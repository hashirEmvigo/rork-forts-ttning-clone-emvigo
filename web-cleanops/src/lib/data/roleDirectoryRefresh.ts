/**
 * Lightweight refresh signal for the Supabase role directory read seam.
 * CORE-WRITES-A2.1 mutations bump this after successful authoritative Supabase
 * role writes so AppContext refetches roles without touching browser storage.
 */
let roleDirectoryRefreshVersion = 0;
const listeners = new Set<() => void>();

/** Signals that role templates should refetch from Supabase. */
export function bumpRoleDirectoryRefresh(): void {
  roleDirectoryRefreshVersion += 1;
  for (const listener of listeners) listener();
}

/** Current refresh version for useSyncExternalStore. */
export function getRoleDirectoryRefreshVersion(): number {
  return roleDirectoryRefreshVersion;
}

/** Subscribes to role directory refresh bumps. */
export function subscribeRoleDirectoryRefresh(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
