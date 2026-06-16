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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useApp } from "@/context/AppContext";
import { useToast } from "@/hooks/use-toast";
import { useServiceCatalogMutations } from "@/hooks/use-service-catalog-mutations";
import { SERVICE_CATEGORY_TYPES, type ServiceCategory, type ServiceCategoryType } from "@/types";

const NO_TYPE = "__none__";

interface ServiceCategoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pass a category to edit; omit to create a new one. */
  category?: ServiceCategory | null;
}

/** Create/edit a service category. */
export function ServiceCategoryDialog({
  open,
  onOpenChange,
  category,
}: ServiceCategoryDialogProps) {
  const { currentUser, getServiceScope, hasPermission } = useApp();
  const { toast } = useToast();
  const isEdit = Boolean(category);
  const [name, setName] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [categoryType, setCategoryType] = useState<string>(NO_TYPE);
  const [error, setError] = useState<string | null>(null);
  const mutations = useServiceCatalogMutations({
    companyId: currentUser ? getServiceScope() : undefined,
    isSuperAdmin: currentUser?.role === "super_admin",
    canManageServices:
      Boolean(currentUser) &&
      (currentUser?.role === "super_admin" || currentUser?.role === "company_admin") &&
      hasPermission("services.manage"),
    currentUserId: currentUser?.id ?? null,
  });

  useEffect(() => {
    if (!open) return;
    setName(category?.name ?? "");
    setDescription(category?.description ?? "");
    setCategoryType(category?.categoryType ?? NO_TYPE);
    setError(null);
  }, [open, category]);

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!name.trim() || mutations.isPending) return;
    const payload = {
      name: name.trim(),
      description: description.trim() || undefined,
      categoryType: categoryType === NO_TYPE ? undefined : (categoryType as ServiceCategoryType),
    };
    setError(null);
    try {
      if (category) {
        await mutations.updateServiceCategory({ categoryId: category.id, patch: payload });
      } else {
        await mutations.createServiceCategory(payload);
      }
      toast({
        title: isEdit ? "Category updated" : "Category created",
        description: `${name.trim()} has been saved.`,
      });
      onOpenChange(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not save category.";
      setError(message);
      toast({ title: "Couldn't save", description: message, variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!mutations.isPending) onOpenChange(next); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit category" : "New category"}</DialogTitle>
          <DialogDescription>Group related services under a category.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="cat-name">Category name</Label>
            <Input
              id="cat-name"
              placeholder="e.g. Deep Cleaning"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cat-type">Classification</Label>
            <Select value={categoryType} onValueChange={setCategoryType}>
              <SelectTrigger id="cat-type">
                <SelectValue placeholder="Unclassified" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_TYPE}>Unclassified</SelectItem>
                {SERVICE_CATEGORY_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Stable system type used by absence/internal-time filtering and statistics. The name is just a label.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cat-desc">Description</Label>
            <Textarea
              id="cat-desc"
              placeholder="What this category covers…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>
          {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={mutations.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutations.isPending}>
              {mutations.isPending ? "Saving…" : isEdit ? "Save changes" : "Create category"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
