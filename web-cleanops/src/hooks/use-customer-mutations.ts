import { useCallback, useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import type { Customer } from "@/types";
import {
  archiveCustomerInSupabase,
  createCustomerInSupabase,
  restoreCustomerInSupabase,
  updateCustomerInSupabase,
  type SupabaseCustomerCreateInput,
  type SupabaseCustomerUpdatePatch,
} from "@/lib/data/supabaseCustomerRepository";
import { bumpCustomerDirectoryRefresh } from "@/lib/data/customerDirectoryRefresh";

export const CUSTOMER_DIRECTORY_QUERY_KEY = ["customer-directory"] as const;

export interface CustomerMutationScope {
  /** Company-scoped legacy company id. Empty/undefined fails closed. */
  companyId: string | null | undefined;
  canCreateCustomers: boolean;
  canEditCustomers: boolean;
}

export interface UseCustomerMutationsResult {
  createCustomer: (input: Omit<SupabaseCustomerCreateInput, "companyId">) => Promise<Customer>;
  updateCustomer: (input: {
    customerId: string;
    companyId?: string | null;
    patch: SupabaseCustomerUpdatePatch;
  }) => Promise<Customer>;
  archiveCustomer: (input: { customerId: string; companyId?: string | null }) => Promise<Customer>;
  restoreCustomer: (input: { customerId: string; companyId?: string | null }) => Promise<Customer>;
  isPending: boolean;
  error: string | null;
}

/**
 * Supabase-authoritative customer create/update boundary for customer master-data writes.
 * It never calls AppContext persistence, localStorage/sessionStorage, or legacy
 * mirror/dual-write paths. It is shared by CustomerDialog, Customer Card profile
 * saves, inline row edits, simple suggested-area apply, archive/restore lifecycle,
 * and Customer Card notes/scheduling saves.
 * Physical delete and login provisioning/link persistence remain outside this slice.
 */
export function useCustomerMutations(scope: CustomerMutationScope): UseCustomerMutationsResult {
  const queryClient = useQueryClient();
  const normalizedScopeCompanyId = scope.companyId?.trim() ?? "";

  const requireCompanyScope = useCallback(
    (overrideCompanyId?: string | null): string => {
      const candidate = overrideCompanyId?.trim() || normalizedScopeCompanyId;
      if (!candidate) {
        throw new Error("Customer save requires a selected company context.");
      }
      return candidate;
    },
    [normalizedScopeCompanyId],
  );

  const afterSuccess = useCallback(async (): Promise<void> => {
    bumpCustomerDirectoryRefresh();
    await queryClient.invalidateQueries({ queryKey: CUSTOMER_DIRECTORY_QUERY_KEY });
  }, [queryClient]);

  const createCustomerMutation = useMutation({
    mutationFn: async (input: Omit<SupabaseCustomerCreateInput, "companyId">) => {
      if (!scope.canCreateCustomers) {
        throw new Error("You don't have permission to create customers.");
      }
      const companyId = requireCompanyScope();
      return createCustomerInSupabase({ ...input, companyId });
    },
    onSuccess: afterSuccess,
  });

  const updateCustomerMutation = useMutation({
    mutationFn: async (input: {
      customerId: string;
      companyId?: string | null;
      patch: SupabaseCustomerUpdatePatch;
    }) => {
      if (!scope.canEditCustomers) {
        throw new Error("You don't have permission to edit customers.");
      }
      const companyId = requireCompanyScope(input.companyId);
      return updateCustomerInSupabase(companyId, input.customerId, input.patch);
    },
    onSuccess: afterSuccess,
  });

  const archiveCustomerMutation = useMutation({
    mutationFn: async (input: { customerId: string; companyId?: string | null }) => {
      if (!scope.canEditCustomers) {
        throw new Error("You don't have permission to archive customers.");
      }
      const companyId = requireCompanyScope(input.companyId);
      return archiveCustomerInSupabase(companyId, input.customerId);
    },
    onSuccess: afterSuccess,
  });

  const restoreCustomerMutation = useMutation({
    mutationFn: async (input: { customerId: string; companyId?: string | null }) => {
      if (!scope.canEditCustomers) {
        throw new Error("You don't have permission to restore customers.");
      }
      const companyId = requireCompanyScope(input.companyId);
      return restoreCustomerInSupabase(companyId, input.customerId);
    },
    onSuccess: afterSuccess,
  });

  const createCustomer = useCallback(
    (input: Omit<SupabaseCustomerCreateInput, "companyId">) =>
      createCustomerMutation.mutateAsync(input),
    [createCustomerMutation],
  );

  const updateCustomer = useCallback(
    (input: { customerId: string; companyId?: string | null; patch: SupabaseCustomerUpdatePatch }) =>
      updateCustomerMutation.mutateAsync(input),
    [updateCustomerMutation],
  );

  const archiveCustomer = useCallback(
    (input: { customerId: string; companyId?: string | null }) =>
      archiveCustomerMutation.mutateAsync(input),
    [archiveCustomerMutation],
  );

  const restoreCustomer = useCallback(
    (input: { customerId: string; companyId?: string | null }) =>
      restoreCustomerMutation.mutateAsync(input),
    [restoreCustomerMutation],
  );

  return useMemo<UseCustomerMutationsResult>(() => {
    const error =
      createCustomerMutation.error ??
      updateCustomerMutation.error ??
      archiveCustomerMutation.error ??
      restoreCustomerMutation.error ??
      null;
    return {
      createCustomer,
      updateCustomer,
      archiveCustomer,
      restoreCustomer,
      isPending:
        createCustomerMutation.isPending ||
        updateCustomerMutation.isPending ||
        archiveCustomerMutation.isPending ||
        restoreCustomerMutation.isPending,
      error: error instanceof Error ? error.message : null,
    };
  }, [
    createCustomer,
    updateCustomer,
    archiveCustomer,
    restoreCustomer,
    createCustomerMutation.error,
    createCustomerMutation.isPending,
    updateCustomerMutation.error,
    updateCustomerMutation.isPending,
    archiveCustomerMutation.error,
    archiveCustomerMutation.isPending,
    restoreCustomerMutation.error,
    restoreCustomerMutation.isPending,
  ]);
}
