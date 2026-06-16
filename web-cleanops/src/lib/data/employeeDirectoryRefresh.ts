/**
 * Lightweight refresh signal for the Supabase employee directory read seam.
 * EMP-A1 mutations bump this after a successful authoritative Supabase write so
 * AppContext's employee directory source refetches without touching browser storage.
 */
let employeeDirectoryRefreshVersion = 0;
const listeners = new Set<() => void>();

/** Signals that the employee directory should refetch from Supabase. */
export function bumpEmployeeDirectoryRefresh(): void {
  employeeDirectoryRefreshVersion += 1;
  for (const listener of listeners) listener();
}

/** Current refresh version for useSyncExternalStore. */
export function getEmployeeDirectoryRefreshVersion(): number {
  return employeeDirectoryRefreshVersion;
}

/** Subscribes to employee directory refresh bumps. */
export function subscribeEmployeeDirectoryRefresh(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
