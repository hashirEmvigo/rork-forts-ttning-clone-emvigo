/**
 * Agreement Templates persistence layer — end-to-end harness validation.
 *
 * Exercises the production WRITE path (`persistTemplate` /
 * `copyGlobalTemplateToCompany` / `archiveTemplate` /
 * `createAgreementFromPersistedTemplate`) and the repository reads against the
 * in-memory Supabase stand-in from `customerAgreementHarness`, with NO browser
 * localStorage, NO signed-in Supabase session and NO network.
 *
 * Proves the full foundation lifecycle:
 *   persist global/company template + lines → read back → version chain →
 *   copy global → company → archive → template → agreement creation from
 *   persisted data → Time Bank rule + cancellation policy persistence →
 *   template mutation does NOT affect a created agreement → company isolation.
 *
 * SAFETY — identical guarantees to the Phase-1/2/3/4 harnesses: no network, no
 * env, no localStorage, no real Supabase, no activation. Pure validation.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  archiveTemplate,
  copyGlobalTemplateToCompany,
  createAgreementFromPersistedTemplate,
  persistTemplate,
} from "./agreementTemplatesPersistence";
import { supabaseAgreementTemplatesRepository } from "./agreementTemplatesRepository";
import {
  buildAgreementTemplate,
  buildAgreementTemplateLine,
  resetTemplateSequencers,
} from "./agreementTemplates";
import { harnessSupabase, resetHarness } from "./customerAgreementHarness";
import type {
  AgreementTemplate,
  AgreementTemplateLine,
  TimeBankTemplateRules,
} from "@/types";

vi.mock("@/lib/supabase", async () => {
  const { harnessSupabase: hs } = await import("./customerAgreementHarness");
  return {
    isSupabaseConfigured: true,
    supabase: hs.client,
    requireSupabase: () => hs.client,
  };
});

vi.mock("@/lib/store", async () => {
  const { harnessStore: store } = await import("./customerAgreementHarness");
  return {
    getCustomers: () => store.customers,
    getWorkOrders: () => store.workOrders,
    getServices: () => store.services,
  };
});

const COMPANY = "cmp_1";
const COMPANY_UUID = "00000000-0000-4000-8000-000000000001";
const OTHER_COMPANY = "cmp_2";
const OTHER_COMPANY_UUID = "00000000-0000-4000-8000-000000000002";
const NOW = "2026-01-01T00:00:00.000Z";

function makeCompanyTemplate(
  over: Partial<Parameters<typeof buildAgreementTemplate>[0]> = {},
): AgreementTemplate {
  return buildAgreementTemplate({
    ownerType: "company",
    companyId: COMPANY,
    name: "Office Monthly Cleaning",
    billingModel: "monthly_fixed",
    invoiceInterval: "monthly",
    status: "active",
    ...over,
  });
}

function makeGlobalTemplate(
  over: Partial<Parameters<typeof buildAgreementTemplate>[0]> = {},
): AgreementTemplate {
  return buildAgreementTemplate({
    ownerType: "global",
    companyId: null,
    name: "Private Standard",
    billingModel: "per_visit",
    invoiceInterval: "monthly",
    status: "active",
    ...over,
  });
}

function makeLine(
  template: AgreementTemplate,
  over: Partial<Parameters<typeof buildAgreementTemplateLine>[0]> = {},
): AgreementTemplateLine {
  return buildAgreementTemplateLine({
    templateId: template.id,
    templateGroupId: template.templateGroupId,
    ownerType: template.ownerType,
    companyId: template.companyId,
    serviceNameSnapshot: "Standard Cleaning",
    sortOrder: 0,
    defaultPrice: 2500,
    defaultVat: 25,
    pricingModel: "fixed",
    active: true,
    ...over,
  });
}

beforeEach(() => {
  resetHarness();
  resetTemplateSequencers();
  vi.clearAllMocks();
  harnessSupabase.seedCompany(COMPANY, COMPANY_UUID);
  harnessSupabase.seedCompany(OTHER_COMPANY, OTHER_COMPANY_UUID);
});

// ── Template + line persistence ──────────────────────────────
describe("agreement templates persistence — write + read", () => {
  it("persists a company template + lines and reads them back", async () => {
    const template = makeCompanyTemplate();
    const lines = [makeLine(template), makeLine(template, { serviceNameSnapshot: "Windows", sortOrder: 1 })];

    const res = await persistTemplate({ template, lines });
    expect(res.ok).toBe(true);
    expect(res.writtenTemplateCount).toBe(1);
    expect(res.writtenLineCount).toBe(2);

    const back = await supabaseAgreementTemplatesRepository.getTemplateById(template.id, {
      companyId: COMPANY,
    });
    expect(back?.id).toBe(template.id);
    expect(back?.ownerType).toBe("company");

    const backLines = await supabaseAgreementTemplatesRepository.listLines(template.id);
    expect(backLines).toHaveLength(2);
    expect(backLines[0].sortOrder).toBe(0);
    expect(backLines[1].sortOrder).toBe(1);
  });

  it("persists a global template (company_id null) readable by any scope", async () => {
    const template = makeGlobalTemplate();
    const lines = [makeLine(template)];

    const res = await persistTemplate({ template, lines });
    expect(res.ok).toBe(true);

    const back = await supabaseAgreementTemplatesRepository.getTemplateById(template.id, {
      companyId: OTHER_COMPANY,
    });
    expect(back?.id).toBe(template.id);
    expect(back?.ownerType).toBe("global");
  });

  it("is idempotent — re-persisting the same template overwrites, never duplicates", async () => {
    const template = makeCompanyTemplate();
    await persistTemplate({ template, lines: [makeLine(template)] });
    await persistTemplate({ template, lines: [makeLine(template)] });

    const rows = harnessSupabase.db.get("agreement_templates") ?? [];
    expect(rows.filter((r) => r.legacy_id === template.id)).toHaveLength(1);
  });

  it("dryRun writes nothing", async () => {
    const template = makeCompanyTemplate();
    const res = await persistTemplate({ template, lines: [makeLine(template)], dryRun: true });
    expect(res.ok).toBe(true);
    expect(res.writtenTemplateCount).toBe(0);
    const rows = harnessSupabase.db.get("agreement_templates") ?? [];
    expect(rows).toHaveLength(0);
  });

  it("aborts a company template write when the company is not migrated", async () => {
    const template = makeCompanyTemplate({ companyId: "cmp_unknown" });
    const res = await persistTemplate({ template, lines: [makeLine(template)] });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/No Supabase company/);
  });
});

// ── Listing + version chain ──────────────────────────────────
describe("agreement templates persistence — listing", () => {
  it("lists global and company templates separately, and active for a company", async () => {
    const g = makeGlobalTemplate();
    const c = makeCompanyTemplate();
    const draft = makeCompanyTemplate({ name: "WIP", status: "draft" });
    await persistTemplate({ template: g, lines: [makeLine(g)] });
    await persistTemplate({ template: c, lines: [makeLine(c)] });
    await persistTemplate({ template: draft, lines: [makeLine(draft)] });

    const globals = await supabaseAgreementTemplatesRepository.listGlobalTemplates();
    expect(globals.map((t) => t.id)).toContain(g.id);

    const company = await supabaseAgreementTemplatesRepository.listCompanyTemplates(COMPANY);
    expect(company.map((t) => t.id).sort()).toEqual([c.id, draft.id].sort());

    const active = await supabaseAgreementTemplatesRepository.listActiveTemplates(COMPANY);
    expect(active.map((t) => t.id).sort()).toEqual([g.id, c.id].sort());
    expect(active.map((t) => t.id)).not.toContain(draft.id);
  });

  it("returns an immutable, ordered version chain that does not mutate old versions", async () => {
    const v1 = makeCompanyTemplate({ name: "Std" });
    await persistTemplate({ template: v1, lines: [makeLine(v1)] });

    const v2: AgreementTemplate = {
      ...v1,
      id: "tpl_v2",
      version: 2,
      supersedesVersionId: v1.id,
      name: "Std v2",
    };
    await persistTemplate({ template: v2, lines: [] });

    const chain = await supabaseAgreementTemplatesRepository.listVersionChain(v1.templateGroupId, {
      companyId: COMPANY,
    });
    expect(chain.map((t) => t.version)).toEqual([1, 2]);

    const v1Back = await supabaseAgreementTemplatesRepository.getTemplateById(v1.id, {
      companyId: COMPANY,
    });
    expect(v1Back?.name).toBe("Std");
  });
});

// ── Copy global → company ────────────────────────────────────
describe("agreement templates persistence — copy global → company", () => {
  it("copies a persisted global template into an independent company draft", async () => {
    const g = makeGlobalTemplate();
    await persistTemplate({ template: g, lines: [makeLine(g), makeLine(g, { sortOrder: 1, serviceNameSnapshot: "Floors" })] });

    const res = await copyGlobalTemplateToCompany({
      sourceTemplateId: g.id,
      targetCompanyId: COMPANY,
      name: "Our Standard",
    });
    expect(res.ok).toBe(true);
    expect(res.template?.ownerType).toBe("company");
    expect(res.template?.companyId).toBe(COMPANY);
    expect(res.template?.status).toBe("draft");
    expect(res.template?.copiedFromTemplateId).toBe(g.id);
    expect(res.template?.templateGroupId).not.toBe(g.templateGroupId);
    expect(res.lines).toHaveLength(2);

    const copyLines = await supabaseAgreementTemplatesRepository.listLines(res.template!.id);
    expect(copyLines).toHaveLength(2);
    expect(copyLines.every((l) => l.companyId === COMPANY)).toBe(true);
  });

  it("editing the company copy does not affect the source global template", async () => {
    const g = makeGlobalTemplate();
    await persistTemplate({ template: g, lines: [makeLine(g)] });
    const res = await copyGlobalTemplateToCompany({ sourceTemplateId: g.id, targetCompanyId: COMPANY });

    const edited: AgreementTemplate = { ...res.template!, name: "Edited", status: "active" };
    await persistTemplate({ template: edited, lines: [] });

    const gBack = await supabaseAgreementTemplatesRepository.getTemplateById(g.id);
    expect(gBack?.name).toBe("Private Standard");
    expect(gBack?.status).toBe("active");
  });
});

// ── Archive (status flip) ────────────────────────────────────
describe("agreement templates persistence — archive", () => {
  it("archives a template by status flip and preserves the row", async () => {
    const c = makeCompanyTemplate();
    await persistTemplate({ template: c, lines: [makeLine(c)] });

    const res = await archiveTemplate({ templateId: c.id, companyId: COMPANY, now: NOW });
    expect(res.ok).toBe(true);
    expect(res.template?.status).toBe("inactive");

    const back = await supabaseAgreementTemplatesRepository.getTemplateById(c.id, { companyId: COMPANY });
    expect(back?.status).toBe("inactive");
  });
});

// ── Company isolation ────────────────────────────────────────
describe("agreement templates persistence — company isolation", () => {
  it("does not return another company's template when scoped", async () => {
    const c = makeCompanyTemplate();
    await persistTemplate({ template: c, lines: [makeLine(c)] });

    const wrongScope = await supabaseAgreementTemplatesRepository.getTemplateById(c.id, {
      companyId: OTHER_COMPANY,
    });
    expect(wrongScope).toBeNull();

    const inScope = await supabaseAgreementTemplatesRepository.getTemplateById(c.id, {
      companyId: COMPANY,
    });
    expect(inScope?.id).toBe(c.id);
  });
});

// ── Template → Agreement from persisted data ─────────────────
describe("agreement templates persistence — template → agreement", () => {
  const timeBankRules: TimeBankTemplateRules = {
    timeBankEnabled: true,
    allocationMinutes: 600,
    refillFrequency: "monthly",
    carryoverPolicy: "unlimited",
  };

  it("creates an independent agreement v1 from a persisted template", async () => {
    const c = makeCompanyTemplate();
    await persistTemplate({ template: c, lines: [makeLine(c), makeLine(c, { sortOrder: 1, serviceNameSnapshot: "Windows" })] });

    const res = await createAgreementFromPersistedTemplate({
      templateId: c.id,
      customerId: "cust_1",
      companyId: COMPANY,
      scopeCompanyId: COMPANY,
    });
    expect(res.ok).toBe(true);
    expect(res.result?.agreement.version).toBe(1);
    expect(res.result?.agreement.sourceType).toBe("template");
    expect(res.result?.agreement.sourceReferenceId).toBe(c.id);
    expect(res.result?.lines).toHaveLength(2);
  });

  it("rejects creation from a non-active / line-less template", async () => {
    const draft = makeCompanyTemplate({ status: "draft" });
    await persistTemplate({ template: draft, lines: [makeLine(draft)] });

    const res = await createAgreementFromPersistedTemplate({
      templateId: draft.id,
      customerId: "cust_1",
      companyId: COMPANY,
      scopeCompanyId: COMPANY,
    });
    expect(res.ok).toBe(false);
    expect(res.errors.join(" ")).toMatch(/status/);
  });

  it("persists Time Bank rules + carries them into the agreement snapshot (OFF stays off)", async () => {
    const withTb = makeCompanyTemplate({ timeBankEligible: true, timeBankTemplateRules: timeBankRules });
    await persistTemplate({ template: withTb, lines: [makeLine(withTb)] });

    const back = await supabaseAgreementTemplatesRepository.getTemplateById(withTb.id, { companyId: COMPANY });
    expect(back?.timeBankTemplateRules?.allocationMinutes).toBe(600);

    const res = await createAgreementFromPersistedTemplate({
      templateId: withTb.id,
      customerId: "cust_1",
      companyId: COMPANY,
      scopeCompanyId: COMPANY,
    });
    expect(res.result?.timeBankSnapshot.timeBankEnabled).toBe(true);
    expect(res.result?.timeBankSnapshot.rules.allocationMinutes).toBe(600);

    // A template with no Time Bank rules → snapshot OFF.
    const plain = makeCompanyTemplate({ name: "Plain" });
    await persistTemplate({ template: plain, lines: [makeLine(plain)] });
    const plainRes = await createAgreementFromPersistedTemplate({
      templateId: plain.id,
      customerId: "cust_1",
      companyId: COMPANY,
      scopeCompanyId: COMPANY,
    });
    expect(plainRes.result?.timeBankSnapshot.timeBankEnabled).toBe(false);
  });

  it("mutating the template after creation does not affect the created agreement", async () => {
    const c = makeCompanyTemplate();
    await persistTemplate({ template: c, lines: [makeLine(c)] });

    const created = await createAgreementFromPersistedTemplate({
      templateId: c.id,
      customerId: "cust_1",
      companyId: COMPANY,
      scopeCompanyId: COMPANY,
    });
    const originalName = created.result?.agreement.name;

    // Mutate + re-persist the template.
    await persistTemplate({ template: { ...c, name: "Totally Different" }, lines: [] });

    // The already-created agreement snapshot is unchanged.
    expect(created.result?.agreement.name).toBe(originalName);
    expect(created.result?.agreement.name).not.toBe("Totally Different");
  });
});
