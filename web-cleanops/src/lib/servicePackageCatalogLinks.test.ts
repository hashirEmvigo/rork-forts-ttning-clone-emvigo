import { describe, expect, it } from "vitest";

import { packageUsesCategory, packagesUsingCategory } from "@/lib/servicePackageCatalogLinks";
import type { ServicePackage, ServicePackageItem } from "@/types";

/**
 * SVCCAT Catalog tags — category ↔ package link matching.
 *
 * Controlled-selection items match strictly by sourceCategoryId; legacy
 * free-text items (no source link) fall back to a case-insensitive name match.
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

function pkg(id: string, items: ServicePackageItem[]): ServicePackage {
  return {
    id,
    name: id,
    archived: false,
    items,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("packageUsesCategory", () => {
  it("matches a controlled item by sourceCategoryId", () => {
    const p = pkg("p1", [item({ sourceCategoryId: "cat_cleaning", categoryName: "Cleaning" })]);
    expect(packageUsesCategory(p, "cat_cleaning", "Cleaning")).toBe(true);
  });

  it("does not match a controlled item whose sourceCategoryId differs, even if names collide", () => {
    // Two distinct categories share a display name; the id must win.
    const p = pkg("p1", [item({ sourceCategoryId: "cat_other", categoryName: "Cleaning" })]);
    expect(packageUsesCategory(p, "cat_cleaning", "Cleaning")).toBe(false);
  });

  it("falls back to a case-insensitive name match for legacy items without a source link", () => {
    const p = pkg("p1", [item({ sourceCategoryId: undefined, categoryName: "  cleaning  " })]);
    expect(packageUsesCategory(p, "cat_cleaning", "Cleaning")).toBe(true);
  });

  it("returns false when no item references the category", () => {
    const p = pkg("p1", [item({ sourceCategoryId: "cat_windows", categoryName: "Windows" })]);
    expect(packageUsesCategory(p, "cat_cleaning", "Cleaning")).toBe(false);
  });

  it("matches when at least one of several items belongs to the category", () => {
    const p = pkg("p1", [
      item({ id: "a", sourceCategoryId: "cat_windows", categoryName: "Windows" }),
      item({ id: "b", sourceCategoryId: "cat_cleaning", categoryName: "Cleaning" }),
    ]);
    expect(packageUsesCategory(p, "cat_cleaning", "Cleaning")).toBe(true);
  });

  it("returns false for an empty package", () => {
    expect(packageUsesCategory(pkg("p1", []), "cat_cleaning", "Cleaning")).toBe(false);
  });
});

describe("packagesUsingCategory", () => {
  it("returns only matching packages, preserving input order", () => {
    const a = pkg("a", [item({ sourceCategoryId: "cat_cleaning" })]);
    const b = pkg("b", [item({ sourceCategoryId: "cat_windows", categoryName: "Windows" })]);
    const c = pkg("c", [item({ sourceCategoryId: undefined, categoryName: "Cleaning" })]);

    const result = packagesUsingCategory([a, b, c], "cat_cleaning", "Cleaning");

    expect(result.map((p) => p.id)).toEqual(["a", "c"]);
  });

  it("returns an empty list when nothing matches", () => {
    const b = pkg("b", [item({ sourceCategoryId: "cat_windows", categoryName: "Windows" })]);
    expect(packagesUsingCategory([b], "cat_cleaning", "Cleaning")).toEqual([]);
  });
});
