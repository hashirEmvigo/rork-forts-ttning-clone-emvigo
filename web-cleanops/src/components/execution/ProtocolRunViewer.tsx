import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Ban,
  Check,
  ClipboardList,
  MinusCircle,
  SkipForward,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { SkipReasonDialog } from "@/components/execution/SkipReasonDialog";
import { useToast } from "@/hooks/use-toast";
import {
  resolveProtocolItems,
  resolveProtocolRun,
  resolveProtocolSections,
} from "@/lib/checklistSettingsResolver";
import { updateItemStatus } from "@/lib/protocolRunStore";
import { recomputeRunStatus } from "@/lib/runStatusRollup";
import type {
  ProtocolRunItem,
  ProtocolRunItemStatus,
  ProtocolRunSection,
  ProtocolRunStatus,
  ProtocolRunV2,
} from "@/types";

interface ProtocolRunViewerProps {
  /** Company that owns the run. */
  companyId: string;
  /** The run to view (re-resolved by id so header/badges stay fresh). */
  run: ProtocolRunV2;
  /** When true the user may change item statuses (checklists.execution.complete). */
  canComplete: boolean;
  /** Actor recorded as `completedBy` when an item is marked done. */
  actorId: string;
  /** Returns to the runs list. */
  onBack: () => void;
}

/** A run section together with its ordered items, derived from the resolver. */
interface SectionWithItems {
  section: ProtocolRunSection;
  items: ProtocolRunItem[];
}

const RUN_STATUS_META: Record<
  ProtocolRunStatus,
  { label: string; className: string }
> = {
  draft: {
    label: "Draft",
    className: "bg-muted text-muted-foreground",
  },
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

const ITEM_STATUS_META: Record<
  ProtocolRunItemStatus,
  { label: string; className: string }
> = {
  pending: { label: "Pending", className: "bg-muted text-muted-foreground" },
  done: {
    label: "Done",
    className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  },
  skipped: {
    label: "Skipped",
    className: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  },
  na: { label: "N/A", className: "bg-sky-500/15 text-sky-700 dark:text-sky-400" },
};

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * Execution viewer for a single {@link ProtocolRunV2} (Phase 3B, Tickets 26–27).
 *
 * Read path is the resolver only — the run, its sections and items are resolved
 * by id, never read from the store directly. Completion mutations go through the
 * {@link protocolRunStore} and then {@link recomputeRunStatus} so the run's
 * lifecycle status is rolled up in one place. When `canComplete` is false the
 * viewer is read-only (status badges only, no actions).
 */
export function ProtocolRunViewer({
  companyId,
  run: initialRun,
  canComplete,
  actorId,
  onBack,
}: ProtocolRunViewerProps) {
  const { toast } = useToast();
  const [run, setRun] = useState<ProtocolRunV2>(initialRun);
  const [sections, setSections] = useState<SectionWithItems[]>([]);
  const [skipTarget, setSkipTarget] = useState<ProtocolRunItem | null>(null);

  const reload = useCallback(() => {
    const fresh = resolveProtocolRun(companyId, initialRun.id);
    if (fresh) setRun(fresh);
    const list = resolveProtocolSections(companyId, initialRun.id).map(
      (section) => ({
        section,
        items: resolveProtocolItems(companyId, section.id),
      }),
    );
    setSections(list);
  }, [companyId, initialRun.id]);

  useEffect(() => {
    reload();
  }, [reload]);

  const progress = useMemo(() => {
    const all = sections.flatMap((s) => s.items);
    const resolved = all.filter((i) => i.status !== "pending").length;
    return { resolved, total: all.length };
  }, [sections]);

  /** Applies an item status change, then rolls up the run status. */
  const applyStatus = useCallback(
    (
      item: ProtocolRunItem,
      status: ProtocolRunItemStatus,
      skipReason?: string,
    ) => {
      // Toggling the active status back to pending acts as an undo.
      const next = item.status === status ? "pending" : status;
      updateItemStatus(companyId, run.id, item.id, next, {
        completedBy: next === "done" ? actorId : undefined,
        skipReason: next === "skipped" ? skipReason : undefined,
      });
      recomputeRunStatus(companyId, run.id);
      reload();
    },
    [companyId, run.id, actorId, reload],
  );

  const handleDone = (item: ProtocolRunItem) => applyStatus(item, "done");
  const handleNa = (item: ProtocolRunItem) => applyStatus(item, "na");
  const handleSkip = (item: ProtocolRunItem) => {
    // Toggling skip off needs no reason; turning it on requires one.
    if (item.status === "skipped") {
      applyStatus(item, "skipped");
      return;
    }
    setSkipTarget(item);
  };

  const confirmSkip = (reason: string) => {
    if (!skipTarget) return;
    applyStatus(skipTarget, "skipped", reason);
    toast({ title: "Item skipped" });
    setSkipTarget(null);
  };

  const runMeta = RUN_STATUS_META[run.status];

  return (
    <div className="space-y-5">
      <div className="min-w-0">
        <button
          type="button"
          onClick={onBack}
          className="mb-1 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> All runs
        </button>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="min-w-0 truncate text-lg font-semibold">
            {run.sourceCustomerProtocolName ?? run.sourceTemplateName}
          </h2>
          <span
            className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${runMeta.className}`}
          >
            {runMeta.label}
          </span>
        </div>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Generated {formatDateTime(run.generatedAt)}
          {run.completedAt ? ` · Completed ${formatDateTime(run.completedAt)}` : ""}
        </p>
        {progress.total > 0 ? (
          <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
            {progress.resolved} of {progress.total} items actioned
          </p>
        ) : null}
      </div>

      {sections.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/40 px-4 py-12 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <ClipboardList className="h-5 w-5" />
          </div>
          <p className="mt-3 text-sm font-medium">This run has no sections</p>
        </div>
      ) : (
        <div className="space-y-4">
          {sections.map(({ section, items }, sIndex) => (
            <div
              key={section.id}
              className="rounded-xl border border-border bg-background p-4"
            >
              <div className="flex items-center gap-2">
                <span className="flex h-7 min-w-[1.75rem] items-center justify-center rounded-full bg-primary/10 px-2 text-xs font-semibold tabular-nums text-primary">
                  {sIndex + 1}
                </span>
                <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">
                  {section.title}
                </h3>
              </div>

              {items.length === 0 ? (
                <p className="mt-3 rounded-lg border border-dashed border-border bg-muted/40 px-3 py-4 text-center text-sm text-muted-foreground">
                  No items in this section.
                </p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {items.map((item) => {
                    const itemMeta = ITEM_STATUS_META[item.status];
                    return (
                      <li
                        key={item.id}
                        className="rounded-lg border border-border bg-card px-3 py-2.5"
                      >
                        <div className="flex items-start gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="truncate text-sm font-medium">
                                {item.title}
                              </p>
                              {item.required ? (
                                <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                                  Required
                                </span>
                              ) : (
                                <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                  Optional
                                </span>
                              )}
                              <span
                                className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${itemMeta.className}`}
                              >
                                {itemMeta.label}
                              </span>
                            </div>
                            {item.description ? (
                              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                                {item.description}
                              </p>
                            ) : null}
                            {item.status === "done" && item.completedAt ? (
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                Completed {formatDateTime(item.completedAt)}
                              </p>
                            ) : null}
                            {item.status === "skipped" && item.skipReason ? (
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                Skipped — {item.skipReason}
                              </p>
                            ) : null}
                          </div>
                          {canComplete ? (
                            <div className="ml-auto flex shrink-0 items-center gap-1">
                              <Button
                                variant={item.status === "done" ? "default" : "outline"}
                                size="sm"
                                className="gap-1.5"
                                onClick={() => handleDone(item)}
                                aria-label={`Mark ${item.title} done`}
                                aria-pressed={item.status === "done"}
                              >
                                <Check className="h-4 w-4" /> Done
                              </Button>
                              <Button
                                variant={
                                  item.status === "skipped" ? "default" : "outline"
                                }
                                size="sm"
                                className="gap-1.5"
                                onClick={() => handleSkip(item)}
                                aria-label={`Skip ${item.title}`}
                                aria-pressed={item.status === "skipped"}
                              >
                                <SkipForward className="h-4 w-4" /> Skip
                              </Button>
                              <Button
                                variant={item.status === "na" ? "default" : "outline"}
                                size="sm"
                                className="gap-1.5"
                                onClick={() => handleNa(item)}
                                aria-label={`Mark ${item.title} not applicable`}
                                aria-pressed={item.status === "na"}
                              >
                                <MinusCircle className="h-4 w-4" /> N/A
                              </Button>
                            </div>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      {!canComplete ? (
        <div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          <Ban className="mt-0.5 h-4 w-4 shrink-0" />
          <p>You have view-only access to this run and cannot change item statuses.</p>
        </div>
      ) : null}

      <SkipReasonDialog
        open={Boolean(skipTarget)}
        onOpenChange={(open) => {
          if (!open) setSkipTarget(null);
        }}
        itemTitle={skipTarget?.title}
        onConfirm={confirmSkip}
      />
    </div>
  );
}
