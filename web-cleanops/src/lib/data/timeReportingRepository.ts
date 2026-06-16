/**
 * Operational Execution — Time Reporting repository interfaces (Phase 1).
 *
 * INTERFACE ONLY. Declares the storage-agnostic read contracts for the Time
 * Reporting workspace, modelled on the existing {@link ReadRepository} seam.
 * There is NO implementation here, no adapter, and no wiring into the
 * `DataLayer`. Built for high-volume, exception-based review: summaries carry
 * exactly the columns the triage table renders, and the params expose the
 * saved-queue / advanced-filter surface that later phases consume.
 */

import type { CountParams, ListResult, ReadRepository } from "./contracts";
import type { ListParams } from "./types";
import type {
  AiReviewRecommendation,
  FlagResolutionStatus,
  InvoiceBasisStatus,
  PayrollApprovalStatus,
  SavedReviewQueue,
  TimeAllocation,
  TimeReport,
  TimeReportMessage,
  TimeReportStatus,
} from "@/types/timeReporting";

/** Lightweight time-report row for the high-volume triage table. */
export interface TimeReportSummary {
  id: string;
  companyId: string;
  missionLogEntryId: string;
  customerId: string;
  customerNameSnapshot: string;
  employeeId: string;
  employeeNameSnapshot: string;
  scheduledDurationMinutes: number;
  actualDurationMinutes?: number;
  totalDeviationMinutes?: number;
  status: TimeReportStatus;
  payrollApprovalStatus: PayrollApprovalStatus;
  invoiceBasisStatus: InvoiceBasisStatus;
  requiresAdminReview: boolean;
  /** Highest-severity unresolved flag on the report, when any. */
  flagResolutionStatus?: FlagResolutionStatus;
  /** Latest AI recommendation, when computed (never an auto-decision). */
  aiRecommendation?: AiReviewRecommendation;
  submittedAt?: string;
}

/**
 * A flag attached to a time report. Its resolution lifecycle
 * ({@link FlagResolutionStatus}) is tracked SEPARATELY from the report's
 * approval status — a report can be approved while a flag stays open / kept for
 * review / escalated. Read shape rebuilt losslessly from the `time_report_flags`
 * row `data` jsonb.
 */
export interface TimeReportFlagRecord {
  id: string;
  timeReportId: string;
  missionLogEntryId?: string;
  flagType: string;
  resolutionStatus: FlagResolutionStatus;
  severity?: string;
  resolvedByActorId?: string;
  resolvedAt?: string;
}

/** One IMMUTABLE event in a time report's append-only stream. */
export interface TimeReportEventRecord {
  id: string;
  timeReportId: string;
  eventType: string;
  actorType: string;
  actorId?: string;
  occurredAt: string;
}

/** One IMMUTABLE flag-resolution-history event (the flag triage audit trail). */
export interface TimeReportFlagEventRecord {
  id: string;
  timeReportFlagId: string;
  timeReportId: string;
  eventType: string;
  fromResolutionStatus?: FlagResolutionStatus;
  toResolutionStatus?: FlagResolutionStatus;
  actorType: string;
  actorId?: string;
  occurredAt: string;
}

/**
 * Full time-report record: the authoritative {@link TimeReport} plus its child
 * collections, loaded ONLY by `getDetail`. Allocations and flags are mutable
 * (soft-deleted rows excluded); events, flag events and messages are immutable
 * append-only streams ordered deterministically.
 */
export interface TimeReportDetail extends TimeReport {
  allocations: TimeAllocation[];
  flags: TimeReportFlagRecord[];
  messages: TimeReportMessage[];
  events: TimeReportEventRecord[];
  flagEvents: TimeReportFlagEventRecord[];
}

/**
 * Time Reporting list/search params. Extends the base list params with the
 * filter surface the saved review queues are built from — employee/customer/
 * team/location scoping, status + flag + AI buckets, deviation thresholds and
 * an optional saved-queue id the adapter expands into criteria.
 */
export interface TimeReportListParams extends ListParams {
  fromDate?: string;
  toDate?: string;
  employeeIds?: string[];
  customerIds?: string[];
  teamId?: string;
  locationId?: string;
  statuses?: TimeReportStatus[];
  payrollStatuses?: PayrollApprovalStatus[];
  invoiceStatuses?: InvoiceBasisStatus[];
  flagResolutionStatuses?: FlagResolutionStatus[];
  aiRecommendations?: AiReviewRecommendation[];
  /** Only reports whose absolute deviation is at/above this many minutes. */
  minDeviationMinutes?: number;
  /** Only reports whose absolute deviation is at/below this many minutes. */
  maxDeviationMinutes?: number;
  requiresAdminReviewOnly?: boolean;
  /**
   * Restrict to a single service row by its app-facing legacy id. Backs the
   * legacy checkout delete-guard / cut-over parity lookups (the flat
   * `service_row_legacy_id` column on `time_reports`, migration 0032).
   */
  serviceRowLegacyId?: string;
  /** Restrict to reports attached to a single Mission Log entry (soft link). */
  missionLogEntryLegacyId?: string;
  /** Expand a stored {@link SavedReviewQueue} into its filter criteria. */
  savedQueueId?: string;
}

/**
 * The Time Reporting read repository contract. Interface only — no
 * implementation, no bulk mutations (those are a later phase).
 */
export type TimeReportingRepository = ReadRepository<
  TimeReportSummary,
  TimeReportDetail,
  TimeReportListParams
>;

/**
 * Read contract for a company's saved review queues. Kept minimal and read-only
 * for Phase 1 — creation/sharing/persistence arrive with the workspace.
 */
export interface SavedReviewQueueRepository {
  /** All saved review queues visible to the active company scope. */
  list(params?: ListParams): Promise<ListResult<SavedReviewQueue>>;
  /** A single saved review queue by id, or null when missing / out of scope. */
  getById(id: string, params?: ListParams): Promise<SavedReviewQueue | null>;
  /** Count of saved review queues for the scope. */
  count(params?: CountParams): Promise<number>;
}
