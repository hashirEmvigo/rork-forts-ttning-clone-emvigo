import { useEffect, useMemo, useRef, useState } from "react";

import type { ServicePackage } from "@/types";
import { isSupabaseConfigured } from "@/lib/supabase";
import { isSupabaseAuthEnabled } from "@/lib/authSupabase";
import { perf } from "@/lib/perf";
import { listFullServicePackagesFromSupabase } from "@/lib/data/supabaseServicePackageRepository";
import { shadowReadServicePackages } from "@/lib/data/servicePackageMigration";
import {
  shouldReadServicePackagesFromSupabase,
  recordServicePackageSupabaseRead,
  recordServicePackageReadFallback,
  recordServicePackageShadowDrift,
} from "@/lib/data/servicePackageCutover";

export type ServicePackageDirectorySourceKind = "local" | "supabase";

export interface ServicePackageDirectorySourceParams {
  localPackages: ServicePackage[];
  /**
   * Stable auth-readiness signal (`currentUser?.id ?? null`). When Supabase Auth
   * is enabled, the read is skipped until this is non-null so the fetch always
   * runs against an authenticated (RLS-correct) session, and a re-fetch is
   * triggered when it transitions `null → id` after login.
   */
  authNonce: string | null;
  /**
   * Monotonic refresh signal. Bumping this re-fetches the authoritative Supabase
   * catalog — used after a successful package write so the directory reflects the
   * canonical server state without a hard refresh. No effect when the read path
   * is local (flag OFF).
   */
  reloadToken?: number;
}

export interface ServicePackageDirectorySourceResult {
  packages: ServicePackage[];
  source: ServicePackageDirectorySourceKind;
  loading: boolean;
  error: string | null;
}

/**
 * Resolves the SOURCE of the service-package directory (SVCCAT). Packages are
 * ALWAYS global master data (no company scope), so there is a single fetch of
 * the full catalog. Default (flag OFF): returns `localPackages` unchanged. Flag
 * ON: serves the Supabase result directly; empty reads render an empty directory
 * and never fall back to browser-persistent local data. Rollback = flag OFF.
 */
export function useServicePackageDirectorySource(
  params: ServicePackageDirectorySourceParams,
): ServicePackageDirectorySourceResult {
  const { localPackages, authNonce, reloadToken = 0 } = params;

  const enabled = shouldReadServicePackagesFromSupabase() && isSupabaseConfigured;
  // When Supabase Auth is enabled, an unauthenticated pre-auth read can return
  // misleading empty results under RLS. Skip the fetch until auth is ready.
  const awaitingAuth = isSupabaseAuthEnabled && authNonce === null;

  const [remote, setRemote] = useState<ServicePackage[] | null>(null);
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
    setLoading(true);

    void (async () => {
      const stop = perf.start("servicePackages.directory.supabase");
      try {
        const fetched = await listFullServicePackagesFromSupabase();
        if (seq !== requestSeq.current) return;

        setRemote(fetched);
        setError(null);
        recordServicePackageSupabaseRead();
        if (fetched.length > 0) void runShadowCompare();
      } catch (err) {
        if (seq !== requestSeq.current) return;
        setRemote([]);
        const message =
          err instanceof Error ? err.message : "Supabase package directory read failed.";
        setError(message);
        recordServicePackageReadFallback("*", message);
      } finally {
        stop();
        if (seq === requestSeq.current) setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, awaitingAuth, authNonce, reloadToken]);

  const usingSupabase = enabled;
  const packages = usingSupabase ? remote ?? [] : localPackages;

  return useMemo<ServicePackageDirectorySourceResult>(() => {
    if (usingSupabase) {
      perf.count("servicePackages.directory.source.supabase");
      return { packages, source: "supabase", loading, error };
    }
    perf.count("servicePackages.directory.source.local");
    return { packages, source: "local", loading, error };
  }, [usingSupabase, packages, loading, error]);
}

async function runShadowCompare(): Promise<void> {
  try {
    const report = await shadowReadServicePackages();
    if (!report.ok) {
      recordServicePackageShadowDrift(report.notes.join("; ") || "package directory drift");
    }
  } catch {
    // observability-only
  }
}
