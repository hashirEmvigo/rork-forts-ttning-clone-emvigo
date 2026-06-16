/**
 * Shared memoized selector utilities.
 *
 * Across the app the same lookup structures are rebuilt independently in many
 * components — `employeeNameById`, `customerById`, `cityNameById`, etc. Each is
 * an O(n) scan that produces an identical Map. These helpers build such lookups
 * once per source-array reference and reuse the result everywhere, so two
 * components reading the same `employees` array share one Map instead of each
 * paying the scan.
 *
 * The cache is keyed by the *reference* of the source array (a `WeakMap`), which
 * matches the in-memory store's contract: a mutation swaps the array reference,
 * which transparently invalidates the derived lookup. No manual invalidation and
 * no stale data. Pure and safe to call during render.
 *
 * These are deliberately tiny building blocks, not a state library. They reduce
 * repeated render-time work without changing any behaviour.
 */

import { perf } from "./instrumentation";

/**
 * Creates a reusable, reference-cached lookup selector.
 *
 * @param label   Instrumentation label for cache hit/miss accounting.
 * @param build   Builds the lookup value from the source array. Called at most
 *                once per distinct source reference.
 *
 * @example
 * const selectEmployeeNameById = createLookupSelector(
 *   "selector.employeeNameById",
 *   (employees: Employee[]) => {
 *     const map = new Map<string, string>();
 *     for (const e of employees) map.set(e.id, e.name);
 *     return map;
 *   },
 * );
 * const names = selectEmployeeNameById(employees); // built once per array ref
 */
export function createLookupSelector<TSource extends object, TResult>(
  label: string,
  build: (source: TSource) => TResult,
): (source: TSource) => TResult {
  const cache = new WeakMap<TSource, TResult>();
  return (source: TSource): TResult => {
    const cached = cache.get(source);
    if (cached !== undefined) {
      perf.cacheHit(label);
      return cached;
    }
    perf.cacheMiss(label);
    const result = perf.measure(`${label}.build`, () => build(source));
    cache.set(source, result);
    return result;
  };
}

/**
 * Convenience selector for the most common case: an id → entity `Map` built from
 * an array of records that each carry an `id`.
 */
export function createByIdSelector<T extends { id: string }>(
  label: string,
): (items: readonly T[]) => Map<string, T> {
  return createLookupSelector(label, (items: readonly T[]) => {
    const map = new Map<string, T>();
    for (const item of items) map.set(item.id, item);
    return map;
  });
}

/**
 * Convenience selector for an id → single-field `Map` (e.g. id → name). Pass a
 * `pick` function to extract the value stored against each id.
 */
export function createFieldByIdSelector<T extends { id: string }, V>(
  label: string,
  pick: (item: T) => V,
): (items: readonly T[]) => Map<string, V> {
  return createLookupSelector(label, (items: readonly T[]) => {
    const map = new Map<string, V>();
    for (const item of items) map.set(item.id, pick(item));
    return map;
  });
}
