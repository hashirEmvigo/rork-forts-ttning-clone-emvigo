/** Formats an ISO date string as e.g. "12 Mar 2025". */
export function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

/**
 * Normalizes a "YYYY-MM-DD" date so the Date constructor parses it at local
 * midnight (avoids the UTC-midnight-then-timezone-shift off-by-one-day bug).
 */
function toLocalIso(iso: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00` : iso;
}

/** Formats the weekday only, e.g. "Tuesday". */
export function formatWeekday(iso: string): string {
  try {
    return new Date(toLocalIso(iso)).toLocaleDateString("en-GB", { weekday: "long" });
  } catch {
    return "—";
  }
}

/**
 * Shared date formatter that prefixes the weekday, e.g. "Saturday 30 May 2026".
 * Use this everywhere the original/new day of a booking matters (Booking Queue,
 * reschedule information rows, AO Services, Variation Wizard, Schedule) so a
 * single date style is used for the same concept.
 */
export function formatDateWithWeekday(iso: string): string {
  const weekday = formatWeekday(iso);
  const date = formatDate(iso);
  if (weekday === "—" || date === "—") return "—";
  return `${weekday} ${date}`;
}

/**
 * Formats a planned time window like "08:00–10:00" (en-dash, no surrounding
 * spaces). Returns null when neither bound is known so callers can omit the
 * window. Shared so the Booking Queue, reschedule rows and Schedule all render
 * times identically.
 */
export function formatTimeRange(
  start?: string | null,
  end?: string | null,
): string | null {
  if (!start && !end) return null;
  return `${start ?? "—"}\u2013${end ?? "—"}`;
}

/** Formats an ISO timestamp as e.g. "12 Mar 2025, 14:30". */
export function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

/** Formats a number as a currency amount, e.g. "4,900 kr". Defaults to NOK. */
export function formatCurrency(amount: number, currency = "NOK"): string {
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return String(amount);
  }
}

/**
 * Display form of a customer number for ID columns: the visible numeric series
 * without the stored "C-" prefix (e.g. "C-1042" → "1042"). The stored value is
 * never changed — this is display-only. Any value that does not carry the
 * standard "C-" prefix is returned unchanged, and an empty value renders as "—".
 */
export function customerNumberDisplay(customerNumber: string | null | undefined): string {
  const raw = customerNumber?.trim() ?? "";
  if (!raw) return "—";
  const match = /^C-(.+)$/i.exec(raw);
  return match ? match[1] : raw;
}

/** Returns the uppercase initials for a name (max 2 characters). */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
