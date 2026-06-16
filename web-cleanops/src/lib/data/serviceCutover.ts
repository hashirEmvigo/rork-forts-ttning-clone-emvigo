/**
 * Service read-path source runtime (SVC-2 / SVC-4).
 *
 * The decision + telemetry layer for the Services cut-over — the Services
 * analogue of {@link import("./teamCutover")}. Services is a single GLOBAL
 * company directory (an in-memory array seeded once at app mount, holding both
 * the Super Admin global catalog and company services). When the read path is
 * enabled, the directory is reconciled from Supabase via the validated
 * {@link listFullServicesFromSupabase} path while localStorage stays the backout
 * copy.
 *
 * This module centralises:
 *   • source resolution — whether the directory should read from Supabase
 *     (granular SERVICES_SUPABASE_READ OR the SERVICES_SUPABASE_AUTHORITATIVE
 *     cut-over),
 *   • write resolution — whether service writes should be mirrored to Supabase
 *     (granular SERVICES_DUAL_WRITE OR the authoritative cut-over),
 *   • fallback + failure handling — every Supabase read that fails OR returns an
 *     UNSAFE empty result is RECORDED and surfaced, never silently swallowed.
 *
 * It holds NO React state and performs NO I/O — the {@link useServiceDirectorySource}
 * hook calls into it; it only resolves policy and records counters.
 *
 * Rollback is `flag OFF` → the directory seeds from localStorage with no Supabase
 * dependency on the path.
 */
import {
  SERVICES_SUPABASE_READ,
  SERVICES_DUAL_WRITE,
  SERVICES_SUPABASE_AUTHORITATIVE,
} from "@/lib/featureFlags";

/** Which store currently backs the service directory the UI renders. */
export type ServiceReadSource = "supabase" | "localStorage";

/** Why a recorded read event served the localStorage seed instead of Supabase. */
export type ServiceReadFailureKind = "read" | "unsafe.empty" | "drift";

/** A single recorded fallback/failure/drift event during Supabase-read mode. */
export interface ServiceReadFailure {
  kind: ServiceReadFailureKind;
  /** App-facing company scope (or "*") the read was attempted for. */
  ref: string;
  message: string;
  at: string;
}

/** Live, cumulative read-path telemetry (development instrumentation only). */
export interface ServiceCutoverState {
  /** Whether the directory is read from Supabase (read flag or authoritative). */
  supabaseRead: boolean;
  /** Whether service writes are mirrored to Supabase (dual-write or authoritative). */
  supabaseWrite: boolean;
  /** Resolved read source right now (recomputed from the live flags). */
  readSource: ServiceReadSource;
  supabaseReads: number;
  localReads: number;
  fallbacks: number;
  failures: number;
  shadowDrift: number;
  unsafeEmptyReads: number;
  lastMismatch: string | null;
  lastEventAt: string | null;
  recentFailures: ServiceReadFailure[];
}

const MAX_RECENT_FAILURES = 50;

function readEnabled(): boolean {
  return SERVICES_SUPABASE_READ || SERVICES_SUPABASE_AUTHORITATIVE;
}

const state: ServiceCutoverState = {
  supabaseRead: readEnabled(),
  supabaseWrite: SERVICES_DUAL_WRITE || SERVICES_SUPABASE_AUTHORITATIVE,
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
 * Whether the service directory should READ from Supabase — true when the
 * granular read flag is on OR the authoritative cut-over is active (the latter
 * implies the read path).
 */
export function shouldReadServicesFromSupabase(): boolean {
  return readEnabled();
}

/**
 * Whether service writes should be MIRRORED to Supabase — true when the granular
 * dual-write flag is on OR the authoritative cut-over is active.
 */
export function shouldMirrorServiceWrites(): boolean {
  return SERVICES_DUAL_WRITE || SERVICES_SUPABASE_AUTHORITATIVE;
}

/** Returns an immutable snapshot of the cumulative read-path telemetry. */
export function getServiceCutoverState(): ServiceCutoverState {
  return {
    ...state,
    supabaseRead: readEnabled(),
    supabaseWrite: SERVICES_DUAL_WRITE || SERVICES_SUPABASE_AUTHORITATIVE,
    readSource: readEnabled() ? "supabase" : "localStorage",
    recentFailures: [...state.recentFailures],
  };
}

/** Clears the read-path telemetry (used by tests + the dev console). */
export function resetServiceCutoverState(): void {
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

function pushFailure(kind: ServiceReadFailureKind, ref: string, message: string): void {
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
export function recordServiceSupabaseRead(): void {
  state.supabaseReads += 1;
}

/**
 * Records a Supabase read that failed and forced a fallback to the localStorage
 * seed. Surfaced, never silent. Also counts as a local serve.
 */
export function recordServiceReadFallback(ref: string, message: string): void {
  state.fallbacks += 1;
  state.localReads += 1;
  pushFailure("read", ref, message);
  if (import.meta.env.DEV === true) {
    // eslint-disable-next-line no-console
    console.warn(`[SVC-2] Service directory fallback for ${ref}: ${message}`);
  }
}

/**
 * Records an UNSAFE empty Supabase result — empty while localStorage has data.
 * Per Framework v0.2 §8, empty ≠ a successful read in this case: the local seed
 * is retained (the directory is never blanked) and the event is surfaced.
 */
export function recordServiceUnsafeEmpty(ref: string): void {
  state.unsafeEmptyReads += 1;
  state.fallbacks += 1;
  state.localReads += 1;
  pushFailure(
    "unsafe.empty",
    ref,
    "Supabase returned 0 services while localStorage has data — kept local seed.",
  );
  if (import.meta.env.DEV === true) {
    // eslint-disable-next-line no-console
    console.warn(`[SVC-2] Service directory unsafe empty for ${ref} — kept local seed.`);
  }
}

/**
 * Records background shadow-comparison drift between the localStorage directory
 * and the Supabase copy. Drift only flags observability; it never blocks the UI.
 */
export function recordServiceShadowDrift(summary: string): void {
  state.shadowDrift += 1;
  state.lastMismatch = summary;
  pushFailure("drift", "shadow", summary);
  if (import.meta.env.DEV === true) {
    // eslint-disable-next-line no-console
    console.warn(`[SVC-2] Service directory shadow drift: ${summary}`);
  }
}

// Expose console handles in development for manual inspection.
if (import.meta.env.DEV === true && typeof window !== "undefined") {
  const w = window as unknown as { __cleanopsData?: Record<string, unknown> };
  w.__cleanopsData = {
    ...(w.__cleanopsData ?? {}),
    getServiceCutoverState,
    resetServiceCutoverState,
    shouldReadServicesFromSupabase,
    shouldMirrorServiceWrites,
  };
}
