/**
 * Session-scoped pending-create registry for customers.
 *
 * When a customer is created, its localStorage row appears immediately, but the
 * Supabase create/upsert mirror runs fire-and-forget. Under
 * {@link CUSTOMERS_SUPABASE_AUTHORITATIVE} the list read is Supabase-primary, so
 * the just-created customer would vanish from the list until the mirror lands and
 * the next authoritative read returns it. The list hook bridges that window by
 * APPENDING local-only rows (rows present locally but absent from the remote
 * result) to the rendered list.
 *
 * That blanket "append any local-only row" rule is too broad: it also keeps a
 * STALE local row alive after another browser has soft-deleted the customer. The
 * deleting browser's Supabase read correctly omits the row (filtered by
 * `deleted_at`), but the observing browser still has the row in its localStorage,
 * so the append resurrects it.
 *
 * This registry narrows the append to ONLY genuinely-pending creates:
 *   - {@link addCustomerPendingCreate} when `createCustomer` makes a new customer.
 *   - {@link clearCustomerPendingCreates} once a successful authoritative read
 *     CONFIRMS the id exists remotely (the mirror has landed).
 *   - A bounded max-age fallback so a stuck/failed create mirror can never pin a
 *     local-only row forever.
 *
 * The list hook then appends a local-only row only when its id is pending-create.
 * A local row absent from a successful non-empty remote read that is NOT
 * pending-create is treated as stale and dropped — which is exactly the
 * cross-browser deleted customer.
 *
 * In-memory only — never persisted to localStorage. A page reload clears it,
 * which is safe: by then the mirror has run and the authoritative read returns
 * the created row (or omits a deleted one) on its own.
 */

/** How long a pending-create marker survives before auto-expiring (ms). */
export const CUSTOMER_PENDING_CREATE_MAX_AGE_MS = 60_000;

/** id → timestamp (ms) the pending-create marker was registered. */
let pending = new Map<string, number>();

/** Subscribers (useSyncExternalStore listeners). */
const listeners = new Set<() => void>();

/**
 * Stable snapshot reference for useSyncExternalStore — only changes identity when
 * the set of pending ids actually changes, so React can bail out of renders.
 */
let snapshot: readonly string[] = [];

function emit(): void {
  snapshot = Array.from(pending.keys());
  for (const listener of listeners) listener();
}

/**
 * Mark a customer id as locally created but not yet confirmed by a successful
 * remote read. The list hook will keep appending this local-only row until the
 * mirror lands. Auto-expires after {@link CUSTOMER_PENDING_CREATE_MAX_AGE_MS}.
 */
export function addCustomerPendingCreate(id: string): void {
  if (!id) return;
  pending.set(id, Date.now());
  emit();
  if (typeof setTimeout !== "undefined") {
    // Bounded fallback: a stuck/failed create mirror must never pin a local-only
    // row forever. After the max age we drop the marker; the authoritative read
    // then decides visibility on its own.
    setTimeout(() => clearCustomerPendingCreate(id), CUSTOMER_PENDING_CREATE_MAX_AGE_MS);
  }
}

/** Clear a single pending-create marker. */
export function clearCustomerPendingCreate(id: string): void {
  if (pending.delete(id)) emit();
}

/**
 * Clear multiple pending-create markers at once — used when a successful
 * authoritative read confirms these ids now exist remotely.
 */
export function clearCustomerPendingCreates(ids: readonly string[]): void {
  let changed = false;
  for (const id of ids) {
    if (pending.delete(id)) changed = true;
  }
  if (changed) emit();
}

/** Current pending-create ids (stable reference for useSyncExternalStore). */
export function getCustomerPendingCreates(): readonly string[] {
  return snapshot;
}

/** Subscribe to pending-create changes (useSyncExternalStore contract). */
export function subscribeCustomerPendingCreates(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test-only: clears all pending-create markers and resets the snapshot. */
export function __resetCustomerPendingCreates(): void {
  pending = new Map();
  snapshot = [];
}
