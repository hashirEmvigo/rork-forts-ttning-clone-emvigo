import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * TIMECODE-3 — Time Code dual-write mirror.
 *
 * Drives the real `mirrorTimeCodeWrites` path against an in-memory Supabase fake,
 * proving the write path is Supabase-authoritative and lands the SAME shape the
 * live `time_codes` table now carries (migration 0052: `data` jsonb + `deleted_at`):
 *   • create  → mirrors a GLOBAL master code (company_id null) with `data` +
 *     `deleted_at: null` and the flat summary columns,
 *   • edit    → re-mirrors only the changed code (name carried losslessly in `data`),
 *   • archive → `active: false` lands in BOTH the flat column and `data`,
 *   • restore → `active: true` lands in BOTH the flat column and `data`,
 *   • delete  → removal soft-deletes the Supabase row (`deleted_at` set),
 *   • idempotent — repeated mirrors never duplicate rows,
 *   • no localStorage authority — the mirror reads/writes Supabase only; the
 *     browser store is never touched by this path.
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

import type { TimeCode } from "@/types";
import {
  mirrorTimeCodeWrites,
  getTimeCodeDualWriteState,
  resetTimeCodeDualWriteState,
} from "./timeCodeDualWrite";

const TIME_CODES_LS_KEY = "cleanops.timeCodes";

/** A GLOBAL master code (companyId null) — the only scope Time Codes seeds today. */
function code(id: string, codeValue: string, overrides: Partial<TimeCode> = {}): TimeCode {
  return {
    id,
    companyId: null,
    code: codeValue,
    name: `Code ${codeValue}`,
    type: "attendance",
    description: undefined,
    active: true,
    systemManaged: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function timeCodeRows(): Row[] {
  return mocks.client.tables.get("time_codes") ?? [];
}

beforeEach(() => {
  mocks.client.reset();
  resetTimeCodeDualWriteState();
  localStorage.clear();
});

describe("TIMECODE-3 · time-code dual write", () => {
  it("mirrors a new GLOBAL master code with data + deleted_at null (create)", async () => {
    const result = await mirrorTimeCodeWrites([], [code("tc_master_10", "10")]);
    expect(result.ok).toBe(true);
    expect(result.mirrored).toBe(1);
    expect(result.skipped).toHaveLength(0);

    const row = timeCodeRows()[0];
    expect(row.legacy_id).toBe("tc_master_10");
    expect(row.company_id).toBeNull();
    expect(row.code).toBe("10");
    expect(row.active).toBe(true);
    expect(row.system_managed).toBe(true);
    expect(row.deleted_at).toBeNull();
    // The lossless full record lands in `data` (what the read path returns).
    expect((row.data as TimeCode).id).toBe("tc_master_10");
    expect((row.data as TimeCode).name).toBe("Code 10");
  });

  it("re-mirrors only the edited code, carrying the new name in data (edit)", async () => {
    const before = [code("tc_master_10", "10"), code("tc_master_385", "385")];
    await mirrorTimeCodeWrites([], before);
    resetTimeCodeDualWriteState();

    const after = [
      code("tc_master_10", "10", { name: "Worked Time (renamed)" }),
      code("tc_master_385", "385"),
    ];
    const result = await mirrorTimeCodeWrites(before, after);
    expect(result.mirrored).toBe(1);
    const row = timeCodeRows().find((r) => r.legacy_id === "tc_master_10");
    expect((row?.data as TimeCode).name).toBe("Worked Time (renamed)");
  });

  it("archives a code — active false lands in the column AND data (archive)", async () => {
    const before = [code("tc_master_10", "10", { active: true })];
    await mirrorTimeCodeWrites([], before);

    const after = [code("tc_master_10", "10", { active: false })];
    const result = await mirrorTimeCodeWrites(before, after);
    expect(result.ok).toBe(true);

    const row = timeCodeRows().find((r) => r.legacy_id === "tc_master_10");
    expect(row?.active).toBe(false);
    expect((row?.data as TimeCode).active).toBe(false);
    expect(row?.deleted_at).toBeNull();
  });

  it("restores an archived code — active true again (restore)", async () => {
    const archived = [code("tc_master_10", "10", { active: false })];
    await mirrorTimeCodeWrites([], archived);

    const restored = [code("tc_master_10", "10", { active: true })];
    const result = await mirrorTimeCodeWrites(archived, restored);
    expect(result.ok).toBe(true);

    const row = timeCodeRows().find((r) => r.legacy_id === "tc_master_10");
    expect(row?.active).toBe(true);
    expect((row?.data as TimeCode).active).toBe(true);
  });

  it("soft-deletes a removed code (delete → deleted_at set)", async () => {
    const before = [code("tc_custom_900", "900", { systemManaged: false })];
    await mirrorTimeCodeWrites([], before);

    const result = await mirrorTimeCodeWrites(before, []);
    expect(result.removed).toBe(1);
    const row = timeCodeRows().find((r) => r.legacy_id === "tc_custom_900");
    expect(row?.deleted_at).toBeTruthy();
  });

  it("is idempotent — repeated mirrors never duplicate rows", async () => {
    const all = [code("tc_master_10", "10")];
    await mirrorTimeCodeWrites([], all);
    await mirrorTimeCodeWrites([], all);
    expect(timeCodeRows()).toHaveLength(1);
  });

  it("does NOT use localStorage authority — the mirror only touches Supabase", async () => {
    expect(localStorage.getItem(TIME_CODES_LS_KEY)).toBeNull();
    await mirrorTimeCodeWrites([], [code("tc_master_10", "10")]);
    // The authoritative row lives in Supabase; the mirror never writes the store.
    expect(timeCodeRows()).toHaveLength(1);
    expect(localStorage.getItem(TIME_CODES_LS_KEY)).toBeNull();
  });

  it("noop — no prev→next change does no Supabase work", async () => {
    const all = [code("tc_master_10", "10")];
    const result = await mirrorTimeCodeWrites(all, all);
    expect(result.noop).toBe(true);
    expect(result.mirrored).toBe(0);
    expect(getTimeCodeDualWriteState().noops).toBe(1);
  });
});
