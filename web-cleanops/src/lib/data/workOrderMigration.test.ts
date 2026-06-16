import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * P5C — WO-1: Work Order Supabase schema, read repository & shadow read.
 *
 * Drives the REAL migration + shadow-read + repository code paths
 * (`migrateWorkOrders`, `shadowReadWorkOrders`, `supabaseWorkOrderRepository`)
 * against an in-memory Supabase fake. A live Supabase project requires an
 * authenticated browser session and cannot run in CI, so the fake reproduces the
 * exact query-builder surface those modules use (`from().select().eq()
 * .maybeSingle()` and `from().upsert(rows, { onConflict })`) and the RLS-style
 * company scoping the repository relies on.
 *
 * What this proves, automatically and repeatably:
 *   • migration execution across three tables + structured report
 *   • company (legacy_id → uuid) mapping with no orphans
 *   • shadow-read parity: count / id / summary / service rows / exceptions / detail
 *   • service-row + occurrence-exception migration (separate store)
 *   • search + pagination parity (parent rows)
 *   • idempotency (run twice → no inflation, no duplicates)
 *   • query-layer company scoping (foreign company sees nothing)
 *
 * DB-level RLS (migration 0008 policies) is enforced server-side and must be
 * confirmed once against the live project; the query-layer scope verified here
 * is the client contract those policies mirror.
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

import {
  getWorkOrders,
  saveWorkOrders,
  saveBookingOccurrenceExceptions,
} from "@/lib/store";
import { makeOccurrenceKey } from "@/types";
import type {
  WorkOrder,
  WorkOrderServiceRow,
  RecurringVariation,
  BookingOccurrenceException,
} from "@/types";
import { localDataLayer } from "./localStorageAdapters";
import { supabaseWorkOrderRepository } from "./supabaseWorkOrderRepository";
import { migrateWorkOrders, shadowReadWorkOrders } from "./workOrderMigration";

const NORDLYS = "cmp_nordlys";

/** Seeds the fake `companies` table with a uuid for every work-order company id. */
function seedCompanies(): Map<string, string> {
  const legacyIds = Array.from(new Set(getWorkOrders().map((w) => w.companyId)));
  const map = new Map<string, string>();
  const rows: Row[] = legacyIds.map((legacy, i) => {
    const uuid = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
    map.set(legacy, uuid);
    return { id: uuid, legacy_id: legacy };
  });
  mocks.client.tables.set("companies", rows);
  return map;
}

/** A schedule-critical service row with one embedded variation. */
function makeRow(id: string, sortOrder: number, archived = false): WorkOrderServiceRow {
  const variation: RecurringVariation = {
    id: `${id}-var-1`,
    name: "Every 4th week",
    frequency: "every_n_weeks",
    interval: 4,
    startTime: "08:00",
    endTime: "10:00",
    enabled: true,
    status: "active",
    appliesFrom: "2026-01-01",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  return {
    id,
    serviceName: `Service ${sortOrder}`,
    articleNumber: `ART-${sortOrder}`,
    quantity: 1,
    status: "planned",
    serviceDate: "2026-06-01",
    serviceEndDate: null,
    plannedStartTime: "08:00",
    plannedEndTime: "12:00",
    recurrenceInterval: "weekly",
    assignedEmployeeIds: ["emp_a", "emp_b"],
    unassignedEmployeeSlots: 1,
    variations: [variation],
    sortOrder,
    archived,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

/** Adds two live rows + one archived row to the first seeded Nordlys work order. */
function seedWorkOrderWithRows(): WorkOrder {
  const orders = getWorkOrders();
  const target = orders.find((w) => w.companyId === NORDLYS);
  if (!target) throw new Error("expected a seeded work order");
  const withRows: WorkOrder = {
    ...target,
    serviceRows: [makeRow("row-2", 2), makeRow("row-1", 1), makeRow("row-arch", 3, true)],
  };
  saveWorkOrders(orders.map((w) => (w.id === target.id ? withRows : w)));
  return withRows;
}

beforeEach(() => {
  localStorage.clear();
  mocks.client.reset();
});

// ── Migration execution ───────────────────────────────────
describe("WO-1 · migration execution", () => {
  it("dry-run plans every work order and writes nothing", async () => {
    seedCompanies();
    const source = getWorkOrders();
    const report = await migrateWorkOrders({ dryRun: true });

    expect(report.ok).toBe(true);
    expect(report.dryRun).toBe(true);
    expect(report.sourceCount).toBe(source.length);
    expect(report.plannedWorkOrders).toBe(source.length);
    expect(report.writtenWorkOrders).toBe(0);
    expect(report.skipped).toEqual([]);
    expect(mocks.client.tables.get("work_orders") ?? []).toHaveLength(0);
  });

  it("executes the migration and writes parent + service rows + exceptions", async () => {
    seedCompanies();
    seedWorkOrderWithRows();
    saveBookingOccurrenceExceptions([
      {
        id: "exc-1",
        occurrenceKey: makeOccurrenceKey("row-1", "2026-06-15"),
        parentServiceRowId: "row-1",
        occurrenceDate: "2026-06-15",
        status: "rescheduled",
        overrideOccurrenceDate: "2026-06-16",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      },
    ]);
    const source = getWorkOrders();
    const report = await migrateWorkOrders();

    expect(report.ok).toBe(true);
    expect(report.writtenWorkOrders).toBe(source.length);
    expect(report.writtenServiceRows).toBe(3);
    expect(report.writtenExceptions).toBe(1);
    expect(report.skipped).toEqual([]);
    expect(mocks.client.tables.get("work_orders") ?? []).toHaveLength(source.length);
    expect(mocks.client.tables.get("work_order_service_rows") ?? []).toHaveLength(3);
    expect(mocks.client.tables.get("work_order_occurrence_exceptions") ?? []).toHaveLength(1);
  });

  it("skips (does not throw) work orders whose company has no Supabase row", async () => {
    const report = await migrateWorkOrders();
    expect(report.ok).toBe(false);
    expect(report.writtenWorkOrders).toBe(0);
    expect(report.skipped.length).toBe(report.sourceCount);
    expect(report.skipped[0]?.reason).toContain("Migrate companies first");
  });
});

// ── Company mapping ───────────────────────────────────────
describe("WO-1 · company mapping", () => {
  it("every migrated work order carries a valid company uuid (no orphans)", async () => {
    const map = seedCompanies();
    await migrateWorkOrders();
    const rows = mocks.client.tables.get("work_orders") ?? [];
    const validUuids = new Set(map.values());
    for (const row of rows) {
      expect(row.company_id, `${String(row.legacy_id)} missing company uuid`).toBeTruthy();
      expect(validUuids.has(row.company_id as string)).toBe(true);
      expect(row.company_id).toBe(map.get(row.company_legacy_id as string));
    }
  });
});

// ── Shadow-read parity ────────────────────────────────────
describe("WO-1 · shadow-read parity", () => {
  it("reports full parity across all companies after migration", async () => {
    seedCompanies();
    seedWorkOrderWithRows();
    await migrateWorkOrders();
    const report = await shadowReadWorkOrders();

    expect(report.notes, report.notes.join(", ")).toEqual([]);
    expect(report.countMatch).toBe(true);
    expect(report.idsMatch).toBe(true);
    expect(report.summaryMatch).toBe(true);
    expect(report.serviceRowsMatch).toBe(true);
    expect(report.exceptionsMatch).toBe(true);
    expect(report.detailMatch).toBe(true);
    expect(report.ok).toBe(true);
  });

  it("counts service rows and exceptions on both sides", async () => {
    seedCompanies();
    seedWorkOrderWithRows();
    saveBookingOccurrenceExceptions([
      {
        id: "exc-1",
        occurrenceKey: makeOccurrenceKey("row-1", "2026-06-15"),
        parentServiceRowId: "row-1",
        occurrenceDate: "2026-06-15",
        status: "cancelled",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      },
    ]);
    await migrateWorkOrders();
    const report = await shadowReadWorkOrders(NORDLYS);

    expect(report.ok).toBe(true);
    expect(report.localServiceRowTotal).toBe(3);
    expect(report.supabaseServiceRowTotal).toBe(3);
    expect(report.localExceptionTotal).toBe(1);
    expect(report.supabaseExceptionTotal).toBe(1);
  });

  it("surfaces (never hides) work orders missing in Supabase before migration", async () => {
    seedCompanies();
    const report = await shadowReadWorkOrders(NORDLYS);
    expect(report.ok).toBe(false);
    expect(report.missingInSupabase.length).toBe(report.localCount);
    expect(report.notes.join(" ")).toContain("not yet in Supabase");
  });
});

// ── Repository parity (local adapter vs supabase repository) ──
describe("WO-1 · repository parity", () => {
  it("listSummaries / count / getDetail agree after migration", async () => {
    seedCompanies();
    seedWorkOrderWithRows();
    await migrateWorkOrders();

    const local = await localDataLayer.workOrders.listSummaries({ companyId: NORDLYS });
    const remote = await supabaseWorkOrderRepository.listSummaries({ companyId: NORDLYS });
    expect(remote.total).toBe(local.total);
    expect(new Set(remote.items.map((w) => w.id))).toEqual(new Set(local.items.map((w) => w.id)));

    expect(await supabaseWorkOrderRepository.count({ companyId: NORDLYS })).toBe(
      await localDataLayer.workOrders.count({ companyId: NORDLYS }),
    );

    const sample = local.items[0];
    const [ld, rd] = await Promise.all([
      localDataLayer.workOrders.getDetail(sample.id, { companyId: NORDLYS }),
      supabaseWorkOrderRepository.getDetail(sample.id, { companyId: NORDLYS }),
    ]);
    expect(rd?.id).toBe(ld?.id);
    expect(rd?.number).toBe(ld?.number);
    expect(rd?.serviceRows?.length).toBe(ld?.serviceRows?.length);
  });

  it("service rows: live by default, archived on request, ordered by sortOrder", async () => {
    const order = seedWorkOrderWithRows();
    seedCompanies();
    await migrateWorkOrders();

    const live = await supabaseWorkOrderRepository.listServiceRows(order.id, {
      companyId: NORDLYS,
    });
    expect(live.total).toBe(2);

    const all = await supabaseWorkOrderRepository.listServiceRows(order.id, {
      companyId: NORDLYS,
      includeArchived: true,
    });
    expect(all.total).toBe(3);
    const sortOrders = all.items.map((r) => r.sortOrder);
    expect(sortOrders).toEqual([...sortOrders].sort((a, b) => a - b));
    const row1 = all.items.find((r) => r.id === "row-1");
    expect(row1?.recurrenceInterval).toBe("weekly");
    expect(row1?.assignedEmployeeIds).toEqual(["emp_a", "emp_b"]);
    expect(row1?.variationCount).toBe(1);
  });
});

// ── Search + pagination parity ────────────────────────────
describe("WO-1 · search + pagination parity", () => {
  it("number/title search returns the same ids on both sides", async () => {
    seedCompanies();
    await migrateWorkOrders();
    const sample = getWorkOrders().find((w) => w.companyId === NORDLYS);
    expect(sample).toBeDefined();
    if (!sample) return;

    for (const term of [sample.number, sample.number.slice(0, 4)]) {
      const local = await localDataLayer.workOrders.search({ companyId: NORDLYS, search: term });
      const remote = await supabaseWorkOrderRepository.search({ companyId: NORDLYS, search: term });
      expect(new Set(remote.items.map((w) => w.id)), `term="${term}"`).toEqual(
        new Set(local.items.map((w) => w.id)),
      );
    }
  });

  it("paginates identically with no dropped or duplicated rows", async () => {
    seedCompanies();
    await migrateWorkOrders();
    const pageSize = 1;
    const all = await supabaseWorkOrderRepository.listSummaries({ companyId: NORDLYS });
    const pages = Math.max(1, Math.ceil(all.total / pageSize));
    const seen = new Set<string>();
    for (let page = 1; page <= pages; page++) {
      const remote = await supabaseWorkOrderRepository.listSummaries({
        companyId: NORDLYS,
        page,
        pageSize,
      });
      expect(remote.total).toBe(all.total);
      for (const item of remote.items) seen.add(item.id);
    }
    expect(seen.size).toBe(all.total);
  });
});

// ── Idempotency ───────────────────────────────────────────
describe("WO-1 · idempotency", () => {
  it("running migration twice does not inflate or duplicate rows", async () => {
    seedCompanies();
    seedWorkOrderWithRows();
    const source = getWorkOrders();

    await migrateWorkOrders();
    const afterFirst = (mocks.client.tables.get("work_orders") ?? []).length;
    const rowsAfterFirst = (mocks.client.tables.get("work_order_service_rows") ?? []).length;
    await migrateWorkOrders();
    const afterSecond = (mocks.client.tables.get("work_orders") ?? []).length;
    const rowsAfterSecond = (mocks.client.tables.get("work_order_service_rows") ?? []).length;

    expect(afterFirst).toBe(source.length);
    expect(afterSecond).toBe(source.length);
    expect(rowsAfterFirst).toBe(3);
    expect(rowsAfterSecond).toBe(3);

    const ids = (mocks.client.tables.get("work_orders") ?? []).map((r) => r.legacy_id);
    expect(new Set(ids).size).toBe(ids.length);

    const report = await shadowReadWorkOrders();
    expect(report.ok).toBe(true);
  });
});

// ── Company scoping (RLS contract) ────────────────────────
describe("WO-1 · company scoping", () => {
  it("scoping to a company returns only that company's work orders", async () => {
    seedCompanies();
    await migrateWorkOrders();
    const scoped = await supabaseWorkOrderRepository.listSummaries({ companyId: NORDLYS });
    expect(scoped.items.every((w) => w.companyId === NORDLYS)).toBe(true);
    expect(scoped.total).toBeGreaterThan(0);
  });

  it("a non-existent company sees nothing (no cross-company leak)", async () => {
    seedCompanies();
    seedWorkOrderWithRows();
    await migrateWorkOrders();
    const foreign = await supabaseWorkOrderRepository.listSummaries({ companyId: "cmp_not_real" });
    expect(foreign.total).toBe(0);

    const sample = getWorkOrders().find((w) => w.companyId === NORDLYS);
    if (sample) {
      const blocked = await supabaseWorkOrderRepository.getDetail(sample.id, {
        companyId: "cmp_not_real",
      });
      expect(blocked).toBeNull();
      const noRows = await supabaseWorkOrderRepository.listServiceRows(sample.id, {
        companyId: "cmp_not_real",
      });
      expect(noRows.total).toBe(0);
    }
  });
});
