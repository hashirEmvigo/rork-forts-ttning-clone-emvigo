import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronRight, ClipboardList, Info } from "lucide-react";

import { ProtocolRunViewer } from "@/components/execution/ProtocolRunViewer";
import { resolveProtocolRuns } from "@/lib/checklistSettingsResolver";
import { perf } from "@/lib/perf";
import type { ProtocolRunStatus, ProtocolRunV2 } from "@/types";

interface ProtocolRunsPanelProps {
  /** Company whose protocol runs are listed. */
  companyId: string;
  /** When true the user may change item statuses (checklists.execution.complete). */
  canComplete: boolean;
  /** Actor recorded as `completedBy` when completing items. */
  actorId: string;
}

const RUN_STATUS_META: Record<
  ProtocolRunStatus,
  { label: string; className: string }
> = {
  draft: { label: "Draft", className: "bg-muted text-muted-foreground" },
  in_progress: {
    label: "In progress",
    className: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  },
  completed: {
    label: "Completed",
    className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  },
  cancelled: {
    label: "Cancelled",
    className: "bg-destructive/10 text-destructive",
  },
};

/** Display name for a run: the customer protocol name when present, else the template name. */
function runDisplayName(run: ProtocolRunV2): string {
  return run.sourceCustomerProtocolName ?? run.sourceTemplateName;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, { dateStyle: "medium" });
}

/**
 * Lists a company's generated protocol runs and opens the {@link ProtocolRunViewer}
 * for a selected run (Phase 3B). Runs are read through the resolver only. Runs are
 * not generated here — that belongs to a later booking/work-order integration
 * phase — so an empty list is expected until runs exist.
 */
export function ProtocolRunsPanel({
  companyId,
  canComplete,
  actorId,
}: ProtocolRunsPanelProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [runs, setRuns] = useState<ProtocolRunV2[]>([]);
  const [openRunId, setOpenRunId] = useState<string | null>(null);

  // Dev-only render accounting (no-op in production).
  perf.count("ProtocolRuns.render");

  const reload = useCallback(() => {
    // Time the per-company run resolve — a future scaling hot-spot as protocol
    // runs accumulate per company (see operational monitoring registry).
    setRuns(perf.measure("protocolRuns.resolve", () => resolveProtocolRuns(companyId)));
  }, [companyId]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Deep-link support: `/protocol-runs?run=<id>` opens that run directly (used by
  // the AO "Open run" action). Consumed once so navigating back clears it.
  useEffect(() => {
    const deepLinkId = searchParams.get("run");
    if (deepLinkId) {
      setOpenRunId(deepLinkId);
      const next = new URLSearchParams(searchParams);
      next.delete("run");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const openRun = useMemo(
    () => runs.find((r) => r.id === openRunId) ?? null,
    [runs, openRunId],
  );

  if (openRun) {
    return (
      <ProtocolRunViewer
        companyId={companyId}
        run={openRun}
        canComplete={canComplete}
        actorId={actorId}
        onBack={() => {
          setOpenRunId(null);
          reload();
        }}
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-border bg-background p-5">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <ClipboardList className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold">Protocol runs</h3>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Checklist protocols generated from templates. Open a run to view its
              sections and complete items.
            </p>

            {runs.length === 0 ? (
              <div className="mt-4 rounded-lg border border-dashed border-border bg-muted/40 px-4 py-8 text-center">
                <p className="text-sm font-medium">No protocol runs yet</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Runs appear here once they are generated from a checklist template.
                </p>
              </div>
            ) : (
              <ul className="mt-4 space-y-2">
                {runs.map((run) => {
                  const meta = RUN_STATUS_META[run.status];
                  return (
                    <li key={run.id}>
                      <button
                        type="button"
                        className="flex w-full items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-left transition-colors hover:bg-accent"
                        onClick={() => setOpenRunId(run.id)}
                        aria-label={`Open ${runDisplayName(run)}`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate text-sm font-medium">
                              {runDisplayName(run)}
                            </p>
                            <span
                              className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${meta.className}`}
                            >
                              {meta.label}
                            </span>
                          </div>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            Generated {formatDate(run.generatedAt)}
                          </p>
                        </div>
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          Runs are immutable snapshots of a template taken at generation time —
          later template edits never change an existing run.
        </p>
      </div>
    </div>
  );
}
