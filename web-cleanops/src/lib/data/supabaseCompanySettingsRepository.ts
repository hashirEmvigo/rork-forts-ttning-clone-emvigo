/**
 * Supabase-backed Company Settings read repository (SET-1).
 *
 * The company-settings analogue of {@link import("./supabaseAreaRepository")}.
 * Reads the `company_settings` table (migration 0026) and returns the SAME
 * {@link CompanySettings} shapes the localStorage store returns.
 *
 * Each company has exactly ONE settings record; its identity IS the companyId,
 * so `legacy_id == company_legacy_id`. When a company scope is supplied this
 * repository returns that company's record; unscoped returns all RLS-visible
 * rows. Soft-deleted rows (`deleted_at` set) are filtered out.
 */
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import type { CompanySettings } from "@/types";

const SUMMARY_COLUMNS = "legacy_id, company_legacy_id, initialized, deleted_at";

/** Lightweight company-settings row for count / id-set parity checks. */
export interface CompanySettingsSummary {
  id: string;
  companyId: string;
  initialized: boolean;
}

interface CompanySettingsSummaryRow {
  legacy_id: string;
  company_legacy_id: string;
  initialized: boolean;
  deleted_at: string | null;
}

interface CompanySettingsFullRow {
  data: CompanySettings;
  company_legacy_id: string;
  deleted_at: string | null;
}

class SupabaseNotConfiguredError extends Error {
  constructor() {
    super(
      "SupabaseCompanySettingsRepository requires Supabase. Set " +
        "EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.",
    );
    this.name = "SupabaseNotConfiguredError";
  }
}

function rowToSummary(row: CompanySettingsSummaryRow): CompanySettingsSummary {
  return {
    id: row.legacy_id,
    companyId: row.company_legacy_id,
    initialized: row.initialized,
  };
}

/** Company-scoped summary rows. Soft-deleted rows filtered out. */
export async function listCompanySettingsSummariesFromSupabase(
  companyId?: string | null,
): Promise<CompanySettingsSummary[]> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const stop = perf.start("companySettings.list.supabase.summaries");
  try {
    let query = supabase.from("company_settings").select(SUMMARY_COLUMNS);
    if (companyId !== undefined && companyId !== null) {
      query = query.eq("company_legacy_id", companyId);
    }
    const { data, error } = await query;
    if (error) throw new Error(`[company_settings] Supabase list failed: ${error.message}`);
    const rows = (data ?? []) as unknown as CompanySettingsSummaryRow[];
    return rows.filter((r) => !r.deleted_at).map(rowToSummary);
  } finally {
    stop();
  }
}

/** FULL company-settings records (lossless `data` jsonb) for a company scope. */
export async function listFullCompanySettingsFromSupabase(
  companyId?: string | null,
): Promise<CompanySettings[]> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const stop = perf.start("companySettings.list.supabase.full");
  perf.count("companySettings.list.supabase.full.calls");
  try {
    let query = supabase.from("company_settings").select("data, company_legacy_id, deleted_at");
    if (companyId !== undefined && companyId !== null) {
      query = query.eq("company_legacy_id", companyId);
    }
    const { data, error } = await query;
    if (error) throw new Error(`[company_settings] Supabase full list failed: ${error.message}`);
    const rows = (data ?? []) as unknown as CompanySettingsFullRow[];
    return rows
      .filter((r) => !r.deleted_at)
      .map((r) => r.data)
      .filter((s): s is CompanySettings => Boolean(s));
  } finally {
    stop();
  }
}
