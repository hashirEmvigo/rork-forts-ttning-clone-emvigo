/**
 * Lightweight refresh signal for the Supabase service/catalog directory read seams.
 * CORE-WRITES-A1 mutations bump this after successful authoritative Supabase
 * writes so AppContext refetches services and service categories without touching
 * browser storage.
 */
let serviceCatalogDirectoryRefreshVersion = 0;
const listeners = new Set<() => void>();

/** Signals that service and category directories should refetch from Supabase. */
export function bumpServiceCatalogDirectoryRefresh(): void {
  serviceCatalogDirectoryRefreshVersion += 1;
  for (const listener of listeners) listener();
}

/** Current refresh version for useSyncExternalStore. */
export function getServiceCatalogDirectoryRefreshVersion(): number {
  return serviceCatalogDirectoryRefreshVersion;
}

/** Subscribes to service catalog directory refresh bumps. */
export function subscribeServiceCatalogDirectoryRefresh(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
