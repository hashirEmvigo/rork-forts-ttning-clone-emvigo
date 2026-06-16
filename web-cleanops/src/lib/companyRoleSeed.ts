/**
 * Company role inheritance helpers.
 *
 * Two concerns, both pure (no I/O, no React):
 *
 *   1. {@link selectCompanyRoles} — the single source of truth for WHICH roles the
 *      Company Admin → Settings → Roles & Permissions panel renders: the
 *      company's OWN roles, never the shared global templates. The Super Admin
 *      manages templates; a company admin works with company-scoped roles.
 *
 *   2. {@link buildCompanyRoleSeedPlan} — the TypeScript reference mirror of
 *      migration `0046_seed_company_roles_from_templates.sql`. Given the global
 *      templates and a company, it derives the company-scoped roles that should
 *      exist (one per company-scoped base role, permissions inherited from the
 *      template, ids rewritten to the company), skipping any that already exist.
 *      It powers the seed-contract tests (template inheritance + idempotency)
 *      that guard the migration's behaviour and is exposed for ad-hoc
 *      verification in development.
 */
import type { Role, UserRole } from "@/types";
import { ROLE_LABELS } from "@/types";
import { ROLE_DESCRIPTIONS, systemRoleId } from "@/lib/store";
import { DEFAULT_ROLE_PERMISSIONS } from "@/lib/permissions";

/** Base roles a company owns its own copy of (super_admin is platform-only). */
export const COMPANY_SCOPED_BASE_ROLES: readonly UserRole[] = [
  "company_admin",
  "employee",
  "customer",
];

/**
 * Base roles that have a GLOBAL template (mirrors seedRoles + migration 0047).
 * super_admin is a platform-only template — present here but never copied to a
 * company by {@link buildCompanyRoleSeedPlan} (it is not company-scoped).
 */
export const GLOBAL_TEMPLATE_BASE_ROLES: readonly UserRole[] = [
  "super_admin",
  "company_admin",
  "employee",
  "customer",
];

/**
 * Pure TypeScript mirror of migration `0047_seed_global_role_templates.sql`:
 * the canonical GLOBAL role templates (companyId === null) the Super Admin owns.
 * Each carries the deterministic template id (`role_tpl_<base>`), the role label
 * and description, and the permissions inherited verbatim from
 * {@link DEFAULT_ROLE_PERMISSIONS}. This is the single source of truth the live
 * Supabase seed must match, and the starting point the company-role seed copies
 * from — when these are absent in Supabase the Company Admin panel is blank
 * (the live bug 0047 fixes).
 *
 * @param createdAt ISO timestamp stamped on each template (fixed default keeps
 *   the mirror deterministic for tests and matches the migration's literal).
 */
export function buildGlobalRoleTemplates(
  createdAt = "2026-01-01T00:00:00.000Z",
): Role[] {
  return GLOBAL_TEMPLATE_BASE_ROLES.map((base) => ({
    id: systemRoleId(base, null),
    name: ROLE_LABELS[base],
    description: ROLE_DESCRIPTIONS[base],
    companyId: null,
    isSystem: true,
    baseRole: base,
    permissions: [...DEFAULT_ROLE_PERMISSIONS[base]],
    createdAt,
  }));
}

/**
 * The company-scoped roles to render for a company admin: the company's OWN
 * roles only. Global templates (companyId === null) are intentionally excluded —
 * they are managed by the Super Admin. Returns an empty array when the company
 * has no roles yet (the blank-panel state that migration 0046 backfills away).
 */
export function selectCompanyRoles(roles: Role[], companyId: string | null): Role[] {
  if (!companyId) return [];
  return roles.filter((r) => r.companyId !== null && r.companyId === companyId);
}

/**
 * The GLOBAL CUSTOM role templates (companyId === null) that are NOT one of the
 * four platform base roles — e.g. the "Prospect" template (migration 0048). The
 * Super Admin "Role Templates" grid renders the four base roles via a fixed
 * order; this selector surfaces any additional custom global template so it is
 * visible and editable there too. A custom template carries no {@link
 * Role.baseRole} (it is not an auth base role), which is exactly how it is
 * distinguished from the base-role templates.
 */
export function selectCustomGlobalTemplates(roles: Role[]): Role[] {
  return roles
    .filter((r) => r.companyId === null && !r.baseRole)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Pure mirror of the SQL seed (migration 0046). Derives the company-scoped roles
 * that should be created for `companyId` by copying every GLOBAL company-scoped
 * template, rewriting `id`/`companyId` to the company and inheriting the
 * template's name/description/permissions. Roles whose deterministic id already
 * exists in `existing` are skipped, so re-running yields no new rows — the same
 * idempotency the migration enforces via `ON CONFLICT (legacy_id) DO NOTHING`.
 *
 * @param templates  All roles in scope; only global (companyId === null) rows are considered.
 * @param companyId  App-facing company id the copies belong to (the legacy id).
 * @param existing   Roles that already exist (any scope); used to skip duplicates by id.
 */
export function buildCompanyRoleSeedPlan(
  templates: Role[],
  companyId: string,
  existing: Role[] = [],
): Role[] {
  if (!companyId) return [];

  // One template per company-scoped base role (first wins on duplicates).
  const templateByBase = new Map<UserRole, Role>();
  for (const role of templates) {
    if (role.companyId !== null) continue;
    const base = role.baseRole;
    if (!base || !COMPANY_SCOPED_BASE_ROLES.includes(base)) continue;
    if (!templateByBase.has(base)) templateByBase.set(base, role);
  }

  const existingIds = new Set(existing.map((r) => r.id));

  const plan: Role[] = [];
  for (const base of COMPANY_SCOPED_BASE_ROLES) {
    const template = templateByBase.get(base);
    if (!template) continue;
    const id = systemRoleId(base, companyId);
    if (existingIds.has(id)) continue;
    plan.push({
      ...template,
      id,
      companyId,
      isSystem: true,
      baseRole: base,
      permissions: [...template.permissions],
    });
  }
  return plan;
}
