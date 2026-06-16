import { useEffect, useMemo, useRef, useState } from "react";

import type { Area } from "@/types";
import { isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import { listFullAreasFromSupabase } from "@/lib/data/supabaseAreaRepository";
import { shadowReadAreas } from "@/lib/data/areaMigration";
import {
  shouldReadAreasFromSupabase,
  recordAreaSupabaseRead,
  recordAreaReadFallback,
  recordAreaShadowDrift,
} from "@/lib/data/areaCutover";

export type AreaDirectorySourceKind = "local" | "supabase";

export interface AreaDirectorySourceParams {
  localAreas: Area[];
  companyId: string | null | undefined;
}

export interface AreaDirectorySourceResult {
  areas: Area[];
  source: AreaDirectorySourceKind;
  loading: boolean;
  error: string | null;
}

/**
 * Resolves the SOURCE of the area directory (AREA) — the Areas analogue of
 * {@link import("./use-team-directory-source").useTeamDirectorySource}. Default
 * (flag OFF): returns `localAreas` unchanged. Flag ON: serves the Supabase
 * result directly; empty reads render an empty directory and never fall back to
 * browser-persistent local data. Rollback = flag OFF.
 */
export function useAreaDirectorySource(
  params: AreaDirectorySourceParams,
): AreaDirectorySourceResult {
  const { localAreas, companyId } = params;

  const enabled = shouldReadAreasFromSupabase() && isSupabaseConfigured;

  const [remote, setRemote] = useState<Area[] | null>(null);
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
      const stop = perf.start("areas.directory.supabase");
      try {
        const fetched = await listFullAreasFromSupabase(scope);
        if (seq !== requestSeq.current) return;

        setRemote(fetched);
        setError(null);
        recordAreaSupabaseRead();
        if (fetched.length > 0) void runShadowCompare(scope);
      } catch (err) {
        if (seq !== requestSeq.current) return;
        setRemote([]);
        const message =
          err instanceof Error ? err.message : "Supabase area directory read failed.";
        setError(message);
        recordAreaReadFallback(ref, message);
      } finally {
        stop();
        if (seq === requestSeq.current) setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, companyId]);

  const usingSupabase = enabled;
  const areas = usingSupabase ? remote ?? [] : localAreas;

  return useMemo<AreaDirectorySourceResult>(() => {
    if (usingSupabase) {
      perf.count("areas.directory.source.supabase");
      return { areas, source: "supabase", loading, error };
    }
    perf.count("areas.directory.source.local");
    return { areas, source: "local", loading, error };
  }, [usingSupabase, areas, loading, error]);
}

async function runShadowCompare(scope: string | undefined): Promise<void> {
  try {
    const report = await shadowReadAreas(scope ?? null);
    if (!report.ok) {
      recordAreaShadowDrift(report.notes.join("; ") || "area directory drift");
    }
  } catch {
    // observability-only
  }
}
