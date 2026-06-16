import {
  calculatePlannedDurationMinutes,
  calculatePlannedLabourMinutes,
  makeOccurrenceKey,
  normalizeUnassignedSlots,
} from "@/types";
import type {
  BookingOccurrenceException,
  RecurringVariation,
  WorkOrderServiceRow,
} from "@/types";
import { parseDateOnly, recurrenceOccurrences, toDateOnly } from "./recurrence";
import {
  occurrenceIndexFromStart,
  resolveOccurrenceVariations,
  variationMatchesOccurrence,
} from "./variationResolver";

/**
 * Shared, side-effect-free generator for the upcoming concrete occurrences of a
 * single work-order service row. This is the SAME pipeline the Booking Queue
 * uses — base occurrence → variation resolver → BookingOccurrenceException —
 * so the wizard's occurrence list never diverges from what the queue shows.
 *
 * It NEVER persists occurrences and NEVER touches occurrence identity:
 * {@link makeOccurrenceKey} (parentServiceRowId + base occurrenceDate) stays
 * anchored to the rule-derived date even when a variation shifts the visible
 * time or an exception reschedules it. Visit duration and total (labour) minutes
 * are computed from the final effective occurrence values.
 */

/** Effective status of an occurrence after its exception overlay (if any). */
export type ServiceRowOccurrenceStatus = "active" | "cancelled" | "rescheduled";

/** A single resolved upcoming occurrence for the wizard / planning surfaces. */
export interface ServiceRowOccurrence {
  /** Stable identity: `parentServiceRowId:occurrenceDate` (never shifted). */
  occurrenceKey: string;
  /** The parent service row id (stable). */
  parentServiceRowId: string;
  /** 0-based position from the series start — anchors variation matching. */
  occurrenceIndex: number;
  /**
   * The value to persist on a variation so it starts from this booking. Equals
   * {@link occurrenceIndex}; surfaced explicitly because it is the wizard's
   * primary output.
   */
  anchorOccurrenceIndex: number;
  /** Rule-derived date "YYYY-MM-DD" (identity anchor, never shifted). */
  occurrenceDate: string;
  /** Visible date "YYYY-MM-DD" — equals occurrenceDate unless rescheduled. */
  displayDate: string;
  /** Resolved planned start "HH:MM" (after variation/exception), or null. */
  startTime: string | null;
  /** Resolved planned end "HH:MM" (after variation/exception), or null. */
  endTime: string | null;
  /**
   * Planned start "HH:MM" BEFORE the exception overlay (base + variation only),
   * or null. Equals {@link startTime} when no exception changed the time. The
   * authoritative source a schedule needs to detect a manual time change.
   */
  preExceptionStartTime: string | null;
  /** Planned end "HH:MM" before the exception overlay, or null. */
  preExceptionEndTime: string | null;
  /** Wall-clock visit duration in minutes (or null when no valid window). */
  visitMinutes: number | null;
  /** Total planned labour effort in minutes (or null when no valid window). */
  labourMinutes: number | null;
  /** Planned labour minutes per assigned employee (visit window, or pinned total ÷ crew). */
  perEmployeeMinutes: number | null;
  /** True when a labour override pinned the total (a redistributed job). */
  isLabourRedistributed: boolean;
  /** Resolved assigned employee ids (after variation/exception). */
  assignedEmployeeIds: string[];
  /** Resolved open employee slots. */
  unassignedEmployeeSlots: number;
  /** Effective status after the exception overlay. */
  status: ServiceRowOccurrenceStatus;
  /** True when at least one variation applied to this occurrence. */
  isVariation: boolean;
}

/** Options for {@link generateServiceRowOccurrences}. */
export interface GenerateServiceRowOccurrencesOptions {
  /** The source service row (source of truth for recurrence + staffing). */
  row: WorkOrderServiceRow;
  /** Inclusive lower bound "YYYY-MM-DD"; defaults to today (local). */
  fromDate?: string;
  /** Optional inclusive upper bound "YYYY-MM-DD" for a date-range search. */
  toDate?: string;
  /** Max occurrences to return. Defaults to {@link DEFAULT_OCCURRENCE_LIMIT}. */
  limit?: number;
  /** Persisted exception overlays keyed by occurrence key (optional). */
  exceptions?: Map<string, BookingOccurrenceException>;
}

/** Default number of upcoming occurrences surfaced (the wizard's first page). */
export const DEFAULT_OCCURRENCE_LIMIT = 5;

/** Hard cap so a misconfigured range/interval can never loop unbounded. */
const HARD_CAP = 500;

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

/**
 * Generates the upcoming occurrences for `row`, on/after `fromDate` (default
 * today), optionally bounded above by `toDate`, limited to `limit` results.
 * Respects service recurrence, the optional series end date, recurring
 * variations (via the shared resolver) and BookingOccurrenceException overlays.
 * Pure — safe to call during render.
 */
export function generateServiceRowOccurrences(
  options: GenerateServiceRowOccurrencesOptions,
): ServiceRowOccurrence[] {
  const { row } = options;
  const serviceDate = row.serviceDate;
  if (!serviceDate) return [];

  const interval = row.recurrenceInterval ?? "one_time";
  const limit = Math.max(0, Math.min(options.limit ?? DEFAULT_OCCURRENCE_LIMIT, HARD_CAP));
  if (limit === 0) return [];

  const fromIso = options.fromDate?.trim() || toDateOnly(new Date());
  const rangeStart = startOfDay(parseDateOnly(fromIso) ?? new Date());

  // Without an explicit upper bound, scan up to a generous far-future date; the
  // `limit` is what actually bounds the result, not the date window.
  const farFuture = new Date(rangeStart);
  farFuture.setFullYear(farFuture.getFullYear() + 5);
  const toBound = options.toDate ? parseDateOnly(options.toDate) : null;
  const rangeEnd = toBound ? endOfDay(toBound) : endOfDay(farFuture);
  const seriesEnd = row.serviceEndDate
    ? endOfDay(parseDateOnly(row.serviceEndDate) ?? farFuture)
    : null;

  const dates = recurrenceOccurrences(serviceDate, interval, {
    rangeStart,
    rangeEnd,
    horizonEnd: endOfDay(farFuture),
    seriesEnd,
  });

  const variations = row.variations ?? [];
  const baseAssigned = row.assignedEmployeeIds ?? [];
  const baseSlots = normalizeUnassignedSlots(row.unassignedEmployeeSlots);
  const baseDuration = calculatePlannedDurationMinutes(
    row.plannedStartTime,
    row.plannedEndTime,
  );

  const out: ServiceRowOccurrence[] = [];
  for (const dateIso of dates) {
    if (out.length >= limit) break;

    const occurrenceIndex = occurrenceIndexFromStart(serviceDate, dateIso, interval);

    // Base occurrence → variation resolver (anchored to the series start).
    const resolution = resolveOccurrenceVariations({
      base: {
        occurrenceDate: dateIso,
        startTime: row.plannedStartTime ?? null,
        endTime: row.plannedEndTime ?? null,
        durationMinutes: baseDuration,
        assignedEmployeeIds: baseAssigned,
        unassignedEmployeeSlots: baseSlots,
        notes: null,
      },
      occurrenceIndex,
      variations,
    });
    const resolved = resolution.resolved;

    // Exception overlay (mirrors applyOccurrenceException — a manual exception
    // always wins after variations). Identity (occurrenceKey/occurrenceDate) is
    // never derived from the override date.
    const occurrenceKey = makeOccurrenceKey(row.id, dateIso);
    const exception = options.exceptions?.get(occurrenceKey);
    let status: ServiceRowOccurrenceStatus = "active";
    let displayDate = dateIso;
    let startTime = resolved.startTime;
    let endTime = resolved.endTime;
    // Captured before the exception overlay so callers can tell a manual time
    // change from a same-time reschedule (or a date-only move).
    const preExceptionStartTime = resolved.startTime;
    const preExceptionEndTime = resolved.endTime;
    if (exception?.status === "cancelled") {
      status = "cancelled";
    } else if (exception?.status === "rescheduled") {
      status = "rescheduled";
      displayDate = exception.overrideOccurrenceDate ?? displayDate;
      startTime = exception.overrideStartTime ?? startTime;
      endTime = exception.overrideEndTime ?? endTime;
    }

    // Per-occurrence STAFFING override (reassignment) from the exception, applied
    // after variations and independently of cancel/reschedule status. This is the
    // foundation that lets a single recurring occurrence be reassigned without
    // mutating the base service row.
    let assignedEmployeeIds = resolved.assignedEmployeeIds;
    let unassignedEmployeeSlots = resolved.unassignedEmployeeSlots;
    let totalLabourMinutesOverride = row.totalLabourMinutesOverride;
    if (Array.isArray(exception?.overrideAssignedEmployeeIds)) {
      assignedEmployeeIds = exception.overrideAssignedEmployeeIds.filter(
        (id): id is string => typeof id === "string" && id.length > 0,
      );
    }
    if (typeof exception?.overrideUnassignedEmployeeSlots === "number") {
      unassignedEmployeeSlots = normalizeUnassignedSlots(
        exception.overrideUnassignedEmployeeSlots,
      );
    }
    if (
      typeof exception?.overrideTotalLabourMinutes === "number" &&
      Number.isFinite(exception.overrideTotalLabourMinutes) &&
      exception.overrideTotalLabourMinutes > 0
    ) {
      totalLabourMinutesOverride = exception.overrideTotalLabourMinutes;
    }

    const labour = calculatePlannedLabourMinutes({
      plannedStartTime: startTime,
      plannedEndTime: endTime,
      assignedEmployeeIds,
      unassignedEmployeeSlots,
      // Stale overrides are filtered to the resolved assignees internally, so
      // it's safe to pass them through even when a variation changed staffing.
      employeeTimeOverrides: row.employeeTimeOverrides,
      // A redistributed job pins total labour at the row/occurrence level so the
      // total job time is preserved regardless of how the crew is sized.
      totalLabourMinutesOverride,
    });

    out.push({
      occurrenceKey,
      parentServiceRowId: row.id,
      occurrenceIndex,
      anchorOccurrenceIndex: occurrenceIndex,
      occurrenceDate: dateIso,
      displayDate,
      startTime,
      endTime,
      preExceptionStartTime,
      preExceptionEndTime,
      visitMinutes: labour.visitMinutes,
      labourMinutes: labour.labourMinutes,
      perEmployeeMinutes: labour.perEmployeeMinutes,
      isLabourRedistributed: labour.isLabourRedistributed,
      assignedEmployeeIds,
      unassignedEmployeeSlots,
      status,
      isVariation: resolution.isVariation,
    });
  }

  return out;
}

/** Past vs. future generated, non-cancelled occurrence counts for a row. */
export interface ServiceRowOccurrenceCounts {
  /** Generated occurrences strictly before today (local). */
  past: number;
  /** Generated occurrences today or later (local). */
  future: number;
  /** Convenience sum of {@link past} + {@link future}. */
  total: number;
}

/**
 * Counts the generated, non-cancelled occurrences of `row`, split into past
 * (strictly before today) and future (today onward). Used by the Force Delete
 * flow to show how much history a mistaken service produced. Cancelled
 * occurrences are excluded since they never represent real work. Pure.
 */
export function countServiceRowGeneratedOccurrences(
  row: WorkOrderServiceRow,
  options?: {
    now?: Date;
    exceptions?: Map<string, BookingOccurrenceException>;
  },
): ServiceRowOccurrenceCounts {
  if (!row.serviceDate) return { past: 0, future: 0, total: 0 };
  const now = options?.now ?? new Date();
  const today = startOfDay(now);
  const todayIso = toDateOnly(today);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayIso = toDateOnly(yesterday);

  const isCounted = (o: ServiceRowOccurrence): boolean => o.status !== "cancelled";

  const past = generateServiceRowOccurrences({
    row,
    fromDate: row.serviceDate,
    toDate: yesterdayIso,
    limit: HARD_CAP,
    exceptions: options?.exceptions,
  }).filter(isCounted).length;

  const future = generateServiceRowOccurrences({
    row,
    fromDate: todayIso,
    limit: HARD_CAP,
    exceptions: options?.exceptions,
  }).filter(isCounted).length;

  return { past, future, total: past + future };
}

/**
 * Whether `variation` already applied to at least one occurrence of `row`
 * strictly before `todayIso` (local "YYYY-MM-DD"). Used to decide whether a
 * variation has historical impact — and therefore must be stopped/archived
 * rather than hard-deleted.
 *
 * Pure: scans the rule-derived occurrence dates from the series start up to (but
 * not including) today, respects the variation's own validity window, and reuses
 * the shared {@link variationMatchesOccurrence} matcher so the "did it apply?"
 * rule never diverges from the resolver. Never persists anything.
 */
export function variationHasPastOccurrence(
  row: WorkOrderServiceRow,
  variation: RecurringVariation,
  todayIso: string,
): boolean {
  const serviceDate = row.serviceDate;
  if (!serviceDate) return false;
  const today = parseDateOnly(todayIso);
  const start = parseDateOnly(serviceDate);
  if (!today || !start) return false;
  // Nothing can have occurred before the series even starts.
  if (start.getTime() >= startOfDay(today).getTime()) return false;

  const interval = row.recurrenceInterval ?? "one_time";
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const seriesEnd = row.serviceEndDate ? parseDateOnly(row.serviceEndDate) : null;

  const dates = recurrenceOccurrences(serviceDate, interval, {
    rangeStart: startOfDay(start),
    rangeEnd: endOfDay(yesterday),
    horizonEnd: endOfDay(yesterday),
    seriesEnd: seriesEnd ? endOfDay(seriesEnd) : null,
  });

  for (const dateIso of dates) {
    const date = parseDateOnly(dateIso);
    if (!date) continue;
    // Respect the variation's validity window so an out-of-window date doesn't
    // count as a past application.
    if (variation.appliesFrom && dateIso < variation.appliesFrom) continue;
    if (variation.appliesUntil && dateIso > variation.appliesUntil) continue;
    const index = occurrenceIndexFromStart(serviceDate, dateIso, interval);
    if (variationMatchesOccurrence(variation, index, date)) return true;
  }
  return false;
}
