import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * P5I — WO-5.6: Work Order removal / soft-delete propagation.
 *
 * The WO-5.5 soak found that removed local rows lingered in Supabase as stale
 * rows. These tests drive the real `mirrorWorkOrderWrites` /
 * `mirrorWorkOrderExceptionWrites` paths against an in-memory Supabase fake that
 * supports `update().in()` and prove that:
 *   • removing a parent work order soft-deletes the parent + its service rows,
 *   • dropping a service row from a surviving parent soft-deletes just that row,
 *   • removing an occurrence exception soft-deletes that exception,
 *   • soft-deleted rows disappear from the repository's active reads (so no
 *     ghost schedule occurrence / stale overlay survives),
 *   • re-creating a removed id UNDELETES it (deleted_at → null),
 *   • repeated removal is idempotent (no duplicate rows, no error).
 *
 * localStorage stays authoritative throughout — these helpers only mirror.
 */

type Row = Record<string, unknown>;

const mocks = vi.hoisted(() => {
  class QueryBuilder {
    private filters: Array<[string, unknown]> = [];
    private inFilters: Array<[string, unknown[]]> = [];
    constructor(
      private rows: Row[],
      private updateValues: Row | null,
    ) {}
    eq(col: string, val: unknown): this {
      this.filters.push([col, val]);
      return this;
    }
    in(col: string, vals: unknown[]): this {
      this.inFilters.push([col, vals]);
      return this;
    }
    private applied(): Row[] {
      return this.rows.filter(
        (r) =>
          this.filters.every(([c, v]) => r[c] === v) &&
          this.inFilters.every(([c, vals]) => vals.includes(r[c])),
      );
    }
    maybeSingle(): Promise<{ data: Row | null; error: null }> {
      return Promise.resolve({ data: this.applied()[0] ?? null, error: null });
    }
    then<R>(onFulfilled: (res: { data: Row[]; error: null }) => R): Promise<R> {
      const matched = this.applied();
      if (this.updateValues) {
        for (const r of matched) Object.assign(r, this.updateValues);
      }
      return Promise.resolve({ data: matched, error: null }).then(onFulfilled);
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
        select: (_cols?: string) => new QueryBuilder(rows, null),
        update: (values: Row) => new QueryBuilder(rows, values),
        upsert: (incoming: Row[], opts: { onConflict: string }) => {
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
    }
  }

  return { client: new FakeClient() };
});

vi.mock("@/lib/supabase", () => ({
  supabase: mocks.client,
  isSupabaseConfigured: true,
}));

import { saveWorkOrders } from "@/lib/store";
import type { WorkOrder, WorkOrderServiceRow, BookingOccurrenceException } from "@/types";
import {
  mirrorWorkOrderWrites,
  mirrorWorkOrderExceptionWrites,
  getWorkOrderDualWriteState,
  resetWorkOrderDualWriteState,
} from "./workOrderDualWrite";
import { supabaseWorkOrderRepository } from "./supabaseWorkOrderRepository";

const COMPANY = "cmp_test";

function seedCompany(): void {
  mocks.client.tables.set("companies", [
    { id: "00000000-0000-4000-8000-000000000000", legacy_id: COMPANY },
  ]);
}

function makeRow(id: string, sortOrder: number): WorkOrderServiceRow {
  return {
    id,
    serviceName: `Service ${id}`,
    quantity: 1,
    status: "planned",
    serviceDate: "2026-07-01",
    recurrenceInterval: "weekly",
    plannedStartTime: "08:00",
    plannedEndTime: "10:00",
    assignedEmployeeIds: [],
    unassignedEmployeeSlots: 1,
    sortOrder,
    createdAt: "",
    updatedAt: "",
  };
}

function makeOrder(id: string, rows: WorkOrderServiceRow[]): WorkOrder {
  const now = new Date().toISOString();
  return {
    id,
    companyId: COMPANY,
    customerId: "cust_1",
    number: `WO-${id}`,
    title: `Order ${id}`,
    status: "planned",
    serviceRows: rows,
    createdAt: now,
    updatedAt: now,
  };
}

function woRowsTable(): Row[] {
  return mocks.client.tables.get("work_orders") ?? [];
}
function serviceRowsTable(): Row[] {
  return mocks.client.tables.get("work_order_service_rows") ?? [];
}
function exceptionsTable(): Row[] {
  return mocks.client.tables.get("work_order_occurrence_exceptions") ?? [];
}

beforeEach(() => {
  localStorage.clear();
  mocks.client.reset();
  resetWorkOrderDualWriteState();
  seedCompany();
});

describe("P5I · WO-5.6 work order removal propagation", () => {
  it("soft-deletes a removed parent and all its service rows", async () => {
    const order = makeOrder("wo_a", [makeRow("row_a1", 0), makeRow("row_a2", 1)]);
    await mirrorWorkOrderWrites([], [order]);

    const removal = await mirrorWorkOrderWrites([order], []);

    expect(removal.removedWorkOrders).toBe(1);
    expect(removal.removedServiceRows).toBe(2);
    expect(removal.ok).toBe(true);

    const parent = woRowsTable().find((r) => r.legacy_id === "wo_a");
    expect(parent?.deleted_at).toBeTruthy();
    for (const r of serviceRowsTable()) expect(r.deleted_at).toBeTruthy();

    // Active reads no longer surface the removed parent or its rows.
    const list = await supabaseWorkOrderRepository.listSummaries({ companyId: COMPANY });
    expect(list.items.some((w) => w.id === "wo_a")).toBe(false);
    const rows = await supabaseWorkOrderRepository.listServiceRows("wo_a", {
      companyId: COMPANY,
      includeArchived: true,
    });
    expect(rows.total).toBe(0);
    expect(await supabaseWorkOrderRepository.getDetail("wo_a", { companyId: COMPANY })).toBeNull();

    const state = getWorkOrderDualWriteState();
    expect(state.parentsRemoved).toBe(1);
    expect(state.serviceRowsRemoved).toBe(2);
  });

  it("soft-deletes only the service row dropped from a surviving parent", async () => {
    const rowA = makeRow("row_b1", 0);
    const rowB = makeRow("row_b2", 1);
    const order = makeOrder("wo_b", [rowA, rowB]);
    await mirrorWorkOrderWrites([], [order]);

    const updated = { ...order, serviceRows: [rowA] };
    const removal = await mirrorWorkOrderWrites([order], [updated]);

    expect(removal.removedWorkOrders).toBe(0);
    expect(removal.removedServiceRows).toBe(1);

    const rows = await supabaseWorkOrderRepository.listServiceRows("wo_b", {
      companyId: COMPANY,
      includeArchived: true,
    });
    expect(rows.items.map((r) => r.id)).toEqual(["row_b1"]);
    // Parent stays active.
    const list = await supabaseWorkOrderRepository.listSummaries({ companyId: COMPANY });
    expect(list.items.some((w) => w.id === "wo_b")).toBe(true);
  });

  it("soft-deletes a removed occurrence exception", async () => {
    const order = makeOrder("wo_c", [makeRow("row_c1", 0)]);
    saveWorkOrders([order]); // exception scoping resolves via the parent work order
    const now = new Date().toISOString();
    const exc: BookingOccurrenceException = {
      id: "exc_c1",
      occurrenceKey: "row_c1:2026-07-01",
      parentServiceRowId: "row_c1",
      occurrenceDate: "2026-07-01",
      status: "cancelled",
      createdAt: now,
      updatedAt: now,
    };
    await mirrorWorkOrderExceptionWrites([], [exc]);
    expect(exceptionsTable().find((r) => r.legacy_id === "exc_c1")?.deleted_at).toBeFalsy();

    const removal = await mirrorWorkOrderExceptionWrites([exc], []);
    expect(removal.removedExceptions).toBe(1);
    expect(exceptionsTable().find((r) => r.legacy_id === "exc_c1")?.deleted_at).toBeTruthy();

    const active = await supabaseWorkOrderRepository.listOccurrenceExceptions({
      companyId: COMPANY,
    });
    expect(active.items.some((e) => e.serviceRowId === "row_c1")).toBe(false);
    expect(getWorkOrderDualWriteState().exceptionsRemoved).toBe(1);
  });

  it("UNDELETES a row when its id is re-created (upsert clears deleted_at)", async () => {
    const order = makeOrder("wo_d", [makeRow("row_d1", 0)]);
    await mirrorWorkOrderWrites([], [order]);
    await mirrorWorkOrderWrites([order], []); // remove

    expect(woRowsTable().find((r) => r.legacy_id === "wo_d")?.deleted_at).toBeTruthy();

    await mirrorWorkOrderWrites([], [order]); // re-create same id
    expect(woRowsTable().find((r) => r.legacy_id === "wo_d")?.deleted_at).toBeNull();

    const list = await supabaseWorkOrderRepository.listSummaries({ companyId: COMPANY });
    expect(list.items.some((w) => w.id === "wo_d")).toBe(true);
  });

  it("is idempotent — repeated removal never duplicates rows or errors", async () => {
    const order = makeOrder("wo_e", [makeRow("row_e1", 0)]);
    await mirrorWorkOrderWrites([], [order]);

    await mirrorWorkOrderWrites([order], []);
    const parentCount = woRowsTable().length;
    const rowCount = serviceRowsTable().length;

    const second = await mirrorWorkOrderWrites([order], []);
    expect(second.error).toBeNull();
    expect(woRowsTable().length).toBe(parentCount);
    expect(serviceRowsTable().length).toBe(rowCount);
  });

  it("treats a no-change, no-removal save as a no-op", async () => {
    const order = makeOrder("wo_f", [makeRow("row_f1", 0)]);
    await mirrorWorkOrderWrites([], [order]);
    const result = await mirrorWorkOrderWrites([order], [order]);
    expect(result.noop).toBe(true);
    expect(result.removedWorkOrders).toBe(0);
    expect(result.removedServiceRows).toBe(0);
  });
});
