/**
 * Role dual-write mirror (ROLE-3).
 *
 * The Roles analogue of {@link import("./serviceDualWrite")}, with GLOBAL-role
 * handling (a role can be a Super Admin global template, companyId === null).
 * localStorage stays the source of truth: every role write completes against
 * localStorage BEFORE this module runs. When dual-write / authoritative mode is
 * on, `persistRoles` (AppContext) fires {@link mirrorRoleWrites} in the
 * background to MIRROR the same change into the Supabase `roles` table.
 *
 * Guarantees (identical to the proven service mirror):
 *   • Never throws — always invoked fire-and-forget; a Supabase failure can never
 *     break a role operation.
 *   • Idempotent — upsert on the unique `legacy_id`; repeated saves never inflate.
 *   • Company-scoped — company rows carry the real `company_id` UUID RLS checks;
 *     GLOBAL rows carry `company_id = null`; company rows whose company has no
 *     Supabase mapping are skipped + surfaced.
 *   • Removal propagation — a role gone from `next` is SOFT-deleted in Supabase
 *     (`deleted_at` set) so no stale role survives the cut-over.
 *   • Self-validating — after mirroring, it re-reads the affected rows and compares
 *     the critical fields, recording any drift (never silently hidden).
 *
 * All runtime state lives in {@link getRoleDualWriteState}.
 */
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import type { Role } from "@/types";
import { loadCompanyUuidMap } from "./customerMigration";
import { toRoleUpsertRow, type RoleUpsertRow } from "./roleMigration";

/** Critical fields validated after every mirrored write. */
export type RoleWriteField = "legacy_id" | "company_legacy_id" | "name";

/** A single field-level discrepancy found while validating a mirrored write. */
export interface RoleWriteMismatch {
  id: string;
  field: RoleWriteField | "missing";
  local: string;
  supabase: string;
  at: string;
}

/** The classification of changes a single mirror operation carried. */
export interface RoleWriteDiff {
  created: string[];
  updated: string[];
  /** Ids present before but gone after — soft-deleted in Supabase. */
  removed: string[];
}

/** Structured outcome of one {@link mirrorRoleWrites} run. */
export interface RoleDualWriteResult {
  ok: boolean;
  /** True when nothing changed between prev/next (no Supabase work done). */
  noop: boolean;
  diff: RoleWriteDiff;
  /** Rows actually upserted to Supabase. */
  mirrored: number;
  /** Rows soft-deleted in Supabase (removal propagation). */
  removed: number;
  /** Source roles skipped (no company mapping / RLS would reject). */
  skipped: Array<{ id: string; reason: string }>;
  /** Field-level mismatches found by the post-write validation. */
  mismatches: RoleWriteMismatch[];
  /** Fatal error captured (never thrown to the caller). */
  error: string | null;
  /** Total wall-clock duration of the mirror, milliseconds. */
  durationMs: number;
}

/** Live, cumulative dual-write metrics (development instrumentation only). */
export interface RoleDualWriteState {
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
  recentMismatches: RoleWriteMismatch[];
}

const MAX_RECENT_MISMATCHES = 50;

const state: RoleDualWriteState = {
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
export function getRoleDualWriteState(): RoleDualWriteState {
  return { ...state, recentMismatches: [...state.recentMismatches] };
}

/** Clears the cumulative dual-write metrics (used by tests + the dev console). */
export function resetRoleDualWriteState(): void {
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

function fingerprint(role: Role): string {
  return JSON.stringify(role);
}

/** Classifies prev → next into created / updated / removed id sets. */
function diffRoles(prev: Role[], next: Role[]): RoleWriteDiff {
  const prevById = new Map(prev.map((r) => [r.id, r]));
  const nextById = new Map(next.map((r) => [r.id, r]));
  const created: string[] = [];
  const updated: string[] = [];
  const removed: string[] = [];

  for (const r of next) {
    const before = prevById.get(r.id);
    if (!before) created.push(r.id);
    else if (fingerprint(before) !== fingerprint(r)) updated.push(r.id);
  }
  for (const r of prev) {
    if (!nextById.has(r.id)) removed.push(r.id);
  }
  return { created, updated, removed };
}

function recordMismatch(m: RoleWriteMismatch): void {
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
  rows: RoleUpsertRow[],
  sourceById: Map<string, Role>,
): Promise<RoleWriteMismatch[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  const stop = perf.start("role.write.validation");
  const found: RoleWriteMismatch[] = [];
  const at = new Date().toISOString();
  try {
    for (const row of rows) {
      const local = sourceById.get(row.legacy_id);
      if (!local) continue;
      const { data, error } = await supabase
        .from("roles")
        .select("legacy_id, company_legacy_id, name")
        .eq("legacy_id", row.legacy_id)
        .maybeSingle();
      state.validations += 1;
      if (error || !data) {
        const m: RoleWriteMismatch = {
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
      const checks: Array<[RoleWriteField, string, string]> = [
        ["legacy_id", local.id, r.legacy_id],
        // null (global) normalised to "" on both sides so it compares equal.
        ["company_legacy_id", local.companyId ?? "", r.company_legacy_id ?? ""],
        ["name", local.name, r.name],
      ];
      for (const [field, localVal, supaVal] of checks) {
        if (localVal !== supaVal) {
          const m: RoleWriteMismatch = {
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
 * Mirrors a role write (prev → next) into Supabase.
 *
 * Always call fire-and-forget AFTER the authoritative localStorage write has
 * completed. localStorage is never affected by this function; it only upserts the
 * changed rows into the `roles` table, soft-deletes removed rows, and validates
 * the result.
 *
 * @param prev The roles array BEFORE the write (authoritative previous state).
 * @param next The roles array AFTER the write (now persisted to localStorage).
 */
export async function mirrorRoleWrites(
  prev: Role[],
  next: Role[],
): Promise<RoleDualWriteResult> {
  const stopDual = perf.start("role.write.dual");
  const startedAt =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  state.runs += 1;
  state.lastRunAt = new Date().toISOString();

  const diff = diffRoles(prev, next);

  const result: RoleDualWriteResult = {
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

  const finish = (): RoleDualWriteResult => {
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

  const nextById = new Map(next.map((r) => [r.id, r]));
  const stopWrite = perf.start("role.write.supabase");
  try {
    const companyMap = await loadCompanyUuidMap();
    const rows: RoleUpsertRow[] = [];
    const sourceById = new Map<string, Role>();
    for (const id of changedIds) {
      const role = nextById.get(id);
      if (!role) continue;
      // GLOBAL role (Super Admin templates) → company_id null, never skipped.
      if (role.companyId === null) {
        rows.push(toRoleUpsertRow(role, null));
        sourceById.set(id, role);
        continue;
      }
      const uuid = companyMap.get(role.companyId) ?? null;
      if (!uuid) {
        result.skipped.push({
          id,
          reason: `No Supabase company for legacy_id "${role.companyId}". Migrate companies first.`,
        });
        state.skipped += 1;
        continue;
      }
      rows.push(toRoleUpsertRow(role, uuid));
      sourceById.set(id, role);
    }

    if (rows.length > 0) {
      const { error } = await supabase
        .from("roles")
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
    // stale role survives. A failure here is recorded but never blocks the op.
    if (diff.removed.length > 0) {
      const { error } = await supabase
        .from("roles")
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
    mirrorRoleWrites,
    getRoleDualWriteState,
    resetRoleDualWriteState,
  };
}
