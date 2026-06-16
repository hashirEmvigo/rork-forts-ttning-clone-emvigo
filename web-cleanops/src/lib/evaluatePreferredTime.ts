import {
  WEEK_DAYS,
  normalizeSchedulingPreferencesV2,
} from "@/types";
import type {
  CustomerSchedulingPreferences,
  SchedulingPreferenceWindow,
  WeekDay,
} from "@/types";

/**
 * Shared, pure evaluation layer for the optional Preferred Time Evaluation
 * add-on. Given a scheduled service occurrence and a customer's preferred
 * (and, when present, acceptable) days/time windows, it classifies how well
 * the scheduled time matches the customer's wishes.
 *
 * This module is intentionally framework- and storage-agnostic so it can be
 * reused by AO / Work Order, the future Schedule module and the Booking Queue.
 * It NEVER reads settings or decides whether the feature is enabled — that
 * gating lives in {@link isPreferredTimeEvaluationAvailable} and the callers.
 */

/** Classification of a scheduled time against customer preferences. */
export type PreferredTimeStatus =
  | "none"
  | "optimal"
  | "acceptable"
  | "outside_range"
  | "not_evaluated";

/** A day-scoped time window "HH:MM"–"HH:MM" used for matching. */
export interface PreferredTimeRange {
  day: WeekDay;
  startTime: string;
  endTime: string;
}

/** Generic input for {@link evaluatePreferredTimeStatus}. */
export interface PreferredTimeEvaluationInput {
  /** Occurrence date ("YYYY-MM-DD"). Used to derive {@link scheduledDay} when absent. */
  scheduledDate?: string | null;
  /** Occurrence weekday. Derived from {@link scheduledDate} when omitted. */
  scheduledDay?: WeekDay | null;
  /** Planned start of the occurrence ("HH:MM"). */
  plannedStartTime?: string | null;
  /** Planned end of the occurrence ("HH:MM"). */
  plannedEndTime?: string | null;
  /** Days the customer prefers (optimal). */
  preferredDays?: WeekDay[] | null;
  /** Optimal time windows, keyed by day. */
  preferredTimeRanges?: PreferredTimeRange[] | null;
  /** Days the customer finds acceptable (wider than preferred). */
  acceptableDays?: WeekDay[] | null;
  /** Acceptable (wider) time windows, keyed by day. */
  acceptableTimeRanges?: PreferredTimeRange[] | null;
}

/** The result of an evaluation, with an optional human-readable reason. */
export interface PreferredTimeEvaluationResult {
  status: PreferredTimeStatus;
  reason?: string;
}

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

/** Parses "HH:MM" into minutes-since-midnight, or null when invalid. */
function parseTime(t?: string | null): number | null {
  if (!t) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** Derives the weekday from an ISO date, or null when unparseable. Uses the
 * local timezone so the displayed day matches the rest of the app. */
export function weekdayFromIso(iso?: string | null): WeekDay | null {
  if (!iso) return null;
  const parts = iso.slice(0, 10).split("-").map(Number);
  if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return null;
  const [y, m, d] = parts;
  const date = new Date(y, (m || 1) - 1, d || 1);
  if (Number.isNaN(date.getTime())) return null;
  return INDEX_TO_WEEKDAY[date.getDay()] ?? null;
}

/** True when the supplied list has at least one entry. */
function hasItems<T>(list?: T[] | null): list is T[] {
  return Array.isArray(list) && list.length > 0;
}

/**
 * Whether a planned [start, end] window fits a set of day/time constraints.
 * Day match: the scheduled day must be in `days` (or, when `days` is empty, in
 * the set of days covered by `ranges`). Time match: when ranges exist for that
 * day, the planned window must be fully contained within at least one of them;
 * when no ranges exist for the day, only the day needs to match.
 */
function matchesConstraints(
  day: WeekDay,
  startMin: number,
  endMin: number,
  days: WeekDay[] | null | undefined,
  ranges: PreferredTimeRange[] | null | undefined,
): boolean {
  const dayList = hasItems(days) ? days : [];
  const rangeList = hasItems(ranges) ? ranges : [];

  const allowedDays = new Set<WeekDay>(dayList);
  if (allowedDays.size === 0) {
    for (const r of rangeList) allowedDays.add(r.day);
  }
  if (allowedDays.size === 0) return false;
  if (!allowedDays.has(day)) return false;

  const dayRanges = rangeList.filter((r) => r.day === day);
  if (dayRanges.length === 0) return true;

  return dayRanges.some((r) => {
    const rs = parseTime(r.startTime);
    const re = parseTime(r.endTime);
    if (rs == null || re == null) return false;
    return startMin >= rs && endMin <= re;
  });
}

/**
 * Classifies a scheduled occurrence against the customer's preferred and
 * acceptable day/time windows. Pure — safe to call during render.
 *
 * Rules:
 * - No preferences at all → `none` (no icon should be shown).
 * - Missing/invalid scheduled day or planned window → `not_evaluated`.
 * - Matches the preferred day AND preferred time → `optimal`.
 * - Otherwise, when acceptable windows exist and the occurrence matches them →
 *   `acceptable`.
 * - Otherwise → `outside_range`.
 *
 * When acceptable windows are not configured, the result is only ever
 * `optimal` or `outside_range`.
 */
export function evaluatePreferredTimeStatus(
  input: PreferredTimeEvaluationInput,
): PreferredTimeEvaluationResult {
  const hasPreferred =
    hasItems(input.preferredDays) || hasItems(input.preferredTimeRanges);
  const hasAcceptable =
    hasItems(input.acceptableDays) || hasItems(input.acceptableTimeRanges);

  if (!hasPreferred && !hasAcceptable) {
    return { status: "none" };
  }

  const day = input.scheduledDay ?? weekdayFromIso(input.scheduledDate);
  const startMin = parseTime(input.plannedStartTime);
  const endMin = parseTime(input.plannedEndTime);

  if (!day || startMin == null || endMin == null || endMin <= startMin) {
    return {
      status: "not_evaluated",
      reason: "Scheduled day or planned time is missing or invalid.",
    };
  }

  if (
    hasPreferred &&
    matchesConstraints(
      day,
      startMin,
      endMin,
      input.preferredDays,
      input.preferredTimeRanges,
    )
  ) {
    return { status: "optimal", reason: "Within the preferred day and time." };
  }

  if (
    hasAcceptable &&
    matchesConstraints(
      day,
      startMin,
      endMin,
      input.acceptableDays,
      input.acceptableTimeRanges,
    )
  ) {
    return {
      status: "acceptable",
      reason: "Within the acceptable day and time, but not the preferred window.",
    };
  }

  return {
    status: "outside_range",
    reason: "Outside the customer's approved days/time.",
  };
}

/** A scheduled occurrence to evaluate against a customer's stored preferences. */
export interface ScheduledOccurrence {
  scheduledDate?: string | null;
  scheduledDay?: WeekDay | null;
  plannedStartTime?: string | null;
  plannedEndTime?: string | null;
}

/**
 * Maps stored customer preferences into the generic preferred-time evaluator.
 * V2 uses only recurring windows for normal scheduling: preferred recurring
 * windows are Optimal, acceptable recurring windows are Acceptable, and temporary
 * windows are intentionally ignored until an explicit rescheduling reason exists.
 */
export function preferredTimeInputFromPreferences(
  prefs: CustomerSchedulingPreferences | null | undefined,
  occurrence: ScheduledOccurrence,
): PreferredTimeEvaluationInput {
  const normalized = normalizeSchedulingPreferencesV2(prefs);
  const preferredWindows = normalized.preferredRecurringWindows ?? [];
  const acceptableWindows = normalized.acceptableRecurringWindows ?? [];

  const toRange = (window: SchedulingPreferenceWindow): PreferredTimeRange => ({
    day: window.day,
    startTime: window.startTime,
    endTime: window.endTime,
  });

  return {
    scheduledDate: occurrence.scheduledDate,
    scheduledDay: occurrence.scheduledDay,
    plannedStartTime: occurrence.plannedStartTime,
    plannedEndTime: occurrence.plannedEndTime,
    preferredDays: preferredWindows.map((window) => window.day),
    preferredTimeRanges: preferredWindows.map(toRange),
    acceptableDays: acceptableWindows.map((window) => window.day),
    acceptableTimeRanges: acceptableWindows.map(toRange),
  };
}

/**
 * Resolves whether the Preferred Time Evaluation feature should be surfaced in
 * the UI for a given company. All applicable gates must agree:
 *  - `masterAllows`   — platform-wide (global) availability / Master Admin gate.
 *  - `companyEntitled` — the company is entitled to the paid add-on. Optional;
 *    defaults to `true` so existing callers that predate the entitlement model
 *    keep working (the entitlement default is also `true` for this feature).
 *  - `companyEnabled` — the company admin has turned the feature on.
 *
 * When the master gate is off, the company's entitlement and stored enabled
 * state are intentionally ignored (the add-on is not licensed).
 */
export function isPreferredTimeEvaluationAvailable(opts: {
  masterAllows: boolean;
  companyEnabled: boolean;
  companyEntitled?: boolean;
}): boolean {
  const companyEntitled = opts.companyEntitled !== false;
  return (
    opts.masterAllows === true &&
    companyEntitled &&
    opts.companyEnabled === true
  );
}
