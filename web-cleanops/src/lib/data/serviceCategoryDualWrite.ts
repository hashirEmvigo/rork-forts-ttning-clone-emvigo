/**
 * Service Category dual-write mirror (SVCCAT-1).
 *
 * The service-categories analogue of {@link import("./serviceDualWrite")}.
 * localStorage stays the source of truth: every category write completes against
 * localStorage BEFORE this runs. When dual-write / authoritative mode is on,
 * `persistServiceCategories` (AppContext) fires {@link mirrorServiceCategoryWrites}
 * to MIRROR the change into the `service_categories` table.
 *
 * Guarantees (identical to the proven service mirror): never throws, idempotent
 * upsert on `legacy_id`, company-scoped (global rows carry company_id = null),
 * removal propagation (soft-delete), self-validating post-write.
 */
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import type { ServiceCategory } from "@/types";
import { loadCompanyUuidMap } from "./customerMigration";
import {
  toServiceCategoryUpsertRow,
  type ServiceCategoryUpsertRow,
} from "./serviceCategoryMigration";

export type ServiceCategoryWriteField = "legacy_id" | "company_legacy_id" | "name";

/**
 * Identity/scope of the user firing the mirror. Used to exclude rows the writer
 * is not allowed to upsert under RLS (global rows and cross-company rows), which
 * would otherwise poison the whole batched upsert and roll back the writer's own
 * legitimate company-scoped row. When omitted, no scope filtering is applied
 * (legacy behaviour, e.g. super-admin migration tooling).
 */
export interface MirrorWriterScope {
  /** The writer's company legacy id; null for global/super-admin scope. */
  companyId: string | null;
  /** True when the writer is a super_admin (may mirror global + any scope). */
  isSuperAdmin: boolean;
}

export interface ServiceCategoryWriteMismatch {
  id: string;
  field: ServiceCategoryWriteField | "missing";
  local: string;
  supabase: string;
  at: string;
}

export interface ServiceCategoryWriteDiff {
  created: string[];
  updated: string[];
  removed: string[];
}

export interface ServiceCategoryDualWriteResult {
  ok: boolean;
  noop: boolean;
  diff: ServiceCategoryWriteDiff;
  mirrored: number;
  removed: number;
  skipped: Array<{ id: string; reason: string }>;
  mismatches: ServiceCategoryWriteMismatch[];
  error: string | null;
  durationMs: number;
}

export interface ServiceCategoryDualWriteState {
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
  recentMismatches: ServiceCategoryWriteMismatch[];
}

const MAX_RECENT_MISMATCHES = 50;

const state: ServiceCategoryDualWriteState = {
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

export function getServiceCategoryDualWriteState(): ServiceCategoryDualWriteState {
  return { ...state, recentMismatches: [...state.recentMismatches] };
}

export function resetServiceCategoryDualWriteState(): void {
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

function fingerprint(category: ServiceCategory): string {
  return JSON.stringify(category);
}

function diffCategories(
  prev: ServiceCategory[],
  next: ServiceCategory[],
): ServiceCategoryWriteDiff {
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

function recordMismatch(m: ServiceCategoryWriteMismatch): void {
  state.mismatches += 1;
  state.recentMismatches.unshift(m);
  if (state.recentMismatches.length > MAX_RECENT_MISMATCHES) {
    state.recentMismatches.length = MAX_RECENT_MISMATCHES;
  }
}

async function validateMirroredRows(
  rows: ServiceCategoryUpsertRow[],
  sourceById: Map<string, ServiceCategory>,
): Promise<ServiceCategoryWriteMismatch[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  const stop = perf.start("serviceCategory.write.validation");
  const found: ServiceCategoryWriteMismatch[] = [];
  const at = new Date().toISOString();
  try {
    for (const row of rows) {
      const local = sourceById.get(row.legacy_id);
      if (!local) continue;
      const { data, error } = await supabase
        .from("service_categories")
        .select("legacy_id, company_legacy_id, name")
        .eq("legacy_id", row.legacy_id)
        .maybeSingle();
      state.validations += 1;
      if (error || !data) {
        const m: ServiceCategoryWriteMismatch = {
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
        company_legacy_id: string | null;
        name: string;
      };
      const checks: Array<[ServiceCategoryWriteField, string, string]> = [
        ["legacy_id", local.id, r.legacy_id],
        ["company_legacy_id", local.companyId ?? "", r.company_legacy_id ?? ""],
        ["name", local.name, r.name],
      ];
      for (const [field, localVal, supaVal] of checks) {
        if (localVal !== supaVal) {
          const m: ServiceCategoryWriteMismatch = {
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

/** Mirrors a service-category write (prev → next) into Supabase. */
export async function mirrorServiceCategoryWrites(
  prev: ServiceCategory[],
  next: ServiceCategory[],
  writer?: MirrorWriterScope,
): Promise<ServiceCategoryDualWriteResult> {
  const stopDual = perf.start("serviceCategory.write.dual");
  const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  state.runs += 1;
  state.lastRunAt = new Date().toISOString();

  const diff = diffCategories(prev, next);

  const result: ServiceCategoryDualWriteResult = {
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

  const finish = (): ServiceCategoryDualWriteResult => {
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
  const prevById = new Map(prev.map((c) => [c.id, c]));
  const scopeGuard = writer && !writer.isSuperAdmin;
  const stopWrite = perf.start("serviceCategory.write.supabase");
  try {
    const companyMap = await loadCompanyUuidMap();
    const rows: ServiceCategoryUpsertRow[] = [];
    const sourceById = new Map<string, ServiceCategory>();
    for (const id of changedIds) {
      const category = nextById.get(id);
      if (!category) continue;
      // Writer-scope guard: a non-super-admin may only mirror rows in their own
      // company scope. Global/cross-company rows would be rejected by RLS and
      // poison the batched upsert, so exclude them and record as skipped.
      if (scopeGuard && category.companyId !== writer.companyId) {
        result.skipped.push({
          id,
          reason: `Writer scope "${writer.companyId ?? "global"}" may not mirror row in scope "${category.companyId ?? "global"}".`,
        });
        state.skipped += 1;
        continue;
      }
      if (category.companyId === null) {
        rows.push(toServiceCategoryUpsertRow(category, null));
        sourceById.set(id, category);
        continue;
      }
      const uuid = companyMap.get(category.companyId) ?? null;
      if (!uuid) {
        result.skipped.push({
          id,
          reason: `No Supabase company for legacy_id "${category.companyId}". Migrate companies first.`,
        });
        state.skipped += 1;
        continue;
      }
      rows.push(toServiceCategoryUpsertRow(category, uuid));
      sourceById.set(id, category);
    }

    if (rows.length > 0) {
      const { error } = await supabase
        .from("service_categories")
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

    let removedIds = diff.removed;
    if (scopeGuard) {
      const allowed: string[] = [];
      for (const id of diff.removed) {
        const before = prevById.get(id);
        if (before && before.companyId === writer.companyId) {
          allowed.push(id);
        } else {
          result.skipped.push({
            id,
            reason: `Writer scope "${writer.companyId ?? "global"}" may not soft-delete row in scope "${before?.companyId ?? "global"}".`,
          });
          state.skipped += 1;
        }
      }
      removedIds = allowed;
    }

    if (removedIds.length > 0) {
      const { error } = await supabase
        .from("service_categories")
        .update({ deleted_at: new Date().toISOString() })
        .in("legacy_id", removedIds);
      if (error) {
        state.failures += 1;
        state.lastError = error.message;
        result.error = `Supabase soft-delete failed: ${error.message}`;
        return finish();
      }
      result.removed = removedIds.length;
      state.removed += removedIds.length;
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
    mirrorServiceCategoryWrites,
    getServiceCategoryDualWriteState,
    resetServiceCategoryDualWriteState,
  };
}
