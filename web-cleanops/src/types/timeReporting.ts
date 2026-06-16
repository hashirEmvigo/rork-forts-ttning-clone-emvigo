/**
 * Operational Execution — Time Reporting type foundations (Phase 1).
 *
 * Time Reporting is the standalone *approval, adjustment and time-classification
 * workspace*. It consumes Mission Log execution data and decides what time is
 * approved, what is payroll-relevant and what is invoice/billable — optimised
 * for high-volume, exception-based review (saved review queues, advanced
 * filters, bulk actions, flag triage, and future AI-assisted prioritisation).
 *
 * THIS FILE IS TYPE-ONLY FOUNDATION. Nothing here is wired into the UI, the
 * store, Supabase, or AppContext yet, and there is NO behaviour change. These
 * shapes mirror `docs/architecture/30-operational-execution-architecture.md`
 * (§§11–12) so later phases build against a stable contract.
 *
 * AUTHORITATIVE MODEL / NAMING: `TimeReport` here is the new, authoritative
 * Operational Execution time-report model. It is intentionally NOT re-exported
 * from `@/types` (the index barrel), which still carries the legacy checkout
 * `TimeReport` that drives a live work-order checkout flow. The legacy model is
 * reported as a live dependency to be cut over in a later behavioural wave;
 * until then, import the new model directly from `@/types/timeReporting`. This
 * is deliberately a single authoritative model, not a parallel collision-avoider.
 */

// ── Statuses ──────────────────────────────────────────────

/** The lifecycle status of a time report through the review workflow. */
export type TimeReportStatus =
  | "draft"
  | "employee_submitted"
  | "auto_approved"
  | "admin_review_required"
  | "admin_adjusted_pending_employee"
  | "employee_question_pending"
  | "employee_answered"
  | "approved"
  | "ready_for_payroll"
  | "ready_for_invoice"
  | "sent_to_payroll"
  | "sent_to_invoice_basis"
  | "admin_override_approved"
  | "rejected"
  | "excluded";

/** Payroll readiness, tracked separately from invoice readiness. */
export type PayrollApprovalStatus =
  | "not_ready"
  | "ready"
  | "approved"
  | "sent_to_payroll"
  | "excluded";

/** Invoice-basis readiness, tracked separately from payroll readiness. */
export type InvoiceBasisStatus =
  | "not_ready"
  | "ready"
  | "approved"
  | "sent_to_invoice_basis"
  | "excluded";

/** Who must still act on a side of the report. */
export type PartyApprovalStatus = "pending" | "approved" | "rejected";

/** Admin-side approval state, including the override outcome. */
export type AdminApprovalStatus = "pending" | "approved" | "rejected" | "overridden";

// ── Time Report ───────────────────────────────────────────

/**
 * The authoritative Operational Execution time report. Separates scheduled,
 * checked-in/out, employee-reported and admin-adjusted durations, and tracks
 * payroll vs. invoice readiness independently (a report may be ready for
 * payroll but not invoice, or vice versa). The deviation split lives in the
 * separate {@link TimeAllocation} model.
 */
export interface TimeReport {
  id: string;
  companyId: string;

  missionLogEntryId: string;
  bookingId: string;
  bookingOccurrenceId: string;
  workOrderId?: string;

  customerId: string;
  customerNameSnapshot: string;

  employeeId: string;
  employeeNameSnapshot: string;

  scheduledStartTime: string;
  scheduledEndTime: string;
  scheduledDurationMinutes: number;

  checkedInAt?: string;
  checkedOutAt?: string;
  actualDurationMinutes?: number;

  employeeReportedStartTime?: string;
  employeeReportedEndTime?: string;
  employeeReportedDurationMinutes?: number;

  adminAdjustedStartTime?: string;
  adminAdjustedEndTime?: string;
  adminAdjustedDurationMinutes?: number;
  adminAdjustmentReason?: string;

  finalApprovedPayrollMinutes?: number;
  finalApprovedInvoiceMinutes?: number;

  totalDeviationMinutes?: number;
  billableDeviationMinutes?: number;
  nonBillableDeviationMinutes?: number;
  excludedMinutes?: number;

  status: TimeReportStatus;
  payrollApprovalStatus: PayrollApprovalStatus;
  invoiceBasisStatus: InvoiceBasisStatus;

  requiresAdminReview: boolean;
  reviewReasonCodes: string[];

  employeeApprovalStatus: PartyApprovalStatus;
  adminApprovalStatus: AdminApprovalStatus;

  createdAt: string;
  updatedAt: string;
}

// ── Time Allocation ───────────────────────────────────────

/** How a slice of time is classified for payroll/invoice purposes. */
export type TimeAllocationType =
  | "scheduled_billable"
  | "extra_billable"
  | "internal_non_billable"
  | "non_billable_customer_related"
  | "training"
  | "admin_adjustment"
  | "excluded";

/** Who created an allocation slice. */
export type AllocationActorType = "employee" | "admin" | "system";

/**
 * A single classified slice of a time report's minutes. The sum of allocations
 * reconstructs the worked time and its billable/internal/excluded split.
 */
export interface TimeAllocation {
  id: string;
  companyId: string;
  timeReportId: string;
  missionLogEntryId: string;
  employeeId: string;

  allocationType: TimeAllocationType;
  minutes: number;

  reasonCodeId?: string;
  reasonLabelSnapshot?: string;

  isPayrollRelevant: boolean;
  isInvoiceRelevant: boolean;
  isBillable: boolean;

  createdByActorType: AllocationActorType;
  createdByActorId?: string;

  note?: string;

  createdAt: string;
  updatedAt: string;
}

/** The allocation type a reason code maps a deviation to by default. */
export type ReasonCodeDefaultAllocationType =
  | "extra_billable"
  | "internal_non_billable"
  | "non_billable_customer_related"
  | "training"
  | "excluded";

/** Company-configurable deviation reason codes (managed in Settings). */
export interface TimeDeviationReasonCode {
  id: string;
  companyId: string;

  label: string;
  description?: string;

  defaultAllocationType: ReasonCodeDefaultAllocationType;

  isBillableDefault: boolean;
  isPayrollRelevantDefault: boolean;
  isInvoiceRelevantDefault: boolean;

  requiresComment: boolean;
  isActive: boolean;

  sortOrder: number;

  createdAt: string;
  updatedAt: string;
}

// ── Messages ──────────────────────────────────────────────

/** Who sent a {@link TimeReportMessage}. */
export type TimeReportMessageSender = "employee" | "admin" | "system";

/** Admin↔employee communication thread attached to a time report. */
export interface TimeReportMessage {
  id: string;
  companyId: string;
  timeReportId: string;

  senderType: TimeReportMessageSender;
  senderId?: string;

  message: string;

  createdAt: string;
}

// ── Settings ──────────────────────────────────────────────

/** Company-level Time Reporting configuration. */
export interface TimeReportingSettings {
  companyId: string;

  autoApprovalEnabled: boolean;

  maxDeviationMinutes: number;
  maxDeviationPercent: number;

  requireGpsOrQrVerification: boolean;
  requireEmployeeDailyApproval: boolean;

  manualAdjustmentsAlwaysRequireAdminReview: boolean;
  splitAllocationsAlwaysRequireAdminReview: boolean;
  internalNonBillableAlwaysRequiresAdminReview: boolean;
  gpsQrProblemsAlwaysRequireAdminReview: boolean;

  allowEmployeeSuggestedAllocation: boolean;
  allowEmployeeOptionalComment: boolean;

  createdAt: string;
  updatedAt: string;
}

// ── Flag triage ───────────────────────────────────────────

/**
 * Resolution status of an operational flag attached to a time report or
 * mission. CRITICAL: this is tracked SEPARATELY from a report's approval
 * status — a report can be approved for payroll/invoice while a related flag is
 * still kept for later review, or dismissed as harmless after triage.
 */
export type FlagResolutionStatus =
  | "open"
  | "reviewed"
  | "approved"
  | "dismissed"
  | "escalated"
  | "kept_for_review";

/**
 * AI review recommendation (Phase 1: type-only — AI never makes a final
 * decision). Future AI provides a recommendation + explanation to help admins
 * prioritise; the admin always decides.
 */
export type AiReviewRecommendation =
  | "likely_approve"
  | "review_recommended"
  | "high_risk"
  | "needs_human_decision"
  | "insufficient_data";

// ── Saved review queues / filters ─────────────────────────

/** A single advanced-filter predicate field for Time Reporting review. */
export type SavedFilterField =
  | "gps_flag"
  | "qr_flag"
  | "training_time"
  | "internal_non_billable"
  | "employee"
  | "customer"
  | "team"
  | "location"
  | "manual_adjustment"
  | "missing_check_in"
  | "missing_check_out"
  | "outside_normal_pattern"
  | "deviation_above_threshold"
  | "small_deviation"
  | "time_report_status"
  | "payroll_status"
  | "invoice_status"
  | "flag_resolution_status"
  | "ai_recommendation";

/** Comparison operator for a {@link SavedFilterCriterion}. */
export type SavedFilterOperator =
  | "is"
  | "is_not"
  | "in"
  | "not_in"
  | "gte"
  | "lte"
  | "between"
  | "exists"
  | "not_exists";

/** One predicate in a saved filter. `values` carries operands (ids/numbers). */
export interface SavedFilterCriterion {
  field: SavedFilterField;
  operator: SavedFilterOperator;
  values: Array<string | number>;
}

/** How multiple criteria combine. */
export type SavedFilterMatch = "all" | "any";

/**
 * A reusable, named set of filter criteria for the Time Reporting workspace.
 * Pure data — evaluation/persistence is built in a later phase.
 */
export interface SavedFilter {
  id: string;
  companyId: string;
  name: string;
  match: SavedFilterMatch;
  criteria: SavedFilterCriterion[];
  createdByUserId?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * A saved review queue: a named, ordered, shareable view over time reports
 * built from a {@link SavedFilter}, used for exception-based triage (e.g. "GPS
 * flags", "Training time", "Small deviations likely safe to approve"). Pure
 * data foundation — no evaluation, persistence or UI in Phase 1.
 */
export interface SavedReviewQueue {
  id: string;
  companyId: string;
  name: string;
  description?: string;
  /** The filter that defines queue membership. */
  filter: SavedFilter;
  /** Whether the queue is shared with the whole company or private to its owner. */
  shared: boolean;
  /** Optional display order among saved queues. */
  sortOrder?: number;
  createdByUserId?: string;
  createdAt: string;
  updatedAt: string;
}
