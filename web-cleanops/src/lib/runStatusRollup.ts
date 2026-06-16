import {
  getRun,
  getRunItems,
  getRunSections,
  updateRunStatus,
} from "@/lib/protocolRunStore";
import type {
  ProtocolRunItem,
  ProtocolRunItemStatus,
  ProtocolRunStatus,
  ProtocolRunV2,
} from "@/types";

/**
 * Checklist Manager V2 — Protocol run status rollup (Phase 3B, Ticket 28).
 *
 * Centralized, single source of truth for deriving a run's lifecycle status from
 * its item completion states. UI never recomputes status itself — it mutates an
 * item via the store and then calls {@link recomputeRunStatus}, keeping the rule
 * in exactly one place.
 *
 * Rules:
 *  - `cancelled` is a manual terminal state and is never overridden here.
 *  - All items still `pending` (or a run with no items) → `draft`.
 *  - At least one item resolved but required items still open → `in_progress`.
 *  - Every required item resolved (done / skipped / na) → `completed`. When a run
 *    has no required items, completion requires every item to be resolved so an
 *    optional-only run doesn't auto-complete on the first action.
 */

/** An item status counts as "resolved" once it is no longer pending. */
export function isItemResolved(status: ProtocolRunItemStatus): boolean {
  return status === "done" || status === "skipped" || status === "na";
}

/**
 * Pure rollup: derives the lifecycle status for a run given its current status
 * and items. Does not touch storage.
 */
export function computeRunStatus(
  currentStatus: ProtocolRunStatus,
  items: ProtocolRunItem[],
): ProtocolRunStatus {
  // Cancelling is a manual decision; never auto-transition out of it.
  if (currentStatus === "cancelled") return "cancelled";

  if (items.length === 0) return "draft";

  const anyResolved = items.some((i) => isItemResolved(i.status));
  if (!anyResolved) return "draft";

  const requiredItems = items.filter((i) => i.required);
  const completed =
    requiredItems.length > 0
      ? requiredItems.every((i) => isItemResolved(i.status))
      : items.every((i) => isItemResolved(i.status));

  return completed ? "completed" : "in_progress";
}

/**
 * Reads a run's items from the store, computes the rolled-up status and persists
 * it when it changed. Returns the (possibly updated) run, or null when the run
 * is unknown / not owned by the company. Cancelled runs are returned unchanged.
 */
export function recomputeRunStatus(
  companyId: string,
  runId: string,
): ProtocolRunV2 | null {
  const run = getRun(companyId, runId);
  if (!run) return null;
  if (run.status === "cancelled") return run;

  const items = getRunSections(companyId, runId).flatMap((section) =>
    getRunItems(companyId, section.id),
  );
  const next = computeRunStatus(run.status, items);
  if (next === run.status) return run;

  return updateRunStatus(companyId, runId, next);
}
