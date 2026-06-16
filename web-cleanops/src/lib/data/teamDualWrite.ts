/**
 * Team dual-write mirror (TEAM-3).
 *
 * The Teams analogue of {@link import("./customerDualWrite")}, with the WO-5.6
 * removal-propagation behaviour added (teams CAN be deleted, unlike customers).
 * localStorage stays the source of truth: every team write completes against
 * localStorage BEFORE this module runs. When dual-write / authoritative mode is
 * on, `persistTeams` (AppContext) fires {@link mirrorTeamWrites} in the
 * background to MIRROR the same change into the Supabase `teams` table.
 *
 * Guarantees (identical to the proven customer mirror):
 *   \u2022 Never throws \u2014 always invoked fire-and-forget; a Supabase failure can never
 *     break a team operation.
 *   \u2022 Idempotent \u2014 upsert on the unique `legacy_id`; repeated saves never inflate.
 *   \u2022 Company-scoped \u2014 each row carries the real `company_id` UUID RLS checks;
 *     rows whose company has no Supabase mapping are skipped + surfaced.
 *   \u2022 Removal propagation \u2014 a team gone from `next` is SOFT-deleted in Supabase
 *     (`deleted_at` set) so no stale team survives the cut-over.
 *   \u2022 Self-validating \u2014 after mirroring, it re-reads the affected rows and compares
 *     the critical fields, recording any drift (never silently hidden).
 *
 * All runtime state lives in {@link getTeamDualWriteState}.
 */
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import type { Team } from "@/types";
import { loadCompanyUuidMap } from "./customerMigration";
import { toTeamUpsertRow, type TeamUpsertRow } from "./teamMigration";

/** Critical fields validated after every mirrored write. */
export type TeamWriteField = "legacy_id" | "company_legacy_id" | "name";

/** A single field-level discrepancy found while validating a mirrored write. */
export interface TeamWriteMismatch {
  id: string;
  field: TeamWriteField | "missing";
  local: string;
  supabase: string;
  at: string;
}

/** The classification of changes a single mirror operation carried. */
export interface TeamWriteDiff {
  created: string[];
  updated: string[];
  /** Ids present before but gone after \u2014 soft-deleted in Supabase. */
  removed: string[];
}

/** Structured outcome of one {@link mirrorTeamWrites} run. */
export interface TeamDualWriteResult {
  ok: boolean;
  /** True when nothing changed between prev/next (no Supabase work done). */
  noop: boolean;
  diff: TeamWriteDiff;
  /** Rows actually upserted to Supabase. */
  mirrored: number;
  /** Rows soft-deleted in Supabase (removal propagation). */
  removed: number;
  /** Source teams skipped (no company mapping / RLS would reject). */
  skipped: Array<{ id: string; reason: string }>;
  /** Field-level mismatches found by the post-write validation. */
  mismatches: TeamWriteMismatch[];
  /** Fatal error captured (never thrown to the caller). */
  error: string | null;
  /** Total wall-clock duration of the mirror, milliseconds. */
  durationMs: number;
}

/** Live, cumulative dual-write metrics (development instrumentation only). */
export interface TeamDualWriteState {
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
  recentMismatches: TeamWriteMismatch[];
}

const MAX_RECENT_MISMATCHES = 50;

const state: TeamDualWriteState = {
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
export function getTeamDualWriteState(): TeamDualWriteState {
  return { ...state, recentMismatches: [...state.recentMismatches] };
}

/** Clears the cumulative dual-write metrics (used by tests + the dev console). */
export function resetTeamDualWriteState(): void {
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

function fingerprint(team: Team): string {
  return JSON.stringify(team);
}

/** Classifies prev \u2192 next into created / updated / removed id sets. */
function diffTeams(prev: Team[], next: Team[]): TeamWriteDiff {
  const prevById = new Map(prev.map((t) => [t.id, t]));
  const nextById = new Map(next.map((t) => [t.id, t]));
  const created: string[] = [];
  const updated: string[] = [];
  const removed: string[] = [];

  for (const t of next) {
    const before = prevById.get(t.id);
    if (!before) created.push(t.id);
    else if (fingerprint(before) !== fingerprint(t)) updated.push(t.id);
  }
  for (const t of prev) {
    if (!nextById.has(t.id)) removed.push(t.id);
  }
  return { created, updated, removed };
}

function recordMismatch(m: TeamWriteMismatch): void {
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
  rows: TeamUpsertRow[],
  sourceById: Map<string, Team>,
): Promise<TeamWriteMismatch[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  const stop = perf.start("team.write.validation");
  const found: TeamWriteMismatch[] = [];
  const at = new Date().toISOString();
  try {
    for (const row of rows) {
      const local = sourceById.get(row.legacy_id);
      if (!local) continue;
      const { data, error } = await supabase
        .from("teams")
        .select("legacy_id, company_legacy_id, name")
        .eq("legacy_id", row.legacy_id)
        .maybeSingle();
      state.validations += 1;
      if (error || !data) {
        const m: TeamWriteMismatch = {
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
      };
      const checks: Array<[TeamWriteField, string, string]> = [
        ["legacy_id", local.id, r.legacy_id],
        ["company_legacy_id", local.companyId, r.company_legacy_id],
        ["name", local.name, r.name],
      ];
      for (const [field, localVal, supaVal] of checks) {
        if (localVal !== supaVal) {
          const m: TeamWriteMismatch = {
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
 * Mirrors a team write (prev \u2192 next) into Supabase.
 *
 * Always call fire-and-forget AFTER the authoritative localStorage write has
 * completed. localStorage is never affected by this function; it only upserts the
 * changed rows into the `teams` table, soft-deletes removed rows, and validates
 * the result.
 *
 * @param prev The teams array BEFORE the write (authoritative previous state).
 * @param next The teams array AFTER the write (now persisted to localStorage).
 */
export async function mirrorTeamWrites(
  prev: Team[],
  next: Team[],
): Promise<TeamDualWriteResult> {
  const stopDual = perf.start("team.write.dual");
  const startedAt =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  state.runs += 1;
  state.lastRunAt = new Date().toISOString();

  const diff = diffTeams(prev, next);

  const result: TeamDualWriteResult = {
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

  const finish = (): TeamDualWriteResult => {
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

  const nextById = new Map(next.map((t) => [t.id, t]));
  const stopWrite = perf.start("team.write.supabase");
  try {
    const companyMap = await loadCompanyUuidMap();
    const rows: TeamUpsertRow[] = [];
    const sourceById = new Map<string, Team>();
    for (const id of changedIds) {
      const team = nextById.get(id);
      if (!team) continue;
      const uuid = companyMap.get(team.companyId) ?? null;
      if (!uuid) {
        result.skipped.push({
          id,
          reason: `No Supabase company for legacy_id "${team.companyId}". Migrate companies first.`,
        });
        state.skipped += 1;
        continue;
      }
      rows.push(toTeamUpsertRow(team, uuid));
      sourceById.set(id, team);
    }

    if (rows.length > 0) {
      const { error } = await supabase
        .from("teams")
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
    // stale team survives. A failure here is recorded but never blocks the op.
    if (diff.removed.length > 0) {
      const { error } = await supabase
        .from("teams")
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

    // Post-write parity validation \u2014 surfaces drift, never blocks anything.
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
    mirrorTeamWrites,
    getTeamDualWriteState,
    resetTeamDualWriteState,
  };
}
