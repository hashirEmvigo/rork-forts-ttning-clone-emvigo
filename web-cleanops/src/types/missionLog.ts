/**
 * Operational Execution — Mission Log type foundations (Phase 1).
 *
 * Mission Log is the operational *execution ledger*: what was planned vs. what
 * actually happened on a mission (one planned booking occurrence). It is
 * deliberately separate from Time Reporting (the approval/classification
 * workspace) — Mission Log records execution and emits events; Time Reporting
 * decides how the resulting time is approved and classified.
 *
 * THIS FILE IS TYPE-ONLY FOUNDATION. Nothing here is wired into the UI, the
 * store, Supabase, or AppContext yet, and there is NO behaviour change. These
 * shapes mirror `docs/architecture/30-operational-execution-architecture.md`
 * (§5) so later phases can build the repository, migration and UI against a
 * stable contract.
 *
 * Naming note: this is intentionally NOT re-exported from `@/types` (the index
 * barrel). The legacy checkout `TimeReport` still occupies that namespace and
 * drives a live work-order checkout flow; these new operational-execution types
 * are imported directly from their own module path until the legacy model is
 * cut over in a later (behavioural) wave.
 */

import type { TimeReportStatus } from "./timeReporting";

/** High-level state of a single mission (one planned booking occurrence). */
export type MissionStatus =
  | "scheduled"
  | "not_started"
  | "in_progress"
  | "completed"
  | "missed"
  | "cancelled"
  | "requires_attention";

/** Operational delay/forecast state, derived without mutating the Schedule. */
export type DelayStatus =
  | "on_time"
  | "late_check_in"
  | "over_time"
  | "early_finish"
  | "estimated_delay"
  | "chain_delay_risk"
  | "time_window_breach_risk"
  | "critical_delay";

/**
 * One Mission Log entry represents one planned booking occurrence / mission.
 * Records planned vs. actual vs. projected times and the operational status;
 * links forward to a {@link import("./timeReporting").TimeReport} once one
 * exists. Mission Log never mutates Schedule, payroll or invoices.
 */
export interface MissionLogEntry {
  id: string;
  companyId: string;

  bookingId: string;
  bookingOccurrenceId: string;
  workOrderId?: string;

  customerId: string;
  customerNameSnapshot: string;
  customerAddressSnapshot: string;

  scheduledStartTime: string;
  scheduledEndTime: string;
  scheduledDurationMinutes: number;

  actualStartTime?: string;
  actualEndTime?: string;
  actualDurationMinutes?: number;

  projectedStartTime?: string;
  projectedEndTime?: string;
  projectedDelayMinutes?: number;

  approvedCustomerTimeWindowStart?: string;
  approvedCustomerTimeWindowEnd?: string;
  hasStrictTimeWindow: boolean;

  missionStatus: MissionStatus;
  delayStatus: DelayStatus;

  /** Forward link to the Time Reporting record produced from this mission. */
  timeReportId?: string;
  timeReportStatus?: TimeReportStatus;

  requiresAdminReview: boolean;
  reviewReasonCodes: string[];

  createdAt: string;
  updatedAt: string;
}

/** How an employee's check-in/check-out was captured. */
export type CheckMethod = "gps" | "qr" | "manual" | "missing";

/** Outcome of a location verification attempt at check-in/out. */
export type LocationVerificationStatus =
  | "verified"
  | "warning"
  | "failed"
  | "not_required"
  | "missing";

/** Per-employee session lifecycle within a mission. */
export type StaffSessionStatus =
  | "scheduled"
  | "checked_in"
  | "checked_out"
  | "missing_check_in"
  | "missing_check_out"
  | "manual_review_required";

/**
 * Check-in/check-out is stored per employee so one employee can be on time
 * while another is late — required for accurate delay projection.
 */
export interface MissionStaffSession {
  id: string;
  companyId: string;
  missionLogEntryId: string;

  employeeId: string;
  employeeNameSnapshot: string;

  scheduledStartTime: string;
  scheduledEndTime: string;
  scheduledDurationMinutes: number;

  actualCheckInTime?: string;
  actualCheckOutTime?: string;
  actualDurationMinutes?: number;

  checkInMethod: CheckMethod;
  checkOutMethod: CheckMethod;

  checkInLocationStatus: LocationVerificationStatus;
  checkOutLocationStatus: LocationVerificationStatus;

  checkInLatitude?: number;
  checkInLongitude?: number;
  checkOutLatitude?: number;
  checkOutLongitude?: number;

  qrCheckInCodeId?: string;
  qrCheckOutCodeId?: string;

  status: StaffSessionStatus;

  createdAt: string;
  updatedAt: string;
}

/** Immutable operational events emitted during a mission's lifecycle. */
export type MissionEventType =
  | "mission_created"
  | "mission_started"
  | "mission_completed"
  | "employee_checked_in"
  | "employee_checked_out"
  | "employee_late_check_in"
  | "missing_check_in"
  | "missing_check_out"
  | "gps_verification_failed"
  | "qr_verification_failed"
  | "estimated_delay_detected"
  | "chain_delay_detected"
  | "time_window_breach_risk_detected"
  | "employee_delay_confirmation_requested"
  | "employee_delay_confirmed"
  | "employee_delay_rejected"
  | "customer_delay_update_recommended"
  | "customer_delay_update_sent"
  | "admin_alert_created"
  | "time_report_created"
  | "booked_time_rating_submitted"
  | "low_booked_time_rating_detected"
  | "critical_booked_time_rating_detected";

/** Who triggered a {@link MissionLogEvent}. */
export type MissionActorType = "system" | "employee" | "admin" | "customer";

/**
 * An immutable event in a mission's event stream. Append-only: events are never
 * mutated or removed. `idempotencyKey` lets a later pipeline de-duplicate
 * re-delivered events; `schemaVersion` allows the payload shape to evolve.
 */
export interface MissionLogEvent {
  id: string;
  companyId: string;
  missionLogEntryId: string;

  eventType: MissionEventType;

  actorType: MissionActorType;
  actorId?: string;

  payload: Record<string, unknown>;

  correlationId?: string;
  idempotencyKey?: string;
  schemaVersion: number;

  occurredAt: string;
  createdAt: string;
}

/**
 * Booked-time rating collected at checkout (0 = completely insufficient time,
 * 10 = more than enough). Collection belongs to Mission Log Core; the advanced
 * analysis belongs to the `time_quality_analytics` add-on.
 */
export type BookedTimeRating = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

/** Structured reasons an employee can attach to a booked-time rating. */
export type BookedTimeRatingReason =
  | "too_much_to_clean"
  | "customer_home_was_dirtier_than_expected"
  | "extra_customer_requests"
  | "access_problem"
  | "key_or_entry_problem"
  | "missing_or_wrong_material"
  | "equipment_problem"
  | "customer_interruption"
  | "new_or_unfamiliar_customer"
  | "unclear_work_instructions"
  | "travel_or_parking_problem"
  | "team_understaffed"
  | "employee_inexperienced"
  | "quality_standard_too_high_for_booked_time"
  | "time_was_sufficient"
  | "other";

/** Stored per employee session (not only per mission). */
export interface MissionBookedTimeRating {
  id: string;
  companyId: string;

  missionLogEntryId: string;
  missionStaffSessionId: string;

  bookingId: string;
  bookingOccurrenceId: string;
  workOrderId?: string;

  customerId: string;
  customerNameSnapshot: string;

  employeeId: string;
  employeeNameSnapshot: string;

  scheduledDurationMinutes: number;
  actualDurationMinutes?: number;
  deviationMinutes?: number;
  deviationPercent?: number;

  rating: BookedTimeRating;
  reasonCodes: BookedTimeRatingReason[];

  optionalComment?: string;

  submittedAt: string;
  createdAt: string;
  updatedAt: string;
}
