import { beforeEach, describe, expect, it } from "vitest";

import {
  resolveProtocolItems,
  resolveProtocolRun,
  resolveProtocolRuns,
  resolveProtocolSections,
} from "./checklistSettingsResolver";
import { generateProtocolRun } from "./protocolRunGenerator";
import { getActiveTemplates } from "./checklistTemplateStore";

const COMPANY = "company-a";
const OTHER_COMPANY = "company-b";

beforeEach(() => {
  localStorage.clear();
});

function seedRun(company: string) {
  const template = getActiveTemplates(company)[0];
  return generateProtocolRun(company, template.id, { generatedBy: "user-1" })!;
}

describe("resolver — protocol runs", () => {
  it("resolves runs for a company", () => {
    const run = seedRun(COMPANY);
    const runs = resolveProtocolRuns(COMPANY);
    expect(runs.some((r) => r.id === run.id)).toBe(true);
  });

  it("does not leak another company's run", () => {
    const run = seedRun(COMPANY);
    expect(resolveProtocolRun(OTHER_COMPANY, run.id)).toBeNull();
    expect(resolveProtocolRun(COMPANY, run.id)?.id).toBe(run.id);
  });

  it("resolves sections and items through the run", () => {
    const run = seedRun(COMPANY);
    const sections = resolveProtocolSections(COMPANY, run.id);
    expect(sections.length).toBeGreaterThan(0);
    const items = resolveProtocolItems(COMPANY, sections[0].id);
    expect(items.length).toBeGreaterThan(0);
  });

  it("scopes section/item resolution by company", () => {
    const run = seedRun(COMPANY);
    expect(resolveProtocolSections(OTHER_COMPANY, run.id)).toHaveLength(0);
    const section = resolveProtocolSections(COMPANY, run.id)[0];
    expect(resolveProtocolItems(OTHER_COMPANY, section.id)).toHaveLength(0);
  });
});
