/**
 * User (login) migration + shadow-read tooling (USER-1).
 *
 * The Users analogue of {@link import("./roleMigration")}. Two development/admin
 * utilities, both READ-ONLY against the running app's localStorage source of
 * truth:
 *
 *   1. `migrateUsers()` — copies localStorage logins INTO the Supabase
 *      `app_users` table (single, flat record). Idempotent (upsert on
 *      `legacy_id`), repeatable, with a `dryRun` mode that computes the plan +
 *      report WITHOUT writing. Preserves legacy ids verbatim and the full
 *      (PASSWORD-FREE) payload in `data` jsonb. GLOBAL logins (companyId === null
 *      → platform super admins) are migrated with `company_id = null`; company
 *      logins whose company has no Supabase row are skipped + reported.
 *
 *   2. `shadowReadUsers()` — diffs localStorage vs Supabase for a scope (count /
 *      id set / email parity / detail payload), producing a structured mismatch
 *      report. Differences are surfaced, never silently ignored.
 *
 * SECURITY: the source is {@link getUsers} which already STRIPS passwords, so no
 * secret ever reaches Supabase. The CRITICAL guarantee is `legacy_id` stability
 * — employees.userId / customers.userIds soft-reference the login by it.
 */
import { getUsers } from "@/lib/store";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import type { User } from "@/types";
import { loadCompanyUuidMap } from "./customerMigration";
import {
  listUserSummariesFromSupabase,
  listFullUsersFromSupabase,
} from "./supabaseUserRepository";

// ── Migration ───────────────────────────────────────────────────────────

/** A single upsert row written to (or planned for) the `app_users` table. */
export interface UserUpsertRow {
  legacy_id: string;
  /** Real tenant FK UUID, or null for a GLOBAL (platform super admin) login. */
  company_id: string | null;
  /** App-facing company id, or null for a GLOBAL login. */
  company_legacy_id: string | null;
  email: string;
  role: string;
  status: string;
  /** Soft-delete marker — always null on upsert (an upsert UNDELETES the row). */
  deleted_at: string | null;
  /** The PASSWORD-FREE login record (getUsers already strips the password). */
  data: User;
}

/** Structured outcome of a user migration run (or dry-run). */
export interface UserMigrationReport {
  ok: boolean;
  dryRun: boolean;
  /** Company scope this run was limited to, or null for all companies. */
  companyId: string | null;
  /** Logins read from localStorage for the scope. */
  sourceCount: number;
  /** Rows that would be / were upserted. */
  plannedCount: number;
  /** Rows actually written (0 on dry-run). */
  writtenCount: number;
  /** Source logins skipped because their company_id could not be resolved. */
  skipped: Array<{ id: string; reason: string }>;
  /** Fatal error, if the run failed. */
  error?: string;
}

function scopeByCompany(users: User[], companyId: string | null | undefined): User[] {
  if (companyId === undefined || companyId === null) return users;
  return users.filter((u) => u.companyId === companyId);
}

/**
 * Maps a localStorage {@link User} login to an `app_users` table upsert row. The
 * flat columns carry email/role/status/scope; the full (password-free) record is
 * preserved losslessly in `data`. Shared by the migration utility and the
 * USER-3 dual-write mirror so both write byte-identical rows.
 *
 * GLOBAL logins (companyId === null) pass `companyUuid = null`.
 */
export function toUserUpsertRow(user: User, companyUuid: string | null): UserUpsertRow {
  return {
    legacy_id: user.id,
    company_id: companyUuid,
    company_legacy_id: user.companyId,
    email: user.email,
    role: user.role,
    status: user.status,
    deleted_at: null,
    data: user,
  };
}

/**
 * Migrates localStorage logins into Supabase.
 *
 * @param options.companyId Restrict to a single app-facing company id.
 * @param options.dryRun    When true, compute the plan + report but write nothing.
 */
export async function migrateUsers(options?: {
  companyId?: string | null;
  dryRun?: boolean;
}): Promise<UserMigrationReport> {
  const companyId = options?.companyId ?? null;
  const dryRun = options?.dryRun ?? false;

  const source = scopeByCompany(getUsers(), companyId);
  const report: UserMigrationReport = {
    ok: false,
    dryRun,
    companyId,
    sourceCount: source.length,
    plannedCount: 0,
    writtenCount: 0,
    skipped: [],
  };

  if (!isSupabaseConfigured || !supabase) {
    report.error = "Supabase is not configured.";
    return report;
  }

  const companyMap = await loadCompanyUuidMap();
  const rows: UserUpsertRow[] = [];
  for (const user of source) {
    // GLOBAL login (platform super admin) → company_id null, never skipped.
    if (user.companyId === null) {
      rows.push(toUserUpsertRow(user, null));
      continue;
    }
    const uuid = companyMap.get(user.companyId) ?? null;
    if (!uuid) {
      report.skipped.push({
        id: user.id,
        reason: `No Supabase company found for legacy_id "${user.companyId}". Migrate companies first.`,
      });
      continue;
    }
    rows.push(toUserUpsertRow(user, uuid));
  }
  report.plannedCount = rows.length;

  if (dryRun || rows.length === 0) {
    report.ok = report.skipped.length === 0;
    return report;
  }

  const CHUNK = 200;
  try {
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const { error } = await supabase
        .from("app_users")
        .upsert(chunk, { onConflict: "legacy_id" });
      if (error) {
        report.error = `Upsert failed at chunk ${i / CHUNK}: ${error.message}`;
        report.writtenCount = i;
        return report;
      }
    }
    report.writtenCount = rows.length;
    report.ok = report.skipped.length === 0;
    return report;
  } catch (err) {
    report.error = err instanceof Error ? err.message : "Unknown migration error.";
    return report;
  }
}

// ── Shadow-read validation ────────────────────────────────────────────────

/** Per-aspect outcome of a localStorage-vs-Supabase login comparison. */
export interface UserShadowReport {
  ok: boolean;
  companyId: string | null;
  localCount: number;
  supabaseCount: number;
  countMatch: boolean;
  idsMatch: boolean;
  summaryMatch: boolean;
  detailMatch: boolean;
  /** Ids present locally but missing in Supabase (not yet migrated). */
  missingInSupabase: string[];
  /** Ids present in Supabase but absent locally (stale/extra). */
  extraInSupabase: string[];
  /** Human-readable mismatch notes — never empty when ok is false. */
  notes: string[];
}

function idSetDiff(a: string[], b: string[]): { onlyA: string[]; onlyB: string[] } {
  const setB = new Set(b);
  const setA = new Set(a);
  return {
    onlyA: a.filter((id) => !setB.has(id)),
    onlyB: b.filter((id) => !setA.has(id)),
  };
}

/**
 * Compares localStorage logins against the Supabase shadow copy for a scope.
 * Read-only on both sides; mutates nothing. Validates count / id set / email /
 * a detail sample. Use this to confirm "0 critical mismatches" before any UI
 * cut-over.
 *
 * NOTE on scope: an unscoped (super-admin) shadow read covers every row; a
 * company-scoped read covers only that company's logins (global super-admin
 * logins are not visible to a company admin), mirroring the repository.
 */
export async function shadowReadUsers(
  companyId?: string | null,
): Promise<UserShadowReport> {
  const scope = companyId ?? null;
  const queryScope = companyId ?? undefined;
  const notes: string[] = [];

  const local = scopeByCompany(getUsers(), queryScope);

  const report: UserShadowReport = {
    ok: false,
    companyId: scope,
    localCount: local.length,
    supabaseCount: 0,
    countMatch: false,
    idsMatch: false,
    summaryMatch: false,
    detailMatch: false,
    missingInSupabase: [],
    extraInSupabase: [],
    notes,
  };

  if (!isSupabaseConfigured || !supabase) {
    notes.push("Supabase is not configured.");
    return report;
  }

  let remote: Awaited<ReturnType<typeof listUserSummariesFromSupabase>>;
  try {
    remote = await listUserSummariesFromSupabase(queryScope);
  } catch (err) {
    notes.push(err instanceof Error ? err.message : "Supabase read failed.");
    return report;
  }

  report.supabaseCount = remote.length;
  report.countMatch = local.length === remote.length;
  if (!report.countMatch) {
    notes.push(`count mismatch: local ${local.length} vs supabase ${remote.length}`);
  }

  const { onlyA, onlyB } = idSetDiff(
    local.map((u) => u.id),
    remote.map((u) => u.id),
  );
  report.missingInSupabase = onlyA;
  report.extraInSupabase = onlyB;
  report.idsMatch = onlyA.length === 0 && onlyB.length === 0;
  if (onlyA.length > 0) notes.push(`${onlyA.length} login(s) not yet in Supabase`);
  if (onlyB.length > 0) notes.push(`${onlyB.length} extra login(s) in Supabase`);

  // Email + scope parity on the shared ids.
  const remoteById = new Map(remote.map((u) => [u.id, u] as const));
  let summaryMatch = true;
  for (const l of local) {
    const r = remoteById.get(l.id);
    if (!r) continue;
    if (r.email !== l.email || (r.companyId ?? null) !== (l.companyId ?? null)) {
      summaryMatch = false;
      notes.push(`summary mismatch for ${l.id}`);
      break;
    }
  }
  report.summaryMatch = summaryMatch;

  // Detail parity on a single sample id present in both (lossless reconstruction).
  let detailMatch = true;
  const sample = local.find((l) => remoteById.has(l.id));
  if (sample) {
    try {
      const remoteFull = await listFullUsersFromSupabase(queryScope);
      const remoteDetail = remoteFull.find((u) => u.id === sample.id) ?? null;
      detailMatch =
        Boolean(remoteDetail) && JSON.stringify(remoteDetail) === JSON.stringify(sample);
      if (!detailMatch) notes.push(`detail mismatch for ${sample.id}`);
    } catch (err) {
      detailMatch = false;
      notes.push(err instanceof Error ? err.message : "detail read failed");
    }
  }
  report.detailMatch = detailMatch;

  report.ok =
    report.countMatch && report.idsMatch && report.summaryMatch && report.detailMatch;
  return report;
}

// Expose console handles in development for manual migration + verification.
if (import.meta.env.DEV === true && typeof window !== "undefined") {
  const w = window as unknown as { __cleanopsData?: Record<string, unknown> };
  w.__cleanopsData = {
    ...(w.__cleanopsData ?? {}),
    migrateUsers,
    shadowReadUsers,
  };
}
