/**
 * Time-conflict detection — Phase 3B (simple v1). Pure.
 *
 * When an occurrence is moved to a new time (or date+time), it may now overlap
 * another booking that shares an assigned employee on the same day. v1 only
 * DETECTS and REPORTS the overlap so the UI can warn the dispatcher; it never
 * moves, shifts or compresses any other booking (no cascading, no route
 * optimisation — those land after the availability + conflict engine).
 *
 * Recommended policy for v1 is "warning + override", not a hard block: there's
 * no employee/customer availability data yet, so the dispatcher must stay able
 * to deliberately schedule an overlap they know is fine.
 *
 * Overlap rule: two windows on the SAME date conflict when their half-open
 * intervals [start, end) intersect — `aStart < bEnd && bStart < aEnd`. Touching
 * edges (one ends exactly when the other starts) do NOT conflict.
 */

/** The moved occurrence's candidate window to test for overlaps. */
export interface ConflictCandidate {
  /** The moving occurrence's stable key — excluded from its own conflict set. */
  occurrenceKey: string;
  date: string;
  startTime: string;
  endTime: string;
}

/** A neighbouring occurrence the candidate is tested against. */
export interface ConflictNeighbour {
  occurrenceKey: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  customerName: string;
  serviceName: string;
  /** Time label for display, e.g. "10:15–12:15". */
  timeLabel: string;
}

/** A reported overlap (a subset of the neighbour facts the warning shows). */
export interface ConflictWindow {
  occurrenceKey: string;
  customerName: string;
  serviceName: string;
  timeLabel: string;
}

/** Minutes since midnight for a canonical "HH:mm", or null when invalid. */
function minutesOf(value: string | null): number | null {
  if (!value) return null;
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * Returns the neighbours whose window overlaps the candidate's new window on the
 * same date. The candidate's own occurrence and any neighbour without a valid
 * window are ignored. Pure — no side effects, no persistence.
 */
export function detectTimeConflicts(
  candidate: ConflictCandidate,
  neighbours: ConflictNeighbour[],
): ConflictWindow[] {
  const aStart = minutesOf(candidate.startTime);
  const aEnd = minutesOf(candidate.endTime);
  if (aStart == null || aEnd == null || aEnd <= aStart) return [];

  const conflicts: ConflictWindow[] = [];
  for (const neighbour of neighbours) {
    if (neighbour.occurrenceKey === candidate.occurrenceKey) continue;
    if (neighbour.date !== candidate.date) continue;
    const bStart = minutesOf(neighbour.startTime);
    const bEnd = minutesOf(neighbour.endTime);
    if (bStart == null || bEnd == null || bEnd <= bStart) continue;
    // Half-open overlap: touching edges don't conflict.
    if (aStart < bEnd && bStart < aEnd) {
      conflicts.push({
        occurrenceKey: neighbour.occurrenceKey,
        customerName: neighbour.customerName,
        serviceName: neighbour.serviceName,
        timeLabel: neighbour.timeLabel,
      });
    }
  }
  return conflicts;
}
