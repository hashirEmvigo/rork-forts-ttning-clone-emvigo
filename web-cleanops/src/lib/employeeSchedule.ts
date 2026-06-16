import {
  calculatePlannedDurationMinutes,
  type Employee,
  type EmployeeAvailabilityDay,
  type EmployeeTimeWindow,
  type EmployeeWorkingSchedule,
  type EmployeeWorkingScheduleDay,
  type Weekday,
} from "@/types";

/**
 * Employee Working Schedule core — the single, pure source of truth for an
 * employee's NORMAL availability and working hours. This is deliberately
 * separate from the customer cleaning schedule: customer bookings always come
 * from the Schedule Core ({@link resolveScheduleProgram}); this module only
 * describes WHEN an employee is available to work and HOW MUCH capacity they
 * have per weekday. Future planner checks (employee unavailable, booking outside
 * working hours, daily capacity exceeded, overtime, double-booking) compare the
 * booked work against this baseline — none of that logic lives here yet.
 *
 * Everything is pure and framework-agnostic so it is safe during render and
 * trivially testable.
 */

/** The weekdays in canonical Monday→Sunday order. */
export const WEEKDAYS: Weekday[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

/** Human labels for each weekday. */
export const WEEKDAY_LABELS: Record<Weekday, string> = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
};

/** Short labels (e.g. "Mon") for dense table headers. */
export const WEEKDAY_SHORT_LABELS: Record<Weekday, string> = {
  monday: "Mon",
  tuesday: "Tue",
  wednesday: "Wed",
  thursday: "Thu",
  friday: "Fri",
  saturday: "Sat",
  sunday: "Sun",
};

/** Default working window for a normal weekday. */
const DEFAULT_START = "08:00";
const DEFAULT_END = "16:00";
const DEFAULT_BREAK_MINUTES = 30;

/** Weekdays that are working days in the default schedule (Mon–Fri). */
const DEFAULT_WORKING_DAYS = new Set<Weekday>([
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
]);

/**
 * Maps a JS `Date.getDay()` (0 = Sunday … 6 = Saturday) to our {@link Weekday}.
 */
const JS_DAY_TO_WEEKDAY: Weekday[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

/** Resolves the {@link Weekday} for a "YYYY-MM-DD" date (local, no TZ drift). */
export function weekdayOf(dateIso: string): Weekday | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) return null;
  const d = new Date(`${dateIso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return JS_DAY_TO_WEEKDAY[d.getDay()];
}

/** Builds the default working-schedule day for a given weekday. */
export function defaultWorkingScheduleDay(weekday: Weekday): EmployeeWorkingScheduleDay {
  const isWorking = DEFAULT_WORKING_DAYS.has(weekday);
  return {
    weekday,
    isAvailable: isWorking,
    startTime: DEFAULT_START,
    endTime: DEFAULT_END,
    breakMinutes: isWorking ? DEFAULT_BREAK_MINUTES : 0,
  };
}

/**
 * The default weekly working schedule: Monday–Friday 08:00–16:00 with a 30-min
 * break, weekends unavailable. Returned as a fresh Mon→Sun array every call.
 */
export function defaultWorkingSchedule(): EmployeeWorkingSchedule {
  return WEEKDAYS.map((weekday) => defaultWorkingScheduleDay(weekday));
}

/**
 * Normalizes any (possibly partial, unordered, or missing) stored schedule into
 * a complete, validated Mon→Sun schedule. Missing weekdays fall back to the
 * default for that day; invalid time windows on an available day fall back to
 * the default window; negative breaks/capacities are clamped. This is the
 * missing-schedule fallback every consumer should go through.
 */
export function normalizeWorkingSchedule(
  input: EmployeeWorkingScheduleDay[] | undefined | null,
): EmployeeWorkingSchedule {
  const byWeekday = new Map<Weekday, EmployeeWorkingScheduleDay>();
  if (Array.isArray(input)) {
    for (const day of input) {
      if (!day || !WEEKDAYS.includes(day.weekday) || byWeekday.has(day.weekday)) continue;
      byWeekday.set(day.weekday, day);
    }
  }
  return WEEKDAYS.map((weekday) => {
    const raw = byWeekday.get(weekday);
    if (!raw) return defaultWorkingScheduleDay(weekday);
    const isAvailable = raw.isAvailable === true;
    const fallback = defaultWorkingScheduleDay(weekday);
    const hasValidWindow =
      calculatePlannedDurationMinutes(raw.startTime, raw.endTime) != null;
    const startTime = hasValidWindow ? raw.startTime : fallback.startTime;
    const endTime = hasValidWindow ? raw.endTime : fallback.endTime;
    const breakMinutes =
      typeof raw.breakMinutes === "number" && raw.breakMinutes >= 0
        ? Math.round(raw.breakMinutes)
        : undefined;
    const capacityHours =
      typeof raw.capacityHours === "number" && raw.capacityHours >= 0
        ? raw.capacityHours
        : undefined;
    const note = typeof raw.note === "string" && raw.note.trim() ? raw.note.trim() : undefined;
    return {
      weekday,
      isAvailable,
      startTime,
      endTime,
      ...(breakMinutes != null ? { breakMinutes } : {}),
      ...(capacityHours != null ? { capacityHours } : {}),
      ...(note != null ? { note } : {}),
    };
  });
}

/**
 * Resolves an employee's effective working schedule, applying the
 * missing-schedule fallback when the employee has none stored. Always returns a
 * complete Mon→Sun schedule.
 */
export function resolveEmployeeWorkingSchedule(
  employee: Pick<Employee, "workingSchedule">,
): EmployeeWorkingSchedule {
  return normalizeWorkingSchedule(employee.workingSchedule);
}

/** Returns the schedule day for a weekday from a (normalized or raw) schedule. */
export function getWorkingDay(
  schedule: EmployeeWorkingScheduleDay[] | undefined | null,
  weekday: Weekday,
): EmployeeWorkingScheduleDay {
  const normalized = normalizeWorkingSchedule(schedule);
  return normalized.find((d) => d.weekday === weekday) as EmployeeWorkingScheduleDay;
}

/** True when the employee is available to work on the given weekday. */
export function isAvailableOnWeekday(
  schedule: EmployeeWorkingScheduleDay[] | undefined | null,
  weekday: Weekday,
): boolean {
  return getWorkingDay(schedule, weekday).isAvailable;
}

/** True when the employee is available to work on the given "YYYY-MM-DD" date. */
export function isAvailableOnDate(
  schedule: EmployeeWorkingScheduleDay[] | undefined | null,
  dateIso: string,
): boolean {
  const weekday = weekdayOf(dateIso);
  if (!weekday) return false;
  return isAvailableOnWeekday(schedule, weekday);
}

/**
 * The raw working-window length in minutes for a day (end − start), ignoring
 * breaks. Returns 0 when the day is unavailable or the window is invalid.
 */
export function workingWindowMinutes(day: EmployeeWorkingScheduleDay): number {
  if (!day.isAvailable) return 0;
  return calculatePlannedDurationMinutes(day.startTime, day.endTime) ?? 0;
}

/**
 * The plan-able daily capacity in minutes for a day. Unavailable days have zero
 * capacity. When an explicit {@link EmployeeWorkingScheduleDay.capacityHours} is
 * set it wins; otherwise capacity is the working window minus any break,
 * clamped at zero.
 */
export function dailyCapacityMinutes(day: EmployeeWorkingScheduleDay): number {
  if (!day.isAvailable) return 0;
  if (typeof day.capacityHours === "number" && day.capacityHours >= 0) {
    return Math.round(day.capacityHours * 60);
  }
  const window = workingWindowMinutes(day);
  const breakMinutes = typeof day.breakMinutes === "number" && day.breakMinutes > 0 ? day.breakMinutes : 0;
  return Math.max(0, window - breakMinutes);
}

/**
 * Copies the Monday settings (availability, times, break, capacity, note) onto
 * every other weekday, returning a new normalized schedule. Used by the
 * "Copy Monday to all weekdays" action.
 */
export function copyMondayToAll(
  schedule: EmployeeWorkingScheduleDay[] | undefined | null,
): EmployeeWorkingSchedule {
  const normalized = normalizeWorkingSchedule(schedule);
  const monday = normalized.find((d) => d.weekday === "monday") as EmployeeWorkingScheduleDay;
  return WEEKDAYS.map((weekday) => ({ ...monday, weekday }));
}

/** Resets to the {@link defaultWorkingSchedule}. Alias for intent/readability. */
export function resetToDefaultWorkingSchedule(): EmployeeWorkingSchedule {
  return defaultWorkingSchedule();
}

/**
 * Sensible default acceptable (outer-bound) working hours for a new employee.
 * Wider than the preferred window.
 */
export const DEFAULT_ACCEPTABLE_HOURS: EmployeeTimeWindow = { start: "06:00", end: "18:00" };

/** Sensible default preferred working hours for a new employee. */
export const DEFAULT_PREFERRED_HOURS: EmployeeTimeWindow = { start: "08:00", end: "16:00" };

/**
 * Formats a working-hours window as "HH:MM\u2013HH:MM" (en-dash). Returns "Not set"
 * when the window is missing or incomplete.
 */
export function formatTimeWindow(window: EmployeeTimeWindow | undefined | null): string {
  if (!window || !window.start || !window.end) return "Not set";
  return `${window.start}\u2013${window.end}`;
}

// ── Per-day availability (acceptable vs. preferred working windows) ──────────

/** True when a time window has both a start and end and forms a positive range. */
function isValidWindow(window: EmployeeTimeWindow | undefined | null): boolean {
  if (!window || !window.start || !window.end) return false;
  return calculatePlannedDurationMinutes(window.start, window.end) != null;
}

/**
 * The default per-day availability for a new employee: Monday–Friday available
 * with preferred 08:00–16:00 inside a wider acceptable 06:00–18:00 window;
 * weekends unavailable. Returned as a fresh Mon→Sun array every call.
 */
export function defaultEmployeeAvailability(): EmployeeAvailabilityDay[] {
  return WEEKDAYS.map((weekday) => ({
    weekday,
    isAvailable: DEFAULT_WORKING_DAYS.has(weekday),
    preferred: { ...DEFAULT_PREFERRED_HOURS },
    acceptable: { ...DEFAULT_ACCEPTABLE_HOURS },
  }));
}

/**
 * Normalizes any (possibly partial, unordered, missing, or legacy) availability
 * into a complete, validated Mon→Sun array. When no availability is stored, the
 * employee is seeded from the legacy single {@link Employee.acceptableHours} /
 * {@link Employee.preferredHours} windows when present, otherwise from
 * {@link defaultEmployeeAvailability}. Invalid windows fall back to defaults.
 */
export function normalizeEmployeeAvailability(
  input: EmployeeAvailabilityDay[] | undefined | null,
  legacyAcceptable?: EmployeeTimeWindow | null,
  legacyPreferred?: EmployeeTimeWindow | null,
): EmployeeAvailabilityDay[] {
  const seededPreferred = isValidWindow(legacyPreferred)
    ? (legacyPreferred as EmployeeTimeWindow)
    : DEFAULT_PREFERRED_HOURS;
  const seededAcceptable = isValidWindow(legacyAcceptable)
    ? (legacyAcceptable as EmployeeTimeWindow)
    : DEFAULT_ACCEPTABLE_HOURS;

  if (!Array.isArray(input) || input.length === 0) {
    return WEEKDAYS.map((weekday) => ({
      weekday,
      isAvailable: DEFAULT_WORKING_DAYS.has(weekday),
      preferred: { ...seededPreferred },
      acceptable: { ...seededAcceptable },
    }));
  }

  const byWeekday = new Map<Weekday, EmployeeAvailabilityDay>();
  for (const day of input) {
    if (!day || !WEEKDAYS.includes(day.weekday) || byWeekday.has(day.weekday)) continue;
    byWeekday.set(day.weekday, day);
  }
  return WEEKDAYS.map((weekday) => {
    const raw = byWeekday.get(weekday);
    if (!raw) {
      return {
        weekday,
        isAvailable: DEFAULT_WORKING_DAYS.has(weekday),
        preferred: { ...DEFAULT_PREFERRED_HOURS },
        acceptable: { ...DEFAULT_ACCEPTABLE_HOURS },
      };
    }
    const preferred = isValidWindow(raw.preferred)
      ? { start: raw.preferred.start, end: raw.preferred.end }
      : { ...DEFAULT_PREFERRED_HOURS };
    const acceptable = isValidWindow(raw.acceptable)
      ? { start: raw.acceptable.start, end: raw.acceptable.end }
      : { ...DEFAULT_ACCEPTABLE_HOURS };
    return { weekday, isAvailable: raw.isAvailable === true, preferred, acceptable };
  });
}

/**
 * The representative single window for an employee, derived from the first
 * available day of their availability. Used to keep the legacy
 * {@link Employee.acceptableHours} / {@link Employee.preferredHours} fields
 * meaningful for consumers that read a single window. Returns null when no day
 * is available.
 */
export function representativeWindows(
  availability: EmployeeAvailabilityDay[] | undefined | null,
): { acceptable: EmployeeTimeWindow; preferred: EmployeeTimeWindow } | null {
  const days = normalizeEmployeeAvailability(availability);
  const first = days.find((d) => d.isAvailable);
  if (!first) return null;
  return { acceptable: { ...first.acceptable }, preferred: { ...first.preferred } };
}

/**
 * A compact per-day availability summary, compressing consecutive weekdays that
 * share the same preferred window into ranges, e.g.
 * "Mon–Fri 08:00–16:00 · Sat 10:00–14:00". Returns "No available days" when the
 * employee is unavailable every day.
 */
export function formatAvailabilitySummary(
  availability: EmployeeAvailabilityDay[] | undefined | null,
): string {
  const days = normalizeEmployeeAvailability(availability);
  type Run = { startDay: Weekday; endDay: Weekday; window: string };
  const runs: Run[] = [];
  let current: Run | null = null;
  for (const day of days) {
    if (!day.isAvailable) {
      current = null;
      continue;
    }
    const window = formatTimeWindow(day.preferred);
    if (current && current.window === window) {
      current.endDay = day.weekday;
    } else {
      current = { startDay: day.weekday, endDay: day.weekday, window };
      runs.push(current);
    }
  }
  if (runs.length === 0) return "No available days";
  return runs
    .map((r) => {
      const label =
        r.startDay === r.endDay
          ? WEEKDAY_SHORT_LABELS[r.startDay]
          : `${WEEKDAY_SHORT_LABELS[r.startDay]}\u2013${WEEKDAY_SHORT_LABELS[r.endDay]}`;
      return `${label} ${r.window}`;
    })
    .join(" · ");
}

/**
 * A single-line, list-friendly availability summary. When every available day
 * forms one contiguous run sharing the same preferred window it returns a
 * compact label like "Mon\u2013Fri 08:00\u201316:00"; when availability differs
 * across days (different windows, or gaps) it returns "Variable" to keep the
 * roster readable. Returns "\u2014" when the employee has no available days.
 *
 * Unlike {@link formatAvailabilitySummary} (which lists every run for the
 * profile/dialog), this deliberately collapses anything non-uniform to a single
 * word so table rows stay scannable.
 */
export function formatCompactAvailability(
  availability: EmployeeAvailabilityDay[] | undefined | null,
): string {
  const summary = formatAvailabilitySummary(availability);
  if (summary === "No available days") return "\u2014";
  // A single run (no " \u00b7 " separator) means contiguous days sharing one
  // window — safe to show in full. Anything else is condensed to "Variable".
  return summary.includes(" \u00b7 ") ? "Variable" : summary;
}

/** Total plan-able capacity across the whole week, in minutes. */
export function weeklyCapacityMinutes(
  schedule: EmployeeWorkingScheduleDay[] | undefined | null,
): number {
  return normalizeWorkingSchedule(schedule).reduce(
    (sum, day) => sum + dailyCapacityMinutes(day),
    0,
  );
}
