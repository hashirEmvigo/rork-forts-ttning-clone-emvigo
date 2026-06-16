/**
 * Operational Execution parity — read-only fetch runner (Slice 2d-2).
 *
 * The controlled, READ-ONLY bridge between a caller-provided legacy checkout
 * {@link TimeReport} and the pure comparators ({@link
 * import("./timeReportingParity").compareTimeReportingParity} / {@link
 * import("./missionLogParity").compareMissionLogParity}). It fetches the matching
 * Supabase rows by their DETERMINISTIC legacy ids (company-scoped, soft-deleted
 * excluded), runs the comparators and records SANITIZED telemetry via {@link
 * import("./timeReportingParityState")}.
 *
 * STRICTLY VALIDATION ONLY:
 *   • Gated by {@link TIME_REPORTING_SHADOW_VALIDATE} (DEFAULT OFF). With the gate
 *     off NOTHING is fetched and NO telemetry is recorded.
 *   • READ-ONLY — only `.select()` by deterministic id; it never upserts, inserts,
 *     updates or deletes, never touches localStorage, never mutates Schedule and
 *     never writes payroll / invoice / time-bank / notifications / AI.
 *   • NEVER throws into the caller — a Supabase fetch failure, an unconfigured
 *     client or even a comparator error is caught, recorded as a sanitized fetch
 *     failure and returned. It does not change live reads or block checkout.
 *   • It does NOT import AppContext or any UI-layer logic.
 *
 * It is NOT wired into checkout in this slice — it is a callable test / dev
 * utility. Mission Log parity is OPT-IN per call (`includeMissionLog`) and its
 * absence grading follows {@link MISSION_LOG_DUAL_WRITE} (overridable per call):
 * OFF → missing Mission Log rows are info/expected; ON → warning/blocking.
 */
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import {
  MISSION_LOG_DUAL_WRITE,
  TIME_REPORTING_SHADOW_VALIDATE,
} from "@/lib/featureFlags";
import type { TimeReport } from "@/types";
import {
  buildTimeReportLegacyId,
  type TimeReportingCheckoutContext,
} from "./timeReportingMigration";
import {
  buildMissionLogEntryLegacyId,
  buildMissionStaffSessionLegacyId,
  buildCheckoutEventLegacyId,
  type MissionLogCheckoutContext,
} from "./missionLogMigration";
import {
  compareTimeReportingParity as defaultCompareTimeReporting,
  type TimeReportingParityRows,
} from "./timeReportingParity";
import {
  compareMissionLogParity as defaultCompareMissionLog,
  type MissionLogParityRows,
} from "./missionLogParity";
import type { ParityResult } from "./parityShared";
import {
  recordParityResult,
  recordParityMissingInLegacy,
  recordParityFetchFailure,
} from "./timeReportingParityState";

/** Whether the parity runner is allowed to run (DEFAULT OFF). */
export function shouldRunTimeReportingShadowValidation(): boolean {
  return TIME_REPORTING_SHADOW_VALIDATE;
}

/** Options for one parity run (all optional; sensible flag-driven defaults). */
export interface ParityRunOptions {
  /**
   * Overrides the {@link TIME_REPORTING_SHADOW_VALIDATE} gate. When false (or the
   * flag is off and this is unset) NOTHING is fetched and NO telemetry is
   * recorded. Tests pass `true` to run while the flag is off under vitest.
   */
  enabled?: boolean;
  /** Also fetch + compare the Mission Log rows for this checkout. */
  includeMissionLog?: boolean;
  /**
   * Whether Mission Log dual-write is considered enabled (drives how ABSENT
   * Mission Log rows are graded). Defaults to {@link MISSION_LOG_DUAL_WRITE}.
   */
  missionLogDualWriteEnabled?: boolean;
  /** Injected Time Reporting comparator (defaults to the real pure function). */
  compareTimeReporting?: typeof defaultCompareTimeReporting;
  /** Injected Mission Log comparator (defaults to the real pure function). */
  compareMissionLog?: typeof defaultCompareMissionLog;
}

/** Structured outcome of {@link runTimeReportingParityForReport}. */
export interface TimeReportingParityRunResult {
  /** False when the gate was off (nothing fetched / recorded). */
  ran: boolean;
  /** Reason the run did not execute, when `ran` is false. */
  skippedReason?: "disabled";
  /** The deterministic report legacy id the run anchored on. */
  reportLegacyId: string;
  /** The Time Reporting comparator result, or null on a fetch failure. */
  timeReporting: ParityResult | null;
  /** The Mission Log comparator result (only when requested), or null. */
  missionLog: ParityResult | null;
  /** Sanitized fetch / comparator error, when one was caught (never thrown). */
  fetchError: string | null;
}

/** One legacy checkout report + the work-order context it does not carry. */
export interface ParityReportInput {
  report: TimeReport;
  context: TimeReportingCheckoutContext & MissionLogCheckoutContext;
}

function resolveEnabled(opts: ParityRunOptions): boolean {
  return opts.enabled ?? shouldRunTimeReportingShadowValidation();
}

// ── Read-only fetch helpers (by deterministic id, company-scoped) ────────────

const REPORT_COLUMNS =
  "legacy_id, company_legacy_id, work_order_legacy_id, service_row_legacy_id, " +
  "employee_legacy_id, employee_name_snapshot, scheduled_duration_minutes, " +
  "actual_duration_minutes, total_deviation_minutes, status, requires_admin_review, " +
  "payroll_approval_status, invoice_basis_status, ai_recommendation, submitted_at, " +
  "mission_log_entry_legacy_id, mission_staff_session_legacy_id, deleted_at";

interface MaybeSingle<T> {
  maybeSingle(): Promise<{ data: T | null; error: { message: string } | null }>;
}
interface ListResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}

/** Fetches the matching Time Reporting rows for ONE checkout (read-only). */
async function fetchTimeReportingRows(
  reportLegacyId: string,
  companyLegacyId: string,
): Promise<TimeReportingParityRows> {
  if (!supabase) throw new Error("Supabase is not configured.");

  const reportQuery = supabase
    .from("time_reports")
    .select(REPORT_COLUMNS)
    .eq("legacy_id", reportLegacyId)
    .eq("company_legacy_id", companyLegacyId)
    .is("deleted_at", null) as unknown as MaybeSingle<TimeReportingParityRows["report"]>;
  const { data: report, error: reportError } = await reportQuery.maybeSingle();
  if (reportError) {
    throw new Error(`time_reports fetch failed: ${reportError.message}`);
  }

  // A missing report → empty children; the comparator records `report.missing`.
  if (!report) {
    return { report: null, allocations: [], events: [], flags: [], flagEvents: [], messages: [] };
  }

  const [allocations, events, flags, flagEvents, messages] = await Promise.all([
    fetchChildList<TimeReportingParityRows["allocations"][number]>(
      "time_allocations",
      "time_report_legacy_id",
      reportLegacyId,
      true,
    ),
    fetchChildList<TimeReportingParityRows["events"][number]>(
      "time_report_events",
      "time_report_legacy_id",
      reportLegacyId,
      false,
    ),
    fetchChildList<TimeReportingParityRows["flags"][number]>(
      "time_report_flags",
      "time_report_legacy_id",
      reportLegacyId,
      true,
    ),
    fetchChildList<TimeReportingParityRows["flagEvents"][number]>(
      "time_report_flag_events",
      "time_report_legacy_id",
      reportLegacyId,
      false,
    ),
    fetchChildList<TimeReportingParityRows["messages"][number]>(
      "time_report_messages",
      "time_report_legacy_id",
      reportLegacyId,
      false,
    ),
  ]);

  return { report, allocations, events, flags, flagEvents, messages };
}

/** Fetches a child list by `time_report_legacy_id`, excluding soft-deleted. */
async function fetchChildList<T>(
  table: string,
  column: string,
  value: string,
  excludeDeleted: boolean,
): Promise<T[]> {
  if (!supabase) throw new Error("Supabase is not configured.");
  let query = supabase.from(table).select("*").eq(column, value);
  if (excludeDeleted) {
    query = (query as unknown as { is(c: string, v: unknown): typeof query }).is(
      "deleted_at",
      null,
    );
  }
  const { data, error } = (await query) as unknown as ListResult<T>;
  if (error) throw new Error(`${table} fetch failed: ${error.message}`);
  return data ?? [];
}

/** Fetches the matching Mission Log rows for ONE checkout (read-only). */
async function fetchMissionLogRows(report: TimeReport): Promise<MissionLogParityRows> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const entryLegacyId = buildMissionLogEntryLegacyId(report);
  const sessionLegacyId = buildMissionStaffSessionLegacyId(report);
  const eventLegacyId = buildCheckoutEventLegacyId(report);

  const entryQuery = supabase
    .from("mission_log_entries")
    .select("*")
    .eq("legacy_id", entryLegacyId)
    .is("deleted_at", null) as unknown as MaybeSingle<MissionLogParityRows["entry"]>;
  const sessionQuery = supabase
    .from("mission_staff_sessions")
    .select("*")
    .eq("legacy_id", sessionLegacyId)
    .is("deleted_at", null) as unknown as MaybeSingle<MissionLogParityRows["session"]>;
  // Fetch the checkout event by its OWN deterministic id so a sibling report on
  // the same mission entry can never look like a duplicate of this one.
  const eventQuery = supabase
    .from("mission_log_events")
    .select("*")
    .eq("legacy_id", eventLegacyId) as unknown as MaybeSingle<
    MissionLogParityRows["events"][number]
  >;

  const [entryRes, sessionRes, eventRes] = await Promise.all([
    entryQuery.maybeSingle(),
    sessionQuery.maybeSingle(),
    eventQuery.maybeSingle(),
  ]);
  if (entryRes.error) throw new Error(`mission_log_entries fetch failed: ${entryRes.error.message}`);
  if (sessionRes.error) throw new Error(`mission_staff_sessions fetch failed: ${sessionRes.error.message}`);
  if (eventRes.error) throw new Error(`mission_log_events fetch failed: ${eventRes.error.message}`);

  return {
    entry: entryRes.data,
    session: sessionRes.data,
    events: eventRes.data ? [eventRes.data] : [],
  };
}

// ── Public runners ──────────────────────────────────────────────────────────

/**
 * Validates ONE legacy checkout {@link TimeReport} against its Supabase rows.
 *
 * READ-ONLY + gated + never-throwing. With the gate off it returns
 * `{ ran: false }` and records nothing. On any fetch / comparator error it
 * records a sanitized failure and returns `{ fetchError }` — it never throws.
 */
export async function runTimeReportingParityForReport(
  report: TimeReport,
  context: TimeReportingCheckoutContext & MissionLogCheckoutContext,
  opts: ParityRunOptions = {},
): Promise<TimeReportingParityRunResult> {
  const reportLegacyId = buildTimeReportLegacyId(report);
  const result: TimeReportingParityRunResult = {
    ran: false,
    reportLegacyId,
    timeReporting: null,
    missionLog: null,
    fetchError: null,
  };

  if (!resolveEnabled(opts)) {
    result.skippedReason = "disabled";
    return result;
  }
  result.ran = true;

  const ref = `${report.companyId}/${reportLegacyId}`;
  const stop = perf.start("timeReporting.parity.run");
  try {
    if (!isSupabaseConfigured || !supabase) {
      throw new Error("Supabase is not configured.");
    }

    const compareTimeReporting = opts.compareTimeReporting ?? defaultCompareTimeReporting;
    const compareMissionLog = opts.compareMissionLog ?? defaultCompareMissionLog;

    const trRows = await fetchTimeReportingRows(reportLegacyId, report.companyId);
    const trResult = compareTimeReporting(report, context, trRows);
    recordParityResult(trResult);
    result.timeReporting = trResult;

    if (opts.includeMissionLog) {
      const mlEnabled = opts.missionLogDualWriteEnabled ?? MISSION_LOG_DUAL_WRITE;
      const mlRows = await fetchMissionLogRows(report);
      const mlResult = compareMissionLog(report, context, mlRows, {
        missionLogDualWriteEnabled: mlEnabled,
      });
      recordParityResult(mlResult);
      result.missionLog = mlResult;
    }

    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown parity error.";
    recordParityFetchFailure(ref, message);
    result.fetchError = message;
    return result;
  } finally {
    stop();
  }
}

/** Structured outcome of {@link runTimeReportingParityBatch}. */
export interface TimeReportingParityBatchResult {
  /** False when the gate was off (nothing fetched / recorded). */
  ran: boolean;
  skippedReason?: "disabled";
  /** Number of reports actually validated. */
  checked: number;
  /** Per-report results, in input order. */
  results: TimeReportingParityRunResult[];
  /** Supabase report legacy ids with no matching legacy report (when provided). */
  missingInLegacy: string[];
}

/** Options for a batch parity run. */
export interface ParityBatchOptions extends ParityRunOptions {
  /**
   * OPTIONAL bounded set of report legacy ids known to exist in Supabase for the
   * scope (the caller fetches the lightweight `legacy_id` column). When provided,
   * any id NOT produced by the batch's legacy reports is recorded as
   * missing-in-legacy. Omit to skip the inverse check (no broad scan).
   */
  supabaseReportLegacyIds?: readonly string[];
}

/**
 * Validates a BOUNDED batch of legacy checkout reports sequentially. READ-ONLY +
 * gated + never-throwing (each report is isolated). When
 * {@link ParityBatchOptions.supabaseReportLegacyIds} is provided it also records
 * the inverse (Supabase rows absent from the legacy batch) as missing-in-legacy.
 */
export async function runTimeReportingParityBatch(
  inputs: readonly ParityReportInput[],
  opts: ParityBatchOptions = {},
): Promise<TimeReportingParityBatchResult> {
  const batch: TimeReportingParityBatchResult = {
    ran: false,
    checked: 0,
    results: [],
    missingInLegacy: [],
  };

  if (!resolveEnabled(opts)) {
    batch.skippedReason = "disabled";
    return batch;
  }
  batch.ran = true;

  // Force the per-report runs to honour the resolved gate without re-reading it.
  const runOpts: ParityRunOptions = { ...opts, enabled: true };
  for (const input of inputs) {
    const res = await runTimeReportingParityForReport(input.report, input.context, runOpts);
    batch.results.push(res);
    batch.checked += 1;
  }

  if (opts.supabaseReportLegacyIds) {
    const legacyIds = new Set(inputs.map((i) => buildTimeReportLegacyId(i.report)));
    for (const supabaseId of opts.supabaseReportLegacyIds) {
      if (!legacyIds.has(supabaseId)) {
        recordParityMissingInLegacy(supabaseId);
        batch.missingInLegacy.push(supabaseId);
      }
    }
  }

  return batch;
}

// Expose console handles in development for manual inspection.
if (import.meta.env.DEV === true && typeof window !== "undefined") {
  const w = window as unknown as { __cleanopsData?: Record<string, unknown> };
  w.__cleanopsData = {
    ...(w.__cleanopsData ?? {}),
    runTimeReportingParityForReport,
    runTimeReportingParityBatch,
    shouldRunTimeReportingShadowValidation,
  };
}
