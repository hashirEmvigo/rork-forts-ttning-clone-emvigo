import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * P6E — Schedule authoritative staging soak.
 *
 * The validation step after P6D made Supabase the authoritative Schedule INPUT.
 * The Schedule has no writes, so this soak validates the only migration surface —
 * the resolver INPUT source — by repeatedly resolving the SAME interval from the
 * local input and the Supabase-authoritative input across daily / weekly /
 * two-week / monthly windows and diffing every occurrence.
 *
 * These tests prove:
 *   • a clean run over real seeded data yields a READY verdict (0 critical drift,
 *     0 occurrence divergence, parity clean, fallback + rollback proven),
 *   • all four view-mode windows are exercised every sweep,
 *   • the Supabase-input resolve produces IDENTICAL occurrences to the local
 *     resolve (recurring visit + reschedule exception both reproduced),
 *   • the fallback + rollback drills confirm the local backout input always
 *     resolves — rollback is instant and data-free.
 *
 * The resolver, recurrence, variation and exception LOGIC are untouched.
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

import {
  getWorkOrders,
  saveWorkOrders,
  saveCustomers,
  saveEmployees,
  saveBookingOccurrenceExceptions,
} from "@/lib/store";
import type { WorkOrder, Customer, Employee, BookingOccurrenceException } from "@/types";
import { runScheduleAuthoritativeSoak, listScheduleSoakCompanies } from "./scheduleAuthoritativeSoak";

const NORDLYS = "cmp_nordlys";
const ANCHOR = "2026-06-01";

function seedFixtures(): void {
  const order: WorkOrder = {
    id: "wo_p6e_1",
    companyId: NORDLYS,
    customerId: "cust_p6e_1",
    number: "WO-9401",
    status: "planned",
    serviceRows: [
      {
        id: "row_p6e_1",
        serviceName: "Window Cleaning",
        quantity: 1,
        status: "planned",
        serviceDate: "2026-06-01",
        recurrenceInterval: "weekly",
        plannedStartTime: "08:00",
        plannedEndTime: "10:00",
        assignedEmployeeIds: ["emp_p6e_1"],
        unassignedEmployeeSlots: 1,
        sortOrder: 0,
        variations: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  } as unknown as WorkOrder;
  saveWorkOrders([order]);

  saveCustomers([
    {
      id: "cust_p6e_1",
      companyId: NORDLYS,
      name: "Bergen Office Park",
      customerNumber: "C-9401",
      email: "office@bergen.test",
      status: "active",
      addresses: [
        { id: "addr_1", street: "Storgata 1", postalCode: "5003", city: "Bergen", isDelivery: true },
      ],
    } as unknown as Customer,
  ]);

  saveEmployees([
    {
      id: "emp_p6e_1",
      companyId: NORDLYS,
      name: "Ingrid Sand",
      email: "ingrid@nordlys.test",
      status: "active",
      teamIds: [],
    } as unknown as Employee,
  ]);

  const exception: BookingOccurrenceException = {
    id: "exc_p6e_1",
    occurrenceKey: "row_p6e_1:2026-06-15",
    parentServiceRowId: "row_p6e_1",
    occurrenceDate: "2026-06-15",
    status: "rescheduled",
    overrideOccurrenceDate: "2026-06-16",
    overrideStartTime: "09:00",
    overrideEndTime: "11:00",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  } as unknown as BookingOccurrenceException;
  saveBookingOccurrenceExceptions([exception]);
}

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

describe("P6E · Schedule authoritative staging soak", () => {
  it("lists companies with schedulable work orders", () => {
    seedFixtures();
    expect(listScheduleSoakCompanies()).toContain(NORDLYS);
  });

  it("clean run over seeded data yields a READY verdict with parity across every view mode", async () => {
    seedFixtures();
    seedCompanies();

    const report = await runScheduleAuthoritativeSoak({
      companyId: NORDLYS,
      sweeps: 2,
      anchorDate: ANCHOR,
    });

    // 2 sweeps × 4 view modes.
    expect(report.scheduleRuns).toBe(8);
    expect(report.scheduleClean).toBe(8);
    expect(report.criticalDrift).toBe(0);
    expect(report.totalDivergences).toBe(0);

    // Parity dimensions all clean.
    expect(report.serviceRowParityOk).toBe(true);
    expect(report.variationParityOk).toBe(true);
    expect(report.exceptionParityOk).toBe(true);

    // Supabase-input resolve reproduced the local occurrences (recurring + exception).
    expect(report.totalLocalOccurrences).toBeGreaterThan(0);
    expect(report.totalSupabaseOccurrences).toBe(report.totalLocalOccurrences);

    // Drills + verdict.
    expect(report.fallbackVerified).toBe(true);
    expect(report.rollbackVerified).toBe(true);
    expect(report.blockers).toEqual([]);
    expect(report.verdict).toBe("READY");
  });

  it("exercises all four view-mode windows each sweep", async () => {
    seedFixtures();
    seedCompanies();

    const report = await runScheduleAuthoritativeSoak({
      companyId: NORDLYS,
      sweeps: 1,
      anchorDate: ANCHOR,
    });

    const modes = report.intervals.map((iv) => iv.viewMode);
    expect(modes).toEqual(["daily", "weekly", "twoWeek", "monthly"]);
    for (const iv of report.intervals) {
      expect(iv.ok).toBe(true);
      expect(iv.supabaseOccurrences).toBe(iv.localOccurrences);
    }
  });
});
