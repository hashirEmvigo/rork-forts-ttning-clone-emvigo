import { beforeEach, describe, expect, it } from "vitest";

import {
  archiveGlobalTemplate,
  copyGlobalTemplateToCompany,
  createGlobalTemplate,
  createSection,
  getGlobalTemplates,
  getItems,
  getSections,
  restoreGlobalTemplate,
  updateGlobalTemplate,
  updateItem,
  updateSection,
} from "./checklistTemplateStore";
import {
  resolveGlobalTemplateItems,
  resolveGlobalTemplateSections,
} from "./checklistSettingsResolver";
import { generateCustomerProtocol } from "./customerProtocolGenerator";
import {
  getCustomerProtocolItems,
  getCustomerProtocolSections,
} from "./customerProtocolStore";
import { generateProtocolRunFromCustomerProtocol } from "./protocolRunGenerator";
import { getRunItems, getRunSections } from "./protocolRunStore";
import {
  ALL_PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSION_MODULES,
} from "./permissions";

const COMPANY = "company-a";
const CUSTOMER = "customer-1";

beforeEach(() => {
  localStorage.clear();
});

describe("global template — Super Admin builder (sections & items)", () => {
  it("reads global sections/items only through the global resolver path", () => {
    const created = createGlobalTemplate({ name: "Builder Template" })!;
    const section = createSection(created.id, { title: "Lobby" })!;

    const sections = resolveGlobalTemplateSections(created.id);
    expect(sections.map((s) => s.id)).toContain(section.id);

    // The section/template carry no company scope.
    expect(section.companyId).toBeNull();
  });

  it("does not resolve a section that belongs to a different global template", () => {
    const a = createGlobalTemplate({ name: "Template A" })!;
    const b = createGlobalTemplate({ name: "Template B" })!;
    const sectionA = createSection(a.id, { title: "Section A" })!;

    expect(resolveGlobalTemplateItems(b.id, sectionA.id)).toHaveLength(0);
    expect(resolveGlobalTemplateItems(a.id, sectionA.id)).toEqual([]);
  });

  it("renames a global section without leaking into other globals", () => {
    const a = createGlobalTemplate({ name: "Alpha" })!;
    const section = createSection(a.id, { title: "Original" })!;
    updateSection(section.id, { title: "Renamed" });
    expect(resolveGlobalTemplateSections(a.id)[0].title).toBe("Renamed");
  });
});

describe("global template — edits only affect future copies", () => {
  it("editing a global never changes an existing company copy", () => {
    const [global] = getGlobalTemplates();
    const copy = copyGlobalTemplateToCompany(COMPANY, global.id)!;
    const copySection = getSections(copy.id)[0];
    const copyItemTitleBefore = getItems(copySection.id)[0].title;

    // Mutate the global after the copy was taken.
    const globalSection = getSections(global.id)[0];
    const globalItem = getItems(globalSection.id)[0];
    updateItem(globalItem.id, { title: "Global edit after copy" });
    updateGlobalTemplate(global.id, { name: `${global.name} (edited)` });

    const copyItemTitleAfter = getItems(copySection.id)[0].title;
    expect(copyItemTitleAfter).toBe(copyItemTitleBefore);
    expect(copyItemTitleAfter).not.toBe("Global edit after copy");
  });

  it("editing a global never changes a customer protocol created from it", () => {
    const [global] = getGlobalTemplates();
    const protocol = generateCustomerProtocol(COMPANY, CUSTOMER, global.id, {
      name: "Bergen – From Global",
    })!;
    const protoSection = getCustomerProtocolSections(protocol.id)[0];
    const protoItemTitleBefore = getCustomerProtocolItems(protoSection.id)[0].title;

    const globalSection = getSections(global.id)[0];
    const globalItem = getItems(globalSection.id)[0];
    updateItem(globalItem.id, { title: "Changed on global only" });

    const protoItemTitleAfter = getCustomerProtocolItems(protoSection.id)[0].title;
    expect(protoItemTitleAfter).toBe(protoItemTitleBefore);
  });

  it("editing a global never changes a generated protocol run", () => {
    const [global] = getGlobalTemplates();
    const protocol = generateCustomerProtocol(COMPANY, CUSTOMER, global.id, {
      name: "Run Source",
    })!;
    const run = generateProtocolRunFromCustomerProtocol(
      COMPANY,
      CUSTOMER,
      protocol.id,
      { generatedBy: "usr_root" },
    )!;
    const runSection = getRunSections(COMPANY, run.id)[0];
    const runItemTitleBefore = getRunItems(COMPANY, runSection.id)[0].title;

    const globalSection = getSections(global.id)[0];
    const globalItem = getItems(globalSection.id)[0];
    updateItem(globalItem.id, { title: "Global mutated post-run" });

    const runItemTitleAfter = getRunItems(COMPANY, runSection.id)[0].title;
    expect(runItemTitleAfter).toBe(runItemTitleBefore);
  });

  it("archiving and restoring a global never touches an existing copy", () => {
    const [global] = getGlobalTemplates();
    const copy = copyGlobalTemplateToCompany(COMPANY, global.id)!;
    archiveGlobalTemplate(global.id);
    restoreGlobalTemplate(global.id);
    // Copy remains active and intact.
    expect(getSections(copy.id).length).toBeGreaterThan(0);
  });
});

describe("global template — permission registration", () => {
  const KEYS = [
    "global_templates.view",
    "global_templates.create",
    "global_templates.edit",
    "global_templates.archive",
  ];

  it("registers all four global template keys under a dedicated module", () => {
    for (const key of KEYS) expect(ALL_PERMISSIONS).toContain(key);
    const module = PERMISSION_MODULES.find((m) => m.id === "global_templates");
    expect(module).toBeDefined();
    expect(module?.permissions.map((p) => p.key)).toEqual(KEYS);
  });

  it("grants the Super Admin full management by default", () => {
    for (const key of KEYS) {
      expect(DEFAULT_ROLE_PERMISSIONS.super_admin).toContain(key);
    }
  });

  it("grants the Company Admin view only — never edit/archive", () => {
    expect(DEFAULT_ROLE_PERMISSIONS.company_admin).toContain(
      "global_templates.view",
    );
    expect(DEFAULT_ROLE_PERMISSIONS.company_admin).not.toContain(
      "global_templates.create",
    );
    expect(DEFAULT_ROLE_PERMISSIONS.company_admin).not.toContain(
      "global_templates.edit",
    );
    expect(DEFAULT_ROLE_PERMISSIONS.company_admin).not.toContain(
      "global_templates.archive",
    );
  });

  it("does not grant global template access to employees or customers", () => {
    for (const role of ["employee", "customer"] as const) {
      for (const key of KEYS) {
        expect(DEFAULT_ROLE_PERMISSIONS[role]).not.toContain(key);
      }
    }
  });
});
