/**
 * Time Bank persistence layer — end-to-end harness validation.
 *
 * Exercises the production WRITE path (`ensureWalletForAgreement` /
 * `appendWalletTransaction` / `recordOpeningBalance`) and the balance read
 * helpers against the in-memory Supabase stand-in from `customerAgreementHarness`,
 * with NO browser localStorage, NO signed-in Supabase session and NO network.
 *
 * Proves the full foundation lifecycle:
 *   create wallet → persist → append ledger → read transactions → derive balance
 *   → derive historical balance → reservation/consumption/release → frozen/closed
 *   gates → idempotency → cross-company scope → agreement-version continuity.
 *
 * SAFETY — identical guarantees to the Phase-1/2/3 harnesses: no network, no env,
 * no localStorage, no real Supabase, no activation, no production-authoritative
 * flip. Pure validation.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  appendWalletTransaction,
  ensureWalletForAgreement,
  readWalletBalance,
  readWalletBalanceAsOf,
  readWalletStatement,
  recordOpeningBalance,
  setWalletStatus,
} from "./timeBankPersistence";
import { supabaseTimeBankRepository } from "./timeBankRepository";
import { defaultTimeBankRules, walletMatchesAgreementChain } from "./timeBank";
import { harnessSupabase, resetHarness } from "./customerAgreementHarness";
import type { CustomerAgreement, TimeBankWallet } from "@/types";

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
const GROUP = "grp_1";
const T1 = "2026-01-01T00:00:00.000Z";
const T2 = "2026-02-01T00:00:00.000Z";
const T3 = "2026-03-01T00:00:00.000Z";

function makeAgreement(over: Partial<CustomerAgreement> = {}): CustomerAgreement {
  return {
    id: "grp1_v1",
    agreementGroupId: GROUP,
    companyId: COMPANY,
    customerId: "cust_1",
    version: 1,
    status: "active",
    billingModel: "time_bank",
    invoiceInterval: "monthly",
    name: "Time bank agreement",
    sourceType: "manual",
    sourceReferenceId: null,
    supersedesVersionId: null,
    supersededById: null,
    validFrom: "2026-01-01",
    validTo: null,
    notes: null,
    createdBy: "user_1",
    createdAt: T1,
    updatedAt: T1,
    ...over,
  };
}

async function makeWallet(
  over: { walletId?: string; status?: TimeBankWallet["status"]; agreement?: CustomerAgreement } = {},
): Promise<TimeBankWallet> {
  const res = await ensureWalletForAgreement({
    walletId: over.walletId ?? "wallet_1",
    agreement: over.agreement ?? makeAgreement(),
    rules: defaultTimeBankRules(600),
    now: T1,
    status: over.status,
    companyId: COMPANY,
  });
  if (!res.wallet) throw new Error(res.error ?? "wallet creation failed");
  return res.wallet;
}

beforeEach(() => {
  resetHarness();
  vi.clearAllMocks();
  harnessSupabase.seedCompany(COMPANY, COMPANY_UUID);
  harnessSupabase.seedCompany(OTHER_COMPANY, OTHER_COMPANY_UUID);
});

// ── Wallet creation + idempotency ────────────────────────────
describe("time bank persistence — wallet creation", () => {
  it("creates a wallet bound to agreementGroupId and reads it back", async () => {
    const res = await ensureWalletForAgreement({
      walletId: "wallet_1",
      agreement: makeAgreement(),
      rules: defaultTimeBankRules(600),
      now: T1,
      companyId: COMPANY,
    });
    expect(res.ok).toBe(true);
    expect(res.created).toBe(true);
    expect(res.wallet?.agreementGroupId).toBe(GROUP);

    const back = await supabaseTimeBankRepository.getWalletByAgreementGroupId(GROUP, {
      companyId: COMPANY,
    });
    expect(back?.id).toBe("wallet_1");
    expect(back?.agreementGroupId).toBe(GROUP);
    expect(back?.status).toBe("active");
  });

  it("is idempotent per agreementGroupId — a second call reuses the existing wallet", async () => {
    await makeWallet();
    const second = await ensureWalletForAgreement({
      walletId: "wallet_DIFFERENT",
      agreement: makeAgreement(),
      rules: defaultTimeBankRules(999),
      now: T2,
      companyId: COMPANY,
    });
    expect(second.ok).toBe(true);
    expect(second.created).toBe(false);
    expect(second.wallet?.id).toBe("wallet_1"); // original, not the new id

    const rows = harnessSupabase.db.get("time_bank_wallets") ?? [];
    expect(rows).toHaveLength(1);
  });

  it("aborts when the company has no Supabase tenant", async () => {
    const res = await ensureWalletForAgreement({
      walletId: "wallet_x",
      agreement: makeAgreement({ companyId: "ghost" }),
      rules: defaultTimeBankRules(600),
      now: T1,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("No Supabase company found");
    expect(harnessSupabase.db.get("time_bank_wallets") ?? []).toHaveLength(0);
  });
});

// ── Append + ordering + balance derivation ───────────────────
describe("time bank persistence — ledger append + balance", () => {
  it("appends entries, orders the ledger and derives the balance from reads", async () => {
    const wallet = await makeWallet();

    await appendWalletTransaction({
      id: "tx_refill",
      wallet,
      type: "monthly_refill",
      minutes: 600,
      effectiveAt: T1,
      now: T1,
      companyId: COMPANY,
    });
    await appendWalletTransaction({
      id: "tx_visit",
      wallet,
      type: "visit_consumption",
      minutes: 150,
      effectiveAt: T2,
      now: T2,
      serviceCategorySnapshot: "Recurring",
      billable: true,
      companyId: COMPANY,
    });

    const ledger = await supabaseTimeBankRepository.listTransactions("wallet_1");
    expect(ledger.map((t) => t.id)).toEqual(["tx_refill", "tx_visit"]); // effective_at order
    expect(ledger[1].minutes).toBe(-150); // sign normalised for consumption

    const balance = await readWalletBalance("wallet_1");
    expect(balance.currentBalance).toBe(450);
    expect(balance.availableBalance).toBe(450);
  });

  it("reproduces a historical balance as-of an instant from persisted data", async () => {
    const wallet = await makeWallet();
    await appendWalletTransaction({ id: "r1", wallet, type: "monthly_refill", minutes: 600, effectiveAt: T1, now: T1, companyId: COMPANY });
    await appendWalletTransaction({ id: "c1", wallet, type: "visit_consumption", minutes: 100, effectiveAt: T2, now: T2, companyId: COMPANY });
    await appendWalletTransaction({ id: "c2", wallet, type: "visit_consumption", minutes: 200, effectiveAt: T3, now: T3, companyId: COMPANY });

    expect((await readWalletBalanceAsOf("wallet_1", T1)).currentBalance).toBe(600);
    expect((await readWalletBalanceAsOf("wallet_1", T2)).currentBalance).toBe(500);
    expect((await readWalletBalanceAsOf("wallet_1", T3)).currentBalance).toBe(300);
    // The live balance is unchanged regardless of as-of reads.
    expect((await readWalletBalance("wallet_1")).currentBalance).toBe(300);
  });

  it("builds a statement (statistics) from the persisted ledger", async () => {
    const wallet = await makeWallet();
    await appendWalletTransaction({ id: "r1", wallet, type: "monthly_refill", minutes: 600, effectiveAt: T1, now: T1, companyId: COMPANY });
    await appendWalletTransaction({ id: "c1", wallet, type: "visit_consumption", minutes: 120, effectiveAt: T2, now: T2, serviceCategorySnapshot: "Windows", billable: true, companyId: COMPANY });
    await appendWalletTransaction({ id: "c2", wallet, type: "visit_consumption", minutes: 60, effectiveAt: T2, now: T2, serviceCategorySnapshot: "Windows", billable: false, companyId: COMPANY });

    const statement = await readWalletStatement("wallet_1");
    expect(statement.refillMinutes).toBe(600);
    expect(statement.consumptionMinutes).toBe(180);
    expect(statement.consumptionByCategory["Windows"]).toBe(180);
    expect(statement.billableMinutes).toBe(120);
    expect(statement.nonBillableMinutes).toBe(60);
    expect(statement.closingBalance).toBe(420);
  });
});

// ── Reservation → consumption → release lifecycle ────────────
describe("time bank persistence — reservation lifecycle", () => {
  it("reserve → consume → release leaves the expected current/reserved/available", async () => {
    const wallet = await makeWallet();
    await appendWalletTransaction({ id: "refill", wallet, type: "monthly_refill", minutes: 600, effectiveAt: T1, now: T1, companyId: COMPANY });

    // Reserve 120 for an upcoming visit.
    await appendWalletTransaction({ id: "res", wallet, type: "reservation", minutes: 120, effectiveAt: T1, now: T1, companyId: COMPANY });
    let b = await readWalletBalance("wallet_1");
    expect(b.currentBalance).toBe(600);
    expect(b.reservedBalance).toBe(120);
    expect(b.availableBalance).toBe(480);

    // Visit happens: consume 120 and release the reservation.
    await appendWalletTransaction({ id: "consume", wallet, type: "visit_consumption", minutes: 120, effectiveAt: T2, now: T2, companyId: COMPANY });
    await appendWalletTransaction({ id: "release", wallet, type: "reservation_release", minutes: 120, effectiveAt: T2, now: T2, companyId: COMPANY });
    b = await readWalletBalance("wallet_1");
    expect(b.currentBalance).toBe(480);
    expect(b.reservedBalance).toBe(0);
    expect(b.availableBalance).toBe(480);
  });
});

// ── Frozen / closed state-machine gates ──────────────────────
describe("time bank persistence — wallet state gates", () => {
  it("frozen wallet blocks new reservations but honours consumption/release", async () => {
    const wallet = await makeWallet({ status: "frozen" });

    const blocked = await appendWalletTransaction({ id: "res", wallet, type: "reservation", minutes: 60, effectiveAt: T1, now: T1, companyId: COMPANY });
    expect(blocked.ok).toBe(false);
    expect(blocked.blockedByGate).toBe(true);
    expect(harnessSupabase.db.get("time_bank_transactions") ?? []).toHaveLength(0);

    const allowed = await appendWalletTransaction({ id: "consume", wallet, type: "visit_consumption", minutes: 30, effectiveAt: T1, now: T1, companyId: COMPANY });
    expect(allowed.ok).toBe(true);
    expect(harnessSupabase.db.get("time_bank_transactions") ?? []).toHaveLength(1);
  });

  it("closed wallet rejects all transactions", async () => {
    const wallet = await makeWallet({ status: "closed" });
    const res = await appendWalletTransaction({ id: "tx", wallet, type: "visit_consumption", minutes: 10, effectiveAt: T1, now: T1, companyId: COMPANY });
    expect(res.ok).toBe(false);
    expect(res.blockedByGate).toBe(true);
    expect(harnessSupabase.db.get("time_bank_transactions") ?? []).toHaveLength(0);
  });
});

// ── Idempotency / duplicate prevention / opening balance ─────
describe("time bank persistence — idempotency", () => {
  it("re-appending the same transaction id does not duplicate the ledger entry", async () => {
    const wallet = await makeWallet();
    await appendWalletTransaction({ id: "tx_dup", wallet, type: "monthly_refill", minutes: 600, effectiveAt: T1, now: T1, companyId: COMPANY });
    await appendWalletTransaction({ id: "tx_dup", wallet, type: "monthly_refill", minutes: 600, effectiveAt: T1, now: T1, companyId: COMPANY });
    const rows = harnessSupabase.db.get("time_bank_transactions") ?? [];
    expect(rows.filter((r) => r.legacy_id === "tx_dup")).toHaveLength(1);
    expect((await readWalletBalance("wallet_1")).currentBalance).toBe(600);
  });

  it("opening balance is safely re-runnable (deterministic id → single entry)", async () => {
    const wallet = await makeWallet();
    await recordOpeningBalance({ wallet, minutes: 300, effectiveAt: T1, now: T1, companyId: COMPANY });
    await recordOpeningBalance({ wallet, minutes: 300, effectiveAt: T1, now: T1, companyId: COMPANY });
    const rows = harnessSupabase.db.get("time_bank_transactions") ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0].legacy_id).toBe("wallet_1-opening");
    expect((await readWalletBalance("wallet_1")).currentBalance).toBe(300);
  });
});

// ── Write-failure handling ───────────────────────────────────
describe("time bank persistence — failure handling", () => {
  it("returns ok=false (no throw) when the wallet write fails", async () => {
    harnessSupabase.failTable("time_bank_wallets");
    const res = await ensureWalletForAgreement({
      walletId: "wallet_1",
      agreement: makeAgreement(),
      rules: defaultTimeBankRules(600),
      now: T1,
      companyId: COMPANY,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
  });

  it("returns ok=false when the transaction append fails — no partial ledger", async () => {
    const wallet = await makeWallet();
    harnessSupabase.failTable("time_bank_transactions");
    const res = await appendWalletTransaction({ id: "tx", wallet, type: "monthly_refill", minutes: 600, effectiveAt: T1, now: T1, companyId: COMPANY });
    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
  });

  it("rejects non-integer minutes before any write occurs", async () => {
    const wallet = await makeWallet();
    const res = await appendWalletTransaction({ id: "tx", wallet, type: "manual_add", minutes: 10.5, effectiveAt: T1, now: T1, companyId: COMPANY });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("integer");
    expect(harnessSupabase.db.get("time_bank_transactions") ?? []).toHaveLength(0);
  });
});

// ── Wallet status transitions (freeze / close) ───────────────
describe("time bank persistence — wallet status", () => {
  it("freezes an active wallet and persists the new status", async () => {
    const wallet = await makeWallet();
    const res = await setWalletStatus({ wallet, status: "frozen", now: T2, companyId: COMPANY });
    expect(res.ok).toBe(true);
    expect(res.wallet?.status).toBe("frozen");
    const reread = await supabaseTimeBankRepository.getWalletByAgreementGroupId(GROUP, {
      companyId: COMPANY,
    });
    expect(reread?.status).toBe("frozen");
  });

  it("a same-status transition is a safe no-op success", async () => {
    const wallet = await makeWallet();
    const res = await setWalletStatus({ wallet, status: "active", now: T2, companyId: COMPANY });
    expect(res.ok).toBe(true);
  });

  it("a closed wallet is terminal — status changes are blocked", async () => {
    const wallet = await makeWallet({ status: "closed" });
    const res = await setWalletStatus({ wallet, status: "active", now: T2, companyId: COMPANY });
    expect(res.ok).toBe(false);
    expect(res.blockedByGate).toBe(true);
  });
});

// ── Cross-company isolation ──────────────────────────────────
describe("time bank persistence — company scoping", () => {
  it("a wallet is only readable within its own company scope", async () => {
    await makeWallet();
    const inScope = await supabaseTimeBankRepository.getWalletByAgreementGroupId(GROUP, {
      companyId: COMPANY,
    });
    expect(inScope?.id).toBe("wallet_1");
    const outOfScope = await supabaseTimeBankRepository.getWalletByAgreementGroupId(GROUP, {
      companyId: OTHER_COMPANY,
    });
    expect(outOfScope).toBeNull();
  });

  it("listWalletsByCustomer only returns the requesting company's wallets", async () => {
    await makeWallet();
    expect(await supabaseTimeBankRepository.listWalletsByCustomer("cust_1", { companyId: COMPANY })).toHaveLength(1);
    expect(await supabaseTimeBankRepository.listWalletsByCustomer("cust_1", { companyId: OTHER_COMPANY })).toHaveLength(0);
  });
});

// ── Agreement-version continuity ─────────────────────────────
describe("time bank persistence — agreement integration", () => {
  it("a version change never creates a new wallet — continuity across v1 → v2 → v3", async () => {
    const v1 = makeAgreement({ id: "grp1_v1", version: 1 });
    const created = await ensureWalletForAgreement({
      walletId: "wallet_1",
      agreement: v1,
      rules: defaultTimeBankRules(600),
      now: T1,
      companyId: COMPANY,
    });
    expect(created.created).toBe(true);

    // New versions of the SAME group must reuse the wallet (no new wallet).
    const v2 = makeAgreement({ id: "grp1_v2", version: 2, status: "active" });
    const v3 = makeAgreement({ id: "grp1_v3", version: 3, status: "active" });
    for (const v of [v2, v3]) {
      const res = await ensureWalletForAgreement({
        walletId: `wallet_for_${v.id}`,
        agreement: v,
        rules: defaultTimeBankRules(600),
        now: T2,
        companyId: COMPANY,
      });
      expect(res.created).toBe(false);
      expect(res.wallet?.id).toBe("wallet_1");
    }

    const rows = harnessSupabase.db.get("time_bank_wallets") ?? [];
    expect(rows).toHaveLength(1);

    // Lookup is by agreementGroupId only — never a version id.
    const wallet = await supabaseTimeBankRepository.getWalletByAgreementGroupId(GROUP, {
      companyId: COMPANY,
    });
    expect(wallet).not.toBeNull();
    expect(walletMatchesAgreementChain(wallet as TimeBankWallet, [v1, v2, v3])).toBe(true);
  });

  it("ledger continuity: transactions recorded under different versions share one wallet/group", async () => {
    const v1 = makeAgreement({ id: "grp1_v1", version: 1 });
    const wallet = await makeWallet({ agreement: v1 });

    // Entry under v1, then under v2 (sourceAgreementVersionId differs, group is stable).
    await appendWalletTransaction({ id: "u1", wallet, type: "monthly_refill", minutes: 600, effectiveAt: T1, now: T1, sourceAgreementVersionId: "grp1_v1", companyId: COMPANY });
    await appendWalletTransaction({ id: "u2", wallet, type: "visit_consumption", minutes: 100, effectiveAt: T2, now: T2, sourceAgreementVersionId: "grp1_v2", companyId: COMPANY });

    const ledger = await supabaseTimeBankRepository.listTransactions("wallet_1");
    expect(new Set(ledger.map((t) => t.agreementGroupId))).toEqual(new Set([GROUP]));
    expect(ledger.map((t) => t.sourceAgreementVersionId)).toEqual(["grp1_v1", "grp1_v2"]);
    expect((await readWalletBalance("wallet_1")).currentBalance).toBe(500);
  });
});
