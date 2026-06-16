import { beforeEach, describe, expect, it } from "vitest";

import {
  archiveCustomerProtocol,
  createCustomerProtocol,
  createCustomerProtocolItem,
  createCustomerProtocolSection,
  deleteCustomerProtocolItem,
  deleteCustomerProtocolSection,
  getCustomerProtocol,
  getCustomerProtocolItems,
  getCustomerProtocolSections,
  getCustomerProtocols,
  reorderCustomerProtocolItems,
  reorderCustomerProtocolSections,
  restoreCustomerProtocol,
  updateCustomerProtocol,
  updateCustomerProtocolItem,
  updateCustomerProtocolSection,
} from "./customerProtocolStore";
import { generateCustomerProtocol } from "./customerProtocolGenerator";
import {
  resolveCustomerProtocol,
  resolveCustomerProtocolItems,
  resolveCustomerProtocols,
  resolveCustomerProtocolSections,
} from "./checklistSettingsResolver";
import {
  createItem,
  createSection,
  createTemplate,
  getActiveTemplates,
  getItems,
  getSections,
  updateSection,
} from "./checklistTemplateStore";
import type { ChecklistTemplateV2 } from "@/types";

const COMPANY = "company-a";
const OTHER_COMPANY = "company-b";
const CUSTOMER = "customer-1";
const OTHER_CUSTOMER = "customer-2";

beforeEach(() => {
  localStorage.clear();
});

/** Seeds the company and returns its first template (with sections + items). */
function seedTemplate(): ChecklistTemplateV2 {
  return getActiveTemplates(COMPANY)[0];
}

describe("customerProtocolStore — creation & metadata", () => {
  it("creates a customer protocol with metadata", () => {
    const template = seedTemplate();
    const protocol = createCustomerProtocol(COMPANY, {
      customerId: CUSTOMER,
      sourceTemplateId: template.id,
      sourceTemplateName: template.name,
      sourceTemplateVersion: 1,
      name: "Bergen – Recurring",
      description: "Weekly clean",
      categoryIds: ["cat-1"],
      floorPresetIds: ["floor-1"],
    });
    expect(protocol).not.toBeNull();
    expect(protocol?.companyId).toBe(COMPANY);
    expect(protocol?.customerId).toBe(CUSTOMER);
    expect(protocol?.isArchived).toBe(false);
    expect(protocol?.categoryIds).toEqual(["cat-1"]);
  });

  it("rejects a duplicate name within the same customer", () => {
    const template = seedTemplate();
    const base = {
      customerId: CUSTOMER,
      sourceTemplateId: template.id,
      sourceTemplateName: template.name,
      sourceTemplateVersion: 1,
    };
    expect(createCustomerProtocol(COMPANY, { ...base, name: "Dup" })).not.toBeNull();
    expect(createCustomerProtocol(COMPANY, { ...base, name: "dup" })).toBeNull();
  });

  it("allows the same name for a different customer", () => {
    const template = seedTemplate();
    const base = {
      sourceTemplateId: template.id,
      sourceTemplateName: template.name,
      sourceTemplateVersion: 1,
      name: "Shared name",
    };
    expect(
      createCustomerProtocol(COMPANY, { ...base, customerId: CUSTOMER }),
    ).not.toBeNull();
    expect(
      createCustomerProtocol(COMPANY, { ...base, customerId: OTHER_CUSTOMER }),
    ).not.toBeNull();
  });

  it("updates metadata in place", () => {
    const template = seedTemplate();
    const protocol = createCustomerProtocol(COMPANY, {
      customerId: CUSTOMER,
      sourceTemplateId: template.id,
      sourceTemplateName: template.name,
      sourceTemplateVersion: 1,
      name: "Before",
    })!;
    const updated = updateCustomerProtocol(COMPANY, protocol.id, {
      name: "After",
      description: "Now described",
    });
    expect(updated?.name).toBe("After");
    expect(updated?.description).toBe("Now described");
  });
});

describe("customerProtocolStore — scoping", () => {
  it("scopes protocols per company and customer", () => {
    const template = seedTemplate();
    createCustomerProtocol(COMPANY, {
      customerId: CUSTOMER,
      sourceTemplateId: template.id,
      sourceTemplateName: template.name,
      sourceTemplateVersion: 1,
      name: "Mine",
    });
    expect(getCustomerProtocols(COMPANY, CUSTOMER)).toHaveLength(1);
    expect(getCustomerProtocols(COMPANY, OTHER_CUSTOMER)).toHaveLength(0);
    expect(getCustomerProtocols(OTHER_COMPANY, CUSTOMER)).toHaveLength(0);
  });
});

describe("customerProtocolStore — archive / restore", () => {
  it("archives and restores while preserving bindings and content", () => {
    const template = seedTemplate();
    const protocol = generateCustomerProtocol(COMPANY, CUSTOMER, template.id)!;
    const sectionsBefore = getCustomerProtocolSections(protocol.id).length;

    const archived = archiveCustomerProtocol(COMPANY, protocol.id);
    expect(archived?.isArchived).toBe(true);
    expect(getCustomerProtocols(COMPANY, CUSTOMER)).toHaveLength(0);
    expect(
      getCustomerProtocols(COMPANY, CUSTOMER, { includeArchived: true }),
    ).toHaveLength(1);
    // Content preserved while archived.
    expect(getCustomerProtocolSections(protocol.id).length).toBe(sectionsBefore);

    const restored = restoreCustomerProtocol(COMPANY, protocol.id);
    expect(restored?.isArchived).toBe(false);
    expect(getCustomerProtocols(COMPANY, CUSTOMER)).toHaveLength(1);
  });
});

describe("customerProtocolStore — sections & items", () => {
  function blankProtocol() {
    const template = seedTemplate();
    return createCustomerProtocol(COMPANY, {
      customerId: CUSTOMER,
      sourceTemplateId: template.id,
      sourceTemplateName: template.name,
      sourceTemplateVersion: 1,
      name: "Blank",
    })!;
  }

  it("creates, updates and deletes sections (cascading items)", () => {
    const protocol = blankProtocol();
    const section = createCustomerProtocolSection(protocol.id, {
      title: "Kitchen",
    })!;
    expect(section.title).toBe("Kitchen");

    const item = createCustomerProtocolItem(section.id, {
      title: "Clean sink",
      required: true,
    })!;
    expect(getCustomerProtocolItems(section.id)).toHaveLength(1);

    updateCustomerProtocolSection(section.id, { title: "Galley" });
    expect(getCustomerProtocolSections(protocol.id)[0].title).toBe("Galley");

    expect(deleteCustomerProtocolSection(section.id)).toBe(true);
    expect(getCustomerProtocolSections(protocol.id)).toHaveLength(0);
    // Cascade: the item is gone too.
    expect(getCustomerProtocolItems(section.id)).toHaveLength(0);
    expect(item.required).toBe(true);
  });

  it("creates, updates and deletes items with the required flag", () => {
    const protocol = blankProtocol();
    const section = createCustomerProtocolSection(protocol.id, {
      title: "Bathroom",
    })!;
    const item = createCustomerProtocolItem(section.id, {
      title: "Mop floor",
    })!;
    expect(item.required).toBe(false);

    const updated = updateCustomerProtocolItem(item.id, { required: true });
    expect(updated?.required).toBe(true);

    expect(deleteCustomerProtocolItem(item.id)).toBe(true);
    expect(getCustomerProtocolItems(section.id)).toHaveLength(0);
  });

  it("reorders sections and items", () => {
    const protocol = blankProtocol();
    const a = createCustomerProtocolSection(protocol.id, { title: "A" })!;
    const b = createCustomerProtocolSection(protocol.id, { title: "B" })!;
    reorderCustomerProtocolSections(protocol.id, [b.id, a.id]);
    expect(getCustomerProtocolSections(protocol.id).map((s) => s.title)).toEqual([
      "B",
      "A",
    ]);

    const i1 = createCustomerProtocolItem(a.id, { title: "one" })!;
    const i2 = createCustomerProtocolItem(a.id, { title: "two" })!;
    reorderCustomerProtocolItems(a.id, [i2.id, i1.id]);
    expect(getCustomerProtocolItems(a.id).map((i) => i.title)).toEqual([
      "two",
      "one",
    ]);
  });
});

describe("customerProtocolGenerator — deep copy & independence", () => {
  it("deep-copies template structure into an independent protocol", () => {
    const template = seedTemplate();
    const protocol = generateCustomerProtocol(COMPANY, CUSTOMER, template.id)!;
    expect(protocol.sourceTemplateId).toBe(template.id);
    expect(protocol.sourceTemplateName).toBe(template.name);

    const templateSections = getSections(template.id);
    const protocolSections = getCustomerProtocolSections(protocol.id);
    expect(protocolSections).toHaveLength(templateSections.length);
    // Fresh ids, provenance retained.
    protocolSections.forEach((section, index) => {
      expect(section.id).not.toBe(templateSections[index].id);
      expect(section.sourceSectionId).toBe(templateSections[index].id);
      expect(section.title).toBe(templateSections[index].title);
    });
  });

  it("template edits do NOT affect an existing protocol", () => {
    const template = seedTemplate();
    const protocol = generateCustomerProtocol(COMPANY, CUSTOMER, template.id)!;
    const firstTemplateSection = getSections(template.id)[0];
    const protocolTitleBefore = getCustomerProtocolSections(protocol.id)[0].title;

    updateSection(firstTemplateSection.id, { title: "Template renamed" });

    expect(getCustomerProtocolSections(protocol.id)[0].title).toBe(
      protocolTitleBefore,
    );
  });

  it("protocol edits do NOT affect the source template", () => {
    const template = seedTemplate();
    const protocol = generateCustomerProtocol(COMPANY, CUSTOMER, template.id)!;
    const protocolSection = getCustomerProtocolSections(protocol.id)[0];
    const templateTitleBefore = getSections(template.id)[0].title;

    updateCustomerProtocolSection(protocolSection.id, {
      title: "Protocol renamed",
    });

    expect(getSections(template.id)[0].title).toBe(templateTitleBefore);
  });

  it("adding a section to the protocol leaves the template untouched", () => {
    const template = seedTemplate();
    const firstSection = getSections(template.id)[0];
    const templateItemCount = getItems(firstSection.id).length;
    const protocol = generateCustomerProtocol(COMPANY, CUSTOMER, template.id)!;

    const protocolSection = getCustomerProtocolSections(protocol.id)[0];
    createCustomerProtocolItem(protocolSection.id, { title: "Extra task" });

    expect(getItems(firstSection.id).length).toBe(templateItemCount);
  });

  it("returns null when the template does not exist for the company", () => {
    expect(generateCustomerProtocol(COMPANY, CUSTOMER, "missing")).toBeNull();
  });
});

describe("customerProtocol resolver", () => {
  it("resolves active protocols and hides archived by default", () => {
    const template = seedTemplate();
    const protocol = generateCustomerProtocol(COMPANY, CUSTOMER, template.id)!;
    expect(resolveCustomerProtocols(COMPANY, CUSTOMER)).toHaveLength(1);

    archiveCustomerProtocol(COMPANY, protocol.id);
    expect(resolveCustomerProtocols(COMPANY, CUSTOMER)).toHaveLength(0);
    expect(
      resolveCustomerProtocols(COMPANY, CUSTOMER, { includeArchived: true }),
    ).toHaveLength(1);
  });

  it("scopes single-protocol reads by customer", () => {
    const template = seedTemplate();
    const protocol = generateCustomerProtocol(COMPANY, CUSTOMER, template.id)!;
    expect(
      resolveCustomerProtocol(COMPANY, CUSTOMER, protocol.id),
    ).not.toBeNull();
    expect(
      resolveCustomerProtocol(COMPANY, OTHER_CUSTOMER, protocol.id),
    ).toBeNull();
  });

  it("resolves sections and items only for the owning customer", () => {
    const template = seedTemplate();
    const protocol = generateCustomerProtocol(COMPANY, CUSTOMER, template.id)!;
    const sections = resolveCustomerProtocolSections(
      COMPANY,
      CUSTOMER,
      protocol.id,
    );
    expect(sections.length).toBeGreaterThan(0);
    expect(
      resolveCustomerProtocolSections(COMPANY, OTHER_CUSTOMER, protocol.id),
    ).toHaveLength(0);

    const items = resolveCustomerProtocolItems(
      COMPANY,
      CUSTOMER,
      sections[0].id,
    );
    expect(items.length).toBeGreaterThan(0);
    expect(
      resolveCustomerProtocolItems(COMPANY, OTHER_CUSTOMER, sections[0].id),
    ).toHaveLength(0);
  });

  it("returns empty for a custom-built section query when scoped wrong", () => {
    const template = seedTemplate();
    createTemplate(COMPANY, { name: "Tmp" });
    const protocol = generateCustomerProtocol(COMPANY, CUSTOMER, template.id)!;
    const section = createCustomerProtocolSection(protocol.id, {
      title: "Custom",
    })!;
    const created = createSection(template.id, { title: "Ignored" });
    expect(created).not.toBeNull();
    expect(
      resolveCustomerProtocolItems(OTHER_COMPANY, CUSTOMER, section.id),
    ).toHaveLength(0);
  });
});
