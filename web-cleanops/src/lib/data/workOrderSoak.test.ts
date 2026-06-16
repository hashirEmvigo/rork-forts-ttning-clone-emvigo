import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * P5H — WO-5.5: Work Order staging soak validation.
 *
 * Drives the REAL soak harness (`runWorkOrderSoak`) — which itself drives
 * `migrateWorkOrders`, `mirrorWorkOrderWrites`, `mirrorWorkOrderExceptionWrites`,
 * `shadowReadWorkOrders`, `validateWorkOrderScheduleDependency`, and the
 * localStorage adapter — against an in-memory Supabase fake (the same multi-table
 * fake used by the WO-1/WO-2 suites). This proves, automatically and repeatably,
 * that a sustained run of real work-order workflows (incl. service rows,
 * variations and occurrence exceptions) stays drift-free, schedule-safe,
 * company-scoped, failure-free and instantly rollback-able BEFORE any
 * source-of-truth cut-over (WO-6).
 *
 * What it asserts:
 *   • a multi-iteration workflow soak completes with a READY verdict
 *   • zero critical drift across periodic shadow reads
 *   • zero schedule-dependency mismatches (local == Supabase-reconstructed)
 *   • zero company-scope failures and zero mirror failures
 *   • the rollback drill confirms localStorage advances with Supabase untouched
 *   • performance observations are captured for the workOrders.write.* timers
 */

type Row = Record<string, unknown>;

const mocks = vi.hoisted(() => {
  class QueryBuilder {
    private filters: Array<[string, unknown]> = [];
    constructor(private rows: Row[]) {}
    eq(col: string, val: unknown): this {
      this.filters.push([col, val]);
      return this;
    }
    private applied(): Row[] {
      return this.rows.filter((r) => this.filters.every(([c, v]) => r[c] === v));
    }
    maybeSingle(): Promise<{ data: Row | null; error: null }> {
      return Promise.resolve({ data: this.applied()[0] ?? null, error: null });
    }
    then<R>(onFulfilled: (res: { data: Row[]; error: null }) => R): Promise<R> {
      return Promise.resolve({ data: this.applied(), error: null }).then(onFulfilled);
    }
  }

  class FakeClient {
    tables = new Map<string, Row[]>();
    upsertCalls = 0;
    private table(name: string): Row[] {
      if (!this.tables.has(name)) this.tables.set(name, []);
      return this.tables.get(name) as Row[];
    }
    from(name: string) {
      const rows = this.table(name);
      return {
        select: (_cols?: string) => new QueryBuilder(rows),
        upsert: (incoming: Row[], opts: { onConflict: string }) => {
          this.upsertCalls += 1;
          const key = opts.onConflict;
          for (const row of incoming) {
            const idx = rows.findIndex((r) => r[key] === row[key]);
            if (idx >= 0) rows[idx] = { ...rows[idx], ...row };
            else rows.push({ ...row });
          }
          return Promise.resolve({ error: null });
        },
      };
    }
    reset(): void {
      this.tables.clear();
      this.upsertCalls = 0;
    }
  }

  return { client: new FakeClient() };
});

vi.mock("@/lib/supabase", () => ({
  supabase: mocks.client,
  isSupabaseConfigured: true,
}));

import { getWorkOrders } from "@/lib/store";
import { runWorkOrderSoak } from "./workOrderSoak";

const NORDLYS = "cmp_nordlys";

/** Seeds the fake `companies` table with a uuid for every work-order company id. */
function seedCompanies(): void {
  const legacyIds = Array.from(new Set(getWorkOrders().map((w) => w.companyId)));
  mocks.client.tables.set(
    "companies",
    legacyIds.map((legacy, i) => ({
      id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      legacy_id: legacy,
    })),
  );
}

beforeEach(() => {
  localStorage.clear();
  mocks.client.reset();
});

describe("P5H · work order staging soak", () => {
  it("a 40-iteration workflow soak returns a READY verdict with zero drift", async () => {
    seedCompanies();
    const report = await runWorkOrderSoak({ companyId: NORDLYS, iterations: 40 });

    expect(report.companyId).toBe(NORDLYS);
    expect(report.operations).toBe(40);
    expect(report.criticalDrift, report.driftNotes.join(", ")).toBe(0);
    expect(report.scheduleMismatches, report.scheduleNotes.join(", ")).toBe(0);
    expect(report.scopeFailures).toBe(0);
    expect(report.writeFailures).toBe(0);
    expect(report.mismatches).toBe(0);
    expect(report.skipped).toBe(0);
    expect(report.shadowRuns).toBeGreaterThan(0);
    expect(report.shadowClean).toBe(report.shadowRuns);
    expect(report.scheduleRuns).toBeGreaterThan(0);
    expect(report.scheduleClean).toBe(report.scheduleRuns);
    expect(report.rollbackVerified).toBe(true);
    expect(report.blockers).toEqual([]);
    expect(report.verdict).toBe("READY");
  });

  it("exercises every workflow at least once", async () => {
    seedCompanies();
    const report = await runWorkOrderSoak({ companyId: NORDLYS, iterations: 40 });
    for (const kind of Object.keys(report.byWorkflow) as Array<
      keyof typeof report.byWorkflow
    >) {
      expect(report.byWorkflow[kind], `workflow ${kind}`).toBeGreaterThan(0);
    }
  });

  it("mirrors parents, service rows and occurrence exceptions", async () => {
    seedCompanies();
    const report = await runWorkOrderSoak({ companyId: NORDLYS, iterations: 40 });
    expect(report.parentsMirrored).toBeGreaterThan(0);
    expect(report.serviceRowsMirrored).toBeGreaterThan(0);
    expect(report.exceptionsMirrored).toBeGreaterThan(0);
  });

  it("captures performance observations for the dual-write timers", async () => {
    seedCompanies();
    const report = await runWorkOrderSoak({ companyId: NORDLYS, iterations: 20 });
    const labels = report.perf.map((p) => p.label);
    expect(labels).toContain("workOrders.write.dual");
    for (const obs of report.perf) {
      expect(obs.calls).toBeGreaterThan(0);
      expect(obs.avgMs).toBeGreaterThanOrEqual(0);
      expect(obs.maxMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("keeps every soak work order inside the target company (no cross-company leak)", async () => {
    seedCompanies();
    await runWorkOrderSoak({ companyId: NORDLYS, iterations: 30 });
    const soakRows = getWorkOrders().filter((w) => w.id.startsWith("soak_wo_"));
    expect(soakRows.length).toBeGreaterThan(0);
    expect(soakRows.every((w) => w.companyId === NORDLYS)).toBe(true);
  });

  it("withholds READY (surfaces drift) when companies are unmapped", async () => {
    // No companies seeded → mirror skips every row, baseline migration cannot map.
    const report = await runWorkOrderSoak({ companyId: NORDLYS, iterations: 12 });
    expect(report.verdict).toBe("NOT READY");
    expect(report.blockers.length).toBeGreaterThan(0);
  });
});
