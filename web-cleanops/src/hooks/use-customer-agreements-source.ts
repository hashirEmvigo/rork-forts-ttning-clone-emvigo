/**
 * useCustomerAgreementsSource — lists the Customer Agreements belonging to ONE
 * customer, for the Customer workspace "Agreements" tab.
 *
 * A read-only data seam mirroring {@link useCustomerAgreementDetailSource}: it
 * owns the list I/O so the panel stays presentation-only. It reads agreement
 * SUMMARIES (no lossless `data`, no lines) scoped to the customer's company and
 * id via the validated repository.
 *
 * SAFETY (read-only, no writes, no activation): this hook never creates,
 * mutates, or deletes agreements and never provisions wallets. When Supabase is
 * unconfigured or no customer id is provided it resolves to an empty,
 * non-error state so the panel renders a clean empty surface.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import { supabaseCustomerAgreementRepository } from "@/lib/data";
import type { CustomerAgreementSummary } from "@/lib/data";

/** The resolved list bundle for a customer's agreements. */
export interface CustomerAgreementsSourceResult {
  /** The customer's agreement summaries (newest version first). */
  agreements: CustomerAgreementSummary[];
  /** True while the initial / refresh read is in flight. */
  loading: boolean;
  /** A load error message, or null. */
  error: string | null;
  /** Re-reads the customer's agreements from the repository. */
  reload: () => void;
}

const EMPTY: CustomerAgreementSummary[] = [];

/**
 * Resolves the agreement list for one customer, scoped to the viewer.
 *
 * @param customerId  The app-facing customer id to scope agreements to.
 * @param companyScope Viewer scope for the read — `undefined`/`null` for super
 *                     admins (unscoped), else the active company id (RLS-aligned).
 */
export function useCustomerAgreementsSource(
  customerId: string | undefined,
  companyScope: string | null | undefined,
): CustomerAgreementsSourceResult {
  const enabled = isSupabaseConfigured && Boolean(customerId);

  const [agreements, setAgreements] = useState<CustomerAgreementSummary[]>(EMPTY);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const requestSeq = useRef<number>(0);
  const [reloadToken, setReloadToken] = useState<number>(0);

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  useEffect(() => {
    if (!enabled || !customerId) {
      setAgreements(EMPTY);
      setError(null);
      return;
    }

    const seq = ++requestSeq.current;
    const scope = companyScope ?? undefined;
    setLoading(true);

    void (async () => {
      const stop = perf.start("customerAgreements.customer.source.read");
      try {
        const result = await supabaseCustomerAgreementRepository.listSummaries({
          companyId: scope,
          customerId,
        });
        if (seq !== requestSeq.current) return; // superseded

        // Newest version first within a stable group ordering.
        const sorted = [...result.items].sort((a, b) => {
          if (a.agreementGroupId !== b.agreementGroupId) {
            return a.agreementGroupId < b.agreementGroupId ? -1 : 1;
          }
          return b.version - a.version;
        });

        setAgreements(sorted);
        setError(null);
      } catch (err) {
        if (seq !== requestSeq.current) return;
        setAgreements(EMPTY);
        setError(
          err instanceof Error ? err.message : "Failed to load agreements.",
        );
      } finally {
        stop();
        if (seq === requestSeq.current) setLoading(false);
      }
    })();
  }, [enabled, customerId, companyScope, reloadToken]);

  return useMemo<CustomerAgreementsSourceResult>(
    () => ({ agreements, loading, error, reload }),
    [agreements, loading, error, reload],
  );
}
