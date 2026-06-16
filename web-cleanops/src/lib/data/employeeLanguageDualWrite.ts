/**
 * Employee Language dual-write mirror (AREA-1).
 *
 * The Employee Languages analogue of {@link import("./areaDualWrite")}.
 * localStorage stays the source of truth; when dual-write / authoritative mode
 * is on, AppContext fires {@link mirrorEmployeeLanguageWrites} to MIRROR the
 * change into the `employee_languages` table. Never throws, idempotent upsert on
 * `legacy_id`, company-scoped, removal propagation (soft-delete), self-validating.
 *
 * NOTE: the single-default invariant is owned by the store; this mirror writes
 * whatever flags the localStorage record carries (incl. the recomputed
 * is_default after a default change), so prev→next updates of sibling rows are
 * mirrored too.
 */
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import type { EmployeeLanguage } from "@/types";
import { loadCompanyUuidMap } from "./customerMigration";
import {
  toEmployeeLanguageUpsertRow,
  type EmployeeLanguageUpsertRow,
} from "./employeeLanguageMigration";

export type EmployeeLanguageWriteField =
  | "legacy_id"
  | "company_legacy_id"
  | "code"
  | "name";

export interface EmployeeLanguageWriteMismatch {
  id: string;
  field: EmployeeLanguageWriteField | "missing";
  local: string;
  supabase: string;
  at: string;
}

export interface EmployeeLanguageWriteDiff {
  created: string[];
  updated: string[];
  removed: string[];
}

export interface EmployeeLanguageDualWriteResult {
  ok: boolean;
  noop: boolean;
  diff: EmployeeLanguageWriteDiff;
  mirrored: number;
  removed: number;
  skipped: Array<{ id: string; reason: string }>;
  mismatches: EmployeeLanguageWriteMismatch[];
  error: string | null;
  durationMs: number;
}

export interface EmployeeLanguageDualWriteState {
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
  recentMismatches: EmployeeLanguageWriteMismatch[];
}

const MAX_RECENT_MISMATCHES = 50;

const state: EmployeeLanguageDualWriteState = {
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

export function getEmployeeLanguageDualWriteState(): EmployeeLanguageDualWriteState {
  return { ...state, recentMismatches: [...state.recentMismatches] };
}

export function resetEmployeeLanguageDualWriteState(): void {
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

function fingerprint(language: EmployeeLanguage): string {
  return JSON.stringify(language);
}

function diffLanguages(
  prev: EmployeeLanguage[],
  next: EmployeeLanguage[],
): EmployeeLanguageWriteDiff {
  const prevById = new Map(prev.map((l) => [l.id, l]));
  const nextById = new Map(next.map((l) => [l.id, l]));
  const created: string[] = [];
  const updated: string[] = [];
  const removed: string[] = [];

  for (const l of next) {
    const before = prevById.get(l.id);
    if (!before) created.push(l.id);
    else if (fingerprint(before) !== fingerprint(l)) updated.push(l.id);
  }
  for (const l of prev) {
    if (!nextById.has(l.id)) removed.push(l.id);
  }
  return { created, updated, removed };
}

function recordMismatch(m: EmployeeLanguageWriteMismatch): void {
  state.mismatches += 1;
  state.recentMismatches.unshift(m);
  if (state.recentMismatches.length > MAX_RECENT_MISMATCHES) {
    state.recentMismatches.length = MAX_RECENT_MISMATCHES;
  }
}

async function validateMirroredRows(
  rows: EmployeeLanguageUpsertRow[],
  sourceById: Map<string, EmployeeLanguage>,
): Promise<EmployeeLanguageWriteMismatch[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  const stop = perf.start("employeeLanguage.write.validation");
  const found: EmployeeLanguageWriteMismatch[] = [];
  const at = new Date().toISOString();
  try {
    for (const row of rows) {
      const local = sourceById.get(row.legacy_id);
      if (!local) continue;
      const { data, error } = await supabase
        .from("employee_languages")
        .select("legacy_id, company_legacy_id, code, name")
        .eq("legacy_id", row.legacy_id)
        .maybeSingle();
      state.validations += 1;
      if (error || !data) {
        const m: EmployeeLanguageWriteMismatch = {
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
        code: string;
        name: string;
      };
      const checks: Array<[EmployeeLanguageWriteField, string, string]> = [
        ["legacy_id", local.id, r.legacy_id],
        ["company_legacy_id", local.companyId, r.company_legacy_id],
        ["code", local.code, r.code],
        ["name", local.name, r.name],
      ];
      for (const [field, localVal, supaVal] of checks) {
        if (localVal !== supaVal) {
          const m: EmployeeLanguageWriteMismatch = {
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

/** Mirrors an employee-language write (prev → next) into Supabase. */
export async function mirrorEmployeeLanguageWrites(
  prev: EmployeeLanguage[],
  next: EmployeeLanguage[],
): Promise<EmployeeLanguageDualWriteResult> {
  const stopDual = perf.start("employeeLanguage.write.dual");
  const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  state.runs += 1;
  state.lastRunAt = new Date().toISOString();

  const diff = diffLanguages(prev, next);

  const result: EmployeeLanguageDualWriteResult = {
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

  const finish = (): EmployeeLanguageDualWriteResult => {
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

  const nextById = new Map(next.map((l) => [l.id, l]));
  const stopWrite = perf.start("employeeLanguage.write.supabase");
  try {
    const companyMap = await loadCompanyUuidMap();
    const rows: EmployeeLanguageUpsertRow[] = [];
    const sourceById = new Map<string, EmployeeLanguage>();
    for (const id of changedIds) {
      const language = nextById.get(id);
      if (!language) continue;
      const uuid = companyMap.get(language.companyId) ?? null;
      if (!uuid) {
        result.skipped.push({
          id,
          reason: `No Supabase company for legacy_id "${language.companyId}". Migrate companies first.`,
        });
        state.skipped += 1;
        continue;
      }
      rows.push(toEmployeeLanguageUpsertRow(language, uuid));
      sourceById.set(id, language);
    }

    if (rows.length > 0) {
      const { error } = await supabase
        .from("employee_languages")
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
        .from("employee_languages")
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
    mirrorEmployeeLanguageWrites,
    getEmployeeLanguageDualWriteState,
    resetEmployeeLanguageDualWriteState,
  };
}
