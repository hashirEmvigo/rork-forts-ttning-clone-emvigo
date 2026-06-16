/**
 * Company Settings dual-write mirror (SET-1).
 *
 * The company-settings analogue of {@link import("./areaDualWrite")}. A record's
 * identity is its companyId, so `legacy_id == companyId`. localStorage stays the
 * source of truth; when dual-write / authoritative mode is on,
 * `persistCompanySettings` (AppContext) fires {@link mirrorCompanySettingsWrites}
 * to MIRROR the change into the `company_settings` table. Never throws,
 * idempotent, company-scoped, removal propagation, self-validating.
 */
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import type { CompanySettings } from "@/types";
import { loadCompanyUuidMap } from "./customerMigration";
import {
  toCompanySettingsUpsertRow,
  type CompanySettingsUpsertRow,
} from "./companySettingsMigration";

export type CompanySettingsWriteField = "legacy_id" | "company_legacy_id";

export interface CompanySettingsWriteMismatch {
  id: string;
  field: CompanySettingsWriteField | "missing";
  local: string;
  supabase: string;
  at: string;
}

export interface CompanySettingsWriteDiff {
  created: string[];
  updated: string[];
  removed: string[];
}

export interface CompanySettingsDualWriteResult {
  ok: boolean;
  noop: boolean;
  diff: CompanySettingsWriteDiff;
  mirrored: number;
  removed: number;
  skipped: Array<{ id: string; reason: string }>;
  mismatches: CompanySettingsWriteMismatch[];
  error: string | null;
  durationMs: number;
}

export interface CompanySettingsDualWriteState {
  runs: number;
  noops: number;
  created: number;
  updated: number;
  removed: number;
  skipped: number;
  validations: number;
  mismatches: number;
  failures: number;
  lastError: string | null;
  lastRunAt: string | null;
  recentMismatches: CompanySettingsWriteMismatch[];
}

const MAX_RECENT_MISMATCHES = 50;

const state: CompanySettingsDualWriteState = {
  runs: 0,
  noops: 0,
  created: 0,
  updated: 0,
  removed: 0,
  skipped: 0,
  validations: 0,
  mismatches: 0,
  failures: 0,
  lastError: null,
  lastRunAt: null,
  recentMismatches: [],
};

export function getCompanySettingsDualWriteState(): CompanySettingsDualWriteState {
  return { ...state, recentMismatches: [...state.recentMismatches] };
}

export function resetCompanySettingsDualWriteState(): void {
  state.runs = 0;
  state.noops = 0;
  state.created = 0;
  state.updated = 0;
  state.removed = 0;
  state.skipped = 0;
  state.validations = 0;
  state.mismatches = 0;
  state.failures = 0;
  state.lastError = null;
  state.lastRunAt = null;
  state.recentMismatches = [];
}

function fingerprint(settings: CompanySettings): string {
  return JSON.stringify(settings);
}

function diffCompanySettings(
  prev: CompanySettings[],
  next: CompanySettings[],
): CompanySettingsWriteDiff {
  const prevById = new Map(prev.map((s) => [s.companyId, s]));
  const nextById = new Map(next.map((s) => [s.companyId, s]));
  const created: string[] = [];
  const updated: string[] = [];
  const removed: string[] = [];

  for (const s of next) {
    const before = prevById.get(s.companyId);
    if (!before) created.push(s.companyId);
    else if (fingerprint(before) !== fingerprint(s)) updated.push(s.companyId);
  }
  for (const s of prev) {
    if (!nextById.has(s.companyId)) removed.push(s.companyId);
  }
  return { created, updated, removed };
}

function recordMismatch(m: CompanySettingsWriteMismatch): void {
  state.mismatches += 1;
  state.recentMismatches.unshift(m);
  if (state.recentMismatches.length > MAX_RECENT_MISMATCHES) {
    state.recentMismatches.length = MAX_RECENT_MISMATCHES;
  }
}

async function validateMirroredRows(
  rows: CompanySettingsUpsertRow[],
  sourceById: Map<string, CompanySettings>,
): Promise<CompanySettingsWriteMismatch[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  const stop = perf.start("companySettings.write.validation");
  const found: CompanySettingsWriteMismatch[] = [];
  const at = new Date().toISOString();
  try {
    for (const row of rows) {
      const local = sourceById.get(row.legacy_id);
      if (!local) continue;
      const { data, error } = await supabase
        .from("company_settings")
        .select("legacy_id, company_legacy_id")
        .eq("legacy_id", row.legacy_id)
        .maybeSingle();
      state.validations += 1;
      if (error || !data) {
        const m: CompanySettingsWriteMismatch = {
          id: row.legacy_id,
          field: "missing",
          local: local.companyId,
          supabase: error ? `error: ${error.message}` : "no row",
          at,
        };
        found.push(m);
        recordMismatch(m);
        continue;
      }
      const r = data as unknown as { legacy_id: string; company_legacy_id: string };
      const checks: Array<[CompanySettingsWriteField, string, string]> = [
        ["legacy_id", local.companyId, r.legacy_id],
        ["company_legacy_id", local.companyId, r.company_legacy_id],
      ];
      for (const [field, localVal, supaVal] of checks) {
        if (localVal !== supaVal) {
          const m: CompanySettingsWriteMismatch = {
            id: row.legacy_id,
            field,
            local: localVal,
            supabase: supaVal,
            at,
          };
          found.push(m);
          recordMismatch(m);
        }
      }
    }
    return found;
  } finally {
    stop();
  }
}

/** Mirrors a company-settings write (prev → next) into Supabase. */
export async function mirrorCompanySettingsWrites(
  prev: CompanySettings[],
  next: CompanySettings[],
): Promise<CompanySettingsDualWriteResult> {
  const stopDual = perf.start("companySettings.write.dual");
  const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  state.runs += 1;
  state.lastRunAt = new Date().toISOString();

  const diff = diffCompanySettings(prev, next);

  const result: CompanySettingsDualWriteResult = {
    ok: false,
    noop: false,
    diff,
    mirrored: 0,
    removed: 0,
    skipped: [],
    mismatches: [],
    error: null,
    durationMs: 0,
  };

  const finish = (): CompanySettingsDualWriteResult => {
    stopDual();
    result.durationMs =
      (typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt;
    return result;
  };

  const changedIds = [...diff.created, ...diff.updated];
  if (changedIds.length === 0 && diff.removed.length === 0) {
    state.noops += 1;
    result.ok = true;
    result.noop = true;
    return finish();
  }

  if (!isSupabaseConfigured || !supabase) {
    state.failures += 1;
    state.lastError = "Supabase is not configured.";
    result.error = "Supabase is not configured.";
    return finish();
  }

  const nextById = new Map(next.map((s) => [s.companyId, s]));
  const stopWrite = perf.start("companySettings.write.supabase");
  try {
    const companyMap = await loadCompanyUuidMap();
    const rows: CompanySettingsUpsertRow[] = [];
    const sourceById = new Map<string, CompanySettings>();
    for (const id of changedIds) {
      const settings = nextById.get(id);
      if (!settings) continue;
      const uuid = companyMap.get(settings.companyId) ?? null;
      if (!uuid) {
        result.skipped.push({
          id,
          reason: `No Supabase company for legacy_id "${settings.companyId}". Migrate companies first.`,
        });
        state.skipped += 1;
        continue;
      }
      rows.push(toCompanySettingsUpsertRow(settings, uuid));
      sourceById.set(id, settings);
    }

    if (rows.length > 0) {
      const { error } = await supabase
        .from("company_settings")
        .upsert(rows, { onConflict: "legacy_id" });
      if (error) {
        state.failures += 1;
        state.lastError = error.message;
        result.error = `Supabase upsert failed: ${error.message}`;
        return finish();
      }
      result.mirrored = rows.length;
      const createdSet = new Set(diff.created);
      for (const row of rows) {
        if (createdSet.has(row.legacy_id)) state.created += 1;
        else state.updated += 1;
      }
    }

    if (diff.removed.length > 0) {
      const { error } = await supabase
        .from("company_settings")
        .update({ deleted_at: new Date().toISOString() })
        .in("legacy_id", diff.removed);
      if (error) {
        state.failures += 1;
        state.lastError = error.message;
        result.error = `Supabase soft-delete failed: ${error.message}`;
        return finish();
      }
      result.removed = diff.removed.length;
      state.removed += diff.removed.length;
    }

    stopWrite();

    result.mismatches = await validateMirroredRows(rows, sourceById);
    result.ok =
      result.error === null &&
      result.skipped.length === 0 &&
      result.mismatches.length === 0;
    return finish();
  } catch (err) {
    stopWrite();
    state.failures += 1;
    state.lastError = err instanceof Error ? err.message : "Unknown mirror error.";
    result.error = state.lastError;
    return finish();
  }
}

if (import.meta.env.DEV === true && typeof window !== "undefined") {
  const w = window as unknown as { __cleanopsData?: Record<string, unknown> };
  w.__cleanopsData = {
    ...(w.__cleanopsData ?? {}),
    mirrorCompanySettingsWrites,
    getCompanySettingsDualWriteState,
    resetCompanySettingsDualWriteState,
  };
}
