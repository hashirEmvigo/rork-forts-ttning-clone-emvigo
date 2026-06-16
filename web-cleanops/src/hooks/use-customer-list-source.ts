import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import type { Customer } from "@/types";
import { isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import {
  getCustomerDirectoryRefreshVersion,
  subscribeCustomerDirectoryRefresh,
} from "@/lib/data/customerDirectoryRefresh";
import {
  listFullCustomersFromSupabase,
  shadowReadCustomers,
  shouldReadListFromSupabase,
  isCustomerSupabaseAuthoritative,
  recordCutoverRead,
  recordCutoverFailure,
  getCustomerDeleteTombstones,
  subscribeCustomerDeleteTombstones,
  clearCustomerDeleteTombstones,
  getCustomerListReconcileVersion,
  subscribeCustomerListReconcile,
  getCustomerPendingCreates,
  subscribeCustomerPendingCreates,
  clearCustomerPendingCreates,
} from "@/lib/data";
import type { CustomerShadowReport } from "@/lib/data";

/** Where the resolved customer list is currently being read from. */
export type CustomerListSource = "local" | "supabase";

export interface CustomerListSourceOptions {
  /** Include archived customer rows. Defaults to false for normal active surfaces. */
  includeArchived?: boolean;
}

export interface CustomerListSourceResult {
  /** The customer records the page should render. */
  customers: Customer[];
  /** The source actually backing `customers` right now. */
  source: CustomerListSource;
  /** True while the Supabase read is in flight (only when the flag is on). */
  loading: boolean;
  /** A non-fatal error message if the Supabase read failed (we fell back). */
  error: string | null;
  /** Latest background shadow-read result, when the flag is on. */
  shadow: CustomerShadowReport | null;
}

/**
 * Resolves the source of the Customers LIST (P4F · Wave 1B).
 *
 * Default (flag OFF): returns the caller-provided localStorage customers
 * unchanged — zero behaviour change, fully synchronous.
 *
 * Flag ON ({@link CUSTOMERS_LIST_SUPABASE_READ}): reads the customer records
 * from Supabase via the validated repository seam and returns those instead.
 * Empty Supabase results are authoritative empty states. Browser-persistent
 * local data is never used as a fallback, seed layer, or revival source.
 * A background shadow read keeps comparing both sources and surfaces any drift
 * (never silently ignored).
 *
 * This hook ONLY moves list reads. Writes (create / update / archive) and the
 * Customer Card continue to use localStorage via {@link AppContext} unchanged.
 * Rollback is instant: flip the flag OFF.
 *
 * @param localCustomers The localStorage source of truth (from AppContext).
 * @param companyId      App-facing company id used to scope the Supabase read.
 */
export function useCustomerListSource(
  localCustomers: Customer[],
  companyId: string | null | undefined,
  options: CustomerListSourceOptions = {},
): CustomerListSourceResult {
  // Wave 1F: authoritative mode implies the list read path even when the
  // dedicated list-read flag is off. shouldReadListFromSupabase() folds both.
  const enabled = shouldReadListFromSupabase() && isSupabaseConfigured;

  const includeArchived = options.includeArchived === true;
  const [remote, setRemote] = useState<Customer[] | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [shadow, setShadow] = useState<CustomerShadowReport | null>(null);

  // Optimistic delete tombstones: ids removed locally this session whose Supabase
  // soft-delete mirror may not have landed yet. Subtracting them keeps a just-
  // deleted customer from lingering in the list until the next reconciliation.
  const tombstoned = useSyncExternalStore(
    subscribeCustomerDeleteTombstones,
    getCustomerDeleteTombstones,
    getCustomerDeleteTombstones,
  );

  // Reconcile signal: bumped after a customer write mirror resolves (e.g. a
  // soft-delete UPDATE committed). Re-running the read on this guarantees a fresh
  // fetch AFTER the commit, so the confirming read below can clear the tombstone.
  const reconcileVersion = useSyncExternalStore(
    subscribeCustomerListReconcile,
    getCustomerListReconcileVersion,
    getCustomerListReconcileVersion,
  );

  // Supabase-authoritative CustomerDialog writes bump this after the server write
  // confirms, forcing a fresh list read without relying on browser storage.
  const directoryRefreshVersion = useSyncExternalStore(
    subscribeCustomerDirectoryRefresh,
    getCustomerDirectoryRefreshVersion,
    getCustomerDirectoryRefreshVersion,
  );

  // Pending-create registry: ids created locally this session whose Supabase
  // create mirror may not have landed yet. Only these local-only rows are
  // appended below; any OTHER local row absent from a successful authoritative
  // read is stale (e.g. soft-deleted by another browser) and must not be kept.
  const pendingCreates = useSyncExternalStore(
    subscribeCustomerPendingCreates,
    getCustomerPendingCreates,
    getCustomerPendingCreates,
  );

  // Guards stale async results from overwriting a newer fetch.
  const requestSeq = useRef<number>(0);

  // Deterministic prune: a tombstoned (just-deleted) id is removed from the
  // CACHED remote snapshot too, not only the rendered output. The render-time
  // `suppress` overlay hides the row while the tombstone is active, but the
  // cached `remote` still holds the stale (pre-delete) row underneath. If the
  // tombstone is later cleared — by a confirming read OR by max-age expiry —
  // before a fresh read replaces `remote`, that stale row would resurface and a
  // downstream hydration could write the ghost back into local state. Pruning
  // the snapshot here keeps it in lockstep with the suppression set, so clearing
  // a tombstone can never resurrect a deleted row. Re-runs after each reconcile
  // bump (post mirror-commit) so a slow confirming read is never depended upon.
  // Idempotent: returns the same reference once nothing remains to prune, so it
  // can never loop.
  useEffect(() => {
    if (tombstoned.length === 0) return;
    const set = new Set(tombstoned);
    setRemote((cur) => {
      if (!cur) return cur;
      const pruned = cur.filter((c) => !set.has(c.id));
      return pruned.length === cur.length ? cur : pruned;
    });
  }, [tombstoned, reconcileVersion]);

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
        const rows = await listFullCustomersFromSupabase(scope, { includeArchived });
        if (seq !== requestSeq.current) return; // superseded
        // Confirmed-removal clearing: any tombstoned id NOT present in this fresh
        // read is proven gone from Supabase, so its tombstone can be retired (the
        // deleted_at filter now keeps it out). Computed from the RAW rows (proof
        // of absence in Supabase). Tombstones for ids still returned are kept —
        // this read raced ahead of the soft-delete commit. We only trust a
        // non-empty read so an unrelated empty/blanked result can't retire a
        // tombstone prematurely.
        const active = getCustomerDeleteTombstones();
        if (rows.length > 0 && active.length > 0) {
          const remoteIds = new Set(rows.map((r) => r.id));
          const confirmedGone = active.filter((id) => !remoteIds.has(id));
          if (confirmedGone.length > 0) clearCustomerDeleteTombstones(confirmedGone);
        }
        // Pending-create confirmation: any pending-create id PRESENT in this fresh
        // read has had its create mirror land, so it no longer needs the local-only
        // append safety net — retire its marker. Only a non-empty read is trusted,
        // so a transient empty/blanked result can't prematurely clear a marker (the
        // row would then drop while its create is still mirroring).
        const pending = getCustomerPendingCreates();
        if (rows.length > 0 && pending.length > 0) {
          const remoteIds = new Set(rows.map((r) => r.id));
          const confirmedPresent = pending.filter((id) => remoteIds.has(id));
          if (confirmedPresent.length > 0) clearCustomerPendingCreates(confirmedPresent);
        }
        // Snapshot prune at read time: never CACHE a still-tombstoned id. A slow
        // soft-delete mirror means Supabase can keep returning the row until the
        // commit lands; without this, each re-read would repopulate the cached
        // snapshot with the row, so clearing the tombstone (by expiry, or once the
        // mirror lands) could briefly resurface it. Pruning keeps the cached
        // snapshot in lockstep with the suppression set. The confirming-read logic
        // above still uses the RAW rows, so tombstones are retired correctly.
        const tombstoneSet = active.length > 0 ? new Set(active) : null;
        const visibleRows = tombstoneSet
          ? rows.filter((r) => !tombstoneSet.has(r.id))
          : rows;
        // Empty result is an authoritative empty state. Never fall back to
        // browser-persistent local data, because that can resurrect reset data.
        setRemote(visibleRows);
        setError(null);
        // Wave 1F: count a Supabase-primary list read under authoritative mode.
        if (rows.length > 0) recordCutoverRead("read.list");
      } catch (err) {
        if (seq !== requestSeq.current) return;
        setRemote([]);
        const message = err instanceof Error ? err.message : "Supabase customer read failed.";
        setError(message);
        // Wave 1F: under authoritative mode this is a fallback to the backout
        // copy — record it (never silent) before the UI falls back.
        if (isCustomerSupabaseAuthoritative()) {
          recordCutoverFailure("read.list", scope ?? "*", message);
        }
      } finally {
        if (seq === requestSeq.current) setLoading(false);
      }

      // Background parity check — surfaces drift, never blocks the UI.
      try {
        const report = await shadowReadCustomers(companyId ?? null);
        if (seq !== requestSeq.current) return;
        setShadow(report);
        if (!report.ok && import.meta.env.DEV === true) {
          // eslint-disable-next-line no-console
          console.warn("[Wave1B] Customer list shadow-read drift:", report.notes.join(", "));
        }
      } catch {
        // Shadow read is advisory only; ignore its failures.
      }
    })();
    // Re-runs on company switch and explicit server-confirmed refresh signals.
    // Local browser storage changes are intentionally not a fetch trigger in
    // Supabase mode.
  }, [enabled, companyId, includeArchived, reconcileVersion, pendingCreates, directoryRefreshVersion]);

  return useMemo<CustomerListSourceResult>(() => {
    // Optimistic delete suppression: drop ids the user just deleted, regardless
    // of source. Only explicitly-deleted ids are tracked, so unrelated remote-
    // only customers are never hidden.
    const tombstoneSet = tombstoned.length > 0 ? new Set(tombstoned) : null;
    const suppress = (list: Customer[]): Customer[] => {
      const lifecycleFiltered = includeArchived
        ? list
        : list.filter((customer) => customer.status !== "archived");
      return tombstoneSet ? lifecycleFiltered.filter((c) => !tombstoneSet.has(c.id)) : lifecycleFiltered;
    };

    if (enabled) {
      perf.count("customers.list.source.supabase");
      // Phase 1 safety: render only the Supabase snapshot. Do not append local-only
      // rows, prefer newer localStorage records, or keep local data on empty reads.
      // Pending-create and mirror-window overlays are disabled until a reviewed
      // non-persistent optimistic design exists.
      return { customers: suppress(remote ?? []), source: "supabase", loading, error, shadow };
    }
    perf.count("customers.list.source.local");
    return { customers: suppress(localCustomers), source: "local", loading, error, shadow };
  }, [enabled, remote, localCustomers, loading, error, shadow, tombstoned, includeArchived]);
}
