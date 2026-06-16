/**
 * Supabase-backed Settings Template read repository (SET-1).
 *
 * The settings-templates analogue of
 * {@link import("./supabaseServicePackageRepository")}. Reads the
 * `settings_templates` table (migration 0026) and returns the SAME
 * {@link SettingsTemplate} shapes the localStorage store returns.
 *
 * Templates are ALWAYS global master data (the type carries no companyId), so
 * there is NO company scope — every authenticated user reads the full catalog.
 * Soft-deleted rows (`deleted_at` set) are filtered out.
 */
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import type { SettingsTemplate } from "@/types";

const SUMMARY_COLUMNS = "legacy_id, name, status, deleted_at";

/** Lightweight template row for count / id-set parity checks. */
export interface SettingsTemplateSummary {
  id: string;
  name: string;
}

interface SettingsTemplateSummaryRow {
  legacy_id: string;
  name: string;
  status: string;
  deleted_at: string | null;
}

interface SettingsTemplateFullRow {
  data: SettingsTemplate;
  deleted_at: string | null;
}

class SupabaseNotConfiguredError extends Error {
  constructor() {
    super(
      "SupabaseSettingsTemplateRepository requires Supabase. Set " +
        "EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.",
    );
    this.name = "SupabaseNotConfiguredError";
  }
}

function rowToSummary(row: SettingsTemplateSummaryRow): SettingsTemplateSummary {
  return { id: row.legacy_id, name: row.name };
}

/** Global template summary rows. Soft-deleted rows filtered out. */
export async function listSettingsTemplateSummariesFromSupabase(): Promise<
  SettingsTemplateSummary[]
> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const stop = perf.start("settingsTemplates.list.supabase.summaries");
  try {
    const { data, error } = await supabase.from("settings_templates").select(SUMMARY_COLUMNS);
    if (error) throw new Error(`[settings_templates] Supabase list failed: ${error.message}`);
    const rows = (data ?? []) as unknown as SettingsTemplateSummaryRow[];
    return rows.filter((r) => !r.deleted_at).map(rowToSummary);
  } finally {
    stop();
  }
}

/** FULL template records (lossless `data` jsonb, incl. the SettingsData blob). */
export async function listFullSettingsTemplatesFromSupabase(): Promise<SettingsTemplate[]> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const stop = perf.start("settingsTemplates.list.supabase.full");
  perf.count("settingsTemplates.list.supabase.full.calls");
  try {
    const { data, error } = await supabase
      .from("settings_templates")
      .select("data, deleted_at");
    if (error) {
      throw new Error(`[settings_templates] Supabase full list failed: ${error.message}`);
    }
    const rows = (data ?? []) as unknown as SettingsTemplateFullRow[];
    return rows
      .filter((r) => !r.deleted_at)
      .map((r) => r.data)
      .filter((t): t is SettingsTemplate => Boolean(t));
  } finally {
    stop();
  }
}
