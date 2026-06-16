import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * P7C — EMP-1: Employee Supabase schema, read repository & shadow read.
 *
 * Drives the REAL migration + shadow-read + repository code paths
 * (`migrateEmployees`, `shadowReadEmployees`, `supabaseEmployeeRepository`)
 * against an in-memory Supabase fake. A live Supabase project requires an
 * authenticated browser session and cannot run in CI, so the fake reproduces the
 * exact query-builder surface those modules use (`from().select().eq()
 * .maybeSingle()` and `from().upsert(rows, { onConflict })`) and the RLS-style
 * company scoping the repository relies on.
 *
 * What this proves, automatically and repeatably:
 *   • migration execution (single table) + structured report
 *   • company (legacy_id → uuid) mapping with no orphans
 *   • legacy_id preserved verbatim (the id-stability guarantee)
 *   • shadow-read parity: count / id / summary (teamCount + hasLogin) / detail
 *   • search + pagination parity
 *   • status coverage (inactive employees not dropped)
 *   • idempotency (run twice → no inflation, no duplicates)
 *   • query-layer company scoping (foreign company sees nothing)
 *   • soft-delete rows are filtered out of reads (WO-5.6 convention)
 *
 * DB-level RLS (migration 0010 policies) is enforced server-side and must be
 * confirmed once against the live project; the query-layer scope verified here
 * is the client contract those policies mirror.
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
    upsertCalls = 0;
    private numberSeries = new Map<string, number>();
    private table(name: string): Row[] {
      if (!this.tables.has(name)) this.tables.set(name, []);
      return this.tables.get(name) as Row[];
    }
    rpc(fn: string, args: Record<string, unknown>) {
      if (fn === "allocate_number") {
        const key = `${String(args.p_company_scope)}:${String(args.p_entity_kind)}`;
        const next = (this.numberSeries.get(key) ?? 0) + 1;
        this.numberSeries.set(key, next);
        return Promise.resolve({ data: next, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    }
    from(name: string) {
      const rows = this.table(name);
      return {
        select: (_cols?: string) => new QueryBuilder(rows),
        upsert: (incoming: Row[], opts: { onConflict: string }) => {
          this.upsertCalls += 1;
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
      this.upsertCalls = 0;
      this.numberSeries.clear();
    }
  }

  return { client: new FakeClient() };
});

vi.mock("@/lib/supabase", () => ({
  supabase: mocks.client,
  isSupabaseConfigured: true,
}));

import { getEmployees, saveEmployees } from "@/lib/store";
import type { Employee } from "@/types";
import { localDataLayer } from "./localStorageAdapters";
import { supabaseEmployeeRepository } from "./supabaseEmployeeRepository";
import { migrateEmployees, shadowReadEmployees, inspectEmployeeBackfill } from "./employeeMigration";
import {
  createEmployeeInSupabase,
  listFullEmployeesFromSupabase,
  updateEmployeeInSupabase,
} from "./supabaseEmployeeRepository";

const NORDLYS = "cmp_nordlys";
const OTHER = "cmp_other";

function makeEmployee(overrides: Partial<Employee> & Pick<Employee, "id">): Employee {
  return {
    companyId: NORDLYS,
    name: "Test Employee",
    email: `${overrides.id}@example.com`,
    title: "Cleaner",
    status: "active",
    teamIds: [],
    userId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/** Seeds a deterministic, parity-meaningful employee fixture. */
function seedFixture(): Employee[] {
  const fixture: Employee[] = [
    makeEmployee({
      id: "emp_active",
      name: "Astrid Holm",
      teamIds: ["team_a", "team_b"],
      userId: "usr_1",
      title: "Team Lead",
      postalCityId: "pc_1",
      languageId: "lang_no",
      workingSchedule: [
        { weekday: "monday", isAvailable: true, startTime: "08:00", endTime: "16:00", breakMinutes: 30 },
      ],
    }),
    makeEmployee({ id: "emp_inactive", name: "Bjorn Vik", status: "inactive", teamIds: ["team_a"] }),
    makeEmployee({ id: "emp_other", name: "Cilla Berg", companyId: OTHER }),
  ];
  saveEmployees(fixture);
  return fixture;
}

/** Seeds the fake `companies` table with a uuid for every employee company id. */
function seedCompanies(companyIds?: string[]): Map<string, string> {
  const legacyIds = companyIds ?? Array.from(new Set(getEmployees().map((e) => e.companyId)));
  const map = new Map<string, string>();
  const rows: Row[] = legacyIds.map((legacy, i) => {
    const uuid = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
    map.set(legacy, uuid);
    return { id: uuid, legacy_id: legacy };
  });
  mocks.client.tables.set("companies", rows);
  return map;
}

beforeEach(() => {
  localStorage.clear();
  mocks.client.reset();
});

// ── Migration execution ───────────────────────────────────
describe("EMP-1 · migration execution", () => {
  it("dry-run plans every employee and writes nothing", async () => {
    seedFixture();
    seedCompanies();
    const source = getEmployees();
    const report = await migrateEmployees({ dryRun: true });

    expect(report.ok).toBe(true);
    expect(report.dryRun).toBe(true);
    expect(report.sourceCount).toBe(source.length);
    expect(report.plannedCount).toBe(source.length);
    expect(report.writtenCount).toBe(0);
    expect(report.skipped).toEqual([]);
    expect(mocks.client.tables.get("employees") ?? []).toHaveLength(0);
  });

  it("executes the migration and preserves legacy_id + full payload", async () => {
    seedFixture();
    seedCompanies();
    const source = getEmployees();
    const report = await migrateEmployees();

    expect(report.ok).toBe(true);
    expect(report.writtenCount).toBe(source.length);
    expect(report.skipped).toEqual([]);

    const rows = mocks.client.tables.get("employees") ?? [];
    expect(rows).toHaveLength(source.length);
    const active = rows.find((r) => r.legacy_id === "emp_active");
    expect(active?.legacy_id).toBe("emp_active");
    expect(active?.user_legacy_id).toBe("usr_1");
    expect(active?.team_ids).toEqual(["team_a", "team_b"]);
    expect(active?.deleted_at).toBeNull();
    expect((active?.data as Employee).workingSchedule?.length).toBe(1);
  });

  it("skips (does not throw) employees whose company has no Supabase row", async () => {
    seedFixture();
    const report = await migrateEmployees();
    expect(report.ok).toBe(false);
    expect(report.writtenCount).toBe(0);
    expect(report.skipped.length).toBe(report.sourceCount);
    expect(report.skipped[0]?.reason).toContain("Migrate companies first");
  });

  it("is idempotent — running twice does not inflate or duplicate rows", async () => {
    seedFixture();
    seedCompanies();
    const first = await migrateEmployees();
    const second = await migrateEmployees();
    expect(first.writtenCount).toBe(second.writtenCount);
    expect(mocks.client.tables.get("employees") ?? []).toHaveLength(getEmployees().length);
  });

  it("surfaces per-company duplicate emails without blocking", async () => {
    saveEmployees([
      makeEmployee({ id: "emp_dup_1", email: "dupe@example.com" }),
      makeEmployee({ id: "emp_dup_2", email: "DUPE@example.com" }),
    ]);
    seedCompanies();
    const report = await migrateEmployees();
    expect(report.ok).toBe(true);
    expect(report.duplicateEmails).toHaveLength(1);
    expect(report.duplicateEmails[0]?.ids.sort()).toEqual(["emp_dup_1", "emp_dup_2"]);
  });
});

// ── Shadow-read parity ────────────────────────────────────
describe("EMP-1 · shadow-read parity", () => {
  it("reports full parity after migration (count / ids / summary / detail)", async () => {
    seedFixture();
    seedCompanies();
    await migrateEmployees();
    const report = await shadowReadEmployees();

    expect(report.countMatch).toBe(true);
    expect(report.idsMatch).toBe(true);
    expect(report.summaryMatch).toBe(true);
    expect(report.detailMatch).toBe(true);
    expect(report.ok).toBe(true);
    expect(report.notes).toEqual([]);
  });

  it("scopes to a single company (foreign rows excluded)", async () => {
    seedFixture();
    seedCompanies();
    await migrateEmployees();
    const report = await shadowReadEmployees(NORDLYS);
    expect(report.companyId).toBe(NORDLYS);
    expect(report.ok).toBe(true);
    expect(report.localCount).toBe(2);
    expect(report.supabaseCount).toBe(2);
  });

  it("flags missing rows before migration completes", async () => {
    seedFixture();
    seedCompanies();
    const report = await shadowReadEmployees(NORDLYS);
    expect(report.ok).toBe(false);
    expect(report.missingInSupabase.length).toBeGreaterThan(0);
  });
});

// ── Backfill preflight inspection (EMP-4 operational surface) ──
describe("EMP-4 · inspectEmployeeBackfill", () => {
  it("flags companies as not_backfilled before migration", async () => {
    seedFixture();
    seedCompanies();
    const report = await inspectEmployeeBackfill();

    expect(report.supabaseConfigured).toBe(true);
    expect(report.ok).toBe(false);
    expect(report.totals.localCount).toBe(3);
    expect(report.totals.supabaseActiveCount).toBe(0);

    const nordlys = report.companies.find((c) => c.companyId === NORDLYS);
    expect(nordlys?.mapped).toBe(true);
    expect(nordlys?.localCount).toBe(2);
    expect(nordlys?.supabaseActiveCount).toBe(0);
    expect(nordlys?.status).toBe("not_backfilled");
  });

  it("reports parity_ok for every company after a full backfill", async () => {
    seedFixture();
    seedCompanies();
    await migrateEmployees();
    const report = await inspectEmployeeBackfill();

    expect(report.ok).toBe(true);
    expect(report.totals.supabaseActiveCount).toBe(3);
    expect(report.companies.every((c) => c.status === "parity_ok")).toBe(true);
  });

  it("counts soft-deleted rows separately and does not treat them as active", async () => {
    seedFixture();
    seedCompanies();
    await migrateEmployees();

    const rows = mocks.client.tables.get("employees") ?? [];
    const target = rows.find((r) => r.legacy_id === "emp_inactive");
    if (target) target.deleted_at = "2026-02-01T00:00:00.000Z";

    const report = await inspectEmployeeBackfill();
    const nordlys = report.companies.find((c) => c.companyId === NORDLYS);
    expect(nordlys?.supabaseActiveCount).toBe(1);
    expect(nordlys?.supabaseDeletedCount).toBe(1);
    // 1 active vs 2 local → partially backfilled.
    expect(nordlys?.status).toBe("partially_backfilled");
    expect(report.totals.supabaseDeletedCount).toBe(1);
  });

  it("flags companies with no Supabase mapping as unmapped", async () => {
    seedFixture();
    // No companies seeded → nothing maps.
    const report = await inspectEmployeeBackfill();
    expect(report.companies.every((c) => c.status === "unmapped")).toBe(true);
    expect(report.ok).toBe(false);
  });

  it("detects extra/stale Supabase rows as a mismatch", async () => {
    seedFixture();
    seedCompanies();
    await migrateEmployees();
    // Simulate a stale Supabase row with no local counterpart.
    const rows = mocks.client.tables.get("employees") ?? [];
    rows.push({ legacy_id: "emp_ghost", company_legacy_id: NORDLYS, deleted_at: null });

    const report = await inspectEmployeeBackfill();
    const nordlys = report.companies.find((c) => c.companyId === NORDLYS);
    expect(nordlys?.supabaseActiveCount).toBe(3);
    expect(nordlys?.localCount).toBe(2);
    expect(nordlys?.status).toBe("mismatch");
  });
});

// ── Repository parity (summary / detail / search / count) ──
describe("EMP-A1 · Supabase employee authoritative writes", () => {
  it("creates an employee through Supabase only without browser storage", async () => {
    seedCompanies([NORDLYS]);
    const getItemSpy = vi.spyOn(Storage.prototype, "getItem");
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    const sessionGetSpy = vi.spyOn(sessionStorage, "getItem");
    const sessionSetSpy = vi.spyOn(sessionStorage, "setItem");

    const created = await createEmployeeInSupabase({
      companyId: NORDLYS,
      name: "  Nora Nyberg  ",
      email: "  nora@example.com  ",
      title: "  Cleaner  ",
      teamIds: ["team_a"],
      userId: null,
    });

    expect(created).toEqual(
      expect.objectContaining({
        companyId: NORDLYS,
        name: "Nora Nyberg",
        email: "nora@example.com",
        title: "Cleaner",
        status: "active",
        teamIds: ["team_a"],
        userId: null,
      }),
    );
    const rows = mocks.client.tables.get("employees") ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        legacy_id: created.id,
        company_legacy_id: NORDLYS,
        name: "Nora Nyberg",
        email: "nora@example.com",
        deleted_at: null,
      }),
    );
    expect((rows[0]?.data as Employee).name).toBe("Nora Nyberg");
    expect(getItemSpy).not.toHaveBeenCalled();
    expect(setItemSpy).not.toHaveBeenCalled();
    expect(sessionGetSpy).not.toHaveBeenCalled();
    expect(sessionSetSpy).not.toHaveBeenCalled();
  });

  it("updates an employee through Supabase only and preserves row identity", async () => {
    seedCompanies([NORDLYS]);
    const created = await createEmployeeInSupabase({
      companyId: NORDLYS,
      name: "Edit Me",
      email: "edit@example.com",
      teamIds: [],
    });
    const getItemSpy = vi.spyOn(Storage.prototype, "getItem");
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");

    const updated = await updateEmployeeInSupabase(NORDLYS, created.id, {
      name: "Edited Employee",
      email: "edited@example.com",
      title: "Supervisor",
      teamIds: ["team_b"],
    });

    expect(updated).toEqual(
      expect.objectContaining({
        id: created.id,
        companyId: NORDLYS,
        name: "Edited Employee",
        email: "edited@example.com",
        title: "Supervisor",
        teamIds: ["team_b"],
      }),
    );
    const rows = mocks.client.tables.get("employees") ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        legacy_id: created.id,
        name: "Edited Employee",
        email: "edited@example.com",
        title: "Supervisor",
        team_ids: ["team_b"],
      }),
    );
    expect(getItemSpy).not.toHaveBeenCalled();
    expect(setItemSpy).not.toHaveBeenCalled();
  });

  it("fails closed when company context or Supabase company mapping is missing", async () => {
    await expect(
      createEmployeeInSupabase({ companyId: "", name: "No Company", email: "no@example.com", teamIds: [] }),
    ).rejects.toThrow(/company context/i);

    await expect(
      createEmployeeInSupabase({
        companyId: NORDLYS,
        name: "No Mapping",
        email: "nomap@example.com",
        teamIds: [],
      }),
    ).rejects.toThrow(/No Supabase company found/i);
    expect(mocks.client.tables.get("employees") ?? []).toHaveLength(0);
  });

  it("keeps an empty Supabase employee list empty until create succeeds", async () => {
    seedCompanies([NORDLYS]);
    await expect(listFullEmployeesFromSupabase(NORDLYS)).resolves.toEqual([]);

    const created = await createEmployeeInSupabase({
      companyId: NORDLYS,
      name: "First Employee",
      email: "first@example.com",
      teamIds: [],
    });

    await expect(listFullEmployeesFromSupabase(NORDLYS)).resolves.toEqual([created]);
  });
});

describe("EMP-1 · SupabaseEmployeeRepository", () => {
  it("projects teamCount + hasLogin + status verbatim", async () => {
    seedFixture();
    seedCompanies();
    await migrateEmployees();

    const list = await supabaseEmployeeRepository.listSummaries({ companyId: NORDLYS });
    const active = list.items.find((e) => e.id === "emp_active");
    expect(active?.teamCount).toBe(2);
    expect(active?.hasLogin).toBe(true);
    expect(active?.title).toBe("Team Lead");

    const inactive = list.items.find((e) => e.id === "emp_inactive");
    expect(inactive?.status).toBe("inactive");
    expect(inactive?.hasLogin).toBe(false);
    // Status coverage — inactive employees are NOT dropped.
    expect(list.items.length).toBe(2);
  });

  it("getDetail reconstructs the full record losslessly incl. workingSchedule", async () => {
    const fixture = seedFixture();
    seedCompanies();
    await migrateEmployees();

    const expected = fixture.find((e) => e.id === "emp_active");
    const detail = await supabaseEmployeeRepository.getDetail("emp_active", { companyId: NORDLYS });
    expect(detail).toEqual(expected);
    expect(detail?.workingSchedule?.length).toBe(1);
  });

  it("getDetail returns null for a foreign company", async () => {
    seedFixture();
    seedCompanies();
    await migrateEmployees();
    const blocked = await supabaseEmployeeRepository.getDetail("emp_active", { companyId: OTHER });
    expect(blocked).toBeNull();
  });

  it("matches the localStorage adapter on count + search", async () => {
    seedFixture();
    seedCompanies();
    await migrateEmployees();

    const localCount = await localDataLayer.employees.count({ companyId: NORDLYS });
    const remoteCount = await supabaseEmployeeRepository.count({ companyId: NORDLYS });
    expect(remoteCount).toBe(localCount);

    const localSearch = await localDataLayer.employees.search({ companyId: NORDLYS, search: "Astrid" });
    const remoteSearch = await supabaseEmployeeRepository.search({ companyId: NORDLYS, search: "Astrid" });
    expect(remoteSearch.items.map((e) => e.id)).toEqual(localSearch.items.map((e) => e.id));
  });

  it("paginates without dropping or duplicating rows", async () => {
    saveEmployees([
      makeEmployee({ id: "emp_p1", name: "Page One" }),
      makeEmployee({ id: "emp_p2", name: "Page Two" }),
      makeEmployee({ id: "emp_p3", name: "Page Three" }),
    ]);
    seedCompanies();
    await migrateEmployees();

    const all = await supabaseEmployeeRepository.listSummaries({ companyId: NORDLYS });
    const total = all.total;
    const pageSize = 2;
    const seen = new Set<string>();
    const pageCount = Math.ceil(total / pageSize);
    for (let page = 1; page <= pageCount; page++) {
      const res = await supabaseEmployeeRepository.listSummaries({ companyId: NORDLYS, page, pageSize });
      expect(res.total).toBe(total);
      for (const item of res.items) seen.add(item.id);
    }
    expect(seen.size).toBe(total);
  });

  it("excludes soft-deleted rows from reads", async () => {
    seedFixture();
    seedCompanies();
    await migrateEmployees();

    // Simulate a soft-delete directly in the shadow copy.
    const rows = mocks.client.tables.get("employees") ?? [];
    const target = rows.find((r) => r.legacy_id === "emp_inactive");
    if (target) target.deleted_at = "2026-02-01T00:00:00.000Z";

    const list = await supabaseEmployeeRepository.listSummaries({ companyId: NORDLYS });
    expect(list.items.some((e) => e.id === "emp_inactive")).toBe(false);
    const detail = await supabaseEmployeeRepository.getDetail("emp_inactive", { companyId: NORDLYS });
    expect(detail).toBeNull();
  });
});
