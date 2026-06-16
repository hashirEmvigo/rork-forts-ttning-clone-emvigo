/**
 * Service Entitlements read-path source runtime (ENT-1).
 *
 * The decision + telemetry layer for the Entitlements cut-over — the
 * Entitlements analogue of {@link import("./areaCutover")}. Resolves whether the
 * entitlement stores read from Supabase and whether entitlement writes are
 * mirrored, and records every fallback / unsafe-empty / drift event. Rollback is
 * `flag OFF`.
 */
import {
  ENTITLEMENTS_SUPABASE_READ,
  ENTITLEMENTS_DUAL_WRITE,
  ENTITLEMENTS_SUPABASE_AUTHORITATIVE,
} from "@/lib/featureFlags";

export type EntitlementReadSource = "supabase" | "localStorage";
export type EntitlementReadFailureKind = "read" | "unsafe.empty" | "drift";

export interface EntitlementReadFailure {
  kind: EntitlementReadFailureKind;
  ref: string;
  message: string;
  at: string;
}

export interface EntitlementCutoverState {
  supabaseRead: boolean;
  supabaseWrite: boolean;
  readSource: EntitlementReadSource;
  supabaseReads: number;
  localReads: number;
  fallbacks: number;
  failures: number;
  shadowDrift: number;
  unsafeEmptyReads: number;
  lastMismatch: string | null;
  lastEventAt: string | null;
  recentFailures: EntitlementReadFailure[];
}

const MAX_RECENT_FAILURES = 50;

function readEnabled(): boolean {
  return ENTITLEMENTS_SUPABASE_READ || ENTITLEMENTS_SUPABASE_AUTHORITATIVE;
}

const state: EntitlementCutoverState = {
  supabaseRead: readEnabled(),
  supabaseWrite: ENTITLEMENTS_DUAL_WRITE || ENTITLEMENTS_SUPABASE_AUTHORITATIVE,
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

export function shouldReadEntitlementsFromSupabase(): boolean {
  return readEnabled();
}

export function shouldMirrorEntitlementWrites(): boolean {
  return ENTITLEMENTS_DUAL_WRITE || ENTITLEMENTS_SUPABASE_AUTHORITATIVE;
}

export function getEntitlementCutoverState(): EntitlementCutoverState {
  return {
    ...state,
    supabaseRead: readEnabled(),
    supabaseWrite: ENTITLEMENTS_DUAL_WRITE || ENTITLEMENTS_SUPABASE_AUTHORITATIVE,
    readSource: readEnabled() ? "supabase" : "localStorage",
    recentFailures: [...state.recentFailures],
  };
}

export function resetEntitlementCutoverState(): void {
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

function pushFailure(kind: EntitlementReadFailureKind, ref: string, message: string): void {
  const at = new Date().toISOString();
  state.failures += 1;
  state.lastEventAt = at;
  state.recentFailures.unshift({ kind, ref, message, at });
  if (state.recentFailures.length > MAX_RECENT_FAILURES) {
    state.recentFailures.length = MAX_RECENT_FAILURES;
  }
}

export function recordEntitlementSupabaseRead(): void {
  state.supabaseReads += 1;
}

export function recordEntitlementReadFallback(ref: string, message: string): void {
  state.fallbacks += 1;
  state.localReads += 1;
  pushFailure("read", ref, message);
  if (import.meta.env.DEV === true) {
    // eslint-disable-next-line no-console
    console.warn(`[ENT] Entitlement fallback for ${ref}: ${message}`);
  }
}

export function recordEntitlementUnsafeEmpty(ref: string): void {
  state.unsafeEmptyReads += 1;
  state.fallbacks += 1;
  state.localReads += 1;
  pushFailure(
    "unsafe.empty",
    ref,
    "Supabase returned 0 entitlements while localStorage has data — kept local seed.",
  );
  if (import.meta.env.DEV === true) {
    // eslint-disable-next-line no-console
    console.warn(`[ENT] Entitlement unsafe empty for ${ref} — kept local seed.`);
  }
}

export function recordEntitlementShadowDrift(summary: string): void {
  state.shadowDrift += 1;
  state.lastMismatch = summary;
  pushFailure("drift", "shadow", summary);
  if (import.meta.env.DEV === true) {
    // eslint-disable-next-line no-console
    console.warn(`[ENT] Entitlement shadow drift: ${summary}`);
  }
}

if (import.meta.env.DEV === true && typeof window !== "undefined") {
  const w = window as unknown as { __cleanopsData?: Record<string, unknown> };
  w.__cleanopsData = {
    ...(w.__cleanopsData ?? {}),
    getEntitlementCutoverState,
    resetEntitlementCutoverState,
    shouldReadEntitlementsFromSupabase,
    shouldMirrorEntitlementWrites,
  };
}
