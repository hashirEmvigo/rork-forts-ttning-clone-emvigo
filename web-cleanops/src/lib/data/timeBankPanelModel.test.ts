/**
 * Tests for the pure Time Bank admin-panel view-model (Phase 13).
 *
 * Pure logic only — no React, no Supabase, no env. Validates formatting, input
 * parsing, balance/warning derivation, opening-balance + adjustment gating,
 * cancellation display and the panel visibility/disabled rules.
 */
import { describe, expect, it } from "vitest";

import type {
  CustomerAgreement,
  TimeBankCancellationPolicy,
  TimeBankLegacyHistoryNote,
  TimeBankTransaction,
  TimeBankWallet,
} from "@/types";
import {
  buildTransaction,
  buildWalletForAgreement,
  defaultTimeBankRules,
} from "./timeBank";
import { buildOpeningBalanceTransaction, buildLegacyHistoryNote } from "./timeBankMigration";
import type { TimeBankEntitlementDecision } from "./timeBankEntitlement";
import {
  buildTimeBankPanelModel,
  formatMinutes,
  formatSignedMinutes,
  gateCreateOpeningBalance,
  parseHoursMinutes,
  type TimeBankPanelInput,
} from "./timeBankPanelModel";

const NOW = "2026-01-15T10:00:00.000Z";

function agreement(): CustomerAgreement {
  return { agreementGroupId: "grp-1", customerId: "cust-1", companyId: "co-1" } as CustomerAgreement;
}

function wallet(over: Partial<TimeBankWallet> = {}): TimeBankWallet {
  const base = buildWalletForAgreement({
    id: "wallet-1",
    agreement: agreement(),
    rules: defaultTimeBankRules(600, { warningThresholdPercent: 20, criticalThresholdPercent: 5 }),
    now: NOW,
  });
  return { ...base, ...over };
}

function tx(
  type: TimeBankTransaction["type"],
  minutes: number,
  over: Partial<TimeBankTransaction> = {},
): TimeBankTransaction {
  const built = buildTransaction({
    id: `${type}-${minutes}-${over.id ?? ""}`,
    wallet: wallet(),
    type,
    minutes,
    effectiveAt: over.effectiveAt ?? NOW,
    now: NOW,
  });
  return { ...built, ...over };
}

function entitled(allowed: boolean): TimeBankEntitlementDecision {
  return {
    allowed,
    status: allowed ? "enabled" : "disabled",
    source: allowed ? "bundle" : "none",
    contributingBundleIds: allowed ? ["bundle-pro"] : [],
    globallyAvailable: true,
    denialReason: allowed ? null : "This company is not entitled to Time Bank.",
  };
}

function input(over: Partial<TimeBankPanelInput> = {}): TimeBankPanelInput {
  return {
    timeBankEnabledOnAgreement: true,
    entitlement: entitled(true),
    wallet: wallet(),
    transactions: [],
    legacyNotes: [],
    cancellationPolicy: null,
    ...over,
  };
}

describe("formatMinutes / formatSignedMinutes", () => {
  it("formats hours and minutes", () => {
    expect(formatMinutes(210)).toBe("3h 30m");
    expect(formatMinutes(60)).toBe("1h");
    expect(formatMinutes(45)).toBe("45m");
    expect(formatMinutes(0)).toBe("0m");
    expect(formatMinutes(-90)).toBe("-1h 30m");
  });

  it("prefixes a sign for positive values", () => {
    expect(formatSignedMinutes(180)).toBe("+3h");
    expect(formatSignedMinutes(-30)).toBe("-30m");
    expect(formatSignedMinutes(0)).toBe("0m");
  });
});

describe("parseHoursMinutes", () => {
  it("parses hours + minutes into total minutes", () => {
    expect(parseHoursMinutes("3", "30")).toEqual({ ok: true, minutes: 210 });
    expect(parseHoursMinutes("", "45")).toEqual({ ok: true, minutes: 45 });
  });

  it("rejects non-integers, negatives and zero", () => {
    expect(parseHoursMinutes("1.5", "0").ok).toBe(false);
    expect(parseHoursMinutes("-1", "0").ok).toBe(false);
    expect(parseHoursMinutes("0", "0").ok).toBe(false);
  });
});

describe("buildTimeBankPanelModel — visibility", () => {
  it("is visible when the agreement has Time Bank enabled", () => {
    expect(buildTimeBankPanelModel(input({ wallet: null })).visible).toBe(true);
  });

  it("is visible when a wallet exists even if not enabled and not entitled", () => {
    const model = buildTimeBankPanelModel(
      input({ timeBankEnabledOnAgreement: false, entitlement: entitled(false) }),
    );
    expect(model.visible).toBe(true);
  });

  it("is hidden when not enabled, not entitled and no wallet", () => {
    const model = buildTimeBankPanelModel(
      input({
        timeBankEnabledOnAgreement: false,
        entitlement: entitled(false),
        wallet: null,
      }),
    );
    expect(model.visible).toBe(false);
  });
});

describe("buildTimeBankPanelModel — disabled (entitlement denied, no wallet)", () => {
  it("disables with the denial reason when no wallet and denied", () => {
    const model = buildTimeBankPanelModel(
      input({ wallet: null, entitlement: entitled(false) }),
    );
    expect(model.disabled).toBe(true);
    expect(model.disabledReason).toContain("not entitled");
    expect(model.hasWallet).toBe(false);
  });

  it("is NOT disabled when a wallet exists, even if entitlement denied", () => {
    const model = buildTimeBankPanelModel(input({ entitlement: entitled(false) }));
    expect(model.disabled).toBe(false);
    expect(model.hasWallet).toBe(true);
  });
});

describe("buildTimeBankPanelModel — wallet summary + balances", () => {
  it("derives current / reserved / available and labels", () => {
    const txs = [tx("opening_balance", 300, { id: "ob" }), tx("reservation", 90, { id: "r" })];
    const model = buildTimeBankPanelModel(input({ transactions: txs }));
    expect(model.wallet?.currentBalance).toBe(300);
    expect(model.wallet?.reservedBalance).toBe(90);
    expect(model.wallet?.availableBalance).toBe(210);
    expect(model.wallet?.availableLabel).toBe("3h 30m");
    expect(model.wallet?.openingBalanceMinutes).toBe(300);
  });

  it("flags a critical warning and overdraft", () => {
    const txs = [tx("manual_remove", 30, { id: "neg" })];
    const model = buildTimeBankPanelModel(input({ transactions: txs }));
    expect(model.wallet?.isNegative).toBe(true);
    expect(model.wallet?.warningLevel).toBe("critical");
  });
});

describe("buildTimeBankPanelModel — opening balance gate", () => {
  it("allows creation when no opening balance exists on an active wallet", () => {
    expect(buildTimeBankPanelModel(input()).gates.createOpeningBalance.allowed).toBe(true);
  });

  it("blocks a second opening balance", () => {
    const ob = buildOpeningBalanceTransaction({ wallet: wallet(), minutes: 120, effectiveAt: NOW, now: NOW });
    const gate = gateCreateOpeningBalance(wallet(), [ob]);
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toContain("already exists");
  });

  it("blocks opening balance on a closed wallet", () => {
    const model = buildTimeBankPanelModel(input({ wallet: wallet({ status: "closed" }) }));
    expect(model.gates.createOpeningBalance.allowed).toBe(false);
  });
});

describe("buildTimeBankPanelModel — adjustment gate", () => {
  it("allows adjustments on an active wallet", () => {
    const model = buildTimeBankPanelModel(input());
    expect(model.gates.addAdjustmentAdd.allowed).toBe(true);
    expect(model.gates.addAdjustmentRemove.allowed).toBe(true);
  });

  it("blocks manual adjustments on a frozen wallet", () => {
    const model = buildTimeBankPanelModel(input({ wallet: wallet({ status: "frozen" }) }));
    expect(model.gates.addAdjustmentAdd.allowed).toBe(false);
  });
});

describe("buildTimeBankPanelModel — legacy notes never affect balance", () => {
  it("keeps legacy notes separate from the derived balance", () => {
    const note: TimeBankLegacyHistoryNote = buildLegacyHistoryNote({
      id: "note-1",
      wallet: wallet(),
      note: "Customer previously accumulated 8 hours in the legacy system.",
      now: NOW,
      sourceSystem: "OldSys",
    });
    const txs = [tx("opening_balance", 120, { id: "ob" })];
    const model = buildTimeBankPanelModel(input({ transactions: txs, legacyNotes: [note] }));
    expect(model.legacyNotes).toHaveLength(1);
    // Balance reflects only the ledger, never the note's "8 hours".
    expect(model.wallet?.currentBalance).toBe(120);
  });
});

describe("buildTimeBankPanelModel — cancellation display + ledger", () => {
  it("renders the cancellation policy", () => {
    const policy: TimeBankCancellationPolicy = {
      enabled: true,
      deductionMethod: "percentage",
      deductionPercent: 25,
      minCreditMinutes: 0,
    };
    const model = buildTimeBankPanelModel(input({ cancellationPolicy: policy }));
    expect(model.cancellation?.enabled).toBe(true);
    expect(model.cancellation?.deductionDetail).toContain("25%");
  });

  it("orders ledger rows and surfaces the cancellation breakdown", () => {
    const credit = tx("cancelled_visit_credit", 180, {
      id: "cvc",
      cancellationCredit: {
        originalVisitMinutes: 240,
        deductionMethod: "fixed",
        deductionValue: 60,
        deductionMinutes: 60,
        creditedMinutes: 180,
        cancellationReason: "Customer cancelled",
      },
    });
    const model = buildTimeBankPanelModel(input({ transactions: [credit] }));
    const row = model.ledger.find((r) => r.type === "cancelled_visit_credit");
    expect(row?.minutesLabel).toBe("+3h");
    expect(row?.cancellation?.creditedLabel).toBe("3h");
    expect(row?.cancellation?.deductionLabel).toBe("1h");
  });
});
