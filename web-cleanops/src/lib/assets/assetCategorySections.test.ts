import { describe, expect, it } from "vitest";

import {
  ASSET_CATEGORY_SECTIONS,
  getAssetCategorySection,
  groupItemsByAssetCategory,
} from "./assetCategorySections";

function item(id: string, categoryId: string | null) {
  return { id, asset: { categoryId } };
}

describe("assetCategorySections", () => {
  it("defines the seeded Media Center image category sections in display order", () => {
    expect(ASSET_CATEGORY_SECTIONS.map((section) => section.label)).toEqual([
      "Cleaning protocols",
      "Services",
      "Website / Public places",
      "General folder",
    ]);
    expect(ASSET_CATEGORY_SECTIONS.map((section) => section.categoryIds[0])).toEqual([
      "asset_cat_cleaning_protocols",
      "asset_cat_services",
      "asset_cat_website_public",
      "asset_cat_general",
    ]);
  });

  it("maps existing Asset Center category ids to display sections", () => {
    expect(getAssetCategorySection("asset_cat_cleaning_protocols").label).toBe("Cleaning protocols");
    expect(getAssetCategorySection("asset_cat_services").label).toBe("Services");
    expect(getAssetCategorySection("asset_cat_website_public").label).toBe(
      "Website / Public places",
    );
    expect(getAssetCategorySection("asset_cat_general").label).toBe("General folder");
  });

  it("falls missing or unknown category ids back to General folder", () => {
    expect(getAssetCategorySection(null).label).toBe("General folder");
    expect(getAssetCategorySection(undefined).label).toBe("General folder");
    expect(getAssetCategorySection("legacy_unknown").label).toBe("General folder");
  });

  it("groups items by existing asset category metadata and hides empty sections", () => {
    const groups = groupItemsByAssetCategory([
      item("protocol", "asset_cat_cleaning_protocols"),
      item("service", "asset_cat_services"),
      item("uncategorised", null),
      item("unknown", "legacy_unknown"),
    ]);

    expect(groups.map((group) => group.section.label)).toEqual([
      "Cleaning protocols",
      "Services",
      "General folder",
    ]);
    expect(groups.map((group) => group.items.map((groupedItem) => groupedItem.id))).toEqual([
      ["protocol"],
      ["service"],
      ["uncategorised", "unknown"],
    ]);
  });
});
