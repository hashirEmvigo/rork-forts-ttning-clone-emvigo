/**
 * Visit Occurrence dual-write mirror (MISSION-1).
 *
 * The Missions analogue of {@link import("./areaDualWrite")}. localStorage stays
 * the synchronized backout copy: every occurrence write completes against
 * localStorage BEFORE this runs. When dual-write / authoritative mode is on, the
 * store fires {@link mirrorVisitOccurrenceWrites} to MIRROR the change into the
 * `visit_occurrences` table.
 *
 * Guarantees (identical to the proven area mirror): never throws, idempotent
 * upsert on `legacy_id`, company-scoped, removal propagation (soft-delete — the
 * store only ever cancels, so this is defensive), self-validating post-write.
 */
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import type { VisitOccurrence } from "@/types";
import { loadCompanyUuidMap } from "./customerMigration";
import {
  toVisitOccurrenceUpsertRow,
  type VisitOccurrenceUpsertRow,
} from "./visitOccurrenceMigration";

export type VisitOccurrenceWriteField =
  | "legacy_id"
  | "company_legacy_id"
  | "status"
  | "scheduled_date";

export interface VisitOccurrenceWriteMismatch {
  id: string;
  field: VisitOccurrenceWriteField | "missing";
  local: string;
  supabase: string;
  at: string;
}

export interface VisitOccurrenceWriteDiff {
  created: string[];
  updated: string[];
  removed: string[];
}

export interface VisitOccurrenceDualWriteResult {
  ok: boolean;
  noop: boolean;
  diff: VisitOccurrenceWriteDiff;
  mirrored: number;
  removed: number;
  skipped: Array<{ id: string; reason: string }>;
  mismatches: VisitOccurrenceWriteMismatch[];
  error: string | null;
  durationMs: number;
}

export interface VisitOccurrenceDualWriteState {
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
  recentMismatches: VisitOccurrenceWriteMismatch[];
}

const MAX_RECENT_MISMATCHES = 50;

const state: VisitOccurrenceDualWriteState = {
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

export function getVisitOccurrenceDualWriteState(): VisitOccurrenceDualWriteState {
  return { ...state, recentMismatches: [...state.recentMismatches] };
}

export function resetVisitOccurrenceDualWriteState(): void {
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

function fingerprint(visit: VisitOccurrence): string {
  return JSON.stringify(visit);
}

function diffVisits(
  prev: VisitOccurrence[],
  next: VisitOccurrence[],
): VisitOccurrenceWriteDiff {
  const prevById = new Map(prev.map((v) => [v.id, v]));
  const nextById = new Map(next.map((v) => [v.id, v]));
  const created: string[] = [];
  const updated: string[] = [];
  const removed: string[] = [];

  for (const v of next) {
    const before = prevById.get(v.id);
    if (!before) created.push(v.id);
    else if (fingerprint(before) !== fingerprint(v)) updated.push(v.id);
  }
  for (const v of prev) {
    if (!nextById.has(v.id)) removed.push(v.id);
  }
  return { created, updated, removed };
}

function recordMismatch(m: VisitOccurrenceWriteMismatch): void {
  state.mismatches += 1;
  state.recentMismatches.unshift(m);
  if (state.recentMismatches.length > MAX_RECENT_MISMATCHES) {
    state.recentMismatches.length = MAX_RECENT_MISMATCHES;
  }
}

async function validateMirroredRows(
  rows: VisitOccurrenceUpsertRow[],
  sourceById: Map<string, VisitOccurrence>,
): Promise<VisitOccurrenceWriteMismatch[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  const stop = perf.start("visitOccurrence.write.validation");
  const found: VisitOccurrenceWriteMismatch[] = [];
  const at = new Date().toISOString();
  try {
    for (const row of rows) {
      const local = sourceById.get(row.legacy_id);
      if (!local) continue;
      const { data, error } = await supabase
        .from("visit_occurrences")
        .select("legacy_id, company_legacy_id, status, scheduled_date")
        .eq("legacy_id", row.legacy_id)
        .maybeSingle();
      state.validations += 1;
      if (error || !data) {
        const m: VisitOccurrenceWriteMismatch = {
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
        status: string;
        scheduled_date: string;
      };
      const checks: Array<[VisitOccurrenceWriteField, string, string]> = [
        ["legacy_id", local.id, r.legacy_id],
        ["company_legacy_id", local.companyId, r.company_legacy_id],
        ["status", local.status, r.status],
        ["scheduled_date", local.scheduledDate, r.scheduled_date],
      ];
      for (const [field, localVal, supaVal] of checks) {
        if (localVal !== supaVal) {
          const m: VisitOccurrenceWriteMismatch = {
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

/** Mirrors an occurrence write (prev → next) into Supabase. */
export async function mirrorVisitOccurrenceWrites(
  prev: VisitOccurrence[],
  next: VisitOccurrence[],
): Promise<VisitOccurrenceDualWriteResult> {
  const stopDual = perf.start("visitOccurrence.write.dual");
  const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  state.runs += 1;
  state.lastRunAt = new Date().toISOString();

  const diff = diffVisits(prev, next);

  const result: VisitOccurrenceDualWriteResult = {
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

  const finish = (): VisitOccurrenceDualWriteResult => {
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

  const nextById = new Map(next.map((v) => [v.id, v]));
  const stopWrite = perf.start("visitOccurrence.write.supabase");
  try {
    const companyMap = await loadCompanyUuidMap();
    const rows: VisitOccurrenceUpsertRow[] = [];
    const sourceById = new Map<string, VisitOccurrence>();
    for (const id of changedIds) {
      const visit = nextById.get(id);
      if (!visit) continue;
      const uuid = companyMap.get(visit.companyId) ?? null;
      if (!uuid) {
        result.skipped.push({
          id,
          reason: `No Supabase company for legacy_id "${visit.companyId}". Migrate companies first.`,
        });
        state.skipped += 1;
        continue;
      }
      rows.push(toVisitOccurrenceUpsertRow(visit, uuid));
      sourceById.set(id, visit);
    }

    if (rows.length > 0) {
      const { error } = await supabase
        .from("visit_occurrences")
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
        .from("visit_occurrences")
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
    mirrorVisitOccurrenceWrites,
    getVisitOccurrenceDualWriteState,
    resetVisitOccurrenceDualWriteState,
  };
}
