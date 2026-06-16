/**
 * Supabase-backed User (login) read repository (USER-1).
 *
 * The Users analogue of {@link import("./supabaseRoleRepository")}. It reads the
 * `app_users` table created in migration 0023 and returns the SAME (password-
 * free) {@link User} shapes the localStorage store returns, so the USER-2 read
 * seam can swap it in with no UI change.
 *
 * Behaviour parity — the in-memory `users` array the UI consumes holds BOTH
 * company-owned logins and GLOBAL (platform super admin) logins. RLS already
 * enforces visibility (a company admin sees only their company's logins; a super
 * admin sees all). When a company scope is supplied this filters on
 * `company_legacy_id`; when unscoped (super admin) it returns all RLS-visible
 * rows. Soft-deleted rows (`deleted_at` set) are filtered out (WO-5.6
 * convention).
 *
 * Unlike services/roles there is NO public "global" read tier — global logins
 * are platform super-admin accounts and are only RLS-visible to super admins.
 */
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import type { EntityStatus, User, UserRole } from "@/types";

/** Columns selected for a lightweight summary list (no `data` jsonb). */
const SUMMARY_COLUMNS = "legacy_id, company_legacy_id, email, role, status, deleted_at";

/** Lightweight login row for count / id-set parity checks. */
export interface UserSummary {
  id: string;
  companyId: string | null;
  email: string;
}

/** Shape of the flat summary columns returned by Supabase. */
interface UserSummaryRow {
  legacy_id: string;
  company_legacy_id: string | null;
  email: string;
  role: string;
  status: string;
  deleted_at: string | null;
}

/** Shape of a full login row (the lossless `data` jsonb + scope/soft-delete). */
interface UserFullRow {
  data: User;
  company_legacy_id: string | null;
  deleted_at: string | null;
}

interface AssignedUserRosterRow {
  legacy_id: string;
  company_legacy_id: string | null;
  email: string;
  role: string;
  status: string;
  data: Partial<User> | null;
  deleted_at: string | null;
  companies: { legacy_id: string | null; name: string | null; status: string | null } | null;
}

/** Supabase-authoritative row for role-related user rosters and counts. */
export interface AppUserRosterRecord extends User {
  /** Resolved from the Supabase companies FK join; Platform for global rows. */
  companyName: string;
  /** Resolved from the Supabase companies FK join; active for platform rows. */
  companyStatus: EntityStatus;
}

/** Thrown when the repository is used but Supabase is not configured. */
class SupabaseNotConfiguredError extends Error {
  constructor() {
    super(
      "SupabaseUserRepository requires Supabase. Set EXPO_PUBLIC_SUPABASE_URL " +
        "and EXPO_PUBLIC_SUPABASE_ANON_KEY.",
    );
    this.name = "SupabaseNotConfiguredError";
  }
}

function rowToSummary(row: UserSummaryRow): UserSummary {
  return { id: row.legacy_id, companyId: row.company_legacy_id, email: row.email };
}

function normaliseRole(value: string): UserRole {
  if (
    value === "super_admin" ||
    value === "company_admin" ||
    value === "employee" ||
    value === "customer"
  ) {
    return value;
  }
  return "customer";
}

function normaliseEntityStatus(value: string): EntityStatus {
  return value === "active" ? "active" : "inactive";
}

function rowToRosterRecord(row: AssignedUserRosterRow): AppUserRosterRecord {
  const data = row.data ?? {};
  const companyId = row.company_legacy_id ?? row.companies?.legacy_id ?? data.companyId ?? null;
  const email = row.email || data.email || "";
  const role = normaliseRole(row.role || data.role || "customer");
  return {
    id: row.legacy_id || data.id || email,
    name: data.name || email || "Unnamed user",
    email,
    role,
    companyId,
    status: normaliseEntityStatus(row.status || data.status || "inactive"),
    createdAt: data.createdAt || new Date(0).toISOString(),
    roleId: data.roleId ?? null,
    linkedEmployeeId: data.linkedEmployeeId ?? null,
    linkedCustomerId: data.linkedCustomerId ?? null,
    areaScope: data.areaScope,
    companyName: companyId ? row.companies?.name ?? "Unresolved company" : "Platform",
    companyStatus: companyId ? normaliseEntityStatus(row.companies?.status ?? "inactive") : "active",
  };
}

/**
 * Applies the company scope to an `app_users` query. When a scope is supplied we
 * filter on the app-facing `company_legacy_id`; when omitted (super admin) all
 * RLS-visible rows are returned. There is intentionally NO global OR-clause here:
 * global logins are super-admin-only and are surfaced by the unscoped path.
 */
function applyScope<T extends { eq: (col: string, val: string) => T }>(
  query: T,
  companyId: string | null | undefined,
): T {
  if (companyId === undefined || companyId === null) return query;
  return query.eq("company_legacy_id", companyId);
}

/**
 * Minimal awaitable + scopable view of the `app_users` query. Casting the
 * deeply-generic PostgREST builder to this local shape avoids a TS2589
 * "excessively deep" instantiation through {@link applyScope}'s self-referential
 * constraint. Runtime is unchanged — the real builder still resolves the query.
 */
type AppUsersScopedQuery = PromiseLike<{ data: unknown; error: { message: string } | null }> & {
  eq(column: string, value: string): AppUsersScopedQuery;
};

/**
 * Fetches the company-scoped summary rows. Soft-deleted rows are filtered out
 * (WO-5.6 convention).
 */
export async function listUserSummariesFromSupabase(
  companyId?: string | null,
): Promise<UserSummary[]> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const stop = perf.start("appUsers.list.supabase.summaries");
  try {
    const query = applyScope(
      supabase.from("app_users").select(SUMMARY_COLUMNS) as unknown as AppUsersScopedQuery,
      companyId,
    );
    const { data, error } = await query;
    if (error) {
      throw new Error(`[app_users] Supabase list failed: ${error.message}`);
    }
    const rows = (data ?? []) as unknown as UserSummaryRow[];
    return rows.filter((r) => !r.deleted_at).map(rowToSummary);
  } finally {
    stop();
  }
}

/**
 * Lists FULL (password-free) login records (the lossless `data` jsonb) for a
 * company scope. Returns the same {@link User} objects the page reads from
 * localStorage today, so the read source can move to Supabase without any
 * visible behaviour change.
 */
export async function listFullUsersFromSupabase(
  companyId?: string | null,
): Promise<User[]> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const stop = perf.start("appUsers.list.supabase.full");
  perf.count("appUsers.list.supabase.full.calls");
  try {
    const query = applyScope(
      supabase
        .from("app_users")
        .select("data, company_legacy_id, deleted_at") as unknown as AppUsersScopedQuery,
      companyId,
    );
    const { data, error } = await query;
    if (error) {
      throw new Error(`[app_users] Supabase full list failed: ${error.message}`);
    }
    const rows = (data ?? []) as unknown as UserFullRow[];
    return rows
      .filter((r) => !r.deleted_at)
      .map((r) => r.data)
      .filter((u): u is User => Boolean(u));
  } finally {
    stop();
  }
}

/**
 * Lists the Supabase-authoritative app_users roster used by role-related UI.
 *
 * This intentionally does not read localStorage, customer domain rows, or the
 * AppContext users array. RLS and optional company scope determine visibility.
 */
export async function listAssignedUserRosterFromSupabase(
  companyId?: string | null,
): Promise<AppUserRosterRecord[]> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const stop = perf.start("appUsers.list.supabase.assignedRoster");
  perf.count("appUsers.list.supabase.assignedRoster.calls");
  try {
    const query = applyScope(
      supabase
        .from("app_users")
        .select(
          "legacy_id, company_legacy_id, email, role, status, data, deleted_at, companies(legacy_id, name, status)",
        ) as unknown as AppUsersScopedQuery,
      companyId,
    );
    const { data, error } = await query;
    if (error) {
      throw new Error(`[app_users] Supabase assigned roster list failed: ${error.message}`);
    }
    const rows = (data ?? []) as unknown as AssignedUserRosterRow[];
    return rows.filter((r) => !r.deleted_at).map(rowToRosterRecord);
  } finally {
    stop();
  }
}
