/**
 * Customer source-of-truth cut-over runtime (P4J · Wave 1F).
 *
 * The decision + telemetry layer for the FIRST true operational cut-over. When
 * {@link CUSTOMERS_SUPABASE_AUTHORITATIVE} is on, Supabase becomes the PRIMARY
 * source for Customer reads and the authoritative target for writes, while
 * localStorage is kept as a synchronized BACKOUT copy (option B — safest,
 * instantly reversible). This module centralises:
 *
 *   • the source resolution — what is authoritative right now (read / write),
 *   • divergence + failure handling — every Supabase read/write failure under
 *     authoritative mode is RECORDED and surfaced, never silently swallowed,
 *   • the live cut-over state behind the Super Admin "Customer Source of Truth"
 *     monitoring panel.
 *
 * It deliberately holds NO React state and performs NO I/O — the hooks and the
 * AppContext write seam call into it; it only resolves policy and records
 * counters. Rollback is `flag OFF` → reads/writes return to localStorage.
 */
import {
  CUSTOMERS_LIST_SUPABASE_READ,
  CUSTOMERS_DETAIL_SUPABASE_READ,
  CUSTOMERS_DUAL_WRITE,
  CUSTOMERS_SUPABASE_AUTHORITATIVE,
} from "@/lib/featureFlags";

/** Which store is authoritative for a given operation right now. */
export type CutoverSource = "supabase" | "localStorage";

/** Why a fallback to the localStorage backout copy happened. */
export type CutoverFallbackKind =
  | "read.list"
  | "read.detail"
  | "write.mirror";

/** A single recorded divergence/failure event during authoritative mode. */
export interface CutoverFailure {
  kind: CutoverFallbackKind;
  /** App-facing customer id (or company scope) the failure relates to. */
  ref: string;
  message: string;
  at: string;
}

/** Live, cumulative cut-over telemetry (development instrumentation only). */
export interface CustomerCutoverState {
  /** Whether Supabase is currently the authoritative customer source. */
  authoritative: boolean;
  /** Resolved read source for the list + card. */
  readSource: CutoverSource;
  /** Resolved write source (localStorage stays the backout copy regardless). */
  writeSource: CutoverSource;
  /** List reads served from Supabase (primary) under authoritative mode. */
  listReadsPrimary: number;
  /** Detail reads served from Supabase (primary) under authoritative mode. */
  detailReadsPrimary: number;
  /** Reads that fell back to the localStorage backout copy after a failure. */
  readFallbacks: number;
  /** Authoritative write mirrors that failed (localStorage still advanced). */
  writeFailures: number;
  /** Total divergence/failure events recorded. */
  failures: number;
  /** ISO timestamp of the most recent recorded event. */
  lastEventAt: string | null;
  /** Bounded ring of the most recent failures for the monitoring panel. */
  recentFailures: CutoverFailure[];
}

const MAX_RECENT_FAILURES = 50;

/** Listener notified whenever a cut-over failure is recorded. */
export type CutoverFailureListener = (failure: CutoverFailure) => void;

const failureListeners = new Set<CutoverFailureListener>();

/**
 * Subscribes to cut-over failures so a UI layer can surface them (e.g. a toast)
 * — authoritative-mode write/read failures must never be silent in production.
 * Returns an unsubscribe function.
 */
export function subscribeCustomerCutoverFailure(
  listener: CutoverFailureListener,
): () => void {
  failureListeners.add(listener);
  return () => {
    failureListeners.delete(listener);
  };
}

const state: CustomerCutoverState = {
  authoritative: CUSTOMERS_SUPABASE_AUTHORITATIVE,
  readSource: CUSTOMERS_SUPABASE_AUTHORITATIVE ? "supabase" : "localStorage",
  writeSource: CUSTOMERS_SUPABASE_AUTHORITATIVE ? "supabase" : "localStorage",
  listReadsPrimary: 0,
  detailReadsPrimary: 0,
  readFallbacks: 0,
  writeFailures: 0,
  failures: 0,
  lastEventAt: null,
  recentFailures: [],
};

/** Whether Supabase is the authoritative customer source. */
export function isCustomerSupabaseAuthoritative(): boolean {
  return CUSTOMERS_SUPABASE_AUTHORITATIVE;
}

/**
 * Whether the Customers LIST should READ from Supabase as primary. True when
 * either the dedicated list-read flag is on OR the authoritative flag is on
 * (authority implies the read path even if the granular flag is off).
 */
export function shouldReadListFromSupabase(): boolean {
  return CUSTOMERS_LIST_SUPABASE_READ || CUSTOMERS_SUPABASE_AUTHORITATIVE;
}

/** Whether the Customer CARD should READ its detail from Supabase as primary. */
export function shouldReadDetailFromSupabase(): boolean {
  return CUSTOMERS_DETAIL_SUPABASE_READ || CUSTOMERS_SUPABASE_AUTHORITATIVE;
}

/**
 * Whether a customer write should be MIRRORED to Supabase. True when dual-write
 * is on OR authoritative mode is on. Under authoritative mode the mirror is the
 * authoritative write; localStorage is still written first as the backout copy.
 */
export function shouldMirrorWrites(): boolean {
  return CUSTOMERS_DUAL_WRITE || CUSTOMERS_SUPABASE_AUTHORITATIVE;
}

/** Returns an immutable snapshot of the cumulative cut-over telemetry. */
export function getCustomerCutoverState(): CustomerCutoverState {
  return {
    ...state,
    authoritative: CUSTOMERS_SUPABASE_AUTHORITATIVE,
    readSource: CUSTOMERS_SUPABASE_AUTHORITATIVE ? "supabase" : "localStorage",
    writeSource: CUSTOMERS_SUPABASE_AUTHORITATIVE ? "supabase" : "localStorage",
    recentFailures: [...state.recentFailures],
  };
}

/** Clears the cut-over telemetry (used by tests + the dev console). */
export function resetCustomerCutoverState(): void {
  state.listReadsPrimary = 0;
  state.detailReadsPrimary = 0;
  state.readFallbacks = 0;
  state.writeFailures = 0;
  state.failures = 0;
  state.lastEventAt = null;
  state.recentFailures = [];
}

/** Records a successful Supabase-primary read under authoritative mode. */
export function recordCutoverRead(kind: "read.list" | "read.detail"): void {
  if (!CUSTOMERS_SUPABASE_AUTHORITATIVE) return;
  if (kind === "read.list") state.listReadsPrimary += 1;
  else state.detailReadsPrimary += 1;
}

/**
 * Records a divergence/failure that forced a fallback to the localStorage
 * backout copy (or a failed authoritative write). Surfaced, never silent.
 */
export function recordCutoverFailure(
  kind: CutoverFallbackKind,
  ref: string,
  message: string,
): void {
  const at = new Date().toISOString();
  const failure: CutoverFailure = { kind, ref, message, at };
  state.failures += 1;
  state.lastEventAt = at;
  if (kind === "write.mirror") state.writeFailures += 1;
  else state.readFallbacks += 1;
  state.recentFailures.unshift(failure);
  if (state.recentFailures.length > MAX_RECENT_FAILURES) {
    state.recentFailures.length = MAX_RECENT_FAILURES;
  }
  // Notify UI subscribers (toast surface). Listeners must never throw back here —
  // a failed notification can never break the authoritative write/read path.
  for (const listener of failureListeners) {
    try {
      listener(failure);
    } catch {
      // Surfacing is best-effort; ignore listener errors.
    }
  }
  if (import.meta.env.DEV === true) {
    // eslint-disable-next-line no-console
    console.warn(`[Wave1F] Customer cut-over ${kind} fallback for ${ref}: ${message}`);
  }
}

// Expose console handles in development for manual inspection.
if (import.meta.env.DEV === true && typeof window !== "undefined") {
  const w = window as unknown as { __cleanopsData?: Record<string, unknown> };
  w.__cleanopsData = {
    ...(w.__cleanopsData ?? {}),
    getCustomerCutoverState,
    resetCustomerCutoverState,
    isCustomerSupabaseAuthoritative,
  };
}
