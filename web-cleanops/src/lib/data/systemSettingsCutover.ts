/**
 * System Settings read-path source runtime (SYSSET-1).
 *
 * The decision + telemetry layer for the System Settings cut-over — the System
 * Settings analogue of {@link import("./settingsTemplateCutover")}. System
 * settings are a SINGLETON global record (no company scope), so a "ref" here is
 * always the single record ("global"). Resolves whether the record reads from
 * Supabase and whether writes mirror, and records every fallback / unsafe-empty
 * / drift event. Rollback is `flag OFF`.
 */
import {
  SYSTEM_SETTINGS_SUPABASE_READ,
  SYSTEM_SETTINGS_DUAL_WRITE,
  SYSTEM_SETTINGS_SUPABASE_AUTHORITATIVE,
} from "@/lib/featureFlags";

export type SystemSettingsReadSource = "supabase" | "localStorage";
export type SystemSettingsReadFailureKind = "read" | "unsafe.empty" | "drift";

export interface SystemSettingsReadFailure {
  kind: SystemSettingsReadFailureKind;
  ref: string;
  message: string;
  at: string;
}

export interface SystemSettingsCutoverState {
  supabaseRead: boolean;
  supabaseWrite: boolean;
  readSource: SystemSettingsReadSource;
  supabaseReads: number;
  localReads: number;
  fallbacks: number;
  failures: number;
  shadowDrift: number;
  unsafeEmptyReads: number;
  lastMismatch: string | null;
  lastEventAt: string | null;
  recentFailures: SystemSettingsReadFailure[];
}

const MAX_RECENT_FAILURES = 50;

function readEnabled(): boolean {
  return SYSTEM_SETTINGS_SUPABASE_READ || SYSTEM_SETTINGS_SUPABASE_AUTHORITATIVE;
}

const state: SystemSettingsCutoverState = {
  supabaseRead: readEnabled(),
  supabaseWrite: SYSTEM_SETTINGS_DUAL_WRITE || SYSTEM_SETTINGS_SUPABASE_AUTHORITATIVE,
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

export function shouldReadSystemSettingsFromSupabase(): boolean {
  return readEnabled();
}

export function shouldMirrorSystemSettingsWrites(): boolean {
  return SYSTEM_SETTINGS_DUAL_WRITE || SYSTEM_SETTINGS_SUPABASE_AUTHORITATIVE;
}

export function isSystemSettingsSupabaseAuthoritative(): boolean {
  return SYSTEM_SETTINGS_SUPABASE_AUTHORITATIVE;
}

export function getSystemSettingsCutoverState(): SystemSettingsCutoverState {
  return {
    ...state,
    supabaseRead: readEnabled(),
    supabaseWrite: SYSTEM_SETTINGS_DUAL_WRITE || SYSTEM_SETTINGS_SUPABASE_AUTHORITATIVE,
    readSource: readEnabled() ? "supabase" : "localStorage",
    recentFailures: [...state.recentFailures],
  };
}

export function resetSystemSettingsCutoverState(): void {
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
  kind: SystemSettingsReadFailureKind,
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

export function recordSystemSettingsSupabaseRead(): void {
  state.supabaseReads += 1;
}

export function recordSystemSettingsReadFallback(ref: string, message: string): void {
  state.fallbacks += 1;
  state.localReads += 1;
  pushFailure("read", ref, message);
  if (import.meta.env.DEV === true) {
    // eslint-disable-next-line no-console
    console.warn(`[SYSSET] System settings fallback for ${ref}: ${message}`);
  }
}

export function recordSystemSettingsUnsafeEmpty(ref: string): void {
  state.unsafeEmptyReads += 1;
  state.fallbacks += 1;
  state.localReads += 1;
  pushFailure(
    "unsafe.empty",
    ref,
    "Supabase has no system-settings record while localStorage has one — kept local seed.",
  );
  if (import.meta.env.DEV === true) {
    // eslint-disable-next-line no-console
    console.warn(`[SYSSET] System settings unsafe empty for ${ref} — kept local seed.`);
  }
}

export function recordSystemSettingsShadowDrift(summary: string): void {
  state.shadowDrift += 1;
  state.lastMismatch = summary;
  pushFailure("drift", "shadow", summary);
  if (import.meta.env.DEV === true) {
    // eslint-disable-next-line no-console
    console.warn(`[SYSSET] System settings shadow drift: ${summary}`);
  }
}

if (import.meta.env.DEV === true && typeof window !== "undefined") {
  const w = window as unknown as { __cleanopsData?: Record<string, unknown> };
  w.__cleanopsData = {
    ...(w.__cleanopsData ?? {}),
    getSystemSettingsCutoverState,
    resetSystemSettingsCutoverState,
    shouldReadSystemSettingsFromSupabase,
    shouldMirrorSystemSettingsWrites,
    isSystemSettingsSupabaseAuthoritative,
  };
}
