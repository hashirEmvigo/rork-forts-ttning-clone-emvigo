/**
 * Checklist Template dual-write mirror (CHK-1).
 *
 * localStorage stays the source of truth: every checklist write completes
 * against localStorage BEFORE this runs. When dual-write / authoritative mode is
 * on, the checklist store fires {@link mirrorChecklistTemplateWrites} to MIRROR
 * the change into `checklist_templates`. Operates on {@link
 * ChecklistTemplateAggregate}s (template + sections + items). Global templates
 * (companyId null) mirror with company_id null; company templates whose company
 * has no Supabase row are skipped + reported. Never throws, idempotent,
 * soft-delete removal propagation, self-validating.
 */
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import { loadCompanyUuidMap } from "./customerMigration";
import type { ChecklistTemplateAggregate } from "./supabaseChecklistTemplateRepository";
import {
  toChecklistTemplateUpsertRow,
  type ChecklistTemplateUpsertRow,
} from "./checklistTemplateMigration";

export type ChecklistTemplateWriteField = "legacy_id" | "name";

export interface ChecklistTemplateWriteMismatch {
  id: string;
  field: ChecklistTemplateWriteField | "missing";
  local: string;
  supabase: string;
  at: string;
}

export interface ChecklistTemplateWriteDiff {
  created: string[];
  updated: string[];
  removed: string[];
}

export interface ChecklistTemplateDualWriteResult {
  ok: boolean;
  noop: boolean;
  diff: ChecklistTemplateWriteDiff;
  mirrored: number;
  removed: number;
  skipped: Array<{ id: string; reason: string }>;
  mismatches: ChecklistTemplateWriteMismatch[];
  error: string | null;
  durationMs: number;
}

export interface ChecklistTemplateDualWriteState {
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
  recentMismatches: ChecklistTemplateWriteMismatch[];
}

const MAX_RECENT_MISMATCHES = 50;

const state: ChecklistTemplateDualWriteState = {
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

export function getChecklistTemplateDualWriteState(): ChecklistTemplateDualWriteState {
  return { ...state, recentMismatches: [...state.recentMismatches] };
}

export function resetChecklistTemplateDualWriteState(): void {
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

function fingerprint(aggregate: ChecklistTemplateAggregate): string {
  return JSON.stringify(aggregate);
}

function diffAggregates(
  prev: ChecklistTemplateAggregate[],
  next: ChecklistTemplateAggregate[],
): ChecklistTemplateWriteDiff {
  const prevById = new Map(prev.map((a) => [a.template.id, a]));
  const nextById = new Map(next.map((a) => [a.template.id, a]));
  const created: string[] = [];
  const updated: string[] = [];
  const removed: string[] = [];

  for (const a of next) {
    const before = prevById.get(a.template.id);
    if (!before) created.push(a.template.id);
    else if (fingerprint(before) !== fingerprint(a)) updated.push(a.template.id);
  }
  for (const a of prev) {
    if (!nextById.has(a.template.id)) removed.push(a.template.id);
  }
  return { created, updated, removed };
}

function recordMismatch(m: ChecklistTemplateWriteMismatch): void {
  state.mismatches += 1;
  state.recentMismatches.unshift(m);
  if (state.recentMismatches.length > MAX_RECENT_MISMATCHES) {
    state.recentMismatches.length = MAX_RECENT_MISMATCHES;
  }
}

async function validateMirroredRows(
  rows: ChecklistTemplateUpsertRow[],
  sourceById: Map<string, ChecklistTemplateAggregate>,
): Promise<ChecklistTemplateWriteMismatch[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  const stop = perf.start("checklistTemplate.write.validation");
  const found: ChecklistTemplateWriteMismatch[] = [];
  const at = new Date().toISOString();
  try {
    for (const row of rows) {
      const local = sourceById.get(row.legacy_id);
      if (!local) continue;
      const { data, error } = await supabase
        .from("checklist_templates")
        .select("legacy_id, name")
        .eq("legacy_id", row.legacy_id)
        .maybeSingle();
      state.validations += 1;
      if (error || !data) {
        const m: ChecklistTemplateWriteMismatch = {
          id: row.legacy_id,
          field: "missing",
          local: local.template.id,
          supabase: error ? `error: ${error.message}` : "no row",
          at,
        };
        found.push(m);
        recordMismatch(m);
        continue;
      }
      const r = data as unknown as { legacy_id: string; name: string };
      const checks: Array<[ChecklistTemplateWriteField, string, string]> = [
        ["legacy_id", local.template.id, r.legacy_id],
        ["name", local.template.name, r.name],
      ];
      for (const [field, localVal, supaVal] of checks) {
        if (localVal !== supaVal) {
          const m: ChecklistTemplateWriteMismatch = {
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

/** Mirrors a checklist-template write (prev → next aggregates) into Supabase. */
export async function mirrorChecklistTemplateWrites(
  prev: ChecklistTemplateAggregate[],
  next: ChecklistTemplateAggregate[],
): Promise<ChecklistTemplateDualWriteResult> {
  const stopDual = perf.start("checklistTemplate.write.dual");
  const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  state.runs += 1;
  state.lastRunAt = new Date().toISOString();

  const diff = diffAggregates(prev, next);

  const result: ChecklistTemplateDualWriteResult = {
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

  const finish = (): ChecklistTemplateDualWriteResult => {
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

  const nextById = new Map(next.map((a) => [a.template.id, a]));
  const stopWrite = perf.start("checklistTemplate.write.supabase");
  try {
    const companyMap = await loadCompanyUuidMap();
    const rows: ChecklistTemplateUpsertRow[] = [];
    const sourceById = new Map<string, ChecklistTemplateAggregate>();
    for (const id of changedIds) {
      const aggregate = nextById.get(id);
      if (!aggregate) continue;
      const t = aggregate.template;
      if (t.scope === "global" || !t.companyId) {
        rows.push(toChecklistTemplateUpsertRow(aggregate, null));
        sourceById.set(id, aggregate);
        continue;
      }
      const uuid = companyMap.get(t.companyId) ?? null;
      if (!uuid) {
        result.skipped.push({
          id,
          reason: `No Supabase company for legacy_id "${t.companyId}". Migrate companies first.`,
        });
        state.skipped += 1;
        continue;
      }
      rows.push(toChecklistTemplateUpsertRow(aggregate, uuid));
      sourceById.set(id, aggregate);
    }

    if (rows.length > 0) {
      const { error } = await supabase
        .from("checklist_templates")
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
        .from("checklist_templates")
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
    mirrorChecklistTemplateWrites,
    getChecklistTemplateDualWriteState,
    resetChecklistTemplateDualWriteState,
  };
}
