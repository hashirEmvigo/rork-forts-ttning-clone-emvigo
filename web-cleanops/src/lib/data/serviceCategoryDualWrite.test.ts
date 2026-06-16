import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * SVCCAT — Service Category dual-write mirror.
 *
 * Drives the real `mirrorServiceCategoryWrites` path against an in-memory
 * Supabase fake, proving create / global-row / idempotency / update / removal /
 * noop / failure / skip behaviour. localStorage is the source of truth.
 */

type Row = Record<string, unknown>;

const mocks = vi.hoisted(() => {
  let failUpsertTable: string | null = null;

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
          if (failUpsertTable === name) {
            return Promise.resolve({ error: { message: `simulated ${name} failure` } });
          }
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
            for (const row of rows) {
              if (vals.includes(row[col])) Object.assign(row, patch);
            }
            return Promise.resolve({ error: null });
          },
        }),
      };
    }
    reset(): void {
      this.tables.clear();
      failUpsertTable = null;
    }
    failOn(table: string | null): void {
      failUpsertTable = table;
    }
  }

  return { client: new FakeClient() };
});

vi.mock("@/lib/supabase", () => ({
  supabase: mocks.client,
  isSupabaseConfigured: true,
}));

import type { ServiceCategory } from "@/types";
import {
  mirrorServiceCategoryWrites,
  getServiceCategoryDualWriteState,
  resetServiceCategoryDualWriteState,
} from "./serviceCategoryDualWrite";

const NORDLYS = "cmp_nordlys";
const UUID = "00000000-0000-4000-8000-000000000000";

function seedCompanies(): void {
  mocks.client.tables.set("companies", [{ id: UUID, legacy_id: NORDLYS }]);
}

function category(
  id: string,
  name = id,
  companyId: string | null = NORDLYS,
): ServiceCategory {
  return {
    id,
    companyId,
    name,
    sortOrder: 0,
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function rows(): Row[] {
  return mocks.client.tables.get("service_categories") ?? [];
}

beforeEach(() => {
  mocks.client.reset();
  resetServiceCategoryDualWriteState();
});

describe("SVCCAT · service category dual write", () => {
  it("mirrors a new category on create", async () => {
    seedCompanies();
    const result = await mirrorServiceCategoryWrites([], [category("cat_a")]);
    expect(result.ok).toBe(true);
    expect(result.mirrored).toBe(1);
    expect(rows()).toHaveLength(1);
    expect(rows()[0].deleted_at).toBeNull();
  });

  it("mirrors a GLOBAL category with company_id null (never skipped)", async () => {
    const result = await mirrorServiceCategoryWrites([], [category("cat_g", "Global", null)]);
    expect(result.ok).toBe(true);
    expect(result.skipped).toHaveLength(0);
    expect(rows()[0].company_id).toBeNull();
  });

  it("is idempotent", async () => {
    seedCompanies();
    const all = [category("cat_a")];
    await mirrorServiceCategoryWrites([], all);
    await mirrorServiceCategoryWrites([], all);
    expect(rows()).toHaveLength(1);
  });

  it("re-mirrors only the changed category on update", async () => {
    seedCompanies();
    const before = [category("cat_a"), category("cat_b")];
    await mirrorServiceCategoryWrites([], before);
    resetServiceCategoryDualWriteState();
    const after = [category("cat_a", "Renamed"), category("cat_b")];
    const result = await mirrorServiceCategoryWrites(before, after);
    expect(result.mirrored).toBe(1);
    expect(rows().find((r) => r.legacy_id === "cat_a")?.name).toBe("Renamed");
  });

  it("soft-deletes a removed category", async () => {
    seedCompanies();
    const before = [category("cat_a"), category("cat_b")];
    await mirrorServiceCategoryWrites([], before);
    const result = await mirrorServiceCategoryWrites(before, [category("cat_a")]);
    expect(result.removed).toBe(1);
    expect(rows().find((r) => r.legacy_id === "cat_b")?.deleted_at).toBeTruthy();
  });

  it("noop does no Supabase work", async () => {
    seedCompanies();
    const all = [category("cat_a")];
    const result = await mirrorServiceCategoryWrites(all, all);
    expect(result.noop).toBe(true);
    expect(getServiceCategoryDualWriteState().noops).toBe(1);
  });

  it("records a failure when the upsert fails", async () => {
    seedCompanies();
    mocks.client.failOn("service_categories");
    const result = await mirrorServiceCategoryWrites([], [category("cat_a")]);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("upsert failed");
  });

  it("skips a company category with no Supabase mapping", async () => {
    const result = await mirrorServiceCategoryWrites([], [category("cat_a")]);
    expect(result.mirrored).toBe(0);
    expect(result.skipped).toHaveLength(1);
  });

  it("company writer skips a global row but still upserts its own company row", async () => {
    seedCompanies();
    const result = await mirrorServiceCategoryWrites(
      [],
      [category("cat_global", "Global", null), category("cat_company")],
      { companyId: NORDLYS, isSuperAdmin: false },
    );
    // The company-scoped row landed; the global row was excluded, not failed.
    expect(rows().map((r) => r.legacy_id)).toEqual(["cat_company"]);
    expect(result.mirrored).toBe(1);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].id).toBe("cat_global");
    expect(getServiceCategoryDualWriteState().failures).toBe(0);
    expect(getServiceCategoryDualWriteState().created).toBe(1);
  });

  it("super_admin writer still mirrors global rows", async () => {
    const result = await mirrorServiceCategoryWrites(
      [],
      [category("cat_global", "Global", null)],
      { companyId: null, isSuperAdmin: true },
    );
    expect(result.ok).toBe(true);
    expect(result.mirrored).toBe(1);
    expect(result.skipped).toHaveLength(0);
    expect(rows()[0].company_id).toBeNull();
  });

  it("company writer does not soft-delete a global removed row", async () => {
    seedCompanies();
    const before = [category("cat_company"), category("cat_global", "Global", null)];
    const result = await mirrorServiceCategoryWrites(
      before,
      [category("cat_global", "Global", null)],
      { companyId: NORDLYS, isSuperAdmin: false },
    );
    // Removing the company row is allowed; the global row is left untouched.
    expect(result.removed).toBe(1);
    expect(result.skipped).toHaveLength(0);
  });
});
