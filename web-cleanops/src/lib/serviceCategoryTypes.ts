import {
  SERVICE_CATEGORY_TYPES,
  type ServiceCategory,
  type ServiceCategoryType,
} from "@/types";

/**
 * Service Category governance helpers. The Super Admin owns the global category
 * catalogue; the stable {@link ServiceCategoryType} (never the display name) is
 * what every downstream flow keys off — future category-scoped registration
 * (absence, internal time), statistics aggregation and payroll filtering.
 *
 * Kept pure and free of storage/UI so both seeding and tests share one source
 * of truth for the catalogue shape.
 */

/** Stable id for the seeded global category of a given type. */
export function globalCategoryId(type: ServiceCategoryType): string {
  return `svc_cat_${type}`;
}

const VALID_TYPES = new Set<ServiceCategoryType>(
  SERVICE_CATEGORY_TYPES.map((c) => c.value),
);

/** Type guard for an unknown value being a valid {@link ServiceCategoryType}. */
export function isServiceCategoryType(value: unknown): value is ServiceCategoryType {
  return typeof value === "string" && VALID_TYPES.has(value as ServiceCategoryType);
}

/**
 * Builds the governed global category catalogue (companyId === null) from
 * {@link SERVICE_CATEGORY_TYPES}, in declared order. This is the single source
 * of truth used by both fresh seeding and the backfill migration.
 */
export function buildGlobalServiceCategories(timestamp: string): ServiceCategory[] {
  return SERVICE_CATEGORY_TYPES.map((c, index) => ({
    id: globalCategoryId(c.value),
    companyId: null,
    name: c.label,
    categoryType: c.value,
    description: c.description,
    sortOrder: index,
    status: "active" as const,
    createdBy: "usr_root",
    createdAt: timestamp,
    updatedAt: timestamp,
  }));
}

/**
 * Best-effort mapping of a legacy global category id (pre-categoryType) to a
 * stable {@link ServiceCategoryType}, so existing installs gain a classification
 * without losing data. Unknown ids return undefined (left uncategorised).
 */
export function legacyCategoryTypeForId(id: string): ServiceCategoryType | undefined {
  switch (id) {
    case "svc_cat_recurring":
      return "recurring_service";
    case "svc_cat_deep":
      return "one_time_service";
    case "svc_cat_specialty":
      return "special_service";
    case "svc_cat_commercial":
      return "recurring_service";
    default:
      return undefined;
  }
}
