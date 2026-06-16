/**
 * Service Entitlements dual-write mirror (ENT-1).
 *
 * The Entitlements analogue of {@link import("./areaDualWrite")}, spanning the
 * three entitlement stores. localStorage stays the source of truth: every
 * entitlement write completes against localStorage BEFORE this runs. When
 * dual-write / authoritative mode is on, AppContext fires the matching mirror to
 * MIRROR the change into Supabase:
 *
 *   • mirrorGlobalEntitlementWrites   — upsert + soft-delete removal
 *   • mirrorCompanyEntitlementWrites  — upsert + soft-delete removal
 *   • mirrorEntitlementLogAppend      — append-only insert (immutable trail)
 *
 * Guarantees (identical to the proven area mirror): never throws, idempotent
 * upsert on `legacy_id`, self-validating post-write counters.
 */
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import type {
  ServiceGlobalEntitlement,
  CompanyServiceEntitlement,
  ServiceEntitlementLogEntry,
} from "@/types";
import { loadCompanyUuidMap } from "./customerMigration";
import {
  companyEntitlementLegacyId,
  toGlobalEntitlementUpsertRow,
  toCompanyEntitlementUpsertRow,
  toEntitlementLogUpsertRow,
} from "./entitlementMigration";

export interface EntitlementDualWriteState {
  runs: number;
  noops: number;
  globalMirrored: number;
  companyMirrored: number;
  logMirrored: number;
  removed: number;
  skipped: number;
  failures: number;
  lastError: string | null;
  lastRunAt: string | null;
}

const state: EntitlementDualWriteState = {
  runs: 0,
  noops: 0,
  globalMirrored: 0,
  companyMirrored: 0,
  logMirrored: 0,
  removed: 0,
  skipped: 0,
  failures: 0,
  lastError: null,
  lastRunAt: null,
};

export function getEntitlementDualWriteState(): EntitlementDualWriteState {
  return { ...state };
}

export function resetEntitlementDualWriteState(): void {
  state.runs = 0;
  state.noops = 0;
  state.globalMirrored = 0;
  state.companyMirrored = 0;
  state.logMirrored = 0;
  state.removed = 0;
  state.skipped = 0;
  state.failures = 0;
  state.lastError = null;
  state.lastRunAt = null;
}

export interface EntitlementDualWriteResult {
  ok: boolean;
  noop: boolean;
  mirrored: number;
  removed: number;
  skipped: Array<{ id: string; reason: string }>;
  error: string | null;
}

function diffByKey<T>(
  prev: T[],
  next: T[],
  keyOf: (item: T) => string,
): { changed: T[]; removed: string[] } {
  const prevByKey = new Map(prev.map((i) => [keyOf(i), i]));
  const nextByKey = new Map(next.map((i) => [keyOf(i), i]));
  const changed: T[] = [];
  const removed: string[] = [];
  for (const item of next) {
    const before = prevByKey.get(keyOf(item));
    if (!before || JSON.stringify(before) !== JSON.stringify(item)) changed.push(item);
  }
  for (const item of prev) {
    if (!nextByKey.has(keyOf(item))) removed.push(keyOf(item));
  }
  return { changed, removed };
}

function startRun(): void {
  state.runs += 1;
  state.lastRunAt = new Date().toISOString();
}

function fail(result: EntitlementDualWriteResult, message: string): EntitlementDualWriteResult {
  state.failures += 1;
  state.lastError = message;
  result.error = message;
  return result;
}

/** Mirrors a global-entitlement write (prev → next) into Supabase. */
export async function mirrorGlobalEntitlementWrites(
  prev: ServiceGlobalEntitlement[],
  next: ServiceGlobalEntitlement[],
): Promise<EntitlementDualWriteResult> {
  const stop = perf.start("entitlement.global.write.dual");
  startRun();
  const result: EntitlementDualWriteResult = {
    ok: false,
    noop: false,
    mirrored: 0,
    removed: 0,
    skipped: [],
    error: null,
  };
  try {
    const { changed, removed } = diffByKey(prev, next, (g) => g.serviceKey);
    if (changed.length === 0 && removed.length === 0) {
      state.noops += 1;
      result.ok = true;
      result.noop = true;
      return result;
    }
    if (!isSupabaseConfigured || !supabase) return fail(result, "Supabase is not configured.");

    if (changed.length > 0) {
      const rows = changed.map(toGlobalEntitlementUpsertRow);
      const { error } = await supabase
        .from("service_global_entitlements")
        .upsert(rows, { onConflict: "legacy_id" });
      if (error) return fail(result, `Global upsert failed: ${error.message}`);
      result.mirrored = rows.length;
      state.globalMirrored += rows.length;
    }
    if (removed.length > 0) {
      const { error } = await supabase
        .from("service_global_entitlements")
        .update({ deleted_at: new Date().toISOString() })
        .in("legacy_id", removed);
      if (error) return fail(result, `Global soft-delete failed: ${error.message}`);
      result.removed = removed.length;
      state.removed += removed.length;
    }
    result.ok = true;
    return result;
  } catch (err) {
    return fail(result, err instanceof Error ? err.message : "Unknown mirror error.");
  } finally {
    stop();
  }
}

/** Mirrors a company-entitlement write (prev → next) into Supabase. */
export async function mirrorCompanyEntitlementWrites(
  prev: CompanyServiceEntitlement[],
  next: CompanyServiceEntitlement[],
): Promise<EntitlementDualWriteResult> {
  const stop = perf.start("entitlement.company.write.dual");
  startRun();
  const result: EntitlementDualWriteResult = {
    ok: false,
    noop: false,
    mirrored: 0,
    removed: 0,
    skipped: [],
    error: null,
  };
  const keyOf = (c: CompanyServiceEntitlement): string =>
    companyEntitlementLegacyId(c.companyId, c.serviceKey);
  try {
    const { changed, removed } = diffByKey(prev, next, keyOf);
    if (changed.length === 0 && removed.length === 0) {
      state.noops += 1;
      result.ok = true;
      result.noop = true;
      return result;
    }
    if (!isSupabaseConfigured || !supabase) return fail(result, "Supabase is not configured.");

    const companyMap = await loadCompanyUuidMap();
    const rows = [];
    for (const c of changed) {
      const uuid = companyMap.get(c.companyId) ?? null;
      if (!uuid) {
        result.skipped.push({
          id: keyOf(c),
          reason: `No Supabase company for legacy_id "${c.companyId}". Migrate companies first.`,
        });
        state.skipped += 1;
        continue;
      }
      rows.push(toCompanyEntitlementUpsertRow(c, uuid));
    }
    if (rows.length > 0) {
      const { error } = await supabase
        .from("company_service_entitlements")
        .upsert(rows, { onConflict: "legacy_id" });
      if (error) return fail(result, `Company upsert failed: ${error.message}`);
      result.mirrored = rows.length;
      state.companyMirrored += rows.length;
    }
    if (removed.length > 0) {
      const { error } = await supabase
        .from("company_service_entitlements")
        .update({ deleted_at: new Date().toISOString() })
        .in("legacy_id", removed);
      if (error) return fail(result, `Company soft-delete failed: ${error.message}`);
      result.removed = removed.length;
      state.removed += removed.length;
    }
    result.ok = result.skipped.length === 0;
    return result;
  } catch (err) {
    return fail(result, err instanceof Error ? err.message : "Unknown mirror error.");
  } finally {
    stop();
  }
}

/**
 * Mirrors newly-appended entitlement-log entries into Supabase (append-only).
 * The log is immutable: only entries present in `next` but not `prev` are
 * inserted. Idempotent upsert on `legacy_id` makes re-runs safe.
 */
export async function mirrorEntitlementLogAppend(
  prev: ServiceEntitlementLogEntry[],
  next: ServiceEntitlementLogEntry[],
): Promise<EntitlementDualWriteResult> {
  const stop = perf.start("entitlement.log.write.dual");
  startRun();
  const result: EntitlementDualWriteResult = {
    ok: false,
    noop: false,
    mirrored: 0,
    removed: 0,
    skipped: [],
    error: null,
  };
  try {
    const prevIds = new Set(prev.map((l) => l.id));
    const added = next.filter((l) => !prevIds.has(l.id));
    if (added.length === 0) {
      state.noops += 1;
      result.ok = true;
      result.noop = true;
      return result;
    }
    if (!isSupabaseConfigured || !supabase) return fail(result, "Supabase is not configured.");

    const companyMap = await loadCompanyUuidMap();
    const rows = [];
    for (const l of added) {
      const uuid = l.companyId ? companyMap.get(l.companyId) ?? null : null;
      if (l.companyId && !uuid) {
        result.skipped.push({
          id: l.id,
          reason: `No Supabase company for log legacy_id "${l.companyId}".`,
        });
        state.skipped += 1;
        continue;
      }
      rows.push(toEntitlementLogUpsertRow(l, uuid));
    }
    if (rows.length > 0) {
      const { error } = await supabase
        .from("service_entitlement_log")
        .upsert(rows, { onConflict: "legacy_id" });
      if (error) return fail(result, `Log insert failed: ${error.message}`);
      result.mirrored = rows.length;
      state.logMirrored += rows.length;
    }
    result.ok = result.skipped.length === 0;
    return result;
  } catch (err) {
    return fail(result, err instanceof Error ? err.message : "Unknown mirror error.");
  } finally {
    stop();
  }
}

if (import.meta.env.DEV === true && typeof window !== "undefined") {
  const w = window as unknown as { __cleanopsData?: Record<string, unknown> };
  w.__cleanopsData = {
    ...(w.__cleanopsData ?? {}),
    mirrorGlobalEntitlementWrites,
    mirrorCompanyEntitlementWrites,
    mirrorEntitlementLogAppend,
    getEntitlementDualWriteState,
    resetEntitlementDualWriteState,
  };
}
