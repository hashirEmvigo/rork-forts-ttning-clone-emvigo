/**
 * Mission Log checkout dual-write mappers (Slice 2c-1).
 *
 * The mapping layer the Mission Log checkout dual-write ({@link
 * import("./missionLogDualWrite")}) writes through — the Mission Log analogue of
 * the `to*UpsertRow` convention used by every other migration mapper
 * (`teamMigration` / `customerMigration` / `activityMigration`). It turns ONE
 * legacy checkout {@link TimeReport} (plus the small bit of work-order context
 * not carried on the report) into the three Mission Log rows the execution
 * ledger records for a checkout:
 *
 *   1. ONE `mission_log_entries` row   — upsert, one per mission / service-row
 *      context (idempotent on the deterministic entry legacy id).
 *   2. ONE `mission_staff_sessions` row — upsert, one per legacy checkout/report
 *      (Option B id: includes the legacy report id so a second checkout by the
 *      same employee for the same mission is a DISTINCT session, never merged).
 *   3. ONE `mission_log_events` row     — IMMUTABLE `employee_checked_out` event,
 *      inserted with `ignoreDuplicates` on a stable idempotency key so retries
 *      never duplicate and never mutate an existing event row.
 *
 * SCOPE — this file is pure mapping + deterministic id derivation. It performs NO
 * I/O, reads NO flags and never throws. It writes ONLY the three Mission Log
 * tables above; it never produces `mission_booked_time_ratings`, any Time
 * Reporting row, payroll/invoice basis or time-bank effects. All cross-entity
 * references are soft legacy-id text (never FKs) so an empty Supabase stays
 * valid; `service_row_legacy_id` is carried FLAT for later delete-guard parity.
 */
import type { TimeReport } from "@/types";
import type {
  DelayStatus,
  MissionStatus,
  StaffSessionStatus,
} from "@/types/missionLog";

/** The minimal work-order context a checkout {@link TimeReport} does not carry. */
export interface MissionLogCheckoutContext {
  /** App-facing customer legacy id (from the owning work order). */
  customerId: string;
  /** Optional customer name snapshot at checkout time. */
  customerNameSnapshot?: string;
}

// ── Deterministic id derivation ─────────────────────────────────────────────
//
// Every id is a pure function of stable legacy inputs so a retried dual-write
// targets the SAME rows (idempotent upsert / ignore) and can never duplicate.

/**
 * The Mission Log entry legacy id — one mission / service-row context per work
 * order. Soft + idempotent: a second checkout for the same job upserts the same
 * entry. Service-row-less checkouts collapse onto the work-order-level mission.
 */
export function buildMissionLogEntryLegacyId(report: TimeReport): string {
  return `mission:${report.workOrderId}:${report.serviceRowId ?? "wo"}`;
}

/**
 * The synthesized soft booking-occurrence id for a checkout-derived mission.
 * Checkout has no real planned occurrence yet, so this mirrors the entry scope;
 * a later wave can reconcile it to the authoritative visit occurrence.
 */
export function buildMissionOccurrenceLegacyId(report: TimeReport): string {
  return `occ:${report.workOrderId}:${report.serviceRowId ?? "wo"}`;
}

/**
 * The staff-session legacy id — Option B (per legacy report/checkout).
 *
 * It includes the legacy {@link TimeReport} id so the SAME employee producing a
 * second checkout for the same mission/service row creates a DISTINCT session
 * rather than silently overwriting the first. Retrying the SAME checkout reuses
 * the same id (idempotent upsert converges, never duplicates).
 */
export function buildMissionStaffSessionLegacyId(report: TimeReport): string {
  const employee = report.employeeId ?? "unknown";
  return `session:${buildMissionLogEntryLegacyId(report)}:${employee}:${report.id}`;
}

/**
 * Stable idempotency key for the checkout event — a pure function of the legacy
 * report id, so a retried mirror inserts the SAME event (ignored on conflict),
 * never a drifting duplicate.
 */
export function buildCheckoutEventIdempotencyKey(report: TimeReport): string {
  return `checked_out:${report.id}`;
}

/** The Mission Log event legacy id (unique insert key for the checkout event). */
export function buildCheckoutEventLegacyId(report: TimeReport): string {
  return `event:${buildMissionLogEntryLegacyId(report)}:${buildCheckoutEventIdempotencyKey(report)}`;
}

// ── Derived flat summary state ──────────────────────────────────────────────

/**
 * Derives the operational delay status from the only signal a checkout carries:
 * actual vs. scheduled minutes. No Schedule data is mutated or inferred beyond
 * this comparison.
 */
export function deriveDelayStatusFromCheckout(report: TimeReport): DelayStatus {
  if (report.actualMinutes > report.scheduledMinutes) return "over_time";
  if (report.actualMinutes < report.scheduledMinutes) return "early_finish";
  return "on_time";
}

/**
 * A checkout means the mission was executed, so the entry is recorded as
 * `completed`. (Mission Log never back-mutates Schedule from this.)
 */
const CHECKOUT_MISSION_STATUS: MissionStatus = "completed";

// ── Row shapes ──────────────────────────────────────────────────────────────

/** A `mission_log_entries` upsert row (flat columns + lossless `data` jsonb). */
export interface MissionLogEntryUpsertRow {
  legacy_id: string;
  company_id: string | null;
  company_legacy_id: string;
  booking_legacy_id: string;
  booking_occurrence_legacy_id: string;
  work_order_legacy_id: string | null;
  service_row_legacy_id: string | null;
  customer_legacy_id: string | null;
  scheduled_start_time: string | null;
  scheduled_end_time: string | null;
  mission_status: MissionStatus;
  delay_status: DelayStatus;
  requires_admin_review: boolean;
  data: Record<string, unknown>;
  /** Always null on upsert — an upsert UNDELETES the row. */
  deleted_at: string | null;
}

/** A `mission_staff_sessions` upsert row (flat columns + lossless `data` jsonb). */
export interface MissionStaffSessionUpsertRow {
  legacy_id: string;
  company_id: string | null;
  company_legacy_id: string;
  mission_log_entry_legacy_id: string;
  employee_legacy_id: string;
  status: StaffSessionStatus;
  check_in_method: string;
  check_out_method: string;
  actual_check_in_time: string | null;
  actual_check_out_time: string | null;
  data: Record<string, unknown>;
  /** Always null on upsert — an upsert UNDELETES the row. */
  deleted_at: string | null;
}

/** A `mission_log_events` INSERT row (immutable, append-only). */
export interface MissionLogEventInsertRow {
  legacy_id: string;
  company_id: string | null;
  company_legacy_id: string;
  mission_log_entry_legacy_id: string;
  event_type: string;
  actor_type: string;
  actor_id: string | null;
  correlation_id: string | null;
  idempotency_key: string;
  schema_version: number;
  data: Record<string, unknown>;
  occurred_at: string;
}

// ── Mappers ─────────────────────────────────────────────────────────────────

/**
 * Maps a checkout {@link TimeReport} to its `mission_log_entries` upsert row.
 * `requires_admin_review` mirrors the legacy approval routing (anything not
 * auto-approved needs review). Scheduled timestamps are left null — checkout
 * carries only scheduled MINUTES, never the planned start/end instants.
 */
export function toMissionLogEntryUpsertRow(
  report: TimeReport,
  context: MissionLogCheckoutContext,
  companyUuid: string | null,
): MissionLogEntryUpsertRow {
  const entryLegacyId = buildMissionLogEntryLegacyId(report);
  return {
    legacy_id: entryLegacyId,
    company_id: companyUuid,
    company_legacy_id: report.companyId,
    booking_legacy_id: report.workOrderId,
    booking_occurrence_legacy_id: buildMissionOccurrenceLegacyId(report),
    work_order_legacy_id: report.workOrderId,
    service_row_legacy_id: report.serviceRowId ?? null,
    customer_legacy_id: context.customerId,
    scheduled_start_time: null,
    scheduled_end_time: null,
    mission_status: CHECKOUT_MISSION_STATUS,
    delay_status: deriveDelayStatusFromCheckout(report),
    requires_admin_review: report.approvalStatus !== "auto_approved",
    data: {
      source: "checkout_dual_write",
      legacyTimeReportId: report.id,
      workOrderId: report.workOrderId,
      serviceRowId: report.serviceRowId ?? null,
      customerId: context.customerId,
      customerNameSnapshot: context.customerNameSnapshot ?? "",
      jobName: report.jobName,
      scheduledMinutes: report.scheduledMinutes,
      actualMinutes: report.actualMinutes,
      deviationMinutes: report.deviationMinutes,
      approvalStatus: report.approvalStatus,
      submittedAt: report.submittedAt,
    },
    deleted_at: null,
  };
}

/**
 * Maps a checkout {@link TimeReport} to its `mission_staff_sessions` upsert row.
 * Records ONLY the facts a checkout actually provides: the employee, the
 * check-out time and a manual check-out method. No GPS/QR coordinates or
 * check-in are fabricated (check-in stays `missing`).
 */
export function toMissionStaffSessionUpsertRow(
  report: TimeReport,
  companyUuid: string | null,
): MissionStaffSessionUpsertRow {
  return {
    legacy_id: buildMissionStaffSessionLegacyId(report),
    company_id: companyUuid,
    company_legacy_id: report.companyId,
    mission_log_entry_legacy_id: buildMissionLogEntryLegacyId(report),
    employee_legacy_id: report.employeeId ?? "unknown",
    status: "checked_out",
    check_in_method: "missing",
    check_out_method: "manual",
    actual_check_in_time: null,
    actual_check_out_time: report.submittedAt,
    data: {
      source: "checkout_dual_write",
      legacyTimeReportId: report.id,
      employeeId: report.employeeId,
      employeeNameSnapshot: report.employeeName,
      scheduledMinutes: report.scheduledMinutes,
      actualMinutes: report.actualMinutes,
      deviationMinutes: report.deviationMinutes,
      checkOutMethod: "manual",
    },
    deleted_at: null,
  };
}

/**
 * Maps a checkout {@link TimeReport} to its IMMUTABLE `employee_checked_out`
 * event row. `occurred_at` is the checkout time; `idempotency_key` is stable per
 * legacy report so retries are de-duplicated on insert.
 */
export function toMissionCheckoutEventInsertRow(
  report: TimeReport,
  companyUuid: string | null,
): MissionLogEventInsertRow {
  return {
    legacy_id: buildCheckoutEventLegacyId(report),
    company_id: companyUuid,
    company_legacy_id: report.companyId,
    mission_log_entry_legacy_id: buildMissionLogEntryLegacyId(report),
    event_type: "employee_checked_out",
    actor_type: "employee",
    actor_id: report.employeeId ?? null,
    correlation_id: report.id,
    idempotency_key: buildCheckoutEventIdempotencyKey(report),
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
      submittedAt: report.submittedAt,
    },
    occurred_at: report.submittedAt,
  };
}
