/**
 * Lightweight refresh signal for the Supabase Module-domain directory read seam.
 *
 * The authoritative Module-domain mutations bump this AFTER a confirmed Supabase
 * write so
 * {@link import("@/hooks/use-module-directory-source").useModuleDirectorySource}
 * refetches the catalogue from Supabase and the UI reflects the true persisted
 * state. It never touches browser storage and carries no domain data — it is a
 * pure version counter, the Modules analogue of
 * {@link import("./timeCodeDirectoryRefresh")}.
 *
 * Scope: signals ALL three Module-domain collections the directory serves —
 * GLOBAL modules + module categories (Phase 2A) AND the COMPANY-scoped
 * company_modules availability/enablement config (Phase 2B). A Super-Admin
 * availability change or a Company-Admin enable/disable bumps this so the
 * company-facing view reflects the persisted state after the confirmed write.
 */
let moduleDirectoryRefreshVersion = 0;
const listeners = new Set<() => void>();

/** Signals that the module directory should refetch from Supabase. */
export function bumpModuleDirectoryRefresh(): void {
  moduleDirectoryRefreshVersion += 1;
  for (const listener of listeners) listener();
}

/** Current refresh version for `useSyncExternalStore`. */
export function getModuleDirectoryRefreshVersion(): number {
  return moduleDirectoryRefreshVersion;
}

/** Subscribes to module directory refresh bumps; returns an unsubscribe fn. */
export function subscribeModuleDirectoryRefresh(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
