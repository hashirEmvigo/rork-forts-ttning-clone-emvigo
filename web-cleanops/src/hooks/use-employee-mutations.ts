import { useCallback, useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import type { Employee } from "@/types";
import {
  createEmployeeInSupabase,
  updateEmployeeInSupabase,
  type SupabaseEmployeeCreateInput,
  type SupabaseEmployeeUpdatePatch,
} from "@/lib/data/supabaseEmployeeRepository";
import { bumpEmployeeDirectoryRefresh } from "@/lib/data/employeeDirectoryRefresh";
import { EMPLOYEE_STAFF_NUMBERS_QUERY_KEY } from "@/hooks/use-staff-numbers";
import { DIRECTORY_PROFILES_QUERY_KEY } from "@/hooks/use-directory-profiles";

export const EMPLOYEE_DIRECTORY_QUERY_KEY = ["employee-directory"] as const;

export interface UseEmployeeMutationsResult {
  createEmployee: (input: SupabaseEmployeeCreateInput) => Promise<Employee>;
  updateEmployee: (input: {
    employeeId: string;
    patch: SupabaseEmployeeUpdatePatch;
  }) => Promise<Employee>;
  isPending: boolean;
  error: string | null;
}

/**
 * Supabase-authoritative employee create/update boundary for EMP-A1.
 * It never calls AppContext employee persistence, localStorage/sessionStorage,
 * or the legacy employee dual-write flag path.
 */
export function useEmployeeMutations(companyId: string | null | undefined): UseEmployeeMutationsResult {
  const queryClient = useQueryClient();
  const normalizedCompanyId = companyId?.trim() ?? "";

  const afterSuccess = useCallback(async (): Promise<void> => {
    bumpEmployeeDirectoryRefresh();
    // Refresh the employee directory AND the database-issued Staff ID lookups so a
    // freshly created/updated employee shows its allocated Staff ID immediately
    // (the Employees/Team page resolves Staff IDs from the staff-numbers query and
    // the shared profile roster — both are otherwise cached for 60s, which left a
    // new row showing "—" until a hard refresh). Staff IDs stay database-issued;
    // this only re-reads them.
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: EMPLOYEE_DIRECTORY_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: EMPLOYEE_STAFF_NUMBERS_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: DIRECTORY_PROFILES_QUERY_KEY }),
    ]);
  }, [queryClient]);

  const createMutation = useMutation({
    mutationFn: async (input: SupabaseEmployeeCreateInput) => {
      if (!normalizedCompanyId) throw new Error("Employee save requires a company context.");
      return createEmployeeInSupabase({ ...input, companyId: normalizedCompanyId });
    },
    onSuccess: afterSuccess,
  });

  const updateMutation = useMutation({
    mutationFn: async (input: { employeeId: string; patch: SupabaseEmployeeUpdatePatch }) => {
      if (!normalizedCompanyId) throw new Error("Employee save requires a company context.");
      return updateEmployeeInSupabase(normalizedCompanyId, input.employeeId, input.patch);
    },
    onSuccess: afterSuccess,
  });

  const createEmployee = useCallback(
    (input: SupabaseEmployeeCreateInput): Promise<Employee> => createMutation.mutateAsync(input),
    [createMutation],
  );

  const updateEmployee = useCallback(
    (input: { employeeId: string; patch: SupabaseEmployeeUpdatePatch }): Promise<Employee> =>
      updateMutation.mutateAsync(input),
    [updateMutation],
  );

  return useMemo<UseEmployeeMutationsResult>(() => {
    const error = createMutation.error ?? updateMutation.error ?? null;
    return {
      createEmployee,
      updateEmployee,
      isPending: createMutation.isPending || updateMutation.isPending,
      error: error instanceof Error ? error.message : null,
    };
  }, [
    createEmployee,
    updateEmployee,
    createMutation.error,
    createMutation.isPending,
    updateMutation.error,
    updateMutation.isPending,
  ]);
}
