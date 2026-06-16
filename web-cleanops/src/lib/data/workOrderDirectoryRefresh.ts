/**
 * Lightweight refresh signal for Supabase work-order list/detail read seams.
 * CORE-WRITES-WORKORDERS-A1.1 mutations bump this after successful authoritative
 * Supabase writes so work-order views refetch without browser storage.
 */
let workOrderDirectoryRefreshVersion = 0;
const listeners = new Set<() => void>();

/** Signals that work-order list/detail directories should refetch from Supabase. */
export function bumpWorkOrderDirectoryRefresh(): void {
  workOrderDirectoryRefreshVersion += 1;
  for (const listener of listeners) listener();
}

/** Current refresh version for useSyncExternalStore. */
export function getWorkOrderDirectoryRefreshVersion(): number {
  return workOrderDirectoryRefreshVersion;
}

/** Subscribes to work-order directory refresh bumps. */
export function subscribeWorkOrderDirectoryRefresh(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
