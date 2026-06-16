/**
 * Time Reporting checkout dual-write gate + state (Slice 2c-2a).
 *
 * The decision + telemetry layer for the Time Reporting checkout dual-write —
 * the Time Reporting analogue of {@link import("./missionLogCutover")}, but
 * WRITE-ONLY: Slice 2c-2a mirrors the legacy checkout into the Time Reporting
 * CORE tables and adds NO read seam, shadow read or read cut-over.
 *
 * It centralises:
 *   • write resolution — {@link shouldMirrorTimeReportingCheckout} (the granular
 *     TIME_REPORTING_DUAL_WRITE flag OR the reserved authoritative cut-over),
 *   • dual-write telemetry — attempted / succeeded / failed / skipped-missing-
 *     company counters + a sanitized recent-failure ring the Development Center
 *     surfaces.
 *
 * It holds NO React state and performs NO I/O — {@link
 * import("./timeReportingDualWrite")} calls into it. CRITICAL: the legacy
 * checkout is authoritative — a Supabase mirror failure is RECORDED here and
 * never surfaced to the user. Rollback is `flag OFF` → no Supabase dependency on
 * the checkout path.
 *
 * Logging is deliberately minimal and sanitized: refs are legacy-id / scope
 * strings and error summaries only — never full report contents or PII.
 */
import {
  TIME_REPORTING_DUAL_WRITE,
  TIME_REPORTING_SUPABASE_AUTHORITATIVE,
} from "@/lib/featureFlags";

/** Why a recorded dual-write event did not fully succeed. */
export type TimeReportingDualWriteFailureKind =
  | "write"
  | "skipped.missing_company"
  | "not_configured";

/** A single recorded dual-write failure (sanitized — no report contents). */
export interface TimeReportingDualWriteFailure {
  kind: TimeReportingDualWriteFailureKind;
  /** App-facing scope the mirror was attempted for (report/company id or "*"). */
  ref: string;
  message: string;
  at: string;
}

/** Live, cumulative checkout dual-write telemetry (development instrumentation). */
export interface TimeReportingCutoverState {
  /** Whether checkout writes are mirrored into Time Reporting right now. */
  supabaseWrite: boolean;
  /** Total mirror attempts (one per gated checkout). */
  attempted: number;
  /** Mirrors that fully succeeded (report + allocations + event written/converged). */
  succeeded: number;
  /** Mirrors that failed (Supabase error / not configured). */
  failed: number;
  /** Mirrors skipped because the company had no Supabase UUID mapping. */
  skippedMissingCompany: number;
  /** Last sanitized error summary, if any. */
  lastError: string | null;
  lastRunAt: string | null;
  /** Most-recent sanitized failures (capped). */
  recentFailures: TimeReportingDualWriteFailure[];
}

const MAX_RECENT_FAILURES = 50;

function writeEnabled(): boolean {
  return TIME_REPORTING_DUAL_WRITE || TIME_REPORTING_SUPABASE_AUTHORITATIVE;
}

const state: TimeReportingCutoverState = {
  supabaseWrite: writeEnabled(),
  attempted: 0,
  succeeded: 0,
  failed: 0,
  skippedMissingCompany: 0,
  lastError: null,
  lastRunAt: null,
  recentFailures: [],
};

/**
 * Whether a checkout should be MIRRORED into the Time Reporting tables — true
 * when the granular TIME_REPORTING_DUAL_WRITE flag is on OR the reserved
 * authoritative cut-over is active. DEFAULT OFF; this is NOT the read resolver.
 */
export function shouldMirrorTimeReportingCheckout(): boolean {
  return writeEnabled();
}

/** Returns an immutable snapshot of the cumulative dual-write telemetry. */
export function getTimeReportingCutoverState(): TimeReportingCutoverState {
  return {
    ...state,
    supabaseWrite: writeEnabled(),
    recentFailures: [...state.recentFailures],
  };
}

/** Clears the dual-write telemetry (used by tests + the dev console). */
export function resetTimeReportingCutoverState(): void {
  state.attempted = 0;
  state.succeeded = 0;
  state.failed = 0;
  state.skippedMissingCompany = 0;
  state.lastError = null;
  state.lastRunAt = null;
  state.recentFailures = [];
}

/** Records the start of one mirror attempt. */
export function recordTimeReportingMirrorAttempt(): void {
  state.attempted += 1;
  state.lastRunAt = new Date().toISOString();
}

/** Records a fully successful mirror. */
export function recordTimeReportingMirrorSuccess(): void {
  state.succeeded += 1;
}

function pushFailure(
  kind: TimeReportingDualWriteFailureKind,
  ref: string,
  message: string,
): void {
  const at = new Date().toISOString();
  state.lastError = message;
  state.recentFailures.unshift({ kind, ref, message, at });
  if (state.recentFailures.length > MAX_RECENT_FAILURES) {
    state.recentFailures.length = MAX_RECENT_FAILURES;
  }
}

/** Records a mirror that failed (Supabase error / not configured). Sanitized. */
export function recordTimeReportingMirrorFailure(
  ref: string,
  message: string,
  kind: TimeReportingDualWriteFailureKind = "write",
): void {
  state.failed += 1;
  pushFailure(kind, ref, message);
  if (import.meta.env.DEV === true) {
    // eslint-disable-next-line no-console
    console.warn(`[TIMEREPORTING-2c] checkout mirror failure for ${ref}: ${message}`);
  }
}

/**
 * Records a mirror skipped because the checkout's company has no Supabase UUID
 * mapping (RLS would reject the write). Surfaced, never silent; the legacy
 * checkout still succeeded.
 */
export function recordTimeReportingMirrorSkippedMissingCompany(
  ref: string,
  message: string,
): void {
  state.skippedMissingCompany += 1;
  pushFailure("skipped.missing_company", ref, message);
  if (import.meta.env.DEV === true) {
    // eslint-disable-next-line no-console
    console.warn(`[TIMEREPORTING-2c] checkout mirror skipped (no company) for ${ref}: ${message}`);
  }
}

// Expose console handles in development for manual inspection.
if (import.meta.env.DEV === true && typeof window !== "undefined") {
  const w = window as unknown as { __cleanopsData?: Record<string, unknown> };
  w.__cleanopsData = {
    ...(w.__cleanopsData ?? {}),
    getTimeReportingCutoverState,
    resetTimeReportingCutoverState,
    shouldMirrorTimeReportingCheckout,
  };
}
