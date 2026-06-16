/**
 * Time field delta — Phase 3B (occurrence-scoped time move, simple v1).
 *
 * A time drag moves an occurrence to another START TIME while preserving its
 * DURATION: the end time slides by the same amount so the on-site window keeps
 * its length, and staffing / labour are untouched (the reschedule write only
 * overlays the date + window). The board has no time-of-day grid, so the exact
 * new start is chosen in the drop-confirm dialog; this builder turns that choice
 * into the `schedule` portion of a {@link import("../dragTypes").DragWrite},
 * which routes to the existing `rescheduleOccurrence` writer — the same
 * authoritative per-occurrence exception used by the date move.
 *
 * v1 scope (intentionally simple):
 *  - moves ONLY the selected occurrence (no cascading, no route optimisation),
 *  - preserves duration (end = newStart + currentDuration),
 *  - never changes labour, staffing or required headcount.
 */
import { addMinutesToTime, splitTime } from "@/lib/time";

/** The facts a time change needs. Duration is derived from the current window. */
export interface TimeDeltaInput {
  /** The day the occurrence sits on (unchanged by a pure time move). */
  date: string;
  /** The occurrence's current start time "HH:mm", or null. */
  currentStart: string | null;
  /** The occurrence's current end time "HH:mm", or null. */
  currentEnd: string | null;
  /** The dispatcher-chosen new start time "HH:mm". */
  newStart: string;
}

/** Minutes between two canonical "HH:mm" values, or null when either is invalid. */
export function durationMinutesOf(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  const s = splitTime(start);
  const e = splitTime(end);
  if (!s || !e) return null;
  const minutes = e.hour * 60 + e.minute - (s.hour * 60 + s.minute);
  return minutes > 0 ? minutes : null;
}

/**
 * Turns a time change into the schedule portion of a DragWrite. The day is
 * unchanged; `endTime` is recomputed from `newStart` + the preserved duration so
 * the window keeps its exact length. When the occurrence has no resolvable
 * duration the end is left null (the writer keeps it following the base rule).
 * Pure.
 */
export function buildTimeScheduleWrite(
  input: TimeDeltaInput,
): { date: string; startTime: string; endTime: string | null } {
  const duration = durationMinutesOf(input.currentStart, input.currentEnd);
  const endTime = duration != null ? addMinutesToTime(input.newStart, duration) : null;
  return { date: input.date, startTime: input.newStart, endTime };
}
