/**
 * Service Package read-path source runtime (SVCCAT-1).
 *
 * The service-packages analogue of {@link import("./serviceCategoryCutover")}.
 * Packages are global master data (no company scope), so a "ref" here is always
 * the shared catalog ("*"). Resolves whether the package directory reads from
 * Supabase and whether writes mirror, and records fallback / unsafe-empty /
 * drift events.
 */
import {
  SERVICE_PACKAGES_SUPABASE_READ,
  SERVICE_PACKAGES_DUAL_WRITE,
  SERVICE_PACKAGES_SUPABASE_AUTHORITATIVE,
} from "@/lib/featureFlags";

export type ServicePackageReadSource = "supabase" | "localStorage";
export type ServicePackageReadFailureKind = "read" | "unsafe.empty" | "drift";

export interface ServicePackageReadFailure {
  kind: ServicePackageReadFailureKind;
  ref: string;
  message: string;
  at: string;
}

export interface ServicePackageCutoverState {
  supabaseRead: boolean;
  supabaseWrite: boolean;
  readSource: ServicePackageReadSource;
  supabaseReads: number;
  localReads: number;
  fallbacks: number;
  failures: number;
  shadowDrift: number;
  unsafeEmptyReads: number;
  lastMismatch: string | null;
  lastEventAt: string | null;
  recentFailures: ServicePackageReadFailure[];
}

const MAX_RECENT_FAILURES = 50;

function readEnabled(): boolean {
  return SERVICE_PACKAGES_SUPABASE_READ || SERVICE_PACKAGES_SUPABASE_AUTHORITATIVE;
}

const state: ServicePackageCutoverState = {
  supabaseRead: readEnabled(),
  supabaseWrite: SERVICE_PACKAGES_DUAL_WRITE || SERVICE_PACKAGES_SUPABASE_AUTHORITATIVE,
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

export function shouldReadServicePackagesFromSupabase(): boolean {
  return readEnabled();
}

export function shouldMirrorServicePackageWrites(): boolean {
  return SERVICE_PACKAGES_DUAL_WRITE || SERVICE_PACKAGES_SUPABASE_AUTHORITATIVE;
}

export function getServicePackageCutoverState(): ServicePackageCutoverState {
  return {
    ...state,
    supabaseRead: readEnabled(),
    supabaseWrite: SERVICE_PACKAGES_DUAL_WRITE || SERVICE_PACKAGES_SUPABASE_AUTHORITATIVE,
    readSource: readEnabled() ? "supabase" : "localStorage",
    recentFailures: [...state.recentFailures],
  };
}

export function resetServicePackageCutoverState(): void {
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
  kind: ServicePackageReadFailureKind,
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

export function recordServicePackageSupabaseRead(): void {
  state.supabaseReads += 1;
}

export function recordServicePackageReadFallback(ref: string, message: string): void {
  state.fallbacks += 1;
  state.localReads += 1;
  pushFailure("read", ref, message);
  if (import.meta.env.DEV === true) {
    // eslint-disable-next-line no-console
    console.warn(`[SVCCAT] Service package directory fallback for ${ref}: ${message}`);
  }
}

export function recordServicePackageUnsafeEmpty(ref: string): void {
  state.unsafeEmptyReads += 1;
  state.fallbacks += 1;
  state.localReads += 1;
  pushFailure(
    "unsafe.empty",
    ref,
    "Supabase returned 0 packages while localStorage has data — kept local seed.",
  );
  if (import.meta.env.DEV === true) {
    // eslint-disable-next-line no-console
    console.warn(`[SVCCAT] Service package directory unsafe empty for ${ref} — kept local seed.`);
  }
}

export function recordServicePackageShadowDrift(summary: string): void {
  state.shadowDrift += 1;
  state.lastMismatch = summary;
  pushFailure("drift", "shadow", summary);
  if (import.meta.env.DEV === true) {
    // eslint-disable-next-line no-console
    console.warn(`[SVCCAT] Service package directory shadow drift: ${summary}`);
  }
}

if (import.meta.env.DEV === true && typeof window !== "undefined") {
  const w = window as unknown as { __cleanopsData?: Record<string, unknown> };
  w.__cleanopsData = {
    ...(w.__cleanopsData ?? {}),
    getServicePackageCutoverState,
    resetServicePackageCutoverState,
    shouldReadServicePackagesFromSupabase,
    shouldMirrorServicePackageWrites,
  };
}
