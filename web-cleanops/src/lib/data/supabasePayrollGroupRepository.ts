/**
 * Supabase-backed Payroll Group read repository (SVCCAT-1).
 *
 * The payroll-groups analogue of {@link import("./supabaseServiceRepository")}.
 * Reads the `payroll_groups` table (migration 0019) and returns the SAME
 * {@link PayrollGroup} shapes the localStorage store returns. A company scope
 * returns that company's groups PLUS every global group (`company_legacy_id is
 * null`); unscoped returns all RLS-visible rows. Soft-deleted rows are filtered.
 */
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import type { PayrollGroup } from "@/types";

const SUMMARY_COLUMNS = "legacy_id, company_legacy_id, name, status, deleted_at";

/** Lightweight group row for count / id-set parity checks. */
export interface PayrollGroupSummary {
  id: string;
  companyId: string | null;
  name: string;
}

interface PayrollGroupSummaryRow {
  legacy_id: string;
  company_legacy_id: string | null;
  name: string;
  status: string;
  deleted_at: string | null;
}

interface PayrollGroupFullRow {
  data: PayrollGroup;
  company_legacy_id: string | null;
  deleted_at: string | null;
}

class SupabaseNotConfiguredError extends Error {
  constructor() {
    super(
      "SupabasePayrollGroupRepository requires Supabase. Set " +
        "EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.",
    );
    this.name = "SupabaseNotConfiguredError";
  }
}

function rowToSummary(row: PayrollGroupSummaryRow): PayrollGroupSummary {
  return { id: row.legacy_id, companyId: row.company_legacy_id, name: row.name };
}

function applyScope<T extends { or: (f: string) => T }>(
  query: T,
  companyId: string | null | undefined,
): T {
  if (companyId === undefined || companyId === null) return query;
  return query.or(`company_legacy_id.eq.${companyId},company_legacy_id.is.null`);
}

/** Company-scoped (+ global) summary rows. Soft-deleted rows filtered out. */
export async function listPayrollGroupSummariesFromSupabase(
  companyId?: string | null,
): Promise<PayrollGroupSummary[]> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const stop = perf.start("payrollGroups.list.supabase.summaries");
  try {
    const query = applyScope(
      supabase.from("payroll_groups").select(SUMMARY_COLUMNS),
      companyId,
    );
    const { data, error } = await query;
    if (error) throw new Error(`[payroll_groups] Supabase list failed: ${error.message}`);
    const rows = (data ?? []) as unknown as PayrollGroupSummaryRow[];
    return rows.filter((r) => !r.deleted_at).map(rowToSummary);
  } finally {
    stop();
  }
}

/** FULL group records (lossless `data` jsonb) for a company scope (+ globals). */
export async function listFullPayrollGroupsFromSupabase(
  companyId?: string | null,
): Promise<PayrollGroup[]> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const stop = perf.start("payrollGroups.list.supabase.full");
  perf.count("payrollGroups.list.supabase.full.calls");
  try {
    const query = applyScope(
      supabase.from("payroll_groups").select("data, company_legacy_id, deleted_at"),
      companyId,
    );
    const { data, error } = await query;
    if (error) throw new Error(`[payroll_groups] Supabase full list failed: ${error.message}`);
    const rows = (data ?? []) as unknown as PayrollGroupFullRow[];
    return rows
      .filter((r) => !r.deleted_at)
      .map((r) => r.data)
      .filter((g): g is PayrollGroup => Boolean(g));
  } finally {
    stop();
  }
}
