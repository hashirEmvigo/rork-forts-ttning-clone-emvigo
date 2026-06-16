import { useQuery } from "@tanstack/react-query";

import {
  fetchUserAuthMeta,
  isUserLifecycleConfigured,
  type UserAuthMetaMap,
} from "@/lib/adminUserLifecycle";
import { isSupabaseAuthEnabled } from "@/lib/authSupabase";

/**
 * Shared React Query key for the Users-table auth metadata (last sign-in,
 * invite/confirm state) read from `auth.users` through the
 * `admin-user-lifecycle` Edge Function. Lifecycle mutations invalidate this key
 * so the Last Login / Invite Status columns refresh after an action.
 */
export const USER_AUTH_META_QUERY_KEY = ["user-auth-meta"] as const;

/**
 * Loads auth metadata for every user the caller may see (RLS-scoped server-side)
 * and shares it via the React Query cache, keyed by user id.
 *
 * Degrades gracefully: returns an empty map (never throws) when the lifecycle
 * layer is dormant or the Edge Function is not deployed, so the Users table
 * still renders with "—" for Last Login / Invite Status.
 */
export function useUserAuthMeta(): {
  meta: UserAuthMetaMap;
  isLoading: boolean;
  /** True when the metadata source is reachable (function deployed + healthy). */
  isAvailable: boolean;
} {
  const enabled = isSupabaseAuthEnabled && isUserLifecycleConfigured;

  const { data, isLoading } = useQuery({
    queryKey: USER_AUTH_META_QUERY_KEY,
    queryFn: () => fetchUserAuthMeta(),
    enabled,
    staleTime: 60_000,
    // Don't hammer a not-yet-deployed function; one retry is enough to ride out
    // a transient network blip.
    retry: 1,
  });

  return {
    meta: data?.meta ?? {},
    isLoading: enabled && isLoading,
    isAvailable: Boolean(data?.ok),
  };
}
