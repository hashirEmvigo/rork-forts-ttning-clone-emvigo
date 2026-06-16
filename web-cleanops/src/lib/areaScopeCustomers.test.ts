import { beforeEach, describe, expect, it } from "vitest";

import { resolveCustomerArea } from "./area";
import { filterByAreaScope } from "./areaScope";
import type { Area, AreaScope, Customer } from "@/types";

/**
 * Verifies the exact logic the Customers list uses for Area Scoped Access:
 * resolve each customer's structured area (preferring areaId, falling back to
 * legacy free-text) then filter by the acting login's scope. Search runs on the
 * already-scoped list, so out-of-scope customers can never be revealed.
 */

const COMPANY = "cmp_nordlys";

beforeEach(() => {
  localStorage.clear();
});

const areas: Area[] = [
  { id: "area_gbg", companyId: COMPANY, name: "Gothenburg", isActive: true, createdAt: "", updatedAt: "" },
  { id: "area_sthlm", companyId: COMPANY, name: "Stockholm", isActive: true, createdAt: "", updatedAt: "" },
];

function customer(over: Partial<Customer>): Customer {
  return {
    id: "c",
    companyId: COMPANY,
    name: "Cust",
    customerNumber: "C-1",
    email: "a@b.c",
    status: "active",
    userIds: [],
    createdAt: "",
    ...over,
  };
}

const customers: Customer[] = [
  customer({ id: "c_gbg", name: "Bergen Office", areaId: "area_gbg" }),
  customer({ id: "c_sthlm", name: "Sveavägen", areaId: "area_sthlm" }),
  customer({ id: "c_legacy", name: "Legacy GBG", area: "Gothenburg" }), // legacy free-text
  customer({ id: "c_none", name: "Unassigned" }), // no area at all
];

function listFor(enabled: boolean, scope: AreaScope | undefined): string[] {
  return filterByAreaScope(customers, (c) => resolveCustomerArea(c, areas)?.id, {
    enabled,
    scope,
  }).map((c) => c.id);
}

describe("customer list — Area Scoped Access", () => {
  it("shows all customers when the feature is inactive", () => {
    expect(listFor(false, { mode: "selected", areaIds: ["area_gbg"] })).toEqual([
      "c_gbg",
      "c_sthlm",
      "c_legacy",
      "c_none",
    ]);
  });

  it("shows all customers to an all-areas user when active", () => {
    expect(listFor(true, { mode: "all", areaIds: [] })).toEqual([
      "c_gbg",
      "c_sthlm",
      "c_legacy",
      "c_none",
    ]);
  });

  it("shows only in-scope customers to a selected-area user (incl. legacy match)", () => {
    expect(listFor(true, { mode: "selected", areaIds: ["area_gbg"] })).toEqual([
      "c_gbg",
      "c_legacy",
    ]);
  });

  it("hides unassigned customers from scoped users", () => {
    expect(listFor(true, { mode: "selected", areaIds: ["area_sthlm"] })).toEqual(["c_sthlm"]);
  });

  it("treats an empty selected scope as access to nothing", () => {
    expect(listFor(true, { mode: "selected", areaIds: [] })).toEqual([]);
  });
});
