import { useEffect, useMemo, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  Globe,
  Lock,
  Pencil,
  Sparkles,
} from "lucide-react";
import { useChecklistTemplateReadModel } from "@/hooks/use-checklist-template-read-model";
import { partitionByRecommendation } from "@/lib/templateRecommendations";
import { TemplatePreviewDialog } from "@/components/customer/TemplatePreviewDialog";
import type { ChecklistTemplateAggregate } from "@/lib/data/supabaseChecklistTemplateRepository";
import {
  TEMPLATE_AUDIENCE_LABELS,
  type ChecklistTemplateV2,
  type CustomerSegment,
} from "@/types";

export interface CustomerProtocolCreateSubmit {
  mode: "create";
  templateId: string;
  name: string;
  description?: string;
}

export interface CustomerProtocolEditSubmit {
  mode: "edit";
  name: string;
  description?: string;
}

export type CustomerProtocolDialogSubmit =
  | CustomerProtocolCreateSubmit
  | CustomerProtocolEditSubmit;

/** A template paired with its ownership tier, for the picker rows. */
interface PickerTemplate {
  template: ChecklistTemplateV2;
  scope: "global" | "company";
}

interface CustomerProtocolDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Company whose company-level templates are available to create from. */
  companyId: string;
  /**
   * Customer segment used to surface recommended templates first. When unset no
   * recommendation group is shown.
   */
  customerSegment?: CustomerSegment;
  /**
   * Pass a protocol to edit its metadata; omit to create a new one from a
   * global or company template.
   */
  protocol?: { name: string; description?: string } | null;
  /**
   * Persists the metadata. Returns an error message on failure (e.g. a
   * duplicate name) so the dialog can surface it inline and stay open, or null
   * on success.
   */
  onSubmit: (input: CustomerProtocolDialogSubmit) => string | null;
  /**
   * Copies a read-only global template into the company's editable templates.
   * When provided, global rows show a "Copy to Company" action. Returns an
   * error message on failure, or null on success.
   */
  onCopyGlobalToCompany?: (globalTemplateId: string) => string | null;
}

/**
 * Create a customer protocol from a global or company {@link ChecklistTemplateV2},
 * or edit an existing protocol's metadata (name + description).
 *
 * In create mode the picker groups templates into collapsible sections —
 * Recommended (driven by the customer's segment), Global and Company — so admins
 * avoid long flat lists and find the right template fast. Every row supports a
 * read-only Preview, and choosing a template prefills the name. The chosen
 * template's structure is deep-copied by the generator on submit.
 */
export function CustomerProtocolDialog({
  open,
  onOpenChange,
  companyId,
  customerSegment,
  protocol,
  onSubmit,
  onCopyGlobalToCompany,
}: CustomerProtocolDialogProps) {
  void onSubmit;
  const isEdit = Boolean(protocol);
  const [templateId, setTemplateId] = useState<string>("");
  const [name, setName] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  /** Template currently being previewed (read-only), or null. */
  const [previewAggregate, setPreviewAggregate] =
    useState<ChecklistTemplateAggregate | null>(null);
  /** Per-group collapse state. */
  const [openGroups, setOpenGroups] = useState<{
    recommended: boolean;
    global: boolean;
    company: boolean;
  }>({ recommended: true, global: false, company: false });

  const templateReadModel = useChecklistTemplateReadModel(companyId);

  const globalAggregates = useMemo<ChecklistTemplateAggregate[]>(
    () =>
      open && !isEdit
        ? templateReadModel.aggregates.filter(
            (aggregate) =>
              aggregate.template.scope === "global" || aggregate.template.companyId === null,
          )
        : [],
    [open, isEdit, templateReadModel.aggregates],
  );
  const companyAggregates = useMemo<ChecklistTemplateAggregate[]>(
    () =>
      open && !isEdit
        ? templateReadModel.aggregates.filter(
            (aggregate) =>
              aggregate.template.scope !== "global" && aggregate.template.companyId === companyId,
          )
        : [],
    [open, isEdit, templateReadModel.aggregates, companyId],
  );
  const globalTemplates = useMemo<ChecklistTemplateV2[]>(
    () => globalAggregates.map((aggregate) => aggregate.template),
    [globalAggregates],
  );
  const companyTemplates = useMemo<ChecklistTemplateV2[]>(
    () => companyAggregates.map((aggregate) => aggregate.template),
    [companyAggregates],
  );

  /** Recommended templates across both tiers, segment-driven, ordered. */
  const recommended = useMemo<PickerTemplate[]>(() => {
    const combined: PickerTemplate[] = [
      ...globalTemplates.map((template) => ({
        template,
        scope: "global" as const,
      })),
      ...companyTemplates.map((template) => ({
        template,
        scope: "company" as const,
      })),
    ];
    return partitionByRecommendation(
      combined.map((entry) => ({ ...entry, audience: entry.template.audience })),
      customerSegment,
    ).recommended.map(({ template, scope }) => ({ template, scope }));
  }, [globalTemplates, companyTemplates, customerSegment]);

  const hasTemplates = globalTemplates.length + companyTemplates.length > 0;
  const deferredWriteMessage = isEdit
    ? "Customer protocol editing is temporarily disabled while Supabase writes are connected."
    : "Customer protocol creation is temporarily disabled while Supabase writes are connected.";

  useEffect(() => {
    if (!open) return;
    setTemplateId("");
    setName(protocol?.name ?? "");
    setDescription(protocol?.description ?? "");
    setError(null);
    setPreviewAggregate(null);
    setOpenGroups({ recommended: true, global: false, company: false });
  }, [open, protocol]);

  const selectTemplate = (template: ChecklistTemplateV2) => {
    setTemplateId(template.id);
    // Prefill the name when it hasn't been customized yet.
    setName((current) => (current.trim() ? current : template.name));
    if (error) setError(null);
  };

  const handleCopyGlobal = (_globalTemplateId: string) => {
    if (!onCopyGlobalToCompany) return;
    setError(
      "Copying global templates is temporarily disabled while Supabase writes are connected.",
    );
  };

  const openPreview = (template: ChecklistTemplateV2) => {
    const aggregate = [...globalAggregates, ...companyAggregates].find(
      (entry) => entry.template.id === template.id,
    );
    setPreviewAggregate(aggregate ?? null);
  };

  const renderTemplateRow = (
    template: ChecklistTemplateV2,
    scope: "global" | "company",
    keyPrefix: string,
  ) => {
    const selected = template.id === templateId;
    const isGlobal = scope === "global";
    return (
      <div
        key={`${keyPrefix}-${template.id}`}
        className={`flex items-start gap-2 rounded-md px-2 py-1.5 transition-colors ${
          selected ? "bg-primary/10" : "hover:bg-muted"
        }`}
      >
        <button
          type="button"
          onClick={() => selectTemplate(template)}
          className="min-w-0 flex-1 text-left text-sm"
          aria-pressed={selected}
        >
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="truncate font-medium">{template.name}</span>
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
                  <Pencil className="h-2.5 w-2.5" /> Editable
                </>
              )}
            </span>
            {template.audience ? (
              <span className="shrink-0 rounded-full border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                {TEMPLATE_AUDIENCE_LABELS[template.audience]}
              </span>
            ) : null}
          </span>
          {template.description ? (
            <span className="block truncate text-xs text-muted-foreground">
              {template.description}
            </span>
          ) : null}
        </button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 shrink-0 gap-1 px-2 text-xs"
          onClick={() => openPreview(template)}
        >
          <Eye className="h-3 w-3" /> Preview
        </Button>
        {isGlobal && onCopyGlobalToCompany ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 gap-1 px-2 text-xs"
            onClick={() => handleCopyGlobal(template.id)}
            disabled
          >
            <Copy className="h-3 w-3" /> Copy to Company
          </Button>
        ) : null}
      </div>
    );
  };

  const renderGroup = (
    key: "recommended" | "global" | "company",
    label: string,
    icon: React.ReactNode,
    rows: PickerTemplate[],
  ) => {
    if (rows.length === 0) return null;
    const isOpen = openGroups[key];
    return (
      <div className="space-y-1">
        <button
          type="button"
          onClick={() =>
            setOpenGroups((prev) => ({ ...prev, [key]: !prev[key] }))
          }
          className="flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:bg-muted"
          aria-expanded={isOpen}
        >
          {isOpen ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
          {icon}
          <span>{label}</span>
          <span className="ml-auto tabular-nums">{rows.length}</span>
        </button>
        {isOpen
          ? rows.map((row) => renderTemplateRow(row.template, row.scope, key))
          : null}
      </div>
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(deferredWriteMessage);
  };

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Edit protocol" : "New customer protocol"}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Review this protocol's name and description. Editing is deferred until Supabase writes are connected."
              : "Choose a Supabase template source. Creating customer protocols is deferred until Supabase writes are connected."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {!isEdit ? (
            <div className="space-y-1.5">
              <Label>Template</Label>
              <ScrollArea className="h-64 rounded-md border border-border">
                <div className="space-y-3 p-2">
                  {templateReadModel.isLoading ? (
                    <p className="px-1 py-2 text-xs text-muted-foreground">
                      Loading templates from Supabase…
                    </p>
                  ) : templateReadModel.error ? (
                    <p className="px-1 py-2 text-xs text-destructive">
                      Could not load Supabase templates.
                    </p>
                  ) : !hasTemplates ? (
                    <p className="px-1 py-2 text-xs text-muted-foreground">
                      No templates available in Supabase. Create company or global
                      templates after write cutover is connected.
                    </p>
                  ) : null}

                  {renderGroup(
                    "recommended",
                    "Recommended templates",
                    <Sparkles className="h-3 w-3" />,
                    recommended,
                  )}

                  {renderGroup(
                    "global",
                    "Global templates",
                    <Globe className="h-3 w-3" />,
                    globalTemplates.map((template) => ({
                      template,
                      scope: "global" as const,
                    })),
                  )}

                  {renderGroup(
                    "company",
                    "Company templates",
                    <Pencil className="h-3 w-3" />,
                    companyTemplates.map((template) => ({
                      template,
                      scope: "company" as const,
                    })),
                  )}
                </div>
              </ScrollArea>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="cprotocol-name">Name</Label>
            <Input
              id="cprotocol-name"
              placeholder="e.g. Bergen Office Park – Recurring Cleaning"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError(null);
              }}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cprotocol-desc">Description</Label>
            <Textarea
              id="cprotocol-desc"
              placeholder="Optional — what this protocol covers for this customer…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>

          <p className="rounded-md border border-dashed border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {deferredWriteMessage}
          </p>

          {error ? (
            <p className="text-sm font-medium text-destructive">{error}</p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled title={deferredWriteMessage}>
              {isEdit ? "Save changes" : "Create protocol"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

    <TemplatePreviewDialog
      open={Boolean(previewAggregate)}
      onOpenChange={(value) => {
        if (!value) setPreviewAggregate(null);
      }}
      aggregate={previewAggregate}
    />
    </>
  );
}
