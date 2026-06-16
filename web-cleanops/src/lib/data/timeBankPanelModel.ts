/**
 * Time Bank — Admin Panel view-model (Phase 13 · first admin UI surface).
 *
 * The PURE presentation layer between the Time Bank data foundation and the
 * `TimeBankAdminPanel` React component. It assembles everything an admin panel
 * needs to RENDER (visibility/disabled state, entitlement display, wallet
 * summary with derived balances + warning level, read-only rules, cancellation
 * policy, opening-balance status, ledger rows and legacy notes) and exposes the
 * SAFETY GATES the panel must obey before offering any action.
 *
 * It is PURE and FOUNDATION ONLY:
 *   * No Supabase, no localStorage, no React, no network, no activation.
 *   * It never mutates inputs — every balance is folded from the immutable
 *     ledger via the existing logic core (`timeBank.ts`), legacy notes are kept
 *     strictly separate (they NEVER affect balance), and the action gates only
 *     DESCRIBE what is allowed; they never perform a write.
 *
 * Safety contracts surfaced here (the panel must not bypass them):
 *   - A wallet is NEVER created from the panel; actions require an existing
 *     wallet, so a denied entitlement simply yields a disabled, read-only state.
 *   - At most ONE opening balance per wallet (validateSingleOpeningBalance).
 *   - No editing/deleting of historical ledger rows — corrections go through
 *     adjustment transactions only.
 *   - Adjustments / opening balance require an `active` wallet (the frozen/closed
 *     state machine in `canRecordTransaction` is the source of truth).
 */
import type {
  TimeBankCancellationPolicy,
  TimeBankLegacyHistoryNote,
  TimeBankRules,
  TimeBankTransaction,
  TimeBankWallet,
} from "@/types";
import {
  TIME_BANK_CANCELLATION_DEDUCTION_METHOD_LABELS,
  TIME_BANK_TRANSACTION_TYPE_LABELS,
  TIME_BANK_WALLET_STATUS_LABELS,
} from "@/types";
import {
  affectsReserved,
  canRecordTransaction,
  deriveBalance,
  evaluateReservationWarning,
  orderLedger,
  transactionKind,
  type TimeBankWarningLevel,
} from "./timeBank";
import {
  findOpeningBalances,
  hasOpeningBalance,
  validateSingleOpeningBalance,
} from "./timeBankMigration";
import type { TimeBankEntitlementDecision } from "./timeBankEntitlement";

// ── Minute formatting ────────────────────────────────────────

/**
 * Formats signed integer minutes as a human "Xh Ym" string (e.g. 210 → "3h 30m",
 * -90 → "-1h 30m", 45 → "45m", 0 → "0m"). Pure; minutes are clamped to integers.
 */
export function formatMinutes(minutes: number): string {
  const rounded = Math.trunc(minutes);
  const sign = rounded < 0 ? "-" : "";
  const abs = Math.abs(rounded);
  const hours = Math.floor(abs / 60);
  const mins = abs % 60;
  if (hours === 0) return `${sign}${mins}m`;
  if (mins === 0) return `${sign}${hours}h`;
  return `${sign}${hours}h ${mins}m`;
}

/** Like {@link formatMinutes} but always prefixes a sign for non-zero values (e.g. "+3h"). */
export function formatSignedMinutes(minutes: number): string {
  const rounded = Math.trunc(minutes);
  if (rounded > 0) return `+${formatMinutes(rounded)}`;
  return formatMinutes(rounded);
}

// ── Input parsing (admin forms) ──────────────────────────────

/** Result of parsing admin hour/minute inputs into signed integer minutes. */
export interface ParsedMinutes {
  ok: boolean;
  /** Total signed integer minutes (only meaningful when `ok`). */
  minutes: number;
  error?: string;
}

/**
 * Parses an admin "hours" + "minutes" pair into total signed integer minutes.
 * Both fields are optional strings; empty is treated as 0. Rejects non-integers,
 * negatives (magnitude is always entered as a positive amount — direction/sign is
 * chosen separately), and the all-zero case. The result is a MAGNITUDE; callers
 * apply the sign for removals.
 */
export function parseHoursMinutes(hoursRaw: string, minutesRaw: string): ParsedMinutes {
  const hours = hoursRaw.trim() === "" ? 0 : Number(hoursRaw);
  const mins = minutesRaw.trim() === "" ? 0 : Number(minutesRaw);
  if (!Number.isInteger(hours) || !Number.isInteger(mins)) {
    return { ok: false, minutes: 0, error: "Enter whole numbers for hours and minutes." };
  }
  if (hours < 0 || mins < 0) {
    return { ok: false, minutes: 0, error: "Hours and minutes must be zero or positive." };
  }
  const total = hours * 60 + mins;
  if (total === 0) {
    return { ok: false, minutes: 0, error: "Enter an amount greater than zero." };
  }
  return { ok: true, minutes: total };
}

// ── Entitlement display ──────────────────────────────────────

/** Display labels for an entitlement resolution source. */
export const TIME_BANK_ENTITLEMENT_SOURCE_LABELS: Record<string, string> = {
  none: "None",
  default: "Platform default",
  global: "Platform default",
  bundle: "Bundle",
  base_plan: "Base plan",
  add_on: "Add-on",
  override: "Company override",
  grant: "Grant",
};

/** Human label for an entitlement source key (falls back to the raw key). */
export function entitlementSourceLabel(source: string): string {
  return TIME_BANK_ENTITLEMENT_SOURCE_LABELS[source] ?? source;
}

/** The panel's view of the resolved entitlement decision. */
export interface EntitlementDisplay {
  allowed: boolean;
  statusLabel: string;
  sourceLabel: string;
  globallyAvailable: boolean;
  contributingBundleIds: string[];
  denialReason: string | null;
}

/** Builds the entitlement display block (or a safe denied default when none resolved). */
export function buildEntitlementDisplay(
  decision: TimeBankEntitlementDecision | null,
): EntitlementDisplay {
  if (!decision) {
    return {
      allowed: false,
      statusLabel: "Unknown",
      sourceLabel: entitlementSourceLabel("none"),
      globallyAvailable: false,
      contributingBundleIds: [],
      denialReason: "Entitlement has not been resolved for this company.",
    };
  }
  return {
    allowed: decision.allowed,
    statusLabel: decision.status,
    sourceLabel: entitlementSourceLabel(decision.source),
    globallyAvailable: decision.globallyAvailable,
    contributingBundleIds: decision.contributingBundleIds,
    denialReason: decision.denialReason,
  };
}

// ── Wallet summary ───────────────────────────────────────────

/** Severity → label/tone mapping the panel renders for a warning badge. */
export const TIME_BANK_WARNING_LABELS: Record<TimeBankWarningLevel, string> = {
  ok: "Healthy",
  warning: "Low balance",
  critical: "Critical balance",
};

/** The panel's wallet summary block. */
export interface WalletSummaryDisplay {
  statusLabel: string;
  agreementGroupId: string;
  currentBalance: number;
  reservedBalance: number;
  availableBalance: number;
  currentLabel: string;
  reservedLabel: string;
  availableLabel: string;
  /** Low-balance warning derived from the AVAILABLE balance against the rules' thresholds. */
  warningLevel: TimeBankWarningLevel;
  warningLabel: string;
  /** True when the balance is below zero (overdraft). */
  isNegative: boolean;
  /** Opening-balance minutes if an `opening_balance` entry exists; null otherwise. */
  openingBalanceMinutes: number | null;
}

/** Assembles the wallet summary, deriving balances from the immutable ledger. */
export function buildWalletSummary(
  wallet: TimeBankWallet,
  transactions: TimeBankTransaction[],
): WalletSummaryDisplay {
  const balance = deriveBalance(transactions);
  const warningLevel = evaluateReservationWarning(wallet, balance.availableBalance);
  const openings = findOpeningBalances(transactions);
  return {
    statusLabel: TIME_BANK_WALLET_STATUS_LABELS[wallet.status],
    agreementGroupId: wallet.agreementGroupId,
    currentBalance: balance.currentBalance,
    reservedBalance: balance.reservedBalance,
    availableBalance: balance.availableBalance,
    currentLabel: formatMinutes(balance.currentBalance),
    reservedLabel: formatMinutes(balance.reservedBalance),
    availableLabel: formatMinutes(balance.availableBalance),
    warningLevel,
    warningLabel: TIME_BANK_WARNING_LABELS[warningLevel],
    isNegative: balance.currentBalance < 0,
    openingBalanceMinutes: openings.length > 0 ? openings[0].minutes : null,
  };
}

// ── Rules display ────────────────────────────────────────────

/** Read-only rules display. */
export interface RulesDisplay {
  allocationLabel: string;
  refillFrequency: string;
  carryoverPolicy: string;
  maxBalanceLabel: string | null;
  expiryLabel: string | null;
  negativeFloorLabel: string;
  warningThresholdLabel: string | null;
  criticalThresholdLabel: string | null;
}

/** Builds the read-only rules display (no editing surface — display only). */
export function buildRulesDisplay(rules: TimeBankRules): RulesDisplay {
  const thresholdLabel = (
    percent: number | null | undefined,
    absolute: number | null | undefined,
  ): string | null => {
    if (percent !== null && percent !== undefined) return `${percent}%`;
    if (absolute !== null && absolute !== undefined) return formatMinutes(absolute);
    return null;
  };
  return {
    allocationLabel: formatMinutes(rules.allocationMinutes),
    refillFrequency: rules.refillFrequency,
    carryoverPolicy: rules.carryoverPolicy,
    maxBalanceLabel:
      rules.maxBalanceMinutes !== null && rules.maxBalanceMinutes !== undefined
        ? formatMinutes(rules.maxBalanceMinutes)
        : null,
    expiryLabel:
      rules.expiryAfterDays !== null && rules.expiryAfterDays !== undefined
        ? `${rules.expiryAfterDays} days`
        : null,
    negativeFloorLabel: formatMinutes(-Math.abs(rules.negativeFloorMinutes)),
    warningThresholdLabel: thresholdLabel(
      rules.warningThresholdPercent,
      rules.warningThresholdMinutes,
    ),
    criticalThresholdLabel: thresholdLabel(
      rules.criticalThresholdPercent,
      rules.criticalThresholdMinutes,
    ),
  };
}

// ── Cancellation policy display ──────────────────────────────

/** Cancellation-credit policy display. */
export interface CancellationDisplay {
  enabled: boolean;
  methodLabel: string;
  deductionDetail: string | null;
  minCreditLabel: string | null;
}

/** Builds the cancellation-credit policy display block. */
export function buildCancellationDisplay(
  policy: TimeBankCancellationPolicy | null,
): CancellationDisplay | null {
  if (!policy) return null;
  let deductionDetail: string | null = null;
  if (policy.enabled) {
    if (policy.deductionMethod === "fixed" && policy.deductionMinutes != null) {
      deductionDetail = `${formatMinutes(policy.deductionMinutes)} per cancelled visit`;
    } else if (policy.deductionMethod === "percentage" && policy.deductionPercent != null) {
      deductionDetail = `${policy.deductionPercent}% of the visit duration`;
    }
  }
  return {
    enabled: policy.enabled,
    methodLabel: TIME_BANK_CANCELLATION_DEDUCTION_METHOD_LABELS[policy.deductionMethod],
    deductionDetail,
    minCreditLabel:
      policy.minCreditMinutes != null && policy.minCreditMinutes > 0
        ? formatMinutes(policy.minCreditMinutes)
        : null,
  };
}

// ── Ledger rows ──────────────────────────────────────────────

/** A render-ready ledger row. */
export interface LedgerRowDisplay {
  id: string;
  effectiveAt: string;
  type: TimeBankTransaction["type"];
  typeLabel: string;
  kind: string;
  minutes: number;
  minutesLabel: string;
  /** True when the entry affects the RESERVED balance rather than current. */
  reserved: boolean;
  reason: string | null;
  category: string | null;
  billable: boolean | null;
  sourceWorkOrderId: string | null;
  /** Full cancellation breakdown for admin/audit (present only on credit entries). */
  cancellation:
    | {
        originalLabel: string;
        deductionLabel: string;
        creditedLabel: string;
        methodLabel: string;
      }
    | null;
}

/** Builds chronologically-ordered, render-ready ledger rows (admin/audit view). */
export function buildLedgerRows(transactions: TimeBankTransaction[]): LedgerRowDisplay[] {
  return orderLedger(transactions).map((tx) => ({
    id: tx.id,
    effectiveAt: tx.effectiveAt,
    type: tx.type,
    typeLabel: TIME_BANK_TRANSACTION_TYPE_LABELS[tx.type],
    kind: transactionKind(tx.type),
    minutes: tx.minutes,
    minutesLabel: formatSignedMinutes(tx.minutes),
    reserved: affectsReserved(tx.type),
    reason: tx.reason ?? null,
    category: tx.serviceCategorySnapshot ?? null,
    billable: tx.billable ?? null,
    sourceWorkOrderId: tx.sourceWorkOrderId ?? null,
    cancellation: tx.cancellationCredit
      ? {
          originalLabel: formatMinutes(tx.cancellationCredit.originalVisitMinutes),
          deductionLabel: formatMinutes(tx.cancellationCredit.deductionMinutes),
          creditedLabel: formatMinutes(tx.cancellationCredit.creditedMinutes),
          methodLabel:
            TIME_BANK_CANCELLATION_DEDUCTION_METHOD_LABELS[
              tx.cancellationCredit.deductionMethod
            ],
        }
      : null,
  }));
}

// ── Action gates (describe-only — never write) ───────────────

/** Result of a panel action gate. */
export interface ActionGate {
  allowed: boolean;
  reason?: string;
}

/**
 * Whether the admin may create an opening balance: requires an existing wallet,
 * NO existing opening balance (at most one per wallet), and a wallet status that
 * accepts the entry (`canRecordTransaction`). The entitlement gate is NOT
 * consulted here because the wallet already exists — entitlement only governs
 * wallet CREATION, which the panel never performs.
 */
export function gateCreateOpeningBalance(
  wallet: TimeBankWallet | null,
  transactions: TimeBankTransaction[],
): ActionGate {
  if (!wallet) {
    return { allowed: false, reason: "No wallet exists for this agreement yet." };
  }
  const single = validateSingleOpeningBalance(transactions);
  if (!single.ok) {
    return { allowed: false, reason: single.reason };
  }
  const gate = canRecordTransaction(wallet, "opening_balance");
  if (!gate.allowed) return { allowed: false, reason: gate.reason };
  return { allowed: true };
}

/** Whether the admin may append a manual adjustment (manual_add / manual_remove). */
export function gateAddAdjustment(
  wallet: TimeBankWallet | null,
  direction: "manual_add" | "manual_remove",
): ActionGate {
  if (!wallet) {
    return { allowed: false, reason: "No wallet exists for this agreement yet." };
  }
  const gate = canRecordTransaction(wallet, direction);
  if (!gate.allowed) return { allowed: false, reason: gate.reason };
  return { allowed: true };
}

/** Whether the admin may add a legacy history note (informational — only needs a wallet). */
export function gateAddLegacyNote(wallet: TimeBankWallet | null): ActionGate {
  if (!wallet) {
    return { allowed: false, reason: "No wallet exists for this agreement yet." };
  }
  return { allowed: true };
}

// ── Panel visibility / disabled state ────────────────────────

/** Inputs to {@link buildTimeBankPanelModel}. */
export interface TimeBankPanelInput {
  /** Whether the Customer Agreement snapshot has Time Bank enabled. */
  timeBankEnabledOnAgreement: boolean;
  /** Resolved entitlement decision for the company (null when unresolved). */
  entitlement: TimeBankEntitlementDecision | null;
  /** The wallet bound to the agreement group, if one exists. */
  wallet: TimeBankWallet | null;
  /** The wallet's immutable ledger (empty when none). */
  transactions: TimeBankTransaction[];
  /** Informational legacy notes (never balance-affecting). */
  legacyNotes: TimeBankLegacyHistoryNote[];
  /** The agreement's cancellation-credit policy snapshot (null when none). */
  cancellationPolicy: TimeBankCancellationPolicy | null;
}

/** The complete render model for the admin panel. */
export interface TimeBankPanelModel {
  /** Whether the panel should render at all on the agreement page. */
  visible: boolean;
  /** When visible but Time Bank is unavailable, render a clear disabled state. */
  disabled: boolean;
  disabledReason: string | null;
  entitlement: EntitlementDisplay;
  hasWallet: boolean;
  wallet: WalletSummaryDisplay | null;
  rules: RulesDisplay | null;
  cancellation: CancellationDisplay | null;
  hasOpeningBalance: boolean;
  ledger: LedgerRowDisplay[];
  legacyNotes: TimeBankLegacyHistoryNote[];
  /** Action gates the panel obeys before offering any write control. */
  gates: {
    createOpeningBalance: ActionGate;
    addAdjustmentAdd: ActionGate;
    addAdjustmentRemove: ActionGate;
    addLegacyNote: ActionGate;
  };
}

/**
 * Decides whether the panel is RELEVANT to the agreement (LOCKED placement rule):
 * show it when the agreement has Time Bank enabled, OR the company is entitled,
 * OR a wallet already exists. Otherwise the panel is hidden entirely.
 */
export function isPanelRelevant(input: TimeBankPanelInput): boolean {
  return (
    input.timeBankEnabledOnAgreement ||
    (input.entitlement?.allowed ?? false) ||
    input.wallet !== null
  );
}

/**
 * Assembles the complete, render-ready panel model. PURE — derives balances from
 * the immutable ledger, keeps legacy notes separate from the balance, and only
 * DESCRIBES which actions are allowed (it never writes). When Time Bank is
 * irrelevant the panel is hidden; when relevant but no wallet exists AND the
 * company is not entitled, it renders a disabled, read-only state (no wallet is
 * ever created from the panel).
 */
export function buildTimeBankPanelModel(input: TimeBankPanelInput): TimeBankPanelModel {
  const entitlement = buildEntitlementDisplay(input.entitlement);
  const hasWallet = input.wallet !== null;
  const visible = isPanelRelevant(input);

  // Disabled when there is no wallet and the company is not entitled to create
  // one — the panel never provisions wallets, so there is nothing actionable.
  const disabled = !hasWallet && !entitlement.allowed;
  const disabledReason = disabled
    ? entitlement.denialReason ??
      "Time Bank is not available for this company and no wallet exists."
    : null;

  return {
    visible,
    disabled,
    disabledReason,
    entitlement,
    hasWallet,
    wallet: input.wallet ? buildWalletSummary(input.wallet, input.transactions) : null,
    rules: input.wallet ? buildRulesDisplay(input.wallet.rules) : null,
    cancellation: buildCancellationDisplay(input.cancellationPolicy),
    hasOpeningBalance: hasOpeningBalance(input.transactions),
    ledger: buildLedgerRows(input.transactions),
    legacyNotes: input.legacyNotes.slice(),
    gates: {
      createOpeningBalance: gateCreateOpeningBalance(input.wallet, input.transactions),
      addAdjustmentAdd: gateAddAdjustment(input.wallet, "manual_add"),
      addAdjustmentRemove: gateAddAdjustment(input.wallet, "manual_remove"),
      addLegacyNote: gateAddLegacyNote(input.wallet),
    },
  };
}
