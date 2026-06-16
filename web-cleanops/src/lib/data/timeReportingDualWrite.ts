/**
 * Time Reporting checkout dual-write mirror (Slice 2c-2a).
 *
 * The Time Reporting analogue of {@link import("./missionLogDualWrite")} for the
 * legacy work-order checkout flow. localStorage stays the authoritative source
 * of truth: a checkout's legacy {@link TimeReport} is persisted BEFORE this
 * runs. When TIME_REPORTING_DUAL_WRITE is on, AppContext fires {@link
 * mirrorTimeReportingCheckout} fire-and-forget to MIRROR that one checkout into
 * the Time Reporting CORE tables:
 *
 *   • `time_reports`       — upsert (one authoritative report per checkout),
 *   • `time_allocations`   — upsert (scheduled always + deviation slices > 0),
 *   • `time_report_events` — immutable `time_report_submitted` insert,
 *     de-duplicated on its stable idempotency key (`ignoreDuplicates`) so a
 *     retry NEVER duplicates and NEVER mutates an existing event row,
 *   • `time_report_flags`       — Slice 2c-2b: ONE `deviation_review` flag,
 *     written ONLY when the checkout requires admin review, INSERT-ONCE
 *     (`ignoreDuplicates`) so a retried mirror never clobbers a later admin
 *     resolution; its `resolution_status` is tracked SEPARATELY from approval,
 *   • `time_report_flag_events` — Slice 2c-2b: the immutable `flag_opened` open
 *     event for that flag, insert-ignored on its stable idempotency key,
 *   • `time_report_messages`    — Slice 2c-2b: ONE immutable checkout message,
 *     written ONLY when the checkout carries a real deviation comment,
 *     insert-ignored on its stable idempotency key (no empty message).
 *
 * Guarantees (identical to the proven Mission Log mirror):
 *   • Never throws — always invoked fire-and-forget; a Supabase failure can
 *     never break the legacy checkout, which has already succeeded.
 *   • Idempotent — report/allocations upsert on `legacy_id`; the event inserts
 *     insert-ignore on `legacy_id`; repeated mirrors converge and never inflate.
 *   • Company-scoped — every row carries the real `company_id` UUID RLS checks;
 *     a checkout whose company has no Supabase mapping is SKIPPED + surfaced (the
 *     legacy checkout still succeeded).
 *   • Write-only, Time Reporting only — writes ONLY the three CORE tables plus
 *     (Slice 2c-2b) the optional flag / flag-event / message review surface. It
 *     NEVER writes payroll/invoice basis, the time bank, notifications or AI
 *     inference.
 *
 * All cumulative metrics live in {@link getTimeReportingCutoverState}.
 */
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import { MISSION_LOG_DUAL_WRITE } from "@/lib/featureFlags";
import type { TimeReport } from "@/types";
import { loadCompanyUuidMap } from "./customerMigration";
import {
  runTimeReportingParityForReport,
  shouldRunTimeReportingShadowValidation,
} from "./timeReportingParityRunner";
import {
  toTimeReportUpsertRow,
  toTimeAllocationUpsertRows,
  toTimeReportSubmittedEventInsertRow,
  toTimeReportFlagUpsertRow,
  toTimeReportFlagOpenedEventInsertRow,
  toTimeReportCheckoutMessageInsertRow,
  buildTimeReportLegacyId,
  shouldCreateAdminReviewFlag,
  getCheckoutMessageText,
  type TimeReportingCheckoutContext,
} from "./timeReportingMigration";
import {
  recordTimeReportingMirrorAttempt,
  recordTimeReportingMirrorSuccess,
  recordTimeReportingMirrorFailure,
  recordTimeReportingMirrorSkippedMissingCompany,
} from "./timeReportingCutover";

/**
 * Optional hook overrides for {@link mirrorTimeReportingCheckout} (Slice 2d-3).
 *
 * AppContext never passes these — the live checkout uses the real flag-driven
 * gate and the real read-only runner. They exist ONLY so the gated fire-and-forget
 * shadow-validation hook is deterministically testable in isolation.
 */
export interface MirrorTimeReportingHookOptions {
  /**
   * Overrides the {@link TIME_REPORTING_SHADOW_VALIDATE} gate. Defaults to
   * {@link shouldRunTimeReportingShadowValidation}. With the gate off the parity
   * runner is NOT called at all.
   */
  shadowValidationEnabled?: boolean;
  /**
   * Whether Mission Log dual-write is on — drives `includeMissionLog` and how an
   * ABSENT Mission Log row is graded. Defaults to {@link MISSION_LOG_DUAL_WRITE}.
   */
  missionLogDualWriteEnabled?: boolean;
  /** Injected parity runner (defaults to the real read-only runner). */
  runShadowValidation?: typeof runTimeReportingParityForReport;
}

/** Structured outcome of one {@link mirrorTimeReportingCheckout} run. */
export interface TimeReportingCheckoutMirrorResult {
  ok: boolean;
  /** True when the company had no Supabase mapping — nothing was written. */
  skipped: boolean;
  /** The time-report legacy id this checkout mirrored to. */
  timeReportLegacyId: string;
  /** True when the report upsert ran. */
  reportWritten: boolean;
  /** Number of allocation rows upserted (1–3). */
  allocationsWritten: number;
  /** True when the submitted-event insert ran (ignored-on-conflict still counts). */
  eventWritten: boolean;
  /** True when the admin-review flag insert ran (only when review is required). */
  flagWritten: boolean;
  /** True when the flag-opened event insert ran (only when a flag was written). */
  flagEventWritten: boolean;
  /** True when the checkout-comment message insert ran (only when a comment exists). */
  messageWritten: boolean;
  /** Fatal error captured (never thrown to the caller). */
  error: string | null;
}

/**
 * Mirrors ONE legacy checkout into the Time Reporting CORE tables.
 *
 * Always call fire-and-forget AFTER the authoritative localStorage checkout has
 * completed. localStorage is never touched here. A failure is recorded in the
 * Time Reporting cut-over state and returned, never thrown.
 *
 * @param report  The legacy checkout TimeReport just persisted to localStorage.
 * @param context The work-order context the report does not carry (customer).
 */
export async function mirrorTimeReportingCheckout(
  report: TimeReport,
  context: TimeReportingCheckoutContext,
  hookOpts: MirrorTimeReportingHookOptions = {},
): Promise<TimeReportingCheckoutMirrorResult> {
  const stop = perf.start("timeReporting.checkout.dual");
  recordTimeReportingMirrorAttempt();

  const timeReportLegacyId = buildTimeReportLegacyId(report);
  const ref = `${report.companyId}/${timeReportLegacyId}`;

  const result: TimeReportingCheckoutMirrorResult = {
    ok: false,
    skipped: false,
    timeReportLegacyId,
    reportWritten: false,
    allocationsWritten: 0,
    eventWritten: false,
    flagWritten: false,
    flagEventWritten: false,
    messageWritten: false,
    error: null,
  };

  const fail = (
    message: string,
    kind: "write" | "not_configured" = "write",
  ): TimeReportingCheckoutMirrorResult => {
    recordTimeReportingMirrorFailure(ref, message, kind);
    result.error = message;
    stop();
    return result;
  };

  try {
    if (!isSupabaseConfigured || !supabase) {
      return fail("Supabase is not configured.", "not_configured");
    }

    const companyMap = await loadCompanyUuidMap();
    const companyUuid = companyMap.get(report.companyId) ?? null;
    if (!companyUuid) {
      const message = `No Supabase company for legacy_id "${report.companyId}". Migrate companies first.`;
      recordTimeReportingMirrorSkippedMissingCompany(ref, message);
      result.skipped = true;
      result.error = message;
      stop();
      return result;
    }

    // 1. Time report — upsert (idempotent on the deterministic report id).
    const reportRow = toTimeReportUpsertRow(report, context, companyUuid);
    const reportRes = await supabase
      .from("time_reports")
      .upsert(reportRow, { onConflict: "legacy_id" });
    if (reportRes.error) {
      return fail(`Supabase report upsert failed: ${reportRes.error.message}`);
    }
    result.reportWritten = true;

    // 2. Allocations — upsert (scheduled always + deviation slices > 0).
    const allocationRows = toTimeAllocationUpsertRows(report, companyUuid);
    const allocationsRes = await supabase
      .from("time_allocations")
      .upsert(allocationRows, { onConflict: "legacy_id" });
    if (allocationsRes.error) {
      return fail(`Supabase allocations upsert failed: ${allocationsRes.error.message}`);
    }
    result.allocationsWritten = allocationRows.length;

    // 3. Submitted event — IMMUTABLE insert, de-duplicated on the stable
    //    idempotency key (ignoreDuplicates: existing event rows are untouched).
    const eventRow = toTimeReportSubmittedEventInsertRow(report, companyUuid);
    const eventRes = await supabase
      .from("time_report_events")
      .upsert(eventRow, { onConflict: "legacy_id", ignoreDuplicates: true });
    if (eventRes.error) {
      return fail(`Supabase event insert failed: ${eventRes.error.message}`);
    }
    result.eventWritten = true;

    // 4. Admin-review flag (+ its open event) — ONLY when the checkout routes to
    //    admin review. INSERT-ONCE (ignoreDuplicates) so a retried mirror never
    //    clobbers a later admin resolution; flag resolution stays SEPARATE from
    //    approval. An auto-approved checkout raises no flag.
    if (shouldCreateAdminReviewFlag(report)) {
      const flagRow = toTimeReportFlagUpsertRow(report, companyUuid);
      const flagRes = await supabase
        .from("time_report_flags")
        .upsert(flagRow, { onConflict: "legacy_id", ignoreDuplicates: true });
      if (flagRes.error) {
        return fail(`Supabase flag insert failed: ${flagRes.error.message}`);
      }
      result.flagWritten = true;

      const flagEventRow = toTimeReportFlagOpenedEventInsertRow(report, companyUuid);
      const flagEventRes = await supabase
        .from("time_report_flag_events")
        .upsert(flagEventRow, { onConflict: "legacy_id", ignoreDuplicates: true });
      if (flagEventRes.error) {
        return fail(`Supabase flag event insert failed: ${flagEventRes.error.message}`);
      }
      result.flagEventWritten = true;
    }

    // 5. Checkout message — ONLY when the checkout carries a real deviation
    //    comment (no empty message). IMMUTABLE insert, de-duplicated on its
    //    stable idempotency key.
    const messageText = getCheckoutMessageText(report);
    if (messageText) {
      const messageRow = toTimeReportCheckoutMessageInsertRow(
        report,
        messageText,
        companyUuid,
      );
      const messageRes = await supabase
        .from("time_report_messages")
        .upsert(messageRow, { onConflict: "legacy_id", ignoreDuplicates: true });
      if (messageRes.error) {
        return fail(`Supabase message insert failed: ${messageRes.error.message}`);
      }
      result.messageWritten = true;
    }

    result.ok = true;
    recordTimeReportingMirrorSuccess();

    // Slice 2d-3 — gated fire-and-forget runtime parity validation. It runs ONLY
    // here, at the success tail AFTER every Time Reporting write has completed,
    // so the parity reads can never race the writes this mirror just made. It is
    // never awaited, never blocks checkout and (by design) never throws.
    scheduleShadowValidation(report, context, hookOpts);

    stop();
    return result;
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Unknown mirror error.");
  }
}

/**
 * Slice 2d-3 — schedules the gated fire-and-forget parity validation for ONE
 * just-mirrored checkout. Called ONLY from the success tail of {@link
 * mirrorTimeReportingCheckout} (never on a failure / skip). Gated by
 * {@link shouldRunTimeReportingShadowValidation}; the runner is read-only and
 * never throws, but the returned promise is defensively swallowed so a rejection
 * can never surface to the already-successful checkout.
 */
function scheduleShadowValidation(
  report: TimeReport,
  context: TimeReportingCheckoutContext,
  hookOpts: MirrorTimeReportingHookOptions,
): void {
  const enabled =
    hookOpts.shadowValidationEnabled ?? shouldRunTimeReportingShadowValidation();
  if (!enabled) return;

  // includeMissionLog reflects MISSION_LOG_DUAL_WRITE: when Mission Log dual-write
  // is off we do not fetch/compare Mission Log rows at all (their absence stays
  // non-blocking); when on we validate + grade them as warning/blocking.
  const missionLogDualWriteEnabled =
    hookOpts.missionLogDualWriteEnabled ?? MISSION_LOG_DUAL_WRITE;
  const run = hookOpts.runShadowValidation ?? runTimeReportingParityForReport;

  try {
    const pending = run(report, context, {
      enabled: true,
      includeMissionLog: missionLogDualWriteEnabled,
      missionLogDualWriteEnabled,
    });
    void Promise.resolve(pending).catch(() => {
      // The runner is designed to never reject; swallow defensively so runtime
      // validation can never affect the authoritative checkout.
    });
  } catch {
    // An injected runner could throw synchronously — swallow for the same reason.
  }
}

// Expose a console handle in development for manual inspection.
if (import.meta.env.DEV === true && typeof window !== "undefined") {
  const w = window as unknown as { __cleanopsData?: Record<string, unknown> };
  w.__cleanopsData = {
    ...(w.__cleanopsData ?? {}),
    mirrorTimeReportingCheckout,
  };
}
