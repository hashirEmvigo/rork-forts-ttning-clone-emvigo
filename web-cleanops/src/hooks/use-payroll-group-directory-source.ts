import { useEffect, useMemo, useRef, useState } from "react";

import type { PayrollGroup } from "@/types";
import { isSupabaseConfigured } from "@/lib/supabase";
import { isSupabaseAuthEnabled } from "@/lib/authSupabase";
import { perf } from "@/lib/perf";
import { listFullPayrollGroupsFromSupabase } from "@/lib/data/supabasePayrollGroupRepository";
import { shadowReadPayrollGroups } from "@/lib/data/payrollGroupMigration";
import {
  shouldReadPayrollGroupsFromSupabase,
  recordPayrollGroupSupabaseRead,
  recordPayrollGroupReadFallback,
  recordPayrollGroupShadowDrift,
} from "@/lib/data/payrollGroupCutover";

export type PayrollGroupDirectorySourceKind = "local" | "supabase";

export interface PayrollGroupDirectorySourceParams {
  localGroups: PayrollGroup[];
  companyId: string | null | undefined;
  /**
   * Stable auth-readiness signal (`currentUser?.id ?? null`). When Supabase Auth
   * is enabled, the read is skipped until this is non-null so the fetch always
   * runs against an authenticated (RLS-correct) session, and a re-fetch is
   * triggered when it transitions `null → id` after login.
   */
  authNonce: string | null;
}

export interface PayrollGroupDirectorySourceResult {
  groups: PayrollGroup[];
  source: PayrollGroupDirectorySourceKind;
  loading: boolean;
  error: string | null;
}

/**
 * Resolves the SOURCE of the payroll-group directory (SVCCAT) — the
 * payroll-groups analogue of {@link import("./use-service-category-directory-source").useServiceCategoryDirectorySource}.
 * Default (flag OFF): returns `localGroups` unchanged. Flag ON: serves the
 * Supabase result directly; empty reads render an empty directory and never
 * fall back to browser-persistent local data. Rollback = flag OFF.
 */
export function usePayrollGroupDirectorySource(
  params: PayrollGroupDirectorySourceParams,
): PayrollGroupDirectorySourceResult {
  const { localGroups, companyId, authNonce } = params;

  const enabled = shouldReadPayrollGroupsFromSupabase() && isSupabaseConfigured;
  // When Supabase Auth is enabled, an unauthenticated pre-auth read can return
  // misleading empty results under RLS. Skip the fetch until auth is ready.
  const awaitingAuth = isSupabaseAuthEnabled && authNonce === null;

  const [remote, setRemote] = useState<PayrollGroup[] | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const requestSeq = useRef<number>(0);

  useEffect(() => {
    if (!enabled || awaitingAuth) {
      setRemote(null);
      setError(null);
      return;
    }

    const seq = ++requestSeq.current;
    const scope = companyId ?? undefined;
    const ref = companyId ?? "*";
    setLoading(true);

    void (async () => {
      const stop = perf.start("payrollGroups.directory.supabase");
      try {
        const fetched = await listFullPayrollGroupsFromSupabase(scope);
        if (seq !== requestSeq.current) return;

        setRemote(fetched);
        setError(null);
        recordPayrollGroupSupabaseRead();
        if (fetched.length > 0) void runShadowCompare(scope);
      } catch (err) {
        if (seq !== requestSeq.current) return;
        setRemote([]);
        const message =
          err instanceof Error ? err.message : "Supabase payroll group directory read failed.";
        setError(message);
        recordPayrollGroupReadFallback(ref, message);
      } finally {
        stop();
        if (seq === requestSeq.current) setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, awaitingAuth, companyId, authNonce]);

  const usingSupabase = enabled;
  const groups = usingSupabase ? remote ?? [] : localGroups;

  return useMemo<PayrollGroupDirectorySourceResult>(() => {
    if (usingSupabase) {
      perf.count("payrollGroups.directory.source.supabase");
      return { groups, source: "supabase", loading, error };
    }
    perf.count("payrollGroups.directory.source.local");
    return { groups, source: "local", loading, error };
  }, [usingSupabase, groups, loading, error]);
}

async function runShadowCompare(scope: string | undefined): Promise<void> {
  try {
    const report = await shadowReadPayrollGroups(scope ?? null);
    if (!report.ok) {
      recordPayrollGroupShadowDrift(report.notes.join("; ") || "payroll group directory drift");
    }
  } catch {
    // observability-only
  }
}
