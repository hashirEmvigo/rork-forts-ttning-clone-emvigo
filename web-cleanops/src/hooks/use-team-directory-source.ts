import { useEffect, useMemo, useRef, useState } from "react";

import type { Team } from "@/types";
import { isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import { listFullTeamsFromSupabase } from "@/lib/data/supabaseTeamRepository";
import { shadowReadTeams } from "@/lib/data/teamMigration";
import {
  shouldReadTeamsFromSupabase,
  recordTeamSupabaseRead,
  recordTeamReadFallback,
  recordTeamUnsafeEmpty,
  recordTeamShadowDrift,
} from "@/lib/data/teamCutover";

/** Where the team directory the UI renders comes from. */
export type TeamDirectorySourceKind = "local" | "supabase";

export interface TeamDirectorySourceParams {
  /** The localStorage teams used only when the Supabase read flag is off. */
  localTeams: Team[];
  /** Active company scope for the Supabase read — `undefined` = unscoped (super admin). */
  companyId: string | null | undefined;
}

export interface TeamDirectorySourceResult {
  /** Teams the UI should consume. */
  teams: Team[];
  /** The source actually backing `teams` right now. */
  source: TeamDirectorySourceKind;
  /** True while the Supabase directory read is in flight (only when enabled). */
  loading: boolean;
  /** A non-fatal error message if the Supabase read failed. */
  error: string | null;
}

/**
 * Resolves the SOURCE of the team directory (TEAM-2 / TEAM-4).
 *
 * Default (flag OFF): returns the caller-provided local array unchanged. Flag
 * ON: reads the FULL team records from Supabase. Per TEAM-2 safety the directory
 * NEVER blanks — the local seed is served on a read failure and on an UNSAFE
 * empty result (Supabase returns 0 rows while localStorage has data). Only a
 * healthy non-empty result — or a SAFE empty (both empty) — replaces the array.
 */
export function useTeamDirectorySource(
  params: TeamDirectorySourceParams,
): TeamDirectorySourceResult {
  const { localTeams, companyId } = params;

  const enabled = shouldReadTeamsFromSupabase() && isSupabaseConfigured;

  const [remoteTeams, setRemoteTeams] = useState<Team[] | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Guards stale async results from overwriting a newer fetch (scope change).
  const requestSeq = useRef<number>(0);

  useEffect(() => {
    if (!enabled) {
      setRemoteTeams(null);
      setError(null);
      return;
    }

    const seq = ++requestSeq.current;
    const scope = companyId ?? undefined;
    const ref = companyId ?? "*";
    setLoading(true);

    void (async () => {
      const stop = perf.start("teams.directory.supabase");
      try {
        const fetched = await listFullTeamsFromSupabase(scope);
        if (seq !== requestSeq.current) return;

        if (fetched.length === 0 && localTeams.length > 0) {
          // UNSAFE empty: never blank a populated directory — keep the local seed.
          setRemoteTeams(null);
          setError(null);
          recordTeamUnsafeEmpty(ref);
        } else {
          setRemoteTeams(fetched);
          setError(null);
          recordTeamSupabaseRead();
          if (fetched.length > 0) void runShadowCompare(scope);
        }
      } catch (err) {
        if (seq !== requestSeq.current) return;
        setRemoteTeams(null);
        const message = err instanceof Error ? err.message : "Supabase team directory read failed.";
        setError(message);
        recordTeamReadFallback(ref, message);
      } finally {
        stop();
        if (seq === requestSeq.current) setLoading(false);
      }
    })();
    // localTeams intentionally omitted: browser-persistent local data is only a
    // flag-off rollback path, not a Supabase read fallback or fetch trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, companyId]);

  // Serve Supabase only when enabled AND a healthy result is held. Otherwise
  // (flag off, read failure, unsafe empty) the local seed is served so the
  // directory never blanks.
  const usingSupabase = enabled && remoteTeams !== null;
  const teams = usingSupabase ? remoteTeams : localTeams;

  return useMemo<TeamDirectorySourceResult>(() => {
    if (usingSupabase) {
      perf.count("teams.directory.source.supabase");
      return { teams, source: "supabase", loading, error };
    }
    perf.count("teams.directory.source.local");
    return { teams, source: "local", loading, error };
  }, [usingSupabase, teams, loading, error]);
}

async function runShadowCompare(scope: string | undefined): Promise<void> {
  try {
    const report = await shadowReadTeams(scope ?? null);
    if (!report.ok) {
      recordTeamShadowDrift(report.notes.join("; ") || "team directory drift");
    }
  } catch {
    // Shadow read is observability-only; swallow to never affect the UI.
  }
}
