/**
 * Work Order dual-write mirror (P5G · WO-5).
 *
 * The FIRST Work Order write-path migration step and the direct analogue of
 * {@link import("./customerDualWrite")}. localStorage stays the single source of
 * truth: every work-order write completes synchronously against localStorage
 * BEFORE this module runs. When the {@link WORK_ORDERS_DUAL_WRITE} flag is on,
 * the two write seams fire these mirrors in the background:
 *
 *   • `persistWorkOrders`  → {@link mirrorWorkOrderWrites} — MIRRORS the parent
 *     into `work_orders` and its nested service rows into
 *     `work_order_service_rows` (variations stay embedded in each row's `data`
 *     jsonb, exactly like the migration tool).
 *   • `persistBookingOccurrenceExceptions` → {@link mirrorWorkOrderExceptionWrites}
 *     — MIRRORS the SEPARATE occurrence-exception store into
 *     `work_order_occurrence_exceptions`.
 *
 * WO-5.6 — removal propagation. The mirror also reconciles DELETIONS so no stale
 * row survives in Supabase before the WO-6 cut-over: a removed parent, a service
 * row dropped from a kept/removed parent, and a removed occurrence exception are
 * each SOFT-DELETED (`deleted_at` stamp; RLS blocks hard delete). Read paths
 * filter `deleted_at`, so a soft-deleted row vanishes from every active /
 * schedule-critical query — eliminating ghost occurrences and stale
 * cancellations/reschedules. An upsert of the same `legacy_id` (re-create /
 * reactivate / restore) writes `deleted_at = null` and UNDELETES the row.
 *
 * Guarantees (identical to the proven customer mirror):
 *   • Never throws — always invoked fire-and-forget, so a Supabase failure /
 *     timeout can never break a work-order operation.
 *   • Idempotent — `upsert` on the unique `legacy_id`, so re-running (or repeated
 *     saves of the same record) never inflates or duplicates rows. Removal is an
 *     idempotent soft-delete UPDATE (re-running re-stamps the same removed rows).
 *   • Company-scoped — each row carries the real `company_id` UUID that RLS
 *     checks; rows whose company has no Supabase mapping are skipped + surfaced.
 *   • Self-validating — after mirroring, it re-reads the affected parent rows and
 *     compares the critical fields + service-row counts, recording any drift.
 *
 * The Schedule resolver, recurrence, variation and exception LOGIC are all
 * untouched; this module only mirrors data. All runtime state lives in
 * {@link getWorkOrderDualWriteState}, which backs the Super Admin "Work Orders ·
 * WO-5 Dual Write" monitoring panel.
 */
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import {
  WORK_ORDERS_DUAL_WRITE,
  WORK_ORDERS_LIST_SUPABASE_READ,
  WORK_ORDERS_DETAIL_SUPABASE_READ,
  WORK_ORDERS_SUPABASE_AUTHORITATIVE,
} from "@/lib/featureFlags";
import { perf } from "@/lib/perf";
import { getCustomers, getWorkOrders } from "@/lib/store";
import type { WorkOrder, BookingOccurrenceException } from "@/types";
import { loadCompanyUuidMap } from "./customerMigration";
import {
  toWorkOrderUpsertRow,
  toServiceRowUpsertRow,
  toExceptionUpsertRow,
  type WorkOrderUpsertRow,
  type WorkOrderServiceRowUpsertRow,
  type WorkOrderExceptionUpsertRow,
} from "./workOrderMigration";

/** Critical parent fields validated after every mirrored work-order write. */
export type WorkOrderWriteField =
  | "legacy_id"
  | "company_legacy_id"
  | "customer_legacy_id"
  | "number"
  | "status"
  | "service_row_count";

/** A single field-level discrepancy found while validating a mirrored write. */
export interface WorkOrderWriteMismatch {
  /** App-facing work-order id (or exception legacy_id). */
  id: string;
  /** The critical field that differs (or "missing" when the row never arrived). */
  field: WorkOrderWriteField | "missing";
  /** Value persisted to localStorage (authoritative). */
  local: string;
  /** Value read back from Supabase. */
  supabase: string;
  /** When the mismatch was observed. */
  at: string;
}

/** The classification of changes a single mirror operation carried. */
export interface WorkOrderWriteDiff {
  created: string[];
  updated: string[];
  /** Ids present before but gone after — surfaced only (hard delete handled separately). */
  removed: string[];
}

/** Structured outcome of one {@link mirrorWorkOrderWrites} run. */
export interface WorkOrderDualWriteResult {
  ok: boolean;
  /** True when nothing changed between prev/next (no Supabase work done). */
  noop: boolean;
  diff: WorkOrderWriteDiff;
  /** Parent rows actually upserted to Supabase. */
  mirroredWorkOrders: number;
  /** Service rows actually upserted to Supabase. */
  mirroredServiceRows: number;
  /** Parent rows soft-deleted in Supabase (present before, absent after). */
  removedWorkOrders: number;
  /** Service rows soft-deleted in Supabase (dropped from a kept/removed parent). */
  removedServiceRows: number;
  /** Source work orders skipped (no company mapping / RLS would reject). */
  skipped: Array<{ id: string; reason: string }>;
  /** Field-level mismatches found by the post-write validation. */
  mismatches: WorkOrderWriteMismatch[];
  /** Fatal error captured (never thrown to the caller). */
  error: string | null;
  /** Total wall-clock duration of the mirror, milliseconds. */
  durationMs: number;
}

/** Structured outcome of one {@link mirrorWorkOrderExceptionWrites} run. */
export interface WorkOrderExceptionDualWriteResult {
  ok: boolean;
  noop: boolean;
  diff: WorkOrderWriteDiff;
  /** Exception rows actually upserted to Supabase. */
  mirroredExceptions: number;
  /** Exception rows soft-deleted in Supabase (present before, absent after). */
  removedExceptions: number;
  skipped: Array<{ id: string; reason: string }>;
  error: string | null;
  durationMs: number;
}

/** Effective Work Orders rollout flags captured with each mirror run. */
export interface WorkOrderDualWriteFlagState {
  dualWrite: boolean;
  listSupabaseRead: boolean;
  detailSupabaseRead: boolean;
  supabaseAuthoritative: boolean;
}

/** Read-only Supabase/RLS context captured for skip/failure diagnostics. */
export interface WorkOrderSupabaseSessionDiagnostics {
  authSessionExists: boolean | null;
  currentCompanyId: string | null;
  isSuperAdmin: boolean | null;
  error: string | null;
}

/** The UI identity needed to tie a displayed Work Order back to its immutable id. */
export interface WorkOrderMirrorIdentityContext {
  legacyId: string;
  number: string;
  title: string | null;
  companyLegacyId: string;
  customerLegacyId: string;
  serviceRows: Array<{ id: string; serviceName: string }>;
}

/** One concrete skip/failure record from a recent Work Orders mirror attempt. */
export interface WorkOrderMirrorIssueRecord {
  at: string;
  runId: string;
  kind: "skip" | "failure";
  tableName: string | null;
  workOrderLegacyId: string | null;
  displayedNumber: string | null;
  companyLegacyId: string | null;
  reason: string;
  supabaseCode: string | null;
  supabaseMessage: string | null;
  companyMappingFound: boolean | null;
  authSessionExists: boolean | null;
  currentCompanyId: string | null;
  isSuperAdmin: boolean | null;
}

/** Latest-run and recent-run diagnostics for Work Orders mirror tracing. */
export interface WorkOrderMirrorRunDiagnostic {
  runId: string;
  kind: "work_orders" | "occurrence_exceptions";
  startedAt: string;
  finishedAt: string | null;
  durationMs: number;
  ok: boolean;
  noop: boolean;
  flagState: WorkOrderDualWriteFlagState;
  diff: WorkOrderWriteDiff;
  noOpWorkOrderLegacyIds: string[];
  noOpWorkOrderCount: number;
  parentRowLegacyIdsAttempted: string[];
  parentRowsAttempted: number;
  parentsMirrored: number;
  serviceRowLegacyIdsAttempted: string[];
  serviceRowsAttempted: number;
  serviceRowsMirrored: number;
  occurrenceExceptionIdsAttempted: string[];
  occurrenceExceptionsAttempted: number;
  occurrenceExceptionsMirrored: number;
  parentsRemoved: number;
  serviceRowsRemoved: number;
  exceptionsRemoved: number;
  latestIdentity: WorkOrderMirrorIdentityContext | null;
  supabaseSession: WorkOrderSupabaseSessionDiagnostics;
  skipped: WorkOrderMirrorIssueRecord[];
  failures: WorkOrderMirrorIssueRecord[];
  mismatches: WorkOrderWriteMismatch[];
  lastError: string | null;
}

/** Live, cumulative dual-write metrics (development instrumentation only). */
export interface WorkOrderDualWriteState {
  /** Mirror operations attempted (one per work-order/exception write while on). */
  runs: number;
  /** Runs that performed no Supabase work (nothing changed). */
  noops: number;
  /** Parent work-order rows mirrored to Supabase. */
  parentsMirrored: number;
  /** Service rows mirrored to Supabase. */
  serviceRowsMirrored: number;
  /** Occurrence exceptions mirrored to Supabase. */
  exceptionsMirrored: number;
  /** Removals detected locally (parents/exceptions absent in next). */
  removedDetected: number;
  /** Parent work-order rows soft-deleted in Supabase (removal propagated). */
  parentsRemoved: number;
  /** Service rows soft-deleted in Supabase (removal propagated). */
  serviceRowsRemoved: number;
  /** Occurrence exceptions soft-deleted in Supabase (removal propagated). */
  exceptionsRemoved: number;
  /** Source rows skipped for want of a company mapping. */
  skipped: number;
  /** Post-write validation passes performed. */
  validations: number;
  /** Field-level mismatches observed across all runs. */
  mismatches: number;
  /** Mirror runs that failed (Supabase unavailable / error / timeout). */
  failures: number;
  /** Most recent fatal error message, if any. */
  lastError: string | null;
  /** ISO timestamp of the last mirror run. */
  lastRunAt: string | null;
  /** Bounded ring of the most recent mismatches, for the monitoring panel. */
  recentMismatches: WorkOrderWriteMismatch[];
  /** Full diagnostics for the latest mirror run, including immutable legacy ids. */
  latestRun: WorkOrderMirrorRunDiagnostic | null;
  /** Bounded ring of the last mirror runs for before/after validation. */
  recentRuns: WorkOrderMirrorRunDiagnostic[];
  /** Bounded ring of concrete recent skip/failure records. */
  recentIssues: WorkOrderMirrorIssueRecord[];
}

/**
 * Whether work-order writes should be MIRRORED to Supabase. True when the
 * dual-write flag is on OR authoritative mode is on (WO-6: authority implies the
 * write mirror even if the granular dual-write flag is off — localStorage is
 * still written first as the backout copy). Rollback = both flags OFF → writes
 * go to localStorage only.
 */
export function shouldMirrorWorkOrderWrites(): boolean {
  return WORK_ORDERS_DUAL_WRITE || WORK_ORDERS_SUPABASE_AUTHORITATIVE;
}

const MAX_RECENT_MISMATCHES = 50;
const MAX_RECENT_RUNS = 10;
const MAX_RECENT_ISSUES = 50;
const MAX_NOOP_IDS = 25;

const state: WorkOrderDualWriteState = {
  runs: 0,
  noops: 0,
  parentsMirrored: 0,
  serviceRowsMirrored: 0,
  exceptionsMirrored: 0,
  removedDetected: 0,
  parentsRemoved: 0,
  serviceRowsRemoved: 0,
  exceptionsRemoved: 0,
  skipped: 0,
  validations: 0,
  mismatches: 0,
  failures: 0,
  lastError: null,
  lastRunAt: null,
  recentMismatches: [],
  latestRun: null,
  recentRuns: [],
  recentIssues: [],
};

function cloneIdentity(
  identity: WorkOrderMirrorIdentityContext | null,
): WorkOrderMirrorIdentityContext | null {
  if (identity == null) return null;
  return {
    ...identity,
    serviceRows: identity.serviceRows.map((row) => ({ ...row })),
  };
}

function cloneRun(run: WorkOrderMirrorRunDiagnostic): WorkOrderMirrorRunDiagnostic {
  return {
    ...run,
    flagState: { ...run.flagState },
    diff: {
      created: [...run.diff.created],
      updated: [...run.diff.updated],
      removed: [...run.diff.removed],
    },
    noOpWorkOrderLegacyIds: [...run.noOpWorkOrderLegacyIds],
    parentRowLegacyIdsAttempted: [...run.parentRowLegacyIdsAttempted],
    serviceRowLegacyIdsAttempted: [...run.serviceRowLegacyIdsAttempted],
    occurrenceExceptionIdsAttempted: [...run.occurrenceExceptionIdsAttempted],
    latestIdentity: cloneIdentity(run.latestIdentity),
    supabaseSession: { ...run.supabaseSession },
    skipped: run.skipped.map((issue) => ({ ...issue })),
    failures: run.failures.map((issue) => ({ ...issue })),
    mismatches: run.mismatches.map((mismatch) => ({ ...mismatch })),
  };
}

/** Returns an immutable snapshot of the cumulative dual-write metrics. */
export function getWorkOrderDualWriteState(): WorkOrderDualWriteState {
  return {
    ...state,
    recentMismatches: [...state.recentMismatches],
    latestRun: state.latestRun == null ? null : cloneRun(state.latestRun),
    recentRuns: state.recentRuns.map(cloneRun),
    recentIssues: state.recentIssues.map((issue) => ({ ...issue })),
  };
}

/** Clears the cumulative dual-write metrics (used by tests + the dev console). */
export function resetWorkOrderDualWriteState(): void {
  state.runs = 0;
  state.noops = 0;
  state.parentsMirrored = 0;
  state.serviceRowsMirrored = 0;
  state.exceptionsMirrored = 0;
  state.removedDetected = 0;
  state.parentsRemoved = 0;
  state.serviceRowsRemoved = 0;
  state.exceptionsRemoved = 0;
  state.skipped = 0;
  state.validations = 0;
  state.mismatches = 0;
  state.failures = 0;
  state.lastError = null;
  state.lastRunAt = null;
  state.recentMismatches = [];
  state.latestRun = null;
  state.recentRuns = [];
  state.recentIssues = [];
}

/** Stable, comparison-friendly key for a single work-order record. */
function fingerprintWorkOrder(order: WorkOrder): string {
  return JSON.stringify(order);
}

/** Stable, comparison-friendly key for a single exception record. */
function fingerprintException(exception: BookingOccurrenceException): string {
  return JSON.stringify(exception);
}

/** Classifies prev → next work orders into created / updated / removed id sets. */
function diffWorkOrders(prev: WorkOrder[], next: WorkOrder[]): WorkOrderWriteDiff {
  const prevById = new Map(prev.map((w) => [w.id, w]));
  const nextById = new Map(next.map((w) => [w.id, w]));
  const created: string[] = [];
  const updated: string[] = [];
  const removed: string[] = [];

  for (const w of next) {
    const before = prevById.get(w.id);
    if (!before) created.push(w.id);
    else if (fingerprintWorkOrder(before) !== fingerprintWorkOrder(w)) updated.push(w.id);
  }
  for (const w of prev) {
    if (!nextById.has(w.id)) removed.push(w.id);
  }
  return { created, updated, removed };
}

/** Classifies prev → next exceptions into created / updated / removed id sets. */
function diffExceptions(
  prev: BookingOccurrenceException[],
  next: BookingOccurrenceException[],
): WorkOrderWriteDiff {
  const prevById = new Map(prev.map((e) => [e.id, e]));
  const nextById = new Map(next.map((e) => [e.id, e]));
  const created: string[] = [];
  const updated: string[] = [];
  const removed: string[] = [];

  for (const e of next) {
    const before = prevById.get(e.id);
    if (!before) created.push(e.id);
    else if (fingerprintException(before) !== fingerprintException(e)) updated.push(e.id);
  }
  for (const e of prev) {
    if (!nextById.has(e.id)) removed.push(e.id);
  }
  return { created, updated, removed };
}

/**
 * Collects the service-row legacy ids that must be soft-deleted in Supabase:
 * every row of a fully-removed parent, plus every row dropped from a surviving
 * (updated) parent. Stale service rows are schedule-critical — they create ghost
 * occurrences — so this set drives mandatory removal propagation before WO-6.
 */
function collectRemovedServiceRowIds(
  prev: WorkOrder[],
  next: WorkOrder[],
  diff: WorkOrderWriteDiff,
): string[] {
  const prevById = new Map(prev.map((w) => [w.id, w]));
  const nextById = new Map(next.map((w) => [w.id, w]));
  const removed: string[] = [];
  // 1. All service rows of fully-removed parent work orders.
  for (const id of diff.removed) {
    const before = prevById.get(id);
    for (const r of before?.serviceRows ?? []) removed.push(r.id);
  }
  // 2. Service rows dropped from a surviving (updated) parent.
  for (const id of diff.updated) {
    const before = prevById.get(id);
    const after = nextById.get(id);
    if (!before || !after) continue;
    const afterIds = new Set((after.serviceRows ?? []).map((r) => r.id));
    for (const r of before.serviceRows ?? []) {
      if (!afterIds.has(r.id)) removed.push(r.id);
    }
  }
  return removed;
}

/**
 * Soft-deletes rows by `legacy_id`: an UPDATE that stamps `deleted_at`. RLS
 * blocks hard DELETE for everyone, so removal is always a soft delete (mirrors
 * the customers convention). Read paths filter `deleted_at`, so a soft-deleted
 * row immediately disappears from every active / schedule-critical query while
 * history is preserved. Returns the Supabase error message, if any.
 */
async function softDeleteByLegacyIds(
  table: string,
  legacyIds: string[],
): Promise<string | null> {
  if (!supabase || legacyIds.length === 0) return null;
  const { error } = await supabase
    .from(table)
    .update({ deleted_at: new Date().toISOString() })
    .in("legacy_id", legacyIds);
  return error ? error.message : null;
}

function recordMismatch(m: WorkOrderWriteMismatch): void {
  state.mismatches += 1;
  state.recentMismatches.unshift(m);
  if (state.recentMismatches.length > MAX_RECENT_MISMATCHES) {
    state.recentMismatches.length = MAX_RECENT_MISMATCHES;
  }
}

function normalise(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

/**
 * Re-reads each mirrored parent row from Supabase and compares the critical
 * fields (+ service-row count) against the authoritative localStorage record.
 * Read-only; records drift but never throws. Returns the mismatches found.
 */
async function validateMirroredWorkOrders(
  rows: WorkOrderUpsertRow[],
  sourceById: Map<string, WorkOrder>,
): Promise<WorkOrderWriteMismatch[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  const stop = perf.start("workOrders.write.validation");
  const found: WorkOrderWriteMismatch[] = [];
  const at = new Date().toISOString();
  try {
    for (const row of rows) {
      const local = sourceById.get(row.legacy_id);
      if (!local) continue;
      const { data, error } = await supabase
        .from("work_orders")
        .select("legacy_id, company_legacy_id, customer_legacy_id, number, status, service_row_count")
        .eq("legacy_id", row.legacy_id)
        .maybeSingle();
      state.validations += 1;
      if (error || !data) {
        const m: WorkOrderWriteMismatch = {
          id: row.legacy_id,
          field: "missing",
          local: local.id,
          supabase: error ? `error: ${error.message}` : "no row",
          at,
        };
        found.push(m);
        recordMismatch(m);
        continue;
      }
      const r = data as unknown as {
        legacy_id: string;
        company_legacy_id: string;
        customer_legacy_id: string;
        number: string;
        status: string;
        service_row_count: number | null;
      };
      const localRowCount = local.serviceRows?.length ?? 0;
      const checks: Array<[WorkOrderWriteField, string, string]> = [
        ["legacy_id", local.id, r.legacy_id],
        ["company_legacy_id", local.companyId, r.company_legacy_id],
        ["customer_legacy_id", local.customerId, r.customer_legacy_id],
        ["number", local.number, r.number],
        ["status", normalise(local.status), normalise(r.status)],
        ["service_row_count", String(localRowCount), String(r.service_row_count ?? 0)],
      ];
      for (const [field, localVal, supaVal] of checks) {
        if (localVal !== supaVal) {
          const m: WorkOrderWriteMismatch = {
            id: row.legacy_id,
            field,
            local: localVal,
            supabase: supaVal,
            at,
          };
          found.push(m);
          recordMismatch(m);
        }
      }
    }
    return found;
  } finally {
    stop();
  }
}

/** Builds a customerId → display name map once (avoids per-row lookup). */
function buildCustomerNameMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const c of getCustomers()) map.set(c.id, c.name);
  return map;
}

function captureFlagState(): WorkOrderDualWriteFlagState {
  return {
    dualWrite: WORK_ORDERS_DUAL_WRITE,
    listSupabaseRead: WORK_ORDERS_LIST_SUPABASE_READ,
    detailSupabaseRead: WORK_ORDERS_DETAIL_SUPABASE_READ,
    supabaseAuthoritative: WORK_ORDERS_SUPABASE_AUTHORITATIVE,
  };
}

function emptySessionDiagnostics(error: string | null = null): WorkOrderSupabaseSessionDiagnostics {
  return {
    authSessionExists: null,
    currentCompanyId: null,
    isSuperAdmin: null,
    error,
  };
}

async function readSupabaseSessionDiagnostics(): Promise<WorkOrderSupabaseSessionDiagnostics> {
  if (!supabase) return emptySessionDiagnostics("Supabase is not configured.");

  const client = supabase as unknown as {
    auth?: { getSession?: () => Promise<{ data?: { session?: unknown | null }; error?: { message?: string } | null }> };
    rpc?: (fn: string) => Promise<{ data?: unknown; error?: { message?: string } | null }>;
  };
  const diagnostics = emptySessionDiagnostics();
  const errors: string[] = [];

  try {
    if (typeof client.auth?.getSession === "function") {
      const { data, error } = await client.auth.getSession();
      diagnostics.authSessionExists = Boolean(data?.session);
      if (error?.message) errors.push(`auth.getSession: ${error.message}`);
    }
  } catch (err) {
    errors.push(err instanceof Error ? `auth.getSession: ${err.message}` : "auth.getSession failed");
  }

  try {
    if (typeof client.rpc === "function") {
      const { data, error } = await client.rpc("current_company_id");
      diagnostics.currentCompanyId = typeof data === "string" ? data : null;
      if (error?.message) errors.push(`current_company_id: ${error.message}`);
    }
  } catch (err) {
    errors.push(err instanceof Error ? `current_company_id: ${err.message}` : "current_company_id failed");
  }

  try {
    if (typeof client.rpc === "function") {
      const { data, error } = await client.rpc("is_super_admin");
      diagnostics.isSuperAdmin = typeof data === "boolean" ? data : null;
      if (error?.message) errors.push(`is_super_admin: ${error.message}`);
    }
  } catch (err) {
    errors.push(err instanceof Error ? `is_super_admin: ${err.message}` : "is_super_admin failed");
  }

  diagnostics.error = errors.length > 0 ? errors.join("; ") : null;
  return diagnostics;
}

function buildIdentityContext(order: WorkOrder): WorkOrderMirrorIdentityContext {
  return {
    legacyId: order.id,
    number: order.number,
    title: order.title ?? order.service ?? null,
    companyLegacyId: order.companyId,
    customerLegacyId: order.customerId,
    serviceRows: (order.serviceRows ?? []).map((row) => ({
      id: row.id,
      serviceName: row.serviceName,
    })),
  };
}

function findWorkOrderByServiceRowId(orders: WorkOrder[], serviceRowId: string): WorkOrder | null {
  return orders.find((order) => (order.serviceRows ?? []).some((row) => row.id === serviceRowId)) ?? null;
}

function errorField(error: unknown, field: "code" | "message"): string | null {
  if (typeof error !== "object" || error === null || !(field in error)) return null;
  const value = (error as Record<string, unknown>)[field];
  return typeof value === "string" ? value : null;
}

function createIssueRecord(args: {
  run: WorkOrderMirrorRunDiagnostic;
  kind: "skip" | "failure";
  tableName: string | null;
  order: WorkOrder | null;
  companyLegacyId: string | null;
  reason: string;
  supabaseError?: unknown;
  companyMappingFound: boolean | null;
}): WorkOrderMirrorIssueRecord {
  return {
    at: new Date().toISOString(),
    runId: args.run.runId,
    kind: args.kind,
    tableName: args.tableName,
    workOrderLegacyId: args.order?.id ?? null,
    displayedNumber: args.order?.number ?? null,
    companyLegacyId: args.companyLegacyId ?? args.order?.companyId ?? null,
    reason: args.reason,
    supabaseCode: errorField(args.supabaseError, "code"),
    supabaseMessage: errorField(args.supabaseError, "message") ?? args.reason,
    companyMappingFound: args.companyMappingFound,
    authSessionExists: args.run.supabaseSession.authSessionExists,
    currentCompanyId: args.run.supabaseSession.currentCompanyId,
    isSuperAdmin: args.run.supabaseSession.isSuperAdmin,
  };
}

function recordIssue(run: WorkOrderMirrorRunDiagnostic, issue: WorkOrderMirrorIssueRecord): void {
  if (issue.kind === "skip") run.skipped.push(issue);
  else run.failures.push(issue);
  state.recentIssues.unshift(issue);
  if (state.recentIssues.length > MAX_RECENT_ISSUES) state.recentIssues.length = MAX_RECENT_ISSUES;
}

function createRunDiagnostic(args: {
  kind: "work_orders" | "occurrence_exceptions";
  diff: WorkOrderWriteDiff;
}): WorkOrderMirrorRunDiagnostic {
  const startedAt = new Date().toISOString();
  return {
    runId: `${args.kind}-${state.runs}-${Date.now().toString(36)}`,
    kind: args.kind,
    startedAt,
    finishedAt: null,
    durationMs: 0,
    ok: false,
    noop: false,
    flagState: captureFlagState(),
    diff: args.diff,
    noOpWorkOrderLegacyIds: [],
    noOpWorkOrderCount: 0,
    parentRowLegacyIdsAttempted: [],
    parentRowsAttempted: 0,
    parentsMirrored: 0,
    serviceRowLegacyIdsAttempted: [],
    serviceRowsAttempted: 0,
    serviceRowsMirrored: 0,
    occurrenceExceptionIdsAttempted: [],
    occurrenceExceptionsAttempted: 0,
    occurrenceExceptionsMirrored: 0,
    parentsRemoved: 0,
    serviceRowsRemoved: 0,
    exceptionsRemoved: 0,
    latestIdentity: null,
    supabaseSession: emptySessionDiagnostics(),
    skipped: [],
    failures: [],
    mismatches: [],
    lastError: null,
  };
}

function finalizeRun(
  run: WorkOrderMirrorRunDiagnostic,
  result: WorkOrderDualWriteResult | WorkOrderExceptionDualWriteResult,
): void {
  run.finishedAt = new Date().toISOString();
  run.durationMs = result.durationMs;
  run.ok = result.ok;
  run.noop = result.noop;
  run.lastError = result.error;
  if ("mirroredWorkOrders" in result) {
    run.parentsMirrored = result.mirroredWorkOrders;
    run.serviceRowsMirrored = result.mirroredServiceRows;
    run.parentsRemoved = result.removedWorkOrders;
    run.serviceRowsRemoved = result.removedServiceRows;
    run.mismatches = result.mismatches;
  } else {
    run.occurrenceExceptionsMirrored = result.mirroredExceptions;
    run.exceptionsRemoved = result.removedExceptions;
  }
  state.latestRun = run;
  state.recentRuns.unshift(run);
  if (state.recentRuns.length > MAX_RECENT_RUNS) state.recentRuns.length = MAX_RECENT_RUNS;
}

/**
 * Mirrors a work-order write (prev → next) into Supabase: the changed parent
 * rows into `work_orders` and their service rows into `work_order_service_rows`.
 *
 * Always call fire-and-forget AFTER the authoritative localStorage write has
 * completed. localStorage is never affected by this function.
 *
 * @param prev The work orders BEFORE the write (authoritative previous state).
 * @param next The work orders AFTER the write (now persisted to localStorage).
 */
export async function mirrorWorkOrderWrites(
  prev: WorkOrder[],
  next: WorkOrder[],
): Promise<WorkOrderDualWriteResult> {
  const stopDual = perf.start("workOrders.write.dual");
  const startedAt =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  state.runs += 1;
  state.lastRunAt = new Date().toISOString();

  const diff = diffWorkOrders(prev, next);
  state.removedDetected += diff.removed.length;

  // WO-5.6: removal propagation sets. Removed parents are soft-deleted; their
  // service rows (plus rows dropped from surviving parents) are soft-deleted too.
  const removedWorkOrderIds = diff.removed;
  const removedServiceRowIds = collectRemovedServiceRowIds(prev, next, diff);
  const changedIds = [...diff.created, ...diff.updated];
  const prevById = new Map(prev.map((w) => [w.id, w]));
  const nextById = new Map(next.map((w) => [w.id, w]));
  const latestWorkOrder =
    (changedIds[0] != null ? nextById.get(changedIds[0]) : undefined) ??
    (removedWorkOrderIds[0] != null ? prevById.get(removedWorkOrderIds[0]) : undefined) ??
    null;
  const run = createRunDiagnostic({ kind: "work_orders", diff });
  run.latestIdentity = latestWorkOrder == null ? null : buildIdentityContext(latestWorkOrder);

  const result: WorkOrderDualWriteResult = {
    ok: false,
    noop: false,
    diff,
    mirroredWorkOrders: 0,
    mirroredServiceRows: 0,
    removedWorkOrders: 0,
    removedServiceRows: 0,
    skipped: [],
    mismatches: [],
    error: null,
    durationMs: 0,
  };

  const finish = (): WorkOrderDualWriteResult => {
    stopDual();
    result.durationMs =
      (typeof performance !== "undefined" ? performance.now() : Date.now()) -
      startedAt;
    finalizeRun(run, result);
    return result;
  };

  // A no-op only when nothing changed AND nothing was removed — removals must
  // still propagate even when no row was created / updated (e.g. a pure delete).
  if (
    changedIds.length === 0 &&
    removedWorkOrderIds.length === 0 &&
    removedServiceRowIds.length === 0
  ) {
    state.noops += 1;
    result.ok = true;
    result.noop = true;
    run.noOpWorkOrderCount = next.length;
    run.noOpWorkOrderLegacyIds = next.slice(0, MAX_NOOP_IDS).map((order) => order.id);
    return finish();
  }

  if (!isSupabaseConfigured || !supabase) {
    state.failures += 1;
    state.lastError = "Supabase is not configured.";
    result.error = "Supabase is not configured.";
    run.supabaseSession = emptySessionDiagnostics(result.error);
    recordIssue(
      run,
      createIssueRecord({
        run,
        kind: "failure",
        tableName: null,
        order: latestWorkOrder,
        companyLegacyId: latestWorkOrder?.companyId ?? null,
        reason: result.error,
        companyMappingFound: null,
      }),
    );
    return finish();
  }

  run.supabaseSession = await readSupabaseSessionDiagnostics();
  const stopWrite = perf.start("workOrders.write.supabase");
  try {
    const companyMap = await loadCompanyUuidMap();
    const customerNames = buildCustomerNameMap();
    const woRows: WorkOrderUpsertRow[] = [];
    const serviceRows: WorkOrderServiceRowUpsertRow[] = [];
    const sourceById = new Map<string, WorkOrder>();
    for (const id of changedIds) {
      const order = nextById.get(id);
      if (!order) continue;
      const uuid = companyMap.get(order.companyId) ?? null;
      if (!uuid) {
        const reason = `No Supabase company for legacy_id "${order.companyId}". Migrate companies first.`;
        result.skipped.push({ id, reason });
        state.skipped += 1;
        recordIssue(
          run,
          createIssueRecord({
            run,
            kind: "skip",
            tableName: "work_orders",
            order,
            companyLegacyId: order.companyId,
            reason,
            companyMappingFound: false,
          }),
        );
        continue;
      }
      woRows.push(
        toWorkOrderUpsertRow(order, uuid, customerNames.get(order.customerId) ?? ""),
      );
      for (const row of order.serviceRows ?? []) {
        serviceRows.push(toServiceRowUpsertRow(row, order, uuid));
      }
      sourceById.set(id, order);
    }

    run.parentRowLegacyIdsAttempted = woRows.map((row) => row.legacy_id);
    run.parentRowsAttempted = woRows.length;
    run.serviceRowLegacyIdsAttempted = serviceRows.map((row) => row.legacy_id);
    run.serviceRowsAttempted = serviceRows.length;

    if (woRows.length > 0) {
      const { error: woError } = await supabase
        .from("work_orders")
        .upsert(woRows, { onConflict: "legacy_id" });
      if (woError) {
        state.failures += 1;
        state.lastError = woError.message;
        result.error = `Supabase work_orders upsert failed: ${woError.message}`;
        recordIssue(
          run,
          createIssueRecord({
            run,
            kind: "failure",
            tableName: "work_orders",
            order: latestWorkOrder,
            companyLegacyId: latestWorkOrder?.companyId ?? null,
            reason: result.error,
            supabaseError: woError,
            companyMappingFound: latestWorkOrder == null ? null : companyMap.has(latestWorkOrder.companyId),
          }),
        );
        stopWrite();
        return finish();
      }
      result.mirroredWorkOrders = woRows.length;
      state.parentsMirrored += woRows.length;
    }

    if (serviceRows.length > 0) {
      const { error: rowError } = await supabase
        .from("work_order_service_rows")
        .upsert(serviceRows, { onConflict: "legacy_id" });
      if (rowError) {
        state.failures += 1;
        state.lastError = rowError.message;
        result.error = `Supabase work_order_service_rows upsert failed: ${rowError.message}`;
        recordIssue(
          run,
          createIssueRecord({
            run,
            kind: "failure",
            tableName: "work_order_service_rows",
            order: latestWorkOrder,
            companyLegacyId: latestWorkOrder?.companyId ?? null,
            reason: result.error,
            supabaseError: rowError,
            companyMappingFound: latestWorkOrder == null ? null : companyMap.has(latestWorkOrder.companyId),
          }),
        );
        stopWrite();
        return finish();
      }
      result.mirroredServiceRows = serviceRows.length;
      state.serviceRowsMirrored += serviceRows.length;
    }

    // WO-5.6: propagate removals via soft delete so no stale parent / ghost
    // service row survives in Supabase. Parents first, then service rows.
    if (removedWorkOrderIds.length > 0) {
      const removeErr = await softDeleteByLegacyIds("work_orders", removedWorkOrderIds);
      if (removeErr) {
        state.failures += 1;
        state.lastError = removeErr;
        result.error = `Supabase work_orders soft-delete failed: ${removeErr}`;
        const removedOrder = removedWorkOrderIds[0] != null ? prevById.get(removedWorkOrderIds[0]) ?? null : null;
        recordIssue(
          run,
          createIssueRecord({
            run,
            kind: "failure",
            tableName: "work_orders",
            order: removedOrder,
            companyLegacyId: removedOrder?.companyId ?? null,
            reason: result.error,
            supabaseError: { message: removeErr },
            companyMappingFound: removedOrder == null ? null : companyMap.has(removedOrder.companyId),
          }),
        );
        stopWrite();
        return finish();
      }
      result.removedWorkOrders = removedWorkOrderIds.length;
      state.parentsRemoved += removedWorkOrderIds.length;
    }

    if (removedServiceRowIds.length > 0) {
      const removeErr = await softDeleteByLegacyIds(
        "work_order_service_rows",
        removedServiceRowIds,
      );
      if (removeErr) {
        state.failures += 1;
        state.lastError = removeErr;
        result.error = `Supabase work_order_service_rows soft-delete failed: ${removeErr}`;
        recordIssue(
          run,
          createIssueRecord({
            run,
            kind: "failure",
            tableName: "work_order_service_rows",
            order: latestWorkOrder,
            companyLegacyId: latestWorkOrder?.companyId ?? null,
            reason: result.error,
            supabaseError: { message: removeErr },
            companyMappingFound: latestWorkOrder == null ? null : companyMap.has(latestWorkOrder.companyId),
          }),
        );
        stopWrite();
        return finish();
      }
      result.removedServiceRows = removedServiceRowIds.length;
      state.serviceRowsRemoved += removedServiceRowIds.length;
    }

    stopWrite();

    // Post-write parity validation — surfaces drift, never blocks anything.
    result.mismatches = await validateMirroredWorkOrders(woRows, sourceById);
    result.ok =
      result.error === null &&
      result.skipped.length === 0 &&
      result.mismatches.length === 0;
    return finish();
  } catch (err) {
    stopWrite();
    state.failures += 1;
    state.lastError = err instanceof Error ? err.message : "Unknown mirror error.";
    result.error = state.lastError;
    recordIssue(
      run,
      createIssueRecord({
        run,
        kind: "failure",
        tableName: null,
        order: latestWorkOrder,
        companyLegacyId: latestWorkOrder?.companyId ?? null,
        reason: result.error,
        supabaseError: err,
        companyMappingFound: latestWorkOrder == null ? null : null,
      }),
    );
    return finish();
  }
}

/**
 * Mirrors an occurrence-exception write (prev → next) into Supabase. The
 * exception store is SEPARATE from work orders and carries no companyId of its
 * own, so — exactly like the migration tool — each exception is scoped via its
 * parent service row's work order (`parentServiceRowId` → owning work order →
 * `companyId`). Exceptions whose parent row is not found, or whose company has
 * no Supabase mapping, are skipped + surfaced (never silently dropped).
 *
 * Always call fire-and-forget AFTER the authoritative localStorage write.
 */
export async function mirrorWorkOrderExceptionWrites(
  prev: BookingOccurrenceException[],
  next: BookingOccurrenceException[],
): Promise<WorkOrderExceptionDualWriteResult> {
  const stopDual = perf.start("workOrders.write.dual");
  const startedAt =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  state.runs += 1;
  state.lastRunAt = new Date().toISOString();

  const diff = diffExceptions(prev, next);
  state.removedDetected += diff.removed.length;
  // WO-5.6: exceptions present before but gone after must be soft-deleted, or a
  // stale overlay would keep cancelling / rescheduling future occurrences.
  const removedExceptionIds = diff.removed;
  const changedIds = [...diff.created, ...diff.updated];
  const currentOrders = getWorkOrders();
  const nextById = new Map(next.map((e) => [e.id, e]));
  const firstChangedException = changedIds[0] != null ? nextById.get(changedIds[0]) ?? null : null;
  const latestParentOrder = firstChangedException == null
    ? null
    : findWorkOrderByServiceRowId(currentOrders, firstChangedException.parentServiceRowId);
  const run = createRunDiagnostic({ kind: "occurrence_exceptions", diff });
  run.latestIdentity = latestParentOrder == null ? null : buildIdentityContext(latestParentOrder);
  run.occurrenceExceptionIdsAttempted = changedIds;
  run.occurrenceExceptionsAttempted = changedIds.length;

  const result: WorkOrderExceptionDualWriteResult = {
    ok: false,
    noop: false,
    diff,
    mirroredExceptions: 0,
    removedExceptions: 0,
    skipped: [],
    error: null,
    durationMs: 0,
  };

  const finish = (): WorkOrderExceptionDualWriteResult => {
    stopDual();
    result.durationMs =
      (typeof performance !== "undefined" ? performance.now() : Date.now()) -
      startedAt;
    finalizeRun(run, result);
    return result;
  };

  if (changedIds.length === 0 && removedExceptionIds.length === 0) {
    state.noops += 1;
    result.ok = true;
    result.noop = true;
    return finish();
  }

  if (!isSupabaseConfigured || !supabase) {
    state.failures += 1;
    state.lastError = "Supabase is not configured.";
    result.error = "Supabase is not configured.";
    run.supabaseSession = emptySessionDiagnostics(result.error);
    recordIssue(
      run,
      createIssueRecord({
        run,
        kind: "failure",
        tableName: "work_order_occurrence_exceptions",
        order: latestParentOrder,
        companyLegacyId: latestParentOrder?.companyId ?? null,
        reason: result.error,
        companyMappingFound: null,
      }),
    );
    return finish();
  }

  run.supabaseSession = await readSupabaseSessionDiagnostics();
  const stopWrite = perf.start("workOrders.write.supabase");
  try {
    const companyMap = await loadCompanyUuidMap();
    // Resolve each service row → its work order's legacy company id, so an
    // exception (which carries no companyId) can be scoped via its parent row.
    const rowCompanyLegacy = new Map<string, string>();
    const rowParentOrder = new Map<string, WorkOrder>();
    for (const w of currentOrders) {
      for (const r of w.serviceRows ?? []) {
        rowCompanyLegacy.set(r.id, w.companyId);
        rowParentOrder.set(r.id, w);
      }
    }
    const rows: WorkOrderExceptionUpsertRow[] = [];
    for (const id of changedIds) {
      const exception = nextById.get(id);
      if (!exception) continue;
      const companyLegacy = rowCompanyLegacy.get(exception.parentServiceRowId);
      if (!companyLegacy) {
        const reason = `No parent work order found for service row "${exception.parentServiceRowId}".`;
        result.skipped.push({ id, reason });
        state.skipped += 1;
        recordIssue(
          run,
          createIssueRecord({
            run,
            kind: "skip",
            tableName: "work_order_occurrence_exceptions",
            order: null,
            companyLegacyId: null,
            reason,
            companyMappingFound: null,
          }),
        );
        continue;
      }
      const uuid = companyMap.get(companyLegacy) ?? null;
      if (!uuid) {
        const reason = `No Supabase company for legacy_id "${companyLegacy}". Migrate companies first.`;
        result.skipped.push({ id, reason });
        state.skipped += 1;
        recordIssue(
          run,
          createIssueRecord({
            run,
            kind: "skip",
            tableName: "work_order_occurrence_exceptions",
            order: rowParentOrder.get(exception.parentServiceRowId) ?? null,
            companyLegacyId: companyLegacy,
            reason,
            companyMappingFound: false,
          }),
        );
        continue;
      }
      rows.push(toExceptionUpsertRow(exception, companyLegacy, uuid));
    }

    if (rows.length > 0) {
      const { error } = await supabase
        .from("work_order_occurrence_exceptions")
        .upsert(rows, { onConflict: "legacy_id" });
      if (error) {
        state.failures += 1;
        state.lastError = error.message;
        result.error = `Supabase work_order_occurrence_exceptions upsert failed: ${error.message}`;
        recordIssue(
          run,
          createIssueRecord({
            run,
            kind: "failure",
            tableName: "work_order_occurrence_exceptions",
            order: latestParentOrder,
            companyLegacyId: latestParentOrder?.companyId ?? null,
            reason: result.error,
            supabaseError: error,
            companyMappingFound: latestParentOrder == null ? null : companyMap.has(latestParentOrder.companyId),
          }),
        );
        stopWrite();
        return finish();
      }
      result.mirroredExceptions = rows.length;
      state.exceptionsMirrored += rows.length;
    }

    // WO-5.6: propagate exception removals via soft delete.
    if (removedExceptionIds.length > 0) {
      const removeErr = await softDeleteByLegacyIds(
        "work_order_occurrence_exceptions",
        removedExceptionIds,
      );
      if (removeErr) {
        state.failures += 1;
        state.lastError = removeErr;
        result.error = `Supabase work_order_occurrence_exceptions soft-delete failed: ${removeErr}`;
        recordIssue(
          run,
          createIssueRecord({
            run,
            kind: "failure",
            tableName: "work_order_occurrence_exceptions",
            order: latestParentOrder,
            companyLegacyId: latestParentOrder?.companyId ?? null,
            reason: result.error,
            supabaseError: { message: removeErr },
            companyMappingFound: latestParentOrder == null ? null : companyMap.has(latestParentOrder.companyId),
          }),
        );
        stopWrite();
        return finish();
      }
      result.removedExceptions = removedExceptionIds.length;
      state.exceptionsRemoved += removedExceptionIds.length;
    }

    stopWrite();
    result.ok = result.error === null && result.skipped.length === 0;
    return finish();
  } catch (err) {
    stopWrite();
    state.failures += 1;
    state.lastError = err instanceof Error ? err.message : "Unknown mirror error.";
    result.error = state.lastError;
    recordIssue(
      run,
      createIssueRecord({
        run,
        kind: "failure",
        tableName: "work_order_occurrence_exceptions",
        order: latestParentOrder,
        companyLegacyId: latestParentOrder?.companyId ?? null,
        reason: result.error,
        supabaseError: err,
        companyMappingFound: latestParentOrder == null ? null : null,
      }),
    );
    return finish();
  }
}

// Expose console handles in development for manual inspection. Merges with the
// handles attached in the other data modules.
if (import.meta.env.DEV === true && typeof window !== "undefined") {
  const w = window as unknown as { __cleanopsData?: Record<string, unknown> };
  w.__cleanopsData = {
    ...(w.__cleanopsData ?? {}),
    mirrorWorkOrderWrites,
    mirrorWorkOrderExceptionWrites,
    getWorkOrderDualWriteState,
    resetWorkOrderDualWriteState,
  };
}
