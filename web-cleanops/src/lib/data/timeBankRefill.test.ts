import { describe, expect, it } from "vitest";

import {
  computeAgeExpiry,
  evaluateWalletWarnings,
  expiryTransactionId,
  isAutoRefillFrequency,
  planTimeBankExpiry,
  planTimeBankRefill,
  refillPeriodKey,
  refillPeriodStart,
  refillTransactionId,
} from "./timeBankRefill";
import {
  buildTransaction,
  buildWalletForAgreement,
  defaultTimeBankRules,
  deriveBalance,
  deriveBalanceAsOf,
} from "./timeBank";
import { createNewAgreementVersion } from "./agreementVersioning";
import type {
  CustomerAgreement,
  TimeBankRules,
  TimeBankTransaction,
  TimeBankTransactionType,
  TimeBankWallet,
} from "@/types";

const NOW = "2026-06-01T00:00:00.000Z";

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

function makeWallet(rules: Partial<TimeBankRules> = {}, over: Partial<TimeBankWallet> = {}): TimeBankWallet {
  return {
    id: "wal_1",
    agreementGroupId: "grp_1",
    customerId: "cust_001",
    companyId: "cmp_nordlys",
    status: "active",
    rules: defaultTimeBankRules(600, rules),
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
  effectiveAt: string,
): TimeBankTransaction {
  seq += 1;
  return buildTransaction({
    id: `seed_${seq}`,
    wallet,
    type,
    minutes,
    effectiveAt,
    now: NOW,
  });
}

// ── Frequency helpers & period keys ──────────────────────────

describe("frequency helpers", () => {
  it("classifies auto-scheduled vs manual/disabled", () => {
    expect(isAutoRefillFrequency("monthly")).toBe(true);
    expect(isAutoRefillFrequency("quarterly")).toBe(true);
    expect(isAutoRefillFrequency("yearly")).toBe(true);
    expect(isAutoRefillFrequency("weekly")).toBe(true);
    expect(isAutoRefillFrequency("manual")).toBe(false);
    expect(isAutoRefillFrequency("none")).toBe(false);
  });

  it("builds stable period keys per frequency", () => {
    expect(refillPeriodKey("monthly", "2026-03-17")).toBe("2026-03");
    expect(refillPeriodKey("quarterly", "2026-03-17")).toBe("2026-Q1");
    expect(refillPeriodKey("quarterly", "2026-11-02")).toBe("2026-Q4");
    expect(refillPeriodKey("yearly", "2026-11-02")).toBe("2026");
    expect(refillPeriodKey("none", "2026-11-02")).toBeNull();
    expect(refillPeriodKey("manual", "2026-11-02")).toBeNull();
  });

  it("anchors the refill at the period start", () => {
    expect(refillPeriodStart("monthly", "2026-03-17")).toBe("2026-03-01T00:00:00.000Z");
    expect(refillPeriodStart("quarterly", "2026-11-02")).toBe("2026-10-01T00:00:00.000Z");
    expect(refillPeriodStart("yearly", "2026-11-02")).toBe("2026-01-01T00:00:00.000Z");
  });
});

// ── Refill cadences ──────────────────────────────────────────

describe("refill cadences", () => {
  it("plans a monthly refill of the allocation at the month boundary", () => {
    const wallet = makeWallet({ refillFrequency: "monthly", allocationMinutes: 600 });
    const plan = planTimeBankRefill({ wallet, transactions: [], periodDate: "2026-03-17" });
    expect(plan.due).toBe(true);
    expect(plan.decision).toBe("due");
    expect(plan.periodKey).toBe("2026-03");
    expect(plan.plannedTransactions).toHaveLength(1);
    const [entry] = plan.plannedTransactions;
    expect(entry.type).toBe("monthly_refill");
    expect(entry.minutes).toBe(600);
    expect(entry.effectiveAt).toBe("2026-03-01T00:00:00.000Z");
    expect(entry.id).toBe(refillTransactionId(wallet.id, "2026-03"));
  });

  it("plans a quarterly refill keyed by quarter", () => {
    const wallet = makeWallet({ refillFrequency: "quarterly", allocationMinutes: 1800 });
    const plan = planTimeBankRefill({ wallet, transactions: [], periodDate: "2026-08-20" });
    expect(plan.due).toBe(true);
    expect(plan.periodKey).toBe("2026-Q3");
    expect(plan.plannedTransactions[0].minutes).toBe(1800);
    expect(plan.plannedTransactions[0].effectiveAt).toBe("2026-07-01T00:00:00.000Z");
  });

  it("plans a yearly refill keyed by year", () => {
    const wallet = makeWallet({ refillFrequency: "yearly", allocationMinutes: 7200 });
    const plan = planTimeBankRefill({ wallet, transactions: [], periodDate: "2026-08-20" });
    expect(plan.due).toBe(true);
    expect(plan.periodKey).toBe("2026");
    expect(plan.plannedTransactions[0].effectiveAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("never auto-schedules a disabled (none) refill", () => {
    const wallet = makeWallet({ refillFrequency: "none" });
    const plan = planTimeBankRefill({ wallet, transactions: [], periodDate: "2026-03-17" });
    expect(plan.due).toBe(false);
    expect(plan.decision).toBe("disabled");
    expect(plan.plannedTransactions).toHaveLength(0);
  });

  it("never auto-schedules a manual/one-time refill", () => {
    const wallet = makeWallet({ refillFrequency: "manual" });
    const plan = planTimeBankRefill({ wallet, transactions: [], periodDate: "2026-03-17" });
    expect(plan.due).toBe(false);
    expect(plan.decision).toBe("manual");
    expect(plan.plannedTransactions).toHaveLength(0);
  });
});

// ── Idempotency / duplicate period prevention ────────────────

describe("idempotency", () => {
  it("is not due when a refill for the period already exists", () => {
    const wallet = makeWallet({ refillFrequency: "monthly" });
    const existing: TimeBankTransaction = {
      ...tx(wallet, "monthly_refill", 600, "2026-03-01T00:00:00.000Z"),
      id: refillTransactionId(wallet.id, "2026-03"),
    };
    const plan = planTimeBankRefill({
      wallet,
      transactions: [existing],
      periodDate: "2026-03-30",
    });
    expect(plan.due).toBe(false);
    expect(plan.decision).toBe("already_refilled");
    expect(plan.plannedTransactions).toHaveLength(0);
  });

  it("produces the same deterministic id for any date in the period (no duplicates)", () => {
    const wallet = makeWallet({ refillFrequency: "monthly" });
    const first = planTimeBankRefill({ wallet, transactions: [], periodDate: "2026-03-01" });
    const last = planTimeBankRefill({ wallet, transactions: [], periodDate: "2026-03-31" });
    expect(first.plannedTransactions[0].id).toBe(last.plannedTransactions[0].id);
  });
});

// ── Carryover ────────────────────────────────────────────────

describe("carryover", () => {
  it("unlimited carryover credits only the refill (balance accumulates)", () => {
    const wallet = makeWallet({ refillFrequency: "monthly", carryoverPolicy: "unlimited" });
    const ledger = [tx(wallet, "monthly_refill", 600, "2026-02-01T00:00:00.000Z")];
    const plan = planTimeBankRefill({ wallet, transactions: ledger, periodDate: "2026-03-10" });
    expect(plan.plannedTransactions).toHaveLength(1);
    expect(plan.plannedTransactions[0].type).toBe("monthly_refill");
  });

  it("no_carryover expires the leftover before crediting the allocation", () => {
    const wallet = makeWallet({ refillFrequency: "monthly", carryoverPolicy: "no_carryover" });
    const ledger = [
      tx(wallet, "monthly_refill", 600, "2026-02-01T00:00:00.000Z"),
      tx(wallet, "visit_consumption", -150, "2026-02-15T00:00:00.000Z"),
    ];
    const plan = planTimeBankRefill({ wallet, transactions: ledger, periodDate: "2026-03-05" });
    expect(plan.plannedTransactions).toHaveLength(2);
    const [expiry, refill] = plan.plannedTransactions;
    expect(expiry.type).toBe("expiry");
    expect(expiry.minutes).toBe(-450); // 600 - 150 leftover expires
    expect(refill.type).toBe("monthly_refill");
    expect(refill.minutes).toBe(600);
    // Net balance after applying the plan resets to the allocation.
    const applied = [...ledger, makePlanned(wallet, plan)].flat();
    expect(deriveBalance(applied).currentBalance).toBe(600);
  });

  it("capped carryover trims the excess above the cap after the credit", () => {
    const wallet = makeWallet({
      refillFrequency: "monthly",
      carryoverPolicy: "capped",
      maxBalanceMinutes: 900,
    });
    const ledger = [tx(wallet, "monthly_refill", 600, "2026-02-01T00:00:00.000Z")];
    const plan = planTimeBankRefill({ wallet, transactions: ledger, periodDate: "2026-03-05" });
    // pre=600, +600 refill = 1200, cap 900 → expire 300.
    const expiry = plan.plannedTransactions.find((p) => p.type === "expiry");
    expect(expiry?.minutes).toBe(-300);
    const applied = [...ledger, makePlanned(wallet, plan)].flat();
    expect(deriveBalance(applied).currentBalance).toBe(900);
  });

  it("carryover never rewrites historical balances (append-only)", () => {
    const wallet = makeWallet({ refillFrequency: "monthly", carryoverPolicy: "no_carryover" });
    const ledger = [tx(wallet, "monthly_refill", 600, "2026-02-01T00:00:00.000Z")];
    const before = deriveBalanceAsOf(ledger, "2026-02-28T00:00:00.000Z").currentBalance;
    const plan = planTimeBankRefill({ wallet, transactions: ledger, periodDate: "2026-03-05" });
    const applied = [...ledger, makePlanned(wallet, plan)].flat();
    // The February balance is unchanged by the March carryover/refill.
    expect(deriveBalanceAsOf(applied, "2026-02-28T00:00:00.000Z").currentBalance).toBe(before);
  });
});

// ── Expiry ───────────────────────────────────────────────────

describe("expiry", () => {
  it("plans no expiry when the policy is not expiry", () => {
    const wallet = makeWallet({ carryoverPolicy: "unlimited" });
    const plan = planTimeBankExpiry({
      wallet,
      transactions: [tx(wallet, "monthly_refill", 600, "2026-01-01T00:00:00.000Z")],
      asOf: "2026-06-01T00:00:00.000Z",
      asOfKey: "2026-06",
    });
    expect(plan.due).toBe(false);
    expect(plan.plannedTransaction).toBeNull();
  });

  it("expires the leftover at the period boundary when no age is configured", () => {
    const wallet = makeWallet({ carryoverPolicy: "expiry", expiryAfterDays: null });
    const ledger = [tx(wallet, "monthly_refill", 600, "2026-01-01T00:00:00.000Z")];
    const plan = planTimeBankExpiry({
      wallet,
      transactions: ledger,
      asOf: "2026-02-01T00:00:00.000Z",
      asOfKey: "2026-02",
    });
    expect(plan.due).toBe(true);
    expect(plan.plannedTransaction?.type).toBe("expiry");
    expect(plan.plannedTransaction?.minutes).toBe(-600);
  });

  it("age-based expiry FIFO-expires minutes older than the configured age", () => {
    const wallet = makeWallet({ carryoverPolicy: "expiry", expiryAfterDays: 90 });
    const ledger = [
      tx(wallet, "monthly_refill", 600, "2026-01-01T00:00:00.000Z"), // old lot
      tx(wallet, "visit_consumption", -100, "2026-01-10T00:00:00.000Z"), // draws old lot first
      tx(wallet, "monthly_refill", 600, "2026-05-01T00:00:00.000Z"), // fresh lot
    ];
    const plan = planTimeBankExpiry({
      wallet,
      transactions: ledger,
      asOf: "2026-06-01T00:00:00.000Z",
      asOfKey: "2026-06",
    });
    // Old lot: 600 - 100 = 500 remaining and older than 90d → expires; fresh lot stays.
    expect(plan.plannedTransaction?.minutes).toBe(-500);
  });

  it("is idempotent on the deterministic expiry id", () => {
    const wallet = makeWallet({ carryoverPolicy: "expiry", expiryAfterDays: null });
    const ledger = [tx(wallet, "monthly_refill", 600, "2026-01-01T00:00:00.000Z")];
    const existing: TimeBankTransaction = {
      ...tx(wallet, "expiry", -600, "2026-02-01T00:00:00.000Z"),
      id: expiryTransactionId(wallet.id, "2026-02"),
    };
    const plan = planTimeBankExpiry({
      wallet,
      transactions: [...ledger, existing],
      asOf: "2026-02-01T00:00:00.000Z",
      asOfKey: "2026-02",
    });
    expect(plan.due).toBe(false);
  });

  it("computeAgeExpiry reports expiring-soon minutes within the lookahead", () => {
    const wallet = makeWallet({ carryoverPolicy: "expiry", expiryAfterDays: 90 });
    const ledger = [tx(wallet, "monthly_refill", 600, "2026-04-01T00:00:00.000Z")];
    // 90-day expiry; asOf is ~61 days in; lookahead 30d → within 60..90d window.
    const result = computeAgeExpiry(ledger, "2026-06-01T00:00:00.000Z", 90, 30);
    expect(result.expiringMinutes).toBe(0);
    expect(result.expiringSoonMinutes).toBe(600);
  });
});

// ── Threshold warnings ───────────────────────────────────────

describe("threshold warnings", () => {
  it("derives low-balance warning and critical levels", () => {
    const wallet = makeWallet({
      allocationMinutes: 600,
      warningThresholdPercent: 20, // 120m
      criticalThresholdPercent: 5, // 30m
    });
    expect(evaluateWalletWarnings({ wallet, currentBalance: 500, availableBalance: 500 }).lowBalance).toBe("ok");
    expect(evaluateWalletWarnings({ wallet, currentBalance: 100, availableBalance: 100 }).lowBalance).toBe("warning");
    expect(evaluateWalletWarnings({ wallet, currentBalance: 20, availableBalance: 20 }).lowBalance).toBe("critical");
  });

  it("flags a negative balance warning", () => {
    const wallet = makeWallet({ negativeFloorMinutes: 120 });
    const warnings = evaluateWalletWarnings({ wallet, currentBalance: -30, availableBalance: -30 });
    expect(warnings.isNegative).toBe(true);
  });

  it("surfaces an expiring-balance warning when supported", () => {
    const wallet = makeWallet({ carryoverPolicy: "expiry", expiryAfterDays: 90 });
    const warnings = evaluateWalletWarnings({
      wallet,
      currentBalance: 600,
      availableBalance: 600,
      expiringSoonMinutes: 600,
    });
    expect(warnings.hasExpiringWarning).toBe(true);
    expect(warnings.expiringSoonMinutes).toBe(600);
  });

  it("reports no expiring warning when none is supplied", () => {
    const wallet = makeWallet();
    const warnings = evaluateWalletWarnings({ wallet, currentBalance: 600, availableBalance: 600 });
    expect(warnings.hasExpiringWarning).toBe(false);
  });
});

// ── Wallet state machine ─────────────────────────────────────

describe("wallet state machine", () => {
  it("blocks a refill on a frozen wallet (honors existing reservations)", () => {
    const wallet = makeWallet({ refillFrequency: "monthly" }, { status: "frozen" });
    const plan = planTimeBankRefill({ wallet, transactions: [], periodDate: "2026-03-10" });
    expect(plan.due).toBe(false);
    expect(plan.blockedByGate).toBe(true);
    expect(plan.decision).toBe("blocked_frozen");
    expect(plan.plannedTransactions).toHaveLength(0);
  });

  it("rejects a refill on a closed wallet", () => {
    const wallet = makeWallet({ refillFrequency: "monthly" }, { status: "closed" });
    const plan = planTimeBankRefill({ wallet, transactions: [], periodDate: "2026-03-10" });
    expect(plan.due).toBe(false);
    expect(plan.blockedByGate).toBe(true);
    expect(plan.decision).toBe("blocked_closed");
  });
});

// ── Version-chain wallet continuity ──────────────────────────

describe("version-chain continuity", () => {
  it("keeps refilling the same wallet across v1 → v2 → v3 (binds to agreementGroupId)", () => {
    const v1 = makeAgreement();
    const wallet = buildWalletForAgreement({
      id: "wal_grp_1",
      agreement: v1,
      rules: defaultTimeBankRules(600, { refillFrequency: "monthly" }),
      now: NOW,
    });

    const v2 = createNewAgreementVersion(v1, {
      changes: { invoiceInterval: "quarterly" },
      now: "2026-04-01T00:00:00.000Z",
      newAgreementId: "agr_v2",
      createdBy: "user_1",
    }).next;
    const v3 = createNewAgreementVersion(v2, {
      changes: { name: "Renamed" },
      now: "2026-07-01T00:00:00.000Z",
      newAgreementId: "agr_v3",
      createdBy: "user_1",
    }).next;

    // The wallet binds to the stable group id, never a version id.
    expect(wallet.agreementGroupId).toBe(v1.agreementGroupId);
    expect(new Set([v1, v2, v3].map((v) => v.agreementGroupId)).size).toBe(1);

    // A refill planned under v3 lands on the SAME wallet ledger as one under v1.
    const planV1 = planTimeBankRefill({ wallet, transactions: [], periodDate: "2026-01-15" });
    const refillV1 = makePlanned(wallet, planV1);
    const planV3 = planTimeBankRefill({
      wallet,
      transactions: refillV1,
      periodDate: "2026-08-15",
    });
    const refillV3 = makePlanned(wallet, planV3);
    const full = [...refillV1, ...refillV3];
    expect(full.every((t) => t.walletId === wallet.id)).toBe(true);
    expect(full.every((t) => t.agreementGroupId === wallet.agreementGroupId)).toBe(true);
    expect(deriveBalance(full).currentBalance).toBe(1200);
  });
});

/** Materialises a plan's planned entries into real ledger transactions (test helper). */
function makePlanned(wallet: TimeBankWallet, plan: { plannedTransactions: { id: string; type: TimeBankTransactionType; minutes: number; effectiveAt: string }[] }): TimeBankTransaction[] {
  return plan.plannedTransactions.map((p) =>
    buildTransaction({
      id: p.id,
      wallet,
      type: p.type,
      minutes: p.minutes,
      effectiveAt: p.effectiveAt,
      now: NOW,
    }),
  );
}
