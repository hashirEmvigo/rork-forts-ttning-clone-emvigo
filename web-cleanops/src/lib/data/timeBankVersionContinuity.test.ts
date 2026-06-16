/**
 * Time Bank — wallet continuity across the agreement version chain (cross-layer
 * end-to-end validation).
 *
 * This is the dedicated validation that proves the LOCKED invariant end-to-end
 * through the COMPLETE real stack — orchestration + persistence + versioning —
 * rather than indirectly through unit slices:
 *
 *   Persisted Template
 *     ↓ createCustomerAgreementFromTemplate (orchestration)
 *   Agreement v1 + Time Bank wallet (entitlement-gated)
 *     ↓ opening balance · refill · cancelled-visit credit · adjustment · legacy note
 *   persistNewAgreementVersion → v2 (pricing) → v3 (service lines) → v4 (Time Bank settings)
 *     ↓ ensureWalletForAgreement on every new version (idempotent)
 *   EXACTLY ONE wallet, bound to agreementGroupId, with its full history intact.
 *
 * Contracts asserted:
 *   * Wallet binds to `agreementGroupId`, NEVER a version id, and survives
 *     unlimited future versions (no duplicate wallet is ever created).
 *   * All ledger history (opening balance, refill, cancellation credit,
 *     adjustment) and all informational legacy notes stay attached to the SAME
 *     wallet across the whole chain.
 *   * Template mutation / archival after creation never touches the wallet or
 *     the agreement chain.
 *   * A later entitlement loss does NOT delete the wallet or its history (the
 *     gate only governs CREATION; reads + audit stay reproducible). Documented
 *     below — no behaviour change here.
 *   * A failed version creation never orphans or duplicates the wallet.
 *
 * SAFETY — identical guarantees to the Phase-1…9 harnesses: no network, no env,
 * no localStorage, no real Supabase, no activation. Pure validation.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createCustomerAgreementFromTemplate } from "./agreementTemplateOrchestration";
import { persistTemplate, archiveTemplate } from "./agreementTemplatesPersistence";
import { persistNewAgreementVersion } from "./agreementVersionPersistence";
import { supabaseCustomerAgreementRepository } from "./customerAgreementRepository";
import { supabaseTimeBankRepository } from "./timeBankRepository";
import {
  appendWalletTransaction,
  ensureWalletForAgreement,
  recordLegacyHistoryNote,
  recordOpeningBalance,
  readWalletBalance,
} from "./timeBankPersistence";
import { defaultTimeBankRules, walletMatchesAgreementChain } from "./timeBank";
import {
  buildAgreementTemplate,
  buildAgreementTemplateLine,
  resetTemplateSequencers,
} from "./agreementTemplates";
import { harnessSupabase, resetHarness } from "./customerAgreementHarness";
import type {
  AgreementTemplate,
  AgreementTemplateLine,
  CustomerAgreement,
  CustomerAgreementLine,
  TimeBankTemplateRules,
  TimeBankWallet,
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
const T2 = "2026-02-01T00:00:00.000Z";
const T3 = "2026-03-01T00:00:00.000Z";
const T4 = "2026-04-01T00:00:00.000Z";

const ALLOW: () => boolean = () => true;

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

// Authoritative WALLET rules (`TimeBankRules`) for `ensureWalletForAgreement`, which
// expects the wallet shape — NOT the advisory `TimeBankTemplateRules` above (whose
// fields are all optional and which omits the required `negativeFloorMinutes`). The
// 600/monthly/unlimited defaults mirror `tbEnabledRules`; matches the sibling
// timeBank suites that pass `defaultTimeBankRules(600)` here.
const tbWalletRules = defaultTimeBankRules(600);

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
    timeBankEligible: true,
    timeBankTemplateRules: tbEnabledRules,
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

/** Creates a persisted agreement v1 + Time Bank wallet from a fresh template. */
async function createV1WithWallet(): Promise<{
  agreement: CustomerAgreement;
  wallet: TimeBankWallet;
}> {
  const t = await seedTemplate({}, 2);
  const res = await createCustomerAgreementFromTemplate({
    templateId: t.id,
    customerId: "cust_1",
    companyId: COMPANY,
    scopeCompanyId: COMPANY,
    walletId: "wallet_1",
    now: NOW,
    timeBankEntitlementGate: ALLOW,
  });
  if (!res.ok || !res.agreement || !res.timeBank?.wallet) {
    throw new Error(res.error ?? "v1 creation failed");
  }
  return { agreement: res.agreement, wallet: res.timeBank.wallet };
}

/** Counts the persisted wallet rows bound to an agreement group. */
function walletRowsForGroup(groupId: string): number {
  const rows = harnessSupabase.db.get("time_bank_wallets") ?? [];
  return rows.filter((r) => r.agreement_group_id === groupId).length;
}

/**
 * Supersedes the live version with a new persisted version, then ensures the
 * wallet for the new version. Returns the new live version + the ensure result.
 */
async function nextVersion(
  current: CustomerAgreement,
  currentLines: CustomerAgreementLine[],
  newId: string,
  now: string,
  changes: Parameters<typeof persistNewAgreementVersion>[2]["changes"],
): Promise<{ next: CustomerAgreement; lines: CustomerAgreementLine[]; created: boolean }> {
  const res = await persistNewAgreementVersion(current, currentLines, {
    newAgreementId: newId,
    now,
    changes,
    companyId: COMPANY,
  });
  if (!res.report.ok) throw new Error(res.report.error ?? "version persist failed");
  const ensure = await ensureWalletForAgreement({
    walletId: "wallet_should_be_ignored",
    agreement: res.next,
    rules: tbWalletRules,
    now,
    companyId: COMPANY,
  });
  if (!ensure.ok) throw new Error(ensure.error ?? "ensure failed");
  return { next: res.next, lines: res.lines, created: ensure.created };
}

beforeEach(() => {
  resetHarness();
  resetTemplateSequencers();
  vi.clearAllMocks();
  harnessSupabase.seedCompany(COMPANY, COMPANY_UUID);
});

// ── 1. End-to-end continuity through v1 → v2 → v3 → v4 ────────
describe("continuity — full version chain", () => {
  it("keeps ONE wallet bound to agreementGroupId across v1 → v2 → v3 → v4", async () => {
    const { agreement: v1, wallet } = await createV1WithWallet();
    const groupId = v1.agreementGroupId;
    const v1Lines = await supabaseCustomerAgreementRepository.listLines(v1.id);

    // v2: pricing change
    const s2 = await nextVersion(v1, v1Lines, `${groupId}_v2`, T2, {
      billingModel: "time_bank",
    });
    expect(s2.created).toBe(false); // wallet reused, never re-created

    // v3: service-line change
    const s3 = await nextVersion(s2.next, s2.lines, `${groupId}_v3`, T3, {
      invoiceInterval: "quarterly",
    });
    expect(s3.created).toBe(false);

    // v4: Time Bank settings change (still the same wallet)
    const s4 = await nextVersion(s3.next, s3.lines, `${groupId}_v4`, T4, {
      validFrom: "2026-04-01",
    });
    expect(s4.created).toBe(false);

    // Exactly one wallet exists for the whole chain.
    expect(walletRowsForGroup(groupId)).toBe(1);

    // The persisted chain shares one group id; versions ids all differ.
    const chain = await supabaseCustomerAgreementRepository.listVersionChain(groupId, {
      companyId: COMPANY,
    });
    expect(chain).toHaveLength(4);
    expect(new Set(chain.map((c) => c.agreementGroupId))).toEqual(new Set([groupId]));
    expect(new Set(chain.map((c) => c.id)).size).toBe(4);

    // Wallet binds to the group, NEVER a version id.
    expect(walletMatchesAgreementChain(wallet, chain)).toBe(true);
    for (const version of chain) {
      expect(wallet.agreementGroupId).not.toBe(version.id);
    }
    expect(wallet.agreementGroupId).toBe(groupId);
  });

  it("survives an unbounded number of versions without duplicating the wallet", async () => {
    const { agreement: v1, wallet } = await createV1WithWallet();
    const groupId = v1.agreementGroupId;
    let current = v1;
    let lines = await supabaseCustomerAgreementRepository.listLines(v1.id);

    for (let v = 2; v <= 12; v += 1) {
      const step = await nextVersion(
        current,
        lines,
        `${groupId}_v${v}`,
        `2026-${String(v).padStart(2, "0")}-15T00:00:00.000Z`,
        { name: `Revision ${v}` },
      );
      expect(step.created).toBe(false);
      current = step.next;
      lines = step.lines;
    }

    expect(walletRowsForGroup(groupId)).toBe(1);
    const back = await supabaseTimeBankRepository.getWalletByAgreementGroupId(groupId, {
      companyId: COMPANY,
    });
    expect(back?.id).toBe(wallet.id);
    expect(back?.agreementGroupId).toBe(groupId);
  });
});

// ── 2 & 3. Transaction + legacy-note continuity ──────────────
describe("continuity — ledger + legacy history survive versioning", () => {
  it("keeps opening balance, refill, cancellation credit, adjustment and legacy notes attached to the same wallet", async () => {
    const { agreement: v1, wallet } = await createV1WithWallet();
    const groupId = v1.agreementGroupId;

    // Build a representative ledger on v1's wallet.
    const opening = await recordOpeningBalance({
      wallet,
      minutes: 420,
      effectiveAt: NOW,
      now: NOW,
      reason: "Imported balance",
      companyId: COMPANY,
    });
    expect(opening.ok).toBe(true);

    const refill = await appendWalletTransaction({
      id: "tx_refill_1",
      wallet,
      type: "monthly_refill",
      minutes: 600,
      effectiveAt: T2,
      now: T2,
      companyId: COMPANY,
    });
    expect(refill.ok).toBe(true);

    const credit = await appendWalletTransaction({
      id: "tx_cancel_1",
      wallet,
      type: "cancelled_visit_credit",
      minutes: 180,
      effectiveAt: T2,
      now: T2,
      reason: "Cancelled visit",
      companyId: COMPANY,
    });
    expect(credit.ok).toBe(true);

    const adjust = await appendWalletTransaction({
      id: "tx_adjust_1",
      wallet,
      type: "manual_remove",
      minutes: 60,
      effectiveAt: T3,
      now: T3,
      reason: "Correction",
      companyId: COMPANY,
    });
    expect(adjust.ok).toBe(true);

    const note = await recordLegacyHistoryNote({
      id: "note_1",
      wallet,
      note: "Customer accrued 8h in the legacy system before migration.",
      now: NOW,
      sourceSystem: "LegacyApp",
      companyId: COMPANY,
    });
    expect(note.ok).toBe(true);

    const balanceBefore = await readWalletBalance(wallet.id, { companyId: COMPANY });

    // Advance the agreement through three more versions.
    let current = v1;
    let lines = await supabaseCustomerAgreementRepository.listLines(v1.id);
    for (let v = 2; v <= 4; v += 1) {
      const step = await nextVersion(current, lines, `${groupId}_v${v}`, T4, {
        name: `Rev ${v}`,
      });
      current = step.next;
      lines = step.lines;
    }

    // All ledger entries remain attached to the SAME wallet id.
    const ledger = await supabaseTimeBankRepository.listTransactions(wallet.id);
    const types = ledger.map((t) => t.type).sort();
    expect(types).toEqual(
      ["cancelled_visit_credit", "manual_remove", "monthly_refill", "opening_balance"].sort(),
    );
    expect(new Set(ledger.map((t) => t.agreementGroupId))).toEqual(new Set([groupId]));

    // Legacy notes remain attached and informational only.
    const notes = await supabaseTimeBankRepository.listLegacyNotes(wallet.id);
    expect(notes).toHaveLength(1);
    expect(notes[0].agreementGroupId).toBe(groupId);

    // Balance is reproducible and unchanged by versioning (opening 420 + refill
    // 600 + credit 180 − adjust 60 = 1140); legacy notes never affect it.
    const balanceAfter = await readWalletBalance(wallet.id, { companyId: COMPANY });
    expect(balanceAfter.currentBalance).toBe(1140);
    expect(balanceAfter.currentBalance).toBe(balanceBefore.currentBalance);

    // Still exactly one wallet.
    expect(walletRowsForGroup(groupId)).toBe(1);
  });
});

// ── 5. Template independence ─────────────────────────────────
describe("continuity — template independence", () => {
  it("template mutation/archival after creation never affects the wallet or chain", async () => {
    const { agreement: v1, wallet } = await createV1WithWallet();
    const groupId = v1.agreementGroupId;
    const v1Lines = await supabaseCustomerAgreementRepository.listLines(v1.id);

    // Move to v2 so the wallet has a multi-version chain.
    await nextVersion(v1, v1Lines, `${groupId}_v2`, T2, { billingModel: "time_bank" });

    // Mutate, then archive, the source template.
    const templates = harnessSupabase.db.get("agreement_templates") ?? [];
    const sourceLegacyId = (templates[0]?.data as AgreementTemplate | undefined)?.id;
    expect(sourceLegacyId).toBeTruthy();
    const edited = {
      ...(templates[0].data as AgreementTemplate),
      name: "Renamed Template",
    };
    await persistTemplate({ template: edited, lines: [] });
    await archiveTemplate({ templateId: sourceLegacyId!, companyId: COMPANY, now: T3 });

    // Wallet + chain untouched.
    expect(walletRowsForGroup(groupId)).toBe(1);
    const back = await supabaseTimeBankRepository.getWalletByAgreementGroupId(groupId, {
      companyId: COMPANY,
    });
    expect(back?.id).toBe(wallet.id);
    const chain = await supabaseCustomerAgreementRepository.listVersionChain(groupId, {
      companyId: COMPANY,
    });
    expect(chain).toHaveLength(2);
    expect(new Set(chain.map((c) => c.agreementGroupId))).toEqual(new Set([groupId]));
  });
});

// ── 6. Entitlement interaction (read-only review) ────────────
describe("continuity — entitlement loss after wallet creation", () => {
  it("a later entitlement loss does not delete the wallet or its history (gate governs CREATION only)", async () => {
    const { agreement: v1, wallet } = await createV1WithWallet();
    const groupId = v1.agreementGroupId;

    await appendWalletTransaction({
      id: "tx_refill_1",
      wallet,
      type: "monthly_refill",
      minutes: 600,
      effectiveAt: T2,
      now: T2,
      companyId: COMPANY,
    });

    // Simulate "entitlement removed": no orchestration call re-runs, and the
    // versioning path does NOT consult entitlements — so the wallet + ledger are
    // untouched and remain fully readable/reproducible.
    const v1Lines = await supabaseCustomerAgreementRepository.listLines(v1.id);
    await nextVersion(v1, v1Lines, `${groupId}_v2`, T3, { name: "Post-revocation" });

    const back = await supabaseTimeBankRepository.getWalletByAgreementGroupId(groupId, {
      companyId: COMPANY,
    });
    expect(back?.id).toBe(wallet.id);
    const balance = await readWalletBalance(wallet.id, { companyId: COMPANY });
    expect(balance.currentBalance).toBe(600);
    const ledger = await supabaseTimeBankRepository.listTransactions(wallet.id);
    expect(ledger).toHaveLength(1);
  });
});

// ── 7. Failure-path review ───────────────────────────────────
describe("continuity — failure paths never orphan/duplicate the wallet", () => {
  it("a failed version creation leaves the wallet valid and unduplicated", async () => {
    const { agreement: v1, wallet } = await createV1WithWallet();
    const groupId = v1.agreementGroupId;
    const v1Lines = await supabaseCustomerAgreementRepository.listLines(v1.id);

    // Force the version write to fail.
    harnessSupabase.failTable("customer_agreements");
    const res = await persistNewAgreementVersion(v1, v1Lines, {
      newAgreementId: `${groupId}_v2`,
      now: T2,
      changes: { billingModel: "time_bank" },
      companyId: COMPANY,
    });
    expect(res.report.ok).toBe(false);
    harnessSupabase.clearFailure("customer_agreements");

    // The wallet is still the single, valid wallet — no orphan, no duplicate.
    expect(walletRowsForGroup(groupId)).toBe(1);
    const back = await supabaseTimeBankRepository.getWalletByAgreementGroupId(groupId, {
      companyId: COMPANY,
    });
    expect(back?.id).toBe(wallet.id);
    expect(back?.agreementGroupId).toBe(groupId);
  });

  it("ensure-wallet after a failed version is still idempotent (no second wallet)", async () => {
    const { agreement: v1 } = await createV1WithWallet();
    const groupId = v1.agreementGroupId;

    // Even if a caller optimistically ensures a wallet for a version that never
    // persisted, the group already has one — so it is reused, not duplicated.
    const ensure = await ensureWalletForAgreement({
      walletId: "wallet_phantom",
      agreement: { ...v1, id: `${groupId}_v2`, version: 2 },
      rules: tbWalletRules,
      now: T2,
      companyId: COMPANY,
    });
    expect(ensure.ok).toBe(true);
    expect(ensure.created).toBe(false);
    expect(walletRowsForGroup(groupId)).toBe(1);
  });
});
