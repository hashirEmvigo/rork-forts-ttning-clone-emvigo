/**
 * System Settings dual-write mirror (SYSSET-1).
 *
 * The System Settings analogue of {@link import("./settingsTemplateDualWrite")},
 * reduced to a SINGLETON: there is exactly ONE global system-settings record, so
 * the mirror is a single upsert fired whenever the record changes. localStorage
 * stays the source of truth: every system-settings write completes against
 * localStorage BEFORE this runs. When dual-write / authoritative mode is on,
 * `updateSystemSettings` (AppContext) fires {@link mirrorSystemSettingsWrite} to
 * MIRROR the change into the `system_settings` table.
 *
 * Guarantees (identical to the proven mirrors): never throws, idempotent upsert
 * on `legacy_id`, self-validating post-write counters, recorded failures.
 */
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import type { SystemSettings } from "@/types";
import {
  toSystemSettingsUpsertRow,
  type SystemSettingsUpsertRow,
} from "./systemSettingsMigration";
import { SYSTEM_SETTINGS_LEGACY_ID } from "./supabaseSystemSettingsRepository";

export interface SystemSettingsDualWriteState {
  runs: number;
  noops: number;
  mirrored: number;
  validations: number;
  mismatches: number;
  failures: number;
  lastError: string | null;
  lastRunAt: string | null;
}

const state: SystemSettingsDualWriteState = {
  runs: 0,
  noops: 0,
  mirrored: 0,
  validations: 0,
  mismatches: 0,
  failures: 0,
  lastError: null,
  lastRunAt: null,
};

export function getSystemSettingsDualWriteState(): SystemSettingsDualWriteState {
  return { ...state };
}

export function resetSystemSettingsDualWriteState(): void {
  state.runs = 0;
  state.noops = 0;
  state.mirrored = 0;
  state.validations = 0;
  state.mismatches = 0;
  state.failures = 0;
  state.lastError = null;
  state.lastRunAt = null;
}

export interface SystemSettingsDualWriteResult {
  ok: boolean;
  noop: boolean;
  mirrored: number;
  mismatch: boolean;
  error: string | null;
}

/**
 * Mirrors a system-settings write (prev → next) into Supabase. A no-op when the
 * record is byte-identical. After the upsert it validates the round-trip by
 * re-reading the row and comparing the lossless `data` payload.
 */
export async function mirrorSystemSettingsWrite(
  prev: SystemSettings | null,
  next: SystemSettings,
): Promise<SystemSettingsDualWriteResult> {
  const stop = perf.start("systemSettings.write.dual");
  state.runs += 1;
  state.lastRunAt = new Date().toISOString();

  const result: SystemSettingsDualWriteResult = {
    ok: false,
    noop: false,
    mirrored: 0,
    mismatch: false,
    error: null,
  };

  const fail = (message: string): SystemSettingsDualWriteResult => {
    state.failures += 1;
    state.lastError = message;
    result.error = message;
    return result;
  };

  try {
    if (prev && JSON.stringify(prev) === JSON.stringify(next)) {
      state.noops += 1;
      result.ok = true;
      result.noop = true;
      return result;
    }

    if (!isSupabaseConfigured || !supabase) return fail("Supabase is not configured.");

    const row: SystemSettingsUpsertRow = toSystemSettingsUpsertRow(next);
    const { error } = await supabase
      .from("system_settings")
      .upsert([row], { onConflict: "legacy_id" });
    if (error) return fail(`Supabase upsert failed: ${error.message}`);
    result.mirrored = 1;
    state.mirrored += 1;

    // Self-validation: re-read the row and compare the lossless payload.
    const { data, error: readError } = await supabase
      .from("system_settings")
      .select("data")
      .eq("legacy_id", SYSTEM_SETTINGS_LEGACY_ID)
      .maybeSingle();
    state.validations += 1;
    if (readError || !data) {
      result.mismatch = true;
      state.mismatches += 1;
      return fail(readError ? `validation read failed: ${readError.message}` : "no row after upsert");
    }
    const remote = (data as unknown as { data: SystemSettings }).data;
    if (JSON.stringify(remote) !== JSON.stringify(next)) {
      result.mismatch = true;
      state.mismatches += 1;
      state.lastError = "post-write payload mismatch";
      result.error = "post-write payload mismatch";
      return result;
    }

    result.ok = true;
    return result;
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Unknown mirror error.");
  } finally {
    stop();
  }
}

if (import.meta.env.DEV === true && typeof window !== "undefined") {
  const w = window as unknown as { __cleanopsData?: Record<string, unknown> };
  w.__cleanopsData = {
    ...(w.__cleanopsData ?? {}),
    mirrorSystemSettingsWrite,
    getSystemSettingsDualWriteState,
    resetSystemSettingsDualWriteState,
  };
}
