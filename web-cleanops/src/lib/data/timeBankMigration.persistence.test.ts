/**
 * Time Bank — Opening Balance & Legacy History persistence (harness validation).
 *
 * Exercises `recordOpeningBalance` (now a dedicated `opening_balance` ledger
 * entry with single-occurrence enforcement) and `recordLegacyHistoryNote` (an
 * informational-only row in a SEPARATE table) against the in-memory Supabase
 * stand-in — no network, no localStorage, no real Supabase, no activation.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ensureWalletForAgreement,
  readWalletBalance,
  readWalletStatement,
  recordLegacyHistoryNote,
  recordOpeningBalance,
} from "./timeBankPersistence";
import { supabaseTimeBankRepository } from "./timeBankRepository";
import { defaultTimeBankRules } from "./timeBank";
import { harnessSupabase, resetHarness } from "./customerAgreementHarness";
import type { CustomerAgreement, TimeBankWallet } from "@/types";

vi.mock("@/lib/supabase", async () => {
  const { harnessSupabase: hs } = await import("./customerAgreementHarness");
  return { isSupabaseConfigured: true, supabase: hs.client, requireSupabase: () => hs.client };
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
const GROUP = "grp_1";
const T1 = "2026-01-01T00:00:00.000Z";
const T2 = "2026-02-01T00:00:00.000Z";

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

async function makeWallet(): Promise<TimeBankWallet> {
  const res = await ensureWalletForAgreement({
    walletId: "wallet_1",
    agreement: makeAgreement(),
    rules: defaultTimeBankRules(600),
    now: T1,
    companyId: COMPANY,
  });
  if (!res.wallet) throw new Error(res.error ?? "wallet creation failed");
  return res.wallet;
}

beforeEach(() => {
  resetHarness();
  vi.clearAllMocks();
  harnessSupabase.seedCompany(COMPANY, COMPANY_UUID);
});

// ── Opening balance persistence ──────────────────────────────
describe("opening balance persistence", () => {
  it("persists a single opening_balance entry that drives the derived balance", async () => {
    const wallet = await makeWallet();
    const res = await recordOpeningBalance({
      wallet,
      minutes: 420,
      effectiveAt: T1,
      now: T1,
      sourceReference: "LEGACY-2025",
      companyId: COMPANY,
    });
    expect(res.ok).toBe(true);
    expect(res.transaction?.type).toBe("opening_balance");

    const rows = harnessSupabase.db.get("time_bank_transactions") ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("opening_balance");
    expect((await readWalletBalance("wallet_1")).currentBalance).toBe(420);

    const statement = await readWalletStatement("wallet_1");
    expect(statement.openingBalanceMinutes).toBe(420);
  });

  it("rejects a DIFFERENT second opening balance (at most one per wallet)", async () => {
    const wallet = await makeWallet();
    await recordOpeningBalance({ wallet, minutes: 300, effectiveAt: T1, now: T1, companyId: COMPANY });
    const second = await recordOpeningBalance({
      wallet,
      minutes: 999,
      effectiveAt: T2,
      now: T2,
      id: "wallet_1-opening-2",
      companyId: COMPANY,
    });
    expect(second.ok).toBe(false);
    expect(second.error).toContain("already exists");
    expect((await readWalletBalance("wallet_1")).currentBalance).toBe(300);
  });

  it("a same-id re-run stays an idempotent no-op", async () => {
    const wallet = await makeWallet();
    await recordOpeningBalance({ wallet, minutes: 300, effectiveAt: T1, now: T1, companyId: COMPANY });
    await recordOpeningBalance({ wallet, minutes: 300, effectiveAt: T1, now: T1, companyId: COMPANY });
    const rows = harnessSupabase.db.get("time_bank_transactions") ?? [];
    expect(rows).toHaveLength(1);
    expect((await readWalletBalance("wallet_1")).currentBalance).toBe(300);
  });
});

// ── Legacy history note persistence ──────────────────────────
describe("legacy history note persistence", () => {
  it("stores notes in a SEPARATE table that never touches the ledger/balance", async () => {
    const wallet = await makeWallet();
    await recordOpeningBalance({ wallet, minutes: 200, effectiveAt: T1, now: T1, companyId: COMPANY });

    const res = await recordLegacyHistoryNote({
      id: "note_1",
      wallet,
      note: "Customer previously accumulated 8 hours in the legacy system.",
      now: T1,
      importedBy: "user_admin",
      sourceSystem: "OldTimeBank v1",
      companyId: COMPANY,
    });
    expect(res.ok).toBe(true);

    // Note lives in its own table; the ledger is unchanged.
    const noteRows = harnessSupabase.db.get("time_bank_legacy_notes") ?? [];
    expect(noteRows).toHaveLength(1);
    expect(noteRows[0].note).toContain("8 hours");
    expect(noteRows[0].imported_by).toBe("user_admin");

    const txRows = harnessSupabase.db.get("time_bank_transactions") ?? [];
    expect(txRows).toHaveLength(1); // only the opening balance
    expect((await readWalletBalance("wallet_1")).currentBalance).toBe(200);
  });

  it("supports multiple note entries and reads them back", async () => {
    const wallet = await makeWallet();
    await recordLegacyHistoryNote({ id: "n1", wallet, note: "8 hours accrued", now: T1, companyId: COMPANY });
    await recordLegacyHistoryNote({ id: "n2", wallet, note: "3 hours used in March 2025", now: T2, companyId: COMPANY });

    const notes = await supabaseTimeBankRepository.listLegacyNotes("wallet_1");
    expect(notes).toHaveLength(2);
    expect(new Set(notes.map((n) => n.id))).toEqual(new Set(["n1", "n2"]));
  });

  it("rejects an empty note before any write", async () => {
    const wallet = await makeWallet();
    const res = await recordLegacyHistoryNote({ id: "n", wallet, note: "   ", now: T1, companyId: COMPANY });
    expect(res.ok).toBe(false);
    expect(harnessSupabase.db.get("time_bank_legacy_notes") ?? []).toHaveLength(0);
  });
});

// ── Migration scenario (end-to-end onboarding) ───────────────
describe("migration scenario — legacy customer onboarding", () => {
  it("create wallet → opening balance → paste legacy notes → wallet active", async () => {
    // 1. Determine starting balance and create the wallet.
    const wallet = await makeWallet();
    // 2. Opening Balance transaction (8h carried over).
    const opening = await recordOpeningBalance({
      wallet,
      minutes: 480,
      effectiveAt: T1,
      now: T1,
      companyId: COMPANY,
    });
    expect(opening.ok).toBe(true);
    // 3. Paste historical notes (informational only — even when structured
    //    transaction history is unavailable from the old system).
    await recordLegacyHistoryNote({
      id: "hist_1",
      wallet,
      note: "Legacy summary:\n8h accrued total\n3h used March 2025\n2h cancelled-visit credit",
      now: T1,
      sourceSystem: "Spreadsheet",
      companyId: COMPANY,
    });

    // 4. Wallet is operational: balance comes ONLY from the ledger.
    expect((await readWalletBalance("wallet_1")).currentBalance).toBe(480);
    const notes = await supabaseTimeBankRepository.listLegacyNotes("wallet_1");
    expect(notes).toHaveLength(1);
    expect(notes[0].note).toContain("8h accrued");
  });
});
