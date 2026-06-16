/**
 * Catalog ↔ Service Package links (SVCCAT Catalog tags).
 *
 * The Catalog tab surfaces, on each category, which reusable service packages
 * already draw at least one service from that category. This lets a Super Admin
 * jump straight from a category to the package that uses it instead of hunting
 * through the Packages tab.
 *
 * Matching is read-only and never mutates packages. It prefers the controlled
 * selection link ({@link ServicePackageItem.sourceCategoryId}); for legacy
 * free-text items written before controlled selection (no source link) it falls
 * back to a case-insensitive category-NAME match so older packages still surface.
 */
import type { ServicePackage } from "@/types";

/**
 * Returns true when `pkg` contains at least one item drawn from the catalog
 * category identified by `categoryId`/`categoryName`.
 *
 * - Items with a {@link ServicePackageItem.sourceCategoryId} match strictly by
 *   id (a name collision must never falsely attribute a controlled item).
 * - Legacy items without a source link fall back to a trimmed, case-insensitive
 *   category-name match.
 *
 * Pure — safe to call during render.
 */
export function packageUsesCategory(
  pkg: ServicePackage,
  categoryId: string,
  categoryName: string,
): boolean {
  const targetName = categoryName.trim().toLowerCase();
  return pkg.items.some((item) => {
    if (item.sourceCategoryId) return item.sourceCategoryId === categoryId;
    return item.categoryName.trim().toLowerCase() === targetName;
  });
}

/**
 * Filters `packages` down to those that use the given catalog category, keeping
 * the input order. Callers pass the set they want surfaced (e.g. only active,
 * non-archived packages); this helper does not filter by archived state.
 */
export function packagesUsingCategory(
  packages: ServicePackage[],
  categoryId: string,
  categoryName: string,
): ServicePackage[] {
  return packages.filter((pkg) => packageUsesCategory(pkg, categoryId, categoryName));
}
