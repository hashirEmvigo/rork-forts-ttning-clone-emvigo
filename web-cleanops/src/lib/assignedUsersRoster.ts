import type { AdminProfileRosterRow } from "@/lib/profile";
import type { EntityStatus, User } from "@/types";

/**
 * Shared React Query key historically used by the standalone assigned-user
 * roster query. The roster now reads the Supabase `profiles` identity backbone
 * via {@link import("@/hooks/use-directory-profiles").useDirectoryProfiles}
 * (cache key `directory-profiles-roster`), so this key is retained only so the
 * existing AppContext cache-invalidation calls keep compiling and stay harmless
 * no-ops. New code should not consume it.
 */
export const ASSIGNED_USERS_ROSTER_QUERY_KEY = ["assigned-users-app-users-roster"] as const;

/**
 * A single row in the Roles & Permissions assigned-user roster.
 *
 * Extends the app's {@link User} (so existing role/company count helpers and the
 * directory table keep working unchanged) and adds presentation-only metadata:
 *   - `companyName`   — resolved display name, so the table never has to look it up.
 *   - `companyStatus` — resolved company lifecycle status for the company filter.
 *   - `source`        — fixed to `profile`, proving this role roster comes from
 *                       the Supabase `profiles` identity backbone (the SAME
 *                       source the Dashboard, Employees and Users directories
 *                       use), never the localStorage `users` array nor the
 *                       secondary `app_users` mirror.
 *
 * This is a READ-ONLY view model. It never writes back to localStorage or
 * Supabase, and it does not change any authorization or permission logic.
 */
export interface AssignedUser extends User {
  /** Resolved company display name ("Platform" for company-less super admins). */
  companyName: string;
  /** Resolved company lifecycle status; active for platform rows. */
  companyStatus: EntityStatus;
  source: "profile";
}

/**
 * Builds the Roles & Permissions assigned-user roster from the Supabase
 * `profiles` identity backbone — the single source of truth shared with the
 * Dashboard, Employees and Users directories. Role/member counts therefore can
 * never diverge from those surfaces.
 *
 * Why profiles (and not the localStorage `users` array or the `app_users`
 * mirror): a `profiles` row exists for every provisioned identity regardless of
 * the device it was created on, so the roster is complete and cross-device
 * consistent. The local `users` array and `app_users` can both be empty/stale
 * per device and are intentionally NOT read here.
 *
 * @param profiles     RLS-scoped profile roster from `useDirectoryProfiles`.
 * @param companyScope When set, restricts the roster to that company (company
 *                     admins). Omit/undefined for the platform-wide super-admin
 *                     view. Platform super admins (companyId null) are excluded
 *                     from a company-scoped roster.
 */
export function assignedUsersFromProfiles(
  profiles: AdminProfileRosterRow[],
  companyScope?: string | null,
): AssignedUser[] {
  const scoped =
    companyScope === undefined || companyScope === null
      ? profiles
      : profiles.filter((profile) => profile.companyId === companyScope);

  return scoped.map((profile) => {
    const companyId = profile.companyId ?? null;
    // Roles apply to identities/logins; archived or inactive identities do not
    // hold an active role, so they collapse to "inactive" and are filtered out
    // of the default count input by activeAssignedUsers.
    const status: EntityStatus = profile.status === "active" ? "active" : "inactive";
    return {
      id: profile.id,
      name: profile.fullName?.trim() || profile.email || "Unnamed user",
      email: profile.email ?? "",
      role: profile.baseRole,
      companyId,
      status,
      createdAt: profile.createdAt ?? new Date(0).toISOString(),
      // profiles carry no custom-role assignment / entity links, so these are
      // null. Custom-role assignment persistence is a separate, deferred slice.
      roleId: null,
      linkedEmployeeId: null,
      linkedCustomerId: null,
      companyName: companyId ? profile.companyName ?? "Unresolved company" : "Platform",
      companyStatus: profile.companyStatus ?? "active",
      source: "profile",
    };
  });
}

/** Returns roster rows used for default role-card/member counts: active users only. */
export function activeAssignedUsers(roster: AssignedUser[]): AssignedUser[] {
  return roster.filter((user) => user.status === "active");
}

/** Company filter/list options derived from the authoritative assigned-user roster. */
export function companiesFromAssignedUserRoster(
  roster: AssignedUser[],
): { id: string; name: string; status: EntityStatus }[] {
  const byId = new Map<string, { id: string; name: string; status: EntityStatus }>();
  for (const user of roster) {
    if (!user.companyId) continue;
    byId.set(user.companyId, {
      id: user.companyId,
      name: user.companyName,
      status: user.companyStatus,
    });
  }
  return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
}
