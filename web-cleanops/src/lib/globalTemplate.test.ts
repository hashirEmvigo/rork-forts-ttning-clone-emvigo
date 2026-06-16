import { beforeEach, describe, expect, it } from "vitest";

import {
  archiveGlobalTemplate,
  copyGlobalTemplateToCompany,
  createGlobalTemplate,
  createTemplate,
  getActiveTemplates,
  getGlobalTemplate,
  getGlobalTemplates,
  getItems,
  getSections,
  getTemplate,
  restoreGlobalTemplate,
  updateGlobalTemplate,
  updateItem,
} from "./checklistTemplateStore";
import {
  resolveCompanyTemplates,
  resolveGlobalTemplate,
  resolveGlobalTemplates,
} from "./checklistSettingsResolver";
import { generateCustomerProtocol } from "./customerProtocolGenerator";
import {
  getCustomerProtocolItems,
  getCustomerProtocolSections,
} from "./customerProtocolStore";
import type { ChecklistTemplateV2 } from "@/types";

const COMPANY = "company-a";
const OTHER_COMPANY = "company-b";
const CUSTOMER = "customer-1";
const TEMPLATES_KEY = "cleanops.checklistTemplates";

beforeEach(() => {
  localStorage.clear();
});

describe("global template — scope separation", () => {
  it("seeds a global library that is system-owned (scope=global, companyId=null)", () => {
    const globals = getGlobalTemplates();
    expect(globals.length).toBeGreaterThan(0);
    expect(globals.every((t) => t.scope === "global")).toBe(true);
    expect(globals.every((t) => t.companyId === null)).toBe(true);
  });

  it("keeps company and global templates in separate collections", () => {
    const globals = getGlobalTemplates();
    const company = getActiveTemplates(COMPANY);

    // Company reads never surface globals…
    expect(company.every((t) => t.scope === "company")).toBe(true);
    expect(company.every((t) => t.companyId === COMPANY)).toBe(true);
    // …and global reads never surface company templates.
    expect(globals.some((g) => company.some((c) => c.id === g.id))).toBe(false);
  });

  it("does not expose a global template through company lookups", () => {
    const [global] = getGlobalTemplates();
    expect(getTemplate(COMPANY, global.id)).toBeNull();
    expect(getGlobalTemplate(global.id)?.id).toBe(global.id);
  });
});

describe("global template — migration of legacy records", () => {
  it("migrates pre-scope company templates to scope=company on read", () => {
    // A legacy template persisted before `scope` existed (has companyId, no scope).
    const legacy = {
      id: "ctpl_legacy",
      companyId: COMPANY,
      name: "Legacy Template",
      categoryIds: [],
      floorPresetIds: [],
      sortOrder: 0,
      isArchived: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as unknown as ChecklistTemplateV2;
    localStorage.setItem(TEMPLATES_KEY, JSON.stringify([legacy]));

    const found = getTemplate(COMPANY, "ctpl_legacy");
    expect(found?.scope).toBe("company");
    expect(getActiveTemplates(COMPANY).some((t) => t.id === "ctpl_legacy")).toBe(
      true,
    );
  });
});

describe("global template — Super Admin management", () => {
  it("creates, updates, archives and restores a global template", () => {
    const created = createGlobalTemplate({ name: "Window Cleaning" });
    expect(created?.scope).toBe("global");
    expect(created?.companyId).toBeNull();

    const updated = updateGlobalTemplate(created!.id, {
      description: "Best-practice window routine",
    });
    expect(updated?.description).toBe("Best-practice window routine");

    archiveGlobalTemplate(created!.id);
    expect(getGlobalTemplates().some((t) => t.id === created!.id)).toBe(false);
    expect(
      getGlobalTemplates({ includeArchived: true }).some(
        (t) => t.id === created!.id,
      ),
    ).toBe(true);

    restoreGlobalTemplate(created!.id);
    expect(getGlobalTemplates().some((t) => t.id === created!.id)).toBe(true);
  });

  it("rejects duplicate global names", () => {
    const [first] = getGlobalTemplates();
    expect(createGlobalTemplate({ name: first.name })).toBeNull();
  });
});

describe("global template — copy to company", () => {
  it("deep-copies metadata, bindings, sections and items with fresh ids", () => {
    const [global] = getGlobalTemplates();
    const sourceSections = getSections(global.id);
    const sourceItemCount = sourceSections.reduce(
      (sum, s) => sum + getItems(s.id).length,
      0,
    );

    const copy = copyGlobalTemplateToCompany(COMPANY, global.id);
    expect(copy).not.toBeNull();
    expect(copy!.scope).toBe("company");
    expect(copy!.companyId).toBe(COMPANY);
    expect(copy!.id).not.toBe(global.id);
    expect(copy!.sourceGlobalTemplateId).toBe(global.id);
    expect(copy!.sourceGlobalTemplateName).toBe(global.name);

    const copiedSections = getSections(copy!.id);
    expect(copiedSections).toHaveLength(sourceSections.length);
    // Fresh ids — no shared identity with the source.
    expect(
      copiedSections.some((c) => sourceSections.some((s) => s.id === c.id)),
    ).toBe(false);
    const copiedItemCount = copiedSections.reduce(
      (sum, s) => sum + getItems(s.id).length,
      0,
    );
    expect(copiedItemCount).toBe(sourceItemCount);
    // Copy appears in company reads, not as a global.
    expect(getActiveTemplates(COMPANY).some((t) => t.id === copy!.id)).toBe(
      true,
    );
    expect(getGlobalTemplates().some((t) => t.id === copy!.id)).toBe(false);
  });

  it("is independent — editing the copy never affects the global", () => {
    const [global] = getGlobalTemplates();
    const copy = copyGlobalTemplateToCompany(COMPANY, global.id)!;
    const copySection = getSections(copy.id)[0];
    const copyItem = getItems(copySection.id)[0];

    updateItem(copyItem.id, { title: "Changed only on the copy" });

    const globalSection = getSections(global.id)[0];
    const globalItem = getItems(globalSection.id)[0];
    expect(globalItem.title).not.toBe("Changed only on the copy");
  });

  it("dedupes the copy name when it clashes with an existing company template", () => {
    const [global] = getGlobalTemplates();
    createTemplate(COMPANY, { name: global.name });
    const copy = copyGlobalTemplateToCompany(COMPANY, global.id)!;
    expect(copy.name).not.toBe(global.name);
    expect(copy.name).toContain(global.name);
  });

  it("does not copy archived global templates", () => {
    const created = createGlobalTemplate({ name: "Retired Routine" })!;
    archiveGlobalTemplate(created.id);
    expect(copyGlobalTemplateToCompany(COMPANY, created.id)).toBeNull();
  });
});

describe("global template — resolver", () => {
  it("resolves global and company tiers separately", () => {
    const globals = resolveGlobalTemplates();
    const company = resolveCompanyTemplates(COMPANY);
    expect(globals.every((t) => t.scope === "global")).toBe(true);
    expect(company.every((t) => t.companyId === COMPANY)).toBe(true);
  });

  it("hides archived globals unless requested", () => {
    const created = createGlobalTemplate({ name: "Seasonal Deep Clean" })!;
    archiveGlobalTemplate(created.id);
    expect(resolveGlobalTemplate(created.id)).toBeNull();
    expect(
      resolveGlobalTemplate(created.id, { includeArchived: true })?.id,
    ).toBe(created.id);
  });
});

describe("global template — customer protocol creation", () => {
  it("creates a customer protocol from a global template (deep copy)", () => {
    const [global] = getGlobalTemplates();
    const protocol = generateCustomerProtocol(COMPANY, CUSTOMER, global.id, {
      name: "Bergen – From Global",
    });
    expect(protocol).not.toBeNull();
    expect(protocol!.sourceTemplateId).toBe(global.id);

    const sections = getCustomerProtocolSections(protocol!.id);
    expect(sections.length).toBe(getSections(global.id).length);
    const itemCount = sections.reduce(
      (sum, s) => sum + getCustomerProtocolItems(s.id).length,
      0,
    );
    const globalItemCount = getSections(global.id).reduce(
      (sum, s) => sum + getItems(s.id).length,
      0,
    );
    expect(itemCount).toBe(globalItemCount);
  });

  it("still creates from a company template", () => {
    const company = createTemplate(COMPANY, { name: "Company-only Routine" })!;
    const protocol = generateCustomerProtocol(COMPANY, CUSTOMER, company.id, {
      name: "From Company",
    });
    expect(protocol?.sourceTemplateId).toBe(company.id);
  });

  it("does not leak a global into another company's template reads", () => {
    const [global] = getGlobalTemplates();
    copyGlobalTemplateToCompany(COMPANY, global.id);
    // Other company sees only its own seeded templates, none from company-a.
    const other = resolveCompanyTemplates(OTHER_COMPANY);
    expect(other.every((t) => t.companyId === OTHER_COMPANY)).toBe(true);
  });
});
