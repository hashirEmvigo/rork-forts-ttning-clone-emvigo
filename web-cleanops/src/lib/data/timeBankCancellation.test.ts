import { describe, expect, it } from "vitest";

import {
  buildCancellationCreditTransaction,
  calculateCancellationCredit,
  canRecordTransaction,
  defaultCancellationPolicy,
  defaultTimeBankRules,
  deriveBalance,
  transactionKind,
  validateCancellationPolicy,
} from "./timeBank";
import type {
  TimeBankCancellationPolicy,
  TimeBankWallet,
} from "@/types";

const NOW = "2026-02-01T00:00:00.000Z";

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

function policy(over: Partial<TimeBankCancellationPolicy> = {}): TimeBankCancellationPolicy {
  return defaultCancellationPolicy(over);
}

// ── Calculation: deduction methods ───────────────────────────

describe("calculateCancellationCredit", () => {
  it("full credit when no deduction (4h → +4h)", () => {
    const result = calculateCancellationCredit(240, policy({ deductionMethod: "none" }));
    expect(result?.creditedMinutes).toBe(240);
    expect(result?.deductionMinutes).toBe(0);
    expect(result?.deductionValue).toBeNull();
  });

  it("fixed deduction (4h − 1h → +3h)", () => {
    const result = calculateCancellationCredit(
      240,
      policy({ deductionMethod: "fixed", deductionMinutes: 60 }),
    );
    expect(result?.deductionMinutes).toBe(60);
    expect(result?.creditedMinutes).toBe(180);
    expect(result?.deductionValue).toBe(60);
  });

  it("percentage deduction (4h − 25% → +3h)", () => {
    const result = calculateCancellationCredit(
      240,
      policy({ deductionMethod: "percentage", deductionPercent: 25 }),
    );
    expect(result?.deductionMinutes).toBe(60);
    expect(result?.creditedMinutes).toBe(180);
    expect(result?.deductionValue).toBe(25);
  });

  it("rounds percentage deductions to whole minutes", () => {
    const result = calculateCancellationCredit(
      245,
      policy({ deductionMethod: "percentage", deductionPercent: 33 }),
    );
    // 33% of 245 = 80.85 → 81
    expect(result?.deductionMinutes).toBe(81);
    expect(result?.creditedMinutes).toBe(164);
  });

  it("never deducts more than the visit duration", () => {
    const result = calculateCancellationCredit(
      60,
      policy({ deductionMethod: "fixed", deductionMinutes: 120 }),
    );
    expect(result?.deductionMinutes).toBe(60);
    expect(result?.creditedMinutes).toBe(0);
  });

  it("clamps the credit to minCreditMinutes floor", () => {
    const result = calculateCancellationCredit(
      120,
      policy({ deductionMethod: "percentage", deductionPercent: 100, minCreditMinutes: 30 }),
    );
    expect(result?.creditedMinutes).toBe(30);
    expect(result?.deductionMinutes).toBe(90);
  });

  it("returns null when the policy is disabled", () => {
    expect(calculateCancellationCredit(240, policy({ enabled: false }))).toBeNull();
  });

  it("rejects non-integer / negative visit durations", () => {
    expect(() => calculateCancellationCredit(12.5, policy())).toThrow();
    expect(() => calculateCancellationCredit(-30, policy())).toThrow();
  });
});

// ── Policy validation ────────────────────────────────────────

describe("validateCancellationPolicy", () => {
  it("accepts well-formed policies", () => {
    expect(validateCancellationPolicy(policy({ deductionMethod: "none" })).ok).toBe(true);
    expect(
      validateCancellationPolicy(policy({ deductionMethod: "fixed", deductionMinutes: 60 })).ok,
    ).toBe(true);
    expect(
      validateCancellationPolicy(policy({ deductionMethod: "percentage", deductionPercent: 25 })).ok,
    ).toBe(true);
  });

  it("rejects a fixed policy without a non-negative integer deduction", () => {
    const result = validateCancellationPolicy(
      policy({ deductionMethod: "fixed", deductionMinutes: null }),
    );
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("rejects an out-of-range percentage", () => {
    expect(
      validateCancellationPolicy(
        policy({ deductionMethod: "percentage", deductionPercent: 150 }),
      ).ok,
    ).toBe(false);
    expect(
      validateCancellationPolicy(
        policy({ deductionMethod: "percentage", deductionPercent: 12.5 }),
      ).ok,
    ).toBe(false);
  });

  it("treats a disabled policy as valid regardless of deduction fields", () => {
    expect(
      validateCancellationPolicy(
        policy({ enabled: false, deductionMethod: "fixed", deductionMinutes: null }),
      ).ok,
    ).toBe(true);
  });
});

// ── Transaction model ────────────────────────────────────────

describe("buildCancellationCreditTransaction", () => {
  it("produces a SINGLE net positive credit entry with full audit breakdown", () => {
    const wallet = makeWallet();
    const tx = buildCancellationCreditTransaction({
      id: "tx_cancel_1",
      wallet,
      originalVisitMinutes: 240,
      policy: policy({ deductionMethod: "fixed", deductionMinutes: 60 }),
      effectiveAt: NOW,
      now: NOW,
      cancellationReason: "Customer rescheduled holiday",
      sourceWorkOrderId: "wo_99",
    });
    expect(tx).not.toBeNull();
    expect(tx?.type).toBe("cancelled_visit_credit");
    // Customer-facing net minutes.
    expect(tx?.minutes).toBe(180);
    // Audit trail retains the underlying calculation.
    expect(tx?.cancellationCredit).toEqual({
      originalVisitMinutes: 240,
      deductionMethod: "fixed",
      deductionValue: 60,
      deductionMinutes: 60,
      creditedMinutes: 180,
      cancellationReason: "Customer rescheduled holiday",
    });
    expect(tx?.sourceWorkOrderId).toBe("wo_99");
  });

  it("classifies the credit as an accrual for statistics", () => {
    expect(transactionKind("cancelled_visit_credit")).toBe("accrual");
  });

  it("returns null when the net credit is zero", () => {
    const wallet = makeWallet();
    const tx = buildCancellationCreditTransaction({
      id: "tx_cancel_zero",
      wallet,
      originalVisitMinutes: 60,
      policy: policy({ deductionMethod: "percentage", deductionPercent: 100 }),
      effectiveAt: NOW,
      now: NOW,
    });
    expect(tx).toBeNull();
  });

  it("credits the wallet balance by the net minutes only", () => {
    const wallet = makeWallet();
    const tx = buildCancellationCreditTransaction({
      id: "tx_cancel_2",
      wallet,
      originalVisitMinutes: 240,
      policy: policy({ deductionMethod: "percentage", deductionPercent: 25 }),
      effectiveAt: NOW,
      now: NOW,
    });
    const balance = deriveBalance(tx ? [tx] : []);
    expect(balance.currentBalance).toBe(180);
    expect(balance.availableBalance).toBe(180);
  });
});

// ── Wallet state machine interaction ─────────────────────────

describe("cancellation credit + wallet state machine", () => {
  it("is allowed on an active wallet and blocked on frozen/closed wallets", () => {
    expect(canRecordTransaction(makeWallet(), "cancelled_visit_credit").allowed).toBe(true);
    // Frozen wallets accrue nothing new (inbound credit blocked, like refills).
    expect(
      canRecordTransaction(makeWallet({ status: "frozen" }), "cancelled_visit_credit").allowed,
    ).toBe(false);
    expect(
      canRecordTransaction(makeWallet({ status: "closed" }), "cancelled_visit_credit").allowed,
    ).toBe(false);
  });
});
