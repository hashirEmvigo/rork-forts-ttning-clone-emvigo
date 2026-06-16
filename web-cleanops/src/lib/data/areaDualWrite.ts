/**
 * Area dual-write mirror (AREA-1).
 *
 * The Areas analogue of {@link import("./teamDualWrite")}. localStorage stays the
 * source of truth: every area write completes against localStorage BEFORE this
 * runs. When dual-write / authoritative mode is on, AppContext fires
 * {@link mirrorAreaWrites} to MIRROR the change into the `areas` table.
 *
 * Guarantees (identical to the proven team mirror): never throws, idempotent
 * upsert on `legacy_id`, company-scoped, removal propagation (soft-delete),
 * self-validating post-write.
 */
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import type { Area } from "@/types";
import { loadCompanyUuidMap } from "./customerMigration";
import { toAreaUpsertRow, type AreaUpsertRow } from "./areaMigration";

export type AreaWriteField = "legacy_id" | "company_legacy_id" | "name";

export interface AreaWriteMismatch {
  id: string;
  field: AreaWriteField | "missing";
  local: string;
  supabase: string;
  at: string;
}

export interface AreaWriteDiff {
  created: string[];
  updated: string[];
  removed: string[];
}

export interface AreaDualWriteResult {
  ok: boolean;
  noop: boolean;
  diff: AreaWriteDiff;
  mirrored: number;
  removed: number;
  skipped: Array<{ id: string; reason: string }>;
  mismatches: AreaWriteMismatch[];
  error: string | null;
  durationMs: number;
}

export interface AreaDualWriteState {
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
  recentMismatches: AreaWriteMismatch[];
}

const MAX_RECENT_MISMATCHES = 50;

const state: AreaDualWriteState = {
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

export function getAreaDualWriteState(): AreaDualWriteState {
  return { ...state, recentMismatches: [...state.recentMismatches] };
}

export function resetAreaDualWriteState(): void {
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

function fingerprint(area: Area): string {
  return JSON.stringify(area);
}

function diffAreas(prev: Area[], next: Area[]): AreaWriteDiff {
  const prevById = new Map(prev.map((a) => [a.id, a]));
  const nextById = new Map(next.map((a) => [a.id, a]));
  const created: string[] = [];
  const updated: string[] = [];
  const removed: string[] = [];

  for (const a of next) {
    const before = prevById.get(a.id);
    if (!before) created.push(a.id);
    else if (fingerprint(before) !== fingerprint(a)) updated.push(a.id);
  }
  for (const a of prev) {
    if (!nextById.has(a.id)) removed.push(a.id);
  }
  return { created, updated, removed };
}

function recordMismatch(m: AreaWriteMismatch): void {
  state.mismatches += 1;
  state.recentMismatches.unshift(m);
  if (state.recentMismatches.length > MAX_RECENT_MISMATCHES) {
    state.recentMismatches.length = MAX_RECENT_MISMATCHES;
  }
}

async function validateMirroredRows(
  rows: AreaUpsertRow[],
  sourceById: Map<string, Area>,
): Promise<AreaWriteMismatch[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  const stop = perf.start("area.write.validation");
  const found: AreaWriteMismatch[] = [];
  const at = new Date().toISOString();
  try {
    for (const row of rows) {
      const local = sourceById.get(row.legacy_id);
      if (!local) continue;
      const { data, error } = await supabase
        .from("areas")
        .select("legacy_id, company_legacy_id, name")
        .eq("legacy_id", row.legacy_id)
        .maybeSingle();
      state.validations += 1;
      if (error || !data) {
        const m: AreaWriteMismatch = {
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
      const r = data as unknown as {
        legacy_id: string;
        company_legacy_id: string;
        name: string;
      };
      const checks: Array<[AreaWriteField, string, string]> = [
        ["legacy_id", local.id, r.legacy_id],
        ["company_legacy_id", local.companyId, r.company_legacy_id],
        ["name", local.name, r.name],
      ];
      for (const [field, localVal, supaVal] of checks) {
        if (localVal !== supaVal) {
          const m: AreaWriteMismatch = {
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

/** Mirrors an area write (prev → next) into Supabase. */
export async function mirrorAreaWrites(
  prev: Area[],
  next: Area[],
): Promise<AreaDualWriteResult> {
  const stopDual = perf.start("area.write.dual");
  const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  state.runs += 1;
  state.lastRunAt = new Date().toISOString();

  const diff = diffAreas(prev, next);

  const result: AreaDualWriteResult = {
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

  const finish = (): AreaDualWriteResult => {
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

  const nextById = new Map(next.map((a) => [a.id, a]));
  const stopWrite = perf.start("area.write.supabase");
  try {
    const companyMap = await loadCompanyUuidMap();
    const rows: AreaUpsertRow[] = [];
    const sourceById = new Map<string, Area>();
    for (const id of changedIds) {
      const area = nextById.get(id);
      if (!area) continue;
      const uuid = companyMap.get(area.companyId) ?? null;
      if (!uuid) {
        result.skipped.push({
          id,
          reason: `No Supabase company for legacy_id "${area.companyId}". Migrate companies first.`,
        });
        state.skipped += 1;
        continue;
      }
      rows.push(toAreaUpsertRow(area, uuid));
      sourceById.set(id, area);
    }

    if (rows.length > 0) {
      const { error } = await supabase.from("areas").upsert(rows, { onConflict: "legacy_id" });
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
        .from("areas")
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
    mirrorAreaWrites,
    getAreaDualWriteState,
    resetAreaDualWriteState,
  };
}
