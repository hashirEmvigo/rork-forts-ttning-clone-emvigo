import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * AREA-1 — Area migration + shadow-read parity. Drives the real `migrateAreas` /
 * `shadowReadAreas` paths against an in-memory Supabase fake.
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

const storeMocks = vi.hoisted(() => ({ areas: [] as unknown[] }));
vi.mock("@/lib/store", () => ({
  getAreas: () => storeMocks.areas,
}));

import type { Area } from "@/types";
import { migrateAreas, shadowReadAreas } from "./areaMigration";

const NORDLYS = "cmp_nordlys";
const UUID = "00000000-0000-4000-8000-000000000000";

function seedCompanies(): void {
  mocks.client.tables.set("companies", [{ id: UUID, legacy_id: NORDLYS }]);
}

function area(id: string, name = id, companyId = NORDLYS): Area {
  return {
    id,
    companyId,
    name,
    description: `${name} desc`,
    isActive: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function areaRows(): Row[] {
  return mocks.client.tables.get("areas") ?? [];
}

beforeEach(() => {
  mocks.client.reset();
  storeMocks.areas = [];
});

describe("AREA-1 · migrateAreas", () => {
  it("upserts area rows preserving legacy_id", async () => {
    seedCompanies();
    storeMocks.areas = [area("area_a"), area("area_b")];
    const report = await migrateAreas();
    expect(report.ok).toBe(true);
    expect(report.writtenCount).toBe(2);
    expect(areaRows().map((r) => r.legacy_id).sort()).toEqual(["area_a", "area_b"]);
  });

  it("dry-run writes nothing", async () => {
    seedCompanies();
    storeMocks.areas = [area("area_a")];
    const report = await migrateAreas({ dryRun: true });
    expect(report.plannedCount).toBe(1);
    expect(report.writtenCount).toBe(0);
    expect(areaRows()).toHaveLength(0);
  });

  it("skips an area whose company has no Supabase row", async () => {
    storeMocks.areas = [area("area_a")];
    const report = await migrateAreas();
    expect(report.ok).toBe(false);
    expect(report.skipped).toHaveLength(1);
    expect(areaRows()).toHaveLength(0);
  });
});

describe("AREA-1 · shadowReadAreas", () => {
  it("reports full parity after a clean migration", async () => {
    seedCompanies();
    storeMocks.areas = [area("area_a"), area("area_b")];
    await migrateAreas();
    const report = await shadowReadAreas();
    expect(report.countMatch).toBe(true);
    expect(report.idsMatch).toBe(true);
    expect(report.summaryMatch).toBe(true);
    expect(report.detailMatch).toBe(true);
    expect(report.ok).toBe(true);
  });

  it("flags a count mismatch when Supabase is missing an area", async () => {
    seedCompanies();
    storeMocks.areas = [area("area_a"), area("area_b")];
    await migrateAreas();
    storeMocks.areas = [...(storeMocks.areas as Area[]), area("area_c")];
    const report = await shadowReadAreas();
    expect(report.countMatch).toBe(false);
    expect(report.missingInSupabase).toContain("area_c");
    expect(report.ok).toBe(false);
  });
});
