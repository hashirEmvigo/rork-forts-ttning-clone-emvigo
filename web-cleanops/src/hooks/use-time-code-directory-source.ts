import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import type { TimeCode } from "@/types";
import { isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import { listFullTimeCodesFromSupabase } from "@/lib/data/supabaseTimeCodeRepository";
import { shadowReadTimeCodes } from "@/lib/data/timeCodeMigration";
import {
  getTimeCodeDirectoryRefreshVersion,
  subscribeTimeCodeDirectoryRefresh,
} from "@/lib/data/timeCodeDirectoryRefresh";
import {
  shouldReadTimeCodesFromSupabase,
  recordTimeCodeSupabaseRead,
  recordTimeCodeReadFallback,
  recordTimeCodeShadowDrift,
} from "@/lib/data/timeCodeCutover";

/** Where the time-code directory the UI renders comes from. */
export type TimeCodeDirectorySourceKind = "local" | "supabase";

export interface TimeCodeDirectorySourceParams {
  /** The localStorage codes seeded synchronously at mount (fallback). */
  localTimeCodes: TimeCode[];
  /** Active company scope for the Supabase read — `undefined` = unscoped (super admin). */
  companyId: string | null | undefined;
}

export interface TimeCodeDirectorySourceResult {
  /** Codes the UI should consume (Supabase when flag ON + healthy + non-empty). */
  timeCodes: TimeCode[];
  /** The source actually backing `timeCodes` right now. */
  source: TimeCodeDirectorySourceKind;
  /** True while the Supabase directory read is in flight (only when enabled). */
  loading: boolean;
  /** A non-fatal error message if the Supabase read failed (we fell back to local). */
  error: string | null;
}

/**
 * Resolves the SOURCE of the time-code directory (TIMECODE-2 / TIMECODE-4) — the
 * Time Codes analogue of
 * {@link import("./use-role-directory-source").useRoleDirectorySource}. There is
 * exactly one fetch per company scope, and it replaces the whole in-memory array
 * only on a healthy result.
 *
 * The Supabase read returns the company's codes PLUS the shared GLOBAL master
 * library (companyId === null), mirroring the in-memory array's effective
 * contents, so per-view scope filtering keeps behaving identically.
 *
 * Default (flag OFF): returns the caller-provided localStorage `localTimeCodes`
 * unchanged — zero behaviour change, fully synchronous.
 *
 * Flag ON: reads the FULL code records (losslessly reconstructed from the `data`
 * jsonb) from Supabase via {@link listFullTimeCodesFromSupabase}. The caller
 * still passes the legacy local array for flag-off rollback only. When Supabase
 * reads are enabled, this hook serves Supabase results directly. Safety rules:
 *
 *   • Query error / throw → render empty/error and record a fallback event.
 *   • Empty Supabase result → render an empty directory.
 *   • A superseded scope change (stale async result) is discarded via a request
 *     sequence guard so an older fetch can never overwrite a newer one.
 *
 * A background {@link shadowReadTimeCodes} runs after each healthy serve and
 * surfaces any count / id / code / detail drift (observability only).
 *
 * Rollback is instant: flip the flag OFF.
 */
export function useTimeCodeDirectorySource(
  params: TimeCodeDirectorySourceParams,
): TimeCodeDirectorySourceResult {
  const { localTimeCodes, companyId } = params;

  const enabled = shouldReadTimeCodesFromSupabase() && isSupabaseConfigured;

  const [remoteTimeCodes, setRemoteTimeCodes] = useState<TimeCode[] | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Bumped by TIMECODE-5 authoritative mutations after a confirmed Supabase write
  // so the directory refetches and the UI reflects the true persisted state.
  const refreshVersion = useSyncExternalStore(
    subscribeTimeCodeDirectoryRefresh,
    getTimeCodeDirectoryRefreshVersion,
    getTimeCodeDirectoryRefreshVersion,
  );

  // Guards stale async results from overwriting a newer fetch (scope change).
  const requestSeq = useRef<number>(0);

  useEffect(() => {
    if (!enabled) {
      setRemoteTimeCodes(null);
      setError(null);
      return;
    }

    const seq = ++requestSeq.current;
    const scope = companyId ?? undefined;
    const ref = companyId ?? "*";
    setLoading(true);

    void (async () => {
      const stop = perf.start("timeCodes.directory.supabase");
      try {
        const fetched = await listFullTimeCodesFromSupabase(scope);
        if (seq !== requestSeq.current) return; // superseded by a newer scope

        setRemoteTimeCodes(fetched);
        setError(null);
        recordTimeCodeSupabaseRead();
        if (fetched.length > 0) void runShadowCompare(scope);
      } catch (err) {
        if (seq !== requestSeq.current) return;
        setRemoteTimeCodes([]);
        const message =
          err instanceof Error ? err.message : "Supabase time-code directory read failed.";
        setError(message);
        recordTimeCodeReadFallback(ref, message);
      } finally {
        stop();
        if (seq === requestSeq.current) setLoading(false);
      }
    })();
    // localTimeCodes intentionally omitted: browser-persistent local data is only
    // a flag-off rollback path, not a Supabase read fallback or fetch trigger.
    // refreshVersion IS a dependency: an authoritative write bump must refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, companyId, refreshVersion]);

  const usingSupabase = enabled;
  const timeCodes = usingSupabase ? remoteTimeCodes ?? [] : localTimeCodes;

  return useMemo<TimeCodeDirectorySourceResult>(() => {
    if (usingSupabase) {
      perf.count("timeCodes.directory.source.supabase");
      return { timeCodes, source: "supabase", loading, error };
    }
    perf.count("timeCodes.directory.source.local");
    return { timeCodes, source: "local", loading, error };
  }, [usingSupabase, timeCodes, loading, error]);
}

/**
 * Runs the background shadow comparison after a healthy Supabase serve and
 * records any drift. Fire-and-forget: failures here never affect the served
 * directory.
 */
async function runShadowCompare(scope: string | undefined): Promise<void> {
  try {
    const report = await shadowReadTimeCodes(scope ?? null);
    if (!report.ok) {
      recordTimeCodeShadowDrift(report.notes.join("; ") || "time-code directory drift");
    }
  } catch {
    // Shadow read is observability-only; swallow to never affect the UI.
  }
}
