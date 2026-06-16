import { useEffect, useMemo, useRef, useState } from "react";

import type { CompanySettings } from "@/types";
import { isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import { listFullCompanySettingsFromSupabase } from "@/lib/data/supabaseCompanySettingsRepository";
import { shadowReadCompanySettings } from "@/lib/data/companySettingsMigration";
import {
  shouldReadCompanySettingsFromSupabase,
  recordCompanySettingsSupabaseRead,
  recordCompanySettingsReadFallback,
  recordCompanySettingsShadowDrift,
} from "@/lib/data/companySettingsCutover";

export type CompanySettingsDirectorySourceKind = "local" | "supabase";

export interface CompanySettingsDirectorySourceParams {
  localSettings: CompanySettings[];
  companyId: string | null | undefined;
}

export interface CompanySettingsDirectorySourceResult {
  settings: CompanySettings[];
  source: CompanySettingsDirectorySourceKind;
  loading: boolean;
  error: string | null;
}

/**
 * Resolves the SOURCE of the company-settings directory (SET) — the
 * company-settings analogue of
 * {@link import("./use-area-directory-source").useAreaDirectorySource}. Default
 * (flag OFF): returns `localSettings` unchanged. Flag ON: serves the Supabase
 * result directly; empty reads render an empty directory and never fall back to
 * browser-persistent local data. Rollback = flag OFF.
 */
export function useCompanySettingsDirectorySource(
  params: CompanySettingsDirectorySourceParams,
): CompanySettingsDirectorySourceResult {
  const { localSettings, companyId } = params;

  const enabled = shouldReadCompanySettingsFromSupabase() && isSupabaseConfigured;

  const [remote, setRemote] = useState<CompanySettings[] | null>(null);
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
      const stop = perf.start("companySettings.directory.supabase");
      try {
        const fetched = await listFullCompanySettingsFromSupabase(scope);
        if (seq !== requestSeq.current) return;

        setRemote(fetched);
        setError(null);
        recordCompanySettingsSupabaseRead();
        if (fetched.length > 0) void runShadowCompare(scope);
      } catch (err) {
        if (seq !== requestSeq.current) return;
        setRemote([]);
        const message =
          err instanceof Error ? err.message : "Supabase company-settings directory read failed.";
        setError(message);
        recordCompanySettingsReadFallback(ref, message);
      } finally {
        stop();
        if (seq === requestSeq.current) setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, companyId]);

  const usingSupabase = enabled;
  const settings = usingSupabase ? remote ?? [] : localSettings;

  return useMemo<CompanySettingsDirectorySourceResult>(() => {
    if (usingSupabase) {
      perf.count("companySettings.directory.source.supabase");
      return { settings, source: "supabase", loading, error };
    }
    perf.count("companySettings.directory.source.local");
    return { settings, source: "local", loading, error };
  }, [usingSupabase, settings, loading, error]);
}

async function runShadowCompare(scope: string | undefined): Promise<void> {
  try {
    const report = await shadowReadCompanySettings(scope ?? null);
    if (!report.ok) {
      recordCompanySettingsShadowDrift(
        report.notes.join("; ") || "company-settings directory drift",
      );
    }
  } catch {
    // observability-only
  }
}
