import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * P5E — WO-3: Work Order DETAIL read path (localStorage → Supabase, flag-gated).
 *
 * Drives the real `supabaseWorkOrderRepository.getDetail` read path and the
 * `shadowReadWorkOrderDetail` validator against the same in-memory Supabase fake
 * used by the WO-1/WO-2 tests, proving that the FULL work-order detail the page
 * renders (header fields + nested service rows + embedded variations)
 * round-trips through Supabase with company scoping intact, and that detail
 * parity matches the localStorage path.
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
import { migrateWorkOrders, shadowReadWorkOrderDetail } from "./workOrderMigration";
import { supabaseWorkOrderRepository } from "./supabaseWorkOrderRepository";

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

describe("P5E · WO-3 work order detail read path", () => {
  it("getDetail returns the full work-order record after migration", async () => {
    seedCompanies();
    await migrateWorkOrders();

    const local = getWorkOrders().find((w) => w.companyId === NORDLYS);
    expect(local).toBeTruthy();

    const remote = await supabaseWorkOrderRepository.getDetail(local!.id, {
      companyId: NORDLYS,
    });
    // Lossless jsonb round-trip — equals the localStorage record exactly.
    expect(remote).toEqual(local);
  });

  it("scopes by company — a foreign company scope returns null", async () => {
    seedCompanies();
    await migrateWorkOrders();

    const local = getWorkOrders().find((w) => w.companyId === NORDLYS);
    const remote = await supabaseWorkOrderRepository.getDetail(local!.id, {
      companyId: "cmp_not_real",
    });
    expect(remote).toBeNull();
  });

  it("returns null for a non-existing work order", async () => {
    seedCompanies();
    await migrateWorkOrders();

    const remote = await supabaseWorkOrderRepository.getDetail("wo_does_not_exist", {
      companyId: NORDLYS,
    });
    expect(remote).toBeNull();
  });

  it("resolves a Supabase-only order (no localStorage copy) within company scope", async () => {
    seedCompanies();
    await migrateWorkOrders();

    const local = getWorkOrders().find((w) => w.companyId === NORDLYS);
    expect(local).toBeTruthy();
    const id = local!.id;

    // Simulate the deployed dev/demo case the bug hit: the order lives in
    // Supabase (authoritative list) and the viewer has no usable localStorage
    // copy. (Note: the store re-seeds default work orders when localStorage is
    // empty, so we cannot assert an empty local set here — the point under test
    // is that the Supabase detail read does NOT depend on a local copy.)
    //
    // useWorkOrderDetailSource now reads regardless of a local copy; access is
    // enforced purely by the company-scoped getDetail.
    const inScope = await supabaseWorkOrderRepository.getDetail(id, {
      companyId: NORDLYS,
    });
    expect(inScope).not.toBeNull();
    expect(inScope?.id).toBe(id);

    const foreign = await supabaseWorkOrderRepository.getDetail(id, {
      companyId: "cmp_not_real",
    });
    expect(foreign).toBeNull();
  });

  it("shadow read reports detail parity (0 mismatches) for a migrated order", async () => {
    seedCompanies();
    await migrateWorkOrders();

    const local = getWorkOrders().find((w) => w.companyId === NORDLYS);
    const report = await shadowReadWorkOrderDetail(local!.id, NORDLYS);

    expect(report.localFound).toBe(true);
    expect(report.supabaseFound).toBe(true);
    expect(report.serviceRowIdsMatch).toBe(true);
    expect(report.localServiceRowCount).toBe(report.supabaseServiceRowCount);
    expect(report.localVariationCount).toBe(report.supabaseVariationCount);
    expect(report.mismatchedFields).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("shadow read flags a Supabase-missing order (not migrated)", async () => {
    seedCompanies();
    // No migration → Supabase is empty; local exists.
    const local = getWorkOrders().find((w) => w.companyId === NORDLYS);
    const report = await shadowReadWorkOrderDetail(local!.id, NORDLYS);

    expect(report.localFound).toBe(true);
    expect(report.supabaseFound).toBe(false);
    expect(report.ok).toBe(false);
    expect(report.notes.length).toBeGreaterThan(0);
  });
});
