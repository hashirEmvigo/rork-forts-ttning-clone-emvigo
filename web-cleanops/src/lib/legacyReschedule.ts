import { makeOccurrenceKey } from "@/types";
import type { BookingOccurrenceException, BookingQueueItem } from "@/types";

/**
 * Legacy reschedule compatibility reader.
 *
 * Before the occurrence-exception model existed, a Booking Queue move was stored
 * directly on the booking as {@link BookingQueueItem.reschedule}. The Shared
 * Schedule Core (and every surface built on it) only reads
 * {@link BookingOccurrenceException} overlays, so those legacy moves were
 * invisible to Schedule / Schedule Lab — the active divergence this module
 * removes.
 *
 * New moves now always write an occurrence exception. `item.reschedule` is
 * treated as read-only compatibility data: it is never written again, never
 * deleted, and is surfaced to the exception-reading surfaces by synthesizing a
 * read-only exception at read time (no migration, no mutation). When a real
 * persisted exception already exists for the same occurrence it always wins, so
 * a converted booking never double-counts.
 *
 * Pure — safe to call during render.
 */

/** Normalizes an ISO timestamp or "YYYY-MM-DD" string to "YYYY-MM-DD" (local). */
function toDateOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  const y = parsed.getFullYear();
  const m = String(parsed.getMonth() + 1).padStart(2, "0");
  const d = String(parsed.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Converts a legacy {@link BookingQueueItem.reschedule} into a synthetic,
 * read-only {@link BookingOccurrenceException} so exception-reading surfaces see
 * the move. The exception is keyed on the occurrence's rule date
 * ({@link BookingQueueItem.serviceDate}) — the identity date the occurrence
 * generator anchors to — with the legacy `newDate` as the override date. The
 * legacy model carried no time overrides, so only the date is moved.
 *
 * Returns null when the item has no legacy reschedule, no usable service
 * (rule) date, or the move resolves to a no-op (override === rule date).
 */
export function legacyRescheduleToException(
  item: BookingQueueItem,
): BookingOccurrenceException | null {
  const legacy = item.reschedule;
  if (!legacy) return null;
  const ruleDate = toDateOnly(item.serviceDate);
  if (!ruleDate) return null;
  const overrideDate = toDateOnly(legacy.newDate);
  if (!overrideDate || overrideDate === ruleDate) return null;

  const occurrenceKey = makeOccurrenceKey(item.serviceRowId, ruleDate);
  const at = legacy.rescheduledAt || item.updatedAt || item.createdAt;
  return {
    // Deterministic synthetic id so repeated reads are stable and never collide
    // with a real persisted exception id (which uses the `bocc` prefix).
    id: `legacy-rs:${occurrenceKey}`,
    occurrenceKey,
    parentServiceRowId: item.serviceRowId,
    occurrenceDate: ruleDate,
    status: "rescheduled",
    overrideOccurrenceDate: overrideDate,
    overrideStartTime: null,
    overrideEndTime: null,
    createdAt: at,
    updatedAt: at,
  };
}

/**
 * Merges read-only synthetic exceptions for any legacy {@link
 * BookingQueueItem.reschedule} into `exceptions`, so Schedule Core and its
 * surfaces show legacy moves identically to new (real exception) moves. A real
 * persisted exception for the same occurrence key always wins — the synthetic
 * one is skipped — so a booking that has since been re-moved through the new
 * path is never double-applied. Returns the original array unchanged when no
 * legacy data needs bridging. Pure.
 */
export function withLegacyReschedules(
  items: BookingQueueItem[] | null | undefined,
  exceptions: BookingOccurrenceException[],
): BookingOccurrenceException[] {
  if (!Array.isArray(items) || items.length === 0) return exceptions;
  const have = new Set<string>(exceptions.map((e) => e.occurrenceKey));
  const synthetic: BookingOccurrenceException[] = [];
  for (const item of items) {
    const ex = legacyRescheduleToException(item);
    if (!ex || have.has(ex.occurrenceKey)) continue;
    synthetic.push(ex);
    have.add(ex.occurrenceKey);
  }
  return synthetic.length === 0 ? exceptions : [...exceptions, ...synthetic];
}
