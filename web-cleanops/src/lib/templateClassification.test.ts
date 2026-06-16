import { beforeEach, describe, expect, it } from "vitest";

import {
  copyGlobalTemplateToCompany,
  createGlobalTemplate,
  createTemplate,
  getGlobalTemplate,
  getTemplate,
  updateGlobalTemplate,
  updateTemplate,
} from "./checklistTemplateStore";
import type { ChecklistTemplateV2 } from "@/types";

const COMPANY = "company-a";

beforeEach(() => {
  localStorage.clear();
});

describe("template classification — audience persistence", () => {
  it("stores the audience on a new company template", () => {
    const created = createTemplate(COMPANY, {
      name: "Office Cleaning",
      audience: "b2b",
    });
    expect(created?.audience).toBe("b2b");
    expect(getTemplate(COMPANY, created!.id)?.audience).toBe("b2b");
  });

  it("leaves audience undefined when not provided (backwards compatible)", () => {
    const created = createTemplate(COMPANY, { name: "No Audience" });
    expect(created?.audience).toBeUndefined();
  });

  it("updates a company template's audience without touching other fields", () => {
    const created = createTemplate(COMPANY, {
      name: "Recurring",
      audience: "b2c",
    });
    const updated = updateTemplate(COMPANY, created!.id, { audience: "general" });
    expect(updated?.audience).toBe("general");
    expect(updated?.name).toBe("Recurring");
  });

  it("preserves audience when an unrelated field is updated", () => {
    const created = createTemplate(COMPANY, {
      name: "Deep Clean",
      audience: "b2b",
    });
    const updated = updateTemplate(COMPANY, created!.id, {
      description: "Updated note",
    });
    expect(updated?.audience).toBe("b2b");
  });

  it("stores the audience on a global template", () => {
    const created = createGlobalTemplate({
      name: "Global Office",
      audience: "b2b",
    });
    expect(created?.audience).toBe("b2b");
    expect(getGlobalTemplate(created!.id)?.audience).toBe("b2b");
  });

  it("updates a global template's audience", () => {
    const created = createGlobalTemplate({ name: "Global Move-Out" });
    const updated = updateGlobalTemplate(created!.id, { audience: "general" });
    expect(updated?.audience).toBe("general");
  });
});

describe("template classification — copy independence", () => {
  it("copies the global template audience onto the company copy", () => {
    const global = createGlobalTemplate({
      name: "Global B2C Home",
      audience: "b2c",
    });
    const copy = copyGlobalTemplateToCompany(COMPANY, global!.id);
    expect(copy?.audience).toBe("b2c");
  });

  it("keeps the global and company audiences independent after copy", () => {
    const global = createGlobalTemplate({
      name: "Global Indep",
      audience: "b2b",
    });
    const copy = copyGlobalTemplateToCompany(COMPANY, global!.id);

    // Edit the company copy's audience — global must not change.
    updateTemplate(COMPANY, copy!.id, { audience: "b2c" });
    expect(getGlobalTemplate(global!.id)?.audience).toBe("b2b");

    // Edit the global audience — existing copy must not change.
    updateGlobalTemplate(global!.id, { audience: "general" });
    expect(getTemplate(COMPANY, copy!.id)?.audience).toBe("b2c");
  });
});

describe("template classification — type shape", () => {
  it("accepts every audience literal", () => {
    const audiences: NonNullable<ChecklistTemplateV2["audience"]>[] = [
      "b2b",
      "b2c",
      "general",
    ];
    expect(audiences).toHaveLength(3);
  });
});
