import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  Info,
  Pencil,
  Plus,
  Tags,
} from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { CategoryDialog } from "@/components/settings/CategoryDialog";
import { useToast } from "@/hooks/use-toast";
import {
  archiveChecklistCategory,
  createChecklistCategory,
  getAllChecklistCategories,
  reorderChecklistCategories,
  unarchiveChecklistCategory,
  updateChecklistCategory,
} from "@/lib/checklistCategoryStore";
import type { ChecklistCategory, ChecklistCategoryType } from "@/types";

interface CategoryPanelProps {
  /** Company whose categories are managed. */
  companyId: string;
  /** Which category domain this panel manages. */
  type: ChecklistCategoryType;
  /** Singular noun for this type, e.g. "room category". */
  typeLabel: string;
  /** When false the list is read-only (no add/edit/archive/reorder). */
  canManage: boolean;
}

const DUPLICATE_MESSAGE = "A category with this name already exists.";

/**
 * Reusable management UI for one Checklist Manager category type. Mirrors
 * {@link FloorPresetsPanel}: categories are company-scoped, archiving is a
 * soft-delete, and reordering applies to active categories only via simple move
 * up/down (no drag-and-drop dependency). The {@link checklistCategoryStore} is a
 * non-reactive localStorage abstraction, so the panel holds the (company, type)
 * categories in local state and re-reads after each mutation.
 */
export function CategoryPanel({
  companyId,
  type,
  typeLabel,
  canManage,
}: CategoryPanelProps) {
  const { toast } = useToast();
  const [categories, setCategories] = useState<ChecklistCategory[]>([]);
  const [showArchived, setShowArchived] = useState<boolean>(false);
  const [dialogOpen, setDialogOpen] = useState<boolean>(false);
  const [editing, setEditing] = useState<ChecklistCategory | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<ChecklistCategory | null>(null);

  const reload = useCallback(() => {
    setCategories(getAllChecklistCategories(companyId, type));
  }, [companyId, type]);

  useEffect(() => {
    reload();
  }, [reload]);

  const active = useMemo(
    () => categories.filter((c) => !c.isArchived),
    [categories],
  );
  const archived = useMemo(
    () => categories.filter((c) => c.isArchived),
    [categories],
  );

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (category: ChecklistCategory) => {
    setEditing(category);
    setDialogOpen(true);
  };

  const handleSubmit = (input: { name: string; description?: string }): string | null => {
    const result = editing
      ? updateChecklistCategory(companyId, editing.id, input)
      : createChecklistCategory(companyId, type, input);
    if (!result) return DUPLICATE_MESSAGE;
    reload();
    toast({ title: editing ? "Category updated" : "Category added" });
    return null;
  };

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= active.length) return;
    const next = [...active];
    [next[index], next[target]] = [next[target], next[index]];
    reorderChecklistCategories(
      companyId,
      type,
      next.map((c) => c.id),
    );
    reload();
  };

  const confirmArchive = () => {
    if (!archiveTarget) return;
    archiveChecklistCategory(companyId, archiveTarget.id);
    reload();
    toast({ title: "Category archived" });
    setArchiveTarget(null);
  };

  const restore = (category: ChecklistCategory) => {
    unarchiveChecklistCategory(companyId, category.id);
    reload();
    toast({ title: "Category restored" });
  };

  return (
    <div className="space-y-5">
      {/* Active categories */}
      <div className="rounded-xl border border-border bg-background p-5">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Tags className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold">Active categories</h3>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Reusable groups used to organize and filter items across the
                  checklist manager. Order here is the order people see.
                </p>
              </div>
              {canManage ? (
                <Button className="shrink-0 gap-1.5" onClick={openCreate}>
                  <Plus className="h-4 w-4" /> Add category
                </Button>
              ) : null}
            </div>

            {active.length === 0 ? (
              <div className="mt-4 rounded-lg border border-dashed border-border bg-muted/40 px-4 py-8 text-center">
                <p className="text-sm font-medium">No active categories</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {canManage
                    ? "Add a category to get started, or restore an archived one below."
                    : "No categories have been configured yet."}
                </p>
              </div>
            ) : (
              <ul className="mt-4 space-y-2">
                {active.map((category, index) => (
                  <li
                    key={category.id}
                    className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2"
                  >
                    <span className="flex h-7 min-w-[1.75rem] items-center justify-center rounded-full bg-primary/10 px-2 text-xs font-semibold tabular-nums text-primary">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{category.name}</p>
                      {category.description ? (
                        <p className="truncate text-xs text-muted-foreground">
                          {category.description}
                        </p>
                      ) : null}
                    </div>
                    {canManage ? (
                      <div className="ml-auto flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          disabled={index === 0}
                          onClick={() => move(index, -1)}
                          aria-label={`Move ${category.name} up`}
                        >
                          <ArrowUp className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          disabled={index === active.length - 1}
                          onClick={() => move(index, 1)}
                          aria-label={`Move ${category.name} down`}
                        >
                          <ArrowDown className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => openEdit(category)}
                          aria-label={`Edit ${category.name}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => setArchiveTarget(category)}
                          aria-label={`Archive ${category.name}`}
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

      {/* Archived categories */}
      <div className="rounded-xl border border-border bg-muted/40 p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Switch
              id="category-show-archived"
              checked={showArchived}
              onCheckedChange={setShowArchived}
            />
            <Label htmlFor="category-show-archived" className="text-sm font-medium">
              Show archived categories
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
            <p className="mt-4 text-sm text-muted-foreground">No archived categories.</p>
          ) : (
            <ul className="mt-4 space-y-2">
              {archived.map((category) => (
                <li
                  key={category.id}
                  className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-muted-foreground">
                      {category.name}
                    </p>
                    {category.description ? (
                      <p className="truncate text-xs text-muted-foreground">
                        {category.description}
                      </p>
                    ) : null}
                  </div>
                  {canManage ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-auto gap-1.5"
                      onClick={() => restore(category)}
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
          Categories are saved for your company. Archiving keeps a category out of
          active lists while preserving it for historical references — it is never
          deleted.
        </p>
      </div>

      <CategoryDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        category={editing}
        typeLabel={typeLabel}
        onSubmit={handleSubmit}
      />

      <AlertDialog
        open={Boolean(archiveTarget)}
        onOpenChange={(open) => {
          if (!open) setArchiveTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive category?</AlertDialogTitle>
            <AlertDialogDescription>
              “{archiveTarget?.name}” will be hidden from active lists but kept for
              historical references. You can restore it at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmArchive}>Archive</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
