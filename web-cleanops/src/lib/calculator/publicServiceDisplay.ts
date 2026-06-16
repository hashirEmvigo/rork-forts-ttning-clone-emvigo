/**
 * Public calculator — service-display partitioning (Slice 12C, Part D).
 *
 * Pure, presentation-only helper for the public service selector. The Edge config
 * already returns ONLY public-ready services (enabled or coming-soon; drafts are
 * withheld) sorted by `sortOrder`. This splits that list into a small FEATURED
 * head (the first N, configurable via sort order) and the remaining services
 * revealed behind a "Visa fler" toggle. No I/O — fully unit-testable.
 */

/** Default number of services shown before the "Visa fler" toggle. */
export const DEFAULT_FEATURED_LIMIT = 3;

export interface ServiceDisplayPartition<T> {
  /** The first `limit` services (always visible). */
  featured: T[];
  /** The remaining services, revealed by "Visa fler". */
  more: T[];
  /** True only when there is at least one extra service to reveal. */
  hasMore: boolean;
}

/**
 * Splits an already-ordered service list into `featured` (first `limit`) and
 * `more` (the rest). With `limit` items or fewer, `more` is empty and `hasMore`
 * is false (so the UI shows no toggle). A non-positive/NaN limit is treated as
 * the default.
 */
export function partitionFeaturedServices<T>(
  services: readonly T[],
  limit: number = DEFAULT_FEATURED_LIMIT,
): ServiceDisplayPartition<T> {
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : DEFAULT_FEATURED_LIMIT;
  const featured = services.slice(0, safeLimit);
  const more = services.slice(safeLimit);
  return { featured, more, hasMore: more.length > 0 };
}
