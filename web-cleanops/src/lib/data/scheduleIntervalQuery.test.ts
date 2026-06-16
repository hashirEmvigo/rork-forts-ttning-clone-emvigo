import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * P6C — Schedule true interval-scoped query.
 *
 * Proves {@link fetchScheduleIntervalFromSupabase} fetches ONLY what the
 * `[fromDate, toDate]` window can touch — never all work orders — while still
 * feeding {@link resolveScheduleProgram} an input that yields IDENTICAL
 * occurrences to the local source over the same display window.
 *
 * It exercises the three things that make the narrowing correct:
 *   1. Parent narrowing — a work order whose only row is far outside the window
 *      is NOT hydrated.
 *   2. Scan widening — a reschedule whose moved-to date lands in range widens
 *      the scanned window to the rule date, so the occurrence that moved IN is
 *      still fetched (resolver parity).
 *   3. Empty interval — a window with no overlapping rows / exceptions returns
 *      nothing (the hook keeps localStorage rather than blanking).
 *
 * Read-only; the resolver, recurrence, variation and exception LOGIC are
 * untouched.
 */

type Row = Record<string, unknown>;

const mocks = vi.hoisted(() => {
  /** Parses one `col.op.val` term of a PostgREST `.or(...)` expression. */
  function matchOrTerm(row: Row, term: string): boolean {
    const [col, op, ...rest] = term.split(".");
    const val = rest.join(".");
    const cell = row[col];
    if (op === "is" && val === "null") return cell === null || cell === undefined;
    if (op === "gte") return cell != null && String(cell) >= val;
    if (op === "lte") return cell != null && String(cell) <= val;
    if (op === "eq") return String(cell) === val;
    return false;
  }

  class QueryBuilder {
    private filters: Array<(r: Row) => boolean> = [];
    constructor(private rows: Row[]) {}
    eq(col: string, val: unknown): this {
      this.filters.push((r) => r[col] === val);
      return this;
    }
    gte(col: string, val: unknown): this {
      this.filters.push((r) => r[col] != null && String(r[col]) >= String(val));
      return this;
    }
    lte(col: string, val: unknown): this {
      this.filters.push((r) => r[col] != null && String(r[col]) <= String(val));
      return this;
    }
    in(col: string, vals: unknown[]): this {
      const set = new Set(vals);
      this.filters.push((r) => set.has(r[col]));
      return this;
    }
    or(expr: string): this {
      const terms = expr.split(",");
      this.filters.push((r) => terms.some((t) => matchOrTerm(r, t)));
      return this;
    }
    private applied(): Row[] {
      return this.rows.filter((r) => this.filters.every((f) => f(r)));
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
import { resolveScheduleProgram, type ScheduleCoreInput } from "@/lib/scheduleCore";
import { getCustomers, getEmployees, getPostalCities } from "@/lib/store";
import { migrateWorkOrders } from "./workOrderMigration";
import { fetchScheduleIntervalFromSupabase } from "./supabaseWorkOrderRepository";
import { buildScheduleInputFromLocal, compareScheduleEntries } from "./workOrderScheduleValidation";

const NORD = "cmp_nord";

/** Display window: a single week in June. */
const WINDOW = { fromDate: "2026-06-08", toDate: "2026-06-14" };

function weeklyRow(id: string, serviceDate: string, serviceEndDate: string | null): WorkOrder["serviceRows"][number] {
  return {
    id,
    serviceName: "Window Cleaning",
    quantity: 1,
    status: "planned",
    serviceDate,
    serviceEndDate,
    recurrenceInterval: "weekly",
    plannedStartTime: "08:00",
    plannedEndTime: "10:00",
    assignedEmployeeIds: ["emp_1"],
    unassignedEmployeeSlots: 0,
    sortOrder: 0,
    variations: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  } as unknown as WorkOrder["serviceRows"][number];
}

function seed(): void {
  // In-window WO — open-ended weekly row that overlaps the June window.
  const inWindow: WorkOrder = {
    id: "wo_in",
    companyId: NORD,
    customerId: "cust_1",
    number: "WO-IN",
    status: "planned",
    serviceRows: [weeklyRow("row_in", "2026-06-01", null)],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  } as unknown as WorkOrder;

  // Out-of-window WO — a one-time row that ended back in January. Its dates do
  // NOT overlap the June window, so it must NOT be hydrated as a parent.
  const outWindow: WorkOrder = {
    id: "wo_out",
    companyId: NORD,
    customerId: "cust_1",
    number: "WO-OUT",
    status: "planned",
    serviceRows: [
      {
        ...weeklyRow("row_out", "2026-01-05", "2026-01-05"),
        recurrenceInterval: "one_time",
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  } as unknown as WorkOrder;

  saveWorkOrders([inWindow, outWindow]);

  saveCustomers([
    {
      id: "cust_1",
      companyId: NORD,
      name: "Bergen Office Park",
      customerNumber: "C-1",
      email: "office@bergen.test",
      status: "active",
      addresses: [{ id: "a1", street: "Storgata 1", postalCode: "5003", city: "Bergen", isDelivery: true }],
    } as unknown as Customer,
  ]);
  saveEmployees([
    { id: "emp_1", companyId: NORD, name: "Ingrid Sand", email: "i@n.test", status: "active", teamIds: [] } as unknown as Employee,
  ]);

  // Reschedule: rule date 2026-06-22 (OUTSIDE the window) moved to 2026-06-10
  // (INSIDE the window). Tests scan widening + moved-in parity.
  const moved: BookingOccurrenceException = {
    id: "exc_moved",
    occurrenceKey: "row_in:2026-06-22",
    parentServiceRowId: "row_in",
    occurrenceDate: "2026-06-22",
    status: "rescheduled",
    overrideOccurrenceDate: "2026-06-10",
    overrideStartTime: "09:00",
    overrideEndTime: "11:00",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  } as unknown as BookingOccurrenceException;
  saveBookingOccurrenceExceptions([moved]);
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

describe("P6C · Schedule interval-scoped query", () => {
  it("hydrates only the parents that own an in-window row (no full fetch)", async () => {
    seed();
    seedCompanies();
    await migrateWorkOrders();

    const fetched = await fetchScheduleIntervalFromSupabase({ companyId: NORD, ...WINDOW });

    const ids = fetched.workOrders.map((w) => w.id).sort();
    expect(ids).toEqual(["wo_in"]);
    expect(fetched.parentsFetched).toBe(1);
    expect(fetched.serviceRowsFetched).toBeGreaterThanOrEqual(1);
  });

  it("widens the scan window for a reschedule that moved INTO the range", async () => {
    seed();
    seedCompanies();
    await migrateWorkOrders();

    const fetched = await fetchScheduleIntervalFromSupabase({ companyId: NORD, ...WINDOW });

    // The override (2026-06-10) lands in [from,to]; the rule date (2026-06-22)
    // widens the scanned upper bound past the display window.
    expect(fetched.queryFromDate).toBe(WINDOW.fromDate);
    expect(fetched.queryToDate).toBe("2026-06-22");
    expect(fetched.exceptionsFetched).toBe(1);
  });

  it("interval-scoped resolve equals local resolve over the same window", async () => {
    seed();
    seedCompanies();
    await migrateWorkOrders();

    const opts = { companyId: NORD, ...WINDOW, includeCancelled: true };
    const fetched = await fetchScheduleIntervalFromSupabase(opts);

    const supabaseInput: ScheduleCoreInput = {
      workOrders: fetched.workOrders,
      customers: getCustomers(),
      employees: getEmployees(),
      postalCities: getPostalCities(),
      exceptions: fetched.exceptions,
      ...WINDOW,
      includeCancelled: true,
    };

    const localEntries = resolveScheduleProgram(buildScheduleInputFromLocal(opts));
    const supabaseEntries = resolveScheduleProgram(supabaseInput);

    const cmp = compareScheduleEntries(localEntries, supabaseEntries, { companyId: NORD, ...WINDOW });
    expect(cmp.ok).toBe(true);
    expect(cmp.localOccurrences).toBeGreaterThan(0);
    // The moved-in occurrence (rule 06-22 → display 06-10) must be present.
    expect(supabaseEntries.some((e) => e.occurrenceKey === "row_in:2026-06-22")).toBe(true);
  });

  it("returns an empty slice for a window nothing can touch", async () => {
    seed();
    seedCompanies();
    await migrateWorkOrders();

    const fetched = await fetchScheduleIntervalFromSupabase({
      companyId: NORD,
      fromDate: "2025-03-01",
      toDate: "2025-03-07",
    });

    expect(fetched.workOrders).toEqual([]);
    expect(fetched.exceptions).toEqual([]);
    expect(fetched.parentsFetched).toBe(0);
  });
});
