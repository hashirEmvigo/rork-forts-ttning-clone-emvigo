import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * P4F — Wave 1B: Customer LIST read path (localStorage → Supabase, flag-gated).
 *
 * Drives the real `listFullCustomersFromSupabase` read path against the same
 * in-memory Supabase fake used by the Wave 1A.5 migration tests, proving that
 * the FULL records the Customers list renders (not just the lightweight
 * summary) round-trip through Supabase with company scoping intact.
 *
 * The feature flag itself defaults OFF; this test verifies the read path the
 * flag switches ON behaves identically to localStorage.
 */

type Row = Record<string, unknown>;

const mocks = vi.hoisted(() => {
  class QueryBuilder {
    private filters: Array<[string, unknown]> = [];
    private isFilters: string[] = [];
    constructor(private rows: Row[]) {}
    eq(col: string, val: unknown): this {
      this.filters.push([col, val]);
      return this;
    }
    is(col: string, _val: null): this {
      this.isFilters.push(col);
      return this;
    }
    private applied(): Row[] {
      return this.rows.filter(
        (r) =>
          this.filters.every(([c, v]) => r[c] === v) &&
          this.isFilters.every((c) => r[c] === null || r[c] === undefined),
      );
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

import { getCustomers } from "@/lib/store";
import { migrateCustomers } from "./customerMigration";
import { listFullCustomersFromSupabase } from "./supabaseCustomerRepository";

const NORDLYS = "cmp_nordlys";

function seedCompanies(): void {
  const legacyIds = Array.from(new Set(getCustomers().map((c) => c.companyId)));
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

describe("P4F · Wave 1B customer list read path", () => {
  it("returns full customer records (not just summary fields) after migration", async () => {
    seedCompanies();
    await migrateCustomers();

    const local = getCustomers().filter((c) => c.companyId === NORDLYS);
    const remote = await listFullCustomersFromSupabase(NORDLYS);

    expect(remote.length).toBe(local.length);

    const localById = new Map(local.map((c) => [c.id, c]));
    for (const r of remote) {
      const l = localById.get(r.id);
      expect(l, `missing local customer ${r.id}`).toBeDefined();
      if (!l) continue;
      // Detail-only fields the list renders must survive the round-trip.
      expect(r.name).toBe(l.name);
      expect(r.customerNumber).toBe(l.customerNumber);
      expect(r.phone ?? null).toBe(l.phone ?? null);
      expect(r.addresses?.length ?? 0).toBe(l.addresses?.length ?? 0);
      expect(r.ownerId ?? null).toBe(l.ownerId ?? null);
    }
  });

  it("scopes to a single company (no cross-tenant leak)", async () => {
    seedCompanies();
    await migrateCustomers();
    const rows = await listFullCustomersFromSupabase(NORDLYS);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((c) => c.companyId === NORDLYS)).toBe(true);
  });

  it("returns nothing for an unknown company", async () => {
    seedCompanies();
    await migrateCustomers();
    const rows = await listFullCustomersFromSupabase("cmp_not_real");
    expect(rows).toEqual([]);
  });

  it("unscoped read returns every migrated company's customers", async () => {
    seedCompanies();
    await migrateCustomers();
    const all = await listFullCustomersFromSupabase();
    expect(all.length).toBe(getCustomers().length);
  });

  it("excludes archived customers by default and includes them only when requested", async () => {
    seedCompanies();
    await migrateCustomers();

    const before = await listFullCustomersFromSupabase(NORDLYS, { includeArchived: true });
    expect(before.length).toBeGreaterThan(0);

    const victim = before[0];
    const rows = mocks.client.tables.get("customers") ?? [];
    const target = rows.find((r) => r.legacy_id === victim.id);
    expect(target).toBeDefined();
    if (target) {
      target.status = "archived";
      target.data = { ...(target.data as Record<string, unknown>), status: "archived" };
    }

    const activeOnly = await listFullCustomersFromSupabase(NORDLYS);
    expect(activeOnly.some((c) => c.id === victim.id)).toBe(false);

    const withArchived = await listFullCustomersFromSupabase(NORDLYS, { includeArchived: true });
    expect(withArchived.some((c) => c.id === victim.id && c.status === "archived")).toBe(true);
  });

  it("excludes soft-deleted (deleted_at) customers from the list read", async () => {
    seedCompanies();
    await migrateCustomers();

    const before = await listFullCustomersFromSupabase(NORDLYS);
    expect(before.length).toBeGreaterThan(0);

    // Soft-delete one row directly in the fake store (simulates the mirror's
    // removal propagation stamping deleted_at).
    const victim = before[0];
    const rows = mocks.client.tables.get("customers") ?? [];
    const target = rows.find((r) => r.legacy_id === victim.id);
    expect(target).toBeDefined();
    if (target) target.deleted_at = new Date().toISOString();

    const after = await listFullCustomersFromSupabase(NORDLYS);
    expect(after.length).toBe(before.length - 1);
    expect(after.some((c) => c.id === victim.id)).toBe(false);
  });
});
