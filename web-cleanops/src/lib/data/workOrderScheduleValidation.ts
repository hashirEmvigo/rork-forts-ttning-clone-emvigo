/**
 * WO-4 — Service Rows → Schedule dependency validation (P5F). VALIDATION-ONLY.
 *
 * The single most dangerous dependency in the Work Orders migration is
 * Service Rows → Schedule: the resolver ({@link resolveScheduleProgram}) reads
 * LIVE work-order service rows + their EMBEDDED variations + the SEPARATE
 * occurrence-exception store, and any drift in the Supabase representation would
 * silently drop / duplicate / mis-time occurrences on the board.
 *
 * This module proves the Supabase `work_orders` / `work_order_service_rows` /
 * `work_order_occurrence_exceptions` tables contain EVERYTHING needed to
 * reproduce the current resolver inputs, WITHOUT changing the live Schedule. It:
 *
 *   1. Deep service-row field parity (every schedule-critical column).
 *   2. Variation parity (embedded in the row's `data` jsonb — count / ids /
 *      effective dates / status / staffing+time changes).
 *   3. Occurrence-exception parity (separate store → its own table, with
 *      explicit company_id).
 *   4. Resolver-input coverage map (each resolver field → its data source).
 *   5. `buildScheduleInputFromSupabase()` — reconstructs a {@link ScheduleCoreInput}
 *      from Supabase (work orders + exceptions are migrated and lossless via
 *      `data` jsonb; customers / employees / postal cities are held constant from
 *      the local store, since those entities are migrated on their own tracks).
 *   6. `compareScheduleInterval()` — runs the resolver over the SAME interval from
 *      the local source and the Supabase-reconstructed source and diffs every
 *      occurrence (key / dates / times / customer / employees / status / change
 *      indicators).
 *
 * Read-only on both sides. Mutates nothing. The Schedule resolver, recurrence,
 * variation and exception logic are all untouched; localStorage stays
 * authoritative. This is the gate before any Work Order dual-write (WO-5).
 */
import {
  getWorkOrders,
  getBookingOccurrenceExceptions,
  getCustomers,
  getEmployees,
  getPostalCities,
} from "@/lib/store";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { getVariationStatus } from "@/types";
import { perf } from "@/lib/perf";
import type {
  WorkOrder,
  WorkOrderServiceRow,
  BookingOccurrenceException,
  RecurringVariation,
} from "@/types";
import {
  resolveScheduleProgram,
  type ScheduleCoreInput,
  type ScheduleEntry,
} from "@/lib/scheduleCore";
import { localDataLayer } from "./localStorageAdapters";
import { supabaseWorkOrderRepository, listFullWorkOrdersFromSupabase } from "./supabaseWorkOrderRepository";

// ── Shared helpers ────────────────────────────────────────

function idSetDiff(a: string[], b: string[]): { onlyA: string[]; onlyB: string[] } {
  const setB = new Set(b);
  const setA = new Set(a);
  return { onlyA: a.filter((id) => !setB.has(id)), onlyB: b.filter((id) => !setA.has(id)) };
}

function norm(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return JSON.stringify([...value].sort());
  return String(value);
}

/** A single parity dimension outcome (mirrors the WO-0 parity shape). */
export interface ScheduleParityCheck {
  dimension: string;
  ok: boolean;
  localCount: number;
  supabaseCount: number;
  /** Human-readable mismatch notes — never empty when ok is false. */
  notes: string[];
}

// ── Part 1 — Service-row field parity ─────────────────────

/** Schedule-critical service-row fields validated, in resolver-relevant order. */
const SERVICE_ROW_FIELDS: ReadonlyArray<keyof WorkOrderServiceRow> = [
  "status",
  "archived",
  "serviceDate",
  "serviceEndDate",
  "recurrenceInterval",
  "plannedStartTime",
  "plannedEndTime",
  "assignedEmployeeIds",
  "unassignedEmployeeSlots",
  "sortOrder",
];

/**
 * Deep service-row parity: for every work order in scope, compares each live +
 * archived service row's schedule-critical fields between the localStorage
 * detail and the Supabase detail (lossless `data` jsonb). Field-level, not just
 * counts.
 */
export async function validateServiceRowFieldParity(
  companyId?: string | null,
): Promise<ScheduleParityCheck> {
  const queryScope = companyId ?? undefined;
  const notes: string[] = [];
  let localTotal = 0;
  let supabaseTotal = 0;

  const local = await localDataLayer.workOrders.listSummaries({ companyId: queryScope });
  for (const wo of local.items) {
    const [localDetail, remoteDetail] = await Promise.all([
      localDataLayer.workOrders.getDetail(wo.id, { companyId: queryScope }),
      supabaseWorkOrderRepository.getDetail(wo.id, { companyId: queryScope }),
    ]);
    const localRows = localDetail?.serviceRows ?? [];
    const remoteRows = remoteDetail?.serviceRows ?? [];
    localTotal += localRows.length;
    supabaseTotal += remoteRows.length;

    const diff = idSetDiff(localRows.map((r) => r.id), remoteRows.map((r) => r.id));
    if (diff.onlyA.length > 0 || diff.onlyB.length > 0) {
      notes.push(`row id set mismatch on ${wo.id}`);
    }
    const remoteById = new Map(remoteRows.map((r) => [r.id, r]));
    for (const lr of localRows) {
      const rr = remoteById.get(lr.id);
      if (!rr) continue;
      for (const field of SERVICE_ROW_FIELDS) {
        if (norm(lr[field]) !== norm(rr[field])) {
          notes.push(`row ${lr.id}: ${String(field)} mismatch`);
        }
      }
    }
  }

  return {
    dimension: "serviceRows.fields",
    ok: notes.length === 0,
    localCount: localTotal,
    supabaseCount: supabaseTotal,
    notes,
  };
}

// ── Part 2 — Variation parity ─────────────────────────────

interface FlatVariation {
  id: string;
  serviceRowId: string;
  status: string;
  frequency: string;
  appliesFrom: string;
  appliesUntil: string;
  startTime: string;
  endTime: string;
  assignedEmployeeIds: string;
}

function flattenVariations(orders: WorkOrder[]): FlatVariation[] {
  const out: FlatVariation[] = [];
  for (const wo of orders) {
    for (const row of wo.serviceRows ?? []) {
      for (const v of (row.variations ?? []) as RecurringVariation[]) {
        out.push({
          id: v.id,
          serviceRowId: row.id,
          status: getVariationStatus(v),
          frequency: norm(v.frequency),
          appliesFrom: norm(v.appliesFrom),
          appliesUntil: norm(v.appliesUntil),
          startTime: norm(v.startTime),
          endTime: norm(v.endTime),
          assignedEmployeeIds: norm(v.assignedEmployeeIds),
        });
      }
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Variation parity. Variations stay EMBEDDED in the service-row `data` jsonb, so
 * this reconstructs the full work orders from Supabase and compares the flattened
 * variation set (count / ids / effective dates / status / time + staffing
 * changes) against the local source. No normalisation of variations occurs.
 */
export async function validateVariationParity(
  companyId?: string | null,
): Promise<ScheduleParityCheck> {
  const localOrders = scopeOrders(getWorkOrders(), companyId);
  const remoteOrders = await listFullWorkOrdersFromSupabase(companyId ?? undefined);

  const localVars = flattenVariations(localOrders);
  const remoteVars = flattenVariations(remoteOrders);
  const notes: string[] = [];

  const diff = idSetDiff(localVars.map((v) => v.id), remoteVars.map((v) => v.id));
  if (diff.onlyA.length > 0) notes.push(`${diff.onlyA.length} variation(s) missing in Supabase`);
  if (diff.onlyB.length > 0) notes.push(`${diff.onlyB.length} extra variation(s) in Supabase`);

  const remoteById = new Map(remoteVars.map((v) => [v.id, v]));
  for (const lv of localVars) {
    const rv = remoteById.get(lv.id);
    if (!rv) continue;
    (Object.keys(lv) as Array<keyof FlatVariation>).forEach((k) => {
      if (lv[k] !== rv[k]) notes.push(`variation ${lv.id}: ${k} mismatch`);
    });
  }

  return {
    dimension: "variations",
    ok: notes.length === 0,
    localCount: localVars.length,
    supabaseCount: remoteVars.length,
    notes,
  };
}

// ── Part 3 — Occurrence-exception parity ──────────────────

/**
 * Occurrence-exception parity. Exceptions are a SEPARATE store; they were
 * migrated into `work_order_occurrence_exceptions` WITH an explicit company_id
 * (resolved via their parent service row). Compares count / ids / workOrderId
 * (via parent row) / serviceRowId / occurrenceDate / status / company scope.
 */
export async function validateExceptionParity(
  companyId?: string | null,
): Promise<ScheduleParityCheck> {
  const queryScope = companyId ?? undefined;
  const notes: string[] = [];

  const [local, remote] = await Promise.all([
    localDataLayer.workOrders.listOccurrenceExceptions({ companyId: queryScope }),
    supabaseWorkOrderRepository.listOccurrenceExceptions({ companyId: queryScope }),
  ]);

  const diff = idSetDiff(
    local.items.map((e) => e.occurrenceKey),
    remote.items.map((e) => e.occurrenceKey),
  );
  if (diff.onlyA.length > 0) notes.push(`${diff.onlyA.length} exception(s) missing in Supabase`);
  if (diff.onlyB.length > 0) notes.push(`${diff.onlyB.length} extra exception(s) in Supabase`);

  const remoteByKey = new Map(remote.items.map((e) => [e.occurrenceKey, e]));
  for (const le of local.items) {
    const re = remoteByKey.get(le.occurrenceKey);
    if (!re) continue;
    if (
      le.serviceRowId !== re.serviceRowId ||
      le.status !== re.status ||
      le.occurrenceDate !== re.occurrenceDate ||
      norm(le.overrideOccurrenceDate) !== norm(re.overrideOccurrenceDate) ||
      norm(le.overrideStartTime) !== norm(re.overrideStartTime) ||
      norm(le.overrideEndTime) !== norm(re.overrideEndTime)
    ) {
      notes.push(`exception ${le.occurrenceKey} field mismatch`);
    }
  }

  return {
    dimension: "exceptions",
    ok: notes.length === 0,
    localCount: local.total,
    supabaseCount: remote.total,
    notes,
  };
}

// ── Part 4 — Resolver input coverage ──────────────────────

export type CoverageSource = "relational" | "data-jsonb" | "local-lookup" | "not-needed";

export interface ResolverFieldCoverage {
  field: string;
  table: "work_orders" | "work_order_service_rows" | "work_order_occurrence_exceptions" | "external";
  source: CoverageSource;
  note: string;
}

/**
 * Every field {@link resolveScheduleProgram} consumes, mapped to where it is
 * available after migration. `relational` = a flat indexed column; `data-jsonb`
 * = inside the lossless `data` payload; `local-lookup` = a separate entity not
 * part of the Work Orders migration (held constant). Any `missing` here would be
 * a hard blocker — there are none.
 */
export const RESOLVER_INPUT_COVERAGE: ReadonlyArray<ResolverFieldCoverage> = [
  { field: "WorkOrder.status (isLiveWorkOrder gate)", table: "work_orders", source: "relational", note: "status column + data jsonb." },
  { field: "WorkOrder.serviceRows[]", table: "work_order_service_rows", source: "relational", note: "Child table; also inside parent data jsonb." },
  { field: "ServiceRow.status / archived (isLiveSourceRow gate)", table: "work_order_service_rows", source: "relational", note: "status + archived columns." },
  { field: "ServiceRow.serviceDate / serviceEndDate", table: "work_order_service_rows", source: "relational", note: "service_date / service_end_date columns." },
  { field: "ServiceRow.recurrenceInterval", table: "work_order_service_rows", source: "relational", note: "recurrence_interval column." },
  { field: "ServiceRow.plannedStartTime / plannedEndTime", table: "work_order_service_rows", source: "relational", note: "planned_start_time / planned_end_time columns." },
  { field: "ServiceRow.assignedEmployeeIds / unassignedEmployeeSlots", table: "work_order_service_rows", source: "relational", note: "assigned_employee_ids[] / unassigned_employee_slots columns." },
  { field: "ServiceRow.employeeTimeOverrides / totalLabourMinutesOverride", table: "work_order_service_rows", source: "data-jsonb", note: "Resolved with the row at compute time; lossless in data jsonb." },
  { field: "ServiceRow.scheduleSource / schedulePreferences", table: "work_order_service_rows", source: "data-jsonb", note: "Lossless in data jsonb." },
  { field: "ServiceRow.variations[] (embedded)", table: "work_order_service_rows", source: "data-jsonb", note: "Embedded; resolved per occurrence — stays in data jsonb (WO-4 decision)." },
  { field: "BookingOccurrenceException (overlay)", table: "work_order_occurrence_exceptions", source: "relational", note: "Own table + lossless data jsonb; explicit company_id." },
  { field: "Customer.id / name / addresses", table: "external", source: "local-lookup", note: "Customer entity (migrated on its own track); held constant in the dry-run." },
  { field: "Employee.id / name", table: "external", source: "local-lookup", note: "Employee entity (separate track); name lookup only." },
  { field: "PostalCity[]", table: "external", source: "local-lookup", note: "Reference data (separate track); structured city label only." },
];

// ── Part 5 — Schedule reconstruction (Supabase → ScheduleCoreInput) ──

function scopeOrders(orders: WorkOrder[], companyId: string | null | undefined): WorkOrder[] {
  if (companyId === undefined || companyId === null) return orders;
  return orders.filter((w) => w.companyId === companyId);
}

interface FullExceptionRow {
  data: BookingOccurrenceException;
  company_legacy_id: string;
}

/**
 * Reconstructs the FULL {@link BookingOccurrenceException} list from Supabase by
 * reading the lossless `data` jsonb (the summary projection drops the staffing /
 * labour overrides the resolver needs). Company-scoped via `company_legacy_id`.
 */
export async function reconstructExceptionsFromSupabase(
  companyId?: string | null,
): Promise<BookingOccurrenceException[]> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error("Supabase is not configured.");
  }
  let query = supabase.from("work_order_occurrence_exceptions").select("data, company_legacy_id");
  if (companyId !== undefined && companyId !== null) {
    query = query.eq("company_legacy_id", companyId);
  }
  const { data, error } = await query;
  if (error) throw new Error(`[workOrders] Supabase exception reconstruct failed: ${error.message}`);
  const rows = (data ?? []) as unknown as FullExceptionRow[];
  return rows.map((r) => r.data).filter((e): e is BookingOccurrenceException => Boolean(e));
}

export interface ScheduleInputSource {
  /** Where the work orders + exceptions came from. */
  origin: "local" | "supabase";
  input: ScheduleCoreInput;
}

export interface ScheduleReconstructionOptions {
  companyId?: string | null;
  fromDate: string;
  toDate: string;
  includeCancelled?: boolean;
}

/**
 * Builds a resolver input whose work orders + exceptions come from Supabase,
 * with customers / employees / postal cities held CONSTANT from the local store
 * (those entities migrate on their own tracks). The local twin uses the same
 * lookups so any occurrence divergence is attributable purely to the migrated
 * work-order / service-row / exception representation. Does NOT touch the live
 * Schedule.
 */
export async function buildScheduleInputFromSupabase(
  options: ScheduleReconstructionOptions,
): Promise<ScheduleCoreInput> {
  const stop = perf.start("workOrders.schedule.reconstruct");
  try {
    const [workOrders, exceptions] = await Promise.all([
      listFullWorkOrdersFromSupabase(options.companyId ?? undefined),
      reconstructExceptionsFromSupabase(options.companyId),
    ]);
    return {
      workOrders,
      customers: getCustomers(),
      employees: getEmployees(),
      postalCities: getPostalCities(),
      exceptions,
      fromDate: options.fromDate,
      toDate: options.toDate,
      includeCancelled: options.includeCancelled ?? false,
    };
  } finally {
    stop();
  }
}

/** The local twin of {@link buildScheduleInputFromSupabase} — same lookups. */
export function buildScheduleInputFromLocal(
  options: ScheduleReconstructionOptions,
): ScheduleCoreInput {
  return {
    workOrders: scopeOrders(getWorkOrders(), options.companyId),
    customers: getCustomers(),
    employees: getEmployees(),
    postalCities: getPostalCities(),
    exceptions: getBookingOccurrenceExceptions(),
    fromDate: options.fromDate,
    toDate: options.toDate,
    includeCancelled: options.includeCancelled ?? false,
  };
}

// ── Part 6 — Interval comparison (dry run) ────────────────

/** A single diverging occurrence between the local and Supabase resolves. */
export interface OccurrenceDivergence {
  occurrenceKey: string;
  side: "local-only" | "supabase-only" | "field";
  fields?: string[];
}

export interface ScheduleIntervalComparison {
  ok: boolean;
  companyId: string | null;
  fromDate: string;
  toDate: string;
  localOccurrences: number;
  supabaseOccurrences: number;
  countMatch: boolean;
  keysMatch: boolean;
  /** Occurrence keys present on only one side. */
  missingInSupabase: string[];
  extraInSupabase: string[];
  /** Per-occurrence field divergences on the shared keys. */
  divergences: OccurrenceDivergence[];
  notes: string[];
}

/** The occurrence fields compared between the two resolves. */
const ENTRY_COMPARE_FIELDS: ReadonlyArray<keyof ScheduleEntry> = [
  "displayDate",
  "occurrenceDate",
  "startTime",
  "endTime",
  "customerId",
  "customerName",
  "assignedEmployeeIds",
  "status",
  "isVariation",
  "isRescheduled",
  "isTimeChanged",
];

function diffEntries(
  local: ScheduleEntry[],
  remote: ScheduleEntry[],
): { divergences: OccurrenceDivergence[]; missing: string[]; extra: string[] } {
  const localByKey = new Map(local.map((e) => [e.occurrenceKey, e]));
  const remoteByKey = new Map(remote.map((e) => [e.occurrenceKey, e]));
  const divergences: OccurrenceDivergence[] = [];

  const { onlyA: missing, onlyB: extra } = idSetDiff(
    [...localByKey.keys()],
    [...remoteByKey.keys()],
  );

  for (const [key, le] of localByKey) {
    const re = remoteByKey.get(key);
    if (!re) continue;
    const fields = ENTRY_COMPARE_FIELDS.filter((f) => norm(le[f]) !== norm(re[f])).map(String);
    if (fields.length > 0) divergences.push({ occurrenceKey: key, side: "field", fields });
  }
  return { divergences, missing, extra };
}

/**
 * Diffs two ALREADY-RESOLVED occurrence lists (local vs Supabase-input) into a
 * {@link ScheduleIntervalComparison}. Pure — performs no I/O and runs no
 * resolver. This is the shared comparison core used both by the WO-4 dry-run
 * ({@link compareScheduleInterval}, which fetches + resolves) and by the P6B
 * background shadow comparison in `useScheduleInputSource` (which already holds
 * both resolved lists, so it diffs without re-fetching).
 */
export function compareScheduleEntries(
  localEntries: ScheduleEntry[],
  supabaseEntries: ScheduleEntry[],
  meta: { companyId: string | null; fromDate: string; toDate: string },
): ScheduleIntervalComparison {
  const notes: string[] = [];
  const report: ScheduleIntervalComparison = {
    ok: false,
    companyId: meta.companyId,
    fromDate: meta.fromDate,
    toDate: meta.toDate,
    localOccurrences: localEntries.length,
    supabaseOccurrences: supabaseEntries.length,
    countMatch: localEntries.length === supabaseEntries.length,
    keysMatch: false,
    missingInSupabase: [],
    extraInSupabase: [],
    divergences: [],
    notes,
  };

  if (!report.countMatch) {
    notes.push(
      `occurrence count mismatch: local ${localEntries.length} vs supabase ${supabaseEntries.length}`,
    );
  }

  const { divergences, missing, extra } = diffEntries(localEntries, supabaseEntries);
  report.missingInSupabase = missing;
  report.extraInSupabase = extra;
  report.divergences = divergences;
  report.keysMatch = missing.length === 0 && extra.length === 0;
  if (missing.length > 0) notes.push(`${missing.length} occurrence(s) only in local resolve`);
  if (extra.length > 0) notes.push(`${extra.length} occurrence(s) only in supabase resolve`);
  if (divergences.length > 0) notes.push(`${divergences.length} occurrence(s) with field drift`);

  report.ok = report.countMatch && report.keysMatch && divergences.length === 0;
  return report;
}

/**
 * Runs {@link resolveScheduleProgram} over the SAME interval from the local
 * source and the Supabase-reconstructed source, then diffs every occurrence.
 * Read-only; the live Schedule is untouched. A clean result (counts + keys +
 * fields all match) is the evidence that the Supabase service-row / exception
 * representation reproduces the schedule exactly.
 */
export async function compareScheduleInterval(
  options: ScheduleReconstructionOptions,
): Promise<ScheduleIntervalComparison> {
  const scope = options.companyId ?? null;
  const empty: ScheduleIntervalComparison = {
    ok: false,
    companyId: scope,
    fromDate: options.fromDate,
    toDate: options.toDate,
    localOccurrences: 0,
    supabaseOccurrences: 0,
    countMatch: false,
    keysMatch: false,
    missingInSupabase: [],
    extraInSupabase: [],
    divergences: [],
    notes: [],
  };

  if (!isSupabaseConfigured || !supabase) {
    empty.notes.push("Supabase is not configured.");
    return empty;
  }

  const stop = perf.start("workOrders.schedule.dryRun");
  try {
    const localInput = buildScheduleInputFromLocal(options);
    const supabaseInput = await buildScheduleInputFromSupabase(options);

    const localEntries = resolveScheduleProgram(localInput);
    const supabaseEntries = resolveScheduleProgram(supabaseInput);

    return compareScheduleEntries(localEntries, supabaseEntries, {
      companyId: scope,
      fromDate: options.fromDate,
      toDate: options.toDate,
    });
  } catch (err) {
    empty.notes.push(err instanceof Error ? err.message : "schedule dry-run failed");
    return empty;
  } finally {
    stop();
  }
}

// ── Orchestrator ──────────────────────────────────────────

export interface WorkOrderScheduleValidationReport {
  ok: boolean;
  companyId: string | null;
  serviceRows: ScheduleParityCheck;
  variations: ScheduleParityCheck;
  exceptions: ScheduleParityCheck;
  interval: ScheduleIntervalComparison;
}

/**
 * Full WO-4 validation: the three parity dimensions plus an interval dry-run.
 * Read-only end-to-end. Use the result to gate WO-5 (dual write) — proceed only
 * when every dimension is `ok`.
 */
export async function validateWorkOrderScheduleDependency(
  options: ScheduleReconstructionOptions,
): Promise<WorkOrderScheduleValidationReport> {
  const [serviceRows, variations, exceptions, interval] = await Promise.all([
    validateServiceRowFieldParity(options.companyId),
    validateVariationParity(options.companyId),
    validateExceptionParity(options.companyId),
    compareScheduleInterval(options),
  ]);
  return {
    ok: serviceRows.ok && variations.ok && exceptions.ok && interval.ok,
    companyId: options.companyId ?? null,
    serviceRows,
    variations,
    exceptions,
    interval,
  };
}

// Expose console handles in development for manual WO-4 verification.
if (import.meta.env.DEV === true && typeof window !== "undefined") {
  const w = window as unknown as { __cleanopsData?: Record<string, unknown> };
  w.__cleanopsData = {
    ...(w.__cleanopsData ?? {}),
    validateServiceRowFieldParity,
    validateVariationParity,
    validateExceptionParity,
    buildScheduleInputFromSupabase,
    compareScheduleInterval,
    validateWorkOrderScheduleDependency,
  };
}
