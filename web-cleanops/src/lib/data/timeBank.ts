/**
 * Time Bank Foundation (Phase 3 · logic only).
 *
 * The immutable transaction-ledger core for the Time Bank: how a wallet's
 * balances are DERIVED from an append-only ledger (never stored), how new
 * ledger entries are constructed safely, how the LOCKED wallet state machine
 * gates writes, and how the wallet's binding to the stable `agreementGroupId`
 * survives agreement versioning. It also exposes statement/statistics helpers
 * so future payroll, billable-hours and reporting can read clean aggregates.
 *
 * This module is PURE and FOUNDATION ONLY:
 *   * No Supabase writes, no localStorage, no UI, no flags, no activation.
 *   * No migration is created; no production-authoritative flip; no rollout.
 *   * It never mutates the wallets/transactions passed to it — builders return
 *     NEW objects, and every balance is a pure fold over an immutable ledger,
 *     so historical balances are always reproducible and a later entry can
 *     never rewrite the past.
 *
 * It honours the LOCKED Time Bank decisions (see Development Center
 * `time_bank`):
 *   (1) ONE wallet per agreementGroupId.            (2) Wallet binds to
 *   agreementGroupId, NEVER a version id.           (3) Statuses active |
 *   frozen | closed; frozen HONORS existing reservations, blocks new ones,
 *   refills and adjustments.                         (4) Signed INTEGER minutes
 *   only.                                            (5) No direct balance
 *   editing — every change is a transaction.        (10)
 *   available = current − reserved.
 *
 * Out of scope (nothing here): persistence, refill scheduling jobs, invoice
 * intents/money ledger, customer portal, UI.
 */
import type {
  CustomerAgreement,
  TimeBankBalance,
  TimeBankCancellationCredit,
  TimeBankCancellationPolicy,
  TimeBankCarryoverPolicy,
  TimeBankRefillFrequency,
  TimeBankRules,
  TimeBankTransaction,
  TimeBankTransactionKind,
  TimeBankTransactionType,
  TimeBankWallet,
  TimeBankWalletStatus,
} from "@/types";

// ── Transaction classification ───────────────────────────────

/**
 * Transaction types whose `minutes` MUST be positive (credits / holds). Their
 * builders coerce the supplied magnitude to a positive value.
 */
const POSITIVE_TYPES: ReadonlySet<TimeBankTransactionType> = new Set([
  "monthly_refill",
  "manual_add",
  "cancelled_visit_credit",
  "reservation",
]);

/**
 * Transaction types whose `minutes` MUST be negative (debits / releases). Their
 * builders coerce the supplied magnitude to a negative value.
 */
const NEGATIVE_TYPES: ReadonlySet<TimeBankTransactionType> = new Set([
  "manual_remove",
  "visit_consumption",
  "cancellation_consumption",
  "reschedule_consumption",
  "reservation_release",
  "expiry",
]);

/** Transaction types that accept a SIGNED value (±) as-is. */
const SIGNED_TYPES: ReadonlySet<TimeBankTransactionType> = new Set([
  "correction",
  "opening_balance",
  "migration",
]);

/** Transaction types that affect the RESERVED balance (not the current balance). */
const RESERVATION_TYPES: ReadonlySet<TimeBankTransactionType> = new Set([
  "reservation",
  "reservation_release",
]);

/** Maps each ledger type to its high-level {@link TimeBankTransactionKind}. */
const TYPE_KIND: Record<TimeBankTransactionType, TimeBankTransactionKind> = {
  monthly_refill: "accrual",
  manual_add: "adjustment",
  manual_remove: "adjustment",
  visit_consumption: "consumption",
  cancellation_consumption: "consumption",
  reschedule_consumption: "consumption",
  cancelled_visit_credit: "accrual",
  reservation: "reservation",
  reservation_release: "reservation",
  correction: "correction",
  expiry: "expiration",
  opening_balance: "migration",
  migration: "migration",
};

/** The semantic family of a transaction type (accrual / consumption / …). */
export function transactionKind(type: TimeBankTransactionType): TimeBankTransactionKind {
  return TYPE_KIND[type];
}

/** True when the type affects the RESERVED balance rather than the current balance. */
export function affectsReserved(type: TimeBankTransactionType): boolean {
  return RESERVATION_TYPES.has(type);
}

/**
 * Canonicalises a magnitude/value into the SIGNED INTEGER minutes the ledger
 * stores, applying the sign rule for the type. Throws on non-finite or
 * non-integer input (no floating-point hours allowed — LOCKED decision 4).
 *
 *  - Positive types → `+|value|`.
 *  - Negative types → `−|value|`.
 *  - Signed types (correction, migration) → `value` unchanged.
 */
export function normalizeMinutes(type: TimeBankTransactionType, value: number): number {
  if (!Number.isInteger(value)) {
    throw new Error(
      `Time Bank minutes must be an integer (got ${value}). Minutes are stored as signed integers, never hours.`,
    );
  }
  if (SIGNED_TYPES.has(type)) return value;
  const magnitude = Math.abs(value);
  return NEGATIVE_TYPES.has(type) ? -magnitude : magnitude;
}

// ── Balance derivation (pure folds over the ledger) ──────────

/**
 * Derives a wallet's balances from its FULL transaction ledger. Reservation
 * entries accumulate into `reservedBalance`; every other type into
 * `currentBalance`. `available = current − reserved` (LOCKED decision 10).
 * Pure — does not mutate the input.
 */
export function deriveBalance(transactions: TimeBankTransaction[]): TimeBankBalance {
  let currentBalance = 0;
  let reservedBalance = 0;
  for (const tx of transactions) {
    if (affectsReserved(tx.type)) {
      reservedBalance += tx.minutes;
    } else {
      currentBalance += tx.minutes;
    }
  }
  return {
    currentBalance,
    reservedBalance,
    availableBalance: currentBalance - reservedBalance,
  };
}

/**
 * Reproduces a wallet's balances AS OF an instant — folding only the entries
 * with `effectiveAt <= asOf`. This proves historical reproducibility: the same
 * `asOf` always yields the same balances regardless of later entries, so future
 * transactions can never rewrite a historical balance.
 */
export function deriveBalanceAsOf(
  transactions: TimeBankTransaction[],
  asOf: string,
): TimeBankBalance {
  return deriveBalance(transactions.filter((tx) => tx.effectiveAt <= asOf));
}

/**
 * Stable chronological ordering for statements/audit: by `effectiveAt`, then by
 * `id` as a deterministic tie-breaker. Returns a NEW array.
 */
export function orderLedger(transactions: TimeBankTransaction[]): TimeBankTransaction[] {
  return transactions.slice().sort((a, b) => {
    if (a.effectiveAt !== b.effectiveAt) return a.effectiveAt < b.effectiveAt ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

// ── Wallet binding to agreementGroupId (proof, not behaviour) ─

/**
 * The key a wallet binds to. By LOCKED decision the wallet binds to the stable
 * {@link TimeBankWallet.agreementGroupId} — NOT a version id — so it survives
 * version changes, price changes and line changes.
 */
export function walletBindingKey(wallet: TimeBankWallet): string {
  return wallet.agreementGroupId;
}

/**
 * Proves wallet continuity across a version chain: the wallet's binding key must
 * equal the single `agreementGroupId` shared by every version in the chain,
 * regardless of which version is currently live. Returns false when the chain is
 * empty, mixes group ids, or the wallet binds elsewhere. This is the contract
 * test for "version changes never break wallet continuity".
 */
export function walletMatchesAgreementChain(
  wallet: TimeBankWallet,
  versions: CustomerAgreement[],
): boolean {
  if (versions.length === 0) return false;
  const groupIds = new Set(versions.map((v) => v.agreementGroupId));
  if (groupIds.size !== 1) return false;
  return groupIds.has(wallet.agreementGroupId);
}

// ── Wallet state machine gates (LOCKED decision 3) ───────────

/** Types blocked while a wallet is `frozen` (new reservations, refills, adjustments, inbound credits). */
const FROZEN_BLOCKED_TYPES: ReadonlySet<TimeBankTransactionType> = new Set([
  "monthly_refill",
  "manual_add",
  "manual_remove",
  "cancelled_visit_credit",
  "reservation",
]);

/** Result of a write-gate check. */
export interface TransactionGateResult {
  allowed: boolean;
  /** Populated when `allowed` is false. */
  reason?: string;
}

/**
 * Decides whether a transaction of `type` may be appended given the wallet's
 * status (LOCKED decision 3):
 *  - `active` → everything allowed.
 *  - `frozen` → HONORS existing reservations: consumption and reservation_release
 *    are allowed (and corrections, for audit), but new reservations, refills and
 *    manual adjustments are blocked.
 *  - `closed` → terminal: no new transactions of any kind.
 */
export function canRecordTransaction(
  wallet: TimeBankWallet,
  type: TimeBankTransactionType,
): TransactionGateResult {
  switch (wallet.status) {
    case "active":
      return { allowed: true };
    case "frozen":
      if (FROZEN_BLOCKED_TYPES.has(type)) {
        return {
          allowed: false,
          reason: `Wallet ${wallet.id} is frozen: "${type}" is blocked (existing reservations are honored, but new reservations, refills and manual adjustments are not).`,
        };
      }
      return { allowed: true };
    case "closed":
      return {
        allowed: false,
        reason: `Wallet ${wallet.id} is closed: no new transactions are permitted.`,
      };
    default:
      return { allowed: false, reason: "Unknown wallet status." };
  }
}

// ── Consumption floor + reservation warnings ─────────────────

/** Result of {@link evaluateConsumption}. */
export interface ConsumptionEvaluation {
  /** True when consuming stays at or above the negative floor. */
  withinFloor: boolean;
  /** Balance after the proposed consumption. */
  resultingBalance: number;
  /** The hard floor (`-negativeFloorMinutes`). */
  floor: number;
}

/**
 * Stage-2 consumption enforcement (LOCKED decision 10): checks whether consuming
 * `minutesToConsume` (a non-negative magnitude) keeps the CURRENT balance at or
 * above the wallet's floor (`-negativeFloorMinutes`). When `withinFloor` is
 * false the caller must block or require an explicit override.
 */
export function evaluateConsumption(
  wallet: TimeBankWallet,
  currentBalance: number,
  minutesToConsume: number,
): ConsumptionEvaluation {
  const magnitude = Math.abs(Math.trunc(minutesToConsume));
  const floor = -Math.abs(wallet.rules.negativeFloorMinutes);
  const resultingBalance = currentBalance - magnitude;
  return { withinFloor: resultingBalance >= floor, resultingBalance, floor };
}

/** Severity of a reservation/availability warning. */
export type TimeBankWarningLevel = "ok" | "warning" | "critical";

/**
 * Stage-1 reservation warning (LOCKED decision 10): compares `availableBalance`
 * against percentage thresholds relative to `allocationMinutes`, falling back to
 * absolute minute thresholds for zero-allocation wallets. Warnings never block —
 * they only signal. Returns the most severe matching level.
 */
export function evaluateReservationWarning(
  wallet: TimeBankWallet,
  availableBalance: number,
): TimeBankWarningLevel {
  const { rules } = wallet;
  const critical = thresholdMinutes(
    rules.allocationMinutes,
    rules.criticalThresholdPercent,
    rules.criticalThresholdMinutes,
  );
  const warning = thresholdMinutes(
    rules.allocationMinutes,
    rules.warningThresholdPercent,
    rules.warningThresholdMinutes,
  );
  if (critical !== null && availableBalance <= critical) return "critical";
  if (warning !== null && availableBalance <= warning) return "warning";
  return "ok";
}

/** Resolves a threshold to minutes: percent-of-allocation, else absolute fallback. */
function thresholdMinutes(
  allocationMinutes: number,
  percent: number | null | undefined,
  absolute: number | null | undefined,
): number | null {
  if (allocationMinutes > 0 && percent !== null && percent !== undefined) {
    return Math.round((percent / 100) * allocationMinutes);
  }
  if (absolute !== null && absolute !== undefined) return absolute;
  return null;
}

// ── Builders (pure, immutable) ───────────────────────────────

/** Inputs for {@link buildTransaction}. */
export interface BuildTransactionInput {
  id: string;
  wallet: TimeBankWallet;
  type: TimeBankTransactionType;
  /** Magnitude (positive/negative types) or signed value (correction/migration). */
  minutes: number;
  effectiveAt: string;
  now: string;
  actorId?: string | null;
  actorName?: string | null;
  reason?: string | null;
  serviceCategorySnapshot?: string | null;
  billable?: boolean | null;
  sourceWorkOrderId?: string | null;
  sourceOccurrenceId?: string | null;
  sourceAgreementVersionId?: string | null;
  /** Audit breakdown for `cancelled_visit_credit` entries (see {@link buildCancellationCreditTransaction}). */
  cancellationCredit?: TimeBankCancellationCredit | null;
}

/**
 * Builds an immutable ledger entry for a wallet, applying the sign rule for the
 * type and stamping the wallet's binding key (`agreementGroupId`) and company.
 * Pure — creates a NEW object and never mutates the wallet. Does NOT enforce the
 * status gate (call {@link canRecordTransaction} first); this keeps the builder
 * usable for migration/correction backfills.
 */
export function buildTransaction(input: BuildTransactionInput): TimeBankTransaction {
  const minutes = normalizeMinutes(input.type, input.minutes);
  return {
    id: input.id,
    walletId: input.wallet.id,
    agreementGroupId: input.wallet.agreementGroupId,
    companyId: input.wallet.companyId,
    type: input.type,
    minutes,
    effectiveAt: input.effectiveAt,
    actorId: input.actorId ?? null,
    actorName: input.actorName ?? null,
    reason: input.reason ?? null,
    serviceCategorySnapshot: input.serviceCategorySnapshot ?? null,
    billable: input.billable ?? null,
    sourceWorkOrderId: input.sourceWorkOrderId ?? null,
    sourceOccurrenceId: input.sourceOccurrenceId ?? null,
    sourceAgreementVersionId: input.sourceAgreementVersionId ?? null,
    cancellationCredit: input.cancellationCredit ?? null,
    createdAt: input.now,
  };
}

// ── Cancellation credit (pure calculation + builder) ─────────────

/** A sensible default cancellation policy: enabled, full credit, no deduction. */
export function defaultCancellationPolicy(
  over: Partial<TimeBankCancellationPolicy> = {},
): TimeBankCancellationPolicy {
  return {
    enabled: true,
    deductionMethod: "none",
    deductionMinutes: null,
    deductionPercent: null,
    minCreditMinutes: 0,
    ...over,
  };
}

/** Outcome of {@link validateCancellationPolicy}. */
export interface CancellationPolicyValidation {
  ok: boolean;
  errors: string[];
}

/**
 * Validates a {@link TimeBankCancellationPolicy}. Enforces integer, non-negative
 * deduction values and a 0–100 range for the percentage method. A disabled
 * policy is always valid (its deduction fields are ignored).
 */
export function validateCancellationPolicy(
  policy: TimeBankCancellationPolicy,
): CancellationPolicyValidation {
  const errors: string[] = [];
  if (policy.minCreditMinutes != null) {
    if (!Number.isInteger(policy.minCreditMinutes) || policy.minCreditMinutes < 0) {
      errors.push("minCreditMinutes must be a non-negative integer.");
    }
  }
  if (policy.enabled) {
    if (policy.deductionMethod === "fixed") {
      const m = policy.deductionMinutes;
      if (m == null || !Number.isInteger(m) || m < 0) {
        errors.push("fixed deduction requires a non-negative integer deductionMinutes.");
      }
    } else if (policy.deductionMethod === "percentage") {
      const p = policy.deductionPercent;
      if (p == null || !Number.isInteger(p) || p < 0 || p > 100) {
        errors.push("percentage deduction requires an integer deductionPercent between 0 and 100.");
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Computes the NET cancellation credit for a cancelled visit. Pure and
 * integer-only: the deduction is rounded to whole minutes and the credit is
 * clamped to `[minCreditMinutes, originalVisitMinutes]` (never negative, never
 * more than the visit). Returns `null` when the policy is disabled (no credit).
 *
 * The returned breakdown is the audit-grade record stored on the ledger entry;
 * the customer only ever sees `creditedMinutes`.
 */
export function calculateCancellationCredit(
  originalVisitMinutes: number,
  policy: TimeBankCancellationPolicy,
  cancellationReason?: string | null,
): TimeBankCancellationCredit | null {
  if (!Number.isInteger(originalVisitMinutes) || originalVisitMinutes < 0) {
    throw new Error(
      `Cancellation credit requires a non-negative integer visit duration (got ${originalVisitMinutes}).`,
    );
  }
  if (!policy.enabled) return null;

  let deductionMinutes = 0;
  let deductionValue: number | null = null;
  if (policy.deductionMethod === "fixed") {
    deductionValue = policy.deductionMinutes ?? 0;
    deductionMinutes = Math.max(0, Math.round(deductionValue));
  } else if (policy.deductionMethod === "percentage") {
    deductionValue = policy.deductionPercent ?? 0;
    deductionMinutes = Math.round((Math.max(0, Math.min(100, deductionValue)) / 100) * originalVisitMinutes);
  }

  // Never deduct more than the visit.
  deductionMinutes = Math.min(deductionMinutes, originalVisitMinutes);
  const floor = Math.max(0, policy.minCreditMinutes ?? 0);
  let creditedMinutes = originalVisitMinutes - deductionMinutes;
  if (creditedMinutes < floor) {
    creditedMinutes = Math.min(floor, originalVisitMinutes);
    deductionMinutes = originalVisitMinutes - creditedMinutes;
  }

  return {
    originalVisitMinutes,
    deductionMethod: policy.deductionMethod,
    deductionValue,
    deductionMinutes,
    creditedMinutes,
    cancellationReason: cancellationReason ?? null,
  };
}

/** Inputs for {@link buildCancellationCreditTransaction}. */
export interface BuildCancellationCreditInput {
  id: string;
  wallet: TimeBankWallet;
  /** The originally scheduled visit duration (integer minutes). */
  originalVisitMinutes: number;
  policy: TimeBankCancellationPolicy;
  effectiveAt: string;
  now: string;
  cancellationReason?: string | null;
  actorId?: string | null;
  actorName?: string | null;
  serviceCategorySnapshot?: string | null;
  billable?: boolean | null;
  sourceWorkOrderId?: string | null;
  sourceOccurrenceId?: string | null;
  sourceAgreementVersionId?: string | null;
}

/**
 * Builds a SINGLE net `cancelled_visit_credit` ledger entry from a cancelled
 * visit. The ledger stores ONE positive credit (`minutes = creditedMinutes`)
 * plus the full {@link TimeBankCancellationCredit} breakdown for audit — never
 * a separate "duration" entry minus a "fee" entry. Returns `null` when the
 * policy is disabled or the net credit is zero (nothing to record). Pure; does
 * NOT enforce the wallet status gate (call {@link canRecordTransaction} first).
 */
export function buildCancellationCreditTransaction(
  input: BuildCancellationCreditInput,
): TimeBankTransaction | null {
  const breakdown = calculateCancellationCredit(
    input.originalVisitMinutes,
    input.policy,
    input.cancellationReason,
  );
  if (breakdown === null || breakdown.creditedMinutes <= 0) return null;
  const tx = buildTransaction({
    id: input.id,
    wallet: input.wallet,
    type: "cancelled_visit_credit",
    minutes: breakdown.creditedMinutes,
    effectiveAt: input.effectiveAt,
    now: input.now,
    actorId: input.actorId,
    actorName: input.actorName,
    reason: input.cancellationReason ?? null,
    serviceCategorySnapshot: input.serviceCategorySnapshot,
    billable: input.billable,
    sourceWorkOrderId: input.sourceWorkOrderId,
    sourceOccurrenceId: input.sourceOccurrenceId,
    sourceAgreementVersionId: input.sourceAgreementVersionId,
  });
  return { ...tx, cancellationCredit: breakdown };
}

/** Sensible, conservative default rules for a new wallet (unlimited carryover). */
export function defaultTimeBankRules(
  allocationMinutes: number,
  over: Partial<TimeBankRules> = {},
): TimeBankRules {
  return {
    allocationMinutes,
    suggestedAllocationMinutes: null,
    refillFrequency: "monthly",
    refillAnchor: "01",
    negativeFloorMinutes: 0,
    carryoverPolicy: "unlimited",
    maxBalanceMinutes: null,
    warningThresholdPercent: 20,
    criticalThresholdPercent: 5,
    warningThresholdMinutes: null,
    criticalThresholdMinutes: null,
    ...over,
  };
}

/** Inputs for {@link buildWalletForAgreement}. */
export interface BuildWalletInput {
  id: string;
  /** The live agreement version the wallet is created from (any version works). */
  agreement: CustomerAgreement;
  rules: TimeBankRules;
  now: string;
  status?: TimeBankWalletStatus;
}

/**
 * Creates a wallet BOUND TO the agreement's stable `agreementGroupId` (NOT its
 * version id — LOCKED decision 2), so a later version change leaves the wallet's
 * binding untouched. Pure — does not mutate the agreement.
 */
export function buildWalletForAgreement(input: BuildWalletInput): TimeBankWallet {
  return {
    id: input.id,
    agreementGroupId: input.agreement.agreementGroupId,
    customerId: input.agreement.customerId,
    companyId: input.agreement.companyId,
    status: input.status ?? "active",
    rules: input.rules,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

// ── Ledger integrity validation ──────────────────────────────

/** Outcome of {@link validateLedger}. */
export interface LedgerIntegrityResult {
  ok: boolean;
  /** Anomalies found (orphans, group mismatch, non-integer minutes, sign/zero, negative reserved). */
  issues: string[];
  balance: TimeBankBalance;
}

/**
 * Validates a wallet's ledger against the LOCKED invariants:
 *  - no transaction without its wallet (no orphan: walletId + agreementGroupId match);
 *  - every `minutes` is a finite integer and non-zero;
 *  - sign matches the type (positive/negative types) — corrections/migration are signed;
 *  - reserved balance never goes negative (can't release more than was reserved).
 * Read-only; also returns the derived balance for convenience.
 */
export function validateLedger(
  wallet: TimeBankWallet,
  transactions: TimeBankTransaction[],
): LedgerIntegrityResult {
  const issues: string[] = [];

  for (const tx of transactions) {
    if (tx.walletId !== wallet.id) {
      issues.push(`transaction ${tx.id} belongs to wallet ${tx.walletId}, not ${wallet.id}`);
    }
    if (tx.agreementGroupId !== wallet.agreementGroupId) {
      issues.push(
        `transaction ${tx.id} agreementGroupId ${tx.agreementGroupId} != wallet ${wallet.agreementGroupId}`,
      );
    }
    if (!Number.isInteger(tx.minutes)) {
      issues.push(`transaction ${tx.id} minutes ${tx.minutes} is not an integer`);
    } else if (tx.minutes === 0) {
      issues.push(`transaction ${tx.id} has zero minutes (no-op ledger entry)`);
    } else if (POSITIVE_TYPES.has(tx.type) && tx.minutes < 0) {
      issues.push(`transaction ${tx.id} (${tx.type}) must be positive, got ${tx.minutes}`);
    } else if (NEGATIVE_TYPES.has(tx.type) && tx.minutes > 0) {
      issues.push(`transaction ${tx.id} (${tx.type}) must be negative, got ${tx.minutes}`);
    }
  }

  // Reserved balance must never be negative at any point in chronological order.
  let runningReserved = 0;
  for (const tx of orderLedger(transactions)) {
    if (affectsReserved(tx.type)) {
      runningReserved += tx.minutes;
      if (runningReserved < 0) {
        issues.push(
          `reserved balance went negative at transaction ${tx.id} (released more than reserved)`,
        );
        break;
      }
    }
  }

  return { ok: issues.length === 0, issues, balance: deriveBalance(transactions) };
}

// ── Statement / statistics aggregation ───────────────────────

/** A statement-ready aggregate of a wallet's ledger over a window. */
export interface TimeBankStatement {
  /** Opening balance immediately BEFORE the window (null window → 0). */
  openingBalance: number;
  /** Closing balance at the end of the window. */
  closingBalance: number;
  /** Total accrued (refills). */
  refillMinutes: number;
  /** Total consumed (all consumption types, as a positive magnitude). */
  consumptionMinutes: number;
  /** Net of manual add/remove. */
  adjustmentMinutes: number;
  /** Total expired (positive magnitude). */
  expiryMinutes: number;
  /** Net correction (signed). */
  correctionMinutes: number;
  /**
   * Imported OPENING BALANCE minutes (signed) — the explicit starting balance
   * carried into CleanOps at onboarding. Shown on customer-facing statements as
   * "Opening Balance". Kept SEPARATE from {@link migrationMinutes}.
   */
  openingBalanceMinutes: number;
  /** Other migration minutes (signed) — excludes `opening_balance` entries. */
  migrationMinutes: number;
  /** Consumption split by service category (positive magnitudes). */
  consumptionByCategory: Record<string, number>;
  /** Billable vs non-billable consumed minutes (positive magnitudes; unknown billable → non-billable). */
  billableMinutes: number;
  nonBillableMinutes: number;
}

/** Optional window (inclusive ISO bounds) for {@link buildStatement}. */
export interface StatementWindow {
  from?: string;
  to?: string;
}

/**
 * Aggregates a ledger into a statement (LOCKED decision 9): opening/closing
 * balance plus refills, consumption (split by category + billable/non-billable),
 * adjustments, expiry, corrections and migration. Reservation entries are
 * intentionally excluded — a statement reports the CURRENT balance flow, not
 * holds. Pure; supports an optional inclusive window for monthly statements.
 *
 * Forward-compatible for payroll / billable-hours / workload statistics: callers
 * read these aggregates without re-implementing the ledger math.
 */
export function buildStatement(
  transactions: TimeBankTransaction[],
  window: StatementWindow = {},
): TimeBankStatement {
  const ordered = orderLedger(transactions);
  const inWindow = ordered.filter(
    (tx) =>
      (window.from === undefined || tx.effectiveAt >= window.from) &&
      (window.to === undefined || tx.effectiveAt <= window.to),
  );

  // Opening balance = current-affecting flow strictly before the window opens.
  const openingBalance =
    window.from === undefined
      ? 0
      : ordered
          .filter((tx) => tx.effectiveAt < window.from! && !affectsReserved(tx.type))
          .reduce((sum, tx) => sum + tx.minutes, 0);

  const statement: TimeBankStatement = {
    openingBalance,
    closingBalance: openingBalance,
    refillMinutes: 0,
    consumptionMinutes: 0,
    adjustmentMinutes: 0,
    expiryMinutes: 0,
    correctionMinutes: 0,
    openingBalanceMinutes: 0,
    migrationMinutes: 0,
    consumptionByCategory: {},
    billableMinutes: 0,
    nonBillableMinutes: 0,
  };

  for (const tx of inWindow) {
    if (affectsReserved(tx.type)) continue;
    statement.closingBalance += tx.minutes;
    const kind = transactionKind(tx.type);
    switch (kind) {
      case "accrual":
        statement.refillMinutes += tx.minutes;
        break;
      case "consumption": {
        const magnitude = Math.abs(tx.minutes);
        statement.consumptionMinutes += magnitude;
        const category = tx.serviceCategorySnapshot ?? "uncategorized";
        statement.consumptionByCategory[category] =
          (statement.consumptionByCategory[category] ?? 0) + magnitude;
        if (tx.billable === true) statement.billableMinutes += magnitude;
        else statement.nonBillableMinutes += magnitude;
        break;
      }
      case "adjustment":
        statement.adjustmentMinutes += tx.minutes;
        break;
      case "expiration":
        statement.expiryMinutes += Math.abs(tx.minutes);
        break;
      case "correction":
        statement.correctionMinutes += tx.minutes;
        break;
      case "migration":
        if (tx.type === "opening_balance") statement.openingBalanceMinutes += tx.minutes;
        else statement.migrationMinutes += tx.minutes;
        break;
      default:
        break;
    }
  }

  return statement;
}

// ── Carryover application (pure planning helper) ─────────────

/**
 * Computes the `expiry` adjustment (a non-positive magnitude) that a carryover
 * policy would apply to a pre-refill `currentBalance`. Returns 0 when nothing
 * expires. Pure planning helper — it returns the delta only; the caller decides
 * whether to append an `expiry` transaction. Never mutates anything.
 *
 *  - `unlimited`    → 0 (balance accumulates).
 *  - `capped`       → trims the excess above `maxBalanceMinutes` (if any).
 *  - `no_carryover` → expires the entire positive balance (reset to 0).
 *  - `expiry`       → 0 here (time-based expiry needs dated policy input later).
 */
export function carryoverExpiryDelta(
  policy: TimeBankCarryoverPolicy,
  currentBalance: number,
  maxBalanceMinutes: number | null | undefined,
): number {
  switch (policy) {
    case "capped": {
      if (maxBalanceMinutes === null || maxBalanceMinutes === undefined) return 0;
      const excess = currentBalance - maxBalanceMinutes;
      return excess > 0 ? -excess : 0;
    }
    case "no_carryover":
      return currentBalance > 0 ? -currentBalance : 0;
    case "unlimited":
    case "expiry":
    default:
      return 0;
  }
}

/** Re-exported for convenience so callers can type refill cadence without a deep import. */
export type { TimeBankRefillFrequency };
