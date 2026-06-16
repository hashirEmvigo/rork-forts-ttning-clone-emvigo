/**
 * Lightweight refresh signal for Supabase customer directory/detail read seams.
 * CORE-WRITES-CUSTOMERS-A1.1 mutations bump this after successful authoritative
 * Supabase writes so customer list/detail views refetch without browser storage.
 */
let customerDirectoryRefreshVersion = 0;
const listeners = new Set<() => void>();

/** Signals that customer list/detail directories should refetch from Supabase. */
export function bumpCustomerDirectoryRefresh(): void {
  customerDirectoryRefreshVersion += 1;
  for (const listener of listeners) listener();
}

/** Current refresh version for useSyncExternalStore. */
export function getCustomerDirectoryRefreshVersion(): number {
  return customerDirectoryRefreshVersion;
}

/** Subscribes to customer directory refresh bumps. */
export function subscribeCustomerDirectoryRefresh(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
