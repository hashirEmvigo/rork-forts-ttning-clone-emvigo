import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import type { WorkOrder } from "@/types";
import { isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import {
  supabaseWorkOrderRepository,
  shadowReadWorkOrderDetail,
  shouldReadWorkOrderDetailFromSupabase,
  isWorkOrderSupabaseAuthoritative,
  recordWorkOrderCutoverRead,
  recordWorkOrderCutoverFailure,
} from "@/lib/data";
import {
  getWorkOrderDirectoryRefreshVersion,
  subscribeWorkOrderDirectoryRefresh,
} from "@/lib/data/workOrderDirectoryRefresh";
import type { WorkOrderDetailShadowReport } from "@/lib/data";

/** Where the resolved work-order detail is currently being read from. */
export type WorkOrderDetailSource = "local" | "supabase";

export interface WorkOrderDetailSourceResult {
  /** The work-order record WorkOrderDetails should render. */
  workOrder: WorkOrder | null;
  /** The source actually backing `workOrder` right now. */
  source: WorkOrderDetailSource;
  /** True while the Supabase detail read is in flight (only when the flag is on). */
  loading: boolean;
  /** A non-fatal error message if the Supabase read failed (we fell back). */
  error: string | null;
  /** Latest background detail shadow-read result, when the flag is on. */
  shadow: WorkOrderDetailShadowReport | null;
}

/**
 * Resolves the source of the WorkOrderDetails DETAIL (P5E · WO-3) — the direct
 * analogue of {@link import("./use-customer-detail-source").useCustomerDetailSource}.
 *
 * Default (flag OFF): returns the caller-provided localStorage `localWorkOrder`
 * unchanged — zero behaviour change, fully synchronous.
 *
 * Flag ON ({@link WORK_ORDERS_DETAIL_SUPABASE_READ}): reads the FULL work-order
 * detail from Supabase via the validated {@link WorkOrderRepository.getDetail}
 * seam and returns that instead. Missing rows and read failures no longer fall
 * back to browser-persistent local data. A background detail shadow read keeps
 * comparing both sources field-by-field and surfaces any drift.
 *
 * ACCESS: when the Supabase-primary path is active, `companyScope` gates the
 * read — `getDetail` returns null for a foreign or missing row, so a viewer can
 * only resolve orders within their company (super admins read unscoped). This
 * works even when there is NO localStorage copy (Supabase-only orders), matching
 * useCustomerDetailSource. When the flag is OFF, the caller-provided
 * `localWorkOrder` (already access-checked by `getWorkOrder`) is returned as-is.
 *
 * This hook ONLY moves the detail read. Writes (create / update / archive /
 * service-row / variation / staffing), the Schedule resolver and the list flag
 * are independent and stay on their current paths. Rollback is instant: flip the
 * flag OFF.
 *
 * @param localWorkOrder The localStorage record (already access-checked).
 * @param workOrderId    The work-order id from the route.
 * @param companyScope   Viewer scope for the Supabase read — `undefined` for
 *                       super admins (unscoped), else the active company id.
 */
export function useWorkOrderDetailSource(
  localWorkOrder: WorkOrder | null,
  workOrderId: string | undefined,
  companyScope: string | null | undefined,
): WorkOrderDetailSourceResult {
  // WO-6: authoritative mode implies the detail read path even when the
  // dedicated detail-read flag is off. A1.1.1 additionally reads Supabase when
  // there is no local detail copy, matching the Supabase-backed Customer Card
  // list: a server-created AO must open without browser hydration.
  const enabled =
    isSupabaseConfigured &&
    Boolean(workOrderId) &&
    (shouldReadWorkOrderDetailFromSupabase() || localWorkOrder == null);

  const [remote, setRemote] = useState<WorkOrder | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [hasResolved, setHasResolved] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [shadow, setShadow] = useState<WorkOrderDetailShadowReport | null>(null);

  // Supabase-authoritative work-order mutations bump this after successful writes,
  // forcing detail to re-read from Supabase without browser storage hydration.
  const directoryRefreshVersion = useSyncExternalStore(
    subscribeWorkOrderDirectoryRefresh,
    getWorkOrderDirectoryRefreshVersion,
    getWorkOrderDirectoryRefreshVersion,
  );

  // Guards stale async results from overwriting a newer fetch.
  const requestSeq = useRef<number>(0);

  useEffect(() => {
    // Read Supabase whenever the authoritative path is active and we have an id.
    // We intentionally do NOT require a localStorage copy: under
    // WORK_ORDERS_SUPABASE_AUTHORITATIVE the list is Supabase-primary, so an order
    // can exist in Supabase without a localStorage record (seeded / migrated /
    // created on another client). ACCESS stays enforced by the company-scoped
    // `getDetail` below — a foreign or missing row returns null — exactly mirroring
    // useCustomerDetailSource. This closes the gap where such Supabase-only orders
    // were unreachable (getWorkOrder returned null → Access Denied).
    if (!enabled || !workOrderId) {
      setRemote(null);
      setHasResolved(false);
      setError(null);
      setShadow(null);
      return;
    }

    if (companyScope === null) {
      setRemote(null);
      setHasResolved(true);
      setError("Work order detail requires a company scope.");
      setShadow(null);
      setLoading(false);
      return;
    }

    const seq = ++requestSeq.current;
    const scope = companyScope;
    setHasResolved(false);
    setLoading(true);

    void (async () => {
      const stop = perf.start("workOrders.detail.supabase.read");
      try {
        const row = await supabaseWorkOrderRepository.getDetail(workOrderId, {
          companyId: scope,
        });
        if (seq !== requestSeq.current) return; // superseded
        // Missing row is authoritative absence; never fall back to localStorage.
        setRemote(row ?? null);
        setHasResolved(true);
        setError(null);
        // WO-6: count a Supabase-primary detail read under authoritative mode.
        if (row) recordWorkOrderCutoverRead("read.detail");
      } catch (err) {
        if (seq !== requestSeq.current) return;
        setRemote(null);
        setHasResolved(true);
        const message =
          err instanceof Error ? err.message : "Supabase work-order detail read failed.";
        setError(message);
        // WO-6: under authoritative mode this is a fallback to the backout copy —
        // record it (never silent) before the page falls back.
        if (isWorkOrderSupabaseAuthoritative()) {
          recordWorkOrderCutoverFailure("read.detail", workOrderId, message);
        }
      } finally {
        stop();
        if (seq === requestSeq.current) setLoading(false);
      }

      // Background parity check — surfaces field drift, never blocks the UI.
      const stopShadow = perf.start("workOrders.detail.shadowRead");
      try {
        const report = await shadowReadWorkOrderDetail(workOrderId, companyScope ?? null);
        if (seq !== requestSeq.current) return;
        setShadow(report);
        if (!report.ok && import.meta.env.DEV === true) {
          // eslint-disable-next-line no-console
          console.warn("[WO-3] Work Order detail shadow-read drift:", report.notes.join(", "));
        }
      } catch {
        // Shadow read is advisory only; ignore its failures.
      } finally {
        stopShadow();
      }
    })();
    // Re-runs on id / company switch and explicit server-confirmed refresh
    // signals. Browser-persistent local data is not a source signal for
    // Supabase-authoritative detail reads.
  }, [enabled, workOrderId, companyScope, directoryRefreshVersion]);

  return useMemo<WorkOrderDetailSourceResult>(() => {
    if (enabled) {
      perf.count("workOrders.detail.source.supabase");
      return { workOrder: remote, source: "supabase", loading: loading || !hasResolved, error, shadow };
    }
    perf.count("workOrders.detail.source.local");
    return { workOrder: localWorkOrder, source: "local", loading, error, shadow };
  }, [enabled, remote, localWorkOrder, loading, hasResolved, error, shadow]);
}
