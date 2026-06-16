import { useEffect, useMemo, useRef, useState } from "react";

import type { EmployeeLanguage } from "@/types";
import { isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import { listFullEmployeeLanguagesFromSupabase } from "@/lib/data/supabaseEmployeeLanguageRepository";
import { shadowReadEmployeeLanguages } from "@/lib/data/employeeLanguageMigration";
import {
  shouldReadEmployeeLanguagesFromSupabase,
  recordEmployeeLanguageSupabaseRead,
  recordEmployeeLanguageReadFallback,
  recordEmployeeLanguageShadowDrift,
} from "@/lib/data/employeeLanguageCutover";

export type EmployeeLanguageDirectorySourceKind = "local" | "supabase";

export interface EmployeeLanguageDirectorySourceParams {
  localLanguages: EmployeeLanguage[];
  companyId: string | null | undefined;
}

export interface EmployeeLanguageDirectorySourceResult {
  languages: EmployeeLanguage[];
  source: EmployeeLanguageDirectorySourceKind;
  loading: boolean;
  error: string | null;
}

/**
 * Resolves the SOURCE of the employee-language directory (AREA) — the Languages
 * analogue of {@link import("./use-area-directory-source").useAreaDirectorySource}.
 * Default (flag OFF): returns `localLanguages` unchanged. Flag ON: reconciles to
 * the Supabase result directly. Empty reads render an empty directory and never
 * fall back to browser-persistent local data. Rollback = flag OFF.
 */
export function useEmployeeLanguageDirectorySource(
  params: EmployeeLanguageDirectorySourceParams,
): EmployeeLanguageDirectorySourceResult {
  const { localLanguages, companyId } = params;

  const enabled = shouldReadEmployeeLanguagesFromSupabase() && isSupabaseConfigured;

  const [remote, setRemote] = useState<EmployeeLanguage[] | null>(null);
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
    const scope = companyId ?? undefined;
    const ref = companyId ?? "*";
    setLoading(true);

    void (async () => {
      const stop = perf.start("employeeLanguages.directory.supabase");
      try {
        const fetched = await listFullEmployeeLanguagesFromSupabase(scope);
        if (seq !== requestSeq.current) return;

        setRemote(fetched);
        setError(null);
        recordEmployeeLanguageSupabaseRead();
        if (fetched.length > 0) void runShadowCompare(scope);
      } catch (err) {
        if (seq !== requestSeq.current) return;
        setRemote([]);
        const message =
          err instanceof Error ? err.message : "Supabase language directory read failed.";
        setError(message);
        recordEmployeeLanguageReadFallback(ref, message);
      } finally {
        stop();
        if (seq === requestSeq.current) setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, companyId]);

  const usingSupabase = enabled;
  const languages = usingSupabase ? remote ?? [] : localLanguages;

  return useMemo<EmployeeLanguageDirectorySourceResult>(() => {
    if (usingSupabase) {
      perf.count("employeeLanguages.directory.source.supabase");
      return { languages, source: "supabase", loading, error };
    }
    perf.count("employeeLanguages.directory.source.local");
    return { languages, source: "local", loading, error };
  }, [usingSupabase, languages, loading, error]);
}

async function runShadowCompare(scope: string | undefined): Promise<void> {
  try {
    const report = await shadowReadEmployeeLanguages(scope ?? null);
    if (!report.ok) {
      recordEmployeeLanguageShadowDrift(report.notes.join("; ") || "language directory drift");
    }
  } catch {
    // observability-only
  }
}
