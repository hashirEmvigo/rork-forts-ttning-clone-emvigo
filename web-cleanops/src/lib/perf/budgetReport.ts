/**
 * Budget validation report (reporting only — never enforces).
 *
 * Bridges the live instrumentation snapshot (render counters + cache ratios)
 * against the declared {@link PERFORMANCE_BUDGETS}. It is deliberately honest
 * about what the current in-memory architecture can and cannot measure:
 *
 *  - **Cache hit rate** IS measurable today and is graded pass/warning/fail.
 *  - **Render count** is observed as a *cumulative session total*, not a
 *    per-interaction count, so it is reported as informational, not graded.
 *  - **Query / payload budgets** describe the desired post-Supabase state and
 *    cannot be measured while data lives in memory — reported as "pre-migration".
 *
 * Nothing here blocks, throws, or changes behaviour. It exists so a super-admin
 * can see at a glance which foundations are paying off before the P4 migration.
 */

import { perf } from "./instrumentation";
import { PERFORMANCE_BUDGETS, type PerformanceBudget } from "./budget";

/** Grade for a single budget dimension that we can actually measure today. */
export type BudgetGrade = "pass" | "warning" | "fail" | "informational" | "pre-migration" | "no-data";

/** One graded dimension within a page budget. */
export interface BudgetDimensionResult {
  label: string;
  target: string;
  observed: string;
  grade: BudgetGrade;
}

/** A page's full budget assessment. */
export interface BudgetReportRow {
  page: string;
  label: string;
  /** Worst grade across measurable dimensions, used for the row's headline. */
  status: BudgetGrade;
  dimensions: BudgetDimensionResult[];
  notes?: string;
}

/**
 * Maps a budget page id to the instrumentation render-counter label that tracks
 * it. Pages without a wired counter are simply omitted (reported as no-data).
 */
const RENDER_COUNTER_BY_PAGE: Readonly<Record<string, string>> = {
  schedule: "Schedule.render",
  bookingQueue: "BookingQueue.render",
  customerCard: "CustomerCard.render",
  workOrderDetails: "WorkOrderDetails.render",
  employees: "Employees.render",
};

/** Maps a budget page id to the interval-cache label that backs it. */
const CACHE_LABEL_BY_PAGE: Readonly<Record<string, string>> = {
  schedule: "schedule.interval",
};

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

/**
 * Grades an observed cache hit rate against a target. Allows a small grace band
 * below target before failing, so a barely-warmed cache reads as "warning"
 * rather than a hard fail.
 */
function gradeCacheHitRate(observed: number, target: number): BudgetGrade {
  if (observed >= target) return "pass";
  if (observed >= target - 0.15) return "warning";
  return "fail";
}

/** Severity ordering so we can pick the worst grade for the row headline. */
const GRADE_SEVERITY: Readonly<Record<BudgetGrade, number>> = {
  pass: 0,
  informational: 0,
  "pre-migration": 0,
  "no-data": 1,
  warning: 2,
  fail: 3,
};

/**
 * Builds the full budget report from the current instrumentation snapshot.
 * Pure read — calling it never mutates metrics.
 */
export function buildBudgetReport(): BudgetReportRow[] {
  const snap = perf.snapshot();

  return Object.values(PERFORMANCE_BUDGETS).map((budget: PerformanceBudget): BudgetReportRow => {
    const dimensions: BudgetDimensionResult[] = [];

    // Queries / payload: only meaningful once server-backed.
    dimensions.push({
      label: "Initial queries",
      target: String(budget.targetQueries),
      observed: "—",
      grade: "pre-migration",
    });
    if (typeof budget.targetSearchQueries === "number") {
      dimensions.push({
        label: "Search queries",
        target: String(budget.targetSearchQueries),
        observed: "—",
        grade: "pre-migration",
      });
    }
    if (typeof budget.targetPayloadKb === "number") {
      dimensions.push({
        label: "Payload",
        target: `${budget.targetPayloadKb} KB`,
        observed: "—",
        grade: "pre-migration",
      });
    }

    // Render count: observed cumulatively, reported as informational.
    const counterLabel = RENDER_COUNTER_BY_PAGE[budget.page];
    if (typeof budget.targetRenderCount === "number") {
      const observed = counterLabel ? snap.counters[counterLabel] : undefined;
      dimensions.push({
        label: "Render count (session total)",
        target: `≤ ${budget.targetRenderCount} / interaction`,
        observed: typeof observed === "number" ? String(observed) : "no data",
        grade: typeof observed === "number" ? "informational" : "no-data",
      });
    }

    // Cache hit rate: genuinely measurable today.
    if (typeof budget.targetCacheHitRate === "number") {
      const cacheLabel = CACHE_LABEL_BY_PAGE[budget.page];
      const cache = cacheLabel ? snap.caches[cacheLabel] : undefined;
      const total = cache ? cache.hits + cache.misses : 0;
      if (cache && total > 0) {
        dimensions.push({
          label: "Cache hit rate",
          target: `≥ ${pct(budget.targetCacheHitRate)}`,
          observed: pct(cache.hitRate),
          grade: gradeCacheHitRate(cache.hitRate, budget.targetCacheHitRate),
        });
      } else {
        dimensions.push({
          label: "Cache hit rate",
          target: `≥ ${pct(budget.targetCacheHitRate)}`,
          observed: "no data",
          grade: "no-data",
        });
      }
    }

    const status = dimensions.reduce<BudgetGrade>((worst, d) => {
      return GRADE_SEVERITY[d.grade] > GRADE_SEVERITY[worst] ? d.grade : worst;
    }, "pass");

    return {
      page: budget.page,
      label: budget.label,
      status,
      dimensions,
      notes: budget.notes,
    };
  });
}
