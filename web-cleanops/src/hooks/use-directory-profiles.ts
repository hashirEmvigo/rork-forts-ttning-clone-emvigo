import { useQuery } from "@tanstack/react-query";

import { listDirectoryProfiles, type AdminProfileRosterRow } from "@/lib/profile";

/**
 * Shared React Query key for the global Supabase `profiles` roster — the single
 * identity backbone consumed by BOTH the Employees directory and the Roles &
 * Permissions assigned-user roster. Mutations that change identity (create /
 * delete / archive of an employee or login) invalidate this exact key so every
 * directory surface refetches and stays consistent across devices.
 */
export const DIRECTORY_PROFILES_QUERY_KEY = ["directory-profiles-roster"] as const;

/**
 * Loads the full, global profile roster (all roles, RLS-scoped) once and shares
 * the result via the React Query cache. This is the read seam that lets every
 * user-facing directory converge on a single source of truth: any login created
 * on any device appears here, and any deleted profile disappears here.
 */
export function useDirectoryProfiles(): {
  profiles: AdminProfileRosterRow[];
  isLoading: boolean;
} {
  const { data: profiles = [], isLoading } = useQuery<AdminProfileRosterRow[]>({
    queryKey: DIRECTORY_PROFILES_QUERY_KEY,
    queryFn: () => listDirectoryProfiles(),
    staleTime: 60_000,
  });

  return { profiles, isLoading };
}
