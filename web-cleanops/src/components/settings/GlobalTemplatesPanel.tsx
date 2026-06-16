import { useMemo, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  ChevronRight,
  FileStack,
  Info,
  ListChecks,
  Loader2,
  Pencil,
  Plus,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { GlobalTemplateBuilder } from "@/components/settings/GlobalTemplateBuilder";
import { useGlobalChecklistTemplateReadModel } from "@/hooks/use-checklist-template-read-model";
import { TEMPLATE_AUDIENCE_LABELS } from "@/types";

interface GlobalTemplatesPanelProps {
  /** When false the list is read-only (no add/edit/archive/restore). */
  canManage: boolean;
}

const DEFERRED_WRITE_MESSAGE =
  "Global template create, edit, archive and restore actions are temporarily disabled while Supabase writes are connected.";

/**
 * Super Admin management UI for the system-owned global template library.
 * Mirrors the company {@link TemplatesPanel} but operates strictly on the
 * global tier (`scope: "global"`, `companyId: null`). Edits only affect future
 * copies — existing company templates, customer protocols and protocol runs are
 * independent deep copies and never change.
 */
export function GlobalTemplatesPanel({ canManage }: GlobalTemplatesPanelProps) {
  const [showArchived, setShowArchived] = useState<boolean>(false);
  const [builderId, setBuilderId] = useState<string | null>(null);
  const { aggregates, active, archived, counts, isLoading, error } =
    useGlobalChecklistTemplateReadModel();

  const renderCounts = (templateId: string) => {
    const c = counts[templateId];
    if (!c) return null;
    return (
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <ListChecks className="h-3.5 w-3.5" /> {c.sections} sections
        </span>
        <span className="inline-flex items-center gap-1">
          <FileStack className="h-3.5 w-3.5" /> {c.items} items
        </span>
      </div>
    );
  };

  const builderAggregate = useMemo(
    () => aggregates.find((aggregate) => aggregate.template.id === builderId) ?? null,
    [aggregates, builderId],
  );

  if (builderAggregate) {
    return (
      <GlobalTemplateBuilder
        aggregate={builderAggregate}
        canManage={canManage}
        onBack={() => {
          setBuilderId(null);
        }}
      />
    );
  }

  return (
    <div className="space-y-5">
      {/* Active templates */}
      <div className="rounded-xl border border-border bg-background p-5">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <FileStack className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold">Active global templates</h3>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Best-practice templates companies start from. Edits here only
                  affect future copies — existing company templates and protocols
                  are untouched.
                </p>
              </div>
              {canManage ? (
                <Button className="shrink-0 gap-1.5" disabled title={DEFERRED_WRITE_MESSAGE}>
                  <Plus className="h-4 w-4" /> Add template
                </Button>
              ) : null}
            </div>

            {canManage ? (
              <p className="mt-3 rounded-md border border-dashed border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                {DEFERRED_WRITE_MESSAGE}
              </p>
            ) : null}

            {isLoading ? (
              <div className="mt-4 flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-4 py-5 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading global templates from Supabase…
              </div>
            ) : error ? (
              <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-5 text-sm text-destructive">
                Could not load global templates from Supabase.
              </div>
            ) : active.length === 0 ? (
              <div className="mt-4 rounded-lg border border-dashed border-border bg-muted/40 px-4 py-8 text-center">
                <p className="text-sm font-medium">No active global templates</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {canManage
                    ? "No global templates exist in Supabase yet. Add/create is deferred until writes are connected."
                    : "No global templates have been configured yet."}
                </p>
              </div>
            ) : (
              <ul className="mt-4 space-y-2">
                {active.map((template) => (
                  <li
                    key={template.id}
                    className="flex items-start gap-3 rounded-lg border border-border bg-card px-3 py-2.5"
                  >
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => setBuilderId(template.id)}
                      aria-label={`Open ${template.name}`}
                    >
                      <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                        <span className="truncate">{template.name}</span>
                        {template.audience ? (
                          <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                            {TEMPLATE_AUDIENCE_LABELS[template.audience]}
                          </span>
                        ) : null}
                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                      </p>
                      {template.description ? (
                        <p className="truncate text-xs text-muted-foreground">
                          {template.description}
                        </p>
                      ) : null}
                      {renderCounts(template.id)}
                    </button>
                    {canManage ? (
                      <div className="ml-auto flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-1.5"
                          onClick={() => setBuilderId(template.id)}
                        >
                          <ListChecks className="h-4 w-4" /> View content
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          disabled
                          title={DEFERRED_WRITE_MESSAGE}
                          aria-label={`Edit ${template.name}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          disabled
                          title={DEFERRED_WRITE_MESSAGE}
                          aria-label={`Archive ${template.name}`}
                        >
                          <Archive className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* Archived templates */}
      <div className="rounded-xl border border-border bg-muted/40 p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Switch
              id="global-template-show-archived"
              checked={showArchived}
              onCheckedChange={setShowArchived}
            />
            <Label
              htmlFor="global-template-show-archived"
              className="text-sm font-medium"
            >
              Show archived templates
            </Label>
          </div>
          {archived.length > 0 ? (
            <span className="text-xs text-muted-foreground tabular-nums">
              {archived.length} archived
            </span>
          ) : null}
        </div>

        {showArchived ? (
          archived.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">
              No archived global templates.
            </p>
          ) : (
            <ul className="mt-4 space-y-2">
              {archived.map((template) => (
                <li
                  key={template.id}
                  className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-muted-foreground">
                      {template.name}
                    </p>
                    {template.description ? (
                      <p className="truncate text-xs text-muted-foreground">
                        {template.description}
                      </p>
                    ) : null}
                  </div>
                  {canManage ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-auto gap-1.5"
                      disabled
                      title={DEFERRED_WRITE_MESSAGE}
                    >
                      <ArchiveRestore className="h-4 w-4" /> Restore
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )
        ) : null}
      </div>

      <div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          Global templates are system-owned. Companies copy them into their own
          editable templates — copying is a one-time deep copy, so later edits
          here never sync to existing copies. Archiving keeps a template out of
          active lists while preserving it.
        </p>
      </div>

    </div>
  );
}
