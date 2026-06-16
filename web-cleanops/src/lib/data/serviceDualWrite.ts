/**
 * Service dual-write mirror (SVC-3).
 *
 * The Services analogue of {@link import("./teamDualWrite")}, with GLOBAL-service
 * handling added (a service can be Super Admin global, companyId === null).
 * localStorage stays the source of truth: every service write completes against
 * localStorage BEFORE this module runs. When dual-write / authoritative mode is
 * on, `persistServices` (AppContext) fires {@link mirrorServiceWrites} in the
 * background to MIRROR the same change into the Supabase `services` table.
 *
 * Guarantees (identical to the proven team mirror):
 *   • Never throws — always invoked fire-and-forget; a Supabase failure can never
 *     break a service operation.
 *   • Idempotent — upsert on the unique `legacy_id`; repeated saves never inflate.
 *   • Company-scoped — company rows carry the real `company_id` UUID RLS checks;
 *     GLOBAL rows carry `company_id = null`; company rows whose company has no
 *     Supabase mapping are skipped + surfaced.
 *   • Removal propagation — a service gone from `next` is SOFT-deleted in Supabase
 *     (`deleted_at` set) so no stale service survives the cut-over.
 *   • Self-validating — after mirroring, it re-reads the affected rows and compares
 *     the critical fields, recording any drift (never silently hidden).
 *
 * All runtime state lives in {@link getServiceDualWriteState}.
 */
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import type { Service } from "@/types";
import { loadCompanyUuidMap } from "./customerMigration";
import { toServiceUpsertRow, type ServiceUpsertRow } from "./serviceMigration";

/** Critical fields validated after every mirrored write. */
export type ServiceWriteField = "legacy_id" | "company_legacy_id" | "name";

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

/** A single field-level discrepancy found while validating a mirrored write. */
export interface ServiceWriteMismatch {
  id: string;
  field: ServiceWriteField | "missing";
  local: string;
  supabase: string;
  at: string;
}

/** The classification of changes a single mirror operation carried. */
export interface ServiceWriteDiff {
  created: string[];
  updated: string[];
  /** Ids present before but gone after — soft-deleted in Supabase. */
  removed: string[];
}

/** Structured outcome of one {@link mirrorServiceWrites} run. */
export interface ServiceDualWriteResult {
  ok: boolean;
  /** True when nothing changed between prev/next (no Supabase work done). */
  noop: boolean;
  diff: ServiceWriteDiff;
  /** Rows actually upserted to Supabase. */
  mirrored: number;
  /** Rows soft-deleted in Supabase (removal propagation). */
  removed: number;
  /** Source services skipped (no company mapping / RLS would reject). */
  skipped: Array<{ id: string; reason: string }>;
  /** Field-level mismatches found by the post-write validation. */
  mismatches: ServiceWriteMismatch[];
  /** Fatal error captured (never thrown to the caller). */
  error: string | null;
  /** Total wall-clock duration of the mirror, milliseconds. */
  durationMs: number;
}

/** Live, cumulative dual-write metrics (development instrumentation only). */
export interface ServiceDualWriteState {
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
  recentMismatches: ServiceWriteMismatch[];
}

const MAX_RECENT_MISMATCHES = 50;

const state: ServiceDualWriteState = {
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

/** Returns an immutable snapshot of the cumulative dual-write metrics. */
export function getServiceDualWriteState(): ServiceDualWriteState {
  return { ...state, recentMismatches: [...state.recentMismatches] };
}

/** Clears the cumulative dual-write metrics (used by tests + the dev console). */
export function resetServiceDualWriteState(): void {
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

function fingerprint(service: Service): string {
  return JSON.stringify(service);
}

/** Classifies prev → next into created / updated / removed id sets. */
function diffServices(prev: Service[], next: Service[]): ServiceWriteDiff {
  const prevById = new Map(prev.map((s) => [s.id, s]));
  const nextById = new Map(next.map((s) => [s.id, s]));
  const created: string[] = [];
  const updated: string[] = [];
  const removed: string[] = [];

  for (const s of next) {
    const before = prevById.get(s.id);
    if (!before) created.push(s.id);
    else if (fingerprint(before) !== fingerprint(s)) updated.push(s.id);
  }
  for (const s of prev) {
    if (!nextById.has(s.id)) removed.push(s.id);
  }
  return { created, updated, removed };
}

function recordMismatch(m: ServiceWriteMismatch): void {
  state.mismatches += 1;
  state.recentMismatches.unshift(m);
  if (state.recentMismatches.length > MAX_RECENT_MISMATCHES) {
    state.recentMismatches.length = MAX_RECENT_MISMATCHES;
  }
}

/**
 * Re-reads each mirrored row from Supabase and compares the critical fields
 * against the authoritative localStorage record. Read-only; records drift but
 * never throws. Returns the mismatches found this run.
 */
async function validateMirroredRows(
  rows: ServiceUpsertRow[],
  sourceById: Map<string, Service>,
): Promise<ServiceWriteMismatch[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  const stop = perf.start("service.write.validation");
  const found: ServiceWriteMismatch[] = [];
  const at = new Date().toISOString();
  try {
    for (const row of rows) {
      const local = sourceById.get(row.legacy_id);
      if (!local) continue;
      const { data, error } = await supabase
        .from("services")
        .select("legacy_id, company_legacy_id, name")
        .eq("legacy_id", row.legacy_id)
        .maybeSingle();
      state.validations += 1;
      if (error || !data) {
        const m: ServiceWriteMismatch = {
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
      const checks: Array<[ServiceWriteField, string, string]> = [
        ["legacy_id", local.id, r.legacy_id],
        // null (global) normalised to "" on both sides so it compares equal.
        ["company_legacy_id", local.companyId ?? "", r.company_legacy_id ?? ""],
        ["name", local.name, r.name],
      ];
      for (const [field, localVal, supaVal] of checks) {
        if (localVal !== supaVal) {
          const m: ServiceWriteMismatch = {
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

/**
 * Mirrors a service write (prev → next) into Supabase.
 *
 * Always call fire-and-forget AFTER the authoritative localStorage write has
 * completed. localStorage is never affected by this function; it only upserts the
 * changed rows into the `services` table, soft-deletes removed rows, and validates
 * the result.
 *
 * @param prev The services array BEFORE the write (authoritative previous state).
 * @param next The services array AFTER the write (now persisted to localStorage).
 */
export async function mirrorServiceWrites(
  prev: Service[],
  next: Service[],
  writer?: MirrorWriterScope,
): Promise<ServiceDualWriteResult> {
  const stopDual = perf.start("service.write.dual");
  const startedAt =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  state.runs += 1;
  state.lastRunAt = new Date().toISOString();

  const diff = diffServices(prev, next);

  const result: ServiceDualWriteResult = {
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

  const finish = (): ServiceDualWriteResult => {
    stopDual();
    result.durationMs =
      (typeof performance !== "undefined" ? performance.now() : Date.now()) -
      startedAt;
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

  const nextById = new Map(next.map((s) => [s.id, s]));
  const prevById = new Map(prev.map((s) => [s.id, s]));
  const scopeGuard = writer && !writer.isSuperAdmin;
  const stopWrite = perf.start("service.write.supabase");
  try {
    const companyMap = await loadCompanyUuidMap();
    const rows: ServiceUpsertRow[] = [];
    const sourceById = new Map<string, Service>();
    for (const id of changedIds) {
      const service = nextById.get(id);
      if (!service) continue;
      // Writer-scope guard: a non-super-admin may only mirror rows in their own
      // company scope. Global/cross-company rows would be rejected by RLS and
      // poison the batched upsert, so exclude them and record as skipped.
      if (scopeGuard && service.companyId !== writer.companyId) {
        result.skipped.push({
          id,
          reason: `Writer scope "${writer.companyId ?? "global"}" may not mirror row in scope "${service.companyId ?? "global"}".`,
        });
        state.skipped += 1;
        continue;
      }
      // GLOBAL service (Super Admin catalog) → company_id null, never skipped.
      if (service.companyId === null) {
        rows.push(toServiceUpsertRow(service, null));
        sourceById.set(id, service);
        continue;
      }
      const uuid = companyMap.get(service.companyId) ?? null;
      if (!uuid) {
        result.skipped.push({
          id,
          reason: `No Supabase company for legacy_id "${service.companyId}". Migrate companies first.`,
        });
        state.skipped += 1;
        continue;
      }
      rows.push(toServiceUpsertRow(service, uuid));
      sourceById.set(id, service);
    }

    if (rows.length > 0) {
      const { error } = await supabase
        .from("services")
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

    // Removal propagation (WO-5.6 convention): soft-delete the removed rows so no
    // stale service survives. A failure here is recorded but never blocks the op.
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
        .from("services")
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

    // Post-write parity validation — surfaces drift, never blocks anything.
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

// Expose a console handle in development for manual inspection.
if (import.meta.env.DEV === true && typeof window !== "undefined") {
  const w = window as unknown as { __cleanopsData?: Record<string, unknown> };
  w.__cleanopsData = {
    ...(w.__cleanopsData ?? {}),
    mirrorServiceWrites,
    getServiceDualWriteState,
    resetServiceDualWriteState,
  };
}
