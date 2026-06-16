/**
 * Checklist Template read-path source runtime (CHK-1).
 *
 * Resolves whether the checklist-template directory reads from Supabase and
 * whether writes mirror, and records fallback / unsafe-empty / drift events.
 * Rollback is `flag OFF`.
 */
import {
  CHECKLIST_TEMPLATES_SUPABASE_READ,
  CHECKLIST_TEMPLATES_DUAL_WRITE,
  CHECKLIST_TEMPLATES_SUPABASE_AUTHORITATIVE,
} from "@/lib/featureFlags";

export type ChecklistTemplateReadSource = "supabase" | "localStorage";
export type ChecklistTemplateReadFailureKind = "read" | "unsafe.empty" | "drift";

export interface ChecklistTemplateReadFailure {
  kind: ChecklistTemplateReadFailureKind;
  ref: string;
  message: string;
  at: string;
}

export interface ChecklistTemplateCutoverState {
  supabaseRead: boolean;
  supabaseWrite: boolean;
  readSource: ChecklistTemplateReadSource;
  supabaseReads: number;
  localReads: number;
  fallbacks: number;
  failures: number;
  shadowDrift: number;
  unsafeEmptyReads: number;
  lastMismatch: string | null;
  lastEventAt: string | null;
  recentFailures: ChecklistTemplateReadFailure[];
}

const MAX_RECENT_FAILURES = 50;

function readEnabled(): boolean {
  return CHECKLIST_TEMPLATES_SUPABASE_READ || CHECKLIST_TEMPLATES_SUPABASE_AUTHORITATIVE;
}

const state: ChecklistTemplateCutoverState = {
  supabaseRead: readEnabled(),
  supabaseWrite: CHECKLIST_TEMPLATES_DUAL_WRITE || CHECKLIST_TEMPLATES_SUPABASE_AUTHORITATIVE,
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

export function shouldReadChecklistTemplatesFromSupabase(): boolean {
  return readEnabled();
}

export function shouldMirrorChecklistTemplateWrites(): boolean {
  return CHECKLIST_TEMPLATES_DUAL_WRITE || CHECKLIST_TEMPLATES_SUPABASE_AUTHORITATIVE;
}

export function isChecklistTemplatesSupabaseAuthoritative(): boolean {
  return CHECKLIST_TEMPLATES_SUPABASE_AUTHORITATIVE;
}

export function getChecklistTemplateCutoverState(): ChecklistTemplateCutoverState {
  return {
    ...state,
    supabaseRead: readEnabled(),
    supabaseWrite: CHECKLIST_TEMPLATES_DUAL_WRITE || CHECKLIST_TEMPLATES_SUPABASE_AUTHORITATIVE,
    readSource: readEnabled() ? "supabase" : "localStorage",
    recentFailures: [...state.recentFailures],
  };
}

export function resetChecklistTemplateCutoverState(): void {
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
  kind: ChecklistTemplateReadFailureKind,
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

export function recordChecklistTemplateSupabaseRead(): void {
  state.supabaseReads += 1;
}

export function recordChecklistTemplateReadFallback(ref: string, message: string): void {
  state.fallbacks += 1;
  state.localReads += 1;
  pushFailure("read", ref, message);
  if (import.meta.env.DEV === true) {
    // eslint-disable-next-line no-console
    console.warn(`[CHK] Checklist directory fallback for ${ref}: ${message}`);
  }
}

export function recordChecklistTemplateUnsafeEmpty(ref: string): void {
  state.unsafeEmptyReads += 1;
  state.fallbacks += 1;
  state.localReads += 1;
  pushFailure(
    "unsafe.empty",
    ref,
    "Supabase returned 0 checklist templates while localStorage has data — kept local seed.",
  );
  if (import.meta.env.DEV === true) {
    // eslint-disable-next-line no-console
    console.warn(`[CHK] Checklist directory unsafe empty for ${ref} — kept local seed.`);
  }
}

export function recordChecklistTemplateShadowDrift(summary: string): void {
  state.shadowDrift += 1;
  state.lastMismatch = summary;
  pushFailure("drift", "shadow", summary);
  if (import.meta.env.DEV === true) {
    // eslint-disable-next-line no-console
    console.warn(`[CHK] Checklist directory shadow drift: ${summary}`);
  }
}

if (import.meta.env.DEV === true && typeof window !== "undefined") {
  const w = window as unknown as { __cleanopsData?: Record<string, unknown> };
  w.__cleanopsData = {
    ...(w.__cleanopsData ?? {}),
    getChecklistTemplateCutoverState,
    resetChecklistTemplateCutoverState,
    shouldReadChecklistTemplatesFromSupabase,
    shouldMirrorChecklistTemplateWrites,
    isChecklistTemplatesSupabaseAuthoritative,
  };
}
