import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * SET-1 — Settings wave migration + shadow-read parity. Drives the real
 * `migrateSettingsTemplates` (global) + `migrateCompanySettings` (company-scoped)
 * paths against an in-memory Supabase fake.
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

const storeMocks = vi.hoisted(() => ({
  templates: [] as unknown[],
  companySettings: [] as unknown[],
}));
vi.mock("@/lib/store", () => ({
  getSettingsTemplates: () => storeMocks.templates,
  getCompanySettings: () => storeMocks.companySettings,
}));

import type { CompanySettings, SettingsData, SettingsTemplate } from "@/types";
import {
  migrateSettingsTemplates,
  shadowReadSettingsTemplates,
} from "./settingsTemplateMigration";
import {
  migrateCompanySettings,
  shadowReadCompanySettings,
} from "./companySettingsMigration";

const NORDLYS = "cmp_nordlys";
const UUID = "00000000-0000-4000-8000-000000000000";
const EMPTY_DATA = {} as SettingsData;

function seedCompanies(): void {
  mocks.client.tables.set("companies", [{ id: UUID, legacy_id: NORDLYS }]);
}

function template(id: string, name = id): SettingsTemplate {
  return {
    id,
    name,
    archived: false,
    data: EMPTY_DATA,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function companySettings(companyId = NORDLYS): CompanySettings {
  return {
    companyId,
    initialized: true,
    sourceTemplateId: null,
    sourceTemplateName: null,
    data: EMPTY_DATA,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

beforeEach(() => {
  mocks.client.reset();
  storeMocks.templates = [];
  storeMocks.companySettings = [];
});

describe("SET-1 · migrateSettingsTemplates (global)", () => {
  it("upserts template rows preserving legacy_id", async () => {
    storeMocks.templates = [template("st_a"), template("st_b")];
    const report = await migrateSettingsTemplates();
    expect(report.ok).toBe(true);
    expect(report.writtenCount).toBe(2);
    expect((mocks.client.tables.get("settings_templates") ?? []).map((r) => r.legacy_id).sort()).toEqual([
      "st_a",
      "st_b",
    ]);
  });

  it("reports full parity after a clean migration", async () => {
    storeMocks.templates = [template("st_a")];
    await migrateSettingsTemplates();
    const report = await shadowReadSettingsTemplates();
    expect(report.ok).toBe(true);
  });
});

describe("SET-1 · migrateCompanySettings (company-scoped)", () => {
  it("upserts a record keyed by companyId", async () => {
    seedCompanies();
    storeMocks.companySettings = [companySettings()];
    const report = await migrateCompanySettings();
    expect(report.ok).toBe(true);
    expect(report.writtenCount).toBe(1);
    expect((mocks.client.tables.get("company_settings") ?? [])[0]?.legacy_id).toBe(NORDLYS);
  });

  it("skips a record whose company has no Supabase row", async () => {
    storeMocks.companySettings = [companySettings()];
    const report = await migrateCompanySettings();
    expect(report.ok).toBe(false);
    expect(report.skipped).toHaveLength(1);
  });

  it("reports full parity after a clean migration", async () => {
    seedCompanies();
    storeMocks.companySettings = [companySettings()];
    await migrateCompanySettings();
    const report = await shadowReadCompanySettings();
    expect(report.ok).toBe(true);
  });
});
