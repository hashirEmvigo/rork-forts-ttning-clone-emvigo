import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * P4G — Wave 1C: Customer Card DETAIL read path (localStorage → Supabase,
 * flag-gated).
 *
 * Drives the real `supabaseCustomerRepository.getDetail` + the detail
 * shadow-read against the same in-memory Supabase fake used by the Wave 1A.5
 * migration and Wave 1B list tests, proving that the FULL detail record the
 * Customer Card renders round-trips through Supabase with company scoping
 * intact and matches localStorage field-by-field.
 *
 * The feature flag itself defaults OFF; this verifies the read path the flag
 * switches ON behaves identically to localStorage.
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
import { migrateCustomers, shadowReadCustomerDetail } from "./customerMigration";
import { supabaseCustomerRepository } from "./supabaseCustomerRepository";

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

describe("P4G · Wave 1C customer detail read path", () => {
  it("getDetail returns the full record matching localStorage", async () => {
    seedCompanies();
    await migrateCustomers();

    const sample = getCustomers().find((c) => c.companyId === NORDLYS);
    expect(sample).toBeDefined();
    if (!sample) return;

    const remote = await supabaseCustomerRepository.getDetail(sample.id, {
      companyId: NORDLYS,
    });
    expect(remote).not.toBeNull();
    expect(remote?.id).toBe(sample.id);
    expect(remote?.name).toBe(sample.name);
    expect(remote?.customerNumber).toBe(sample.customerNumber);
    expect(remote?.phone ?? null).toBe(sample.phone ?? null);
    expect(remote?.addresses?.length ?? 0).toBe(sample.addresses?.length ?? 0);
    expect(remote?.contacts?.length ?? 0).toBe(sample.contacts?.length ?? 0);
  });

  it("detail shadow read reports zero field mismatches after migration", async () => {
    seedCompanies();
    await migrateCustomers();

    const sample = getCustomers().find((c) => c.companyId === NORDLYS);
    if (!sample) return;

    const report = await shadowReadCustomerDetail(sample.id, NORDLYS);
    expect(report.localFound).toBe(true);
    expect(report.supabaseFound).toBe(true);
    expect(report.mismatchedFields, report.notes.join(", ")).toEqual([]);
    expect(report.matchedFields).toContain("userIds");
    expect(report.ok).toBe(true);
  });

  it("detail shadow read surfaces userIds (customer-portal login) drift", async () => {
    seedCompanies();
    await migrateCustomers();

    const sample = getCustomers().find((c) => c.companyId === NORDLYS);
    if (!sample) return;

    // Diverge the Supabase copy's linked logins to simulate portal-login drift.
    const rows = mocks.client.tables.get("customers") ?? [];
    const row = rows.find((r) => r.legacy_id === sample.id);
    expect(row).toBeDefined();
    if (!row) return;
    const detail = row.data as { userIds?: string[] };
    detail.userIds = [...(detail.userIds ?? []), "usr_ghost_portal_login"];

    const report = await shadowReadCustomerDetail(sample.id, NORDLYS);
    expect(report.mismatchedFields).toContain("userIds");
    expect(report.ok).toBe(false);
    expect(report.notes.join(", ")).toContain("userIds mismatch");
  });

  it("detail shadow read ignores userIds ordering (order-insensitive set)", async () => {
    seedCompanies();
    await migrateCustomers();

    const sample = getCustomers().find(
      (c) => c.companyId === NORDLYS && (c.userIds?.length ?? 0) >= 2,
    );
    if (!sample) return;

    const rows = mocks.client.tables.get("customers") ?? [];
    const row = rows.find((r) => r.legacy_id === sample.id);
    if (!row) return;
    const detail = row.data as { userIds?: string[] };
    detail.userIds = [...(detail.userIds ?? [])].reverse();

    const report = await shadowReadCustomerDetail(sample.id, NORDLYS);
    expect(report.matchedFields).toContain("userIds");
    expect(report.mismatchedFields).not.toContain("userIds");
  });

  it("blocks cross-company detail access (RLS-equivalent scoping)", async () => {
    seedCompanies();
    await migrateCustomers();

    const sample = getCustomers().find((c) => c.companyId === NORDLYS);
    if (!sample) return;

    // Scoping to a different company must not surface this customer.
    const blocked = await supabaseCustomerRepository.getDetail(sample.id, {
      companyId: "cmp_fjord",
    });
    expect(blocked).toBeNull();
  });

  it("returns null for a non-existent customer", async () => {
    seedCompanies();
    await migrateCustomers();
    const missing = await supabaseCustomerRepository.getDetail("cust_does_not_exist", {
      companyId: NORDLYS,
    });
    expect(missing).toBeNull();
  });

  it("super-admin (unscoped) detail read returns the record", async () => {
    seedCompanies();
    await migrateCustomers();

    const sample = getCustomers()[0];
    if (!sample) return;
    const remote = await supabaseCustomerRepository.getDetail(sample.id);
    expect(remote?.id).toBe(sample.id);
  });
});
