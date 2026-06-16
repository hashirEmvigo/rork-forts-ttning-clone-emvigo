import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useApp } from "@/context/AppContext";
import {
  listNavigationMenuOverrides,
  resetNavigationMenuOverride,
  upsertNavigationMenuOverride,
  type OverrideDraft,
} from "@/lib/navigation/navigationOverridesAdmin";
import {
  mergeAdminNavigationGroup,
  resolveMainNavPresentationByRoute,
  resolveNavigationGroup,
  type AdminNavigationItem,
  type MainNavPresentation,
  type NavigationGroupKey,
  type NavigationMenuOverride,
  type ResolvedNavigationItem,
} from "@/lib/navigation/navigationRegistry";

/** Shared React Query key for the navigation/menu override layer. */
export const NAVIGATION_OVERRIDES_QUERY_KEY = ["navigation-menu-overrides"] as const;

export interface UseNavigationConfigResult {
  overrides: NavigationMenuOverride[];
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
  refetch: () => void;
  isSaving: boolean;
  /** Save one menu item's presentation override (upsert by menu key). */
  saveOverride: (draft: OverrideDraft) => Promise<void>;
  /** Reset one menu item back to its registry defaults (neutralises the row). */
  resetOverride: (menuKey: string) => Promise<void>;
  /** Registry × overrides merged for the settings editor (per group). */
  adminGroup: (group: NavigationGroupKey) => AdminNavigationItem[];
}

/**
 * Loads the navigation/menu override layer (Supabase-authoritative, super_admin
 * RLS) and exposes the safe save/reset operations the Navigation settings
 * surface uses. Every successful write invalidates the overrides query so the
 * editor + any menu consuming the registry re-read the authoritative state.
 */
export function useNavigationConfig(): UseNavigationConfigResult {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: NAVIGATION_OVERRIDES_QUERY_KEY,
    queryFn: () => listNavigationMenuOverrides(),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: NAVIGATION_OVERRIDES_QUERY_KEY });
  };

  const saveMutation = useMutation({
    mutationFn: (draft: OverrideDraft) => upsertNavigationMenuOverride(draft),
    onSuccess: invalidate,
  });

  const resetMutation = useMutation({
    mutationFn: (menuKey: string) => resetNavigationMenuOverride(menuKey),
    onSuccess: invalidate,
  });

  const overrides = useMemo<NavigationMenuOverride[]>(() => query.data ?? [], [query.data]);

  return {
    overrides,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error as Error | null,
    refetch: () => {
      void query.refetch();
    },
    isSaving: saveMutation.isPending || resetMutation.isPending,
    saveOverride: (draft) => saveMutation.mutateAsync(draft),
    resetOverride: (menuKey) => resetMutation.mutateAsync(menuKey),
    adminGroup: (group) => mergeAdminNavigationGroup(group, overrides),
  };
}

/**
 * Read-only resolution of ONE menu group for actual UI rendering (e.g. the
 * Calculator tabs). Merges the registry with the override layer and filters by
 * the live permission check — visibility is presentation only and never bypasses
 * permissions. Resilient: a missing/erroring override layer falls back to the
 * registry defaults so the menu always renders.
 */
export function useNavigationMenu(group: NavigationGroupKey): ResolvedNavigationItem[] {
  const { hasPermission } = useApp();

  const query = useQuery({
    queryKey: NAVIGATION_OVERRIDES_QUERY_KEY,
    queryFn: () => listNavigationMenuOverrides(),
  });

  const overrides = query.data ?? [];

  return useMemo(
    () => resolveNavigationGroup(group, overrides, { hasPermission }),
    [group, overrides, hasPermission],
  );
}

/**
 * Resolves the main-navigation PRESENTATION overlay (label / icon / visibility)
 * keyed by route, for the live sidebar (Slice 11C). This is intentionally NOT
 * permission-filtered — the sidebar runs its own permission gate first, so the
 * overlay is pure presentation. Resilient: a missing/erroring override layer
 * resolves every managed route to its registry default (visible, default
 * label/icon), so the sidebar always renders unchanged until customised.
 */
export function useNavigationMainNav(): Map<string, MainNavPresentation> {
  const query = useQuery({
    queryKey: NAVIGATION_OVERRIDES_QUERY_KEY,
    queryFn: () => listNavigationMenuOverrides(),
  });

  const overrides = query.data ?? [];

  return useMemo(() => resolveMainNavPresentationByRoute(overrides), [overrides]);
}
