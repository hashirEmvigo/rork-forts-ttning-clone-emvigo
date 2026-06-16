/**
 * Module-domain dual-write mirror (MOD-1).
 *
 * localStorage stays the source of truth: every module write completes against
 * localStorage BEFORE this runs. When dual-write / authoritative mode is on, the
 * store fires the matching mirror. Three independent mirrors share one telemetry
 * state object:
 *   • {@link mirrorModuleWrites}        — global modules.
 *   • {@link mirrorModuleCategoryWrites} — global categories.
 *   • {@link mirrorCompanyModuleWrites} — company-scoped config (needs company
 *     UUID mapping; rows whose company has no Supabase row are skipped).
 * Never throws, idempotent upsert on `legacy_id`, soft-delete removal propagation.
 */
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import type { Module, ModuleCategory, CompanyModuleSetting } from "@/types";
import { loadCompanyUuidMap } from "./customerMigration";
import {
  toModuleUpsertRow,
  toModuleCategoryUpsertRow,
  toCompanyModuleUpsertRow,
  companyModuleLegacyId,
} from "./moduleMigration";

export interface ModuleWriteDiff {
  created: string[];
  updated: string[];
  removed: string[];
}

export interface ModuleDualWriteResult {
  ok: boolean;
  noop: boolean;
  table: string;
  diff: ModuleWriteDiff;
  mirrored: number;
  removed: number;
  skipped: Array<{ id: string; reason: string }>;
  error: string | null;
  durationMs: number;
}

export interface ModuleDualWriteState {
  runs: number;
  noops: number;
  created: number;
  updated: number;
  removed: number;
  skipped: number;
  failures: number;
  lastError: string | null;
  lastRunAt: string | null;
}

const state: ModuleDualWriteState = {
  runs: 0,
  noops: 0,
  created: 0,
  updated: 0,
  removed: 0,
  skipped: 0,
  failures: 0,
  lastError: null,
  lastRunAt: null,
};

export function getModuleDualWriteState(): ModuleDualWriteState {
  return { ...state };
}

export function resetModuleDualWriteState(): void {
  state.runs = 0;
  state.noops = 0;
  state.created = 0;
  state.updated = 0;
  state.removed = 0;
  state.skipped = 0;
  state.failures = 0;
  state.lastError = null;
  state.lastRunAt = null;
}

function diffById<T>(
  prev: T[],
  next: T[],
  idOf: (item: T) => string,
): ModuleWriteDiff {
  const prevById = new Map(prev.map((i) => [idOf(i), i]));
  const nextById = new Map(next.map((i) => [idOf(i), i]));
  const created: string[] = [];
  const updated: string[] = [];
  const removed: string[] = [];
  for (const i of next) {
    const id = idOf(i);
    const before = prevById.get(id);
    if (!before) created.push(id);
    else if (JSON.stringify(before) !== JSON.stringify(i)) updated.push(id);
  }
  for (const i of prev) {
    if (!nextById.has(idOf(i))) removed.push(idOf(i));
  }
  return { created, updated, removed };
}

function emptyResult(table: string, diff: ModuleWriteDiff): ModuleDualWriteResult {
  return {
    ok: false,
    noop: false,
    table,
    diff,
    mirrored: 0,
    removed: 0,
    skipped: [],
    error: null,
    durationMs: 0,
  };
}

async function runMirror(
  table: string,
  diff: ModuleWriteDiff,
  buildRows: () => Promise<{
    rows: Array<Record<string, unknown>>;
    skipped: Array<{ id: string; reason: string }>;
  }>,
): Promise<ModuleDualWriteResult> {
  const stopDual = perf.start(`module.write.dual.${table}`);
  const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  state.runs += 1;
  state.lastRunAt = new Date().toISOString();

  const result = emptyResult(table, diff);
  const finish = (): ModuleDualWriteResult => {
    stopDual();
    result.durationMs =
      (typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt;
    return result;
  };

  if (diff.created.length + diff.updated.length === 0 && diff.removed.length === 0) {
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

  try {
    const { rows, skipped } = await buildRows();
    result.skipped = skipped;
    state.skipped += skipped.length;

    if (rows.length > 0) {
      const { error } = await supabase.from(table).upsert(rows, { onConflict: "legacy_id" });
      if (error) {
        state.failures += 1;
        state.lastError = error.message;
        result.error = `Supabase upsert failed: ${error.message}`;
        return finish();
      }
      result.mirrored = rows.length;
      const createdSet = new Set(diff.created);
      for (const row of rows) {
        if (createdSet.has(String(row.legacy_id))) state.created += 1;
        else state.updated += 1;
      }
    }

    if (diff.removed.length > 0) {
      const { error } = await supabase
        .from(table)
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

    result.ok = result.error === null && result.skipped.length === 0;
    return finish();
  } catch (err) {
    state.failures += 1;
    state.lastError = err instanceof Error ? err.message : "Unknown mirror error.";
    result.error = state.lastError;
    return finish();
  }
}

/** Mirrors a global modules write (prev → next). */
export async function mirrorModuleWrites(
  prev: Module[],
  next: Module[],
): Promise<ModuleDualWriteResult> {
  const diff = diffById(prev, next, (m) => m.id);
  const nextById = new Map(next.map((m) => [m.id, m]));
  return runMirror("modules", diff, async () => ({
    rows: [...diff.created, ...diff.updated]
      .map((id) => nextById.get(id))
      .filter((m): m is Module => Boolean(m))
      .map(toModuleUpsertRow) as unknown as Array<Record<string, unknown>>,
    skipped: [],
  }));
}

/** Mirrors a global module-categories write (prev → next). */
export async function mirrorModuleCategoryWrites(
  prev: ModuleCategory[],
  next: ModuleCategory[],
): Promise<ModuleDualWriteResult> {
  const diff = diffById(prev, next, (c) => c.id);
  const nextById = new Map(next.map((c) => [c.id, c]));
  return runMirror("module_categories", diff, async () => ({
    rows: [...diff.created, ...diff.updated]
      .map((id) => nextById.get(id))
      .filter((c): c is ModuleCategory => Boolean(c))
      .map(toModuleCategoryUpsertRow) as unknown as Array<Record<string, unknown>>,
    skipped: [],
  }));
}

/** Mirrors a company-modules config write (prev → next), mapping company UUIDs. */
export async function mirrorCompanyModuleWrites(
  prev: CompanyModuleSetting[],
  next: CompanyModuleSetting[],
): Promise<ModuleDualWriteResult> {
  const diff = diffById(prev, next, companyModuleLegacyId);
  const nextById = new Map(next.map((s) => [companyModuleLegacyId(s), s]));
  return runMirror("company_modules", diff, async () => {
    const companyMap = await loadCompanyUuidMap();
    const rows: Array<Record<string, unknown>> = [];
    const skipped: Array<{ id: string; reason: string }> = [];
    for (const id of [...diff.created, ...diff.updated]) {
      const setting = nextById.get(id);
      if (!setting) continue;
      const uuid = companyMap.get(setting.companyId) ?? null;
      if (!uuid) {
        skipped.push({
          id,
          reason: `No Supabase company for legacy_id "${setting.companyId}". Migrate companies first.`,
        });
        continue;
      }
      rows.push(
        toCompanyModuleUpsertRow(setting, uuid) as unknown as Record<string, unknown>,
      );
    }
    return { rows, skipped };
  });
}

if (import.meta.env.DEV === true && typeof window !== "undefined") {
  const w = window as unknown as { __cleanopsData?: Record<string, unknown> };
  w.__cleanopsData = {
    ...(w.__cleanopsData ?? {}),
    mirrorModuleWrites,
    mirrorModuleCategoryWrites,
    mirrorCompanyModuleWrites,
    getModuleDualWriteState,
    resetModuleDualWriteState,
  };
}
