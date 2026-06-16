import type { User } from "@/types";

/**
 * Centralised authorization policy. These pure functions are the single source
 * of truth for access decisions, used by both UI guards (ProtectedRoute, nav)
 * and the data layer (context mutations). Keeping the rules here means access
 * is enforced beyond the UI — a component can't bypass tenant isolation by
 * simply rendering a page or calling a mutation directly.
 */

/** Whether a user operates with platform-wide scope. */
export function isPlatformScope(user: User): boolean {
  return user.role === "super_admin";
}

/**
 * Whether a user may act on a resource belonging to the given company.
 * Super Admins span every company; everyone else is confined to their own.
 */
export function inCompanyScope(user: User, resourceCompanyId: string | null): boolean {
  if (isPlatformScope(user)) return true;
  return user.companyId != null && user.companyId === resourceCompanyId;
}

/** Whether a permission set grants a specific permission key. */
export function grants(permissions: string[], permission: string): boolean {
  return permissions.includes(permission);
}

export interface AuthorizeParams {
  user: User;
  /** The user's effective permission keys. */
  permissions: string[];
  /** Permission key required for the action, if any. */
  permission?: string;
  /** Company the affected resource belongs to, if the action is company-scoped. */
  resourceCompanyId?: string | null;
}

/**
 * The core decision used across the app: a user is authorized when they hold
 * the required permission (if any) AND the resource is within their company
 * scope (if the action targets a company resource).
 */
export function authorize({
  user,
  permissions,
  permission,
  resourceCompanyId,
}: AuthorizeParams): boolean {
  if (permission && !grants(permissions, permission)) return false;
  if (resourceCompanyId !== undefined && !inCompanyScope(user, resourceCompanyId)) {
    return false;
  }
  return true;
}

/** Standard message returned when an action is blocked by the policy. */
export const FORBIDDEN_MESSAGE = "You do not have permission to perform this action.";
