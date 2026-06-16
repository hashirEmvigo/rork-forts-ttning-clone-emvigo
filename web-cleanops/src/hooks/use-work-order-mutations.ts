import { useCallback, useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import type { WorkOrder } from "@/types";
import {
  addWorkOrderServiceRowInSupabase,
  archiveWorkOrderServiceRowInSupabase,
  createWorkOrderInSupabase,
  removeWorkOrderServiceRowInSupabase,
  rescheduleOneTimeServiceRowInSupabase,
  restoreWorkOrderServiceRowInSupabase,
  updateWorkOrderServiceRowInSupabase,
  type SupabaseOneTimeServiceRowDateTimeInput,
  type SupabaseWorkOrderCreateInput,
  type SupabaseWorkOrderServiceRowAddResult,
  type SupabaseWorkOrderServiceRowArchiveInput,
  type SupabaseWorkOrderServiceRowCreateInput,
  type SupabaseWorkOrderServiceRowRemoveInput,
  type SupabaseWorkOrderServiceRowRemoveResult,
  type SupabaseWorkOrderServiceRowUpdateInput,
  type SupabaseWorkOrderServiceRowUpdateResult,
} from "@/lib/data/supabaseWorkOrderRepository";
import { bumpWorkOrderDirectoryRefresh } from "@/lib/data/workOrderDirectoryRefresh";

export const WORK_ORDER_DIRECTORY_QUERY_KEY = ["work-order-directory"] as const;

export interface WorkOrderMutationScope {
  /** Company-scoped legacy company id. Empty/undefined fails closed. */
  companyId: string | null | undefined;
  canCreateWorkOrders: boolean;
}

export interface UseWorkOrderMutationsResult {
  createWorkOrder: (
    input: Omit<SupabaseWorkOrderCreateInput, "companyId"> & { companyId?: string | null },
  ) => Promise<WorkOrder>;
  addServiceRow: (
    input: Omit<SupabaseWorkOrderServiceRowCreateInput, "companyId"> & { companyId?: string | null },
  ) => Promise<SupabaseWorkOrderServiceRowAddResult>;
  /**
   * Updates one existing service row through the transactional
   * `update_work_order_service_row` RPC (CORE-WRITES-WORKORDERS-A1.2.3 Edit).
   * Only allowlisted, non-staffing, non-protocol, non-booking fields are sent.
   */
  updateServiceRow: (
    input: Omit<SupabaseWorkOrderServiceRowUpdateInput, "companyId"> & { companyId?: string | null },
  ) => Promise<SupabaseWorkOrderServiceRowUpdateResult>;
  /**
   * Changes serviceDate/plannedStartTime/plannedEndTime for one-time rows only.
   * Recurring rows, booking queue and occurrence exceptions stay gated.
   */
  changeOneTimeServiceRowDateTime: (
    input: Omit<SupabaseOneTimeServiceRowDateTimeInput, "companyId"> & { companyId?: string | null },
  ) => Promise<SupabaseWorkOrderServiceRowUpdateResult>;
  /** Archives one service row through the Supabase update RPC. */
  archiveServiceRow: (
    input: Omit<SupabaseWorkOrderServiceRowArchiveInput, "companyId"> & { companyId?: string | null },
  ) => Promise<SupabaseWorkOrderServiceRowUpdateResult>;
  /** Restores one service row through the Supabase update RPC. */
  restoreServiceRow: (
    input: Omit<SupabaseWorkOrderServiceRowArchiveInput, "companyId"> & { companyId?: string | null },
  ) => Promise<SupabaseWorkOrderServiceRowUpdateResult>;
  /** Removes one unprotected service row through the Supabase remove RPC. */
  removeServiceRow: (
    input: Omit<SupabaseWorkOrderServiceRowRemoveInput, "companyId"> & { companyId?: string | null },
  ) => Promise<SupabaseWorkOrderServiceRowRemoveResult>;
  isPending: boolean;
  error: string | null;
}

/**
 * Supabase-authoritative work-order mutation boundary.
 * CORE-WRITES-WORKORDERS-A1.1 supports parent work-order creation.
 * CORE-WRITES-WORKORDERS-A1.2.1 adds exactly one service row via the transactional
 * Supabase RPC. A1.2.3 adds Edit (one allowlisted service-row field patch)
 * through the transactional `update_work_order_service_row` RPC. A1.2.4a adds a
 * narrow one-time-only date/time change path over the same RPC. AO-2B adds
 * archive/restore over that same RPC. Service-row removal is Supabase-authoritative
 * and only allowed after protected-history guards clear. Other service-row actions
 * stay gated until converted and validated in their own slice. No localStorage
 * persistence or dual-write mirror paths are invoked here.
 */
export function useWorkOrderMutations(
  scope: WorkOrderMutationScope,
): UseWorkOrderMutationsResult {
  const queryClient = useQueryClient();
  const normalizedScopeCompanyId = scope.companyId?.trim() ?? "";

  const requireCompanyScope = useCallback(
    (overrideCompanyId?: string | null): string => {
      const candidate = overrideCompanyId?.trim() || normalizedScopeCompanyId;
      if (!candidate) {
        throw new Error("Work order mutation requires a selected company context.");
      }
      return candidate;
    },
    [normalizedScopeCompanyId],
  );

  const afterSuccess = useCallback(async (): Promise<void> => {
    bumpWorkOrderDirectoryRefresh();
    await queryClient.invalidateQueries({ queryKey: WORK_ORDER_DIRECTORY_QUERY_KEY });
  }, [queryClient]);

  const createMutation = useMutation({
    mutationFn: async (
      input: Omit<SupabaseWorkOrderCreateInput, "companyId"> & { companyId?: string | null },
    ) => {
      if (!scope.canCreateWorkOrders) {
        throw new Error("You don't have permission to create work orders.");
      }
      const companyId = requireCompanyScope(input.companyId);
      return createWorkOrderInSupabase({ ...input, companyId });
    },
    onSuccess: afterSuccess,
  });

  const addServiceRowMutation = useMutation({
    mutationFn: async (
      input: Omit<SupabaseWorkOrderServiceRowCreateInput, "companyId"> & { companyId?: string | null },
    ) => {
      if (!scope.canCreateWorkOrders) {
        throw new Error("You don't have permission to manage work-order services.");
      }
      const companyId = requireCompanyScope(input.companyId);
      return addWorkOrderServiceRowInSupabase({ ...input, companyId });
    },
    onSuccess: afterSuccess,
  });


  const createWorkOrder = useCallback(
    (input: Omit<SupabaseWorkOrderCreateInput, "companyId"> & { companyId?: string | null }) =>
      createMutation.mutateAsync(input),
    [createMutation],
  );

  const updateServiceRowMutation = useMutation({
    mutationFn: async (
      input: Omit<SupabaseWorkOrderServiceRowUpdateInput, "companyId"> & { companyId?: string | null },
    ) => {
      if (!scope.canCreateWorkOrders) {
        throw new Error("You don't have permission to manage work-order services.");
      }
      const companyId = requireCompanyScope(input.companyId);
      return updateWorkOrderServiceRowInSupabase({ ...input, companyId });
    },
    onSuccess: afterSuccess,
  });

  const changeDateTimeMutation = useMutation({
    mutationFn: async (
      input: Omit<SupabaseOneTimeServiceRowDateTimeInput, "companyId"> & { companyId?: string | null },
    ) => {
      if (!scope.canCreateWorkOrders) {
        throw new Error("You don't have permission to manage work-order services.");
      }
      const companyId = requireCompanyScope(input.companyId);
      return rescheduleOneTimeServiceRowInSupabase({ ...input, companyId });
    },
    onSuccess: afterSuccess,
  });

  const archiveServiceRowMutation = useMutation({
    mutationFn: async (
      input: Omit<SupabaseWorkOrderServiceRowArchiveInput, "companyId"> & { companyId?: string | null },
    ) => {
      if (!scope.canCreateWorkOrders) {
        throw new Error("You don't have permission to manage work-order services.");
      }
      const companyId = requireCompanyScope(input.companyId);
      return archiveWorkOrderServiceRowInSupabase({ ...input, companyId });
    },
    onSuccess: afterSuccess,
  });

  const restoreServiceRowMutation = useMutation({
    mutationFn: async (
      input: Omit<SupabaseWorkOrderServiceRowArchiveInput, "companyId"> & { companyId?: string | null },
    ) => {
      if (!scope.canCreateWorkOrders) {
        throw new Error("You don't have permission to manage work-order services.");
      }
      const companyId = requireCompanyScope(input.companyId);
      return restoreWorkOrderServiceRowInSupabase({ ...input, companyId });
    },
    onSuccess: afterSuccess,
  });

  const removeServiceRowMutation = useMutation({
    mutationFn: async (
      input: Omit<SupabaseWorkOrderServiceRowRemoveInput, "companyId"> & { companyId?: string | null },
    ) => {
      if (!scope.canCreateWorkOrders) {
        throw new Error("You don't have permission to manage work-order services.");
      }
      const companyId = requireCompanyScope(input.companyId);
      return removeWorkOrderServiceRowInSupabase({ ...input, companyId });
    },
    onSuccess: afterSuccess,
  });

  const addServiceRow = useCallback(
    (
      input: Omit<SupabaseWorkOrderServiceRowCreateInput, "companyId"> & {
        companyId?: string | null;
      },
    ) => addServiceRowMutation.mutateAsync(input),
    [addServiceRowMutation],
  );

  const updateServiceRow = useCallback(
    (
      input: Omit<SupabaseWorkOrderServiceRowUpdateInput, "companyId"> & {
        companyId?: string | null;
      },
    ) => updateServiceRowMutation.mutateAsync(input),
    [updateServiceRowMutation],
  );

  const changeOneTimeServiceRowDateTime = useCallback(
    (
      input: Omit<SupabaseOneTimeServiceRowDateTimeInput, "companyId"> & {
        companyId?: string | null;
      },
    ) => changeDateTimeMutation.mutateAsync(input),
    [changeDateTimeMutation],
  );

  const archiveServiceRow = useCallback(
    (
      input: Omit<SupabaseWorkOrderServiceRowArchiveInput, "companyId"> & {
        companyId?: string | null;
      },
    ) => archiveServiceRowMutation.mutateAsync(input),
    [archiveServiceRowMutation],
  );

  const restoreServiceRow = useCallback(
    (
      input: Omit<SupabaseWorkOrderServiceRowArchiveInput, "companyId"> & {
        companyId?: string | null;
      },
    ) => restoreServiceRowMutation.mutateAsync(input),
    [restoreServiceRowMutation],
  );

  const removeServiceRow = useCallback(
    (
      input: Omit<SupabaseWorkOrderServiceRowRemoveInput, "companyId"> & {
        companyId?: string | null;
      },
    ) => removeServiceRowMutation.mutateAsync(input),
    [removeServiceRowMutation],
  );

  return useMemo<UseWorkOrderMutationsResult>(() => {
    const error =
      createMutation.error ??
      addServiceRowMutation.error ??
      updateServiceRowMutation.error ??
      changeDateTimeMutation.error ??
      archiveServiceRowMutation.error ??
      restoreServiceRowMutation.error ??
      removeServiceRowMutation.error;
    return {
      createWorkOrder,
      addServiceRow,
      updateServiceRow,
      changeOneTimeServiceRowDateTime,
      archiveServiceRow,
      restoreServiceRow,
      removeServiceRow,
      isPending:
        createMutation.isPending ||
        addServiceRowMutation.isPending ||
        updateServiceRowMutation.isPending ||
        changeDateTimeMutation.isPending ||
        archiveServiceRowMutation.isPending ||
        restoreServiceRowMutation.isPending ||
        removeServiceRowMutation.isPending,
      error: error instanceof Error ? error.message : null,
    };
  }, [
    createWorkOrder,
    addServiceRow,
    updateServiceRow,
    changeOneTimeServiceRowDateTime,
    archiveServiceRow,
    restoreServiceRow,
    removeServiceRow,
    createMutation.error,
    createMutation.isPending,
    addServiceRowMutation.error,
    addServiceRowMutation.isPending,
    updateServiceRowMutation.error,
    updateServiceRowMutation.isPending,
    changeDateTimeMutation.error,
    changeDateTimeMutation.isPending,
    archiveServiceRowMutation.error,
    archiveServiceRowMutation.isPending,
    restoreServiceRowMutation.error,
    restoreServiceRowMutation.isPending,
    removeServiceRowMutation.error,
    removeServiceRowMutation.isPending,
  ]);
}
