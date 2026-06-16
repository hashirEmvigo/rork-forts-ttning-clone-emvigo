/**
 * Write planning — assembles a {@link DragWrite} (the persistence intent) from
 * an action, its resolved scope, and the occurrence's current staffing. Pure.
 *
 * It delegates field math to the field deltas (today: the employee delta's
 * `buildDropStaffingWrite`, whose labour-preservation logic is unchanged) and
 * never decides HOW to persist — that's `applyDragWrite`'s job.
 *
 * Invariants (asserted by tests):
 *  - a pure employee drag only ever emits `staffing` (never `schedule`),
 *  - a date/time drag only ever emits `schedule` (never `staffing`).
 */
import type { DragAction, DragScope, DragWrite } from "./dragTypes";
import {
  buildDropStaffingWrite,
  type DropOccurrenceStaffing,
} from "./fields/employeeDelta";
import { buildDateScheduleWrite } from "./fields/dateDelta";

/**
 * Builds the persistence intent for a confirmed drag. `staffing` is the
 * occurrence's current staffing facts, needed to preserve duration/total labour.
 */
export function planDragWrite(params: {
  action: DragAction;
  scope: DragScope;
  staffing: DropOccurrenceStaffing;
}): DragWrite {
  const { action, scope, staffing } = params;

  const write: DragWrite = {
    scope,
    occurrenceKey: action.occurrenceKey,
    parentServiceRowId: action.parentServiceRowId,
    workOrderId: action.workOrderId,
  };

  const employee = action.deltas.employee;
  if (employee) {
    const result = buildDropStaffingWrite({
      mode: employee.kind,
      staffing,
      targetEmployeeId: employee.kind === "unassign" ? undefined : employee.to,
      removeEmployeeId: employee.kind === "unassign" ? employee.from : undefined,
    });
    write.staffing = {
      assignedEmployeeIds: result.assignedEmployeeIds,
      unassignedEmployeeSlots: result.unassignedEmployeeSlots,
      totalLabourMinutes: result.totalLabourMinutes,
    };
  }

  // Phase 3A: a date move populates `write.schedule` (preserving the window).
  // A date delta and an employee delta never coexist in one action (the gesture
  // layer produces exactly one), so `staffing` and `schedule` are mutually
  // exclusive on a single write — asserted by the invariant tests.
  const date = action.deltas.date;
  if (date) {
    const schedule = buildDateScheduleWrite({
      fromDate: date.from,
      toDate: date.to,
      startTime: date.startTime,
      endTime: date.endTime,
    });
    write.schedule = {
      date: schedule.date,
      // Pass the preserved window through as-is; null means "no explicit time
      // override" so the occurrence keeps following its resolved time.
      startTime: schedule.startTime ?? undefined,
      endTime: schedule.endTime ?? undefined,
    };
  }

  return write;
}
