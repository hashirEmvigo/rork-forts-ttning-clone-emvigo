import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * AREA-1 — Employee Language migration + shadow-read parity. Drives the real
 * `migrateEmployeeLanguages` / `shadowReadEmployeeLanguages` paths against an
 * in-memory Supabase fake.
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

const storeMocks = vi.hoisted(() => ({ languages: [] as unknown[] }));
vi.mock("@/lib/store", () => ({
  getEmployeeLanguages: () => storeMocks.languages,
}));

import type { EmployeeLanguage } from "@/types";
import {
  migrateEmployeeLanguages,
  shadowReadEmployeeLanguages,
} from "./employeeLanguageMigration";

const NORDLYS = "cmp_nordlys";
const UUID = "00000000-0000-4000-8000-000000000000";

function seedCompanies(): void {
  mocks.client.tables.set("companies", [{ id: UUID, legacy_id: NORDLYS }]);
}

function lang(id: string, code = id, companyId = NORDLYS): EmployeeLanguage {
  return {
    id,
    companyId,
    code,
    name: code.toUpperCase(),
    nativeName: code,
    isActive: true,
    isDefault: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function langRows(): Row[] {
  return mocks.client.tables.get("employee_languages") ?? [];
}

beforeEach(() => {
  mocks.client.reset();
  storeMocks.languages = [];
});

describe("AREA-1 · migrateEmployeeLanguages", () => {
  it("upserts language rows preserving legacy_id + code", async () => {
    seedCompanies();
    storeMocks.languages = [lang("lang_en", "en"), lang("lang_sv", "sv")];
    const report = await migrateEmployeeLanguages();
    expect(report.ok).toBe(true);
    expect(report.writtenCount).toBe(2);
    expect(langRows().map((r) => r.code).sort()).toEqual(["en", "sv"]);
  });

  it("dry-run writes nothing", async () => {
    seedCompanies();
    storeMocks.languages = [lang("lang_en", "en")];
    const report = await migrateEmployeeLanguages({ dryRun: true });
    expect(report.plannedCount).toBe(1);
    expect(report.writtenCount).toBe(0);
    expect(langRows()).toHaveLength(0);
  });

  it("skips a language whose company has no Supabase row", async () => {
    storeMocks.languages = [lang("lang_en", "en")];
    const report = await migrateEmployeeLanguages();
    expect(report.ok).toBe(false);
    expect(report.skipped).toHaveLength(1);
  });
});

describe("AREA-1 · shadowReadEmployeeLanguages", () => {
  it("reports full parity after a clean migration", async () => {
    seedCompanies();
    storeMocks.languages = [lang("lang_en", "en"), lang("lang_sv", "sv")];
    await migrateEmployeeLanguages();
    const report = await shadowReadEmployeeLanguages();
    expect(report.countMatch).toBe(true);
    expect(report.idsMatch).toBe(true);
    expect(report.summaryMatch).toBe(true);
    expect(report.detailMatch).toBe(true);
    expect(report.ok).toBe(true);
  });

  it("flags a count mismatch when Supabase is missing a language", async () => {
    seedCompanies();
    storeMocks.languages = [lang("lang_en", "en")];
    await migrateEmployeeLanguages();
    storeMocks.languages = [...(storeMocks.languages as EmployeeLanguage[]), lang("lang_pl", "pl")];
    const report = await shadowReadEmployeeLanguages();
    expect(report.countMatch).toBe(false);
    expect(report.missingInSupabase).toContain("lang_pl");
    expect(report.ok).toBe(false);
  });
});
