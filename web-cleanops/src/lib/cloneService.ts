/**
 * Helpers for the Clone / reactivate service flow.
 *
 * Cloning copies an existing service row's details but lets the admin pick a
 * fresh start date. The original end date should only carry over when it is
 * still valid relative to the new start date — otherwise the clone would fail
 * validation ("The end date must be on or after the service date").
 */

/**
 * Resolves the end date a cloned service should use.
 *
 * - Keeps the original end date when it is on/after the new start date.
 * - Clears it (returns `null`) when the original end date falls before the new
 *   start date, so the clone starts open-ended instead of being invalid.
 * - Clears it when there is no original end date.
 *
 * Dates are ISO `YYYY-MM-DD` strings, which compare correctly lexicographically.
 */
export function resolveClonedEndDate(
  originalEndDate: string | null | undefined,
  newStartDate: string,
): string | null {
  const end = originalEndDate?.trim();
  const start = newStartDate.trim();
  if (!end || !start) return null;
  return end >= start ? end : null;
}
