import { type QueryClient } from "@tanstack/react-query";

/**
 * Current client-side domain storage epoch.
 *
 * Bump this when old app-owned browser domain state must be ignored after a
 * source-of-truth cutover, tenant reset, or storage schema change. This marker
 * deliberately lives under a CleanOps key, while Supabase Auth keeps its own
 * `sb-*` keys and is never touched here.
 */
export const CLIENT_DOMAIN_STORAGE_EPOCH = "core-storage-a1-2026-06-05";

/** Browser marker proving this epoch's app-owned domain purge has already run. */
export const CLIENT_DOMAIN_STORAGE_EPOCH_KEY = "cleanops.clientDomainStorageEpoch";

/**
 * Exact app-owned domain keys that can carry stale tenant/business data.
 * Supabase Auth keys (`sb-*`) are intentionally absent and must never be added.
 */
export const CLIENT_DOMAIN_STORAGE_PURGE_KEYS = [
  "cleanops.session",
  "cleanops.resetTokens",
  "cleanops.users",
  "cleanops.companies",
  "cleanops.roles",
  "cleanops.customers",
  "cleanops.employees",
  "cleanops.teams",
  "cleanops.areas",
  "cleanops.postalCities",
  "cleanops.employeeLanguages",
  "cleanops.autoAreaFromPostalCity",
  "cleanops.areaScopedAccess",
  "cleanops.featureFlags",
  "cleanops.modules",
  "cleanops.companyModules",
  "cleanops.moduleCategories",
  "cleanops.auditEvents",
  "cleanops.checklistTemplates",
  "cleanops.checklistAdoptions",
  "cleanops.checklistSections",
  "cleanops.checklistItems",
  "cleanops.customerProtocols",
  "cleanops.customerProtocolsV2",
  "cleanops.customerProtocolSections",
  "cleanops.customerProtocolItems",
  "cleanops.libraryRooms",
  "cleanops.libraryTasks",
  "cleanops.settingsTemplates",
  "cleanops.companySettings",
  "cleanops.serviceCategories",
  "cleanops.payrollGroups",
  "cleanops.services",
  "cleanops.servicePackages",
  "cleanops.serviceFavorites",
  "cleanops.timeCodes",
  "cleanops.workOrders",
  "cleanops.workOrderSettings",
  "cleanops.timeReportSettings",
  "cleanops.durationSettings",
  "cleanops.timeReports",
  "cleanops.invoices",
  "cleanops.bookingQueue",
  "cleanops.bookingOccurrenceExceptions",
  "cleanops.systemSettings",
  "cleanops.serviceGlobalEntitlements",
  "cleanops.companyServiceEntitlements",
  "cleanops.serviceEntitlementLog",
  "cleanops.visitOccurrences",
  "cleanops.protocolRuns",
  "cleanops.protocolRunSections",
  "cleanops.protocolRunItems",
  "cleanops.files",
  "cleanops.floorPresets",
  "cleanops.mediaAssets",
  "cleanops.payroll.exportCapabilities",
  "cleanops.payroll.exportProfiles",
  "cleanops.payroll.exportRuns",
  // Reviewed one-time local-domain migration markers. Removing them is safe
  // because this purge also removes the data they previously mutated, allowing
  // any remaining local bootstrap defaults to rebuild from the current code.
  "cleanops.migration.areaScopedAccessToFeature",
  "cleanops.migration.customerAreaIds",
  "cleanops.migration.checklistPerms",
  "cleanops.migration.checklistSettingsPerms",
  "cleanops.migration.checklistExecutionPerms",
  "cleanops.migration.globalTemplatesPerms",
  "cleanops.migration.protocolPerms",
  "cleanops.migration.myProtocolsPerms",
  "cleanops.migration.settingsTemplatesPerms",
  "cleanops.migration.serviceCategoryGovernance",
  "cleanops.migration.servicesPerms",
  "cleanops.migration.bookingQueueBackfill",
  "cleanops.migration.bookingQueueSnapshot.v2",
  "cleanops.migration.legacyDemoSeedPurged.v1",
  // Reviewed local backout metadata. These keys are app-owned domain rollback
  // metadata, not Supabase/Auth state.
  "cleanops:customers:backout:meta",
  "cleanops:workOrders:backout:meta",
] as const;

/** Prefixes for app-owned domain keys that include a dynamic suffix. */
export const CLIENT_DOMAIN_STORAGE_PURGE_PREFIXES = [
  "cleanops.recentCustomers.",
] as const;

export interface ClientDomainStoragePurgeResult {
  didPurge: boolean;
  previousEpoch: string | null;
  currentEpoch: string;
  purgedKeys: string[];
  preservedSupabaseAuthKeys: string[];
}

let lastPurgeResult: ClientDomainStoragePurgeResult | null = null;

function canAccessLocalStorage(): boolean {
  try {
    if (typeof window === "undefined" || !window.localStorage) return false;
    const probe = "cleanops.__storage_probe__";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

function listMatchingDynamicKeys(storage: Storage): string[] {
  const matches: string[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (!key) continue;
    if (CLIENT_DOMAIN_STORAGE_PURGE_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      matches.push(key);
    }
  }
  return matches;
}

function listSupabaseAuthKeys(storage: Storage): string[] {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key?.startsWith("sb-")) keys.push(key);
  }
  return keys;
}

/**
 * Purges stale app-owned CleanOps domain storage once per epoch.
 *
 * This never calls `localStorage.clear()`, never removes unknown keys, and never
 * touches Supabase Auth/session keys (`sb-*`).
 */
export function purgeClientDomainStorageForCurrentEpoch(): ClientDomainStoragePurgeResult {
  const emptyResult: ClientDomainStoragePurgeResult = {
    didPurge: false,
    previousEpoch: null,
    currentEpoch: CLIENT_DOMAIN_STORAGE_EPOCH,
    purgedKeys: [],
    preservedSupabaseAuthKeys: [],
  };

  if (!canAccessLocalStorage()) {
    lastPurgeResult = emptyResult;
    return emptyResult;
  }

  const storage = window.localStorage;
  const previousEpoch = storage.getItem(CLIENT_DOMAIN_STORAGE_EPOCH_KEY);
  const preservedSupabaseAuthKeys = listSupabaseAuthKeys(storage);

  if (previousEpoch === CLIENT_DOMAIN_STORAGE_EPOCH) {
    lastPurgeResult = {
      ...emptyResult,
      previousEpoch,
      preservedSupabaseAuthKeys,
    };
    return lastPurgeResult;
  }

  const keysToRemove = Array.from(
    new Set<string>([
      ...CLIENT_DOMAIN_STORAGE_PURGE_KEYS,
      ...listMatchingDynamicKeys(storage),
    ]),
  ).filter((key) => key !== CLIENT_DOMAIN_STORAGE_EPOCH_KEY && !key.startsWith("sb-"));

  const purgedKeys: string[] = [];
  for (const key of keysToRemove) {
    if (storage.getItem(key) === null) continue;
    storage.removeItem(key);
    purgedKeys.push(key);
  }

  storage.setItem(CLIENT_DOMAIN_STORAGE_EPOCH_KEY, CLIENT_DOMAIN_STORAGE_EPOCH);

  lastPurgeResult = {
    didPurge: true,
    previousEpoch,
    currentEpoch: CLIENT_DOMAIN_STORAGE_EPOCH,
    purgedKeys,
    preservedSupabaseAuthKeys,
  };
  return lastPurgeResult;
}

/** Returns the last startup purge result for startup cache invalidation. */
export function getLastClientDomainStoragePurgeResult(): ClientDomainStoragePurgeResult | null {
  return lastPurgeResult;
}

/** Invalidates all in-memory React Query data after auth/tenant/storage boundary changes. */
export async function invalidateDomainQueryCaches(queryClient: QueryClient): Promise<void> {
  await queryClient.invalidateQueries({ predicate: () => true });
}
