/**
 * Supabase-backed System Settings read repository (SYSSET-1).
 *
 * The System Settings analogue of
 * {@link import("./supabaseSettingsTemplateRepository")}, but reduced to a
 * SINGLETON: there is exactly ONE global system-settings record for the whole
 * installation (the type carries no companyId). Reads the `system_settings`
 * table (migration 0030) and returns the SAME normalized {@link SystemSettings}
 * shape the localStorage store returns (rebuilt losslessly from the `data`
 * jsonb), so the read seam can swap it in with no UI change.
 *
 * Soft-deleted rows (`deleted_at` set) are filtered out (WO-5.6 convention),
 * though the singleton is never soft-deleted in practice.
 */
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import { normalizeSystemSettings, type SystemSettings } from "@/types";

/** Constant app-facing id for the singleton system-settings record. */
export const SYSTEM_SETTINGS_LEGACY_ID = "global";

interface SystemSettingsFullRow {
  data: SystemSettings;
  deleted_at: string | null;
}

class SupabaseNotConfiguredError extends Error {
  constructor() {
    super(
      "SupabaseSystemSettingsRepository requires Supabase. Set " +
        "EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.",
    );
    this.name = "SupabaseNotConfiguredError";
  }
}

/**
 * Reads the single global system-settings record from Supabase, returning the
 * normalized {@link SystemSettings} (lossless `data` jsonb) or `null` when no
 * row exists yet (pre-migration) so the read seam can keep the local seed.
 */
export async function getSystemSettingsFromSupabase(): Promise<SystemSettings | null> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const stop = perf.start("systemSettings.get.supabase");
  perf.count("systemSettings.get.supabase.calls");
  try {
    const { data, error } = await supabase
      .from("system_settings")
      .select("data, deleted_at")
      .eq("legacy_id", SYSTEM_SETTINGS_LEGACY_ID)
      .maybeSingle();
    if (error) throw new Error(`[system_settings] Supabase read failed: ${error.message}`);
    const row = (data ?? null) as unknown as SystemSettingsFullRow | null;
    if (!row || row.deleted_at || !row.data) return null;
    return normalizeSystemSettings(row.data);
  } finally {
    stop();
  }
}
