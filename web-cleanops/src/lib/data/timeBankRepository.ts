/**
 * Time Bank repository + row mappers (Phase 4 · persistence foundation).
 *
 * The first server-side surface for the Time Bank minute ledger. It mirrors the
 * proven customers (0007) / work_orders (0008) / customer_agreements (0013)
 * conventions:
 *
 *   * flat, indexed columns for list / scope / lookup, plus a lossless
 *     `data jsonb` carrying the COMPLETE domain record for detail rebuild;
 *   * `legacy_id` (app-facing wallet/transaction id, also the idempotency key)
 *     + `company_legacy_id` query scope;
 *   * idempotent upsert-on-`legacy_id`, chunked for large ledgers.
 *
 * Two append-only guarantees back the ledger model:
 *   * Wallets carry NO stored balance — balance is ALWAYS derived in the logic
 *     layer ({@link deriveBalance} / {@link deriveBalanceAsOf}) from the ledger.
 *   * Transaction writes use `ignoreDuplicates` so a re-run of the same
 *     `legacy_id` is a NO-OP (never an UPDATE) — matching the migration 0014 RLS
 *     where time_bank_transactions has SELECT + INSERT only, no UPDATE/DELETE.
 *
 * FOUNDATION ONLY — not wired to any UI; no activation, no production flip.
 */
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import type {
  TimeBankLegacyHistoryNote,
  TimeBankTransaction,
  TimeBankWallet,
} from "@/types";
import type { DetailParams } from "./types";

// ── Upsert row shapes (write path + future migration share these) ──

/** A single upsert row written to the `time_bank_wallets` table. */
export interface TimeBankWalletUpsertRow {
  legacy_id: string;
  agreement_group_id: string;
  company_id: string | null;
  company_legacy_id: string;
  customer_legacy_id: string;
  status: string;
  rules: TimeBankWallet["rules"];
  data: TimeBankWallet;
}

/** A single upsert row written to the `time_bank_transactions` table. */
export interface TimeBankTransactionUpsertRow {
  legacy_id: string;
  wallet_legacy_id: string;
  agreement_group_id: string;
  company_id: string | null;
  company_legacy_id: string;
  type: string;
  minutes: number;
  effective_at: string;
  actor_id: string | null;
  actor_name: string | null;
  reason: string | null;
  service_category_snapshot: string | null;
  billable: boolean | null;
  source_work_order_id: string | null;
  source_occurrence_id: string | null;
  source_agreement_version_id: string | null;
  data: TimeBankTransaction;
}

/**
 * A single insert row for the `time_bank_legacy_notes` table. Legacy notes are
 * INFORMATIONAL ONLY — there is deliberately NO `minutes` column: a note can
 * never affect the ledger balance.
 */
export interface TimeBankLegacyNoteInsertRow {
  legacy_id: string;
  wallet_legacy_id: string;
  agreement_group_id: string;
  company_id: string | null;
  company_legacy_id: string;
  note: string;
  imported_by: string | null;
  imported_at: string | null;
  source_system: string | null;
  data: TimeBankLegacyHistoryNote;
}

/**
 * Maps a domain {@link TimeBankLegacyHistoryNote} to a `time_bank_legacy_notes`
 * insert row. The full record is kept losslessly in `data`; flat columns drive
 * scope and audit display. No `minutes` — notes are never balance-affecting.
 */
export function toTimeBankLegacyNoteInsertRow(
  note: TimeBankLegacyHistoryNote,
  companyUuid: string | null,
): TimeBankLegacyNoteInsertRow {
  return {
    legacy_id: note.id,
    wallet_legacy_id: note.walletId,
    agreement_group_id: note.agreementGroupId,
    company_id: companyUuid,
    company_legacy_id: note.companyId,
    note: note.note,
    imported_by: note.importedBy ?? null,
    imported_at: note.importedAt ?? null,
    source_system: note.sourceSystem ?? null,
    data: note,
  };
}

/**
 * Maps a domain {@link TimeBankWallet} to a `time_bank_wallets` upsert row. Flat
 * columns mirror the indexed/queryable fields; the full record (and the policy
 * `rules`) is kept losslessly in `data` / `rules`. Note: there is deliberately
 * NO balance column — balance is derived from the ledger, never stored.
 */
export function toTimeBankWalletUpsertRow(
  wallet: TimeBankWallet,
  companyUuid: string | null,
): TimeBankWalletUpsertRow {
  return {
    legacy_id: wallet.id,
    agreement_group_id: wallet.agreementGroupId,
    company_id: companyUuid,
    company_legacy_id: wallet.companyId,
    customer_legacy_id: wallet.customerId,
    status: wallet.status,
    rules: wallet.rules,
    data: wallet,
  };
}

/**
 * Maps a domain {@link TimeBankTransaction} to a `time_bank_transactions` upsert
 * row. The full record is kept losslessly in `data`; flat columns drive ordering
 * (`effective_at`), scope and statistics.
 */
export function toTimeBankTransactionUpsertRow(
  tx: TimeBankTransaction,
  companyUuid: string | null,
): TimeBankTransactionUpsertRow {
  return {
    legacy_id: tx.id,
    wallet_legacy_id: tx.walletId,
    agreement_group_id: tx.agreementGroupId,
    company_id: companyUuid,
    company_legacy_id: tx.companyId,
    type: tx.type,
    minutes: tx.minutes,
    effective_at: tx.effectiveAt,
    actor_id: tx.actorId ?? null,
    actor_name: tx.actorName ?? null,
    reason: tx.reason ?? null,
    service_category_snapshot: tx.serviceCategorySnapshot ?? null,
    billable: tx.billable ?? null,
    source_work_order_id: tx.sourceWorkOrderId ?? null,
    source_occurrence_id: tx.sourceOccurrenceId ?? null,
    source_agreement_version_id: tx.sourceAgreementVersionId ?? null,
    data: tx,
  };
}

// ── Read DTOs + repository ────────────────────────────────

class SupabaseNotConfiguredError extends Error {
  constructor() {
    super(
      "timeBankRepository requires Supabase. Set EXPO_PUBLIC_SUPABASE_URL " +
        "and EXPO_PUBLIC_SUPABASE_ANON_KEY.",
    );
    this.name = "SupabaseNotConfiguredError";
  }
}

interface WalletDataRow {
  data: TimeBankWallet;
  company_legacy_id: string;
}

interface TransactionDataRow {
  data: TimeBankTransaction;
}

interface LegacyNoteDataRow {
  data: TimeBankLegacyHistoryNote;
}

/** Bounds payload size for large ledgers — matches the agreements write path. */
const WRITE_CHUNK = 200;

/**
 * Server (Supabase) read + persistence surface for the Time Bank. Balance is
 * NEVER read from here — callers fold the returned transactions through the
 * logic layer ({@link deriveBalance}). Foundation only: NOT wired to any UI and
 * performs no activation.
 */
export const supabaseTimeBankRepository = {
  /**
   * Upserts wallet rows on `legacy_id`, chunked. Idempotent: re-running
   * overwrites the same `legacy_id` (so a re-persist heals drift / flips status)
   * rather than duplicating. The caller guarantees ONE wallet per
   * agreementGroupId (the table also enforces it with a unique index).
   *
   * @returns the number of wallet rows written.
   */
  async upsertWallets(
    wallets: TimeBankWallet[],
    companyUuid: string | null,
  ): Promise<number> {
    if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
    if (wallets.length === 0) return 0;
    const stop = perf.start("timeBank.write.supabase.wallets");
    try {
      const rows = wallets.map((w) => toTimeBankWalletUpsertRow(w, companyUuid));
      for (let i = 0; i < rows.length; i += WRITE_CHUNK) {
        const chunk = rows.slice(i, i + WRITE_CHUNK);
        const { error } = await supabase
          .from("time_bank_wallets")
          .upsert(chunk, { onConflict: "legacy_id" });
        if (error) {
          throw new Error(
            `[time_bank_wallets] Supabase wallet upsert failed at chunk ${i / WRITE_CHUNK}: ${error.message}`,
          );
        }
      }
      return rows.length;
    } finally {
      stop();
    }
  },

  /**
   * Appends transaction rows on `legacy_id`, chunked, with `ignoreDuplicates` so
   * a re-run of the same `legacy_id` is a NO-OP insert (never an UPDATE) — the
   * ledger is append-only and immutable (migration 0014 grants SELECT+INSERT
   * only). This is what makes opening-balance / migration writes safely
   * re-runnable and prevents duplicate ledger entries.
   *
   * @returns the number of transaction rows submitted (already-present rows are
   *   silently ignored by the database).
   */
  async appendTransactions(
    transactions: TimeBankTransaction[],
    companyUuid: string | null,
  ): Promise<number> {
    if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
    if (transactions.length === 0) return 0;
    const stop = perf.start("timeBank.write.supabase.transactions");
    try {
      const rows = transactions.map((t) => toTimeBankTransactionUpsertRow(t, companyUuid));
      for (let i = 0; i < rows.length; i += WRITE_CHUNK) {
        const chunk = rows.slice(i, i + WRITE_CHUNK);
        const { error } = await supabase
          .from("time_bank_transactions")
          .upsert(chunk, { onConflict: "legacy_id", ignoreDuplicates: true });
        if (error) {
          throw new Error(
            `[time_bank_transactions] Supabase append failed at chunk ${i / WRITE_CHUNK}: ${error.message}`,
          );
        }
      }
      return rows.length;
    } finally {
      stop();
    }
  },

  /** The single wallet bound to an agreement group, or null when none exists. */
  async getWalletByAgreementGroupId(
    agreementGroupId: string,
    params: DetailParams = {},
  ): Promise<TimeBankWallet | null> {
    if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
    const { data, error } = await supabase
      .from("time_bank_wallets")
      .select("data, company_legacy_id")
      .eq("agreement_group_id", agreementGroupId)
      .maybeSingle();
    if (error) {
      throw new Error(`[time_bank_wallets] Supabase wallet read failed: ${error.message}`);
    }
    if (!data) return null;
    const row = data as unknown as WalletDataRow;
    if (params.companyId !== undefined && row.company_legacy_id !== params.companyId) {
      return null;
    }
    return row.data;
  },

  /** A single wallet by id, or null when missing / out of scope. */
  async getWalletById(
    walletId: string,
    params: DetailParams = {},
  ): Promise<TimeBankWallet | null> {
    if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
    const { data, error } = await supabase
      .from("time_bank_wallets")
      .select("data, company_legacy_id")
      .eq("legacy_id", walletId)
      .maybeSingle();
    if (error) {
      throw new Error(`[time_bank_wallets] Supabase wallet read failed: ${error.message}`);
    }
    if (!data) return null;
    const row = data as unknown as WalletDataRow;
    if (params.companyId !== undefined && row.company_legacy_id !== params.companyId) {
      return null;
    }
    return row.data;
  },

  /** All wallets for a customer (typically 0..n agreement groups). */
  async listWalletsByCustomer(
    customerId: string,
    params: DetailParams = {},
  ): Promise<TimeBankWallet[]> {
    if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
    let query = supabase
      .from("time_bank_wallets")
      .select("data, company_legacy_id")
      .eq("customer_legacy_id", customerId);
    if (params.companyId !== undefined && params.companyId !== null) {
      query = query.eq("company_legacy_id", params.companyId);
    }
    const { data, error } = await query;
    if (error) {
      throw new Error(`[time_bank_wallets] Supabase customer wallet list failed: ${error.message}`);
    }
    const rows = (data ?? []) as unknown as WalletDataRow[];
    return rows.map((r) => r.data).filter((w): w is TimeBankWallet => Boolean(w));
  },

  /** All wallets in a company scope, optionally constrained to a customer. */
  async listWalletsByCompany(companyId: string): Promise<TimeBankWallet[]> {
    if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
    const { data, error } = await supabase
      .from("time_bank_wallets")
      .select("data, company_legacy_id")
      .eq("company_legacy_id", companyId);
    if (error) {
      throw new Error(`[time_bank_wallets] Supabase company wallet list failed: ${error.message}`);
    }
    const rows = (data ?? []) as unknown as WalletDataRow[];
    return rows.map((r) => r.data).filter((w): w is TimeBankWallet => Boolean(w));
  },

  /**
   * The full append-only ledger for a wallet, ordered by `effective_at`
   * ascending. Balance is derived from this in the logic layer; this read never
   * computes a balance itself.
   */
  async listTransactions(walletId: string): Promise<TimeBankTransaction[]> {
    if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
    const { data, error } = await supabase
      .from("time_bank_transactions")
      .select("data")
      .eq("wallet_legacy_id", walletId)
      .order("effective_at", { ascending: true });
    if (error) {
      throw new Error(`[time_bank_transactions] Supabase ledger read failed: ${error.message}`);
    }
    const rows = (data ?? []) as unknown as TransactionDataRow[];
    return rows.map((r) => r.data).filter((t): t is TimeBankTransaction => Boolean(t));
  },

  /**
   * Inserts INFORMATIONAL-ONLY legacy history notes, chunked, with
   * `ignoreDuplicates` so a re-run of the same `legacy_id` is a NO-OP. These
   * rows never affect any balance — they are reference text only.
   *
   * @returns the number of note rows submitted.
   */
  async insertLegacyNotes(
    notes: TimeBankLegacyHistoryNote[],
    companyUuid: string | null,
  ): Promise<number> {
    if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
    if (notes.length === 0) return 0;
    const stop = perf.start("timeBank.write.supabase.legacyNotes");
    try {
      const rows = notes.map((n) => toTimeBankLegacyNoteInsertRow(n, companyUuid));
      for (let i = 0; i < rows.length; i += WRITE_CHUNK) {
        const chunk = rows.slice(i, i + WRITE_CHUNK);
        const { error } = await supabase
          .from("time_bank_legacy_notes")
          .upsert(chunk, { onConflict: "legacy_id", ignoreDuplicates: true });
        if (error) {
          throw new Error(
            `[time_bank_legacy_notes] Supabase note insert failed at chunk ${i / WRITE_CHUNK}: ${error.message}`,
          );
        }
      }
      return rows.length;
    } finally {
      stop();
    }
  },

  /**
   * All informational legacy history notes for a wallet, newest first. These are
   * NEVER folded into a balance — they are reference text for admin/audit views.
   */
  async listLegacyNotes(walletId: string): Promise<TimeBankLegacyHistoryNote[]> {
    if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
    const { data, error } = await supabase
      .from("time_bank_legacy_notes")
      .select("data")
      .eq("wallet_legacy_id", walletId)
      .order("created_at", { ascending: false });
    if (error) {
      throw new Error(`[time_bank_legacy_notes] Supabase note list failed: ${error.message}`);
    }
    const rows = (data ?? []) as unknown as LegacyNoteDataRow[];
    return rows.map((r) => r.data).filter((n): n is TimeBankLegacyHistoryNote => Boolean(n));
  },
};
