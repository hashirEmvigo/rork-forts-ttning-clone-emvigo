import { describe, expect, it } from "vitest";

import { buildServicePackageItemFromService } from "./servicePackageItems";
import type { PayrollGroup, Service, ServiceCategory } from "@/types";

/** Builds a fully-specified catalog Service fixture; overrides win. */
function makeService(overrides: Partial<Service> = {}): Service {
  return {
    id: "svc_window",
    companyId: null,
    categoryId: "cat_cleaning",
    name: "Window cleaning",
    description: "Exterior + interior glass",
    articleNumber: "ART-100",
    serviceType: "cleaning",
    timeCodeId: "tc_1",
    timeCode: "T-100",
    unit: "hour",
    billingType: "hourly",
    serviceBasisType: "billable",
    payrollGroupId: "pg_working",
    deductionEligible: true,
    deductionType: "rut",
    price: 450,
    vat: 25,
    minimumPrice: 200,
    salesAccount: "3001",
    smsEnabled: true,
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}

function makeCategory(overrides: Partial<ServiceCategory> = {}): ServiceCategory {
  return {
    id: "cat_cleaning",
    companyId: null,
    name: "Cleaning",
    sortOrder: 0,
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const payrollGroups: PayrollGroup[] = [
  {
    id: "pg_working",
    companyId: null,
    name: "Working time",
    groupType: "working_time",
    sortOrder: 0,
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "pg_travel",
    companyId: null,
    name: "Travel time",
    groupType: "travel_time",
    sortOrder: 1,
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
];

describe("buildServicePackageItemFromService", () => {
  it("snapshots the service identity and copies every catalog field", () => {
    const item = buildServicePackageItemFromService(
      makeService(),
      makeCategory(),
      payrollGroups,
    );

    expect(item.name).toBe("Window cleaning");
    expect(item.description).toBe("Exterior + interior glass");
    expect(item.articleNumber).toBe("ART-100");
    expect(item.serviceType).toBe("cleaning");
    expect(item.timeCode).toBe("T-100");
    expect(item.billingType).toBe("hourly");
    expect(item.serviceBasisType).toBe("billable");
    expect(item.deductionEligible).toBe(true);
    expect(item.deductionType).toBe("rut");
    expect(item.price).toBe(450);
    expect(item.vat).toBe(25);
    expect(item.minimumPrice).toBe(200);
    expect(item.salesAccount).toBe("3001");
    expect(item.smsEnabled).toBe(true);
  });

  it("records the source service and category ids for traceability", () => {
    const item = buildServicePackageItemFromService(
      makeService({ id: "svc_window", categoryId: "cat_cleaning" }),
      makeCategory({ id: "cat_cleaning" }),
      payrollGroups,
    );

    expect(item.sourceServiceId).toBe("svc_window");
    expect(item.sourceCategoryId).toBe("cat_cleaning");
  });

  it("uses the category name as the snapshot category label", () => {
    const item = buildServicePackageItemFromService(
      makeService(),
      makeCategory({ name: "Office cleaning" }),
      payrollGroups,
    );

    expect(item.categoryName).toBe("Office cleaning");
  });

  it("trims whitespace from the snapshot category name", () => {
    const item = buildServicePackageItemFromService(
      makeService(),
      makeCategory({ name: "  Cleaning  " }),
      payrollGroups,
    );

    expect(item.categoryName).toBe("Cleaning");
  });

  it("falls back to Uncategorised when there is no category", () => {
    const item = buildServicePackageItemFromService(
      makeService({ categoryId: null }),
      null,
      payrollGroups,
    );

    expect(item.categoryName).toBe("Uncategorised");
    expect(item.sourceCategoryId).toBeUndefined();
  });

  it("falls back to Uncategorised when the category name is blank", () => {
    const item = buildServicePackageItemFromService(
      makeService(),
      makeCategory({ name: "   " }),
      payrollGroups,
    );

    expect(item.categoryName).toBe("Uncategorised");
  });

  it("resolves the payroll group type from the service's payroll group id", () => {
    const item = buildServicePackageItemFromService(
      makeService({ payrollGroupId: "pg_travel" }),
      makeCategory(),
      payrollGroups,
    );

    expect(item.payrollGroupType).toBe("travel_time");
  });

  it("leaves payroll group type undefined when the service is ungrouped", () => {
    const item = buildServicePackageItemFromService(
      makeService({ payrollGroupId: null }),
      makeCategory(),
      payrollGroups,
    );

    expect(item.payrollGroupType).toBeUndefined();
  });

  it("leaves payroll group type undefined when the group id has no match", () => {
    const item = buildServicePackageItemFromService(
      makeService({ payrollGroupId: "pg_missing" }),
      makeCategory(),
      payrollGroups,
    );

    expect(item.payrollGroupType).toBeUndefined();
  });

  it("generates a unique id for each item with the svc_pkg_item prefix", () => {
    const service = makeService();
    const category = makeCategory();
    const first = buildServicePackageItemFromService(service, category, payrollGroups);
    const second = buildServicePackageItemFromService(service, category, payrollGroups);

    expect(first.id).toMatch(/^svc_pkg_item_/);
    expect(second.id).toMatch(/^svc_pkg_item_/);
    expect(first.id).not.toBe(second.id);
  });
});
