/**
 * Time Reporting checkout dual-write mappers (Slice 2c-2a).
 *
 * The mapping layer the Time Reporting checkout dual-write ({@link
 * import("./timeReportingDualWrite")}) writes through — the Time Reporting
 * analogue of {@link import("./missionLogMigration")}. It turns ONE legacy
 * checkout {@link TimeReport} (plus the small bit of work-order context not
 * carried on the report) into the Time Reporting CORE rows a checkout records:
 *
 *   1. ONE `time_reports` row     — upsert (one authoritative report per legacy
 *      checkout, idempotent on the deterministic report legacy id).
 *   2. 1–3 `time_allocations` rows — upsert. The scheduled allocation is ALWAYS
 *      written (even at 0 minutes) so every mirrored report has a stable base
 *      allocation; a billable / internal deviation allocation is written ONLY
 *      when its minutes are > 0.
 *   3. ONE `time_report_events` row — IMMUTABLE `time_report_submitted` event,
 *      inserted with `ignoreDuplicates` on a stable idempotency key so retries
 *      never duplicate and never mutate an existing event row.
 *
 * SCOPE — Slice 2c-2a added the dual-write CORE (the three core tables above);
 * Slice 2c-2b EXTENDS this same mapping layer with the optional review surface —
 * ONE `time_report_flags` row (only when the checkout requires admin review),
 * its ONE IMMUTABLE `time_report_flag_events` open event, and ONE IMMUTABLE
 * `time_report_messages` row (only when the checkout carries a real deviation
 * comment). This file stays pure mapping + deterministic id derivation: NO I/O,
 * NO flag reads, never throws. It NEVER writes payroll basis, invoice basis, the
 * time bank, notifications or AI inference. `ai_recommendation` is always null.
 * When a flag is created the report's denormalised `flag_resolution_status`
 * rollup is set to `open` (still SEPARATE from approval); otherwise it stays
 * null.
 *
 * RELATIONSHIP TO MISSION LOG: the report links BACK to Mission Log via the SAME
 * deterministic keys Slice 2c-1 derives ({@link buildMissionLogEntryLegacyId} /
 * {@link buildMissionStaffSessionLegacyId}), computed here EVEN WHEN Mission Log
 * dual-write is off (the link is a soft legacy-id text, never an FK, so an empty
 * Supabase stays valid). `service_row_legacy_id` is carried FLAT for later
 * delete-guard / cut-over parity.
 *
 * ALLOCATIONS CLASSIFY TIME ONLY: the `is_payroll_relevant` / `is_invoice_relevant`
 * / `is_billable` flags reconstruct the billable / non-billable / payroll /
 * invoice split — they do NOT create payroll basis or invoice basis here.
 */
import type { TimeReport } from "@/types";
import type {
  FlagResolutionStatus,
  InvoiceBasisStatus,
  PayrollApprovalStatus,
  TimeAllocationType,
  TimeReportStatus,
} from "@/types/timeReporting";
import {
  buildMissionLogEntryLegacyId,
  buildMissionOccurrenceLegacyId,
  buildMissionStaffSessionLegacyId,
} from "./missionLogMigration";

/** The minimal work-order context a checkout {@link TimeReport} does not carry. */
export interface TimeReportingCheckoutContext {
  /** App-facing customer legacy id (from the owning work order). */
  customerId: string;
  /** Optional customer name snapshot at checkout time. */
  customerNameSnapshot?: string;
}

// ── Deterministic id derivation ─────────────────────────────────────────────
//
// Every id is a pure function of stable legacy inputs so a retried dual-write
// targets the SAME rows (idempotent upsert / ignore) and can never duplicate.

/** The time-report legacy id — one authoritative report per legacy checkout. */
export function buildTimeReportLegacyId(report: TimeReport): string {
  return `treport:${report.id}`;
}

/** The scheduled-time allocation legacy id (always present per report). */
export function buildScheduledAllocationLegacyId(report: TimeReport): string {
  return `alloc:${report.id}:scheduled`;
}

/** The billable-deviation allocation legacy id (present only when minutes > 0). */
export function buildBillableDeviationAllocationLegacyId(report: TimeReport): string {
  return `alloc:${report.id}:billable_deviation`;
}

/** The internal/non-billable-deviation allocation legacy id (only when minutes > 0). */
export function buildInternalDeviationAllocationLegacyId(report: TimeReport): string {
  return `alloc:${report.id}:internal_deviation`;
}

/**
 * Stable idempotency key for the submitted event — a pure function of the legacy
 * report id, so a retried mirror inserts the SAME event (ignored on conflict),
 * never a drifting duplicate.
 */
export function buildSubmittedEventIdempotencyKey(report: TimeReport): string {
  return `time_report_submitted:${report.id}`;
}

/** The time-report event legacy id (unique insert key for the submitted event). */
export function buildSubmittedEventLegacyId(report: TimeReport): string {
  return `tr_event:${report.id}:submitted`;
}

/** The admin-review flag legacy id — at most one flag per legacy checkout. */
export function buildAdminReviewFlagLegacyId(report: TimeReport): string {
  return `tr_flag:${report.id}:admin_review`;
}

/** The flag-opened event legacy id (unique insert key for the open event). */
export function buildFlagOpenedEventLegacyId(report: TimeReport): string {
  return `tr_flag_event:${report.id}:opened`;
}

/**
 * Stable idempotency key for the flag-opened event — a pure function of the
 * legacy report id, so a retried mirror inserts the SAME event (ignored on
 * conflict), never a drifting duplicate.
 */
export function buildFlagOpenedEventIdempotencyKey(report: TimeReport): string {
  return `time_report_flag_opened:${report.id}`;
}

/** The checkout-comment message legacy id (unique insert key for the message). */
export function buildCheckoutMessageLegacyId(report: TimeReport): string {
  return `tr_msg:${report.id}:checkout_comment`;
}

/**
 * Stable idempotency key for the checkout-comment message — a pure function of
 * the legacy report id, so a retried mirror inserts the SAME message (ignored on
 * conflict), never a drifting duplicate.
 */
export function buildCheckoutMessageIdempotencyKey(report: TimeReport): string {
  return `time_report_checkout_comment:${report.id}`;
}

// ── Derived status mapping ──────────────────────────────────────────────────

/**
 * Maps the legacy approval routing onto the new {@link TimeReportStatus}:
 *   • `auto_approved`          → `auto_approved`
 *   • `pending_admin_approval` → `admin_review_required`
 */
export function deriveTimeReportStatus(report: TimeReport): TimeReportStatus {
  return report.approvalStatus === "auto_approved"
    ? "auto_approved"
    : "admin_review_required";
}

/** Whether the report needs admin review (anything not auto-approved). */
export function deriveRequiresAdminReview(report: TimeReport): boolean {
  return report.approvalStatus !== "auto_approved";
}

/**
 * Whether this checkout should raise an admin-review flag. A flag is created
 * ONLY when the report routes to admin review (pending_admin_approval) — an
 * auto-approved checkout never raises a flag. Flag resolution is tracked
 * SEPARATELY from approval, so a flag stays `open` even once the report is
 * approved.
 */
export function shouldCreateAdminReviewFlag(report: TimeReport): boolean {
  return report.approvalStatus !== "auto_approved";
}

/**
 * The checkout comment to preserve as a message, or null when there is nothing
 * real to keep. Only a non-empty (trimmed) {@link TimeReport.deviationComment}
 * produces a message — an empty/whitespace comment never fabricates one.
 */
export function getCheckoutMessageText(report: TimeReport): string | null {
  const text = report.deviationComment?.trim();
  return text ? text : null;
}

/** Payroll readiness at checkout — always `not_ready` (no payroll basis here). */
const CHECKOUT_PAYROLL_STATUS: PayrollApprovalStatus = "not_ready";
/** Invoice-basis readiness at checkout — always `not_ready` (no invoice basis here). */
const CHECKOUT_INVOICE_STATUS: InvoiceBasisStatus = "not_ready";

// ── Row shapes ──────────────────────────────────────────────────────────────

/** A `time_reports` upsert row (flat columns + lossless `data` jsonb). */
export interface TimeReportUpsertRow {
  legacy_id: string;
  company_id: string | null;
  company_legacy_id: string;
  mission_log_entry_legacy_id: string;
  mission_staff_session_legacy_id: string;
  booking_legacy_id: string | null;
  booking_occurrence_legacy_id: string | null;
  work_order_legacy_id: string | null;
  service_row_legacy_id: string | null;
  customer_legacy_id: string | null;
  employee_legacy_id: string | null;
  customer_name_snapshot: string | null;
  employee_name_snapshot: string | null;
  scheduled_start_time: string | null;
  scheduled_end_time: string | null;
  scheduled_duration_minutes: number;
  actual_duration_minutes: number;
  total_deviation_minutes: number;
  status: TimeReportStatus;
  payroll_approval_status: PayrollApprovalStatus;
  invoice_basis_status: InvoiceBasisStatus;
  requires_admin_review: boolean;
  /** No flag exists yet in Slice 2c-2a — kept null (flags arrive in 2c-2b). */
  flag_resolution_status: string | null;
  /** ADVISORY ONLY — always null; AI never decides. */
  ai_recommendation: string | null;
  submitted_at: string;
  data: Record<string, unknown>;
  /** Always null on upsert — an upsert UNDELETES the row. */
  deleted_at: string | null;
}

/** A `time_allocations` upsert row (flat columns + lossless `data` jsonb). */
export interface TimeAllocationUpsertRow {
  legacy_id: string;
  company_id: string | null;
  company_legacy_id: string;
  time_report_legacy_id: string;
  mission_log_entry_legacy_id: string;
  employee_legacy_id: string | null;
  allocation_type: TimeAllocationType;
  minutes: number;
  reason_code_legacy_id: string | null;
  is_payroll_relevant: boolean;
  is_invoice_relevant: boolean;
  is_billable: boolean;
  created_by_actor_type: string;
  created_by_actor_id: string | null;
  data: Record<string, unknown>;
  /** Always null on upsert — an upsert UNDELETES the row. */
  deleted_at: string | null;
}

/** A `time_report_events` INSERT row (immutable, append-only). */
export interface TimeReportEventInsertRow {
  legacy_id: string;
  company_id: string | null;
  company_legacy_id: string;
  time_report_legacy_id: string;
  event_type: string;
  actor_type: string;
  actor_id: string | null;
  correlation_id: string | null;
  idempotency_key: string;
  schema_version: number;
  data: Record<string, unknown>;
  occurred_at: string;
}

/**
 * A `time_report_flags` upsert row (flat columns + lossless `data` jsonb). The
 * flag's `resolution_status` lifecycle is tracked SEPARATELY from the report's
 * approval status. Inserted ONCE per checkout (insert-ignore on `legacy_id`) so
 * a retried mirror never clobbers a later admin resolution.
 */
export interface TimeReportFlagUpsertRow {
  legacy_id: string;
  company_id: string | null;
  company_legacy_id: string;
  time_report_legacy_id: string;
  mission_log_entry_legacy_id: string;
  flag_type: string;
  resolution_status: FlagResolutionStatus;
  severity: string | null;
  resolved_by_actor_id: string | null;
  resolved_at: string | null;
  data: Record<string, unknown>;
  /** Always null on insert. */
  deleted_at: string | null;
}

/** A `time_report_flag_events` INSERT row (immutable, append-only). */
export interface TimeReportFlagEventInsertRow {
  legacy_id: string;
  company_id: string | null;
  company_legacy_id: string;
  time_report_flag_legacy_id: string;
  time_report_legacy_id: string;
  event_type: string;
  from_resolution_status: FlagResolutionStatus | null;
  to_resolution_status: FlagResolutionStatus | null;
  actor_type: string;
  actor_id: string | null;
  idempotency_key: string;
  schema_version: number;
  data: Record<string, unknown>;
  occurred_at: string;
}

/** A `time_report_messages` INSERT row (immutable, append-only). */
export interface TimeReportMessageInsertRow {
  legacy_id: string;
  company_id: string | null;
  company_legacy_id: string;
  time_report_legacy_id: string;
  sender_type: string;
  sender_id: string | null;
  message: string;
  idempotency_key: string;
  schema_version: number;
  data: Record<string, unknown>;
}

// ── Mappers ─────────────────────────────────────────────────────────────────

/**
 * Maps a checkout {@link TimeReport} to its `time_reports` upsert row. Payroll
 * and invoice statuses stay `not_ready`; `ai_recommendation` and
 * `flag_resolution_status` are null. The `data` jsonb is a lossless new-model
 * snapshot plus the complete legacy report for safe later reconstruction.
 */
export function toTimeReportUpsertRow(
  report: TimeReport,
  context: TimeReportingCheckoutContext,
  companyUuid: string | null,
): TimeReportUpsertRow {
  const legacyId = buildTimeReportLegacyId(report);
  const status = deriveTimeReportStatus(report);
  const requiresAdminReview = deriveRequiresAdminReview(report);
  const missionLogEntryLegacyId = buildMissionLogEntryLegacyId(report);
  const missionStaffSessionLegacyId = buildMissionStaffSessionLegacyId(report);

  return {
    legacy_id: legacyId,
    company_id: companyUuid,
    company_legacy_id: report.companyId,
    mission_log_entry_legacy_id: missionLogEntryLegacyId,
    mission_staff_session_legacy_id: missionStaffSessionLegacyId,
    booking_legacy_id: report.workOrderId,
    booking_occurrence_legacy_id: buildMissionOccurrenceLegacyId(report),
    work_order_legacy_id: report.workOrderId,
    service_row_legacy_id: report.serviceRowId ?? null,
    customer_legacy_id: context.customerId,
    employee_legacy_id: report.employeeId ?? null,
    customer_name_snapshot: context.customerNameSnapshot ?? null,
    employee_name_snapshot: report.employeeName,
    scheduled_start_time: null,
    scheduled_end_time: null,
    scheduled_duration_minutes: report.scheduledMinutes,
    actual_duration_minutes: report.actualMinutes,
    total_deviation_minutes: report.deviationMinutes,
    status,
    payroll_approval_status: CHECKOUT_PAYROLL_STATUS,
    invoice_basis_status: CHECKOUT_INVOICE_STATUS,
    requires_admin_review: requiresAdminReview,
    // When a flag is created the denormalised rollup starts at `open` (still
    // SEPARATE from approval); an auto-approved checkout raises no flag → null.
    flag_resolution_status: shouldCreateAdminReviewFlag(report) ? "open" : null,
    ai_recommendation: null,
    submitted_at: report.submittedAt,
    data: {
      source: "checkout_dual_write",
      // New-model snapshot (lossless reconstruction target).
      id: legacyId,
      companyId: report.companyId,
      missionLogEntryId: missionLogEntryLegacyId,
      missionStaffSessionId: missionStaffSessionLegacyId,
      bookingId: report.workOrderId,
      workOrderId: report.workOrderId,
      serviceRowId: report.serviceRowId ?? null,
      customerId: context.customerId,
      customerNameSnapshot: context.customerNameSnapshot ?? "",
      employeeId: report.employeeId,
      employeeNameSnapshot: report.employeeName,
      jobName: report.jobName,
      scheduledDurationMinutes: report.scheduledMinutes,
      actualDurationMinutes: report.actualMinutes,
      totalDeviationMinutes: report.deviationMinutes,
      billableDeviationMinutes: report.billableDeviationMinutes,
      nonBillableDeviationMinutes: report.internalDeviationMinutes,
      status,
      payrollApprovalStatus: CHECKOUT_PAYROLL_STATUS,
      invoiceBasisStatus: CHECKOUT_INVOICE_STATUS,
      requiresAdminReview,
      submittedAt: report.submittedAt,
      createdAt: report.createdAt,
      updatedAt: report.updatedAt,
      // Lossless legacy snapshot.
      legacyTimeReport: report,
    },
    deleted_at: null,
  };
}

/**
 * Maps a checkout {@link TimeReport} to its classified `time_allocations` rows.
 *
 * The SCHEDULED allocation is ALWAYS produced (even at 0 minutes) so every
 * mirrored report has a stable base allocation. The billable / internal
 * deviation allocations are produced ONLY when their minutes are > 0 (zero-minute
 * deviation slices are skipped). Allocations classify time only — they never
 * create payroll or invoice basis.
 */
export function toTimeAllocationUpsertRows(
  report: TimeReport,
  companyUuid: string | null,
): TimeAllocationUpsertRow[] {
  const base = {
    company_id: companyUuid,
    company_legacy_id: report.companyId,
    time_report_legacy_id: buildTimeReportLegacyId(report),
    mission_log_entry_legacy_id: buildMissionLogEntryLegacyId(report),
    employee_legacy_id: report.employeeId ?? null,
    reason_code_legacy_id: null,
    created_by_actor_type: "system",
    created_by_actor_id: null,
    deleted_at: null,
  } as const;

  const rows: TimeAllocationUpsertRow[] = [
    {
      ...base,
      legacy_id: buildScheduledAllocationLegacyId(report),
      allocation_type: "scheduled_billable",
      minutes: report.scheduledMinutes,
      is_payroll_relevant: true,
      is_invoice_relevant: true,
      is_billable: true,
      data: {
        source: "checkout_dual_write",
        slice: "scheduled",
        legacyTimeReportId: report.id,
        minutes: report.scheduledMinutes,
      },
    },
  ];

  if (report.billableDeviationMinutes > 0) {
    rows.push({
      ...base,
      legacy_id: buildBillableDeviationAllocationLegacyId(report),
      allocation_type: "extra_billable",
      minutes: report.billableDeviationMinutes,
      is_payroll_relevant: true,
      is_invoice_relevant: true,
      is_billable: true,
      data: {
        source: "checkout_dual_write",
        slice: "billable_deviation",
        legacyTimeReportId: report.id,
        minutes: report.billableDeviationMinutes,
      },
    });
  }

  if (report.internalDeviationMinutes > 0) {
    rows.push({
      ...base,
      legacy_id: buildInternalDeviationAllocationLegacyId(report),
      allocation_type: "internal_non_billable",
      minutes: report.internalDeviationMinutes,
      is_payroll_relevant: true,
      is_invoice_relevant: false,
      is_billable: false,
      data: {
        source: "checkout_dual_write",
        slice: "internal_deviation",
        legacyTimeReportId: report.id,
        minutes: report.internalDeviationMinutes,
      },
    });
  }

  return rows;
}

/**
 * Maps a checkout {@link TimeReport} to its IMMUTABLE `time_report_submitted`
 * event row. `occurred_at` is the checkout time; `idempotency_key` is stable per
 * legacy report so retries are de-duplicated on insert.
 */
export function toTimeReportSubmittedEventInsertRow(
  report: TimeReport,
  companyUuid: string | null,
): TimeReportEventInsertRow {
  return {
    legacy_id: buildSubmittedEventLegacyId(report),
    company_id: companyUuid,
    company_legacy_id: report.companyId,
    time_report_legacy_id: buildTimeReportLegacyId(report),
    event_type: "time_report_submitted",
    actor_type: "employee",
    actor_id: report.employeeId ?? null,
    correlation_id: report.id,
    idempotency_key: buildSubmittedEventIdempotencyKey(report),
    schema_version: 1,
    data: {
      source: "checkout_dual_write",
      legacyTimeReportId: report.id,
      jobName: report.jobName,
      scheduledMinutes: report.scheduledMinutes,
      actualMinutes: report.actualMinutes,
      deviationMinutes: report.deviationMinutes,
      billableDeviationMinutes: report.billableDeviationMinutes,
      internalDeviationMinutes: report.internalDeviationMinutes,
      approvalStatus: report.approvalStatus,
      status: deriveTimeReportStatus(report),
      submittedAt: report.submittedAt,
    },
    occurred_at: report.submittedAt,
  };
}

/** The flag type a deviation/admin-review checkout flag carries. */
export const ADMIN_REVIEW_FLAG_TYPE = "deviation_review" as const;

/**
 * Maps a checkout {@link TimeReport} that requires admin review to its ONE
 * `time_report_flags` row. Caller MUST gate on {@link shouldCreateAdminReviewFlag}
 * (an auto-approved checkout never raises a flag). The flag is inserted ONCE
 * (insert-ignore on `legacy_id`) at `resolution_status: "open"` — tracked
 * SEPARATELY from approval — so a retried mirror never clobbers a later admin
 * resolution. No severity is fabricated.
 */
export function toTimeReportFlagUpsertRow(
  report: TimeReport,
  companyUuid: string | null,
): TimeReportFlagUpsertRow {
  return {
    legacy_id: buildAdminReviewFlagLegacyId(report),
    company_id: companyUuid,
    company_legacy_id: report.companyId,
    time_report_legacy_id: buildTimeReportLegacyId(report),
    mission_log_entry_legacy_id: buildMissionLogEntryLegacyId(report),
    flag_type: ADMIN_REVIEW_FLAG_TYPE,
    resolution_status: "open",
    severity: null,
    resolved_by_actor_id: null,
    resolved_at: null,
    data: {
      source: "checkout_dual_write",
      legacyTimeReportId: report.id,
      flagType: ADMIN_REVIEW_FLAG_TYPE,
      resolutionStatus: "open",
      approvalStatus: report.approvalStatus,
      deviationMinutes: report.deviationMinutes,
      deviationReason: report.deviationReason ?? null,
      createdAt: report.submittedAt,
    },
    deleted_at: null,
  };
}

/**
 * Maps a checkout {@link TimeReport} flag to its IMMUTABLE `flag_opened`
 * `time_report_flag_events` row. Caller MUST gate on {@link
 * shouldCreateAdminReviewFlag}. `idempotency_key` is stable per legacy report so
 * retries are de-duplicated on insert; the transition is null → `open`.
 */
export function toTimeReportFlagOpenedEventInsertRow(
  report: TimeReport,
  companyUuid: string | null,
): TimeReportFlagEventInsertRow {
  return {
    legacy_id: buildFlagOpenedEventLegacyId(report),
    company_id: companyUuid,
    company_legacy_id: report.companyId,
    time_report_flag_legacy_id: buildAdminReviewFlagLegacyId(report),
    time_report_legacy_id: buildTimeReportLegacyId(report),
    event_type: "flag_opened",
    from_resolution_status: null,
    to_resolution_status: "open",
    actor_type: "system",
    actor_id: null,
    idempotency_key: buildFlagOpenedEventIdempotencyKey(report),
    schema_version: 1,
    data: {
      source: "checkout_dual_write",
      legacyTimeReportId: report.id,
      flagType: ADMIN_REVIEW_FLAG_TYPE,
      toResolutionStatus: "open",
      occurredAt: report.submittedAt,
    },
    occurred_at: report.submittedAt,
  };
}

/**
 * Maps a checkout {@link TimeReport} carrying a real deviation comment to its ONE
 * IMMUTABLE `time_report_messages` row. Caller MUST gate on {@link
 * getCheckoutMessageText} (an empty/whitespace comment never fabricates a
 * message). The employee is the sender; `idempotency_key` is stable per legacy
 * report so retries are de-duplicated on insert.
 */
export function toTimeReportCheckoutMessageInsertRow(
  report: TimeReport,
  message: string,
  companyUuid: string | null,
): TimeReportMessageInsertRow {
  return {
    legacy_id: buildCheckoutMessageLegacyId(report),
    company_id: companyUuid,
    company_legacy_id: report.companyId,
    time_report_legacy_id: buildTimeReportLegacyId(report),
    sender_type: "employee",
    sender_id: report.employeeId ?? null,
    message,
    idempotency_key: buildCheckoutMessageIdempotencyKey(report),
    schema_version: 1,
    data: {
      source: "checkout_dual_write",
      legacyTimeReportId: report.id,
      senderType: "employee",
      deviationReason: report.deviationReason ?? null,
      createdAt: report.submittedAt,
    },
  };
}
