import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * AREA-1 — Postal City migration + shadow-read parity. Drives the real
 * `migratePostalCities` / `shadowReadPostalCities` paths against an in-memory
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

const storeMocks = vi.hoisted(() => ({ cities: [] as unknown[] }));
vi.mock("@/lib/store", () => ({
  getPostalCities: () => storeMocks.cities,
}));

import type { PostalCity } from "@/types";
import { migratePostalCities, shadowReadPostalCities } from "./postalCityMigration";

const NORDLYS = "cmp_nordlys";
const UUID = "00000000-0000-4000-8000-000000000000";

function seedCompanies(): void {
  mocks.client.tables.set("companies", [{ id: UUID, legacy_id: NORDLYS }]);
}

function city(id: string, name = id, companyId = NORDLYS): PostalCity {
  return {
    id,
    companyId,
    name,
    areaId: "area_a",
    isActive: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function cityRows(): Row[] {
  return mocks.client.tables.get("postal_cities") ?? [];
}

beforeEach(() => {
  mocks.client.reset();
  storeMocks.cities = [];
});

describe("AREA-1 · migratePostalCities", () => {
  it("upserts postal-city rows preserving legacy_id + area_legacy_id", async () => {
    seedCompanies();
    storeMocks.cities = [city("pc_a"), city("pc_b")];
    const report = await migratePostalCities();
    expect(report.ok).toBe(true);
    expect(report.writtenCount).toBe(2);
    expect(cityRows().every((r) => r.area_legacy_id === "area_a")).toBe(true);
  });

  it("dry-run writes nothing", async () => {
    seedCompanies();
    storeMocks.cities = [city("pc_a")];
    const report = await migratePostalCities({ dryRun: true });
    expect(report.plannedCount).toBe(1);
    expect(report.writtenCount).toBe(0);
    expect(cityRows()).toHaveLength(0);
  });

  it("skips a postal city whose company has no Supabase row", async () => {
    storeMocks.cities = [city("pc_a")];
    const report = await migratePostalCities();
    expect(report.ok).toBe(false);
    expect(report.skipped).toHaveLength(1);
  });
});

describe("AREA-1 · shadowReadPostalCities", () => {
  it("reports full parity after a clean migration", async () => {
    seedCompanies();
    storeMocks.cities = [city("pc_a"), city("pc_b")];
    await migratePostalCities();
    const report = await shadowReadPostalCities();
    expect(report.countMatch).toBe(true);
    expect(report.idsMatch).toBe(true);
    expect(report.summaryMatch).toBe(true);
    expect(report.detailMatch).toBe(true);
    expect(report.ok).toBe(true);
  });

  it("flags a count mismatch when Supabase is missing a postal city", async () => {
    seedCompanies();
    storeMocks.cities = [city("pc_a")];
    await migratePostalCities();
    storeMocks.cities = [...(storeMocks.cities as PostalCity[]), city("pc_c")];
    const report = await shadowReadPostalCities();
    expect(report.countMatch).toBe(false);
    expect(report.missingInSupabase).toContain("pc_c");
    expect(report.ok).toBe(false);
  });
});
