/**
 * Mission Log checkout dual-write gate + state (Slice 2c-1).
 *
 * The decision + telemetry layer for the Mission Log checkout dual-write — the
 * Mission Log analogue of the established `*Cutover` modules
 * ({@link import("./teamCutover")} / {@link import("./activityCutover")}), but
 * WRITE-ONLY: Slice 2c-1 mirrors the legacy checkout into the Mission Log
 * execution ledger and adds NO read seam, shadow read or read cut-over.
 *
 * It centralises:
 *   • write resolution — {@link shouldMirrorMissionLogCheckout} (the granular
 *     MISSION_LOG_DUAL_WRITE flag OR the reserved authoritative cut-over),
 *   • dual-write telemetry — attempted / succeeded / failed / skipped-missing-
 *     company counters + a sanitized recent-failure ring the Development Center
 *     surfaces.
 *
 * It holds NO React state and performs NO I/O — {@link
 * import("./missionLogDualWrite")} calls into it. CRITICAL: the legacy checkout
 * is authoritative — a Supabase mirror failure is RECORDED here and never
 * surfaced to the user. Rollback is `flag OFF` → no Supabase dependency on the
 * checkout path.
 *
 * Logging is deliberately minimal and sanitized: refs are legacy-id / scope
 * strings and error summaries only — never full report contents or PII.
 */
import {
  MISSION_LOG_DUAL_WRITE,
  MISSION_LOG_SUPABASE_AUTHORITATIVE,
} from "@/lib/featureFlags";

/** Why a recorded dual-write event did not fully succeed. */
export type MissionLogDualWriteFailureKind =
  | "write"
  | "skipped.missing_company"
  | "not_configured";

/** A single recorded dual-write failure (sanitized — no report contents). */
export interface MissionLogDualWriteFailure {
  kind: MissionLogDualWriteFailureKind;
  /** App-facing scope the mirror was attempted for (mission/company id or "*"). */
  ref: string;
  message: string;
  at: string;
}

/** Live, cumulative checkout dual-write telemetry (development instrumentation). */
export interface MissionLogCutoverState {
  /** Whether checkout writes are mirrored into Mission Log right now. */
  supabaseWrite: boolean;
  /** Total mirror attempts (one per gated checkout). */
  attempted: number;
  /** Mirrors that fully succeeded (entry + session + event written/converged). */
  succeeded: number;
  /** Mirrors that failed (Supabase error / not configured). */
  failed: number;
  /** Mirrors skipped because the company had no Supabase UUID mapping. */
  skippedMissingCompany: number;
  /** Last sanitized error summary, if any. */
  lastError: string | null;
  lastRunAt: string | null;
  /** Most-recent sanitized failures (capped). */
  recentFailures: MissionLogDualWriteFailure[];
}

const MAX_RECENT_FAILURES = 50;

function writeEnabled(): boolean {
  return MISSION_LOG_DUAL_WRITE || MISSION_LOG_SUPABASE_AUTHORITATIVE;
}

const state: MissionLogCutoverState = {
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
 * Whether a checkout should be MIRRORED into the Mission Log ledger — true when
 * the granular MISSION_LOG_DUAL_WRITE flag is on OR the reserved authoritative
 * cut-over is active. DEFAULT OFF; this is NOT the cut-over read resolver.
 */
export function shouldMirrorMissionLogCheckout(): boolean {
  return writeEnabled();
}

/** Returns an immutable snapshot of the cumulative dual-write telemetry. */
export function getMissionLogCutoverState(): MissionLogCutoverState {
  return {
    ...state,
    supabaseWrite: writeEnabled(),
    recentFailures: [...state.recentFailures],
  };
}

/** Clears the dual-write telemetry (used by tests + the dev console). */
export function resetMissionLogCutoverState(): void {
  state.attempted = 0;
  state.succeeded = 0;
  state.failed = 0;
  state.skippedMissingCompany = 0;
  state.lastError = null;
  state.lastRunAt = null;
  state.recentFailures = [];
}

/** Records the start of one mirror attempt. */
export function recordMissionLogMirrorAttempt(): void {
  state.attempted += 1;
  state.lastRunAt = new Date().toISOString();
}

/** Records a fully successful mirror. */
export function recordMissionLogMirrorSuccess(): void {
  state.succeeded += 1;
}

function pushFailure(
  kind: MissionLogDualWriteFailureKind,
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
export function recordMissionLogMirrorFailure(
  ref: string,
  message: string,
  kind: MissionLogDualWriteFailureKind = "write",
): void {
  state.failed += 1;
  pushFailure(kind, ref, message);
  if (import.meta.env.DEV === true) {
    // eslint-disable-next-line no-console
    console.warn(`[MISSIONLOG-2c] checkout mirror failure for ${ref}: ${message}`);
  }
}

/**
 * Records a mirror skipped because the checkout's company has no Supabase UUID
 * mapping (RLS would reject the write). Surfaced, never silent; the legacy
 * checkout still succeeded.
 */
export function recordMissionLogMirrorSkippedMissingCompany(
  ref: string,
  message: string,
): void {
  state.skippedMissingCompany += 1;
  pushFailure("skipped.missing_company", ref, message);
  if (import.meta.env.DEV === true) {
    // eslint-disable-next-line no-console
    console.warn(`[MISSIONLOG-2c] checkout mirror skipped (no company) for ${ref}: ${message}`);
  }
}

// Expose console handles in development for manual inspection.
if (import.meta.env.DEV === true && typeof window !== "undefined") {
  const w = window as unknown as { __cleanopsData?: Record<string, unknown> };
  w.__cleanopsData = {
    ...(w.__cleanopsData ?? {}),
    getMissionLogCutoverState,
    resetMissionLogCutoverState,
    shouldMirrorMissionLogCheckout,
  };
}
