import { beforeEach, describe, expect, it } from "vitest";

import { getEmployees, saveEmployees } from "@/lib/store";
import type { Employee } from "@/types";
import { localDataLayer } from "./localStorageAdapters";
import { validateEmployeeParity } from "./employeeParity";

/**
 * EMP-0 validation (P7B). Confirms the already-existing localStorage employee
 * adapter faithfully represents the current Employee aggregate — count / id-set
 * / summary fields (incl. teamCount + hasLogin) / lossless detail / company
 * scope / search / status coverage — so a later Supabase adapter can be swapped
 * in behind the SAME repository contract with confidence.
 *
 * Some checks (linked login, inactive status, team membership) need deterministic
 * data, so a small fixture is seeded for the scoped runs alongside the broad
 * seeded-data run.
 */
const SEEDED_COMPANY = "cmp_nordlys";
const OTHER_COMPANY = "cmp_other";

beforeEach(() => {
  localStorage.clear();
});

function makeEmployee(overrides: Partial<Employee> & Pick<Employee, "id">): Employee {
  return {
    companyId: SEEDED_COMPANY,
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
function seedEmployeeFixture(): Employee[] {
  const fixture: Employee[] = [
    makeEmployee({
      id: "emp_fix_active",
      name: "Astrid Holm",
      teamIds: ["team_a", "team_b"],
      userId: "usr_1",
      title: "Team Lead",
      workingSchedule: [
        { weekday: "monday", isAvailable: true, startTime: "08:00", endTime: "16:00", breakMinutes: 30 },
      ],
    }),
    makeEmployee({ id: "emp_fix_inactive", name: "Bjorn Vik", status: "inactive", teamIds: ["team_a"] }),
    makeEmployee({ id: "emp_fix_other", name: "Cilla Berg", companyId: OTHER_COMPANY }),
  ];
  saveEmployees(fixture);
  return fixture;
}

describe("EMP-0 parity — validateEmployeeParity()", () => {
  it("passes for every dimension across all companies (seeded data)", async () => {
    const report = await validateEmployeeParity();
    for (const check of report.checks) {
      expect(check.notes, `${check.dimension}: ${check.notes.join(", ")}`).toEqual([]);
      expect(check.ok, check.dimension).toBe(true);
    }
    expect(report.ok).toBe(true);
  });

  it("passes for every dimension scoped to a seeded company", async () => {
    const report = await validateEmployeeParity(SEEDED_COMPANY);
    expect(report.companyId).toBe(SEEDED_COMPANY);
    for (const check of report.checks) {
      expect(check.notes, `${check.dimension}: ${check.notes.join(", ")}`).toEqual([]);
      expect(check.ok, check.dimension).toBe(true);
    }
    expect(report.ok).toBe(true);
  });

  it("passes with a deterministic fixture (linked login + inactive + teams)", async () => {
    seedEmployeeFixture();
    const report = await validateEmployeeParity(SEEDED_COMPANY);
    for (const check of report.checks) {
      expect(check.notes, `${check.dimension}: ${check.notes.join(", ")}`).toEqual([]);
      expect(check.ok, check.dimension).toBe(true);
    }
    // The fixture made the status-coverage check meaningful (one inactive row).
    expect(report.checks.find((c) => c.dimension === "employees.statusCoverage")?.sourceCount).toBe(1);
  });
});

describe("EMP-0 adapter — count + id-set parity", () => {
  it("count() and listSummaries total equal the getter (company-scoped)", async () => {
    seedEmployeeFixture();
    const source = getEmployees().filter((e) => e.companyId === SEEDED_COMPANY);
    const list = await localDataLayer.employees.listSummaries({ companyId: SEEDED_COMPANY });
    const count = await localDataLayer.employees.count({ companyId: SEEDED_COMPANY });
    expect(list.total).toBe(source.length);
    expect(count).toBe(source.length);
    expect(new Set(list.items.map((e) => e.id))).toEqual(new Set(source.map((e) => e.id)));
  });
});

describe("EMP-0 adapter — summary field parity", () => {
  it("projects teamCount + hasLogin + status verbatim", async () => {
    seedEmployeeFixture();
    const list = await localDataLayer.employees.listSummaries({ companyId: SEEDED_COMPANY });

    const active = list.items.find((e) => e.id === "emp_fix_active");
    expect(active?.teamCount).toBe(2);
    expect(active?.hasLogin).toBe(true);
    expect(active?.title).toBe("Team Lead");
    expect(active?.status).toBe("active");

    const inactive = list.items.find((e) => e.id === "emp_fix_inactive");
    expect(inactive?.teamCount).toBe(1);
    expect(inactive?.hasLogin).toBe(false);
    expect(inactive?.status).toBe("inactive");
  });
});

describe("EMP-0 adapter — detail parity (lossless)", () => {
  it("getDetail reconstructs the full record incl. workingSchedule", async () => {
    const fixture = seedEmployeeFixture();
    const expected = fixture.find((e) => e.id === "emp_fix_active");
    const detail = await localDataLayer.employees.getDetail("emp_fix_active", {
      companyId: SEEDED_COMPANY,
    });
    expect(detail).not.toBeNull();
    expect(detail).toEqual(expected);
    expect(detail?.workingSchedule?.length).toBe(1);
  });
});

describe("EMP-0 adapter — pagination", () => {
  it("paginates without dropping or duplicating rows", async () => {
    seedEmployeeFixture();
    // Add a few more so multiple pages are exercised.
    saveEmployees([
      ...getEmployees(),
      makeEmployee({ id: "emp_pg_1", name: "Page One" }),
      makeEmployee({ id: "emp_pg_2", name: "Page Two" }),
    ]);
    const all = await localDataLayer.employees.listSummaries({ companyId: SEEDED_COMPANY });
    const total = all.total;
    const pageSize = 2;
    const seen = new Set<string>();
    const pageCount = Math.ceil(total / pageSize);

    for (let page = 1; page <= pageCount; page++) {
      const res = await localDataLayer.employees.listSummaries({
        companyId: SEEDED_COMPANY,
        page,
        pageSize,
      });
      expect(res.total).toBe(total);
      expect(res.page).toBe(page);
      expect(res.items.length).toBeLessThanOrEqual(pageSize);
      for (const item of res.items) seen.add(item.id);
    }
    expect(seen.size).toBe(total);
  });
});

describe("EMP-0 adapter — search + status filtering parity", () => {
  it("search narrows results and matched ids resolve via getDetail", async () => {
    seedEmployeeFixture();
    const res = await localDataLayer.employees.search({
      companyId: SEEDED_COMPANY,
      search: "Astrid",
    });
    expect(res.items.some((e) => e.id === "emp_fix_active")).toBe(true);
    expect(res.items.some((e) => e.id === "emp_fix_inactive")).toBe(false);

    const detail = await localDataLayer.employees.getDetail("emp_fix_active", {
      companyId: SEEDED_COMPANY,
    });
    expect(detail?.id).toBe("emp_fix_active");
  });

  it("does NOT implicitly filter by status — inactive rows remain in the list", async () => {
    seedEmployeeFixture();
    const list = await localDataLayer.employees.listSummaries({ companyId: SEEDED_COMPANY });
    expect(list.items.some((e) => e.id === "emp_fix_inactive")).toBe(true);
  });
});

describe("EMP-0 adapter — company scope guards", () => {
  it("unknown company returns an empty list and zero count", async () => {
    seedEmployeeFixture();
    const list = await localDataLayer.employees.listSummaries({ companyId: "cmp_does_not_exist" });
    const count = await localDataLayer.employees.count({ companyId: "cmp_does_not_exist" });
    expect(list.total).toBe(0);
    expect(list.items).toEqual([]);
    expect(count).toBe(0);
  });

  it("getDetail returns null for a foreign company", async () => {
    seedEmployeeFixture();
    const blocked = await localDataLayer.employees.getDetail("emp_fix_active", {
      companyId: OTHER_COMPANY,
    });
    expect(blocked).toBeNull();
  });

  it("does not leak foreign-company employees into a scoped list", async () => {
    seedEmployeeFixture();
    const list = await localDataLayer.employees.listSummaries({ companyId: SEEDED_COMPANY });
    expect(list.items.every((e) => e.companyId === SEEDED_COMPANY)).toBe(true);
    expect(list.items.some((e) => e.id === "emp_fix_other")).toBe(false);
  });
});
