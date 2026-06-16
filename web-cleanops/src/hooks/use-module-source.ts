import { useEffect, useMemo, useRef, useState } from "react";

import type { Module, ModuleCategory, CompanyModuleSetting } from "@/types";
import { isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import {
  listFullModulesFromSupabase,
  listFullModuleCategoriesFromSupabase,
  listFullCompanyModulesFromSupabase,
} from "@/lib/data/supabaseModuleRepository";
import { shadowReadModules } from "@/lib/data/moduleMigration";
import {
  shouldReadModulesFromSupabase,
  recordModuleSupabaseRead,
  recordModuleReadFallback,
  recordModuleShadowDrift,
} from "@/lib/data/moduleCutover";

export type ModuleSourceKind = "local" | "supabase";

export interface ModuleSourceSnapshot {
  modules: Module[];
  categories: ModuleCategory[];
  companyModules: CompanyModuleSetting[];
}

export interface ModuleSourceParams {
  local: ModuleSourceSnapshot;
  companyId?: string | null;
}

export interface ModuleSourceResult extends ModuleSourceSnapshot {
  source: ModuleSourceKind;
  loading: boolean;
  error: string | null;
}

/**
 * Resolves the SOURCE of the Module-domain directory (MOD): the global modules /
 * categories catalogue plus the company-scoped config. Default (flag OFF):
 * returns the `local` snapshot unchanged. Flag ON: serves the Supabase snapshot
 * directly; empty reads render empty module/category/company-module collections
 * and never fall back to browser-persistent local data. Rollback = flag OFF.
 */
export function useModuleSource(params: ModuleSourceParams): ModuleSourceResult {
  const { local, companyId } = params;
  const scope = companyId ?? null;

  const enabled = shouldReadModulesFromSupabase() && isSupabaseConfigured;

  const [remote, setRemote] = useState<ModuleSourceSnapshot | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const requestSeq = useRef<number>(0);

  useEffect(() => {
    if (!enabled) {
      setRemote(null);
      setError(null);
      return;
    }

    const seq = ++requestSeq.current;
    setLoading(true);

    void (async () => {
      const stop = perf.start("modules.directory.supabase");
      try {
        const [modules, categories, companyModules] = await Promise.all([
          listFullModulesFromSupabase(),
          listFullModuleCategoriesFromSupabase(),
          listFullCompanyModulesFromSupabase(scope),
        ]);
        if (seq !== requestSeq.current) return;

        setRemote({ modules, categories, companyModules });
        setError(null);
        recordModuleSupabaseRead();
        if (modules.length > 0) void runShadowCompare(scope);
      } catch (err) {
        if (seq !== requestSeq.current) return;
        setRemote({ modules: [], categories: [], companyModules: [] });
        const message =
          err instanceof Error ? err.message : "Supabase module directory read failed.";
        setError(message);
        recordModuleReadFallback(scope ?? "*", message);
      } finally {
        stop();
        if (seq === requestSeq.current) setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, scope]);

  const usingSupabase = enabled;
  const snapshot = usingSupabase ? remote ?? { modules: [], categories: [], companyModules: [] } : local;

  return useMemo<ModuleSourceResult>(() => {
    perf.count(`modules.directory.source.${usingSupabase ? "supabase" : "local"}`);
    return {
      modules: snapshot.modules,
      categories: snapshot.categories,
      companyModules: snapshot.companyModules,
      source: usingSupabase ? "supabase" : "local",
      loading,
      error,
    };
  }, [usingSupabase, snapshot, loading, error]);
}

async function runShadowCompare(companyId: string | null): Promise<void> {
  try {
    const report = await shadowReadModules({ companyId });
    if (!report.ok) {
      recordModuleShadowDrift(report.notes.join("; ") || "module directory drift");
    }
  } catch {
    // observability-only
  }
}
