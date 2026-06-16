/**
 * Service Category read-path source runtime (SVCCAT-1).
 *
 * The decision + telemetry layer for the Service Categories cut-over — the
 * service-categories analogue of {@link import("./serviceCutover")}. Resolves
 * whether the category directory reads from Supabase and whether category writes
 * are mirrored, and records every fallback / unsafe-empty / drift event.
 */
import {
  SERVICE_CATEGORIES_SUPABASE_READ,
  SERVICE_CATEGORIES_DUAL_WRITE,
  SERVICE_CATEGORIES_SUPABASE_AUTHORITATIVE,
} from "@/lib/featureFlags";

export type ServiceCategoryReadSource = "supabase" | "localStorage";
export type ServiceCategoryReadFailureKind = "read" | "unsafe.empty" | "drift";

export interface ServiceCategoryReadFailure {
  kind: ServiceCategoryReadFailureKind;
  ref: string;
  message: string;
  at: string;
}

export interface ServiceCategoryCutoverState {
  supabaseRead: boolean;
  supabaseWrite: boolean;
  readSource: ServiceCategoryReadSource;
  supabaseReads: number;
  localReads: number;
  fallbacks: number;
  failures: number;
  shadowDrift: number;
  unsafeEmptyReads: number;
  lastMismatch: string | null;
  lastEventAt: string | null;
  recentFailures: ServiceCategoryReadFailure[];
}

const MAX_RECENT_FAILURES = 50;

function readEnabled(): boolean {
  return SERVICE_CATEGORIES_SUPABASE_READ || SERVICE_CATEGORIES_SUPABASE_AUTHORITATIVE;
}

const state: ServiceCategoryCutoverState = {
  supabaseRead: readEnabled(),
  supabaseWrite: SERVICE_CATEGORIES_DUAL_WRITE || SERVICE_CATEGORIES_SUPABASE_AUTHORITATIVE,
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

export function shouldReadServiceCategoriesFromSupabase(): boolean {
  return readEnabled();
}

export function shouldMirrorServiceCategoryWrites(): boolean {
  return SERVICE_CATEGORIES_DUAL_WRITE || SERVICE_CATEGORIES_SUPABASE_AUTHORITATIVE;
}

export function getServiceCategoryCutoverState(): ServiceCategoryCutoverState {
  return {
    ...state,
    supabaseRead: readEnabled(),
    supabaseWrite: SERVICE_CATEGORIES_DUAL_WRITE || SERVICE_CATEGORIES_SUPABASE_AUTHORITATIVE,
    readSource: readEnabled() ? "supabase" : "localStorage",
    recentFailures: [...state.recentFailures],
  };
}

export function resetServiceCategoryCutoverState(): void {
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
  kind: ServiceCategoryReadFailureKind,
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

export function recordServiceCategorySupabaseRead(): void {
  state.supabaseReads += 1;
}

export function recordServiceCategoryReadFallback(ref: string, message: string): void {
  state.fallbacks += 1;
  state.localReads += 1;
  pushFailure("read", ref, message);
  if (import.meta.env.DEV === true) {
    // eslint-disable-next-line no-console
    console.warn(`[SVCCAT] Service category directory fallback for ${ref}: ${message}`);
  }
}

export function recordServiceCategoryUnsafeEmpty(ref: string): void {
  state.unsafeEmptyReads += 1;
  state.fallbacks += 1;
  state.localReads += 1;
  pushFailure(
    "unsafe.empty",
    ref,
    "Supabase returned 0 categories while localStorage has data — kept local seed.",
  );
  if (import.meta.env.DEV === true) {
    // eslint-disable-next-line no-console
    console.warn(`[SVCCAT] Service category directory unsafe empty for ${ref} — kept local seed.`);
  }
}

export function recordServiceCategoryShadowDrift(summary: string): void {
  state.shadowDrift += 1;
  state.lastMismatch = summary;
  pushFailure("drift", "shadow", summary);
  if (import.meta.env.DEV === true) {
    // eslint-disable-next-line no-console
    console.warn(`[SVCCAT] Service category directory shadow drift: ${summary}`);
  }
}

if (import.meta.env.DEV === true && typeof window !== "undefined") {
  const w = window as unknown as { __cleanopsData?: Record<string, unknown> };
  w.__cleanopsData = {
    ...(w.__cleanopsData ?? {}),
    getServiceCategoryCutoverState,
    resetServiceCategoryCutoverState,
    shouldReadServiceCategoriesFromSupabase,
    shouldMirrorServiceCategoryWrites,
  };
}
