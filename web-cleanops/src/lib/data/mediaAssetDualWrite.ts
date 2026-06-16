/**
 * Media Asset dual-write mirror (MEDIA-1).
 *
 * The Media analogue of {@link import("./areaDualWrite")}. localStorage stays
 * the source of truth: every media write completes against localStorage BEFORE
 * this runs. When dual-write / authoritative mode is on, the media store fires
 * {@link mirrorMediaAssetWrites} to MIRROR the change into the `media_assets`
 * table. Never throws, idempotent, company-scoped, soft-delete removal
 * propagation, self-validating.
 */
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import type { MediaAsset } from "@/types";
import { loadCompanyUuidMap } from "./customerMigration";
import { toMediaAssetUpsertRow, type MediaAssetUpsertRow } from "./mediaAssetMigration";

export type MediaAssetWriteField = "legacy_id" | "company_legacy_id" | "category";

export interface MediaAssetWriteMismatch {
  id: string;
  field: MediaAssetWriteField | "missing";
  local: string;
  supabase: string;
  at: string;
}

export interface MediaAssetWriteDiff {
  created: string[];
  updated: string[];
  removed: string[];
}

export interface MediaAssetDualWriteResult {
  ok: boolean;
  noop: boolean;
  diff: MediaAssetWriteDiff;
  mirrored: number;
  removed: number;
  skipped: Array<{ id: string; reason: string }>;
  mismatches: MediaAssetWriteMismatch[];
  error: string | null;
  durationMs: number;
}

export interface MediaAssetDualWriteState {
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
  recentMismatches: MediaAssetWriteMismatch[];
}

const MAX_RECENT_MISMATCHES = 50;

const state: MediaAssetDualWriteState = {
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

export function getMediaAssetDualWriteState(): MediaAssetDualWriteState {
  return { ...state, recentMismatches: [...state.recentMismatches] };
}

export function resetMediaAssetDualWriteState(): void {
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

function fingerprint(asset: MediaAsset): string {
  return JSON.stringify(asset);
}

function diffAssets(prev: MediaAsset[], next: MediaAsset[]): MediaAssetWriteDiff {
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

function recordMismatch(m: MediaAssetWriteMismatch): void {
  state.mismatches += 1;
  state.recentMismatches.unshift(m);
  if (state.recentMismatches.length > MAX_RECENT_MISMATCHES) {
    state.recentMismatches.length = MAX_RECENT_MISMATCHES;
  }
}

async function validateMirroredRows(
  rows: MediaAssetUpsertRow[],
  sourceById: Map<string, MediaAsset>,
): Promise<MediaAssetWriteMismatch[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  const stop = perf.start("mediaAsset.write.validation");
  const found: MediaAssetWriteMismatch[] = [];
  const at = new Date().toISOString();
  try {
    for (const row of rows) {
      const local = sourceById.get(row.legacy_id);
      if (!local) continue;
      const { data, error } = await supabase
        .from("media_assets")
        .select("legacy_id, company_legacy_id, category")
        .eq("legacy_id", row.legacy_id)
        .maybeSingle();
      state.validations += 1;
      if (error || !data) {
        const m: MediaAssetWriteMismatch = {
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
        category: string;
      };
      const checks: Array<[MediaAssetWriteField, string, string]> = [
        ["legacy_id", local.id, r.legacy_id],
        ["company_legacy_id", local.companyId, r.company_legacy_id],
        ["category", local.category, r.category],
      ];
      for (const [field, localVal, supaVal] of checks) {
        if (localVal !== supaVal) {
          const m: MediaAssetWriteMismatch = {
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

/** Mirrors a media-asset write (prev → next) into Supabase. */
export async function mirrorMediaAssetWrites(
  prev: MediaAsset[],
  next: MediaAsset[],
): Promise<MediaAssetDualWriteResult> {
  const stopDual = perf.start("mediaAsset.write.dual");
  const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  state.runs += 1;
  state.lastRunAt = new Date().toISOString();

  const diff = diffAssets(prev, next);

  const result: MediaAssetDualWriteResult = {
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

  const finish = (): MediaAssetDualWriteResult => {
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
  const stopWrite = perf.start("mediaAsset.write.supabase");
  try {
    const companyMap = await loadCompanyUuidMap();
    const rows: MediaAssetUpsertRow[] = [];
    const sourceById = new Map<string, MediaAsset>();
    for (const id of changedIds) {
      const asset = nextById.get(id);
      if (!asset) continue;
      const uuid = companyMap.get(asset.companyId) ?? null;
      if (!uuid) {
        result.skipped.push({
          id,
          reason: `No Supabase company for legacy_id "${asset.companyId}". Migrate companies first.`,
        });
        state.skipped += 1;
        continue;
      }
      rows.push(toMediaAssetUpsertRow(asset, uuid));
      sourceById.set(id, asset);
    }

    if (rows.length > 0) {
      const { error } = await supabase
        .from("media_assets")
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
        .from("media_assets")
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
    mirrorMediaAssetWrites,
    getMediaAssetDualWriteState,
    resetMediaAssetDualWriteState,
  };
}
