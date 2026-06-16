import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import type {
  ServiceGlobalEntitlement,
  CompanyServiceEntitlement,
  ServiceEntitlementLogEntry,
} from "@/types";
import { isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import {
  listGlobalEntitlementsFromSupabase,
  listCompanyEntitlementsFromSupabase,
  listEntitlementLogFromSupabase,
} from "@/lib/data/supabaseEntitlementRepository";
import { shadowReadEntitlements } from "@/lib/data/entitlementMigration";
import {
  getEntitlementDirectoryRefreshVersion,
  subscribeEntitlementDirectoryRefresh,
} from "@/lib/data/entitlementDirectoryRefresh";
import {
  shouldReadEntitlementsFromSupabase,
  recordEntitlementSupabaseRead,
  recordEntitlementReadFallback,
  recordEntitlementShadowDrift,
} from "@/lib/data/entitlementCutover";

export type EntitlementSourceKind = "local" | "supabase";

export interface EntitlementSourceParams {
  localGlobals: ServiceGlobalEntitlement[];
  localCompanies: CompanyServiceEntitlement[];
  localLog: ServiceEntitlementLogEntry[];
  companyId: string | null | undefined;
}

export interface EntitlementSourceResult {
  globals: ServiceGlobalEntitlement[];
  companies: CompanyServiceEntitlement[];
  log: ServiceEntitlementLogEntry[];
  source: EntitlementSourceKind;
  loading: boolean;
  error: string | null;
}

interface RemoteSnapshot {
  globals: ServiceGlobalEntitlement[];
  companies: CompanyServiceEntitlement[];
  log: ServiceEntitlementLogEntry[];
}

/**
 * Resolves the SOURCE of the entitlement stores (ENT) — the Entitlements
 * analogue of {@link import("./use-area-directory-source").useAreaDirectorySource}.
 * Default (flag OFF): returns the local stores unchanged. Flag ON: reconciles to
 * the Supabase snapshot (global readable to all, company scoped). Empty Supabase
 * results render empty entitlement state; browser-persistent local data is not a
 * fallback, seed, or revival layer.
 */
export function useEntitlementSource(
  params: EntitlementSourceParams,
): EntitlementSourceResult {
  const { localGlobals, localCompanies, localLog, companyId } = params;

  const enabled = shouldReadEntitlementsFromSupabase() && isSupabaseConfigured;

  const [remote, setRemote] = useState<RemoteSnapshot | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Bumped by the authoritative entitlement mutations after a confirmed Supabase
  // write so the source refetches and the UI reflects the true persisted state.
  const refreshVersion = useSyncExternalStore(
    subscribeEntitlementDirectoryRefresh,
    getEntitlementDirectoryRefreshVersion,
    getEntitlementDirectoryRefreshVersion,
  );

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
      const stop = perf.start("entitlements.source.supabase");
      try {
        const [globals, companies, log] = await Promise.all([
          listGlobalEntitlementsFromSupabase(),
          listCompanyEntitlementsFromSupabase(scope),
          listEntitlementLogFromSupabase(scope),
        ]);
        if (seq !== requestSeq.current) return;

        setRemote({ globals, companies, log });
        setError(null);
        recordEntitlementSupabaseRead();
        if (globals.length > 0 || companies.length > 0 || log.length > 0) {
          void runShadowCompare(scope);
        }
      } catch (err) {
        if (seq !== requestSeq.current) return;
        setRemote({ globals: [], companies: [], log: [] });
        const message =
          err instanceof Error ? err.message : "Supabase entitlement read failed.";
        setError(message);
        recordEntitlementReadFallback(ref, message);
      } finally {
        stop();
        if (seq === requestSeq.current) setLoading(false);
      }
    })();
    // refreshVersion IS a dependency: an authoritative entitlement write bumps it
    // so this hook refetches and the reconciled state reflects the persisted rows.
  }, [enabled, companyId, refreshVersion]);

  const usingSupabase = enabled;
  const globals = usingSupabase ? remote?.globals ?? [] : localGlobals;
  const companies = usingSupabase ? remote?.companies ?? [] : localCompanies;
  const log = usingSupabase ? remote?.log ?? [] : localLog;

  return useMemo<EntitlementSourceResult>(() => {
    if (usingSupabase) {
      perf.count("entitlements.source.supabase");
      return { globals, companies, log, source: "supabase", loading, error };
    }
    perf.count("entitlements.source.local");
    return { globals, companies, log, source: "local", loading, error };
  }, [usingSupabase, globals, companies, log, loading, error]);
}

async function runShadowCompare(scope: string | undefined): Promise<void> {
  try {
    const report = await shadowReadEntitlements(scope ?? null);
    if (!report.ok) {
      recordEntitlementShadowDrift(report.notes.join("; ") || "entitlement drift");
    }
  } catch {
    // observability-only
  }
}
