/**
 * Supabase-backed Visit Occurrence read repository (MISSION-1).
 *
 * The Missions analogue of {@link import("./supabaseAreaRepository")}. Reads the
 * `visit_occurrences` table (migration 0021) and returns the SAME
 * {@link VisitOccurrence} shapes the localStorage store returns, so the read
 * seam can swap it in with no consumer change.
 *
 * Behaviour parity: occurrences are company-scoped (no global rows). When a
 * company scope is supplied this repository returns that company's occurrences;
 * unscoped returns all RLS-visible rows. Soft-deleted rows (`deleted_at` set) are
 * filtered out (WO-5.6 convention); the app uses the `cancelled` status for soft
 * lifecycle so `deleted_at` is effectively never set.
 */
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import { sortVisitOccurrences, type VisitOccurrence } from "@/types";

const SUMMARY_COLUMNS =
  "legacy_id, company_legacy_id, customer_legacy_id, work_order_legacy_id, scheduled_date, status, deleted_at";

/** Lightweight occurrence row for count / id-set parity checks. */
export interface VisitOccurrenceSummary {
  id: string;
  companyId: string;
  customerId: string;
  workOrderId: string;
  scheduledDate: string;
  status: string;
}

interface VisitOccurrenceSummaryRow {
  legacy_id: string;
  company_legacy_id: string;
  customer_legacy_id: string;
  work_order_legacy_id: string;
  scheduled_date: string;
  status: string;
  deleted_at: string | null;
}

interface VisitOccurrenceFullRow {
  data: VisitOccurrence;
  company_legacy_id: string;
  deleted_at: string | null;
}

class SupabaseNotConfiguredError extends Error {
  constructor() {
    super(
      "SupabaseVisitOccurrenceRepository requires Supabase. Set " +
        "EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.",
    );
    this.name = "SupabaseNotConfiguredError";
  }
}

function rowToSummary(row: VisitOccurrenceSummaryRow): VisitOccurrenceSummary {
  return {
    id: row.legacy_id,
    companyId: row.company_legacy_id,
    customerId: row.customer_legacy_id,
    workOrderId: row.work_order_legacy_id,
    scheduledDate: row.scheduled_date,
    status: row.status,
  };
}

/** Company-scoped summary rows. Soft-deleted rows filtered out. */
export async function listVisitOccurrenceSummariesFromSupabase(
  companyId?: string | null,
): Promise<VisitOccurrenceSummary[]> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const stop = perf.start("visitOccurrences.list.supabase.summaries");
  try {
    let query = supabase.from("visit_occurrences").select(SUMMARY_COLUMNS);
    if (companyId !== undefined && companyId !== null) {
      query = query.eq("company_legacy_id", companyId);
    }
    const { data, error } = await query;
    if (error) throw new Error(`[visitOccurrences] Supabase list failed: ${error.message}`);
    const rows = (data ?? []) as unknown as VisitOccurrenceSummaryRow[];
    return rows.filter((r) => !r.deleted_at).map(rowToSummary);
  } finally {
    stop();
  }
}

/** FULL occurrence records (lossless `data` jsonb) for a company scope, ordered. */
export async function listFullVisitOccurrencesFromSupabase(
  companyId?: string | null,
): Promise<VisitOccurrence[]> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const stop = perf.start("visitOccurrences.list.supabase.full");
  perf.count("visitOccurrences.list.supabase.full.calls");
  try {
    let query = supabase
      .from("visit_occurrences")
      .select("data, company_legacy_id, deleted_at");
    if (companyId !== undefined && companyId !== null) {
      query = query.eq("company_legacy_id", companyId);
    }
    const { data, error } = await query;
    if (error) {
      throw new Error(`[visitOccurrences] Supabase full list failed: ${error.message}`);
    }
    const rows = (data ?? []) as unknown as VisitOccurrenceFullRow[];
    return sortVisitOccurrences(
      rows
        .filter((r) => !r.deleted_at)
        .map((r) => r.data)
        .filter((v): v is VisitOccurrence => Boolean(v)),
    );
  } finally {
    stop();
  }
}
