/**
 * Time Bank — entitlement integration harness (Phase 10).
 *
 * Proves Time Bank access is decided ENTIRELY through the REAL bundle-first
 * entitlement resolver (`@/lib/entitlements`), and that the orchestration layer
 * surfaces the structured decision in its report.
 *
 * The entitlement context loader is INJECTED so the real resolver path runs
 * with an in-memory context — NO Supabase, network, env, or session. Persistence
 * for the orchestration integration uses the same in-memory stand-in as the
 * Phase-9 harness.
 *
 * SAFETY — no network, no env, no localStorage, no real Supabase, no activation.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createTimeBankEntitlementGate,
  decideTimeBankEntitlement,
  resolveTimeBankEntitlement,
  type EntitlementContextLoader,
} from "./timeBankEntitlement";
import { createCustomerAgreementFromTemplate } from "./agreementTemplateOrchestration";
import { persistTemplate } from "./agreementTemplatesPersistence";
import { supabaseTimeBankRepository } from "./timeBankRepository";
import {
  buildAgreementTemplate,
  buildAgreementTemplateLine,
  resetTemplateSequencers,
} from "./agreementTemplates";
import { harnessSupabase, resetHarness } from "./customerAgreementHarness";
import { SERVICE_FEATURE_REGISTRY, TIME_BANK_KEY } from "@/lib/serviceRegistry";
import { resolveCompanyEntitlements } from "@/lib/entitlements/resolver";
import type {
  AssignmentRole,
  ResolutionContext,
  ResolvedCompanyEntitlements,
  RuntimeBundle,
  RuntimeBundleAssignment,
  RuntimeCompanyOverride,
} from "@/lib/entitlements/types";
import type {
  AgreementTemplate,
  AgreementTemplateLine,
  ServiceEntitlementStatus,
  ServiceGlobalEntitlement,
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
const NOW = "2026-01-01T00:00:00.000Z";
const NOW_DATE = new Date(NOW);

// ── Context builders (real registry, in-memory rows) ─────────────

function tbBundle(
  id: string,
  status: ServiceEntitlementStatus,
): RuntimeBundle {
  return {
    id,
    slug: id,
    name: id,
    bundleType: status === "disabled" ? "addon" : "base_plan",
    status: "active",
    grants: [{ serviceKey: TIME_BANK_KEY, status, limits: [] }],
  };
}

function tbAssignment(
  bundleId: string,
  role: AssignmentRole,
): RuntimeBundleAssignment {
  return {
    id: `as-${bundleId}`,
    companyId: COMPANY,
    bundleId,
    role,
    startsAt: "2025-01-01T00:00:00.000Z",
    endsAt: null,
  };
}

function tbOverride(status: ServiceEntitlementStatus): RuntimeCompanyOverride {
  return {
    id: "ov-time-bank",
    companyId: COMPANY,
    serviceKey: TIME_BANK_KEY,
    status,
    reason: "test",
    startsAt: "2025-01-01T00:00:00.000Z",
    endsAt: null,
    limits: [],
  };
}

function context(
  over: Partial<ResolutionContext> = {},
): ResolutionContext {
  return {
    registry: SERVICE_FEATURE_REGISTRY,
    globalEntitlements: [],
    bundles: [],
    assignments: [],
    overrides: [],
    now: NOW_DATE,
    ...over,
  };
}

/** An injectable loader returning a fixed context (or a null/failed load). */
function loaderFor(ctx: ResolutionContext | null): EntitlementContextLoader {
  return async () =>
    ctx
      ? { context: ctx, source: "supabase", reason: "ok", issues: [] }
      : { context: null, source: "none", reason: "supabase-not-configured", issues: [] };
}

function resolvedFor(ctx: ResolutionContext): ResolvedCompanyEntitlements {
  return resolveCompanyEntitlements(ctx, COMPANY);
}

// ── Pure decision ────────────────────────────────────────────────
describe("decideTimeBankEntitlement (pure)", () => {
  it("denies a company with no bundle / override (registry default disabled)", () => {
    const d = decideTimeBankEntitlement(resolvedFor(context()));
    expect(d.allowed).toBe(false);
    expect(d.status).toBe("disabled");
    expect(d.source).toBe("default");
    expect(d.globallyAvailable).toBe(true);
    expect(d.denialReason).toMatch(/not entitled/i);
  });

  it("allows a company entitled through a base bundle grant", () => {
    const d = decideTimeBankEntitlement(
      resolvedFor(
        context({
          bundles: [tbBundle("base", "enabled")],
          assignments: [tbAssignment("base", "base")],
        }),
      ),
    );
    expect(d.allowed).toBe(true);
    expect(d.status).toBe("enabled");
    expect(d.source).toBe("bundle");
    expect(d.contributingBundleIds).toContain("base");
    expect(d.denialReason).toBeNull();
  });

  it("allows a company entitled through an add-on bundle grant", () => {
    const d = decideTimeBankEntitlement(
      resolvedFor(
        context({
          bundles: [tbBundle("tb-addon", "enabled")],
          assignments: [tbAssignment("tb-addon", "addon")],
        }),
      ),
    );
    expect(d.allowed).toBe(true);
    expect(d.source).toBe("bundle");
    expect(d.contributingBundleIds).toContain("tb-addon");
  });

  it("treats a trial grant as entitled", () => {
    const d = decideTimeBankEntitlement(
      resolvedFor(
        context({
          bundles: [tbBundle("trial", "trial")],
          assignments: [tbAssignment("trial", "addon")],
        }),
      ),
    );
    expect(d.allowed).toBe(true);
    expect(d.status).toBe("trial");
  });

  it("denies when an override removes a bundle-granted entitlement", () => {
    const d = decideTimeBankEntitlement(
      resolvedFor(
        context({
          bundles: [tbBundle("base", "enabled")],
          assignments: [tbAssignment("base", "base")],
          overrides: [tbOverride("disabled")],
        }),
      ),
    );
    expect(d.allowed).toBe(false);
    expect(d.source).toBe("override");
  });

  it("denies (global gate) when Time Bank is globally unavailable", () => {
    const globalEntitlements: ServiceGlobalEntitlement[] = [
      { serviceKey: TIME_BANK_KEY, enabled: false, updatedBy: null, updatedAt: NOW },
    ];
    const d = decideTimeBankEntitlement(
      resolvedFor(
        context({
          globalEntitlements,
          bundles: [tbBundle("base", "enabled")],
          assignments: [tbAssignment("base", "base")],
        }),
      ),
    );
    expect(d.allowed).toBe(false);
    expect(d.globallyAvailable).toBe(false);
    expect(d.denialReason).toMatch(/platform/i);
  });
});

// ── Gate (real resolver via injected loader) ─────────────────────
describe("createTimeBankEntitlementGate", () => {
  it("resolves allowed for an entitled company", async () => {
    const gate = createTimeBankEntitlementGate({
      loadContext: loaderFor(
        context({
          bundles: [tbBundle("base", "enabled")],
          assignments: [tbAssignment("base", "base")],
        }),
      ),
    });
    const d = await gate(COMPANY);
    expect(d.allowed).toBe(true);
    expect(d.source).toBe("bundle");
  });

  it("resolves denied for a non-entitled company", async () => {
    const gate = createTimeBankEntitlementGate({ loadContext: loaderFor(context()) });
    const d = await gate(COMPANY);
    expect(d.allowed).toBe(false);
    expect(d.source).toBe("default");
  });

  it("denies (never grants) when the entitlement context cannot be loaded", async () => {
    const d = await resolveTimeBankEntitlement(COMPANY, { loadContext: loaderFor(null) });
    expect(d.allowed).toBe(false);
    expect(d.source).toBe("none");
    expect(d.denialReason).toMatch(/context unavailable/i);
  });
});

// ── Orchestration integration (real gate + report) ───────────────

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

function makeTemplate(): AgreementTemplate {
  return buildAgreementTemplate({
    ownerType: "company",
    companyId: COMPANY,
    name: "Office Monthly Cleaning",
    billingModel: "monthly_fixed",
    invoiceInterval: "monthly",
    status: "active",
    timeBankEligible: true,
    timeBankTemplateRules: tbEnabledRules,
  });
}

function makeLine(template: AgreementTemplate): AgreementTemplateLine {
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
  });
}

async function seedTemplate(): Promise<AgreementTemplate> {
  const template = makeTemplate();
  const res = await persistTemplate({ template, lines: [makeLine(template)] });
  if (!res.ok) throw new Error(res.error ?? "seed failed");
  return template;
}

beforeEach(() => {
  resetHarness();
  resetTemplateSequencers();
  vi.clearAllMocks();
  harnessSupabase.seedCompany(COMPANY, COMPANY_UUID);
});

describe("orchestration — real entitlement gate", () => {
  it("creates a wallet and reports the bundle source when entitled", async () => {
    const t = await seedTemplate();
    const gate = createTimeBankEntitlementGate({
      loadContext: loaderFor(
        context({
          bundles: [tbBundle("tb-addon", "enabled")],
          assignments: [tbAssignment("tb-addon", "addon")],
        }),
      ),
    });

    const res = await createCustomerAgreementFromTemplate({
      templateId: t.id,
      customerId: "cust_1",
      companyId: COMPANY,
      scopeCompanyId: COMPANY,
      walletId: "wallet_1",
      now: NOW,
      timeBankEntitlementGate: gate,
    });

    expect(res.ok).toBe(true);
    expect(res.timeBank?.enabled).toBe(true);
    expect(res.timeBank?.walletCreated).toBe(true);
    expect(res.timeBank?.entitlementStatus).toBe("enabled");
    expect(res.timeBank?.entitlementSource).toBe("bundle");
    expect(res.timeBank?.contributingBundleIds).toContain("tb-addon");
    expect(res.timeBank?.denialReason).toBeNull();

    const wallet = await supabaseTimeBankRepository.getWalletByAgreementGroupId(
      res.agreement!.agreementGroupId,
      { companyId: COMPANY },
    );
    expect(wallet?.agreementGroupId).toBe(res.agreement!.agreementGroupId);
  });

  it("creates the agreement but suppresses the wallet when denied, recording the reason", async () => {
    const t = await seedTemplate();
    const gate = createTimeBankEntitlementGate({ loadContext: loaderFor(context()) });

    const res = await createCustomerAgreementFromTemplate({
      templateId: t.id,
      customerId: "cust_1",
      companyId: COMPANY,
      scopeCompanyId: COMPANY,
      walletId: "wallet_1",
      now: NOW,
      timeBankEntitlementGate: gate,
    });

    expect(res.ok).toBe(true);
    expect(res.agreement).not.toBeNull();
    expect(res.timeBank?.enabled).toBe(false);
    expect(res.timeBank?.reason).toBe("entitlement_denied");
    expect(res.timeBank?.entitlementSource).toBe("default");
    expect(res.timeBank?.denialReason).toMatch(/not entitled/i);

    const wallet = await supabaseTimeBankRepository.getWalletByAgreementGroupId(
      res.agreement!.agreementGroupId,
      { companyId: COMPANY },
    );
    expect(wallet).toBeNull();
  });

  it("future compatibility: an override granting Time Bank also enables it", async () => {
    const t = await seedTemplate();
    const gate = createTimeBankEntitlementGate({
      loadContext: loaderFor(context({ overrides: [tbOverride("enabled")] })),
    });

    const res = await createCustomerAgreementFromTemplate({
      templateId: t.id,
      customerId: "cust_1",
      companyId: COMPANY,
      scopeCompanyId: COMPANY,
      walletId: "wallet_1",
      now: NOW,
      timeBankEntitlementGate: gate,
    });

    expect(res.ok).toBe(true);
    expect(res.timeBank?.enabled).toBe(true);
    expect(res.timeBank?.entitlementSource).toBe("override");
  });
});
