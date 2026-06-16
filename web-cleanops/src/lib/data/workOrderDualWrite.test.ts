import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * P5G — WO-5: Work Order dual-write mirror.
 *
 * Drives the real `mirrorWorkOrderWrites` / `mirrorWorkOrderExceptionWrites`
 * paths against the same in-memory Supabase fake used by the WO-1/WO-2/WO-3
 * tests, proving that:
 *   • a create mirrors the parent + its service rows,
 *   • an update re-mirrors only the changed order,
 *   • repeated mirrors are idempotent (no duplicate rows),
 *   • the post-write validation reports 0 mismatches when parity holds,
 *   • a Supabase failure is recorded as drift (localStorage already advanced),
 *   • the SEPARATE occurrence-exception store mirrors via its parent work order.
 *
 * localStorage is the source of truth throughout — these helpers only mirror.
 */

type Row = Record<string, unknown>;

const mocks = vi.hoisted(() => {
  let failUpsertTable: string | null = null;

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
    private table(name: string): Row[] {
      if (!this.tables.has(name)) this.tables.set(name, []);
      return this.tables.get(name) as Row[];
    }
    from(name: string) {
      const rows = this.table(name);
      return {
        select: (_cols?: string) => new QueryBuilder(rows),
        upsert: (incoming: Row[], opts: { onConflict: string }) => {
          if (failUpsertTable === name) {
            return Promise.resolve({ error: { message: `simulated ${name} failure` } });
          }
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
      failUpsertTable = null;
    }
    failOn(table: string | null): void {
      failUpsertTable = table;
    }
  }

  return { client: new FakeClient() };
});

vi.mock("@/lib/supabase", () => ({
  supabase: mocks.client,
  isSupabaseConfigured: true,
}));

import { getWorkOrders, getBookingOccurrenceExceptions } from "@/lib/store";
import type { WorkOrder, BookingOccurrenceException } from "@/types";
import {
  mirrorWorkOrderWrites,
  mirrorWorkOrderExceptionWrites,
  getWorkOrderDualWriteState,
  resetWorkOrderDualWriteState,
} from "./workOrderDualWrite";

const NORDLYS = "cmp_nordlys";

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

function woRows(): Row[] {
  return mocks.client.tables.get("work_orders") ?? [];
}
function serviceRows(): Row[] {
  return mocks.client.tables.get("work_order_service_rows") ?? [];
}

beforeEach(() => {
  localStorage.clear();
  mocks.client.reset();
  resetWorkOrderDualWriteState();
});

describe("P5G · WO-5 work order dual write", () => {
  it("mirrors the parent + service rows on create", async () => {
    seedCompanies();
    const order = getWorkOrders().find((w) => w.companyId === NORDLYS)!;
    const prev = getWorkOrders().filter((w) => w.id !== order.id);

    const result = await mirrorWorkOrderWrites(prev, getWorkOrders());

    expect(result.ok).toBe(true);
    expect(result.diff.created).toContain(order.id);
    expect(result.mirroredWorkOrders).toBeGreaterThan(0);
    expect(woRows().some((r) => r.legacy_id === order.id)).toBe(true);
    const expectedRows = order.serviceRows?.length ?? 0;
    expect(serviceRows().filter((r) => r.work_order_legacy_id === order.id).length).toBe(
      expectedRows,
    );
    expect(result.mismatches).toEqual([]);
  });

  it("is idempotent — repeated mirrors never duplicate rows", async () => {
    seedCompanies();
    const all = getWorkOrders();
    const empty: WorkOrder[] = [];

    await mirrorWorkOrderWrites(empty, all);
    const afterFirst = woRows().length;
    const rowsAfterFirst = serviceRows().length;

    await mirrorWorkOrderWrites(empty, all);
    expect(woRows().length).toBe(afterFirst);
    expect(serviceRows().length).toBe(rowsAfterFirst);
  });

  it("re-mirrors only the changed order on update", async () => {
    seedCompanies();
    const all = getWorkOrders();
    await mirrorWorkOrderWrites([], all);

    const target = all.find((w) => w.companyId === NORDLYS)!;
    const next = all.map((w) =>
      w.id === target.id ? { ...w, title: `${w.title ?? ""} (edited)` } : w,
    );

    const result = await mirrorWorkOrderWrites(all, next);
    expect(result.diff.updated).toEqual([target.id]);
    expect(result.mirroredWorkOrders).toBe(1);
    expect(result.ok).toBe(true);
  });

  it("treats an unchanged save as a no-op (no Supabase work)", async () => {
    seedCompanies();
    const all = getWorkOrders();
    const result = await mirrorWorkOrderWrites(all, all);
    expect(result.noop).toBe(true);
    expect(result.mirroredWorkOrders).toBe(0);
    expect(getWorkOrderDualWriteState().noops).toBe(1);
  });

  it("records a failure when the Supabase parent upsert fails (local already advanced)", async () => {
    seedCompanies();
    mocks.client.failOn("work_orders");
    const all = getWorkOrders();

    const result = await mirrorWorkOrderWrites([], all);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/work_orders upsert failed/);
    expect(getWorkOrderDualWriteState().failures).toBeGreaterThan(0);
  });

  it("skips orders whose company has no Supabase mapping (surfaced, not silent)", async () => {
    // No companies seeded → no mapping resolves.
    const all = getWorkOrders();
    const result = await mirrorWorkOrderWrites([], all);
    expect(result.skipped.length).toBeGreaterThan(0);
    expect(result.mirroredWorkOrders).toBe(0);
    expect(getWorkOrderDualWriteState().skipped).toBeGreaterThan(0);
  });

  it("mirrors occurrence exceptions via their parent work order", async () => {
    seedCompanies();
    const exceptions = getBookingOccurrenceExceptions();
    if (exceptions.length === 0) {
      // No seed exceptions — assert the no-op path stays clean.
      const result = await mirrorWorkOrderExceptionWrites([], []);
      expect(result.noop).toBe(true);
      return;
    }
    const result = await mirrorWorkOrderExceptionWrites(
      [] as BookingOccurrenceException[],
      exceptions,
    );
    const mirrored = mocks.client.tables.get("work_order_occurrence_exceptions") ?? [];
    expect(result.mirroredExceptions + result.skipped.length).toBe(exceptions.length);
    expect(mirrored.length).toBe(result.mirroredExceptions);
  });
});
