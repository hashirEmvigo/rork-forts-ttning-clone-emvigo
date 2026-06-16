/**
 * Employee Language read-path source runtime (AREA-1).
 *
 * The Employee Languages analogue of {@link import("./areaCutover")}. Resolves
 * whether the language directory reads from Supabase and whether writes are
 * mirrored, and records every fallback / unsafe-empty / drift event. Rollback is
 * `flag OFF`.
 */
import {
  EMPLOYEE_LANGUAGES_SUPABASE_READ,
  EMPLOYEE_LANGUAGES_DUAL_WRITE,
  EMPLOYEE_LANGUAGES_SUPABASE_AUTHORITATIVE,
} from "@/lib/featureFlags";

export type EmployeeLanguageReadSource = "supabase" | "localStorage";
export type EmployeeLanguageReadFailureKind = "read" | "unsafe.empty" | "drift";

export interface EmployeeLanguageReadFailure {
  kind: EmployeeLanguageReadFailureKind;
  ref: string;
  message: string;
  at: string;
}

export interface EmployeeLanguageCutoverState {
  supabaseRead: boolean;
  supabaseWrite: boolean;
  readSource: EmployeeLanguageReadSource;
  supabaseReads: number;
  localReads: number;
  fallbacks: number;
  failures: number;
  shadowDrift: number;
  unsafeEmptyReads: number;
  lastMismatch: string | null;
  lastEventAt: string | null;
  recentFailures: EmployeeLanguageReadFailure[];
}

const MAX_RECENT_FAILURES = 50;

function readEnabled(): boolean {
  return EMPLOYEE_LANGUAGES_SUPABASE_READ || EMPLOYEE_LANGUAGES_SUPABASE_AUTHORITATIVE;
}

const state: EmployeeLanguageCutoverState = {
  supabaseRead: readEnabled(),
  supabaseWrite: EMPLOYEE_LANGUAGES_DUAL_WRITE || EMPLOYEE_LANGUAGES_SUPABASE_AUTHORITATIVE,
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

export function shouldReadEmployeeLanguagesFromSupabase(): boolean {
  return readEnabled();
}

export function shouldMirrorEmployeeLanguageWrites(): boolean {
  return EMPLOYEE_LANGUAGES_DUAL_WRITE || EMPLOYEE_LANGUAGES_SUPABASE_AUTHORITATIVE;
}

export function getEmployeeLanguageCutoverState(): EmployeeLanguageCutoverState {
  return {
    ...state,
    supabaseRead: readEnabled(),
    supabaseWrite: EMPLOYEE_LANGUAGES_DUAL_WRITE || EMPLOYEE_LANGUAGES_SUPABASE_AUTHORITATIVE,
    readSource: readEnabled() ? "supabase" : "localStorage",
    recentFailures: [...state.recentFailures],
  };
}

export function resetEmployeeLanguageCutoverState(): void {
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
  kind: EmployeeLanguageReadFailureKind,
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

export function recordEmployeeLanguageSupabaseRead(): void {
  state.supabaseReads += 1;
}

export function recordEmployeeLanguageReadFallback(ref: string, message: string): void {
  state.fallbacks += 1;
  state.localReads += 1;
  pushFailure("read", ref, message);
  if (import.meta.env.DEV === true) {
    // eslint-disable-next-line no-console
    console.warn(`[AREA] Language directory fallback for ${ref}: ${message}`);
  }
}

export function recordEmployeeLanguageUnsafeEmpty(ref: string): void {
  state.unsafeEmptyReads += 1;
  state.fallbacks += 1;
  state.localReads += 1;
  pushFailure(
    "unsafe.empty",
    ref,
    "Supabase returned 0 languages while localStorage has data — kept local seed.",
  );
  if (import.meta.env.DEV === true) {
    // eslint-disable-next-line no-console
    console.warn(`[AREA] Language directory unsafe empty for ${ref} — kept local seed.`);
  }
}

export function recordEmployeeLanguageShadowDrift(summary: string): void {
  state.shadowDrift += 1;
  state.lastMismatch = summary;
  pushFailure("drift", "shadow", summary);
  if (import.meta.env.DEV === true) {
    // eslint-disable-next-line no-console
    console.warn(`[AREA] Language directory shadow drift: ${summary}`);
  }
}

if (import.meta.env.DEV === true && typeof window !== "undefined") {
  const w = window as unknown as { __cleanopsData?: Record<string, unknown> };
  w.__cleanopsData = {
    ...(w.__cleanopsData ?? {}),
    getEmployeeLanguageCutoverState,
    resetEmployeeLanguageCutoverState,
    shouldReadEmployeeLanguagesFromSupabase,
    shouldMirrorEmployeeLanguageWrites,
  };
}
