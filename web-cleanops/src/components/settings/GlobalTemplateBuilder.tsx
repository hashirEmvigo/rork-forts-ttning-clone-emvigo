import { useMemo } from "react";
import { ArrowLeft, CheckCircle2, Circle, Info, ListChecks } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { ChecklistTemplateAggregate } from "@/lib/data/supabaseChecklistTemplateRepository";
import { TEMPLATE_AUDIENCE_LABELS, type ChecklistItem, type ChecklistSection } from "@/types";

interface GlobalTemplateBuilderProps {
  /** Supabase aggregate for the global template being viewed. */
  aggregate: ChecklistTemplateAggregate;
  /** Kept for caller compatibility; mutations are deferred during read-only cutover. */
  canManage: boolean;
  /** Returns to the global template list. */
  onBack: () => void;
}

interface SectionWithItems {
  section: ChecklistSection;
  items: ChecklistItem[];
}

const DEFERRED_WRITE_MESSAGE =
  "Global template content editing is temporarily disabled while Supabase writes are connected.";

/**
 * Read-only Supabase detail display for a global checklist template aggregate.
 * It never reads browser storage or calls the legacy checklist-template store.
 */
export function GlobalTemplateBuilder({
  aggregate,
  canManage,
  onBack,
}: GlobalTemplateBuilderProps) {
  void canManage;
  const { template } = aggregate;
  const sections = useMemo<SectionWithItems[]>(
    () =>
      aggregate.sections.map((section) => ({
        section,
        items: aggregate.items.filter((item) => item.sectionId === section.id),
      })),
    [aggregate],
  );
  const itemCount = useMemo(
    () => sections.reduce((sum, entry) => sum + entry.items.length, 0),
    [sections],
  );

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <button
            type="button"
            onClick={onBack}
            className="mb-1 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> All global templates
          </button>
          <div className="flex items-center gap-2">
            <h2 className="truncate text-lg font-semibold">{template.name}</h2>
            <span className="shrink-0 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
              Global
            </span>
            {template.audience ? (
              <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                {TEMPLATE_AUDIENCE_LABELS[template.audience]}
              </span>
            ) : null}
          </div>
          {template.description ? (
            <p className="mt-0.5 text-sm text-muted-foreground">{template.description}</p>
          ) : null}
          <p className="mt-1 text-xs text-muted-foreground">
            {sections.length} sections · {itemCount} items · {template.categoryIds.length} categories · {template.floorPresetIds.length} floor presets
          </p>
        </div>
        <Button disabled className="shrink-0 gap-1.5" title={DEFERRED_WRITE_MESSAGE}>
          <ListChecks className="h-4 w-4" /> Edit content
        </Button>
      </div>

      <div className="flex items-start gap-2.5 rounded-xl border border-dashed border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <p>{DEFERRED_WRITE_MESSAGE}</p>
      </div>

      {sections.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/40 px-4 py-12 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <ListChecks className="h-5 w-5" />
          </div>
          <p className="mt-3 text-sm font-medium">No sections in Supabase</p>
          <p className="mt-1 text-sm text-muted-foreground">
            This global template aggregate has no sections yet.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {sections.map(({ section, items }, sectionIndex) => (
            <div
              key={section.id}
              className="rounded-xl border border-border bg-background p-4"
            >
              <div className="flex items-center gap-2">
                <span className="flex h-7 min-w-[1.75rem] items-center justify-center rounded-full bg-primary/10 px-2 text-xs font-semibold tabular-nums text-primary">
                  {sectionIndex + 1}
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
                  {items.map((item) => (
                    <li
                      key={item.id}
                      className="flex items-start gap-3 rounded-lg border border-border bg-card px-3 py-2"
                    >
                      {item.required ? (
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      ) : (
                        <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-medium">{item.title}</p>
                          {item.required ? (
                            <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                              Required
                            </span>
                          ) : (
                            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                              Optional
                            </span>
                          )}
                        </div>
                        {item.description ? (
                          <p className="truncate text-xs text-muted-foreground">
                            {item.description}
                          </p>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
