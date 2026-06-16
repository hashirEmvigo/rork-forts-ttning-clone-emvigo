import type { Employee, Role, RoleSourceType, User, UserRole } from "@/types";
import { DEFAULT_ROLE_PERMISSIONS } from "@/lib/permissions";

/**
 * Employee Roles & Permissions — the single permission engine.
 *
 * This is the platform-wide SOURCE OF TRUTH for authorization. Every permission
 * decision in the app (AppContext.hasPermission, route protection, menu/button
 * visibility, future company data scoping, Supabase RLS and API authorization)
 * resolves through the helpers here. There is intentionally ONE resolution
 * engine so behavior can never drift between surfaces.
 *
 * Every helper is a PURE function over plain data (users, roles, employees) —
 * no React, no storage, no side effects — so the exact same resolution can run
 * during render, in tests, in a worker, or be translated into an RLS policy.
 *
 * Authorization subject:
 *  - The login {@link User} is the authorization subject. Permissions are NEVER
 *    hardcoded on an employee; an {@link Employee} only links to a login via
 *    {@link Employee.userId} and inherits that login's resolved role.
 *  - Resolution order for a user: explicit custom role ({@link User.roleId}) →
 *    the company's system role for the login's base {@link UserRole} →
 *    {@link DEFAULT_ROLE_PERMISSIONS}. This keeps legacy/un-migrated logins safe.
 *  - Role definitions are resolved centrally, so updating a role updates every
 *    user/employee that holds it without touching their records.
 */

/** Context for the core (user-centric) permission engine. Pass live roles. */
export interface PermissionContext {
  /** All roles (system templates + company roles). */
  roles: Role[];
}

/** The data an employee-permission resolution reads. Pass live store data. */
export interface RoleResolutionContext extends PermissionContext {
  /** All known logins; an employee links to one via {@link Employee.userId}. */
  users: User[];
}

/**
 * Classifies a role as a centrally-managed system template (company-agnostic,
 * `companyId === null`) or a company-owned role. Derived, never stored, so
 * legacy roles need no migration.
 */
export function roleSourceType(role: Pick<Role, "companyId">): RoleSourceType {
  return role.companyId === null ? "systemTemplate" : "companyRole";
}

/**
 * Whether a role is active. Absent/`undefined` {@link Role.isActive} counts as
 * active so legacy roles keep working. Inactive roles still resolve for
 * employees that already hold them (no silent loss of access), but are excluded
 * from the assignable list.
 */
export function isRoleActive(role: Pick<Role, "isActive">): boolean {
  return role.isActive !== false;
}

/** Finds the login linked to an employee, if any. */
function findEmployeeUser(employee: Employee, users: User[]): User | null {
  if (!employee.userId) return null;
  return users.find((u) => u.id === employee.userId) ?? null;
}

/**
 * Finds the company's system role for a base {@link UserRole}. Used as the
 * fallback when a login has no explicit custom {@link User.roleId}.
 */
function findSystemRoleFor(
  baseRole: UserRole,
  companyId: string | null,
  roles: Role[],
): Role | null {
  return (
    roles.find(
      (r) => r.isSystem && r.baseRole === baseRole && r.companyId === companyId,
    ) ?? null
  );
}

/**
 * CORE ENGINE — resolves the effective {@link Role} for a login {@link User},
 * the authorization subject. Priority order:
 *  1. The explicit custom role on the login ({@link User.roleId}).
 *  2. The company's system role for the login's base {@link UserRole}.
 * Returns `null` only when neither can be found — callers then fall back to
 * {@link DEFAULT_ROLE_PERMISSIONS}. Every other permission helper delegates here.
 */
export function resolveUserRole(
  user: Pick<User, "roleId" | "role" | "companyId">,
  ctx: PermissionContext,
): Role | null {
  if (user.roleId) {
    const explicit = ctx.roles.find((r) => r.id === user.roleId);
    if (explicit) return explicit;
  }

  const baseRole: UserRole = user.role ?? "employee";
  const companyId = user.companyId ?? null;
  return findSystemRoleFor(baseRole, companyId, ctx.roles);
}

/**
 * CORE ENGINE — the effective permission keys for a login {@link User}. Uses the
 * resolved role's permissions, falling back to the base-role defaults when no
 * role resolves so a user is never left with an undefined permission set. This
 * is the single function every authorization check ultimately flows through.
 */
export function resolveUserPermissions(
  user: Pick<User, "roleId" | "role" | "companyId">,
  ctx: PermissionContext,
): string[] {
  const role = resolveUserRole(user, ctx);
  if (role) return role.permissions;
  return DEFAULT_ROLE_PERMISSIONS[user.role ?? "employee"] ?? [];
}

/** Whether a login {@link User} holds a specific permission key. */
export function userHasPermission(
  user: Pick<User, "roleId" | "role" | "companyId">,
  permissionKey: string,
  ctx: PermissionContext,
): boolean {
  return resolveUserPermissions(user, ctx).includes(permissionKey);
}

/**
 * Resolves the effective {@link Role} for an employee. Employees carry no
 * permissions of their own — they inherit their linked login's role via the
 * core {@link resolveUserRole} engine. Priority order:
 *  1. The login's resolved role (explicit custom → company system role).
 *  2. The company's system "employee" role (employees are staff by default)
 *     when the employee has no resolvable login role.
 * Returns `null` only when none of the above can be found — callers then fall
 * back to {@link DEFAULT_ROLE_PERMISSIONS}.
 */
export function resolveEmployeeRole(
  employee: Employee,
  ctx: RoleResolutionContext,
): Role | null {
  const user = findEmployeeUser(employee, ctx.users);
  if (user) {
    const role = resolveUserRole(user, ctx);
    if (role) return role;
  }

  return findSystemRoleFor("employee", employee.companyId ?? null, ctx.roles);
}

/**
 * The effective permission keys for an employee. Uses the resolved role's
 * permissions, falling back to the base-role defaults when no role resolves so
 * an employee is never left with an undefined permission set.
 */
export function resolveEmployeePermissions(
  employee: Employee,
  ctx: RoleResolutionContext,
): string[] {
  const role = resolveEmployeeRole(employee, ctx);
  if (role) return role.permissions;

  const user = findEmployeeUser(employee, ctx.users);
  const baseRole: UserRole = user?.role ?? "employee";
  return DEFAULT_ROLE_PERMISSIONS[baseRole] ?? [];
}

/** Whether an employee's effective role grants a specific permission key. */
export function employeeHasPermission(
  employee: Employee,
  permissionKey: string,
  ctx: RoleResolutionContext,
): boolean {
  return resolveEmployeePermissions(employee, ctx).includes(permissionKey);
}

/**
 * SHARED MATCHER — whether a login {@link User} effectively HOLDS a given role,
 * used wherever the UI must agree on role membership (role card counts, the
 * member list, the Assign dialog, the customer/user card and the employee role
 * display). A user with an explicit custom {@link User.roleId} holds exactly
 * that role; otherwise they are counted against the matching built-in (system)
 * role for their base {@link UserRole} and company. This is the SAME rule the
 * directory roster uses, so no two surfaces can ever disagree.
 */
export function userHoldsRole(
  role: Pick<Role, "id" | "isSystem" | "baseRole" | "companyId">,
  user: Pick<User, "roleId" | "role" | "companyId">,
): boolean {
  if (user.roleId) return user.roleId === role.id;
  return (
    role.isSystem === true &&
    role.baseRole === user.role &&
    (role.companyId ?? null) === (user.companyId ?? null)
  );
}

/**
 * Whether `assignerRole` (the acting user's base role) is allowed to grant a
 * given role to someone else. This is a SECURITY boundary, not a UI nicety:
 *
 *  - The Super Admin role (base role `super_admin`) is the platform-owner role
 *    and may ONLY be granted by a Super Admin. A Company Admin must never be
 *    able to create or elevate anyone to Super Admin.
 *  - Every other role (Company Admin, Employee, Customer, custom company roles)
 *    can be assigned by both Super Admins and Company Admins.
 *
 * Callers must enforce this both when BUILDING selectors (so the option never
 * appears) and at the WRITE path (so a crafted request can't bypass the UI).
 */
export function canAssignRole(
  assignerRole: UserRole | undefined | null,
  role: Pick<Role, "baseRole">,
): boolean {
  if (role.baseRole === "super_admin") return assignerRole === "super_admin";
  return true;
}

/**
 * The roles a user can assign within a company, sorted system-first then
 * alphabetically. Includes the company's own roles plus the global system
 * templates (which can be copied/applied). Inactive roles are excluded, and
 * roles the `assignerRole` isn't allowed to grant (e.g. Super Admin for a
 * Company Admin) are filtered out via {@link canAssignRole}.
 *
 * Built-in (system) roles exist twice in the catalog: once as a global template
 * (`companyId === null`) and once as a per-company copy (`companyId === company`).
 * Both resolve to the same {@link Role.baseRole}, so we collapse them to a single
 * entry per base role — preferring the company-scoped copy when present — so the
 * selector never shows duplicate built-in roles.
 */
export function listAssignableRoles(
  companyId: string | null,
  roles: Role[],
  assignerRole?: UserRole | null,
): Role[] {
  const candidates = roles.filter((r) => {
    if (!isRoleActive(r)) return false;
    // Security: never offer a role the acting user may not grant.
    if (assignerRole !== undefined && !canAssignRole(assignerRole, r)) return false;
    // The company's own roles, plus company-agnostic system templates.
    return r.companyId === companyId || r.companyId === null;
  });

  // Collapse built-in roles to one entry per base role, preferring the
  // company-scoped copy over the global template.
  const systemByBaseRole = new Map<UserRole, Role>();
  const customRoles: Role[] = [];
  for (const r of candidates) {
    if (!r.isSystem || !r.baseRole) {
      customRoles.push(r);
      continue;
    }
    const existing = systemByBaseRole.get(r.baseRole);
    if (!existing || (r.companyId === companyId && existing.companyId === null)) {
      systemByBaseRole.set(r.baseRole, r);
    }
  }

  return [...systemByBaseRole.values(), ...customRoles].sort((a, b) => {
    if (a.isSystem !== b.isSystem) return a.isSystem ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}
