import { useEffect, useMemo, useRef, useState } from "react";

import { defaultSystemSettings, type SystemSettings } from "@/types";
import { isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import { getSystemSettingsFromSupabase } from "@/lib/data/supabaseSystemSettingsRepository";
import { shadowReadSystemSettings } from "@/lib/data/systemSettingsMigration";
import {
  shouldReadSystemSettingsFromSupabase,
  recordSystemSettingsSupabaseRead,
  recordSystemSettingsReadFallback,
  recordSystemSettingsShadowDrift,
} from "@/lib/data/systemSettingsCutover";

export type SystemSettingsSourceKind = "local" | "supabase";

export interface SystemSettingsSourceParams {
  localSettings: SystemSettings;
}

export interface SystemSettingsSourceResult {
  settings: SystemSettings;
  source: SystemSettingsSourceKind;
  loading: boolean;
  error: string | null;
}

/**
 * Resolves the SOURCE of the platform System Settings record (SYSSET). System
 * settings are a SINGLETON global record (no company scope), so there is a single
 * fetch. Default (flag OFF): returns `localSettings` unchanged. Flag ON serves
 * the Supabase record when present. If Supabase has no row or the read fails,
 * the hook uses a non-persistent safe default instead of browser storage.
 * Rollback = flag OFF.
 */
export function useSystemSettingsSource(
  params: SystemSettingsSourceParams,
): SystemSettingsSourceResult {
  const { localSettings } = params;

  const enabled = shouldReadSystemSettingsFromSupabase() && isSupabaseConfigured;

  const [remote, setRemote] = useState<SystemSettings | null>(null);
  const [safeDefault] = useState<SystemSettings>(() => defaultSystemSettings());
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
      const stop = perf.start("systemSettings.source.supabase");
      try {
        const fetched = await getSystemSettingsFromSupabase();
        if (seq !== requestSeq.current) return;

        if (fetched) {
          setRemote(fetched);
          setError(null);
          recordSystemSettingsSupabaseRead();
          void runShadowCompare();
        } else {
          setRemote(safeDefault);
          setError(null);
        }
      } catch (err) {
        if (seq !== requestSeq.current) return;
        setRemote(safeDefault);
        const message =
          err instanceof Error ? err.message : "Supabase system-settings read failed.";
        setError(message);
        recordSystemSettingsReadFallback("global", message);
      } finally {
        stop();
        if (seq === requestSeq.current) setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, safeDefault]);

  const usingSupabase = enabled;
  const settings = usingSupabase ? remote ?? safeDefault : localSettings;

  return useMemo<SystemSettingsSourceResult>(() => {
    if (usingSupabase) {
      perf.count("systemSettings.source.supabase");
      return { settings, source: "supabase", loading, error };
    }
    perf.count("systemSettings.source.local");
    return { settings, source: "local", loading, error };
  }, [usingSupabase, settings, loading, error]);
}

async function runShadowCompare(): Promise<void> {
  try {
    const report = await shadowReadSystemSettings();
    if (!report.ok) {
      recordSystemSettingsShadowDrift(report.notes.join("; ") || "system-settings drift");
    }
  } catch {
    // observability-only
  }
}
