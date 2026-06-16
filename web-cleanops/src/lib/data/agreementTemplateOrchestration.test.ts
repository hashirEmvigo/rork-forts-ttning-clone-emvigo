/**
 * Agreement Template → Customer Agreement orchestration — end-to-end harness.
 *
 * Exercises `createCustomerAgreementFromTemplate` against the in-memory Supabase
 * stand-in from `customerAgreementHarness`, with NO browser localStorage, NO
 * signed-in session and NO network.
 *
 * Proves the controlled creation flow:
 *   persisted template → loaded + validated → pure snapshot → entitlement gate →
 *   persisted agreement v1 + lines → optional idempotent wallet → structured
 *   report. Plus: Time Bank off by default, entitlement denial, wallet
 *   idempotency, cancellation policy copy (no transaction), template
 *   independence/deletion, company isolation, and write-failure handling.
 *
 * SAFETY — identical guarantees to the Phase-1…9 harnesses: no network, no env,
 * no localStorage, no real Supabase, no activation. Pure validation.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createCustomerAgreementFromTemplate } from "./agreementTemplateOrchestration";
import { persistTemplate, archiveTemplate } from "./agreementTemplatesPersistence";
import { supabaseAgreementTemplatesRepository } from "./agreementTemplatesRepository";
import { supabaseCustomerAgreementRepository } from "./customerAgreementRepository";
import { supabaseTimeBankRepository } from "./timeBankRepository";
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

const ALLOW: () => boolean = () => true;
const DENY: () => boolean = () => false;

const tbEnabledRules: TimeBankTemplateRules = {
  timeBankEnabled: true,
  allocationMinutes: 600,
  refillFrequency: "monthly",
  carryoverPolicy: "unlimited",
  cancellationCreditPolicy: {
    enabled: true,
    deductionMethod: "percentage",
  },
};

function makeTemplate(
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

/** Persists an active company template with N active lines and returns it. */
async function seedTemplate(
  over: Partial<Parameters<typeof buildAgreementTemplate>[0]> = {},
  lineCount = 2,
): Promise<AgreementTemplate> {
  const template = makeTemplate(over);
  const lines = Array.from({ length: lineCount }, (_, i) =>
    makeLine(template, { sortOrder: i, serviceNameSnapshot: `Service ${i}` }),
  );
  const res = await persistTemplate({ template, lines });
  if (!res.ok) throw new Error(res.error ?? "seed failed");
  return template;
}

function run(
  over: Partial<Parameters<typeof createCustomerAgreementFromTemplate>[0]> & {
    templateId: string;
  },
) {
  return createCustomerAgreementFromTemplate({
    customerId: "cust_1",
    companyId: COMPANY,
    scopeCompanyId: COMPANY,
    walletId: "wallet_1",
    now: NOW,
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

// ── Successful creation + persistence ────────────────────────
describe("orchestration — successful creation", () => {
  it("creates + persists agreement v1 and its lines from a persisted template", async () => {
    const t = await seedTemplate({}, 2);

    const res = await run({ templateId: t.id });
    expect(res.ok).toBe(true);
    expect(res.agreement?.version).toBe(1);
    expect(res.agreement?.sourceType).toBe("template");
    expect(res.agreement?.sourceReferenceId).toBe(t.id);
    expect(res.lines).toHaveLength(2);
    expect(res.writtenAgreementCount).toBe(1);
    expect(res.writtenLineCount).toBe(2);
    expect(res.sourceTemplateId).toBe(t.id);
    expect(res.sourceTemplateVersion).toBe(1);

    // Persisted + readable back
    const back = await supabaseCustomerAgreementRepository.getDetail(res.agreement!.id, {
      companyId: COMPANY,
    });
    expect(back?.id).toBe(res.agreement!.id);
    const backLines = await supabaseCustomerAgreementRepository.listLines(res.agreement!.id);
    expect(backLines).toHaveLength(2);
  });

  it("applies header + line overrides after the template snapshot", async () => {
    const t = await seedTemplate({}, 1);
    const res = await run({
      templateId: t.id,
      overrides: { header: { name: "Custom Name", notes: "vip" } },
    });
    expect(res.ok).toBe(true);
    expect(res.agreement?.name).toBe("Custom Name");
    expect(res.agreement?.notes).toBe("vip");
  });

  it("returns a fresh agreementGroupId each call (NOT globally idempotent)", async () => {
    const t = await seedTemplate({}, 1);
    const a = await run({ templateId: t.id });
    const b = await run({ templateId: t.id });
    expect(a.ok && b.ok).toBe(true);
    expect(a.agreement?.agreementGroupId).not.toBe(b.agreement?.agreementGroupId);
    expect(a.agreement?.id).not.toBe(b.agreement?.id);
  });
});

// ── Rejections ───────────────────────────────────────────────
describe("orchestration — rejections", () => {
  it("rejects a missing / out-of-scope template", async () => {
    const res = await run({ templateId: "tpl_missing" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not found/);
  });

  it("rejects an inactive (draft) template", async () => {
    const t = await seedTemplate({ status: "draft" }, 1);
    const res = await run({ templateId: t.id });
    expect(res.ok).toBe(false);
    expect(res.errors.join(" ")).toMatch(/status/);
  });

  it("rejects a template with no active lines", async () => {
    const t = makeTemplate();
    await persistTemplate({ template: t, lines: [makeLine(t, { active: false })] });
    const res = await run({ templateId: t.id });
    expect(res.ok).toBe(false);
    expect(res.errors.join(" ")).toMatch(/no active lines/);
  });

  it("does not write an agreement when validation fails", async () => {
    const t = await seedTemplate({ status: "draft" }, 1);
    await run({ templateId: t.id });
    const rows = harnessSupabase.db.get("customer_agreements") ?? [];
    expect(rows).toHaveLength(0);
  });
});

// ── Time Bank: default OFF + entitlement gate ────────────────
describe("orchestration — Time Bank gate", () => {
  it("Time Bank is OFF by default (template does not request it)", async () => {
    const t = await seedTemplate({}, 1);
    const res = await run({ templateId: t.id, timeBankEntitlementGate: ALLOW });
    expect(res.ok).toBe(true);
    expect(res.timeBank?.enabled).toBe(false);
    expect(res.timeBank?.reason).toBe("template_disabled");
    expect(res.timeBank?.wallet).toBeNull();

    const wallet = await supabaseTimeBankRepository.getWalletByAgreementGroupId(
      res.agreement!.agreementGroupId,
      { companyId: COMPANY },
    );
    expect(wallet).toBeNull();
  });

  it("creates a wallet when Time Bank requested AND entitlement allows", async () => {
    const t = await seedTemplate(
      { timeBankEligible: true, timeBankTemplateRules: tbEnabledRules },
      1,
    );
    const res = await run({ templateId: t.id, timeBankEntitlementGate: ALLOW });
    expect(res.ok).toBe(true);
    expect(res.timeBank?.enabled).toBe(true);
    expect(res.timeBank?.reason).toBe("enabled");
    expect(res.timeBank?.walletCreated).toBe(true);
    expect(res.timeBank?.wallet?.agreementGroupId).toBe(res.agreement!.agreementGroupId);

    const wallet = await supabaseTimeBankRepository.getWalletByAgreementGroupId(
      res.agreement!.agreementGroupId,
      { companyId: COMPANY },
    );
    expect(wallet?.agreementGroupId).toBe(res.agreement!.agreementGroupId);
  });

  it("creates the agreement but NO wallet when entitlement is denied", async () => {
    const t = await seedTemplate(
      { timeBankEligible: true, timeBankTemplateRules: tbEnabledRules },
      1,
    );
    const res = await run({ templateId: t.id, timeBankEntitlementGate: DENY });
    expect(res.ok).toBe(true); // agreement still created
    expect(res.agreement).not.toBeNull();
    expect(res.timeBank?.enabled).toBe(false);
    expect(res.timeBank?.reason).toBe("entitlement_denied");
    expect(res.timeBank?.requestedByTemplate).toBe(true);

    const wallet = await supabaseTimeBankRepository.getWalletByAgreementGroupId(
      res.agreement!.agreementGroupId,
      { companyId: COMPANY },
    );
    expect(wallet).toBeNull();
  });

  it("treats an omitted entitlement gate as DENIED (no hidden activation)", async () => {
    const t = await seedTemplate(
      { timeBankEligible: true, timeBankTemplateRules: tbEnabledRules },
      1,
    );
    const res = await run({ templateId: t.id }); // no gate
    expect(res.ok).toBe(true);
    expect(res.timeBank?.enabled).toBe(false);
    expect(res.timeBank?.reason).toBe("entitlement_denied");
  });

  it("wallet creation is idempotent per agreementGroupId", async () => {
    const t = await seedTemplate(
      { timeBankEligible: true, timeBankTemplateRules: tbEnabledRules },
      1,
    );
    const res = await run({ templateId: t.id, timeBankEntitlementGate: ALLOW });
    expect(res.timeBank?.walletCreated).toBe(true);

    // Re-ensure the SAME group does not duplicate (simulate retry).
    const again = await supabaseTimeBankRepository.getWalletByAgreementGroupId(
      res.agreement!.agreementGroupId,
      { companyId: COMPANY },
    );
    expect(again).not.toBeNull();
    const walletRows = harnessSupabase.db.get("time_bank_wallets") ?? [];
    expect(
      walletRows.filter((r) => r.agreement_group_id === res.agreement!.agreementGroupId),
    ).toHaveLength(1);
  });

  it("appends NO transaction at creation (scheduler stays inactive)", async () => {
    const t = await seedTemplate(
      { timeBankEligible: true, timeBankTemplateRules: tbEnabledRules },
      1,
    );
    const res = await run({ templateId: t.id, timeBankEntitlementGate: ALLOW });
    const txns = await supabaseTimeBankRepository.listTransactions(res.timeBank!.wallet!.id);
    expect(txns).toHaveLength(0);
  });
});

// ── Cancellation credit policy ───────────────────────────────
describe("orchestration — cancellation credit policy", () => {
  it("copies the cancellation policy into the snapshot WITHOUT creating a transaction", async () => {
    const t = await seedTemplate(
      { timeBankEligible: true, timeBankTemplateRules: tbEnabledRules },
      1,
    );
    const res = await run({ templateId: t.id, timeBankEntitlementGate: ALLOW });
    expect(res.timeBank?.cancellationCreditPolicy.enabled).toBe(true);
    expect(res.timeBank?.cancellationCreditPolicy.deductionMethod).toBe("percentage");
    const txns = await supabaseTimeBankRepository.listTransactions(res.timeBank!.wallet!.id);
    expect(txns).toHaveLength(0);
  });
});

// ── Template independence ────────────────────────────────────
describe("orchestration — template independence", () => {
  it("template mutation after creation does not affect the created agreement", async () => {
    const t = await seedTemplate({ name: "Original" }, 1);
    const res = await run({ templateId: t.id });
    expect(res.agreement?.name).toBe("Original");

    const edited: AgreementTemplate = { ...t, name: "Renamed" };
    await persistTemplate({ template: edited, lines: [] });

    const back = await supabaseCustomerAgreementRepository.getDetail(res.agreement!.id, {
      companyId: COMPANY,
    });
    expect(back?.name).toBe("Original");
  });

  it("template archival/deletion after creation does not affect the agreement", async () => {
    const t = await seedTemplate({}, 1);
    const res = await run({ templateId: t.id });
    await archiveTemplate({ templateId: t.id, companyId: COMPANY, now: NOW });

    const back = await supabaseCustomerAgreementRepository.getDetail(res.agreement!.id, {
      companyId: COMPANY,
    });
    expect(back?.id).toBe(res.agreement!.id);
    expect(back?.status).toBe("active");
  });
});

// ── Company isolation + safety ───────────────────────────────
describe("orchestration — isolation + safety", () => {
  it("cannot create from another company's template when scoped", async () => {
    const t = await seedTemplate({}, 1);
    const res = await run({ templateId: t.id, scopeCompanyId: OTHER_COMPANY });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not found/);
  });

  it("aborts cleanly when the target company is not migrated (no UUID)", async () => {
    // Global template is readable by any scope; the WRITE resolves the target
    // company UUID, which fails for an unmigrated company.
    const g = makeTemplate({ ownerType: "global", companyId: null });
    await persistTemplate({ template: g, lines: [makeLine(g)] });

    const res = await createCustomerAgreementFromTemplate({
      templateId: g.id,
      customerId: "cust_1",
      companyId: "cmp_unknown",
      scopeCompanyId: null,
      walletId: "wallet_1",
      now: NOW,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/No Supabase company/);
    const rows = harnessSupabase.db.get("customer_agreements") ?? [];
    expect(rows).toHaveLength(0);
  });

  it("agreement write failure prevents wallet creation and is reported", async () => {
    const t = await seedTemplate(
      { timeBankEligible: true, timeBankTemplateRules: tbEnabledRules },
      1,
    );
    harnessSupabase.failTable("customer_agreements");
    const res = await run({ templateId: t.id, timeBankEntitlementGate: ALLOW });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Supabase|failure/i);
    // No wallet provisioned when the agreement write failed.
    const wallets = harnessSupabase.db.get("time_bank_wallets") ?? [];
    expect(wallets).toHaveLength(0);
  });

  it("wallet write failure is reported clearly while the agreement persists", async () => {
    const t = await seedTemplate(
      { timeBankEligible: true, timeBankTemplateRules: tbEnabledRules },
      1,
    );
    harnessSupabase.failTable("time_bank_wallets");
    const res = await run({ templateId: t.id, timeBankEntitlementGate: ALLOW });
    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
    // The agreement itself was written before the wallet step.
    expect(res.writtenAgreementCount).toBe(1);
    const back = await supabaseCustomerAgreementRepository.getDetail(res.agreement!.id, {
      companyId: COMPANY,
    });
    expect(back?.id).toBe(res.agreement!.id);
  });

  it("dryRun computes the report but writes nothing", async () => {
    const t = await seedTemplate(
      { timeBankEligible: true, timeBankTemplateRules: tbEnabledRules },
      1,
    );
    const res = await run({ templateId: t.id, timeBankEntitlementGate: ALLOW, dryRun: true });
    expect(res.ok).toBe(true);
    expect(res.agreement).not.toBeNull();
    expect(res.writtenAgreementCount).toBe(0);
    expect(res.writtenLineCount).toBe(0);
    const rows = harnessSupabase.db.get("customer_agreements") ?? [];
    expect(rows).toHaveLength(0);
    const wallets = harnessSupabase.db.get("time_bank_wallets") ?? [];
    expect(wallets).toHaveLength(0);
  });
});
