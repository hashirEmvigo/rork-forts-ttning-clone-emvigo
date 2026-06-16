import { beforeEach, describe, expect, it } from "vitest";

import {
  archiveChecklistCategory,
  createChecklistCategory,
  getActiveChecklistCategories,
  getAllChecklistCategories,
  getChecklistCategory,
  reorderChecklistCategories,
  unarchiveChecklistCategory,
  updateChecklistCategory,
} from "./checklistCategoryStore";
import {
  CHECKLIST_CATEGORY_TYPES,
  DEFAULT_CHECKLIST_CATEGORY_SPECS,
} from "@/types";

const COMPANY = "company-a";

beforeEach(() => {
  localStorage.clear();
});

describe("checklistCategoryStore — seeding", () => {
  it("lazily seeds defaults per company and type", () => {
    for (const type of CHECKLIST_CATEGORY_TYPES) {
      const active = getActiveChecklistCategories(COMPANY, type);
      expect(active).toHaveLength(DEFAULT_CHECKLIST_CATEGORY_SPECS[type].length);
      expect(active.every((c) => c.companyId === COMPANY && c.type === type)).toBe(
        true,
      );
    }
  });
});

describe("checklistCategoryStore — active vs archived reads", () => {
  it("excludes archived categories from active reads but keeps them in all", () => {
    const target = getActiveChecklistCategories(COMPANY, "room")[0];
    archiveChecklistCategory(COMPANY, target.id);

    expect(
      getActiveChecklistCategories(COMPANY, "room").some((c) => c.id === target.id),
    ).toBe(false);
    expect(
      getAllChecklistCategories(COMPANY, "room").some(
        (c) => c.id === target.id && c.isArchived,
      ),
    ).toBe(true);
  });
});

describe("checklistCategoryStore — duplicate rules", () => {
  it("rejects duplicate names within the same company + type", () => {
    const existing = getActiveChecklistCategories(COMPANY, "room")[0];
    const dup = createChecklistCategory(COMPANY, "room", {
      name: existing.name.toLowerCase(),
    });
    expect(dup).toBeNull();
  });

  it("allows the same name across different types", () => {
    const created = createChecklistCategory(COMPANY, "task", {
      name: "Shared Name",
    });
    const createdOther = createChecklistCategory(COMPANY, "media", {
      name: "Shared Name",
    });
    expect(created).not.toBeNull();
    expect(createdOther).not.toBeNull();
  });

  it("rejects renaming onto another category's name in the same type", () => {
    const cats = getActiveChecklistCategories(COMPANY, "task");
    const updated = updateChecklistCategory(COMPANY, cats[1].id, {
      name: cats[0].name,
    });
    expect(updated).toBeNull();
  });
});

describe("checklistCategoryStore — deterministic sorting", () => {
  it("orders by sortOrder", () => {
    const cats = getActiveChecklistCategories(COMPANY, "quality");
    const orders = cats.map((c) => c.sortOrder);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });
});

describe("checklistCategoryStore — reorder", () => {
  it("rewrites sortOrder to match the provided id order within a type", () => {
    const cats = getActiveChecklistCategories(COMPANY, "instruction");
    const reversedIds = [...cats].reverse().map((c) => c.id);
    reorderChecklistCategories(COMPANY, "instruction", reversedIds);

    const after = getActiveChecklistCategories(COMPANY, "instruction");
    expect(after.map((c) => c.id)).toEqual(reversedIds);
  });
});

describe("checklistCategoryStore — archive & restore", () => {
  it("archives then restores a category", () => {
    const target = getActiveChecklistCategories(COMPANY, "template")[0];

    archiveChecklistCategory(COMPANY, target.id);
    expect(getChecklistCategory(COMPANY, target.id)?.isArchived).toBe(true);

    unarchiveChecklistCategory(COMPANY, target.id);
    expect(getChecklistCategory(COMPANY, target.id)?.isArchived).toBe(false);
    expect(
      getActiveChecklistCategories(COMPANY, "template").some(
        (c) => c.id === target.id,
      ),
    ).toBe(true);
  });
});
