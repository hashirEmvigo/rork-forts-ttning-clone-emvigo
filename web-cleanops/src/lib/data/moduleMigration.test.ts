import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * MOD-1 — Module-domain migration + shadow-read parity (modules / categories /
 * company config) against an in-memory Supabase fake.
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

const storeMocks = vi.hoisted(() => ({
  modules: [] as unknown[],
  categories: [] as unknown[],
  companyModules: [] as unknown[],
}));
vi.mock("@/lib/store", () => ({
  getModules: () => storeMocks.modules,
  getModuleCategories: () => storeMocks.categories,
  getCompanyModules: () => storeMocks.companyModules,
}));

import type { Module, ModuleCategory, CompanyModuleSetting } from "@/types";
import { migrateModules, shadowReadModules } from "./moduleMigration";

const NORDLYS = "cmp_nordlys";
const UUID = "00000000-0000-4000-8000-000000000000";

function seedCompanies(): void {
  mocks.client.tables.set("companies", [{ id: UUID, legacy_id: NORDLYS }]);
}

function mod(id: string): Module {
  return {
    id,
    name: id,
    description: "",
    status: "active",
    allowedUserTypes: ["company_admin"],
    createdAt: "2026-01-01T00:00:00.000Z",
  } as Module;
}

function cat(id: string): ModuleCategory {
  return {
    id,
    name: id,
    description: "",
    icon: "folder",
    sortOrder: 0,
    status: "active",
    visibleUserTypes: ["company_admin"],
    moduleIds: [],
    createdAt: "2026-01-01T00:00:00.000Z",
  } as ModuleCategory;
}

function cmod(moduleId: string, companyId = NORDLYS): CompanyModuleSetting {
  return { companyId, moduleId, available: true, enabled: false };
}

beforeEach(() => {
  mocks.client.reset();
  storeMocks.modules = [];
  storeMocks.categories = [];
  storeMocks.companyModules = [];
});

describe("MOD-1 · migrateModules", () => {
  it("migrates global modules + categories and company config", async () => {
    seedCompanies();
    storeMocks.modules = [mod("checklist-manager")];
    storeMocks.categories = [cat("cat_ops")];
    storeMocks.companyModules = [cmod("checklist-manager")];
    const report = await migrateModules();
    expect(report.ok).toBe(true);
    expect(report.modules).toBe(1);
    expect(report.categories).toBe(1);
    expect(report.companyModules).toBe(1);
    expect(mocks.client.tables.get("company_modules")?.[0]?.legacy_id).toBe(
      `${NORDLYS}:checklist-manager`,
    );
  });

  it("skips company config whose company has no Supabase row", async () => {
    storeMocks.companyModules = [cmod("checklist-manager")];
    const report = await migrateModules();
    expect(report.ok).toBe(false);
    expect(report.skipped).toHaveLength(1);
  });
});

describe("MOD-1 · shadowReadModules", () => {
  it("reports parity across the three collections after migration", async () => {
    seedCompanies();
    storeMocks.modules = [mod("checklist-manager")];
    storeMocks.categories = [cat("cat_ops")];
    storeMocks.companyModules = [cmod("checklist-manager")];
    await migrateModules();
    const report = await shadowReadModules();
    expect(report.modulesMatch).toBe(true);
    expect(report.categoriesMatch).toBe(true);
    expect(report.companyModulesMatch).toBe(true);
    expect(report.ok).toBe(true);
  });
});
