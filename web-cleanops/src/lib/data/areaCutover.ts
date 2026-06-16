/**
 * Area read-path source runtime (AREA-1).
 *
 * The decision + telemetry layer for the Areas cut-over — the Areas analogue of
 * {@link import("./teamCutover")}. Resolves whether the area directory reads from
 * Supabase and whether area writes are mirrored, and records every fallback /
 * unsafe-empty / drift event. Rollback is `flag OFF`.
 */
import {
  AREAS_SUPABASE_READ,
  AREAS_DUAL_WRITE,
  AREAS_SUPABASE_AUTHORITATIVE,
} from "@/lib/featureFlags";

export type AreaReadSource = "supabase" | "localStorage";
export type AreaReadFailureKind = "read" | "unsafe.empty" | "drift";

export interface AreaReadFailure {
  kind: AreaReadFailureKind;
  ref: string;
  message: string;
  at: string;
}

export interface AreaCutoverState {
  supabaseRead: boolean;
  supabaseWrite: boolean;
  readSource: AreaReadSource;
  supabaseReads: number;
  localReads: number;
  fallbacks: number;
  failures: number;
  shadowDrift: number;
  unsafeEmptyReads: number;
  lastMismatch: string | null;
  lastEventAt: string | null;
  recentFailures: AreaReadFailure[];
}

const MAX_RECENT_FAILURES = 50;

function readEnabled(): boolean {
  return AREAS_SUPABASE_READ || AREAS_SUPABASE_AUTHORITATIVE;
}

const state: AreaCutoverState = {
  supabaseRead: readEnabled(),
  supabaseWrite: AREAS_DUAL_WRITE || AREAS_SUPABASE_AUTHORITATIVE,
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

export function shouldReadAreasFromSupabase(): boolean {
  return readEnabled();
}

export function shouldMirrorAreaWrites(): boolean {
  return AREAS_DUAL_WRITE || AREAS_SUPABASE_AUTHORITATIVE;
}

export function getAreaCutoverState(): AreaCutoverState {
  return {
    ...state,
    supabaseRead: readEnabled(),
    supabaseWrite: AREAS_DUAL_WRITE || AREAS_SUPABASE_AUTHORITATIVE,
    readSource: readEnabled() ? "supabase" : "localStorage",
    recentFailures: [...state.recentFailures],
  };
}

export function resetAreaCutoverState(): void {
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

function pushFailure(kind: AreaReadFailureKind, ref: string, message: string): void {
  const at = new Date().toISOString();
  state.failures += 1;
  state.lastEventAt = at;
  state.recentFailures.unshift({ kind, ref, message, at });
  if (state.recentFailures.length > MAX_RECENT_FAILURES) {
    state.recentFailures.length = MAX_RECENT_FAILURES;
  }
}

export function recordAreaSupabaseRead(): void {
  state.supabaseReads += 1;
}

export function recordAreaReadFallback(ref: string, message: string): void {
  state.fallbacks += 1;
  state.localReads += 1;
  pushFailure("read", ref, message);
  if (import.meta.env.DEV === true) {
    // eslint-disable-next-line no-console
    console.warn(`[AREA] Area directory fallback for ${ref}: ${message}`);
  }
}

export function recordAreaUnsafeEmpty(ref: string): void {
  state.unsafeEmptyReads += 1;
  state.fallbacks += 1;
  state.localReads += 1;
  pushFailure(
    "unsafe.empty",
    ref,
    "Supabase returned 0 areas while localStorage has data — kept local seed.",
  );
  if (import.meta.env.DEV === true) {
    // eslint-disable-next-line no-console
    console.warn(`[AREA] Area directory unsafe empty for ${ref} — kept local seed.`);
  }
}

export function recordAreaShadowDrift(summary: string): void {
  state.shadowDrift += 1;
  state.lastMismatch = summary;
  pushFailure("drift", "shadow", summary);
  if (import.meta.env.DEV === true) {
    // eslint-disable-next-line no-console
    console.warn(`[AREA] Area directory shadow drift: ${summary}`);
  }
}

if (import.meta.env.DEV === true && typeof window !== "undefined") {
  const w = window as unknown as { __cleanopsData?: Record<string, unknown> };
  w.__cleanopsData = {
    ...(w.__cleanopsData ?? {}),
    getAreaCutoverState,
    resetAreaCutoverState,
    shouldReadAreasFromSupabase,
    shouldMirrorAreaWrites,
  };
}
