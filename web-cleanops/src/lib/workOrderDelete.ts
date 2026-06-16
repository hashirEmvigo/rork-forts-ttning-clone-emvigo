import { isForceDeleteConfirmed } from "./archiveValidation";

/**
 * Deletion / archival protection for whole Work Orders.
 *
 * A Work Order is a container for service rows, booking queue items, generated
 * occurrences, occurrence exceptions, variations and time reports. Once any of
 * that schedule data exists, the work order must NEVER be hard-deleted — doing
 * so leaves orphaned bookings on the Schedule Board and broken navigation. It
 * must be archived instead (which removes it from live planning while preserving
 * history). Only a completely empty/test work order may be force-deleted.
 *
 * Every validator here is pure: the caller resolves the related-data counts from
 * the surrounding stores ({@link WorkOrderRelatedData}) and passes them in.
 */

/** Related schedule/history data attached to a work order. */
export interface WorkOrderRelatedData {
  /** Service rows on the work order (archived included). */
  serviceRowCount: number;
  /** Booking queue items linked to any of the work order's rows. */
  bookingItemCount: number;
  /** Generated future occurrences across the work order's live rows. */
  futureOccurrenceCount: number;
  /** Occurrence exceptions (cancel / reschedule) for any of its rows. */
  occurrenceExceptionCount: number;
  /** Recurring variations across the work order's rows. */
  variationCount: number;
  /** Time reports / historical activity referencing any of its rows. */
  timeReportCount: number;
}

/** A zeroed related-data record — the baseline for an empty work order. */
export const EMPTY_WORK_ORDER_RELATED_DATA: WorkOrderRelatedData = {
  serviceRowCount: 0,
  bookingItemCount: 0,
  futureOccurrenceCount: 0,
  occurrenceExceptionCount: 0,
  variationCount: 0,
  timeReportCount: 0,
};

/** Whether a work order has ANY related schedule/history data. */
export function hasRelatedScheduleData(data: WorkOrderRelatedData): boolean {
  return (
    data.serviceRowCount > 0 ||
    data.bookingItemCount > 0 ||
    data.futureOccurrenceCount > 0 ||
    data.occurrenceExceptionCount > 0 ||
    data.variationCount > 0 ||
    data.timeReportCount > 0
  );
}

/** Which kinds of related data blocked a hard delete. */
export type WorkOrderDeleteBlockFactor =
  | "has_service_rows"
  | "has_booking_items"
  | "has_future_occurrences"
  | "has_occurrence_exceptions"
  | "has_variations"
  | "has_time_reports";

/** Human-readable explanation for each delete block factor. */
export const WORK_ORDER_DELETE_BLOCK_FACTOR_LABELS: Record<
  WorkOrderDeleteBlockFactor,
  string
> = {
  has_service_rows: "This work order still has service rows.",
  has_booking_items: "This work order has bookings in Booking Lists.",
  has_future_occurrences: "This work order has future scheduled occurrences.",
  has_occurrence_exceptions:
    "This work order has booking exceptions that must be preserved.",
  has_variations: "This work order has service variations that must be preserved.",
  has_time_reports: "This work order has time reports / historical activity.",
};

export interface WorkOrderDeleteValidationResult {
  /** Whether a hard delete is currently permitted. */
  allowed: boolean;
  /** Stable factor codes that block deletion (empty when allowed). */
  blockingFactors: WorkOrderDeleteBlockFactor[];
  /** Human-readable reasons, aligned 1:1 with {@link blockingFactors}. */
  reasons: string[];
  /** Single summary message shown when deletion is blocked. */
  blockedMessage?: string;
}

/** Message shown when a work order has schedule data and must be archived. */
export const WORK_ORDER_DELETE_BLOCKED_MESSAGE =
  "This work order has bookings or history and cannot be deleted. Archive it instead to remove it from live planning while preserving the record.";

/**
 * Validates whether a whole Work Order may be permanently (hard) deleted.
 *
 * Hard delete exists ONLY to remove a mistaken, empty/test work order that never
 * gained any schedule data. It is blocked the moment any of the following holds:
 * service rows, booking queue items, future occurrences, occurrence exceptions,
 * variations, or time reports exist. When blocked, the work order must be
 * archived (or its future bookings cancelled and then archived) instead.
 */
export function validateWorkOrderDelete(
  data: WorkOrderRelatedData,
): WorkOrderDeleteValidationResult {
  const factors: WorkOrderDeleteBlockFactor[] = [];
  if (data.serviceRowCount > 0) factors.push("has_service_rows");
  if (data.bookingItemCount > 0) factors.push("has_booking_items");
  if (data.futureOccurrenceCount > 0) factors.push("has_future_occurrences");
  if (data.occurrenceExceptionCount > 0) factors.push("has_occurrence_exceptions");
  if (data.variationCount > 0) factors.push("has_variations");
  if (data.timeReportCount > 0) factors.push("has_time_reports");
  const allowed = factors.length === 0;
  return {
    allowed,
    blockingFactors: factors,
    reasons: factors.map((f) => WORK_ORDER_DELETE_BLOCK_FACTOR_LABELS[f]),
    blockedMessage: allowed ? undefined : WORK_ORDER_DELETE_BLOCKED_MESSAGE,
  };
}

export interface WorkOrderForceDeleteValidationResult {
  /** Whether a confirmed force delete is currently permitted. */
  allowed: boolean;
  /** Stable factor codes that block the force delete (empty when allowed). */
  blockingFactors: WorkOrderDeleteBlockFactor[];
  /** Human-readable reasons, aligned 1:1 with {@link blockingFactors}. */
  reasons: string[];
  /** Single summary message shown when the force delete is blocked. */
  blockedMessage?: string;
}

/** Message shown when a force delete is rejected because data exists. */
export const WORK_ORDER_FORCE_DELETE_BLOCKED_MESSAGE =
  "Force delete is only allowed for empty work orders with no bookings or history. Archive this work order instead.";

/**
 * Validates whether a Work Order may be FORCE-deleted. Force delete is the same
 * empty-only gate as {@link validateWorkOrderDelete} (a work order with related
 * data may never be wiped), but additionally requires an explicit typed
 * confirmation. Reuses the shared {@link isForceDeleteConfirmed} word so the
 * confirmation contract never drifts from the service-row force delete.
 */
export function validateWorkOrderForceDelete(
  data: WorkOrderRelatedData,
  confirmationInput: string,
): WorkOrderForceDeleteValidationResult {
  const base = validateWorkOrderDelete(data);
  if (!base.allowed) {
    return {
      allowed: false,
      blockingFactors: base.blockingFactors,
      reasons: base.reasons,
      blockedMessage: WORK_ORDER_FORCE_DELETE_BLOCKED_MESSAGE,
    };
  }
  if (!isForceDeleteConfirmed(confirmationInput)) {
    return {
      allowed: false,
      blockingFactors: [],
      reasons: [],
      blockedMessage: "Type “delete” to confirm.",
    };
  }
  return { allowed: true, blockingFactors: [], reasons: [] };
}
