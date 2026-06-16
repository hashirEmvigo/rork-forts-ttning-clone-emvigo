/**
 * useTimeBankPanel — container hook for the Time Bank admin panel (Phase 13 ·
 * persistence wiring).
 *
 * This is the single seam between the PRESENTATIONAL {@link TimeBankAdminPanel}
 * and the real Supabase persistence layer. It owns ALL data loading and the safe
 * write actions so the component stays presentation-only (no query logic, no
 * Supabase imports inside the view).
 *
 * Responsibilities:
 *   * LOAD the wallet (by agreementGroupId), its immutable ledger and the
 *     informational legacy notes from the validated repository.
 *   * ASSEMBLE the {@link TimeBankPanelInput} the pure view-model consumes —
 *     balances/warnings/opening-balance state are derived downstream from the
 *     ledger, never stored.
 *   * EXPOSE the small set of safe write actions (opening balance, legacy note,
 *     manual adjustment, freeze/close), each routed through the existing
 *     persistence functions and followed by a refresh.
 *
 * SAFETY (foundation only — no customer portal, no scheduler, no billing):
 *   * The hook NEVER creates a wallet — wallet provisioning is entitlement-gated
 *     elsewhere. When no wallet exists every action is a guarded no-op.
 *   * Opening balance is single-occurrence and re-runnable (deterministic id);
 *     the ledger is append-only — no edit/delete path exists here.
 *   * All write/validation/load failures surface as errors — never silent.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { isSupabaseConfigured } from "@/lib/supabase";
import { makeId } from "@/lib/store";
import {
  appendWalletTransaction,
  recordLegacyHistoryNote,
  recordOpeningBalance,
  setWalletStatus,
  supabaseTimeBankRepository,
} from "@/lib/data";
import type { TimeBankEntitlementDecision } from "@/lib/data";
import type { TimeBankPanelInput } from "@/lib/data/timeBankPanelModel";
import type { TimeBankAdminPanelHandlers } from "@/components/customer/TimeBankAdminPanel";
import type {
  TimeBankCancellationPolicy,
  TimeBankLegacyHistoryNote,
  TimeBankTransaction,
  TimeBankWallet,
  TimeBankWalletStatus,
} from "@/types";

/** Audit actor recorded on writes (the signed-in admin). */
export interface TimeBankPanelActor {
  id?: string | null;
  name?: string | null;
}

/** Inputs to {@link useTimeBankPanel}. */
export interface UseTimeBankPanelArgs {
  /** Stable binding key the wallet is bound to (from the Customer Agreement). */
  agreementGroupId: string | undefined;
  /** App-facing company id used to resolve the tenant UUID for RLS-scoped writes. */
  companyId: string | null | undefined;
  /** Whether the agreement snapshot has Time Bank enabled. */
  timeBankEnabledOnAgreement: boolean;
  /** Resolved entitlement decision for the company (null when unresolved). */
  entitlement: TimeBankEntitlementDecision | null;
  /** The agreement's cancellation-credit policy snapshot (null when none). */
  cancellationPolicy: TimeBankCancellationPolicy | null;
  /** Audit actor recorded on every write. */
  actor?: TimeBankPanelActor;
  /** Clock injection point for deterministic tests. Defaults to `Date.now`. */
  now?: () => string;
}

/** The hook's return contract. */
export interface UseTimeBankPanelResult {
  /** The fully-assembled input for {@link TimeBankAdminPanel} / the view-model. */
  input: TimeBankPanelInput;
  /** True while the initial / refresh load is in flight. */
  loading: boolean;
  /** A load-path error (wallet / ledger / notes read), or null. */
  loadError: string | null;
  /** The most recent action error (save / validation), or null. */
  actionError: string | null;
  /** True while a write action is in flight. */
  pending: boolean;
  /** Re-reads the wallet, ledger and notes from the repository. */
  reload: () => void;
  /** Safe write handlers to spread onto {@link TimeBankAdminPanel}. */
  handlers: TimeBankAdminPanelHandlers;
}

const EMPTY_TRANSACTIONS: TimeBankTransaction[] = [];
const EMPTY_NOTES: TimeBankLegacyHistoryNote[] = [];

/**
 * Loads and wires the Time Bank admin panel against the real repository. UI stays
 * presentation-only: pass `result.input` and spread `result.handlers` onto
 * {@link TimeBankAdminPanel}.
 */
export function useTimeBankPanel(args: UseTimeBankPanelArgs): UseTimeBankPanelResult {
  const {
    agreementGroupId,
    companyId,
    timeBankEnabledOnAgreement,
    entitlement,
    cancellationPolicy,
    actor,
    now,
  } = args;

  const clock = useMemo(() => now ?? (() => new Date().toISOString()), [now]);
  const enabled = isSupabaseConfigured && Boolean(agreementGroupId);

  const [wallet, setWallet] = useState<TimeBankWallet | null>(null);
  const [transactions, setTransactions] = useState<TimeBankTransaction[]>(EMPTY_TRANSACTIONS);
  const [legacyNotes, setLegacyNotes] = useState<TimeBankLegacyHistoryNote[]>(EMPTY_NOTES);
  const [loading, setLoading] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState<boolean>(false);

  // Guards stale async loads + bumps to trigger an explicit reload.
  const requestSeq = useRef<number>(0);
  const [reloadToken, setReloadToken] = useState<number>(0);

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  useEffect(() => {
    if (!enabled || !agreementGroupId) {
      setWallet(null);
      setTransactions(EMPTY_TRANSACTIONS);
      setLegacyNotes(EMPTY_NOTES);
      setLoadError(null);
      return;
    }

    const seq = ++requestSeq.current;
    const scope = companyId ?? undefined;
    setLoading(true);

    void (async () => {
      try {
        const loadedWallet = await supabaseTimeBankRepository.getWalletByAgreementGroupId(
          agreementGroupId,
          { companyId: scope },
        );
        if (seq !== requestSeq.current) return; // superseded

        if (!loadedWallet) {
          setWallet(null);
          setTransactions(EMPTY_TRANSACTIONS);
          setLegacyNotes(EMPTY_NOTES);
          setLoadError(null);
          return;
        }

        const [txs, notes] = await Promise.all([
          supabaseTimeBankRepository.listTransactions(loadedWallet.id),
          supabaseTimeBankRepository.listLegacyNotes(loadedWallet.id),
        ]);
        if (seq !== requestSeq.current) return;

        setWallet(loadedWallet);
        setTransactions(txs);
        setLegacyNotes(notes);
        setLoadError(null);
      } catch (err) {
        if (seq !== requestSeq.current) return;
        setWallet(null);
        setTransactions(EMPTY_TRANSACTIONS);
        setLegacyNotes(EMPTY_NOTES);
        setLoadError(
          err instanceof Error ? err.message : "Failed to load Time Bank data.",
        );
      } finally {
        if (seq === requestSeq.current) setLoading(false);
      }
    })();
  }, [enabled, agreementGroupId, companyId, reloadToken]);

  // ── Safe write actions (each refreshes on success, surfaces errors) ──

  const runAction = useCallback(
    async (run: () => Promise<{ ok: boolean; error?: string }>) => {
      if (!wallet) {
        setActionError("No wallet exists for this agreement yet.");
        return;
      }
      setPending(true);
      setActionError(null);
      try {
        const res = await run();
        if (!res.ok) {
          setActionError(res.error ?? "The action could not be completed.");
          return;
        }
        reload();
      } catch (err) {
        setActionError(
          err instanceof Error ? err.message : "The action could not be completed.",
        );
      } finally {
        setPending(false);
      }
    },
    [wallet, reload],
  );

  const onCreateOpeningBalance = useCallback<
    NonNullable<TimeBankAdminPanelHandlers["onCreateOpeningBalance"]>
  >(
    ({ minutes, note, sourceReference }) => {
      const ts = clock();
      void runAction(() =>
        recordOpeningBalance({
          wallet: wallet as TimeBankWallet,
          minutes,
          effectiveAt: ts,
          now: ts,
          reason: note,
          sourceReference,
          actorId: actor?.id ?? null,
          actorName: actor?.name ?? null,
          companyId: companyId ?? undefined,
        }),
      );
    },
    [runAction, wallet, clock, actor, companyId],
  );

  const onAddAdjustment = useCallback<
    NonNullable<TimeBankAdminPanelHandlers["onAddAdjustment"]>
  >(
    ({ direction, minutes, reason }) => {
      const ts = clock();
      void runAction(() =>
        appendWalletTransaction({
          id: makeId("tbadj"),
          wallet: wallet as TimeBankWallet,
          type: direction,
          minutes,
          effectiveAt: ts,
          now: ts,
          reason,
          actorId: actor?.id ?? null,
          actorName: actor?.name ?? null,
          companyId: companyId ?? undefined,
        }),
      );
    },
    [runAction, wallet, clock, actor, companyId],
  );

  const onAddLegacyNote = useCallback<
    NonNullable<TimeBankAdminPanelHandlers["onAddLegacyNote"]>
  >(
    ({ note, sourceSystem }) => {
      const ts = clock();
      void runAction(() =>
        recordLegacyHistoryNote({
          id: makeId("tbnote"),
          wallet: wallet as TimeBankWallet,
          note,
          now: ts,
          sourceSystem,
          importedBy: actor?.id ?? null,
          companyId: companyId ?? undefined,
        }),
      );
    },
    [runAction, wallet, clock, actor, companyId],
  );

  const onSetWalletStatus = useCallback<
    NonNullable<TimeBankAdminPanelHandlers["onSetWalletStatus"]>
  >(
    (status: TimeBankWalletStatus) => {
      const ts = clock();
      void runAction(() =>
        setWalletStatus({
          wallet: wallet as TimeBankWallet,
          status,
          now: ts,
          companyId: companyId ?? undefined,
        }),
      );
    },
    [runAction, wallet, clock, companyId],
  );

  const input = useMemo<TimeBankPanelInput>(
    () => ({
      timeBankEnabledOnAgreement,
      entitlement,
      wallet,
      transactions,
      legacyNotes,
      cancellationPolicy,
    }),
    [
      timeBankEnabledOnAgreement,
      entitlement,
      wallet,
      transactions,
      legacyNotes,
      cancellationPolicy,
    ],
  );

  const handlers = useMemo<TimeBankAdminPanelHandlers>(
    () => ({
      onCreateOpeningBalance,
      onAddAdjustment,
      onAddLegacyNote,
      onSetWalletStatus,
    }),
    [onCreateOpeningBalance, onAddAdjustment, onAddLegacyNote, onSetWalletStatus],
  );

  return { input, loading, loadError, actionError, pending, reload, handlers };
}
