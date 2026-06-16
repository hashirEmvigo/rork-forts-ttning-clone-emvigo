import { beforeEach, describe, expect, it } from "vitest";

import {
  getCustomers,
  getEmployees,
  getWorkOrders,
  getBookingQueue,
  getAuditEvents,
  getTimeReports,
} from "@/lib/store";
import { localDataLayer } from "./localStorageAdapters";
import { validateWave0Parity } from "./parity";

/**
 * Wave 0 validation (P4C). Confirms the localStorage adapters return exactly what
 * the existing store getters return, so a later Supabase adapter can be swapped
 * in behind the same contract with confidence. Runs against the seeded demo data
 * (the store seeds on first read), both unscoped and company-scoped.
 */
const SEEDED_COMPANY = "cmp_nordlys";

beforeEach(() => {
  localStorage.clear();
});

describe("Wave 0 parity — validateWave0Parity()", () => {
  it("passes for every entity across all companies", async () => {
    const report = await validateWave0Parity();
    for (const check of report.checks) {
      expect(check.notes, `${check.entity}: ${check.notes.join(", ")}`).toEqual([]);
      expect(check.ok, check.entity).toBe(true);
    }
    expect(report.ok).toBe(true);
  });

  it("passes for every entity scoped to a seeded company", async () => {
    const report = await validateWave0Parity(SEEDED_COMPANY);
    expect(report.companyId).toBe(SEEDED_COMPANY);
    for (const check of report.checks) {
      expect(check.notes, `${check.entity}: ${check.notes.join(", ")}`).toEqual([]);
      expect(check.ok, check.entity).toBe(true);
    }
    expect(report.ok).toBe(true);
  });

  it("has non-empty seeded data so the comparison is meaningful", async () => {
    const report = await validateWave0Parity(SEEDED_COMPANY);
    const customers = report.checks.find((c) => c.entity === "customers");
    const workOrders = report.checks.find((c) => c.entity === "workOrders");
    expect(customers?.getterCount ?? 0).toBeGreaterThan(0);
    expect(workOrders?.getterCount ?? 0).toBeGreaterThan(0);
  });
});

describe("Wave 0 adapters — count parity", () => {
  it("customers/employees/work orders counts equal the getters (company-scoped)", async () => {
    const cust = getCustomers().filter((c) => c.companyId === SEEDED_COMPANY);
    const emp = getEmployees().filter((e) => e.companyId === SEEDED_COMPANY);
    const wo = getWorkOrders().filter((w) => w.companyId === SEEDED_COMPANY);

    expect(await localDataLayer.customers.count({ companyId: SEEDED_COMPANY })).toBe(cust.length);
    expect(await localDataLayer.employees.count({ companyId: SEEDED_COMPANY })).toBe(emp.length);
    expect(await localDataLayer.workOrders.count({ companyId: SEEDED_COMPANY })).toBe(wo.length);
  });

  it("schedule/activity/time-report counts equal the getters (unscoped)", async () => {
    expect(await localDataLayer.schedule.count()).toBe(getBookingQueue().length);
    expect(await localDataLayer.activityLog.count()).toBe(getAuditEvents().length);
    expect(await localDataLayer.timeReports.count()).toBe(getTimeReports().length);
  });
});

describe("Wave 0 adapters — pagination", () => {
  it("paginates without dropping or duplicating rows", async () => {
    const all = await localDataLayer.customers.listSummaries({ companyId: SEEDED_COMPANY });
    const total = all.total;
    const pageSize = 2;
    const seen = new Set<string>();
    const pageCount = Math.ceil(total / pageSize);

    for (let page = 1; page <= pageCount; page++) {
      const res = await localDataLayer.customers.listSummaries({
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

describe("Wave 0 adapters — search + detail", () => {
  it("search narrows results and matched ids resolve via getDetail", async () => {
    const sample = getCustomers().find((c) => c.companyId === SEEDED_COMPANY);
    expect(sample).toBeDefined();
    if (!sample) return;

    const res = await localDataLayer.customers.search({
      companyId: SEEDED_COMPANY,
      search: sample.customerNumber,
    });
    expect(res.items.some((c) => c.id === sample.id)).toBe(true);

    const detail = await localDataLayer.customers.getDetail(sample.id, {
      companyId: SEEDED_COMPANY,
    });
    expect(detail?.id).toBe(sample.id);
  });

  it("getDetail enforces company scope (returns null for a foreign company)", async () => {
    const sample = getCustomers().find((c) => c.companyId === SEEDED_COMPANY);
    expect(sample).toBeDefined();
    if (!sample) return;

    const blocked = await localDataLayer.customers.getDetail(sample.id, {
      companyId: "cmp_does_not_exist",
    });
    expect(blocked).toBeNull();
  });
});
