/**
 * Payroll Group dual-write mirror (SVCCAT-1).
 *
 * The payroll-groups analogue of {@link import("./serviceCategoryDualWrite")}.
 * localStorage stays the source of truth; when dual-write / authoritative mode
 * is on, `persistPayrollGroups` (AppContext) fires {@link mirrorPayrollGroupWrites}
 * to MIRROR the change into the `payroll_groups` table. Never throws, idempotent,
 * company-scoped (global rows carry company_id = null), removal propagation,
 * self-validating.
 */
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import type { PayrollGroup } from "@/types";
import { loadCompanyUuidMap } from "./customerMigration";
import {
  toPayrollGroupUpsertRow,
  type PayrollGroupUpsertRow,
} from "./payrollGroupMigration";

export type PayrollGroupWriteField = "legacy_id" | "company_legacy_id" | "name";

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

export interface PayrollGroupWriteMismatch {
  id: string;
  field: PayrollGroupWriteField | "missing";
  local: string;
  supabase: string;
  at: string;
}

export interface PayrollGroupWriteDiff {
  created: string[];
  updated: string[];
  removed: string[];
}

export interface PayrollGroupDualWriteResult {
  ok: boolean;
  noop: boolean;
  diff: PayrollGroupWriteDiff;
  mirrored: number;
  removed: number;
  skipped: Array<{ id: string; reason: string }>;
  mismatches: PayrollGroupWriteMismatch[];
  error: string | null;
  durationMs: number;
}

export interface PayrollGroupDualWriteState {
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
  recentMismatches: PayrollGroupWriteMismatch[];
}

const MAX_RECENT_MISMATCHES = 50;

const state: PayrollGroupDualWriteState = {
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

export function getPayrollGroupDualWriteState(): PayrollGroupDualWriteState {
  return { ...state, recentMismatches: [...state.recentMismatches] };
}

export function resetPayrollGroupDualWriteState(): void {
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

function fingerprint(group: PayrollGroup): string {
  return JSON.stringify(group);
}

function diffGroups(prev: PayrollGroup[], next: PayrollGroup[]): PayrollGroupWriteDiff {
  const prevById = new Map(prev.map((g) => [g.id, g]));
  const nextById = new Map(next.map((g) => [g.id, g]));
  const created: string[] = [];
  const updated: string[] = [];
  const removed: string[] = [];

  for (const g of next) {
    const before = prevById.get(g.id);
    if (!before) created.push(g.id);
    else if (fingerprint(before) !== fingerprint(g)) updated.push(g.id);
  }
  for (const g of prev) {
    if (!nextById.has(g.id)) removed.push(g.id);
  }
  return { created, updated, removed };
}

function recordMismatch(m: PayrollGroupWriteMismatch): void {
  state.mismatches += 1;
  state.recentMismatches.unshift(m);
  if (state.recentMismatches.length > MAX_RECENT_MISMATCHES) {
    state.recentMismatches.length = MAX_RECENT_MISMATCHES;
  }
}

async function validateMirroredRows(
  rows: PayrollGroupUpsertRow[],
  sourceById: Map<string, PayrollGroup>,
): Promise<PayrollGroupWriteMismatch[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  const stop = perf.start("payrollGroup.write.validation");
  const found: PayrollGroupWriteMismatch[] = [];
  const at = new Date().toISOString();
  try {
    for (const row of rows) {
      const local = sourceById.get(row.legacy_id);
      if (!local) continue;
      const { data, error } = await supabase
        .from("payroll_groups")
        .select("legacy_id, company_legacy_id, name")
        .eq("legacy_id", row.legacy_id)
        .maybeSingle();
      state.validations += 1;
      if (error || !data) {
        const m: PayrollGroupWriteMismatch = {
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
      const checks: Array<[PayrollGroupWriteField, string, string]> = [
        ["legacy_id", local.id, r.legacy_id],
        ["company_legacy_id", local.companyId ?? "", r.company_legacy_id ?? ""],
        ["name", local.name, r.name],
      ];
      for (const [field, localVal, supaVal] of checks) {
        if (localVal !== supaVal) {
          const m: PayrollGroupWriteMismatch = {
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

/** Mirrors a payroll-group write (prev → next) into Supabase. */
export async function mirrorPayrollGroupWrites(
  prev: PayrollGroup[],
  next: PayrollGroup[],
  writer?: MirrorWriterScope,
): Promise<PayrollGroupDualWriteResult> {
  const stopDual = perf.start("payrollGroup.write.dual");
  const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  state.runs += 1;
  state.lastRunAt = new Date().toISOString();

  const diff = diffGroups(prev, next);

  const result: PayrollGroupDualWriteResult = {
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

  const finish = (): PayrollGroupDualWriteResult => {
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

  const nextById = new Map(next.map((g) => [g.id, g]));
  const prevById = new Map(prev.map((g) => [g.id, g]));
  const scopeGuard = writer && !writer.isSuperAdmin;
  const stopWrite = perf.start("payrollGroup.write.supabase");
  try {
    const companyMap = await loadCompanyUuidMap();
    const rows: PayrollGroupUpsertRow[] = [];
    const sourceById = new Map<string, PayrollGroup>();
    for (const id of changedIds) {
      const group = nextById.get(id);
      if (!group) continue;
      // Writer-scope guard: a non-super-admin may only mirror rows in their own
      // company scope. Global/cross-company rows would be rejected by RLS and
      // poison the batched upsert, so exclude them and record as skipped.
      if (scopeGuard && group.companyId !== writer.companyId) {
        result.skipped.push({
          id,
          reason: `Writer scope "${writer.companyId ?? "global"}" may not mirror row in scope "${group.companyId ?? "global"}".`,
        });
        state.skipped += 1;
        continue;
      }
      if (group.companyId === null) {
        rows.push(toPayrollGroupUpsertRow(group, null));
        sourceById.set(id, group);
        continue;
      }
      const uuid = companyMap.get(group.companyId) ?? null;
      if (!uuid) {
        result.skipped.push({
          id,
          reason: `No Supabase company for legacy_id "${group.companyId}". Migrate companies first.`,
        });
        state.skipped += 1;
        continue;
      }
      rows.push(toPayrollGroupUpsertRow(group, uuid));
      sourceById.set(id, group);
    }

    if (rows.length > 0) {
      const { error } = await supabase
        .from("payroll_groups")
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
        .from("payroll_groups")
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
    mirrorPayrollGroupWrites,
    getPayrollGroupDualWriteState,
    resetPayrollGroupDualWriteState,
  };
}
