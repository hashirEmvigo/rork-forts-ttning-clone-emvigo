import type { Asset } from "./assetTypes";

/** Display ids for the seeded global Asset Center image categories. */
export type AssetCategorySectionId =
  | "cleaning_protocols"
  | "services"
  | "website_public"
  | "general";

export interface AssetCategorySectionDefinition {
  id: AssetCategorySectionId;
  /** Existing Asset Center category legacy id stored on assets.categoryId. */
  categoryIds: string[];
  label: string;
  description: string;
  sortOrder: number;
}

export interface AssetCategoryItemGroup<TItem> {
  section: AssetCategorySectionDefinition;
  items: TItem[];
}

/**
 * Display mapping for the four seeded global Asset Center categories from the
 * upload flow. This is intentionally a label/ordering helper, not a new category
 * authority or category-management model.
 */
export const ASSET_CATEGORY_SECTIONS: AssetCategorySectionDefinition[] = [
  {
    id: "cleaning_protocols",
    categoryIds: ["asset_cat_cleaning_protocols"],
    label: "Cleaning protocols",
    description: "Protocol, room, section and task reference imagery.",
    sortOrder: 0,
  },
  {
    id: "services",
    categoryIds: ["asset_cat_services"],
    label: "Services",
    description: "Service and service-category media for the global catalogue.",
    sortOrder: 1,
  },
  {
    id: "website_public",
    categoryIds: ["asset_cat_website_public"],
    label: "Website / Public places",
    description: "Website, login, marketing and public-facing imagery.",
    sortOrder: 2,
  },
  {
    id: "general",
    categoryIds: ["asset_cat_general"],
    label: "General folder",
    description: "Uncategorised or general-purpose images.",
    sortOrder: 3,
  },
];

const GENERAL_SECTION = ASSET_CATEGORY_SECTIONS.find(
  (section) => section.id === "general",
) as AssetCategorySectionDefinition;

const SECTION_BY_CATEGORY_ID = ASSET_CATEGORY_SECTIONS.reduce<Record<string, AssetCategorySectionDefinition>>(
  (acc, section) => {
    for (const categoryId of section.categoryIds) {
      acc[categoryId.toLowerCase()] = section;
    }
    return acc;
  },
  {},
);

/** Resolves a stored Asset Center category id into a Media Center section. */
export function getAssetCategorySection(
  categoryId: string | null | undefined,
): AssetCategorySectionDefinition {
  const key = (categoryId ?? "").trim().toLowerCase();
  return SECTION_BY_CATEGORY_ID[key] ?? GENERAL_SECTION;
}

/** Groups Media Center items by their existing asset.categoryId metadata. */
export function groupItemsByAssetCategory<TItem extends { asset: Pick<Asset, "categoryId"> }>(
  items: TItem[],
): AssetCategoryItemGroup<TItem>[] {
  const buckets = new Map<AssetCategorySectionId, TItem[]>();
  for (const section of ASSET_CATEGORY_SECTIONS) {
    buckets.set(section.id, []);
  }

  for (const item of items) {
    const section = getAssetCategorySection(item.asset.categoryId);
    buckets.get(section.id)?.push(item);
  }

  return ASSET_CATEGORY_SECTIONS.map((section) => ({
    section,
    items: buckets.get(section.id) ?? [],
  })).filter((group) => group.items.length > 0);
}
