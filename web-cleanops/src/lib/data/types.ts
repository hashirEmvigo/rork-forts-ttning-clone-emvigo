/**
 * Query-layer DTOs and shared query types (Migration Wave 0).
 *
 * Design seam only. These types describe the *summary* and *detail* shapes the
 * future query layer will return, so UI/business code can depend on a stable
 * contract instead of the raw domain types or storage implementation. They sit
 * BESIDE the existing domain types in `@/types` — nothing here replaces or
 * deletes a domain type, and no UI is migrated onto them yet.
 *
 * Rules (from the P4A blueprint, `SUMMARY_DETAIL_CONTRACTS`):
 *  - Summary DTOs are lightweight: only the fields a list/board surface renders.
 *  - Detail DTOs carry the full domain record (re-exported, not duplicated).
 *  - List/query methods never return detail-heavy data by default.
 *
 * The DTO fields are intentionally aligned with the current domain types so the
 * localStorage adapters can be implemented with no resolution work, and so a
 * later Supabase adapter can return the same shapes from a `select` of just the
 * summary columns.
 */
import type {
  Customer,
  Employee,
  WorkOrder,
  WorkOrderServiceRow,
  WorkOrderServiceStatus,
  RecurrenceInterval,
  RecurringVariationFrequency,
  VariationStatus,
  VariationType,
  BookingOccurrenceExceptionStatus,
  TimeReport,
  AuditEvent,
  BookingQueueItem,
  EntityStatus,
  CustomerType,
  WorkOrderStatus,
  TimeReportApprovalStatus,
  BookingAssignmentStatus,
  BookingScheduleStatus,
  UserRole,
  AuditAction,
} from "@/types";

// ── Shared query parameter / result types ─────────────────

/**
 * Base parameters every list/search query accepts. `companyId` is the universal
 * tenant filter; `page` is 1-based; `search` is free text the adapter matches
 * against the entity's searchable + identifier fields.
 */
export interface ListParams {
  /** Active company scope. When omitted, the adapter returns all companies. */
  companyId?: string | null;
  /** Free-text / identifier search term. Empty or omitted means "no search". */
  search?: string;
  /** 1-based page number. Defaults to 1. */
  page?: number;
  /** Page size. When omitted, no pagination is applied (all matches returned). */
  pageSize?: number;
}

/** Parameters for a count query — list params without pagination. */
export type CountParams = Omit<ListParams, "page" | "pageSize">;

/** Parameters for a single detail lookup. */
export interface DetailParams {
  /** Optional company scope guard — detail is only returned if it matches. */
  companyId?: string | null;
}

/** A paginated list result. `total` is the match count BEFORE pagination. */
export interface ListResult<TSummary> {
  items: TSummary[];
  /** Total matches before pagination (drives pagination controls). */
  total: number;
  /** Echoed 1-based page (1 when unpaginated). */
  page: number;
  /** Echoed page size (equal to `total` when unpaginated). */
  pageSize: number;
}

// ── Customer DTOs ─────────────────────────────────────────

/**
 * Lightweight customer row for list/search surfaces. Excludes addresses,
 * contacts, notes, scheduling preferences, media and history (detail-only).
 */
export interface CustomerSummary {
  id: string;
  companyId: string;
  name: string;
  customerNumber: string;
  email: string;
  status: EntityStatus;
  customerType?: CustomerType;
  /** Structured area id (preferred) — label resolution stays in the UI/detail. */
  areaId?: string;
  /** Legacy free-text area, kept for back-compat display only. */
  area?: string;
}

/** Full customer record, loaded on card open. */
export type CustomerDetail = Customer;

// ── Employee DTOs ─────────────────────────────────────────

/** Lightweight employee row. Excludes working schedule, languages, history. */
export interface EmployeeSummary {
  id: string;
  companyId: string;
  name: string;
  email: string;
  title?: string;
  status: EntityStatus;
  /** Team membership count — cheap badge data without resolving team names. */
  teamCount: number;
  /** Whether this employee has a linked login (cheap boolean, not the user). */
  hasLogin: boolean;
}

/** Full employee record, loaded on profile open. */
export type EmployeeDetail = Employee;

// ── Work Order DTOs ───────────────────────────────────────

/** Lightweight work-order row. Excludes service rows, notes, activity, media. */
export interface WorkOrderSummary {
  id: string;
  companyId: string;
  customerId: string;
  /**
   * Denormalised customer name (resolved at query time) so list / customer-card
   * surfaces render without a per-row customer lookup (avoids N+1). Empty string
   * when the customer can't be resolved — never a thrown/missing field.
   */
  customerDisplayName: string;
  number: string;
  title?: string;
  status: WorkOrderStatus;
  startDate?: string;
  endDate?: string;
  /** Count of service rows — list badge without shipping the rows themselves. */
  serviceRowCount: number;
  updatedAt: string;
}

/** Full work-order record (incl. service rows, variations, activity). */
export type WorkOrderDetail = WorkOrder;

// ── Work Order child DTOs (WO-0) ──────────────────────────

/**
 * Schedule-critical projection of a {@link WorkOrderServiceRow}. Carries exactly
 * what occurrence generation / the schedule resolver consume — no commercial
 * (price/vat/quantity) or protocol fields, and the embedded variation array is
 * reduced to a count. The full row is loaded via {@link WorkOrderServiceRowDetail}.
 */
export interface WorkOrderServiceRowSummary {
  id: string;
  workOrderId: string;
  companyId: string;
  serviceName: string;
  status: WorkOrderServiceStatus;
  /** Archived rows are not live sources for the schedule (isLiveSourceRow). */
  archived: boolean;
  serviceDate: string;
  serviceEndDate?: string | null;
  recurrenceInterval: RecurrenceInterval;
  plannedStartTime?: string;
  plannedEndTime?: string;
  assignedEmployeeIds: string[];
  unassignedEmployeeSlots: number;
  sortOrder: number;
  /** Count of embedded variations (the array stays in the detail DTO). */
  variationCount: number;
  updatedAt: string;
}

/** Full service-row record (incl. variations / overrides / prefs / protocol links). */
export type WorkOrderServiceRowDetail = WorkOrderServiceRow;

/**
 * Lightweight summary of an embedded {@link import("@/types").RecurringVariation}.
 * The matching-rule fields (interval / weekday / anchor) and override values are
 * lazy-loaded with the row detail; this is the chip-list shape.
 */
export interface WorkOrderVariationSummary {
  id: string;
  /** The service row this variation is embedded in. */
  serviceRowId: string;
  workOrderId: string;
  companyId: string;
  name: string;
  type?: VariationType;
  /** Effective status (derived via getVariationStatus when not stored). */
  status: VariationStatus;
  frequency: RecurringVariationFrequency;
  appliesFrom?: string;
  appliesUntil?: string;
}

/**
 * Lightweight summary of a {@link import("@/types").BookingOccurrenceException}
 * from the SEPARATE exception store. This is the schedule overlay shape — cancel
 * / reschedule / time-change for a single occurrence, keyed by occurrenceKey.
 */
export interface WorkOrderExceptionSummary {
  /** `parentServiceRowId:occurrenceDate` — stable occurrence identity. */
  occurrenceKey: string;
  /** The base recurring service row this overlays (domain `parentServiceRowId`). */
  serviceRowId: string;
  status: BookingOccurrenceExceptionStatus;
  occurrenceDate: string;
  overrideOccurrenceDate?: string | null;
  overrideStartTime?: string | null;
  overrideEndTime?: string | null;
}

// ── Schedule occurrence DTOs ──────────────────────────────

/**
 * Lightweight schedule occurrence row, optimised for board rendering, filtering
 * and assignment. In Wave 0 the localStorage adapter derives these from the
 * persisted Booking Queue (the closest stored planning record); the future
 * server query returns the same shape from a scoped interval query.
 */
export interface ScheduleOccurrenceSummary {
  /** Stable occurrence id (the booking-queue item id in Wave 0). */
  visitId: string;
  companyId: string;
  workOrderId: string;
  customerId: string;
  customerDisplayName: string;
  serviceLabel: string;
  /** Planned date "YYYY-MM-DD" (scheduled date, falling back to service date). */
  date: string | null;
  startTime: string | null;
  endTime: string | null;
  employeeIds: string[];
  assignmentStatus: BookingAssignmentStatus;
  scheduleStatus: BookingScheduleStatus;
}

/** Full booking/occurrence record, loaded on occurrence open. */
export type ScheduleOccurrenceDetail = BookingQueueItem;

// ── Activity Log DTOs ─────────────────────────────────────

/**
 * Activity-event summary. The domain {@link AuditEvent} is already
 * summary-shaped, so the summary mirrors it; the future detail query adds the
 * full payload/diff which the current model does not store.
 */
export interface ActivityEventSummary {
  id: string;
  at: string;
  actorId: string | null;
  actorName: string;
  actorRole: UserRole;
  companyId: string | null;
  action: AuditAction;
  summary: string;
}

/** Full activity event (today identical to the summary). */
export type ActivityEventDetail = AuditEvent;

// ── Time Report DTOs ──────────────────────────────────────

/** Lightweight time-report row. Excludes the append-only audit history. */
export interface TimeReportSummary {
  id: string;
  companyId: string;
  workOrderId: string;
  employeeId: string | null;
  employeeName: string;
  jobName: string;
  scheduledMinutes: number;
  actualMinutes: number;
  deviationMinutes: number;
  approvalStatus: TimeReportApprovalStatus;
  submittedAt: string;
}

/** Full time-report record (incl. deviation allocation + audit history). */
export type TimeReportDetail = TimeReport;
