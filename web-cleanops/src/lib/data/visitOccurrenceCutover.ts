/**
 * Visit Occurrence read-path source runtime (MISSION-1).
 *
 * The decision + telemetry layer for the Missions cut-over — the Missions
 * analogue of {@link import("./areaCutover")}. Resolves whether the occurrence
 * directory reads from Supabase and whether occurrence writes are mirrored, and
 * records every fallback / unsafe-empty / drift event. Rollback is `flag OFF`.
 */
import {
  VISIT_OCCURRENCES_SUPABASE_READ,
  VISIT_OCCURRENCES_DUAL_WRITE,
  VISIT_OCCURRENCES_SUPABASE_AUTHORITATIVE,
} from "@/lib/featureFlags";

export type VisitOccurrenceReadSource = "supabase" | "localStorage";
export type VisitOccurrenceReadFailureKind = "read" | "unsafe.empty" | "drift";

export interface VisitOccurrenceReadFailure {
  kind: VisitOccurrenceReadFailureKind;
  ref: string;
  message: string;
  at: string;
}

export interface VisitOccurrenceCutoverState {
  supabaseRead: boolean;
  supabaseWrite: boolean;
  readSource: VisitOccurrenceReadSource;
  supabaseReads: number;
  localReads: number;
  fallbacks: number;
  failures: number;
  shadowDrift: number;
  unsafeEmptyReads: number;
  lastMismatch: string | null;
  lastEventAt: string | null;
  recentFailures: VisitOccurrenceReadFailure[];
}

const MAX_RECENT_FAILURES = 50;

function readEnabled(): boolean {
  return VISIT_OCCURRENCES_SUPABASE_READ || VISIT_OCCURRENCES_SUPABASE_AUTHORITATIVE;
}

const state: VisitOccurrenceCutoverState = {
  supabaseRead: readEnabled(),
  supabaseWrite: VISIT_OCCURRENCES_DUAL_WRITE || VISIT_OCCURRENCES_SUPABASE_AUTHORITATIVE,
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

export function shouldReadVisitOccurrencesFromSupabase(): boolean {
  return readEnabled();
}

export function shouldMirrorVisitOccurrenceWrites(): boolean {
  return VISIT_OCCURRENCES_DUAL_WRITE || VISIT_OCCURRENCES_SUPABASE_AUTHORITATIVE;
}

export function getVisitOccurrenceCutoverState(): VisitOccurrenceCutoverState {
  return {
    ...state,
    supabaseRead: readEnabled(),
    supabaseWrite:
      VISIT_OCCURRENCES_DUAL_WRITE || VISIT_OCCURRENCES_SUPABASE_AUTHORITATIVE,
    readSource: readEnabled() ? "supabase" : "localStorage",
    recentFailures: [...state.recentFailures],
  };
}

export function resetVisitOccurrenceCutoverState(): void {
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

function pushFailure(
  kind: VisitOccurrenceReadFailureKind,
  ref: string,
  message: string,
): void {
  const at = new Date().toISOString();
  state.failures += 1;
  state.lastEventAt = at;
  state.recentFailures.unshift({ kind, ref, message, at });
  if (state.recentFailures.length > MAX_RECENT_FAILURES) {
    state.recentFailures.length = MAX_RECENT_FAILURES;
  }
}

export function recordVisitOccurrenceSupabaseRead(): void {
  state.supabaseReads += 1;
}

export function recordVisitOccurrenceReadFallback(ref: string, message: string): void {
  state.fallbacks += 1;
  state.localReads += 1;
  pushFailure("read", ref, message);
  if (import.meta.env.DEV === true) {
    // eslint-disable-next-line no-console
    console.warn(`[MISSION] Visit occurrence fallback for ${ref}: ${message}`);
  }
}

export function recordVisitOccurrenceUnsafeEmpty(ref: string): void {
  state.unsafeEmptyReads += 1;
  state.fallbacks += 1;
  state.localReads += 1;
  pushFailure(
    "unsafe.empty",
    ref,
    "Supabase returned 0 occurrences while localStorage has data — kept local seed.",
  );
  if (import.meta.env.DEV === true) {
    // eslint-disable-next-line no-console
    console.warn(`[MISSION] Visit occurrence unsafe empty for ${ref} — kept local seed.`);
  }
}

export function recordVisitOccurrenceShadowDrift(summary: string): void {
  state.shadowDrift += 1;
  state.lastMismatch = summary;
  pushFailure("drift", "shadow", summary);
  if (import.meta.env.DEV === true) {
    // eslint-disable-next-line no-console
    console.warn(`[MISSION] Visit occurrence shadow drift: ${summary}`);
  }
}

if (import.meta.env.DEV === true && typeof window !== "undefined") {
  const w = window as unknown as { __cleanopsData?: Record<string, unknown> };
  w.__cleanopsData = {
    ...(w.__cleanopsData ?? {}),
    getVisitOccurrenceCutoverState,
    resetVisitOccurrenceCutoverState,
    shouldReadVisitOccurrencesFromSupabase,
    shouldMirrorVisitOccurrenceWrites,
  };
}
