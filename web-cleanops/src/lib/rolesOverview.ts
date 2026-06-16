import { DEFAULT_ROLE_PERMISSIONS } from "@/lib/permissions";
import type { Role, User, UserRole } from "@/types";

/** Canonical display order for the four platform base roles. */
export const BASE_ROLE_ORDER: UserRole[] = [
  "super_admin",
  "company_admin",
  "employee",
  "customer",
];

/**
 * Finds the global (platform-wide) role template that backs a base role. Global
 * templates have `companyId === null`; the {@link Role.baseRole} link is used so
 * legacy templates resolve regardless of their display name.
 */
export function findGlobalTemplate(roles: Role[], baseRole: UserRole): Role | undefined {
  return roles.find((r) => r.companyId === null && r.baseRole === baseRole);
}

/**
 * Resolves the effective permission keys for a base role: the global template's
 * permissions when one exists, otherwise the built-in defaults. This is a
 * read-only presentation helper — it never mutates the permission model.
 */
export function permissionsForBaseRole(roles: Role[], baseRole: UserRole): string[] {
  return findGlobalTemplate(roles, baseRole)?.permissions ?? DEFAULT_ROLE_PERMISSIONS[baseRole];
}

/** Counts active users across the whole platform holding a given base role. */
export function userCountForBaseRole(users: User[], baseRole: UserRole): number {
  return users.filter((u) => u.status === "active" && u.role === baseRole).length;
}

/**
 * Counts the distinct companies that have at least one active user with the
 * given base role. Platform-wide super admins (companyId null) are intentionally
 * excluded since they don't belong to a company.
 */
export function companyCountForBaseRole(users: User[], baseRole: UserRole): number {
  const ids = new Set<string>();
  for (const u of users) {
    if (u.status === "active" && u.role === baseRole && u.companyId) ids.add(u.companyId);
  }
  return ids.size;
}

/** Per-company tally of users by base role, used by the assignments table. */
export interface CompanyRoleTally {
  admins: number;
  employees: number;
  customers: number;
  total: number;
}

/** Tallies a single company's active users by base role. */
export function tallyCompanyRoles(users: User[], companyId: string): CompanyRoleTally {
  let admins = 0;
  let employees = 0;
  let customers = 0;
  for (const u of users) {
    if (u.status !== "active" || u.companyId !== companyId) continue;
    if (u.role === "company_admin") admins += 1;
    else if (u.role === "employee") employees += 1;
    else if (u.role === "customer") customers += 1;
  }
  return { admins, employees, customers, total: admins + employees + customers };
}
