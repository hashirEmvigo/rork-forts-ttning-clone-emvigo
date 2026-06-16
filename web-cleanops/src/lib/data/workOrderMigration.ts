/**
 * Work Order migration + shadow-read tooling (P5C · WO-1).
 *
 * The Work Orders analogue of {@link import("./customerMigration")}. Two
 * development/admin utilities, both READ-ONLY against the running app's
 * localStorage source of truth:
 *
 *   1. `migrateWorkOrders()` — copies localStorage work orders INTO the three
 *      Supabase tables (work_orders + work_order_service_rows +
 *      work_order_occurrence_exceptions). Idempotent (upsert on `legacy_id`),
 *      repeatable, with a `dryRun` mode that computes the plan + report WITHOUT
 *      writing. Variations stay embedded in each service row's `data` jsonb.
 *
 *   2. `shadowReadWorkOrders()` — diffs localStorage vs Supabase for a company
 *      (work-order count / id set / summary fields / service-row totals /
 *      exception totals / a detail sample), producing a structured mismatch
 *      report. Differences are surfaced, never silently ignored.
 *
 * Neither utility touches the UI, the Schedule resolver, or write behaviour.
 * localStorage stays the source of truth for the whole of WO-1; Supabase is the
 * shadow copy these tools populate and verify.
 */
import { getWorkOrders, getCustomers, getBookingOccurrenceExceptions } from "@/lib/store";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import type {
  WorkOrder,
  WorkOrderServiceRow,
  BookingOccurrenceException,
} from "@/types";
import { localDataLayer } from "./localStorageAdapters";
import { supabaseWorkOrderRepository } from "./supabaseWorkOrderRepository";
import { loadCompanyUuidMap } from "./customerMigration";

// ── Upsert row shapes ─────────────────────────────────────

/** A single upsert row written to (or planned for) `work_orders`. */
export interface WorkOrderUpsertRow {
  legacy_id: string;
  company_id: string | null;
  company_legacy_id: string;
  customer_legacy_id: string;
  customer_display_name: string;
  number: string;
  title: string | null;
  status: string;
  start_date: string | null;
  end_date: string | null;
  service_row_count: number;
  created_by: string | null;
  /** Soft-delete marker — always null on upsert (an upsert UNDELETES the row). */
  deleted_at: string | null;
  data: WorkOrder;
}

/** A single upsert row written to (or planned for) `work_order_service_rows`. */
export interface WorkOrderServiceRowUpsertRow {
  legacy_id: string;
  company_id: string | null;
  company_legacy_id: string;
  work_order_legacy_id: string;
  service_name: string;
  article_number: string | null;
  status: string;
  archived: boolean;
  service_date: string | null;
  service_end_date: string | null;
  planned_start_time: string | null;
  planned_end_time: string | null;
  recurrence_interval: string;
  assigned_employee_ids: string[];
  unassigned_employee_slots: number;
  sort_order: number;
  variation_count: number;
  /** Soft-delete marker — always null on upsert (an upsert UNDELETES the row). */
  deleted_at: string | null;
  data: WorkOrderServiceRow;
}

/** A single upsert row for `work_order_occurrence_exceptions`. */
export interface WorkOrderExceptionUpsertRow {
  legacy_id: string;
  company_id: string | null;
  company_legacy_id: string;
  service_row_legacy_id: string;
  occurrence_key: string;
  occurrence_date: string;
  status: string;
  override_occurrence_date: string | null;
  override_start_time: string | null;
  override_end_time: string | null;
  /** Soft-delete marker — always null on upsert (an upsert UNDELETES the row). */
  deleted_at: string | null;
  data: BookingOccurrenceException;
}

/** Structured outcome of a work-order migration run (or dry-run). */
export interface WorkOrderMigrationReport {
  ok: boolean;
  dryRun: boolean;
  companyId: string | null;
  /** Work orders read from localStorage for the scope. */
  sourceCount: number;
  /** Work-order rows that would be / were upserted. */
  plannedWorkOrders: number;
  /** Service rows that would be / were upserted. */
  plannedServiceRows: number;
  /** Occurrence exceptions that would be / were upserted. */
  plannedExceptions: number;
  writtenWorkOrders: number;
  writtenServiceRows: number;
  writtenExceptions: number;
  /** Source work orders skipped because their company_id could not be resolved. */
  skipped: Array<{ id: string; reason: string }>;
  error?: string;
}

function scopeByCompany(orders: WorkOrder[], companyId: string | null | undefined): WorkOrder[] {
  if (companyId === undefined || companyId === null) return orders;
  return orders.filter((w) => w.companyId === companyId);
}

/** Builds a customerId → display name map once (avoids per-row lookup). */
function buildCustomerNameMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const c of getCustomers()) map.set(c.id, c.name);
  return map;
}

/** Maps a localStorage {@link WorkOrder} to a `work_orders` upsert row. */
export function toWorkOrderUpsertRow(
  order: WorkOrder,
  companyUuid: string | null,
  customerDisplayName: string,
): WorkOrderUpsertRow {
  return {
    legacy_id: order.id,
    company_id: companyUuid,
    company_legacy_id: order.companyId,
    customer_legacy_id: order.customerId,
    customer_display_name: customerDisplayName,
    number: order.number,
    title: order.title ?? null,
    status: order.status,
    start_date: order.startDate ?? null,
    end_date: order.endDate ?? null,
    service_row_count: order.serviceRows?.length ?? 0,
    created_by: order.createdBy ?? null,
    deleted_at: null,
    data: order,
  };
}

/** Maps a service row to a `work_order_service_rows` upsert row. */
export function toServiceRowUpsertRow(
  row: WorkOrderServiceRow,
  order: WorkOrder,
  companyUuid: string | null,
): WorkOrderServiceRowUpsertRow {
  return {
    legacy_id: row.id,
    company_id: companyUuid,
    company_legacy_id: order.companyId,
    work_order_legacy_id: order.id,
    service_name: row.serviceName,
    article_number: row.articleNumber ?? null,
    status: row.status,
    archived: Boolean(row.archived),
    service_date: row.serviceDate ?? null,
    service_end_date: row.serviceEndDate ?? null,
    planned_start_time: row.plannedStartTime ?? null,
    planned_end_time: row.plannedEndTime ?? null,
    recurrence_interval: row.recurrenceInterval ?? "one_time",
    assigned_employee_ids: row.assignedEmployeeIds ?? [],
    unassigned_employee_slots: row.unassignedEmployeeSlots ?? 0,
    sort_order: row.sortOrder,
    variation_count: row.variations?.length ?? 0,
    deleted_at: null,
    data: row,
  };
}

/** Maps an exception to a `work_order_occurrence_exceptions` upsert row. */
export function toExceptionUpsertRow(
  exception: BookingOccurrenceException,
  companyLegacyId: string,
  companyUuid: string | null,
): WorkOrderExceptionUpsertRow {
  return {
    legacy_id: exception.id,
    company_id: companyUuid,
    company_legacy_id: companyLegacyId,
    service_row_legacy_id: exception.parentServiceRowId,
    occurrence_key: exception.occurrenceKey,
    occurrence_date: exception.occurrenceDate,
    status: exception.status,
    override_occurrence_date: exception.overrideOccurrenceDate ?? null,
    override_start_time: exception.overrideStartTime ?? null,
    override_end_time: exception.overrideEndTime ?? null,
    deleted_at: null,
    data: exception,
  };
}

/**
 * Migrates localStorage work orders (parent + service rows + the SEPARATE
 * occurrence-exception store) into Supabase.
 *
 * @param options.companyId Restrict to a single app-facing company id.
 * @param options.dryRun    When true, compute the plan + report but write nothing.
 */
export async function migrateWorkOrders(options?: {
  companyId?: string | null;
  dryRun?: boolean;
}): Promise<WorkOrderMigrationReport> {
  const companyId = options?.companyId ?? null;
  const dryRun = options?.dryRun ?? false;

  const source = scopeByCompany(getWorkOrders(), companyId);
  const report: WorkOrderMigrationReport = {
    ok: false,
    dryRun,
    companyId,
    sourceCount: source.length,
    plannedWorkOrders: 0,
    plannedServiceRows: 0,
    plannedExceptions: 0,
    writtenWorkOrders: 0,
    writtenServiceRows: 0,
    writtenExceptions: 0,
    skipped: [],
  };

  if (!isSupabaseConfigured || !supabase) {
    report.error = "Supabase is not configured.";
    return report;
  }

  const companyMap = await loadCompanyUuidMap();
  const customerNames = buildCustomerNameMap();

  // Resolve each service row's company so exceptions (which carry no companyId)
  // can be scoped via their parent service row — mirrors the local adapter.
  const rowCompanyLegacy = new Map<string, string>();
  for (const w of source) {
    for (const r of w.serviceRows ?? []) rowCompanyLegacy.set(r.id, w.companyId);
  }

  const woRows: WorkOrderUpsertRow[] = [];
  const serviceRows: WorkOrderServiceRowUpsertRow[] = [];
  for (const order of source) {
    const uuid = companyMap.get(order.companyId) ?? null;
    if (!uuid) {
      report.skipped.push({
        id: order.id,
        reason: `No Supabase company found for legacy_id "${order.companyId}". Migrate companies first.`,
      });
      continue;
    }
    woRows.push(
      toWorkOrderUpsertRow(order, uuid, customerNames.get(order.customerId) ?? ""),
    );
    for (const row of order.serviceRows ?? []) {
      serviceRows.push(toServiceRowUpsertRow(row, order, uuid));
    }
  }

  // Exceptions: scope to migrated rows only (and to the company scope, via the
  // parent service row's company). Skip orphans whose parent row is out of scope.
  const exceptionRows: WorkOrderExceptionUpsertRow[] = [];
  for (const exception of getBookingOccurrenceExceptions()) {
    const companyLegacy = rowCompanyLegacy.get(exception.parentServiceRowId);
    if (!companyLegacy) continue; // parent not in scope → not migrated here
    const uuid = companyMap.get(companyLegacy) ?? null;
    if (!uuid) continue;
    exceptionRows.push(toExceptionUpsertRow(exception, companyLegacy, uuid));
  }

  report.plannedWorkOrders = woRows.length;
  report.plannedServiceRows = serviceRows.length;
  report.plannedExceptions = exceptionRows.length;

  if (dryRun) {
    report.ok = report.skipped.length === 0;
    return report;
  }

  try {
    report.writtenWorkOrders = await upsertChunked("work_orders", woRows);
    report.writtenServiceRows = await upsertChunked("work_order_service_rows", serviceRows);
    report.writtenExceptions = await upsertChunked(
      "work_order_occurrence_exceptions",
      exceptionRows,
    );
    report.ok = report.skipped.length === 0;
    return report;
  } catch (err) {
    report.error = err instanceof Error ? err.message : "Unknown migration error.";
    return report;
  }
}

/** Idempotent + repeatable chunked upsert on the unique `legacy_id`. */
async function upsertChunked<T extends object>(
  table: string,
  rows: ReadonlyArray<T>,
): Promise<number> {
  if (!supabase || rows.length === 0) return 0;
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await supabase.from(table).upsert(chunk, { onConflict: "legacy_id" });
    if (error) {
      throw new Error(`Upsert into ${table} failed at chunk ${i / CHUNK}: ${error.message}`);
    }
  }
  return rows.length;
}

// ── Shadow-read validation ────────────────────────────────

/** Structured outcome of a localStorage-vs-Supabase work-order comparison. */
export interface WorkOrderShadowReport {
  ok: boolean;
  companyId: string | null;
  localCount: number;
  supabaseCount: number;
  countMatch: boolean;
  idsMatch: boolean;
  summaryMatch: boolean;
  serviceRowsMatch: boolean;
  exceptionsMatch: boolean;
  detailMatch: boolean;
  /** Ids present locally but missing in Supabase (not yet migrated). */
  missingInSupabase: string[];
  /** Ids present in Supabase but absent locally (stale/extra). */
  extraInSupabase: string[];
  localServiceRowTotal: number;
  supabaseServiceRowTotal: number;
  localExceptionTotal: number;
  supabaseExceptionTotal: number;
  /** Human-readable mismatch notes — never empty when ok is false. */
  notes: string[];
}

function idSetDiff(a: string[], b: string[]): { onlyA: string[]; onlyB: string[] } {
  const setB = new Set(b);
  const setA = new Set(a);
  return {
    onlyA: a.filter((id) => !setB.has(id)),
    onlyB: b.filter((id) => !setA.has(id)),
  };
}

/**
 * Compares localStorage work orders against the Supabase shadow copy for a
 * scope. Read-only on both sides; mutates nothing. Validates the parent rows
 * (count / id set / summary fields), the aggregate service-row totals, the
 * separate exception-store totals, and a detail sample. Use this to confirm
 * "0 critical mismatches" before any future UI cut-over.
 */
export async function shadowReadWorkOrders(
  companyId?: string | null,
): Promise<WorkOrderShadowReport> {
  // Label-only normalisation. The ADAPTER scope stays `companyId` (undefined for
  // the all-companies case): the local adapter filters on undefined → all,
  // whereas the Supabase repository treats null/undefined the same way. We keep
  // `companyId` for the queries and only label with `scope`.
  const scope = companyId ?? null;
  const queryScope = companyId ?? undefined;
  const notes: string[] = [];

  const local = await localDataLayer.workOrders.listSummaries({ companyId: queryScope });

  const report: WorkOrderShadowReport = {
    ok: false,
    companyId: scope,
    localCount: local.total,
    supabaseCount: 0,
    countMatch: false,
    idsMatch: false,
    summaryMatch: false,
    serviceRowsMatch: false,
    exceptionsMatch: false,
    detailMatch: false,
    missingInSupabase: [],
    extraInSupabase: [],
    localServiceRowTotal: 0,
    supabaseServiceRowTotal: 0,
    localExceptionTotal: 0,
    supabaseExceptionTotal: 0,
    notes,
  };

  if (!isSupabaseConfigured || !supabase) {
    notes.push("Supabase is not configured.");
    return report;
  }

  let remote: Awaited<ReturnType<typeof supabaseWorkOrderRepository.listSummaries>>;
  try {
    remote = await supabaseWorkOrderRepository.listSummaries({ companyId: queryScope });
  } catch (err) {
    notes.push(err instanceof Error ? err.message : "Supabase read failed.");
    return report;
  }

  report.supabaseCount = remote.total;
  report.countMatch = local.total === remote.total;
  if (!report.countMatch) notes.push(`count mismatch: local ${local.total} vs supabase ${remote.total}`);

  const { onlyA, onlyB } = idSetDiff(
    local.items.map((w) => w.id),
    remote.items.map((w) => w.id),
  );
  report.missingInSupabase = onlyA;
  report.extraInSupabase = onlyB;
  report.idsMatch = onlyA.length === 0 && onlyB.length === 0;
  if (onlyA.length > 0) notes.push(`${onlyA.length} work order(s) not yet in Supabase`);
  if (onlyB.length > 0) notes.push(`${onlyB.length} extra work order(s) in Supabase`);

  // Summary field spot-check on the shared ids.
  const remoteById = new Map(remote.items.map((w) => [w.id, w] as const));
  let summaryMatch = true;
  for (const l of local.items) {
    const r = remoteById.get(l.id);
    if (!r) continue;
    if (
      r.number !== l.number ||
      r.status !== l.status ||
      r.customerId !== l.customerId ||
      r.serviceRowCount !== l.serviceRowCount ||
      r.customerDisplayName !== l.customerDisplayName
    ) {
      summaryMatch = false;
      notes.push(`summary mismatch for ${l.id}`);
      break;
    }
  }
  report.summaryMatch = summaryMatch;

  // Service-row aggregate parity across the shared work orders.
  let serviceRowsMatch = true;
  for (const l of local.items) {
    if (!remoteById.has(l.id)) continue;
    try {
      const [localRows, remoteRows] = await Promise.all([
        localDataLayer.workOrders.listServiceRows(l.id, {
          companyId: queryScope,
          includeArchived: true,
        }),
        supabaseWorkOrderRepository.listServiceRows(l.id, {
          companyId: queryScope,
          includeArchived: true,
        }),
      ]);
      report.localServiceRowTotal += localRows.total;
      report.supabaseServiceRowTotal += remoteRows.total;
      if (localRows.total !== remoteRows.total) {
        serviceRowsMatch = false;
        notes.push(`service-row count mismatch on ${l.id}`);
      } else {
        const rd = idSetDiff(
          localRows.items.map((r) => r.id),
          remoteRows.items.map((r) => r.id),
        );
        if (rd.onlyA.length > 0 || rd.onlyB.length > 0) {
          serviceRowsMatch = false;
          notes.push(`service-row id mismatch on ${l.id}`);
        }
      }
    } catch (err) {
      serviceRowsMatch = false;
      notes.push(err instanceof Error ? err.message : `service-row read failed on ${l.id}`);
    }
  }
  report.serviceRowsMatch = serviceRowsMatch;

  // Exception parity (separate store).
  try {
    const [localExc, remoteExc] = await Promise.all([
      localDataLayer.workOrders.listOccurrenceExceptions({ companyId: queryScope }),
      supabaseWorkOrderRepository.listOccurrenceExceptions({ companyId: queryScope }),
    ]);
    report.localExceptionTotal = localExc.total;
    report.supabaseExceptionTotal = remoteExc.total;
    const ed = idSetDiff(
      localExc.items.map((e) => e.occurrenceKey),
      remoteExc.items.map((e) => e.occurrenceKey),
    );
    report.exceptionsMatch =
      localExc.total === remoteExc.total && ed.onlyA.length === 0 && ed.onlyB.length === 0;
    if (!report.exceptionsMatch) notes.push("exception count / key set mismatch");
  } catch (err) {
    notes.push(err instanceof Error ? err.message : "exception read failed");
  }

  // Detail parity on a single sample id present in both.
  let detailMatch = true;
  const sample = local.items.find((l) => remoteById.has(l.id));
  if (sample) {
    try {
      const [localDetail, remoteDetail] = await Promise.all([
        localDataLayer.workOrders.getDetail(sample.id, { companyId: queryScope }),
        supabaseWorkOrderRepository.getDetail(sample.id, { companyId: queryScope }),
      ]);
      detailMatch =
        Boolean(remoteDetail) &&
        remoteDetail?.id === localDetail?.id &&
        remoteDetail?.number === localDetail?.number &&
        (remoteDetail?.serviceRows?.length ?? 0) === (localDetail?.serviceRows?.length ?? 0);
      if (!detailMatch) notes.push(`detail mismatch for ${sample.id}`);
    } catch (err) {
      detailMatch = false;
      notes.push(err instanceof Error ? err.message : "detail read failed");
    }
  }
  report.detailMatch = detailMatch;

  report.ok =
    report.countMatch &&
    report.idsMatch &&
    report.summaryMatch &&
    report.serviceRowsMatch &&
    report.exceptionsMatch &&
    report.detailMatch;
  return report;
}

// ── Detail shadow-read validation (P5E · WO-3) ────────────

/** Structured outcome of a single work-order DETAIL localStorage-vs-Supabase comparison. */
export interface WorkOrderDetailShadowReport {
  ok: boolean;
  id: string;
  companyId: string | null;
  localFound: boolean;
  supabaseFound: boolean;
  /** Scalar/structural fields that matched. */
  matchedFields: string[];
  /** Scalar/structural fields that diverged. */
  mismatchedFields: string[];
  /** Local vs Supabase service-row counts (drift-revealing). */
  localServiceRowCount: number;
  supabaseServiceRowCount: number;
  /** Service-row ids present on one side only. */
  serviceRowIdsMatch: boolean;
  /** Local vs Supabase embedded-variation totals. */
  localVariationCount: number;
  supabaseVariationCount: number;
  /** Human-readable mismatch notes — never empty when ok is false. */
  notes: string[];
}

/** Counts embedded variations across a work order's service rows. */
function countVariations(order: WorkOrder | null): number {
  if (!order) return 0;
  return (order.serviceRows ?? []).reduce(
    (sum, row) => sum + (row.variations?.length ?? 0),
    0,
  );
}

/** Stable, comparison-friendly stringification of a scalar/array detail field. */
function normaliseWoField(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return JSON.stringify(value);
  return String(value);
}

/** Scalar work-order detail fields the page header / overview render. */
const WO_DETAIL_FIELDS: ReadonlyArray<keyof WorkOrder> = [
  "number",
  "title",
  "status",
  "customerId",
  "companyId",
  "startDate",
  "endDate",
];

/**
 * Compares one work order's localStorage detail against its Supabase shadow copy
 * for the fields WorkOrderDetails renders (P5E · WO-3). Read-only on both sides;
 * mutates nothing. Validates the scalar header/overview fields, the nested
 * service-row count + id set, and the embedded-variation total. Surfaces
 * field-level drift, never silently ignored. Backs the WorkOrderDetails
 * detail-read switch.
 *
 * @param id        App-facing work-order id.
 * @param companyId Viewer scope (null / undefined = unscoped, e.g. super admin).
 */
export async function shadowReadWorkOrderDetail(
  id: string,
  companyId?: string | null,
): Promise<WorkOrderDetailShadowReport> {
  const scope = companyId ?? null;
  const queryScope = companyId ?? undefined;
  const notes: string[] = [];
  const matchedFields: string[] = [];
  const mismatchedFields: string[] = [];

  const report: WorkOrderDetailShadowReport = {
    ok: false,
    id,
    companyId: scope,
    localFound: false,
    supabaseFound: false,
    matchedFields,
    mismatchedFields,
    localServiceRowCount: 0,
    supabaseServiceRowCount: 0,
    serviceRowIdsMatch: false,
    localVariationCount: 0,
    supabaseVariationCount: 0,
    notes,
  };

  if (!isSupabaseConfigured || !supabase) {
    notes.push("Supabase is not configured.");
    return report;
  }

  let local: WorkOrder | null;
  let remote: WorkOrder | null;
  try {
    [local, remote] = await Promise.all([
      localDataLayer.workOrders.getDetail(id, { companyId: queryScope }),
      supabaseWorkOrderRepository.getDetail(id, { companyId: queryScope }),
    ]);
  } catch (err) {
    notes.push(err instanceof Error ? err.message : "detail read failed");
    return report;
  }

  report.localFound = Boolean(local);
  report.supabaseFound = Boolean(remote);
  if (!local) notes.push("work order not found in localStorage");
  if (!remote) notes.push("work order not found in Supabase");
  if (!local || !remote) return report;

  for (const field of WO_DETAIL_FIELDS) {
    if (normaliseWoField(local[field]) === normaliseWoField(remote[field])) {
      matchedFields.push(field);
    } else {
      mismatchedFields.push(field);
      notes.push(`field mismatch: ${field}`);
    }
  }

  const localRows = local.serviceRows ?? [];
  const remoteRows = remote.serviceRows ?? [];
  report.localServiceRowCount = localRows.length;
  report.supabaseServiceRowCount = remoteRows.length;
  if (localRows.length !== remoteRows.length) {
    mismatchedFields.push("serviceRows.length");
    notes.push("service-row count mismatch");
  } else {
    matchedFields.push("serviceRows.length");
  }

  const rowDiff = idSetDiff(
    localRows.map((r) => r.id),
    remoteRows.map((r) => r.id),
  );
  report.serviceRowIdsMatch = rowDiff.onlyA.length === 0 && rowDiff.onlyB.length === 0;
  if (!report.serviceRowIdsMatch) {
    mismatchedFields.push("serviceRows.ids");
    notes.push("service-row id set mismatch");
  } else {
    matchedFields.push("serviceRows.ids");
  }

  report.localVariationCount = countVariations(local);
  report.supabaseVariationCount = countVariations(remote);
  if (report.localVariationCount !== report.supabaseVariationCount) {
    mismatchedFields.push("variations.count");
    notes.push("variation count mismatch");
  } else {
    matchedFields.push("variations.count");
  }

  report.ok = mismatchedFields.length === 0;
  return report;
}

// Expose console handles in development for manual migration + verification.
if (import.meta.env.DEV === true && typeof window !== "undefined") {
  const w = window as unknown as { __cleanopsData?: Record<string, unknown> };
  w.__cleanopsData = {
    ...(w.__cleanopsData ?? {}),
    migrateWorkOrders,
    shadowReadWorkOrders,
    shadowReadWorkOrderDetail,
  };
}
