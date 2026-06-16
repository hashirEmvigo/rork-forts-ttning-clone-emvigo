/**
 * Tests for useTimeBankPanel (Phase 13 · admin panel persistence wiring).
 *
 * Exercises the container hook against the in-memory Supabase stand-in from
 * `customerAgreementHarness` — NO browser localStorage, NO signed-in Supabase
 * session, NO network. Validates repository loading, the safe write actions
 * (opening balance, legacy note, adjustment, freeze/close), single-opening-balance
 * prevention, refresh behaviour, error surfacing, and frozen/closed restrictions.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

import { useTimeBankPanel } from "./use-time-bank-panel";
import {
  appendWalletTransaction,
  ensureWalletForAgreement,
} from "@/lib/data/timeBankPersistence";
import { supabaseTimeBankRepository } from "@/lib/data/timeBankRepository";
import { defaultTimeBankRules } from "@/lib/data/timeBank";
import { harnessSupabase, resetHarness } from "@/lib/data/customerAgreementHarness";
import type { TimeBankEntitlementDecision } from "@/lib/data/timeBankEntitlement";
import type { CustomerAgreement, TimeBankWallet } from "@/types";

vi.mock("@/lib/supabase", async () => {
  const { harnessSupabase: hs } = await import("@/lib/data/customerAgreementHarness");
  return {
    isSupabaseConfigured: true,
    supabase: hs.client,
    requireSupabase: () => hs.client,
  };
});

const COMPANY = "cmp_1";
const COMPANY_UUID = "00000000-0000-4000-8000-000000000001";
const GROUP = "grp_1";
const T1 = "2026-01-01T00:00:00.000Z";

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
    notes: undefined,
    createdBy: "user_1",
    createdAt: T1,
    updatedAt: T1,
    ...over,
  };
}

async function seedWallet(status?: TimeBankWallet["status"]): Promise<TimeBankWallet> {
  const res = await ensureWalletForAgreement({
    walletId: "wallet_1",
    agreement: makeAgreement(),
    rules: defaultTimeBankRules(600),
    now: T1,
    status,
    companyId: COMPANY,
  });
  if (!res.wallet) throw new Error(res.error ?? "wallet seed failed");
  return res.wallet;
}

function entitled(allowed: boolean): TimeBankEntitlementDecision {
  return {
    allowed,
    status: allowed ? "enabled" : "disabled",
    source: allowed ? "bundle" : "none",
    contributingBundleIds: allowed ? ["bundle-pro"] : [],
    globallyAvailable: true,
    denialReason: allowed ? null : "Not entitled.",
  };
}

function args(over: Partial<Parameters<typeof useTimeBankPanel>[0]> = {}) {
  return {
    agreementGroupId: GROUP,
    companyId: COMPANY,
    timeBankEnabledOnAgreement: true,
    entitlement: entitled(true),
    cancellationPolicy: null,
    actor: { id: "user_1", name: "Admin" },
    now: () => T1,
    ...over,
  };
}

beforeEach(() => {
  resetHarness();
  vi.clearAllMocks();
  harnessSupabase.seedCompany(COMPANY, COMPANY_UUID);
});

describe("useTimeBankPanel — loading", () => {
  it("loads the wallet, ledger and legacy notes from the repository", async () => {
    const wallet = await seedWallet();
    await appendWalletTransaction({
      id: "tx_1",
      wallet,
      type: "monthly_refill",
      minutes: 600,
      effectiveAt: T1,
      now: T1,
      companyId: COMPANY,
    });

    const { result } = renderHook(() => useTimeBankPanel(args()));

    await waitFor(() => expect(result.current.input.wallet).not.toBeNull());
    expect(result.current.input.transactions).toHaveLength(1);
    expect(result.current.loadError).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it("yields a null wallet (no error) when none exists", async () => {
    const { result } = renderHook(() => useTimeBankPanel(args()));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.input.wallet).toBeNull();
    expect(result.current.loadError).toBeNull();
  });

  it("surfaces a load error when the wallet read fails", async () => {
    await seedWallet();
    harnessSupabase.failTable("time_bank_wallets");
    const { result } = renderHook(() => useTimeBankPanel(args()));
    await waitFor(() => expect(result.current.loadError).not.toBeNull());
    expect(result.current.input.wallet).toBeNull();
  });
});

describe("useTimeBankPanel — opening balance", () => {
  it("persists an opening balance and refreshes", async () => {
    await seedWallet();
    const { result } = renderHook(() => useTimeBankPanel(args()));
    await waitFor(() => expect(result.current.input.wallet).not.toBeNull());

    await act(async () => {
      result.current.handlers.onCreateOpeningBalance?.({
        minutes: 420,
        note: "Carried over",
        sourceReference: null,
      });
    });

    await waitFor(() =>
      expect(
        result.current.input.transactions.some((t) => t.type === "opening_balance"),
      ).toBe(true),
    );
    expect(result.current.actionError).toBeNull();
  });

  it("prevents a second opening balance and surfaces the reason", async () => {
    const wallet = await seedWallet();
    // An opening balance already recorded under a different id (e.g. an earlier
    // migration path) — a new deterministic-id create must be rejected.
    await appendWalletTransaction({
      id: "ob_legacy",
      wallet,
      type: "opening_balance",
      minutes: 120,
      effectiveAt: T1,
      now: T1,
      companyId: COMPANY,
    });
    const { result } = renderHook(() => useTimeBankPanel(args()));
    await waitFor(() => expect(result.current.input.transactions).toHaveLength(1));

    await act(async () => {
      result.current.handlers.onCreateOpeningBalance?.({
        minutes: 300,
        note: "Second attempt",
        sourceReference: null,
      });
    });

    await waitFor(() => expect(result.current.actionError).not.toBeNull());
    // Still exactly one opening balance.
    const fresh = await supabaseTimeBankRepository.listTransactions("wallet_1");
    expect(fresh.filter((t) => t.type === "opening_balance")).toHaveLength(1);
  });
});

describe("useTimeBankPanel — legacy notes & adjustments", () => {
  it("persists a legacy history note without affecting the ledger", async () => {
    await seedWallet();
    const { result } = renderHook(() => useTimeBankPanel(args()));
    await waitFor(() => expect(result.current.input.wallet).not.toBeNull());

    await act(async () => {
      result.current.handlers.onAddLegacyNote?.({
        note: "8 hours accrued in legacy system",
        sourceSystem: "OldSys",
      });
    });

    await waitFor(() => expect(result.current.input.legacyNotes).toHaveLength(1));
    expect(result.current.input.transactions).toHaveLength(0); // never the ledger
  });

  it("persists a manual adjustment", async () => {
    await seedWallet();
    const { result } = renderHook(() => useTimeBankPanel(args()));
    await waitFor(() => expect(result.current.input.wallet).not.toBeNull());

    await act(async () => {
      result.current.handlers.onAddAdjustment?.({
        direction: "manual_add",
        minutes: 90,
        reason: "Goodwill",
      });
    });

    await waitFor(() =>
      expect(
        result.current.input.transactions.some((t) => t.type === "manual_add"),
      ).toBe(true),
    );
  });

  it("surfaces a write error from the repository", async () => {
    await seedWallet();
    const { result } = renderHook(() => useTimeBankPanel(args()));
    await waitFor(() => expect(result.current.input.wallet).not.toBeNull());

    harnessSupabase.failTable("time_bank_transactions");
    await act(async () => {
      result.current.handlers.onAddAdjustment?.({
        direction: "manual_add",
        minutes: 30,
        reason: "Will fail",
      });
    });

    await waitFor(() => expect(result.current.actionError).not.toBeNull());
  });
});

describe("useTimeBankPanel — wallet status restrictions", () => {
  it("blocks adjustments on a frozen wallet", async () => {
    await seedWallet("frozen");
    const { result } = renderHook(() => useTimeBankPanel(args()));
    await waitFor(() => expect(result.current.input.wallet).not.toBeNull());

    await act(async () => {
      result.current.handlers.onAddAdjustment?.({
        direction: "manual_add",
        minutes: 30,
        reason: "Blocked",
      });
    });

    await waitFor(() => expect(result.current.actionError).toMatch(/frozen/i));
    expect(result.current.input.transactions).toHaveLength(0);
  });

  it("freezes an active wallet via the status action", async () => {
    await seedWallet();
    const { result } = renderHook(() => useTimeBankPanel(args()));
    await waitFor(() => expect(result.current.input.wallet?.status).toBe("active"));

    await act(async () => {
      result.current.handlers.onSetWalletStatus?.("frozen");
    });

    await waitFor(() => expect(result.current.input.wallet?.status).toBe("frozen"));
    expect(result.current.actionError).toBeNull();
  });

  it("blocks any status change on a closed wallet", async () => {
    await seedWallet("closed");
    const { result } = renderHook(() => useTimeBankPanel(args()));
    await waitFor(() => expect(result.current.input.wallet?.status).toBe("closed"));

    await act(async () => {
      result.current.handlers.onSetWalletStatus?.("active");
    });

    await waitFor(() => expect(result.current.actionError).toMatch(/closed/i));
    expect(result.current.input.wallet?.status).toBe("closed");
  });
});
