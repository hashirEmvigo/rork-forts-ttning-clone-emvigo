import { useRef } from "react";

import { IntervalCache, type IntervalCacheOptions } from "@/lib/perf/intervalCache";

/**
 * Holds a single {@link IntervalCache} instance that survives re-renders but is
 * scoped to the component (created lazily on first render, never recreated).
 *
 * Each schedule/calendar surface gets its own cache via this hook, so periods
 * viewed in one surface don't pollute another. Combined with the cache's
 * data-token invalidation, this is safe to use during render.
 */
export function useIntervalCache<T>(options: IntervalCacheOptions = {}): IntervalCache<T> {
  const ref = useRef<IntervalCache<T> | null>(null);
  if (ref.current === null) {
    ref.current = new IntervalCache<T>(options);
  }
  return ref.current;
}
