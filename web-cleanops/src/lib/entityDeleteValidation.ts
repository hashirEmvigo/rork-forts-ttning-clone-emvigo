/**
 * Delete / archive protection for whole Customers and Employees.
 *
 * Operational principle:
 * - A customer or employee that has NEVER participated in operations may be
 *   permanently deleted (the record and its non-operational data are removed).
 * - Once operational history exists, the record must be ARCHIVED instead so the
 *   history stays preserved.
 *
 * Every validator here is pure: the caller resolves the dependency counts from
 * shared dependency contexts (Supabase for customer lifecycle decisions; local
 * stores only where the entity has not been cut over yet) and passes them in.
 * This keeps the rules in one place and easily testable, mirroring
 * {@link import("./workOrderDelete")}.
 */

// ── Customers ──────────────────────────────────────────────────────────────

/**
 * Operational dependencies attached to a customer. A customer may only be
 * permanently deleted when BOTH counts are zero (no Work Orders / AO and no
 * Missions / scheduled visits).
 */
export interface CustomerDeleteContext {
  /** Active, non-deleted Work Orders (AO) linked to this customer. */
  workOrderCount: number;
  /** Aggregate operational execution/planning records for this customer. */
  missionCount: number;
  /** Optional detail: active, non-deleted booking_queue rows. */
  bookingQueueCount?: number;
  /** Optional detail: active, non-deleted mission_log_entries rows. */
  missionLogEntryCount?: number;
  /** Optional detail: active, non-deleted time_reports rows. */
  timeReportCount?: number;
}

/** Which kind of operational history blocked a customer delete. */
export type CustomerDeleteBlockFactor = "has_work_orders" | "has_missions";

/** Human-readable explanation for each customer delete block factor. */
export const CUSTOMER_DELETE_BLOCK_FACTOR_LABELS: Record<
  CustomerDeleteBlockFactor,
  string
> = {
  has_work_orders: "This customer has one or more work orders.",
  has_missions: "This customer has bookings, missions, or time reports.",
};

/** Message shown when a customer has history and must be archived, not deleted. */
export const CUSTOMER_DELETE_BLOCKED_MESSAGE =
  "This customer has operational history and cannot be permanently deleted. Archive the customer instead to preserve the record.";

export interface EntityDeleteValidationResult {
  /** Whether a permanent delete is currently permitted. */
  allowed: boolean;
  /** Stable factor codes that block deletion (empty when allowed). */
  blockingFactors: string[];
  /** Human-readable reasons, aligned 1:1 with {@link blockingFactors}. */
  reasons: string[];
  /** Single summary message shown when deletion is blocked. */
  blockedMessage?: string;
}

/**
 * Validates whether a customer may be permanently deleted. Deletion is blocked
 * the moment ANY shared backend work order, booking, mission, or time report
 * exists; the caller must then archive the customer instead.
 */
export function validateCustomerDelete(
  context: CustomerDeleteContext,
): EntityDeleteValidationResult {
  const factors: CustomerDeleteBlockFactor[] = [];
  if (context.workOrderCount > 0) factors.push("has_work_orders");
  if (context.missionCount > 0) factors.push("has_missions");
  const allowed = factors.length === 0;
  return {
    allowed,
    blockingFactors: factors,
    reasons: factors.map((f) => CUSTOMER_DELETE_BLOCK_FACTOR_LABELS[f]),
    blockedMessage: allowed ? undefined : CUSTOMER_DELETE_BLOCKED_MESSAGE,
  };
}

// ── Employees ─────────────────────────────────────────────────────────────

/**
 * Operational dependencies attached to an employee. An employee may only be
 * permanently deleted when BOTH counts are zero (no completed missions and no
 * future assigned missions).
 */
export interface EmployeeDeleteContext {
  /** Completed missions: time reports the employee has produced. */
  completedMissionCount: number;
  /** Future assigned missions: upcoming visits the employee is staffed on. */
  futureAssignedMissionCount: number;
}

/** Which kind of operational history blocked an employee delete. */
export type EmployeeDeleteBlockFactor =
  | "has_completed_missions"
  | "has_future_missions";

/** Human-readable explanation for each employee delete block factor. */
export const EMPLOYEE_DELETE_BLOCK_FACTOR_LABELS: Record<
  EmployeeDeleteBlockFactor,
  string
> = {
  has_completed_missions: "This employee has completed missions.",
  has_future_missions: "This employee has future assigned missions.",
};

/** Message shown when an employee has history and must be archived, not deleted. */
export const EMPLOYEE_DELETE_BLOCKED_MESSAGE =
  "This employee has operational history and cannot be permanently deleted. Archive the employee instead to preserve the record.";

/**
 * Validates whether an employee may be permanently deleted. Deletion is blocked
 * the moment ANY completed mission or future assigned mission exists; the caller
 * must then archive the employee instead.
 */
export function validateEmployeeDelete(
  context: EmployeeDeleteContext,
): EntityDeleteValidationResult {
  const factors: EmployeeDeleteBlockFactor[] = [];
  if (context.completedMissionCount > 0) factors.push("has_completed_missions");
  if (context.futureAssignedMissionCount > 0) factors.push("has_future_missions");
  const allowed = factors.length === 0;
  return {
    allowed,
    blockingFactors: factors,
    reasons: factors.map((f) => EMPLOYEE_DELETE_BLOCK_FACTOR_LABELS[f]),
    blockedMessage: allowed ? undefined : EMPLOYEE_DELETE_BLOCKED_MESSAGE,
  };
}
