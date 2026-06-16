/**
 * Supabase-backed Booking Queue read repository (BQ-1).
 *
 * The Booking Queue analogue of {@link import("./supabaseAreaRepository")}. Reads
 * the `booking_queue` table (migration 0025) and returns the SAME
 * {@link BookingQueueItem} shapes the localStorage store returns, so the read
 * seam can swap it in with no UI change.
 *
 * Behaviour parity: queue items are company-scoped (no global rows). When a
 * company scope is supplied this repository returns that company's items;
 * unscoped returns all RLS-visible rows. Soft-deleted rows (`deleted_at` set)
 * are filtered out (WO-5.6 convention).
 */
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import type { BookingQueueItem } from "@/types";

const SUMMARY_COLUMNS =
  "legacy_id, company_legacy_id, work_order_legacy_id, service_row_legacy_id, deleted_at";

/** Lightweight queue row for count / id-set parity checks. */
export interface BookingQueueSummary {
  id: string;
  companyId: string;
  workOrderId: string;
  serviceRowId: string;
}

interface BookingQueueSummaryRow {
  legacy_id: string;
  company_legacy_id: string;
  work_order_legacy_id: string;
  service_row_legacy_id: string;
  deleted_at: string | null;
}

interface BookingQueueFullRow {
  data: BookingQueueItem;
  company_legacy_id: string;
  deleted_at: string | null;
}

class SupabaseNotConfiguredError extends Error {
  constructor() {
    super(
      "SupabaseBookingQueueRepository requires Supabase. Set EXPO_PUBLIC_SUPABASE_URL " +
        "and EXPO_PUBLIC_SUPABASE_ANON_KEY.",
    );
    this.name = "SupabaseNotConfiguredError";
  }
}

function rowToSummary(row: BookingQueueSummaryRow): BookingQueueSummary {
  return {
    id: row.legacy_id,
    companyId: row.company_legacy_id,
    workOrderId: row.work_order_legacy_id,
    serviceRowId: row.service_row_legacy_id,
  };
}

/** Company-scoped summary rows. Soft-deleted rows filtered out. */
export async function listBookingQueueSummariesFromSupabase(
  companyId?: string | null,
): Promise<BookingQueueSummary[]> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const stop = perf.start("bookingQueue.list.supabase.summaries");
  try {
    let query = supabase.from("booking_queue").select(SUMMARY_COLUMNS);
    if (companyId !== undefined && companyId !== null) {
      query = query.eq("company_legacy_id", companyId);
    }
    const { data, error } = await query;
    if (error) throw new Error(`[booking_queue] Supabase list failed: ${error.message}`);
    const rows = (data ?? []) as unknown as BookingQueueSummaryRow[];
    return rows.filter((r) => !r.deleted_at).map(rowToSummary);
  } finally {
    stop();
  }
}

/** FULL queue records (lossless `data` jsonb) for a company scope. */
export async function listFullBookingQueueFromSupabase(
  companyId?: string | null,
): Promise<BookingQueueItem[]> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const stop = perf.start("bookingQueue.list.supabase.full");
  perf.count("bookingQueue.list.supabase.full.calls");
  try {
    let query = supabase.from("booking_queue").select("data, company_legacy_id, deleted_at");
    if (companyId !== undefined && companyId !== null) {
      query = query.eq("company_legacy_id", companyId);
    }
    const { data, error } = await query;
    if (error) throw new Error(`[booking_queue] Supabase full list failed: ${error.message}`);
    const rows = (data ?? []) as unknown as BookingQueueFullRow[];
    return rows
      .filter((r) => !r.deleted_at)
      .map((r) => r.data)
      .filter((b): b is BookingQueueItem => Boolean(b));
  } finally {
    stop();
  }
}
