/**
 * Media Asset read-path source runtime (MEDIA-1).
 *
 * The Media analogue of {@link import("./areaCutover")}. Resolves whether the
 * media directory reads from Supabase and whether writes mirror, and records
 * fallback / unsafe-empty / drift events. Rollback is `flag OFF`.
 */
import {
  MEDIA_ASSETS_SUPABASE_READ,
  MEDIA_ASSETS_DUAL_WRITE,
  MEDIA_ASSETS_SUPABASE_AUTHORITATIVE,
} from "@/lib/featureFlags";

export type MediaAssetReadSource = "supabase" | "localStorage";
export type MediaAssetReadFailureKind = "read" | "unsafe.empty" | "drift";

export interface MediaAssetReadFailure {
  kind: MediaAssetReadFailureKind;
  ref: string;
  message: string;
  at: string;
}

export interface MediaAssetCutoverState {
  supabaseRead: boolean;
  supabaseWrite: boolean;
  readSource: MediaAssetReadSource;
  supabaseReads: number;
  localReads: number;
  fallbacks: number;
  failures: number;
  shadowDrift: number;
  unsafeEmptyReads: number;
  lastMismatch: string | null;
  lastEventAt: string | null;
  recentFailures: MediaAssetReadFailure[];
}

const MAX_RECENT_FAILURES = 50;

function readEnabled(): boolean {
  return MEDIA_ASSETS_SUPABASE_READ || MEDIA_ASSETS_SUPABASE_AUTHORITATIVE;
}

const state: MediaAssetCutoverState = {
  supabaseRead: readEnabled(),
  supabaseWrite: MEDIA_ASSETS_DUAL_WRITE || MEDIA_ASSETS_SUPABASE_AUTHORITATIVE,
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

export function shouldReadMediaAssetsFromSupabase(): boolean {
  return readEnabled();
}

export function shouldMirrorMediaAssetWrites(): boolean {
  return MEDIA_ASSETS_DUAL_WRITE || MEDIA_ASSETS_SUPABASE_AUTHORITATIVE;
}

export function isMediaAssetsSupabaseAuthoritative(): boolean {
  return MEDIA_ASSETS_SUPABASE_AUTHORITATIVE;
}

export function getMediaAssetCutoverState(): MediaAssetCutoverState {
  return {
    ...state,
    supabaseRead: readEnabled(),
    supabaseWrite: MEDIA_ASSETS_DUAL_WRITE || MEDIA_ASSETS_SUPABASE_AUTHORITATIVE,
    readSource: readEnabled() ? "supabase" : "localStorage",
    recentFailures: [...state.recentFailures],
  };
}

export function resetMediaAssetCutoverState(): void {
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

function pushFailure(kind: MediaAssetReadFailureKind, ref: string, message: string): void {
  const at = new Date().toISOString();
  state.failures += 1;
  state.lastEventAt = at;
  state.recentFailures.unshift({ kind, ref, message, at });
  if (state.recentFailures.length > MAX_RECENT_FAILURES) {
    state.recentFailures.length = MAX_RECENT_FAILURES;
  }
}

export function recordMediaAssetSupabaseRead(): void {
  state.supabaseReads += 1;
}

export function recordMediaAssetReadFallback(ref: string, message: string): void {
  state.fallbacks += 1;
  state.localReads += 1;
  pushFailure("read", ref, message);
  if (import.meta.env.DEV === true) {
    // eslint-disable-next-line no-console
    console.warn(`[MEDIA] Media directory fallback for ${ref}: ${message}`);
  }
}

export function recordMediaAssetUnsafeEmpty(ref: string): void {
  state.unsafeEmptyReads += 1;
  state.fallbacks += 1;
  state.localReads += 1;
  pushFailure(
    "unsafe.empty",
    ref,
    "Supabase returned 0 media assets while localStorage has data — kept local seed.",
  );
  if (import.meta.env.DEV === true) {
    // eslint-disable-next-line no-console
    console.warn(`[MEDIA] Media directory unsafe empty for ${ref} — kept local seed.`);
  }
}

export function recordMediaAssetShadowDrift(summary: string): void {
  state.shadowDrift += 1;
  state.lastMismatch = summary;
  pushFailure("drift", "shadow", summary);
  if (import.meta.env.DEV === true) {
    // eslint-disable-next-line no-console
    console.warn(`[MEDIA] Media directory shadow drift: ${summary}`);
  }
}

if (import.meta.env.DEV === true && typeof window !== "undefined") {
  const w = window as unknown as { __cleanopsData?: Record<string, unknown> };
  w.__cleanopsData = {
    ...(w.__cleanopsData ?? {}),
    getMediaAssetCutoverState,
    resetMediaAssetCutoverState,
    shouldReadMediaAssetsFromSupabase,
    shouldMirrorMediaAssetWrites,
    isMediaAssetsSupabaseAuthoritative,
  };
}
