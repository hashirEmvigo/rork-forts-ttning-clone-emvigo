import { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { CategoryDialog } from "@/components/modules/CategoryDialog";
import { useApp } from "@/context/AppContext";
import { useToast } from "@/hooks/use-toast";
import { getCategoryIcon, getModuleDefinition } from "@/lib/modules";
import { ROLE_LABELS, type ModuleCategory } from "@/types";

/** Super Admin view: create, edit, delete and reorder global module categories. */
export function CategoriesPanel() {
  const { moduleCategories, deleteCategory, reorderCategories } = useApp();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState<boolean>(false);
  const [editing, setEditing] = useState<ModuleCategory | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ModuleCategory | null>(null);

  const sorted = useMemo(
    () => [...moduleCategories].sort((a, b) => a.sortOrder - b.sortOrder),
    [moduleCategories],
  );

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (category: ModuleCategory) => {
    setEditing(category);
    setDialogOpen(true);
  };

  const move = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= sorted.length) return;
    const ids = sorted.map((c) => c.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    // Authoritative: order only changes once the Supabase write is confirmed and
    // the directory refetches — a failed reorder leaves the list as it was.
    const result = await reorderCategories(ids);
    if (!result.ok) {
      toast({ title: "Couldn't reorder", description: result.error, variant: "destructive" });
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const result = await deleteCategory(pendingDelete.id);
    if (!result.ok) {
      toast({ title: "Couldn't delete", description: result.error, variant: "destructive" });
    } else {
      toast({ title: "Category deleted", description: `${pendingDelete.name} has been removed.` });
    }
    setPendingDelete(null);
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Categories group modules in navigation across every company.
        </p>
        <Button size="sm" onClick={openCreate}>
          <Plus className="h-4 w-4" /> New category
        </Button>
      </div>

      {sorted.length === 0 ? (
        <p className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          No categories yet. Create one to start grouping modules.
        </p>
      ) : (
        <div className="space-y-2.5">
          {sorted.map((category, index) => {
            const Icon = getCategoryIcon(category.icon);
            const isActive = category.status === "active";
            return (
              <div
                key={category.id}
                className="flex items-start gap-3 rounded-xl border border-border bg-card px-4 py-3.5"
              >
                <div className="flex flex-col gap-1 pt-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      void move(index, -1);
                    }}
                    disabled={index === 0}
                    aria-label={`Move ${category.name} up`}
                    className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent disabled:opacity-30"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void move(index, 1);
                    }}
                    disabled={index === sorted.length - 1}
                    aria-label={`Move ${category.name} down`}
                    className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent disabled:opacity-30"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                  <Icon className="h-4 w-4" />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold">{category.name}</p>
                    <span
                      className={
                        isActive
                          ? "rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700"
                          : "rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                      }
                    >
                      {isActive ? "Active" : "Inactive"}
                    </span>
                  </div>
                  {category.description ? (
                    <p className="mt-0.5 text-sm text-muted-foreground">{category.description}</p>
                  ) : null}

                  <div className="mt-2 flex flex-wrap gap-1">
                    {category.moduleIds.length === 0 ? (
                      <span className="text-[11px] text-muted-foreground">No modules connected</span>
                    ) : (
                      category.moduleIds.map((mid) => {
                        const def = getModuleDefinition(mid);
                        if (!def) return null;
                        return (
                          <span
                            key={mid}
                            className="rounded-md border border-border bg-secondary px-2 py-0.5 text-[11px] font-medium text-secondary-foreground"
                          >
                            {def.name}
                          </span>
                        );
                      })
                    )}
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-1">
                    <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      Visible for:
                    </span>
                    {category.visibleUserTypes.length === 0 ? (
                      <span className="text-[11px] text-muted-foreground">Nobody</span>
                    ) : (
                      category.visibleUserTypes.map((r) => (
                        <span
                          key={r}
                          className="rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary"
                        >
                          {ROLE_LABELS[r]}
                        </span>
                      ))
                    )}
                  </div>
                </div>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => openEdit(category)}>
                      <Pencil className="h-4 w-4" /> Edit category
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => setPendingDelete(category)}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" /> Delete category
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            );
          })}
        </div>
      )}

      <CategoryDialog open={dialogOpen} onOpenChange={setDialogOpen} category={editing} />

      <AlertDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {pendingDelete?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This category will be removed from navigation. The modules themselves stay available.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                void confirmDelete();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
