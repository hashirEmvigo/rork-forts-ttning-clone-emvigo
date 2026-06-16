import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * EMP-4 — Employee dual-write mirror.
 *
 * Drives the real `mirrorEmployeeWrites` path against an in-memory Supabase fake,
 * proving that:
 *   • a create mirrors the employee row,
 *   • an update re-mirrors only the changed employee with normalized fields,
 *   • an archive mirrors status=inactive + archivedAt as an update,
 *   • a delete soft-deletes the Supabase row (removal propagation),
 *   • repeated mirrors are idempotent (no duplicate rows),
 *   • a noop (no prev→next change) performs no Supabase work,
 *   • a Supabase failure is recorded (localStorage already advanced),
 *   • a company with no Supabase mapping is skipped (never throws),
 *   • empty-string optional refs are normalized to null (no bad rows),
 *   • company scoping is preserved.
 *
 * localStorage is the source of truth throughout — this helper only mirrors.
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

import type { Employee } from "@/types";
import {
  mirrorEmployeeWrites,
  getEmployeeDualWriteState,
  resetEmployeeDualWriteState,
} from "./employeeDualWrite";

const NORDLYS = "cmp_nordlys";
const OTHER = "cmp_other";
const UUID_NORDLYS = "00000000-0000-4000-8000-000000000000";
const UUID_OTHER = "00000000-0000-4000-8000-000000000001";

function seedCompanies(): void {
  mocks.client.tables.set("companies", [
    { id: UUID_NORDLYS, legacy_id: NORDLYS },
    { id: UUID_OTHER, legacy_id: OTHER },
  ]);
}

function employee(id: string, overrides: Partial<Employee> = {}): Employee {
  return {
    id,
    companyId: NORDLYS,
    name: id,
    email: `${id}@example.com`,
    status: "active",
    teamIds: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function employeeRows(): Row[] {
  return mocks.client.tables.get("employees") ?? [];
}

beforeEach(() => {
  mocks.client.reset();
  resetEmployeeDualWriteState();
});

describe("EMP-4 · employee dual write", () => {
  it("mirrors a new employee on create", async () => {
    seedCompanies();
    const result = await mirrorEmployeeWrites([], [employee("emp_a")]);
    expect(result.ok).toBe(true);
    expect(result.mirrored).toBe(1);
    expect(employeeRows()).toHaveLength(1);
    expect(employeeRows()[0].legacy_id).toBe("emp_a");
    expect(employeeRows()[0].company_legacy_id).toBe(NORDLYS);
    expect(employeeRows()[0].deleted_at).toBeNull();
  });

  it("is idempotent — repeated mirrors never duplicate rows", async () => {
    seedCompanies();
    const all = [employee("emp_a")];
    await mirrorEmployeeWrites([], all);
    await mirrorEmployeeWrites([], all);
    expect(employeeRows()).toHaveLength(1);
  });

  it("re-mirrors only the changed employee on update", async () => {
    seedCompanies();
    const before = [employee("emp_a"), employee("emp_b")];
    await mirrorEmployeeWrites([], before);
    resetEmployeeDualWriteState();
    const after = [employee("emp_a", { name: "Renamed A" }), employee("emp_b")];
    const result = await mirrorEmployeeWrites(before, after);
    expect(result.mirrored).toBe(1);
    expect(result.diff.updated).toEqual(["emp_a"]);
    expect(employeeRows().find((r) => r.legacy_id === "emp_a")?.name).toBe("Renamed A");
  });

  it("mirrors an archive as a status=inactive update", async () => {
    seedCompanies();
    const before = [employee("emp_a")];
    await mirrorEmployeeWrites([], before);
    const after = [
      employee("emp_a", { status: "inactive", archivedAt: "2026-02-01T00:00:00.000Z" }),
    ];
    const result = await mirrorEmployeeWrites(before, after);
    expect(result.mirrored).toBe(1);
    const row = employeeRows().find((r) => r.legacy_id === "emp_a");
    expect(row?.status).toBe("inactive");
    expect(row?.deleted_at).toBeNull();
    expect((row?.data as Employee).archivedAt).toBe("2026-02-01T00:00:00.000Z");
  });

  it("soft-deletes a removed (deleted) employee (removal propagation)", async () => {
    seedCompanies();
    const before = [employee("emp_a"), employee("emp_b")];
    await mirrorEmployeeWrites([], before);
    const after = [employee("emp_a")];
    const result = await mirrorEmployeeWrites(before, after);
    expect(result.removed).toBe(1);
    const removedRow = employeeRows().find((r) => r.legacy_id === "emp_b");
    expect(removedRow?.deleted_at).toBeTruthy();
  });

  it("normalizes empty-string optional refs to null (no bad rows)", async () => {
    seedCompanies();
    const emp = employee("emp_a", {
      title: "",
      userId: "",
      postalCityId: "",
      languageId: "",
    });
    const result = await mirrorEmployeeWrites([], [emp]);
    expect(result.ok).toBe(true);
    const row = employeeRows()[0];
    expect(row.title).toBeNull();
    expect(row.user_legacy_id).toBeNull();
    expect(row.postal_city_id).toBeNull();
    expect(row.language_id).toBeNull();
  });

  it("noop — no prev→next change does no Supabase work", async () => {
    seedCompanies();
    const all = [employee("emp_a")];
    const result = await mirrorEmployeeWrites(all, all);
    expect(result.noop).toBe(true);
    expect(result.mirrored).toBe(0);
    expect(getEmployeeDualWriteState().noops).toBe(1);
  });

  it("records a failure when the upsert fails (localStorage already advanced)", async () => {
    seedCompanies();
    mocks.client.failOn("employees");
    const result = await mirrorEmployeeWrites([], [employee("emp_a")]);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("upsert failed");
    expect(getEmployeeDualWriteState().failures).toBeGreaterThan(0);
  });

  it("skips an employee whose company has no Supabase mapping", async () => {
    // No companies seeded → no uuid.
    const result = await mirrorEmployeeWrites([], [employee("emp_a")]);
    expect(result.mirrored).toBe(0);
    expect(result.skipped).toHaveLength(1);
    expect(getEmployeeDualWriteState().skipped).toBe(1);
  });

  it("preserves company scoping (each row carries its own company)", async () => {
    seedCompanies();
    const result = await mirrorEmployeeWrites(
      [],
      [employee("emp_a", { companyId: NORDLYS }), employee("emp_b", { companyId: OTHER })],
    );
    expect(result.mirrored).toBe(2);
    expect(employeeRows().find((r) => r.legacy_id === "emp_a")?.company_id).toBe(UUID_NORDLYS);
    expect(employeeRows().find((r) => r.legacy_id === "emp_b")?.company_id).toBe(UUID_OTHER);
  });
});
