/**
 * Lightweight refresh signal for Supabase Booking Queue read seams.
 * Booking Queue mirror writes bump this after a successful Supabase write so
 * queue views refetch without relying on browser storage hydration.
 */
let bookingQueueDirectoryRefreshVersion = 0;
const listeners = new Set<() => void>();

/** Signals that Booking Queue directories should refetch from Supabase. */
export function bumpBookingQueueDirectoryRefresh(): void {
  bookingQueueDirectoryRefreshVersion += 1;
  for (const listener of listeners) listener();
}

/** Bumps the directory refresh signal only after a successful Booking Queue mirror write. */
export function bumpBookingQueueDirectoryRefreshAfterSuccessfulMirror(result: { ok: boolean }): void {
  if (result.ok) bumpBookingQueueDirectoryRefresh();
}

/** Current refresh version for useSyncExternalStore. */
export function getBookingQueueDirectoryRefreshVersion(): number {
  return bookingQueueDirectoryRefreshVersion;
}

/** Subscribes to Booking Queue directory refresh bumps. */
export function subscribeBookingQueueDirectoryRefresh(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
