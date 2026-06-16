/**
 * useCustomerAgreementDetailSource — loads ONE Customer Agreement (with its
 * lines and version-chain metadata) from the validated Supabase repository.
 *
 * The single data seam for the Customer Agreement detail page (Phase 14 · first
 * host page). It owns the read I/O so the page stays presentation-only:
 *
 *   * the requested agreement VERSION (by id, scope-guarded),
 *   * its ordered commercial LINES,
 *   * the full version CHAIN for the group (oldest → newest), used for the
 *     version-info section and to surface the stable `agreementGroupId`.
 *
 * SAFETY (foundation only — no UI activation, no writes): this hook is strictly
 * read-only. It never creates agreements, never provisions wallets, and never
 * mutates anything. When Supabase is unconfigured or the id is missing it
 * resolves to an empty, non-error state so the page can render a clean
 * "not found" surface.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import { supabaseCustomerAgreementRepository } from "@/lib/data";
import type { CustomerAgreement, CustomerAgreementLine } from "@/types";

/** The resolved detail bundle for one Customer Agreement version. */
export interface CustomerAgreementDetailSourceResult {
  /** The requested agreement version, or null when not found / out of scope. */
  agreement: CustomerAgreement | null;
  /** The agreement's ordered commercial lines (empty when none / not found). */
  lines: CustomerAgreementLine[];
  /** The full version chain (oldest → newest) for the agreement group. */
  versionChain: CustomerAgreement[];
  /** True while the initial / refresh read is in flight. */
  loading: boolean;
  /** A load error message, or null. */
  error: string | null;
  /** Re-reads the agreement, lines and version chain from the repository. */
  reload: () => void;
}

const EMPTY_LINES: CustomerAgreementLine[] = [];
const EMPTY_CHAIN: CustomerAgreement[] = [];

/**
 * Resolves the detail for one Customer Agreement version.
 *
 * @param agreementId  The agreement VERSION id from the route.
 * @param companyScope Viewer scope for the read — `undefined`/`null` for super
 *                     admins (unscoped), else the active company id (RLS-aligned).
 */
export function useCustomerAgreementDetailSource(
  agreementId: string | undefined,
  companyScope: string | null | undefined,
): CustomerAgreementDetailSourceResult {
  const enabled = isSupabaseConfigured && Boolean(agreementId);

  const [agreement, setAgreement] = useState<CustomerAgreement | null>(null);
  const [lines, setLines] = useState<CustomerAgreementLine[]>(EMPTY_LINES);
  const [versionChain, setVersionChain] = useState<CustomerAgreement[]>(EMPTY_CHAIN);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Guards stale async reads + bumps to trigger an explicit reload.
  const requestSeq = useRef<number>(0);
  const [reloadToken, setReloadToken] = useState<number>(0);

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  useEffect(() => {
    if (!enabled || !agreementId) {
      setAgreement(null);
      setLines(EMPTY_LINES);
      setVersionChain(EMPTY_CHAIN);
      setError(null);
      return;
    }

    const seq = ++requestSeq.current;
    const scope = companyScope ?? undefined;
    setLoading(true);

    void (async () => {
      const stop = perf.start("customerAgreement.detail.source.read");
      try {
        const loaded = await supabaseCustomerAgreementRepository.getDetail(agreementId, {
          companyId: scope,
        });
        if (seq !== requestSeq.current) return; // superseded

        if (!loaded) {
          setAgreement(null);
          setLines(EMPTY_LINES);
          setVersionChain(EMPTY_CHAIN);
          setError(null);
          return;
        }

        const [agreementLines, chain] = await Promise.all([
          supabaseCustomerAgreementRepository.listLines(loaded.id),
          supabaseCustomerAgreementRepository.listVersionChain(loaded.agreementGroupId, {
            companyId: scope,
          }),
        ]);
        if (seq !== requestSeq.current) return;

        setAgreement(loaded);
        setLines(agreementLines);
        setVersionChain(chain);
        setError(null);
      } catch (err) {
        if (seq !== requestSeq.current) return;
        setAgreement(null);
        setLines(EMPTY_LINES);
        setVersionChain(EMPTY_CHAIN);
        setError(
          err instanceof Error ? err.message : "Failed to load the agreement.",
        );
      } finally {
        stop();
        if (seq === requestSeq.current) setLoading(false);
      }
    })();
  }, [enabled, agreementId, companyScope, reloadToken]);

  return useMemo<CustomerAgreementDetailSourceResult>(
    () => ({ agreement, lines, versionChain, loading, error, reload }),
    [agreement, lines, versionChain, loading, error, reload],
  );
}
