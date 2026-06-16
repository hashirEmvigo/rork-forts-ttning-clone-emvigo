import { useEffect, useMemo, useRef, useState } from "react";

import type { User } from "@/types";
import { isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import { listFullUsersFromSupabase } from "@/lib/data/supabaseUserRepository";
import { shadowReadUsers } from "@/lib/data/userMigration";
import {
  shouldReadUsersFromSupabase,
  recordUserSupabaseRead,
  recordUserReadFallback,
  recordUserShadowDrift,
} from "@/lib/data/userCutover";

/** Where the login directory the UI renders comes from. */
export type UserDirectorySourceKind = "local" | "supabase";

export interface UserDirectorySourceParams {
  /** The localStorage logins seeded synchronously at mount (fallback). */
  localUsers: User[];
  /** Active company scope for the Supabase read — `undefined` = unscoped (super admin). */
  companyId: string | null | undefined;
}

export interface UserDirectorySourceResult {
  /** Logins the UI should consume (Supabase when flag ON + healthy + non-empty). */
  users: User[];
  /** The source actually backing `users` right now. */
  source: UserDirectorySourceKind;
  /** True while the Supabase directory read is in flight (only when enabled). */
  loading: boolean;
  /** A non-fatal error message if the Supabase read failed (we fell back to local). */
  error: string | null;
}

/**
 * Resolves the SOURCE of the login directory (USER-2 / USER-4) — the Users
 * analogue of {@link import("./use-role-directory-source").useRoleDirectorySource}.
 * There is exactly one fetch per company scope, and it replaces the whole
 * in-memory array only on a healthy result.
 *
 * RLS scopes visibility: a company admin sees only their company's logins; a
 * super admin (unscoped) sees all logins incl. platform super-admin globals.
 *
 * Default (flag OFF): returns the caller-provided localStorage `localUsers`
 * unchanged — zero behaviour change, fully synchronous.
 *
 * Flag ON: reads the FULL (password-free) login records (losslessly
 * reconstructed from the `data` jsonb) from Supabase via
 * {@link listFullUsersFromSupabase}. The caller keeps the synchronous local seed
 * as the initial value (zero flash); this hook reconciles to Supabase ONLY on a
 * healthy result. Safety rules:
 *
 *   • Query error / throw → record the failure and render an empty directory.
 *   • Empty Supabase result → render an empty directory.
 *   • Browser-persistent local data is never used as fallback, seed, or revival
 *     data once the Supabase read path is enabled.
 *   • A superseded scope change (stale async result) is discarded via a request
 *     sequence guard so an older fetch can never overwrite a newer one.
 *
 * A background {@link shadowReadUsers} runs after each healthy serve and surfaces
 * any count / id / email / detail drift (observability only).
 *
 * Rollback is instant: flip the flag OFF.
 */
export function useUserDirectorySource(
  params: UserDirectorySourceParams,
): UserDirectorySourceResult {
  const { localUsers, companyId } = params;

  const enabled = shouldReadUsersFromSupabase() && isSupabaseConfigured;

  const [remoteUsers, setRemoteUsers] = useState<User[] | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Guards stale async results from overwriting a newer fetch (scope change).
  const requestSeq = useRef<number>(0);

  useEffect(() => {
    if (!enabled) {
      setRemoteUsers(null);
      setError(null);
      return;
    }

    const seq = ++requestSeq.current;
    const scope = companyId ?? undefined;
    const ref = companyId ?? "*";
    setLoading(true);

    void (async () => {
      const stop = perf.start("appUsers.directory.supabase");
      try {
        const fetched = await listFullUsersFromSupabase(scope);
        if (seq !== requestSeq.current) return; // superseded by a newer scope

        setRemoteUsers(fetched);
        setError(null);
        recordUserSupabaseRead();
        if (fetched.length > 0) void runShadowCompare(scope);
      } catch (err) {
        if (seq !== requestSeq.current) return;
        setRemoteUsers([]);
        const message =
          err instanceof Error ? err.message : "Supabase login directory read failed.";
        setError(message);
        recordUserReadFallback(ref, message);
      } finally {
        stop();
        if (seq === requestSeq.current) setLoading(false);
      }
    })();
    // localUsers intentionally omitted: browser-persistent local data is not a
    // source signal when Supabase reads are enabled.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, companyId]);

  const usingSupabase = enabled;
  const users = usingSupabase ? remoteUsers ?? [] : localUsers;

  return useMemo<UserDirectorySourceResult>(() => {
    if (usingSupabase) {
      perf.count("appUsers.directory.source.supabase");
      return { users, source: "supabase", loading, error };
    }
    perf.count("appUsers.directory.source.local");
    return { users, source: "local", loading, error };
  }, [usingSupabase, users, loading, error]);
}

/**
 * Runs the background shadow comparison after a healthy Supabase serve and
 * records any drift. Fire-and-forget: failures here never affect the served
 * directory.
 */
async function runShadowCompare(scope: string | undefined): Promise<void> {
  try {
    const report = await shadowReadUsers(scope ?? null);
    if (!report.ok) {
      recordUserShadowDrift(report.notes.join("; ") || "login directory drift");
    }
  } catch {
    // Shadow read is observability-only; swallow to never affect the UI.
  }
}
