/**
 * Mission Log checkout dual-write mirror (Slice 2c-1).
 *
 * The Mission Log analogue of {@link import("./activityDualWrite")} for the
 * legacy work-order checkout flow. localStorage stays the authoritative source
 * of truth: a checkout's legacy {@link TimeReport} is persisted BEFORE this runs.
 * When MISSION_LOG_DUAL_WRITE is on, AppContext fires {@link
 * mirrorMissionLogCheckout} fire-and-forget to MIRROR that one checkout into the
 * Mission Log execution ledger:
 *
 *   • `mission_log_entries`    — upsert (one mission / service-row context),
 *   • `mission_staff_sessions` — upsert (Option B: one per legacy report),
 *   • `mission_log_events`     — immutable `employee_checked_out` insert,
 *     de-duplicated on its stable idempotency key (`ignoreDuplicates`) so a
 *     retry NEVER duplicates and NEVER mutates an existing event row.
 *
 * Guarantees (identical to the proven mirrors):
 *   • Never throws — always invoked fire-and-forget; a Supabase failure can never
 *     break the legacy checkout, which has already succeeded against localStorage.
 *   • Idempotent — entries/sessions upsert on `legacy_id`; events insert-ignore
 *     on `legacy_id`; repeated mirrors converge and never inflate.
 *   • Company-scoped — every row carries the real `company_id` UUID RLS checks;
 *     a checkout whose company has no Supabase mapping is SKIPPED + surfaced (the
 *     legacy checkout still succeeded).
 *   • Write-only — writes ONLY the three Mission Log tables. It NEVER writes
 *     `mission_booked_time_ratings`, any Time Reporting table, payroll/invoice
 *     basis, the time bank, notifications or AI inference.
 *
 * All cumulative metrics live in {@link getMissionLogCutoverState}.
 */
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import type { TimeReport } from "@/types";
import { loadCompanyUuidMap } from "./customerMigration";
import {
  toMissionLogEntryUpsertRow,
  toMissionStaffSessionUpsertRow,
  toMissionCheckoutEventInsertRow,
  buildMissionLogEntryLegacyId,
  type MissionLogCheckoutContext,
} from "./missionLogMigration";
import {
  recordMissionLogMirrorAttempt,
  recordMissionLogMirrorSuccess,
  recordMissionLogMirrorFailure,
  recordMissionLogMirrorSkippedMissingCompany,
} from "./missionLogCutover";

/** Structured outcome of one {@link mirrorMissionLogCheckout} run. */
export interface MissionLogCheckoutMirrorResult {
  ok: boolean;
  /** True when the company had no Supabase mapping — nothing was written. */
  skipped: boolean;
  /** The Mission Log entry legacy id this checkout mirrored to. */
  missionLogEntryLegacyId: string;
  /** True when the entry upsert ran. */
  entryWritten: boolean;
  /** True when the staff-session upsert ran. */
  sessionWritten: boolean;
  /** True when the event insert ran (ignored-on-conflict still counts). */
  eventWritten: boolean;
  /** Fatal error captured (never thrown to the caller). */
  error: string | null;
}

/**
 * Mirrors ONE legacy checkout into the Mission Log ledger.
 *
 * Always call fire-and-forget AFTER the authoritative localStorage checkout has
 * completed. localStorage is never touched here. A failure is recorded in the
 * Mission Log cut-over state and returned, never thrown.
 *
 * @param report  The legacy checkout TimeReport just persisted to localStorage.
 * @param context The work-order context the report does not carry (customer).
 */
export async function mirrorMissionLogCheckout(
  report: TimeReport,
  context: MissionLogCheckoutContext,
): Promise<MissionLogCheckoutMirrorResult> {
  const stop = perf.start("missionLog.checkout.dual");
  recordMissionLogMirrorAttempt();

  const missionLogEntryLegacyId = buildMissionLogEntryLegacyId(report);
  const ref = `${report.companyId}/${missionLogEntryLegacyId}`;

  const result: MissionLogCheckoutMirrorResult = {
    ok: false,
    skipped: false,
    missionLogEntryLegacyId,
    entryWritten: false,
    sessionWritten: false,
    eventWritten: false,
    error: null,
  };

  const fail = (
    message: string,
    kind: "write" | "not_configured" = "write",
  ): MissionLogCheckoutMirrorResult => {
    recordMissionLogMirrorFailure(ref, message, kind);
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
      recordMissionLogMirrorSkippedMissingCompany(ref, message);
      result.skipped = true;
      result.error = message;
      stop();
      return result;
    }

    // 1. Mission entry — upsert (idempotent on the deterministic entry id).
    const entryRow = toMissionLogEntryUpsertRow(report, context, companyUuid);
    const entryRes = await supabase
      .from("mission_log_entries")
      .upsert(entryRow, { onConflict: "legacy_id" });
    if (entryRes.error) {
      return fail(`Supabase entry upsert failed: ${entryRes.error.message}`);
    }
    result.entryWritten = true;

    // 2. Staff session — upsert (Option B id: one per legacy report).
    const sessionRow = toMissionStaffSessionUpsertRow(report, companyUuid);
    const sessionRes = await supabase
      .from("mission_staff_sessions")
      .upsert(sessionRow, { onConflict: "legacy_id" });
    if (sessionRes.error) {
      return fail(`Supabase session upsert failed: ${sessionRes.error.message}`);
    }
    result.sessionWritten = true;

    // 3. Checkout event — IMMUTABLE insert, de-duplicated on the stable
    //    idempotency key (ignoreDuplicates: existing event rows are untouched).
    const eventRow = toMissionCheckoutEventInsertRow(report, companyUuid);
    const eventRes = await supabase
      .from("mission_log_events")
      .upsert(eventRow, { onConflict: "legacy_id", ignoreDuplicates: true });
    if (eventRes.error) {
      return fail(`Supabase event insert failed: ${eventRes.error.message}`);
    }
    result.eventWritten = true;

    result.ok = true;
    recordMissionLogMirrorSuccess();
    stop();
    return result;
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Unknown mirror error.");
  }
}

// Expose a console handle in development for manual inspection.
if (import.meta.env.DEV === true && typeof window !== "undefined") {
  const w = window as unknown as { __cleanopsData?: Record<string, unknown> };
  w.__cleanopsData = {
    ...(w.__cleanopsData ?? {}),
    mirrorMissionLogCheckout,
  };
}
