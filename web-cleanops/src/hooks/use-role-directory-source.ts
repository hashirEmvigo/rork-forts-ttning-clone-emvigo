import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import type { Role } from "@/types";
import { isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import { listFullRolesFromSupabase } from "@/lib/data/supabaseRoleRepository";
import { shadowReadRoles } from "@/lib/data/roleMigration";
import {
  shouldReadRolesFromSupabase,
  recordRoleSupabaseRead,
  recordRoleReadFallback,
  recordRoleShadowDrift,
} from "@/lib/data/roleCutover";
import {
  getRoleDirectoryRefreshVersion,
  subscribeRoleDirectoryRefresh,
} from "@/lib/data/roleDirectoryRefresh";

/** Where the role directory the UI renders comes from. */
export type RoleDirectorySourceKind = "local" | "supabase";

export interface RoleDirectorySourceParams {
  /** The localStorage roles seeded synchronously at mount (fallback). */
  localRoles: Role[];
  /** Active company scope for the Supabase read — `undefined` = unscoped (super admin). */
  companyId: string | null | undefined;
}

export interface RoleDirectorySourceResult {
  /** Roles the UI should consume (Supabase when flag ON + healthy + non-empty). */
  roles: Role[];
  /** The source actually backing `roles` right now. */
  source: RoleDirectorySourceKind;
  /** True while the Supabase directory read is in flight (only when enabled). */
  loading: boolean;
  /** A non-fatal error message if the Supabase read failed (we fell back to local). */
  error: string | null;
}

/**
 * Resolves the SOURCE of the role directory (ROLE-2 / ROLE-4) — the Roles
 * analogue of {@link import("./use-service-directory-source").useServiceDirectorySource}.
 * There is exactly one fetch per company scope, and it replaces the whole
 * in-memory array only on a healthy result.
 *
 * The Supabase read returns the company's roles PLUS the shared GLOBAL templates
 * (companyId === null), mirroring the in-memory array's effective contents, so
 * per-view scope filtering keeps behaving identically.
 *
 * Default (flag OFF): returns the caller-provided localStorage `localRoles`
 * unchanged — zero behaviour change, fully synchronous.
 *
 * Flag ON: reads the FULL role records (losslessly reconstructed from the `data`
 * jsonb) from Supabase via {@link listFullRolesFromSupabase}. The caller keeps
 * the synchronous local seed as the initial value (zero flash); this hook
 * reconciles to Supabase ONLY on a healthy result. Safety rules:
 *
 *   • Query error / throw → record the failure and render an empty directory.
 *   • Empty Supabase result → render an empty directory.
 *   • Browser-persistent local data is never used as fallback, seed, or revival
 *     data once the Supabase read path is enabled.
 *   • A superseded scope change (stale async result) is discarded via a request
 *     sequence guard so an older fetch can never overwrite a newer one.
 *
 * A background {@link shadowReadRoles} runs after each healthy serve and surfaces
 * any count / id / name / detail drift (observability only).
 *
 * Rollback is instant: flip the flag OFF.
 */
export function useRoleDirectorySource(
  params: RoleDirectorySourceParams,
): RoleDirectorySourceResult {
  const { localRoles, companyId } = params;

  const enabled = shouldReadRolesFromSupabase() && isSupabaseConfigured;

  const [remoteRoles, setRemoteRoles] = useState<Role[] | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const refreshVersion = useSyncExternalStore(
    subscribeRoleDirectoryRefresh,
    getRoleDirectoryRefreshVersion,
    getRoleDirectoryRefreshVersion,
  );

  // Guards stale async results from overwriting a newer fetch (scope change).
  const requestSeq = useRef<number>(0);

  useEffect(() => {
    if (!enabled) {
      setRemoteRoles(null);
      setError(null);
      return;
    }

    const seq = ++requestSeq.current;
    const scope = companyId ?? undefined;
    const ref = companyId ?? "*";
    setLoading(true);

    void (async () => {
      const stop = perf.start("roles.directory.supabase");
      try {
        const fetched = await listFullRolesFromSupabase(scope);
        if (seq !== requestSeq.current) return; // superseded by a newer scope

        setRemoteRoles(fetched);
        setError(null);
        recordRoleSupabaseRead();
        if (fetched.length > 0) void runShadowCompare(scope);
      } catch (err) {
        if (seq !== requestSeq.current) return;
        setRemoteRoles([]);
        const message =
          err instanceof Error ? err.message : "Supabase role directory read failed.";
        setError(message);
        recordRoleReadFallback(ref, message);
      } finally {
        stop();
        if (seq === requestSeq.current) setLoading(false);
      }
    })();
    // localRoles intentionally omitted: browser-persistent local data is not a
    // source signal when Supabase reads are enabled.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, companyId, refreshVersion]);

  const usingSupabase = enabled;
  const roles = usingSupabase ? remoteRoles ?? [] : localRoles;

  return useMemo<RoleDirectorySourceResult>(() => {
    if (usingSupabase) {
      perf.count("roles.directory.source.supabase");
      return { roles, source: "supabase", loading, error };
    }
    perf.count("roles.directory.source.local");
    return { roles, source: "local", loading, error };
  }, [usingSupabase, roles, loading, error]);
}

/**
 * Runs the background shadow comparison after a healthy Supabase serve and
 * records any drift. Fire-and-forget: failures here never affect the served
 * directory.
 */
async function runShadowCompare(scope: string | undefined): Promise<void> {
  try {
    const report = await shadowReadRoles(scope ?? null);
    if (!report.ok) {
      recordRoleShadowDrift(report.notes.join("; ") || "role directory drift");
    }
  } catch {
    // Shadow read is observability-only; swallow to never affect the UI.
  }
}
