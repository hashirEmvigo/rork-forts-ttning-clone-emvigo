import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import type { Module, ModuleCategory, CompanyModuleSetting } from "@/types";
import { isSupabaseConfigured } from "@/lib/supabase";
import { isSupabaseAuthEnabled } from "@/lib/authSupabase";
import { perf } from "@/lib/perf";
import {
  listFullModulesFromSupabase,
  listFullModuleCategoriesFromSupabase,
  listFullCompanyModulesFromSupabase,
} from "@/lib/data/supabaseModuleRepository";
import {
  getModuleDirectoryRefreshVersion,
  subscribeModuleDirectoryRefresh,
} from "@/lib/data/moduleDirectoryRefresh";
import {
  shouldReadModulesFromSupabase,
  recordModuleSupabaseRead,
  recordModuleReadFallback,
} from "@/lib/data/moduleCutover";

/** Where the module catalogue the UI renders comes from. */
export type ModuleDirectorySourceKind = "local" | "supabase";

export interface ModuleDirectorySourceParams {
  /** The localStorage modules seeded synchronously at mount (flag-off fallback). */
  localModules: Module[];
  /** The localStorage categories seeded synchronously at mount (flag-off fallback). */
  localModuleCategories: ModuleCategory[];
  /** The localStorage company-module config seeded at mount (flag-off fallback). */
  localCompanyModules: CompanyModuleSetting[];
  /**
   * Stable auth-readiness signal (`currentUser?.id ?? null`). The GLOBAL catalogue
   * is world-readable, but company_modules is RLS-scoped to the signed-in user
   * (super admin → all companies, company admin → own). When Supabase Auth is
   * enabled the read is skipped until this is non-null so it always runs against
   * an authenticated (RLS-correct) session, and a re-fetch is triggered on the
   * `null → id` transition after login so company availability resolves correctly.
   */
  authNonce: string | null;
}

export interface ModuleDirectorySourceResult {
  /** Modules the UI should consume (Supabase when flag ON + configured). */
  modules: Module[];
  /** Categories the UI should consume (Supabase when flag ON + configured). */
  moduleCategories: ModuleCategory[];
  /** Per-company availability/enablement config (Supabase when flag ON, RLS-scoped). */
  companyModules: CompanyModuleSetting[];
  /** The source actually backing the lists right now. */
  source: ModuleDirectorySourceKind;
  /** True while the Supabase directory read is in flight (only when enabled). */
  loading: boolean;
  /** A non-fatal error message if the Supabase read failed. */
  error: string | null;
}

/**
 * Resolves the SOURCE of the Module-domain directory (Phase 2A + 2B) — the
 * Modules analogue of
 * {@link import("./use-time-code-directory-source").useTimeCodeDirectorySource}.
 * It serves THREE collections from a single fetch:
 *
 *   • modules / module_categories — GLOBAL master data (no company scope,
 *     world-readable). Phase 2A.
 *   • company_modules            — COMPANY-scoped availability/enablement config,
 *     read UNSCOPED so RLS returns the correct set per role (super admin → all
 *     companies; company admin → own). Phase 2B.
 *
 * Default (flag OFF, e.g. vitest / rollback): returns the caller-provided
 * localStorage arrays unchanged — zero behaviour change, fully synchronous.
 *
 * Flag ON (app builds): reads the FULL records (losslessly reconstructed from
 * the `data` jsonb) from Supabase, serving them directly. Safety:
 *
 *   • Query error / throw → render empty + record a fallback event.
 *   • Empty Supabase result → render empty (no stale local seed — Supabase is
 *     authoritative; clearing localStorage never changes availability/enabled).
 *   • A superseded refresh (stale async result) is discarded via a request
 *     sequence guard so an older fetch can never overwrite a newer one.
 *   • While Supabase Auth is enabled but not yet ready (`authNonce === null`),
 *     the read is skipped so company_modules is never read under an
 *     unauthenticated (misleading-empty) session.
 *
 * An authoritative write (global status / category mutation OR a company
 * availability/enablement change) bumps {@link bumpModuleDirectoryRefresh} so
 * this hook refetches and the UI reflects the true persisted state. Rollback is
 * instant: flip the flag OFF.
 */
export function useModuleDirectorySource(
  params: ModuleDirectorySourceParams,
): ModuleDirectorySourceResult {
  const { localModules, localModuleCategories, localCompanyModules, authNonce } = params;

  const enabled = shouldReadModulesFromSupabase() && isSupabaseConfigured;
  // company_modules is RLS-scoped to the caller; an unauthenticated pre-auth read
  // would return a misleading empty set. Skip the fetch until auth is ready.
  const awaitingAuth = isSupabaseAuthEnabled && authNonce === null;

  const [remoteModules, setRemoteModules] = useState<Module[] | null>(null);
  const [remoteCategories, setRemoteCategories] = useState<ModuleCategory[] | null>(null);
  const [remoteCompanyModules, setRemoteCompanyModules] = useState<
    CompanyModuleSetting[] | null
  >(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Bumped by the authoritative mutations after a confirmed Supabase write so the
  // directory refetches and the UI reflects the true persisted state.
  const refreshVersion = useSyncExternalStore(
    subscribeModuleDirectoryRefresh,
    getModuleDirectoryRefreshVersion,
    getModuleDirectoryRefreshVersion,
  );

  // Guards stale async results from overwriting a newer fetch.
  const requestSeq = useRef<number>(0);

  useEffect(() => {
    if (!enabled || awaitingAuth) {
      setRemoteModules(null);
      setRemoteCategories(null);
      setRemoteCompanyModules(null);
      setError(null);
      return;
    }

    const seq = ++requestSeq.current;
    setLoading(true);

    void (async () => {
      const stop = perf.start("modules.directory.supabase");
      try {
        const [mods, cats, companyMods] = await Promise.all([
          listFullModulesFromSupabase(),
          listFullModuleCategoriesFromSupabase(),
          listFullCompanyModulesFromSupabase(),
        ]);
        if (seq !== requestSeq.current) return; // superseded by a newer refresh
        setRemoteModules(mods);
        setRemoteCategories(cats);
        setRemoteCompanyModules(companyMods);
        setError(null);
        recordModuleSupabaseRead();
      } catch (err) {
        if (seq !== requestSeq.current) return;
        setRemoteModules([]);
        setRemoteCategories([]);
        setRemoteCompanyModules([]);
        const message =
          err instanceof Error ? err.message : "Supabase module directory read failed.";
        setError(message);
        recordModuleReadFallback("*", message);
      } finally {
        stop();
        if (seq === requestSeq.current) setLoading(false);
      }
    })();
    // localModules / localModuleCategories / localCompanyModules intentionally
    // omitted: browser-persistent local data is only a flag-off rollback path, not
    // a Supabase read fallback or fetch trigger. refreshVersion + authNonce ARE
    // dependencies: an authoritative write refetches, and the null→id auth
    // transition refetches company_modules under the correct RLS scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, awaitingAuth, authNonce, refreshVersion]);

  const usingSupabase = enabled;
  const modules = usingSupabase ? remoteModules ?? [] : localModules;
  const moduleCategories = usingSupabase ? remoteCategories ?? [] : localModuleCategories;
  const companyModules = usingSupabase
    ? remoteCompanyModules ?? []
    : localCompanyModules;

  return useMemo<ModuleDirectorySourceResult>(() => {
    if (usingSupabase) {
      perf.count("modules.directory.source.supabase");
      return {
        modules,
        moduleCategories,
        companyModules,
        source: "supabase",
        loading,
        error,
      };
    }
    perf.count("modules.directory.source.local");
    return {
      modules,
      moduleCategories,
      companyModules,
      source: "local",
      loading,
      error,
    };
  }, [usingSupabase, modules, moduleCategories, companyModules, loading, error]);
}
