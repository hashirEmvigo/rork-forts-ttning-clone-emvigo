/**
 * Operational Execution — Mission Log delay projection (Phase 1 foundation).
 *
 * Pure operational forecast helpers. Mission Log calculates delay projections
 * WITHOUT ever mutating the Schedule — Schedule remains the planned source of
 * truth. These helpers only compute numbers; persistence, events and any
 * downstream projection mutation are built in a later phase.
 */

/**
 * Estimates a mission's delay from lost staff capacity.
 *
 * Example: a 2-person mission where one employee is 20 minutes late loses 20
 * staff-minutes; spread across the team that is `ceil(20 / 2) = 10` minutes of
 * mission delay. The effective team size is clamped to at least 1 so a missing
 * team size never divides by zero. Negative per-employee lateness is treated as
 * 0 (early arrival does not create delay). Pure.
 */
export function calculateMissionDelay(input: {
  plannedTeamSize: number;
  lateEmployeeMinutes: number[];
  scheduledDurationMinutes: number;
  currentActualProgressMinutes?: number;
}): number {
  const totalLostStaffMinutes = input.lateEmployeeMinutes.reduce(
    (sum, minutes) => sum + Math.max(0, Number.isFinite(minutes) ? minutes : 0),
    0,
  );
  const effectiveTeamSize = Math.max(Math.floor(input.plannedTeamSize) || 0, 1);
  return Math.ceil(totalLostStaffMinutes / effectiveTeamSize);
}
