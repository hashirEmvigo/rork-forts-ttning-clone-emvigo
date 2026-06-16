/**
 * Lightweight refresh signal for the Supabase time-code directory read seam.
 *
 * The TIMECODE-5 authoritative mutations bump this AFTER a confirmed Supabase
 * write so {@link import("@/hooks/use-time-code-directory-source").useTimeCodeDirectorySource}
 * refetches the directory from Supabase and the UI reflects the true persisted
 * state. It never touches browser storage and carries no domain data \u2014 it is a
 * pure version counter, the Time Codes analogue of
 * {@link import("./serviceCatalogDirectoryRefresh")}.
 */
let timeCodeDirectoryRefreshVersion = 0;
const listeners = new Set<() => void>();

/** Signals that the time-code directory should refetch from Supabase. */
export function bumpTimeCodeDirectoryRefresh(): void {
  timeCodeDirectoryRefreshVersion += 1;
  for (const listener of listeners) listener();
}

/** Current refresh version for `useSyncExternalStore`. */
export function getTimeCodeDirectoryRefreshVersion(): number {
  return timeCodeDirectoryRefreshVersion;
}

/** Subscribes to time-code directory refresh bumps; returns an unsubscribe fn. */
export function subscribeTimeCodeDirectoryRefresh(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
