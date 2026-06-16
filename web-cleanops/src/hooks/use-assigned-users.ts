import { useMemo } from "react";

import { useApp } from "@/context/AppContext";
import { useDirectoryProfiles } from "@/hooks/use-directory-profiles";
import { assignedUsersFromProfiles, type AssignedUser } from "@/lib/assignedUsersRoster";

/**
 * Read-only roster for Roles & Permissions assigned-user views — the role-card
 * and member counts, the Assigned Users directory, and the per-company
 * assignment tally.
 *
 * Sourced from the Supabase `profiles` identity backbone via the shared
 * {@link useDirectoryProfiles} hook — the SAME source of truth the Dashboard,
 * Employees and Users directories use — so role/member counts can never diverge
 * from those surfaces. It intentionally does NOT read the localStorage `users`
 * array nor the secondary `app_users` mirror, so a dirty/empty browser store can
 * never pollute or under-count role membership.
 *
 * Visibility is determined by Supabase RLS plus an optional company scope:
 * a company admin sees only their own company's identities; a super admin sees
 * every RLS-visible profile across the platform.
 */
export function useAssignedUsers(): {
  roster: AssignedUser[];
  isLoading: boolean;
  error: Error | null;
} {
  const { currentUser } = useApp();
  const { profiles, isLoading } = useDirectoryProfiles();
  const companyScope =
    currentUser?.role === "super_admin" ? undefined : currentUser?.companyId ?? undefined;

  const roster = useMemo(
    () => assignedUsersFromProfiles(profiles, companyScope),
    [profiles, companyScope],
  );

  return { roster, isLoading, error: null };
}
