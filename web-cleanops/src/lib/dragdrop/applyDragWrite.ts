/**
 * Write routing — the single place that maps a {@link DragWrite}'s scope to a
 * concrete persistence call. The caller injects the context writers so this
 * stays framework-agnostic and unit-testable.
 *
 * Routing table:
 *   occurrence + staffing → reassignOccurrence  (per-occurrence staffing exception)
 *   occurrence + schedule → rescheduleOccurrence (per-occurrence date/time exception)
 *   series                → updateServiceRow    (one-time path; row IS the booking)
 *   from_here_forward     → not implemented yet (variation writer, later phase)
 *
 * The employee path is Phase 1's `confirmDrop` body, lifted so the routing is
 * data-driven; the schedule path (Phase 3A) reuses the existing reschedule
 * writer so date moves go through the same authoritative exception overlay.
 */
import type { DragWrite } from "./dragTypes";

export interface DragWriteResult {
  ok: boolean;
  error?: string;
}

/** The context writers `applyDragWrite` routes to (injected by the caller). */
export interface DragWriters {
  reassignOccurrence: (
    occurrenceKey: string,
    input: {
      assignedEmployeeIds: string[];
      unassignedEmployeeSlots?: number | null;
      totalLabourMinutes?: number | null;
    },
  ) => DragWriteResult;
  updateServiceRow: (
    workOrderId: string,
    serviceRowId: string,
    patch: {
      assignedEmployeeIds?: string[];
      unassignedEmployeeSlots?: number;
      totalLabourMinutesOverride?: number | null;
    },
  ) => DragWriteResult;
  /**
   * Phase 3A — occurrence-scoped date/time move. Reuses the existing reschedule
   * writer: it overlays just this occurrence (date + preserved window) and keeps
   * any staffing override on the occurrence intact.
   */
  rescheduleOccurrence?: (
    occurrenceKey: string,
    input: { newDate: string; newStartTime?: string | null; newEndTime?: string | null },
  ) => DragWriteResult;
  /** Later phase — `from_here_forward` variation writer. */
  addRecurringVariation?: (write: DragWrite) => DragWriteResult;
}

/** Routes a planned write to the matching context writer. */
export function applyDragWrite(write: DragWrite, writers: DragWriters): DragWriteResult {
  const { staffing, schedule } = write;

  switch (write.scope) {
    case "occurrence": {
      // Date/time move → reschedule exception (preserves staffing override).
      if (schedule) {
        if (!writers.rescheduleOccurrence) {
          return { ok: false, error: "Rescheduling isn't supported here." };
        }
        if (!schedule.date) {
          return { ok: false, error: "No target date to move to." };
        }
        return writers.rescheduleOccurrence(write.occurrenceKey, {
          newDate: schedule.date,
          newStartTime: schedule.startTime ?? null,
          newEndTime: schedule.endTime ?? null,
        });
      }
      if (!staffing) {
        return { ok: false, error: "No staffing change to apply." };
      }
      return writers.reassignOccurrence(write.occurrenceKey, {
        assignedEmployeeIds: staffing.assignedEmployeeIds,
        unassignedEmployeeSlots: staffing.unassignedEmployeeSlots,
        totalLabourMinutes: staffing.totalLabourMinutes,
      });
    }
    case "series": {
      if (!staffing) {
        return { ok: false, error: "No staffing change to apply." };
      }
      return writers.updateServiceRow(write.workOrderId, write.parentServiceRowId, {
        assignedEmployeeIds: staffing.assignedEmployeeIds,
        unassignedEmployeeSlots: staffing.unassignedEmployeeSlots,
        totalLabourMinutesOverride: staffing.totalLabourMinutes,
      });
    }
    case "from_here_forward": {
      if (writers.addRecurringVariation) return writers.addRecurringVariation(write);
      return { ok: false, error: "Series-forward changes aren't supported yet." };
    }
    default: {
      // Exhaustiveness guard — a new scope must be handled above.
      const never: never = write.scope;
      return { ok: false, error: `Unsupported scope: ${String(never)}` };
    }
  }
}
