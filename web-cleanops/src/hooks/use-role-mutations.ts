import { useCallback, useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import type { Role } from "@/types";
import {
  createCompanyRoleInSupabase,
  updateRoleInSupabase,
  type SupabaseCompanyRoleCreateInput,
  type SupabaseRoleUpdatePatch,
} from "@/lib/data/supabaseRoleRepository";
import { bumpRoleDirectoryRefresh } from "@/lib/data/roleDirectoryRefresh";

export const ROLE_DIRECTORY_QUERY_KEY = ["role-directory"] as const;

export interface RoleMutationScope {
  /** null = global role-template context; string = company role context; undefined = missing context. */
  companyId: string | null | undefined;
  isSuperAdmin: boolean;
  canManageRoles: boolean;
}

export interface UseRoleMutationsResult {
  createCompanyRole: (
    input: Omit<SupabaseCompanyRoleCreateInput, "companyId">,
  ) => Promise<Role>;
  updateRole: (input: { role: Role; patch: SupabaseRoleUpdatePatch }) => Promise<Role>;
  isPending: boolean;
  error: string | null;
}

/**
 * Supabase-authoritative role template create/update boundary for CORE-WRITES-A2.1.
 * It never calls AppContext persistence, localStorage/sessionStorage, or legacy
 * mirror/dual-write paths. Assignment/delete/global custom create remain deferred.
 */
export function useRoleMutations(scope: RoleMutationScope): UseRoleMutationsResult {
  const queryClient = useQueryClient();
  const normalizedCompanyId = scope.companyId === null ? null : scope.companyId?.trim() ?? "";

  const requireManageRoles = useCallback((): void => {
    if (!scope.canManageRoles) throw new Error("You don't have permission to manage roles.");
  }, [scope.canManageRoles]);

  const requireCompanyScope = useCallback((): string => {
    requireManageRoles();
    if (scope.isSuperAdmin) {
      throw new Error("Global custom role creation is not enabled yet.");
    }
    if (!normalizedCompanyId) throw new Error("Role save requires a company context.");
    return normalizedCompanyId;
  }, [normalizedCompanyId, requireManageRoles, scope.isSuperAdmin]);

  const scopeForUpdate = useCallback(
    (role: Role): string | null => {
      requireManageRoles();
      if (scope.isSuperAdmin) {
        if (role.companyId !== null) {
          throw new Error("Super Admin role editing in this slice is limited to global templates.");
        }
        return null;
      }
      if (!normalizedCompanyId) throw new Error("Role save requires a company context.");
      if (role.companyId !== normalizedCompanyId) {
        throw new Error("You can only edit roles in your company.");
      }
      if (role.isSystem) {
        throw new Error("Built-in company roles are not editable in this flow.");
      }
      return normalizedCompanyId;
    },
    [normalizedCompanyId, requireManageRoles, scope.isSuperAdmin],
  );

  const afterSuccess = useCallback(async (): Promise<void> => {
    bumpRoleDirectoryRefresh();
    await queryClient.invalidateQueries({ queryKey: ROLE_DIRECTORY_QUERY_KEY });
  }, [queryClient]);

  const createCompanyRoleMutation = useMutation({
    mutationFn: async (input: Omit<SupabaseCompanyRoleCreateInput, "companyId">) => {
      const companyId = requireCompanyScope();
      return createCompanyRoleInSupabase({ ...input, companyId });
    },
    onSuccess: afterSuccess,
  });

  const updateRoleMutation = useMutation({
    mutationFn: async (input: { role: Role; patch: SupabaseRoleUpdatePatch }) => {
      const companyId = scopeForUpdate(input.role);
      return updateRoleInSupabase(companyId, input.role.id, input.patch);
    },
    onSuccess: afterSuccess,
  });

  const createCompanyRole = useCallback(
    (input: Omit<SupabaseCompanyRoleCreateInput, "companyId">) =>
      createCompanyRoleMutation.mutateAsync(input),
    [createCompanyRoleMutation],
  );

  const updateRole = useCallback(
    (input: { role: Role; patch: SupabaseRoleUpdatePatch }) =>
      updateRoleMutation.mutateAsync(input),
    [updateRoleMutation],
  );

  return useMemo<UseRoleMutationsResult>(() => {
    const error = createCompanyRoleMutation.error ?? updateRoleMutation.error ?? null;
    return {
      createCompanyRole,
      updateRole,
      isPending: createCompanyRoleMutation.isPending || updateRoleMutation.isPending,
      error: error instanceof Error ? error.message : null,
    };
  }, [
    createCompanyRole,
    updateRole,
    createCompanyRoleMutation.error,
    createCompanyRoleMutation.isPending,
    updateRoleMutation.error,
    updateRoleMutation.isPending,
  ]);
}
