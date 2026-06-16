import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * MISSION-1 — Visit Occurrence migration + shadow-read parity. Drives the real
 * `migrateVisitOccurrences` / `shadowReadVisitOccurrences` paths against an
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

const storeMocks = vi.hoisted(() => ({ visits: [] as unknown[] }));
vi.mock("@/lib/visitOccurrenceStore", () => ({
  getAllVisitOccurrences: () => storeMocks.visits,
}));

import type { VisitOccurrence } from "@/types";
import {
  migrateVisitOccurrences,
  shadowReadVisitOccurrences,
} from "./visitOccurrenceMigration";

const NORDLYS = "cmp_nordlys";
const UUID = "00000000-0000-4000-8000-000000000000";

function seedCompanies(): void {
  mocks.client.tables.set("companies", [{ id: UUID, legacy_id: NORDLYS }]);
}

function visit(id: string, companyId = NORDLYS): VisitOccurrence {
  return {
    id,
    companyId,
    customerId: "cust_1",
    workOrderId: "wo_1",
    serviceRowId: "row_1",
    scheduledDate: "2026-06-15",
    status: "scheduled",
    schemaVersion: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function visitRows(): Row[] {
  return mocks.client.tables.get("visit_occurrences") ?? [];
}

beforeEach(() => {
  mocks.client.reset();
  storeMocks.visits = [];
});

describe("MISSION-1 · migrateVisitOccurrences", () => {
  it("upserts occurrence rows preserving legacy_id", async () => {
    seedCompanies();
    storeMocks.visits = [visit("visit_a"), visit("visit_b")];
    const report = await migrateVisitOccurrences();
    expect(report.ok).toBe(true);
    expect(report.writtenCount).toBe(2);
    expect(visitRows().map((r) => r.legacy_id).sort()).toEqual(["visit_a", "visit_b"]);
  });

  it("dry-run writes nothing", async () => {
    seedCompanies();
    storeMocks.visits = [visit("visit_a")];
    const report = await migrateVisitOccurrences({ dryRun: true });
    expect(report.plannedCount).toBe(1);
    expect(report.writtenCount).toBe(0);
    expect(visitRows()).toHaveLength(0);
  });

  it("skips an occurrence whose company has no Supabase row", async () => {
    storeMocks.visits = [visit("visit_a")];
    const report = await migrateVisitOccurrences();
    expect(report.ok).toBe(false);
    expect(report.skipped).toHaveLength(1);
    expect(visitRows()).toHaveLength(0);
  });
});

describe("MISSION-1 · shadowReadVisitOccurrences", () => {
  it("reports full parity after a clean migration", async () => {
    seedCompanies();
    storeMocks.visits = [visit("visit_a"), visit("visit_b")];
    await migrateVisitOccurrences();
    const report = await shadowReadVisitOccurrences();
    expect(report.countMatch).toBe(true);
    expect(report.idsMatch).toBe(true);
    expect(report.summaryMatch).toBe(true);
    expect(report.detailMatch).toBe(true);
    expect(report.ok).toBe(true);
  });

  it("flags a count mismatch when Supabase is missing an occurrence", async () => {
    seedCompanies();
    storeMocks.visits = [visit("visit_a"), visit("visit_b")];
    await migrateVisitOccurrences();
    storeMocks.visits = [...(storeMocks.visits as VisitOccurrence[]), visit("visit_c")];
    const report = await shadowReadVisitOccurrences();
    expect(report.countMatch).toBe(false);
    expect(report.missingInSupabase).toContain("visit_c");
    expect(report.ok).toBe(false);
  });
});
