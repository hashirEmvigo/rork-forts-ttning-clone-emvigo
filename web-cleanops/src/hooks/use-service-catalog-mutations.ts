import { useCallback, useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import type { Service, ServiceCategory, ServicePackage } from "@/types";
import {
  createServiceInSupabase,
  updateServiceInSupabase,
  type SupabaseServiceCreateInput,
  type SupabaseServiceUpdatePatch,
} from "@/lib/data/supabaseServiceRepository";
import {
  createServiceCategoryInSupabase,
  updateServiceCategoryInSupabase,
  type SupabaseServiceCategoryCreateInput,
  type SupabaseServiceCategoryUpdatePatch,
} from "@/lib/data/supabaseServiceCategoryRepository";
import { bumpServiceCatalogDirectoryRefresh } from "@/lib/data/serviceCatalogDirectoryRefresh";
import { normalizeCategoryKey, planServicePackageApply } from "@/lib/servicePackageApplyPlan";
import {
  describePackageArticleNumberConflicts,
  detectPackageArticleNumberConflicts,
} from "@/lib/servicePackageArticleNumberConflicts";

export const SERVICE_CATALOG_DIRECTORY_QUERY_KEY = ["service-catalog-directory"] as const;

export interface ServiceCatalogMutationScope {
  /** null = Super Admin global catalog; string = company catalog; undefined = missing context. */
  companyId: string | null | undefined;
  isSuperAdmin: boolean;
  canManageServices: boolean;
  currentUserId?: string | null;
}

/** Input for copying a GLOBAL service package into the active company catalog. */
export interface ApplyServicePackageInput {
  /** The global template package being copied. */
  pkg: ServicePackage;
  /** The company's EXISTING categories, used to dedupe by name (no duplicates). */
  existingCompanyCategories: ServiceCategory[];
  /**
   * The company's EXISTING services, used to BLOCK the copy if it would create a
   * duplicate article number inside the company (article numbers are unique per
   * company). Snapshots are never silently rewritten or regenerated.
   */
  existingCompanyServices: Service[];
}

/** Outcome of a Copy-into-company apply. */
export interface ApplyServicePackageResult {
  /** Number of company services created. */
  added: number;
  /** Number of new company categories created (existing ones are reused). */
  categoriesCreated: number;
}

export interface UseServiceCatalogMutationsResult {
  createServiceCategory: (input: Omit<SupabaseServiceCategoryCreateInput, "companyId" | "createdBy">) => Promise<ServiceCategory>;
  updateServiceCategory: (input: {
    categoryId: string;
    patch: SupabaseServiceCategoryUpdatePatch;
  }) => Promise<ServiceCategory>;
  createService: (input: Omit<SupabaseServiceCreateInput, "companyId" | "createdBy">) => Promise<Service>;
  updateService: (input: {
    serviceId: string;
    patch: SupabaseServiceUpdatePatch;
  }) => Promise<Service>;
  /**
   * Supabase-authoritative "Copy package into company" deep copy: creates
   * company-owned categories/services from the package snapshot. Company copies
   * are independent of the global template and survive a hard refresh.
   */
  applyPackage: (input: ApplyServicePackageInput) => Promise<ApplyServicePackageResult>;
  isPending: boolean;
  error: string | null;
}

/**
 * Supabase-authoritative service catalog create/update boundary for CORE-WRITES-A1.
 * It never calls AppContext persistence, localStorage/sessionStorage, or legacy
 * mirror/dual-write paths. Archive/reorder/package writes remain outside scope.
 */
export function useServiceCatalogMutations(
  scope: ServiceCatalogMutationScope,
): UseServiceCatalogMutationsResult {
  const queryClient = useQueryClient();
  const normalizedCompanyId = scope.companyId === null ? null : scope.companyId?.trim() ?? "";

  const requireWritableScope = useCallback((): string | null => {
    if (!scope.canManageServices) throw new Error("You don't have permission to manage services.");
    if (scope.isSuperAdmin) return null;
    if (!normalizedCompanyId) throw new Error("Service catalog save requires a company context.");
    return normalizedCompanyId;
  }, [normalizedCompanyId, scope.canManageServices, scope.isSuperAdmin]);

  const afterSuccess = useCallback(async (): Promise<void> => {
    bumpServiceCatalogDirectoryRefresh();
    await queryClient.invalidateQueries({ queryKey: SERVICE_CATALOG_DIRECTORY_QUERY_KEY });
  }, [queryClient]);

  const createCategoryMutation = useMutation({
    mutationFn: async (input: Omit<SupabaseServiceCategoryCreateInput, "companyId" | "createdBy">) => {
      const companyId = requireWritableScope();
      return createServiceCategoryInSupabase({
        ...input,
        companyId,
        createdBy: scope.currentUserId ?? null,
      });
    },
    onSuccess: afterSuccess,
  });

  const updateCategoryMutation = useMutation({
    mutationFn: async (input: { categoryId: string; patch: SupabaseServiceCategoryUpdatePatch }) => {
      const companyId = requireWritableScope();
      return updateServiceCategoryInSupabase(companyId, input.categoryId, input.patch);
    },
    onSuccess: afterSuccess,
  });

  const createServiceMutation = useMutation({
    mutationFn: async (input: Omit<SupabaseServiceCreateInput, "companyId" | "createdBy">) => {
      const companyId = requireWritableScope();
      return createServiceInSupabase({
        ...input,
        companyId,
        createdBy: scope.currentUserId ?? null,
      });
    },
    onSuccess: afterSuccess,
  });

  const updateServiceMutation = useMutation({
    mutationFn: async (input: { serviceId: string; patch: SupabaseServiceUpdatePatch }) => {
      const companyId = requireWritableScope();
      return updateServiceInSupabase(companyId, input.serviceId, input.patch);
    },
    onSuccess: afterSuccess,
  });

  const applyPackageMutation = useMutation({
    mutationFn: async (input: ApplyServicePackageInput): Promise<ApplyServicePackageResult> => {
      const companyId = requireWritableScope();
      const createdBy = scope.currentUserId ?? null;

      // Article numbers are unique per company. Block the WHOLE copy up-front if
      // it would introduce a duplicate inside the target company — never rewrite
      // or regenerate a snapshot silently, and never partially apply.
      const conflictMessage = describePackageArticleNumberConflicts(
        detectPackageArticleNumberConflicts(input.pkg, input.existingCompanyServices),
      );
      if (conflictMessage) throw new Error(conflictMessage);

      const plan = planServicePackageApply(input.pkg, input.existingCompanyCategories);

      // Resolve target category id by name: existing company categories first,
      // then each newly created company category (deep copy, never a global link).
      const categoryIdByName = new Map<string, string>(
        Object.entries(plan.existingCategoryIdByName),
      );
      for (const category of plan.categoriesToCreate) {
        const created = await createServiceCategoryInSupabase({
          companyId,
          name: category.name,
          sortOrder: category.sortOrder,
          createdBy,
        });
        categoryIdByName.set(normalizeCategoryKey(category.name), created.id);
      }

      let added = 0;
      for (const planned of plan.services) {
        const categoryId = categoryIdByName.get(normalizeCategoryKey(planned.categoryName)) ?? null;
        await createServiceInSupabase({
          ...planned.fields,
          categoryId,
          companyId,
          createdBy,
        });
        added += 1;
      }

      return { added, categoriesCreated: plan.categoriesToCreate.length };
    },
    // Reconcile on BOTH success and failure: a multi-row copy may land partially,
    // so always refresh the directory from Supabase to show the true state.
    onSettled: afterSuccess,
  });

  const createServiceCategory = useCallback(
    (input: Omit<SupabaseServiceCategoryCreateInput, "companyId" | "createdBy">) =>
      createCategoryMutation.mutateAsync(input),
    [createCategoryMutation],
  );

  const updateServiceCategory = useCallback(
    (input: { categoryId: string; patch: SupabaseServiceCategoryUpdatePatch }) =>
      updateCategoryMutation.mutateAsync(input),
    [updateCategoryMutation],
  );

  const createService = useCallback(
    (input: Omit<SupabaseServiceCreateInput, "companyId" | "createdBy">) =>
      createServiceMutation.mutateAsync(input),
    [createServiceMutation],
  );

  const updateService = useCallback(
    (input: { serviceId: string; patch: SupabaseServiceUpdatePatch }) =>
      updateServiceMutation.mutateAsync(input),
    [updateServiceMutation],
  );

  const applyPackage = useCallback(
    (input: ApplyServicePackageInput) => applyPackageMutation.mutateAsync(input),
    [applyPackageMutation],
  );

  return useMemo<UseServiceCatalogMutationsResult>(() => {
    const error =
      createCategoryMutation.error ??
      updateCategoryMutation.error ??
      createServiceMutation.error ??
      updateServiceMutation.error ??
      applyPackageMutation.error ??
      null;
    return {
      createServiceCategory,
      updateServiceCategory,
      createService,
      updateService,
      applyPackage,
      isPending:
        createCategoryMutation.isPending ||
        updateCategoryMutation.isPending ||
        createServiceMutation.isPending ||
        updateServiceMutation.isPending ||
        applyPackageMutation.isPending,
      error: error instanceof Error ? error.message : null,
    };
  }, [
    createServiceCategory,
    updateServiceCategory,
    createService,
    updateService,
    applyPackage,
    createCategoryMutation.error,
    createCategoryMutation.isPending,
    updateCategoryMutation.error,
    updateCategoryMutation.isPending,
    createServiceMutation.error,
    createServiceMutation.isPending,
    updateServiceMutation.error,
    updateServiceMutation.isPending,
    applyPackageMutation.error,
    applyPackageMutation.isPending,
  ]);
}
