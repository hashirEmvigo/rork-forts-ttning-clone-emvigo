import { describe, expect, it } from "vitest";

import {
  addPlacement,
  isAssetPlacedInArea,
  nextSortOrder,
  removePlacement,
  removePlacementsForAsset,
  reorderPlacements,
  selectPlacements,
  setPlacementEmployeeVisibility,
} from "./workOrderMediaPlacements";
import type { WorkOrderMediaPlacement } from "@/types";

let counter = 0;
function id(): string {
  counter += 1;
  return `pl_${counter}`;
}
function ts(seconds: number): string {
  return new Date(2026, 0, 1, 0, 0, seconds).toISOString();
}

/** Adds a placement and returns the resulting list (asserting it was created). */
function add(
  list: WorkOrderMediaPlacement[],
  input: Parameters<typeof addPlacement>[1],
  seconds: number,
): WorkOrderMediaPlacement[] {
  return addPlacement(list, input, id(), ts(seconds)).placements;
}

describe("addPlacement", () => {
  it("creates a header placement, defaulting employee visibility to true", () => {
    const res = addPlacement([], { mediaAssetId: "a1", placementType: "header" }, "p1", ts(1));
    expect(res.added).not.toBeNull();
    expect(res.placements).toHaveLength(1);
    expect(res.placements[0].placementType).toBe("header");
    expect(res.placements[0].serviceRowId).toBeNull();
    expect(res.placements[0].visibleToEmployee).toBe(true);
    expect(res.placements[0].sortOrder).toBe(0);
  });

  it("allows the same asset in different areas (reuse without duplicate uploads)", () => {
    let list = add([], { mediaAssetId: "a1", placementType: "header" }, 1);
    list = add(list, { mediaAssetId: "a1", placementType: "service_row", serviceRowId: "r1" }, 2);
    list = add(list, { mediaAssetId: "a1", placementType: "service_row", serviceRowId: "r2" }, 3);
    expect(list).toHaveLength(3);
    expect(list.every((p) => p.mediaAssetId === "a1")).toBe(true);
  });

  it("de-duplicates the same asset in the same area (no-op)", () => {
    const list = add([], { mediaAssetId: "a1", placementType: "header" }, 1);
    const res = addPlacement(list, { mediaAssetId: "a1", placementType: "header" }, "p2", ts(2));
    expect(res.added).toBeNull();
    expect(res.placements).toHaveLength(1);
  });

  it("respects an explicit visibleToEmployee=false for a service row", () => {
    const res = addPlacement(
      [],
      { mediaAssetId: "a1", placementType: "service_row", serviceRowId: "r1", visibleToEmployee: false },
      "p1",
      ts(1),
    );
    expect(res.placements[0].visibleToEmployee).toBe(false);
  });

  it("assigns increasing sort orders within an area", () => {
    let list = add([], { mediaAssetId: "a1", placementType: "header" }, 1);
    list = add(list, { mediaAssetId: "a2", placementType: "header" }, 2);
    expect(selectPlacements(list, { placementType: "header" }).map((p) => p.sortOrder)).toEqual([0, 1]);
  });
});

describe("selectPlacements", () => {
  it("scopes service-row placements by row id and sorts by sortOrder", () => {
    let list = add([], { mediaAssetId: "a1", placementType: "service_row", serviceRowId: "r1" }, 1);
    list = add(list, { mediaAssetId: "a2", placementType: "service_row", serviceRowId: "r2" }, 2);
    list = add(list, { mediaAssetId: "a3", placementType: "service_row", serviceRowId: "r1" }, 3);
    const r1 = selectPlacements(list, { placementType: "service_row", serviceRowId: "r1" });
    expect(r1.map((p) => p.mediaAssetId)).toEqual(["a1", "a3"]);
  });

  it("does not mix header and service-row areas", () => {
    let list = add([], { mediaAssetId: "a1", placementType: "header" }, 1);
    list = add(list, { mediaAssetId: "a2", placementType: "service_row", serviceRowId: "r1" }, 2);
    expect(selectPlacements(list, { placementType: "header" })).toHaveLength(1);
    expect(
      selectPlacements(list, { placementType: "service_row", serviceRowId: "r1" }),
    ).toHaveLength(1);
  });
});

describe("nextSortOrder / isAssetPlacedInArea", () => {
  it("returns 0 for an empty area and detects placement membership", () => {
    expect(nextSortOrder([], { placementType: "header" })).toBe(0);
    const list = add([], { mediaAssetId: "a1", placementType: "header" }, 1);
    expect(nextSortOrder(list, { placementType: "header" })).toBe(1);
    expect(isAssetPlacedInArea(list, { placementType: "header" }, "a1")).toBe(true);
    expect(isAssetPlacedInArea(list, { placementType: "header" }, "a2")).toBe(false);
  });
});

describe("removePlacement / removePlacementsForAsset", () => {
  it("removes a single placement link only", () => {
    const res = addPlacement([], { mediaAssetId: "a1", placementType: "header" }, "p1", ts(1));
    const after = removePlacement(res.placements, "p1");
    expect(after).toHaveLength(0);
  });

  it("removes every placement referencing a deleted asset across areas", () => {
    let list = add([], { mediaAssetId: "a1", placementType: "header" }, 1);
    list = add(list, { mediaAssetId: "a1", placementType: "service_row", serviceRowId: "r1" }, 2);
    list = add(list, { mediaAssetId: "a2", placementType: "header" }, 3);
    const after = removePlacementsForAsset(list, "a1");
    expect(after).toHaveLength(1);
    expect(after[0].mediaAssetId).toBe("a2");
  });
});

describe("reorderPlacements", () => {
  it("reorders within an area and leaves other areas untouched", () => {
    let list = add([], { mediaAssetId: "a1", placementType: "header" }, 1);
    list = add(list, { mediaAssetId: "a2", placementType: "header" }, 2);
    list = add(list, { mediaAssetId: "a3", placementType: "header" }, 3);
    list = add(list, { mediaAssetId: "b1", placementType: "service_row", serviceRowId: "r1" }, 4);
    const headerIds = selectPlacements(list, { placementType: "header" }).map((p) => p.id);
    const reversed = [...headerIds].reverse();
    const after = reorderPlacements(list, { placementType: "header" }, reversed);
    expect(selectPlacements(after, { placementType: "header" }).map((p) => p.mediaAssetId)).toEqual([
      "a3",
      "a2",
      "a1",
    ]);
    // Service row placement unchanged.
    expect(
      selectPlacements(after, { placementType: "service_row", serviceRowId: "r1" }),
    ).toHaveLength(1);
  });
});

describe("setPlacementEmployeeVisibility", () => {
  it("toggles the flag on the link without touching siblings", () => {
    let list = add([], { mediaAssetId: "a1", placementType: "service_row", serviceRowId: "r1" }, 1);
    list = add(list, { mediaAssetId: "a2", placementType: "service_row", serviceRowId: "r1" }, 2);
    const target = list[0].id;
    const after = setPlacementEmployeeVisibility(list, target, false);
    expect(after.find((p) => p.id === target)?.visibleToEmployee).toBe(false);
    expect(after.find((p) => p.id === list[1].id)?.visibleToEmployee).toBe(true);
  });
});
