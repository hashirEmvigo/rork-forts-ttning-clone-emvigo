import { beforeEach, describe, expect, it } from "vitest";

import {
  activePostalCities,
  addressCityLabel,
  addressPostalCity,
  normalizePostalCityName,
  postalCityLabel,
  resolveAddressPostalCityId,
  resolvePostalCityArea,
} from "./postalCity";
import {
  archiveArea,
  archivePostalCity,
  createArea,
  createPostalCity,
  getActivePostalCities,
  getCustomers,
  isAutoAreaFromPostalCityEnabled,
  listPostalCities,
  resolveAreaForPostalCity,
  restorePostalCity,
  saveCustomers,
  setAutoAreaFromPostalCityEnabled,
  updatePostalCity,
} from "./store";
import type { Area, Customer, CustomerAddress, PostalCity } from "@/types";

const COMPANY = "cmp_pcity_test";

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

function makePostalCity(over: Partial<PostalCity> = {}): PostalCity {
  const now = new Date().toISOString();
  return {
    id: "pcity_1",
    companyId: COMPANY,
    name: "Mölndal",
    areaId: "area_1",
    isActive: true,
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

describe("postalCity — pure helpers", () => {
  it("normalizes names for matching", () => {
    expect(normalizePostalCityName("  Mölndal  ")).toBe("mölndal");
    expect(normalizePostalCityName(undefined)).toBe("");
  });

  it("returns a display label", () => {
    expect(postalCityLabel(makePostalCity({ name: "Partille" }))).toBe("Partille");
    expect(postalCityLabel(undefined)).toBe("");
  });

  it("filters active postal cities", () => {
    const list = [makePostalCity(), makePostalCity({ id: "pcity_2", isActive: false })];
    expect(activePostalCities(list).map((c) => c.id)).toEqual(["pcity_1"]);
  });

  it("resolves the connected area only when active, never crashing", () => {
    const active = makeArea({ id: "area_x" });
    const inactive = makeArea({ id: "area_y", isActive: false });
    expect(resolvePostalCityArea(makePostalCity({ areaId: "area_x" }), [active])?.id).toBe(
      "area_x",
    );
    // Inactive linked area resolves to undefined (no auto-assign).
    expect(resolvePostalCityArea(makePostalCity({ areaId: "area_y" }), [inactive])).toBeUndefined();
    // Missing area resolves to undefined.
    expect(resolvePostalCityArea(makePostalCity({ areaId: "ghost" }), [active])).toBeUndefined();
    expect(resolvePostalCityArea(undefined, [active])).toBeUndefined();
  });
});

describe("postalCity — address-level resolution (postalCityId is the only source)", () => {
  function makeAddress(over: Partial<CustomerAddress> = {}): CustomerAddress {
    return { id: "addr_1", isInvoice: false, isDelivery: false, ...over };
  }

  const cities = [
    makePostalCity({ id: "pc_got", name: "Göteborg" }),
    makePostalCity({ id: "pc_mol", name: "Mölndal" }),
    makePostalCity({ id: "pc_old", name: "Partille", isActive: false }),
  ];

  it("resolves the linked postal city only from an explicit id", () => {
    expect(addressPostalCity(makeAddress({ postalCityId: "pc_got" }), cities)?.id).toBe("pc_got");
    expect(addressPostalCity(makeAddress(), cities)).toBeUndefined();
    expect(addressPostalCity(makeAddress({ postalCityId: "ghost" }), cities)).toBeUndefined();
  });

  it("display priority: postalCityId → empty (no free-text fallback)", () => {
    // 1. structured link resolves to the postal city's name
    expect(addressCityLabel(makeAddress({ postalCityId: "pc_got" }), cities)).toBe("Göteborg");
    // 2. empty state when there is no valid link
    expect(addressCityLabel(makeAddress(), cities)).toBe("");
    expect(addressCityLabel(makeAddress({ postalCityId: "ghost" }), cities)).toBe("");
    expect(addressCityLabel(undefined, cities)).toBe("");
  });

  it("preselect: resolves an explicit, still-valid postalCityId", () => {
    expect(resolveAddressPostalCityId(makeAddress({ postalCityId: "pc_mol" }), cities)).toBe(
      "pc_mol",
    );
  });

  it("preselect: returns undefined for missing or unknown links", () => {
    expect(resolveAddressPostalCityId(makeAddress(), cities)).toBeUndefined();
    expect(resolveAddressPostalCityId(makeAddress({ postalCityId: "ghost" }), cities)).toBeUndefined();
    expect(resolveAddressPostalCityId(undefined, cities)).toBeUndefined();
  });
});

describe("postalCity store — CRUD", () => {
  function seedArea(name = "Gothenburg"): Area {
    const a = createArea(COMPANY, { name });
    expect(a).not.toBeNull();
    return a as Area;
  }

  it("creates and lists postal cities linked to an area", () => {
    const area = seedArea();
    const city = createPostalCity({ companyId: COMPANY, name: "Mölndal", areaId: area.id });
    expect(city).not.toBeNull();
    expect(listPostalCities(COMPANY).some((c) => c.name === "Mölndal")).toBe(true);
    expect(getActivePostalCities(COMPANY).some((c) => c.id === city!.id)).toBe(true);
  });

  it("allows multiple postal cities linked to the SAME area (regression)", () => {
    const area = seedArea();
    const a = createPostalCity({ companyId: COMPANY, name: "Mölndal", areaId: area.id });
    const b = createPostalCity({ companyId: COMPANY, name: "Partille", areaId: area.id });
    const c = createPostalCity({ companyId: COMPANY, name: "Alingsås", areaId: area.id });
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(c).not.toBeNull();
    expect(
      listPostalCities(COMPANY).filter((city) => city.areaId === area.id).length,
    ).toBe(3);
  });

  it("rejects empty names, missing areas and cross-company areas", () => {
    const area = seedArea();
    expect(createPostalCity({ companyId: COMPANY, name: "  ", areaId: area.id })).toBeNull();
    expect(createPostalCity({ companyId: COMPANY, name: "X", areaId: "missing" })).toBeNull();
    const otherArea = createArea("cmp_other", { name: "Oslo" });
    expect(
      createPostalCity({ companyId: COMPANY, name: "X", areaId: otherArea!.id }),
    ).toBeNull();
  });

  it("prevents duplicate ACTIVE names but allows reuse after archiving", () => {
    const area = seedArea();
    createPostalCity({ companyId: COMPANY, name: "Partille", areaId: area.id });
    expect(createPostalCity({ companyId: COMPANY, name: "partille", areaId: area.id })).toBeNull();

    const dup = listPostalCities(COMPANY).find((c) => c.name === "Partille")!;
    archivePostalCity(dup.id);
    // Once archived, the same name can be created again.
    expect(
      createPostalCity({ companyId: COMPANY, name: "Partille", areaId: area.id }),
    ).not.toBeNull();
  });

  it("updates name and area, rejecting clashes and invalid areas", () => {
    const area = seedArea();
    const area2 = seedArea("Borås");
    const a = createPostalCity({ companyId: COMPANY, name: "Mölndal", areaId: area.id })!;
    createPostalCity({ companyId: COMPANY, name: "Lerum", areaId: area.id });

    expect(updatePostalCity(a.id, { areaId: area2.id })?.areaId).toBe(area2.id);
    expect(updatePostalCity(a.id, { name: "Lerum" })).toBeNull();
    expect(updatePostalCity(a.id, { areaId: "missing" })).toBeNull();
    expect(updatePostalCity(a.id, { name: "  " })).toBeNull();
  });

  it("archives and restores, affecting active lists only", () => {
    const area = seedArea();
    const a = createPostalCity({ companyId: COMPANY, name: "Kungälv", areaId: area.id })!;
    archivePostalCity(a.id);
    expect(getActivePostalCities(COMPANY).some((c) => c.id === a.id)).toBe(false);
    expect(listPostalCities(COMPANY).some((c) => c.id === a.id)).toBe(true);
    restorePostalCity(a.id);
    expect(getActivePostalCities(COMPANY).some((c) => c.id === a.id)).toBe(true);
  });

  it("resolves a postal city's area by id, returning null for inactive/missing", () => {
    const area = seedArea();
    const a = createPostalCity({ companyId: COMPANY, name: "Mölndal", areaId: area.id })!;
    expect(resolveAreaForPostalCity(a.id)?.id).toBe(area.id);

    archiveArea(area.id);
    // Linked area is now inactive — no usable area is resolved.
    expect(resolveAreaForPostalCity(a.id)).toBeNull();
    expect(resolveAreaForPostalCity("ghost")).toBeNull();
  });
});

describe("postalCity store — auto area assignment setting", () => {
  it("defaults to inactive and toggles per company", () => {
    expect(isAutoAreaFromPostalCityEnabled(COMPANY)).toBe(false);
    setAutoAreaFromPostalCityEnabled(COMPANY, true);
    expect(isAutoAreaFromPostalCityEnabled(COMPANY)).toBe(true);
    // Independent per company.
    expect(isAutoAreaFromPostalCityEnabled("cmp_other")).toBe(false);
    setAutoAreaFromPostalCityEnabled(COMPANY, false);
    expect(isAutoAreaFromPostalCityEnabled(COMPANY)).toBe(false);
    expect(isAutoAreaFromPostalCityEnabled(null)).toBe(false);
  });
});

describe("customer — postal city persistence", () => {
  it("persists postalCityId across reads (refresh)", () => {
    const existing = getCustomers();
    const customer: Customer = {
      id: "cust_pc",
      companyId: COMPANY,
      name: "Test Customer",
      customerNumber: "C-9001",
      email: "pc@test.com",
      status: "active",
      customerType: "commercial",
      postalCityId: "pcity_1",
      userIds: [],
      createdAt: new Date().toISOString(),
    };
    saveCustomers([customer, ...existing]);

    const reloaded = getCustomers().find((c) => c.id === "cust_pc");
    expect(reloaded?.postalCityId).toBe("pcity_1");
  });
});
