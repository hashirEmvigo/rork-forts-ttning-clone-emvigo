import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import type { Employee } from "@/types";
import { isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import { listFullEmployeesFromSupabase } from "@/lib/data/supabaseEmployeeRepository";
import { shadowReadEmployees } from "@/lib/data/employeeMigration";
import {
  getEmployeeDirectoryRefreshVersion,
  subscribeEmployeeDirectoryRefresh,
} from "@/lib/data/employeeDirectoryRefresh";
import {
  shouldReadEmployeesFromSupabase,
  recordEmployeeSupabaseRead,
  recordEmployeeReadFallback,
  recordEmployeeUnsafeEmpty,
  recordEmployeeShadowDrift,
} from "@/lib/data/employeeCutover";

/** Where the employee directory the UI renders comes from. */
export type EmployeeDirectorySourceKind = "local" | "supabase";

export interface EmployeeDirectorySourceParams {
  /** The localStorage employees seeded synchronously at mount (fallback). */
  localEmployees: Employee[];
  /** Active company scope for the Supabase read — `undefined` = unscoped (super admin). */
  companyId: string | null | undefined;
}

export interface EmployeeDirectorySourceResult {
  /** Employees the UI should consume (Supabase when flag ON + healthy + non-empty). */
  employees: Employee[];
  /** The source actually backing `employees` right now. */
  source: EmployeeDirectorySourceKind;
  /** True while the Supabase directory read is in flight (only when the flag is on). */
  loading: boolean;
  /** A non-fatal error message if the Supabase read failed (we fell back to local). */
  error: string | null;
}

/**
 * Resolves the SOURCE of the employee directory (EMP-2) — the Employees analogue
 * of {@link import("./use-schedule-input-source").useScheduleInputSource}, but
 * adapted to the fact that Employees is a single GLOBAL company directory, not an
 * interval-scoped projection. There is exactly one fetch per company scope (not
 * per view), and it replaces the whole in-memory array only on a healthy result.
 *
 * Default (flag OFF): returns the caller-provided localStorage `localEmployees`
 * unchanged — zero behaviour change, fully synchronous, the directory is never
 * touched by Supabase.
 *
 * Flag ON ({@link EMPLOYEES_SUPABASE_READ}): reads the FULL employee records
 * (losslessly reconstructed from the `data` jsonb) from Supabase via the
 * validated {@link listFullEmployeesFromSupabase}. The caller keeps the
 * synchronous local seed as the initial value (zero flash); this hook reconciles
 * to Supabase ONLY on a healthy result. Safety rules:
 *
 *   • Query error / throw → record the failure and KEEP the local seed (the
 *     directory never blanks; EMP-2 safety guarantee).
 *   • UNSAFE empty (Supabase 0 rows while local has data) → keep the local seed.
 *   • A healthy non-empty result — or a SAFE empty (both empty) — replaces the
 *     in-memory array.
 *   • A superseded scope change (stale async result) is discarded via a request
 *     sequence guard so an older fetch can never overwrite a newer one.
 *
 * A background {@link shadowReadEmployees} runs after each healthy Supabase serve
 * and surfaces any count / id / summary / detail drift (never silently ignored);
 * drift only flags observability — it never blocks the UI.
 *
 * EMP-2 scope: read ONLY. localStorage stays authoritative and the ONLY write
 * target — there is NO dual-write and NO authoritative mode here. Rollback is
 * instant: flip the flag OFF.
 */
export function useEmployeeDirectorySource(
  params: EmployeeDirectorySourceParams,
): EmployeeDirectorySourceResult {
  const { localEmployees, companyId } = params;

  const enabled = shouldReadEmployeesFromSupabase() && isSupabaseConfigured;

  const [remoteEmployees, setRemoteEmployees] = useState<Employee[] | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Guards stale async results from overwriting a newer fetch (scope change).
  const requestSeq = useRef<number>(0);
  const refreshVersion = useSyncExternalStore(
    subscribeEmployeeDirectoryRefresh,
    getEmployeeDirectoryRefreshVersion,
    getEmployeeDirectoryRefreshVersion,
  );

  useEffect(() => {
    if (!enabled) {
      // Flag OFF (or Supabase unconfigured): no Supabase dependency on the path.
      setRemoteEmployees(null);
      setError(null);
      return;
    }

    const seq = ++requestSeq.current;
    const scope = companyId ?? undefined;
    const ref = companyId ?? "*";
    setLoading(true);

    void (async () => {
      const stop = perf.start("employees.directory.supabase");
      try {
        const fetched = await listFullEmployeesFromSupabase(scope);
        if (seq !== requestSeq.current) return; // superseded by a newer scope

        if (fetched.length === 0 && localEmployees.length > 0) {
          // UNSAFE empty: never blank a populated directory — keep the local seed.
          setRemoteEmployees(null);
          setError(null);
          recordEmployeeUnsafeEmpty(ref);
        } else {
          setRemoteEmployees(fetched);
          setError(null);
          recordEmployeeSupabaseRead();
          if (fetched.length > 0) void runShadowCompare(scope);
        }
      } catch (err) {
        if (seq !== requestSeq.current) return;
        setRemoteEmployees(null);
        const message =
          err instanceof Error ? err.message : "Supabase employee directory read failed.";
        setError(message);
        recordEmployeeReadFallback(ref, message);
      } finally {
        stop();
        if (seq === requestSeq.current) setLoading(false);
      }
    })();
    // localEmployees intentionally omitted: browser-persistent local data is not
    // a source signal when Supabase reads are enabled.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, companyId, refreshVersion]);

  // Serve Supabase only when enabled AND a healthy result is held. Otherwise
  // (flag off, read failure, unsafe empty) the local seed is served so the
  // directory never blanks.
  const usingSupabase = enabled && remoteEmployees !== null;
  const employees = usingSupabase ? remoteEmployees : localEmployees;

  return useMemo<EmployeeDirectorySourceResult>(() => {
    if (usingSupabase) {
      perf.count("employees.directory.source.supabase");
      return { employees, source: "supabase", loading, error };
    }
    perf.count("employees.directory.source.local");
    return { employees, source: "local", loading, error };
  }, [usingSupabase, employees, loading, error]);
}

/**
 * Runs the background shadow comparison after a healthy Supabase serve and
 * records any drift. Fire-and-forget: failures here never affect the served
 * directory (it already reconciled to a healthy Supabase result).
 */
async function runShadowCompare(scope: string | undefined): Promise<void> {
  try {
    const report = await shadowReadEmployees(scope ?? null);
    if (!report.ok) {
      recordEmployeeShadowDrift(report.notes.join("; ") || "employee directory drift");
    }
  } catch {
    // Shadow read is observability-only; swallow to never affect the UI.
  }
}
