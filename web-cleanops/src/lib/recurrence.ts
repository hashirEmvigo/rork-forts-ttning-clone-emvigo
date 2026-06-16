import type { RecurrenceInterval } from "@/types";

/** How a recurrence advances between consecutive occurrences. */
type RecurrenceStep = { unit: "day"; n: number } | { unit: "month"; n: number };

/**
 * Maps a {@link RecurrenceInterval} to the step used to advance from one
 * occurrence to the next, or null for "one_time"/unknown (no recurrence).
 * "Every other Monday" steps by 14 days, anchored to the service date.
 */
export function recurrenceStep(
  interval: RecurrenceInterval | undefined | null,
): RecurrenceStep | null {
  switch (interval) {
    case "daily":
      return { unit: "day", n: 1 };
    case "every_2_days":
      return { unit: "day", n: 2 };
    case "every_3_days":
      return { unit: "day", n: 3 };
    case "weekly":
      return { unit: "day", n: 7 };
    case "every_2_weeks":
    case "every_2_weeks_monday":
      return { unit: "day", n: 14 };
    case "every_3_weeks":
      return { unit: "day", n: 21 };
    case "every_4_weeks":
      return { unit: "day", n: 28 };
    case "monthly":
      return { unit: "month", n: 1 };
    case "every_3_months":
      return { unit: "month", n: 3 };
    case "every_6_months":
      return { unit: "month", n: 6 };
    case "yearly":
      return { unit: "month", n: 12 };
    default:
      return null;
  }
}

/** Parses a "YYYY-MM-DD" string to a local-midnight Date, or null if invalid. */
export function parseDateOnly(iso: string | null | undefined): Date | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Formats a Date to a local "YYYY-MM-DD" string. */
export function toDateOnly(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

/** Adds whole months, preserving day-of-month and clamping to the month's end. */
function addMonths(base: Date, months: number): Date {
  const d = new Date(base);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, daysInMonth));
  return d;
}

/** Bounds that constrain which recurring occurrences are produced. */
export interface OccurrenceBounds {
  /** Inclusive lower bound — occurrences before this are skipped. */
  rangeStart: Date;
  /** Inclusive upper bound of the requested view. */
  rangeEnd: Date;
  /** Hard cap from the Booking Generation Horizon (today + N months). */
  horizonEnd: Date;
  /** Optional inclusive series end date from the service row. */
  seriesEnd?: Date | null;
}

/** Safety cap so a misconfigured interval can never loop unbounded. */
const MAX_OCCURRENCES = 1000;

/**
 * Returns the occurrence dates (local "YYYY-MM-DD") of a recurring service that
 * fall within the requested range. The first occurrence is `firstDateIso`;
 * subsequent occurrences advance by the interval's step. Generation stops at the
 * earliest of `rangeEnd`, `horizonEnd` and `seriesEnd`. For "one_time"/unknown
 * intervals a single occurrence at `firstDateIso` is returned when it lies in
 * range. Pure and side-effect free — safe to call during render.
 */
export function recurrenceOccurrences(
  firstDateIso: string,
  interval: RecurrenceInterval | undefined | null,
  bounds: OccurrenceBounds,
): string[] {
  const first = parseDateOnly(firstDateIso);
  if (!first) return [];

  let upper = Math.min(bounds.rangeEnd.getTime(), bounds.horizonEnd.getTime());
  if (bounds.seriesEnd) upper = Math.min(upper, bounds.seriesEnd.getTime());
  const lower = bounds.rangeStart.getTime();

  const step = recurrenceStep(interval);
  if (!step) {
    const t = first.getTime();
    return t >= lower && t <= upper ? [toDateOnly(first)] : [];
  }

  const result: string[] = [];
  for (let i = 0; i < MAX_OCCURRENCES; i++) {
    const occ =
      step.unit === "day" ? addDays(first, i * step.n) : addMonths(first, i * step.n);
    const t = occ.getTime();
    if (t > upper) break;
    if (t >= lower) result.push(toDateOnly(occ));
  }
  return result;
}
