import { describe, expect, it } from "vitest";

import {
  ADMINISTRATION_CENTER_CATEGORIES,
  ADMINISTRATION_CENTER_ITEMS,
  ADMINISTRATION_CENTER_OWNERSHIP_AREAS,
  getAdministrationCenterCoverageSummary,
  getAdministrationCenterOwnershipMap,
  getAdministrationCenterSections,
  searchAdministrationCenterItems,
  validateAdministrationCenterRegistryCoverage,
} from "./administrationCenterRegistry";

describe("administrationCenterRegistry", () => {
  it("exports the expected Administration Center categories", () => {
    const titles = ADMINISTRATION_CENTER_CATEGORIES.map((category) => category.title);

    expect(titles).toEqual([
      "Companies & Users",
      "Access & Permissions",
      "Modules & Navigation",
      "Services & Pricing",
      "Content & Website",
      "Templates",
      "Operational Registers",
      "Requests & CRM",
      "Plans & Entitlements",
      "Platform Settings",
      "Governance & Logs",
    ]);
  });

  it("exports active and planned items with discovery metadata", () => {
    const calculator = ADMINISTRATION_CENTER_ITEMS.find((item) => item.id === "calculator");
    const planned = ADMINISTRATION_CENTER_ITEMS.find((item) => item.id === "pricing-diagnostics");

    expect(calculator).toMatchObject({
      title: "Calculator",
      category: "Services & Pricing",
      route: "/calculator",
      status: "active",
      scope: "super_admin",
      requiredPermission: "calculator.manage",
    });
    expect(calculator?.breadcrumb).toEqual(["Services & Pricing", "Calculator builder"]);
    expect(calculator?.keywords).toEqual(
      expect.arrayContaining(["calculator", "price calculator", "quote", "quotation", "estimate", "service price", "public calculator"]),
    );

    expect(planned).toMatchObject({
      title: "Pricing diagnostics",
      status: "planned",
      scope: "future",
    });
    expect(planned?.route).toBeUndefined();
  });

  it("groups registry items into hub sections", () => {
    const sections = getAdministrationCenterSections();

    expect(sections).toHaveLength(ADMINISTRATION_CENTER_CATEGORIES.length);
    expect(sections.find((section) => section.category.title === "Services & Pricing")?.items.map((item) => item.id)).toEqual([
      "services",
      "calculator",
      "pricing-diagnostics",
    ]);
  });

  it("exports ownership areas for registry boundary mapping", () => {
    expect(ADMINISTRATION_CENTER_OWNERSHIP_AREAS.map((area) => area.id)).toEqual([
      "super_admin",
      "company_admin",
      "global",
      "future",
    ]);
    expect(ADMINISTRATION_CENTER_OWNERSHIP_AREAS.find((area) => area.id === "company_admin")?.boundaryLabel).toBe(
      "Operational reference",
    );
  });

  it("summarizes registry coverage without creating an access model", () => {
    const summary = getAdministrationCenterCoverageSummary();

    expect(summary.totalItems).toBe(ADMINISTRATION_CENTER_ITEMS.length);
    expect(summary.categoriesCovered).toBe(ADMINISTRATION_CENTER_CATEGORIES.length);
    expect(summary.totalCategories).toBe(ADMINISTRATION_CENTER_CATEGORIES.length);
    expect(summary.activeItems + summary.plannedItems).toBe(ADMINISTRATION_CENTER_ITEMS.length);
    expect(summary.activeRoutedItems).toBe(summary.activeItems);
    expect(summary.plannedUnroutedItems).toBe(summary.plannedItems);
    expect(summary.scopeCounts.super_admin).toBeGreaterThan(0);
    expect(summary.scopeCounts.company_admin).toBeGreaterThan(0);
    expect(summary.scopeCounts.global).toBeGreaterThan(0);
    expect(summary.scopeCounts.future).toBeGreaterThan(0);
  });

  it("groups registry items into a display-only ownership map", () => {
    const ownershipMap = getAdministrationCenterOwnershipMap();
    const companyAdminGroup = ownershipMap.find((group) => group.ownership.id === "company_admin");
    const futureGroup = ownershipMap.find((group) => group.ownership.id === "future");

    expect(ownershipMap.map((group) => group.ownership.id)).toEqual(["super_admin", "company_admin", "global", "future"]);
    expect(companyAdminGroup?.items.map((item) => item.id)).toContain("admin-requests-operations");
    expect(futureGroup?.items.every((item) => item.status === "planned")).toBe(true);
  });

  it("validates coverage guardrails for duplicate IDs, category coverage, routes, and related IDs", () => {
    expect(validateAdministrationCenterRegistryCoverage()).toEqual({
      duplicateIds: [],
      unknownCategories: [],
      missingCategories: [],
      activeItemsWithoutRoute: [],
      plannedItemsWithRoute: [],
      relatedItemIdsMissing: [],
    });
  });

  it("searches title, description, category, breadcrumb, keywords, aliases, and ownership labels locally", () => {
    expect(searchAdministrationCenterItems("calculator").map((item) => item.id)).toContain("calculator");
    expect(searchAdministrationCenterItems("price calculator").map((item) => item.id)).toContain("calculator");
    expect(searchAdministrationCenterItems("quote").map((item) => item.id)).toEqual(expect.arrayContaining(["calculator", "pricing-diagnostics"]));
    expect(searchAdministrationCenterItems("estimate").map((item) => item.id)).toEqual(expect.arrayContaining(["calculator", "pricing-diagnostics"]));
    expect(searchAdministrationCenterItems("Calculator builder").map((item) => item.id)).toContain("calculator");
    expect(searchAdministrationCenterItems("operational reference").map((item) => item.id)).toContain("admin-requests-operations");
  });

  it("returns no items for an empty query", () => {
    expect(searchAdministrationCenterItems("   ")).toEqual([]);
  });
});
