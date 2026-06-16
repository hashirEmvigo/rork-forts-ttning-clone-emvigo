import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * MEDIA-1 — Media Asset migration + shadow-read parity against an in-memory
 * Supabase fake. localStorage (jsdom) is the source of truth.
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
        update: (patch: Row) => ({
          in: (col: string, vals: unknown[]) => {
            for (const r of rows) if (vals.includes(r[col])) Object.assign(r, patch);
            return Promise.resolve({ error: null });
          },
        }),
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

import type { MediaAsset } from "@/types";
import { migrateMediaAssets, shadowReadMediaAssets } from "./mediaAssetMigration";

const NORDLYS = "cmp_nordlys";
const UUID = "00000000-0000-4000-8000-000000000000";
const MEDIA_KEY = "cleanops.mediaAssets";

function seedCompanies(): void {
  mocks.client.tables.set("companies", [{ id: UUID, legacy_id: NORDLYS }]);
}

function asset(id: string, companyId = NORDLYS): MediaAsset {
  return {
    id,
    companyId,
    category: "customer_general",
    entityType: "customer",
    entityId: "cust_1",
    uploadedBy: "user_1",
    uploadedByRole: "company_admin",
    microThumbnailUrl: "data:micro",
    hoverThumbnailUrl: "data:hover",
    previewImageUrl: "data:preview",
    width: 100,
    height: 80,
    fileSize: 1234,
    createdAt: "2026-01-01T00:00:00.000Z",
  } as unknown as MediaAsset;
}

function setLocal(assets: MediaAsset[]): void {
  localStorage.setItem(MEDIA_KEY, JSON.stringify(assets));
}

beforeEach(() => {
  mocks.client.reset();
  localStorage.clear();
});

describe("MEDIA-1 · migrateMediaAssets", () => {
  it("upserts media rows preserving legacy_id + company scope", async () => {
    seedCompanies();
    setLocal([asset("m_a"), asset("m_b")]);
    const report = await migrateMediaAssets();
    expect(report.ok).toBe(true);
    expect(report.writtenCount).toBe(2);
    expect((mocks.client.tables.get("media_assets") ?? []).length).toBe(2);
  });

  it("dry-run writes nothing", async () => {
    seedCompanies();
    setLocal([asset("m_a")]);
    const report = await migrateMediaAssets({ dryRun: true });
    expect(report.plannedCount).toBe(1);
    expect(report.writtenCount).toBe(0);
  });

  it("skips an asset whose company has no Supabase row", async () => {
    setLocal([asset("m_a")]);
    const report = await migrateMediaAssets();
    expect(report.ok).toBe(false);
    expect(report.skipped).toHaveLength(1);
  });
});

describe("MEDIA-1 · shadowReadMediaAssets", () => {
  it("reports full parity after a clean migration", async () => {
    seedCompanies();
    setLocal([asset("m_a"), asset("m_b")]);
    await migrateMediaAssets();
    const report = await shadowReadMediaAssets();
    expect(report.ok).toBe(true);
    expect(report.detailMatch).toBe(true);
  });
});
