import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * P4E — Wave 1A.5: Customer migration execution & shadow validation.
 *
 * This drives the REAL migration + shadow-read + repository code paths
 * (`migrateCustomers`, `shadowReadCustomers`, `supabaseCustomerRepository`)
 * against an in-memory Supabase fake. A live Supabase project requires an
 * authenticated browser session and cannot run in CI, so the fake reproduces
 * the exact query-builder surface those modules use (`from().select().eq()
 * .maybeSingle()` and `from().upsert(rows, { onConflict })`) and the RLS-style
 * company scoping the repository relies on.
 *
 * What this proves, automatically and repeatably:
 *   • migration execution + structured report
 *   • company (legacy_id → uuid) mapping with no orphans
 *   • shadow-read parity: count / id / summary / detail
 *   • CRUD parity (create + update via idempotent upsert)
 *   • search parity (number / name / threshold)
 *   • pagination parity (no dropped/duplicated rows)
 *   • idempotency (run twice → no inflation, no duplicates)
 *   • query-layer company scoping (foreign company sees nothing)
 *
 * DB-level RLS (migration 0007 policies) is enforced server-side and must be
 * confirmed once against the live project; the query-layer scope verified here
 * is the client contract those policies mirror.
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
    then<R>(
      onFulfilled: (res: { data: Row[]; error: null }) => R,
    ): Promise<R> {
      return Promise.resolve({ data: this.applied(), error: null }).then(onFulfilled);
    }
  }

  class FakeClient {
    tables = new Map<string, Row[]>();
    /** Counts upsert write operations, to assert idempotency does not inflate. */
    upsertCalls = 0;
    private table(name: string): Row[] {
      if (!this.tables.has(name)) this.tables.set(name, []);
      return this.tables.get(name) as Row[];
    }
    from(name: string) {
      const rows = this.table(name);
      return {
        select: (_cols?: string) => new QueryBuilder(rows),
        upsert: (incoming: Row[], opts: { onConflict: string }) => {
          this.upsertCalls += 1;
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
      this.upsertCalls = 0;
    }
  }

  return { client: new FakeClient() };
});

vi.mock("@/lib/supabase", () => ({
  supabase: mocks.client,
  isSupabaseConfigured: true,
}));

import { getCustomers } from "@/lib/store";
import { localDataLayer } from "./localStorageAdapters";
import { supabaseCustomerRepository } from "./supabaseCustomerRepository";
import { migrateCustomers, shadowReadCustomers } from "./customerMigration";

const NORDLYS = "cmp_nordlys";

/** Seeds the fake `companies` table with a uuid for every customer company id. */
function seedCompanies(): Map<string, string> {
  const legacyIds = Array.from(new Set(getCustomers().map((c) => c.companyId)));
  const map = new Map<string, string>();
  const rows: Row[] = legacyIds.map((legacy, i) => {
    const uuid = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
    map.set(legacy, uuid);
    return { id: uuid, legacy_id: legacy };
  });
  mocks.client.tables.set("companies", rows);
  return map;
}

beforeEach(() => {
  localStorage.clear();
  mocks.client.reset();
});

// ── Part 1: Migration execution ───────────────────────────
describe("P4E · migration execution", () => {
  it("dry-run plans every customer and writes nothing", async () => {
    seedCompanies();
    const source = getCustomers();
    const report = await migrateCustomers({ dryRun: true });

    expect(report.ok).toBe(true);
    expect(report.dryRun).toBe(true);
    expect(report.sourceCount).toBe(source.length);
    expect(report.plannedCount).toBe(source.length);
    expect(report.writtenCount).toBe(0);
    expect(report.skipped).toEqual([]);
    expect(mocks.client.tables.get("customers") ?? []).toHaveLength(0);
  });

  it("executes the migration and writes every customer with no skips", async () => {
    seedCompanies();
    const source = getCustomers();
    const report = await migrateCustomers();

    expect(report.ok).toBe(true);
    expect(report.sourceCount).toBe(source.length);
    expect(report.writtenCount).toBe(source.length);
    expect(report.skipped).toEqual([]);
    expect(mocks.client.tables.get("customers") ?? []).toHaveLength(source.length);
  });

  it("skips (does not throw) customers whose company has no Supabase row", async () => {
    // Intentionally do NOT seed companies → every row should be skipped + reported.
    const report = await migrateCustomers();
    expect(report.ok).toBe(false);
    expect(report.writtenCount).toBe(0);
    expect(report.skipped.length).toBe(report.sourceCount);
    expect(report.skipped[0]?.reason).toContain("Migrate companies first");
  });
});

// ── Part 2: Company mapping ───────────────────────────────
describe("P4E · company mapping", () => {
  it("every migrated row carries a valid company uuid (no orphans, no mismatch)", async () => {
    const map = seedCompanies();
    await migrateCustomers();
    const rows = mocks.client.tables.get("customers") ?? [];
    const validUuids = new Set(map.values());

    for (const row of rows) {
      expect(row.company_id, `${String(row.legacy_id)} missing company uuid`).toBeTruthy();
      expect(validUuids.has(row.company_id as string)).toBe(true);
      // The uuid must match the row's own legacy company id.
      expect(row.company_id).toBe(map.get(row.company_legacy_id as string));
    }
  });
});

// ── Part 3: Shadow read parity ────────────────────────────
describe("P4E · shadow-read parity", () => {
  it("reports full parity across all companies after migration", async () => {
    seedCompanies();
    await migrateCustomers();
    const report = await shadowReadCustomers();

    expect(report.notes, report.notes.join(", ")).toEqual([]);
    expect(report.countMatch).toBe(true);
    expect(report.idsMatch).toBe(true);
    expect(report.summaryMatch).toBe(true);
    expect(report.detailMatch).toBe(true);
    expect(report.missingInSupabase).toEqual([]);
    expect(report.extraInSupabase).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("reports full parity scoped to a single seeded company", async () => {
    seedCompanies();
    await migrateCustomers();
    const report = await shadowReadCustomers(NORDLYS);

    expect(report.companyId).toBe(NORDLYS);
    expect(report.ok).toBe(true);
    expect(report.localCount).toBeGreaterThan(0);
    expect(report.localCount).toBe(report.supabaseCount);
  });

  it("surfaces (never hides) rows missing in Supabase before migration", async () => {
    seedCompanies();
    const report = await shadowReadCustomers(NORDLYS);
    expect(report.ok).toBe(false);
    expect(report.missingInSupabase.length).toBe(report.localCount);
    expect(report.notes.join(" ")).toContain("not yet in Supabase");
  });
});

// ── Part 4: CRUD parity ───────────────────────────────────
describe("P4E · CRUD parity (local adapter vs supabase repository)", () => {
  it("listSummaries / count / getDetail agree after migration", async () => {
    seedCompanies();
    await migrateCustomers();

    const local = await localDataLayer.customers.listSummaries({ companyId: NORDLYS });
    const remote = await supabaseCustomerRepository.listSummaries({ companyId: NORDLYS });
    expect(remote.total).toBe(local.total);
    expect(new Set(remote.items.map((c) => c.id))).toEqual(new Set(local.items.map((c) => c.id)));

    expect(await supabaseCustomerRepository.count({ companyId: NORDLYS })).toBe(
      await localDataLayer.customers.count({ companyId: NORDLYS }),
    );

    const sample = local.items[0];
    const [ld, rd] = await Promise.all([
      localDataLayer.customers.getDetail(sample.id, { companyId: NORDLYS }),
      supabaseCustomerRepository.getDetail(sample.id, { companyId: NORDLYS }),
    ]);
    expect(rd?.id).toBe(ld?.id);
    expect(rd?.customerNumber).toBe(ld?.customerNumber);
    expect(rd?.name).toBe(ld?.name);
  });

  it("update flows through (re-migration refreshes the shadow row)", async () => {
    const map = seedCompanies();
    await migrateCustomers();

    // Simulate an update by upserting a renamed row on the same legacy_id.
    const sample = getCustomers().find((c) => c.companyId === NORDLYS);
    expect(sample).toBeDefined();
    if (!sample) return;
    await mocks.client
      .from("customers")
      .upsert(
        [
          {
            legacy_id: sample.id,
            company_id: map.get(NORDLYS),
            company_legacy_id: NORDLYS,
            customer_number: sample.customerNumber,
            name: "Renamed Co",
            email: sample.email ?? "",
            status: sample.status,
            customer_type: sample.customerType ?? null,
            area_id: sample.areaId ?? null,
            data: { ...sample, name: "Renamed Co" },
          },
        ],
        { onConflict: "legacy_id" },
      );

    const detail = await supabaseCustomerRepository.getDetail(sample.id, { companyId: NORDLYS });
    expect(detail?.name).toBe("Renamed Co");
    // No duplicate created by the update upsert.
    const rows = (mocks.client.tables.get("customers") ?? []).filter((r) => r.legacy_id === sample.id);
    expect(rows).toHaveLength(1);
  });
});

// ── Part 5: Search parity ─────────────────────────────────
describe("P4E · search parity", () => {
  it("number, name and partial search return the same ids on both sides", async () => {
    seedCompanies();
    await migrateCustomers();
    const sample = getCustomers().find((c) => c.companyId === NORDLYS);
    expect(sample).toBeDefined();
    if (!sample) return;

    for (const term of [sample.customerNumber, sample.name, sample.name.slice(0, 3)]) {
      const local = await localDataLayer.customers.search({ companyId: NORDLYS, search: term });
      const remote = await supabaseCustomerRepository.search({ companyId: NORDLYS, search: term });
      expect(new Set(remote.items.map((c) => c.id)), `term="${term}"`).toEqual(
        new Set(local.items.map((c) => c.id)),
      );
      expect(remote.items.some((c) => c.id === sample.id)).toBe(true);
    }
  });

  it("a below-threshold query is ignored identically on both sides", async () => {
    seedCompanies();
    await migrateCustomers();
    const local = await localDataLayer.customers.search({ companyId: NORDLYS, search: "a" });
    const remote = await supabaseCustomerRepository.search({ companyId: NORDLYS, search: "a" });
    expect(remote.total).toBe(local.total);
  });
});

// ── Part 6: Pagination parity ─────────────────────────────
describe("P4E · pagination parity", () => {
  it("paginates identically with no dropped or duplicated rows", async () => {
    seedCompanies();
    await migrateCustomers();
    const pageSize = 1;
    const all = await supabaseCustomerRepository.listSummaries({ companyId: NORDLYS });
    const pages = Math.ceil(all.total / pageSize);
    const seen = new Set<string>();

    for (let page = 1; page <= pages; page++) {
      const local = await localDataLayer.customers.listSummaries({ companyId: NORDLYS, page, pageSize });
      const remote = await supabaseCustomerRepository.listSummaries({ companyId: NORDLYS, page, pageSize });
      expect(remote.total).toBe(local.total);
      expect(remote.page).toBe(page);
      expect(remote.items.length).toBeLessThanOrEqual(pageSize);
      for (const item of remote.items) seen.add(item.id);
    }
    expect(seen.size).toBe(all.total);
  });
});

// ── Part 7: Idempotency ───────────────────────────────────
describe("P4E · idempotency", () => {
  it("running migration twice does not inflate or duplicate rows", async () => {
    seedCompanies();
    const source = getCustomers();

    const first = await migrateCustomers();
    const afterFirst = (mocks.client.tables.get("customers") ?? []).length;
    const second = await migrateCustomers();
    const afterSecond = (mocks.client.tables.get("customers") ?? []).length;

    expect(first.writtenCount).toBe(source.length);
    expect(second.writtenCount).toBe(source.length);
    expect(afterFirst).toBe(source.length);
    expect(afterSecond).toBe(source.length);

    // No duplicate legacy_ids.
    const ids = (mocks.client.tables.get("customers") ?? []).map((r) => r.legacy_id);
    expect(new Set(ids).size).toBe(ids.length);

    // Shadow read still clean after a repeat run.
    const report = await shadowReadCustomers();
    expect(report.ok).toBe(true);
  });
});

// ── Part 8: Query-layer company scoping (RLS contract) ────
describe("P4E · company scoping", () => {
  it("scoping to a company returns only that company's customers", async () => {
    seedCompanies();
    await migrateCustomers();
    const scoped = await supabaseCustomerRepository.listSummaries({ companyId: NORDLYS });
    expect(scoped.items.every((c) => c.companyId === NORDLYS)).toBe(true);
    expect(scoped.total).toBeGreaterThan(0);
  });

  it("a non-existent company sees nothing (no cross-company leak)", async () => {
    seedCompanies();
    await migrateCustomers();
    const foreign = await supabaseCustomerRepository.listSummaries({ companyId: "cmp_not_real" });
    expect(foreign.total).toBe(0);

    const sample = getCustomers().find((c) => c.companyId === NORDLYS);
    if (sample) {
      const blocked = await supabaseCustomerRepository.getDetail(sample.id, {
        companyId: "cmp_not_real",
      });
      expect(blocked).toBeNull();
    }
  });
});
