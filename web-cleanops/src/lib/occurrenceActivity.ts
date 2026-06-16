import { formatDate } from "./format";
import type { AuditAction, WorkOrderActivityAction } from "@/types";

/**
 * Pure builders for the audit + work-order-activity copy written when a
 * dispatcher acts on a single booking occurrence (cancel, restore, reschedule).
 *
 * These are kept framework-agnostic and side-effect free so the AppContext
 * mutations and the dispatcher tests use ONE source of truth for the log copy —
 * the Schedule and Booking Queue therefore record identical audit/activity for
 * the same action. The "assign employee" and "add note" dispatcher actions
 * reuse the already-audited `updateWorkOrderServiceRow` / `addWorkOrderNote`
 * context mutations, so they intentionally do not appear here.
 */

/** Resolved metadata about the occurrence being acted on. */
export interface OccurrenceActionMeta {
  serviceName: string;
  workOrderNumber: string;
  /** Rule/identity date "YYYY-MM-DD" of the occurrence. */
  occurrenceDate: string;
}

/** The paired work-order-activity and audit-log entries for one action. */
export interface OccurrenceActionLog {
  activityAction: WorkOrderActivityAction;
  activitySummary: string;
  auditAction: AuditAction;
  auditSummary: string;
}

function pretty(dateIso: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateIso) ? formatDate(`${dateIso}T00:00:00`) : dateIso;
}

/** Log copy for cancelling a single occurrence. */
export function describeOccurrenceCancel(meta: OccurrenceActionMeta): OccurrenceActionLog {
  const when = pretty(meta.occurrenceDate);
  return {
    activityAction: "booking_cancelled",
    activitySummary: `Occurrence cancelled: ${meta.serviceName} on ${when}`,
    auditAction: "bookingqueue.cancel",
    auditSummary: `Cancelled booking occurrence “${meta.serviceName}” (${meta.workOrderNumber}) on ${when}.`,
  };
}

/** Log copy for restoring a previously cancelled occurrence. */
export function describeOccurrenceRestore(meta: OccurrenceActionMeta): OccurrenceActionLog {
  const when = pretty(meta.occurrenceDate);
  return {
    activityAction: "booking_restored",
    activitySummary: `Occurrence restored: ${meta.serviceName} on ${when}`,
    auditAction: "bookingqueue.restore",
    auditSummary: `Restored booking occurrence “${meta.serviceName}” (${meta.workOrderNumber}) on ${when}.`,
  };
}

/** Log copy for reassigning the staffing of a single occurrence. */
export function describeOccurrenceReassign(
  meta: OccurrenceActionMeta,
  assignedCount: number,
): OccurrenceActionLog {
  const when = pretty(meta.occurrenceDate);
  const who =
    assignedCount === 0
      ? "open slot"
      : `${assignedCount} employee${assignedCount === 1 ? "" : "s"}`;
  return {
    activityAction: "service_edited",
    activitySummary: `Occurrence reassigned: ${meta.serviceName} on ${when} → ${who}`,
    auditAction: "workorder.service",
    auditSummary: `Reassigned booking occurrence “${meta.serviceName}” (${meta.workOrderNumber}) on ${when} to ${who}.`,
  };
}

/** Log copy for clearing a single occurrence's assignment override (back to series). */
export function describeOccurrenceReassignCleared(
  meta: OccurrenceActionMeta,
): OccurrenceActionLog {
  const when = pretty(meta.occurrenceDate);
  return {
    activityAction: "service_edited",
    activitySummary: `Occurrence assignment reset to series: ${meta.serviceName} on ${when}`,
    auditAction: "workorder.service",
    auditSummary: `Reset booking occurrence “${meta.serviceName}” (${meta.workOrderNumber}) on ${when} to the series assignment.`,
  };
}

/** Log copy for moving a single occurrence to a new date (and optional time). */
export function describeOccurrenceReschedule(
  meta: OccurrenceActionMeta,
  newDate: string,
): OccurrenceActionLog {
  const from = pretty(meta.occurrenceDate);
  const to = pretty(newDate);
  const movedDate = newDate !== meta.occurrenceDate;
  const summaryTail = movedDate ? `${from} → ${to}` : `${to} (time updated)`;
  return {
    activityAction: "booking_rescheduled",
    activitySummary: `Occurrence rescheduled: ${meta.serviceName} ${summaryTail}`,
    auditAction: "bookingqueue.reschedule",
    auditSummary: `Rescheduled booking occurrence “${meta.serviceName}” (${meta.workOrderNumber}) ${summaryTail}.`,
  };
}
