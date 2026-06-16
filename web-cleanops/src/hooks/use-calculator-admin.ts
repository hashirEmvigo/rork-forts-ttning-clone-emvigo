import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  getCalculatorAdminOverview,
  setCalculatorEnabled,
  type CalculatorAdminOverview,
} from "@/lib/calculator/calculatorAdmin";

/** Shared React Query key for the Super Admin calculator overview. */
export const CALCULATOR_ADMIN_QUERY_KEY = ["calculator-admin-overview"] as const;

export interface UseCalculatorAdminResult {
  overview: CalculatorAdminOverview | null | undefined;
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
  refetch: () => void;
  /** Persists `calculator_settings.enabled` (the only write this slice allows). */
  setEnabled: (enabled: boolean) => Promise<boolean>;
  isUpdating: boolean;
}

/**
 * Loads the locked Super Admin calculator overview (Supabase-authoritative,
 * gated by super_admin RLS) and exposes the single allowed write — toggling
 * `calculator_settings.enabled`. A successful toggle invalidates the overview so
 * the page re-reads the authoritative state rather than trusting local UI.
 */
export function useCalculatorAdmin(): UseCalculatorAdminResult {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: CALCULATOR_ADMIN_QUERY_KEY,
    queryFn: () => getCalculatorAdminOverview(),
  });

  const mutation = useMutation({
    mutationFn: async ({ settingsLegacyId, enabled }: { settingsLegacyId: string; enabled: boolean }) =>
      setCalculatorEnabled(settingsLegacyId, enabled),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CALCULATOR_ADMIN_QUERY_KEY });
    },
  });

  const setEnabled = async (enabled: boolean): Promise<boolean> => {
    const settingsLegacyId = query.data?.settings.legacyId;
    if (!settingsLegacyId) {
      throw new Error("Calculator settings are not loaded yet.");
    }
    return mutation.mutateAsync({ settingsLegacyId, enabled });
  };

  return {
    overview: query.data,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error as Error | null,
    refetch: () => {
      void query.refetch();
    },
    setEnabled,
    isUpdating: mutation.isPending,
  };
}
