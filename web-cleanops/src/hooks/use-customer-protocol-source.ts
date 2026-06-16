import { useEffect, useMemo, useRef, useState } from "react";

import { isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import {
  listFullCustomerProtocolsFromSupabase,
  type CustomerProtocolAggregate,
} from "@/lib/data/supabaseCustomerProtocolRepository";
import { shadowReadCustomerProtocols } from "@/lib/data/customerProtocolMigration";
import {
  shouldReadCustomerProtocolsFromSupabase,
  recordCustomerProtocolSupabaseRead,
  recordCustomerProtocolReadFallback,
  recordCustomerProtocolShadowDrift,
} from "@/lib/data/customerProtocolCutover";

export type CustomerProtocolSourceKind = "local" | "supabase";

export interface CustomerProtocolSourceParams {
  localAggregates: CustomerProtocolAggregate[];
  companyId?: string | null;
}

export interface CustomerProtocolSourceResult {
  aggregates: CustomerProtocolAggregate[];
  source: CustomerProtocolSourceKind;
  loading: boolean;
  error: string | null;
}

/**
 * Resolves the SOURCE of the customer-protocol directory (PROT). Company-scoped.
 * Default (flag OFF): returns `localAggregates` unchanged. Flag ON: serves the
 * Supabase result directly; empty reads render an empty directory and never fall
 * back to browser-persistent local data. Rollback = OFF.
 */
export function useCustomerProtocolSource(
  params: CustomerProtocolSourceParams,
): CustomerProtocolSourceResult {
  const { localAggregates, companyId } = params;
  const scope = companyId ?? null;

  const enabled = shouldReadCustomerProtocolsFromSupabase() && isSupabaseConfigured;

  const [remote, setRemote] = useState<CustomerProtocolAggregate[] | null>(null);
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
      const stop = perf.start("customerProtocols.directory.supabase");
      try {
        const fetched = await listFullCustomerProtocolsFromSupabase(scope);
        if (seq !== requestSeq.current) return;

        setRemote(fetched);
        setError(null);
        recordCustomerProtocolSupabaseRead();
        if (fetched.length > 0) void runShadowCompare(scope);
      } catch (err) {
        if (seq !== requestSeq.current) return;
        setRemote([]);
        const message =
          err instanceof Error ? err.message : "Supabase protocol directory read failed.";
        setError(message);
        recordCustomerProtocolReadFallback(scope ?? "*", message);
      } finally {
        stop();
        if (seq === requestSeq.current) setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, scope]);

  const usingSupabase = enabled;
  const aggregates = usingSupabase ? remote ?? [] : localAggregates;

  return useMemo<CustomerProtocolSourceResult>(() => {
    if (usingSupabase) {
      perf.count("customerProtocols.directory.source.supabase");
      return { aggregates, source: "supabase", loading, error };
    }
    perf.count("customerProtocols.directory.source.local");
    return { aggregates, source: "local", loading, error };
  }, [usingSupabase, aggregates, loading, error]);
}

async function runShadowCompare(companyId: string | null): Promise<void> {
  try {
    const report = await shadowReadCustomerProtocols(companyId);
    if (!report.ok) {
      recordCustomerProtocolShadowDrift(report.notes.join("; ") || "protocol directory drift");
    }
  } catch {
    // observability-only
  }
}
