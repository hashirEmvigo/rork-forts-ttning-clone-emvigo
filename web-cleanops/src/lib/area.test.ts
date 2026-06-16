import { beforeEach, describe, expect, it } from "vitest";

import {
  activeAreas,
  customerAreaLabel,
  DEFAULT_AREA_NAMES,
  matchAreaByName,
  normalizeAreaName,
  resolveCustomerArea,
} from "./area";
import {
  archiveArea,
  createArea,
  getActiveAreas,
  getAreas,
  getCompanyAreas,
  getCustomers,
  restoreArea,
  updateArea,
} from "./store";
import type { Area, Customer } from "@/types";

const COMPANY = "cmp_nordlys";

beforeEach(() => {
  localStorage.clear();
});

function makeArea(over: Partial<Area> = {}): Area {
  const now = new Date().toISOString();
  return {
    id: "area_1",
    companyId: COMPANY,
    name: "Gothenburg",
    isActive: true,
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

function makeCustomer(over: Partial<Customer> = {}): Customer {
  return {
    id: "cust_1",
    companyId: COMPANY,
    name: "Test",
    customerNumber: "C-1",
    email: "a@b.c",
    status: "active",
    userIds: [],
    createdAt: new Date().toISOString(),
    ...over,
  };
}

describe("area — pure helpers", () => {
  it("normalizes names for matching", () => {
    expect(normalizeAreaName("  Gothenburg  ")).toBe("gothenburg");
    expect(normalizeAreaName(undefined)).toBe("");
  });

  it("filters active areas", () => {
    const list = [makeArea(), makeArea({ id: "area_2", isActive: false })];
    expect(activeAreas(list).map((a) => a.id)).toEqual(["area_1"]);
  });

  it("matches an area by name within a company (case-insensitive)", () => {
    const list = [makeArea({ name: "Oslo" })];
    expect(matchAreaByName(list, COMPANY, "oslo")?.id).toBe("area_1");
    expect(matchAreaByName(list, COMPANY, "  OSLO ")?.id).toBe("area_1");
    expect(matchAreaByName(list, "other", "oslo")).toBeUndefined();
    expect(matchAreaByName(list, COMPANY, "")).toBeUndefined();
  });

  it("prefers areaId, then falls back to legacy free-text matching", () => {
    const list = [makeArea({ id: "area_x", name: "Bergen" })];
    expect(
      resolveCustomerArea(makeCustomer({ areaId: "area_x" }), list)?.id,
    ).toBe("area_x");
    expect(
      resolveCustomerArea(makeCustomer({ area: "Bergen" }), list)?.id,
    ).toBe("area_x");
    expect(resolveCustomerArea(makeCustomer({ area: "Nowhere" }), list)).toBeUndefined();
  });

  it("does not crash on unknown legacy values and labels them Not assigned", () => {
    expect(customerAreaLabel(makeCustomer({ area: "Atlantis" }), [])).toBe(
      "Not assigned",
    );
    expect(customerAreaLabel(makeCustomer({}), [])).toBe("Not assigned");
  });
});

describe("area store — seeding", () => {
  it("seeds the default areas for every company", () => {
    const areas = getCompanyAreas(COMPANY);
    for (const name of DEFAULT_AREA_NAMES) {
      expect(areas.some((a) => a.name === name)).toBe(true);
    }
  });

  it("preserves legacy free-text customer area values as areas", () => {
    // Demo data assigns Bergen / Oslo to Nordlys customers.
    const names = getCompanyAreas(COMPANY).map((a) => a.name);
    expect(names).toContain("Bergen");
    expect(names).toContain("Oslo");
  });
});

describe("area store — CRUD", () => {
  it("creates, lists and rejects duplicate names", () => {
    const created = createArea(COMPANY, { name: "Trondheim" });
    expect(created).not.toBeNull();
    expect(getCompanyAreas(COMPANY).some((a) => a.name === "Trondheim")).toBe(true);

    expect(createArea(COMPANY, { name: "trondheim" })).toBeNull();
    expect(createArea(COMPANY, { name: "  " })).toBeNull();
  });

  it("updates metadata and rejects clashing renames", () => {
    const a = createArea(COMPANY, { name: "Kristiansand" });
    createArea(COMPANY, { name: "Stavanger" });
    expect(updateArea(a!.id, { description: "South" })?.description).toBe("South");
    expect(updateArea(a!.id, { name: "Stavanger" })).toBeNull();
  });

  it("archives and restores areas, affecting active lists only", () => {
    const a = createArea(COMPANY, { name: "Tromsø" });
    archiveArea(a!.id);
    expect(getActiveAreas(COMPANY).some((x) => x.id === a!.id)).toBe(false);
    expect(getCompanyAreas(COMPANY).some((x) => x.id === a!.id)).toBe(true);
    restoreArea(a!.id);
    expect(getActiveAreas(COMPANY).some((x) => x.id === a!.id)).toBe(true);
  });

  it("scopes areas to their company", () => {
    createArea(COMPANY, { name: "Drammen" });
    expect(getCompanyAreas("cmp_fjord").some((a) => a.name === "Drammen")).toBe(false);
  });
});

describe("area store — customer areaId backfill", () => {
  it("derives areaId from legacy free-text area by name match", () => {
    const customers = getCustomers();
    const areas = getAreas();
    const bergenCustomer = customers.find((c) => c.area === "Bergen");
    expect(bergenCustomer?.areaId).toBeDefined();
    const matched = areas.find((a) => a.id === bergenCustomer?.areaId);
    expect(matched?.name).toBe("Bergen");
  });
});
