/**
 * Work Order source-of-truth cut-over runtime (P5J · WO-6).
 *
 * The decision + telemetry layer for the Work Orders authority switch — the
 * direct analogue of {@link import("./customerCutover")}. When
 * {@link WORK_ORDERS_SUPABASE_AUTHORITATIVE} is on, Supabase becomes the PRIMARY
 * source for Work Order reads (list + detail) and the authoritative target for
 * writes, while localStorage is kept as a synchronized BACKOUT copy (strategy B —
 * safest, instantly reversible). This module centralises:
 *
 *   • source resolution — what is authoritative right now (read / write),
 *   • divergence + failure handling — every Supabase read/write failure under
 *     authoritative mode is RECORDED and surfaced, never silently swallowed,
 *   • the live cut-over state behind the Super Admin "Work Orders · Source of
 *     Truth" monitoring panel.
 *
 * It deliberately holds NO React state and performs NO I/O — the hooks and the
 * AppContext write seam call into it; it only resolves policy and records
 * counters. Rollback is `flag OFF` → reads/writes return to localStorage.
 *
 * IMPORTANT: this is Work Orders ONLY. The Schedule resolver, recurrence,
 * variation and exception LOGIC are all untouched; Schedule keeps reading the
 * local resolver path (Schedule interval migration is the later WO-7 phase).
 */
import {
  WORK_ORDERS_LIST_SUPABASE_READ,
  WORK_ORDERS_DETAIL_SUPABASE_READ,
  WORK_ORDERS_SUPABASE_AUTHORITATIVE,
} from "@/lib/featureFlags";

/** Which store is authoritative for a given operation right now. */
export type WorkOrderCutoverSource = "supabase" | "localStorage";

/** Why a fallback to the localStorage backout copy happened. */
export type WorkOrderCutoverFallbackKind =
  | "read.list"
  | "read.detail"
  | "write.mirror";

/** A single recorded divergence/failure event during authoritative mode. */
export interface WorkOrderCutoverFailure {
  kind: WorkOrderCutoverFallbackKind;
  /** App-facing work-order id (or company scope) the failure relates to. */
  ref: string;
  message: string;
  at: string;
}

/** Live, cumulative cut-over telemetry (development instrumentation only). */
export interface WorkOrderCutoverState {
  /** Whether Supabase is currently the authoritative work-order source. */
  authoritative: boolean;
  /** Resolved read source for the list + detail. */
  readSource: WorkOrderCutoverSource;
  /** Resolved write source (localStorage stays the backout copy regardless). */
  writeSource: WorkOrderCutoverSource;
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
  recentFailures: WorkOrderCutoverFailure[];
}

const MAX_RECENT_FAILURES = 50;

const state: WorkOrderCutoverState = {
  authoritative: WORK_ORDERS_SUPABASE_AUTHORITATIVE,
  readSource: WORK_ORDERS_SUPABASE_AUTHORITATIVE ? "supabase" : "localStorage",
  writeSource: WORK_ORDERS_SUPABASE_AUTHORITATIVE ? "supabase" : "localStorage",
  listReadsPrimary: 0,
  detailReadsPrimary: 0,
  readFallbacks: 0,
  writeFailures: 0,
  failures: 0,
  lastEventAt: null,
  recentFailures: [],
};

/** Whether Supabase is the authoritative work-order source. */
export function isWorkOrderSupabaseAuthoritative(): boolean {
  return WORK_ORDERS_SUPABASE_AUTHORITATIVE;
}

/**
 * Whether the Work Order LIST should READ from Supabase as primary. True when
 * either the dedicated list-read flag is on OR the authoritative flag is on
 * (authority implies the read path even if the granular flag is off).
 */
export function shouldReadWorkOrderListFromSupabase(): boolean {
  return WORK_ORDERS_LIST_SUPABASE_READ || WORK_ORDERS_SUPABASE_AUTHORITATIVE;
}

/** Whether WorkOrderDetails should READ its detail from Supabase as primary. */
export function shouldReadWorkOrderDetailFromSupabase(): boolean {
  return WORK_ORDERS_DETAIL_SUPABASE_READ || WORK_ORDERS_SUPABASE_AUTHORITATIVE;
}

/** Returns an immutable snapshot of the cumulative cut-over telemetry. */
export function getWorkOrderCutoverState(): WorkOrderCutoverState {
  return {
    ...state,
    authoritative: WORK_ORDERS_SUPABASE_AUTHORITATIVE,
    readSource: WORK_ORDERS_SUPABASE_AUTHORITATIVE ? "supabase" : "localStorage",
    writeSource: WORK_ORDERS_SUPABASE_AUTHORITATIVE ? "supabase" : "localStorage",
    recentFailures: [...state.recentFailures],
  };
}

/** Clears the cut-over telemetry (used by tests + the dev console). */
export function resetWorkOrderCutoverState(): void {
  state.listReadsPrimary = 0;
  state.detailReadsPrimary = 0;
  state.readFallbacks = 0;
  state.writeFailures = 0;
  state.failures = 0;
  state.lastEventAt = null;
  state.recentFailures = [];
}

/** Records a successful Supabase-primary read under authoritative mode. */
export function recordWorkOrderCutoverRead(kind: "read.list" | "read.detail"): void {
  if (!WORK_ORDERS_SUPABASE_AUTHORITATIVE) return;
  if (kind === "read.list") state.listReadsPrimary += 1;
  else state.detailReadsPrimary += 1;
}

/**
 * Records a divergence/failure that forced a fallback to the localStorage
 * backout copy (or a failed authoritative write). Surfaced, never silent.
 */
export function recordWorkOrderCutoverFailure(
  kind: WorkOrderCutoverFallbackKind,
  ref: string,
  message: string,
): void {
  const at = new Date().toISOString();
  const failure: WorkOrderCutoverFailure = { kind, ref, message, at };
  state.failures += 1;
  state.lastEventAt = at;
  if (kind === "write.mirror") state.writeFailures += 1;
  else state.readFallbacks += 1;
  state.recentFailures.unshift(failure);
  if (state.recentFailures.length > MAX_RECENT_FAILURES) {
    state.recentFailures.length = MAX_RECENT_FAILURES;
  }
  if (import.meta.env.DEV === true) {
    // eslint-disable-next-line no-console
    console.warn(`[WO-6] Work Order cut-over ${kind} fallback for ${ref}: ${message}`);
  }
}

// Expose console handles in development for manual inspection.
if (import.meta.env.DEV === true && typeof window !== "undefined") {
  const w = window as unknown as { __cleanopsData?: Record<string, unknown> };
  w.__cleanopsData = {
    ...(w.__cleanopsData ?? {}),
    getWorkOrderCutoverState,
    resetWorkOrderCutoverState,
    isWorkOrderSupabaseAuthoritative,
  };
}
