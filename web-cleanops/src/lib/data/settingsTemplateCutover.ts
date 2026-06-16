/**
 * Settings Template read-path source runtime (SET-1).
 *
 * The settings-templates analogue of {@link import("./servicePackageCutover")}.
 * Templates are global master data (no company scope), so a "ref" here is always
 * the shared catalog ("*"). Resolves whether the template directory reads from
 * Supabase and whether writes mirror, and records fallback / unsafe-empty /
 * drift events. Rollback is `flag OFF`.
 */
import {
  SETTINGS_TEMPLATES_SUPABASE_READ,
  SETTINGS_TEMPLATES_DUAL_WRITE,
  SETTINGS_TEMPLATES_SUPABASE_AUTHORITATIVE,
} from "@/lib/featureFlags";

export type SettingsTemplateReadSource = "supabase" | "localStorage";
export type SettingsTemplateReadFailureKind = "read" | "unsafe.empty" | "drift";

export interface SettingsTemplateReadFailure {
  kind: SettingsTemplateReadFailureKind;
  ref: string;
  message: string;
  at: string;
}

export interface SettingsTemplateCutoverState {
  supabaseRead: boolean;
  supabaseWrite: boolean;
  readSource: SettingsTemplateReadSource;
  supabaseReads: number;
  localReads: number;
  fallbacks: number;
  failures: number;
  shadowDrift: number;
  unsafeEmptyReads: number;
  lastMismatch: string | null;
  lastEventAt: string | null;
  recentFailures: SettingsTemplateReadFailure[];
}

const MAX_RECENT_FAILURES = 50;

function readEnabled(): boolean {
  return SETTINGS_TEMPLATES_SUPABASE_READ || SETTINGS_TEMPLATES_SUPABASE_AUTHORITATIVE;
}

const state: SettingsTemplateCutoverState = {
  supabaseRead: readEnabled(),
  supabaseWrite: SETTINGS_TEMPLATES_DUAL_WRITE || SETTINGS_TEMPLATES_SUPABASE_AUTHORITATIVE,
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

export function shouldReadSettingsTemplatesFromSupabase(): boolean {
  return readEnabled();
}

export function shouldMirrorSettingsTemplateWrites(): boolean {
  return SETTINGS_TEMPLATES_DUAL_WRITE || SETTINGS_TEMPLATES_SUPABASE_AUTHORITATIVE;
}

export function getSettingsTemplateCutoverState(): SettingsTemplateCutoverState {
  return {
    ...state,
    supabaseRead: readEnabled(),
    supabaseWrite: SETTINGS_TEMPLATES_DUAL_WRITE || SETTINGS_TEMPLATES_SUPABASE_AUTHORITATIVE,
    readSource: readEnabled() ? "supabase" : "localStorage",
    recentFailures: [...state.recentFailures],
  };
}

export function resetSettingsTemplateCutoverState(): void {
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
  kind: SettingsTemplateReadFailureKind,
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

export function recordSettingsTemplateSupabaseRead(): void {
  state.supabaseReads += 1;
}

export function recordSettingsTemplateReadFallback(ref: string, message: string): void {
  state.fallbacks += 1;
  state.localReads += 1;
  pushFailure("read", ref, message);
  if (import.meta.env.DEV === true) {
    // eslint-disable-next-line no-console
    console.warn(`[SET] Settings template directory fallback for ${ref}: ${message}`);
  }
}

export function recordSettingsTemplateUnsafeEmpty(ref: string): void {
  state.unsafeEmptyReads += 1;
  state.fallbacks += 1;
  state.localReads += 1;
  pushFailure(
    "unsafe.empty",
    ref,
    "Supabase returned 0 settings templates while localStorage has data — kept local seed.",
  );
  if (import.meta.env.DEV === true) {
    // eslint-disable-next-line no-console
    console.warn(`[SET] Settings template directory unsafe empty for ${ref} — kept local seed.`);
  }
}

export function recordSettingsTemplateShadowDrift(summary: string): void {
  state.shadowDrift += 1;
  state.lastMismatch = summary;
  pushFailure("drift", "shadow", summary);
  if (import.meta.env.DEV === true) {
    // eslint-disable-next-line no-console
    console.warn(`[SET] Settings template directory shadow drift: ${summary}`);
  }
}

if (import.meta.env.DEV === true && typeof window !== "undefined") {
  const w = window as unknown as { __cleanopsData?: Record<string, unknown> };
  w.__cleanopsData = {
    ...(w.__cleanopsData ?? {}),
    getSettingsTemplateCutoverState,
    resetSettingsTemplateCutoverState,
    shouldReadSettingsTemplatesFromSupabase,
    shouldMirrorSettingsTemplateWrites,
  };
}
