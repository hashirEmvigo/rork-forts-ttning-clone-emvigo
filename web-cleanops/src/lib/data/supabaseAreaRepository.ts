/**
 * Supabase-backed Area read repository (AREA-1).
 *
 * The Areas analogue of {@link import("./supabaseTeamRepository")}. Reads the
 * `areas` table (migration 0020) and returns the SAME {@link Area} shapes the
 * localStorage store returns, so the read seam can swap it in with no UI change.
 *
 * Behaviour parity: areas are company-scoped (no global rows). When a company
 * scope is supplied this repository returns that company's areas; unscoped
 * returns all RLS-visible rows. Soft-deleted rows (`deleted_at` set) are
 * filtered out (WO-5.6 convention).
 */
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import type { Area } from "@/types";

const SUMMARY_COLUMNS = "legacy_id, company_legacy_id, name, deleted_at";

/** Lightweight area row for count / id-set parity checks. */
export interface AreaSummary {
  id: string;
  companyId: string;
  name: string;
}

interface AreaSummaryRow {
  legacy_id: string;
  company_legacy_id: string;
  name: string;
  deleted_at: string | null;
}

interface AreaFullRow {
  data: Area;
  company_legacy_id: string;
  deleted_at: string | null;
}

class SupabaseNotConfiguredError extends Error {
  constructor() {
    super(
      "SupabaseAreaRepository requires Supabase. Set EXPO_PUBLIC_SUPABASE_URL " +
        "and EXPO_PUBLIC_SUPABASE_ANON_KEY.",
    );
    this.name = "SupabaseNotConfiguredError";
  }
}

function rowToSummary(row: AreaSummaryRow): AreaSummary {
  return { id: row.legacy_id, companyId: row.company_legacy_id, name: row.name };
}

/** Company-scoped summary rows. Soft-deleted rows filtered out. */
export async function listAreaSummariesFromSupabase(
  companyId?: string | null,
): Promise<AreaSummary[]> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const stop = perf.start("areas.list.supabase.summaries");
  try {
    let query = supabase.from("areas").select(SUMMARY_COLUMNS);
    if (companyId !== undefined && companyId !== null) {
      query = query.eq("company_legacy_id", companyId);
    }
    const { data, error } = await query;
    if (error) throw new Error(`[areas] Supabase list failed: ${error.message}`);
    const rows = (data ?? []) as unknown as AreaSummaryRow[];
    return rows.filter((r) => !r.deleted_at).map(rowToSummary);
  } finally {
    stop();
  }
}

/** FULL area records (lossless `data` jsonb) for a company scope. */
export async function listFullAreasFromSupabase(
  companyId?: string | null,
): Promise<Area[]> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const stop = perf.start("areas.list.supabase.full");
  perf.count("areas.list.supabase.full.calls");
  try {
    let query = supabase.from("areas").select("data, company_legacy_id, deleted_at");
    if (companyId !== undefined && companyId !== null) {
      query = query.eq("company_legacy_id", companyId);
    }
    const { data, error } = await query;
    if (error) throw new Error(`[areas] Supabase full list failed: ${error.message}`);
    const rows = (data ?? []) as unknown as AreaFullRow[];
    return rows
      .filter((r) => !r.deleted_at)
      .map((r) => r.data)
      .filter((a): a is Area => Boolean(a));
  } finally {
    stop();
  }
}
