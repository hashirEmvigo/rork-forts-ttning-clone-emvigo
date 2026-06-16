import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import type { WorkOrder } from "@/types";
import { isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import {
  getWorkOrderDirectoryRefreshVersion,
  subscribeWorkOrderDirectoryRefresh,
} from "@/lib/data/workOrderDirectoryRefresh";
import {
  listFullWorkOrdersFromSupabase,
  shadowReadWorkOrders,
  shouldReadWorkOrderListFromSupabase,
  isWorkOrderSupabaseAuthoritative,
  recordWorkOrderCutoverRead,
  recordWorkOrderCutoverFailure,
} from "@/lib/data";
import type { WorkOrderShadowReport } from "@/lib/data";

/** Where the resolved work-order list is currently being read from. */
export type WorkOrderListSource = "local" | "supabase";

export interface WorkOrderListSourceOptions {
  /** When false, suppresses remote reads and returns an empty Supabase snapshot. */
  enabled?: boolean;
}

export interface WorkOrderListSourceResult {
  /** The work-order records the list should render. */
  workOrders: WorkOrder[];
  /** The source actually backing `workOrders` right now. */
  source: WorkOrderListSource;
  /** True while the Supabase read is in flight (only when the flag is on). */
  loading: boolean;
  /** A non-fatal error message if the Supabase read failed (we fell back). */
  error: string | null;
  /** Latest background shadow-read result, when the flag is on. */
  shadow: WorkOrderShadowReport | null;
}

/**
 * Resolves the source of the Work Order LIST (P5D · WO-2) — the direct analogue
 * of {@link import("./use-customer-list-source").useCustomerListSource}.
 *
 * Default (flag OFF): returns the caller-provided localStorage `localWorkOrders`
 * unchanged — zero behaviour change, fully synchronous.
 *
 * Flag ON ({@link WORK_ORDERS_LIST_SUPABASE_READ}): reads the FULL work-order
 * records from Supabase via the validated repository seam, scoped to the active
 * company, then narrows to `customerId` (when given) and sorts newest-first to
 * exactly mirror `AppContext.getCustomerWorkOrders`. The provided
 * Supabase is the rendered source whenever the read path is enabled. Empty
 * Supabase results render an empty state; browser-persistent local data is not a
 * fallback, append layer, or seed source. A background shadow read keeps comparing
 * both sources and surfaces any drift
 * (never silently ignored).
 *
 * This hook ONLY moves list reads. WorkOrderDetails, the Schedule resolver and
 * every work-order write stay on localStorage via {@link AppContext} unchanged.
 * Rollback is instant: flip the flag OFF.
 *
 * @param localWorkOrders The localStorage source of truth (already customer-scoped + sorted).
 * @param companyId       App-facing company id used to scope the Supabase read.
 * @param customerId      Optional customer id to narrow the Supabase result to.
 */
export function useWorkOrderListSource(
  localWorkOrders: WorkOrder[],
  companyId: string | null | undefined,
  customerId?: string | null,
  options: WorkOrderListSourceOptions = {},
): WorkOrderListSourceResult {
  // WO-6: authoritative mode implies the list read path even when the dedicated
  // list-read flag is off. shouldReadWorkOrderListFromSupabase() folds both.
  const enabled = shouldReadWorkOrderListFromSupabase() && isSupabaseConfigured && (options.enabled ?? true);

  const [remote, setRemote] = useState<WorkOrder[] | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [shadow, setShadow] = useState<WorkOrderShadowReport | null>(null);

  // Supabase-authoritative Create AO writes bump this after the server insert
  // confirms, forcing a fresh list read without relying on browser storage.
  const directoryRefreshVersion = useSyncExternalStore(
    subscribeWorkOrderDirectoryRefresh,
    getWorkOrderDirectoryRefreshVersion,
    getWorkOrderDirectoryRefreshVersion,
  );

  // Guards stale async results from overwriting a newer fetch.
  const requestSeq = useRef<number>(0);

  useEffect(() => {
    if (!enabled) {
      setRemote(null);
      setError(null);
      setShadow(null);
      return;
    }

    const seq = ++requestSeq.current;
    const scope = companyId ?? undefined;
    setLoading(true);

    void (async () => {
      try {
        const rows = await listFullWorkOrdersFromSupabase(scope);
        if (seq !== requestSeq.current) return; // superseded
        // Mirror getCustomerWorkOrders: narrow to the customer, newest-first.
        const scoped = (customerId
          ? rows.filter((w) => w.customerId === customerId)
          : rows
        ).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        // Empty result is authoritative absence. Never fall back to localStorage.
        setRemote(scoped);
        setError(null);
        // WO-6: count a Supabase-primary list read under authoritative mode.
        if (scoped.length > 0) recordWorkOrderCutoverRead("read.list");
      } catch (err) {
        if (seq !== requestSeq.current) return;
        setRemote([]);
        const message =
          err instanceof Error ? err.message : "Supabase work-order read failed.";
        setError(message);
        // WO-6: under authoritative mode this is a fallback to the backout copy —
        // record it (never silent) before the UI falls back.
        if (isWorkOrderSupabaseAuthoritative()) {
          recordWorkOrderCutoverFailure("read.list", scope ?? "*", message);
        }
      } finally {
        if (seq === requestSeq.current) setLoading(false);
      }

      // Background parity check — surfaces drift, never blocks the UI.
      const stopShadow = perf.start("workOrders.shadowRead");
      try {
        const report = await shadowReadWorkOrders(companyId ?? null);
        if (seq !== requestSeq.current) return;
        setShadow(report);
        if (!report.ok && import.meta.env.DEV === true) {
          // eslint-disable-next-line no-console
          console.warn("[WO-2] Work Order list shadow-read drift:", report.notes.join(", "));
        }
      } catch {
        // Shadow read is advisory only; ignore its failures.
      } finally {
        stopShadow();
      }
    })();
    // Re-runs on company / customer switch and explicit server-confirmed refresh
    // signals. Browser-persistent local data is not a source signal for
    // Supabase-authoritative reads.
  }, [enabled, companyId, customerId, directoryRefreshVersion]);

  return useMemo<WorkOrderListSourceResult>(() => {
    if (enabled) {
      perf.count("workOrders.list.source.supabase");
      // Phase 1 safety: render only the Supabase snapshot. Do not append local-only
      // work orders while the write/mirror architecture is being reviewed.
      return { workOrders: remote ?? [], source: "supabase", loading, error, shadow };
    }
    perf.count("workOrders.list.source.local");
    return { workOrders: localWorkOrders, source: "local", loading, error, shadow };
  }, [enabled, remote, localWorkOrders, loading, error, shadow]);
}
