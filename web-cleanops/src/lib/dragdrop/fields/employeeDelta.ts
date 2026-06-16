/**
 * Employee field delta — the staffing logic lifted verbatim from Phase 1's
 * `scheduleDragDrop.ts`. It owns exactly one concern: given a drag from one
 * employee row to another (or out of the Unassigned / open-slots row), decide
 * whether it's a meaningful staffing change and compute the staffing write that
 * preserves duration and total labour.
 *
 * This is the first of several "field deltas" in the universal drag engine
 * (date/time/duration deltas land in later phases). Keeping it isolated means
 * the gesture-interpretation layer ({@link import("../evaluateDragAction")}) and
 * the write planner ({@link import("../planDragWrite")}) stay field-agnostic.
 *
 * Phase 1 scope (unchanged):
 *  - same date only (no rescheduling / time / duration / labour changes),
 *  - single-assignee cards may be reassigned (multi-assignee is blocked because
 *    the intent is ambiguous — replace one / replace all / add),
 *  - open-slot cards may have ONE slot filled by the target employee,
 *  - the resulting write never changes duration or total labour.
 */

/** The outcome of evaluating a candidate employee drop onto a row/cell. */
export type DropEligibility =
  /** Reassign a single-assignee card from its source employee to the target. */
  | "reassign"
  /** Fill one open slot on the card with the target employee. */
  | "fill_slot"
  /** Card has multiple assignees — reassignment is ambiguous, so it's blocked. */
  | "blocked_multi"
  /** Not a meaningful drop (wrong date, same employee, already assigned, etc.). */
  | "invalid";

/** The minimal occurrence/source facts an eligibility decision needs. */
export interface DragOccurrenceInfo {
  /**
   * The employee row the card is dragged FROM, or null when it is dragged out of
   * the Unassigned / open-slots row (a slot-fill, not a reassignment).
   */
  sourceEmployeeId: string | null;
  /** The display date "YYYY-MM-DD" of the dragged card. */
  sourceDate: string;
  /** Employees currently assigned to the occurrence. */
  assignedEmployeeIds: string[];
  /** Open staffing slots on the occurrence (non-negative). */
  openSlotCount: number;
}

/**
 * Decides whether dropping the dragged occurrence onto `targetEmployeeId` in the
 * `targetDate` column is allowed, and which kind of change it would be. Pure.
 *
 * Rules:
 *  - A different date is always invalid (Phase 1/2 never reschedule — date drags
 *    become a `date` delta in a later phase, handled outside this module).
 *  - From an employee row (reassignment): more than one assignee is blocked;
 *    dropping back on the same employee or onto someone already assigned is a
 *    no-op (invalid); otherwise it's a `reassign`.
 *  - From the Unassigned row (slot-fill): needs an open slot and the target must
 *    not already be assigned; otherwise it's a `fill_slot`.
 */
export function evaluateDrop(params: {
  drag: DragOccurrenceInfo;
  targetEmployeeId: string;
  targetDate: string;
}): DropEligibility {
  const { drag, targetEmployeeId, targetDate } = params;
  // Phase 1/2 only moves between employees on the SAME date.
  if (targetDate !== drag.sourceDate) return "invalid";
  const assigned = drag.assignedEmployeeIds ?? [];

  if (drag.sourceEmployeeId != null) {
    // Reassignment from an employee row.
    if (assigned.length > 1) return "blocked_multi";
    if (targetEmployeeId === drag.sourceEmployeeId) return "invalid";
    if (assigned.includes(targetEmployeeId)) return "invalid";
    return "reassign";
  }

  // Dragged out of the Unassigned / open-slots row → fill one open slot.
  if (Math.max(0, drag.openSlotCount) <= 0) return "invalid";
  if (assigned.includes(targetEmployeeId)) return "invalid";
  return "fill_slot";
}

/** The staffing facts a write needs to preserve duration/labour exactly. */
export interface DropOccurrenceStaffing {
  assignedEmployeeIds: string[];
  openSlotCount: number;
  /** Resolved total labour minutes for the occurrence (or null). */
  labourMinutes: number | null;
  /** True when the occurrence carries a pinned/redistributed total labour. */
  isLabourRedistributed: boolean;
}

/** The shared staffing payload a confirmed employee drop should persist. */
export interface DropStaffingWrite {
  assignedEmployeeIds: string[];
  unassignedEmployeeSlots: number;
  /**
   * Pinned total labour minutes to preserve, or null to let labour scale with
   * headcount. Phase 1/2 never change total labour, so a redistributed job keeps
   * its pinned total and a headcount-scaled job stays scaled (the required
   * headcount is unchanged by either a 1→1 reassign or a slot-fill).
   */
  totalLabourMinutes: number | null;
}

/**
 * Builds the staffing write for a confirmed employee drop. Pure.
 *
 * - `reassign`: replaces the single assignee with the target, keeping the open
 *   slot count unchanged (required headcount unchanged → labour unchanged).
 * - `fill_slot`: adds the target to the assignees and decrements one open slot
 *   (required headcount unchanged → labour unchanged).
 * - `unassign`: removes `removeEmployeeId` from the assignees and ADDS one open
 *   slot (required headcount unchanged → labour/duration unchanged). The seat
 *   becomes open rather than reducing the staffing need.
 *
 * In every case the pinned total labour is preserved when the occurrence is
 * redistributed, otherwise null is returned so labour keeps scaling with the
 * (unchanged) required headcount — never changing duration or total labour.
 */
export function buildDropStaffingWrite(params: {
  mode: "reassign" | "fill_slot" | "unassign";
  staffing: DropOccurrenceStaffing;
  /** Target employee for `reassign`/`fill_slot`. */
  targetEmployeeId?: string;
  /** Employee to drop for `unassign`. */
  removeEmployeeId?: string;
}): DropStaffingWrite {
  const { mode, staffing, targetEmployeeId, removeEmployeeId } = params;
  const openSlots = Math.max(0, staffing.openSlotCount);
  const preservedLabour =
    staffing.isLabourRedistributed &&
    typeof staffing.labourMinutes === "number" &&
    Number.isFinite(staffing.labourMinutes) &&
    staffing.labourMinutes > 0
      ? staffing.labourMinutes
      : null;

  if (mode === "unassign") {
    // Remove exactly the source employee; the freed seat becomes one open slot.
    const next = staffing.assignedEmployeeIds.filter((id) => id !== removeEmployeeId);
    return {
      assignedEmployeeIds: next,
      unassignedEmployeeSlots: openSlots + 1,
      totalLabourMinutes: preservedLabour,
    };
  }

  const target = targetEmployeeId ?? "";

  if (mode === "reassign") {
    // Single assignee replaced by the target; open slots unchanged.
    return {
      assignedEmployeeIds: [target],
      unassignedEmployeeSlots: openSlots,
      totalLabourMinutes: preservedLabour,
    };
  }

  // fill_slot: add the target and consume exactly one open slot.
  const next = staffing.assignedEmployeeIds.includes(target)
    ? staffing.assignedEmployeeIds.slice()
    : [...staffing.assignedEmployeeIds, target];
  return {
    assignedEmployeeIds: next,
    unassignedEmployeeSlots: Math.max(0, openSlots - 1),
    totalLabourMinutes: preservedLabour,
  };
}
