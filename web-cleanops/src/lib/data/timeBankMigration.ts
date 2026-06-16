/**
 * Time Bank — Opening Balance & Legacy History Foundation (Phase 11 · pure logic).
 *
 * Migration/onboarding support for customers moving INTO CleanOps from a legacy
 * system. It cleanly SEPARATES two very different concepts that must never be
 * confused:
 *
 *   1. OPENING BALANCE — the explicit starting balance imported into CleanOps.
 *      This IS a real, append-only `opening_balance` ledger entry: it affects the
 *      wallet balance exactly like any other transaction, is immutable, fully
 *      auditable, and (by policy) exists AT MOST ONCE per wallet. It is built
 *      with a deterministic id so a re-run of the migration is a no-op.
 *
 *   2. LEGACY HISTORY NOTES — INFORMATIONAL-ONLY text carried over from the old
 *      system ("Customer previously accumulated 8 hours", "3 hours used in March
 *      2025"). These are a SEPARATE type ({@link TimeBankLegacyHistoryNote}) and
 *      are NOT ledger entries: they can never influence balance, statements,
 *      warnings, refill, expiry or carryover. Only ledger transactions move the
 *      balance.
 *
 * This module is PURE and FOUNDATION ONLY:
 *   * No Supabase writes, no UI, no flag, no activation, no real data import.
 *   * Every builder returns a NEW object and never mutates its inputs.
 *   * The opening-balance entry is built on top of the immutable ledger core
 *     (`buildTransaction`), so historical balances remain reproducible.
 *
 * Honours the LOCKED Time Bank decisions: signed integer minutes only (4), no
 * direct balance editing — every change is a transaction (5), and the wallet
 * binds to agreementGroupId (2).
 */
import type {
  TimeBankLegacyAttachmentRef,
  TimeBankLegacyHistoryNote,
  TimeBankTransaction,
  TimeBankWallet,
} from "@/types";
import { buildTransaction } from "./timeBank";

// ── Opening balance (a real, single, append-only ledger entry) ──

/** Deterministic id for a wallet's single opening-balance entry (idempotency key). */
export function openingBalanceTransactionId(walletId: string): string {
  return `${walletId}-opening`;
}

/** Inputs for {@link buildOpeningBalanceTransaction}. */
export interface BuildOpeningBalanceInput {
  wallet: TimeBankWallet;
  /**
   * Signed opening minutes carried from the legacy system (e.g. +420 for 7h, or
   * a negative value if the customer started in deficit). Must be an integer.
   */
  minutes: number;
  effectiveAt: string;
  now: string;
  /** Audit: who performed the import. */
  importedBy?: string | null;
  importedByName?: string | null;
  /** Optional note (e.g. "Carried from legacy system X"). */
  note?: string | null;
  /** Optional source reference (e.g. legacy system / export id). */
  sourceReference?: string | null;
  /** Deterministic id override; defaults to {@link openingBalanceTransactionId}. */
  id?: string;
}

/**
 * Builds the wallet's single `opening_balance` ledger entry. Signed-as-is
 * (decision 4), immutable, with a DETERMINISTIC id so a repeated import dedupes
 * to the same row instead of double-crediting. Pure; does NOT enforce the wallet
 * status gate (call {@link canRecordTransaction} first) and does NOT enforce
 * single-occurrence (call {@link validateSingleOpeningBalance} against the
 * existing ledger first). The `sourceReference` is recorded on the audit
 * `sourceWorkOrderId` field for traceability without adding a column.
 */
export function buildOpeningBalanceTransaction(
  input: BuildOpeningBalanceInput,
): TimeBankTransaction {
  return buildTransaction({
    id: input.id ?? openingBalanceTransactionId(input.wallet.id),
    wallet: input.wallet,
    type: "opening_balance",
    minutes: input.minutes,
    effectiveAt: input.effectiveAt,
    now: input.now,
    actorId: input.importedBy ?? null,
    actorName: input.importedByName ?? null,
    reason: input.note ?? "Opening balance (imported)",
    sourceWorkOrderId: input.sourceReference ?? null,
  });
}

/** All `opening_balance` entries in a ledger (normally 0 or 1). */
export function findOpeningBalances(
  transactions: TimeBankTransaction[],
): TimeBankTransaction[] {
  return transactions.filter((tx) => tx.type === "opening_balance");
}

/** True when the wallet's ledger already contains an opening-balance entry. */
export function hasOpeningBalance(transactions: TimeBankTransaction[]): boolean {
  return transactions.some((tx) => tx.type === "opening_balance");
}

/** Result of {@link validateSingleOpeningBalance}. */
export interface SingleOpeningBalanceResult {
  ok: boolean;
  /** Number of opening-balance entries currently in the ledger. */
  existingCount: number;
  reason?: string;
}

/**
 * Enforces the "at most ONE opening balance per wallet" rule. Given the EXISTING
 * ledger, decides whether a NEW opening-balance entry may be appended.
 *
 *  - 0 existing → ok (the first import is allowed).
 *  - ≥1 existing → rejected: a second opening balance is never allowed; a true
 *    correction must be made through a normal `correction`/`manual_*` adjustment
 *    so the audit trail records WHY the starting figure changed.
 */
export function validateSingleOpeningBalance(
  existing: TimeBankTransaction[],
): SingleOpeningBalanceResult {
  const existingCount = findOpeningBalances(existing).length;
  if (existingCount === 0) return { ok: true, existingCount };
  return {
    ok: false,
    existingCount,
    reason:
      "An opening balance already exists for this wallet. Use a correction/manual adjustment to change the starting figure — never a second opening balance.",
  };
}

// ── Legacy history notes (informational only — NEVER ledger) ──

/** Inputs for {@link buildLegacyHistoryNote}. */
export interface BuildLegacyHistoryNoteInput {
  id: string;
  wallet: TimeBankWallet;
  /** Free-text, multiline historical summary pasted/imported from the legacy system. */
  note: string;
  now: string;
  importedBy?: string | null;
  importedAt?: string | null;
  sourceSystem?: string | null;
  attachments?: TimeBankLegacyAttachmentRef[] | null;
}

/**
 * Builds an INFORMATIONAL-ONLY legacy history note bound to the wallet's stable
 * agreementGroupId. This is deliberately a {@link TimeBankLegacyHistoryNote},
 * NOT a {@link TimeBankTransaction}: the type system guarantees it can never be
 * folded into a balance, statement, warning, refill or expiry calculation. Pure;
 * trims the note text and never mutates inputs.
 */
export function buildLegacyHistoryNote(
  input: BuildLegacyHistoryNoteInput,
): TimeBankLegacyHistoryNote {
  return {
    id: input.id,
    walletId: input.wallet.id,
    agreementGroupId: input.wallet.agreementGroupId,
    companyId: input.wallet.companyId,
    note: input.note.trim(),
    importedBy: input.importedBy ?? null,
    importedAt: input.importedAt ?? input.now,
    sourceSystem: input.sourceSystem ?? null,
    attachments: input.attachments ?? null,
    createdAt: input.now,
  };
}

/** Result of {@link validateLegacyHistoryNote}. */
export interface LegacyHistoryNoteValidation {
  ok: boolean;
  errors: string[];
}

/**
 * Validates a legacy history note. The only hard requirement is non-empty text;
 * everything else (importedBy / importedAt / sourceSystem / attachments) is
 * optional audit metadata. Notes never participate in calculations, so there are
 * no numeric/balance rules to enforce.
 */
export function validateLegacyHistoryNote(
  note: TimeBankLegacyHistoryNote,
): LegacyHistoryNoteValidation {
  const errors: string[] = [];
  if (note.note.trim().length === 0) {
    errors.push("A legacy history note must contain non-empty text.");
  }
  if (note.agreementGroupId.length === 0) {
    errors.push("A legacy history note must bind to an agreementGroupId.");
  }
  return { ok: errors.length === 0, errors };
}

// ── Reporting split: ledger history vs informational history ──

/**
 * The audit/admin view of a wallet's complete history: the immutable ledger
 * entries AND the informational legacy notes, kept clearly distinct. The two
 * lists never mix — `ledger` drives balances; `legacyNotes` are reference text.
 */
export interface TimeBankHistoryView {
  ledger: TimeBankTransaction[];
  legacyNotes: TimeBankLegacyHistoryNote[];
}

/**
 * Admin/audit history: returns BOTH the ledger and the informational legacy
 * notes so an admin view can render a "Legacy History" section that is visually
 * separate from the ledger. Pure — does not mutate inputs.
 */
export function buildAdminHistoryView(
  transactions: TimeBankTransaction[],
  legacyNotes: TimeBankLegacyHistoryNote[],
): TimeBankHistoryView {
  return { ledger: transactions.slice(), legacyNotes: legacyNotes.slice() };
}

/**
 * Customer-facing history: ONLY the ledger entries (which include the Opening
 * Balance). Raw legacy notes are intentionally EXCLUDED unless explicitly
 * requested via `includeLegacyNotes`. Notes are never balance-affecting, so this
 * is purely a display choice. Pure — does not mutate inputs.
 */
export function buildCustomerHistoryView(
  transactions: TimeBankTransaction[],
  legacyNotes: TimeBankLegacyHistoryNote[] = [],
  options: { includeLegacyNotes?: boolean } = {},
): TimeBankHistoryView {
  return {
    ledger: transactions.slice(),
    legacyNotes: options.includeLegacyNotes ? legacyNotes.slice() : [],
  };
}
