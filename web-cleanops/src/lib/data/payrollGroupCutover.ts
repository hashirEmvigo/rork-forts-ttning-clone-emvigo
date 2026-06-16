/**
 * Payroll Group read-path source runtime (SVCCAT-1).
 *
 * The payroll-groups analogue of {@link import("./serviceCategoryCutover")}.
 * Resolves whether the payroll-group directory reads from Supabase and whether
 * writes are mirrored, and records every fallback / unsafe-empty / drift event.
 */
import {
  PAYROLL_GROUPS_SUPABASE_READ,
  PAYROLL_GROUPS_DUAL_WRITE,
  PAYROLL_GROUPS_SUPABASE_AUTHORITATIVE,
} from "@/lib/featureFlags";

export type PayrollGroupReadSource = "supabase" | "localStorage";
export type PayrollGroupReadFailureKind = "read" | "unsafe.empty" | "drift";

export interface PayrollGroupReadFailure {
  kind: PayrollGroupReadFailureKind;
  ref: string;
  message: string;
  at: string;
}

export interface PayrollGroupCutoverState {
  supabaseRead: boolean;
  supabaseWrite: boolean;
  readSource: PayrollGroupReadSource;
  supabaseReads: number;
  localReads: number;
  fallbacks: number;
  failures: number;
  shadowDrift: number;
  unsafeEmptyReads: number;
  lastMismatch: string | null;
  lastEventAt: string | null;
  recentFailures: PayrollGroupReadFailure[];
}

const MAX_RECENT_FAILURES = 50;

function readEnabled(): boolean {
  return PAYROLL_GROUPS_SUPABASE_READ || PAYROLL_GROUPS_SUPABASE_AUTHORITATIVE;
}

const state: PayrollGroupCutoverState = {
  supabaseRead: readEnabled(),
  supabaseWrite: PAYROLL_GROUPS_DUAL_WRITE || PAYROLL_GROUPS_SUPABASE_AUTHORITATIVE,
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

export function shouldReadPayrollGroupsFromSupabase(): boolean {
  return readEnabled();
}

export function shouldMirrorPayrollGroupWrites(): boolean {
  return PAYROLL_GROUPS_DUAL_WRITE || PAYROLL_GROUPS_SUPABASE_AUTHORITATIVE;
}

export function getPayrollGroupCutoverState(): PayrollGroupCutoverState {
  return {
    ...state,
    supabaseRead: readEnabled(),
    supabaseWrite: PAYROLL_GROUPS_DUAL_WRITE || PAYROLL_GROUPS_SUPABASE_AUTHORITATIVE,
    readSource: readEnabled() ? "supabase" : "localStorage",
    recentFailures: [...state.recentFailures],
  };
}

export function resetPayrollGroupCutoverState(): void {
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
  kind: PayrollGroupReadFailureKind,
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

export function recordPayrollGroupSupabaseRead(): void {
  state.supabaseReads += 1;
}

export function recordPayrollGroupReadFallback(ref: string, message: string): void {
  state.fallbacks += 1;
  state.localReads += 1;
  pushFailure("read", ref, message);
  if (import.meta.env.DEV === true) {
    // eslint-disable-next-line no-console
    console.warn(`[SVCCAT] Payroll group directory fallback for ${ref}: ${message}`);
  }
}

export function recordPayrollGroupUnsafeEmpty(ref: string): void {
  state.unsafeEmptyReads += 1;
  state.fallbacks += 1;
  state.localReads += 1;
  pushFailure(
    "unsafe.empty",
    ref,
    "Supabase returned 0 payroll groups while localStorage has data — kept local seed.",
  );
  if (import.meta.env.DEV === true) {
    // eslint-disable-next-line no-console
    console.warn(`[SVCCAT] Payroll group directory unsafe empty for ${ref} — kept local seed.`);
  }
}

export function recordPayrollGroupShadowDrift(summary: string): void {
  state.shadowDrift += 1;
  state.lastMismatch = summary;
  pushFailure("drift", "shadow", summary);
  if (import.meta.env.DEV === true) {
    // eslint-disable-next-line no-console
    console.warn(`[SVCCAT] Payroll group directory shadow drift: ${summary}`);
  }
}

if (import.meta.env.DEV === true && typeof window !== "undefined") {
  const w = window as unknown as { __cleanopsData?: Record<string, unknown> };
  w.__cleanopsData = {
    ...(w.__cleanopsData ?? {}),
    getPayrollGroupCutoverState,
    resetPayrollGroupCutoverState,
    shouldReadPayrollGroupsFromSupabase,
    shouldMirrorPayrollGroupWrites,
  };
}
