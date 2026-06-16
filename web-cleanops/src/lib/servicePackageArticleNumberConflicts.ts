/**
 * Pure article-number conflict detection for "Copy package into company"
 * (ARTNUM-1, Phase 2).
 *
 * Copying a GLOBAL package into a company preserves each item's article number
 * as a SNAPSHOT (never silently rewritten or regenerated). Article numbers are
 * unique PER COMPANY, so a copy must be BLOCKED — never partially applied — when
 * the package would introduce a duplicate article number inside the target
 * company. Two kinds of collision are detected:
 *   1. two package items carrying the same article number, and
 *   2. a package item whose article number already exists on a company service.
 *
 * Cross-scope duplicates are irrelevant here: every check is within the single
 * target company's uniqueness domain. This module performs no I/O and mints no
 * ids, so it is trivially unit-testable.
 */
import type { Service, ServicePackage } from "@/types";

/** One article number that would collide inside the target company catalog. */
export interface PackageArticleNumberConflict {
  /** The conflicting article number (normalised, non-blank). */
  articleNumber: string;
  /** Distinct service/item names that share this article number. */
  names: string[];
  /** True when the collision is with an EXISTING company service. */
  withExistingService: boolean;
}

function normalize(value: string | undefined | null): string {
  return value?.trim() ?? "";
}

/**
 * Returns the article-number conflicts a copy would introduce into the target
 * company. An empty array means the copy is safe. Items without an article
 * number never conflict.
 */
export function detectPackageArticleNumberConflicts(
  pkg: ServicePackage,
  existingCompanyServices: Service[],
): PackageArticleNumberConflict[] {
  // Existing company article numbers -> the service names that hold them.
  const existingByNumber = new Map<string, Set<string>>();
  for (const service of existingCompanyServices) {
    const number = normalize(service.articleNumber);
    if (!number) continue;
    const names = existingByNumber.get(number) ?? new Set<string>();
    names.add(service.name);
    existingByNumber.set(number, names);
  }

  const conflicts = new Map<string, PackageArticleNumberConflict>();
  const seenInPackage = new Map<string, string>();

  for (const item of pkg.items) {
    const number = normalize(item.articleNumber);
    if (!number) continue;

    const collidesWithExisting = existingByNumber.has(number);
    const previousItemName = seenInPackage.get(number);

    if (collidesWithExisting || previousItemName !== undefined) {
      const conflict =
        conflicts.get(number) ??
        ({
          articleNumber: number,
          names: [],
          withExistingService: false,
        } satisfies PackageArticleNumberConflict);

      const names = new Set<string>(conflict.names);
      if (collidesWithExisting) {
        for (const name of existingByNumber.get(number) ?? []) names.add(name);
        conflict.withExistingService = true;
      }
      if (previousItemName !== undefined) names.add(previousItemName);
      names.add(item.name);

      conflict.names = [...names];
      conflicts.set(number, conflict);
    }

    if (previousItemName === undefined) seenInPackage.set(number, item.name);
  }

  return [...conflicts.values()].sort((a, b) =>
    a.articleNumber.localeCompare(b.articleNumber, undefined, { numeric: true }),
  );
}

/**
 * Builds a single, user-facing message describing the article-number conflicts
 * that block a Copy-into-company. Returns null when there are no conflicts.
 */
export function describePackageArticleNumberConflicts(
  conflicts: PackageArticleNumberConflict[],
): string | null {
  if (conflicts.length === 0) return null;
  const parts = conflicts.map((c) => `#${c.articleNumber} (${c.names.join(", ")})`);
  return (
    `This package can't be copied because it would create duplicate article numbers in your catalog: ` +
    `${parts.join("; ")}. Article numbers must be unique within a company — resolve the conflict before copying.`
  );
}
