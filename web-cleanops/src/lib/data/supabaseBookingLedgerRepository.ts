import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import type { BookingLedgerEntry } from "@/types";

const BOOKING_LEDGER_COLUMNS =
  "booking_id, booking_series_id, company_legacy_id, customer_id, work_order_id, service_row_id, booking_date, planned_start_time, planned_end_time, booking_status, planning_status, execution_status, billing_status, payroll_status, deleted_at, created_at, updated_at";

interface BookingLedgerRow {
  booking_id: string;
  booking_series_id: string;
  company_legacy_id: string;
  customer_id: string;
  work_order_id: string;
  service_row_id: string;
  booking_date: string;
  planned_start_time: string | null;
  planned_end_time: string | null;
  booking_status: string;
  planning_status: string;
  execution_status: string;
  billing_status: string;
  payroll_status: string;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

class SupabaseNotConfiguredError extends Error {
  constructor() {
    super(
      "SupabaseBookingLedgerRepository requires Supabase. Set EXPO_PUBLIC_SUPABASE_URL " +
        "and EXPO_PUBLIC_SUPABASE_ANON_KEY.",
    );
    this.name = "SupabaseNotConfiguredError";
  }
}

function rowToBookingLedgerEntry(row: BookingLedgerRow): BookingLedgerEntry {
  return {
    bookingId: row.booking_id,
    bookingSeriesId: row.booking_series_id,
    companyId: row.company_legacy_id,
    customerId: row.customer_id,
    workOrderId: row.work_order_id,
    serviceRowId: row.service_row_id,
    bookingDate: row.booking_date,
    plannedStartTime: row.planned_start_time,
    plannedEndTime: row.planned_end_time,
    bookingStatus: row.booking_status as BookingLedgerEntry["bookingStatus"],
    planningStatus: row.planning_status as BookingLedgerEntry["planningStatus"],
    executionStatus: row.execution_status as BookingLedgerEntry["executionStatus"],
    billingStatus: row.billing_status as BookingLedgerEntry["billingStatus"],
    payrollStatus: row.payroll_status as BookingLedgerEntry["payrollStatus"],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Lists generated booking jobs from the new booking ledger table. */
export async function listBookingLedgerEntriesFromSupabase(
  companyId?: string | null,
): Promise<BookingLedgerEntry[]> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const stop = perf.start("bookingLedger.list.supabase");
  try {
    let query = supabase.from("booking_ledger").select(BOOKING_LEDGER_COLUMNS);
    if (companyId !== undefined && companyId !== null) {
      query = query.eq("company_legacy_id", companyId);
    }
    query = query.order("booking_date", { ascending: true }).order("planned_start_time", { ascending: true });
    const { data, error } = await query;
    if (error) throw new Error(`[booking_ledger] Supabase list failed: ${error.message}`);
    const rows = (data ?? []) as unknown as BookingLedgerRow[];
    return rows.filter((row) => !row.deleted_at).map(rowToBookingLedgerEntry);
  } finally {
    stop();
  }
}
