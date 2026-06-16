import { useEffect, useMemo, useRef, useState } from "react";

import { isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import {
  listFullChecklistTemplatesFromSupabase,
  type ChecklistTemplateAggregate,
} from "@/lib/data/supabaseChecklistTemplateRepository";
import { shadowReadChecklistTemplates } from "@/lib/data/checklistTemplateMigration";
import {
  shouldReadChecklistTemplatesFromSupabase,
  recordChecklistTemplateSupabaseRead,
  recordChecklistTemplateReadFallback,
  recordChecklistTemplateShadowDrift,
} from "@/lib/data/checklistTemplateCutover";

export type ChecklistTemplateSourceKind = "local" | "supabase";

export interface ChecklistTemplateSourceParams {
  localAggregates: ChecklistTemplateAggregate[];
  companyId?: string | null;
}

export interface ChecklistTemplateSourceResult {
  aggregates: ChecklistTemplateAggregate[];
  source: ChecklistTemplateSourceKind;
  loading: boolean;
  error: string | null;
}

/**
 * Resolves the SOURCE of the checklist-template directory (CHK). A company scope
 * returns that company's templates PLUS the shared global library. Default (flag
 * OFF): returns `localAggregates` unchanged. Flag ON: serves the Supabase
 * result directly; empty reads render an empty directory and never fall back to
 * browser-persistent local data. Rollback = flag OFF.
 */
export function useChecklistTemplateSource(
  params: ChecklistTemplateSourceParams,
): ChecklistTemplateSourceResult {
  const { localAggregates, companyId } = params;
  const scope = companyId ?? null;

  const enabled = shouldReadChecklistTemplatesFromSupabase() && isSupabaseConfigured;

  const [remote, setRemote] = useState<ChecklistTemplateAggregate[] | null>(null);
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
      const stop = perf.start("checklistTemplates.directory.supabase");
      try {
        const fetched = await listFullChecklistTemplatesFromSupabase(scope);
        if (seq !== requestSeq.current) return;

        setRemote(fetched);
        setError(null);
        recordChecklistTemplateSupabaseRead();
        if (fetched.length > 0) void runShadowCompare(scope);
      } catch (err) {
        if (seq !== requestSeq.current) return;
        setRemote([]);
        const message =
          err instanceof Error ? err.message : "Supabase checklist directory read failed.";
        setError(message);
        recordChecklistTemplateReadFallback(scope ?? "*", message);
      } finally {
        stop();
        if (seq === requestSeq.current) setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, scope]);

  const usingSupabase = enabled;
  const aggregates = usingSupabase ? remote ?? [] : localAggregates;

  return useMemo<ChecklistTemplateSourceResult>(() => {
    if (usingSupabase) {
      perf.count("checklistTemplates.directory.source.supabase");
      return { aggregates, source: "supabase", loading, error };
    }
    perf.count("checklistTemplates.directory.source.local");
    return { aggregates, source: "local", loading, error };
  }, [usingSupabase, aggregates, loading, error]);
}

async function runShadowCompare(companyId: string | null): Promise<void> {
  try {
    const report = await shadowReadChecklistTemplates(companyId);
    if (!report.ok) {
      recordChecklistTemplateShadowDrift(report.notes.join("; ") || "checklist directory drift");
    }
  } catch {
    // observability-only
  }
}
