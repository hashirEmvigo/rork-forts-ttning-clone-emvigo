/**
 * Lightweight refresh signal for the Supabase Service-Entitlements read seam.
 *
 * The authoritative entitlement mutations bump this AFTER a confirmed Supabase
 * write so {@link import("@/hooks/use-entitlement-source").useEntitlementSource}
 * refetches the three entitlement stores from Supabase and the UI reflects the
 * true persisted state. It never touches browser storage and carries no domain
 * data — it is a pure version counter, the Entitlements analogue of
 * {@link import("./moduleDirectoryRefresh")}.
 *
 * Scope: signals ALL three entitlement collections the source serves — the
 * GLOBAL availability records, the COMPANY-scoped tri-state access records, and
 * the append-only entitlement log. A Super-Admin global-availability change or a
 * per-company disabled/trial/enabled change bumps this so the Services page
 * reflects the persisted state after the confirmed write.
 */
let entitlementDirectoryRefreshVersion = 0;
const listeners = new Set<() => void>();

/** Signals that the entitlement source should refetch from Supabase. */
export function bumpEntitlementDirectoryRefresh(): void {
  entitlementDirectoryRefreshVersion += 1;
  for (const listener of listeners) listener();
}

/** Current refresh version for `useSyncExternalStore`. */
export function getEntitlementDirectoryRefreshVersion(): number {
  return entitlementDirectoryRefreshVersion;
}

/** Subscribes to entitlement directory refresh bumps; returns an unsubscribe fn. */
export function subscribeEntitlementDirectoryRefresh(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
