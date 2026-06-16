import { describe, expect, it } from "vitest";

import { normalizeCategoryKey, planServicePackageApply } from "@/lib/servicePackageApplyPlan";
import type { ServiceCategory, ServicePackage, ServicePackageItem } from "@/types";

/**
 * SVCCAT — Copy-into-company planner.
 *
 * Proves the pure deep-copy plan: categories are deduped by name (reusing the
 * company's existing categories), sortOrders continue the company sequence, and
 * every package item maps to a company-service create input with the snapshot
 * fields preserved. The plan references categories by NAME only — no global ids.
 */

function item(overrides: Partial<ServicePackageItem>): ServicePackageItem {
  return {
    id: "svc_pkg_item",
    name: "Service",
    categoryName: "Cleaning",
    billingType: "fixed",
    serviceBasisType: "billable",
    deductionEligible: false,
    deductionType: "none",
    smsEnabled: false,
    ...overrides,
  };
}

function pkg(items: ServicePackageItem[]): ServicePackage {
  return {
    id: "pkg_1",
    name: "Starter",
    archived: false,
    items,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function companyCategory(overrides: Partial<ServiceCategory>): ServiceCategory {
  return {
    id: "svc_cat_existing",
    companyId: "cmp_stad",
    name: "Cleaning",
    sortOrder: 0,
    status: "active",
    createdBy: "usr_admin",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("planServicePackageApply", () => {
  it("schedules a new company category for each distinct package category name", () => {
    const plan = planServicePackageApply(
      pkg([
        item({ id: "a", name: "Weekly Clean", categoryName: "Recurring" }),
        item({ id: "b", name: "Window Wash", categoryName: "Windows" }),
      ]),
      [],
    );

    expect(plan.categoriesToCreate.map((c) => c.name)).toEqual(["Recurring", "Windows"]);
    expect(plan.services).toHaveLength(2);
    expect(plan.services.map((s) => s.categoryName)).toEqual(["Recurring", "Windows"]);
  });

  it("dedupes a repeated category name within the package into a single new category", () => {
    const plan = planServicePackageApply(
      pkg([
        item({ id: "a", name: "Weekly Clean", categoryName: "Recurring" }),
        item({ id: "b", name: "Deep Clean", categoryName: "Recurring" }),
      ]),
      [],
    );

    expect(plan.categoriesToCreate).toHaveLength(1);
    expect(plan.categoriesToCreate[0].name).toBe("Recurring");
    // Both services still target the same (to-be-created) category.
    expect(plan.services.map((s) => s.categoryName)).toEqual(["Recurring", "Recurring"]);
  });

  it("reuses an existing company category (case/whitespace-insensitive) instead of creating one", () => {
    const plan = planServicePackageApply(
      pkg([item({ name: "Weekly Clean", categoryName: "  cleaning  " })]),
      [companyCategory({ id: "svc_cat_existing", name: "Cleaning" })],
    );

    expect(plan.categoriesToCreate).toEqual([]);
    expect(plan.existingCategoryIdByName[normalizeCategoryKey("Cleaning")]).toBe("svc_cat_existing");
    expect(plan.services[0].categoryName).toBe("cleaning");
  });

  it("continues the company sortOrder sequence for newly created categories", () => {
    const plan = planServicePackageApply(
      pkg([
        item({ id: "a", categoryName: "Windows" }),
        item({ id: "b", categoryName: "Gardens" }),
      ]),
      [
        companyCategory({ id: "c1", name: "Cleaning", sortOrder: 4 }),
        companyCategory({ id: "c2", name: "Office", sortOrder: 7 }),
      ],
    );

    expect(plan.categoriesToCreate).toEqual([
      { name: "Windows", sortOrder: 8 },
      { name: "Gardens", sortOrder: 9 },
    ]);
  });

  it("falls back to an Uncategorised category when a package item has no category name", () => {
    const plan = planServicePackageApply(
      pkg([item({ name: "Misc", categoryName: "   " })]),
      [],
    );

    expect(plan.categoriesToCreate.map((c) => c.name)).toEqual(["Uncategorised"]);
    expect(plan.services[0].categoryName).toBe("Uncategorised");
  });

  it("copies the snapshot service fields verbatim as a company-owned deep copy", () => {
    const plan = planServicePackageApply(
      pkg([
        item({
          name: "Weekly Clean",
          description: "Every Monday",
          articleNumber: "ART-1",
          serviceType: "Cleaning",
          timeCode: "T-100",
          billingType: "hourly",
          serviceBasisType: "billable",
          deductionEligible: true,
          deductionType: "rot",
          price: 990,
          vat: 25,
          minimumPrice: 500,
          salesAccount: "3001",
          smsEnabled: true,
          // Source ids exist on the snapshot but must NOT leak into the copy.
          sourceServiceId: "svc_global_1",
          sourceCategoryId: "svc_cat_global_1",
        }),
      ]),
      [],
    );

    expect(plan.services[0].fields).toEqual({
      name: "Weekly Clean",
      description: "Every Monday",
      articleNumber: "ART-1",
      serviceType: "Cleaning",
      timeCode: "T-100",
      billingType: "hourly",
      serviceBasisType: "billable",
      deductionEligible: true,
      deductionType: "rot",
      price: 990,
      vat: 25,
      minimumPrice: 500,
      salesAccount: "3001",
      smsEnabled: true,
    });
    // No global source ids carried into the company copy.
    expect("sourceServiceId" in plan.services[0].fields).toBe(false);
    expect("sourceCategoryId" in plan.services[0].fields).toBe(false);
  });

  it("defaults a missing serviceBasisType to billable", () => {
    const plan = planServicePackageApply(
      pkg([item({ serviceBasisType: undefined })]),
      [],
    );

    expect(plan.services[0].fields.serviceBasisType).toBe("billable");
  });

  it("returns an empty plan for a package with no items", () => {
    const plan = planServicePackageApply(pkg([]), []);

    expect(plan.categoriesToCreate).toEqual([]);
    expect(plan.services).toEqual([]);
  });
});
