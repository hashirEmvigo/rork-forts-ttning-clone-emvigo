import { beforeEach, describe, expect, it } from "vitest";

import {
  accessibleAreaIds,
  areaScopeSummary,
  canAccessArea,
  filterByAreaScope,
  hasAllAreaAccess,
  normalizeAreaScope,
} from "./areaScope";
import {
  isAreaScopedAccessEnabled,
  setAreaScopedAccessEnabled,
} from "./store";
import type { Area, AreaScope } from "@/types";

const COMPANY = "cmp_nordlys";

beforeEach(() => {
  localStorage.clear();
});

function area(id: string, name: string): Area {
  const now = new Date().toISOString();
  return { id, companyId: COMPANY, name, isActive: true, createdAt: now, updatedAt: now };
}

const SELECTED: AreaScope = { mode: "selected", areaIds: ["area_gbg"] };

describe("areaScope — normalization", () => {
  it("treats missing / non-selected scopes as all-area access", () => {
    expect(normalizeAreaScope(undefined)).toEqual({ mode: "all", areaIds: [] });
    expect(normalizeAreaScope(null)).toEqual({ mode: "all", areaIds: [] });
    expect(normalizeAreaScope({ mode: "all", areaIds: ["x"] })).toEqual({
      mode: "all",
      areaIds: [],
    });
  });

  it("de-duplicates and cleans selected ids", () => {
    expect(
      normalizeAreaScope({ mode: "selected", areaIds: ["a", "a", "", "b"] }),
    ).toEqual({ mode: "selected", areaIds: ["a", "b"] });
  });

  it("reports all-area access and accessible ids", () => {
    expect(hasAllAreaAccess(undefined)).toBe(true);
    expect(hasAllAreaAccess(SELECTED)).toBe(false);
    expect(accessibleAreaIds(undefined)).toBe("all");
    expect(accessibleAreaIds(SELECTED)).toEqual(["area_gbg"]);
  });
});

describe("areaScope — canAccessArea", () => {
  it("grants everything when the feature is inactive (fallback)", () => {
    expect(canAccessArea({ enabled: false, scope: SELECTED }, "area_sthlm")).toBe(true);
    expect(canAccessArea({ enabled: false, scope: SELECTED }, undefined)).toBe(true);
  });

  it("grants everything for all-area scopes when active", () => {
    expect(canAccessArea({ enabled: true, scope: undefined }, "area_sthlm")).toBe(true);
    expect(canAccessArea({ enabled: true, scope: { mode: "all", areaIds: [] } }, undefined)).toBe(
      true,
    );
  });

  it("limits selected scopes to their ids when active", () => {
    const ctx = { enabled: true, scope: SELECTED };
    expect(canAccessArea(ctx, "area_gbg")).toBe(true);
    expect(canAccessArea(ctx, "area_sthlm")).toBe(false);
  });

  it("hides records without an area from selected scopes", () => {
    expect(canAccessArea({ enabled: true, scope: SELECTED }, undefined)).toBe(false);
  });

  it("treats an empty selected scope as no access, never all access", () => {
    const empty = { enabled: true, scope: { mode: "selected", areaIds: [] } as AreaScope };
    expect(canAccessArea(empty, "area_gbg")).toBe(false);
    expect(canAccessArea(empty, undefined)).toBe(false);
  });
});

describe("areaScope — filterByAreaScope", () => {
  const rows = [
    { id: "1", areaId: "area_gbg" },
    { id: "2", areaId: "area_sthlm" },
    { id: "3", areaId: undefined },
  ];
  const getAreaId = (r: { id: string; areaId?: string }) => r.areaId;

  it("returns all rows when inactive", () => {
    expect(
      filterByAreaScope(rows, getAreaId, { enabled: false, scope: SELECTED }).map((r) => r.id),
    ).toEqual(["1", "2", "3"]);
  });

  it("returns all rows for all-area scope", () => {
    expect(
      filterByAreaScope(rows, getAreaId, { enabled: true, scope: undefined }).map((r) => r.id),
    ).toEqual(["1", "2", "3"]);
  });

  it("limits rows for selected scope and hides unassigned rows", () => {
    expect(
      filterByAreaScope(rows, getAreaId, { enabled: true, scope: SELECTED }).map((r) => r.id),
    ).toEqual(["1"]);
  });
});

describe("areaScope — summary", () => {
  const areas = [area("area_gbg", "Gothenburg"), area("area_sthlm", "Stockholm"), area("area_malmo", "Malmö")];

  it("summarizes scopes for display", () => {
    expect(areaScopeSummary(undefined, areas)).toBe("All areas");
    expect(areaScopeSummary({ mode: "selected", areaIds: ["area_gbg"] }, areas)).toBe("Gothenburg");
    expect(
      areaScopeSummary({ mode: "selected", areaIds: ["area_gbg", "area_sthlm"] }, areas),
    ).toBe("Gothenburg + Stockholm");
    expect(
      areaScopeSummary(
        { mode: "selected", areaIds: ["area_gbg", "area_sthlm", "area_malmo"] },
        areas,
      ),
    ).toBe("3 areas");
    expect(areaScopeSummary({ mode: "selected", areaIds: [] }, areas)).toBe("No areas");
    expect(areaScopeSummary({ mode: "selected", areaIds: ["ghost"] }, areas)).toBe("No areas");
  });
});

describe("areaScope — company feature flag", () => {
  it("defaults to inactive and toggles per company", () => {
    expect(isAreaScopedAccessEnabled(COMPANY)).toBe(false);
    expect(isAreaScopedAccessEnabled(null)).toBe(false);
    setAreaScopedAccessEnabled(COMPANY, true);
    expect(isAreaScopedAccessEnabled(COMPANY)).toBe(true);
    expect(isAreaScopedAccessEnabled("cmp_other")).toBe(false);
    setAreaScopedAccessEnabled(COMPANY, false);
    expect(isAreaScopedAccessEnabled(COMPANY)).toBe(false);
  });
});
