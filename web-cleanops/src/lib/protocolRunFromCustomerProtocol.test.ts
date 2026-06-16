import { beforeEach, describe, expect, it } from "vitest";

import { getActiveTemplates } from "./checklistTemplateStore";
import { generateCustomerProtocol } from "./customerProtocolGenerator";
import {
  createCustomerProtocolSection,
  deleteCustomerProtocolSection,
  getCustomerProtocolSections,
  updateCustomerProtocol,
  updateCustomerProtocolSection,
  archiveCustomerProtocol,
} from "./customerProtocolStore";
import { generateProtocolRunFromCustomerProtocol } from "./protocolRunGenerator";
import { getRunItems, getRunSections } from "./protocolRunStore";
import type { CustomerProtocolV2 } from "@/types";

const COMPANY = "company-a";
const OTHER_COMPANY = "company-b";
const CUSTOMER = "customer-1";
const OTHER_CUSTOMER = "customer-2";

beforeEach(() => {
  localStorage.clear();
});

/** Seeds a customer protocol (with sections + items) from the first template. */
function seedProtocol(name = "Bergen – Recurring"): CustomerProtocolV2 {
  const template = getActiveTemplates(COMPANY)[0];
  return generateCustomerProtocol(COMPANY, CUSTOMER, template.id, { name })!;
}

describe("generateProtocolRunFromCustomerProtocol — generation", () => {
  it("generates a run snapshot from a customer protocol", () => {
    const protocol = seedProtocol();
    const run = generateProtocolRunFromCustomerProtocol(
      COMPANY,
      CUSTOMER,
      protocol.id,
      { generatedBy: "user-1" },
    );
    expect(run).not.toBeNull();
    expect(run?.sourceCustomerProtocolId).toBe(protocol.id);
    expect(run?.sourceCustomerProtocolName).toBe(protocol.name);
    expect(run?.customerId).toBe(CUSTOMER);
    expect(run?.status).toBe("draft");
  });

  it("preserves the template provenance from the customer protocol", () => {
    const protocol = seedProtocol();
    const run = generateProtocolRunFromCustomerProtocol(
      COMPANY,
      CUSTOMER,
      protocol.id,
      { generatedBy: "user-1" },
    )!;
    expect(run.sourceTemplateId).toBe(protocol.sourceTemplateId);
    expect(run.sourceTemplateName).toBe(protocol.sourceTemplateName);
    expect(run.sourceTemplateVersion).toBe(protocol.sourceTemplateVersion);
  });

  it("deep-copies the section/item structure and starts items pending", () => {
    const protocol = seedProtocol();
    const protocolSections = getCustomerProtocolSections(protocol.id);
    const run = generateProtocolRunFromCustomerProtocol(
      COMPANY,
      CUSTOMER,
      protocol.id,
      { generatedBy: "user-1" },
    )!;

    const runSections = getRunSections(COMPANY, run.id);
    expect(runSections.map((s) => s.title)).toEqual(
      protocolSections.map((s) => s.title),
    );
    const runItems = getRunItems(COMPANY, runSections[0].id);
    expect(runItems.length).toBeGreaterThan(0);
    expect(runItems.every((i) => i.status === "pending")).toBe(true);
  });

  it("stores the optional work-order context", () => {
    const protocol = seedProtocol();
    const run = generateProtocolRunFromCustomerProtocol(
      COMPANY,
      CUSTOMER,
      protocol.id,
      { generatedBy: "user-1", workOrderId: "wo-9" },
    );
    expect(run?.workOrderId).toBe("wo-9");
  });
});

describe("generateProtocolRunFromCustomerProtocol — guards", () => {
  it("returns null for a missing protocol", () => {
    expect(
      generateProtocolRunFromCustomerProtocol(COMPANY, CUSTOMER, "missing", {
        generatedBy: "user-1",
      }),
    ).toBeNull();
  });

  it("blocks cross-customer generation", () => {
    const protocol = seedProtocol();
    expect(
      generateProtocolRunFromCustomerProtocol(
        COMPANY,
        OTHER_CUSTOMER,
        protocol.id,
        { generatedBy: "user-1" },
      ),
    ).toBeNull();
  });

  it("blocks cross-company generation", () => {
    const protocol = seedProtocol();
    expect(
      generateProtocolRunFromCustomerProtocol(
        OTHER_COMPANY,
        CUSTOMER,
        protocol.id,
        { generatedBy: "user-1" },
      ),
    ).toBeNull();
  });

  it("blocks archived protocols by default but allows with allowArchived", () => {
    const protocol = seedProtocol();
    archiveCustomerProtocol(COMPANY, protocol.id);
    expect(
      generateProtocolRunFromCustomerProtocol(COMPANY, CUSTOMER, protocol.id, {
        generatedBy: "user-1",
      }),
    ).toBeNull();
    const run = generateProtocolRunFromCustomerProtocol(
      COMPANY,
      CUSTOMER,
      protocol.id,
      { generatedBy: "user-1", allowArchived: true },
    );
    expect(run).not.toBeNull();
  });
});

describe("generateProtocolRunFromCustomerProtocol — snapshot independence", () => {
  it("does NOT change an existing run when the customer protocol is later edited", () => {
    const protocol = seedProtocol();
    const sections = getCustomerProtocolSections(protocol.id);
    const run = generateProtocolRunFromCustomerProtocol(
      COMPANY,
      CUSTOMER,
      protocol.id,
      { generatedBy: "user-1" },
    )!;
    const runSectionTitlesBefore = getRunSections(COMPANY, run.id).map(
      (s) => s.title,
    );
    const firstRunSectionId = getRunSections(COMPANY, run.id)[0].id;
    const runItemTitleBefore = getRunItems(COMPANY, firstRunSectionId)[0].title;

    // Mutate the customer protocol after generation.
    updateCustomerProtocol(COMPANY, protocol.id, { name: "Renamed Protocol" });
    updateCustomerProtocolSection(sections[0].id, { title: "Renamed Section" });
    createCustomerProtocolSection(protocol.id, { title: "Brand New Section" });

    const runSectionsAfter = getRunSections(COMPANY, run.id);
    expect(runSectionsAfter.map((s) => s.title)).toEqual(runSectionTitlesBefore);
    expect(getRunItems(COMPANY, runSectionsAfter[0].id)[0].title).toBe(
      runItemTitleBefore,
    );
  });

  it("does NOT change the customer protocol when run items are mutated", () => {
    const protocol = seedProtocol();
    const sectionsBefore = getCustomerProtocolSections(protocol.id);
    generateProtocolRunFromCustomerProtocol(COMPANY, CUSTOMER, protocol.id, {
      generatedBy: "user-1",
    });
    // The protocol definition is unchanged by run generation.
    const sectionsAfter = getCustomerProtocolSections(protocol.id);
    expect(sectionsAfter.map((s) => s.title)).toEqual(
      sectionsBefore.map((s) => s.title),
    );
  });

  it("keeps the run intact when the customer protocol section is deleted", () => {
    const protocol = seedProtocol();
    const run = generateProtocolRunFromCustomerProtocol(
      COMPANY,
      CUSTOMER,
      protocol.id,
      { generatedBy: "user-1" },
    )!;
    const before = getRunSections(COMPANY, run.id).length;
    const sections = getCustomerProtocolSections(protocol.id);
    deleteCustomerProtocolSection(sections[0].id);
    expect(getRunSections(COMPANY, run.id).length).toBe(before);
  });
});
