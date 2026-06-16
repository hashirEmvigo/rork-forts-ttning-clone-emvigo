/**
 * TIMECODE-5 — authoritative Time Code write repository.
 *
 * Proves the live bug fix: create / edit / archive / restore / delete each commit
 * DIRECTLY to the Supabase `time_codes` table, and a SUBSEQUENT read (the
 * "hard refresh" the directory performs via {@link listFullTimeCodesFromSupabase})
 * reflects the true persisted state. There is NO localStorage authority on this
 * path and a write that affects 0 rows (RLS-blocked / not found) REJECTS rather
 * than reporting a silent success.
 *
 * Driven against an in-memory Supabase fake that honours the exact chains the
 * repository uses: `insert(row).select("data").single()` and
 * `update(patch).eq(...).is("deleted_at", null).select(...)`, plus the unique
 * `legacy_id` constraint and `deleted_at` soft-delete filtering.
 */

type Row = Record<string, unknown>;
type Result = { data: Row[]; error: { message: string } | null };

const mocks = vi.hoisted(() => {
  class TableOp {
    private filters: Array<[string, unknown]> = [];
    private op: "select" | "insert" | "update" = "select";
    private payload: Row | null = null;
    private cols: string | null = null;
    constructor(private rows: Row[]) {}

    insert(row: Row): this {
      this.op = "insert";
      this.payload = row;
      return this;
    }
    update(patch: Row): this {
      this.op = "update";
      this.payload = patch;
      return this;
    }
    select(cols?: string): this {
      this.cols = cols ?? "*";
      return this;
    }
    eq(col: string, val: unknown): this {
      this.filters.push([col, val]);
      return this;
    }
    is(col: string, val: unknown): this {
      this.filters.push([col, val]);
      return this;
    }
    /** No-op scope OR filter (unscoped reads only in these tests). */
    or(): this {
      return this;
    }

    private matches(r: Row): boolean {
      return this.filters.every(([c, v]) => (r[c] ?? null) === v);
    }

    private project(rows: Row[]): Row[] {
      if (!this.cols || this.cols === "*") return rows.map((r) => ({ ...r }));
      const keys = this.cols.split(",").map((c) => c.trim());
      return rows.map((r) => {
        const out: Row = {};
        for (const k of keys) out[k] = r[k];
        return out;
      });
    }

    private execute(): Result {
      if (this.op === "insert" && this.payload) {
        const row = this.payload;
        if (this.rows.some((r) => r.legacy_id === row.legacy_id)) {
          return { data: [], error: { message: `duplicate legacy_id ${String(row.legacy_id)}` } };
        }
        this.rows.push({ ...row });
        return { data: this.project([row]), error: null };
      }
      if (this.op === "update" && this.payload) {
        const affected: Row[] = [];
        for (const r of this.rows) {
          if (this.matches(r)) {
            Object.assign(r, this.payload);
            affected.push(r);
          }
        }
        return { data: this.project(affected), error: null };
      }
      return { data: this.project(this.rows.filter((r) => this.matches(r))), error: null };
    }

    single(): Promise<{ data: Row | null; error: { message: string } | null }> {
      const { data, error } = this.execute();
      if (error) return Promise.resolve({ data: null, error });
      return Promise.resolve({ data: data[0] ?? null, error: null });
    }

    then<R>(onFulfilled: (res: Result) => R): Promise<R> {
      return Promise.resolve(this.execute()).then(onFulfilled);
    }
  }

  class FakeClient {
    tables = new Map<string, Row[]>();
    private table(name: string): Row[] {
      if (!this.tables.has(name)) this.tables.set(name, []);
      return this.tables.get(name) as Row[];
    }
    from(name: string) {
      return new TableOp(this.table(name));
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

import type { TimeCode } from "@/types";
import {
  createTimeCodeInSupabase,
  updateTimeCodeInSupabase,
  softDeleteTimeCodeInSupabase,
  listFullTimeCodesFromSupabase,
} from "./supabaseTimeCodeRepository";

const TIME_CODES_LS_KEY = "cleanops.timeCodes";

function code(id: string, codeValue: string, overrides: Partial<TimeCode> = {}): TimeCode {
  return {
    id,
    companyId: null,
    code: codeValue,
    name: `Code ${codeValue}`,
    type: "attendance",
    description: undefined,
    active: true,
    systemManaged: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function rows(): Row[] {
  return mocks.client.tables.get("time_codes") ?? [];
}

beforeEach(() => {
  mocks.client.reset();
  localStorage.clear();
});

describe("TIMECODE-5 · authoritative time-code writes", () => {
  it("create persists to Supabase and survives a re-read (hard refresh)", async () => {
    await createTimeCodeInSupabase(code("tc_x1", "900", { name: "Standby" }));

    const row = rows()[0];
    expect(row.legacy_id).toBe("tc_x1");
    expect(row.company_id).toBeNull();
    expect(row.name).toBe("Standby");
    expect(row.deleted_at).toBeNull();

    // Re-read the way the directory does after a refresh.
    const after = await listFullTimeCodesFromSupabase();
    expect(after.map((c) => c.id)).toContain("tc_x1");
    expect(after.find((c) => c.id === "tc_x1")?.name).toBe("Standby");
  });

  it("edit persists the new name in BOTH the flat column and data", async () => {
    await createTimeCodeInSupabase(code("tc_x1", "900", { name: "Standby" }));
    await updateTimeCodeInSupabase(code("tc_x1", "900", { name: "Standby (renamed)" }));

    const row = rows().find((r) => r.legacy_id === "tc_x1");
    expect(row?.name).toBe("Standby (renamed)");
    expect((row?.data as TimeCode).name).toBe("Standby (renamed)");

    const after = await listFullTimeCodesFromSupabase();
    expect(after.find((c) => c.id === "tc_x1")?.name).toBe("Standby (renamed)");
  });

  it("archive then restore persists active=false then active=true after re-read", async () => {
    await createTimeCodeInSupabase(code("tc_x1", "900", { active: true }));

    await updateTimeCodeInSupabase(code("tc_x1", "900", { active: false }));
    let after = await listFullTimeCodesFromSupabase();
    expect(after.find((c) => c.id === "tc_x1")?.active).toBe(false);
    expect(rows().find((r) => r.legacy_id === "tc_x1")?.active).toBe(false);

    await updateTimeCodeInSupabase(code("tc_x1", "900", { active: true }));
    after = await listFullTimeCodesFromSupabase();
    expect(after.find((c) => c.id === "tc_x1")?.active).toBe(true);
  });

  it("soft-delete sets deleted_at and the code disappears from a re-read", async () => {
    await createTimeCodeInSupabase(code("tc_x1", "900"));
    await softDeleteTimeCodeInSupabase("tc_x1");

    const row = rows().find((r) => r.legacy_id === "tc_x1");
    expect(row?.deleted_at).toBeTruthy();

    const after = await listFullTimeCodesFromSupabase();
    expect(after.map((c) => c.id)).not.toContain("tc_x1");
  });

  it("rejects an update that affects 0 rows (RLS-blocked / not found) — never a silent no-op", async () => {
    await expect(updateTimeCodeInSupabase(code("tc_missing", "999"))).rejects.toThrow(
      /0 rows/,
    );
  });

  it("rejects updating a soft-deleted code (deleted_at filter excludes it)", async () => {
    await createTimeCodeInSupabase(code("tc_x1", "900"));
    await softDeleteTimeCodeInSupabase("tc_x1");
    await expect(updateTimeCodeInSupabase(code("tc_x1", "900"))).rejects.toThrow(/0 rows/);
  });

  it("rejects a repeated delete (already soft-deleted) instead of false success", async () => {
    await createTimeCodeInSupabase(code("tc_x1", "900"));
    await softDeleteTimeCodeInSupabase("tc_x1");
    await expect(softDeleteTimeCodeInSupabase("tc_x1")).rejects.toThrow(/0 rows/);
  });

  it("rejects a company-scoped write up-front (global master library only)", async () => {
    await expect(
      createTimeCodeInSupabase(code("tc_c1", "900", { companyId: "cmp_x" })),
    ).rejects.toThrow(/Company-scoped/);
  });

  it("does NOT use localStorage authority — writes only touch Supabase", async () => {
    expect(localStorage.getItem(TIME_CODES_LS_KEY)).toBeNull();
    await createTimeCodeInSupabase(code("tc_x1", "900"));
    await updateTimeCodeInSupabase(code("tc_x1", "900", { name: "Edited" }));
    await softDeleteTimeCodeInSupabase("tc_x1");
    // Authoritative state lives in Supabase; the store is never written.
    expect(localStorage.getItem(TIME_CODES_LS_KEY)).toBeNull();
  });
});
