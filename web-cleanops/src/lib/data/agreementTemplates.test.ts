import { describe, expect, it, beforeEach } from "vitest";

import {
  buildAgreementTemplate,
  buildAgreementTemplateLine,
  createAgreementFromTemplate,
  resetTemplateSequencers,
  validateTemplateForCreation,
  type BuildAgreementTemplateInput,
  type CreateAgreementFromTemplateResult,
} from "./agreementTemplates";
import { defaultTemplateTimeBankRules } from "./timeBankTemplateBinding";
import type {
  AgreementTemplate,
  AgreementTemplateLine,
  TimeBankTemplateRules,
} from "@/types";

// ── Helpers ────────────────────────────────────────────────────

function makeTemplate(
  overrides?: Partial<BuildAgreementTemplateInput>,
): AgreementTemplate {
  return buildAgreementTemplate({
    ownerType: "company",
    companyId: "company_1",
    name: "Standard Cleaning Monthly",
    description: "Standard monthly cleaning agreement",
    billingModel: "monthly_fixed",
    invoiceInterval: "monthly",
    timeBankEligible: false,
    status: "active",
    ...overrides,
  });
}

function makeTemplateLine(
  templateId: string,
  templateGroupId: string,
  overrides?: Partial<Parameters<typeof buildAgreementTemplateLine>[0]>,
): AgreementTemplateLine {
  return buildAgreementTemplateLine({
    templateId,
    templateGroupId,
    ownerType: "company",
    companyId: "company_1",
    serviceNameSnapshot: "Standard Office Cleaning",
    sortOrder: 0,
    defaultPrice: 2500,
    defaultVat: 25,
    pricingModel: "fixed",
    active: true,
    ...overrides,
  });
}

function makeTemplateLine2(
  templateId: string,
  templateGroupId: string,
): AgreementTemplateLine {
  return buildAgreementTemplateLine({
    templateId,
    templateGroupId,
    ownerType: "company",
    companyId: "company_1",
    serviceNameSnapshot: "Window Cleaning",
    sortOrder: 1,
    defaultPrice: 800,
    defaultVat: 25,
    pricingModel: "fixed",
    active: true,
  });
}

beforeEach(() => {
  resetTemplateSequencers();
});

// ── Template creation ──────────────────────────────────────────

describe("buildAgreementTemplate", () => {
  it("creates a company template with defaults", () => {
    const tpl = makeTemplate();
    expect(tpl.id).toBe("tpl_000001");
    expect(tpl.templateGroupId).toBe("tpl_group_000001");
    expect(tpl.ownerType).toBe("company");
    expect(tpl.companyId).toBe("company_1");
    expect(tpl.name).toBe("Standard Cleaning Monthly");
    expect(tpl.version).toBe(1);
    expect(tpl.status).toBe("active");
    expect(tpl.billingModel).toBe("monthly_fixed");
    expect(tpl.invoiceInterval).toBe("monthly");
    expect(tpl.timeBankEligible).toBe(false);
    expect(tpl.timeBankTemplateRules).toBeNull();
    expect(tpl.createdAt).toBeTruthy();
  });

  it("creates a global template (companyId null)", () => {
    const tpl = buildAgreementTemplate({
      ownerType: "global",
      companyId: null,
      name: "Platform Standard",
      status: "active",
    });
    expect(tpl.ownerType).toBe("global");
    expect(tpl.companyId).toBeNull();
    expect(tpl.templateGroupId).toBe("tpl_group_000001");
  });

  it("defaults to draft status when not specified", () => {
    const tpl = buildAgreementTemplate({
      ownerType: "company",
      companyId: "company_1",
      name: "Draft Template",
    });
    expect(tpl.status).toBe("draft");
  });

  it("defaults to per_visit billing model", () => {
    const tpl = buildAgreementTemplate({
      ownerType: "company",
      companyId: "company_1",
      name: "T",
    });
    expect(tpl.billingModel).toBe("per_visit");
  });

  it("defaults to monthly invoice interval", () => {
    const tpl = buildAgreementTemplate({
      ownerType: "company",
      companyId: "company_1",
      name: "T",
    });
    expect(tpl.invoiceInterval).toBe("monthly");
  });

  it("creates unique ids across multiple calls", () => {
    const tpl1 = makeTemplate({ name: "A" });
    const tpl2 = makeTemplate({ name: "B" });
    expect(tpl1.id).not.toBe(tpl2.id);
    expect(tpl1.templateGroupId).not.toBe(tpl2.templateGroupId);
    expect(tpl1.id).toBe("tpl_000001");
    expect(tpl2.id).toBe("tpl_000002");
  });

  it("carries Time Bank template rules when provided", () => {
    const tbr: TimeBankTemplateRules = {
      timeBankEnabled: true,
      allocationMinutes: 300,
      refillFrequency: "monthly",
    };
    const tpl = makeTemplate({ timeBankEligible: true, timeBankTemplateRules: tbr });
    expect(tpl.timeBankEligible).toBe(true);
    expect(tpl.timeBankTemplateRules?.timeBankEnabled).toBe(true);
    expect(tpl.timeBankTemplateRules?.allocationMinutes).toBe(300);
  });
});

// ── Template line creation ─────────────────────────────────────

describe("buildAgreementTemplateLine", () => {
  it("creates a template line with defaults", () => {
    const line = makeTemplateLine("tpl_000001", "tpl_group_000001");
    expect(line.id).toBe("tpl_line_000001");
    expect(line.templateId).toBe("tpl_000001");
    expect(line.templateGroupId).toBe("tpl_group_000001");
    expect(line.serviceNameSnapshot).toBe("Standard Office Cleaning");
    expect(line.defaultPrice).toBe(2500);
    expect(line.pricingModel).toBe("fixed");
    expect(line.active).toBe(true);
    expect(line.sortOrder).toBe(0);
    expect(line.createdAt).toBeTruthy();
  });

  it("creates unique line ids across multiple calls", () => {
    const l1 = makeTemplateLine("tpl_000001", "tpl_group_000001");
    const l2 = makeTemplateLine("tpl_000001", "tpl_group_000001", {
      serviceNameSnapshot: "Another Service",
    });
    expect(l1.id).toBe("tpl_line_000001");
    expect(l2.id).toBe("tpl_line_000002");
  });

  it("respects active flag", () => {
    const activeLine = makeTemplateLine("tpl_000001", "tpl_group_000001", { active: true });
    const inactiveLine = makeTemplateLine("tpl_000001", "tpl_group_000001", {
      serviceNameSnapshot: "Inactive Service",
      active: false,
    });
    expect(activeLine.active).toBe(true);
    expect(inactiveLine.active).toBe(false);
  });

  it("carries recurrence defaults when provided", () => {
    const line = makeTemplateLine("tpl_000001", "tpl_group_000001", {
      recurrenceDefaults: {
        interval: "weekly",
        serviceDate: "2026-06-01",
        plannedStartTime: "09:00",
        plannedEndTime: "12:00",
      },
    });
    expect(line.recurrenceDefaults?.interval).toBe("weekly");
    expect(line.recurrenceDefaults?.plannedStartTime).toBe("09:00");
  });

  it("carries billing model override", () => {
    const line = makeTemplateLine("tpl_000001", "tpl_group_000001", {
      billingModelOverride: "time_bank",
    });
    expect(line.billingModelOverride).toBe("time_bank");
  });

  it("defaults billingModelOverride to null", () => {
    const line = makeTemplateLine("tpl_000001", "tpl_group_000001");
    expect(line.billingModelOverride).toBeNull();
  });
});

// ── Template validation ────────────────────────────────────────

describe("validateTemplateForCreation", () => {
  it("rejects null/undefined template", () => {
    const r = validateTemplateForCreation(null);
    expect(r.valid).toBe(false);
    expect(r.errors).toContain("Template is missing.");
  });

  it("rejects draft template", () => {
    const tpl = makeTemplate({ status: "draft" });
    const lines = [makeTemplateLine(tpl.id, tpl.templateGroupId)];
    const r = validateTemplateForCreation(tpl, lines);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("draft"))).toBe(true);
  });

  it("rejects inactive template", () => {
    const tpl = makeTemplate({ status: "inactive" });
    const lines = [makeTemplateLine(tpl.id, tpl.templateGroupId)];
    const r = validateTemplateForCreation(tpl, lines);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("inactive"))).toBe(true);
  });

  it("rejects superseded template", () => {
    const tpl = makeTemplate({ status: "superseded" });
    const lines = [makeTemplateLine(tpl.id, tpl.templateGroupId)];
    const r = validateTemplateForCreation(tpl, lines);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("superseded"))).toBe(true);
  });

  it("accepts active template with lines", () => {
    const tpl = makeTemplate({ status: "active" });
    const lines = [makeTemplateLine(tpl.id, tpl.templateGroupId)];
    const r = validateTemplateForCreation(tpl, lines);
    expect(r.valid).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it("rejects active template with no lines", () => {
    const tpl = makeTemplate({ status: "active" });
    const r = validateTemplateForCreation(tpl, []);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("no active lines"))).toBe(true);
  });

  it("rejects active template when all lines are inactive", () => {
    const tpl = makeTemplate({ status: "active" });
    const lines = [makeTemplateLine(tpl.id, tpl.templateGroupId, { active: false })];
    const r = validateTemplateForCreation(tpl, lines);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("no active lines"))).toBe(true);
  });

  it("accepts active template when at least one line is active", () => {
    const tpl = makeTemplate({ status: "active" });
    const lines = [
      makeTemplateLine(tpl.id, tpl.templateGroupId, { active: false }),
      makeTemplateLine(tpl.id, tpl.templateGroupId, {
        serviceNameSnapshot: "Active Service",
        active: true,
      }),
    ];
    const r = validateTemplateForCreation(tpl, lines);
    expect(r.valid).toBe(true);
  });
});

// ── Template → Agreement creation ──────────────────────────────

describe("createAgreementFromTemplate", () => {
  it("creates a Customer Agreement (v1) from a template", () => {
    const tpl = makeTemplate({ status: "active", billingModel: "monthly_fixed" });
    const lines = [makeTemplateLine(tpl.id, tpl.templateGroupId)];

    const result = createAgreementFromTemplate({
      template: tpl,
      lines,
      customerId: "cust_1",
      companyId: "company_1",
    });

    expect(result.agreement.id).toBe("agr_000001");
    expect(result.agreement.agreementGroupId).toBe("agr_group_000001");
    expect(result.agreement.version).toBe(1);
    expect(result.agreement.status).toBe("active");
    expect(result.agreement.companyId).toBe("company_1");
    expect(result.agreement.customerId).toBe("cust_1");
    expect(result.agreement.billingModel).toBe("monthly_fixed");
    expect(result.agreement.invoiceInterval).toBe("monthly");
    expect(result.agreement.sourceType).toBe("template");
    expect(result.agreement.sourceReferenceId).toBe(tpl.id);
  });

  it("creates agreement lines from template lines (snapshot)", () => {
    const tpl = makeTemplate({ status: "active" });
    const lines = [
      makeTemplateLine(tpl.id, tpl.templateGroupId),
      makeTemplateLine2(tpl.id, tpl.templateGroupId),
    ];

    const result = createAgreementFromTemplate({
      template: tpl,
      lines,
      customerId: "cust_1",
      companyId: "company_1",
    });

    expect(result.lines).toHaveLength(2);
    expect(result.lines[0].serviceNameSnapshot).toBe("Standard Office Cleaning");
    expect(result.lines[0].agreedPrice).toBe(2500);
    expect(result.lines[0].agreementId).toBe(result.agreement.id);
    expect(result.lines[0].agreementGroupId).toBe(result.agreement.agreementGroupId);

    expect(result.lines[1].serviceNameSnapshot).toBe("Window Cleaning");
    expect(result.lines[1].agreedPrice).toBe(800);
  });

  it("skips inactive template lines", () => {
    const tpl = makeTemplate({ status: "active" });
    const lines = [
      makeTemplateLine(tpl.id, tpl.templateGroupId, { active: false }),
      makeTemplateLine2(tpl.id, tpl.templateGroupId),
    ];

    const result = createAgreementFromTemplate({
      template: tpl,
      lines,
      customerId: "cust_1",
      companyId: "company_1",
    });

    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].serviceNameSnapshot).toBe("Window Cleaning");
  });

  it("records source template id and version for traceability", () => {
    const tpl = makeTemplate({ status: "active" });
    const lines = [makeTemplateLine(tpl.id, tpl.templateGroupId)];

    const result = createAgreementFromTemplate({
      template: tpl,
      lines,
      customerId: "cust_1",
      companyId: "company_1",
    });

    expect(result.sourceTemplateId).toBe(tpl.id);
    expect(result.sourceTemplateVersion).toBe(tpl.version);
    expect(result.agreement.sourceType).toBe("template");
    expect(result.agreement.sourceReferenceId).toBe(tpl.id);
  });

  it("generates a fresh agreementGroupId per creation", () => {
    const tpl = makeTemplate({ status: "active" });
    const lines = [makeTemplateLine(tpl.id, tpl.templateGroupId)];

    const r1 = createAgreementFromTemplate({
      template: tpl, lines, customerId: "cust_1", companyId: "company_1",
    });
    const r2 = createAgreementFromTemplate({
      template: tpl, lines, customerId: "cust_2", companyId: "company_1",
    });

    expect(r1.agreement.agreementGroupId).not.toBe(r2.agreement.agreementGroupId);
    expect(r1.agreement.agreementGroupId).toBe("agr_group_000001");
    expect(r2.agreement.agreementGroupId).toBe("agr_group_000002");
  });

  it("creates every agreement as version 1", () => {
    const tpl = makeTemplate({ status: "active" });
    const lines = [makeTemplateLine(tpl.id, tpl.templateGroupId)];

    const r1 = createAgreementFromTemplate({
      template: tpl, lines, customerId: "cust_1", companyId: "company_1",
    });
    const r2 = createAgreementFromTemplate({
      template: tpl, lines, customerId: "cust_2", companyId: "company_1",
    });

    expect(r1.agreement.version).toBe(1);
    expect(r2.agreement.version).toBe(1);
  });

  // ── Override behaviour ─────────────────────────────────────

  it("applies header overrides", () => {
    const tpl = makeTemplate({
      status: "active",
      billingModel: "monthly_fixed",
      invoiceInterval: "monthly",
    });
    const lines = [makeTemplateLine(tpl.id, tpl.templateGroupId)];

    const result = createAgreementFromTemplate({
      template: tpl,
      lines,
      customerId: "cust_1",
      companyId: "company_1",
      overrides: {
        header: {
          billingModel: "time_bank",
          name: "Custom Agreement Name",
        },
      },
    });

    expect(result.agreement.billingModel).toBe("time_bank");
    expect(result.agreement.name).toBe("Custom Agreement Name");
    // Un-overridden fields keep template values
    expect(result.agreement.invoiceInterval).toBe("monthly");
  });

  it("applies line overrides by template line id", () => {
    const tpl = makeTemplate({ status: "active" });
    const line1 = makeTemplateLine(tpl.id, tpl.templateGroupId);
    const line2 = makeTemplateLine2(tpl.id, tpl.templateGroupId);

    const result = createAgreementFromTemplate({
      template: tpl,
      lines: [line1, line2],
      customerId: "cust_1",
      companyId: "company_1",
      overrides: {
        lineOverrides: {
          [line1.id]: { agreedPrice: 3000 },
          [line2.id]: { agreedPrice: 1000, pricingModel: "per_unit", quantity: 2 },
        },
      },
    });

    expect(result.lines[0].agreedPrice).toBe(3000);
    expect(result.lines[1].agreedPrice).toBe(1000);
    expect(result.lines[1].pricingModel).toBe("per_unit");
    expect(result.lines[1].quantity).toBe(2);
  });

  // ── Template independence ──────────────────────────────────

  it("agreement is independent — editing the template after creation does NOT affect the agreement", () => {
    const tpl = makeTemplate({
      status: "active",
      billingModel: "monthly_fixed",
      name: "Original Template",
    });
    const lines = [makeTemplateLine(tpl.id, tpl.templateGroupId)];

    const result = createAgreementFromTemplate({
      template: tpl,
      lines,
      customerId: "cust_1",
      companyId: "company_1",
    });

    // Now "edit" the template (mutate the object in-place to simulate an edit)
    tpl.billingModel = "time_bank";
    tpl.name = "Updated Template Name";
    (tpl as unknown as Record<string, unknown>).invoiceInterval = "quarterly";

    // The agreement must be frozen as it was at creation time
    expect(result.agreement.billingModel).toBe("monthly_fixed");
    expect(result.agreement.name).toBe("Original Template");
    expect(result.agreement.invoiceInterval).toBe("monthly");
  });

  it("agreement lines are independent — adding/removing template lines does NOT affect existing agreement lines", () => {
    const tpl = makeTemplate({ status: "active" });
    const line1 = makeTemplateLine(tpl.id, tpl.templateGroupId);
    const line2 = makeTemplateLine2(tpl.id, tpl.templateGroupId);

    const result = createAgreementFromTemplate({
      template: tpl,
      lines: [line1, line2],
      customerId: "cust_1",
      companyId: "company_1",
    });

    // "Add" a line to the template (append to array)
    const newLines = [
      line1,
      line2,
      makeTemplateLine(tpl.id, tpl.templateGroupId, {
        serviceNameSnapshot: "New Service",
      }),
    ];

    // Existing agreement lines are unaffected
    expect(result.lines).toHaveLength(2);
    expect(result.lines[0].serviceNameSnapshot).toBe("Standard Office Cleaning");

    // Creating a NEW agreement from the updated template WOULD get 3 lines
    const result2 = createAgreementFromTemplate({
      template: tpl,
      lines: newLines,
      customerId: "cust_2",
      companyId: "company_1",
    });
    expect(result2.lines).toHaveLength(3);
  });

  it("template version change only affects NEW agreements", () => {
    // v1 template
    const tplV1 = makeTemplate({ status: "active", billingModel: "monthly_fixed" });
    const linesV1 = [makeTemplateLine(tplV1.id, tplV1.templateGroupId)];

    const r1 = createAgreementFromTemplate({
      template: tplV1,
      lines: linesV1,
      customerId: "cust_1",
      companyId: "company_1",
    });

    // "Publish" v2 template (supersede v1, create v2)
    // In real life v2 would be a new record; simulate by building a second template
    const tplV2 = makeTemplate({ status: "active", billingModel: "time_bank", name: "V2 Template" });
    const linesV2 = [makeTemplateLine(tplV2.id, tplV2.templateGroupId, {
      serviceNameSnapshot: "Updated Service",
      defaultPrice: 3000,
    })];

    const r2 = createAgreementFromTemplate({
      template: tplV2,
      lines: linesV2,
      customerId: "cust_2",
      companyId: "company_1",
    });

    // v1 agreement is unchanged
    expect(r1.agreement.billingModel).toBe("monthly_fixed");
    expect(r1.agreement.sourceReferenceId).toBe(tplV1.id);
    expect(r1.sourceTemplateVersion).toBe(1);

    // v2 agreement gets the new values
    expect(r2.agreement.billingModel).toBe("time_bank");
    expect(r2.agreement.name).toBe("V2 Template");
    expect(r2.agreement.sourceReferenceId).toBe(tplV2.id);
    expect(r2.sourceTemplateVersion).toBe(1);
    expect(r2.lines[0].serviceNameSnapshot).toBe("Updated Service");
  });

  it("agreement survives template deletion/superseding", () => {
    const tpl = makeTemplate({ status: "active" });
    const lines = [makeTemplateLine(tpl.id, tpl.templateGroupId)];

    const result = createAgreementFromTemplate({
      template: tpl,
      lines,
      customerId: "cust_1",
      companyId: "company_1",
    });

    // "Delete" the template (mark as superseded/inactive)
    tpl.status = "superseded";

    // The agreement is completely unaffected
    expect(result.agreement.status).toBe("active");
    expect(result.agreement.customerId).toBe("cust_1");
    expect(result.lines[0].serviceNameSnapshot).toBe("Standard Office Cleaning");
    expect(result.sourceTemplateId).toBe(tpl.id);
  });

  // ── Time Bank inheritance ──────────────────────────────────

  it("Time Bank OFF by default when template has no Time Bank rules", () => {
    const tpl = makeTemplate({ status: "active", timeBankEligible: false });
    const lines = [makeTemplateLine(tpl.id, tpl.templateGroupId)];

    const result = createAgreementFromTemplate({
      template: tpl,
      lines,
      customerId: "cust_1",
      companyId: "company_1",
    });

    expect(result.timeBankSnapshot.timeBankEnabled).toBe(false);
    expect(result.timeBankSnapshot.rules.allocationMinutes).toBe(0);
  });

  it("Time Bank ON when template explicitly enables it with allocation", () => {
    const tbr: TimeBankTemplateRules = {
      timeBankEnabled: true,
      allocationMinutes: 600,
      refillFrequency: "monthly",
      carryoverPolicy: "unlimited",
    };
    const tpl = makeTemplate({
      status: "active",
      timeBankEligible: true,
      timeBankTemplateRules: tbr,
    });
    const lines = [makeTemplateLine(tpl.id, tpl.templateGroupId)];

    const result = createAgreementFromTemplate({
      template: tpl,
      lines,
      customerId: "cust_1",
      companyId: "company_1",
    });

    expect(result.timeBankSnapshot.timeBankEnabled).toBe(true);
    expect(result.timeBankSnapshot.rules.allocationMinutes).toBe(600);
    expect(result.timeBankSnapshot.rules.refillFrequency).toBe("monthly");
    expect(result.timeBankSnapshot.rules.carryoverPolicy).toBe("unlimited");
  });

  it("Time Bank rules override from createAgreementFromTemplate wins over template", () => {
    const tbr: TimeBankTemplateRules = {
      timeBankEnabled: true,
      allocationMinutes: 300,
    };
    const tpl = makeTemplate({
      status: "active",
      timeBankEligible: true,
      timeBankTemplateRules: tbr,
    });
    const lines = [makeTemplateLine(tpl.id, tpl.templateGroupId)];

    const result = createAgreementFromTemplate({
      template: tpl,
      lines,
      customerId: "cust_1",
      companyId: "company_1",
      overrides: {
        timeBankRulesOverride: { allocationMinutes: 900 },
      },
    });

    // The explicit override wins
    expect(result.timeBankSnapshot.rules.allocationMinutes).toBe(900);
  });

  it("template with timeBankEnabled true but zero allocation → still OFF", () => {
    const tbr: TimeBankTemplateRules = {
      timeBankEnabled: true,
      allocationMinutes: 0,
    };
    const tpl = makeTemplate({
      status: "active",
      timeBankEligible: true,
      timeBankTemplateRules: tbr,
    });
    const lines = [makeTemplateLine(tpl.id, tpl.templateGroupId)];

    const result = createAgreementFromTemplate({
      template: tpl,
      lines,
      customerId: "cust_1",
      companyId: "company_1",
    });

    expect(result.timeBankSnapshot.timeBankEnabled).toBe(false);
  });

  // ── Cancellation credit inheritance ─────────────────────────

  it("cancellation credit disabled by default when template has no policy", () => {
    const tpl = makeTemplate({ status: "active" });
    const lines = [makeTemplateLine(tpl.id, tpl.templateGroupId)];

    const result = createAgreementFromTemplate({
      template: tpl,
      lines,
      customerId: "cust_1",
      companyId: "company_1",
    });

    expect(result.timeBankSnapshot.cancellationCreditPolicy.enabled).toBe(false);
    expect(result.timeBankSnapshot.cancellationPolicyValid).toBe(true);
  });

  it("cancellation credit inherited from template", () => {
    const tbr: TimeBankTemplateRules = {
      cancellationCreditPolicy: {
        enabled: true,
        deductionMethod: "percentage",
        deductionPercent: 25,
      },
    };
    const tpl = makeTemplate({
      status: "active",
      timeBankEligible: true,
      timeBankTemplateRules: tbr,
    });
    const lines = [makeTemplateLine(tpl.id, tpl.templateGroupId)];

    const result = createAgreementFromTemplate({
      template: tpl,
      lines,
      customerId: "cust_1",
      companyId: "company_1",
    });

    expect(result.timeBankSnapshot.cancellationCreditPolicy.enabled).toBe(true);
    expect(result.timeBankSnapshot.cancellationCreditPolicy.deductionMethod).toBe("percentage");
    expect(result.timeBankSnapshot.cancellationCreditPolicy.deductionPercent).toBe(25);
  });

  it("cancellation policy override wins over template", () => {
    const tbr: TimeBankTemplateRules = {
      cancellationCreditPolicy: {
        enabled: true,
        deductionMethod: "percentage",
        deductionPercent: 25,
      },
    };
    const tpl = makeTemplate({
      status: "active",
      timeBankEligible: true,
      timeBankTemplateRules: tbr,
    });
    const lines = [makeTemplateLine(tpl.id, tpl.templateGroupId)];

    const result = createAgreementFromTemplate({
      template: tpl,
      lines,
      customerId: "cust_1",
      companyId: "company_1",
      overrides: {
        cancellationPolicyOverride: { enabled: false },
      },
    });

    expect(result.timeBankSnapshot.cancellationCreditPolicy.enabled).toBe(false);
  });

  // ── Entitlement compatibility ───────────────────────────────

  it("template may suggest Time Bank but entitlement gate is NOT enforced here", () => {
    // This test confirms that createAgreementFromTemplate does NOT check
    // entitlements — the snapshot is produced regardless. The caller must
    // apply the entitlement gate before creating a wallet.
    const tbr: TimeBankTemplateRules = {
      timeBankEnabled: true,
      allocationMinutes: 9999,
    };
    const tpl = makeTemplate({
      status: "active",
      timeBankEligible: true,
      timeBankTemplateRules: tbr,
    });
    const lines = [makeTemplateLine(tpl.id, tpl.templateGroupId)];

    const result = createAgreementFromTemplate({
      template: tpl,
      lines,
      customerId: "cust_1",
      companyId: "company_1",
    });

    // The snapshot IS produced (Time Bank enabled)
    expect(result.timeBankSnapshot.timeBankEnabled).toBe(true);
    // But no wallet is created — the caller must gate that
    expect(result.timeBankSnapshot.rules.allocationMinutes).toBe(9999);

    // Entitlement enforcement is the caller's responsibility
  });

  // ── agreementGroupId continuity ─────────────────────────────

  it("agreementGroupId is freshly generated and lines belong to the same group", () => {
    const tpl = makeTemplate({ status: "active" });
    const lines = [makeTemplateLine(tpl.id, tpl.templateGroupId)];

    const result = createAgreementFromTemplate({
      template: tpl,
      lines,
      customerId: "cust_1",
      companyId: "company_1",
    });

    const groupId = result.agreement.agreementGroupId;
    expect(groupId).toBeTruthy();

    // Every line belongs to the same group
    for (const line of result.lines) {
      expect(line.agreementGroupId).toBe(groupId);
      expect(line.agreementId).toBe(result.agreement.id);
    }
  });

  // ── Billing model override (hybrid) ─────────────────────────

  it("copies billingModelOverride from template line to agreement line", () => {
    const tpl = makeTemplate({ status: "active", billingModel: "hybrid" });
    const line = makeTemplateLine(tpl.id, tpl.templateGroupId, {
      billingModelOverride: "time_bank",
    });

    const result = createAgreementFromTemplate({
      template: tpl,
      lines: [line],
      customerId: "cust_1",
      companyId: "company_1",
    });

    expect(result.lines[0].billingModelOverride).toBe("time_bank");
  });

  // ── Multiple creations from same template ───────────────────

  it("multiple agreements created from the same template are independent of each other", () => {
    const tpl = makeTemplate({ status: "active" });
    const lines = [makeTemplateLine(tpl.id, tpl.templateGroupId)];

    const r1 = createAgreementFromTemplate({
      template: tpl, lines, customerId: "cust_A", companyId: "company_1",
      overrides: { header: { name: "Agreement A" } },
    });
    const r2 = createAgreementFromTemplate({
      template: tpl, lines, customerId: "cust_B", companyId: "company_1",
      overrides: { header: { name: "Agreement B" } },
    });

    expect(r1.agreement.id).not.toBe(r2.agreement.id);
    expect(r1.agreement.agreementGroupId).not.toBe(r2.agreement.agreementGroupId);
    expect(r1.agreement.name).toBe("Agreement A");
    expect(r2.agreement.name).toBe("Agreement B");
    expect(r1.agreement.customerId).toBe("cust_A");
    expect(r2.agreement.customerId).toBe("cust_B");
  });
});
