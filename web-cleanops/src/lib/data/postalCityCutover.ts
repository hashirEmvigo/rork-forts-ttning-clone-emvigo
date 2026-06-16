/**
 * Postal City read-path source runtime (AREA-1).
 *
 * The Postal Cities analogue of {@link import("./areaCutover")}. Resolves whether
 * the postal-city directory reads from Supabase and whether writes are mirrored,
 * and records every fallback / unsafe-empty / drift event. Rollback is `flag OFF`.
 */
import {
  POSTAL_CITIES_SUPABASE_READ,
  POSTAL_CITIES_DUAL_WRITE,
  POSTAL_CITIES_SUPABASE_AUTHORITATIVE,
} from "@/lib/featureFlags";

export type PostalCityReadSource = "supabase" | "localStorage";
export type PostalCityReadFailureKind = "read" | "unsafe.empty" | "drift";

export interface PostalCityReadFailure {
  kind: PostalCityReadFailureKind;
  ref: string;
  message: string;
  at: string;
}

export interface PostalCityCutoverState {
  supabaseRead: boolean;
  supabaseWrite: boolean;
  readSource: PostalCityReadSource;
  supabaseReads: number;
  localReads: number;
  fallbacks: number;
  failures: number;
  shadowDrift: number;
  unsafeEmptyReads: number;
  lastMismatch: string | null;
  lastEventAt: string | null;
  recentFailures: PostalCityReadFailure[];
}

const MAX_RECENT_FAILURES = 50;

function readEnabled(): boolean {
  return POSTAL_CITIES_SUPABASE_READ || POSTAL_CITIES_SUPABASE_AUTHORITATIVE;
}

const state: PostalCityCutoverState = {
  supabaseRead: readEnabled(),
  supabaseWrite: POSTAL_CITIES_DUAL_WRITE || POSTAL_CITIES_SUPABASE_AUTHORITATIVE,
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

export function shouldReadPostalCitiesFromSupabase(): boolean {
  return readEnabled();
}

export function shouldMirrorPostalCityWrites(): boolean {
  return POSTAL_CITIES_DUAL_WRITE || POSTAL_CITIES_SUPABASE_AUTHORITATIVE;
}

export function getPostalCityCutoverState(): PostalCityCutoverState {
  return {
    ...state,
    supabaseRead: readEnabled(),
    supabaseWrite: POSTAL_CITIES_DUAL_WRITE || POSTAL_CITIES_SUPABASE_AUTHORITATIVE,
    readSource: readEnabled() ? "supabase" : "localStorage",
    recentFailures: [...state.recentFailures],
  };
}

export function resetPostalCityCutoverState(): void {
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

function pushFailure(kind: PostalCityReadFailureKind, ref: string, message: string): void {
  const at = new Date().toISOString();
  state.failures += 1;
  state.lastEventAt = at;
  state.recentFailures.unshift({ kind, ref, message, at });
  if (state.recentFailures.length > MAX_RECENT_FAILURES) {
    state.recentFailures.length = MAX_RECENT_FAILURES;
  }
}

export function recordPostalCitySupabaseRead(): void {
  state.supabaseReads += 1;
}

export function recordPostalCityReadFallback(ref: string, message: string): void {
  state.fallbacks += 1;
  state.localReads += 1;
  pushFailure("read", ref, message);
  if (import.meta.env.DEV === true) {
    // eslint-disable-next-line no-console
    console.warn(`[AREA] Postal city directory fallback for ${ref}: ${message}`);
  }
}

export function recordPostalCityUnsafeEmpty(ref: string): void {
  state.unsafeEmptyReads += 1;
  state.fallbacks += 1;
  state.localReads += 1;
  pushFailure(
    "unsafe.empty",
    ref,
    "Supabase returned 0 postal cities while localStorage has data — kept local seed.",
  );
  if (import.meta.env.DEV === true) {
    // eslint-disable-next-line no-console
    console.warn(`[AREA] Postal city directory unsafe empty for ${ref} — kept local seed.`);
  }
}

export function recordPostalCityShadowDrift(summary: string): void {
  state.shadowDrift += 1;
  state.lastMismatch = summary;
  pushFailure("drift", "shadow", summary);
  if (import.meta.env.DEV === true) {
    // eslint-disable-next-line no-console
    console.warn(`[AREA] Postal city directory shadow drift: ${summary}`);
  }
}

if (import.meta.env.DEV === true && typeof window !== "undefined") {
  const w = window as unknown as { __cleanopsData?: Record<string, unknown> };
  w.__cleanopsData = {
    ...(w.__cleanopsData ?? {}),
    getPostalCityCutoverState,
    resetPostalCityCutoverState,
    shouldReadPostalCitiesFromSupabase,
    shouldMirrorPostalCityWrites,
  };
}
