import { useEffect, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  FileStack,
  Info,
  Layers,
  ListChecks,
  Loader2,
  Pencil,
  Plus,
  Tags,
} from "lucide-react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useChecklistTemplateMutations } from "@/hooks/use-checklist-template-mutations";
import { useChecklistTemplateReadModel } from "@/hooks/use-checklist-template-read-model";
import { useToast } from "@/hooks/use-toast";
import {
  TEMPLATE_AUDIENCE_LABELS,
  type ChecklistTemplateV2,
  type TemplateAudience,
} from "@/types";

interface TemplatesPanelProps {
  /** Company whose checklist templates are managed. */
  companyId: string;
  /** When false the list is read-only (no add/edit/archive/restore). */
  canManage: boolean;
}

interface TemplateMetadataFormInput {
  name: string;
  description?: string;
  audience?: TemplateAudience;
}

interface TemplateMetadataDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: ChecklistTemplateV2 | null;
  isSaving: boolean;
  error: string | null;
  onSubmit: (input: TemplateMetadataFormInput) => Promise<void>;
}

const CONTENT_DEFERRED_MESSAGE =
  "Section and item editing is temporarily disabled during the Supabase write cutover.";
const GLOBAL_READ_ONLY_MESSAGE =
  "Global templates are read-only in the company template manager for this slice.";

/** Aggregate counts shown per template (metadata only — no editor here). */
interface TemplateCounts {
  categories: number;
  floorPresets: number;
  sections: number;
  items: number;
}

function isCompanyTemplate(
  template: ChecklistTemplateV2,
  companyId: string,
): boolean {
  return template.scope === "company" && template.companyId === companyId;
}

function TemplateMetadataDialog({
  open,
  onOpenChange,
  template,
  isSaving,
  error,
  onSubmit,
}: TemplateMetadataDialogProps) {
  const isEdit = Boolean(template);
  const [name, setName] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [audience, setAudience] = useState<TemplateAudience | "">("");
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(template?.name ?? "");
    setDescription(template?.description ?? "");
    setAudience(template?.audience ?? "");
    setLocalError(null);
  }, [open, template]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setLocalError("Name is required.");
      return;
    }
    setLocalError(null);
    await onSubmit({
      name: trimmed,
      description: description.trim() || undefined,
      audience: audience || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={isSaving ? undefined : onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit template metadata" : "New company template"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update the Supabase metadata for this company template."
              : "Create an empty company template in Supabase. Sections and items can be added in a later slice."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="template-metadata-name">Name</Label>
            <Input
              id="template-metadata-name"
              placeholder="e.g. Regular Office Cleaning"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                if (localError) setLocalError(null);
              }}
              disabled={isSaving}
              autoFocus
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="template-metadata-description">Description</Label>
            <Textarea
              id="template-metadata-description"
              placeholder="Optional — summarize what this template covers…"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              disabled={isSaving}
              rows={3}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="template-metadata-audience">Audience</Label>
            <select
              id="template-metadata-audience"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              value={audience}
              onChange={(event) => setAudience(event.target.value as TemplateAudience | "")}
              disabled={isSaving}
            >
              <option value="">Not set</option>
              {(Object.keys(TEMPLATE_AUDIENCE_LABELS) as TemplateAudience[]).map((value) => (
                <option key={value} value={value}>
                  {TEMPLATE_AUDIENCE_LABELS[value]}
                </option>
              ))}
            </select>
          </div>
          {localError || error ? (
            <p className="text-sm font-medium text-destructive">{localError ?? error}</p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving…
                </>
              ) : isEdit ? (
                "Save changes"
              ) : (
                "Create template"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Management UI for a company's Checklist Manager templates. Templates are the
 * reusable Template → Section → Item blueprints protocols are built from.
 *
 * The list/count read path and this slice's create/metadata/archive/restore
 * write path are Supabase-only. Section and item editing remains disabled until
 * the content-write slice is connected.
 */
export function TemplatesPanel({ companyId, canManage }: TemplatesPanelProps) {
  const { toast } = useToast();
  const [showArchived, setShowArchived] = useState<boolean>(false);
  const [dialogOpen, setDialogOpen] = useState<boolean>(false);
  const [editingTemplate, setEditingTemplate] = useState<ChecklistTemplateV2 | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<ChecklistTemplateV2 | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const { active, archived, counts, isLoading, error } =
    useChecklistTemplateReadModel(companyId);
  const mutations = useChecklistTemplateMutations(companyId);

  const dialogError = actionError ?? mutations.error?.message ?? null;

  const openCreate = () => {
    setActionError(null);
    setEditingTemplate(null);
    setDialogOpen(true);
  };

  const openEdit = (template: ChecklistTemplateV2) => {
    setActionError(null);
    setEditingTemplate(template);
    setDialogOpen(true);
  };

  const handleMetadataSubmit = async (input: TemplateMetadataFormInput): Promise<void> => {
    setActionError(null);
    try {
      if (editingTemplate) {
        const updated = await mutations.updateMetadata(editingTemplate, input);
        if (!updated) throw new Error("Template was not found in Supabase.");
        toast({ title: "Template updated" });
      } else {
        await mutations.createEmptyCompanyTemplate(input);
        toast({ title: "Template added" });
      }
      setDialogOpen(false);
      setEditingTemplate(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Template could not be saved.");
    }
  };

  const confirmArchive = async (): Promise<void> => {
    if (!archiveTarget) return;
    setActionError(null);
    try {
      const archivedTemplate = await mutations.archive(archiveTarget.id);
      if (!archivedTemplate) throw new Error("Template was not found in Supabase.");
      toast({ title: "Template archived" });
      setArchiveTarget(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Template could not be archived.");
    }
  };

  const restore = async (template: ChecklistTemplateV2): Promise<void> => {
    setActionError(null);
    try {
      const restored = await mutations.restore(template.id);
      if (!restored) throw new Error("Template was not found in Supabase.");
      toast({ title: "Template restored" });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Template could not be restored.");
    }
  };

  const renderCounts = (templateId: string) => {
    const c: TemplateCounts | undefined = counts[templateId];
    if (!c) return null;
    return (
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <ListChecks className="h-3.5 w-3.5" /> {c.sections} sections
        </span>
        <span className="inline-flex items-center gap-1">
          <FileStack className="h-3.5 w-3.5" /> {c.items} items
        </span>
        <span className="inline-flex items-center gap-1">
          <Tags className="h-3.5 w-3.5" /> {c.categories} categories
        </span>
        <span className="inline-flex items-center gap-1">
          <Layers className="h-3.5 w-3.5" /> {c.floorPresets} floor presets
        </span>
      </div>
    );
  };

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
                <h3 className="text-sm font-semibold">Active templates</h3>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Reusable checklist blueprints your team builds protocols from.
                  Create empty company templates and edit metadata here.
                </p>
              </div>
              {canManage ? (
                <Button
                  className="shrink-0 gap-1.5"
                  onClick={openCreate}
                  disabled={mutations.isPending}
                >
                  <Plus className="h-4 w-4" /> Add template
                </Button>
              ) : null}
            </div>

            {canManage ? (
              <p className="mt-3 rounded-md border border-dashed border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                Template metadata, archive and restore are now saved to Supabase.
                {" "}{CONTENT_DEFERRED_MESSAGE}
              </p>
            ) : null}
            {actionError && !dialogOpen && !archiveTarget ? (
              <p className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs font-medium text-destructive">
                {actionError}
              </p>
            ) : null}

            {isLoading ? (
              <div className="mt-4 flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-4 py-5 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading templates from Supabase…
              </div>
            ) : error ? (
              <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-5 text-sm text-destructive">
                Could not load checklist templates from Supabase.
              </div>
            ) : active.length === 0 ? (
              <div className="mt-4 rounded-lg border border-dashed border-border bg-muted/40 px-4 py-8 text-center">
                <p className="text-sm font-medium">No active templates</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {canManage
                    ? "Add a template to get started, or restore an archived one below."
                    : "No templates have been configured yet."}
                </p>
              </div>
            ) : (
              <ul className="mt-4 space-y-2">
                {active.map((template) => {
                  const canMutateThisTemplate = canManage && isCompanyTemplate(template, companyId);
                  const disabledReason = canMutateThisTemplate ? undefined : GLOBAL_READ_ONLY_MESSAGE;
                  return (
                    <li
                      key={template.id}
                      className="flex items-start gap-3 rounded-lg border border-border bg-card px-3 py-2.5"
                    >
                      <div className="min-w-0 flex-1 text-left">
                        <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                          <span className="truncate">{template.name}</span>
                          {template.audience ? (
                            <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                              {TEMPLATE_AUDIENCE_LABELS[template.audience]}
                            </span>
                          ) : null}
                          {template.scope === "global" ? (
                            <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                              Global
                            </span>
                          ) : null}
                        </p>
                        {template.description ? (
                          <p className="truncate text-xs text-muted-foreground">
                            {template.description}
                          </p>
                        ) : null}
                        {renderCounts(template.id)}
                      </div>
                      {canManage ? (
                        <div className="ml-auto flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="gap-1.5"
                            disabled
                            title={CONTENT_DEFERRED_MESSAGE}
                          >
                            <ListChecks className="h-4 w-4" /> Edit content
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            disabled={!canMutateThisTemplate || mutations.isPending}
                            title={disabledReason}
                            onClick={() => openEdit(template)}
                            aria-label={`Edit ${template.name}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            disabled={!canMutateThisTemplate || mutations.isPending}
                            title={disabledReason}
                            onClick={() => setArchiveTarget(template)}
                            aria-label={`Archive ${template.name}`}
                          >
                            <Archive className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
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
              id="template-show-archived"
              checked={showArchived}
              onCheckedChange={setShowArchived}
            />
            <Label htmlFor="template-show-archived" className="text-sm font-medium">
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
            <p className="mt-4 text-sm text-muted-foreground">No archived templates.</p>
          ) : (
            <ul className="mt-4 space-y-2">
              {archived.map((template) => {
                const canMutateThisTemplate = canManage && isCompanyTemplate(template, companyId);
                return (
                  <li
                    key={template.id}
                    className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 truncate text-sm font-medium text-muted-foreground">
                        <span className="truncate">{template.name}</span>
                        {template.scope === "global" ? (
                          <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                            Global
                          </span>
                        ) : null}
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
                        disabled={!canMutateThisTemplate || mutations.isPending}
                        title={canMutateThisTemplate ? undefined : GLOBAL_READ_ONLY_MESSAGE}
                        onClick={() => void restore(template)}
                      >
                        <ArchiveRestore className="h-4 w-4" /> Restore
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )
        ) : null}
      </div>

      <div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          Templates are saved for your company. Archiving keeps a template out of
          active lists while preserving it for historical references — it is never
          deleted. Open a template to edit its sections and items once the content
          write slice is enabled.
        </p>
      </div>

      <TemplateMetadataDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open) setActionError(null);
          setDialogOpen(open);
        }}
        template={editingTemplate}
        isSaving={mutations.isPending}
        error={dialogError}
        onSubmit={handleMetadataSubmit}
      />

      <AlertDialog
        open={Boolean(archiveTarget)}
        onOpenChange={(open) => {
          if (!open && !mutations.isPending) {
            setActionError(null);
            setArchiveTarget(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive template?</AlertDialogTitle>
            <AlertDialogDescription>
              “{archiveTarget?.name}” will be hidden from active Supabase lists but kept
              for historical references. You can restore it at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {actionError ? (
            <p className="text-sm font-medium text-destructive">{actionError}</p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={mutations.isPending}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={() => void confirmArchive()}
              disabled={mutations.isPending}
            >
              {mutations.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Archiving…
                </>
              ) : (
                "Archive"
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
