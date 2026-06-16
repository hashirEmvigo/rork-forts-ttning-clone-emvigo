import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import type { ServiceCategory } from "@/types";
import { isSupabaseConfigured } from "@/lib/supabase";
import { isSupabaseAuthEnabled } from "@/lib/authSupabase";
import { perf } from "@/lib/perf";
import { listFullServiceCategoriesFromSupabase } from "@/lib/data/supabaseServiceCategoryRepository";
import { shadowReadServiceCategories } from "@/lib/data/serviceCategoryMigration";
import {
  shouldReadServiceCategoriesFromSupabase,
  recordServiceCategorySupabaseRead,
  recordServiceCategoryReadFallback,
  recordServiceCategoryShadowDrift,
} from "@/lib/data/serviceCategoryCutover";
import {
  getServiceCatalogDirectoryRefreshVersion,
  subscribeServiceCatalogDirectoryRefresh,
} from "@/lib/data/serviceCatalogDirectoryRefresh";

export type ServiceCategoryDirectorySourceKind = "local" | "supabase";

export interface ServiceCategoryDirectorySourceParams {
  localCategories: ServiceCategory[];
  companyId: string | null | undefined;
  /**
   * Stable auth-readiness signal (`currentUser?.id ?? null`). When Supabase Auth
   * is enabled, the read is skipped until this is non-null so the fetch always
   * runs against an authenticated (RLS-correct) session, and a re-fetch is
   * triggered when it transitions `null → id` after login.
   */
  authNonce: string | null;
}

export interface ServiceCategoryDirectorySourceResult {
  categories: ServiceCategory[];
  source: ServiceCategoryDirectorySourceKind;
  loading: boolean;
  error: string | null;
}

/**
 * Resolves the SOURCE of the service-category directory (SVCCAT) — the
 * service-categories analogue of {@link import("./use-service-directory-source").useServiceDirectorySource}.
 * Default (flag OFF): returns `localCategories` unchanged. Flag ON: serves the
 * Supabase result directly; empty reads render an empty directory and never
 * fall back to browser-persistent local data. Rollback = flag OFF.
 */
export function useServiceCategoryDirectorySource(
  params: ServiceCategoryDirectorySourceParams,
): ServiceCategoryDirectorySourceResult {
  const { localCategories, companyId, authNonce } = params;

  const enabled = shouldReadServiceCategoriesFromSupabase() && isSupabaseConfigured;
  // When Supabase Auth is enabled, an unauthenticated pre-auth read can return
  // misleading empty results under RLS. Skip the fetch until auth is ready.
  const awaitingAuth = isSupabaseAuthEnabled && authNonce === null;

  const [remote, setRemote] = useState<ServiceCategory[] | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const refreshVersion = useSyncExternalStore(
    subscribeServiceCatalogDirectoryRefresh,
    getServiceCatalogDirectoryRefreshVersion,
    getServiceCatalogDirectoryRefreshVersion,
  );

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
      const stop = perf.start("serviceCategories.directory.supabase");
      try {
        const fetched = await listFullServiceCategoriesFromSupabase(scope);
        if (seq !== requestSeq.current) return;

        setRemote(fetched);
        setError(null);
        recordServiceCategorySupabaseRead();
        if (fetched.length > 0) void runShadowCompare(scope);
      } catch (err) {
        if (seq !== requestSeq.current) return;
        setRemote([]);
        const message =
          err instanceof Error ? err.message : "Supabase category directory read failed.";
        setError(message);
        recordServiceCategoryReadFallback(ref, message);
      } finally {
        stop();
        if (seq === requestSeq.current) setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, awaitingAuth, companyId, authNonce, refreshVersion]);

  const usingSupabase = enabled;
  const categories = usingSupabase ? remote ?? [] : localCategories;

  return useMemo<ServiceCategoryDirectorySourceResult>(() => {
    if (usingSupabase) {
      perf.count("serviceCategories.directory.source.supabase");
      return { categories, source: "supabase", loading, error };
    }
    perf.count("serviceCategories.directory.source.local");
    return { categories, source: "local", loading, error };
  }, [usingSupabase, categories, loading, error]);
}

async function runShadowCompare(scope: string | undefined): Promise<void> {
  try {
    const report = await shadowReadServiceCategories(scope ?? null);
    if (!report.ok) {
      recordServiceCategoryShadowDrift(report.notes.join("; ") || "category directory drift");
    }
  } catch {
    // observability-only
  }
}
