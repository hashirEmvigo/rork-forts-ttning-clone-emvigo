import { describe, expect, it } from "vitest";

import {
  affectsReserved,
  buildStatement,
  buildTransaction,
  buildWalletForAgreement,
  canRecordTransaction,
  carryoverExpiryDelta,
  defaultTimeBankRules,
  deriveBalance,
  deriveBalanceAsOf,
  evaluateConsumption,
  evaluateReservationWarning,
  normalizeMinutes,
  orderLedger,
  transactionKind,
  validateLedger,
  walletBindingKey,
  walletMatchesAgreementChain,
  type BuildTransactionInput,
} from "./timeBank";
import { createNewAgreementVersion } from "./agreementVersioning";
import type {
  CustomerAgreement,
  TimeBankTransaction,
  TimeBankTransactionType,
  TimeBankWallet,
} from "@/types";

const NOW = "2026-01-01T00:00:00.000Z";

function makeAgreement(over: Partial<CustomerAgreement> = {}): CustomerAgreement {
  return {
    id: "agr_v1",
    agreementGroupId: "grp_1",
    companyId: "cmp_nordlys",
    customerId: "cust_001",
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
    notes: "original",
    createdBy: "user_1",
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function makeWallet(over: Partial<TimeBankWallet> = {}): TimeBankWallet {
  return {
    id: "wal_1",
    agreementGroupId: "grp_1",
    customerId: "cust_001",
    companyId: "cmp_nordlys",
    status: "active",
    rules: defaultTimeBankRules(600),
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

let seq = 0;
function tx(
  wallet: TimeBankWallet,
  type: TimeBankTransactionType,
  minutes: number,
  over: Partial<BuildTransactionInput> = {},
): TimeBankTransaction {
  seq += 1;
  return buildTransaction({
    id: `tx_${seq}`,
    wallet,
    type,
    minutes,
    effectiveAt: over.effectiveAt ?? `2026-01-${String(seq).padStart(2, "0")}T00:00:00.000Z`,
    now: NOW,
    ...over,
  });
}

// ── Classification & sign rules ──────────────────────────────

describe("transaction classification", () => {
  it("maps each ledger type to its semantic kind", () => {
    expect(transactionKind("monthly_refill")).toBe("accrual");
    expect(transactionKind("visit_consumption")).toBe("consumption");
    expect(transactionKind("manual_add")).toBe("adjustment");
    expect(transactionKind("manual_remove")).toBe("adjustment");
    expect(transactionKind("reservation")).toBe("reservation");
    expect(transactionKind("expiry")).toBe("expiration");
    expect(transactionKind("correction")).toBe("correction");
    expect(transactionKind("migration")).toBe("migration");
  });

  it("only reservation types affect the reserved balance", () => {
    expect(affectsReserved("reservation")).toBe(true);
    expect(affectsReserved("reservation_release")).toBe(true);
    expect(affectsReserved("visit_consumption")).toBe(false);
    expect(affectsReserved("monthly_refill")).toBe(false);
  });

  it("normalizeMinutes applies the sign rule per type", () => {
    expect(normalizeMinutes("monthly_refill", 60)).toBe(60);
    expect(normalizeMinutes("manual_add", -60)).toBe(60); // coerced positive
    expect(normalizeMinutes("visit_consumption", 90)).toBe(-90); // coerced negative
    expect(normalizeMinutes("expiry", 30)).toBe(-30);
    expect(normalizeMinutes("correction", -45)).toBe(-45); // signed kept
    expect(normalizeMinutes("migration", 480)).toBe(480);
  });

  it("rejects non-integer minutes (no floating-point hours)", () => {
    expect(() => normalizeMinutes("manual_add", 1.5)).toThrow(/integer/);
  });
});

// ── Balance derivation & historical reproducibility ──────────

describe("balance derivation", () => {
  it("derives current/reserved/available from the ledger", () => {
    const w = makeWallet();
    const ledger = [
      tx(w, "monthly_refill", 600),
      tx(w, "visit_consumption", 120),
      tx(w, "reservation", 90),
    ];
    const balance = deriveBalance(ledger);
    expect(balance.currentBalance).toBe(480);
    expect(balance.reservedBalance).toBe(90);
    expect(balance.availableBalance).toBe(390);
  });

  it("no balance exists without underlying transactions", () => {
    expect(deriveBalance([])).toEqual({
      currentBalance: 0,
      reservedBalance: 0,
      availableBalance: 0,
    });
  });

  it("reproduces historical balances as-of a date, unaffected by later entries", () => {
    const w = makeWallet();
    const refill = tx(w, "monthly_refill", 600, { effectiveAt: "2026-01-01T00:00:00.000Z" });
    const visit = tx(w, "visit_consumption", 120, { effectiveAt: "2026-01-10T00:00:00.000Z" });
    const ledgerJan = [refill, visit];

    const asOfJan5 = deriveBalanceAsOf(ledgerJan, "2026-01-05T00:00:00.000Z");
    expect(asOfJan5.currentBalance).toBe(600);

    // A future transaction is appended; the historical as-of balance is unchanged.
    const future = tx(w, "visit_consumption", 200, { effectiveAt: "2026-02-01T00:00:00.000Z" });
    const ledgerFeb = [...ledgerJan, future];
    expect(deriveBalanceAsOf(ledgerFeb, "2026-01-05T00:00:00.000Z").currentBalance).toBe(600);
    expect(deriveBalanceAsOf(ledgerFeb, "2026-01-31T00:00:00.000Z").currentBalance).toBe(480);
    expect(deriveBalance(ledgerFeb).currentBalance).toBe(280);
  });

  it("orders the ledger deterministically by effectiveAt then id", () => {
    const w = makeWallet();
    const a = { ...tx(w, "manual_add", 10), id: "b", effectiveAt: "2026-01-02T00:00:00.000Z" };
    const b = { ...tx(w, "manual_add", 10), id: "a", effectiveAt: "2026-01-02T00:00:00.000Z" };
    const c = { ...tx(w, "manual_add", 10), id: "c", effectiveAt: "2026-01-01T00:00:00.000Z" };
    const ordered = orderLedger([a, b, c]);
    expect(ordered.map((t) => t.id)).toEqual(["c", "a", "b"]);
  });
});

// ── Agreement integration: bind to agreementGroupId ──────────

describe("agreement binding", () => {
  it("builds a wallet bound to agreementGroupId, never the version id", () => {
    const agreement = makeAgreement({ id: "agr_v1", agreementGroupId: "grp_1" });
    const wallet = buildWalletForAgreement({
      id: "wal_x",
      agreement,
      rules: defaultTimeBankRules(600),
      now: NOW,
    });
    expect(wallet.agreementGroupId).toBe("grp_1");
    expect(walletBindingKey(wallet)).toBe("grp_1");
    // It binds to the GROUP, not the version id.
    expect(wallet.agreementGroupId).not.toBe(agreement.id);
  });

  it("wallet continuity survives version changes (v1 → v2 → v3)", () => {
    const v1 = makeAgreement({ id: "agr_v1", version: 1, status: "active" });
    const wallet = buildWalletForAgreement({
      id: "wal_x",
      agreement: v1,
      rules: defaultTimeBankRules(600),
      now: NOW,
    });

    const r2 = createNewAgreementVersion(v1, { newAgreementId: "agr_v2", now: NOW });
    const r3 = createNewAgreementVersion(r2.next, { newAgreementId: "agr_v3", now: NOW });
    const chain = [r2.previous, r3.previous, r3.next];

    // Version ids changed across the chain, but the binding key is constant.
    expect(chain.map((v) => v.id)).toEqual(["agr_v1", "agr_v2", "agr_v3"]);
    expect(new Set(chain.map((v) => v.agreementGroupId)).size).toBe(1);
    expect(walletMatchesAgreementChain(wallet, chain)).toBe(true);
    expect(walletBindingKey(wallet)).toBe("grp_1");
  });

  it("rejects a wallet bound to a different group or a mixed chain", () => {
    const wallet = makeWallet({ agreementGroupId: "grp_1" });
    const a = makeAgreement({ id: "a", agreementGroupId: "grp_1" });
    const b = makeAgreement({ id: "b", agreementGroupId: "grp_2" });
    expect(walletMatchesAgreementChain(wallet, [a, b])).toBe(false);
    expect(walletMatchesAgreementChain(makeWallet({ agreementGroupId: "other" }), [a])).toBe(false);
    expect(walletMatchesAgreementChain(wallet, [])).toBe(false);
  });
});

// ── Wallet state machine gates ───────────────────────────────

describe("wallet state machine", () => {
  it("active wallet allows every transaction type", () => {
    const w = makeWallet({ status: "active" });
    for (const type of [
      "monthly_refill",
      "manual_add",
      "reservation",
      "visit_consumption",
      "reservation_release",
      "correction",
    ] as TimeBankTransactionType[]) {
      expect(canRecordTransaction(w, type).allowed).toBe(true);
    }
  });

  it("frozen wallet honors existing reservations but blocks new ones, refills and adjustments", () => {
    const w = makeWallet({ status: "frozen" });
    // Honored (consume / release / correct):
    expect(canRecordTransaction(w, "visit_consumption").allowed).toBe(true);
    expect(canRecordTransaction(w, "reservation_release").allowed).toBe(true);
    expect(canRecordTransaction(w, "correction").allowed).toBe(true);
    // Blocked:
    expect(canRecordTransaction(w, "reservation").allowed).toBe(false);
    expect(canRecordTransaction(w, "monthly_refill").allowed).toBe(false);
    expect(canRecordTransaction(w, "manual_add").allowed).toBe(false);
    expect(canRecordTransaction(w, "manual_remove").allowed).toBe(false);
  });

  it("closed wallet blocks all new transactions", () => {
    const w = makeWallet({ status: "closed" });
    for (const type of [
      "monthly_refill",
      "visit_consumption",
      "correction",
      "reservation_release",
    ] as TimeBankTransactionType[]) {
      expect(canRecordTransaction(w, type).allowed).toBe(false);
    }
  });
});

// ── Consumption floor & reservation warnings ─────────────────

describe("consumption floor", () => {
  it("blocks consumption that would breach the negative floor", () => {
    const w = makeWallet({ rules: defaultTimeBankRules(600, { negativeFloorMinutes: 60 }) });
    const within = evaluateConsumption(w, 30, 80); // 30 - 80 = -50, floor -60 → ok
    expect(within.withinFloor).toBe(true);
    expect(within.resultingBalance).toBe(-50);
    const breach = evaluateConsumption(w, 30, 100); // -70 < -60 → blocked
    expect(breach.withinFloor).toBe(false);
    expect(breach.floor).toBe(-60);
  });

  it("zero floor means no overdraw", () => {
    const w = makeWallet({ rules: defaultTimeBankRules(600, { negativeFloorMinutes: 0 }) });
    expect(evaluateConsumption(w, 10, 10).withinFloor).toBe(true);
    expect(evaluateConsumption(w, 10, 11).withinFloor).toBe(false);
  });
});

describe("reservation warnings", () => {
  it("uses percent-of-allocation thresholds", () => {
    const w = makeWallet({
      rules: defaultTimeBankRules(600, {
        warningThresholdPercent: 20, // 120 min
        criticalThresholdPercent: 5, // 30 min
      }),
    });
    expect(evaluateReservationWarning(w, 200)).toBe("ok");
    expect(evaluateReservationWarning(w, 120)).toBe("warning");
    expect(evaluateReservationWarning(w, 30)).toBe("critical");
  });

  it("falls back to absolute thresholds for zero-allocation wallets", () => {
    const w = makeWallet({
      rules: defaultTimeBankRules(0, {
        warningThresholdPercent: 20,
        criticalThresholdPercent: 5,
        warningThresholdMinutes: 60,
        criticalThresholdMinutes: 15,
      }),
    });
    expect(evaluateReservationWarning(w, 100)).toBe("ok");
    expect(evaluateReservationWarning(w, 60)).toBe("warning");
    expect(evaluateReservationWarning(w, 15)).toBe("critical");
  });
});

// ── Ledger integrity ─────────────────────────────────────────

describe("ledger integrity", () => {
  it("passes a clean ledger", () => {
    const w = makeWallet();
    const result = validateLedger(w, [tx(w, "monthly_refill", 600), tx(w, "visit_consumption", 60)]);
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.balance.currentBalance).toBe(540);
  });

  it("flags orphaned transactions (wrong wallet / group)", () => {
    const w = makeWallet();
    const orphan: TimeBankTransaction = { ...tx(w, "manual_add", 10), walletId: "other_wallet" };
    const result = validateLedger(w, [orphan]);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.includes("belongs to wallet"))).toBe(true);
  });

  it("flags non-integer, zero and wrong-sign minutes", () => {
    const w = makeWallet();
    const bad: TimeBankTransaction[] = [
      { ...tx(w, "manual_add", 10), id: "frac", minutes: 1.5 },
      { ...tx(w, "manual_add", 10), id: "zero", minutes: 0 },
      { ...tx(w, "monthly_refill", 10), id: "negrefill", minutes: -10 },
      { ...tx(w, "visit_consumption", 10), id: "posconsume", minutes: 10 },
    ];
    const result = validateLedger(w, bad);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.includes("not an integer"))).toBe(true);
    expect(result.issues.some((i) => i.includes("zero minutes"))).toBe(true);
    expect(result.issues.some((i) => i.includes("must be positive"))).toBe(true);
    expect(result.issues.some((i) => i.includes("must be negative"))).toBe(true);
  });

  it("flags a reserved balance that goes negative (over-release)", () => {
    const w = makeWallet();
    const ledger = [
      tx(w, "reservation", 60, { effectiveAt: "2026-01-01T00:00:00.000Z" }),
      tx(w, "reservation_release", 90, { effectiveAt: "2026-01-02T00:00:00.000Z" }),
    ];
    const result = validateLedger(w, ledger);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.includes("reserved balance went negative"))).toBe(true);
  });
});

// ── Statements / statistics ──────────────────────────────────

describe("statements", () => {
  it("aggregates refills, consumption (by category + billable), adjustments, expiry, corrections", () => {
    const w = makeWallet();
    const ledger = [
      tx(w, "monthly_refill", 600),
      tx(w, "visit_consumption", 120, { serviceCategorySnapshot: "office", billable: true }),
      tx(w, "visit_consumption", 60, { serviceCategorySnapshot: "windows", billable: false }),
      tx(w, "cancellation_consumption", 30, { serviceCategorySnapshot: "office", billable: true }),
      tx(w, "manual_add", 45),
      tx(w, "manual_remove", 15),
      tx(w, "expiry", 25),
      tx(w, "correction", -10),
      tx(w, "reservation", 90), // excluded from statement flow
    ];
    const s = buildStatement(ledger);
    expect(s.refillMinutes).toBe(600);
    expect(s.consumptionMinutes).toBe(210);
    expect(s.consumptionByCategory).toEqual({ office: 150, windows: 60 });
    expect(s.billableMinutes).toBe(150);
    expect(s.nonBillableMinutes).toBe(60);
    expect(s.adjustmentMinutes).toBe(30); // +45 - 15
    expect(s.expiryMinutes).toBe(25);
    expect(s.correctionMinutes).toBe(-10);
    // Closing excludes the reservation: 600-120-60-30+45-15-25-10 = 385
    expect(s.closingBalance).toBe(385);
    expect(s.openingBalance).toBe(0);
  });

  it("computes opening/closing balances for a windowed (monthly) statement", () => {
    const w = makeWallet();
    const ledger = [
      tx(w, "monthly_refill", 600, { effectiveAt: "2026-01-01T00:00:00.000Z" }),
      tx(w, "visit_consumption", 100, { effectiveAt: "2026-01-15T00:00:00.000Z" }),
      tx(w, "monthly_refill", 600, { effectiveAt: "2026-02-01T00:00:00.000Z" }),
      tx(w, "visit_consumption", 200, { effectiveAt: "2026-02-10T00:00:00.000Z" }),
    ];
    const feb = buildStatement(ledger, {
      from: "2026-02-01T00:00:00.000Z",
      to: "2026-02-28T23:59:59.000Z",
    });
    expect(feb.openingBalance).toBe(500); // 600 - 100 from January
    expect(feb.refillMinutes).toBe(600);
    expect(feb.consumptionMinutes).toBe(200);
    expect(feb.closingBalance).toBe(900); // 500 + 600 - 200
  });
});

// ── Carryover ────────────────────────────────────────────────

describe("carryover policy", () => {
  it("unlimited and expiry policies expire nothing here", () => {
    expect(carryoverExpiryDelta("unlimited", 1000, null)).toBe(0);
    expect(carryoverExpiryDelta("expiry", 1000, null)).toBe(0);
  });

  it("capped trims the excess above the cap", () => {
    expect(carryoverExpiryDelta("capped", 1000, 800)).toBe(-200);
    expect(carryoverExpiryDelta("capped", 500, 800)).toBe(0);
    expect(carryoverExpiryDelta("capped", 1000, null)).toBe(0);
  });

  it("no_carryover resets the positive balance to zero", () => {
    expect(carryoverExpiryDelta("no_carryover", 320, null)).toBe(-320);
    expect(carryoverExpiryDelta("no_carryover", -50, null)).toBe(0);
  });
});

// ── End-to-end lifecycle (foundation, in-memory) ─────────────

describe("end-to-end wallet lifecycle", () => {
  it("refill → reserve → consume → release reproduces every balance from the ledger", () => {
    const agreement = makeAgreement();
    const wallet = buildWalletForAgreement({
      id: "wal_e2e",
      agreement,
      rules: defaultTimeBankRules(600, { negativeFloorMinutes: 0 }),
      now: NOW,
    });

    const ledger: TimeBankTransaction[] = [];
    // 1. Monthly refill.
    expect(canRecordTransaction(wallet, "monthly_refill").allowed).toBe(true);
    ledger.push(tx(wallet, "monthly_refill", 600, { effectiveAt: "2026-01-01T00:00:00.000Z" }));

    // 2. Reserve 120 for a planned visit (warning check on available).
    const beforeReserve = deriveBalance(ledger);
    expect(evaluateReservationWarning(wallet, beforeReserve.availableBalance)).toBe("ok");
    ledger.push(tx(wallet, "reservation", 120, { effectiveAt: "2026-01-05T00:00:00.000Z" }));
    expect(deriveBalance(ledger).availableBalance).toBe(480);

    // 3. Visit happens: consume within floor, release the reservation.
    const evalConsume = evaluateConsumption(wallet, deriveBalance(ledger).currentBalance, 120);
    expect(evalConsume.withinFloor).toBe(true);
    ledger.push(
      tx(wallet, "visit_consumption", 120, {
        effectiveAt: "2026-01-10T00:00:00.000Z",
        serviceCategorySnapshot: "office",
        billable: true,
      }),
    );
    ledger.push(tx(wallet, "reservation_release", 120, { effectiveAt: "2026-01-10T00:00:01.000Z" }));

    const finalBalance = deriveBalance(ledger);
    expect(finalBalance.currentBalance).toBe(480);
    expect(finalBalance.reservedBalance).toBe(0);
    expect(finalBalance.availableBalance).toBe(480);

    // Ledger is clean and the statement reflects the activity.
    expect(validateLedger(wallet, ledger).ok).toBe(true);
    const statement = buildStatement(ledger);
    expect(statement.refillMinutes).toBe(600);
    expect(statement.consumptionMinutes).toBe(120);
    expect(statement.closingBalance).toBe(480);
  });

  it("frozen wallet honors a prior reservation through to consumption (CONTRACT 2)", () => {
    const wallet = makeWallet({ status: "active" });
    const ledger: TimeBankTransaction[] = [
      tx(wallet, "monthly_refill", 600, { effectiveAt: "2026-01-01T00:00:00.000Z" }),
      tx(wallet, "reservation", 120, { effectiveAt: "2026-01-05T00:00:00.000Z" }),
    ];
    // Agreement moves off time_bank → wallet frozen. Existing reservation is honored.
    const frozen: TimeBankWallet = { ...wallet, status: "frozen" };
    expect(canRecordTransaction(frozen, "reservation").allowed).toBe(false);
    expect(canRecordTransaction(frozen, "visit_consumption").allowed).toBe(true);
    expect(canRecordTransaction(frozen, "reservation_release").allowed).toBe(true);
    ledger.push(tx(frozen, "visit_consumption", 120, { effectiveAt: "2026-01-10T00:00:00.000Z" }));
    ledger.push(tx(frozen, "reservation_release", 120, { effectiveAt: "2026-01-10T00:00:01.000Z" }));
    const balance = deriveBalance(ledger);
    expect(balance.currentBalance).toBe(480);
    expect(balance.reservedBalance).toBe(0); // no orphaned reservation
    expect(validateLedger(frozen, ledger).ok).toBe(true);
  });
});
