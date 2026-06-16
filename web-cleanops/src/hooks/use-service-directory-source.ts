import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import type { Service } from "@/types";
import { isSupabaseConfigured } from "@/lib/supabase";
import { isSupabaseAuthEnabled } from "@/lib/authSupabase";
import { perf } from "@/lib/perf";
import { listFullServicesFromSupabase } from "@/lib/data/supabaseServiceRepository";
import { shadowReadServices } from "@/lib/data/serviceMigration";
import {
  shouldReadServicesFromSupabase,
  recordServiceSupabaseRead,
  recordServiceReadFallback,
  recordServiceUnsafeEmpty,
  recordServiceShadowDrift,
} from "@/lib/data/serviceCutover";
import {
  getServiceCatalogDirectoryRefreshVersion,
  subscribeServiceCatalogDirectoryRefresh,
} from "@/lib/data/serviceCatalogDirectoryRefresh";

/** Where the service directory the UI renders comes from. */
export type ServiceDirectorySourceKind = "local" | "supabase";

export interface ServiceDirectorySourceParams {
  /** The localStorage services seeded synchronously at mount (fallback). */
  localServices: Service[];
  /** Active company scope for the Supabase read — `undefined` = unscoped (super admin). */
  companyId: string | null | undefined;
  /**
   * Stable auth-readiness signal (`currentUser?.id ?? null`). When Supabase Auth
   * is enabled, the read is skipped until this is non-null so the fetch always
   * runs against an authenticated (RLS-correct) session, and a re-fetch is
   * triggered when it transitions `null → id` after login.
   */
  authNonce: string | null;
}

export interface ServiceDirectorySourceResult {
  /** Services the UI should consume (Supabase when flag ON + healthy + non-empty). */
  services: Service[];
  /** The source actually backing `services` right now. */
  source: ServiceDirectorySourceKind;
  /** True while the Supabase directory read is in flight (only when enabled). */
  loading: boolean;
  /** A non-fatal error message if the Supabase read failed (we fell back to local). */
  error: string | null;
}

/**
 * Resolves the SOURCE of the service directory (SVC-2 / SVC-4) — the Services
 * analogue of {@link import("./use-team-directory-source").useTeamDirectorySource}.
 * There is exactly one fetch per company scope, and it replaces the whole
 * in-memory array only on a healthy result.
 *
 * The Supabase read returns the company's services PLUS the shared GLOBAL
 * catalog (companyId === null), mirroring the in-memory array's effective
 * contents, so per-view scope filtering keeps behaving identically.
 *
 * Default (flag OFF): returns the caller-provided localStorage `localServices`
 * unchanged — zero behaviour change, fully synchronous.
 *
 * Flag ON: reads the FULL service records (losslessly reconstructed from the
 * `data` jsonb) from Supabase via {@link listFullServicesFromSupabase}. The
 * caller still passes the legacy local array as the synchronous fallback. Per
 * Framework v0.2 §8 the directory NEVER blanks: the local seed is served while
 * awaiting auth, on a read failure, and on an UNSAFE empty result (Supabase
 * returns 0 rows while localStorage has data). Only a healthy non-empty result —
 * or a SAFE empty (both empty) — replaces the in-memory array.
 *   • A superseded scope change (stale async result) is discarded via a request
 *     sequence guard so an older fetch can never overwrite a newer one.
 *
 * A background {@link shadowReadServices} runs after each healthy serve and
 * surfaces any count / id / name / detail drift (observability only).
 *
 * Rollback is instant: flip the flag OFF.
 */
export function useServiceDirectorySource(
  params: ServiceDirectorySourceParams,
): ServiceDirectorySourceResult {
  const { localServices, companyId, authNonce } = params;

  const enabled = shouldReadServicesFromSupabase() && isSupabaseConfigured;
  // When Supabase Auth is enabled, an unauthenticated pre-auth read can return
  // misleading empty results under RLS. Skip the fetch until auth is ready.
  const awaitingAuth = isSupabaseAuthEnabled && authNonce === null;

  const [remoteServices, setRemoteServices] = useState<Service[] | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const refreshVersion = useSyncExternalStore(
    subscribeServiceCatalogDirectoryRefresh,
    getServiceCatalogDirectoryRefreshVersion,
    getServiceCatalogDirectoryRefreshVersion,
  );

  // Guards stale async results from overwriting a newer fetch (scope change).
  const requestSeq = useRef<number>(0);

  useEffect(() => {
    if (!enabled || awaitingAuth) {
      setRemoteServices(null);
      setError(null);
      return;
    }

    const seq = ++requestSeq.current;
    const scope = companyId ?? undefined;
    const ref = companyId ?? "*";
    setLoading(true);

    void (async () => {
      const stop = perf.start("services.directory.supabase");
      try {
        const fetched = await listFullServicesFromSupabase(scope);
        if (seq !== requestSeq.current) return; // superseded by a newer scope

        if (fetched.length === 0 && localServices.length > 0) {
          // UNSAFE empty: never blank a populated directory — keep the local seed.
          setRemoteServices(null);
          setError(null);
          recordServiceUnsafeEmpty(ref);
        } else {
          setRemoteServices(fetched);
          setError(null);
          recordServiceSupabaseRead();
          if (fetched.length > 0) void runShadowCompare(scope);
        }
      } catch (err) {
        if (seq !== requestSeq.current) return;
        setRemoteServices(null);
        const message =
          err instanceof Error ? err.message : "Supabase service directory read failed.";
        setError(message);
        recordServiceReadFallback(ref, message);
      } finally {
        stop();
        if (seq === requestSeq.current) setLoading(false);
      }
    })();
    // localServices intentionally omitted: the seed is the fallback, not a fetch
    // trigger. Scope change and auth-readiness transitions refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, awaitingAuth, companyId, authNonce, refreshVersion]);

  // Serve Supabase only when enabled, auth-ready, AND a healthy result is held.
  // Otherwise (flag off, awaiting auth, read failure, unsafe empty) the local
  // seed is served so the directory never blanks.
  const usingSupabase = enabled && !awaitingAuth && remoteServices !== null;

  return useMemo<ServiceDirectorySourceResult>(() => {
    if (usingSupabase) {
      perf.count("services.directory.source.supabase");
      return { services: remoteServices, source: "supabase", loading, error };
    }
    perf.count("services.directory.source.local");
    return { services: localServices, source: "local", loading, error };
  }, [usingSupabase, remoteServices, localServices, loading, error]);
}

/**
 * Runs the background shadow comparison after a healthy Supabase serve and
 * records any drift. Fire-and-forget: failures here never affect the served
 * directory.
 */
async function runShadowCompare(scope: string | undefined): Promise<void> {
  try {
    const report = await shadowReadServices(scope ?? null);
    if (!report.ok) {
      recordServiceShadowDrift(report.notes.join("; ") || "service directory drift");
    }
  } catch {
    // Shadow read is observability-only; swallow to never affect the UI.
  }
}
