import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * TEAM-1 — Team migration + shadow-read parity.
 *
 * Drives the real `migrateTeams` / `shadowReadTeams` paths against an in-memory
 * Supabase fake, proving that:
 *   • migrate upserts the team rows (idempotent, legacy_id preserved),
 *   • a dry-run writes nothing,
 *   • a team whose company has no Supabase mapping is skipped + reported,
 *   • shadow-read reports parity (count / id / name / detail) after migration.
 *
 * localStorage is the source of truth; these utilities only populate + verify.
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

const storeMocks = vi.hoisted(() => ({ teams: [] as unknown[] }));
vi.mock("@/lib/store", () => ({
  getTeams: () => storeMocks.teams,
}));

import type { Team } from "@/types";
import { migrateTeams, shadowReadTeams } from "./teamMigration";

const NORDLYS = "cmp_nordlys";
const UUID = "00000000-0000-4000-8000-000000000000";

function seedCompanies(): void {
  mocks.client.tables.set("companies", [{ id: UUID, legacy_id: NORDLYS }]);
}

function team(id: string, name = id, companyId = NORDLYS): Team {
  return {
    id,
    companyId,
    name,
    description: `${name} desc`,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function teamRows(): Row[] {
  return mocks.client.tables.get("teams") ?? [];
}

beforeEach(() => {
  mocks.client.reset();
  storeMocks.teams = [];
});

describe("TEAM-1 · migrateTeams", () => {
  it("upserts team rows preserving legacy_id", async () => {
    seedCompanies();
    storeMocks.teams = [team("team_a"), team("team_b")];
    const report = await migrateTeams();
    expect(report.ok).toBe(true);
    expect(report.writtenCount).toBe(2);
    expect(teamRows().map((r) => r.legacy_id).sort()).toEqual(["team_a", "team_b"]);
  });

  it("dry-run writes nothing", async () => {
    seedCompanies();
    storeMocks.teams = [team("team_a")];
    const report = await migrateTeams({ dryRun: true });
    expect(report.plannedCount).toBe(1);
    expect(report.writtenCount).toBe(0);
    expect(teamRows()).toHaveLength(0);
  });

  it("skips a team whose company has no Supabase row", async () => {
    // No companies seeded.
    storeMocks.teams = [team("team_a")];
    const report = await migrateTeams();
    expect(report.ok).toBe(false);
    expect(report.skipped).toHaveLength(1);
    expect(teamRows()).toHaveLength(0);
  });
});

describe("TEAM-1 · shadowReadTeams", () => {
  it("reports full parity after a clean migration", async () => {
    seedCompanies();
    storeMocks.teams = [team("team_a"), team("team_b")];
    await migrateTeams();
    const report = await shadowReadTeams();
    expect(report.countMatch).toBe(true);
    expect(report.idsMatch).toBe(true);
    expect(report.summaryMatch).toBe(true);
    expect(report.detailMatch).toBe(true);
    expect(report.ok).toBe(true);
  });

  it("flags a count mismatch when Supabase is missing a team", async () => {
    seedCompanies();
    storeMocks.teams = [team("team_a"), team("team_b")];
    await migrateTeams();
    // Add a third team locally that was never migrated.
    storeMocks.teams = [...(storeMocks.teams as Team[]), team("team_c")];
    const report = await shadowReadTeams();
    expect(report.countMatch).toBe(false);
    expect(report.missingInSupabase).toContain("team_c");
    expect(report.ok).toBe(false);
  });
});
