import { beforeEach, describe, expect, it } from "vitest";

import {
  archiveTemplate,
  createItem,
  createSection,
  createTemplate,
  deleteItem,
  deleteSection,
  getActiveTemplates,
  getAllTemplates,
  getItems,
  getSections,
  getTemplate,
  reorderItems,
  reorderSections,
  reorderTemplates,
  restoreTemplate,
  updateItem,
  updateSection,
  updateTemplate,
} from "./checklistTemplateStore";
import { DEFAULT_CHECKLIST_TEMPLATE_SPECS } from "@/types";

const COMPANY = "company-a";
const OTHER_COMPANY = "company-b";

beforeEach(() => {
  localStorage.clear();
});

describe("checklistTemplateStore — seeding", () => {
  it("lazily seeds default templates for a company on first read", () => {
    const active = getActiveTemplates(COMPANY);
    expect(active).toHaveLength(DEFAULT_CHECKLIST_TEMPLATE_SPECS.length);
    expect(active.map((t) => t.name)).toEqual(
      DEFAULT_CHECKLIST_TEMPLATE_SPECS.map((s) => s.name),
    );
    expect(active.every((t) => t.companyId === COMPANY)).toBe(true);
  });

  it("seeds nested sections and items for each template", () => {
    const [template] = getActiveTemplates(COMPANY);
    const sections = getSections(template.id);
    expect(sections.length).toBe(
      DEFAULT_CHECKLIST_TEMPLATE_SPECS[0].sections.length,
    );
    const firstSection = sections[0];
    const items = getItems(firstSection.id);
    expect(items.length).toBe(
      DEFAULT_CHECKLIST_TEMPLATE_SPECS[0].sections[0].items.length,
    );
    expect(items.every((i) => i.companyId === COMPANY)).toBe(true);
    expect(items.every((i) => i.templateId === template.id)).toBe(true);
  });

  it("scopes templates per company", () => {
    createTemplate(COMPANY, { name: "Window Washing" });
    expect(
      getAllTemplates(OTHER_COMPANY).some((t) => t.name === "Window Washing"),
    ).toBe(false);
  });
});

describe("checklistTemplateStore — template create & update", () => {
  it("creates a template appended after the seeded ones", () => {
    const before = getActiveTemplates(COMPANY).length;
    const created = createTemplate(COMPANY, {
      name: "Window Washing",
      description: "  Exterior glass  ",
    });
    expect(created).not.toBeNull();
    expect(created?.description).toBe("Exterior glass");
    expect(getActiveTemplates(COMPANY)).toHaveLength(before + 1);
  });

  it("rejects duplicate template names case-insensitively", () => {
    const existing = getActiveTemplates(COMPANY)[0];
    expect(
      createTemplate(COMPANY, { name: existing.name.toUpperCase() }),
    ).toBeNull();
  });

  it("rejects empty/whitespace names", () => {
    expect(createTemplate(COMPANY, { name: "   " })).toBeNull();
  });

  it("updates editable fields and category/floor links", () => {
    const target = getActiveTemplates(COMPANY)[0];
    const updated = updateTemplate(COMPANY, target.id, {
      name: "Renamed Template",
      categoryIds: ["cat-1", "cat-2"],
      floorPresetIds: ["floor-1"],
    });
    expect(updated?.name).toBe("Renamed Template");
    expect(updated?.categoryIds).toEqual(["cat-1", "cat-2"]);
    expect(updated?.floorPresetIds).toEqual(["floor-1"]);
  });

  it("creates a template with category and floor preset bindings", () => {
    const created = createTemplate(COMPANY, {
      name: "Bound Template",
      categoryIds: ["cat-1", "cat-2"],
      floorPresetIds: ["floor-1"],
    });
    expect(created?.categoryIds).toEqual(["cat-1", "cat-2"]);
    expect(created?.floorPresetIds).toEqual(["floor-1"]);
  });

  it("defaults bindings to empty arrays when omitted", () => {
    const created = createTemplate(COMPANY, { name: "Unbound Template" });
    expect(created?.categoryIds).toEqual([]);
    expect(created?.floorPresetIds).toEqual([]);
  });

  it("preserves bindings through archive and restore", () => {
    const created = createTemplate(COMPANY, {
      name: "Archivable Template",
      categoryIds: ["cat-9"],
      floorPresetIds: ["floor-9"],
    });
    expect(created).not.toBeNull();
    archiveTemplate(COMPANY, created!.id);
    const archived = getTemplate(COMPANY, created!.id);
    expect(archived?.isArchived).toBe(true);
    expect(archived?.categoryIds).toEqual(["cat-9"]);
    expect(archived?.floorPresetIds).toEqual(["floor-9"]);
    restoreTemplate(COMPANY, created!.id);
    const restored = getTemplate(COMPANY, created!.id);
    expect(restored?.categoryIds).toEqual(["cat-9"]);
    expect(restored?.floorPresetIds).toEqual(["floor-9"]);
  });

  it("leaves bindings untouched when updating only metadata", () => {
    const created = createTemplate(COMPANY, {
      name: "Metadata Template",
      categoryIds: ["cat-5"],
      floorPresetIds: ["floor-5"],
    });
    const updated = updateTemplate(COMPANY, created!.id, {
      description: "new note",
    });
    expect(updated?.categoryIds).toEqual(["cat-5"]);
    expect(updated?.floorPresetIds).toEqual(["floor-5"]);
  });

  it("rejects renaming onto another template's name", () => {
    const templates = getActiveTemplates(COMPANY);
    expect(
      updateTemplate(COMPANY, templates[1].id, { name: templates[0].name }),
    ).toBeNull();
  });
});

describe("checklistTemplateStore — archive & restore", () => {
  it("archives then restores a template back into the active list", () => {
    const target = getActiveTemplates(COMPANY)[0];

    archiveTemplate(COMPANY, target.id);
    expect(getActiveTemplates(COMPANY).some((t) => t.id === target.id)).toBe(
      false,
    );
    expect(getTemplate(COMPANY, target.id)?.isArchived).toBe(true);
    expect(getAllTemplates(COMPANY).some((t) => t.id === target.id)).toBe(true);

    restoreTemplate(COMPANY, target.id);
    expect(getTemplate(COMPANY, target.id)?.isArchived).toBe(false);
    expect(getActiveTemplates(COMPANY).some((t) => t.id === target.id)).toBe(
      true,
    );
  });
});

describe("checklistTemplateStore — ordering", () => {
  it("seeds templates in deterministic sortOrder", () => {
    const orders = getActiveTemplates(COMPANY).map((t) => t.sortOrder);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });

  it("reorders templates to match the provided id order", () => {
    const reversed = [...getActiveTemplates(COMPANY)].reverse().map((t) => t.id);
    reorderTemplates(COMPANY, reversed);
    expect(getActiveTemplates(COMPANY).map((t) => t.id)).toEqual(reversed);
  });
});

describe("checklistTemplateStore — sections", () => {
  it("creates a section under a template and appends it", () => {
    const template = getActiveTemplates(COMPANY)[0];
    const before = getSections(template.id).length;
    const created = createSection(template.id, { title: "Hallways" });
    expect(created).not.toBeNull();
    expect(created?.companyId).toBe(COMPANY);
    expect(getSections(template.id)).toHaveLength(before + 1);
  });

  it("rejects sections for an unknown template", () => {
    expect(createSection("missing", { title: "Nope" })).toBeNull();
  });

  it("updates a section title", () => {
    const template = getActiveTemplates(COMPANY)[0];
    const section = getSections(template.id)[0];
    const updated = updateSection(section.id, { title: "Updated Title" });
    expect(updated?.title).toBe("Updated Title");
  });

  it("deletes a section and cascades to its items", () => {
    const template = getActiveTemplates(COMPANY)[0];
    const section = getSections(template.id)[0];
    expect(getItems(section.id).length).toBeGreaterThan(0);

    expect(deleteSection(section.id)).toBe(true);
    expect(getSections(template.id).some((s) => s.id === section.id)).toBe(
      false,
    );
    expect(getItems(section.id)).toHaveLength(0);
  });

  it("reorders sections within a template", () => {
    const template = getActiveTemplates(COMPANY)[0];
    const reversed = [...getSections(template.id)].reverse().map((s) => s.id);
    reorderSections(template.id, reversed);
    expect(getSections(template.id).map((s) => s.id)).toEqual(reversed);
  });
});

describe("checklistTemplateStore — items", () => {
  it("creates an item under a section and appends it", () => {
    const template = getActiveTemplates(COMPANY)[0];
    const section = getSections(template.id)[0];
    const before = getItems(section.id).length;
    const created = createItem(section.id, {
      title: "Polish handles",
      required: true,
    });
    expect(created).not.toBeNull();
    expect(created?.required).toBe(true);
    expect(created?.templateId).toBe(template.id);
    expect(getItems(section.id)).toHaveLength(before + 1);
  });

  it("rejects items for an unknown section", () => {
    expect(createItem("missing", { title: "Nope" })).toBeNull();
  });

  it("updates an item's fields", () => {
    const section = getSections(getActiveTemplates(COMPANY)[0].id)[0];
    const item = getItems(section.id)[0];
    const updated = updateItem(item.id, {
      title: "New title",
      description: "  detail  ",
      required: true,
    });
    expect(updated?.title).toBe("New title");
    expect(updated?.description).toBe("detail");
    expect(updated?.required).toBe(true);
  });

  it("deletes an item", () => {
    const section = getSections(getActiveTemplates(COMPANY)[0].id)[0];
    const item = getItems(section.id)[0];
    expect(deleteItem(item.id)).toBe(true);
    expect(getItems(section.id).some((i) => i.id === item.id)).toBe(false);
  });

  it("reorders items within a section", () => {
    const section = getSections(getActiveTemplates(COMPANY)[0].id)[0];
    const reversed = [...getItems(section.id)].reverse().map((i) => i.id);
    reorderItems(section.id, reversed);
    expect(getItems(section.id).map((i) => i.id)).toEqual(reversed);
  });
});

describe("checklistTemplateStore — persistence", () => {
  it("persists created data across fresh reads (no in-memory cache)", () => {
    const template = createTemplate(COMPANY, { name: "Persisted" });
    expect(template).not.toBeNull();
    const section = createSection(template!.id, { title: "Persisted Section" });
    createItem(section!.id, { title: "Persisted Item" });

    // Re-read straight from storage-backed getters.
    expect(getAllTemplates(COMPANY).some((t) => t.id === template!.id)).toBe(
      true,
    );
    expect(getSections(template!.id).some((s) => s.id === section!.id)).toBe(
      true,
    );
    expect(getItems(section!.id).map((i) => i.title)).toContain(
      "Persisted Item",
    );
  });
});
