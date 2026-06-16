import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * P5D — WO-2: Work Order LIST read path (localStorage → Supabase, flag-gated).
 *
 * Drives the real `listFullWorkOrdersFromSupabase` read path against the same
 * in-memory Supabase fake used by the WO-1 migration tests, proving that the
 * FULL work-order records the list renders (not just the lightweight summary —
 * notably the nested `serviceRows`) round-trip through Supabase with company
 * scoping intact, and that customer narrowing matches the localStorage path.
 *
 * The feature flag itself defaults OFF; this test verifies the read path the
 * flag switches ON behaves identically to localStorage.
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

import { getWorkOrders } from "@/lib/store";
import { migrateWorkOrders } from "./workOrderMigration";
import { listFullWorkOrdersFromSupabase } from "./supabaseWorkOrderRepository";

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

beforeEach(() => {
  localStorage.clear();
  mocks.client.reset();
});

describe("P5D · WO-2 work order list read path", () => {
  it("returns full work-order records (incl. nested service rows) after migration", async () => {
    seedCompanies();
    await migrateWorkOrders();

    const local = getWorkOrders().filter((w) => w.companyId === NORDLYS);
    const remote = await listFullWorkOrdersFromSupabase(NORDLYS);

    expect(remote.length).toBe(local.length);
    // Same id set.
    expect(new Set(remote.map((w) => w.id))).toEqual(new Set(local.map((w) => w.id)));
    // Full records — the lossless jsonb round-trip equals the localStorage record
    // (nested serviceRows / notes / activity included, whatever the source had).
    const localById = new Map(local.map((w) => [w.id, w]));
    for (const w of remote) {
      expect(w).toEqual(localById.get(w.id));
    }
  });

  it("scopes by company — a foreign company id returns nothing", async () => {
    seedCompanies();
    await migrateWorkOrders();

    const rows = await listFullWorkOrdersFromSupabase("cmp_not_real");
    expect(rows).toHaveLength(0);
  });

  it("returns every company's work orders when no scope is given", async () => {
    seedCompanies();
    await migrateWorkOrders();

    const all = await listFullWorkOrdersFromSupabase();
    expect(all.length).toBe(getWorkOrders().length);
  });

  it("customer narrowing matches the localStorage view", async () => {
    seedCompanies();
    await migrateWorkOrders();

    const sample = getWorkOrders().find((w) => w.companyId === NORDLYS);
    expect(sample).toBeTruthy();
    const customerId = sample!.customerId;

    const localForCustomer = getWorkOrders()
      .filter((w) => w.customerId === customerId)
      .map((w) => w.id)
      .sort();
    const remoteForCustomer = (await listFullWorkOrdersFromSupabase(NORDLYS))
      .filter((w) => w.customerId === customerId)
      .map((w) => w.id)
      .sort();

    expect(remoteForCustomer).toEqual(localForCustomer);
  });
});
