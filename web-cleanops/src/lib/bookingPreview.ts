import {
  dayOptimalWindow,
  getVariationDisplayState,
  WEEK_DAYS,
} from "@/types";
import type {
  CustomerSchedulingPreferences,
  RecurringVariation,
  WeekDay,
} from "@/types";

/**
 * Pure simulation layer for previewing how a service row would generate future
 * bookings. This NEVER creates real bookings, calendar entries or employee
 * schedules — it only computes a forecast for validation. It will later become
 * the foundation for the booking list, scheduling engine and calendar.
 */

/** Allowed preview horizons (number of future bookings to simulate). */
export const PREVIEW_RANGES = [4, 8, 12, 26, 52] as const;
export type PreviewRange = (typeof PREVIEW_RANGES)[number];
export const DEFAULT_PREVIEW_RANGE: PreviewRange = 12;

/** JS `Date.getDay()` index (0 = Sunday) for each {@link WeekDay}. */
const WEEKDAY_INDEX: Record<WeekDay, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const INDEX_TO_WEEKDAY: WeekDay[] = WEEK_DAYS.map((d) => d.value).reduce(
  (acc, day) => {
    acc[WEEKDAY_INDEX[day]] = day;
    return acc;
  },
  [] as WeekDay[],
);

/** What generated a given preview booking. */
export interface PreviewBookingSource {
  kind: "default" | "variation" | "conflict";
  /** Names of the variations involved (one for a variation, many for a conflict). */
  variationNames: string[];
}

/** A single simulated future booking. */
export interface PreviewBooking {
  /** 1-based position in the preview list. */
  index: number;
  /** ISO date "YYYY-MM-DD". */
  date: string;
  day: WeekDay;
  startTime: string;
  endTime: string;
  durationMinutes?: number;
  employeeCount: number;
  source: PreviewBookingSource;
}

export interface BookingPreviewSummary {
  generated: number;
  defaultBookings: number;
  variationBookings: number;
  conflicts: number;
}

export interface BookingPreviewResult {
  bookings: PreviewBooking[];
  summary: BookingPreviewSummary;
  /** The resolved default schedule rule used, for display. */
  rule?: { day: WeekDay; startTime: string; endTime: string };
  /** Set when no preview could be generated (e.g. no default cleaning day). */
  error?: string;
}

/** Resolved default schedule rule (the recurring weekly baseline). */
interface DefaultRule {
  day: WeekDay;
  startTime: string;
  endTime: string;
}

/**
 * Derives the default schedule rule from the effective scheduling preferences.
 * Uses the primary (highest priority) preferred cleaning day and its optimal
 * time window as the recurring weekly baseline.
 */
function resolveDefaultRule(
  prefs?: CustomerSchedulingPreferences | null,
): DefaultRule | null {
  const primary = prefs?.preferredDays?.[0];
  if (!primary) return null;
  const window = dayOptimalWindow(primary);
  return {
    day: primary.day,
    startTime: window.start || "08:00",
    endTime: window.end || "12:00",
  };
}

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Parses an ISO date or datetime string into a local Date at midnight. */
function parseLocalDate(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

/** 1 (first) … 5 (used for "last"); ordinal occurrence of the weekday in the month. */
function weekOfMonth(d: Date): number {
  return Math.ceil(d.getDate() / 7);
}

/** Whether `d` is the last occurrence of its weekday within the month. */
function isLastWeekdayOfMonth(d: Date): boolean {
  const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return d.getDate() + 7 > daysInMonth;
}

/**
 * Whether a variation's recurrence pattern matches a given booking. `visitIndex`
 * is 0-based (the Nth booking in the series). Validity and status are checked
 * separately by the caller.
 */
function variationMatches(
  v: RecurringVariation,
  visitIndex: number,
  date: Date,
): boolean {
  switch (v.frequency) {
    case "every_n_weeks":
    case "every_n_visits": {
      const n = Math.max(1, v.interval ?? 1);
      return (visitIndex + 1) % n === 0;
    }
    case "nth_weekday_of_month": {
      if (v.weekday && WEEKDAY_INDEX[v.weekday] !== date.getDay()) return false;
      const target = v.weekOfMonth ?? 1;
      if (target >= 5) return isLastWeekdayOfMonth(date);
      return weekOfMonth(date) === target;
    }
    default:
      return false;
  }
}

/**
 * Simulates the next `count` bookings for a service row from its default
 * schedule rule and recurring variations. Only Active variations within their
 * validity window are applied; Draft, Inactive, Archived, Future and Expired
 * variations are ignored. Conflicts (two or more variations on the same
 * booking) are identified but never auto-resolved.
 *
 * This is a forecast only and never creates real bookings.
 */
export function generateBookingPreview(
  prefs: CustomerSchedulingPreferences | null | undefined,
  variations: RecurringVariation[],
  count: number,
  fromDate?: string,
): BookingPreviewResult {
  const rule = resolveDefaultRule(prefs);
  const empty: BookingPreviewSummary = {
    generated: 0,
    defaultBookings: 0,
    variationBookings: 0,
    conflicts: 0,
  };

  if (!rule) {
    return {
      bookings: [],
      summary: empty,
      error:
        "No preferred cleaning day is set for this customer, so a default schedule cannot be simulated. Add a preferred cleaning day first.",
    };
  }

  const start = fromDate ? parseLocalDate(fromDate) : new Date();
  start.setHours(0, 0, 0, 0);

  // Advance to the first occurrence of the rule's weekday on/after the start.
  const cursor = new Date(start);
  const targetDow = WEEKDAY_INDEX[rule.day];
  const diff = (targetDow - cursor.getDay() + 7) % 7;
  cursor.setDate(cursor.getDate() + diff);

  const bookings: PreviewBooking[] = [];
  const summary: BookingPreviewSummary = { ...empty };

  for (let i = 0; i < count; i++) {
    const date = new Date(cursor);
    const iso = toIsoDate(date);

    const applicable = variations.filter(
      (v) =>
        getVariationDisplayState(v, iso) === "active" &&
        variationMatches(v, i, date),
    );

    let booking: PreviewBooking;
    if (applicable.length >= 2) {
      summary.conflicts += 1;
      booking = {
        index: i + 1,
        date: iso,
        day: INDEX_TO_WEEKDAY[date.getDay()],
        startTime: rule.startTime,
        endTime: rule.endTime,
        employeeCount: 1,
        source: { kind: "conflict", variationNames: applicable.map((v) => v.name) },
      };
    } else if (applicable.length === 1) {
      summary.variationBookings += 1;
      const v = applicable[0];
      booking = {
        index: i + 1,
        date: iso,
        day: v.day ?? rule.day,
        startTime: v.startTime ?? rule.startTime,
        endTime: v.endTime ?? rule.endTime,
        durationMinutes: v.durationMinutes,
        employeeCount: v.employeeCount ?? 1,
        source: { kind: "variation", variationNames: [v.name] },
      };
    } else {
      summary.defaultBookings += 1;
      booking = {
        index: i + 1,
        date: iso,
        day: rule.day,
        startTime: rule.startTime,
        endTime: rule.endTime,
        employeeCount: 1,
        source: { kind: "default", variationNames: [] },
      };
    }

    bookings.push(booking);
    cursor.setDate(cursor.getDate() + 7);
  }

  summary.generated = bookings.length;
  return { bookings, summary, rule };
}
