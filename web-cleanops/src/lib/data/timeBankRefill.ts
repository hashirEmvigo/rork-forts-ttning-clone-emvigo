/**
 * Time Bank Refill Engine Foundation (Phase 5 · pure planning layer).
 *
 * The deterministic, IDEMPOTENT planner that decides WHEN a wallet should refill,
 * HOW MUCH, and what carryover/expiry adjustments accompany it — without ever
 * writing anything. It sits on top of the pure ledger core (`timeBank.ts`) and is
 * consumed by an orchestration helper in `timeBankPersistence.ts` that performs
 * the actual append. Planning and write-execution are intentionally separate.
 *
 * This module is PURE and FOUNDATION ONLY:
 *   * No Supabase writes, no scheduler, no cron, no background job, no UI.
 *   * No activation, no flag, no production-authoritative flip, no rollout.
 *   * No billing/payroll/customer-facing wiring.
 *   * Every planner returns NEW objects and never mutates its inputs. Carryover
 *     and expiry are expressed as APPEND-ONLY ledger entries (never balance
 *     rewrites), so historical balances stay reproducible.
 *
 * Idempotency is the core guarantee: a refill (and its carryover/expiry) for a
 * given period is keyed on a DETERMINISTIC period id, so re-planning the same
 * period yields the same transaction ids — appending them twice is a no-op and
 * a period can never be double-credited.
 *
 * Honours the LOCKED Time Bank decisions: integer minutes only (4), no direct
 * balance editing (5), wallet binds to agreementGroupId (2), frozen/closed gate
 * blocks new refills (3), allocationMinutes is authoritative (7), default
 * carryover unlimited (8).
 */
import type {
  TimeBankRefillFrequency,
  TimeBankRules,
  TimeBankTransaction,
  TimeBankWallet,
} from "@/types";
import { canRecordTransaction, deriveBalanceAsOf, evaluateReservationWarning } from "./timeBank";
import type { TimeBankWarningLevel } from "./timeBank";

// ── Frequency helpers ────────────────────────────────────────

/** True when the frequency is auto-scheduled by the engine (not `none`/`manual`). */
export function isAutoRefillFrequency(frequency: TimeBankRefillFrequency): boolean {
  return (
    frequency === "weekly" ||
    frequency === "monthly" ||
    frequency === "quarterly" ||
    frequency === "yearly"
  );
}

/** Parses an ISO date/datetime into its UTC year/month/day parts. Throws on invalid input. */
function utcParts(date: string): { year: number; month: number; day: number; time: number } {
  const time = Date.parse(date);
  if (Number.isNaN(time)) {
    throw new Error(`Invalid refill period date: "${date}".`);
  }
  const d = new Date(time);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), time };
}

/** Zero-pads a number to a fixed width. */
function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

/**
 * ISO-8601 week-numbering year + week for a date (UTC). Used so weekly refills
 * key on `${isoYear}-W${week}` and never collide across year boundaries.
 */
function isoWeek(time: number): { year: number; week: number } {
  const d = new Date(time);
  // Shift to Thursday of the current ISO week (ISO weeks start Monday=1).
  const day = (d.getUTCDay() + 6) % 7; // 0 = Monday
  const thursday = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day + 3),
  );
  const isoYear = thursday.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstDay = (firstThursday.getUTCDay() + 6) % 7;
  const week =
    1 +
    Math.round(
      (thursday.getTime() - Date.UTC(isoYear, 0, 4 - firstDay)) / (7 * 24 * 60 * 60 * 1000),
    );
  return { year: isoYear, week };
}

/**
 * The stable period KEY for a frequency + date — the idempotency anchor:
 *   weekly → `2026-W03`, monthly → `2026-01`, quarterly → `2026-Q1`,
 *   yearly → `2026`. Returns null for `none`/`manual` (never auto-scheduled).
 */
export function refillPeriodKey(
  frequency: TimeBankRefillFrequency,
  date: string,
): string | null {
  if (!isAutoRefillFrequency(frequency)) return null;
  const { year, month, time } = utcParts(date);
  switch (frequency) {
    case "weekly": {
      const { year: isoYear, week } = isoWeek(time);
      return `${isoYear}-W${pad(week)}`;
    }
    case "monthly":
      return `${year}-${pad(month)}`;
    case "quarterly":
      return `${year}-Q${Math.floor((month - 1) / 3) + 1}`;
    case "yearly":
      return `${year}`;
    default:
      return null;
  }
}

/**
 * The period START instant (UTC ISO) the refill is anchored at — first day of the
 * month/quarter/year, or Monday of the ISO week. Used as the entry's `effectiveAt`
 * so the credit lands at the boundary regardless of when planning runs.
 */
export function refillPeriodStart(
  frequency: TimeBankRefillFrequency,
  date: string,
): string {
  const { year, month, time } = utcParts(date);
  switch (frequency) {
    case "weekly": {
      const d = new Date(time);
      const day = (d.getUTCDay() + 6) % 7;
      const monday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day);
      return new Date(monday).toISOString();
    }
    case "quarterly": {
      const firstMonth = Math.floor((month - 1) / 3) * 3 + 1;
      return new Date(Date.UTC(year, firstMonth - 1, 1)).toISOString();
    }
    case "yearly":
      return new Date(Date.UTC(year, 0, 1)).toISOString();
    case "monthly":
    default:
      return new Date(Date.UTC(year, month - 1, 1)).toISOString();
  }
}

/** Deterministic ledger id for a period refill — the idempotency key. */
export function refillTransactionId(walletId: string, periodKey: string): string {
  return `${walletId}-refill-${periodKey}`;
}

/** Deterministic ledger id for the carryover/expiry entry tied to a period refill. */
export function refillExpiryTransactionId(walletId: string, periodKey: string): string {
  return `${walletId}-refill-expiry-${periodKey}`;
}

/** Deterministic ledger id for a time-based (age) expiry sweep on a date. */
export function expiryTransactionId(walletId: string, asOfKey: string): string {
  return `${walletId}-expiry-${asOfKey}`;
}

// ── Planned (not written) transaction descriptor ─────────────

/**
 * A planned ledger entry the engine WOULD append. It maps 1:1 to
 * `appendWalletTransaction` inputs but is inert — nothing is written until an
 * orchestrator explicitly executes the plan.
 */
export interface PlannedTimeBankTransaction {
  /** Deterministic idempotency key (the legacyId the ledger row will use). */
  id: string;
  type: TimeBankTransaction["type"];
  /** SIGNED final value already in the ledger's convention (integer minutes). */
  minutes: number;
  effectiveAt: string;
  reason: string;
  /** Source metadata for audit (e.g. `refill:2026-01`, `carryover:2026-01`). */
  source: string;
}

// ── Refill planning ──────────────────────────────────────────

/** Inputs for {@link planTimeBankRefill}. */
export interface PlanRefillInput {
  wallet: TimeBankWallet;
  /** The wallet's existing ledger (used for idempotency + carryover math). */
  transactions: TimeBankTransaction[];
  /** The date we are planning a refill for (any instant inside the period). */
  periodDate: string;
  actorId?: string | null;
  actorName?: string | null;
}

/** Why a refill is / isn't due. */
export type RefillDecision =
  | "due"
  | "disabled"
  | "manual"
  | "already_refilled"
  | "blocked_frozen"
  | "blocked_closed";

/** Result of {@link planTimeBankRefill}. Pure — writes nothing. */
export interface RefillPlan {
  due: boolean;
  decision: RefillDecision;
  reason: string;
  frequency: TimeBankRefillFrequency;
  periodKey: string | null;
  /** Period anchor instant the credit lands at (null when not auto-scheduled). */
  effectiveAt: string | null;
  /** The refill amount (allocationMinutes) the plan would credit. */
  refillMinutes: number;
  /** True when the wallet state machine blocks the refill. */
  blockedByGate: boolean;
  /** Ordered entries to append (carryover/expiry first, then the refill). Empty when not due. */
  plannedTransactions: PlannedTimeBankTransaction[];
}

/**
 * Decides whether a wallet should refill for the period containing `periodDate`,
 * and returns the planned (unwritten) ledger entries:
 *
 *   1. Carryover handling (LOCKED decision 8), expressed as an `expiry` entry:
 *        * `unlimited`    → none (balance accumulates).
 *        * `no_carryover` → expire the pre-refill positive balance (reset to 0)
 *          BEFORE crediting the allocation.
 *        * `capped`       → after the credit, expire any excess above
 *          `maxBalanceMinutes`.
 *        * `expiry`       → handled by {@link planTimeBankExpiry}, not here.
 *   2. The refill credit of `allocationMinutes` (a `monthly_refill` accrual).
 *
 * IDEMPOTENT: keyed on the deterministic period id, so re-planning the same
 * period produces identical ids — the same period never creates duplicates.
 * `none`/`manual` frequencies are never auto-due. Frozen/closed wallets block
 * the refill (LOCKED decision 3).
 */
export function planTimeBankRefill(input: PlanRefillInput): RefillPlan {
  const { wallet, transactions, periodDate } = input;
  const { rules } = wallet;
  const frequency = rules.refillFrequency;

  const base: RefillPlan = {
    due: false,
    decision: "disabled",
    reason: "",
    frequency,
    periodKey: null,
    effectiveAt: null,
    refillMinutes: rules.allocationMinutes,
    blockedByGate: false,
    plannedTransactions: [],
  };

  if (frequency === "none") {
    return { ...base, decision: "disabled", reason: "Refill is disabled (frequency = none)." };
  }
  if (frequency === "manual") {
    return {
      ...base,
      decision: "manual",
      reason: "Refill is manual/one-time; the engine never auto-schedules it.",
    };
  }

  const periodKey = refillPeriodKey(frequency, periodDate);
  const effectiveAt = refillPeriodStart(frequency, periodDate);
  // periodKey is non-null here because the frequency is auto-scheduled.
  const refillId = refillTransactionId(wallet.id, periodKey as string);

  // State-machine gate: frozen/closed block new refills (decision 3).
  const gate = canRecordTransaction(wallet, "monthly_refill");
  if (!gate.allowed) {
    return {
      ...base,
      periodKey,
      effectiveAt,
      blockedByGate: true,
      decision: wallet.status === "closed" ? "blocked_closed" : "blocked_frozen",
      reason: gate.reason ?? "Refill blocked by wallet status.",
    };
  }

  // Idempotency: a refill for this period already exists → not due.
  if (transactions.some((tx) => tx.id === refillId)) {
    return {
      ...base,
      periodKey,
      effectiveAt,
      decision: "already_refilled",
      reason: `Refill for period ${periodKey} already exists (id ${refillId}).`,
    };
  }

  const planned: PlannedTimeBankTransaction[] = [];

  // Pre-refill carryover: no_carryover expires the leftover before crediting.
  if (rules.carryoverPolicy === "no_carryover") {
    const preBalance = deriveBalanceAsOf(transactions, effectiveAt).currentBalance;
    if (preBalance > 0) {
      planned.push({
        id: refillExpiryTransactionId(wallet.id, periodKey as string),
        type: "expiry",
        minutes: -preBalance,
        effectiveAt,
        reason: `Carryover reset (no_carryover) for period ${periodKey}.`,
        source: `carryover:${periodKey}`,
      });
    }
  }

  // The refill credit (allocationMinutes).
  if (rules.allocationMinutes > 0) {
    planned.push({
      id: refillId,
      type: "monthly_refill",
      minutes: rules.allocationMinutes,
      effectiveAt,
      reason: `Scheduled ${frequency} refill for period ${periodKey}.`,
      source: `refill:${periodKey}`,
    });
  }

  // Post-refill carryover: capped trims any excess above the cap.
  if (rules.carryoverPolicy === "capped" && rules.maxBalanceMinutes != null) {
    const preBalance = deriveBalanceAsOf(transactions, effectiveAt).currentBalance;
    const postBalance = preBalance + rules.allocationMinutes;
    const excess = postBalance - rules.maxBalanceMinutes;
    if (excess > 0) {
      planned.push({
        id: refillExpiryTransactionId(wallet.id, periodKey as string),
        type: "expiry",
        minutes: -excess,
        effectiveAt,
        reason: `Carryover cap (${rules.maxBalanceMinutes}m) trim for period ${periodKey}.`,
        source: `carryover:${periodKey}`,
      });
    }
  }

  return {
    ...base,
    due: planned.length > 0,
    decision: "due",
    reason:
      planned.length > 0
        ? `Refill due for period ${periodKey}.`
        : `Nothing to credit for period ${periodKey} (zero allocation).`,
    periodKey,
    effectiveAt,
    blockedByGate: false,
    plannedTransactions: planned,
  };
}

// ── Time-based expiry (FIFO lots) ────────────────────────────

/** A FIFO credit "lot" — minutes credited at an instant, drawn down oldest-first. */
interface CreditLot {
  effectiveAt: string;
  remaining: number;
}

/** Detail of how much of a wallet's balance is expiring as of a date. */
export interface ExpiryComputation {
  /** Total minutes that should expire (a non-negative magnitude). */
  expiringMinutes: number;
  /** Minutes that will expire WITHIN the lookahead window (for warnings). */
  expiringSoonMinutes: number;
}

/**
 * Computes age-based expiry with FIFO lot tracking (pure):
 *   * Positive CURRENT-balance entries (refill / manual_add / positive
 *     correction|migration) open dated lots.
 *   * Negative CURRENT-balance entries (consumption / expiry / manual_remove /
 *     negative correction|migration) draw down the OLDEST lots first.
 *   * Reservation entries are ignored (they touch the reserved balance only).
 *
 * Any minutes still remaining in lots older than `expiryAfterDays` (relative to
 * `asOf`) are expired. `expiringSoonDays`, when given, also reports minutes that
 * will expire within that lookahead window — derived state for warnings.
 */
export function computeAgeExpiry(
  transactions: TimeBankTransaction[],
  asOf: string,
  expiryAfterDays: number,
  expiringSoonDays?: number,
): ExpiryComputation {
  const asOfTime = Date.parse(asOf);
  const dayMs = 24 * 60 * 60 * 1000;
  const lots: CreditLot[] = [];

  const relevant = transactions
    .filter((tx) => tx.type !== "reservation" && tx.type !== "reservation_release")
    .filter((tx) => Date.parse(tx.effectiveAt) <= asOfTime)
    .slice()
    .sort((a, b) => (a.effectiveAt < b.effectiveAt ? -1 : a.effectiveAt > b.effectiveAt ? 1 : 0));

  for (const tx of relevant) {
    if (tx.minutes > 0) {
      lots.push({ effectiveAt: tx.effectiveAt, remaining: tx.minutes });
    } else if (tx.minutes < 0) {
      let draw = -tx.minutes;
      for (const lot of lots) {
        if (draw <= 0) break;
        const take = Math.min(lot.remaining, draw);
        lot.remaining -= take;
        draw -= take;
      }
    }
  }

  let expiringMinutes = 0;
  let expiringSoonMinutes = 0;
  for (const lot of lots) {
    if (lot.remaining <= 0) continue;
    const ageDays = (asOfTime - Date.parse(lot.effectiveAt)) / dayMs;
    if (ageDays >= expiryAfterDays) {
      expiringMinutes += lot.remaining;
    } else if (
      expiringSoonDays !== undefined &&
      ageDays >= expiryAfterDays - expiringSoonDays
    ) {
      expiringSoonMinutes += lot.remaining;
    }
  }

  return { expiringMinutes, expiringSoonMinutes };
}

/** Inputs for {@link planTimeBankExpiry}. */
export interface PlanExpiryInput {
  wallet: TimeBankWallet;
  transactions: TimeBankTransaction[];
  /** The instant to evaluate expiry as of (also the entry's effectiveAt). */
  asOf: string;
  /** Stable key for the deterministic expiry id (e.g. a period key or date). */
  asOfKey: string;
}

/** Result of {@link planTimeBankExpiry}. Pure — writes nothing. */
export interface ExpiryPlan {
  due: boolean;
  reason: string;
  /** A single planned `expiry` entry, or null when nothing expires / not configured. */
  plannedTransaction: PlannedTimeBankTransaction | null;
  blockedByGate: boolean;
}

/**
 * Plans an `expiry` ledger entry for the `expiry` carryover policy (LOCKED
 * decision 8). Two configured modes, both APPEND-ONLY (never balance rewrites):
 *   * `expiryAfterDays != null` → AGE-based: FIFO-expire minutes older than the
 *     configured age (see {@link computeAgeExpiry}).
 *   * `expiryAfterDays == null` → PERIOD-BOUNDARY: expire the entire positive
 *     current balance carried into `asOf`.
 *
 * Returns no entry when the policy isn't `expiry`, when nothing expires, or when
 * the wallet status blocks the write. Idempotent on the deterministic expiry id.
 */
export function planTimeBankExpiry(input: PlanExpiryInput): ExpiryPlan {
  const { wallet, transactions, asOf, asOfKey } = input;
  const { rules } = wallet;

  if (rules.carryoverPolicy !== "expiry") {
    return {
      due: false,
      reason: `Carryover policy is "${rules.carryoverPolicy}"; no time-based expiry.`,
      plannedTransaction: null,
      blockedByGate: false,
    };
  }

  const gate = canRecordTransaction(wallet, "expiry");
  if (!gate.allowed) {
    return {
      due: false,
      reason: gate.reason ?? "Expiry blocked by wallet status.",
      plannedTransaction: null,
      blockedByGate: true,
    };
  }

  const expiryId = expiryTransactionId(wallet.id, asOfKey);
  if (transactions.some((tx) => tx.id === expiryId)) {
    return {
      due: false,
      reason: `Expiry for ${asOfKey} already exists (id ${expiryId}).`,
      plannedTransaction: null,
      blockedByGate: false,
    };
  }

  let expiringMinutes: number;
  let mode: string;
  if (rules.expiryAfterDays != null) {
    expiringMinutes = computeAgeExpiry(transactions, asOf, rules.expiryAfterDays).expiringMinutes;
    mode = `age>=${rules.expiryAfterDays}d`;
  } else {
    const balance = deriveBalanceAsOf(transactions, asOf).currentBalance;
    expiringMinutes = balance > 0 ? balance : 0;
    mode = "period-boundary";
  }

  if (expiringMinutes <= 0) {
    return {
      due: false,
      reason: `Nothing to expire as of ${asOfKey} (${mode}).`,
      plannedTransaction: null,
      blockedByGate: false,
    };
  }

  return {
    due: true,
    reason: `Expiry of ${expiringMinutes}m due as of ${asOfKey} (${mode}).`,
    plannedTransaction: {
      id: expiryId,
      type: "expiry",
      minutes: -expiringMinutes,
      effectiveAt: asOf,
      reason: `Time Bank expiry (${mode}) as of ${asOfKey}.`,
      source: `expiry:${asOfKey}`,
    },
    blockedByGate: false,
  };
}

// ── Threshold / warning evaluation (derived, never stored) ───

/** A wallet's derived warning state. Computed from the ledger, never persisted. */
export interface WalletWarnings {
  /** Low-balance level from available balance vs thresholds (ok/warning/critical). */
  lowBalance: TimeBankWarningLevel;
  /** True when the CURRENT balance is below zero (overdrawn). */
  isNegative: boolean;
  /** Minutes expiring within the lookahead window (0 when unsupported). */
  expiringSoonMinutes: number;
  /** True when there is an expiring-balance warning. */
  hasExpiringWarning: boolean;
}

/** Options for {@link evaluateWalletWarnings}. */
export interface EvaluateWarningsInput {
  wallet: TimeBankWallet;
  /** Current (real) balance — drives the negative-balance warning. */
  currentBalance: number;
  /** Available balance — drives the low-balance threshold warning. */
  availableBalance: number;
  /** Minutes expiring soon (from {@link computeAgeExpiry}); 0/undefined → no expiry warning. */
  expiringSoonMinutes?: number;
}

/**
 * Computes a wallet's warning state from DERIVED balances (LOCKED decision 10):
 *   * `lowBalance` reuses {@link evaluateReservationWarning} (percent-of-allocation
 *     thresholds with an absolute fallback for zero-allocation wallets).
 *   * `isNegative` flags an overdrawn current balance.
 *   * `expiringSoonMinutes` / `hasExpiringWarning` surface upcoming age-based
 *     expiry when supplied.
 *
 * Pure and stateless — these are signals only and never block or store anything.
 */
export function evaluateWalletWarnings(input: EvaluateWarningsInput): WalletWarnings {
  const expiringSoonMinutes = input.expiringSoonMinutes ?? 0;
  return {
    lowBalance: evaluateReservationWarning(input.wallet, input.availableBalance),
    isNegative: input.currentBalance < 0,
    expiringSoonMinutes,
    hasExpiringWarning: expiringSoonMinutes > 0,
  };
}

/** Re-exported so callers can reference the rules shape without a deep import. */
export type { TimeBankRules };
