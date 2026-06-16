/**
 * Booking Queue read-path source runtime (BQ-1).
 *
 * The decision + telemetry layer for the Booking Queue cut-over — the Booking
 * Queue analogue of {@link import("./areaCutover")}. Resolves whether the queue
 * directory reads from Supabase and whether queue writes are mirrored, and
 * records every fallback / unsafe-empty / drift event. Rollback is `flag OFF`.
 */
import {
  BOOKING_QUEUE_SUPABASE_READ,
  BOOKING_QUEUE_DUAL_WRITE,
  BOOKING_QUEUE_SUPABASE_AUTHORITATIVE,
  BOOKING_QUEUE_LOCAL_BACKOUT_BRIDGE,
} from "@/lib/featureFlags";

export type BookingQueueReadSource = "supabase" | "localStorage";
export type BookingQueueReadFailureKind = "read" | "unsafe.empty" | "drift";

export interface BookingQueueReadFailure {
  kind: BookingQueueReadFailureKind;
  ref: string;
  message: string;
  at: string;
}

export interface BookingQueueCutoverState {
  supabaseRead: boolean;
  supabaseWrite: boolean;
  readSource: BookingQueueReadSource;
  supabaseReads: number;
  localReads: number;
  fallbacks: number;
  failures: number;
  shadowDrift: number;
  unsafeEmptyReads: number;
  localBackoutBridge: boolean;
  lastMismatch: string | null;
  lastEventAt: string | null;
  recentFailures: BookingQueueReadFailure[];
}

const MAX_RECENT_FAILURES = 50;

function readEnabled(): boolean {
  return BOOKING_QUEUE_SUPABASE_READ || BOOKING_QUEUE_SUPABASE_AUTHORITATIVE;
}

const state: BookingQueueCutoverState = {
  supabaseRead: readEnabled(),
  supabaseWrite: BOOKING_QUEUE_DUAL_WRITE || BOOKING_QUEUE_SUPABASE_AUTHORITATIVE,
  readSource: readEnabled() ? "supabase" : "localStorage",
  supabaseReads: 0,
  localReads: 0,
  fallbacks: 0,
  failures: 0,
  shadowDrift: 0,
  unsafeEmptyReads: 0,
  localBackoutBridge: BOOKING_QUEUE_LOCAL_BACKOUT_BRIDGE,
  lastMismatch: null,
  lastEventAt: null,
  recentFailures: [],
};

/**
 * Whether the queue directory should READ from Supabase — true when the granular
 * read flag is on OR the authoritative cut-over is active (the latter implies it).
 */
export function shouldReadBookingQueueFromSupabase(): boolean {
  return readEnabled();
}

/**
 * Whether queue writes should be MIRRORED to Supabase — true when the granular
 * dual-write flag is on OR the authoritative cut-over is active.
 */
export function shouldMirrorBookingQueueWrites(): boolean {
  return BOOKING_QUEUE_DUAL_WRITE || BOOKING_QUEUE_SUPABASE_AUTHORITATIVE;
}

/** Whether the Booking Queue cut-over is authoritative (Supabase is primary). */
export function isBookingQueueSupabaseAuthoritative(): boolean {
  return BOOKING_QUEUE_SUPABASE_AUTHORITATIVE;
}

/**
 * Temporary bridge gate for explicitly unsafe empty Booking Queue reads.
 *
 * This is technical debt: it exists only for controlled migration/backout windows.
 * Clean successful empty Supabase reads are authoritative and must stay empty.
 */
export function shouldUseBookingQueueLocalBackoutBridge(): boolean {
  return BOOKING_QUEUE_LOCAL_BACKOUT_BRIDGE;
}

export function getBookingQueueCutoverState(): BookingQueueCutoverState {
  return {
    ...state,
    supabaseRead: readEnabled(),
    supabaseWrite: BOOKING_QUEUE_DUAL_WRITE || BOOKING_QUEUE_SUPABASE_AUTHORITATIVE,
    readSource: readEnabled() ? "supabase" : "localStorage",
    localBackoutBridge: BOOKING_QUEUE_LOCAL_BACKOUT_BRIDGE,
    recentFailures: [...state.recentFailures],
  };
}

export function resetBookingQueueCutoverState(): void {
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

function pushFailure(kind: BookingQueueReadFailureKind, ref: string, message: string): void {
  const at = new Date().toISOString();
  state.failures += 1;
  state.lastEventAt = at;
  state.recentFailures.unshift({ kind, ref, message, at });
  if (state.recentFailures.length > MAX_RECENT_FAILURES) {
    state.recentFailures.length = MAX_RECENT_FAILURES;
  }
}

export function recordBookingQueueSupabaseRead(): void {
  state.supabaseReads += 1;
}

export function recordBookingQueueReadFallback(ref: string, message: string): void {
  state.fallbacks += 1;
  state.localReads += 1;
  pushFailure("read", ref, message);
  if (import.meta.env.DEV === true) {
    // eslint-disable-next-line no-console
    console.warn(`[BQ] Booking-queue directory fallback for ${ref}: ${message}`);
  }
}

export function recordBookingQueueUnsafeEmpty(ref: string): void {
  state.unsafeEmptyReads += 1;
  state.fallbacks += 1;
  state.localReads += 1;
  pushFailure(
    "unsafe.empty",
    ref,
    "Supabase returned 0 queue items while the explicit local-backout bridge was active — kept local seed temporarily.",
  );
  if (import.meta.env.DEV === true) {
    // eslint-disable-next-line no-console
    console.warn(
      `[BQ] Booking-queue directory unsafe empty for ${ref} — kept local seed via explicit bridge.`,
    );
  }
}

export function recordBookingQueueShadowDrift(summary: string): void {
  state.shadowDrift += 1;
  state.lastMismatch = summary;
  pushFailure("drift", "shadow", summary);
  if (import.meta.env.DEV === true) {
    // eslint-disable-next-line no-console
    console.warn(`[BQ] Booking-queue directory shadow drift: ${summary}`);
  }
}

if (import.meta.env.DEV === true && typeof window !== "undefined") {
  const w = window as unknown as { __cleanopsData?: Record<string, unknown> };
  w.__cleanopsData = {
    ...(w.__cleanopsData ?? {}),
    getBookingQueueCutoverState,
    resetBookingQueueCutoverState,
    shouldReadBookingQueueFromSupabase,
    shouldMirrorBookingQueueWrites,
    shouldUseBookingQueueLocalBackoutBridge,
  };
}
