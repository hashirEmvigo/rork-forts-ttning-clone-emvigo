import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * P6D — Schedule authoritative input cutover.
 *
 * P6D makes Supabase the AUTHORITATIVE Schedule INPUT behind a reversible flag.
 * It deliberately does NOT build a server-generated occurrence engine (the P6C
 * approach that proved too risky); it REUSES the validated P6C interval-scoped
 * Supabase input as primary and keeps the single {@link resolveScheduleProgram}
 * resolver. localStorage stays a fallback / backout input.
 *
 * These tests prove:
 *   • the flag defaults OFF (localStorage authoritative) — instant, data-free
 *     rollback is the absence of the flag,
 *   • {@link isScheduleSupabaseAuthoritative} + the cutover-state authority fields
 *     report the source of truth,
 *   • the authoritative input REUSES the same builder, so the Supabase-input
 *     resolve yields IDENTICAL occurrences to the local-input resolve over an
 *     interval (occurrence count / keys / dates / times / customer / employees /
 *     status / variation / reschedule / cancelled indicators),
 *   • fallback + shadow drift are RECORDED, never silent.
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
import { resolveScheduleProgram } from "@/lib/scheduleCore";
import { migrateWorkOrders } from "./workOrderMigration";
import {
  buildScheduleInputFromLocal,
  buildScheduleInputFromSupabase,
  compareScheduleEntries,
} from "./workOrderScheduleValidation";
import {
  shouldReadScheduleFromSupabase,
  isScheduleSupabaseAuthoritative,
  getScheduleCutoverState,
  resetScheduleCutoverState,
  recordScheduleInputFallback,
  recordScheduleShadowDrift,
} from "./scheduleCutover";

const NORDLYS = "cmp_nordlys";

function seedFixtures(): void {
  const order: WorkOrder = {
    id: "wo_p6d_1",
    companyId: NORDLYS,
    customerId: "cust_p6d_1",
    number: "WO-9301",
    status: "planned",
    serviceRows: [
      {
        id: "row_p6d_1",
        serviceName: "Window Cleaning",
        quantity: 1,
        status: "planned",
        serviceDate: "2026-06-01",
        recurrenceInterval: "weekly",
        plannedStartTime: "08:00",
        plannedEndTime: "10:00",
        assignedEmployeeIds: ["emp_p6d_1"],
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
      id: "cust_p6d_1",
      companyId: NORDLYS,
      name: "Bergen Office Park",
      customerNumber: "C-9301",
      email: "office@bergen.test",
      status: "active",
      addresses: [
        { id: "addr_1", street: "Storgata 1", postalCode: "5003", city: "Bergen", isDelivery: true },
      ],
    } as unknown as Customer,
  ]);

  saveEmployees([
    {
      id: "emp_p6d_1",
      companyId: NORDLYS,
      name: "Ingrid Sand",
      email: "ingrid@nordlys.test",
      status: "active",
      teamIds: [],
    } as unknown as Employee,
  ]);

  const exception: BookingOccurrenceException = {
    id: "exc_p6d_1",
    occurrenceKey: "row_p6d_1:2026-06-15",
    parentServiceRowId: "row_p6d_1",
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

const RANGE = { fromDate: "2026-06-01", toDate: "2026-07-31" };

beforeEach(() => {
  localStorage.clear();
  mocks.client.reset();
  resetScheduleCutoverState();
});

describe("P6D · Schedule authoritative input cutover", () => {
  it("authoritative flag defaults OFF — localStorage is authoritative, rollback is the default", () => {
    expect(isScheduleSupabaseAuthoritative()).toBe(false);
    // Neither flag on → schedule reads stay local (no read-path implied).
    expect(shouldReadScheduleFromSupabase()).toBe(false);
  });

  it("cutover state reports the authority source of truth", () => {
    const state = getScheduleCutoverState();
    expect(state.authoritative).toBe(false);
    expect(state.inputAuthority).toBe("localStorage");
    expect(state.inputSource).toBe("localStorage");
  });

  it("authoritative input REUSES the P6C builder — Supabase resolve equals local resolve over an interval", async () => {
    seedFixtures();
    seedCompanies();
    await migrateWorkOrders();

    const opts = { companyId: NORDLYS, ...RANGE, includeCancelled: true };
    const localEntries = resolveScheduleProgram(buildScheduleInputFromLocal(opts));
    const supabaseEntries = resolveScheduleProgram(await buildScheduleInputFromSupabase(opts));

    const cmp = compareScheduleEntries(localEntries, supabaseEntries, {
      companyId: NORDLYS,
      ...RANGE,
    });

    expect(cmp.ok).toBe(true);
    expect(cmp.countMatch).toBe(true);
    expect(cmp.keysMatch).toBe(true);
    expect(cmp.divergences).toEqual([]);
    expect(cmp.localOccurrences).toBeGreaterThan(0);
  });

  it("fallback under authority is recorded, never silent (so rollback decisions are informed)", () => {
    recordScheduleInputFallback(NORDLYS, "supabase unavailable");
    recordScheduleShadowDrift("1 occurrence(s) with field drift");
    const state = getScheduleCutoverState();
    expect(state.fallbacks).toBe(1);
    expect(state.shadowDrift).toBe(1);
    expect(state.failures).toBe(2);
    expect(state.lastMismatch).toBe("1 occurrence(s) with field drift");
    expect(state.recentFailures[0]?.message).toBe("supabase unavailable");
  });
});
