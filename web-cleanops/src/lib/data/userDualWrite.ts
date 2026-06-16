/**
 * User (login) dual-write mirror (USER-3).
 *
 * The Users analogue of {@link import("./roleDualWrite")}, with GLOBAL-login
 * handling (a login can be a platform super admin, companyId === null).
 * localStorage stays the source of truth: every login write completes against
 * localStorage BEFORE this module runs. When dual-write / authoritative mode is
 * on, `persistUsers` (AppContext) fires {@link mirrorUserWrites} in the
 * background to MIRROR the same change into the Supabase `app_users` table.
 *
 * SECURITY: the mirror writes only the PASSWORD-FREE login record (the source
 * arrays come from context state, which is built from the password-free
 * `getUsers()`). No secret ever reaches Supabase.
 *
 * Guarantees (identical to the proven role mirror):
 *   • Never throws — always invoked fire-and-forget; a Supabase failure can never
 *     break a login operation.
 *   • Idempotent — upsert on the unique `legacy_id`; repeated saves never inflate.
 *   • Company-scoped — company rows carry the real `company_id` UUID RLS checks;
 *     GLOBAL rows carry `company_id = null`; company rows whose company has no
 *     Supabase mapping are skipped + surfaced.
 *   • Removal propagation — a login gone from `next` is SOFT-deleted in Supabase
 *     (`deleted_at` set) so no stale login survives the cut-over.
 *   • Self-validating — after mirroring, it re-reads the affected rows and compares
 *     the critical fields, recording any drift (never silently hidden).
 *
 * All runtime state lives in {@link getUserDualWriteState}.
 */
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import type { User } from "@/types";
import { loadCompanyUuidMap } from "./customerMigration";
import { toUserUpsertRow, type UserUpsertRow } from "./userMigration";

/** Critical fields validated after every mirrored write. */
export type UserWriteField = "legacy_id" | "company_legacy_id" | "email";

/** A single field-level discrepancy found while validating a mirrored write. */
export interface UserWriteMismatch {
  id: string;
  field: UserWriteField | "missing";
  local: string;
  supabase: string;
  at: string;
}

/** The classification of changes a single mirror operation carried. */
export interface UserWriteDiff {
  created: string[];
  updated: string[];
  /** Ids present before but gone after — soft-deleted in Supabase. */
  removed: string[];
}

/** Structured outcome of one {@link mirrorUserWrites} run. */
export interface UserDualWriteResult {
  ok: boolean;
  /** True when nothing changed between prev/next (no Supabase work done). */
  noop: boolean;
  diff: UserWriteDiff;
  /** Rows actually upserted to Supabase. */
  mirrored: number;
  /** Rows soft-deleted in Supabase (removal propagation). */
  removed: number;
  /** Source logins skipped (no company mapping / RLS would reject). */
  skipped: Array<{ id: string; reason: string }>;
  /** Field-level mismatches found by the post-write validation. */
  mismatches: UserWriteMismatch[];
  /** Fatal error captured (never thrown to the caller). */
  error: string | null;
  /** Total wall-clock duration of the mirror, milliseconds. */
  durationMs: number;
}

/** Live, cumulative dual-write metrics (development instrumentation only). */
export interface UserDualWriteState {
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
  recentMismatches: UserWriteMismatch[];
}

const MAX_RECENT_MISMATCHES = 50;

const state: UserDualWriteState = {
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
export function getUserDualWriteState(): UserDualWriteState {
  return { ...state, recentMismatches: [...state.recentMismatches] };
}

/** Clears the cumulative dual-write metrics (used by tests + the dev console). */
export function resetUserDualWriteState(): void {
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

function fingerprint(user: User): string {
  return JSON.stringify(user);
}

/** Classifies prev → next into created / updated / removed id sets. */
function diffUsers(prev: User[], next: User[]): UserWriteDiff {
  const prevById = new Map(prev.map((u) => [u.id, u]));
  const nextById = new Map(next.map((u) => [u.id, u]));
  const created: string[] = [];
  const updated: string[] = [];
  const removed: string[] = [];

  for (const u of next) {
    const before = prevById.get(u.id);
    if (!before) created.push(u.id);
    else if (fingerprint(before) !== fingerprint(u)) updated.push(u.id);
  }
  for (const u of prev) {
    if (!nextById.has(u.id)) removed.push(u.id);
  }
  return { created, updated, removed };
}

function recordMismatch(m: UserWriteMismatch): void {
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
  rows: UserUpsertRow[],
  sourceById: Map<string, User>,
): Promise<UserWriteMismatch[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  const stop = perf.start("appUser.write.validation");
  const found: UserWriteMismatch[] = [];
  const at = new Date().toISOString();
  try {
    for (const row of rows) {
      const local = sourceById.get(row.legacy_id);
      if (!local) continue;
      const { data, error } = await supabase
        .from("app_users")
        .select("legacy_id, company_legacy_id, email")
        .eq("legacy_id", row.legacy_id)
        .maybeSingle();
      state.validations += 1;
      if (error || !data) {
        const m: UserWriteMismatch = {
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
        email: string;
      };
      const checks: Array<[UserWriteField, string, string]> = [
        ["legacy_id", local.id, r.legacy_id],
        // null (global) normalised to "" on both sides so it compares equal.
        ["company_legacy_id", local.companyId ?? "", r.company_legacy_id ?? ""],
        ["email", local.email, r.email],
      ];
      for (const [field, localVal, supaVal] of checks) {
        if (localVal !== supaVal) {
          const m: UserWriteMismatch = {
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
 * Mirrors a login write (prev → next) into Supabase.
 *
 * Always call fire-and-forget AFTER the authoritative localStorage write has
 * completed. localStorage is never affected by this function; it only upserts the
 * changed rows into the `app_users` table, soft-deletes removed rows, and
 * validates the result.
 *
 * @param prev The logins array BEFORE the write (authoritative previous state).
 * @param next The logins array AFTER the write (now persisted to localStorage).
 */
export async function mirrorUserWrites(
  prev: User[],
  next: User[],
): Promise<UserDualWriteResult> {
  const stopDual = perf.start("appUser.write.dual");
  const startedAt =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  state.runs += 1;
  state.lastRunAt = new Date().toISOString();

  const diff = diffUsers(prev, next);

  const result: UserDualWriteResult = {
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

  const finish = (): UserDualWriteResult => {
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

  const nextById = new Map(next.map((u) => [u.id, u]));
  const stopWrite = perf.start("appUser.write.supabase");
  try {
    const companyMap = await loadCompanyUuidMap();
    const rows: UserUpsertRow[] = [];
    const sourceById = new Map<string, User>();
    for (const id of changedIds) {
      const user = nextById.get(id);
      if (!user) continue;
      // GLOBAL login (platform super admin) → company_id null, never skipped.
      if (user.companyId === null) {
        rows.push(toUserUpsertRow(user, null));
        sourceById.set(id, user);
        continue;
      }
      const uuid = companyMap.get(user.companyId) ?? null;
      if (!uuid) {
        result.skipped.push({
          id,
          reason: `No Supabase company for legacy_id "${user.companyId}". Migrate companies first.`,
        });
        state.skipped += 1;
        continue;
      }
      rows.push(toUserUpsertRow(user, uuid));
      sourceById.set(id, user);
    }

    if (rows.length > 0) {
      const { error } = await supabase
        .from("app_users")
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
    // stale login survives. A failure here is recorded but never blocks the op.
    if (diff.removed.length > 0) {
      const { error } = await supabase
        .from("app_users")
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
    mirrorUserWrites,
    getUserDualWriteState,
    resetUserDualWriteState,
  };
}
