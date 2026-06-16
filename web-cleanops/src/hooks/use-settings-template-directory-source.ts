import { useEffect, useMemo, useRef, useState } from "react";

import type { SettingsTemplate } from "@/types";
import { isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import { listFullSettingsTemplatesFromSupabase } from "@/lib/data/supabaseSettingsTemplateRepository";
import { shadowReadSettingsTemplates } from "@/lib/data/settingsTemplateMigration";
import {
  shouldReadSettingsTemplatesFromSupabase,
  recordSettingsTemplateSupabaseRead,
  recordSettingsTemplateReadFallback,
  recordSettingsTemplateShadowDrift,
} from "@/lib/data/settingsTemplateCutover";

export type SettingsTemplateDirectorySourceKind = "local" | "supabase";

export interface SettingsTemplateDirectorySourceParams {
  localTemplates: SettingsTemplate[];
}

export interface SettingsTemplateDirectorySourceResult {
  templates: SettingsTemplate[];
  source: SettingsTemplateDirectorySourceKind;
  loading: boolean;
  error: string | null;
}

/**
 * Resolves the SOURCE of the settings-template directory (SET). Templates are
 * ALWAYS global master data (no company scope), so there is a single fetch of
 * the full catalog. Default (flag OFF): returns `localTemplates` unchanged. Flag
 * ON: serves the Supabase result directly; empty reads render an empty directory
 * and never fall back to browser-persistent local data. Rollback = flag OFF.
 */
export function useSettingsTemplateDirectorySource(
  params: SettingsTemplateDirectorySourceParams,
): SettingsTemplateDirectorySourceResult {
  const { localTemplates } = params;

  const enabled = shouldReadSettingsTemplatesFromSupabase() && isSupabaseConfigured;

  const [remote, setRemote] = useState<SettingsTemplate[] | null>(null);
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
      const stop = perf.start("settingsTemplates.directory.supabase");
      try {
        const fetched = await listFullSettingsTemplatesFromSupabase();
        if (seq !== requestSeq.current) return;

        setRemote(fetched);
        setError(null);
        recordSettingsTemplateSupabaseRead();
        if (fetched.length > 0) void runShadowCompare();
      } catch (err) {
        if (seq !== requestSeq.current) return;
        setRemote([]);
        const message =
          err instanceof Error ? err.message : "Supabase settings-template directory read failed.";
        setError(message);
        recordSettingsTemplateReadFallback("*", message);
      } finally {
        stop();
        if (seq === requestSeq.current) setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  const usingSupabase = enabled;
  const templates = usingSupabase ? remote ?? [] : localTemplates;

  return useMemo<SettingsTemplateDirectorySourceResult>(() => {
    if (usingSupabase) {
      perf.count("settingsTemplates.directory.source.supabase");
      return { templates, source: "supabase", loading, error };
    }
    perf.count("settingsTemplates.directory.source.local");
    return { templates, source: "local", loading, error };
  }, [usingSupabase, templates, loading, error]);
}

async function runShadowCompare(): Promise<void> {
  try {
    const report = await shadowReadSettingsTemplates();
    if (!report.ok) {
      recordSettingsTemplateShadowDrift(
        report.notes.join("; ") || "settings-template directory drift",
      );
    }
  } catch {
    // observability-only
  }
}
