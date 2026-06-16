/**
 * Supabase-backed Role repository (ROLE-1 + CORE-WRITES-A2.1).
 *
 * Reads and authoritative create/update writes for the `roles` table created in
 * migration 0022. The table stores flat indexed columns plus the complete Role
 * payload in `data` jsonb so UI shapes stay unchanged.
 */
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import type { Role } from "@/types";
import { loadCompanyUuidMap } from "./customerMigration";

/** Columns selected for a lightweight summary list (no `data` jsonb). */
const SUMMARY_COLUMNS = "legacy_id, company_legacy_id, name, base_role, is_system, deleted_at";

/** Lightweight role row for count / id-set parity checks. */
export interface RoleSummary {
  id: string;
  companyId: string | null;
  name: string;
}

/** Shape of the flat summary columns returned by Supabase. */
interface RoleSummaryRow {
  legacy_id: string;
  company_legacy_id: string | null;
  name: string;
  base_role: string | null;
  is_system: boolean;
  deleted_at: string | null;
}

/** Shape of a full role row (the lossless `data` jsonb + scope/soft-delete). */
interface RoleFullRow {
  data: Role;
  company_legacy_id: string | null;
  deleted_at: string | null;
}

interface RoleUpsertRow {
  legacy_id: string;
  company_id: string | null;
  company_legacy_id: string | null;
  name: string;
  base_role: string | null;
  is_system: boolean;
  deleted_at: string | null;
  data: Role;
}

export interface SupabaseCompanyRoleCreateInput {
  /** Company-scoped legacy company id. Global custom role creation is intentionally deferred. */
  companyId: string;
  name: string;
  description: string;
  permissions: string[];
}

export type SupabaseRoleUpdatePatch = Partial<Pick<Role, "name" | "description" | "permissions">>;

/** Thrown when the repository is used but Supabase is not configured. */
class SupabaseNotConfiguredError extends Error {
  constructor() {
    super(
      "SupabaseRoleRepository requires Supabase. Set EXPO_PUBLIC_SUPABASE_URL " +
        "and EXPO_PUBLIC_SUPABASE_ANON_KEY.",
    );
    this.name = "SupabaseNotConfiguredError";
  }
}

function rowToSummary(row: RoleSummaryRow): RoleSummary {
  return { id: row.legacy_id, companyId: row.company_legacy_id, name: row.name };
}

function makeRoleId(): string {
  return `role_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
}

function normalizeText(value: string): string {
  return value.trim();
}

async function requireCompanyUuid(companyId: string): Promise<string> {
  const normalizedCompanyId = companyId.trim();
  if (!normalizedCompanyId) throw new Error("Role save requires a company context.");
  const companyMap = await loadCompanyUuidMap();
  const uuid = companyMap.get(normalizedCompanyId) ?? null;
  if (!uuid) {
    throw new Error(`No Supabase company found for role company "${normalizedCompanyId}".`);
  }
  return uuid;
}

function roleToUpsertRow(role: Role, companyUuid: string | null): RoleUpsertRow {
  return {
    legacy_id: role.id,
    company_id: companyUuid,
    company_legacy_id: role.companyId,
    name: role.name,
    base_role: role.baseRole ?? null,
    is_system: role.isSystem,
    deleted_at: null,
    data: role,
  };
}

async function upsertRole(role: Role, companyUuid: string | null): Promise<Role> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const { error } = await supabase
    .from("roles")
    .upsert([roleToUpsertRow(role, companyUuid)], { onConflict: "legacy_id" });
  if (error) throw new Error(`[roles] Supabase role write failed: ${error.message}`);
  return role;
}

/**
 * Applies the company scope to a `roles` query, mirroring the localStorage
 * store's effective visibility:
 *   • scope supplied → that company's rows OR global rows (company_legacy_id null)
 *   • scope omitted  → all RLS-visible rows (super admin)
 */
function applyScope<T extends { or: (f: string) => T }>(
  query: T,
  companyId: string | null | undefined,
): T {
  if (companyId === undefined || companyId === null) return query;
  return query.or(`company_legacy_id.eq.${companyId},company_legacy_id.is.null`);
}

/**
 * Fetches the company-scoped (+ global) summary rows. Soft-deleted rows are
 * filtered out (WO-5.6 convention).
 */
export async function listRoleSummariesFromSupabase(
  companyId?: string | null,
): Promise<RoleSummary[]> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const stop = perf.start("roles.list.supabase.summaries");
  try {
    const query = applyScope(supabase.from("roles").select(SUMMARY_COLUMNS), companyId);
    const { data, error } = await query;
    if (error) {
      throw new Error(`[roles] Supabase list failed: ${error.message}`);
    }
    const rows = (data ?? []) as unknown as RoleSummaryRow[];
    return rows.filter((r) => !r.deleted_at).map(rowToSummary);
  } finally {
    stop();
  }
}

/**
 * Lists FULL role records (the lossless `data` jsonb) for a company scope (+ the
 * global templates). Returns the same {@link Role} objects the page reads from
 * localStorage today, so the read source can move to Supabase without any
 * visible behaviour change.
 */
export async function listFullRolesFromSupabase(
  companyId?: string | null,
): Promise<Role[]> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const stop = perf.start("roles.list.supabase.full");
  perf.count("roles.list.supabase.full.calls");
  try {
    const query = applyScope(
      supabase.from("roles").select("data, company_legacy_id, deleted_at"),
      companyId,
    );
    const { data, error } = await query;
    if (error) {
      throw new Error(`[roles] Supabase full list failed: ${error.message}`);
    }
    const rows = (data ?? []) as unknown as RoleFullRow[];
    return rows
      .filter((r) => !r.deleted_at)
      .map((r) => r.data)
      .filter((r): r is Role => Boolean(r));
  } finally {
    stop();
  }
}

async function getRoleFromSupabaseForExactScope(
  roleId: string,
  companyId: string | null,
): Promise<Role | null> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const { data, error } = await supabase
    .from("roles")
    .select("data, company_legacy_id, deleted_at")
    .eq("legacy_id", roleId)
    .maybeSingle();
  if (error) throw new Error(`[roles] Supabase detail failed: ${error.message}`);
  if (!data) return null;
  const row = data as unknown as RoleFullRow;
  if (row.deleted_at) return null;
  if ((row.company_legacy_id ?? null) !== companyId) return null;
  return row.data ?? null;
}

/** Creates one company-scoped custom role. Global custom create remains deferred. */
export async function createCompanyRoleInSupabase(
  input: SupabaseCompanyRoleCreateInput,
): Promise<Role> {
  const companyId = input.companyId.trim();
  const name = normalizeText(input.name);
  if (!name) throw new Error("Role name is required.");
  const companyUuid = await requireCompanyUuid(companyId);
  const now = new Date().toISOString();
  const role: Role = {
    id: makeRoleId(),
    name,
    description: normalizeText(input.description),
    companyId,
    isSystem: false,
    permissions: [...input.permissions],
    createdAt: now,
    updatedAt: now,
  };
  return upsertRole(role, companyUuid);
}

/**
 * Updates editable role fields only. Scope must match exactly so company admins
 * cannot update global roles and Super Admin global edits preserve system fields.
 */
export async function updateRoleInSupabase(
  companyId: string | null,
  roleId: string,
  patch: SupabaseRoleUpdatePatch,
): Promise<Role> {
  const normalizedRoleId = roleId.trim();
  if (!normalizedRoleId) throw new Error("Role update requires a role id.");
  const normalizedCompanyId = companyId === null ? null : companyId.trim();
  if (companyId !== null && !normalizedCompanyId) {
    throw new Error("Role save requires a company context.");
  }
  const existing = await getRoleFromSupabaseForExactScope(normalizedRoleId, normalizedCompanyId);
  if (!existing) throw new Error("Role not found in Supabase for this scope.");

  const nextName = patch.name !== undefined ? normalizeText(patch.name) : existing.name;
  if (!nextName) throw new Error("Role name is required.");
  const companyUuid = normalizedCompanyId === null ? null : await requireCompanyUuid(normalizedCompanyId);

  const updated: Role = {
    ...existing,
    name: existing.isSystem ? existing.name : nextName,
    description:
      patch.description !== undefined ? normalizeText(patch.description) : existing.description,
    permissions: patch.permissions !== undefined ? [...patch.permissions] : existing.permissions,
    id: existing.id,
    companyId: existing.companyId,
    isSystem: existing.isSystem,
    baseRole: existing.baseRole,
    templateId: existing.templateId,
    isActive: existing.isActive,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  };
  return upsertRole(updated, companyUuid);
}
