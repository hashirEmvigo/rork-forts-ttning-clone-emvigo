/**
 * Module-domain read-path source runtime (MOD-1).
 *
 * Resolves whether the module directory reads from Supabase and whether writes
 * mirror, and records fallback / unsafe-empty / drift events for the three
 * Module-domain stores (modules / categories / company config). Rollback = OFF.
 */
import {
  MODULES_SUPABASE_READ,
  MODULES_DUAL_WRITE,
  MODULES_SUPABASE_AUTHORITATIVE,
} from "@/lib/featureFlags";

export type ModuleReadSource = "supabase" | "localStorage";
export type ModuleReadFailureKind = "read" | "unsafe.empty" | "drift";

export interface ModuleReadFailure {
  kind: ModuleReadFailureKind;
  ref: string;
  message: string;
  at: string;
}

export interface ModuleCutoverState {
  supabaseRead: boolean;
  supabaseWrite: boolean;
  readSource: ModuleReadSource;
  supabaseReads: number;
  localReads: number;
  fallbacks: number;
  failures: number;
  shadowDrift: number;
  unsafeEmptyReads: number;
  lastMismatch: string | null;
  lastEventAt: string | null;
  recentFailures: ModuleReadFailure[];
}

const MAX_RECENT_FAILURES = 50;

function readEnabled(): boolean {
  return MODULES_SUPABASE_READ || MODULES_SUPABASE_AUTHORITATIVE;
}

const state: ModuleCutoverState = {
  supabaseRead: readEnabled(),
  supabaseWrite: MODULES_DUAL_WRITE || MODULES_SUPABASE_AUTHORITATIVE,
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

export function shouldReadModulesFromSupabase(): boolean {
  return readEnabled();
}

export function shouldMirrorModuleWrites(): boolean {
  return MODULES_DUAL_WRITE || MODULES_SUPABASE_AUTHORITATIVE;
}

export function isModulesSupabaseAuthoritative(): boolean {
  return MODULES_SUPABASE_AUTHORITATIVE;
}

export function getModuleCutoverState(): ModuleCutoverState {
  return {
    ...state,
    supabaseRead: readEnabled(),
    supabaseWrite: MODULES_DUAL_WRITE || MODULES_SUPABASE_AUTHORITATIVE,
    readSource: readEnabled() ? "supabase" : "localStorage",
    recentFailures: [...state.recentFailures],
  };
}

export function resetModuleCutoverState(): void {
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

function pushFailure(kind: ModuleReadFailureKind, ref: string, message: string): void {
  const at = new Date().toISOString();
  state.failures += 1;
  state.lastEventAt = at;
  state.recentFailures.unshift({ kind, ref, message, at });
  if (state.recentFailures.length > MAX_RECENT_FAILURES) {
    state.recentFailures.length = MAX_RECENT_FAILURES;
  }
}

export function recordModuleSupabaseRead(): void {
  state.supabaseReads += 1;
}

export function recordModuleReadFallback(ref: string, message: string): void {
  state.fallbacks += 1;
  state.localReads += 1;
  pushFailure("read", ref, message);
  if (import.meta.env.DEV === true) {
    // eslint-disable-next-line no-console
    console.warn(`[MOD] Module directory fallback for ${ref}: ${message}`);
  }
}

export function recordModuleUnsafeEmpty(ref: string): void {
  state.unsafeEmptyReads += 1;
  state.fallbacks += 1;
  state.localReads += 1;
  pushFailure(
    "unsafe.empty",
    ref,
    "Supabase returned 0 modules while localStorage has data — kept local seed.",
  );
  if (import.meta.env.DEV === true) {
    // eslint-disable-next-line no-console
    console.warn(`[MOD] Module directory unsafe empty for ${ref} — kept local seed.`);
  }
}

export function recordModuleShadowDrift(summary: string): void {
  state.shadowDrift += 1;
  state.lastMismatch = summary;
  pushFailure("drift", "shadow", summary);
  if (import.meta.env.DEV === true) {
    // eslint-disable-next-line no-console
    console.warn(`[MOD] Module directory shadow drift: ${summary}`);
  }
}

if (import.meta.env.DEV === true && typeof window !== "undefined") {
  const w = window as unknown as { __cleanopsData?: Record<string, unknown> };
  w.__cleanopsData = {
    ...(w.__cleanopsData ?? {}),
    getModuleCutoverState,
    resetModuleCutoverState,
    shouldReadModulesFromSupabase,
    shouldMirrorModuleWrites,
    isModulesSupabaseAuthoritative,
  };
}
