import type { WorkOrder, WorkOrderServiceRow } from "@/types";

/** Matches a date-only "YYYY-MM-DD" string. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Whether a work order is a LIVE source of operational scheduling truth. A work
 * order that has been inactivated/archived (status `inactive`) — or is missing
 * entirely (deleted) — must stop driving active future bookings. Its service
 * rows' current/future occurrences are treated exactly like orphans: hidden from
 * live planning surfaces (Schedule Board, Booking Queue) while past occurrences
 * stay visible for audit. This guarantees that "deleting" (inactivating) a work
 * order can never leave orphaned live bookings on the board.
 */
export function isLiveWorkOrder(workOrder: WorkOrder | undefined | null): boolean {
  return Boolean(workOrder) && workOrder?.status !== "inactive";
}

/**
 * Whether a work-order service row counts as a LIVE source of truth for the
 * Booking Queue. A row that is missing (deleted) or {@link
 * WorkOrderServiceRow.archived} is NOT live: archived rows are superseded (e.g.
 * a service renewed/cloned into a fresh row) and must stop driving active future
 * bookings. The Booking Queue therefore treats an archived-row-backed snapshot
 * exactly like an orphan — its current/future occurrences are stale ghosts that
 * carry outdated staffing, while past occurrences stay visible for audit.
 */
export function isLiveSourceRow(row: WorkOrderServiceRow | undefined): boolean {
  return Boolean(row) && !row?.archived;
}

/**
 * Final source-of-truth guard for the service row end date. The work-order
 * service row owns the schedule bounds; if it carries an inclusive
 * `serviceEndDate`, no occurrence whose identity date (`occurrenceDate`) falls
 * after it may render as an active future booking — regardless of how the row
 * was produced (recurring expansion, a stale persisted base item, or an item
 * whose snapshot end date lagged behind the edited row).
 *
 * Date-only "YYYY-MM-DD" strings compare correctly lexicographically. An
 * occurrence with an explicit persisted exception is exempt, so a deliberately
 * rescheduled or closed-out occurrence stays historically traceable. When the
 * source row is gone or has no end date, nothing is filtered (unbounded series).
 */
export function isAfterServiceEnd(
  occurrenceDate: string,
  sourceRow: WorkOrderServiceRow | undefined,
  hasException: boolean,
): boolean {
  if (hasException) return false;
  const endIso = sourceRow?.serviceEndDate?.trim();
  if (!endIso || !DATE_ONLY.test(endIso)) return false;
  if (!DATE_ONLY.test(occurrenceDate)) return false;
  return occurrenceDate > endIso;
}

/**
 * Decides whether a queue row backed by an ORPHAN snapshot — a persisted
 * {@link BookingQueueItem} whose live source service row no longer exists — must
 * be hidden from the active future Booking Queue.
 *
 * Orphans can't be reconciled against the source of truth: neither staffing
 * edits in AO nor the service end date reach them, so a current-or-future orphan
 * is a stale ghost (outdated staffing for work that, if real, would be backed by
 * a live row). All future work must originate from a live work-order row, so
 * every orphan occurrence dated on or after `today` is hidden — including ones
 * carrying a reschedule/exception, because a future reschedule of a deleted
 * service row is itself a ghost (e.g. Bergen WO-1002's "Moved from…" rows).
 *
 * History is still fully preserved: an occurrence strictly in the past (before
 * `today`) always stays visible and traceable, exception or not. The boundary is
 * inclusive of `today` — a today orphan can no longer reflect a current AO edit,
 * since the live row carries its own correctly-reconciled queue item.
 *
 * When a live source row exists, nothing is hidden here — `syncBookingItem` and
 * {@link isAfterServiceEnd} already keep that row aligned to the source.
 */
export function isHiddenOrphanOccurrence(params: {
  /** The occurrence identity date ("YYYY-MM-DD"). */
  occurrenceDate: string;
  /** Whether a live work-order service row still backs this snapshot. */
  hasLiveSourceRow: boolean;
  /** Today as a local "YYYY-MM-DD" string. */
  today: string;
}): boolean {
  const { occurrenceDate, hasLiveSourceRow, today } = params;
  if (hasLiveSourceRow) return false;
  if (!DATE_ONLY.test(occurrenceDate) || !DATE_ONLY.test(today)) return false;
  return occurrenceDate >= today;
}
