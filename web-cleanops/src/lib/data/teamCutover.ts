/**
 * Team read-path source runtime (TEAM-2 / TEAM-4).
 *
 * The decision + telemetry layer for the Teams cut-over \u2014 the Teams analogue of
 * {@link import("./employeeCutover")}. Teams is a single GLOBAL company directory
 * (an in-memory array seeded once at app mount). When the read path is enabled,
 * the directory is reconciled from Supabase via the validated
 * {@link listFullTeamsFromSupabase} path while localStorage stays the backout
 * copy.
 *
 * This module centralises:
 *   \u2022 source resolution \u2014 whether the directory should read from Supabase
 *     (granular TEAMS_SUPABASE_READ OR the TEAMS_SUPABASE_AUTHORITATIVE cut-over),
 *   \u2022 write resolution \u2014 whether team writes should be mirrored to Supabase
 *     (granular TEAMS_DUAL_WRITE OR the authoritative cut-over),
 *   \u2022 fallback + failure handling \u2014 every Supabase read that fails OR returns an
 *     UNSAFE empty result is RECORDED and surfaced, never silently swallowed.
 *
 * It holds NO React state and performs NO I/O \u2014 the {@link useTeamDirectorySource}
 * hook calls into it; it only resolves policy and records counters.
 *
 * Rollback is `flag OFF` \u2192 the directory seeds from localStorage with no Supabase
 * dependency on the path.
 */
import {
  TEAMS_SUPABASE_READ,
  TEAMS_DUAL_WRITE,
  TEAMS_SUPABASE_AUTHORITATIVE,
} from "@/lib/featureFlags";

/** Which store currently backs the team directory the UI renders. */
export type TeamReadSource = "supabase" | "localStorage";

/** Why a recorded read event served the localStorage seed instead of Supabase. */
export type TeamReadFailureKind = "read" | "unsafe.empty" | "drift";

/** A single recorded fallback/failure/drift event during Supabase-read mode. */
export interface TeamReadFailure {
  kind: TeamReadFailureKind;
  /** App-facing company scope (or "*") the read was attempted for. */
  ref: string;
  message: string;
  at: string;
}

/** Live, cumulative read-path telemetry (development instrumentation only). */
export interface TeamCutoverState {
  /** Whether the directory is read from Supabase (read flag or authoritative). */
  supabaseRead: boolean;
  /** Whether team writes are mirrored to Supabase (dual-write or authoritative). */
  supabaseWrite: boolean;
  /** Resolved read source right now (recomputed from the live flags). */
  readSource: TeamReadSource;
  supabaseReads: number;
  localReads: number;
  fallbacks: number;
  failures: number;
  shadowDrift: number;
  unsafeEmptyReads: number;
  lastMismatch: string | null;
  lastEventAt: string | null;
  recentFailures: TeamReadFailure[];
}

const MAX_RECENT_FAILURES = 50;

function readEnabled(): boolean {
  return TEAMS_SUPABASE_READ || TEAMS_SUPABASE_AUTHORITATIVE;
}

const state: TeamCutoverState = {
  supabaseRead: readEnabled(),
  supabaseWrite: TEAMS_DUAL_WRITE || TEAMS_SUPABASE_AUTHORITATIVE,
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
 * Whether the team directory should READ from Supabase \u2014 true when the granular
 * read flag is on OR the authoritative cut-over is active (the latter implies the
 * read path).
 */
export function shouldReadTeamsFromSupabase(): boolean {
  return readEnabled();
}

/**
 * Whether team writes should be MIRRORED to Supabase \u2014 true when the granular
 * dual-write flag is on OR the authoritative cut-over is active.
 */
export function shouldMirrorTeamWrites(): boolean {
  return TEAMS_DUAL_WRITE || TEAMS_SUPABASE_AUTHORITATIVE;
}

/** Returns an immutable snapshot of the cumulative read-path telemetry. */
export function getTeamCutoverState(): TeamCutoverState {
  return {
    ...state,
    supabaseRead: readEnabled(),
    supabaseWrite: TEAMS_DUAL_WRITE || TEAMS_SUPABASE_AUTHORITATIVE,
    readSource: readEnabled() ? "supabase" : "localStorage",
    recentFailures: [...state.recentFailures],
  };
}

/** Clears the read-path telemetry (used by tests + the dev console). */
export function resetTeamCutoverState(): void {
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

function pushFailure(kind: TeamReadFailureKind, ref: string, message: string): void {
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
export function recordTeamSupabaseRead(): void {
  state.supabaseReads += 1;
}

/**
 * Records a Supabase read that failed and forced a fallback to the localStorage
 * seed. Surfaced, never silent. Also counts as a local serve.
 */
export function recordTeamReadFallback(ref: string, message: string): void {
  state.fallbacks += 1;
  state.localReads += 1;
  pushFailure("read", ref, message);
  if (import.meta.env.DEV === true) {
    // eslint-disable-next-line no-console
    console.warn(`[TEAM-2] Team directory fallback for ${ref}: ${message}`);
  }
}

/**
 * Records an UNSAFE empty Supabase result \u2014 empty while localStorage has data.
 * Per Framework v0.2 \u00a78, empty \u2260 a successful read in this case: the local seed
 * is retained (the directory is never blanked) and the event is surfaced.
 */
export function recordTeamUnsafeEmpty(ref: string): void {
  state.unsafeEmptyReads += 1;
  state.fallbacks += 1;
  state.localReads += 1;
  pushFailure(
    "unsafe.empty",
    ref,
    "Supabase returned 0 teams while localStorage has data \u2014 kept local seed.",
  );
  if (import.meta.env.DEV === true) {
    // eslint-disable-next-line no-console
    console.warn(`[TEAM-2] Team directory unsafe empty for ${ref} \u2014 kept local seed.`);
  }
}

/**
 * Records background shadow-comparison drift between the localStorage directory
 * and the Supabase copy. Drift only flags observability; it never blocks the UI.
 */
export function recordTeamShadowDrift(summary: string): void {
  state.shadowDrift += 1;
  state.lastMismatch = summary;
  pushFailure("drift", "shadow", summary);
  if (import.meta.env.DEV === true) {
    // eslint-disable-next-line no-console
    console.warn(`[TEAM-2] Team directory shadow drift: ${summary}`);
  }
}

// Expose console handles in development for manual inspection.
if (import.meta.env.DEV === true && typeof window !== "undefined") {
  const w = window as unknown as { __cleanopsData?: Record<string, unknown> };
  w.__cleanopsData = {
    ...(w.__cleanopsData ?? {}),
    getTeamCutoverState,
    resetTeamCutoverState,
    shouldReadTeamsFromSupabase,
    shouldMirrorTeamWrites,
  };
}
