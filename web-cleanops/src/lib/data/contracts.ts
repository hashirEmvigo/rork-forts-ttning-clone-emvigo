/**
 * Query-layer contracts (Migration Wave 0).
 *
 * The stable, storage-agnostic interface every operational entity is read
 * through. Today the only implementation is the localStorage adapter (which
 * wraps the existing store getters); later waves swap in a Supabase adapter
 * behind the SAME interface, so UI/business code never changes when storage
 * moves to the server.
 *
 * Methods are `async` (Promise-returning) on purpose: the localStorage adapter
 * resolves synchronously-derived data immediately, while a future server
 * adapter is naturally asynchronous. Committing to Promises now means the seam
 * does not change shape at migration time.
 *
 * Only methods that map cleanly to real current/future usage are included
 * (`listSummaries`, `getDetail`, `search`, `count`) — no speculative surface.
 */
import type {
  ListParams,
  CountParams,
  DetailParams,
  ListResult,
  CustomerSummary,
  CustomerDetail,
  EmployeeSummary,
  EmployeeDetail,
  WorkOrderSummary,
  WorkOrderDetail,
  WorkOrderServiceRowSummary,
  WorkOrderExceptionSummary,
  ScheduleOccurrenceSummary,
  ScheduleOccurrenceDetail,
  ActivityEventSummary,
  ActivityEventDetail,
  TimeReportSummary,
  TimeReportDetail,
} from "./types";

/**
 * Re-export the shared query primitives so repositories can import them from
 * this stable contracts module alongside the repository interfaces below
 * (they are defined in `./types`).
 */
export type { ListParams, CountParams, DetailParams, ListResult } from "./types";

/**
 * Generic read repository. `TParams` lets an entity extend {@link ListParams}
 * with entity-specific filters (status, date range, …) without weakening the
 * base contract.
 */
export interface ReadRepository<
  TSummary,
  TDetail,
  TParams extends ListParams = ListParams,
> {
  /** Company-scoped, optionally paged list of lightweight summaries. */
  listSummaries(params?: TParams): Promise<ListResult<TSummary>>;
  /** Single full record by id, or null when missing / out of company scope. */
  getDetail(id: string, params?: DetailParams): Promise<TDetail | null>;
  /** Search summaries (free-text + identifier-aware where relevant). */
  search(params: TParams): Promise<ListResult<TSummary>>;
  /** Count matches for the given scope/search, ignoring pagination. */
  count(params?: CountParams): Promise<number>;
}

// ── Entity-specific parameter extensions ──────────────────

/** Customer list/search params (base params are sufficient today). */
export type CustomerListParams = ListParams;

/** Employee list/search params. */
export type EmployeeListParams = ListParams;

/** Work-order list/search params with optional status filtering. */
export interface WorkOrderListParams extends ListParams {
  /** Restrict to a set of statuses (e.g. active board vs archived). */
  statuses?: string[];
}

/** Service-row list params. Scoped to a work order by the explicit id argument. */
export interface ServiceRowListParams extends ListParams {
  /** Include archived rows. Defaults to false (live rows only). */
  includeArchived?: boolean;
}

/** Occurrence-exception list params — the SEPARATE exception store. */
export interface OccurrenceExceptionListParams extends ListParams {
  /** Restrict to a single service row (domain `parentServiceRowId`). */
  serviceRowId?: string;
  /** Inclusive occurrence-date lower bound "YYYY-MM-DD". */
  fromDate?: string;
  /** Inclusive occurrence-date upper bound "YYYY-MM-DD". */
  toDate?: string;
}

/** Schedule interval params — date window scoping the occurrence list. */
export interface ScheduleListParams extends ListParams {
  /** Inclusive interval start "YYYY-MM-DD". */
  fromDate?: string;
  /** Inclusive interval end "YYYY-MM-DD". */
  toDate?: string;
  /** Restrict to specific employees (assignment lanes). */
  employeeIds?: string[];
}

/** Activity-log params with date-range + actor/entity/action filters (OP2). */
export interface ActivityListParams extends ListParams {
  fromDate?: string;
  toDate?: string;
  actorId?: string;
  action?: string;
}

/** Time-report params with employee + date-range scoping. */
export interface TimeReportListParams extends ListParams {
  employeeId?: string;
  fromDate?: string;
  toDate?: string;
}

// ── Per-entity repository contracts ───────────────────────

export type CustomerRepository = ReadRepository<
  CustomerSummary,
  CustomerDetail,
  CustomerListParams
>;

export type EmployeeRepository = ReadRepository<
  EmployeeSummary,
  EmployeeDetail,
  EmployeeListParams
>;

/**
 * Work-order read repository. Extends the base read contract with two
 * work-order-specific reads that mirror the real data shape: nested service
 * rows (scoped to a parent) and the SEPARATE occurrence-exception overlay store.
 * Kept minimal — no speculative surface beyond what the schedule / detail tabs
 * actually consume.
 */
export interface WorkOrderRepository
  extends ReadRepository<WorkOrderSummary, WorkOrderDetail, WorkOrderListParams> {
  /** Schedule-critical service-row summaries for one work order. */
  listServiceRows(
    workOrderId: string,
    params?: ServiceRowListParams,
  ): Promise<ListResult<WorkOrderServiceRowSummary>>;
  /** Occurrence-exception overlay summaries (company-scoped, optional filters). */
  listOccurrenceExceptions(
    params?: OccurrenceExceptionListParams,
  ): Promise<ListResult<WorkOrderExceptionSummary>>;
}

export type ScheduleRepository = ReadRepository<
  ScheduleOccurrenceSummary,
  ScheduleOccurrenceDetail,
  ScheduleListParams
>;

export type ActivityLogRepository = ReadRepository<
  ActivityEventSummary,
  ActivityEventDetail,
  ActivityListParams
>;

export type TimeReportRepository = ReadRepository<
  TimeReportSummary,
  TimeReportDetail,
  TimeReportListParams
>;

/** The full set of operational repositories the data layer exposes. */
export interface DataLayer {
  customers: CustomerRepository;
  employees: EmployeeRepository;
  workOrders: WorkOrderRepository;
  schedule: ScheduleRepository;
  activityLog: ActivityLogRepository;
  timeReports: TimeReportRepository;
}
