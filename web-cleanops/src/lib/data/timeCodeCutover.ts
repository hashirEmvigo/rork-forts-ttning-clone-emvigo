/**
 * Time Code read-path source runtime (TIMECODE-2 / TIMECODE-4).
 *
 * The decision + telemetry layer for the Time Codes cut-over — the Time Codes
 * analogue of {@link import("./roleCutover")}. Time Codes is a single GLOBAL
 * company directory (an in-memory array seeded once at app mount, holding both
 * the Super Admin master library and company codes). When the read path is
 * enabled, the directory is reconciled from Supabase via the validated
 * {@link listFullTimeCodesFromSupabase} path while localStorage stays the backout
 * copy.
 *
 * This module centralises:
 *   • source resolution — whether the directory should read from Supabase
 *     (granular TIME_CODES_SUPABASE_READ OR the TIME_CODES_SUPABASE_AUTHORITATIVE
 *     cut-over),
 *   • write resolution — whether code writes should be mirrored to Supabase
 *     (granular TIME_CODES_DUAL_WRITE OR the authoritative cut-over),
 *   • fallback + failure handling — every Supabase read that fails OR returns an
 *     UNSAFE empty result is RECORDED and surfaced, never silently swallowed.
 *
 * It holds NO React state and performs NO I/O — the
 * {@link useTimeCodeDirectorySource} hook calls into it; it only resolves policy
 * and records counters.
 *
 * Rollback is `flag OFF` → the directory seeds from localStorage with no Supabase
 * dependency on the path.
 */
import {
  TIME_CODES_SUPABASE_READ,
  TIME_CODES_DUAL_WRITE,
  TIME_CODES_SUPABASE_AUTHORITATIVE,
} from "@/lib/featureFlags";

/** Which store currently backs the time-code directory the UI renders. */
export type TimeCodeReadSource = "supabase" | "localStorage";

/** Why a recorded read event served the localStorage seed instead of Supabase. */
export type TimeCodeReadFailureKind = "read" | "unsafe.empty" | "drift";

/** A single recorded fallback/failure/drift event during Supabase-read mode. */
export interface TimeCodeReadFailure {
  kind: TimeCodeReadFailureKind;
  /** App-facing company scope (or "*") the read was attempted for. */
  ref: string;
  message: string;
  at: string;
}

/** Live, cumulative read-path telemetry (development instrumentation only). */
export interface TimeCodeCutoverState {
  /** Whether the directory is read from Supabase (read flag or authoritative). */
  supabaseRead: boolean;
  /** Whether code writes are mirrored to Supabase (dual-write or authoritative). */
  supabaseWrite: boolean;
  /** Resolved read source right now (recomputed from the live flags). */
  readSource: TimeCodeReadSource;
  supabaseReads: number;
  localReads: number;
  fallbacks: number;
  failures: number;
  shadowDrift: number;
  unsafeEmptyReads: number;
  lastMismatch: string | null;
  lastEventAt: string | null;
  recentFailures: TimeCodeReadFailure[];
}

const MAX_RECENT_FAILURES = 50;

function readEnabled(): boolean {
  return TIME_CODES_SUPABASE_READ || TIME_CODES_SUPABASE_AUTHORITATIVE;
}

const state: TimeCodeCutoverState = {
  supabaseRead: readEnabled(),
  supabaseWrite: TIME_CODES_DUAL_WRITE || TIME_CODES_SUPABASE_AUTHORITATIVE,
  readSource: readEnabled() ? "supabase" : "localStorage",
  supabaseReads: 0,
  localReads: 0,
  fallbacks: 0,
  failures: 0,
  shadowDrift: 0,
  unsafeEmptyReads: 0,
  lastMismatch: null,
  lastEventAt: null,
  recentFailures: [],
};

/**
 * Whether the time-code directory should READ from Supabase — true when the
 * granular read flag is on OR the authoritative cut-over is active (the latter
 * implies the read path).
 */
export function shouldReadTimeCodesFromSupabase(): boolean {
  return readEnabled();
}

/**
 * Whether code writes should be MIRRORED to Supabase — true when the granular
 * dual-write flag is on OR the authoritative cut-over is active.
 */
export function shouldMirrorTimeCodeWrites(): boolean {
  return TIME_CODES_DUAL_WRITE || TIME_CODES_SUPABASE_AUTHORITATIVE;
}

/** Returns an immutable snapshot of the cumulative read-path telemetry. */
export function getTimeCodeCutoverState(): TimeCodeCutoverState {
  return {
    ...state,
    supabaseRead: readEnabled(),
    supabaseWrite: TIME_CODES_DUAL_WRITE || TIME_CODES_SUPABASE_AUTHORITATIVE,
    readSource: readEnabled() ? "supabase" : "localStorage",
    recentFailures: [...state.recentFailures],
  };
}

/** Clears the read-path telemetry (used by tests + the dev console). */
export function resetTimeCodeCutoverState(): void {
  state.supabaseReads = 0;
  state.localReads = 0;
  state.fallbacks = 0;
  state.failures = 0;
  state.shadowDrift = 0;
  state.unsafeEmptyReads = 0;
  state.lastMismatch = null;
  state.lastEventAt = null;
  state.recentFailures = [];
}

function pushFailure(kind: TimeCodeReadFailureKind, ref: string, message: string): void {
  const at = new Date().toISOString();
  state.failures += 1;
  state.lastEventAt = at;
  state.recentFailures.unshift({ kind, ref, message, at });
  if (state.recentFailures.length > MAX_RECENT_FAILURES) {
    state.recentFailures.length = MAX_RECENT_FAILURES;
  }
}

/**
 * Records a directory successfully served from Supabase (healthy non-empty, or a
 * safe empty where localStorage is also empty).
 */
export function recordTimeCodeSupabaseRead(): void {
  state.supabaseReads += 1;
}

/**
 * Records a Supabase read that failed and forced a fallback to the localStorage
 * seed. Surfaced, never silent. Also counts as a local serve.
 */
export function recordTimeCodeReadFallback(ref: string, message: string): void {
  state.fallbacks += 1;
  state.localReads += 1;
  pushFailure("read", ref, message);
  if (import.meta.env.DEV === true) {
    // eslint-disable-next-line no-console
    console.warn(`[TIMECODE-2] Time-code directory fallback for ${ref}: ${message}`);
  }
}

/**
 * Records an UNSAFE empty Supabase result — empty while localStorage has data.
 * Per Framework v0.2 §8, empty ≠ a successful read in this case: the local seed
 * is retained (the directory is never blanked) and the event is surfaced.
 */
export function recordTimeCodeUnsafeEmpty(ref: string): void {
  state.unsafeEmptyReads += 1;
  state.fallbacks += 1;
  state.localReads += 1;
  pushFailure(
    "unsafe.empty",
    ref,
    "Supabase returned 0 time codes while localStorage has data — kept local seed.",
  );
  if (import.meta.env.DEV === true) {
    // eslint-disable-next-line no-console
    console.warn(`[TIMECODE-2] Time-code directory unsafe empty for ${ref} — kept local seed.`);
  }
}

/**
 * Records background shadow-comparison drift between the localStorage directory
 * and the Supabase copy. Drift only flags observability; it never blocks the UI.
 */
export function recordTimeCodeShadowDrift(summary: string): void {
  state.shadowDrift += 1;
  state.lastMismatch = summary;
  pushFailure("drift", "shadow", summary);
  if (import.meta.env.DEV === true) {
    // eslint-disable-next-line no-console
    console.warn(`[TIMECODE-2] Time-code directory shadow drift: ${summary}`);
  }
}

// Expose console handles in development for manual inspection.
if (import.meta.env.DEV === true && typeof window !== "undefined") {
  const w = window as unknown as { __cleanopsData?: Record<string, unknown> };
  w.__cleanopsData = {
    ...(w.__cleanopsData ?? {}),
    getTimeCodeCutoverState,
    resetTimeCodeCutoverState,
    shouldReadTimeCodesFromSupabase,
    shouldMirrorTimeCodeWrites,
  };
}
