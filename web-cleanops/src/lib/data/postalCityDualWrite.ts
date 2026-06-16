/**
 * Postal City dual-write mirror (AREA-1).
 *
 * The Postal Cities analogue of {@link import("./areaDualWrite")}. localStorage
 * stays the source of truth; when dual-write / authoritative mode is on,
 * AppContext fires {@link mirrorPostalCityWrites} to MIRROR the change into the
 * `postal_cities` table. Never throws, idempotent upsert on `legacy_id`,
 * company-scoped, removal propagation (soft-delete), self-validating.
 */
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import type { PostalCity } from "@/types";
import { loadCompanyUuidMap } from "./customerMigration";
import { toPostalCityUpsertRow, type PostalCityUpsertRow } from "./postalCityMigration";

export type PostalCityWriteField =
  | "legacy_id"
  | "company_legacy_id"
  | "name"
  | "area_legacy_id";

export interface PostalCityWriteMismatch {
  id: string;
  field: PostalCityWriteField | "missing";
  local: string;
  supabase: string;
  at: string;
}

export interface PostalCityWriteDiff {
  created: string[];
  updated: string[];
  removed: string[];
}

export interface PostalCityDualWriteResult {
  ok: boolean;
  noop: boolean;
  diff: PostalCityWriteDiff;
  mirrored: number;
  removed: number;
  skipped: Array<{ id: string; reason: string }>;
  mismatches: PostalCityWriteMismatch[];
  error: string | null;
  durationMs: number;
}

export interface PostalCityDualWriteState {
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
  recentMismatches: PostalCityWriteMismatch[];
}

const MAX_RECENT_MISMATCHES = 50;

const state: PostalCityDualWriteState = {
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

export function getPostalCityDualWriteState(): PostalCityDualWriteState {
  return { ...state, recentMismatches: [...state.recentMismatches] };
}

export function resetPostalCityDualWriteState(): void {
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

function fingerprint(city: PostalCity): string {
  return JSON.stringify(city);
}

function diffCities(prev: PostalCity[], next: PostalCity[]): PostalCityWriteDiff {
  const prevById = new Map(prev.map((c) => [c.id, c]));
  const nextById = new Map(next.map((c) => [c.id, c]));
  const created: string[] = [];
  const updated: string[] = [];
  const removed: string[] = [];

  for (const c of next) {
    const before = prevById.get(c.id);
    if (!before) created.push(c.id);
    else if (fingerprint(before) !== fingerprint(c)) updated.push(c.id);
  }
  for (const c of prev) {
    if (!nextById.has(c.id)) removed.push(c.id);
  }
  return { created, updated, removed };
}

function recordMismatch(m: PostalCityWriteMismatch): void {
  state.mismatches += 1;
  state.recentMismatches.unshift(m);
  if (state.recentMismatches.length > MAX_RECENT_MISMATCHES) {
    state.recentMismatches.length = MAX_RECENT_MISMATCHES;
  }
}

async function validateMirroredRows(
  rows: PostalCityUpsertRow[],
  sourceById: Map<string, PostalCity>,
): Promise<PostalCityWriteMismatch[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  const stop = perf.start("postalCity.write.validation");
  const found: PostalCityWriteMismatch[] = [];
  const at = new Date().toISOString();
  try {
    for (const row of rows) {
      const local = sourceById.get(row.legacy_id);
      if (!local) continue;
      const { data, error } = await supabase
        .from("postal_cities")
        .select("legacy_id, company_legacy_id, name, area_legacy_id")
        .eq("legacy_id", row.legacy_id)
        .maybeSingle();
      state.validations += 1;
      if (error || !data) {
        const m: PostalCityWriteMismatch = {
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
        area_legacy_id: string;
      };
      const checks: Array<[PostalCityWriteField, string, string]> = [
        ["legacy_id", local.id, r.legacy_id],
        ["company_legacy_id", local.companyId, r.company_legacy_id],
        ["name", local.name, r.name],
        ["area_legacy_id", local.areaId, r.area_legacy_id],
      ];
      for (const [field, localVal, supaVal] of checks) {
        if (localVal !== supaVal) {
          const m: PostalCityWriteMismatch = {
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

/** Mirrors a postal-city write (prev → next) into Supabase. */
export async function mirrorPostalCityWrites(
  prev: PostalCity[],
  next: PostalCity[],
): Promise<PostalCityDualWriteResult> {
  const stopDual = perf.start("postalCity.write.dual");
  const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  state.runs += 1;
  state.lastRunAt = new Date().toISOString();

  const diff = diffCities(prev, next);

  const result: PostalCityDualWriteResult = {
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

  const finish = (): PostalCityDualWriteResult => {
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

  const nextById = new Map(next.map((c) => [c.id, c]));
  const stopWrite = perf.start("postalCity.write.supabase");
  try {
    const companyMap = await loadCompanyUuidMap();
    const rows: PostalCityUpsertRow[] = [];
    const sourceById = new Map<string, PostalCity>();
    for (const id of changedIds) {
      const city = nextById.get(id);
      if (!city) continue;
      const uuid = companyMap.get(city.companyId) ?? null;
      if (!uuid) {
        result.skipped.push({
          id,
          reason: `No Supabase company for legacy_id "${city.companyId}". Migrate companies first.`,
        });
        state.skipped += 1;
        continue;
      }
      rows.push(toPostalCityUpsertRow(city, uuid));
      sourceById.set(id, city);
    }

    if (rows.length > 0) {
      const { error } = await supabase
        .from("postal_cities")
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
        .from("postal_cities")
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
    mirrorPostalCityWrites,
    getPostalCityDualWriteState,
    resetPostalCityDualWriteState,
  };
}
