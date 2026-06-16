import { useEffect, useState } from "react";

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
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { useApp } from "@/context/AppContext";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  CATEGORY_ICON_KEYS,
  MODULE_DEFINITIONS,
  getCategoryIcon,
} from "@/lib/modules";
import { ROLE_LABELS, type ModuleCategory, type UserRole } from "@/types";

interface CategoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pass a category to edit; omit to create a new one. */
  category?: ModuleCategory | null;
}

/** User types a category can be made visible to (Super Admin manages all). */
const VISIBILITY_ROLES: UserRole[] = ["company_admin", "employee", "customer"];

/** Create or edit a global module category and connect modules to it. */
export function CategoryDialog({ open, onOpenChange, category }: CategoryDialogProps) {
  const { createCategory, updateCategory } = useApp();
  const { toast } = useToast();
  const [name, setName] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [icon, setIcon] = useState<string>("layers");
  const [active, setActive] = useState<boolean>(true);
  const [visibleUserTypes, setVisibleUserTypes] = useState<UserRole[]>([]);
  const [moduleIds, setModuleIds] = useState<string[]>([]);
  const [error, setError] = useState<string>("");
  const [saving, setSaving] = useState<boolean>(false);
  const isEdit = Boolean(category);

  useEffect(() => {
    if (open) {
      setName(category?.name ?? "");
      setDescription(category?.description ?? "");
      setIcon(category?.icon ?? "layers");
      setActive(category ? category.status === "active" : true);
      setVisibleUserTypes(category?.visibleUserTypes ?? ["company_admin"]);
      setModuleIds(category?.moduleIds ?? []);
      setError("");
    }
  }, [open, category]);

  const toggleRole = (role: UserRole) => {
    setVisibleUserTypes((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role],
    );
  };

  const toggleModule = (id: string) => {
    setModuleIds((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id],
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!name.trim()) {
      setError("Category name is required.");
      return;
    }
    if (saving) return;

    const payload = {
      name: name.trim(),
      description: description.trim(),
      icon,
      visibleUserTypes,
      moduleIds,
      status: active ? ("active" as const) : ("inactive" as const),
    };

    setSaving(true);
    try {
      // Authoritative path: the category is persisted to Supabase BEFORE the
      // dialog closes. The directory refetches on success so the panel reflects
      // the true stored record — nothing is committed optimistically.
      const result = category
        ? await updateCategory(category.id, payload)
        : await createCategory(payload);

      if (!result.ok) {
        setError(result.error ?? "Unable to save category.");
        return;
      }
      toast({
        title: isEdit ? "Category updated" : "Category created",
        description: `${name.trim()} has been saved.`,
      });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] gap-0 overflow-hidden p-0 sm:max-w-lg">
        <form onSubmit={handleSubmit} className="flex max-h-[90vh] flex-col">
          <DialogHeader className="border-b border-border px-6 py-5">
            <DialogTitle>{isEdit ? "Edit category" : "Create category"}</DialogTitle>
            <DialogDescription>
              Group modules and choose which user types can see this category.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
            <div className="space-y-1.5">
              <Label htmlFor="cat-name">Category name</Label>
              <Input
                id="cat-name"
                placeholder="e.g. Operations"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cat-desc">Description</Label>
              <Textarea
                id="cat-desc"
                placeholder="What does this category group together?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
              />
            </div>

            <div className="space-y-2">
              <Label>Icon</Label>
              <div className="grid grid-cols-8 gap-2">
                {CATEGORY_ICON_KEYS.map((key) => {
                  const Icon = getCategoryIcon(key);
                  const selected = icon === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setIcon(key)}
                      aria-label={`Use ${key} icon`}
                      aria-pressed={selected}
                      className={cn(
                        "flex h-9 w-9 items-center justify-center rounded-lg border transition-colors",
                        selected
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border bg-card text-muted-foreground hover:bg-accent",
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3">
              <div>
                <p className="text-sm font-medium">Active</p>
                <p className="text-xs text-muted-foreground">
                  Inactive categories are hidden from all navigation.
                </p>
              </div>
              <Switch checked={active} onCheckedChange={setActive} aria-label="Toggle active" />
            </div>

            <div className="space-y-2">
              <Label>Visible for user types</Label>
              <p className="text-xs text-muted-foreground">
                Only these user types will see the category and its modules.
              </p>
              <div className="space-y-1 pt-1">
                {VISIBILITY_ROLES.map((role) => (
                  <label
                    key={role}
                    className="flex cursor-pointer items-center justify-between gap-3 rounded-lg px-1 py-1.5 text-sm"
                  >
                    <span className="text-foreground/90">{ROLE_LABELS[role]}</span>
                    <Checkbox
                      checked={visibleUserTypes.includes(role)}
                      onCheckedChange={() => toggleRole(role)}
                    />
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Connected modules</Label>
              <p className="text-xs text-muted-foreground">
                A module can belong to more than one category.
              </p>
              <div className="space-y-1 pt-1">
                {MODULE_DEFINITIONS.map((def) => {
                  const Icon = def.icon;
                  return (
                    <label
                      key={def.id}
                      className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2 text-sm"
                    >
                      <span className="flex items-center gap-2.5 text-foreground/90">
                        <Icon className="h-4 w-4 text-muted-foreground" />
                        {def.name}
                      </span>
                      <Checkbox
                        checked={moduleIds.includes(def.id)}
                        onCheckedChange={() => toggleModule(def.id)}
                      />
                    </label>
                  );
                })}
              </div>
            </div>

            {error ? (
              <p className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>

          <DialogFooter className="border-t border-border px-6 py-4">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving
                ? "Saving…"
                : isEdit
                  ? "Save changes"
                  : "Create category"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
