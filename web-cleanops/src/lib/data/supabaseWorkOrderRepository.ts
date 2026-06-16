/**
 * Supabase-backed WorkOrderRepository (P5C · WO-1).
 *
 * The SECOND real server implementation of a query-layer contract (after
 * customers). It reads the `work_orders`, `work_order_service_rows` and
 * `work_order_occurrence_exceptions` tables created in migration 0008 and
 * returns the SAME DTOs the localStorage adapter returns, so a later wave can
 * swap this in behind the {@link WorkOrderRepository} interface with no UI
 * change.
 *
 * WO-1 scope — this is NOT wired into any page, and the Schedule resolver is
 * untouched. localStorage remains the source of truth. This repository exists so
 * the migration utility and the shadow-read validator can exercise the real
 * server path and prove parity (parent + service rows + the separate exception
 * store).
 *
 * Behaviour parity:
 *   To keep shadow-read diffs clean, scoping / search / pagination / ordering
 *   mirror the localStorage adapter exactly — scope by the app-facing
 *   `company_legacy_id`, apply the shared search-threshold policy, sort service
 *   rows by `sort_order`, then paginate. Server-side `ilike`/range pagination is
 *   a cut-over-time optimisation, intentionally deferred so WO-1 changes no
 *   observable behaviour.
 */
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { evaluateSearchThreshold } from "@/lib/searchThreshold";
import { perf } from "@/lib/perf";
import { makeId } from "@/lib/store";
import type {
  Customer,
  WorkOrder,
  BookingOccurrenceException,
  WorkOrderStatus,
  WorkOrderServiceRow,
} from "@/types";
import type { WorkOrderRepository } from "./contracts";
import { loadCompanyUuidMap } from "./customerMigration";
import type {
  WorkOrderListParams,
  ServiceRowListParams,
  OccurrenceExceptionListParams,
  CountParams,
  DetailParams,
} from "./contracts";
import type {
  ListResult,
  WorkOrderSummary,
  WorkOrderServiceRowSummary,
  WorkOrderExceptionSummary,
} from "./types";

/** Columns selected for a lightweight work-order summary list (no `data` jsonb). */
const WO_SUMMARY_COLUMNS =
  "legacy_id, company_legacy_id, customer_legacy_id, customer_display_name, number, title, status, start_date, end_date, service_row_count, deleted_at, updated_at";

/** Columns selected for a lightweight service-row summary (no `data` jsonb). */
const ROW_SUMMARY_COLUMNS =
  "legacy_id, company_legacy_id, work_order_legacy_id, service_name, article_number, status, archived, service_date, service_end_date, planned_start_time, planned_end_time, recurrence_interval, assigned_employee_ids, unassigned_employee_slots, sort_order, variation_count, deleted_at, updated_at";

/** Columns selected for a lightweight occurrence-exception summary. */
const EXCEPTION_SUMMARY_COLUMNS =
  "legacy_id, company_legacy_id, service_row_legacy_id, occurrence_key, occurrence_date, status, override_occurrence_date, override_start_time, override_end_time, deleted_at";

interface WorkOrderSummaryRow {
  legacy_id: string;
  company_legacy_id: string;
  customer_legacy_id: string;
  customer_display_name: string | null;
  number: string;
  title: string | null;
  status: string;
  start_date: string | null;
  end_date: string | null;
  service_row_count: number | null;
  deleted_at: string | null;
  updated_at: string;
}

interface ServiceRowSummaryRow {
  legacy_id: string;
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
  assigned_employee_ids: string[] | null;
  unassigned_employee_slots: number | null;
  sort_order: number | null;
  variation_count: number | null;
  deleted_at: string | null;
  updated_at: string;
}

interface ExceptionSummaryRow {
  legacy_id: string;
  company_legacy_id: string;
  service_row_legacy_id: string;
  occurrence_key: string;
  occurrence_date: string;
  status: string;
  override_occurrence_date: string | null;
  override_start_time: string | null;
  override_end_time: string | null;
  deleted_at: string | null;
}

/** Thrown when the repository is used but Supabase is not configured. */
class SupabaseNotConfiguredError extends Error {
  constructor() {
    super(
      "SupabaseWorkOrderRepository requires Supabase. Set EXPO_PUBLIC_SUPABASE_URL " +
        "and EXPO_PUBLIC_SUPABASE_ANON_KEY.",
    );
    this.name = "SupabaseNotConfiguredError";
  }
}

function woRowToSummary(row: WorkOrderSummaryRow): WorkOrderSummary {
  return {
    id: row.legacy_id,
    companyId: row.company_legacy_id,
    customerId: row.customer_legacy_id,
    customerDisplayName: row.customer_display_name ?? "",
    number: row.number,
    title: row.title ?? undefined,
    status: row.status as WorkOrderSummary["status"],
    startDate: row.start_date ?? undefined,
    endDate: row.end_date ?? undefined,
    serviceRowCount: row.service_row_count ?? 0,
    updatedAt: row.updated_at,
  };
}

function rowToServiceRowSummary(row: ServiceRowSummaryRow): WorkOrderServiceRowSummary {
  return {
    id: row.legacy_id,
    workOrderId: row.work_order_legacy_id,
    companyId: row.company_legacy_id,
    serviceName: row.service_name,
    status: row.status as WorkOrderServiceRowSummary["status"],
    archived: Boolean(row.archived),
    serviceDate: row.service_date ?? "",
    serviceEndDate: row.service_end_date,
    recurrenceInterval: row.recurrence_interval as WorkOrderServiceRowSummary["recurrenceInterval"],
    plannedStartTime: row.planned_start_time ?? undefined,
    plannedEndTime: row.planned_end_time ?? undefined,
    assignedEmployeeIds: row.assigned_employee_ids ?? [],
    unassignedEmployeeSlots: row.unassigned_employee_slots ?? 0,
    sortOrder: row.sort_order ?? 0,
    variationCount: row.variation_count ?? 0,
    updatedAt: row.updated_at,
  };
}

function rowToExceptionSummary(row: ExceptionSummaryRow): WorkOrderExceptionSummary {
  return {
    occurrenceKey: row.occurrence_key,
    serviceRowId: row.service_row_legacy_id,
    status: row.status as WorkOrderExceptionSummary["status"],
    occurrenceDate: row.occurrence_date,
    overrideOccurrenceDate: row.override_occurrence_date,
    overrideStartTime: row.override_start_time,
    overrideEndTime: row.override_end_time,
  };
}

function applyWoSearch(
  rows: WorkOrderSummaryRow[],
  rawSearch: string | undefined,
): WorkOrderSummaryRow[] {
  const { activeQuery, shouldSearch } = evaluateSearchThreshold(rawSearch ?? "");
  if (!shouldSearch) return rows;
  const needle = activeQuery.toLowerCase();
  return rows.filter((r) =>
    [r.number, r.title].some((f) => (f ?? "").toLowerCase().includes(needle)),
  );
}

function applyRowSearch(
  rows: ServiceRowSummaryRow[],
  rawSearch: string | undefined,
): ServiceRowSummaryRow[] {
  const { activeQuery, shouldSearch } = evaluateSearchThreshold(rawSearch ?? "");
  if (!shouldSearch) return rows;
  const needle = activeQuery.toLowerCase();
  return rows.filter((r) =>
    [r.service_name, r.article_number].some((f) => (f ?? "").toLowerCase().includes(needle)),
  );
}

function paginate<TSummary>(
  all: TSummary[],
  page?: number,
  pageSize?: number,
): ListResult<TSummary> {
  const total = all.length;
  if (!pageSize || pageSize <= 0) {
    return { items: all, total, page: 1, pageSize: total };
  }
  const safePage = page && page > 0 ? page : 1;
  const start = (safePage - 1) * pageSize;
  return { items: all.slice(start, start + pageSize), total, page: safePage, pageSize };
}

/**
 * Fetches company-scoped work-order summary rows. The optional company scope
 * mirrors the localStorage adapter: omit `companyId` for all (RLS-visible) rows,
 * or pass an app-facing id to filter on `company_legacy_id`.
 */
async function fetchScopedWorkOrders(
  params: WorkOrderListParams,
): Promise<WorkOrderSummaryRow[]> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  let query = supabase.from("work_orders").select(WO_SUMMARY_COLUMNS);
  if (params.companyId !== undefined && params.companyId !== null) {
    query = query.eq("company_legacy_id", params.companyId);
  }
  const { data, error } = await query;
  if (error) {
    throw new Error(`[workOrders] Supabase list failed: ${error.message}`);
  }
  let rows = (data ?? []) as unknown as WorkOrderSummaryRow[];
  // WO-5.6: soft-deleted (removed) work orders never appear in active queries.
  rows = rows.filter((r) => !r.deleted_at);
  if (params.statuses && params.statuses.length > 0) {
    const allow = new Set(params.statuses);
    rows = rows.filter((r) => allow.has(r.status));
  }
  return rows;
}

/** Shape of a full work-order row used for the WO-2 list read path. */
interface WorkOrderFullRow {
  data: WorkOrder;
  company_legacy_id: string;
  deleted_at: string | null;
}

interface WorkOrderCustomerScopeRow {
  data: Customer | null;
  company_legacy_id: string;
  deleted_at: string | null;
}

interface WorkOrderServiceScopeRow {
  company_legacy_id: string | null;
  deleted_at: string | null;
}

interface WorkOrderNumberRow {
  number: string | null;
}

interface WorkOrderInsertRow {
  legacy_id: string;
  company_id: string;
  company_legacy_id: string;
  customer_legacy_id: string;
  customer_display_name: string;
  number: string;
  title: string | null;
  status: WorkOrderStatus;
  start_date: string | null;
  end_date: string | null;
  service_row_count: number;
  created_by: string | null;
  deleted_at: string | null;
  data: WorkOrder;
}

export interface SupabaseWorkOrderCreateInput {
  /** Company-scoped legacy company id. Empty/null company work orders fail closed. */
  companyId: string;
  /** Customer-scoped legacy customer id. Must exist in the same company scope. */
  customerId: string;
  title?: string | null;
  status?: WorkOrderStatus;
  startDate?: string | null;
  endDate?: string | null;
  createdBy?: string | null;
  createdByName?: string | null;
}

export interface SupabaseWorkOrderServiceRowCreateInput {
  /** Company-scoped legacy company id. Empty/null company service-row writes fail closed. */
  companyId: string;
  /** Parent work-order legacy id. */
  workOrderId: string;
  /** Source catalog service id. Required for the first transactional add slice. */
  sourceServiceId?: string | null;
  serviceName: string;
  articleNumber?: string;
  categoryName?: string;
  serviceType?: string;
  quantity: number;
  unit?: string;
  price?: number;
  vat?: number;
  status: WorkOrderServiceRow["status"];
  notes?: string;
  serviceDate: string;
  serviceEndDate?: string | null;
  plannedStartTime?: string;
  plannedEndTime?: string;
  assignedEmployeeIds?: string[];
  unassignedEmployeeSlots?: number;
  recurrenceInterval?: WorkOrderServiceRow["recurrenceInterval"];
}

export interface SupabaseWorkOrderServiceRowAddResult {
  workOrder: WorkOrder;
  serviceRow: WorkOrderServiceRow;
  serviceRowCount: number;
  /** Number of actual generated booking jobs inserted into booking_ledger. */
  generatedBookingCount: number;
}

export type SupabaseWorkOrderServiceRowUpdatePatch = Partial<{
  serviceName: string;
  articleNumber: string | null;
  categoryName: string | null;
  serviceType: string | null;
  quantity: number;
  unit: string | null;
  price: number | null;
  vat: number | null;
  status: WorkOrderServiceRow["status"];
  notes: string | null;
  serviceDate: string;
  serviceEndDate: string | null;
  plannedStartTime: string | null;
  plannedEndTime: string | null;
  recurrenceInterval: WorkOrderServiceRow["recurrenceInterval"];
  archived: boolean;
}>;

export interface SupabaseWorkOrderServiceRowUpdateInput {
  /** Company-scoped legacy company id. Empty/null service-row writes fail closed. */
  companyId: string;
  /** Parent work-order legacy id. */
  workOrderId: string;
  /** Target service-row legacy id. */
  serviceRowId: string;
  /** Allowlisted field patch for service-row update slices. */
  patch: SupabaseWorkOrderServiceRowUpdatePatch;
}

export type SupabaseWorkOrderServiceRowArchiveInput = Omit<
  SupabaseWorkOrderServiceRowUpdateInput,
  "patch"
>;

export type SupabaseWorkOrderServiceRowRemoveInput = SupabaseWorkOrderServiceRowArchiveInput;

export interface SupabaseWorkOrderServiceRowUpdateResult {
  workOrder: WorkOrder;
  serviceRow: WorkOrderServiceRow;
  serviceRowCount: number;
}

export interface SupabaseWorkOrderServiceRowRemoveResult {
  workOrder: WorkOrder;
  serviceRow: WorkOrderServiceRow;
  serviceRowCount: number;
}

export interface SupabaseOneTimeServiceRowDateTimeInput {
  /** Company-scoped legacy company id. Empty/null service-row writes fail closed. */
  companyId: string;
  /** Parent work-order legacy id. */
  workOrderId: string;
  /** Target one-time service-row legacy id. */
  serviceRowId: string;
  /** Current recurrence interval from the loaded row; recurring values fail closed. */
  recurrenceInterval?: WorkOrderServiceRow["recurrenceInterval"] | "" | null;
  /** Required YYYY-MM-DD service date. */
  serviceDate: string;
  /** Optional planned start time in HH:MM. Empty/null clears the value. */
  plannedStartTime?: string | null;
  /** Optional planned end time in HH:MM. Empty/null clears the value. */
  plannedEndTime?: string | null;
}

export interface SupabaseWorkOrderServiceRowVerificationInput {
  companyId: string;
  workOrderId: string;
  serviceRowId: string;
  /** Optional RPC-returned row used by Add Service to prove returned/parent/flat parity for the new row. */
  expectedServiceRow?: WorkOrderServiceRow;
}

export interface SupabaseWorkOrderServiceRowUpdateVerificationInput
  extends SupabaseWorkOrderServiceRowVerificationInput {
  expectedPatch: SupabaseWorkOrderServiceRowUpdatePatch;
}

export type SupabaseWorkOrderServiceRowRemoveVerificationInput = SupabaseWorkOrderServiceRowVerificationInput;

function normalizeText(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function normalizeOptionalText(value: string | null | undefined): string | undefined {
  const trimmed = normalizeText(value);
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeNonNegativeInteger(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

function normalizeOptionalPatchText(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") throw new Error("Service-row text patch values must be strings.");
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function isTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function requireCompanyUuid(companyId: string): Promise<string> {
  const normalized = normalizeText(companyId);
  if (!normalized) throw new Error("Work order create requires a selected company context.");
  const companyMap = await loadCompanyUuidMap();
  const uuid = companyMap.get(normalized);
  if (!uuid) {
    throw new Error(`No Supabase company found for legacy_id "${normalized}".`);
  }
  return uuid;
}

async function getCustomerForExactScope(
  customerId: string,
  companyId: string,
): Promise<Customer | null> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const { data, error } = await supabase
    .from("customers")
    .select("data, company_legacy_id, deleted_at")
    .eq("legacy_id", customerId)
    .maybeSingle();
  if (error) throw new Error(`[workOrders] Supabase customer scope read failed: ${error.message}`);
  if (!data) return null;
  const row = data as unknown as WorkOrderCustomerScopeRow;
  if (row.deleted_at) return null;
  if (row.company_legacy_id !== companyId) return null;
  const customer = row.data;
  if (!customer || customer.id !== customerId || customer.companyId !== companyId) return null;
  return customer;
}

async function requireServiceForCompanyScope(serviceId: string, companyId: string): Promise<void> {
  const normalizedServiceId = normalizeText(serviceId);
  const normalizedCompanyId = normalizeText(companyId);
  if (!normalizedServiceId) throw new Error("Selected service id is required to add a service row.");
  if (!normalizedCompanyId) throw new Error("Service row add requires a selected company context.");
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const { data, error } = await supabase
    .from("services")
    .select("company_legacy_id, deleted_at")
    .eq("legacy_id", normalizedServiceId)
    .maybeSingle();
  if (error) throw new Error(`[workOrders] Supabase service scope read failed: ${error.message}`);
  if (!data) throw new Error("Selected service not found in Supabase for this company scope.");
  const row = data as unknown as WorkOrderServiceScopeRow;
  if (row.deleted_at) throw new Error("Selected service is archived or deleted.");
  if (row.company_legacy_id !== null && row.company_legacy_id !== normalizedCompanyId) {
    throw new Error("Selected service does not belong to the target company scope.");
  }
}

async function nextWorkOrderNumber(companyId: string): Promise<string> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const { data, error } = await supabase
    .from("work_orders")
    .select("number")
    .eq("company_legacy_id", companyId);
  if (error) throw new Error(`[workOrders] Supabase number read failed: ${error.message}`);
  const existingNumbers = ((data ?? []) as unknown as WorkOrderNumberRow[])
    .map((row) => Number.parseInt((row.number ?? "").replace(/\D/g, ""), 10))
    .filter((value) => !Number.isNaN(value));
  const nextNumber = (existingNumbers.length > 0 ? Math.max(...existingNumbers) : 1000) + 1;
  return `WO-${nextNumber}`;
}

function buildCreateActivity(input: SupabaseWorkOrderCreateInput, at: string): WorkOrder["activity"] {
  return [
    {
      id: makeId("woact"),
      action: "created",
      summary: "Work order created",
      actorId: normalizeOptionalText(input.createdBy) ?? null,
      actorName: normalizeOptionalText(input.createdByName) ?? "System",
      at,
    },
  ];
}

function workOrderToInsertRow(
  order: WorkOrder,
  companyUuid: string,
  customerDisplayName: string,
): WorkOrderInsertRow {
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
    service_row_count: 0,
    created_by: order.createdBy ?? null,
    deleted_at: null,
    data: order,
  };
}

/**
 * Creates one company/customer-scoped work-order parent row in Supabase.
 * This is the CORE-WRITES-WORKORDERS-A1.1 authoritative create boundary: it
 * inserts only `work_orders`, never service rows, booking queue rows, occurrence
 * exceptions, browser storage, or legacy dual-write mirrors.
 */
export async function createWorkOrderInSupabase(
  input: SupabaseWorkOrderCreateInput,
): Promise<WorkOrder> {
  const companyId = normalizeText(input.companyId);
  const customerId = normalizeText(input.customerId);
  if (!companyId) throw new Error("Work order create requires a selected company context.");
  if (!customerId) throw new Error("Work order create requires a customer id.");
  if (input.status === "inactive") throw new Error("New work orders cannot be created inactive.");

  const companyUuid = await requireCompanyUuid(companyId);
  const customer = await getCustomerForExactScope(customerId, companyId);
  if (!customer) throw new Error("Customer not found in Supabase for this company scope.");

  const now = new Date().toISOString();
  const order: WorkOrder = {
    id: makeId("wo"),
    companyId,
    customerId,
    number: await nextWorkOrderNumber(companyId),
    title: normalizeOptionalText(input.title),
    status: input.status ?? "draft",
    startDate: normalizeOptionalText(input.startDate),
    endDate: normalizeOptionalText(input.endDate),
    createdBy: normalizeOptionalText(input.createdBy) ?? null,
    createdByName: normalizeOptionalText(input.createdByName) ?? "System",
    notes: [],
    serviceRows: [],
    activity: buildCreateActivity(input, now),
    mediaPlacements: [],
    createdAt: now,
    updatedAt: now,
  };

  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const { error } = await supabase
    .from("work_orders")
    .insert([workOrderToInsertRow(order, companyUuid, customer.name)]);
  if (error) throw new Error(`[workOrders] Supabase work order insert failed: ${error.message}`);
  return order;
}

function buildServiceRowForRpc(input: SupabaseWorkOrderServiceRowCreateInput): WorkOrderServiceRow {
  const sourceServiceId = normalizeText(input.sourceServiceId);
  const serviceName = normalizeText(input.serviceName);
  const serviceDate = normalizeText(input.serviceDate);
  const recurrenceInterval = input.recurrenceInterval ?? "one_time";
  if (!sourceServiceId) throw new Error("Selected service id is required to add a service row.");
  if (!serviceName) throw new Error("Service name is required to add a service row.");
  if (!serviceDate) throw new Error("Service date is required to add a service row.");
  const serviceEndDate = normalizeOptionalText(input.serviceEndDate);
  if (recurrenceInterval !== "one_time" && serviceEndDate && serviceEndDate < serviceDate) {
    throw new Error("Service end date must be on or after the service date.");
  }
  const now = new Date().toISOString();
  return {
    id: makeId("worow"),
    sourceServiceId,
    serviceName,
    articleNumber: normalizeOptionalText(input.articleNumber),
    categoryName: normalizeOptionalText(input.categoryName),
    serviceType: normalizeOptionalText(input.serviceType),
    quantity: Number.isFinite(input.quantity) ? input.quantity : 1,
    unit: normalizeOptionalText(input.unit),
    price: input.price,
    vat: input.vat,
    status: input.status,
    notes: normalizeOptionalText(input.notes),
    serviceDate,
    serviceEndDate: recurrenceInterval === "one_time" ? undefined : serviceEndDate,
    plannedStartTime: normalizeOptionalText(input.plannedStartTime),
    plannedEndTime: normalizeOptionalText(input.plannedEndTime),
    assignedEmployeeIds: input.assignedEmployeeIds ?? [],
    unassignedEmployeeSlots: normalizeNonNegativeInteger(input.unassignedEmployeeSlots),
    recurrenceInterval,
    sortOrder: 0,
    archived: false,
    createdAt: now,
    updatedAt: now,
  };
}

const SERVICE_ROW_UPDATE_ALLOWED_KEYS = new Set([
  "serviceName",
  "articleNumber",
  "categoryName",
  "serviceType",
  "quantity",
  "unit",
  "price",
  "vat",
  "status",
  "notes",
  "serviceDate",
  "serviceEndDate",
  "plannedStartTime",
  "plannedEndTime",
  "recurrenceInterval",
  "archived",
] as const);

const SERVICE_ROW_ALLOWED_STATUSES = new Set(["planned", "in_progress", "completed", "inactive"]);
const SERVICE_ROW_ALLOWED_RECURRENCES = new Set([
  "one_time",
  "daily",
  "every_2_days",
  "every_3_days",
  "weekly",
  "every_2_weeks",
  "every_3_weeks",
  "every_4_weeks",
  "monthly",
  "every_2_weeks_monday",
  "every_3_months",
  "every_6_months",
  "yearly",
]);

function normalizeServiceRowUpdatePatch(
  patch: SupabaseWorkOrderServiceRowUpdatePatch,
): Record<string, unknown> {
  if (!isRecord(patch)) throw new Error("Service row update requires a patch object.");
  const normalized: Record<string, unknown> = {};
  for (const [key, rawValue] of Object.entries(patch as Record<string, unknown>)) {
    if (rawValue === undefined) continue;
    if (!(SERVICE_ROW_UPDATE_ALLOWED_KEYS as ReadonlySet<string>).has(key)) {
      throw new Error(`Field "${key}" cannot be updated by this service-row mutation.`);
    }
    switch (key) {
      case "serviceName": {
        if (typeof rawValue !== "string" || !rawValue.trim()) {
          throw new Error("Service name is required.");
        }
        normalized.serviceName = rawValue.trim();
        break;
      }
      case "articleNumber":
      case "categoryName":
      case "serviceType":
      case "unit":
      case "notes": {
        normalized[key] = normalizeOptionalPatchText(rawValue) ?? null;
        break;
      }
      case "quantity": {
        if (typeof rawValue !== "number" || !Number.isFinite(rawValue)) {
          throw new Error("Quantity must be numeric.");
        }
        normalized.quantity = rawValue;
        break;
      }
      case "price":
      case "vat": {
        if (rawValue === null) {
          normalized[key] = null;
          break;
        }
        if (typeof rawValue !== "number" || !Number.isFinite(rawValue)) {
          throw new Error(`${key === "price" ? "Price" : "VAT"} must be numeric.`);
        }
        normalized[key] = rawValue;
        break;
      }
      case "status": {
        if (typeof rawValue !== "string" || !SERVICE_ROW_ALLOWED_STATUSES.has(rawValue)) {
          throw new Error("Unsupported service-row status.");
        }
        normalized.status = rawValue;
        break;
      }
      case "serviceDate": {
        if (typeof rawValue !== "string" || !rawValue.trim()) {
          throw new Error("Service date is required.");
        }
        const value = rawValue.trim();
        if (!isIsoDate(value)) throw new Error("Service date must use YYYY-MM-DD format.");
        normalized.serviceDate = value;
        break;
      }
      case "serviceEndDate": {
        const value = normalizeOptionalPatchText(rawValue);
        if (value != null && !isIsoDate(value)) {
          throw new Error("Service end date must use YYYY-MM-DD format.");
        }
        normalized.serviceEndDate = value ?? null;
        break;
      }
      case "plannedStartTime":
      case "plannedEndTime": {
        const value = normalizeOptionalPatchText(rawValue);
        if (value != null && !isTime(value)) {
          throw new Error(`${key === "plannedStartTime" ? "Planned start" : "Planned end"} time must use HH:MM format.`);
        }
        normalized[key] = value ?? null;
        break;
      }
      case "recurrenceInterval": {
        if (typeof rawValue !== "string" || !SERVICE_ROW_ALLOWED_RECURRENCES.has(rawValue)) {
          throw new Error("Unsupported recurrence interval.");
        }
        normalized.recurrenceInterval = rawValue;
        break;
      }
      case "archived": {
        if (typeof rawValue !== "boolean") {
          throw new Error("Archived must be a boolean.");
        }
        normalized.archived = rawValue;
        break;
      }
      default:
        throw new Error(`Field "${key}" cannot be updated by this service-row mutation.`);
    }
  }

  if (Object.keys(normalized).length === 0) {
    throw new Error("Service row update requires at least one changed field.");
  }

  const start = normalized.plannedStartTime;
  const end = normalized.plannedEndTime;
  if (typeof start === "string" && typeof end === "string" && end <= start) {
    throw new Error("Planned end time must be after planned start time.");
  }
  if (
    typeof normalized.serviceDate === "string" &&
    typeof normalized.serviceEndDate === "string" &&
    normalized.serviceEndDate < normalized.serviceDate
  ) {
    throw new Error("Service end date must be on or after the service date.");
  }

  normalized.updatedAt = new Date().toISOString();
  return normalized;
}

function parseAddServiceRowRpcResult(
  data: unknown,
  expected: { companyId: string; workOrderId: string; rowId: string },
): SupabaseWorkOrderServiceRowAddResult {
  if (!isRecord(data)) {
    throw new Error("Supabase add-service RPC returned an invalid response.");
  }
  const workOrder = data.workOrder as WorkOrder | undefined;
  const serviceRow = data.serviceRow as WorkOrderServiceRow | undefined;
  const serviceRowCount = data.serviceRowCount;
  const generatedBookingCount = data.generatedBookingCount;
  if (!workOrder || workOrder.id !== expected.workOrderId || workOrder.companyId !== expected.companyId) {
    throw new Error("Supabase add-service RPC returned a mismatched work order.");
  }
  if (!serviceRow || serviceRow.id !== expected.rowId) {
    throw new Error("Supabase add-service RPC returned a mismatched service row.");
  }
  const parentRows = workOrder.serviceRows ?? [];
  const parentRow = parentRows.find((row) => row.id === expected.rowId);
  if (!parentRow) {
    throw new Error("Supabase add-service RPC did not append the service row to the parent work order.");
  }
  assertServiceRowDataParity(parentRow, serviceRow, "Supabase add-service RPC returned");
  if (typeof serviceRowCount !== "number" || serviceRowCount !== parentRows.length) {
    throw new Error("Supabase add-service RPC returned an inconsistent service-row count.");
  }
  if (typeof generatedBookingCount !== "number" || generatedBookingCount < 1) {
    throw new Error("Supabase add-service RPC did not generate booking ledger rows.");
  }
  return { workOrder, serviceRow, serviceRowCount, generatedBookingCount };
}

function parseRemoveServiceRowRpcResult(
  data: unknown,
  expected: { companyId: string; workOrderId: string; rowId: string },
): SupabaseWorkOrderServiceRowRemoveResult {
  if (!isRecord(data)) {
    throw new Error("Supabase remove-service RPC returned an invalid response.");
  }
  const workOrder = data.workOrder as WorkOrder | undefined;
  const serviceRow = data.serviceRow as WorkOrderServiceRow | undefined;
  const serviceRowCount = data.serviceRowCount;
  if (!workOrder || workOrder.id !== expected.workOrderId || workOrder.companyId !== expected.companyId) {
    throw new Error("Supabase remove-service RPC returned a mismatched work order.");
  }
  if (!serviceRow || serviceRow.id !== expected.rowId) {
    throw new Error("Supabase remove-service RPC returned a mismatched service row.");
  }
  const parentRows = workOrder.serviceRows ?? [];
  if (parentRows.some((row) => row.id === expected.rowId)) {
    throw new Error("Supabase remove-service RPC returned a work order that still includes the removed service row.");
  }
  if (typeof serviceRowCount !== "number" || serviceRowCount !== parentRows.length) {
    throw new Error("Supabase remove-service RPC returned an inconsistent service-row count.");
  }
  return { workOrder, serviceRow, serviceRowCount };
}

function parseUpdateServiceRowRpcResult(
  data: unknown,
  expected: { companyId: string; workOrderId: string; rowId: string },
): SupabaseWorkOrderServiceRowUpdateResult {
  if (!isRecord(data)) {
    throw new Error("Supabase update-service RPC returned an invalid response.");
  }
  const workOrder = data.workOrder as WorkOrder | undefined;
  const serviceRow = data.serviceRow as WorkOrderServiceRow | undefined;
  const serviceRowCount = data.serviceRowCount;
  if (!workOrder || workOrder.id !== expected.workOrderId || workOrder.companyId !== expected.companyId) {
    throw new Error("Supabase update-service RPC returned a mismatched work order.");
  }
  if (!serviceRow || serviceRow.id !== expected.rowId) {
    throw new Error("Supabase update-service RPC returned a mismatched service row.");
  }
  const parentRows = workOrder.serviceRows ?? [];
  const parentRow = parentRows.find((row) => row.id === expected.rowId);
  if (!parentRow) {
    throw new Error("Supabase update-service RPC did not update the parent work-order service row.");
  }
  assertServiceRowDataParity(parentRow, serviceRow, "Supabase update-service RPC returned");
  if (typeof serviceRowCount !== "number" || serviceRowCount !== parentRows.length) {
    throw new Error("Supabase update-service RPC returned an inconsistent service-row count.");
  }
  return { workOrder, serviceRow, serviceRowCount };
}

/**
 * Adds exactly one service row to one existing work order through the transactional
 * `add_work_order_service_row` RPC. This writes the parent aggregate, flat
 * service-row child, and generated booking ledger rows in one database boundary.
 */
export async function addWorkOrderServiceRowInSupabase(
  input: SupabaseWorkOrderServiceRowCreateInput,
): Promise<SupabaseWorkOrderServiceRowAddResult> {
  const companyId = normalizeText(input.companyId);
  const workOrderId = normalizeText(input.workOrderId);
  if (!companyId) throw new Error("Service row add requires a selected company context.");
  if (!workOrderId) throw new Error("Service row add requires a work order id.");
  const row = buildServiceRowForRpc({ ...input, companyId, workOrderId });
  await requireServiceForCompanyScope(row.sourceServiceId ?? "", companyId);
  const companyUuid = await requireCompanyUuid(companyId);
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const { data, error } = await supabase.rpc("add_work_order_service_row", {
    input: {
      company_id: companyUuid,
      company_legacy_id: companyId,
      work_order_legacy_id: workOrderId,
      row,
    },
  });
  if (error) throw new Error(`[workOrders] Supabase add-service RPC failed: ${error.message}`);
  const result = parseAddServiceRowRpcResult(data, { companyId, workOrderId, rowId: row.id });
  await verifyAddedWorkOrderServiceRowReadableFromSupabase({
    companyId,
    workOrderId,
    serviceRowId: result.serviceRow.id,
    expectedServiceRow: result.serviceRow,
  });
  return result;
}

/**
 * Updates one existing service row through the transactional
 * `update_work_order_service_row` RPC. This writes only the parent aggregate and
 * flat child row; it never invokes browser storage, dual-write mirrors, booking
 * queue, occurrence exceptions, protocols, payroll, or invoices.
 */
export async function removeWorkOrderServiceRowInSupabase(
  input: SupabaseWorkOrderServiceRowRemoveInput,
): Promise<SupabaseWorkOrderServiceRowRemoveResult> {
  const companyId = normalizeText(input.companyId);
  const workOrderId = normalizeText(input.workOrderId);
  const serviceRowId = normalizeText(input.serviceRowId);
  if (!companyId) throw new Error("Service row removal requires a selected company context.");
  if (!workOrderId) throw new Error("Service row removal requires a work order id.");
  if (!serviceRowId) throw new Error("Service row removal requires a service row id.");
  const companyUuid = await requireCompanyUuid(companyId);
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const { data, error } = await supabase.rpc("remove_work_order_service_row", {
    input: {
      company_id: companyUuid,
      company_legacy_id: companyId,
      work_order_legacy_id: workOrderId,
      service_row_legacy_id: serviceRowId,
    },
  });
  if (error) throw new Error(`[workOrders] Supabase remove-service RPC failed: ${error.message}`);
  const result = parseRemoveServiceRowRpcResult(data, { companyId, workOrderId, rowId: serviceRowId });
  await verifyRemovedWorkOrderServiceRowReadableFromSupabase({
    companyId,
    workOrderId,
    serviceRowId,
  });
  return result;
}

export async function updateWorkOrderServiceRowInSupabase(
  input: SupabaseWorkOrderServiceRowUpdateInput,
): Promise<SupabaseWorkOrderServiceRowUpdateResult> {
  const companyId = normalizeText(input.companyId);
  const workOrderId = normalizeText(input.workOrderId);
  const serviceRowId = normalizeText(input.serviceRowId);
  if (!companyId) throw new Error("Service row update requires a selected company context.");
  if (!workOrderId) throw new Error("Service row update requires a work order id.");
  if (!serviceRowId) throw new Error("Service row update requires a service row id.");
  const patch = normalizeServiceRowUpdatePatch(input.patch);
  const companyUuid = await requireCompanyUuid(companyId);
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const { data, error } = await supabase.rpc("update_work_order_service_row", {
    input: {
      company_id: companyUuid,
      company_legacy_id: companyId,
      work_order_legacy_id: workOrderId,
      service_row_legacy_id: serviceRowId,
      patch,
    },
  });
  if (error) throw new Error(`[workOrders] Supabase update-service RPC failed: ${error.message}`);
  return parseUpdateServiceRowRpcResult(data, { companyId, workOrderId, rowId: serviceRowId });
}

/** Archives one service row through the existing transactional update RPC. */
export async function archiveWorkOrderServiceRowInSupabase(
  input: SupabaseWorkOrderServiceRowArchiveInput,
): Promise<SupabaseWorkOrderServiceRowUpdateResult> {
  return updateWorkOrderServiceRowInSupabase({
    ...input,
    patch: { archived: true },
  });
}

/** Restores one archived service row through the existing transactional update RPC. */
export async function restoreWorkOrderServiceRowInSupabase(
  input: SupabaseWorkOrderServiceRowArchiveInput,
): Promise<SupabaseWorkOrderServiceRowUpdateResult> {
  return updateWorkOrderServiceRowInSupabase({
    ...input,
    patch: { archived: false },
  });
}

const ONE_TIME_RESCHEDULE_INPUT_KEYS = new Set([
  "companyId",
  "workOrderId",
  "serviceRowId",
  "recurrenceInterval",
  "serviceDate",
  "plannedStartTime",
  "plannedEndTime",
]);

function isOneTimeRecurrenceValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value !== "string") return false;
  const normalized = value.trim();
  return normalized === "" || normalized === "one_time";
}

/**
 * Changes date/time for a one-time service row only. This is a narrow app-side
 * guard over the transactional update RPC: it accepts only serviceDate,
 * plannedStartTime and plannedEndTime, blocks recurring rows, and never touches
 * booking queue, occurrence exceptions, staffing, protocols, payroll or invoices.
 */
export async function rescheduleOneTimeServiceRowInSupabase(
  input: SupabaseOneTimeServiceRowDateTimeInput,
): Promise<SupabaseWorkOrderServiceRowUpdateResult> {
  for (const key of Object.keys(input as unknown as Record<string, unknown>)) {
    if (!ONE_TIME_RESCHEDULE_INPUT_KEYS.has(key)) {
      throw new Error(`Field "${key}" cannot be updated by this date/time mutation.`);
    }
  }
  if (!isOneTimeRecurrenceValue(input.recurrenceInterval)) {
    throw new Error("Temporarily unavailable for recurring services.");
  }

  const serviceDate = normalizeText(input.serviceDate);
  if (!serviceDate) throw new Error("Service date is required.");
  if (!isIsoDate(serviceDate)) throw new Error("Service date must use a valid YYYY-MM-DD date.");

  const plannedStartTime = normalizeOptionalPatchText(input.plannedStartTime ?? null) ?? null;
  const plannedEndTime = normalizeOptionalPatchText(input.plannedEndTime ?? null) ?? null;
  if (plannedStartTime != null && !isTime(plannedStartTime)) {
    throw new Error("Planned start time must use HH:MM format.");
  }
  if (plannedEndTime != null && !isTime(plannedEndTime)) {
    throw new Error("Planned end time must use HH:MM format.");
  }
  if (plannedStartTime != null && plannedEndTime != null && plannedEndTime <= plannedStartTime) {
    throw new Error("Planned end time must be after planned start time.");
  }

  return updateWorkOrderServiceRowInSupabase({
    companyId: input.companyId,
    workOrderId: input.workOrderId,
    serviceRowId: input.serviceRowId,
    patch: {
      serviceDate,
      plannedStartTime,
      plannedEndTime,
    },
  });
}

interface WorkOrderServiceRowVerificationParentRow {
  data: WorkOrder | null;
  company_legacy_id: string;
  service_row_count: number | null;
  deleted_at: string | null;
}

interface WorkOrderServiceRowVerificationFlatRow {
  data: WorkOrderServiceRow | null;
  legacy_id?: string;
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
  assigned_employee_ids: string[] | null;
  unassigned_employee_slots: number | null;
  sort_order: number | null;
  deleted_at: string | null;
}

const SERVICE_ROW_VERIFICATION_COLUMNS =
  "legacy_id, data, company_legacy_id, work_order_legacy_id, service_name, article_number, status, archived, service_date, service_end_date, planned_start_time, planned_end_time, recurrence_interval, assigned_employee_ids, unassigned_employee_slots, sort_order, deleted_at";

const SERVICE_ROW_DATA_PARITY_KEYS: ReadonlyArray<keyof WorkOrderServiceRow> = [
  "id",
  "sourceServiceId",
  "serviceName",
  "articleNumber",
  "categoryName",
  "serviceType",
  "quantity",
  "unit",
  "price",
  "vat",
  "status",
  "notes",
  "serviceDate",
  "serviceEndDate",
  "plannedStartTime",
  "plannedEndTime",
  "recurrenceInterval",
  "assignedEmployeeIds",
  "unassignedEmployeeSlots",
  "employeeTimeOverrides",
  "totalLabourMinutesOverride",
  "scheduleSource",
  "schedulePreferences",
  "variations",
  "customerProtocolId",
  "protocolRunId",
  "sortOrder",
  "archived",
  "createdAt",
  "updatedAt",
];

function comparableJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function assertServiceRowDataParity(
  expected: WorkOrderServiceRow,
  actual: WorkOrderServiceRow | null | undefined,
  context: string,
): void {
  if (!actual) throw new Error(`${context} is missing service-row data.`);
  for (const key of SERVICE_ROW_DATA_PARITY_KEYS) {
    if (comparableJson(expected[key]) !== comparableJson(actual[key])) {
      throw new Error(`${context} service-row data does not match parent aggregate field ${String(key)}.`);
    }
  }
}

function assertFlatServiceRowIndexesMatchParent(
  flatRow: WorkOrderServiceRowVerificationFlatRow,
  parentRow: WorkOrderServiceRow,
  context: string,
): void {
  if (flatRow.company_legacy_id == null || flatRow.work_order_legacy_id == null) {
    throw new Error(`${context} flat service-row scope is incomplete.`);
  }
  if (flatRow.service_name !== parentRow.serviceName) {
    throw new Error(`${context} flat service name index does not match the parent aggregate.`);
  }
  if ((flatRow.article_number ?? null) !== (parentRow.articleNumber ?? null)) {
    throw new Error(`${context} flat article-number index does not match the parent aggregate.`);
  }
  if (flatRow.status !== parentRow.status) {
    throw new Error(`${context} flat status index does not match the parent aggregate.`);
  }
  if (Boolean(flatRow.archived) !== Boolean(parentRow.archived)) {
    throw new Error(`${context} flat archived index does not match the parent aggregate.`);
  }
  if ((flatRow.service_date ?? null) !== (parentRow.serviceDate ?? null)) {
    throw new Error(`${context} flat service-date index does not match the parent aggregate.`);
  }
  if ((flatRow.service_end_date ?? null) !== (parentRow.serviceEndDate ?? null)) {
    throw new Error(`${context} flat service-end-date index does not match the parent aggregate.`);
  }
  if ((flatRow.planned_start_time ?? null) !== (parentRow.plannedStartTime ?? null)) {
    throw new Error(`${context} flat planned-start index does not match the parent aggregate.`);
  }
  if ((flatRow.planned_end_time ?? null) !== (parentRow.plannedEndTime ?? null)) {
    throw new Error(`${context} flat planned-end index does not match the parent aggregate.`);
  }
  if (flatRow.recurrence_interval !== (parentRow.recurrenceInterval ?? "one_time")) {
    throw new Error(`${context} flat recurrence index does not match the parent aggregate.`);
  }
  if (comparableJson(flatRow.assigned_employee_ids ?? []) !== comparableJson(parentRow.assignedEmployeeIds ?? [])) {
    throw new Error(`${context} flat assignment index does not match the parent aggregate.`);
  }
  if ((flatRow.unassigned_employee_slots ?? 0) !== (parentRow.unassignedEmployeeSlots ?? 0)) {
    throw new Error(`${context} flat open-slot index does not match the parent aggregate.`);
  }
  if ((flatRow.sort_order ?? 0) !== (parentRow.sortOrder ?? 0)) {
    throw new Error(`${context} flat sort-order index does not match the parent aggregate.`);
  }
}

function filterLiveFlatServiceRows(
  flatData: unknown,
): WorkOrderServiceRowVerificationFlatRow[] {
  return ((flatData ?? []) as WorkOrderServiceRowVerificationFlatRow[]).filter((row) => !row.deleted_at);
}

/**
 * Freshly verifies that a just-added service row is readable from Supabase through
 * both the parent aggregate and the flat service-row read path. This is the
 * second-browser proof used before the Add Service dialog can show success.
 */
export async function verifyAddedWorkOrderServiceRowReadableFromSupabase(
  input: SupabaseWorkOrderServiceRowVerificationInput,
): Promise<WorkOrder> {
  const companyId = normalizeText(input.companyId);
  const workOrderId = normalizeText(input.workOrderId);
  const serviceRowId = normalizeText(input.serviceRowId);
  if (!companyId) throw new Error("Service row verification requires a selected company context.");
  if (!workOrderId) throw new Error("Service row verification requires a work order id.");
  if (!serviceRowId) throw new Error("Service row verification requires a service row id.");
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();

  const { data, error } = await supabase
    .from("work_orders")
    .select("data, company_legacy_id, service_row_count, deleted_at")
    .eq("legacy_id", workOrderId)
    .maybeSingle();
  if (error) throw new Error(`[workOrders] Supabase service-row verification failed: ${error.message}`);
  if (!data) throw new Error("Service row was added, but the parent work order is not readable yet.");
  const parent = data as unknown as WorkOrderServiceRowVerificationParentRow;
  if (parent.deleted_at) throw new Error("Service row was added, but the parent work order is deleted.");
  if (parent.company_legacy_id !== companyId) {
    throw new Error("Service row was added, but the parent work order company scope does not match.");
  }
  const workOrder = parent.data;
  if (!workOrder || workOrder.id !== workOrderId || workOrder.companyId !== companyId) {
    throw new Error("Service row was added, but the parent work-order data is not readable.");
  }
  const parentRows = workOrder.serviceRows ?? [];
  const parentRow = parentRows.find((row) => row.id === serviceRowId);
  if (!parentRow) {
    throw new Error("Service row was added, but the parent work order does not include it yet.");
  }
  if (input.expectedServiceRow) {
    assertServiceRowDataParity(
      input.expectedServiceRow,
      parentRow,
      "Service row was added, but the parent aggregate",
    );
  }

  const { data: flatData, error: flatError } = await supabase
    .from("work_order_service_rows")
    .select(SERVICE_ROW_VERIFICATION_COLUMNS)
    .eq("work_order_legacy_id", workOrderId)
    .eq("company_legacy_id", companyId);
  if (flatError) throw new Error(`[workOrders] Supabase flat service-row verification failed: ${flatError.message}`);
  const flatRows = filterLiveFlatServiceRows(flatData);
  const flatRow = flatRows.find(
    (row) => row.work_order_legacy_id === workOrderId && row.data?.id === serviceRowId,
  );
  if (!flatRow?.data) {
    throw new Error("Service row was added, but the flat service-row read path does not include it yet.");
  }
  assertServiceRowDataParity(parentRow, flatRow.data, "Service row was added, but the flat service-row read path");
  assertFlatServiceRowIndexesMatchParent(flatRow, parentRow, "Service row was added, but the flat service-row read path");
  return workOrder;
}

function expectedPatchMatchesRow(
  row: WorkOrderServiceRow,
  expectedPatch: SupabaseWorkOrderServiceRowUpdatePatch,
): boolean {
  const normalizedExpected = normalizeServiceRowUpdatePatch(expectedPatch);
  for (const [key, expected] of Object.entries(normalizedExpected)) {
    if (key === "updatedAt") continue;
    const actual = (row as unknown as Record<string, unknown>)[key];
    if (expected === null) {
      if (actual !== undefined && actual !== null && actual !== "") return false;
    } else if (actual !== expected) {
      return false;
    }
  }
  return true;
}

/**
 * Freshly verifies that a just-updated service row is readable from Supabase
 * through both the parent aggregate and the flat child row, and that the fields
 * changed by the RPC match the expected patch before the UI reports success.
 */
export async function verifyUpdatedWorkOrderServiceRowReadableFromSupabase(
  input: SupabaseWorkOrderServiceRowUpdateVerificationInput,
): Promise<WorkOrder> {
  const companyId = normalizeText(input.companyId);
  const workOrderId = normalizeText(input.workOrderId);
  const serviceRowId = normalizeText(input.serviceRowId);
  if (!companyId) throw new Error("Service row update verification requires a selected company context.");
  if (!workOrderId) throw new Error("Service row update verification requires a work order id.");
  if (!serviceRowId) throw new Error("Service row update verification requires a service row id.");
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();

  const { data, error } = await supabase
    .from("work_orders")
    .select("data, company_legacy_id, service_row_count, deleted_at")
    .eq("legacy_id", workOrderId)
    .maybeSingle();
  if (error) throw new Error(`[workOrders] Supabase service-row update verification failed: ${error.message}`);
  if (!data) throw new Error("Service row was updated, but the parent work order is not readable yet.");
  const parent = data as unknown as WorkOrderServiceRowVerificationParentRow;
  if (parent.deleted_at) throw new Error("Service row was updated, but the parent work order is deleted.");
  if (parent.company_legacy_id !== companyId) {
    throw new Error("Service row was updated, but the parent work order company scope does not match.");
  }
  const workOrder = parent.data;
  if (!workOrder || workOrder.id !== workOrderId || workOrder.companyId !== companyId) {
    throw new Error("Service row was updated, but the parent work-order data is not readable.");
  }
  const parentRows = workOrder.serviceRows ?? [];
  const parentRow = parentRows.find((row) => row.id === serviceRowId);
  if (!parentRow) {
    throw new Error("Service row was updated, but the parent work order does not include it yet.");
  }
  if ((parent.service_row_count ?? -1) !== parentRows.length) {
    throw new Error("Service row was updated, but service_row_count does not match the parent aggregate.");
  }
  if (!expectedPatchMatchesRow(parentRow, input.expectedPatch)) {
    throw new Error("Service row was updated, but the parent aggregate does not match the saved fields yet.");
  }

  const { data: flatData, error: flatError } = await supabase
    .from("work_order_service_rows")
    .select(SERVICE_ROW_VERIFICATION_COLUMNS)
    .eq("work_order_legacy_id", workOrderId)
    .eq("company_legacy_id", companyId);
  if (flatError) throw new Error(`[workOrders] Supabase flat service-row verification failed: ${flatError.message}`);
  const flatRows = filterLiveFlatServiceRows(flatData);
  const flatRow = flatRows.find(
    (row) => row.work_order_legacy_id === workOrderId && row.data?.id === serviceRowId,
  );
  if (!flatRow?.data) {
    throw new Error("Service row was updated, but the flat service-row read path does not include it yet.");
  }
  assertServiceRowDataParity(parentRow, flatRow.data, "Service row was updated, but the flat service-row read path");
  assertFlatServiceRowIndexesMatchParent(flatRow, parentRow, "Service row was updated, but the flat service-row read path");
  if (!expectedPatchMatchesRow(flatRow.data, input.expectedPatch)) {
    throw new Error("Service row was updated, but the flat service-row data does not match the saved fields yet.");
  }
  if (flatRows.length !== parentRows.length) {
    throw new Error("Service row was updated, but parent and flat service-row counts do not match.");
  }
  return workOrder;
}

/**
 * Freshly verifies that a just-removed service row is no longer present in active
 * Supabase read paths. Removal is a soft-delete in the flat child table and a
 * parent-aggregate removal from `work_orders.data.serviceRows`.
 */
export async function verifyRemovedWorkOrderServiceRowReadableFromSupabase(
  input: SupabaseWorkOrderServiceRowRemoveVerificationInput,
): Promise<WorkOrder> {
  const companyId = normalizeText(input.companyId);
  const workOrderId = normalizeText(input.workOrderId);
  const serviceRowId = normalizeText(input.serviceRowId);
  if (!companyId) throw new Error("Service row removal verification requires a selected company context.");
  if (!workOrderId) throw new Error("Service row removal verification requires a work order id.");
  if (!serviceRowId) throw new Error("Service row removal verification requires a service row id.");
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();

  const { data, error } = await supabase
    .from("work_orders")
    .select("data, company_legacy_id, service_row_count, deleted_at")
    .eq("legacy_id", workOrderId)
    .maybeSingle();
  if (error) throw new Error(`[workOrders] Supabase service-row removal verification failed: ${error.message}`);
  if (!data) throw new Error("Service row was removed, but the parent work order is not readable yet.");
  const parent = data as unknown as WorkOrderServiceRowVerificationParentRow;
  if (parent.deleted_at) throw new Error("Service row was removed, but the parent work order is deleted.");
  if (parent.company_legacy_id !== companyId) {
    throw new Error("Service row was removed, but the parent work order company scope does not match.");
  }
  const workOrder = parent.data;
  if (!workOrder || workOrder.id !== workOrderId || workOrder.companyId !== companyId) {
    throw new Error("Service row was removed, but the parent work-order data is not readable.");
  }
  const parentRows = workOrder.serviceRows ?? [];
  if (parentRows.some((row) => row.id === serviceRowId)) {
    throw new Error("Service row was removed, but the parent work order still includes it.");
  }
  if ((parent.service_row_count ?? -1) !== parentRows.length) {
    throw new Error("Service row was removed, but service_row_count does not match the parent aggregate.");
  }

  const { data: flatData, error: flatError } = await supabase
    .from("work_order_service_rows")
    .select(SERVICE_ROW_VERIFICATION_COLUMNS)
    .eq("work_order_legacy_id", workOrderId)
    .eq("company_legacy_id", companyId);
  if (flatError) throw new Error(`[workOrders] Supabase flat service-row removal verification failed: ${flatError.message}`);
  const liveFlatRows = filterLiveFlatServiceRows(flatData);
  const liveRemovedRow = liveFlatRows.find(
    (row) => row.work_order_legacy_id === workOrderId && (row.legacy_id === serviceRowId || row.data?.id === serviceRowId),
  );
  if (liveRemovedRow) {
    throw new Error("Service row was removed, but the flat service-row read path still includes it.");
  }
  return workOrder;
}

/**
 * Lists FULL work-order records (the lossless `data` jsonb) for a company scope
 * (P5D · WO-2).
 *
 * The Work Order list surface (the Customer Card · Work Orders tab) renders rich
 * fields that are NOT part of {@link WorkOrderSummary} — notably the nested
 * `serviceRows` (active-services count) and the per-row dates/status. To switch
 * the list's READ source to Supabase without any visible behaviour change, this
 * returns the same full {@link WorkOrder} objects the page reads from
 * localStorage today. Customer scoping, status filtering and sorting stay in the
 * page (unchanged); this function only moves where the rows come from.
 *
 * Company scope mirrors the localStorage adapter: omit `companyId` for all
 * RLS-visible rows, or pass an app-facing id to filter on `company_legacy_id`.
 */
export async function listFullWorkOrdersFromSupabase(
  companyId?: string | null,
): Promise<WorkOrder[]> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const stop = perf.start("workOrders.list.supabase");
  perf.count("workOrders.list.supabase.calls");
  try {
    let query = supabase.from("work_orders").select("data, company_legacy_id, deleted_at");
    if (companyId !== undefined && companyId !== null) {
      query = query.eq("company_legacy_id", companyId);
    }
    const { data, error } = await query;
    if (error) {
      throw new Error(`[workOrders] Supabase full list failed: ${error.message}`);
    }
    const rows = (data ?? []) as unknown as WorkOrderFullRow[];
    // WO-5.6: skip soft-deleted (removed) work orders.
    return rows
      .filter((r) => !r.deleted_at)
      .map((r) => r.data)
      .filter((w): w is WorkOrder => Boolean(w));
  } finally {
    stop();
  }
}

// ── P6C — true interval-scoped Schedule query ─────────────

/** Slim service-row columns the interval scope needs (no `data` jsonb). */
const SCHEDULE_ROW_COLUMNS =
  "legacy_id, company_legacy_id, work_order_legacy_id, service_date, service_end_date, recurrence_interval, archived, status, deleted_at";

/** Exception columns the interval scope needs (incl. lossless `data` jsonb). */
const SCHEDULE_EXCEPTION_COLUMNS =
  "data, occurrence_date, override_occurrence_date, status, service_row_legacy_id, company_legacy_id, deleted_at";

interface ScheduleRowSlim {
  legacy_id: string;
  company_legacy_id: string;
  work_order_legacy_id: string;
  service_date: string | null;
  service_end_date: string | null;
  recurrence_interval: string;
  archived: boolean;
  status: string;
  deleted_at: string | null;
}

interface ScheduleExceptionFullRow {
  data: BookingOccurrenceException;
  occurrence_date: string;
  override_occurrence_date: string | null;
  status: string;
  service_row_legacy_id: string;
  company_legacy_id: string;
  deleted_at: string | null;
}

/** Inputs for {@link fetchScheduleIntervalFromSupabase}. */
export interface ScheduleIntervalQueryParams {
  /** App-facing company scope; `undefined`/`null` = unscoped (super admin). */
  companyId?: string | null;
  /** Inclusive display lower bound "YYYY-MM-DD". */
  fromDate: string;
  /** Inclusive display upper bound "YYYY-MM-DD". */
  toDate: string;
}

/**
 * The interval-scoped Schedule input — only the work orders + exceptions the
 * `[fromDate, toDate]` window can touch, plus the (possibly widened) bounds that
 * were actually queried and the per-class fetch counts for monitoring.
 */
export interface ScheduleIntervalFetch {
  /** Parent work orders the fetched rows belong to (full `data` jsonb). */
  workOrders: WorkOrder[];
  /** Occurrence exceptions overlapping the widened window (full `data` jsonb). */
  exceptions: BookingOccurrenceException[];
  /** Widened lower bound actually scanned (≤ fromDate when a reschedule moved IN). */
  queryFromDate: string;
  /** Widened upper bound actually scanned (≥ toDate when a reschedule moved IN). */
  queryToDate: string;
  /** Service rows that overlapped the window (the narrowing measure). */
  serviceRowsFetched: number;
  /** Parent work orders hydrated (only those owning an in-window row). */
  parentsFetched: number;
  /** Exceptions fetched for the window. */
  exceptionsFetched: number;
}

/**
 * True interval-scoped Schedule fetch (P6C). Replaces the WO-4/P6B whole-company
 * hydration with a `(company_id, date)`-bounded query that pulls ONLY what the
 * `[fromDate, toDate]` window can touch, so a board navigating a single week
 * never loads every work order.
 *
 * It reproduces {@link resolveScheduleProgram}'s scan-widening exactly:
 *   1. Fetch the reschedules whose OVERRIDE (moved-to date) lands in the display
 *      window — these are the only events that can pull an occurrence IN from
 *      outside it. Their rule `occurrence_date` widens `[queryFrom, queryTo]`.
 *   2. Fetch the overlay exceptions whose rule date falls in the WIDENED window
 *      (union with step 1, deduped, soft-deleted skipped, reconstructed losslessly
 *      from the `data` jsonb — the summary projection drops staffing/labour
 *      overrides the resolver needs).
 *   3. Fetch the service rows that overlap the widened window
 *      (`service_date <= queryTo AND (service_end_date IS NULL OR
 *      service_end_date >= queryFrom)`) — one-time, bounded and open-ended
 *      recurring rows alike — plus the specific rows referenced by the fetched
 *      exceptions (defensive completeness). Their `work_order_legacy_id`s are the
 *      parent set.
 *   4. Hydrate ONLY those parent work orders (full `data` jsonb, soft-deleted
 *      skipped).
 *
 * The resolver still iterates each parent's embedded `serviceRows` and filters by
 * display date itself, so feeding it the narrowed parent set yields identical
 * occurrences — only the fetch is smaller. Read-only; mutates nothing.
 */
export async function fetchScheduleIntervalFromSupabase(
  params: ScheduleIntervalQueryParams,
): Promise<ScheduleIntervalFetch> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const { companyId, fromDate, toDate } = params;
  const scoped = companyId !== undefined && companyId !== null;
  const client = supabase;

  const stopAll = perf.start("schedule.input.supabase.interval");
  try {
    // ── Phase 1 + 2 — exceptions (scan-widening drivers + widened overlays) ──
    const stopExc = perf.start("schedule.query.exceptions");

    let widenQuery = client
      .from("work_order_occurrence_exceptions")
      .select(SCHEDULE_EXCEPTION_COLUMNS)
      .gte("override_occurrence_date", fromDate)
      .lte("override_occurrence_date", toDate);
    if (scoped) widenQuery = widenQuery.eq("company_legacy_id", companyId);
    const widen = await widenQuery;
    if (widen.error) {
      throw new Error(`[schedule] Supabase reschedule scan failed: ${widen.error.message}`);
    }
    const widenRows = (widen.data ?? []) as unknown as ScheduleExceptionFullRow[];

    let queryFromDate = fromDate;
    let queryToDate = toDate;
    for (const ex of widenRows) {
      if (ex.deleted_at || ex.status !== "rescheduled") continue;
      if (ex.occurrence_date < queryFromDate) queryFromDate = ex.occurrence_date;
      if (ex.occurrence_date > queryToDate) queryToDate = ex.occurrence_date;
    }

    let mainQuery = client
      .from("work_order_occurrence_exceptions")
      .select(SCHEDULE_EXCEPTION_COLUMNS)
      .gte("occurrence_date", queryFromDate)
      .lte("occurrence_date", queryToDate);
    if (scoped) mainQuery = mainQuery.eq("company_legacy_id", companyId);
    const main = await mainQuery;
    if (main.error) {
      throw new Error(`[schedule] Supabase exception scan failed: ${main.error.message}`);
    }
    const mainRows = (main.data ?? []) as unknown as ScheduleExceptionFullRow[];
    stopExc();

    const exByKey = new Map<string, BookingOccurrenceException>();
    const exceptionRowIds = new Set<string>();
    for (const row of [...mainRows, ...widenRows]) {
      if (row.deleted_at || !row.data) continue;
      const key =
        row.data.occurrenceKey ?? `${row.service_row_legacy_id}:${row.occurrence_date}`;
      exByKey.set(key, row.data);
      exceptionRowIds.add(row.service_row_legacy_id);
    }
    const exceptions = [...exByKey.values()];

    // ── Phase 3 — service rows overlapping the widened window ──
    const stopRows = perf.start("schedule.query.serviceRows");
    let rowQuery = client
      .from("work_order_service_rows")
      .select(SCHEDULE_ROW_COLUMNS)
      .lte("service_date", queryToDate)
      .or(`service_end_date.is.null,service_end_date.gte.${queryFromDate}`);
    if (scoped) rowQuery = rowQuery.eq("company_legacy_id", companyId);
    const rowsRes = await rowQuery;
    if (rowsRes.error) {
      throw new Error(`[schedule] Supabase service-row scan failed: ${rowsRes.error.message}`);
    }
    const overlapRows = (rowsRes.data ?? []) as unknown as ScheduleRowSlim[];

    const parentIds = new Set<string>();
    let serviceRowsFetched = 0;
    for (const r of overlapRows) {
      if (r.deleted_at) continue;
      serviceRowsFetched += 1;
      parentIds.add(r.work_order_legacy_id);
    }

    // Defensive: an exception can reference a row whose flat dates do not overlap
    // the window (data drift); fetch those rows so their parent is never missed.
    if (exceptionRowIds.size > 0) {
      let refQuery = client
        .from("work_order_service_rows")
        .select(SCHEDULE_ROW_COLUMNS)
        .in("legacy_id", [...exceptionRowIds]);
      if (scoped) refQuery = refQuery.eq("company_legacy_id", companyId);
      const refRes = await refQuery;
      if (refRes.error) {
        throw new Error(`[schedule] Supabase exception-row scan failed: ${refRes.error.message}`);
      }
      for (const r of (refRes.data ?? []) as unknown as ScheduleRowSlim[]) {
        if (r.deleted_at) continue;
        parentIds.add(r.work_order_legacy_id);
      }
    }
    stopRows();

    // ── Phase 4 — parent work orders (only those owning an in-window row) ──
    const stopParents = perf.start("schedule.query.parents");
    let workOrders: WorkOrder[] = [];
    if (parentIds.size > 0) {
      let parentQuery = client
        .from("work_orders")
        .select("data, company_legacy_id, deleted_at")
        .in("legacy_id", [...parentIds]);
      if (scoped) parentQuery = parentQuery.eq("company_legacy_id", companyId);
      const parentRes = await parentQuery;
      if (parentRes.error) {
        throw new Error(`[schedule] Supabase parent fetch failed: ${parentRes.error.message}`);
      }
      const parentRows = (parentRes.data ?? []) as unknown as WorkOrderFullRow[];
      workOrders = parentRows
        .filter((r) => !r.deleted_at)
        .map((r) => r.data)
        .filter((w): w is WorkOrder => Boolean(w));
    }
    stopParents();

    return {
      workOrders,
      exceptions,
      queryFromDate,
      queryToDate,
      serviceRowsFetched,
      parentsFetched: workOrders.length,
      exceptionsFetched: exceptions.length,
    };
  } finally {
    stopAll();
  }
}

export const supabaseWorkOrderRepository: WorkOrderRepository = {
  async listSummaries(params: WorkOrderListParams = {}) {
    const stop = perf.start("workOrders.list.supabase.summaries");
    try {
      const rows = await fetchScopedWorkOrders(params);
      const searched = applyWoSearch(rows, params.search).map(woRowToSummary);
      return paginate(searched, params.page, params.pageSize);
    } finally {
      stop();
    }
  },

  async getDetail(id: string, params: DetailParams = {}) {
    if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
    const { data, error } = await supabase
      .from("work_orders")
      .select("data, company_legacy_id, deleted_at")
      .eq("legacy_id", id)
      .maybeSingle();
    if (error) {
      throw new Error(`[workOrders] Supabase detail failed: ${error.message}`);
    }
    if (!data) return null;
    const row = data as unknown as {
      data: WorkOrder;
      company_legacy_id: string;
      deleted_at: string | null;
    };
    // WO-5.6: a soft-deleted (removed) work order reads as absent.
    if (row.deleted_at) return null;
    if (params.companyId !== undefined && row.company_legacy_id !== params.companyId) {
      return null;
    }
    return row.data ?? null;
  },

  async search(params: WorkOrderListParams) {
    return this.listSummaries(params);
  },

  async count(params: CountParams = {}) {
    const rows = await fetchScopedWorkOrders(params);
    return applyWoSearch(rows, params.search).length;
  },

  async listServiceRows(workOrderId: string, params: ServiceRowListParams = {}) {
    const stop = perf.start("workOrders.serviceRows.supabase");
    try {
      if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
      let query = supabase
        .from("work_order_service_rows")
        .select(ROW_SUMMARY_COLUMNS)
        .eq("work_order_legacy_id", workOrderId);
      if (params.companyId !== undefined && params.companyId !== null) {
        query = query.eq("company_legacy_id", params.companyId);
      }
      const { data, error } = await query;
      if (error) {
        throw new Error(`[workOrders] Supabase service-row list failed: ${error.message}`);
      }
      let rows = (data ?? []) as unknown as ServiceRowSummaryRow[];
      // WO-5.6: soft-deleted (removed) service rows never drive the schedule.
      rows = rows.filter((r) => !r.deleted_at);
      if (!params.includeArchived) rows = rows.filter((r) => !r.archived);
      const searched = applyRowSearch(rows, params.search)
        .map(rowToServiceRowSummary)
        .sort((a, b) => a.sortOrder - b.sortOrder);
      return paginate(searched, params.page, params.pageSize);
    } finally {
      stop();
    }
  },

  async listOccurrenceExceptions(params: OccurrenceExceptionListParams = {}) {
    const stop = perf.start("workOrders.exceptions.supabase");
    try {
      if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
      let query = supabase
        .from("work_order_occurrence_exceptions")
        .select(EXCEPTION_SUMMARY_COLUMNS);
      if (params.companyId !== undefined && params.companyId !== null) {
        query = query.eq("company_legacy_id", params.companyId);
      }
      if (params.serviceRowId) {
        query = query.eq("service_row_legacy_id", params.serviceRowId);
      }
      const { data, error } = await query;
      if (error) {
        throw new Error(`[workOrders] Supabase exception list failed: ${error.message}`);
      }
      let rows = (data ?? []) as unknown as ExceptionSummaryRow[];
      // WO-5.6: soft-deleted (removed) exceptions never overlay the schedule.
      rows = rows.filter((r) => !r.deleted_at);
      if (params.fromDate || params.toDate) {
        rows = rows.filter((e) => {
          if (params.fromDate && e.occurrence_date < params.fromDate) return false;
          if (params.toDate && e.occurrence_date > params.toDate) return false;
          return true;
        });
      }
      const summaries = rows.map(rowToExceptionSummary);
      return paginate(summaries, params.page, params.pageSize);
    } finally {
      stop();
    }
  },
};
