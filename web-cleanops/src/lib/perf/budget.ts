/**
 * Performance budget framework (structure only).
 *
 * Establishes the vocabulary and registry for declaring per-page performance
 * budgets. It does NOT enforce anything yet — there is intentionally no
 * threshold-violation logic, no blocking, and no production behaviour. The goal
 * is a single typed place where budgets live, so a future validation pass
 * (P5/P6 scalability validation) can compare these targets against the metrics
 * collected by the instrumentation layer.
 *
 * The numbers below are *targets*, derived from the Performance Policy's query
 * budget proposal. They are documentation expressed as code so they can be
 * imported, diffed in review, and eventually asserted against real measurements.
 */

/** A single page's performance targets. */
export interface PerformanceBudget {
  /** Stable id, e.g. "customers" | "schedule" | "bookingQueue". */
  page: string;
  /** Human-readable name for reports. */
  label: string;
  /** Max data/network queries to satisfy the initial view. */
  targetQueries: number;
  /** Max queries to satisfy a search/filter interaction. */
  targetSearchQueries?: number;
  /** Soft cap on renders for a single user interaction. */
  targetRenderCount?: number;
  /** Desired interval/selector cache hit ratio (0–1) once warmed. */
  targetCacheHitRate?: number;
  /** Soft cap on the initial payload size in kilobytes (future server phase). */
  targetPayloadKb?: number;
  /** Free-text notes about what the budget intentionally excludes. */
  notes?: string;
}

/**
 * Declared budgets per page. Values mirror the Performance Policy's query-budget
 * proposal. Server-backed numbers (queries, payload) describe the *desired*
 * post-migration state; they are not achievable while data is in-memory and are
 * recorded here so the migration has explicit targets to hit.
 */
export const PERFORMANCE_BUDGETS: Readonly<Record<string, PerformanceBudget>> = {
  customers: {
    page: "customers",
    label: "Customers list",
    targetQueries: 1,
    targetSearchQueries: 1,
    targetPayloadKb: 64,
    notes: "Summary rows only. No media, work orders, protocols, or history in the list.",
  },
  customerCard: {
    page: "customerCard",
    label: "Customer card",
    targetQueries: 4,
    notes: "Detail-on-demand: each tab loads its own data only when opened.",
  },
  employees: {
    page: "employees",
    label: "Employees list",
    targetQueries: 1,
    targetSearchQueries: 1,
    targetPayloadKb: 48,
    notes: "Summary fields only. Schedule/history/media load behind the profile.",
  },
  schedule: {
    page: "schedule",
    label: "Schedule board",
    targetQueries: 1,
    targetRenderCount: 3,
    targetCacheHitRate: 0.6,
    notes: "One interval query per period; revisited periods served from interval cache.",
  },
  bookingQueue: {
    page: "bookingQueue",
    label: "Booking Lists",
    targetQueries: 1,
    targetSearchQueries: 1,
    notes: "Server-side filter/sort/paginate after migration. Default page size 50.",
  },
  workOrderDetails: {
    page: "workOrderDetails",
    label: "Work order details",
    targetQueries: 4,
    notes: "Lazy tabs; count badges memoized rather than re-scanning full arrays.",
  },
  activityLog: {
    page: "activityLog",
    label: "Activity log",
    targetQueries: 1,
    targetSearchQueries: 1,
    targetPayloadKb: 64,
    notes: "Date/user/entity filtered, paginated. Never load the full log.",
  },
} as const;

/** Looks up a declared budget by page id. */
export function getPerformanceBudget(page: string): PerformanceBudget | undefined {
  return PERFORMANCE_BUDGETS[page];
}

/** A measured value compared against a single budget dimension. */
export interface BudgetCheck {
  dimension: keyof PerformanceBudget;
  target: number;
  actual: number;
  withinBudget: boolean;
}

/**
 * Compares a measured snapshot against a budget. Pure helper for a future
 * validation harness — it reports, it does not throw or block. Only the numeric
 * dimensions present in `measured` are checked.
 */
export function checkBudget(
  budget: PerformanceBudget,
  measured: Partial<Pick<
    PerformanceBudget,
    "targetQueries" | "targetSearchQueries" | "targetRenderCount" | "targetPayloadKb"
  >> & { cacheHitRate?: number },
): BudgetCheck[] {
  const checks: BudgetCheck[] = [];

  const lowerIsBetter: Array<keyof PerformanceBudget> = [
    "targetQueries",
    "targetSearchQueries",
    "targetRenderCount",
    "targetPayloadKb",
  ];
  for (const dim of lowerIsBetter) {
    const target = budget[dim];
    const actual = (measured as Record<string, number | undefined>)[dim];
    if (typeof target === "number" && typeof actual === "number") {
      checks.push({ dimension: dim, target, actual, withinBudget: actual <= target });
    }
  }

  if (typeof budget.targetCacheHitRate === "number" && typeof measured.cacheHitRate === "number") {
    checks.push({
      dimension: "targetCacheHitRate",
      target: budget.targetCacheHitRate,
      actual: measured.cacheHitRate,
      withinBudget: measured.cacheHitRate >= budget.targetCacheHitRate,
    });
  }

  return checks;
}
