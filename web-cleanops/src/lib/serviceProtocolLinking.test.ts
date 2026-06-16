import { beforeEach, describe, expect, it } from "vitest";

import {
  createBlankCustomerProtocol,
  generateCustomerProtocol,
} from "@/lib/customerProtocolGenerator";
import {
  archiveCustomerProtocol,
  getCustomerProtocolSections,
} from "@/lib/customerProtocolStore";
import {
  resolveCustomerProtocol,
  resolveCustomerProtocolForService,
} from "@/lib/checklistSettingsResolver";
import { getActiveTemplates } from "@/lib/checklistTemplateStore";

const COMPANY = "company-a";
const CUSTOMER = "customer-1";

beforeEach(() => {
  localStorage.clear();
});

describe("createBlankCustomerProtocol (Phase 3D)", () => {
  it("creates an editable protocol with no source and no sections", () => {
    const created = createBlankCustomerProtocol(COMPANY, CUSTOMER, {
      name: "Conference Rooms",
      description: "Ad-hoc",
    });
    expect(created).not.toBeNull();
    expect(created!.sourceTemplateId).toBe("");
    expect(created!.sourceTemplateName).toBe("");
    expect(created!.sourceTemplateVersion).toBe(0);
    expect(created!.customerId).toBe(CUSTOMER);
    expect(getCustomerProtocolSections(created!.id)).toHaveLength(0);
  });

  it("rejects an empty name", () => {
    expect(
      createBlankCustomerProtocol(COMPANY, CUSTOMER, { name: "   " }),
    ).toBeNull();
  });

  it("rejects a duplicate name within the customer", () => {
    createBlankCustomerProtocol(COMPANY, CUSTOMER, { name: "Dup" });
    expect(
      createBlankCustomerProtocol(COMPANY, CUSTOMER, { name: "dup" }),
    ).toBeNull();
  });
});

describe("resolveCustomerProtocolForService (Phase 3D)", () => {
  it("returns null for a missing/empty link", () => {
    expect(
      resolveCustomerProtocolForService(COMPANY, CUSTOMER, null),
    ).toBeNull();
    expect(
      resolveCustomerProtocolForService(COMPANY, CUSTOMER, undefined),
    ).toBeNull();
  });

  it("resolves a linked protocol, including after it is archived", () => {
    const template = getActiveTemplates(COMPANY)[0];
    const protocol = generateCustomerProtocol(COMPANY, CUSTOMER, template.id, {
      name: "Bergen – Recurring",
    })!;

    expect(
      resolveCustomerProtocolForService(COMPANY, CUSTOMER, protocol.id)?.id,
    ).toBe(protocol.id);

    archiveCustomerProtocol(COMPANY, protocol.id);
    // The plain resolver hides archived protocols…
    expect(
      resolveCustomerProtocol(COMPANY, CUSTOMER, protocol.id),
    ).toBeNull();
    // …but the service-link resolver still surfaces them for display.
    expect(
      resolveCustomerProtocolForService(COMPANY, CUSTOMER, protocol.id)?.id,
    ).toBe(protocol.id);
  });

  it("does not resolve a protocol owned by a different customer", () => {
    const template = getActiveTemplates(COMPANY)[0];
    const protocol = generateCustomerProtocol(COMPANY, CUSTOMER, template.id, {
      name: "Bergen – Recurring",
    })!;
    expect(
      resolveCustomerProtocolForService(COMPANY, "other-customer", protocol.id),
    ).toBeNull();
  });
});
