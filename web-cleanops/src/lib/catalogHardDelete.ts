/**
 * Global catalog hard-delete safety rule (SVCCAT).
 *
 * The Super Admin master catalog (global services, `companyId === null`) is a
 * library of TEMPLATES. When a company copies a package/service into its own
 * catalog it gets an independent, company-owned deep copy (a brand-new row with
 * its own id and `companyId = <company>`) — never a live link to the global
 * row (see `planServicePackageApply` + the `applyPackage` mutation in
 * useServiceCatalogMutations and {@link buildServicePackageItemFromService}).
 *
 * Because company copies share no id and no live foreign key with the global
 * template, permanently removing a GLOBAL service can never touch company-owned
 * data, work orders, schedules or customers (those reference company service
 * copies by snapshot only). This helper encodes that guarantee in one place:
 *
 *  - it removes ONLY the exact global row by id, and
 *  - it refuses to hard-delete any company-owned service (`companyId !== null`),
 *    so the destructive path can never reach a tenant's catalog.
 */
import type { Service } from "@/types";

/** Outcome of a global-catalog hard delete. `next` is set only on success. */
export interface CatalogHardDeleteResult {
  ok: boolean;
  error?: string;
  /** The services array with the global template removed (success only). */
  next?: Service[];
}

/**
 * Removes a single GLOBAL catalog service (`companyId === null`) from `services`.
 *
 * Returns the new array with only that row removed. Company-owned services
 * (including copies that share the same name) are left untouched. Refuses any
 * non-global target so the permanent-delete path can never affect a company's
 * copied data.
 *
 * Pure — performs no I/O and never mutates the input array.
 */
export function removeGlobalCatalogService(
  services: Service[],
  serviceId: string,
): CatalogHardDeleteResult {
  const target = services.find((s) => s.id === serviceId);
  if (!target) return { ok: false, error: "Service not found." };
  if (target.companyId !== null) {
    return {
      ok: false,
      error: "Only global catalog services can be permanently deleted.",
    };
  }
  return { ok: true, next: services.filter((s) => s.id !== serviceId) };
}
