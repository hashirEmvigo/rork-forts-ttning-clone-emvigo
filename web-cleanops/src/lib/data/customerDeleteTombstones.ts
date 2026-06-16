/**
 * Session-scoped optimistic delete tombstones for customers.
 *
 * When a customer is deleted, its localStorage row is removed synchronously, but
 * the Supabase soft-delete mirror runs fire-and-forget. Under
 * {@link CUSTOMERS_SUPABASE_AUTHORITATIVE} the list read is Supabase-primary, so
 * the just-deleted customer keeps appearing until the soft-delete mirror lands
 * and the next reconciliation drops it. This tombstone bridges that window:
 * deleted ids are suppressed from the rendered list immediately and cleared once
 * the next Supabase read CONFIRMS the row is no longer returned — or after a
 * bounded max age, so a stuck/failed mirror can never hide a row forever.
 *
 * Why "confirmed by a read" rather than "mirror promise resolved": the list
 * re-read triggered by the local delete races the soft-delete `UPDATE`. If that
 * read executes before the soft-delete commits, it returns the row as still
 * active. Clearing the tombstone the instant the mirror promise resolves would
 * then unhide that stale row until the next reconciliation/reload. So we keep the
 * tombstone until a fresh read proves the row is gone, and we explicitly trigger
 * that confirming read once the mirror lands via {@link bumpCustomerListReconcile}.
 *
 * In-memory only — never persisted to localStorage. A page reload clears it,
 * which is safe because by then the mirror has run and `deleted_at` filtering on
 * Supabase reads takes over.
 *
 * This NEVER hides unrelated remote-only customers: only ids explicitly passed to
 * {@link addCustomerDeleteTombstone} (i.e. just deleted by the user) are tracked.
 */

/** How long an optimistic tombstone survives before auto-expiring (ms). */
export const CUSTOMER_DELETE_TOMBSTONE_MAX_AGE_MS = 30_000;

/**
 * Reconcile signal — bumped after a customer write mirror resolves so the list
 * read hook can re-fetch from Supabase AFTER the soft-delete `UPDATE` has
 * committed. This guarantees a confirming read happens (otherwise the stale
 * `remote` snapshot from the pre-commit read would linger until a manual reload).
 */
let reconcileVersion = 0;
const reconcileListeners = new Set<() => void>();

/** Bump the reconcile signal — call after a customer write mirror resolves. */
export function bumpCustomerListReconcile(): void {
  reconcileVersion += 1;
  for (const listener of reconcileListeners) listener();
}

/** Current reconcile version (useSyncExternalStore / effect-dependency source). */
export function getCustomerListReconcileVersion(): number {
  return reconcileVersion;
}

/** Subscribe to reconcile bumps (useSyncExternalStore contract). */
export function subscribeCustomerListReconcile(listener: () => void): () => void {
  reconcileListeners.add(listener);
  return () => {
    reconcileListeners.delete(listener);
  };
}

/** id → timestamp (ms) the tombstone was created. */
let tombstones = new Map<string, number>();

/** Subscribers (useSyncExternalStore listeners). */
const listeners = new Set<() => void>();

/**
 * Stable snapshot reference for useSyncExternalStore — only changes identity when
 * the set of tombstoned ids actually changes, so React can bail out of renders.
 */
let snapshot: readonly string[] = [];

function emit(): void {
  snapshot = Array.from(tombstones.keys());
  for (const listener of listeners) listener();
}

/**
 * Suppress a customer id from rendered lists immediately after a successful local
 * delete. Auto-expires after {@link CUSTOMER_DELETE_TOMBSTONE_MAX_AGE_MS}.
 */
export function addCustomerDeleteTombstone(id: string): void {
  if (!id) return;
  tombstones.set(id, Date.now());
  emit();
  if (typeof setTimeout !== "undefined") {
    // Bounded fallback: a stuck/failed soft-delete mirror must never hide a row
    // forever. After the max age we drop the tombstone and let the normal read
    // path (deleted_at filtering or local state) decide visibility.
    setTimeout(() => expireCustomerDeleteTombstone(id), CUSTOMER_DELETE_TOMBSTONE_MAX_AGE_MS);
  }
}

/**
 * Auto-expiry path for a tombstone (the bounded max-age fallback).
 *
 * Unlike {@link clearCustomerDeleteTombstones} — which is called from the list
 * hook ONLY after a fresh read has PROVEN the row is gone — expiry fires without
 * any such proof. A stale cached remote snapshot could therefore still hold the
 * row at the moment suppression lifts, resurrecting it. So on expiry we also
 * bump the reconcile signal, forcing the list hook to issue a fresh Supabase
 * read; `deleted_at` filtering then keeps the row out for good. Combined with
 * the hook's snapshot prune, suppression can never lift over a stale row.
 */
function expireCustomerDeleteTombstone(id: string): void {
  if (tombstones.delete(id)) {
    emit();
    bumpCustomerListReconcile();
  }
}

/** Clear a single tombstone (e.g. when its soft-delete mirror has resolved). */
export function clearCustomerDeleteTombstone(id: string): void {
  if (tombstones.delete(id)) emit();
}

/**
 * Clear multiple tombstones at once — used when a dual-write mirror resolves and
 * reports the set of ids it soft-deleted in Supabase.
 */
export function clearCustomerDeleteTombstones(ids: readonly string[]): void {
  let changed = false;
  for (const id of ids) {
    if (tombstones.delete(id)) changed = true;
  }
  if (changed) emit();
}

/** Current tombstoned ids (stable reference for useSyncExternalStore). */
export function getCustomerDeleteTombstones(): readonly string[] {
  return snapshot;
}

/** Subscribe to tombstone changes (useSyncExternalStore contract). */
export function subscribeCustomerDeleteTombstones(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test-only: clears all tombstones and resets the snapshot + reconcile signal. */
export function __resetCustomerDeleteTombstones(): void {
  tombstones = new Map();
  snapshot = [];
  reconcileVersion = 0;
}
