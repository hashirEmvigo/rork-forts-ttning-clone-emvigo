import { formatDateWithWeekday, formatTimeRange } from "./format";

/**
 * Single source of truth for reschedule messaging across the app (Booking Queue,
 * Schedule, occurrence details and reschedule dialogs). Building the copy here —
 * rather than inferring it from display dates in each view — keeps the wording
 * identical everywhere and makes the distinction between a one-time occurrence
 * move and a series-level anchor move explicit and consistent.
 *
 * Original/new dates must come from the authoritative source:
 * - occurrence moves: {@link BookingOccurrenceException} (`occurrenceDate` →
 *   `overrideOccurrenceDate`),
 * - series moves: the recurrence anchor (`serviceDate`) before/after the change.
 */

/** "occurrence" = single one-time move; "series" = recurrence anchor moved. */
export type RescheduleScope = "occurrence" | "series";

export interface RescheduleMessageInput {
  /** Whether this is a one-time occurrence move or a series-level anchor move. */
  scope: RescheduleScope;
  /** Original (rule-derived) date — ISO timestamp or "YYYY-MM-DD". */
  originalDate: string;
  /** New date the occurrence/series moved to — ISO timestamp or "YYYY-MM-DD". */
  newDate: string;
}

export interface RescheduleMessage {
  scope: RescheduleScope;
  /** Formatted original date with weekday, e.g. "Saturday 30 May 2026". */
  originalDate: string;
  /** Formatted new date with weekday, e.g. "Tuesday 02 Jun 2026". */
  newDate: string;
  /**
   * Whether the booking actually moved to a different day. When `false` the
   * original and new dates are identical — callers must hide the reschedule
   * message entirely and treat the occurrence as not rescheduled.
   */
  changed: boolean;
  /**
   * One-line summary.
   * - occurrence: "Rescheduled from 30 May 2026 → 01 Jun 2026"
   * - series: "Series moved"
   */
  summary: string;
  /**
   * Supporting scope lines.
   * - occurrence: ["One-Time Change"]
   * - series: ["Future occurrences updated"]
   */
  detailLines: string[];
}

/** Right-arrow glyph used in all reschedule copy. */
export const RESCHEDULE_ARROW = "\u2192";

/** Extracts the calendar day ("YYYY-MM-DD") from an ISO timestamp or date-only string. */
function dayKey(date: string): string {
  return date.slice(0, 10);
}

/**
 * Builds the standardized reschedule message for a single occurrence move or a
 * series-level move. Pure — safe to call during render.
 */
export function buildRescheduleMessage(input: RescheduleMessageInput): RescheduleMessage {
  const originalDate = formatDateWithWeekday(input.originalDate);
  const newDate = formatDateWithWeekday(input.newDate);
  const changed = dayKey(input.originalDate) !== dayKey(input.newDate);

  if (input.scope === "series") {
    return {
      scope: "series",
      originalDate,
      newDate,
      changed,
      summary: "Series moved",
      detailLines: ["Future occurrences updated"],
    };
  }

  return {
    scope: "occurrence",
    originalDate,
    newDate,
    changed,
    summary: `Rescheduled from ${originalDate} ${RESCHEDULE_ARROW} ${newDate}`,
    detailLines: ["One-Time Change"],
  };
}

// ── Occurrence change information (Booking List) ─────────────────

export interface OccurrenceChangeInput {
  /** One-time occurrence move vs series-level anchor move. */
  scope: RescheduleScope;
  /** Original (rule-derived) date — ISO timestamp or "YYYY-MM-DD". */
  originalDate: string;
  /** New date the occurrence/series moved to — ISO timestamp or "YYYY-MM-DD". */
  newDate: string;
  /** Original planned start time ("HH:MM"), when known. */
  originalStartTime?: string | null;
  /** Original planned end time ("HH:MM"), when known. */
  originalEndTime?: string | null;
  /** New planned start time ("HH:MM"), when known. */
  newStartTime?: string | null;
  /** New planned end time ("HH:MM"), when known. */
  newEndTime?: string | null;
}

export interface OccurrenceChangeMessage {
  scope: RescheduleScope;
  /**
   * Whether anything actually changed (different day and/or different time).
   * When false the change information must be hidden entirely — never "X → X".
   */
  changed: boolean;
  /** The occurrence moved to a different calendar day. */
  dateChanged: boolean;
  /**
   * The occurrence's planned time window differs from the original. This is the
   * authoritative source for the "Changed" booking modifier — both ranges must
   * be known and differ. Date-only moves leave this false.
   */
  timeChanged: boolean;
  /**
   * Primary line(s) describing the move, weekday-prefixed. One line for a
   * date-only or time-only change; two lines when both date and time changed.
   */
  lines: string[];
  /** Scope detail, e.g. "One-Time Change" (occurrence) or the series equivalent. */
  detail: string;
}

/**
 * Builds the standardized Booking List change-information copy for a single
 * occurrence (or series) move, covering date-only, time-only and combined
 * date+time changes. Sourced from the authoritative occurrence/exception dates
 * and times — never inferred from display values. Pure — safe during render.
 *
 * Deliberately omits recurrence/exception jargon: administrators only see the
 * human-facing "Rescheduled from …", "Time changed from …" and "One-Time Change".
 */
export function buildOccurrenceChangeMessage(
  input: OccurrenceChangeInput,
): OccurrenceChangeMessage {
  const dateChanged = dayKey(input.originalDate) !== dayKey(input.newDate);
  const originalRange = formatTimeRange(input.originalStartTime, input.originalEndTime);
  const newRange = formatTimeRange(input.newStartTime, input.newEndTime);
  const timeChanged =
    originalRange !== null && newRange !== null && originalRange !== newRange;

  const originalDate = formatDateWithWeekday(input.originalDate);
  const newDate = formatDateWithWeekday(input.newDate);

  if (input.scope === "series") {
    return {
      scope: "series",
      changed: dateChanged,
      dateChanged,
      timeChanged: false,
      lines: dateChanged
        ? [`Series moved from ${originalDate} ${RESCHEDULE_ARROW} ${newDate}`]
        : [],
      detail: "Future occurrences updated",
    };
  }

  const detail = "One-Time Change";

  if (dateChanged && timeChanged) {
    return {
      scope: "occurrence",
      changed: true,
      dateChanged,
      timeChanged,
      lines: [
        `Rescheduled from ${originalDate}, ${originalRange}`,
        `${RESCHEDULE_ARROW} ${newDate}, ${newRange}`,
      ],
      detail,
    };
  }

  if (dateChanged) {
    return {
      scope: "occurrence",
      changed: true,
      dateChanged,
      timeChanged,
      lines: [`Rescheduled from ${originalDate} ${RESCHEDULE_ARROW} ${newDate}`],
      detail,
    };
  }

  if (timeChanged) {
    return {
      scope: "occurrence",
      changed: true,
      dateChanged,
      timeChanged,
      lines: [`Time changed from ${originalRange} ${RESCHEDULE_ARROW} ${newRange}`],
      detail,
    };
  }

  return { scope: "occurrence", changed: false, dateChanged, timeChanged, detail, lines: [] };
}

/**
 * Compact one-line summary for activity logs and timelines. Uses the same
 * wording as {@link buildRescheduleMessage} so logs never diverge from the UI.
 */
export function rescheduleLogSummary(
  input: RescheduleMessageInput,
  reason?: string | null,
): string {
  const message = buildRescheduleMessage(input);
  const base =
    message.scope === "series"
      ? `Series moved · ${message.originalDate} ${RESCHEDULE_ARROW} ${message.newDate}`
      : message.summary;
  return reason ? `${base} (${reason})` : base;
}
