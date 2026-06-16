import { getVariationDisplayState } from "@/types";
import type { RecurrenceInterval, RecurringVariation } from "@/types";
import {
  occurrenceIndexFromStart,
  variationMatchesOccurrence,
} from "./variationResolver";
import {
  parseDateOnly,
  recurrenceOccurrences,
  toDateOnly,
} from "./recurrence";

/**
 * Variation overlap detection, replacement lifecycle, and the warning decision
 * model (Step 2 foundation).
 *
 * This layer answers "does a candidate variation collide with any existing
 * variation?" before a variation is saved, and prepares an existing variation
 * for supersession. It is intentionally NOT wired into the Booking Queue, the AO
 * dialog, or any UI yet — it is a side-effect-free foundation that the future
 * overlap warning dialog and replace flow will consume.
 *
 * Hard rules enforced here:
 * - Overlap is occurrence-level: two variations overlap when they both apply to
 *   at least one concrete future occurrence. Matching reuses
 *   {@link variationMatchesOccurrence} from the resolver — the matching rules are
 *   never duplicated.
 * - Occurrence indices are anchored to the service series start (via
 *   {@link occurrenceIndexFromStart}), so detection can't drift with the view.
 * - {@link replaceVariation} preserves history: nothing is deleted, the old
 *   variation is bounded and archived rather than removed.
 */

/** Minimal series descriptor needed to simulate occurrences for overlap checks. */
export interface VariationOverlapSeries {
  /** Series start — the first occurrence date ("YYYY-MM-DD"). */
  serviceDate: string;
  /** How the base service recurs. "one_time"/unknown yields a single occurrence. */
  recurrenceInterval?: RecurrenceInterval | null;
  /** Optional inclusive series end date ("YYYY-MM-DD"). */
  serviceEndDate?: string | null;
  /** Existing variations on the row. Defaults to []. */
  variations?: RecurringVariation[];
  /**
   * Base occurrence start time "HH:mm". Used as the fallback time window when a
   * variation does not override the start/end time, so schedule-overlap checks
   * can compare effective windows rather than just dates.
   */
  startTime?: string | null;
  /** Base occurrence end time "HH:mm". Fallback for schedule-overlap checks. */
  endTime?: string | null;
  /** Base occurrence duration in minutes. Used to derive an end when none is set. */
  durationMinutes?: number | null;
}

/** Inputs for {@link findOverlappingVariations}. */
export interface FindOverlappingVariationsInput {
  /** The base service series (a {@link import("@/types").WorkOrderServiceRow} satisfies this). */
  series: VariationOverlapSeries;
  /** The variation being created/edited and checked for overlap. */
  candidate: RecurringVariation;
  /**
   * Variations to compare against. Defaults to `series.variations`. The candidate
   * itself is always excluded by id so editing an existing variation never
   * reports a self-overlap.
   */
  existingVariations?: RecurringVariation[];
  /** "today" anchor ("YYYY-MM-DD"); defaults to the current date. */
  today?: string;
  /** Simulation horizon in months from `today`. Defaults to 12. */
  horizonMonths?: number;
  /** Hard cap on simulated occurrences. Defaults to 52. */
  maxOccurrences?: number;
}

/** One existing variation that overlaps the candidate, with the colliding dates. */
export interface VariationOverlap {
  variation: RecurringVariation;
  /** Occurrence dates ("YYYY-MM-DD") where both the candidate and this variation apply. */
  overlapDates: string[];
  /**
   * Subset of {@link overlapDates} where the two variations' effective time
   * windows also intersect — i.e. a real schedule clash (same occurrence, same
   * time-of-day), not just two rules landing on the same day. Empty when the
   * variations land on the same date but at non-overlapping times.
   */
  scheduleConflictDates: string[];
}

/** Output of {@link findOverlappingVariations}. */
export interface FindOverlappingVariationsResult {
  /** Existing variations that collide with the candidate, each with its dates. */
  overlaps: VariationOverlap[];
  /** All distinct occurrence dates where the candidate overlaps any variation, ascending. */
  overlapDates: string[];
  /** Number of overlapping existing variations. */
  overlapCount: number;
  /** All distinct dates where time windows also intersect (schedule clash), ascending. */
  scheduleConflictDates: string[];
  /** Number of overlapping variations whose time window also clashes with the candidate. */
  scheduleConflictCount: number;
}

const DEFAULT_HORIZON_MONTHS = 12;
const DEFAULT_MAX_OCCURRENCES = 52;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Parses "HH:mm" (or "HH:mm:ss") into minutes-since-midnight, or null. */
function parseTimeToMinutes(time: string | null | undefined): number | null {
  if (!time) return null;
  const match = /^(\d{1,2}):(\d{2})/.exec(time.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

/** Effective [start, end) minute window for a variation, falling back to base. */
function effectiveWindow(
  v: RecurringVariation,
  series: VariationOverlapSeries,
): { start: number; end: number } | null {
  const start = parseTimeToMinutes(v.startTime ?? series.startTime);
  if (start == null) return null;
  let end = parseTimeToMinutes(v.endTime ?? series.endTime);
  if (end == null) {
    const duration = v.durationMinutes ?? series.durationMinutes ?? null;
    if (duration != null && Number.isFinite(duration) && duration > 0) {
      end = start + duration;
    } else {
      return null;
    }
  }
  if (end <= start) return null;
  return { start, end };
}

/**
 * Whether the candidate and an existing variation clash on the time-of-day for a
 * shared occurrence. Two half-open windows [s,e) overlap when each starts before
 * the other ends. When either effective window is unknown (no time and no
 * duration on the variation or the base), the result is conservatively treated
 * as a clash — two timeless rules on the same occurrence can't be proven safe.
 */
function schedulesClash(
  candidate: RecurringVariation,
  other: RecurringVariation,
  series: VariationOverlapSeries,
): boolean {
  const a = effectiveWindow(candidate, series);
  const b = effectiveWindow(other, series);
  if (!a || !b) return true;
  return a.start < b.end && b.start < a.end;
}

function addMonthsClamped(base: Date, months: number): Date {
  const d = new Date(base);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, daysInMonth));
  return d;
}

/**
 * Whether a variation applies to the occurrence at `index`/`date`. Reuses the
 * resolver's pattern matcher so matching rules are never duplicated. When
 * `requireActive` is true the variation must also be in its Active display state
 * for that date and not already replaced (used for existing variations). The
 * candidate uses `requireActive: false` so a draft can still be checked.
 */
function variationApplies(
  v: RecurringVariation,
  index: number,
  date: Date,
  onIso: string,
  requireActive: boolean,
): boolean {
  if (requireActive) {
    if (v.replacedByVariationId || v.replacedAt) return false;
    if (getVariationDisplayState(v, onIso) !== "active") return false;
  } else {
    // Even when not requiring Active status, respect an explicit validity window
    // so an out-of-window candidate doesn't report phantom overlaps.
    if (v.appliesFrom && onIso < v.appliesFrom) return false;
    if (v.appliesUntil && onIso > v.appliesUntil) return false;
  }
  return variationMatchesOccurrence(v, index, date);
}

/**
 * Finds existing variations that overlap the candidate by simulating future
 * occurrences of the series and checking, per occurrence, whether both the
 * candidate and an existing variation apply.
 *
 * The horizon is the smaller of `horizonMonths` from today and `maxOccurrences`
 * occurrences, so detection stays bounded and stable. Pure and side-effect free.
 */
export function findOverlappingVariations(
  input: FindOverlappingVariationsInput,
): FindOverlappingVariationsResult {
  const today = input.today ?? todayIso();
  const horizonMonths = input.horizonMonths ?? DEFAULT_HORIZON_MONTHS;
  const maxOccurrences = input.maxOccurrences ?? DEFAULT_MAX_OCCURRENCES;

  const existing = (input.existingVariations ?? input.series.variations ?? []).filter(
    (v) => v && v.id !== input.candidate.id,
  );

  const empty: FindOverlappingVariationsResult = {
    overlaps: [],
    overlapDates: [],
    overlapCount: 0,
    scheduleConflictDates: [],
    scheduleConflictCount: 0,
  };
  if (existing.length === 0) return empty;

  const start = parseDateOnly(input.series.serviceDate);
  const todayDate = parseDateOnly(today);
  if (!start || !todayDate) return empty;

  // Simulate from the later of today and the series start, up to the horizon.
  const rangeStart = start.getTime() > todayDate.getTime() ? start : todayDate;
  const horizonEnd = addMonthsClamped(todayDate, horizonMonths);
  const seriesEnd = parseDateOnly(input.series.serviceEndDate ?? null);

  const occurrenceDates = recurrenceOccurrences(
    input.series.serviceDate,
    input.series.recurrenceInterval ?? null,
    { rangeStart, rangeEnd: horizonEnd, horizonEnd, seriesEnd },
  ).slice(0, maxOccurrences);

  const perVariation = new Map<string, string[]>();
  const perVariationSchedule = new Map<string, string[]>();
  const allDates = new Set<string>();
  const allScheduleDates = new Set<string>();

  for (const iso of occurrenceDates) {
    const date = parseDateOnly(iso);
    if (!date) continue;
    const index = occurrenceIndexFromStart(
      input.series.serviceDate,
      iso,
      input.series.recurrenceInterval ?? null,
    );
    if (!variationApplies(input.candidate, index, date, iso, false)) continue;

    for (const v of existing) {
      if (!variationApplies(v, index, date, iso, true)) continue;
      const list = perVariation.get(v.id);
      if (list) list.push(iso);
      else perVariation.set(v.id, [iso]);
      allDates.add(iso);

      if (schedulesClash(input.candidate, v, input.series)) {
        const sched = perVariationSchedule.get(v.id);
        if (sched) sched.push(iso);
        else perVariationSchedule.set(v.id, [iso]);
        allScheduleDates.add(iso);
      }
    }
  }

  if (perVariation.size === 0) return empty;

  const overlaps: VariationOverlap[] = [];
  let scheduleConflictCount = 0;
  for (const v of existing) {
    const dates = perVariation.get(v.id);
    if (dates && dates.length > 0) {
      const scheduleConflictDates = perVariationSchedule.get(v.id) ?? [];
      if (scheduleConflictDates.length > 0) scheduleConflictCount += 1;
      overlaps.push({ variation: v, overlapDates: dates, scheduleConflictDates });
    }
  }

  return {
    overlaps,
    overlapDates: [...allDates].sort(),
    overlapCount: overlaps.length,
    scheduleConflictDates: [...allScheduleDates].sort(),
    scheduleConflictCount,
  };
}

/** Actions an admin can take when a candidate variation overlaps existing ones. */
export type VariationConflictAction = "chain" | "replace" | "cancel";

/** No overlap was found — the candidate is safe to save as-is. */
export interface NoVariationConflict {
  kind: "no_conflict";
}

/** The candidate overlaps one or more existing variations; admin must choose. */
export interface VariationConflict {
  kind: "conflict";
  /** Ids of the overlapping existing variations. */
  overlappingVariationIds: string[];
  /** Names of the overlapping existing variations (same order as ids). */
  overlappingVariationNames: string[];
  /** Number of overlapping existing variations. */
  overlapCount: number;
  /** Earliest colliding occurrence date ("YYYY-MM-DD"), or null. */
  firstOverlapDate: string | null;
  /**
   * True when at least one overlapping variation also clashes on the time-of-day
   * (a real schedule conflict, not just a shared date). Chaining two variations
   * whose windows intersect would double-book the same time slot.
   */
  hasScheduleConflict: boolean;
  /** Earliest date where time windows intersect ("YYYY-MM-DD"), or null. */
  firstScheduleConflictDate: string | null;
  /** Actions to offer the admin, in display order. */
  suggestedActions: VariationConflictAction[];
  /** Full per-variation overlap detail for richer UI. */
  overlaps: VariationOverlap[];
}

/** Discriminated result of an overlap evaluation. */
export type VariationConflictResult = NoVariationConflict | VariationConflict;

/**
 * Evaluates whether a candidate variation conflicts with existing variations and
 * returns the warning decision model the future overlap dialog will render.
 * Pure — delegates detection to {@link findOverlappingVariations}.
 */
export function evaluateVariationConflict(
  input: FindOverlappingVariationsInput,
): VariationConflictResult {
  const result = findOverlappingVariations(input);
  if (result.overlapCount === 0) {
    return { kind: "no_conflict" };
  }
  const hasScheduleConflict = result.scheduleConflictCount > 0;
  return {
    kind: "conflict",
    overlappingVariationIds: result.overlaps.map((o) => o.variation.id),
    overlappingVariationNames: result.overlaps.map((o) => o.variation.name),
    overlapCount: result.overlapCount,
    firstOverlapDate: result.overlapDates[0] ?? null,
    hasScheduleConflict,
    firstScheduleConflictDate: result.scheduleConflictDates[0] ?? null,
    suggestedActions: ["chain", "replace", "cancel"],
    overlaps: result.overlaps,
  };
}

/** Inputs for {@link replaceVariation}. */
export interface ReplaceVariationInput {
  /** The existing variation being superseded. */
  existing: RecurringVariation;
  /** The new variation that replaces it. */
  replacement: RecurringVariation;
  /** ISO timestamp/date used to bound and stamp. Defaults to now. */
  now?: string;
}

/** Result of {@link replaceVariation} — both variations updated, none deleted. */
export interface ReplaceVariationResult {
  /** The existing variation, bounded + archived + back-linked to its replacement. */
  existing: RecurringVariation;
  /** The replacement variation, forward-linked to the variation it replaced. */
  replacement: RecurringVariation;
}

/** The "YYYY-MM-DD" date one day before `iso`, or null if `iso` is invalid. */
function dayBefore(iso: string): string | null {
  const d = parseDateOnly(iso);
  if (!d) return null;
  d.setDate(d.getDate() - 1);
  return toDateOnly(d);
}

/**
 * Prepares an existing variation for replacement by a new one, preserving full
 * history. The existing variation is:
 * 1. Bounded — `appliesUntil` is set to the day before the replacement begins
 *    (the replacement's `appliesFrom`, falling back to today), but only when
 *    that tightens the existing window.
 * 2. Archived — moved to `status: "archived"` so it stops applying but stays
 *    recoverable (never deleted).
 * 3. Back-linked — `replacedByVariationId` and `replacedAt` are recorded.
 *
 * The replacement is forward-linked via `replacesVariationId`. Pure — returns new
 * objects and never mutates its inputs. No persistence or UI here.
 */
export function replaceVariation(
  input: ReplaceVariationInput,
): ReplaceVariationResult {
  const nowIso = input.now ?? new Date().toISOString();
  const nowDate = nowIso.slice(0, 10);
  const replacementStart = input.replacement.appliesFrom || nowDate;
  const boundary = dayBefore(replacementStart);

  // Only tighten the window — never extend an already-earlier end date.
  let appliesUntil = input.existing.appliesUntil;
  if (boundary && (!appliesUntil || boundary < appliesUntil)) {
    appliesUntil = boundary;
  }

  const existing: RecurringVariation = {
    ...input.existing,
    appliesUntil,
    status: "archived",
    archived: true,
    enabled: false,
    replacedByVariationId: input.replacement.id,
    replacedAt: nowIso,
    updatedAt: nowIso,
  };

  const replacement: RecurringVariation = {
    ...input.replacement,
    replacesVariationId: input.existing.id,
    updatedAt: nowIso,
  };

  return { existing, replacement };
}
