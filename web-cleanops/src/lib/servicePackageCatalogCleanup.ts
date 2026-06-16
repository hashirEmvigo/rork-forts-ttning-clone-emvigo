/**
 * Global service-package cleanup on catalog service deletion (SVCCAT).
 *
 * Service packages are GLOBAL master data and their {@link ServicePackageItem}s
 * are self-contained SNAPSHOTS. Each controlled item records the source catalog
 * {@link Service.id} in {@link ServicePackageItem.sourceServiceId} for
 * traceability — never as a live link. When a Super Admin permanently deletes a
 * GLOBAL catalog service, the global packages that snapshotted it must not keep
 * an item pointing at a service that no longer exists; otherwise the editor shows
 * an orphaned, no-longer-valid item.
 *
 * These pure helpers compute that cleanup. They:
 *  - key strictly on {@link ServicePackageItem.sourceServiceId} (legacy free-text
 *    items without a source link are never touched), and
 *  - never delete a package — a package that loses its last item is kept with an
 *    empty `items` array.
 *
 * Packages carry no company scope (always global), so this never reaches any
 * company-owned copied service/category data.
 */
import type { ServicePackage } from "@/types";

/**
 * Returns the packages that contain at least one item snapshotted from the
 * catalog service `sourceServiceId`. Input order is preserved. Pure — never
 * mutates inputs; safe to call during render (e.g. for a confirmation count).
 */
export function packagesContainingService(
  packages: ServicePackage[],
  sourceServiceId: string,
): ServicePackage[] {
  const trimmed = sourceServiceId.trim();
  if (!trimmed) return [];
  return packages.filter((pkg) =>
    pkg.items.some((item) => item.sourceServiceId === trimmed),
  );
}

/** Result of {@link planServicePackageServiceRemoval}. */
export interface ServicePackageServiceRemovalPlan {
  /**
   * Only the packages that referenced the service, each rewritten with the
   * matching item(s) removed and a fresh `updatedAt`. Packages with no reference
   * are omitted so callers persist the minimal set. A package that becomes empty
   * is kept (returned with `items: []`).
   */
  changed: ServicePackage[];
}

/**
 * Plans the removal of a deleted catalog service from every global package that
 * snapshotted it. Removes ONLY items whose {@link ServicePackageItem.sourceServiceId}
 * equals `sourceServiceId`; all other items (including legacy free-text items
 * without a source link) are preserved. The package itself is never removed.
 *
 * Pure — never mutates inputs. `now` is injectable for deterministic tests.
 */
export function planServicePackageServiceRemoval(
  packages: ServicePackage[],
  sourceServiceId: string,
  now: string = new Date().toISOString(),
): ServicePackageServiceRemovalPlan {
  const trimmed = sourceServiceId.trim();
  if (!trimmed) return { changed: [] };

  const changed: ServicePackage[] = [];
  for (const pkg of packages) {
    if (!pkg.items.some((item) => item.sourceServiceId === trimmed)) continue;
    changed.push({
      ...pkg,
      items: pkg.items.filter((item) => item.sourceServiceId !== trimmed),
      updatedAt: now,
    });
  }
  return { changed };
}
