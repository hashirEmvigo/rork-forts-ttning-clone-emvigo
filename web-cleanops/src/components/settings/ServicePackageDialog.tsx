import { useEffect, useMemo, useState } from "react";
import { Plus, X } from "lucide-react";

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
import { buildServicePackageItemFromService } from "@/lib/servicePackageItems";
import { SERVICE_BASIS_TYPE_LABELS } from "@/types";
import type { ServicePackage, ServicePackageItem } from "@/types";

interface ServicePackageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  servicePackage?: ServicePackage | null;
  /**
   * Optional catalog category id to pre-select in the "add service" picker when
   * the dialog opens (used when jumping in from a category's package tag in the
   * Catalog tab). Applied without ever resetting {@link ServicePackage.items}.
   */
  focusCategoryId?: string;
}

/** Sentinel category value for catalog services with no category. */
const UNCATEGORISED = "__uncategorised__";

/**
 * Super Admin editor for reusable service packages companies can copy.
 *
 * Phase 2: items are added by controlled selection from the global service
 * catalog (category → service) — never free text. Each added item is a
 * self-contained snapshot (see {@link buildServicePackageItemFromService}) so a
 * package stays valid after it is copied into a company.
 */
export function ServicePackageDialog({
  open,
  onOpenChange,
  servicePackage,
  focusCategoryId,
}: ServicePackageDialogProps) {
  const {
    createServicePackage,
    updateServicePackage,
    getScopedServiceCategories,
    getScopedServices,
    payrollGroups,
  } = useApp();
  const { toast } = useToast();
  const isEdit = Boolean(servicePackage);

  const [name, setName] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [items, setItems] = useState<ServicePackageItem[]>([]);

  const [draftCategoryId, setDraftCategoryId] = useState<string>("");
  const [draftServiceId, setDraftServiceId] = useState<string>("");
  const [submitting, setSubmitting] = useState<boolean>(false);

  // Global catalog (Super Admin scope) — only active rows are selectable.
  const activeCategories = useMemo(
    () => getScopedServiceCategories().filter((c) => c.status === "active"),
    [getScopedServiceCategories],
  );
  const activeServices = useMemo(
    () => getScopedServices().filter((s) => s.status === "active"),
    [getScopedServices],
  );
  const hasUncategorised = useMemo(
    () => activeServices.some((s) => !s.categoryId),
    [activeServices],
  );
  const catalogIsEmpty = activeCategories.length === 0 && !hasUncategorised;

  // Source-service ids that still exist in the catalog (ANY status — an archived
  // service is NOT deleted, so its snapshot stays valid). An item is "orphaned"
  // only when it was snapshotted from a catalog service (has a sourceServiceId)
  // that has since been permanently DELETED. Orphaned items must never be shown
  // as valid active items, and are dropped when the package is saved. Legacy
  // free-text items (no sourceServiceId) are never treated as orphaned.
  const catalogServiceIds = useMemo(
    () => new Set(getScopedServices().map((s) => s.id)),
    [getScopedServices],
  );
  const validItems = useMemo(
    () => items.filter((it) => !it.sourceServiceId || catalogServiceIds.has(it.sourceServiceId)),
    [items, catalogServiceIds],
  );
  const orphanItems = useMemo(
    () =>
      items.filter(
        (it) => Boolean(it.sourceServiceId) && !catalogServiceIds.has(it.sourceServiceId as string),
      ),
    [items, catalogServiceIds],
  );

  // Effect 1 — hydrate the package's editable fields when the dialog opens (or
  // the target package changes). This is the ONLY place `items` is (re)set, and
  // it deliberately depends ONLY on [open, servicePackage]. The scoped-catalog
  // accessors are intentionally NOT dependencies: a catalog/source refresh
  // re-creates those accessor identities, and including them here caused the
  // effect to re-run mid-edit and wipe items the user had just added (the
  // package-item reset bug). Keeping items off the catalog deps fixes that.
  useEffect(() => {
    if (!open) return;
    setName(servicePackage?.name ?? "");
    setDescription(servicePackage?.description ?? "");
    setItems(servicePackage ? servicePackage.items.map((it) => ({ ...it })) : []);
    setDraftServiceId("");
  }, [open, servicePackage]);

  // Effect 2 — seed a sensible default draft category from the live catalog.
  // This MUST NOT touch `items`. It re-runs when the catalog changes (e.g. it
  // loads asynchronously after the dialog opens), but the functional update only
  // fills an empty or now-invalid selection, so it never clobbers the user's
  // choice and never resets the package contents.
  useEffect(() => {
    if (!open) return;
    setDraftCategoryId((prev) => {
      if (prev === UNCATEGORISED) return hasUncategorised ? prev : "";
      if (prev && activeCategories.some((c) => c.id === prev)) return prev;
      return activeCategories[0]?.id ?? (hasUncategorised ? UNCATEGORISED : "");
    });
  }, [open, activeCategories, hasUncategorised]);

  // Effect 3 — apply an externally requested focus category when the dialog
  // opens (e.g. opened from a category's package tag in the Catalog tab). Kept
  // separate from Effect 1 and deliberately depends only on [open,
  // focusCategoryId] so it NEVER touches `items`: the package contents must
  // survive this just like a catalog refresh. Runs after Effect 2 so it wins
  // over the default-category seed; Effect 2's functional update then preserves
  // this choice as long as it stays a valid active category.
  useEffect(() => {
    if (!open || focusCategoryId === undefined) return;
    setDraftCategoryId(focusCategoryId);
    setDraftServiceId("");
  }, [open, focusCategoryId]);

  // The category object backing the current draft (null = Uncategorised bucket).
  const selectedCategory = useMemo(
    () =>
      draftCategoryId === UNCATEGORISED || draftCategoryId === ""
        ? null
        : activeCategories.find((c) => c.id === draftCategoryId) ?? null,
    [draftCategoryId, activeCategories],
  );

  // Services in the chosen category that aren't already in the package.
  const availableServices = useMemo(() => {
    if (!draftCategoryId) return [];
    const addedSourceIds = new Set(
      items.map((it) => it.sourceServiceId).filter((id): id is string => Boolean(id)),
    );
    return activeServices.filter((s) => {
      const inCategory =
        draftCategoryId === UNCATEGORISED ? !s.categoryId : s.categoryId === draftCategoryId;
      return inCategory && !addedSourceIds.has(s.id);
    });
  }, [activeServices, draftCategoryId, items]);

  const onCategoryChange = (value: string) => {
    setDraftCategoryId(value);
    setDraftServiceId("");
  };

  const addItem = () => {
    if (!draftServiceId) return;
    const service = availableServices.find((s) => s.id === draftServiceId);
    if (!service) return;
    setItems((prev) => [
      ...prev,
      buildServicePackageItemFromService(service, selectedCategory, payrollGroups),
    ]);
    setDraftServiceId("");
  };

  const removeItem = (id: string) => setItems((prev) => prev.filter((it) => it.id !== id));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || submitting) return;
    // Persist only valid items: any item whose source catalog service was
    // permanently deleted is pruned here so saving the package removes the
    // orphan from Supabase too (legacy free-text items are always kept).
    const payload = { name: name.trim(), description: description.trim() || undefined, items: validItems };
    setSubmitting(true);
    const result = servicePackage
      ? await updateServicePackage(servicePackage.id, payload)
      : await createServicePackage(payload);
    setSubmitting(false);
    if (!result.ok) {
      toast({ title: "Couldn't save", description: result.error, variant: "destructive" });
      return;
    }
    toast({
      title: isEdit ? "Package updated" : "Package created",
      description: `${name.trim()} has been saved.`,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit service package" : "New service package"}</DialogTitle>
          <DialogDescription>
            A reusable group of services companies can copy into their own catalog.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto py-2 pr-1">
            <div className="space-y-1.5">
              <Label htmlFor="pkg-name">Package name</Label>
              <Input
                id="pkg-name"
                placeholder="e.g. Cleaning Company Starter"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pkg-desc">Description</Label>
              <Textarea
                id="pkg-desc"
                placeholder="What this package includes…"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
              />
            </div>

            <div className="space-y-2">
              <Label>Services in this package</Label>
              {validItems.length === 0 && orphanItems.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
                  No services yet. Pick a category and service from the catalog below.
                </p>
              ) : validItems.length > 0 ? (
                <div className="space-y-1.5">
                  {validItems.map((it) => (
                    <div
                      key={it.id}
                      className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{it.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {it.categoryName}
                          {` · ${SERVICE_BASIS_TYPE_LABELS[it.serviceBasisType ?? "billable"]}`}
                          {it.price !== undefined ? ` · ${it.price}` : ""}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() => removeItem(it.id)}
                        aria-label={`Remove ${it.name}`}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              ) : null}

              {orphanItems.length > 0 ? (
                <div className="space-y-1.5 rounded-lg border border-dashed border-destructive/40 bg-destructive/5 p-2.5">
                  <p className="text-xs font-medium text-destructive">
                    No longer in catalog ({orphanItems.length})
                  </p>
                  <p className="text-xs text-muted-foreground">
                    These services were permanently deleted from the catalog, so they’re no longer
                    valid. They’ll be dropped automatically when you save.
                  </p>
                  {orphanItems.map((it) => (
                    <div
                      key={it.id}
                      className="flex items-center gap-2 rounded-lg border border-border bg-background/60 px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-muted-foreground line-through">
                          {it.name}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">{it.categoryName}</p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() => removeItem(it.id)}
                        aria-label={`Remove ${it.name}`}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              ) : null}

              {catalogIsEmpty ? (
                <p className="rounded-lg border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
                  No active services in the catalog yet. Add services under the Catalog tab, then
                  build your package here.
                </p>
              ) : (
                <div className="grid items-end gap-2 rounded-xl border border-border bg-muted/30 p-3 sm:grid-cols-[1fr_1fr_auto]">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Category</Label>
                    <Select value={draftCategoryId} onValueChange={onCategoryChange}>
                      <SelectTrigger aria-label="Select category">
                        <SelectValue placeholder="Select category" />
                      </SelectTrigger>
                      <SelectContent>
                        {activeCategories.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                        {hasUncategorised ? (
                          <SelectItem value={UNCATEGORISED}>Uncategorised</SelectItem>
                        ) : null}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Service</Label>
                    <Select
                      value={draftServiceId}
                      onValueChange={setDraftServiceId}
                      disabled={availableServices.length === 0}
                    >
                      <SelectTrigger aria-label="Select service">
                        <SelectValue
                          placeholder={
                            availableServices.length === 0 ? "No services available" : "Select service"
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {availableServices.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={addItem}
                    disabled={!draftServiceId}
                  >
                    <Plus className="h-4 w-4" /> Add
                  </Button>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Services are added from the global catalog. Each is saved as a snapshot, so editing
                the catalog later won't change existing packages.
              </p>
            </div>
          </div>

          <DialogFooter className="mt-4 border-t border-border pt-4">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting
                ? "Saving…"
                : isEdit
                  ? "Save changes"
                  : "Create package"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
