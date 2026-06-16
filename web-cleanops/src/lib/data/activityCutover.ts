/**
 * Activity Log read-path source runtime (ACTIVITY-1).
 *
 * The decision + telemetry layer for the Activity Log cut-over — the Activity
 * Log analogue of {@link import("./areaCutover")}. Resolves whether the audit
 * trail reads from Supabase and whether audit appends are mirrored, and records
 * every fallback / unsafe-empty / drift event. Rollback is `flag OFF`.
 */
import {
  ACTIVITY_LOG_SUPABASE_READ,
  ACTIVITY_LOG_DUAL_WRITE,
  ACTIVITY_LOG_SUPABASE_AUTHORITATIVE,
} from "@/lib/featureFlags";

export type ActivityReadSource = "supabase" | "localStorage";
export type ActivityReadFailureKind = "read" | "unsafe.empty" | "drift";

export interface ActivityReadFailure {
  kind: ActivityReadFailureKind;
  ref: string;
  message: string;
  at: string;
}

export interface ActivityCutoverState {
  supabaseRead: boolean;
  supabaseWrite: boolean;
  readSource: ActivityReadSource;
  supabaseReads: number;
  localReads: number;
  fallbacks: number;
  failures: number;
  shadowDrift: number;
  unsafeEmptyReads: number;
  lastMismatch: string | null;
  lastEventAt: string | null;
  recentFailures: ActivityReadFailure[];
}

const MAX_RECENT_FAILURES = 50;

function readEnabled(): boolean {
  return ACTIVITY_LOG_SUPABASE_READ || ACTIVITY_LOG_SUPABASE_AUTHORITATIVE;
}

const state: ActivityCutoverState = {
  supabaseRead: readEnabled(),
  supabaseWrite: ACTIVITY_LOG_DUAL_WRITE || ACTIVITY_LOG_SUPABASE_AUTHORITATIVE,
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

export function shouldReadActivityFromSupabase(): boolean {
  return readEnabled();
}

export function shouldMirrorActivityWrites(): boolean {
  return ACTIVITY_LOG_DUAL_WRITE || ACTIVITY_LOG_SUPABASE_AUTHORITATIVE;
}

export function getActivityCutoverState(): ActivityCutoverState {
  return {
    ...state,
    supabaseRead: readEnabled(),
    supabaseWrite: ACTIVITY_LOG_DUAL_WRITE || ACTIVITY_LOG_SUPABASE_AUTHORITATIVE,
    readSource: readEnabled() ? "supabase" : "localStorage",
    recentFailures: [...state.recentFailures],
  };
}

export function resetActivityCutoverState(): void {
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

function pushFailure(kind: ActivityReadFailureKind, ref: string, message: string): void {
  const at = new Date().toISOString();
  state.failures += 1;
  state.lastEventAt = at;
  state.recentFailures.unshift({ kind, ref, message, at });
  if (state.recentFailures.length > MAX_RECENT_FAILURES) {
    state.recentFailures.length = MAX_RECENT_FAILURES;
  }
}

export function recordActivitySupabaseRead(): void {
  state.supabaseReads += 1;
}

export function recordActivityReadFallback(ref: string, message: string): void {
  state.fallbacks += 1;
  state.localReads += 1;
  pushFailure("read", ref, message);
  if (import.meta.env.DEV === true) {
    // eslint-disable-next-line no-console
    console.warn(`[ACTIVITY] Activity Log fallback for ${ref}: ${message}`);
  }
}

export function recordActivityUnsafeEmpty(ref: string): void {
  state.unsafeEmptyReads += 1;
  state.fallbacks += 1;
  state.localReads += 1;
  pushFailure(
    "unsafe.empty",
    ref,
    "Supabase returned 0 events while localStorage has data — kept local seed.",
  );
  if (import.meta.env.DEV === true) {
    // eslint-disable-next-line no-console
    console.warn(`[ACTIVITY] Activity Log unsafe empty for ${ref} — kept local seed.`);
  }
}

export function recordActivityShadowDrift(summary: string): void {
  state.shadowDrift += 1;
  state.lastMismatch = summary;
  pushFailure("drift", "shadow", summary);
  if (import.meta.env.DEV === true) {
    // eslint-disable-next-line no-console
    console.warn(`[ACTIVITY] Activity Log shadow drift: ${summary}`);
  }
}

if (import.meta.env.DEV === true && typeof window !== "undefined") {
  const w = window as unknown as { __cleanopsData?: Record<string, unknown> };
  w.__cleanopsData = {
    ...(w.__cleanopsData ?? {}),
    getActivityCutoverState,
    resetActivityCutoverState,
    shouldReadActivityFromSupabase,
    shouldMirrorActivityWrites,
  };
}
