/**
 * Remote-only record hydration (Work Orders / Customers consistency fix).
 *
 * Under a Supabase-authoritative READ path the detail surfaces can resolve a
 * record that exists ONLY in Supabase (seeded / migrated / created on another
 * client) with no localStorage copy. The page renders fine, but every ACTION /
 * ACCESS seam in AppContext still gates on and mutates the in-memory
 * localStorage arrays (`customers.find(...)`, `workOrders.find(...)`,
 * `canAccessCustomer`). A record absent from those arrays makes actions fail:
 *
 *   • Work-order checkout / update / delete service row → "Work order not found".
 *   • Create Work Order from the Customer Card → "You do not have permission"
 *     (because `canAccessCustomer` can't see the Supabase-only customer).
 *
 * Hydration back-fills the resolved remote record into the local in-memory array
 * so the action seams operate on the exact record the page is showing. It is a
 * READ-side reconcile only — it must never mirror back to Supabase (the record
 * already lives there) and must never clobber a newer local edit.
 *
 * Safety properties:
 *   • Adds a missing record (the common case) so actions can find it.
 *   • Replaces a present record ONLY when the remote copy is strictly newer than
 *     local — never overwrites newer local state with an older remote snapshot.
 *   • Never duplicates: keyed strictly by `id`.
 *   • Reports whether anything changed so callers can skip a no-op state update
 *     (prevents render loops).
 *   • Company scoping is enforced upstream by the company-scoped detail read; the
 *     resolved record is already one the viewer may access.
 *
 * Pure and synchronous.
 */

import { isLocalRecordFresher } from "./detailMirrorWindow";

/** Minimal shape the hydration reconcile keys and compares on. */
export interface HydratableRecord {
  id: string;
  /** ISO-8601 last-modified stamp, used to avoid overwriting newer local state. */
  updatedAt?: string | null;
}

export interface HydrationResult<T> {
  /** The next array (same reference as input when nothing changed). */
  list: T[];
  /** True when `list` differs from the input (record added or refreshed). */
  changed: boolean;
}

/**
 * Reconciles a single remote-resolved `record` into a local `list`.
 *
 * @param list   The current local array.
 * @param record The remote record the detail surface resolved.
 */
export function reconcileHydratedRecord<T extends HydratableRecord>(
  list: T[],
  record: T,
): HydrationResult<T> {
  const idx = list.findIndex((r) => r.id === record.id);

  // Missing locally → hydrate (prepend, matching optimistic-append ordering).
  if (idx === -1) {
    return { list: [record, ...list], changed: true };
  }

  // Present locally → only refresh when the remote copy is strictly newer, so a
  // pending local edit (newer/equal `updatedAt`) is never clobbered.
  const existing = list[idx];
  if (isLocalRecordFresher(record, existing)) {
    const next = list.slice();
    next[idx] = record;
    return { list: next, changed: true };
  }

  return { list, changed: false };
}

/**
 * Folds {@link reconcileHydratedRecord} over many remote records in a single
 * pass, so a caller (e.g. the Customers LIST seam) can back-fill every visible
 * Supabase-only row into local state with ONE state update instead of one per
 * row. Same safety properties as the single-record variant: adds missing rows,
 * refreshes only strictly-newer remotes, never duplicates, never clobbers newer
 * local edits. Returns the original list reference when nothing changed.
 *
 * @param list    The current local array.
 * @param records The remote records resolved by the list read.
 */
export function reconcileHydratedRecords<T extends HydratableRecord>(
  list: T[],
  records: readonly T[],
): HydrationResult<T> {
  let next = list;
  let changed = false;
  for (const record of records) {
    const res = reconcileHydratedRecord(next, record);
    if (res.changed) {
      next = res.list;
      changed = true;
    }
  }
  return { list: next, changed };
}
