import { cancelRun, getRunsByVisitOccurrence } from "@/lib/protocolRunStore";
import {
  cancelVisitOccurrence as cancelVisitOccurrenceRow,
  getVisitOccurrence,
} from "@/lib/visitOccurrenceStore";
import type {
  ProtocolRunStatus,
  ProtocolRunV2,
  VisitOccurrence,
} from "@/types";

/**
 * Checklist Manager V2 — Execution integrity & lifecycle rules (Phase 4A,
 * Ticket 56). A single, documented home for the cross-entity rules that keep
 * the execution graph (Customer Protocol → VisitOccurrence → ProtocolRun) safe
 * and predictable as Check-in, mobile execution and reporting are built on top.
 *
 * The rules, by event:
 *
 *  1. Customer Protocol archived
 *     → Existing ProtocolRuns REMAIN VALID and untouched. Runs are immutable
 *       snapshots — they never depend on the live protocol. Archiving only
 *       hides the protocol from active pickers. (No cascade; verified by tests.)
 *
 *  2. Service row removed
 *     → Existing runs and visit occurrences are PRESERVED. They carry their own
 *       snapshotted data and a stable id; orphaning the originating service row
 *       must never delete historical execution/audit records. (No cascade.)
 *
 *  3. Visit cancelled
 *     → The visit transitions to `cancelled` AND its non-terminal bound runs are
 *       cancelled too (a cancelled occurrence cannot have live executions).
 *       Already-completed runs are left as-is (terminal — preserved for audit).
 *       See {@link cancelVisitOccurrenceCascade}.
 *
 *  4. ProtocolRun completed
 *     → Terminal for normal flow. {@link isRunTerminal} treats `completed` and
 *       `cancelled` as terminal so lifecycle transitions don't clobber finished
 *       records (e.g. the visit-cancel cascade skips completed runs).
 *
 *  5. ProtocolRun orphaned (no live visit / work order / protocol)
 *     → Still valid and readable. Orphaned runs are never auto-deleted; they
 *       remain available for reporting and history. {@link isRunOrphaned} only
 *       reports the condition — it takes no action.
 *
 * This module mutates only through the stores (never localStorage directly) and
 * stays company-scoped on every call.
 */

/** Run statuses that are terminal — finished records that must be preserved. */
const TERMINAL_RUN_STATUSES: ReadonlySet<ProtocolRunStatus> = new Set<
  ProtocolRunStatus
>(["completed", "cancelled"]);

/** True when a run has reached a terminal status (`completed` or `cancelled`). */
export function isRunTerminal(status: ProtocolRunStatus): boolean {
  return TERMINAL_RUN_STATUSES.has(status);
}

/**
 * Reports whether a run is orphaned — i.e. it is not anchored to any visit
 * occurrence and carries no work-order context. Orphaned runs remain valid and
 * are never deleted; this is purely diagnostic (e.g. for reporting filters).
 */
export function isRunOrphaned(run: ProtocolRunV2): boolean {
  return !run.visitOccurrenceId && !run.workOrderId;
}

/** Summary of a visit-cancellation cascade. */
export interface CancelVisitCascadeResult {
  /** The cancelled visit occurrence, or null when not found / wrong company. */
  visit: VisitOccurrence | null;
  /** Ids of the runs that were cancelled as part of the cascade. */
  cancelledRunIds: string[];
  /** Ids of bound runs left untouched because they were already terminal. */
  preservedRunIds: string[];
}

/**
 * Cancels a visit occurrence and cascades the cancellation to its bound runs
 * (Rule 3). Non-terminal runs (`draft` / `in_progress`) are cancelled; terminal
 * runs (`completed` / `cancelled`) are preserved untouched for audit. Returns a
 * summary; `visit` is null when the occurrence is unknown for the company (in
 * which case no runs are touched).
 */
export function cancelVisitOccurrenceCascade(
  companyId: string,
  visitOccurrenceId: string,
): CancelVisitCascadeResult {
  const existing = getVisitOccurrence(companyId, visitOccurrenceId);
  if (!existing) {
    return { visit: null, cancelledRunIds: [], preservedRunIds: [] };
  }

  const visit = cancelVisitOccurrenceRow(companyId, visitOccurrenceId);

  const cancelledRunIds: string[] = [];
  const preservedRunIds: string[] = [];
  for (const run of getRunsByVisitOccurrence(companyId, visitOccurrenceId)) {
    if (isRunTerminal(run.status)) {
      preservedRunIds.push(run.id);
      continue;
    }
    const cancelled = cancelRun(companyId, run.id);
    if (cancelled) cancelledRunIds.push(run.id);
  }

  return { visit, cancelledRunIds, preservedRunIds };
}
