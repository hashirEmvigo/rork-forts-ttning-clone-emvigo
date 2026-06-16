/**
 * Per-customer ordered mirror queue (customer write-order fix).
 *
 * PROBLEM (split-brain race on new customers): `persistCustomers` fires
 * {@link mirrorCustomerWrites} fire-and-forget on every write. For a freshly
 * created customer, "create" and a quick "delete" are two independent,
 * UNORDERED background mirrors. If the delete's soft-delete UPDATE reaches
 * Supabase BEFORE the create upsert has committed, the UPDATE matches 0 rows;
 * the create then commits with `deleted_at = null`, leaving the customer ACTIVE
 * remotely and forcing a second delete click.
 *
 * FIX: route every customer mirror through {@link enqueueCustomerMirror}, which
 * serializes mirrors that touch the SAME customer id (FIFO). A create upsert for
 * a customer always completes before that customer's delete/archive/deactivate
 * mirror runs. Mirrors for DIFFERENT customers stay concurrent (no global lock).
 *
 * Guarantees preserved:
 *   • Fire-and-forget from the UI — the local write never blocks on Supabase;
 *     callers still `void enqueueCustomerMirror(prev, next).then(...)`.
 *   • Never throws — a failing mirror settles its queue slot so it can never
 *     reject a later customer's gate (errors are still surfaced in the result).
 *   • Idempotent + tombstone/overlay behavior is unchanged; this module only
 *     orders the remote writes, it does not alter what they do.
 */
import type { Customer } from "@/types";
import {
  mirrorCustomerWrites,
  affectedCustomerIds,
  type CustomerDualWriteResult,
} from "./customerDualWrite";

/** Runs one mirror operation. Injectable so tests can drive ordering directly. */
export type CustomerMirrorRunner = (
  prev: Customer[],
  next: Customer[],
) => Promise<CustomerDualWriteResult>;

let runner: CustomerMirrorRunner = mirrorCustomerWrites;

/**
 * Per-customer-id "tail" promise. Each entry resolves when the most recently
 * enqueued mirror touching that id has settled. A new mirror for the same id
 * gates on its predecessor's tail, producing strict FIFO ordering per id.
 */
const tails = new Map<string, Promise<void>>();

/**
 * Enqueues a customer mirror, serialized against any in-flight mirrors that
 * touch the same customer id(s). Returns the underlying mirror result promise
 * so callers can still inspect / record the outcome.
 *
 * Call fire-and-forget AFTER the authoritative localStorage write, exactly like
 * the previous direct {@link mirrorCustomerWrites} call.
 */
export function enqueueCustomerMirror(
  prev: Customer[],
  next: Customer[],
): Promise<CustomerDualWriteResult> {
  const ids = affectedCustomerIds(prev, next);

  // Nothing meaningful changed: run straight through (the mirror records a noop).
  // No tail is registered because there is no id to serialize against.
  if (ids.length === 0) {
    return runner(prev, next);
  }

  // Gate this operation behind every prior mirror that touches an overlapping
  // id. `allSettled` ensures a failed predecessor still releases the gate.
  const predecessors = ids
    .map((id) => tails.get(id))
    .filter((p): p is Promise<void> => p !== undefined);
  const gate =
    predecessors.length > 0
      ? Promise.allSettled(predecessors)
      : Promise.resolve();

  const run = gate.then(() => runner(prev, next));

  // The tail never rejects, so a later customer's gate can always resolve.
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  for (const id of ids) {
    tails.set(id, tail);
  }

  // Cleanup: once settled, drop this tail if it is still the latest for the id
  // (a newer enqueue may have already replaced it). Keeps the map bounded.
  void tail.then(() => {
    for (const id of ids) {
      if (tails.get(id) === tail) {
        tails.delete(id);
      }
    }
  });

  return run;
}

/** Test-only: override the underlying mirror runner. */
export function __setCustomerMirrorRunner(next: CustomerMirrorRunner): void {
  runner = next;
}

/** Test-only: restore the default runner and clear all pending tails. */
export function __resetCustomerMirrorQueue(): void {
  runner = mirrorCustomerWrites;
  tails.clear();
}
