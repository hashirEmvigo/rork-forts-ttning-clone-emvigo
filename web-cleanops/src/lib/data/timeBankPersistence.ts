/**
 * Time Bank persistence orchestration (Phase 4 · foundation write path).
 *
 * The production WRITE path that turns the pure Time Bank LOGIC layer
 * (`timeBank.ts`) into durable Supabase rows on the migration 0014 schema. It is
 * the missing half between the immutable builders/gates and the repository
 * read/write surface (`timeBankRepository.ts`).
 *
 * Entry points:
 *   1. {@link ensureWalletForAgreement} — IDEMPOTENT wallet creation per
 *      agreementGroupId. If a wallet already exists for the group it is returned
 *      unchanged (`created: false`); otherwise a new wallet is built (bound to
 *      the STABLE agreementGroupId, never a version id) and persisted.
 *   2. {@link appendWalletTransaction} — gates the type through the wallet state
 *      machine ({@link canRecordTransaction}), builds the immutable entry, and
 *      appends it. Idempotent on the transaction id (re-append is a no-op).
 *   3. {@link recordOpeningBalance} — a safely RE-RUNNABLE opening/migration
 *      entry: a deterministic id makes a repeat call a no-op rather than a double
 *      credit.
 *   4. Read helpers — {@link readWalletBalance} / {@link readWalletBalanceAsOf} /
 *      {@link readWalletStatement} — read the persisted ledger then DERIVE the
 *      balance in the logic layer (balance is never stored).
 *
 * All writes resolve the real tenant UUID via {@link loadCompanyUuidMap} (so
 * RLS's `company_id` FK is satisfied), support `dryRun`, and write the wallet
 * (parent) before any transaction (child) so a failed wallet write never leaves
 * orphaned ledger rows.
 *
 * FOUNDATION ONLY — changes NO business behaviour and performs NO activation:
 * localStorage stays the operational source of truth; these tables are a shadow
 * copy until a future explicit cut-over. No flag, no production-authoritative
 * flip, no customer rollout, no UI, no billing/payroll wiring.
 */
import type {
  CustomerAgreement,
  TimeBankBalance,
  TimeBankLegacyAttachmentRef,
  TimeBankLegacyHistoryNote,
  TimeBankRules,
  TimeBankTransaction,
  TimeBankTransactionType,
  TimeBankWallet,
  TimeBankWalletStatus,
} from "@/types";
import {
  buildStatement,
  buildTransaction,
  buildWalletForAgreement,
  canRecordTransaction,
  deriveBalance,
  deriveBalanceAsOf,
  type StatementWindow,
  type TimeBankStatement,
} from "./timeBank";
import { supabaseTimeBankRepository } from "./timeBankRepository";
import {
  buildLegacyHistoryNote,
  openingBalanceTransactionId,
  validateLegacyHistoryNote,
  validateSingleOpeningBalance,
} from "./timeBankMigration";
import { loadCompanyUuidMap } from "./customerMigration";
import {
  planTimeBankRefill,
  type PlannedTimeBankTransaction,
  type RefillPlan,
} from "./timeBankRefill";

/** Shared write options across the persistence entry points. */
export interface TimeBankPersistOptions {
  /**
   * App-facing company id used to resolve the real tenant UUID for RLS. When
   * omitted, the wallet/transaction's own `companyId` is used.
   */
  companyId?: string | null;
  /** When true, compute the plan + report but write nothing. */
  dryRun?: boolean;
}

/**
 * Resolves the real Supabase tenant UUID for an app-facing company id. Returns
 * null when no `companies` row matches (RLS would reject the write) so callers
 * can abort cleanly with a clear reason.
 */
async function resolveCompanyUuid(companyLegacyId: string): Promise<string | null> {
  const map = await loadCompanyUuidMap();
  return map.get(companyLegacyId) ?? null;
}

// ── Wallet creation (idempotent per agreementGroupId) ────────

/** Inputs for {@link ensureWalletForAgreement}. */
export interface EnsureWalletInput extends TimeBankPersistOptions {
  /** Stable id for a NEWLY created wallet. Ignored when one already exists. */
  walletId: string;
  /** The agreement version the wallet is created from (any version works). */
  agreement: CustomerAgreement;
  /** Policy for a newly created wallet. */
  rules: TimeBankRules;
  now: string;
  status?: TimeBankWalletStatus;
}

/** Outcome of an {@link ensureWalletForAgreement} run. */
export interface EnsureWalletResult {
  ok: boolean;
  dryRun: boolean;
  /** The wallet (existing or newly built). Null only when the run failed early. */
  wallet: TimeBankWallet | null;
  /** True when a NEW wallet was created; false when an existing one was reused. */
  created: boolean;
  /** The stable binding key the wallet is bound to. */
  agreementGroupId: string;
  error?: string;
}

/**
 * IDEMPOTENT wallet creation keyed on `agreementGroupId` (LOCKED decision 1: one
 * wallet per group). If a wallet already exists for the group it is returned
 * unchanged; otherwise a new wallet is built via {@link buildWalletForAgreement}
 * (bound to the stable agreementGroupId, never a version id — decision 2) and
 * persisted. Safe to call repeatedly and across a version chain.
 */
export async function ensureWalletForAgreement(
  input: EnsureWalletInput,
): Promise<EnsureWalletResult> {
  const dryRun = input.dryRun ?? false;
  const companyLegacyId = input.companyId ?? input.agreement.companyId;
  const agreementGroupId = input.agreement.agreementGroupId;

  const result: EnsureWalletResult = {
    ok: false,
    dryRun,
    wallet: null,
    created: false,
    agreementGroupId,
  };

  const uuid = await resolveCompanyUuid(companyLegacyId);
  if (!uuid) {
    result.error = `No Supabase company found for legacy_id "${companyLegacyId}". Migrate companies first.`;
    return result;
  }

  try {
    // Idempotency: reuse the existing wallet for this group if present.
    const existing = await supabaseTimeBankRepository.getWalletByAgreementGroupId(
      agreementGroupId,
      { companyId: companyLegacyId },
    );
    if (existing) {
      result.ok = true;
      result.wallet = existing;
      result.created = false;
      return result;
    }

    const wallet = buildWalletForAgreement({
      id: input.walletId,
      agreement: input.agreement,
      rules: input.rules,
      now: input.now,
      status: input.status,
    });

    if (dryRun) {
      result.ok = true;
      result.wallet = wallet;
      result.created = true;
      return result;
    }

    await supabaseTimeBankRepository.upsertWallets([wallet], uuid);
    result.ok = true;
    result.wallet = wallet;
    result.created = true;
    return result;
  } catch (err) {
    result.error = err instanceof Error ? err.message : "Unknown wallet persistence error.";
    return result;
  }
}

// ── Transaction append (gated + idempotent) ──────────────────

/** Inputs for {@link appendWalletTransaction}. */
export interface AppendTransactionInput extends TimeBankPersistOptions {
  /** Stable, deterministic id — the idempotency key (re-append is a no-op). */
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
}

/** Outcome of an {@link appendWalletTransaction} run. */
export interface AppendTransactionResult {
  ok: boolean;
  dryRun: boolean;
  /** The built ledger entry (even on dry-run / gate rejection, for inspection). */
  transaction: TimeBankTransaction | null;
  /** True when the state-machine gate blocked the write. */
  blockedByGate: boolean;
  error?: string;
}

/**
 * Appends ONE ledger entry to a wallet:
 *   1. {@link canRecordTransaction} gates the type against the wallet status
 *      (closed → reject all; frozen → honour reservations + consumption +
 *      corrections, block new reservations/refills/adjustments).
 *   2. {@link buildTransaction} produces the immutable, sign-normalised entry.
 *   3. The repository appends it idempotently on the transaction id.
 *
 * Append-only and immutable: re-appending the same id is a no-op (never an
 * UPDATE), so a retry after a flaky network never double-credits.
 */
export async function appendWalletTransaction(
  input: AppendTransactionInput,
): Promise<AppendTransactionResult> {
  const dryRun = input.dryRun ?? false;
  const companyLegacyId = input.companyId ?? input.wallet.companyId;

  const result: AppendTransactionResult = {
    ok: false,
    dryRun,
    transaction: null,
    blockedByGate: false,
  };

  const gate = canRecordTransaction(input.wallet, input.type);
  if (!gate.allowed) {
    result.blockedByGate = true;
    result.error = gate.reason;
    return result;
  }

  let transaction: TimeBankTransaction;
  try {
    transaction = buildTransaction({
      id: input.id,
      wallet: input.wallet,
      type: input.type,
      minutes: input.minutes,
      effectiveAt: input.effectiveAt,
      now: input.now,
      actorId: input.actorId,
      actorName: input.actorName,
      reason: input.reason,
      serviceCategorySnapshot: input.serviceCategorySnapshot,
      billable: input.billable,
      sourceWorkOrderId: input.sourceWorkOrderId,
      sourceOccurrenceId: input.sourceOccurrenceId,
      sourceAgreementVersionId: input.sourceAgreementVersionId,
    });
  } catch (err) {
    // e.g. non-integer minutes rejected by normalizeMinutes.
    result.error = err instanceof Error ? err.message : "Invalid transaction.";
    return result;
  }
  result.transaction = transaction;

  const uuid = await resolveCompanyUuid(companyLegacyId);
  if (!uuid) {
    result.error = `No Supabase company found for legacy_id "${companyLegacyId}". Migrate companies first.`;
    return result;
  }

  if (dryRun) {
    result.ok = true;
    return result;
  }

  try {
    await supabaseTimeBankRepository.appendTransactions([transaction], uuid);
    result.ok = true;
    return result;
  } catch (err) {
    result.error = err instanceof Error ? err.message : "Unknown transaction append error.";
    return result;
  }
}

// ── Re-runnable opening / migration balance ──────────────────

/** Inputs for {@link recordOpeningBalance}. */
export interface OpeningBalanceInput extends TimeBankPersistOptions {
  wallet: TimeBankWallet;
  /** Signed opening minutes (e.g. carried-over balance from a legacy system). */
  minutes: number;
  effectiveAt: string;
  now: string;
  actorId?: string | null;
  actorName?: string | null;
  reason?: string | null;
  /** Optional source reference (legacy system / export id) for audit. */
  sourceReference?: string | null;
  /**
   * Deterministic id override. Defaults to `${walletId}-opening` so a repeat
   * call dedupes to the SAME row — the opening-balance entry is safely
   * re-runnable and never double-applied.
   */
  id?: string;
  /**
   * When true (default), the existing ledger is read first and the call is
   * rejected if a DIFFERENT opening balance already exists (at most ONE per
   * wallet). A re-run of the SAME deterministic id is always a safe no-op.
   */
  enforceSingle?: boolean;
}

/**
 * Records the wallet's OPENING BALANCE as a single, dedicated `opening_balance`
 * ledger entry with a DETERMINISTIC id, so re-running the migration is a
 * guaranteed no-op (idempotent) rather than a second credit. Uses the signed
 * `opening_balance` type so the value is applied as-is and statements can label
 * it distinctly.
 *
 * By default it enforces the "at most ONE opening balance per wallet" rule by
 * reading the existing ledger first; a genuinely different second opening
 * balance is rejected (use a correction/manual adjustment instead). A repeat
 * call with the SAME deterministic id remains a safe idempotent no-op insert.
 */
export async function recordOpeningBalance(
  input: OpeningBalanceInput,
): Promise<AppendTransactionResult> {
  const id = input.id ?? openingBalanceTransactionId(input.wallet.id);
  const enforceSingle = input.enforceSingle ?? true;

  if (enforceSingle) {
    const existing = await supabaseTimeBankRepository.listTransactions(input.wallet.id);
    const guard = validateSingleOpeningBalance(existing);
    const sameEntryReplay = existing.some(
      (tx) => tx.id === id && tx.type === "opening_balance",
    );
    if (!guard.ok && !sameEntryReplay) {
      return {
        ok: false,
        dryRun: input.dryRun ?? false,
        transaction: null,
        blockedByGate: false,
        error: guard.reason,
      };
    }
  }

  return appendWalletTransaction({
    id,
    wallet: input.wallet,
    type: "opening_balance",
    minutes: input.minutes,
    effectiveAt: input.effectiveAt,
    now: input.now,
    actorId: input.actorId,
    actorName: input.actorName,
    reason: input.reason ?? "Opening balance (imported)",
    sourceWorkOrderId: input.sourceReference,
    companyId: input.companyId,
    dryRun: input.dryRun,
  });
}

// ── Legacy history notes (informational only — never the ledger) ──

/** Inputs for {@link recordLegacyHistoryNote}. */
export interface LegacyHistoryNoteInput extends TimeBankPersistOptions {
  /** Stable, deterministic id — the idempotency key (re-record is a no-op). */
  id: string;
  wallet: TimeBankWallet;
  /** Free-text, multiline historical summary from the legacy system. */
  note: string;
  now: string;
  importedBy?: string | null;
  importedAt?: string | null;
  sourceSystem?: string | null;
  attachments?: TimeBankLegacyAttachmentRef[] | null;
}

/** Outcome of a {@link recordLegacyHistoryNote} run. */
export interface LegacyHistoryNoteResult {
  ok: boolean;
  dryRun: boolean;
  /** The built note (even on dry-run / validation failure, for inspection). */
  note: TimeBankLegacyHistoryNote | null;
  error?: string;
}

/**
 * Persists an INFORMATIONAL-ONLY legacy history note. This NEVER touches the
 * minute ledger and NEVER affects any balance / warning / refill / expiry /
 * carryover calculation — it is reference text stored in a SEPARATE table
 * (migration 0016). Idempotent on the note id.
 */
export async function recordLegacyHistoryNote(
  input: LegacyHistoryNoteInput,
): Promise<LegacyHistoryNoteResult> {
  const dryRun = input.dryRun ?? false;
  const companyLegacyId = input.companyId ?? input.wallet.companyId;

  const note = buildLegacyHistoryNote({
    id: input.id,
    wallet: input.wallet,
    note: input.note,
    now: input.now,
    importedBy: input.importedBy,
    importedAt: input.importedAt,
    sourceSystem: input.sourceSystem,
    attachments: input.attachments,
  });

  const validation = validateLegacyHistoryNote(note);
  if (!validation.ok) {
    return { ok: false, dryRun, note, error: validation.errors.join(" ") };
  }

  const uuid = await resolveCompanyUuid(companyLegacyId);
  if (!uuid) {
    return {
      ok: false,
      dryRun,
      note,
      error: `No Supabase company found for legacy_id "${companyLegacyId}". Migrate companies first.`,
    };
  }

  if (dryRun) return { ok: true, dryRun, note };

  try {
    await supabaseTimeBankRepository.insertLegacyNotes([note], uuid);
    return { ok: true, dryRun, note };
  } catch (err) {
    return {
      ok: false,
      dryRun,
      note,
      error: err instanceof Error ? err.message : "Unknown legacy note persistence error.",
    };
  }
}

// ── Wallet status transitions (freeze / close) ───────────────

/** Inputs for {@link setWalletStatus}. */
export interface SetWalletStatusInput extends TimeBankPersistOptions {
  wallet: TimeBankWallet;
  /** The target status. `closed` is terminal; a closed wallet can never change again. */
  status: TimeBankWalletStatus;
  now: string;
}

/** Outcome of a {@link setWalletStatus} run. */
export interface SetWalletStatusResult {
  ok: boolean;
  dryRun: boolean;
  /** The wallet with the applied status (even on dry-run, for inspection). */
  wallet: TimeBankWallet | null;
  /** True when the status transition was rejected by the state machine. */
  blockedByGate: boolean;
  error?: string;
}

/**
 * Re-persists a wallet with a new {@link TimeBankWalletStatus} (freeze / close).
 * This is the ONLY mutable field on a wallet — the ledger is always append-only
 * and is never touched here. Guards:
 *   - `closed` is TERMINAL: a closed wallet can never be re-opened or frozen.
 *   - A no-op transition (same status) is reported as a safe success.
 * The write reuses the idempotent wallet upsert (UPDATE on `legacy_id`), so a
 * retry simply re-applies the same status.
 */
export async function setWalletStatus(
  input: SetWalletStatusInput,
): Promise<SetWalletStatusResult> {
  const dryRun = input.dryRun ?? false;
  const companyLegacyId = input.companyId ?? input.wallet.companyId;
  const result: SetWalletStatusResult = {
    ok: false,
    dryRun,
    wallet: null,
    blockedByGate: false,
  };

  if (input.wallet.status === "closed") {
    result.blockedByGate = true;
    result.error = `Wallet ${input.wallet.id} is closed: its status is terminal and cannot be changed.`;
    return result;
  }

  const next: TimeBankWallet = {
    ...input.wallet,
    status: input.status,
    updatedAt: input.now,
  };
  result.wallet = next;

  // No-op: re-applying the current status is a safe success (no write needed).
  if (input.wallet.status === input.status) {
    result.ok = true;
    return result;
  }

  const uuid = await resolveCompanyUuid(companyLegacyId);
  if (!uuid) {
    result.error = `No Supabase company found for legacy_id "${companyLegacyId}". Migrate companies first.`;
    return result;
  }

  if (dryRun) {
    result.ok = true;
    return result;
  }

  try {
    await supabaseTimeBankRepository.upsertWallets([next], uuid);
    result.ok = true;
    return result;
  } catch (err) {
    result.error = err instanceof Error ? err.message : "Unknown wallet status persistence error.";
    return result;
  }
}

// ── Balance / statement reads (derive in the logic layer) ────

/**
 * Reads a wallet's persisted ledger and DERIVES its current balances. Balance is
 * never stored — this folds the ledger in the logic layer ({@link deriveBalance}).
 */
export async function readWalletBalance(
  walletId: string,
  options: { companyId?: string } = {},
): Promise<TimeBankBalance> {
  const transactions = await supabaseTimeBankRepository.listTransactions(walletId);
  void options; // company scope is enforced by RLS on the read; kept for symmetry.
  return deriveBalance(transactions);
}

/**
 * Reads a wallet's persisted ledger and DERIVES its balances AS OF an instant —
 * proving historical reproducibility from stored data.
 */
export async function readWalletBalanceAsOf(
  walletId: string,
  asOf: string,
): Promise<TimeBankBalance> {
  const transactions = await supabaseTimeBankRepository.listTransactions(walletId);
  return deriveBalanceAsOf(transactions, asOf);
}

/**
 * Reads a wallet's persisted ledger and builds a statement over an optional
 * window — the statistics/payroll-ready aggregate, computed in the logic layer.
 */
export async function readWalletStatement(
  walletId: string,
  window: StatementWindow = {},
): Promise<TimeBankStatement> {
  const transactions = await supabaseTimeBankRepository.listTransactions(walletId);
  return buildStatement(transactions, window);
}

// ── Refill orchestration (plan reads; execute writes) ────────

/** Inputs for {@link planWalletRefill}. */
export interface PlanWalletRefillInput {
  wallet: TimeBankWallet;
  /** The date to plan a refill for (any instant inside the target period). */
  periodDate: string;
  actorId?: string | null;
  actorName?: string | null;
}

/**
 * READ-ONLY orchestration: loads the wallet's persisted ledger and asks the
 * Refill Engine for a plan. Writes NOTHING — planning and execution are kept
 * separate so a caller can inspect/approve a plan before any append.
 */
export async function planWalletRefill(input: PlanWalletRefillInput): Promise<RefillPlan> {
  const transactions = await supabaseTimeBankRepository.listTransactions(input.wallet.id);
  return planTimeBankRefill({
    wallet: input.wallet,
    transactions,
    periodDate: input.periodDate,
    actorId: input.actorId,
    actorName: input.actorName,
  });
}

/** Inputs for {@link executeRefillPlan}. */
export interface ExecuteRefillPlanInput extends TimeBankPersistOptions {
  wallet: TimeBankWallet;
  /** A plan produced by the Refill Engine (e.g. via {@link planWalletRefill}). */
  plan: RefillPlan;
  now: string;
  actorId?: string | null;
  actorName?: string | null;
}

/** Outcome of an {@link executeRefillPlan} run. */
export interface ExecuteRefillPlanResult {
  ok: boolean;
  dryRun: boolean;
  /** Per planned-entry append results, in plan order. */
  appended: AppendTransactionResult[];
  /** True when the plan had nothing to write (not due / disabled / already refilled). */
  noop: boolean;
  error?: string;
}

/**
 * WRITE orchestration: appends a plan's entries in order (carryover/expiry then
 * refill), each gated + idempotent via {@link appendWalletTransaction}. Because
 * every planned entry carries a DETERMINISTIC id, re-running a plan for the same
 * period is a guaranteed no-op (never a double credit). A not-due plan writes
 * nothing and reports `noop`.
 */
export async function executeRefillPlan(
  input: ExecuteRefillPlanInput,
): Promise<ExecuteRefillPlanResult> {
  const dryRun = input.dryRun ?? false;
  const result: ExecuteRefillPlanResult = { ok: true, dryRun, appended: [], noop: true };

  if (!input.plan.due || input.plan.plannedTransactions.length === 0) {
    return result;
  }
  result.noop = false;

  for (const planned of input.plan.plannedTransactions) {
    const appendResult = await appendPlannedTransaction(input, planned);
    result.appended.push(appendResult);
    if (!appendResult.ok) {
      result.ok = false;
      result.error = appendResult.error;
      break; // stop on first failure; appended entries are idempotent on retry.
    }
  }

  return result;
}

/** Appends a single planned entry, preserving its already-signed minutes. */
async function appendPlannedTransaction(
  input: ExecuteRefillPlanInput,
  planned: PlannedTimeBankTransaction,
): Promise<AppendTransactionResult> {
  return appendWalletTransaction({
    id: planned.id,
    wallet: input.wallet,
    type: planned.type,
    // Planned minutes are already in the ledger sign convention; normalizeMinutes
    // re-applies the sign for the type (refill +, expiry −) so this is stable.
    minutes: planned.minutes,
    effectiveAt: planned.effectiveAt,
    now: input.now,
    actorId: input.actorId,
    actorName: input.actorName,
    reason: planned.reason,
    companyId: input.companyId,
    dryRun: input.dryRun,
  });
}
