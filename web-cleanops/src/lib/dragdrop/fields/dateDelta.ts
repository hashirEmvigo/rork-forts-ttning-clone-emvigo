/**
 * Date field delta — Phase 3A (occurrence-scoped date move).
 *
 * A date drag moves an occurrence to another DAY while preserving its window:
 * the same start/end time (so duration is unchanged) and the same staffing /
 * labour (the staffing override fields are untouched by the reschedule write).
 * The gesture layer ({@link import("../evaluateDragAction")}) decides a different
 * date is a valid `date` delta; this builder turns it into the `schedule`
 * portion of a {@link import("../dragTypes").DragWrite}, which routes to the
 * existing `rescheduleOccurrence` writer.
 *
 * NOTE: time-grid drag (changing the start time) is Phase 3B — see
 * {@link import("./timeDelta").buildTimeScheduleWrite}.
 */

/** The facts a date change needs. The window is carried through to preserve it. */
export interface DateDeltaInput {
  fromDate: string;
  toDate: string;
  /** The occurrence's current start time "HH:mm" to preserve, or null. */
  startTime: string | null;
  /** The occurrence's current end time "HH:mm" to preserve, or null. */
  endTime: string | null;
}

/**
 * Turns a date change into the schedule portion of a DragWrite. The target day
 * is the only thing that changes; `startTime`/`endTime` are passed straight
 * through so the reschedule writer reproduces the exact same window (no duration
 * or time change). Pure.
 */
export function buildDateScheduleWrite(
  input: DateDeltaInput,
): { date: string; startTime: string | null; endTime: string | null } {
  return { date: input.toDate, startTime: input.startTime, endTime: input.endTime };
}
