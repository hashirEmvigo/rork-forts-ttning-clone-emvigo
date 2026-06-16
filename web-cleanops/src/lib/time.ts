/**
 * Time formatting and parsing helpers.
 *
 * The application standardises on 24-hour time (Sweden / operational planning).
 * AM/PM is never displayed. A future application setting may switch the format,
 * so display goes through {@link formatTime} rather than ad-hoc rendering — for
 * now it is forced to 24-hour.
 */

/** Supported time-format modes. Only 24-hour is active today. */
export type TimeFormat = "24h" | "12h";

/** Forced application time format until a user setting is introduced. */
export const APP_TIME_FORMAT: TimeFormat = "24h";

/** Matches a strict "HH:MM" string in 24-hour range (00:00–23:59). */
const TIME_24H_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Returns true when `value` is a valid 24-hour "HH:MM" string. */
export function isValidTime24(value: string): boolean {
  return TIME_24H_RE.test(value.trim());
}

/**
 * Parses loose time input into a canonical "HH:MM" 24-hour string, or null when
 * it cannot be interpreted. Accepts forms like "8", "8:5", "0800", "8.30",
 * "13 30" and pads/normalises them. Rejects out-of-range values.
 */
export function parseTime24(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;

  let hours: number;
  let minutes: number;

  const sep = raw.match(/^(\d{1,2})\s*[:.\s]\s*(\d{1,2})$/);
  if (sep) {
    hours = Number(sep[1]);
    minutes = Number(sep[2]);
  } else if (/^\d{3,4}$/.test(raw)) {
    // Compact "830" / "0830" / "1330".
    const padded = raw.padStart(4, "0");
    hours = Number(padded.slice(0, 2));
    minutes = Number(padded.slice(2));
  } else if (/^\d{1,2}$/.test(raw)) {
    // Bare hour.
    hours = Number(raw);
    minutes = 0;
  } else {
    return null;
  }

  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/**
 * Formats a canonical "HH:MM" value for display. With the active 24-hour format
 * the value is returned as-is; the 12-hour branch exists for the future setting.
 */
export function formatTime(value: string, format: TimeFormat = APP_TIME_FORMAT): string {
  if (!isValidTime24(value)) return value;
  if (format === "24h") return value;
  const [h, m] = value.split(":").map(Number);
  const period = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

/** Splits a canonical "HH:MM" value into numeric hour/minute parts. */
export function splitTime(value: string): { hour: number; minute: number } | null {
  if (!isValidTime24(value)) return null;
  const [h, m] = value.split(":").map(Number);
  return { hour: h, minute: m };
}

/** Builds a canonical "HH:MM" value from numeric hour/minute parts. */
export function buildTime(hour: number, minute: number): string {
  const h = Math.min(23, Math.max(0, Math.floor(hour)));
  const m = Math.min(59, Math.max(0, Math.floor(minute)));
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Highest representable same-day minute (23:59) used to clamp time addition. */
const MAX_DAY_MINUTES = 23 * 60 + 59;

/**
 * Adds a whole number of minutes to a canonical "HH:MM" start time, returning a
 * new "HH:MM" value. Returns null when the start time is invalid or the minute
 * count is not a finite number. Results are clamped to the same day (max 23:59)
 * so a too-large duration never wraps past midnight.
 */
export function addMinutesToTime(start: string, minutes: number): string | null {
  const parts = splitTime(start);
  if (!parts) return null;
  if (!Number.isFinite(minutes)) return null;
  const total = parts.hour * 60 + parts.minute + Math.round(minutes);
  const clamped = Math.min(MAX_DAY_MINUTES, Math.max(0, total));
  return buildTime(Math.floor(clamped / 60), clamped % 60);
}

/**
 * Formats a duration in minutes as a compact decimal-hours label for the Quick
 * Duration presets, e.g. 60 → "1", 75 → "1.25", 90 → "1.5", 105 → "1.75".
 * Non-quarter values round to two decimals (70 → "1.17").
 */
export function formatDurationHoursLabel(minutes: number): string {
  return String(Number((minutes / 60).toFixed(2)));
}
