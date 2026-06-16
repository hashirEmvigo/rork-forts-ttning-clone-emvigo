import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * CHK-1 — Checklist Template (aggregate) migration + shadow-read parity. Tests
 * the GLOBAL tier (companyId null, never skipped) so the in-memory Supabase fake
 * needs no `.or` support. localStorage (jsdom) is the source of truth.
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
    is(col: string, val: unknown): this {
      this.filters.push([col, val]);
      return this;
    }
    or(_expr: string): this {
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

import type { ChecklistTemplateV2 } from "@/types";
import {
  migrateChecklistTemplates,
  shadowReadChecklistTemplates,
} from "./checklistTemplateMigration";

function globalTemplate(id: string, name = id): ChecklistTemplateV2 {
  return {
    id,
    companyId: null,
    scope: "global",
    name,
    categoryIds: [],
    floorPresetIds: [],
    sortOrder: 0,
    isArchived: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    originType: "global",
    version: 1,
    schemaVersion: 2,
  } as ChecklistTemplateV2;
}

function setLocal(templates: ChecklistTemplateV2[]): void {
  localStorage.setItem("cleanops.checklistTemplates", JSON.stringify(templates));
  localStorage.setItem("cleanops.checklistSections", JSON.stringify([]));
  localStorage.setItem("cleanops.checklistItems", JSON.stringify([]));
}

beforeEach(() => {
  mocks.client.reset();
  localStorage.clear();
});

describe("CHK-1 · migrateChecklistTemplates", () => {
  it("upserts global template aggregates (never skipped)", async () => {
    setLocal([globalTemplate("ctpl_a"), globalTemplate("ctpl_b")]);
    const report = await migrateChecklistTemplates();
    expect(report.ok).toBe(true);
    expect(report.writtenCount).toBe(2);
    expect(report.skipped).toHaveLength(0);
  });

  it("dry-run writes nothing", async () => {
    setLocal([globalTemplate("ctpl_a")]);
    const report = await migrateChecklistTemplates({ dryRun: true });
    expect(report.plannedCount).toBe(1);
    expect(report.writtenCount).toBe(0);
  });
});

describe("CHK-1 · shadowReadChecklistTemplates", () => {
  it("reports full parity after a clean migration", async () => {
    setLocal([globalTemplate("ctpl_a"), globalTemplate("ctpl_b")]);
    await migrateChecklistTemplates();
    const report = await shadowReadChecklistTemplates();
    expect(report.countMatch).toBe(true);
    expect(report.idsMatch).toBe(true);
    expect(report.detailMatch).toBe(true);
    expect(report.ok).toBe(true);
  });
});
