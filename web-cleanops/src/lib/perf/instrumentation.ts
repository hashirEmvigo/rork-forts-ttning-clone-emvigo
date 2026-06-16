/**
 * Development-only performance instrumentation.
 *
 * A tiny, dependency-free counter/timer registry used to observe runtime
 * behaviour (render counts, cache hit/miss ratios, heavy-computation
 * executions) WITHOUT shipping any overhead to production.
 *
 * Production behaviour: every public function short-circuits to a no-op when
 * `import.meta.env.DEV` is false. The bundler dead-code-eliminates the body, so
 * there is no counter map, no timers, and no measurable cost in production.
 *
 * Usage is intentionally call-site light:
 *
 * ```ts
 * perf.count("Schedule.render");
 * perf.cacheHit("schedule.interval");
 * perf.cacheMiss("schedule.interval");
 * const stop = perf.start("resolveScheduleProgram");
 * // ...expensive work...
 * stop();
 * ```
 *
 * Inspect at any time from the browser console:
 *
 * ```js
 * __cleanopsPerf.table();   // counters + cache ratios + timing summaries
 * __cleanopsPerf.reset();   // clear all collected metrics
 * ```
 */

/** True only in development. Drives complete no-op behaviour in production. */
const ENABLED: boolean = import.meta.env.DEV === true;

interface CacheStat {
  hits: number;
  misses: number;
}

interface TimerStat {
  /** Number of completed measurements. */
  calls: number;
  /** Total accumulated duration in milliseconds. */
  totalMs: number;
  /** Slowest single measurement in milliseconds. */
  maxMs: number;
}

interface PerfRegistry {
  counters: Map<string, number>;
  caches: Map<string, CacheStat>;
  timers: Map<string, TimerStat>;
}

function createRegistry(): PerfRegistry {
  return {
    counters: new Map<string, number>(),
    caches: new Map<string, CacheStat>(),
    timers: new Map<string, TimerStat>(),
  };
}

const registry: PerfRegistry = createRegistry();

function cacheStat(label: string): CacheStat {
  let stat = registry.caches.get(label);
  if (!stat) {
    stat = { hits: 0, misses: 0 };
    registry.caches.set(label, stat);
  }
  return stat;
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

const noopStop = (): void => {};

/**
 * Performance instrumentation facade. All methods are safe to call in any
 * environment; they do nothing in production builds.
 */
export const perf = {
  /** Whether instrumentation is actively collecting (development only). */
  enabled: ENABLED,

  /** Increment a named counter (e.g. a component render count). */
  count(label: string, by: number = 1): void {
    if (!ENABLED) return;
    registry.counters.set(label, (registry.counters.get(label) ?? 0) + by);
  },

  /** Record a cache hit for the named cache. */
  cacheHit(label: string): void {
    if (!ENABLED) return;
    cacheStat(label).hits += 1;
  },

  /** Record a cache miss for the named cache. */
  cacheMiss(label: string): void {
    if (!ENABLED) return;
    cacheStat(label).misses += 1;
  },

  /**
   * Start timing a named heavy computation. Returns a `stop` function that
   * records the elapsed duration. In production returns a no-op immediately.
   */
  start(label: string): () => void {
    if (!ENABLED) return noopStop;
    const startedAt = now();
    return () => {
      const elapsed = now() - startedAt;
      let stat = registry.timers.get(label);
      if (!stat) {
        stat = { calls: 0, totalMs: 0, maxMs: 0 };
        registry.timers.set(label, stat);
      }
      stat.calls += 1;
      stat.totalMs += elapsed;
      if (elapsed > stat.maxMs) stat.maxMs = elapsed;
    };
  },

  /** Measure a synchronous function while recording its duration. */
  measure<T>(label: string, fn: () => T): T {
    if (!ENABLED) return fn();
    const stop = this.start(label);
    try {
      return fn();
    } finally {
      stop();
    }
  },

  /** Snapshot the current metrics as plain serialisable objects. */
  snapshot(): {
    counters: Record<string, number>;
    caches: Record<string, CacheStat & { hitRate: number }>;
    timers: Record<string, TimerStat & { avgMs: number }>;
  } {
    const counters: Record<string, number> = {};
    for (const [k, v] of registry.counters) counters[k] = v;

    const caches: Record<string, CacheStat & { hitRate: number }> = {};
    for (const [k, v] of registry.caches) {
      const total = v.hits + v.misses;
      caches[k] = { ...v, hitRate: total === 0 ? 0 : v.hits / total };
    }

    const timers: Record<string, TimerStat & { avgMs: number }> = {};
    for (const [k, v] of registry.timers) {
      timers[k] = { ...v, avgMs: v.calls === 0 ? 0 : v.totalMs / v.calls };
    }

    return { counters, caches, timers };
  },

  /** Clear all collected metrics. */
  reset(): void {
    registry.counters.clear();
    registry.caches.clear();
    registry.timers.clear();
  },

  /** Pretty-print the current metrics to the console (development only). */
  table(): void {
    if (!ENABLED) {
      // eslint-disable-next-line no-console
      console.info("[perf] instrumentation is disabled outside development");
      return;
    }
    const snap = this.snapshot();
    // eslint-disable-next-line no-console
    console.groupCollapsed("[perf] CleanOps performance snapshot");
    // eslint-disable-next-line no-console
    console.table(snap.counters);
    // eslint-disable-next-line no-console
    console.table(snap.caches);
    // eslint-disable-next-line no-console
    console.table(snap.timers);
    // eslint-disable-next-line no-console
    console.groupEnd();
  },
};

// Expose a console handle in development for manual inspection.
if (ENABLED && typeof window !== "undefined") {
  (window as unknown as { __cleanopsPerf: typeof perf }).__cleanopsPerf = perf;
}
