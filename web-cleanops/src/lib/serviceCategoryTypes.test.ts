import { describe, expect, it } from "vitest";

import {
  buildGlobalServiceCategories,
  globalCategoryId,
  isServiceCategoryType,
  legacyCategoryTypeForId,
} from "./serviceCategoryTypes";
import { SERVICE_CATEGORY_TYPES } from "@/types";

describe("service category governance catalogue", () => {
  const ts = "2026-06-02T00:00:00.000Z";

  it("builds one global category per governed type, in declared order", () => {
    const cats = buildGlobalServiceCategories(ts);
    expect(cats).toHaveLength(SERVICE_CATEGORY_TYPES.length);
    cats.forEach((c, i) => {
      expect(c.companyId).toBeNull();
      expect(c.categoryType).toBe(SERVICE_CATEGORY_TYPES[i].value);
      expect(c.sortOrder).toBe(i);
      expect(c.id).toBe(globalCategoryId(SERVICE_CATEGORY_TYPES[i].value));
      expect(c.status).toBe("active");
      expect(c.updatedAt).toBe(ts);
    });
  });

  it("produces stable, unique ids", () => {
    const ids = buildGlobalServiceCategories(ts).map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("includes the seven required categories", () => {
    const types = buildGlobalServiceCategories(ts).map((c) => c.categoryType);
    expect(types).toEqual([
      "recurring_service",
      "one_time_service",
      "special_service",
      "window_cleaning",
      "non_billable",
      "absence",
      "information",
    ]);
  });
});

describe("isServiceCategoryType", () => {
  it("accepts governed types and rejects others", () => {
    expect(isServiceCategoryType("absence")).toBe(true);
    expect(isServiceCategoryType("window_cleaning")).toBe(true);
    expect(isServiceCategoryType("nope")).toBe(false);
    expect(isServiceCategoryType(undefined)).toBe(false);
    expect(isServiceCategoryType(42)).toBe(false);
  });
});

describe("legacyCategoryTypeForId", () => {
  it("maps known legacy ids to governed types", () => {
    expect(legacyCategoryTypeForId("svc_cat_recurring")).toBe("recurring_service");
    expect(legacyCategoryTypeForId("svc_cat_deep")).toBe("one_time_service");
    expect(legacyCategoryTypeForId("svc_cat_specialty")).toBe("special_service");
    expect(legacyCategoryTypeForId("svc_cat_commercial")).toBe("recurring_service");
  });

  it("returns undefined for unknown ids", () => {
    expect(legacyCategoryTypeForId("svc_cat_made_up")).toBeUndefined();
  });
});
