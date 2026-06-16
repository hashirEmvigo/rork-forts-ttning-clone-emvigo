import { useMemo } from "react";
import { CheckCircle2, Circle, Globe, Lock, Pencil } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ChecklistTemplateAggregate } from "@/lib/data/supabaseChecklistTemplateRepository";
import {
  TEMPLATE_AUDIENCE_LABELS,
  type ChecklistItem,
  type ChecklistSection,
} from "@/types";

interface TemplatePreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Supabase aggregate to preview, or null when nothing is selected. */
  aggregate: ChecklistTemplateAggregate | null;
}

interface PreviewSection {
  section: ChecklistSection;
  items: ChecklistItem[];
}

/**
 * Read-only preview of a Supabase checklist-template aggregate. Empty or missing
 * aggregates remain unavailable; this preview never reads browser storage or
 * falls back to legacy checklist-template stores.
 */
export function TemplatePreviewDialog({
  open,
  onOpenChange,
  aggregate,
}: TemplatePreviewDialogProps) {
  const template = aggregate?.template ?? null;
  const isGlobal = template?.scope === "global" || template?.companyId === null;

  const sections = useMemo<PreviewSection[]>(() => {
    if (!open || !aggregate) return [];
    return aggregate.sections.map((section) => ({
      section,
      items: aggregate.items.filter((item) => item.sectionId === section.id),
    }));
  }, [open, aggregate]);

  const itemCount = useMemo(
    () => sections.reduce((sum, s) => sum + s.items.length, 0),
    [sections],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="min-w-0 truncate">{template?.name ?? "Template unavailable"}</span>
            {template ? (
              <span
                className={`inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                  isGlobal
                    ? "bg-muted text-muted-foreground"
                    : "bg-primary/10 text-primary"
                }`}
              >
                {isGlobal ? (
                  <>
                    <Lock className="h-2.5 w-2.5" /> Read only
                  </>
                ) : (
                  <>
                    <Pencil className="h-2.5 w-2.5" /> Company
                  </>
                )}
              </span>
            ) : null}
          </DialogTitle>
          <DialogDescription>
            {template?.description?.trim()
              ? template.description
              : template
                ? "Preview this Supabase template aggregate before creating a protocol."
                : "This template is unavailable in Supabase."}
          </DialogDescription>
        </DialogHeader>

        {template ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                {isGlobal ? (
                  <Globe className="h-3.5 w-3.5" />
                ) : (
                  <Pencil className="h-3.5 w-3.5" />
                )}
                {isGlobal ? "Global template" : "Company template"}
              </span>
              <span>
                <span className="font-medium text-foreground">Audience:</span>{" "}
                {template.audience
                  ? TEMPLATE_AUDIENCE_LABELS[template.audience]
                  : "General"}
              </span>
              <span>
                <span className="font-medium text-foreground">{sections.length}</span>{" "}
                sections
              </span>
              <span>
                <span className="font-medium text-foreground">{itemCount}</span> items
              </span>
              <span>
                <span className="font-medium text-foreground">
                  {template.categoryIds.length}
                </span>{" "}
                categories
              </span>
              <span>
                <span className="font-medium text-foreground">
                  {template.floorPresetIds.length}
                </span>{" "}
                floor presets
              </span>
            </div>

            <ScrollArea className="h-72 rounded-md border border-border">
              <div className="space-y-4 p-3">
                {sections.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    This Supabase template aggregate has no sections yet.
                  </p>
                ) : (
                  sections.map(({ section, items }) => (
                    <div key={section.id} className="space-y-1.5">
                      <p className="text-sm font-semibold">{section.title}</p>
                      {items.length === 0 ? (
                        <p className="pl-6 text-xs text-muted-foreground">
                          No items.
                        </p>
                      ) : (
                        <ul className="space-y-1">
                          {items.map((item) => (
                            <li
                              key={item.id}
                              className="flex items-start gap-2 text-sm"
                            >
                              {item.required ? (
                                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                              ) : (
                                <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              )}
                              <span className="min-w-0">
                                <span className="block">{item.title}</span>
                                {item.description ? (
                                  <span className="block text-xs text-muted-foreground">
                                    {item.description}
                                  </span>
                                ) : null}
                              </span>
                              {item.required ? (
                                <span className="ml-auto shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                                  Required
                                </span>
                              ) : (
                                <span className="ml-auto shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                                  Optional
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border bg-muted/40 px-4 py-8 text-center text-sm text-muted-foreground">
            Missing Supabase detail. No legacy template fallback is available.
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
