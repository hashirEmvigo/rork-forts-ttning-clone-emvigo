/**
 * Generic interval cache.
 *
 * A small, dependency-free LRU cache for results that are computed over a
 * `(scope, viewMode, dateRange, filters)` tuple — the canonical shape of any
 * schedule / calendar / report interval query. Designed so that:
 *
 *  - Returning to a previously viewed period is instant (cache hit).
 *  - Stale data is structurally impossible: a `dataToken` describes the identity
 *    of the underlying source data, and when it changes the cache is dropped.
 *  - The interface is source-agnostic. Today it wraps an in-memory pure resolver
 *    ({@link resolveScheduleProgram}); after the Supabase migration the same
 *    `getOrCompute` seam can wrap an async server query without call-site churn.
 *
 * Invalidation strategy (deliberately simple and correct over clever):
 *  - Every entry is stored under a string key (see {@link buildIntervalCacheKey}).
 *  - A single `dataToken` is tracked for the whole cache. When `getOrCompute`
 *    is called with a token that differs from the stored one, the entire cache
 *    is cleared before serving — any mutation to the underlying arrays produces
 *    a new token (see {@link referenceToken}), so we never serve a result built
 *    from superseded data. This trades a little re-computation right after a
 *    mutation for a guarantee of zero stale-data bugs.
 */

import { perf } from "./instrumentation";

/** Identity parts that make a cached interval result unique. */
export interface IntervalCacheKeyParts {
  /**
   * Active scope for the query. For the operational schedule this is the active
   * company id (or `"all"` for cross-company super-admin boards). Keeping it in
   * the key means a company switch can never read another company's interval.
   */
  scope?: string | null;
  /** View granularity, e.g. "day" | "week" | "month" | "custom". */
  viewMode?: string;
  /** Inclusive lower bound, "YYYY-MM-DD". */
  fromDate: string;
  /** Inclusive upper bound, "YYYY-MM-DD". */
  toDate: string;
  /**
   * Active filters that change which rows match (e.g. `{ includeCancelled }`).
   * Serialised deterministically so filter order never affects the key.
   */
  filters?: Record<string, string | number | boolean | null | undefined>;
}

/**
 * Builds a stable, collision-free cache key from its parts. Filter keys are
 * sorted so `{ a, b }` and `{ b, a }` produce the same key.
 */
export function buildIntervalCacheKey(parts: IntervalCacheKeyParts): string {
  const scope = parts.scope ?? "all";
  const viewMode = parts.viewMode ?? "range";
  const filters = parts.filters ?? {};
  const filterStr = Object.keys(filters)
    .sort()
    .map((k) => `${k}=${String(filters[k])}`)
    .join("&");
  return `${scope}|${viewMode}|${parts.fromDate}..${parts.toDate}|${filterStr}`;
}

/**
 * Produces a primitive token describing the *identity* of a set of source
 * objects (arrays, maps, etc.). Two calls return the same token only when every
 * argument is the same reference as before. Because the in-memory store replaces
 * an array reference on every mutation, a changed token reliably signals "the
 * underlying data changed — drop the cache".
 */
export function referenceToken(...sources: ReadonlyArray<object | null | undefined>): string {
  return sources.map((s) => (s == null ? "0" : refId(s))).join(".");
}

let refSeq = 0;
const refIds = new WeakMap<object, number>();
function refId(obj: object): number {
  let id = refIds.get(obj);
  if (id === undefined) {
    refSeq += 1;
    id = refSeq;
    refIds.set(obj, id);
  }
  return id;
}

export interface IntervalCacheOptions {
  /** Maximum number of cached intervals retained (LRU eviction). Default 24. */
  maxEntries?: number;
  /** Instrumentation label for hit/miss accounting. */
  label?: string;
}

/**
 * LRU interval cache with data-token invalidation. Not React-aware on its own;
 * hold one instance in a ref (see `useScheduleIntervalCache`) so it survives
 * re-renders but is scoped to the component using it.
 */
export class IntervalCache<T> {
  private readonly store = new Map<string, T>();
  private readonly maxEntries: number;
  private readonly label: string;
  private token: string | null = null;

  constructor(options: IntervalCacheOptions = {}) {
    this.maxEntries = Math.max(1, options.maxEntries ?? 24);
    this.label = options.label ?? "interval";
  }

  /**
   * Returns the cached value for `key`, computing and storing it on a miss.
   * Passing a new `dataToken` clears the whole cache first, guaranteeing the
   * computed result reflects current source data.
   */
  getOrCompute(key: string, dataToken: string, compute: () => T): T {
    if (dataToken !== this.token) {
      this.store.clear();
      this.token = dataToken;
    }

    const existing = this.store.get(key);
    if (existing !== undefined) {
      // Refresh LRU recency.
      this.store.delete(key);
      this.store.set(key, existing);
      perf.cacheHit(this.label);
      return existing;
    }

    perf.cacheMiss(this.label);
    const value = perf.measure(`${this.label}.compute`, compute);
    this.store.set(key, value);
    this.evictIfNeeded();
    return value;
  }

  /** Current number of retained intervals. */
  get size(): number {
    return this.store.size;
  }

  /** Drops everything. */
  clear(): void {
    this.store.clear();
    this.token = null;
  }

  private evictIfNeeded(): void {
    while (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) break;
      this.store.delete(oldest);
    }
  }
}
