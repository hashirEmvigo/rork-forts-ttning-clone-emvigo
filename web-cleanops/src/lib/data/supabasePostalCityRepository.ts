/**
 * Supabase-backed Postal City read repository (AREA-1).
 *
 * The Postal Cities analogue of {@link import("./supabaseTeamRepository")}. Reads
 * the `postal_cities` table (migration 0020) and returns the SAME
 * {@link PostalCity} shapes the localStorage store returns. Postal cities are
 * company-scoped (no global rows). Soft-deleted rows (`deleted_at` set) are
 * filtered out (WO-5.6 convention).
 */
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import type { PostalCity } from "@/types";

const SUMMARY_COLUMNS = "legacy_id, company_legacy_id, name, area_legacy_id, deleted_at";

/** Lightweight postal-city row for count / id-set parity checks. */
export interface PostalCitySummary {
  id: string;
  companyId: string;
  name: string;
  areaId: string;
}

interface PostalCitySummaryRow {
  legacy_id: string;
  company_legacy_id: string;
  name: string;
  area_legacy_id: string;
  deleted_at: string | null;
}

interface PostalCityFullRow {
  data: PostalCity;
  company_legacy_id: string;
  deleted_at: string | null;
}

class SupabaseNotConfiguredError extends Error {
  constructor() {
    super(
      "SupabasePostalCityRepository requires Supabase. Set EXPO_PUBLIC_SUPABASE_URL " +
        "and EXPO_PUBLIC_SUPABASE_ANON_KEY.",
    );
    this.name = "SupabaseNotConfiguredError";
  }
}

function rowToSummary(row: PostalCitySummaryRow): PostalCitySummary {
  return {
    id: row.legacy_id,
    companyId: row.company_legacy_id,
    name: row.name,
    areaId: row.area_legacy_id,
  };
}

/** Company-scoped summary rows. Soft-deleted rows filtered out. */
export async function listPostalCitySummariesFromSupabase(
  companyId?: string | null,
): Promise<PostalCitySummary[]> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const stop = perf.start("postalCities.list.supabase.summaries");
  try {
    let query = supabase.from("postal_cities").select(SUMMARY_COLUMNS);
    if (companyId !== undefined && companyId !== null) {
      query = query.eq("company_legacy_id", companyId);
    }
    const { data, error } = await query;
    if (error) throw new Error(`[postal_cities] Supabase list failed: ${error.message}`);
    const rows = (data ?? []) as unknown as PostalCitySummaryRow[];
    return rows.filter((r) => !r.deleted_at).map(rowToSummary);
  } finally {
    stop();
  }
}

/** FULL postal-city records (lossless `data` jsonb) for a company scope. */
export async function listFullPostalCitiesFromSupabase(
  companyId?: string | null,
): Promise<PostalCity[]> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const stop = perf.start("postalCities.list.supabase.full");
  perf.count("postalCities.list.supabase.full.calls");
  try {
    let query = supabase
      .from("postal_cities")
      .select("data, company_legacy_id, deleted_at");
    if (companyId !== undefined && companyId !== null) {
      query = query.eq("company_legacy_id", companyId);
    }
    const { data, error } = await query;
    if (error) throw new Error(`[postal_cities] Supabase full list failed: ${error.message}`);
    const rows = (data ?? []) as unknown as PostalCityFullRow[];
    return rows
      .filter((r) => !r.deleted_at)
      .map((r) => r.data)
      .filter((c): c is PostalCity => Boolean(c));
  } finally {
    stop();
  }
}
