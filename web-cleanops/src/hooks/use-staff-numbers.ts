import { useQuery } from "@tanstack/react-query";

import { isSupabaseConfigured } from "@/lib/supabase";
import {
  listEmployeeStaffNumbers,
  type EmployeeStaffNumber,
} from "@/lib/data/supabaseEmployeeRepository";

/** React Query key for a company's employee Staff IDs (NUM-1 Phase 3). */
export const EMPLOYEE_STAFF_NUMBERS_QUERY_KEY = ["employee-staff-numbers"] as const;

/**
 * Resolved Staff ID lookups for the Employees/Team page.
 *
 * `byEmail` is the universal key (every roster row — employee record, profile
 * login, or synthetic admin row — carries an email), `byLegacyId` resolves a
 * localStorage employee row directly by its stable id.
 */
export interface StaffNumberLookups {
  byEmail: Map<string, number>;
  byLegacyId: Map<string, number>;
  isLoading: boolean;
}

/**
 * Loads the database-issued Staff IDs for a company's employee records and
 * exposes them as lookup maps. The database is the single authority for these
 * numbers (NUM-1); this hook never calculates them. Returns empty maps when
 * Supabase is not configured (the page then falls back to "—").
 *
 * @param companyId app-facing company id, or null/undefined for all RLS-visible
 *   rows (super admin).
 */
export function useStaffNumbers(companyId: string | null | undefined): StaffNumberLookups {
  const scope = companyId ?? null;
  const { data = [], isLoading } = useQuery<EmployeeStaffNumber[]>({
    queryKey: [...EMPLOYEE_STAFF_NUMBERS_QUERY_KEY, scope],
    queryFn: () => listEmployeeStaffNumbers(scope),
    enabled: isSupabaseConfigured,
    staleTime: 60_000,
  });

  const byEmail = new Map<string, number>();
  const byLegacyId = new Map<string, number>();
  for (const row of data) {
    byLegacyId.set(row.legacyId, row.staffNumber);
    if (row.email) byEmail.set(row.email, row.staffNumber);
  }

  return { byEmail, byLegacyId, isLoading };
}
