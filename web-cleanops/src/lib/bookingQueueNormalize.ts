import {
  buildBookingSnapshot,
  normalizeUnassignedSlots,
  type BookingQueueItem,
  type WorkOrderServiceRow,
} from "@/types";

/**
 * Source-of-truth normalization for Booking Queue planning.
 *
 * The work-order service row is the single source of truth for a booking's
 * staffing and labour. A {@link BookingQueueItem} only mirrors those values as a
 * persisted snapshot, which can lag behind the row (legacy data created before a
 * sync path existed, one-time migrations gated by a localStorage flag that has
 * already run, or any future field added to the row but not yet re-synced).
 *
 * Trusting a stale snapshot is what made the Schedule Board (which always reads
 * the live row) and the Booking Queue (which read the snapshot) diverge, and why
 * a booking only picked up the new staffing/labour rules after being deleted and
 * recreated. These helpers re-derive the derived fields from the live row at read
 * time so existing bookings follow the current rules without delete/recreate.
 *
 * Everything here is pure and never mutates or persists.
 */

/** Normalized, source-of-truth staffing/labour fields for a service row. */
export interface NormalizedServiceRowStaffing {
  /** Assigned employees, always a clean string array (legacy data may be missing). */
  assignedEmployeeIds: string[];
  /** Open employee slots, clamped to a non-negative integer. */
  unassignedEmployeeSlots: number;
  /**
   * Pinned total planned labour minutes (a redistributed/split job), or null when
   * labour scales naturally with headcount. Non-positive / non-finite legacy
   * values normalize to null so they are simply ignored.
   */
  totalLabourMinutesOverride: number | null;
}

/**
 * Normalizes the staffing/labour fields of a (possibly legacy) service row into
 * the shapes every calculator expects. Safe to call on rows that predate the
 * `assignedEmployeeIds`, `unassignedEmployeeSlots`, or `totalLabourMinutesOverride`
 * fields — missing values become safe defaults rather than `undefined`. Pure.
 */
export function normalizeServiceRowStaffing(
  row: Pick<
    WorkOrderServiceRow,
    "assignedEmployeeIds" | "unassignedEmployeeSlots" | "totalLabourMinutesOverride"
  >,
): NormalizedServiceRowStaffing {
  const assignedEmployeeIds = Array.isArray(row.assignedEmployeeIds)
    ? row.assignedEmployeeIds.filter(
        (id): id is string => typeof id === "string" && id.length > 0,
      )
    : [];
  const unassignedEmployeeSlots = normalizeUnassignedSlots(row.unassignedEmployeeSlots);
  const raw = row.totalLabourMinutesOverride;
  const totalLabourMinutesOverride =
    typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : null;
  return { assignedEmployeeIds, unassignedEmployeeSlots, totalLabourMinutesOverride };
}

/**
 * Returns a Booking Queue item whose derived staffing/labour fields are
 * authoritative for the current rules:
 *
 *  - With a LIVE source row, every snapshot field that can be derived from the
 *    row (service name, planned window, duration, assigned employees + names,
 *    open slots, assignment status, per-employee time overrides) is re-derived
 *    from the row via {@link buildBookingSnapshot}. Stale persisted values are
 *    ignored, so the queue matches the row and the Schedule Board exactly.
 *  - WITHOUT a live source row (orphan), the item's derived values can't be
 *    reconciled, so they are only clamped to safe shapes (arrays, non-negative
 *    slots) to avoid crashes — never trusted as correct.
 *
 * In both cases booking-level fields (id, cancellation, reschedule, schedule
 * placement, timestamps, recurrence anchor, end date) are preserved unchanged.
 * Pure — returns a new item; never mutates the input.
 */
export function normalizeBookingQueueItem(
  item: BookingQueueItem,
  sourceRow: WorkOrderServiceRow | undefined | null,
  resolveEmployeeName: (id: string) => string | undefined,
): BookingQueueItem {
  if (!sourceRow) {
    return {
      ...item,
      assignedEmployeeIds: Array.isArray(item.assignedEmployeeIds)
        ? item.assignedEmployeeIds
        : [],
      assignedEmployeeNames: Array.isArray(item.assignedEmployeeNames)
        ? item.assignedEmployeeNames
        : [],
      unassignedEmployeeSlots: normalizeUnassignedSlots(item.unassignedEmployeeSlots),
      employeeTimeOverrides: Array.isArray(item.employeeTimeOverrides)
        ? item.employeeTimeOverrides
        : [],
      hasCustomEmployeeTimes: item.hasCustomEmployeeTimes ?? false,
    };
  }

  const snapshot = buildBookingSnapshot(sourceRow, resolveEmployeeName);
  return {
    ...item,
    serviceName: snapshot.serviceName,
    plannedStartTime: snapshot.plannedStartTime,
    plannedEndTime: snapshot.plannedEndTime,
    durationMinutes: snapshot.durationMinutes,
    assignedEmployeeIds: snapshot.assignedEmployeeIds,
    assignedEmployeeNames: snapshot.assignedEmployeeNames,
    unassignedEmployeeSlots: snapshot.unassignedEmployeeSlots,
    assignmentStatus: snapshot.assignmentStatus,
    employeeTimeOverrides: snapshot.employeeTimeOverrides,
    hasCustomEmployeeTimes: snapshot.hasCustomEmployeeTimes,
  };
}
