import { calculatePlannedDurationMinutes } from "@/types";

/**
 * The minimal slice of a resolved {@link import("@/types").BookingOccurrence}
 * needed to derive its visit duration. Duration is NOT a persisted field on the
 * occurrence — it is always derived from the resolved planned window so the
 * Duration cell and footer totals stay in lock-step with the TIME column.
 */
export interface OccurrenceDurationSource {
  plannedStartTime: string | null;
  plannedEndTime: string | null;
}

/**
 * Resolves the visit duration (minutes) for a Booking Queue row from the final
 * resolved occurrence's planned window — the same canonical source the TIME
 * column renders from. Falls back to the display item's snapshot duration only
 * when the resolved window can't yield a duration (e.g. an unscheduled booking
 * with no planned times). This guarantees Duration never lags a resolved
 * occurrence whose window changed without the snapshot being mirrored back.
 */
export function resolveOccurrenceDurationMinutes(
  occurrence: OccurrenceDurationSource,
  fallbackMinutes?: number | null,
): number | null {
  const derived = calculatePlannedDurationMinutes(
    occurrence.plannedStartTime,
    occurrence.plannedEndTime,
  );
  if (derived != null) return derived;
  return fallbackMinutes ?? null;
}
