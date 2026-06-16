import { describe, expect, it } from "vitest";

import type { Service, ServicePackage, ServicePackageItem } from "@/types";
import {
  describePackageArticleNumberConflicts,
  detectPackageArticleNumberConflicts,
} from "./servicePackageArticleNumberConflicts";

const COMPANY = "cmp_stad";

function svc(overrides: Partial<Service>): Service {
  return {
    id: "svc_1",
    companyId: COMPANY,
    categoryId: null,
    name: "Service",
    billingType: "fixed",
    serviceBasisType: "billable",
    deductionEligible: false,
    deductionType: "none",
    smsEnabled: false,
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function item(overrides: Partial<ServicePackageItem>): ServicePackageItem {
  return {
    id: "item_1",
    name: "Item",
    categoryName: "Cleaning",
    billingType: "fixed",
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

describe("detectPackageArticleNumberConflicts", () => {
  it("returns no conflicts when article numbers are unique within the company", () => {
    const conflicts = detectPackageArticleNumberConflicts(
      pkg([
        item({ id: "a", name: "A", articleNumber: "1001" }),
        item({ id: "b", name: "B", articleNumber: "1002" }),
      ]),
      [svc({ id: "x", name: "X", articleNumber: "2001" })],
    );
    expect(conflicts).toEqual([]);
  });

  it("flags a package item that collides with an existing company service", () => {
    const conflicts = detectPackageArticleNumberConflicts(
      pkg([item({ id: "a", name: "Weekly Clean", articleNumber: "1001" })]),
      [svc({ id: "x", name: "Existing Clean", articleNumber: "1001" })],
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.articleNumber).toBe("1001");
    expect(conflicts[0]?.withExistingService).toBe(true);
    expect(conflicts[0]?.names).toEqual(expect.arrayContaining(["Weekly Clean", "Existing Clean"]));
  });

  it("flags two package items that share the same article number", () => {
    const conflicts = detectPackageArticleNumberConflicts(
      pkg([
        item({ id: "a", name: "One", articleNumber: "2001" }),
        item({ id: "b", name: "Two", articleNumber: "2001" }),
      ]),
      [],
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.articleNumber).toBe("2001");
    expect(conflicts[0]?.withExistingService).toBe(false);
    expect(conflicts[0]?.names).toEqual(expect.arrayContaining(["One", "Two"]));
  });

  it("ignores items without an article number", () => {
    const conflicts = detectPackageArticleNumberConflicts(
      pkg([
        item({ id: "a", name: "A" }),
        item({ id: "b", name: "B", articleNumber: "   " }),
      ]),
      [svc({ id: "x", articleNumber: "1001" })],
    );
    expect(conflicts).toEqual([]);
  });

  it("treats whitespace-padded numbers as equal", () => {
    const conflicts = detectPackageArticleNumberConflicts(
      pkg([item({ id: "a", name: "A", articleNumber: " 1001 " })]),
      [svc({ id: "x", name: "X", articleNumber: "1001" })],
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.articleNumber).toBe("1001");
  });

  it("builds a human-readable conflict message (and null when clean)", () => {
    expect(describePackageArticleNumberConflicts([])).toBeNull();
    const message = describePackageArticleNumberConflicts(
      detectPackageArticleNumberConflicts(
        pkg([item({ id: "a", name: "Weekly Clean", articleNumber: "1001" })]),
        [svc({ id: "x", name: "Existing", articleNumber: "1001" })],
      ),
    );
    expect(message).toContain("#1001");
    expect(message).toMatch(/unique within a company/i);
  });
});
