/**
 * Settings Template dual-write mirror (SET-1).
 *
 * The settings-templates analogue of {@link import("./servicePackageDualWrite")},
 * simplified because templates are ALWAYS global master data (no companyId, so no
 * company mapping and nothing is ever skipped). localStorage stays the source of
 * truth; when dual-write / authoritative mode is on, `persistSettingsTemplates`
 * (AppContext) fires {@link mirrorSettingsTemplateWrites} to MIRROR the change
 * into the `settings_templates` table. Never throws, idempotent, removal
 * propagation, self-validating.
 */
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import type { SettingsTemplate } from "@/types";
import {
  toSettingsTemplateUpsertRow,
  type SettingsTemplateUpsertRow,
} from "./settingsTemplateMigration";

export type SettingsTemplateWriteField = "legacy_id" | "name";

export interface SettingsTemplateWriteMismatch {
  id: string;
  field: SettingsTemplateWriteField | "missing";
  local: string;
  supabase: string;
  at: string;
}

export interface SettingsTemplateWriteDiff {
  created: string[];
  updated: string[];
  removed: string[];
}

export interface SettingsTemplateDualWriteResult {
  ok: boolean;
  noop: boolean;
  diff: SettingsTemplateWriteDiff;
  mirrored: number;
  removed: number;
  mismatches: SettingsTemplateWriteMismatch[];
  error: string | null;
  durationMs: number;
}

export interface SettingsTemplateDualWriteState {
  runs: number;
  noops: number;
  created: number;
  updated: number;
  removed: number;
  validations: number;
  mismatches: number;
  failures: number;
  lastError: string | null;
  lastRunAt: string | null;
  recentMismatches: SettingsTemplateWriteMismatch[];
}

const MAX_RECENT_MISMATCHES = 50;

const state: SettingsTemplateDualWriteState = {
  runs: 0,
  noops: 0,
  created: 0,
  updated: 0,
  removed: 0,
  validations: 0,
  mismatches: 0,
  failures: 0,
  lastError: null,
  lastRunAt: null,
  recentMismatches: [],
};

export function getSettingsTemplateDualWriteState(): SettingsTemplateDualWriteState {
  return { ...state, recentMismatches: [...state.recentMismatches] };
}

export function resetSettingsTemplateDualWriteState(): void {
  state.runs = 0;
  state.noops = 0;
  state.created = 0;
  state.updated = 0;
  state.removed = 0;
  state.validations = 0;
  state.mismatches = 0;
  state.failures = 0;
  state.lastError = null;
  state.lastRunAt = null;
  state.recentMismatches = [];
}

function fingerprint(template: SettingsTemplate): string {
  return JSON.stringify(template);
}

function diffTemplates(
  prev: SettingsTemplate[],
  next: SettingsTemplate[],
): SettingsTemplateWriteDiff {
  const prevById = new Map(prev.map((t) => [t.id, t]));
  const nextById = new Map(next.map((t) => [t.id, t]));
  const created: string[] = [];
  const updated: string[] = [];
  const removed: string[] = [];

  for (const t of next) {
    const before = prevById.get(t.id);
    if (!before) created.push(t.id);
    else if (fingerprint(before) !== fingerprint(t)) updated.push(t.id);
  }
  for (const t of prev) {
    if (!nextById.has(t.id)) removed.push(t.id);
  }
  return { created, updated, removed };
}

function recordMismatch(m: SettingsTemplateWriteMismatch): void {
  state.mismatches += 1;
  state.recentMismatches.unshift(m);
  if (state.recentMismatches.length > MAX_RECENT_MISMATCHES) {
    state.recentMismatches.length = MAX_RECENT_MISMATCHES;
  }
}

async function validateMirroredRows(
  rows: SettingsTemplateUpsertRow[],
  sourceById: Map<string, SettingsTemplate>,
): Promise<SettingsTemplateWriteMismatch[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  const stop = perf.start("settingsTemplate.write.validation");
  const found: SettingsTemplateWriteMismatch[] = [];
  const at = new Date().toISOString();
  try {
    for (const row of rows) {
      const local = sourceById.get(row.legacy_id);
      if (!local) continue;
      const { data, error } = await supabase
        .from("settings_templates")
        .select("legacy_id, name")
        .eq("legacy_id", row.legacy_id)
        .maybeSingle();
      state.validations += 1;
      if (error || !data) {
        const m: SettingsTemplateWriteMismatch = {
          id: row.legacy_id,
          field: "missing",
          local: local.id,
          supabase: error ? `error: ${error.message}` : "no row",
          at,
        };
        found.push(m);
        recordMismatch(m);
        continue;
      }
      const r = data as unknown as { legacy_id: string; name: string };
      const checks: Array<[SettingsTemplateWriteField, string, string]> = [
        ["legacy_id", local.id, r.legacy_id],
        ["name", local.name, r.name],
      ];
      for (const [field, localVal, supaVal] of checks) {
        if (localVal !== supaVal) {
          const m: SettingsTemplateWriteMismatch = {
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

/** Mirrors a settings-template write (prev → next) into Supabase. */
export async function mirrorSettingsTemplateWrites(
  prev: SettingsTemplate[],
  next: SettingsTemplate[],
): Promise<SettingsTemplateDualWriteResult> {
  const stopDual = perf.start("settingsTemplate.write.dual");
  const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  state.runs += 1;
  state.lastRunAt = new Date().toISOString();

  const diff = diffTemplates(prev, next);

  const result: SettingsTemplateDualWriteResult = {
    ok: false,
    noop: false,
    diff,
    mirrored: 0,
    removed: 0,
    mismatches: [],
    error: null,
    durationMs: 0,
  };

  const finish = (): SettingsTemplateDualWriteResult => {
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

  const nextById = new Map(next.map((t) => [t.id, t]));
  const stopWrite = perf.start("settingsTemplate.write.supabase");
  try {
    const rows: SettingsTemplateUpsertRow[] = [];
    const sourceById = new Map<string, SettingsTemplate>();
    for (const id of changedIds) {
      const template = nextById.get(id);
      if (!template) continue;
      rows.push(toSettingsTemplateUpsertRow(template));
      sourceById.set(id, template);
    }

    if (rows.length > 0) {
      const { error } = await supabase
        .from("settings_templates")
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
        .from("settings_templates")
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
    result.ok = result.error === null && result.mismatches.length === 0;
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
    mirrorSettingsTemplateWrites,
    getSettingsTemplateDualWriteState,
    resetSettingsTemplateDualWriteState,
  };
}
