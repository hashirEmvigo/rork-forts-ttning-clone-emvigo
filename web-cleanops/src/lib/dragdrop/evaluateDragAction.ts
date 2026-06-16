/**
 * Gesture interpretation — turns a (source × target) gesture into a normalized
 * {@link DragAction}, or a blocked reason. Pure.
 *
 * Phase 2 delegated to the employee field delta only. Phase 3A adds a DATE move:
 * dropping a card on a DIFFERENT date column (within the SAME employee context)
 * produces a `deltas.date` instead. A combined employee + date move (different
 * employee AND different date) stays unsupported for now and is reported as
 * `invalid` (inert), so it can't accidentally do half of an ambiguous change.
 * Time-grid drag (changing the start time) is Phase 3B.
 */
import type { DragAction, DragEvaluation, DragSource, DropTarget } from "./dragTypes";
import { evaluateDrop } from "./fields/employeeDelta";
import { durationMinutesOf } from "./fields/timeDelta";

/**
 * Interprets dropping `source` onto `target`. Pure — no persistence, no UI.
 *
 * Today every action is an employee change on the same date; a different date,
 * a same-employee drop, or an already-assigned target is blocked. Multi-assignee
 * cards are blocked because the intent is ambiguous.
 */
export function evaluateDragAction(source: DragSource, target: DropTarget): DragEvaluation {
  // ── Employee → Unassigned: remove the source employee, open a staffing slot ──
  // Dropping a card onto the Unassigned / open-slots row removes exactly the
  // employee whose row it was dragged FROM and converts that seat into an open
  // slot. Multi-assignee cards ARE allowed here because the source row
  // unambiguously identifies which assignee to remove. Same date only (no
  // reschedule via the Unassigned row); date/time/labour/duration are untouched.
  if (target.unassigned) {
    if (target.date !== source.sourceDate) return { ok: false, reason: "invalid" };
    // Must be dragged from an employee row to identify who to remove. A card
    // already in the Unassigned row dropped back onto it changes nothing.
    if (source.sourceEmployeeId == null) return { ok: false, reason: "no_change" };
    if (!(source.assignedEmployeeIds ?? []).includes(source.sourceEmployeeId)) {
      return { ok: false, reason: "invalid" };
    }
    const action: DragAction = {
      occurrenceKey: source.occurrenceKey,
      parentServiceRowId: source.parentServiceRowId,
      workOrderId: source.workOrderId,
      isRecurring: source.isRecurring,
      deltas: { employee: { kind: "unassign", from: source.sourceEmployeeId } },
    };
    return { ok: true, action };
  }

  // From here an employee-row target is required.
  if (target.employeeId == null) return { ok: false, reason: "invalid" };
  const targetEmployeeId = target.employeeId;

  // ── Phase 3B: TIME move (in place) ────────────────────────────────────────
  // Dropping a card back onto its OWN employee + date cell is a request to
  // adjust the occurrence's START TIME. The board has no time-of-day grid, so
  // the exact new start is chosen in the confirm dialog — this seeds a `time`
  // delta with the current window (startTo === startFrom until the dialog edits
  // it). Requires an existing start time to adjust; staffing, labour, headcount
  // and the day are never touched, and duration is preserved by the builder.
  if (
    target.date === source.sourceDate &&
    targetEmployeeId === source.sourceEmployeeId &&
    source.startTime != null
  ) {
    const action: DragAction = {
      occurrenceKey: source.occurrenceKey,
      parentServiceRowId: source.parentServiceRowId,
      workOrderId: source.workOrderId,
      isRecurring: source.isRecurring,
      deltas: {
        time: {
          startFrom: source.startTime,
          startTo: source.startTime,
          durationMinutes: durationMinutesOf(source.startTime, source.endTime) ?? 0,
        },
      },
    };
    return { ok: true, action };
  }

  // ── Phase 3A: DATE move ───────────────────────────────────────────────────
  // A different target date is a reschedule, not an employee change. Only a PURE
  // date move is supported: the employee context must be unchanged (same employee
  // row). A different employee AND a different date is a combined move — still out
  // of scope — so it stays `invalid`. Unassigned-row date moves aren't wired here
  // (the source has no employee), so they also fall through to `invalid`; the
  // reschedule dialog still handles those. Staffing/labour are never touched, so
  // multi-assignee cards CAN be date-moved (every assignee is preserved).
  if (target.date !== source.sourceDate) {
    if (targetEmployeeId !== source.sourceEmployeeId) {
      return { ok: false, reason: "invalid" };
    }
    const action: DragAction = {
      occurrenceKey: source.occurrenceKey,
      parentServiceRowId: source.parentServiceRowId,
      workOrderId: source.workOrderId,
      isRecurring: source.isRecurring,
      deltas: {
        date: {
          from: source.sourceDate,
          to: target.date,
          startTime: source.startTime,
          endTime: source.endTime,
        },
      },
    };
    return { ok: true, action };
  }

  // ── Same date: EMPLOYEE change (Phase 1/2, unchanged) ─────────────────────
  const eligibility = evaluateDrop({
    drag: {
      sourceEmployeeId: source.sourceEmployeeId,
      sourceDate: source.sourceDate,
      assignedEmployeeIds: source.assignedEmployeeIds ?? [],
      openSlotCount: Math.max(0, source.openSlotCount ?? 0),
    },
    targetEmployeeId,
    targetDate: target.date,
  });

  if (eligibility === "blocked_multi") return { ok: false, reason: "blocked_multi" };
  if (eligibility === "invalid") return { ok: false, reason: "invalid" };

  const action: DragAction = {
    occurrenceKey: source.occurrenceKey,
    parentServiceRowId: source.parentServiceRowId,
    workOrderId: source.workOrderId,
    isRecurring: source.isRecurring,
    deltas: {
      employee:
        eligibility === "reassign"
          ? { kind: "reassign", from: source.sourceEmployeeId ?? "", to: targetEmployeeId }
          : { kind: "fill_slot", to: targetEmployeeId },
    },
  };
  return { ok: true, action };
}
