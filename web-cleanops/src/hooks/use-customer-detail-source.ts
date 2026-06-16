import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import type { Customer } from "@/types";
import { isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import {
  getCustomerDirectoryRefreshVersion,
  subscribeCustomerDirectoryRefresh,
} from "@/lib/data/customerDirectoryRefresh";
import {
  supabaseCustomerRepository,
  shadowReadCustomerDetail,
  shouldReadDetailFromSupabase,
  isCustomerSupabaseAuthoritative,
  recordCutoverRead,
  recordCutoverFailure,
} from "@/lib/data";
import type { CustomerDetailShadowReport } from "@/lib/data";

/** Where the resolved customer detail is currently being read from. */
export type CustomerDetailSource = "local" | "supabase";

export interface CustomerDetailSourceResult {
  /** The customer record the Customer Card should render. */
  customer: Customer | undefined;
  /** The source actually backing `customer` right now. */
  source: CustomerDetailSource;
  /** True while the Supabase detail read is in flight (only when the flag is on). */
  loading: boolean;
  /** A non-fatal error message if the Supabase read failed (we fell back). */
  error: string | null;
  /** Latest background detail shadow-read result, when the flag is on. */
  shadow: CustomerDetailShadowReport | null;
}

/**
 * Resolves the source of the Customer Card DETAIL (P4G · Wave 1C).
 *
 * Default (flag OFF): returns the caller-provided localStorage customer
 * unchanged — zero behaviour change, fully synchronous.
 *
 * Flag ON ({@link CUSTOMERS_DETAIL_SUPABASE_READ}): reads the customer detail
 * from Supabase via the validated {@link CustomerRepository} seam and returns
 * that instead. Missing rows, empty results, and read failures no longer fall
 * back to browser-persistent local data. A background detail shadow read keeps
 * comparing both sources field-by-field and surfaces any drift.
 *
 * This hook ONLY moves the detail read. Writes (create / update / archive) and
 * the Customers list flag are independent and stay on their current paths.
 * Rollback is instant: flip the flag OFF.
 *
 * @param localCustomer The localStorage record (resolved from AppContext).
 * @param customerId    The customer id from the route.
 * @param companyScope  Viewer scope for the Supabase read — `undefined` for
 *                       super admins (unscoped), else the active company id.
 */
export function useCustomerDetailSource(
  localCustomer: Customer | undefined,
  customerId: string | undefined,
  companyScope: string | null | undefined,
): CustomerDetailSourceResult {
  // Wave 1F: authoritative mode implies the detail read path even when the
  // dedicated detail-read flag is off. shouldReadDetailFromSupabase() folds both.
  const enabled = shouldReadDetailFromSupabase() && isSupabaseConfigured;

  const [remote, setRemote] = useState<Customer | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [hasResolved, setHasResolved] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [shadow, setShadow] = useState<CustomerDetailShadowReport | null>(null);

  // Supabase-authoritative CustomerDialog writes bump this after the server write
  // confirms, forcing a fresh detail read without relying on browser storage.
  const directoryRefreshVersion = useSyncExternalStore(
    subscribeCustomerDirectoryRefresh,
    getCustomerDirectoryRefreshVersion,
    getCustomerDirectoryRefreshVersion,
  );

  // Guards stale async results from overwriting a newer fetch.
  const requestSeq = useRef<number>(0);

  useEffect(() => {
    if (!enabled || !customerId) {
      setRemote(null);
      setHasResolved(false);
      setError(null);
      setShadow(null);
      return;
    }

    const seq = ++requestSeq.current;
    const scope = companyScope ?? undefined;
    setHasResolved(false);
    setLoading(true);

    void (async () => {
      const stop = perf.start("customers.detail.supabase.read");
      try {
        const row = await supabaseCustomerRepository.getDetail(customerId, {
          companyId: scope,
        });
        if (seq !== requestSeq.current) return; // superseded
        // Missing row is authoritative absence; never fall back to localStorage.
        setRemote(row ?? null);
        setHasResolved(true);
        setError(null);
        // Wave 1F: count a Supabase-primary detail read under authoritative mode.
        if (row) recordCutoverRead("read.detail");
      } catch (err) {
        if (seq !== requestSeq.current) return;
        setRemote(null);
        setHasResolved(true);
        const message =
          err instanceof Error ? err.message : "Supabase customer detail read failed.";
        setError(message);
        // Wave 1F: under authoritative mode this is a fallback to the backout
        // copy — record it (never silent) before the card falls back.
        if (isCustomerSupabaseAuthoritative()) {
          recordCutoverFailure("read.detail", customerId, message);
        }
      } finally {
        stop();
        if (seq === requestSeq.current) setLoading(false);
      }

      // Background parity check — surfaces field drift, never blocks the UI.
      try {
        const report = await shadowReadCustomerDetail(customerId, companyScope ?? null);
        if (seq !== requestSeq.current) return;
        setShadow(report);
        if (!report.ok && import.meta.env.DEV === true) {
          // eslint-disable-next-line no-console
          console.warn("[Wave1C] Customer detail shadow-read drift:", report.notes.join(", "));
        }
      } catch {
        // Shadow read is advisory only; ignore its failures.
      }
    })();
    // Re-runs on id / company switch and explicit server-confirmed refresh
    // signals. Browser-persistent local data is not a source signal for
    // Supabase-authoritative detail reads.
  }, [enabled, customerId, companyScope, directoryRefreshVersion]);

  return useMemo<CustomerDetailSourceResult>(() => {
    if (enabled) {
      perf.count("customers.detail.source.supabase");
      return { customer: remote ?? undefined, source: "supabase", loading: loading || !hasResolved, error, shadow };
    }
    perf.count("customers.detail.source.local");
    return { customer: localCustomer, source: "local", loading, error, shadow };
  }, [enabled, remote, localCustomer, loading, hasResolved, error, shadow]);
}
