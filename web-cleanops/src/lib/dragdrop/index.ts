/**
 * Universal Schedule drag engine — public surface.
 *
 * Layered pure functions:
 *   evaluateDragAction → resolveDragScope → planDragWrite → applyDragWrite
 *
 * The board (`Schedule.tsx`) imports from here; field-specific math lives under
 * `./fields`. Phase 2 only wires the employee delta; date/time deltas and wider
 * scopes are typed but not yet active.
 */
export * from "./dragTypes";
export { evaluateDragAction } from "./evaluateDragAction";
export { resolveDragScope } from "./resolveDragScope";
export { planDragWrite } from "./planDragWrite";
export {
  applyDragWrite,
  type DragWriters,
  type DragWriteResult,
} from "./applyDragWrite";
export {
  buildDropStaffingWrite,
  evaluateDrop,
  type DragOccurrenceInfo,
  type DropEligibility,
  type DropOccurrenceStaffing,
  type DropStaffingWrite,
} from "./fields/employeeDelta";
export { buildDateScheduleWrite, type DateDeltaInput } from "./fields/dateDelta";
export {
  buildTimeScheduleWrite,
  durationMinutesOf,
  type TimeDeltaInput,
} from "./fields/timeDelta";
export {
  detectTimeConflicts,
  type ConflictCandidate,
  type ConflictNeighbour,
  type ConflictWindow,
} from "./timeConflict";
