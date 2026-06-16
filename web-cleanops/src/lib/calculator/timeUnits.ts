/**
 * Slice 12N — global time-unit UX standard for Calculator admin settings.
 *
 * Time-based calculator settings are stored in their existing unit (minutes OR
 * hours, depending on the rule key) and must NEVER change meaning. These helpers
 * are a pure display/edit adapter: they format a stored value as a human-readable
 * "X min (Y h)" string and convert freely between minutes and hours so the admin
 * can edit either field with both mirroring each other.
 */

/** Loosely parse a user-entered number, tolerating spaces and a comma decimal. */
export function parseLooseNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const cleaned = trimmed.replace(/\s/g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Plain dot-decimal string with trailing zeros trimmed (0.5, 0.25, 3, -0.25).
 * `maxDecimals` caps display precision without introducing floating-point noise.
 */
export function formatPlainNumber(n: number, maxDecimals = 4): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = Number(n.toFixed(maxDecimals));
  // Number() collapses -0 → 0 and strips trailing zeros via String().
  return String(rounded === 0 ? 0 : rounded);
}

export function minutesToHours(minutes: number): number {
  return minutes / 60;
}

export function hoursToMinutes(hours: number): number {
  return hours * 60;
}

/** "30 min (0.5 h)" / "-15 min (-0.25 h)" from a MINUTE value. */
export function formatMinutesWithHours(minutes: number): string {
  return `${formatPlainNumber(minutes, 2)} min (${formatPlainNumber(minutes / 60, 4)} h)`;
}

/** "30 min (0.5 h)" / "-15 min (-0.25 h)" from an HOUR value. */
export function formatHoursWithMinutes(hours: number): string {
  return `${formatPlainNumber(hours * 60, 2)} min (${formatPlainNumber(hours, 4)} h)`;
}

/** "1.2 min/m² (0.02 h/m²)" from an hours-per-m² value. */
export function formatHoursPerSqm(hoursPerSqm: number): string {
  return `${formatPlainNumber(hoursPerSqm * 60, 2)} min/m² (${formatPlainNumber(hoursPerSqm, 4)} h/m²)`;
}
