import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * TEAM-3 — Team dual-write mirror.
 *
 * Drives the real `mirrorTeamWrites` path against an in-memory Supabase fake,
 * proving that:
 *   • a create mirrors the team row,
 *   • an update re-mirrors only the changed team,
 *   • repeated mirrors are idempotent (no duplicate rows),
 *   • a removal soft-deletes the Supabase row (removal propagation),
 *   • a noop (no prev→next change) performs no Supabase work,
 *   • a Supabase failure is recorded (localStorage already advanced).
 *
 * localStorage is the source of truth throughout — this helper only mirrors.
 */

type Row = Record<string, unknown>;

const mocks = vi.hoisted(() => {
  let failUpsertTable: string | null = null;

  class QueryBuilder {
    private filters: Array<[string, unknown]> = [];
    private inFilter: [string, unknown[]] | null = null;
    constructor(private rows: Row[]) {}
    eq(col: string, val: unknown): this {
      this.filters.push([col, val]);
      return this;
    }
    in(col: string, vals: unknown[]): Promise<{ error: null }> {
      // Only the update() path chains .in(); apply the pending patch.
      this.inFilter = [col, vals];
      return Promise.resolve({ error: null });
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

import type { Team } from "@/types";
import {
  mirrorTeamWrites,
  getTeamDualWriteState,
  resetTeamDualWriteState,
} from "./teamDualWrite";

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
  resetTeamDualWriteState();
});

describe("TEAM-3 · team dual write", () => {
  it("mirrors a new team on create", async () => {
    seedCompanies();
    const result = await mirrorTeamWrites([], [team("team_a")]);
    expect(result.ok).toBe(true);
    expect(result.mirrored).toBe(1);
    expect(teamRows()).toHaveLength(1);
    expect(teamRows()[0].legacy_id).toBe("team_a");
    expect(teamRows()[0].deleted_at).toBeNull();
  });

  it("is idempotent — repeated mirrors never duplicate rows", async () => {
    seedCompanies();
    const all = [team("team_a")];
    await mirrorTeamWrites([], all);
    await mirrorTeamWrites([], all);
    expect(teamRows()).toHaveLength(1);
  });

  it("re-mirrors only the changed team on update", async () => {
    seedCompanies();
    const before = [team("team_a"), team("team_b")];
    await mirrorTeamWrites([], before);
    resetTeamDualWriteState();
    const after = [team("team_a", "Renamed A"), team("team_b")];
    const result = await mirrorTeamWrites(before, after);
    expect(result.mirrored).toBe(1);
    expect(teamRows().find((r) => r.legacy_id === "team_a")?.name).toBe("Renamed A");
  });

  it("soft-deletes a removed team (removal propagation)", async () => {
    seedCompanies();
    const before = [team("team_a"), team("team_b")];
    await mirrorTeamWrites([], before);
    const after = [team("team_a")];
    const result = await mirrorTeamWrites(before, after);
    expect(result.removed).toBe(1);
    const removedRow = teamRows().find((r) => r.legacy_id === "team_b");
    expect(removedRow?.deleted_at).toBeTruthy();
  });

  it("noop — no prev→next change does no Supabase work", async () => {
    seedCompanies();
    const all = [team("team_a")];
    const result = await mirrorTeamWrites(all, all);
    expect(result.noop).toBe(true);
    expect(result.mirrored).toBe(0);
    expect(getTeamDualWriteState().noops).toBe(1);
  });

  it("records a failure when the upsert fails", async () => {
    seedCompanies();
    mocks.client.failOn("teams");
    const result = await mirrorTeamWrites([], [team("team_a")]);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("upsert failed");
    expect(getTeamDualWriteState().failures).toBeGreaterThan(0);
  });

  it("skips a team whose company has no Supabase mapping", async () => {
    // No companies seeded → no uuid.
    const result = await mirrorTeamWrites([], [team("team_a")]);
    expect(result.mirrored).toBe(0);
    expect(result.skipped).toHaveLength(1);
    expect(getTeamDualWriteState().skipped).toBe(1);
  });
});
