/**
 * Service Package dual-write mirror (SVCCAT-1).
 *
 * The service-packages analogue of {@link import("./serviceCategoryDualWrite")},
 * simplified because packages are ALWAYS global master data (no companyId, so no
 * company mapping and nothing is ever skipped). localStorage stays the source of
 * truth; when dual-write / authoritative mode is on, `persistServicePackages`
 * (AppContext) fires {@link mirrorServicePackageWrites} to MIRROR the change into
 * the `service_packages` table. Never throws, idempotent, removal propagation,
 * self-validating.
 */
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import type { ServicePackage } from "@/types";
import {
  toServicePackageUpsertRow,
  type ServicePackageUpsertRow,
} from "./servicePackageMigration";

export type ServicePackageWriteField = "legacy_id" | "name";

export interface ServicePackageWriteMismatch {
  id: string;
  field: ServicePackageWriteField | "missing";
  local: string;
  supabase: string;
  at: string;
}

export interface ServicePackageWriteDiff {
  created: string[];
  updated: string[];
  removed: string[];
}

export interface ServicePackageDualWriteResult {
  ok: boolean;
  noop: boolean;
  diff: ServicePackageWriteDiff;
  mirrored: number;
  removed: number;
  mismatches: ServicePackageWriteMismatch[];
  error: string | null;
  durationMs: number;
}

export interface ServicePackageDualWriteState {
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
  recentMismatches: ServicePackageWriteMismatch[];
}

const MAX_RECENT_MISMATCHES = 50;

const state: ServicePackageDualWriteState = {
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

export function getServicePackageDualWriteState(): ServicePackageDualWriteState {
  return { ...state, recentMismatches: [...state.recentMismatches] };
}

export function resetServicePackageDualWriteState(): void {
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

function fingerprint(pkg: ServicePackage): string {
  return JSON.stringify(pkg);
}

function diffPackages(
  prev: ServicePackage[],
  next: ServicePackage[],
): ServicePackageWriteDiff {
  const prevById = new Map(prev.map((p) => [p.id, p]));
  const nextById = new Map(next.map((p) => [p.id, p]));
  const created: string[] = [];
  const updated: string[] = [];
  const removed: string[] = [];

  for (const p of next) {
    const before = prevById.get(p.id);
    if (!before) created.push(p.id);
    else if (fingerprint(before) !== fingerprint(p)) updated.push(p.id);
  }
  for (const p of prev) {
    if (!nextById.has(p.id)) removed.push(p.id);
  }
  return { created, updated, removed };
}

function recordMismatch(m: ServicePackageWriteMismatch): void {
  state.mismatches += 1;
  state.recentMismatches.unshift(m);
  if (state.recentMismatches.length > MAX_RECENT_MISMATCHES) {
    state.recentMismatches.length = MAX_RECENT_MISMATCHES;
  }
}

async function validateMirroredRows(
  rows: ServicePackageUpsertRow[],
  sourceById: Map<string, ServicePackage>,
): Promise<ServicePackageWriteMismatch[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  const stop = perf.start("servicePackage.write.validation");
  const found: ServicePackageWriteMismatch[] = [];
  const at = new Date().toISOString();
  try {
    for (const row of rows) {
      const local = sourceById.get(row.legacy_id);
      if (!local) continue;
      const { data, error } = await supabase
        .from("service_packages")
        .select("legacy_id, name")
        .eq("legacy_id", row.legacy_id)
        .maybeSingle();
      state.validations += 1;
      if (error || !data) {
        const m: ServicePackageWriteMismatch = {
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
      const checks: Array<[ServicePackageWriteField, string, string]> = [
        ["legacy_id", local.id, r.legacy_id],
        ["name", local.name, r.name],
      ];
      for (const [field, localVal, supaVal] of checks) {
        if (localVal !== supaVal) {
          const m: ServicePackageWriteMismatch = {
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

/** Mirrors a service-package write (prev → next) into Supabase. */
export async function mirrorServicePackageWrites(
  prev: ServicePackage[],
  next: ServicePackage[],
): Promise<ServicePackageDualWriteResult> {
  const stopDual = perf.start("servicePackage.write.dual");
  const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  state.runs += 1;
  state.lastRunAt = new Date().toISOString();

  const diff = diffPackages(prev, next);

  const result: ServicePackageDualWriteResult = {
    ok: false,
    noop: false,
    diff,
    mirrored: 0,
    removed: 0,
    mismatches: [],
    error: null,
    durationMs: 0,
  };

  const finish = (): ServicePackageDualWriteResult => {
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

  const nextById = new Map(next.map((p) => [p.id, p]));
  const stopWrite = perf.start("servicePackage.write.supabase");
  try {
    const rows: ServicePackageUpsertRow[] = [];
    const sourceById = new Map<string, ServicePackage>();
    for (const id of changedIds) {
      const pkg = nextById.get(id);
      if (!pkg) continue;
      rows.push(toServicePackageUpsertRow(pkg));
      sourceById.set(id, pkg);
    }

    if (rows.length > 0) {
      const { error } = await supabase
        .from("service_packages")
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
        .from("service_packages")
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
    mirrorServicePackageWrites,
    getServicePackageDualWriteState,
    resetServicePackageDualWriteState,
  };
}
