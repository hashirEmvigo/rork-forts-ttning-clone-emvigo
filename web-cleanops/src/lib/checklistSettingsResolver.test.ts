import { beforeEach, describe, expect, it } from "vitest";

import {
  resolveChecklistCategories,
  resolveChecklistCategoriesByType,
  resolveChecklistCategoryById,
  resolveChecklistItems,
  resolveChecklistSections,
  resolveChecklistTemplate,
  resolveChecklistTemplates,
  resolveFloorPresetById,
  resolveFloorPresets,
} from "./checklistSettingsResolver";
import {
  archiveChecklistCategory,
  getActiveChecklistCategories,
} from "./checklistCategoryStore";
import {
  archiveFloorPreset,
  getActiveFloorPresets,
} from "./floorPresetStore";
import {
  archiveTemplate,
  getActiveTemplates,
  getSections,
} from "./checklistTemplateStore";
import { CHECKLIST_CATEGORY_TYPES } from "@/types";

const COMPANY = "company-a";

beforeEach(() => {
  localStorage.clear();
});

describe("resolver — floor presets", () => {
  it("returns active presets by default and includes archived only when requested", () => {
    const target = getActiveFloorPresets(COMPANY)[0];
    archiveFloorPreset(COMPANY, target.id);

    expect(resolveFloorPresets(COMPANY).some((p) => p.id === target.id)).toBe(false);
    expect(
      resolveFloorPresets(COMPANY, { includeArchived: true }).some(
        (p) => p.id === target.id,
      ),
    ).toBe(true);
  });

  it("resolveFloorPresetById returns null for archived items unless includeArchived", () => {
    const target = getActiveFloorPresets(COMPANY)[0];
    archiveFloorPreset(COMPANY, target.id);

    expect(resolveFloorPresetById(COMPANY, target.id)).toBeNull();
    expect(
      resolveFloorPresetById(COMPANY, target.id, { includeArchived: true })?.id,
    ).toBe(target.id);
  });

  it("returns null for an unknown preset id", () => {
    expect(resolveFloorPresetById(COMPANY, "does-not-exist")).toBeNull();
  });
});

describe("resolver — categories", () => {
  it("returns active categories by type and includes archived only when requested", () => {
    const target = getActiveChecklistCategories(COMPANY, "room")[0];
    archiveChecklistCategory(COMPANY, target.id);

    expect(
      resolveChecklistCategories(COMPANY, "room").some((c) => c.id === target.id),
    ).toBe(false);
    expect(
      resolveChecklistCategories(COMPANY, "room", { includeArchived: true }).some(
        (c) => c.id === target.id,
      ),
    ).toBe(true);
  });

  it("returns grouped categories for all types", () => {
    const grouped = resolveChecklistCategoriesByType(COMPANY);
    for (const type of CHECKLIST_CATEGORY_TYPES) {
      expect(Array.isArray(grouped[type])).toBe(true);
      expect(grouped[type].length).toBeGreaterThan(0);
      expect(grouped[type].every((c) => c.type === type)).toBe(true);
    }
  });

  it("resolveChecklistCategoryById returns null for archived items unless includeArchived", () => {
    const target = getActiveChecklistCategories(COMPANY, "task")[0];
    archiveChecklistCategory(COMPANY, target.id);

    expect(resolveChecklistCategoryById(COMPANY, target.id)).toBeNull();
    expect(
      resolveChecklistCategoryById(COMPANY, target.id, { includeArchived: true })?.id,
    ).toBe(target.id);
  });
});

describe("resolver — templates", () => {
  it("returns active templates by default and includes archived only when requested", () => {
    const target = getActiveTemplates(COMPANY)[0];
    archiveTemplate(COMPANY, target.id);

    expect(
      resolveChecklistTemplates(COMPANY).some((t) => t.id === target.id),
    ).toBe(false);
    expect(
      resolveChecklistTemplates(COMPANY, { includeArchived: true }).some(
        (t) => t.id === target.id,
      ),
    ).toBe(true);
  });

  it("resolveChecklistTemplate returns null for archived items unless includeArchived", () => {
    const target = getActiveTemplates(COMPANY)[0];
    archiveTemplate(COMPANY, target.id);

    expect(resolveChecklistTemplate(COMPANY, target.id)).toBeNull();
    expect(
      resolveChecklistTemplate(COMPANY, target.id, { includeArchived: true })?.id,
    ).toBe(target.id);
  });

  it("is company-scoped: another company cannot read a template", () => {
    const target = getActiveTemplates(COMPANY)[0];
    expect(resolveChecklistTemplate("company-z", target.id)).toBeNull();
    expect(resolveChecklistSections("company-z", target.id)).toEqual([]);
  });

  it("resolves ordered sections and items for a template", () => {
    const template = getActiveTemplates(COMPANY)[0];
    const sections = resolveChecklistSections(COMPANY, template.id);
    expect(sections.length).toBeGreaterThan(0);
    expect(sections).toEqual(getSections(template.id));

    const items = resolveChecklistItems(COMPANY, sections[0].id);
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.sectionId === sections[0].id)).toBe(true);
  });

  it("returns empty for unknown template/section ids", () => {
    expect(resolveChecklistSections(COMPANY, "missing")).toEqual([]);
    expect(resolveChecklistItems(COMPANY, "missing")).toEqual([]);
  });
});
