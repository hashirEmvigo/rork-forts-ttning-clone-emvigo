import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * P5F — WO-4: Service Rows → Schedule dependency validation.
 *
 * Drives the real Supabase repository + reconstruction path against the same
 * in-memory Supabase fake used by WO-1/WO-2/WO-3, proving that after migration:
 *   • service-row schedule-critical fields round-trip (deep field parity),
 *   • embedded variations round-trip (count / ids / dates / status),
 *   • the separate occurrence-exception store round-trips with company scope,
 *   • a resolver dry-run over a real interval produces IDENTICAL occurrences
 *     from the local source and the Supabase-reconstructed source.
 *
 * Read-only; nothing here switches the Schedule or any write path.
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
import { migrateWorkOrders } from "./workOrderMigration";
import {
  validateServiceRowFieldParity,
  validateVariationParity,
  validateExceptionParity,
  compareScheduleInterval,
  validateWorkOrderScheduleDependency,
  RESOLVER_INPUT_COVERAGE,
} from "./workOrderScheduleValidation";

const NORDLYS = "cmp_nordlys";

/**
 * Seeds a live work order with a weekly recurring service row (+ an embedded
 * variation) plus a separate occurrence exception, so the resolver actually
 * produces occurrences to compare. The default app seed carries no service rows.
 */
function seedFixtures(): void {
  const order: WorkOrder = {
    id: "wo_fix_1",
    companyId: NORDLYS,
    customerId: "cust_fix_1",
    number: "WO-9001",
    status: "planned",
    serviceRows: [
      {
        id: "row_fix_1",
        serviceName: "Window Cleaning",
        quantity: 1,
        status: "planned",
        serviceDate: "2026-06-01",
        recurrenceInterval: "weekly",
        plannedStartTime: "08:00",
        plannedEndTime: "10:00",
        assignedEmployeeIds: ["emp_fix_1"],
        unassignedEmployeeSlots: 1,
        sortOrder: 0,
        variations: [
          {
            id: "var_fix_1",
            name: "Every 4th week deep clean",
            frequency: "every_n_weeks",
            interval: 4,
            startTime: "08:00",
            endTime: "12:00",
            appliesFrom: "2026-06-01",
            enabled: true,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  saveWorkOrders([order]);

  const customer: Customer = {
    id: "cust_fix_1",
    companyId: NORDLYS,
    name: "Bergen Office Park",
    customerNumber: "C-9001",
    email: "office@bergen.test",
    status: "active",
    addresses: [{ id: "addr_1", street: "Storgata 1", postalCode: "5003", city: "Bergen", isDelivery: true }],
  } as unknown as Customer;
  saveCustomers([customer]);

  const employee: Employee = {
    id: "emp_fix_1",
    companyId: NORDLYS,
    name: "Ingrid Sand",
    email: "ingrid@nordlys.test",
    status: "active",
    teamIds: [],
  } as unknown as Employee;
  saveEmployees([employee]);

  const exception: BookingOccurrenceException = {
    id: "exc_fix_1",
    occurrenceKey: "row_fix_1:2026-06-15",
    parentServiceRowId: "row_fix_1",
    occurrenceDate: "2026-06-15",
    status: "rescheduled",
    overrideOccurrenceDate: "2026-06-16",
    overrideStartTime: "09:00",
    overrideEndTime: "11:00",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
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

/** Widest [from,to] across the seeded service rows, so the interval is non-empty. */
function fullRange(companyId: string): { fromDate: string; toDate: string } {
  const dates: string[] = [];
  for (const w of getWorkOrders().filter((o) => o.companyId === companyId)) {
    for (const r of w.serviceRows ?? []) {
      if (r.serviceDate) dates.push(r.serviceDate);
    }
  }
  dates.sort();
  const from = dates[0] ?? "2026-01-01";
  // Two months past the first anchor — enough to surface recurring occurrences.
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 60);
  return { fromDate: from, toDate: end.toISOString().slice(0, 10) };
}

beforeEach(() => {
  localStorage.clear();
  mocks.client.reset();
});

describe("P5F · WO-4 schedule dependency validation", () => {
  it("service-row field parity is clean after migration", async () => {
    seedFixtures();
    seedCompanies();
    await migrateWorkOrders();
    const check = await validateServiceRowFieldParity(NORDLYS);
    expect(check.notes).toEqual([]);
    expect(check.ok).toBe(true);
    expect(check.localCount).toBe(check.supabaseCount);
  });

  it("variation parity is clean after migration", async () => {
    seedFixtures();
    seedCompanies();
    await migrateWorkOrders();
    const check = await validateVariationParity(NORDLYS);
    expect(check.notes).toEqual([]);
    expect(check.ok).toBe(true);
    expect(check.localCount).toBe(check.supabaseCount);
  });

  it("occurrence-exception parity is clean after migration", async () => {
    seedFixtures();
    seedCompanies();
    await migrateWorkOrders();
    const check = await validateExceptionParity(NORDLYS);
    expect(check.notes).toEqual([]);
    expect(check.ok).toBe(true);
    expect(check.localCount).toBe(check.supabaseCount);
  });

  it("interval dry-run produces identical occurrences (local vs Supabase)", async () => {
    seedFixtures();
    seedCompanies();
    await migrateWorkOrders();
    const range = fullRange(NORDLYS);
    const cmp = await compareScheduleInterval({ companyId: NORDLYS, ...range, includeCancelled: true });

    expect(cmp.countMatch).toBe(true);
    expect(cmp.keysMatch).toBe(true);
    expect(cmp.missingInSupabase).toEqual([]);
    expect(cmp.extraInSupabase).toEqual([]);
    expect(cmp.divergences).toEqual([]);
    expect(cmp.ok).toBe(true);
    // The window should actually exercise at least one occurrence.
    expect(cmp.localOccurrences).toBeGreaterThan(0);
  });

  it("full orchestrator reports overall OK after migration", async () => {
    seedFixtures();
    seedCompanies();
    await migrateWorkOrders();
    const range = fullRange(NORDLYS);
    const report = await validateWorkOrderScheduleDependency({ companyId: NORDLYS, ...range });
    expect(report.ok).toBe(true);
  });

  it("dry-run flags drift when Supabase is empty (not migrated)", async () => {
    seedFixtures();
    seedCompanies();
    // No migration → Supabase has no work orders; local has occurrences.
    const range = fullRange(NORDLYS);
    const cmp = await compareScheduleInterval({ companyId: NORDLYS, ...range });
    expect(cmp.ok).toBe(false);
    expect(cmp.supabaseOccurrences).toBe(0);
    expect(cmp.notes.length).toBeGreaterThan(0);
  });

  it("resolver coverage map has no missing schedule-critical field", () => {
    // Every resolver field maps to a concrete source — no blockers.
    expect(RESOLVER_INPUT_COVERAGE.length).toBeGreaterThan(0);
    for (const f of RESOLVER_INPUT_COVERAGE) {
      expect(["relational", "data-jsonb", "local-lookup", "not-needed"]).toContain(f.source);
    }
  });
});
