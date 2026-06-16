import { beforeEach, describe, expect, it } from "vitest";

import {
  createSection,
  getActiveTemplates,
  getSections,
  updateItem,
  updateSection,
  updateTemplate,
} from "./checklistTemplateStore";
import { getItems } from "./checklistTemplateStore";
import { generateProtocolRun } from "./protocolRunGenerator";
import { getRunItems, getRunSections } from "./protocolRunStore";

const COMPANY = "company-a";

beforeEach(() => {
  localStorage.clear();
});

describe("protocolRunGenerator — generation", () => {
  it("generates a run snapshot from a template", () => {
    const template = getActiveTemplates(COMPANY)[0];
    const run = generateProtocolRun(COMPANY, template.id, {
      generatedBy: "user-1",
    });
    expect(run).not.toBeNull();
    expect(run?.sourceTemplateId).toBe(template.id);
    expect(run?.sourceTemplateName).toBe(template.name);
    expect(run?.status).toBe("draft");
  });

  it("copies the section/item structure from the template", () => {
    const template = getActiveTemplates(COMPANY)[0];
    const templateSections = getSections(template.id);
    const run = generateProtocolRun(COMPANY, template.id, {
      generatedBy: "user-1",
    })!;

    const runSections = getRunSections(COMPANY, run.id);
    expect(runSections.map((s) => s.title)).toEqual(
      templateSections.map((s) => s.title),
    );

    const templateItems = getItems(templateSections[0].id);
    const runItems = getRunItems(COMPANY, runSections[0].id);
    expect(runItems.map((i) => i.title)).toEqual(
      templateItems.map((i) => i.title),
    );
    expect(runItems.every((i) => i.status === "pending")).toBe(true);
  });

  it("copies the template version onto the run", () => {
    const template = getActiveTemplates(COMPANY)[0];
    const run = generateProtocolRun(COMPANY, template.id, {
      generatedBy: "user-1",
    });
    expect(run?.sourceTemplateVersion).toBe(template.version ?? 1);
  });

  it("returns null for an unknown template", () => {
    expect(
      generateProtocolRun(COMPANY, "missing", { generatedBy: "user-1" }),
    ).toBeNull();
  });

  it("stores optional booking/work-order context", () => {
    const template = getActiveTemplates(COMPANY)[0];
    const run = generateProtocolRun(COMPANY, template.id, {
      generatedBy: "user-1",
      bookingId: "bk-9",
      workOrderId: "wo-9",
    });
    expect(run?.bookingId).toBe("bk-9");
    expect(run?.workOrderId).toBe("wo-9");
  });
});

describe("protocolRunGenerator — snapshot integrity", () => {
  it("does NOT change an existing run when the template is later edited", () => {
    const template = getActiveTemplates(COMPANY)[0];
    const sections = getSections(template.id);
    const firstItem = getItems(sections[0].id)[0];

    const run = generateProtocolRun(COMPANY, template.id, {
      generatedBy: "user-1",
    })!;
    const runSectionTitlesBefore = getRunSections(COMPANY, run.id).map(
      (s) => s.title,
    );
    const firstRunSectionId = getRunSections(COMPANY, run.id)[0].id;
    const runItemTitleBefore = getRunItems(COMPANY, firstRunSectionId)[0].title;

    // Mutate the template after generation.
    updateTemplate(COMPANY, template.id, { name: "Totally Renamed Template" });
    updateSection(sections[0].id, { title: "Renamed Section" });
    updateItem(firstItem.id, { title: "Renamed Item" });
    createSection(template.id, { title: "Brand New Section" });

    // The run snapshot must be unchanged.
    const runSectionsAfter = getRunSections(COMPANY, run.id);
    expect(runSectionsAfter.map((s) => s.title)).toEqual(runSectionTitlesBefore);
    expect(getRunItems(COMPANY, runSectionsAfter[0].id)[0].title).toBe(
      runItemTitleBefore,
    );
    expect(run.sourceTemplateName).toBe(template.name);
  });
});
