import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * BQ-1 — Booking Queue migration + shadow-read parity. Drives the real
 * `migrateBookingQueue` / `shadowReadBookingQueue` paths against an in-memory
 * Supabase fake.
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
    private table(name: string): Row[] {
      if (!this.tables.has(name)) this.tables.set(name, []);
      return this.tables.get(name) as Row[];
    }
    from(name: string) {
      const rows = this.table(name);
      return {
        select: (_cols?: string) => new QueryBuilder(rows),
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

const storeMocks = vi.hoisted(() => ({ items: [] as unknown[] }));
vi.mock("@/lib/store", () => ({
  getBookingQueue: () => storeMocks.items,
}));

import type { BookingQueueItem } from "@/types";
import { migrateBookingQueue, shadowReadBookingQueue } from "./bookingQueueMigration";

const NORDLYS = "cmp_nordlys";
const UUID = "00000000-0000-4000-8000-000000000000";

function seedCompanies(): void {
  mocks.client.tables.set("companies", [{ id: UUID, legacy_id: NORDLYS }]);
}

function item(id: string, companyId = NORDLYS): BookingQueueItem {
  return {
    id,
    companyId,
    workOrderId: `wo_${id}`,
    workOrderNumber: "WO-1001",
    serviceRowId: `row_${id}`,
    customerId: `cus_${id}`,
    customerName: "Acme",
    serviceName: "Window cleaning",
    serviceDate: "2026-02-01",
    assignmentStatus: "unassigned",
    scheduleStatus: "unscheduled",
    scheduledDate: null,
    scheduledStartTime: null,
    scheduledEndTime: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function queueRows(): Row[] {
  return mocks.client.tables.get("booking_queue") ?? [];
}

beforeEach(() => {
  mocks.client.reset();
  storeMocks.items = [];
});

describe("BQ-1 · migrateBookingQueue", () => {
  it("upserts queue rows preserving legacy_id + soft references", async () => {
    seedCompanies();
    storeMocks.items = [item("bq_a"), item("bq_b")];
    const report = await migrateBookingQueue();
    expect(report.ok).toBe(true);
    expect(report.writtenCount).toBe(2);
    expect(queueRows().map((r) => r.legacy_id).sort()).toEqual(["bq_a", "bq_b"]);
    expect(queueRows().every((r) => r.work_order_legacy_id != null)).toBe(true);
  });

  it("dry-run writes nothing", async () => {
    seedCompanies();
    storeMocks.items = [item("bq_a")];
    const report = await migrateBookingQueue({ dryRun: true });
    expect(report.plannedCount).toBe(1);
    expect(report.writtenCount).toBe(0);
    expect(queueRows()).toHaveLength(0);
  });

  it("skips a queue item whose company has no Supabase row", async () => {
    storeMocks.items = [item("bq_a")];
    const report = await migrateBookingQueue();
    expect(report.ok).toBe(false);
    expect(report.skipped).toHaveLength(1);
    expect(queueRows()).toHaveLength(0);
  });
});

describe("BQ-1 · shadowReadBookingQueue", () => {
  it("reports full parity after a clean migration", async () => {
    seedCompanies();
    storeMocks.items = [item("bq_a"), item("bq_b")];
    await migrateBookingQueue();
    const report = await shadowReadBookingQueue();
    expect(report.countMatch).toBe(true);
    expect(report.idsMatch).toBe(true);
    expect(report.summaryMatch).toBe(true);
    expect(report.detailMatch).toBe(true);
    expect(report.ok).toBe(true);
  });

  it("flags a count mismatch when Supabase is missing an item", async () => {
    seedCompanies();
    storeMocks.items = [item("bq_a"), item("bq_b")];
    await migrateBookingQueue();
    storeMocks.items = [...(storeMocks.items as BookingQueueItem[]), item("bq_c")];
    const report = await shadowReadBookingQueue();
    expect(report.countMatch).toBe(false);
    expect(report.missingInSupabase).toContain("bq_c");
    expect(report.ok).toBe(false);
  });
});
