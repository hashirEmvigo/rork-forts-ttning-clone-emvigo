import {
  deriveBookingAssignmentStatus,
  getVariationDisplayState,
  normalizeUnassignedSlots,
} from "@/types";
import type {
  BookingAssignmentStatus,
  RecurrenceInterval,
  RecurringVariation,
  WeekDay,
} from "@/types";
import { parseDateOnly, recurrenceStep } from "./recurrence";

/**
 * Pure variation resolver (Step 1 foundation).
 *
 * Determines how recurring/one-time variations modify a single base occurrence
 * and returns the resolved values, the variations that applied, and any
 * field-level conflicts. This layer is intentionally NOT wired into the Booking
 * Queue yet — it is a side-effect-free foundation usable later by Booking Queue
 * rendering, the AO preview, and the variation creation warning dialog.
 *
 * Hard rules enforced here:
 * - Variation matching is anchored to the service series start (via the
 *   occurrence index), NEVER to the visible Booking Queue date range, so
 *   "every fourth week" can't drift when the user changes the visible range.
 * - This resolver does NOT apply {@link import("@/types").BookingOccurrenceException}.
 *   A manual exception always wins and is applied AFTER this resolver by the caller.
 * - The resolver never touches the occurrenceKey; identity stays anchored to the
 *   base occurrence date.
 */

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

/** 1 (first) … 5; ordinal occurrence of the weekday within the month. */
function weekOfMonth(d: Date): number {
  return Math.ceil(d.getDate() / 7);
}

/** Largest minute-of-day that still formats to a valid same-day "HH:MM". */
const MAX_MINUTE_OF_DAY = 23 * 60 + 59;

/**
 * Adds `durationMinutes` to a "HH:MM" start time and returns the resulting
 * "HH:MM", or null when the start is missing/invalid or the duration isn't a
 * positive finite number. The result is clamped to the same day (max "23:59")
 * so a duration-only variation can never produce an invalid time.
 */
export function addMinutesToTimeString(
  start: string | null | undefined,
  durationMinutes: number | null | undefined,
): string | null {
  if (!start) return null;
  if (durationMinutes == null || !Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    return null;
  }
  const match = /^(\d{1,2}):(\d{2})$/.exec(start.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  const total = Math.min(MAX_MINUTE_OF_DAY, hours * 60 + minutes + Math.round(durationMinutes));
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/** Whether `d` is the last occurrence of its weekday within the month. */
function isLastWeekdayOfMonth(d: Date): boolean {
  const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return d.getDate() + 7 > daysInMonth;
}

/**
 * The 0-based position of `occurrenceDate` within the recurring series that
 * starts at `seriesStartIso`, computed purely from the recurrence rule. This is
 * what anchors variation matching to the series start instead of the visible
 * date range. Returns 0 for one-time/unknown intervals or invalid input.
 */
export function occurrenceIndexFromStart(
  seriesStartIso: string | null | undefined,
  occurrenceDate: string,
  interval: RecurrenceInterval | undefined | null,
): number {
  const start = parseDateOnly(seriesStartIso ?? null);
  const occ = parseDateOnly(occurrenceDate);
  if (!start || !occ) return 0;
  const step = recurrenceStep(interval);
  if (!step) return 0;
  if (step.unit === "day") {
    const days = Math.round((occ.getTime() - start.getTime()) / 86_400_000);
    return Math.max(0, Math.round(days / step.n));
  }
  const months =
    (occ.getFullYear() - start.getFullYear()) * 12 +
    (occ.getMonth() - start.getMonth());
  return Math.max(0, Math.round(months / step.n));
}

/**
 * Whether a variation's recurrence pattern matches the occurrence at
 * `occurrenceIndex` (0-based, anchored to series start) on `date`. Validity
 * window and lifecycle status are checked separately in {@link resolveOccurrenceVariations}.
 *
 * For "every_n_weeks" / "every_n_visits": when the variation sets
 * {@link RecurringVariation.anchorOccurrenceIndex}, matching is calculated from
 * that selected occurrence (`index >= anchor && (index - anchor) % n === 0`).
 * Otherwise it falls back to the legacy series-phased rule
 * (`(index + 1) % n === 0`), keeping existing variations unchanged.
 */
export function variationMatchesOccurrence(
  v: RecurringVariation,
  occurrenceIndex: number,
  date: Date,
): boolean {
  switch (v.frequency) {
    case "every_n_weeks":
    case "every_n_visits": {
      const n = Math.max(1, v.interval ?? 1);
      // Anchored matching: the variation first applies at its anchor occurrence
      // and then every Nth occurrence after it, calculated from the selected
      // occurrence rather than from the series start.
      if (v.anchorOccurrenceIndex != null && Number.isFinite(v.anchorOccurrenceIndex)) {
        const anchor = Math.max(0, Math.floor(v.anchorOccurrenceIndex));
        return occurrenceIndex >= anchor && (occurrenceIndex - anchor) % n === 0;
      }
      // Legacy series-phased matching (backward compatible — unchanged behavior).
      return (occurrenceIndex + 1) % n === 0;
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

/** The base occurrence values a resolution starts from. */
export interface ResolverBaseOccurrence {
  /** ISO date "YYYY-MM-DD" of the occurrence (kept stable by the resolver). */
  occurrenceDate: string;
  day?: WeekDay;
  startTime: string | null;
  endTime: string | null;
  durationMinutes: number | null;
  assignedEmployeeIds: string[];
  unassignedEmployeeSlots: number;
  notes?: string | null;
}

/** Inputs for {@link resolveOccurrenceVariations}. */
export interface ResolveOccurrenceVariationsInput {
  /** The base occurrence values (derived from the service row / occurrence). */
  base: ResolverBaseOccurrence;
  /** 0-based index from series start — anchors matching to the series, not the view. */
  occurrenceIndex: number;
  /** Candidate variations (active and inactive are filtered defensively here). */
  variations: RecurringVariation[];
  /** Optional "today" for validity checks; defaults to the occurrence date. */
  today?: string;
}

/** Absolute fields where the last variation in chain order wins. */
export type ResolvableAbsoluteField =
  | "day"
  | "startTime"
  | "endTime"
  | "durationMinutes"
  | "assignedEmployeeIds"
  | "notes";

/** A field set by two or more chained variations (the last one won). */
export interface VariationFieldConflict {
  field: ResolvableAbsoluteField;
  /** Variations that set this field, in chain order. */
  variationIds: string[];
  variationNames: string[];
}

/** Resolved occurrence values after chained variations are applied. */
export interface ResolvedOccurrenceValues {
  day?: WeekDay;
  startTime: string | null;
  endTime: string | null;
  durationMinutes: number | null;
  assignedEmployeeIds: string[];
  unassignedEmployeeSlots: number;
  assignmentStatus: BookingAssignmentStatus;
  notes: string | null;
}

/** Output of {@link resolveOccurrenceVariations}. */
export interface OccurrenceVariationResolution {
  /** True when at least one variation applied. */
  isVariation: boolean;
  /** True when two or more variations chained on this occurrence. */
  isChained: boolean;
  /** Final resolved values (base + chained variation overrides). */
  resolved: ResolvedOccurrenceValues;
  /** Ids of applied variations, in chain order. */
  appliedVariationIds: string[];
  /** Names of applied variations, in chain order. */
  appliedVariationNames: string[];
  /** Non-blocking warnings: absolute fields modified by 2+ variations. */
  conflicts: VariationFieldConflict[];
}

/**
 * Sorts variations into the order they are applied when chaining: by
 * {@link RecurringVariation.chainOrder} ascending (treated as priority), then by
 * {@link RecurringVariation.createdAt} ascending, then by id for stability.
 */
function sortChainOrder(variations: RecurringVariation[]): RecurringVariation[] {
  return [...variations].sort((a, b) => {
    const ao = a.chainOrder;
    const bo = b.chainOrder;
    if (ao != null && bo != null && ao !== bo) return ao - bo;
    if (ao != null && bo == null) return -1;
    if (ao == null && bo != null) return 1;
    const ac = a.createdAt ?? "";
    const bc = b.createdAt ?? "";
    if (ac !== bc) return ac < bc ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * Resolves how the given variations modify a single base occurrence.
 *
 * Behaviour:
 * - Only variations that are Active (per {@link getVariationDisplayState}), not
 *   replaced, and whose recurrence pattern matches the occurrence index are
 *   applied.
 * - Applied variations are processed in chain order (see {@link sortChainOrder}).
 * - Absolute fields (day/time/duration/employees/notes): the last variation in
 *   chain order wins; if 2+ variations set the same field, a non-blocking
 *   conflict is reported (the change is NOT blocked).
 * - Additive field (unassignedSlotsDelta): all deltas SUM on top of the base
 *   open-slot count (never below zero).
 *
 * Pure and side-effect free — safe to call during render. Does not apply
 * BookingOccurrenceException and never alters the occurrence identity.
 */
export function resolveOccurrenceVariations(
  input: ResolveOccurrenceVariationsInput,
): OccurrenceVariationResolution {
  const { base, occurrenceIndex } = input;
  const today = input.today ?? base.occurrenceDate;
  const date = parseDateOnly(base.occurrenceDate);

  // Base resolution (used when no variation applies, or as the starting point).
  const baseUnassigned = normalizeUnassignedSlots(base.unassignedEmployeeSlots);
  const baseResolved: ResolvedOccurrenceValues = {
    day: base.day,
    startTime: base.startTime,
    endTime: base.endTime,
    durationMinutes: base.durationMinutes,
    assignedEmployeeIds: [...base.assignedEmployeeIds],
    unassignedEmployeeSlots: baseUnassigned,
    assignmentStatus: deriveBookingAssignmentStatus(
      base.assignedEmployeeIds.length,
      baseUnassigned,
    ),
    notes: base.notes ?? null,
  };

  if (!date) {
    return {
      isVariation: false,
      isChained: false,
      resolved: baseResolved,
      appliedVariationIds: [],
      appliedVariationNames: [],
      conflicts: [],
    };
  }

  const candidates = (input.variations ?? []).filter((v) => {
    if (!v) return false;
    if (v.replacedByVariationId || v.replacedAt) return false;
    if (getVariationDisplayState(v, today) !== "active") return false;
    return variationMatchesOccurrence(v, occurrenceIndex, date);
  });

  if (candidates.length === 0) {
    return {
      isVariation: false,
      isChained: false,
      resolved: baseResolved,
      appliedVariationIds: [],
      appliedVariationNames: [],
      conflicts: [],
    };
  }

  const ordered = sortChainOrder(candidates);

  // Apply absolute overrides (last writer wins) and accumulate additive deltas.
  let day = base.day;
  let startTime = base.startTime;
  let endTime = base.endTime;
  let durationMinutes = base.durationMinutes;
  let assignedEmployeeIds = [...base.assignedEmployeeIds];
  let notes = base.notes ?? null;
  let slotDelta = 0;

  const fieldSetters = new Map<ResolvableAbsoluteField, RecurringVariation[]>();
  const recordField = (field: ResolvableAbsoluteField, v: RecurringVariation): void => {
    const list = fieldSetters.get(field);
    if (list) list.push(v);
    else fieldSetters.set(field, [v]);
  };

  for (const v of ordered) {
    if (v.day !== undefined) {
      day = v.day;
      recordField("day", v);
    }
    if (v.startTime != null && v.startTime !== "") {
      startTime = v.startTime;
      recordField("startTime", v);
    }
    if (v.endTime != null && v.endTime !== "") {
      endTime = v.endTime;
      recordField("endTime", v);
    }
    if (v.durationMinutes !== undefined) {
      durationMinutes = v.durationMinutes;
      recordField("durationMinutes", v);
    }
    if (v.assignedEmployeeIds !== undefined) {
      assignedEmployeeIds = [...v.assignedEmployeeIds];
      recordField("assignedEmployeeIds", v);
    }
    const note = v.internalNote ?? v.notes;
    if (note != null && note !== "") {
      notes = note;
      recordField("notes", v);
    }
    if (v.unassignedSlotsDelta !== undefined && Number.isFinite(v.unassignedSlotsDelta)) {
      slotDelta += v.unassignedSlotsDelta;
    }
  }

  // Duration-only variations: when a variation explicitly sets durationMinutes
  // but does NOT set an explicit endTime, derive the end time from the resolved
  // start + duration so the new duration actually affects the visit/labour
  // window. An explicit endTime (from any variation) always wins, so the
  // derivation only runs when no variation set endTime. The base endTime is
  // intentionally overridden here because the variation's duration is the
  // authoritative signal in that case.
  if (
    fieldSetters.has("durationMinutes") &&
    !fieldSetters.has("endTime") &&
    startTime != null
  ) {
    const derivedEnd = addMinutesToTimeString(startTime, durationMinutes);
    if (derivedEnd != null) endTime = derivedEnd;
  }

  const unassignedEmployeeSlots = Math.max(0, baseUnassigned + slotDelta);

  const conflicts: VariationFieldConflict[] = [];
  for (const [field, setters] of fieldSetters) {
    if (setters.length >= 2) {
      conflicts.push({
        field,
        variationIds: setters.map((s) => s.id),
        variationNames: setters.map((s) => s.name),
      });
    }
  }

  return {
    isVariation: true,
    isChained: ordered.length >= 2,
    resolved: {
      day,
      startTime,
      endTime,
      durationMinutes,
      assignedEmployeeIds,
      unassignedEmployeeSlots,
      assignmentStatus: deriveBookingAssignmentStatus(
        assignedEmployeeIds.length,
        unassignedEmployeeSlots,
      ),
      notes,
    },
    appliedVariationIds: ordered.map((v) => v.id),
    appliedVariationNames: ordered.map((v) => v.name),
    conflicts,
  };
}
