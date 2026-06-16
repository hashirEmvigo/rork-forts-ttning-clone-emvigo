import { useEffect, useMemo, useRef, useState } from "react";

import type { VisitOccurrence } from "@/types";
import { isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import { listFullVisitOccurrencesFromSupabase } from "@/lib/data/supabaseVisitOccurrenceRepository";
import { shadowReadVisitOccurrences } from "@/lib/data/visitOccurrenceMigration";
import {
  shouldReadVisitOccurrencesFromSupabase,
  recordVisitOccurrenceSupabaseRead,
  recordVisitOccurrenceReadFallback,
  recordVisitOccurrenceShadowDrift,
} from "@/lib/data/visitOccurrenceCutover";

export type VisitOccurrenceSourceKind = "local" | "supabase";

export interface VisitOccurrenceSourceParams {
  localOccurrences: VisitOccurrence[];
  companyId: string | null | undefined;
}

export interface VisitOccurrenceSourceResult {
  occurrences: VisitOccurrence[];
  source: VisitOccurrenceSourceKind;
  loading: boolean;
  error: string | null;
}

/**
 * Resolves the SOURCE of the visit-occurrence list (MISSION) — the Missions
 * analogue of {@link import("./use-area-directory-source").useAreaDirectorySource}.
 * Default (flag OFF): returns `localOccurrences` unchanged. Flag ON: serves the
 * Supabase result directly; empty reads render an empty occurrence list and never
 * fall back to browser-persistent local data. Rollback = flag OFF.
 */
export function useVisitOccurrenceSource(
  params: VisitOccurrenceSourceParams,
): VisitOccurrenceSourceResult {
  const { localOccurrences, companyId } = params;

  const enabled = shouldReadVisitOccurrencesFromSupabase() && isSupabaseConfigured;

  const [remote, setRemote] = useState<VisitOccurrence[] | null>(null);
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
      const stop = perf.start("visitOccurrences.source.supabase");
      try {
        const fetched = await listFullVisitOccurrencesFromSupabase(scope);
        if (seq !== requestSeq.current) return;

        setRemote(fetched);
        setError(null);
        recordVisitOccurrenceSupabaseRead();
        if (fetched.length > 0) void runShadowCompare(scope);
      } catch (err) {
        if (seq !== requestSeq.current) return;
        setRemote([]);
        const message =
          err instanceof Error ? err.message : "Supabase occurrence read failed.";
        setError(message);
        recordVisitOccurrenceReadFallback(ref, message);
      } finally {
        stop();
        if (seq === requestSeq.current) setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, companyId]);

  const usingSupabase = enabled;
  const occurrences = usingSupabase ? remote ?? [] : localOccurrences;

  return useMemo<VisitOccurrenceSourceResult>(() => {
    if (usingSupabase) {
      perf.count("visitOccurrences.source.supabase");
      return { occurrences, source: "supabase", loading, error };
    }
    perf.count("visitOccurrences.source.local");
    return { occurrences, source: "local", loading, error };
  }, [usingSupabase, occurrences, loading, error]);
}

async function runShadowCompare(scope: string | undefined): Promise<void> {
  try {
    const report = await shadowReadVisitOccurrences(scope ?? null);
    if (!report.ok) {
      recordVisitOccurrenceShadowDrift(report.notes.join("; ") || "occurrence drift");
    }
  } catch {
    // observability-only
  }
}
