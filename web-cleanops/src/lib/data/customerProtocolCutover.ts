/**
 * Customer Protocol read-path source runtime (PROT-1).
 *
 * Resolves whether the customer-protocol directory reads from Supabase and
 * whether writes mirror, and records fallback / unsafe-empty / drift events.
 * Rollback is `flag OFF`.
 */
import {
  CUSTOMER_PROTOCOLS_SUPABASE_READ,
  CUSTOMER_PROTOCOLS_DUAL_WRITE,
  CUSTOMER_PROTOCOLS_SUPABASE_AUTHORITATIVE,
} from "@/lib/featureFlags";

export type CustomerProtocolReadSource = "supabase" | "localStorage";
export type CustomerProtocolReadFailureKind = "read" | "unsafe.empty" | "drift";

export interface CustomerProtocolReadFailure {
  kind: CustomerProtocolReadFailureKind;
  ref: string;
  message: string;
  at: string;
}

export interface CustomerProtocolCutoverState {
  supabaseRead: boolean;
  supabaseWrite: boolean;
  readSource: CustomerProtocolReadSource;
  supabaseReads: number;
  localReads: number;
  fallbacks: number;
  failures: number;
  shadowDrift: number;
  unsafeEmptyReads: number;
  lastMismatch: string | null;
  lastEventAt: string | null;
  recentFailures: CustomerProtocolReadFailure[];
}

const MAX_RECENT_FAILURES = 50;

function readEnabled(): boolean {
  return CUSTOMER_PROTOCOLS_SUPABASE_READ || CUSTOMER_PROTOCOLS_SUPABASE_AUTHORITATIVE;
}

const state: CustomerProtocolCutoverState = {
  supabaseRead: readEnabled(),
  supabaseWrite: CUSTOMER_PROTOCOLS_DUAL_WRITE || CUSTOMER_PROTOCOLS_SUPABASE_AUTHORITATIVE,
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

export function shouldReadCustomerProtocolsFromSupabase(): boolean {
  return readEnabled();
}

export function shouldMirrorCustomerProtocolWrites(): boolean {
  return CUSTOMER_PROTOCOLS_DUAL_WRITE || CUSTOMER_PROTOCOLS_SUPABASE_AUTHORITATIVE;
}

export function isCustomerProtocolsSupabaseAuthoritative(): boolean {
  return CUSTOMER_PROTOCOLS_SUPABASE_AUTHORITATIVE;
}

export function getCustomerProtocolCutoverState(): CustomerProtocolCutoverState {
  return {
    ...state,
    supabaseRead: readEnabled(),
    supabaseWrite: CUSTOMER_PROTOCOLS_DUAL_WRITE || CUSTOMER_PROTOCOLS_SUPABASE_AUTHORITATIVE,
    readSource: readEnabled() ? "supabase" : "localStorage",
    recentFailures: [...state.recentFailures],
  };
}

export function resetCustomerProtocolCutoverState(): void {
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
  kind: CustomerProtocolReadFailureKind,
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

export function recordCustomerProtocolSupabaseRead(): void {
  state.supabaseReads += 1;
}

export function recordCustomerProtocolReadFallback(ref: string, message: string): void {
  state.fallbacks += 1;
  state.localReads += 1;
  pushFailure("read", ref, message);
  if (import.meta.env.DEV === true) {
    // eslint-disable-next-line no-console
    console.warn(`[PROT] Protocol directory fallback for ${ref}: ${message}`);
  }
}

export function recordCustomerProtocolUnsafeEmpty(ref: string): void {
  state.unsafeEmptyReads += 1;
  state.fallbacks += 1;
  state.localReads += 1;
  pushFailure(
    "unsafe.empty",
    ref,
    "Supabase returned 0 customer protocols while localStorage has data — kept local seed.",
  );
  if (import.meta.env.DEV === true) {
    // eslint-disable-next-line no-console
    console.warn(`[PROT] Protocol directory unsafe empty for ${ref} — kept local seed.`);
  }
}

export function recordCustomerProtocolShadowDrift(summary: string): void {
  state.shadowDrift += 1;
  state.lastMismatch = summary;
  pushFailure("drift", "shadow", summary);
  if (import.meta.env.DEV === true) {
    // eslint-disable-next-line no-console
    console.warn(`[PROT] Protocol directory shadow drift: ${summary}`);
  }
}

if (import.meta.env.DEV === true && typeof window !== "undefined") {
  const w = window as unknown as { __cleanopsData?: Record<string, unknown> };
  w.__cleanopsData = {
    ...(w.__cleanopsData ?? {}),
    getCustomerProtocolCutoverState,
    resetCustomerProtocolCutoverState,
    shouldReadCustomerProtocolsFromSupabase,
    shouldMirrorCustomerProtocolWrites,
    isCustomerProtocolsSupabaseAuthoritative,
  };
}
