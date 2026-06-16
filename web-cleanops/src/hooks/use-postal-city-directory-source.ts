import { useEffect, useMemo, useRef, useState } from "react";

import type { PostalCity } from "@/types";
import { isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import { listFullPostalCitiesFromSupabase } from "@/lib/data/supabasePostalCityRepository";
import { shadowReadPostalCities } from "@/lib/data/postalCityMigration";
import {
  shouldReadPostalCitiesFromSupabase,
  recordPostalCitySupabaseRead,
  recordPostalCityReadFallback,
  recordPostalCityShadowDrift,
} from "@/lib/data/postalCityCutover";

export type PostalCityDirectorySourceKind = "local" | "supabase";

export interface PostalCityDirectorySourceParams {
  localCities: PostalCity[];
  companyId: string | null | undefined;
}

export interface PostalCityDirectorySourceResult {
  cities: PostalCity[];
  source: PostalCityDirectorySourceKind;
  loading: boolean;
  error: string | null;
}

/**
 * Resolves the SOURCE of the postal-city directory (AREA) — the Postal Cities
 * analogue of {@link import("./use-area-directory-source").useAreaDirectorySource}.
 * Default (flag OFF): returns `localCities` unchanged. Flag ON: reconciles to a
 * Supabase result directly. Empty reads render an empty directory and never
 * fall back to browser-persistent local data. Rollback = flag OFF.
 */
export function usePostalCityDirectorySource(
  params: PostalCityDirectorySourceParams,
): PostalCityDirectorySourceResult {
  const { localCities, companyId } = params;

  const enabled = shouldReadPostalCitiesFromSupabase() && isSupabaseConfigured;

  const [remote, setRemote] = useState<PostalCity[] | null>(null);
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
      const stop = perf.start("postalCities.directory.supabase");
      try {
        const fetched = await listFullPostalCitiesFromSupabase(scope);
        if (seq !== requestSeq.current) return;

        setRemote(fetched);
        setError(null);
        recordPostalCitySupabaseRead();
        if (fetched.length > 0) void runShadowCompare(scope);
      } catch (err) {
        if (seq !== requestSeq.current) return;
        setRemote([]);
        const message =
          err instanceof Error ? err.message : "Supabase postal city directory read failed.";
        setError(message);
        recordPostalCityReadFallback(ref, message);
      } finally {
        stop();
        if (seq === requestSeq.current) setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, companyId]);

  const usingSupabase = enabled;
  const cities = usingSupabase ? remote ?? [] : localCities;

  return useMemo<PostalCityDirectorySourceResult>(() => {
    if (usingSupabase) {
      perf.count("postalCities.directory.source.supabase");
      return { cities, source: "supabase", loading, error };
    }
    perf.count("postalCities.directory.source.local");
    return { cities, source: "local", loading, error };
  }, [usingSupabase, cities, loading, error]);
}

async function runShadowCompare(scope: string | undefined): Promise<void> {
  try {
    const report = await shadowReadPostalCities(scope ?? null);
    if (!report.ok) {
      recordPostalCityShadowDrift(report.notes.join("; ") || "postal city directory drift");
    }
  } catch {
    // observability-only
  }
}
