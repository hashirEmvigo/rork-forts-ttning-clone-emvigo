import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * SVCCAT — Payroll Group dual-write mirror.
 *
 * Drives the real `mirrorPayrollGroupWrites` path against an in-memory Supabase
 * fake, proving create / global-row / idempotency / update / removal / noop /
 * failure / skip behaviour. localStorage is the source of truth.
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

import type { PayrollGroup } from "@/types";
import {
  mirrorPayrollGroupWrites,
  getPayrollGroupDualWriteState,
  resetPayrollGroupDualWriteState,
} from "./payrollGroupDualWrite";

const NORDLYS = "cmp_nordlys";
const UUID = "00000000-0000-4000-8000-000000000000";

function seedCompanies(): void {
  mocks.client.tables.set("companies", [{ id: UUID, legacy_id: NORDLYS }]);
}

function group(id: string, name = id, companyId: string | null = NORDLYS): PayrollGroup {
  return {
    id,
    companyId,
    name,
    groupType: "working_time",
    sortOrder: 0,
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function rows(): Row[] {
  return mocks.client.tables.get("payroll_groups") ?? [];
}

beforeEach(() => {
  mocks.client.reset();
  resetPayrollGroupDualWriteState();
});

describe("SVCCAT · payroll group dual write", () => {
  it("mirrors a new group on create", async () => {
    seedCompanies();
    const result = await mirrorPayrollGroupWrites([], [group("pg_a")]);
    expect(result.ok).toBe(true);
    expect(result.mirrored).toBe(1);
    expect(rows()).toHaveLength(1);
  });

  it("mirrors a GLOBAL group with company_id null (never skipped)", async () => {
    const result = await mirrorPayrollGroupWrites([], [group("pg_g", "Global", null)]);
    expect(result.ok).toBe(true);
    expect(result.skipped).toHaveLength(0);
    expect(rows()[0].company_id).toBeNull();
  });

  it("is idempotent", async () => {
    seedCompanies();
    const all = [group("pg_a")];
    await mirrorPayrollGroupWrites([], all);
    await mirrorPayrollGroupWrites([], all);
    expect(rows()).toHaveLength(1);
  });

  it("re-mirrors only the changed group on update", async () => {
    seedCompanies();
    const before = [group("pg_a"), group("pg_b")];
    await mirrorPayrollGroupWrites([], before);
    resetPayrollGroupDualWriteState();
    const after = [group("pg_a", "Renamed"), group("pg_b")];
    const result = await mirrorPayrollGroupWrites(before, after);
    expect(result.mirrored).toBe(1);
    expect(rows().find((r) => r.legacy_id === "pg_a")?.name).toBe("Renamed");
  });

  it("soft-deletes a removed group", async () => {
    seedCompanies();
    const before = [group("pg_a"), group("pg_b")];
    await mirrorPayrollGroupWrites([], before);
    const result = await mirrorPayrollGroupWrites(before, [group("pg_a")]);
    expect(result.removed).toBe(1);
    expect(rows().find((r) => r.legacy_id === "pg_b")?.deleted_at).toBeTruthy();
  });

  it("noop does no Supabase work", async () => {
    seedCompanies();
    const all = [group("pg_a")];
    const result = await mirrorPayrollGroupWrites(all, all);
    expect(result.noop).toBe(true);
    expect(getPayrollGroupDualWriteState().noops).toBe(1);
  });

  it("records a failure when the upsert fails", async () => {
    seedCompanies();
    mocks.client.failOn("payroll_groups");
    const result = await mirrorPayrollGroupWrites([], [group("pg_a")]);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("upsert failed");
  });

  it("skips a company group with no Supabase mapping", async () => {
    const result = await mirrorPayrollGroupWrites([], [group("pg_a")]);
    expect(result.mirrored).toBe(0);
    expect(result.skipped).toHaveLength(1);
  });

  it("company writer skips a global row but still upserts its own company row", async () => {
    seedCompanies();
    const result = await mirrorPayrollGroupWrites(
      [],
      [group("pg_global", "Global", null), group("pg_company")],
      { companyId: NORDLYS, isSuperAdmin: false },
    );
    expect(rows().map((r) => r.legacy_id)).toEqual(["pg_company"]);
    expect(result.mirrored).toBe(1);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].id).toBe("pg_global");
    expect(getPayrollGroupDualWriteState().failures).toBe(0);
    expect(getPayrollGroupDualWriteState().created).toBe(1);
  });

  it("super_admin writer still mirrors global rows", async () => {
    const result = await mirrorPayrollGroupWrites(
      [],
      [group("pg_global", "Global", null)],
      { companyId: null, isSuperAdmin: true },
    );
    expect(result.ok).toBe(true);
    expect(result.mirrored).toBe(1);
    expect(result.skipped).toHaveLength(0);
    expect(rows()[0].company_id).toBeNull();
  });
});
