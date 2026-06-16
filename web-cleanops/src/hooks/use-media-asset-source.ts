import { useEffect, useMemo, useRef, useState } from "react";

import type { MediaAsset } from "@/types";
import { isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import { listFullMediaAssetsFromSupabase } from "@/lib/data/supabaseMediaAssetRepository";
import { shadowReadMediaAssets } from "@/lib/data/mediaAssetMigration";
import {
  shouldReadMediaAssetsFromSupabase,
  recordMediaAssetSupabaseRead,
  recordMediaAssetReadFallback,
  recordMediaAssetShadowDrift,
} from "@/lib/data/mediaAssetCutover";

export type MediaAssetSourceKind = "local" | "supabase";

export interface MediaAssetSourceParams {
  localAssets: MediaAsset[];
  companyId?: string | null;
}

export interface MediaAssetSourceResult {
  assets: MediaAsset[];
  source: MediaAssetSourceKind;
  loading: boolean;
  error: string | null;
}

/**
 * Resolves the SOURCE of the media-asset directory (MEDIA). Company-scoped.
 * Default (flag OFF): returns `localAssets` unchanged. Flag ON: serves the
 * Supabase result directly; empty reads render an empty directory and never fall
 * back to browser-persistent local data. Rollback = flag OFF.
 */
export function useMediaAssetSource(
  params: MediaAssetSourceParams,
): MediaAssetSourceResult {
  const { localAssets, companyId } = params;
  const scope = companyId ?? null;

  const enabled = shouldReadMediaAssetsFromSupabase() && isSupabaseConfigured;

  const [remote, setRemote] = useState<MediaAsset[] | null>(null);
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
      const stop = perf.start("mediaAssets.directory.supabase");
      try {
        const fetched = await listFullMediaAssetsFromSupabase(scope);
        if (seq !== requestSeq.current) return;

        setRemote(fetched);
        setError(null);
        recordMediaAssetSupabaseRead();
        if (fetched.length > 0) void runShadowCompare(scope);
      } catch (err) {
        if (seq !== requestSeq.current) return;
        setRemote([]);
        const message =
          err instanceof Error ? err.message : "Supabase media directory read failed.";
        setError(message);
        recordMediaAssetReadFallback(scope ?? "*", message);
      } finally {
        stop();
        if (seq === requestSeq.current) setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, scope]);

  const usingSupabase = enabled;
  const assets = usingSupabase ? remote ?? [] : localAssets;

  return useMemo<MediaAssetSourceResult>(() => {
    if (usingSupabase) {
      perf.count("mediaAssets.directory.source.supabase");
      return { assets, source: "supabase", loading, error };
    }
    perf.count("mediaAssets.directory.source.local");
    return { assets, source: "local", loading, error };
  }, [usingSupabase, assets, loading, error]);
}

async function runShadowCompare(companyId: string | null): Promise<void> {
  try {
    const report = await shadowReadMediaAssets(companyId);
    if (!report.ok) {
      recordMediaAssetShadowDrift(report.notes.join("; ") || "media directory drift");
    }
  } catch {
    // observability-only
  }
}
