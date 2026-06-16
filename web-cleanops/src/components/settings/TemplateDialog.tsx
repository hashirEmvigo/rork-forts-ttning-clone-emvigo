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
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  resolveChecklistCategoriesByType,
  resolveFloorPresets,
} from "@/lib/checklistSettingsResolver";
import {
  getAllChecklistCategoriesByType,
} from "@/lib/checklistCategoryStore";
import { getAllFloorPresets } from "@/lib/floorPresetStore";
import {
  CHECKLIST_CATEGORY_TYPES,
  TEMPLATE_AUDIENCE_LABELS,
  type ChecklistCategoryType,
  type TemplateAudience,
} from "@/types";

/** Plural display labels for each category type, shown as binding group headers. */
const CATEGORY_TYPE_LABELS: Record<ChecklistCategoryType, string> = {
  room: "Room categories",
  task: "Task categories",
  instruction: "Instruction categories",
  quality: "Quality categories",
  media: "Media categories",
  template: "Template categories",
  industry: "Industry categories",
};

export interface TemplateDialogSubmit {
  name: string;
  description?: string;
  audience?: TemplateAudience;
  categoryIds: string[];
  floorPresetIds: string[];
}

interface TemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Company whose categories and floor presets are available for binding. */
  companyId: string;
  /** Pass a template to edit; omit to create a new one. */
  template?: {
    name: string;
    description?: string;
    audience?: TemplateAudience;
    categoryIds: string[];
    floorPresetIds: string[];
  } | null;
  /**
   * Persists the template metadata and bindings. Returns an error message on
   * failure (e.g. a duplicate name) so the dialog can surface it inline and stay
   * open, or null on success.
   */
  onSubmit: (input: TemplateDialogSubmit) => string | null;
}

interface BindingOption {
  id: string;
  name: string;
  isArchived: boolean;
}

/**
 * Create/edit checklist template metadata (name + description) and its bindings
 * to existing Checklist Categories and Floor Presets. Bindings reference records
 * from the Phase 1 systems by id — no category/floor-preset data is duplicated.
 *
 * Selection lists show active records, plus any currently-linked archived record
 * so editing never silently drops an existing binding.
 */
export function TemplateDialog({
  open,
  onOpenChange,
  companyId,
  template,
  onSubmit,
}: TemplateDialogProps) {
  const isEdit = Boolean(template);
  const [name, setName] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [audience, setAudience] = useState<TemplateAudience | "">("");
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [floorPresetIds, setFloorPresetIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(template?.name ?? "");
    setDescription(template?.description ?? "");
    setAudience(template?.audience ?? "");
    setCategoryIds(template?.categoryIds ?? []);
    setFloorPresetIds(template?.floorPresetIds ?? []);
    setError(null);
  }, [open, template]);

  /**
   * Category options grouped by type: active categories, plus any archived ones
   * already linked to this template (so they stay selected and aren't dropped).
   */
  const categoryGroups = useMemo<
    { type: ChecklistCategoryType; label: string; options: BindingOption[] }[]
  >(() => {
    if (!open) return [];
    const linked = new Set(template?.categoryIds ?? []);
    const active = resolveChecklistCategoriesByType(companyId);
    const all = getAllChecklistCategoriesByType(companyId, { includeArchived: true });
    return CHECKLIST_CATEGORY_TYPES.map((type) => {
      const activeList = active[type] ?? [];
      const seen = new Set(activeList.map((c) => c.id));
      const linkedArchived = (all[type] ?? []).filter(
        (c) => c.isArchived && linked.has(c.id) && !seen.has(c.id),
      );
      const options: BindingOption[] = [
        ...activeList.map((c) => ({ id: c.id, name: c.name, isArchived: false })),
        ...linkedArchived.map((c) => ({ id: c.id, name: c.name, isArchived: true })),
      ];
      return { type, label: CATEGORY_TYPE_LABELS[type], options };
    }).filter((group) => group.options.length > 0);
  }, [open, companyId, template]);

  /** Floor preset options: active, plus any linked archived presets. */
  const floorPresetOptions = useMemo<BindingOption[]>(() => {
    if (!open) return [];
    const linked = new Set(template?.floorPresetIds ?? []);
    const active = resolveFloorPresets(companyId);
    const seen = new Set(active.map((p) => p.id));
    const linkedArchived = getAllFloorPresets(companyId).filter(
      (p) => p.isArchived && linked.has(p.id) && !seen.has(p.id),
    );
    return [
      ...active.map((p) => ({ id: p.id, name: p.name, isArchived: false })),
      ...linkedArchived.map((p) => ({ id: p.id, name: p.name, isArchived: true })),
    ];
  }, [open, companyId, template]);

  const toggle = (
    id: string,
    current: string[],
    setter: (next: string[]) => void,
  ) => {
    setter(
      current.includes(id)
        ? current.filter((existing) => existing !== id)
        : [...current, id],
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Name is required.");
      return;
    }
    const failure = onSubmit({
      name: trimmed,
      description: description.trim() || undefined,
      audience: audience || undefined,
      categoryIds,
      floorPresetIds,
    });
    if (failure) {
      setError(failure);
      return;
    }
    onOpenChange(false);
  };

  const renderOption = (
    option: BindingOption,
    selected: string[],
    setter: (next: string[]) => void,
    idPrefix: string,
  ) => {
    const checkboxId = `${idPrefix}-${option.id}`;
    return (
      <label
        key={option.id}
        htmlFor={checkboxId}
        className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
      >
        <Checkbox
          id={checkboxId}
          checked={selected.includes(option.id)}
          onCheckedChange={() => toggle(option.id, selected, setter)}
        />
        <span className="min-w-0 flex-1 truncate">{option.name}</span>
        {option.isArchived ? (
          <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
            Archived
          </span>
        ) : null}
      </label>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit template" : "New template"}</DialogTitle>
          <DialogDescription>
            Reusable checklist templates your team builds protocols from.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="template-name">Name</Label>
            <Input
              id="template-name"
              placeholder="e.g. Regular Office Cleaning"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError(null);
              }}
              autoFocus
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="template-desc">Description</Label>
            <Textarea
              id="template-desc"
              placeholder="Optional — summarize what this template covers…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="template-audience">Audience</Label>
            <Select
              value={audience === "" ? "none" : audience}
              onValueChange={(v) =>
                setAudience(v === "none" ? "" : (v as TemplateAudience))
              }
            >
              <SelectTrigger id="template-audience">
                <SelectValue placeholder="Not set" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not set</SelectItem>
                {(
                  Object.keys(TEMPLATE_AUDIENCE_LABELS) as TemplateAudience[]
                ).map((value) => (
                  <SelectItem key={value} value={value}>
                    {TEMPLATE_AUDIENCE_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Used to recommend the right template when creating customer
              protocols.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Linked categories</Label>
              <ScrollArea className="h-44 rounded-md border border-border">
                <div className="p-1">
                  {categoryGroups.length === 0 ? (
                    <p className="px-2 py-3 text-xs text-muted-foreground">
                      No categories available.
                    </p>
                  ) : (
                    categoryGroups.map((group) => (
                      <div key={group.type} className="mb-1.5 last:mb-0">
                        <p className="px-2 pb-0.5 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                          {group.label}
                        </p>
                        {group.options.map((option) =>
                          renderOption(option, categoryIds, setCategoryIds, "cat"),
                        )}
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
              <p className="text-xs text-muted-foreground">
                {categoryIds.length} selected
              </p>
            </div>

            <div className="space-y-1.5">
              <Label>Linked floor presets</Label>
              <ScrollArea className="h-44 rounded-md border border-border">
                <div className="p-1">
                  {floorPresetOptions.length === 0 ? (
                    <p className="px-2 py-3 text-xs text-muted-foreground">
                      No floor presets available.
                    </p>
                  ) : (
                    floorPresetOptions.map((option) =>
                      renderOption(option, floorPresetIds, setFloorPresetIds, "floor"),
                    )
                  )}
                </div>
              </ScrollArea>
              <p className="text-xs text-muted-foreground">
                {floorPresetIds.length} selected
              </p>
            </div>
          </div>

          {error ? (
            <p className="text-sm font-medium text-destructive">{error}</p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">{isEdit ? "Save changes" : "Create template"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
