import { useEffect, useMemo, useRef, useState } from "react";

import type { AuditEvent } from "@/types";
import { isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import { listActivityEventsFromSupabase } from "@/lib/data/supabaseActivityRepository";
import { shadowReadActivityEvents } from "@/lib/data/activityMigration";
import {
  shouldReadActivityFromSupabase,
  recordActivitySupabaseRead,
  recordActivityReadFallback,
  recordActivityShadowDrift,
} from "@/lib/data/activityCutover";

export type ActivitySourceKind = "local" | "supabase";

export interface ActivitySourceParams {
  localEvents: AuditEvent[];
  companyId: string | null | undefined;
}

export interface ActivitySourceResult {
  events: AuditEvent[];
  source: ActivitySourceKind;
  loading: boolean;
  error: string | null;
}

/**
 * Resolves the SOURCE of the Activity Log (ACTIVITY) — the Activity Log analogue
 * of {@link import("./use-area-directory-source").useAreaDirectorySource}.
 * Default (flag OFF): returns `localEvents` unchanged. Flag ON: serves the
 * Supabase result directly; empty reads render an empty activity log and never
 * fall back to browser-persistent local data. Rollback = flag OFF.
 *
 * NOTE: a super admin (companyId null/undefined) reads the unscoped trail; a
 * company user reads only their own company's events — matching the in-app
 * visibility rule.
 */
export function useActivitySource(params: ActivitySourceParams): ActivitySourceResult {
  const { localEvents, companyId } = params;

  const enabled = shouldReadActivityFromSupabase() && isSupabaseConfigured;

  const [remote, setRemote] = useState<AuditEvent[] | null>(null);
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
      const stop = perf.start("activity.directory.supabase");
      try {
        const fetched = await listActivityEventsFromSupabase(scope);
        if (seq !== requestSeq.current) return;

        setRemote(fetched);
        setError(null);
        recordActivitySupabaseRead();
        if (fetched.length > 0) void runShadowCompare(scope);
      } catch (err) {
        if (seq !== requestSeq.current) return;
        setRemote([]);
        const message =
          err instanceof Error ? err.message : "Supabase activity read failed.";
        setError(message);
        recordActivityReadFallback(ref, message);
      } finally {
        stop();
        if (seq === requestSeq.current) setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, companyId]);

  const usingSupabase = enabled;
  const events = usingSupabase ? remote ?? [] : localEvents;

  return useMemo<ActivitySourceResult>(() => {
    if (usingSupabase) {
      perf.count("activity.directory.source.supabase");
      return { events, source: "supabase", loading, error };
    }
    perf.count("activity.directory.source.local");
    return { events, source: "local", loading, error };
  }, [usingSupabase, events, loading, error]);
}

async function runShadowCompare(scope: string | undefined): Promise<void> {
  try {
    const report = await shadowReadActivityEvents(scope ?? null);
    if (!report.ok) {
      recordActivityShadowDrift(report.notes.join("; ") || "activity log drift");
    }
  } catch {
    // observability-only
  }
}
