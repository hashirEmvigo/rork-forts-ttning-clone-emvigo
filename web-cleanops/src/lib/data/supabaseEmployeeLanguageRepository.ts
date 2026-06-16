/**
 * Supabase-backed Employee Language read repository (AREA-1).
 *
 * The Employee Languages analogue of {@link import("./supabaseTeamRepository")}.
 * Reads the `employee_languages` table (migration 0020) and returns the SAME
 * {@link EmployeeLanguage} shapes the localStorage store returns. Languages are
 * company-scoped (no global rows). Soft-deleted rows (`deleted_at` set) are
 * filtered out (WO-5.6 convention).
 */
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import type { EmployeeLanguage } from "@/types";

const SUMMARY_COLUMNS = "legacy_id, company_legacy_id, code, name, deleted_at";

/** Lightweight language row for count / id-set parity checks. */
export interface EmployeeLanguageSummary {
  id: string;
  companyId: string;
  code: string;
  name: string;
}

interface EmployeeLanguageSummaryRow {
  legacy_id: string;
  company_legacy_id: string;
  code: string;
  name: string;
  deleted_at: string | null;
}

interface EmployeeLanguageFullRow {
  data: EmployeeLanguage;
  company_legacy_id: string;
  deleted_at: string | null;
}

class SupabaseNotConfiguredError extends Error {
  constructor() {
    super(
      "SupabaseEmployeeLanguageRepository requires Supabase. Set " +
        "EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.",
    );
    this.name = "SupabaseNotConfiguredError";
  }
}

function rowToSummary(row: EmployeeLanguageSummaryRow): EmployeeLanguageSummary {
  return {
    id: row.legacy_id,
    companyId: row.company_legacy_id,
    code: row.code,
    name: row.name,
  };
}

/** Company-scoped summary rows. Soft-deleted rows filtered out. */
export async function listEmployeeLanguageSummariesFromSupabase(
  companyId?: string | null,
): Promise<EmployeeLanguageSummary[]> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const stop = perf.start("employeeLanguages.list.supabase.summaries");
  try {
    let query = supabase.from("employee_languages").select(SUMMARY_COLUMNS);
    if (companyId !== undefined && companyId !== null) {
      query = query.eq("company_legacy_id", companyId);
    }
    const { data, error } = await query;
    if (error) throw new Error(`[employee_languages] Supabase list failed: ${error.message}`);
    const rows = (data ?? []) as unknown as EmployeeLanguageSummaryRow[];
    return rows.filter((r) => !r.deleted_at).map(rowToSummary);
  } finally {
    stop();
  }
}

/** FULL language records (lossless `data` jsonb) for a company scope. */
export async function listFullEmployeeLanguagesFromSupabase(
  companyId?: string | null,
): Promise<EmployeeLanguage[]> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const stop = perf.start("employeeLanguages.list.supabase.full");
  perf.count("employeeLanguages.list.supabase.full.calls");
  try {
    let query = supabase
      .from("employee_languages")
      .select("data, company_legacy_id, deleted_at");
    if (companyId !== undefined && companyId !== null) {
      query = query.eq("company_legacy_id", companyId);
    }
    const { data, error } = await query;
    if (error) {
      throw new Error(`[employee_languages] Supabase full list failed: ${error.message}`);
    }
    const rows = (data ?? []) as unknown as EmployeeLanguageFullRow[];
    return rows
      .filter((r) => !r.deleted_at)
      .map((r) => r.data)
      .filter((l): l is EmployeeLanguage => Boolean(l));
  } finally {
    stop();
  }
}
