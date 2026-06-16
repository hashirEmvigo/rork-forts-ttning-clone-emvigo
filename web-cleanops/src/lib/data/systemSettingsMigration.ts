/**
 * System Settings migration + shadow-read tooling (SYSSET-1).
 *
 * The System Settings analogue of {@link import("./settingsTemplateMigration")},
 * reduced to a SINGLETON: there is exactly ONE global system-settings record, so
 * the migration is a single idempotent upsert (no company mapping, nothing is
 * ever skipped) and the shadow read is a single detail-parity comparison.
 *
 *   1. `migrateSystemSettings()` — idempotent upsert on `legacy_id` ('global')
 *      into the Supabase `system_settings` table, `dryRun` mode.
 *   2. `shadowReadSystemSettings()` — local-vs-Supabase detail parity for the
 *      single record.
 *
 * localStorage stays the source of truth; these tools only populate + verify.
 */
import { getSystemSettings } from "@/lib/store";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import type { SystemSettings } from "@/types";
import {
  getSystemSettingsFromSupabase,
  SYSTEM_SETTINGS_LEGACY_ID,
} from "./supabaseSystemSettingsRepository";

/** A single upsert row written to (or planned for) `system_settings`. */
export interface SystemSettingsUpsertRow {
  legacy_id: string;
  company_id: string | null;
  company_legacy_id: string | null;
  deleted_at: string | null;
  data: SystemSettings;
}

/** Structured outcome of a system-settings migration run (or dry-run). */
export interface SystemSettingsMigrationReport {
  ok: boolean;
  dryRun: boolean;
  plannedCount: number;
  writtenCount: number;
  error?: string;
}

/** Maps the localStorage {@link SystemSettings} to a `system_settings` row. */
export function toSystemSettingsUpsertRow(settings: SystemSettings): SystemSettingsUpsertRow {
  return {
    legacy_id: SYSTEM_SETTINGS_LEGACY_ID,
    company_id: null,
    company_legacy_id: null,
    deleted_at: null,
    data: settings,
  };
}

/** Migrates the localStorage system-settings record into Supabase. */
export async function migrateSystemSettings(options?: {
  dryRun?: boolean;
}): Promise<SystemSettingsMigrationReport> {
  const dryRun = options?.dryRun ?? false;

  const source = getSystemSettings();
  const report: SystemSettingsMigrationReport = {
    ok: false,
    dryRun,
    plannedCount: 1,
    writtenCount: 0,
  };

  if (!isSupabaseConfigured || !supabase) {
    report.error = "Supabase is not configured.";
    return report;
  }

  if (dryRun) {
    report.ok = true;
    return report;
  }

  try {
    const row = toSystemSettingsUpsertRow(source);
    const { error } = await supabase
      .from("system_settings")
      .upsert([row], { onConflict: "legacy_id" });
    if (error) {
      report.error = `Upsert failed: ${error.message}`;
      return report;
    }
    report.writtenCount = 1;
    report.ok = true;
    return report;
  } catch (err) {
    report.error = err instanceof Error ? err.message : "Unknown migration error.";
    return report;
  }
}

/** Per-aspect outcome of a localStorage-vs-Supabase system-settings comparison. */
export interface SystemSettingsShadowReport {
  ok: boolean;
  presentInSupabase: boolean;
  detailMatch: boolean;
  notes: string[];
}

/** Compares the localStorage system-settings record against the Supabase copy. */
export async function shadowReadSystemSettings(): Promise<SystemSettingsShadowReport> {
  const notes: string[] = [];
  const local = getSystemSettings();

  const report: SystemSettingsShadowReport = {
    ok: false,
    presentInSupabase: false,
    detailMatch: false,
    notes,
  };

  if (!isSupabaseConfigured || !supabase) {
    notes.push("Supabase is not configured.");
    return report;
  }

  let remote: SystemSettings | null;
  try {
    remote = await getSystemSettingsFromSupabase();
  } catch (err) {
    notes.push(err instanceof Error ? err.message : "Supabase read failed.");
    return report;
  }

  if (!remote) {
    notes.push("system settings record not yet in Supabase");
    return report;
  }
  report.presentInSupabase = true;

  report.detailMatch = JSON.stringify(remote) === JSON.stringify(local);
  if (!report.detailMatch) notes.push("detail mismatch for the system-settings record");

  report.ok = report.presentInSupabase && report.detailMatch;
  return report;
}

if (import.meta.env.DEV === true && typeof window !== "undefined") {
  const w = window as unknown as { __cleanopsData?: Record<string, unknown> };
  w.__cleanopsData = {
    ...(w.__cleanopsData ?? {}),
    migrateSystemSettings,
    shadowReadSystemSettings,
  };
}
