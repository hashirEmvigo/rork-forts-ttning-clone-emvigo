/**
 * LocalStorage-backed query-layer adapters (Migration Wave 0).
 *
 * These implement the {@link DataLayer} contracts by wrapping the EXISTING
 * store getters (`getCustomers`, `getEmployees`, …). They introduce no new data
 * source and change no behaviour: they read exactly what the app reads today,
 * apply company scoping + search + pagination, and project the records down to
 * the lightweight summary DTOs.
 *
 * This is the "seam": once a Supabase adapter exists (later waves), callers can
 * switch implementations without touching UI or business code. No page is wired
 * onto these adapters in Wave 0 — the goal is only to create and validate the
 * boundary (see `parity.ts`).
 *
 * All methods are async to match the contract; the underlying reads are
 * synchronous so the promises resolve immediately.
 */
import {
  getCustomers,
  getEmployees,
  getWorkOrders,
  getBookingQueue,
  getBookingOccurrenceExceptions,
  getAuditEvents,
  getTimeReports,
} from "@/lib/store";
import { evaluateSearchThreshold } from "@/lib/searchThreshold";
import type {
  CustomerRepository,
  EmployeeRepository,
  WorkOrderRepository,
  ScheduleRepository,
  ActivityLogRepository,
  TimeReportRepository,
  DataLayer,
} from "./contracts";
import type {
  ServiceRowListParams,
  OccurrenceExceptionListParams,
} from "./contracts";
import type {
  ListParams,
  CountParams,
  ListResult,
  CustomerSummary,
  EmployeeSummary,
  WorkOrderSummary,
  WorkOrderServiceRowSummary,
  WorkOrderExceptionSummary,
  ScheduleOccurrenceSummary,
  ActivityEventSummary,
  TimeReportSummary,
} from "./types";

// ── Shared helpers ────────────────────────────────────────

/** Filters a list to a company scope when `companyId` is provided. */
function scopeByCompany<T extends { companyId: string | null }>(
  items: T[],
  companyId?: string | null,
): T[] {
  if (companyId === undefined) return items;
  return items.filter((item) => item.companyId === companyId);
}

/**
 * Applies the shared search-threshold policy and matches the active query
 * against the provided haystack fields (case-insensitive). When the query is
 * empty or below the free-text threshold (and not identifier-style), no
 * filtering is applied — mirroring the P1 list behaviour.
 */
function applySearch<T>(
  items: T[],
  rawSearch: string | undefined,
  getFields: (item: T) => Array<string | null | undefined>,
): T[] {
  const { activeQuery, shouldSearch } = evaluateSearchThreshold(rawSearch ?? "");
  if (!shouldSearch) return items;
  const needle = activeQuery.toLowerCase();
  return items.filter((item) =>
    getFields(item).some((field) => (field ?? "").toLowerCase().includes(needle)),
  );
}

/** Slices a mapped summary list into a {@link ListResult} using list params. */
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

// ── Customers ─────────────────────────────────────────────

const customers: CustomerRepository = {
  async listSummaries(params: ListParams = {}) {
    const scoped = scopeByCompany(getCustomers(), params.companyId);
    const searched = applySearch(scoped, params.search, (c) => [
      c.name,
      c.customerNumber,
      c.email,
    ]);
    const summaries: CustomerSummary[] = searched.map((c) => ({
      id: c.id,
      companyId: c.companyId,
      name: c.name,
      customerNumber: c.customerNumber,
      email: c.email,
      status: c.status,
      customerType: c.customerType,
      areaId: c.areaId,
      area: c.area,
    }));
    return paginate(summaries, params.page, params.pageSize);
  },
  async getDetail(id, params = {}) {
    const found = getCustomers().find((c) => c.id === id) ?? null;
    if (!found) return null;
    if (params.companyId !== undefined && found.companyId !== params.companyId) return null;
    return found;
  },
  async search(params) {
    return this.listSummaries(params);
  },
  async count(params: CountParams = {}) {
    const scoped = scopeByCompany(getCustomers(), params.companyId);
    return applySearch(scoped, params.search, (c) => [c.name, c.customerNumber, c.email]).length;
  },
};

// ── Employees ─────────────────────────────────────────────

const employees: EmployeeRepository = {
  async listSummaries(params: ListParams = {}) {
    const scoped = scopeByCompany(getEmployees(), params.companyId);
    const searched = applySearch(scoped, params.search, (e) => [e.name, e.email, e.title]);
    const summaries: EmployeeSummary[] = searched.map((e) => ({
      id: e.id,
      companyId: e.companyId,
      name: e.name,
      email: e.email,
      title: e.title,
      status: e.status,
      teamCount: e.teamIds.length,
      hasLogin: Boolean(e.userId),
    }));
    return paginate(summaries, params.page, params.pageSize);
  },
  async getDetail(id, params = {}) {
    const found = getEmployees().find((e) => e.id === id) ?? null;
    if (!found) return null;
    if (params.companyId !== undefined && found.companyId !== params.companyId) return null;
    return found;
  },
  async search(params) {
    return this.listSummaries(params);
  },
  async count(params: CountParams = {}) {
    const scoped = scopeByCompany(getEmployees(), params.companyId);
    return applySearch(scoped, params.search, (e) => [e.name, e.email, e.title]).length;
  },
};

// ── Work Orders ───────────────────────────────────────────

/** Builds a customerId → display name map once per call (avoids per-row lookup). */
function buildCustomerNameMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const c of getCustomers()) map.set(c.id, c.name);
  return map;
}

const workOrders: WorkOrderRepository = {
  async listSummaries(params = {}) {
    let scoped = scopeByCompany(getWorkOrders(), params.companyId);
    if (params.statuses && params.statuses.length > 0) {
      const allow = new Set(params.statuses);
      scoped = scoped.filter((w) => allow.has(w.status));
    }
    const searched = applySearch(scoped, params.search, (w) => [w.number, w.title]);
    const names = buildCustomerNameMap();
    const summaries: WorkOrderSummary[] = searched.map((w) => ({
      id: w.id,
      companyId: w.companyId,
      customerId: w.customerId,
      customerDisplayName: names.get(w.customerId) ?? "",
      number: w.number,
      title: w.title,
      status: w.status,
      startDate: w.startDate,
      endDate: w.endDate,
      serviceRowCount: w.serviceRows?.length ?? 0,
      updatedAt: w.updatedAt,
    }));
    return paginate(summaries, params.page, params.pageSize);
  },
  async getDetail(id, params = {}) {
    const found = getWorkOrders().find((w) => w.id === id) ?? null;
    if (!found) return null;
    if (params.companyId !== undefined && found.companyId !== params.companyId) return null;
    return found;
  },
  async search(params) {
    return this.listSummaries(params);
  },
  async count(params: CountParams = {}) {
    const scoped = scopeByCompany(getWorkOrders(), params.companyId);
    return applySearch(scoped, params.search, (w) => [w.number, w.title]).length;
  },
  async listServiceRows(workOrderId, params: ServiceRowListParams = {}) {
    const order = getWorkOrders().find((w) => w.id === workOrderId) ?? null;
    // Company-scope guard: out-of-scope or missing parent yields an empty result.
    if (!order) return paginate<WorkOrderServiceRowSummary>([], params.page, params.pageSize);
    if (params.companyId !== undefined && order.companyId !== params.companyId) {
      return paginate<WorkOrderServiceRowSummary>([], params.page, params.pageSize);
    }
    let rows = order.serviceRows ?? [];
    if (!params.includeArchived) rows = rows.filter((r) => !r.archived);
    const searched = applySearch(rows, params.search, (r) => [r.serviceName, r.articleNumber]);
    const summaries: WorkOrderServiceRowSummary[] = searched
      .map((r) => ({
        id: r.id,
        workOrderId: order.id,
        companyId: order.companyId,
        serviceName: r.serviceName,
        status: r.status,
        archived: Boolean(r.archived),
        serviceDate: r.serviceDate,
        serviceEndDate: r.serviceEndDate,
        recurrenceInterval: r.recurrenceInterval ?? "one_time",
        plannedStartTime: r.plannedStartTime,
        plannedEndTime: r.plannedEndTime,
        assignedEmployeeIds: r.assignedEmployeeIds ?? [],
        unassignedEmployeeSlots: r.unassignedEmployeeSlots ?? 0,
        sortOrder: r.sortOrder,
        variationCount: r.variations?.length ?? 0,
        updatedAt: r.updatedAt,
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder);
    return paginate(summaries, params.page, params.pageSize);
  },
  async listOccurrenceExceptions(params: OccurrenceExceptionListParams = {}) {
    // Exceptions carry no companyId; resolve it via the parent service row.
    const rowCompany = new Map<string, string>();
    for (const w of getWorkOrders()) {
      for (const r of w.serviceRows ?? []) rowCompany.set(r.id, w.companyId);
    }
    let items = getBookingOccurrenceExceptions();
    if (params.companyId !== undefined) {
      items = items.filter((e) => rowCompany.get(e.parentServiceRowId) === params.companyId);
    }
    if (params.serviceRowId) {
      items = items.filter((e) => e.parentServiceRowId === params.serviceRowId);
    }
    if (params.fromDate || params.toDate) {
      items = items.filter((e) => {
        if (params.fromDate && e.occurrenceDate < params.fromDate) return false;
        if (params.toDate && e.occurrenceDate > params.toDate) return false;
        return true;
      });
    }
    const summaries: WorkOrderExceptionSummary[] = items.map((e) => ({
      occurrenceKey: e.occurrenceKey,
      serviceRowId: e.parentServiceRowId,
      status: e.status,
      occurrenceDate: e.occurrenceDate,
      overrideOccurrenceDate: e.overrideOccurrenceDate,
      overrideStartTime: e.overrideStartTime,
      overrideEndTime: e.overrideEndTime,
    }));
    return paginate(summaries, params.page, params.pageSize);
  },
};

// ── Schedule (derived from the persisted Booking Queue in Wave 0) ──

const schedule: ScheduleRepository = {
  async listSummaries(params = {}) {
    let scoped = scopeByCompany(getBookingQueue(), params.companyId);
    if (params.employeeIds && params.employeeIds.length > 0) {
      const allow = new Set(params.employeeIds);
      scoped = scoped.filter((b) =>
        (b.assignedEmployeeIds ?? []).some((emp) => allow.has(emp)),
      );
    }
    if (params.fromDate || params.toDate) {
      scoped = scoped.filter((b) => {
        const date = b.scheduledDate ?? b.serviceDate ?? null;
        if (!date) return false;
        if (params.fromDate && date < params.fromDate) return false;
        if (params.toDate && date > params.toDate) return false;
        return true;
      });
    }
    const searched = applySearch(scoped, params.search, (b) => [
      b.customerName,
      b.serviceName,
      b.workOrderNumber,
    ]);
    const summaries: ScheduleOccurrenceSummary[] = searched.map((b) => ({
      visitId: b.id,
      companyId: b.companyId,
      workOrderId: b.workOrderId,
      customerId: b.customerId,
      customerDisplayName: b.customerName,
      serviceLabel: b.serviceName,
      date: b.scheduledDate ?? b.serviceDate ?? null,
      startTime: b.scheduledStartTime ?? b.plannedStartTime ?? null,
      endTime: b.scheduledEndTime ?? b.plannedEndTime ?? null,
      employeeIds: b.assignedEmployeeIds ?? [],
      assignmentStatus: b.assignmentStatus,
      scheduleStatus: b.scheduleStatus,
    }));
    return paginate(summaries, params.page, params.pageSize);
  },
  async getDetail(id, params = {}) {
    const found = getBookingQueue().find((b) => b.id === id) ?? null;
    if (!found) return null;
    if (params.companyId !== undefined && found.companyId !== params.companyId) return null;
    return found;
  },
  async search(params) {
    return this.listSummaries(params);
  },
  async count(params: CountParams = {}) {
    const scoped = scopeByCompany(getBookingQueue(), params.companyId);
    return applySearch(scoped, params.search, (b) => [
      b.customerName,
      b.serviceName,
      b.workOrderNumber,
    ]).length;
  },
};

// ── Activity Log ──────────────────────────────────────────

const activityLog: ActivityLogRepository = {
  async listSummaries(params = {}) {
    let scoped = scopeByCompany(getAuditEvents(), params.companyId);
    if (params.actorId) scoped = scoped.filter((e) => e.actorId === params.actorId);
    if (params.action) scoped = scoped.filter((e) => e.action === params.action);
    if (params.fromDate || params.toDate) {
      scoped = scoped.filter((e) => {
        const day = e.at.slice(0, 10);
        if (params.fromDate && day < params.fromDate) return false;
        if (params.toDate && day > params.toDate) return false;
        return true;
      });
    }
    const searched = applySearch(scoped, params.search, (e) => [e.summary, e.actorName, e.action]);
    const summaries: ActivityEventSummary[] = searched.map((e) => ({
      id: e.id,
      at: e.at,
      actorId: e.actorId,
      actorName: e.actorName,
      actorRole: e.actorRole,
      companyId: e.companyId,
      action: e.action,
      summary: e.summary,
    }));
    return paginate(summaries, params.page, params.pageSize);
  },
  async getDetail(id, params = {}) {
    const found = getAuditEvents().find((e) => e.id === id) ?? null;
    if (!found) return null;
    if (params.companyId !== undefined && found.companyId !== params.companyId) return null;
    return found;
  },
  async search(params) {
    return this.listSummaries(params);
  },
  async count(params: CountParams = {}) {
    const scoped = scopeByCompany(getAuditEvents(), params.companyId);
    return applySearch(scoped, params.search, (e) => [e.summary, e.actorName, e.action]).length;
  },
};

// ── Time Reports ──────────────────────────────────────────

const timeReports: TimeReportRepository = {
  async listSummaries(params = {}) {
    let scoped = scopeByCompany(getTimeReports(), params.companyId);
    if (params.employeeId) scoped = scoped.filter((r) => r.employeeId === params.employeeId);
    if (params.fromDate || params.toDate) {
      scoped = scoped.filter((r) => {
        const day = r.submittedAt.slice(0, 10);
        if (params.fromDate && day < params.fromDate) return false;
        if (params.toDate && day > params.toDate) return false;
        return true;
      });
    }
    const searched = applySearch(scoped, params.search, (r) => [r.jobName, r.employeeName]);
    const summaries: TimeReportSummary[] = searched.map((r) => ({
      id: r.id,
      companyId: r.companyId,
      workOrderId: r.workOrderId,
      employeeId: r.employeeId,
      employeeName: r.employeeName,
      jobName: r.jobName,
      scheduledMinutes: r.scheduledMinutes,
      actualMinutes: r.actualMinutes,
      deviationMinutes: r.deviationMinutes,
      approvalStatus: r.approvalStatus,
      submittedAt: r.submittedAt,
    }));
    return paginate(summaries, params.page, params.pageSize);
  },
  async getDetail(id, params = {}) {
    const found = getTimeReports().find((r) => r.id === id) ?? null;
    if (!found) return null;
    if (params.companyId !== undefined && found.companyId !== params.companyId) return null;
    return found;
  },
  async search(params) {
    return this.listSummaries(params);
  },
  async count(params: CountParams = {}) {
    const scoped = scopeByCompany(getTimeReports(), params.companyId);
    return applySearch(scoped, params.search, (r) => [r.jobName, r.employeeName]).length;
  },
};

/**
 * The localStorage-backed data layer. This is the Wave 0 implementation of the
 * {@link DataLayer} contract; later waves provide a Supabase-backed equivalent
 * behind the same interface.
 */
export const localDataLayer: DataLayer = {
  customers,
  employees,
  workOrders,
  schedule,
  activityLog,
  timeReports,
};
