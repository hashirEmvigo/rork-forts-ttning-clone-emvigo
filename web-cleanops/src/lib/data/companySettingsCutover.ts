/**
 * Company Settings read-path source runtime (SET-1).
 *
 * The company-settings analogue of {@link import("./areaCutover")}. Resolves
 * whether the company-settings directory reads from Supabase and whether writes
 * mirror, and records every fallback / unsafe-empty / drift event. Rollback is
 * `flag OFF`.
 */
import {
  COMPANY_SETTINGS_SUPABASE_READ,
  COMPANY_SETTINGS_DUAL_WRITE,
  COMPANY_SETTINGS_SUPABASE_AUTHORITATIVE,
} from "@/lib/featureFlags";

export type CompanySettingsReadSource = "supabase" | "localStorage";
export type CompanySettingsReadFailureKind = "read" | "unsafe.empty" | "drift";

export interface CompanySettingsReadFailure {
  kind: CompanySettingsReadFailureKind;
  ref: string;
  message: string;
  at: string;
}

export interface CompanySettingsCutoverState {
  supabaseRead: boolean;
  supabaseWrite: boolean;
  readSource: CompanySettingsReadSource;
  supabaseReads: number;
  localReads: number;
  fallbacks: number;
  failures: number;
  shadowDrift: number;
  unsafeEmptyReads: number;
  lastMismatch: string | null;
  lastEventAt: string | null;
  recentFailures: CompanySettingsReadFailure[];
}

const MAX_RECENT_FAILURES = 50;

function readEnabled(): boolean {
  return COMPANY_SETTINGS_SUPABASE_READ || COMPANY_SETTINGS_SUPABASE_AUTHORITATIVE;
}

const state: CompanySettingsCutoverState = {
  supabaseRead: readEnabled(),
  supabaseWrite: COMPANY_SETTINGS_DUAL_WRITE || COMPANY_SETTINGS_SUPABASE_AUTHORITATIVE,
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

export function shouldReadCompanySettingsFromSupabase(): boolean {
  return readEnabled();
}

export function shouldMirrorCompanySettingsWrites(): boolean {
  return COMPANY_SETTINGS_DUAL_WRITE || COMPANY_SETTINGS_SUPABASE_AUTHORITATIVE;
}

export function getCompanySettingsCutoverState(): CompanySettingsCutoverState {
  return {
    ...state,
    supabaseRead: readEnabled(),
    supabaseWrite: COMPANY_SETTINGS_DUAL_WRITE || COMPANY_SETTINGS_SUPABASE_AUTHORITATIVE,
    readSource: readEnabled() ? "supabase" : "localStorage",
    recentFailures: [...state.recentFailures],
  };
}

export function resetCompanySettingsCutoverState(): void {
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
  kind: CompanySettingsReadFailureKind,
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

export function recordCompanySettingsSupabaseRead(): void {
  state.supabaseReads += 1;
}

export function recordCompanySettingsReadFallback(ref: string, message: string): void {
  state.fallbacks += 1;
  state.localReads += 1;
  pushFailure("read", ref, message);
  if (import.meta.env.DEV === true) {
    // eslint-disable-next-line no-console
    console.warn(`[SET] Company settings fallback for ${ref}: ${message}`);
  }
}

export function recordCompanySettingsUnsafeEmpty(ref: string): void {
  state.unsafeEmptyReads += 1;
  state.fallbacks += 1;
  state.localReads += 1;
  pushFailure(
    "unsafe.empty",
    ref,
    "Supabase returned 0 company-settings records while localStorage has data — kept local seed.",
  );
  if (import.meta.env.DEV === true) {
    // eslint-disable-next-line no-console
    console.warn(`[SET] Company settings unsafe empty for ${ref} — kept local seed.`);
  }
}

export function recordCompanySettingsShadowDrift(summary: string): void {
  state.shadowDrift += 1;
  state.lastMismatch = summary;
  pushFailure("drift", "shadow", summary);
  if (import.meta.env.DEV === true) {
    // eslint-disable-next-line no-console
    console.warn(`[SET] Company settings shadow drift: ${summary}`);
  }
}

if (import.meta.env.DEV === true && typeof window !== "undefined") {
  const w = window as unknown as { __cleanopsData?: Record<string, unknown> };
  w.__cleanopsData = {
    ...(w.__cleanopsData ?? {}),
    getCompanySettingsCutoverState,
    resetCompanySettingsCutoverState,
    shouldReadCompanySettingsFromSupabase,
    shouldMirrorCompanySettingsWrites,
  };
}
