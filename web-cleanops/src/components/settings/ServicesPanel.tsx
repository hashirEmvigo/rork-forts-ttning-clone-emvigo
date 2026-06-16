import { useMemo, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  Box,
  ChevronDown,
  Copy,
  Download,
  FolderPlus,
  Hash,
  MoreHorizontal,
  Package,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { PageMenuTiles, type PageMenuTileItem } from "@/components/navigation/PageMenuTiles";
import { ServiceDialog } from "@/components/settings/ServiceDialog";
import { ServiceCategoryDialog } from "@/components/settings/ServiceCategoryDialog";
import { ServicePackageDialog } from "@/components/settings/ServicePackageDialog";
import { ArticleNumberSeriesDialog } from "@/components/settings/ArticleNumberSeriesDialog";
import { useApp } from "@/context/AppContext";
import { useServiceCatalogMutations } from "@/hooks/use-service-catalog-mutations";
import { useArticleNumberSeries } from "@/hooks/use-article-number-series";
import type {
  ArticleNumberSeries,
  ArticleNumberSeriesScope,
} from "@/lib/data/supabaseArticleNumberSeriesRepository";
import { useToast } from "@/hooks/use-toast";
import { formatDate } from "@/lib/format";
import { packagesUsingCategory } from "@/lib/servicePackageCatalogLinks";
import { packagesContainingService } from "@/lib/servicePackageCatalogCleanup";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  SERVICE_BASIS_TYPES,
  SERVICE_BASIS_TYPE_LABELS,
  SERVICE_BILLING_TYPE_LABELS,
} from "@/types";
import type { Service, ServiceBasisType, ServiceCategory, ServicePackage } from "@/types";

type BasisFilter = ServiceBasisType | "all";

const MIN_QUERY = 3;

/** Section menu (Slice 11E) — shared icon-above-label tile standard. */
const SERVICES_PANEL_TAB_ITEMS: PageMenuTileItem[] = [
  { value: "catalog", label: "Catalog", icon: Box },
  { value: "packages", label: "Packages", icon: Package },
  { value: "io", label: "Import / Export", icon: Download },
];

/**
 * Settings → Services. Scalable management of the universal service catalog:
 * collapsed categories, services, packages and import/export placeholders.
 */
export function ServicesPanel() {
  const { currentUser } = useApp();
  const isSuperAdmin = currentUser?.role === "super_admin";

  return (
    <Tabs defaultValue="catalog" className="w-full">
      <PageMenuTiles items={SERVICES_PANEL_TAB_ITEMS} ariaLabel="Services sections" testId="services-panel-tiles" />

      <TabsContent value="catalog" className="mt-5">
        <CatalogTab isSuperAdmin={isSuperAdmin} />
      </TabsContent>
      <TabsContent value="packages" className="mt-5">
        <PackagesTab isSuperAdmin={isSuperAdmin} />
      </TabsContent>
      <TabsContent value="io" className="mt-5">
        <ImportExportTab />
      </TabsContent>
    </Tabs>
  );
}

// ── Catalog (categories + services + search) ──

function CatalogTab({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const {
    getServiceScope,
    getScopedServiceCategories,
    getScopedServices,
    setServiceCategoryArchived,
    setServiceArchived,
    hardDeleteService,
    servicePackages,
  } = useApp();
  const { toast } = useToast();

  // Article-number series for this catalog scope (global vs the active company).
  const serviceScope = getServiceScope();
  const { seriesByCategory, configure, isConfiguring } = useArticleNumberSeries(serviceScope);
  const buildSeriesScope = (categoryId: string): ArticleNumberSeriesScope => ({
    scopeKind: serviceScope === null ? "global" : "company",
    companyLegacyId: serviceScope,
    categoryId,
  });

  // Article-number series editor (per category).
  const [seriesDialogOpen, setSeriesDialogOpen] = useState<boolean>(false);
  const [seriesCategory, setSeriesCategory] = useState<ServiceCategory | null>(null);
  const openSeriesConfig = (c: ServiceCategory) => {
    setSeriesCategory(c);
    setSeriesDialogOpen(true);
  };

  const [input, setInput] = useState<string>("");
  const [committed, setCommitted] = useState<string>("");
  const [showArchived, setShowArchived] = useState<boolean>(false);
  const [basisFilter, setBasisFilter] = useState<BasisFilter>("all");

  const [categoryDialogOpen, setCategoryDialogOpen] = useState<boolean>(false);
  const [editingCategory, setEditingCategory] = useState<ServiceCategory | null>(null);
  const [serviceDialogOpen, setServiceDialogOpen] = useState<boolean>(false);
  const [editingService, setEditingService] = useState<Service | null>(null);
  const [defaultCategoryId, setDefaultCategoryId] = useState<string | null>(null);

  // Package editor opened by clicking a category's package tag (Super Admin).
  const [packageDialogOpen, setPackageDialogOpen] = useState<boolean>(false);
  const [editingPackage, setEditingPackage] = useState<ServicePackage | null>(null);
  const [packageFocusCategoryId, setPackageFocusCategoryId] = useState<string | undefined>(
    undefined,
  );

  // Permanent global-catalog delete (Super Admin only) — confirmed via dialog.
  const [serviceToDelete, setServiceToDelete] = useState<Service | null>(null);

  // Global packages that snapshotted the service queued for deletion. Deleting
  // the service also removes it from these packages (shown in the confirmation).
  const packagesAffectedByDelete = useMemo(
    () => (serviceToDelete ? packagesContainingService(servicePackages, serviceToDelete.id) : []),
    [serviceToDelete, servicePackages],
  );

  const categories = getScopedServiceCategories();
  const services = getScopedServices();

  // Non-archived packages whose tags appear on catalog categories. Only the
  // Super Admin owns/edits the global package set, so this stays empty for
  // company admins (whose company catalog ids don't match global package items).
  const activePackages = useMemo(
    () => (isSuperAdmin ? servicePackages.filter((p) => !p.archived) : []),
    [isSuperAdmin, servicePackages],
  );

  const openPackageForCategory = (pkg: ServicePackage, categoryId: string) => {
    setEditingPackage(pkg);
    setPackageFocusCategoryId(categoryId);
    setPackageDialogOpen(true);
  };

  const matchesBasis = (s: Service): boolean =>
    basisFilter === "all" || (s.serviceBasisType ?? "billable") === basisFilter;
  const activeCategories = categories.filter((c) => c.status === "active");

  // Effective query: typed (3+ chars) or committed via Enter/Search button.
  const effectiveQuery = useMemo(() => {
    const typed = input.trim();
    if (typed.length >= MIN_QUERY) return typed.toLowerCase();
    if (committed.trim().length > 0) return committed.trim().toLowerCase();
    return "";
  }, [input, committed]);

  const isSearching = effectiveQuery.length > 0;

  const categoryName = (id: string | null): string =>
    categories.find((c) => c.id === id)?.name ?? "Uncategorised";

  const searchResults = useMemo(() => {
    if (!isSearching) return [];
    const q = effectiveQuery;
    return services
      .filter((s) => (showArchived ? true : s.status === "active"))
      .filter(matchesBasis)
      .filter((s) => {
        const cat = categoryName(s.categoryId).toLowerCase();
        return (
          s.name.toLowerCase().includes(q) ||
          cat.includes(q) ||
          (s.articleNumber ?? "").toLowerCase().includes(q) ||
          (s.serviceType ?? "").toLowerCase().includes(q) ||
          (s.timeCode ?? "").toLowerCase().includes(q)
        );
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSearching, effectiveQuery, services, showArchived, categories, basisFilter]);

  const openNewCategory = () => {
    setEditingCategory(null);
    setCategoryDialogOpen(true);
  };
  const openEditCategory = (c: ServiceCategory) => {
    setEditingCategory(c);
    setCategoryDialogOpen(true);
  };
  const openNewService = (categoryId: string | null) => {
    setEditingService(null);
    setDefaultCategoryId(categoryId);
    setServiceDialogOpen(true);
  };
  const openEditService = (s: Service) => {
    setEditingService(s);
    setDefaultCategoryId(null);
    setServiceDialogOpen(true);
  };

  const toggleCategoryArchived = (c: ServiceCategory) => {
    const result = setServiceCategoryArchived(c.id, c.status === "active");
    if (!result.ok) {
      toast({ title: "Couldn't update", description: result.error, variant: "destructive" });
      return;
    }
    toast({ title: c.status === "active" ? "Category archived" : "Category restored" });
  };

  const toggleServiceArchived = (s: Service) => {
    const result = setServiceArchived(s.id, s.status === "active");
    if (!result.ok) {
      toast({ title: "Couldn't update", description: result.error, variant: "destructive" });
      return;
    }
    toast({ title: s.status === "active" ? "Service archived" : "Service restored" });
  };

  const confirmDeleteService = async () => {
    if (!serviceToDelete) return;
    const service = serviceToDelete;
    // Supabase-authoritative: only clear the dialog/remove the row once Supabase
    // confirms the global template was deleted. A failure keeps it visible.
    const result = await hardDeleteService(service.id);
    if (!result.ok) {
      toast({ title: "Couldn't delete", description: result.error, variant: "destructive" });
      setServiceToDelete(null);
      return;
    }
    const removed = result.removedFromPackages ?? 0;
    toast({
      title: "Service deleted",
      description:
        `“${service.name}” was permanently removed from the global catalog.` +
        (removed > 0
          ? ` Also removed from ${removed} package${removed === 1 ? "" : "s"}.`
          : ""),
    });
    setServiceToDelete(null);
  };

  // Super Admin operates at global scope, so every service shown here is a
  // global template that may be permanently deleted. The context still enforces
  // global-only deletion defensively.
  const onDeleteService = isSuperAdmin ? (s: Service) => setServiceToDelete(s) : undefined;

  const visibleCategories = showArchived
    ? categories
    : categories.filter((c) => c.status === "active");

  return (
    <div className="space-y-5">
      {/* Toolbar: search + actions */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex w-full gap-2 lg:max-w-md">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search services (min 3 letters)…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  setCommitted(input);
                }
              }}
              className="pl-9"
            />
          </div>
          <Button type="button" className="shrink-0" onClick={() => setCommitted(input)}>
            <Search className="h-4 w-4" /> Search
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Select value={basisFilter} onValueChange={(v) => setBasisFilter(v as BasisFilter)}>
            <SelectTrigger className="h-9 w-[150px]" aria-label="Filter by basis type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All basis types</SelectItem>
              {SERVICE_BASIS_TYPES.map((b) => (
                <SelectItem key={b.value} value={b.value}>
                  {b.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1.5 rounded-lg border border-border p-1">
            <Button
              type="button"
              variant={showArchived ? "ghost" : "secondary"}
              size="sm"
              onClick={() => setShowArchived(false)}
            >
              Active
            </Button>
            <Button
              type="button"
              variant={showArchived ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setShowArchived(true)}
            >
              Archived
            </Button>
          </div>
          <Button type="button" variant="outline" onClick={openNewCategory}>
            <FolderPlus className="h-4 w-4" /> Category
          </Button>
          <Button type="button" onClick={() => openNewService(activeCategories[0]?.id ?? null)}>
            <Plus className="h-4 w-4" /> Service
          </Button>
        </div>
      </div>

      {/* Search results OR collapsed categories */}
      {isSearching ? (
        searchResults.length === 0 ? (
          <EmptyState icon={<Search className="h-7 w-7 opacity-40" />} text="No services found." />
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              {searchResults.length} result{searchResults.length === 1 ? "" : "s"}
            </p>
            {searchResults.map((s) => (
              <ServiceRow
                key={s.id}
                service={s}
                categoryLabel={categoryName(s.categoryId)}
                onEdit={() => openEditService(s)}
                onToggleArchived={() => toggleServiceArchived(s)}
                onDelete={onDeleteService ? () => onDeleteService(s) : undefined}
              />
            ))}
          </div>
        )
      ) : visibleCategories.length === 0 ? (
        <EmptyState
          icon={<Box className="h-7 w-7 opacity-40" />}
          text="No service categories yet. Create one to get started."
        />
      ) : (
        <div className="space-y-2.5">
          {visibleCategories.map((cat) => {
            const catServices = services.filter(
              (s) =>
                s.categoryId === cat.id &&
                (showArchived ? true : s.status === "active") &&
                matchesBasis(s),
            );
            const usedByPackages = packagesUsingCategory(activePackages, cat.id, cat.name);
            return (
              <CategorySection
                key={cat.id}
                category={cat}
                services={catServices}
                packages={usedByPackages}
                series={seriesByCategory.get(cat.id)}
                onConfigureSeries={() => openSeriesConfig(cat)}
                onOpenPackage={isSuperAdmin ? openPackageForCategory : undefined}
                onEditCategory={() => openEditCategory(cat)}
                onToggleCategoryArchived={() => toggleCategoryArchived(cat)}
                onAddService={() => openNewService(cat.id)}
                onEditService={openEditService}
                onToggleServiceArchived={toggleServiceArchived}
                onDeleteService={onDeleteService}
              />
            );
          })}

          {/* Uncategorised bucket */}
          {(() => {
            const uncategorised = services.filter(
              (s) =>
                !s.categoryId && (showArchived ? true : s.status === "active") && matchesBasis(s),
            );
            if (uncategorised.length === 0) return null;
            return (
              <CategorySection
                category={null}
                services={uncategorised}
                packages={[]}
                onAddService={() => openNewService(null)}
                onEditService={openEditService}
                onToggleServiceArchived={toggleServiceArchived}
                onDeleteService={onDeleteService}
              />
            );
          })()}
        </div>
      )}

      <ServiceCategoryDialog
        open={categoryDialogOpen}
        onOpenChange={setCategoryDialogOpen}
        category={editingCategory}
      />
      <ArticleNumberSeriesDialog
        open={seriesDialogOpen}
        onOpenChange={setSeriesDialogOpen}
        category={seriesCategory}
        scope={seriesCategory ? buildSeriesScope(seriesCategory.id) : null}
        series={seriesCategory ? seriesByCategory.get(seriesCategory.id) : undefined}
        configure={configure}
        isConfiguring={isConfiguring}
      />
      <ServiceDialog
        open={serviceDialogOpen}
        onOpenChange={setServiceDialogOpen}
        service={editingService}
        categories={activeCategories}
        defaultCategoryId={defaultCategoryId}
      />
      {isSuperAdmin ? (
        <ServicePackageDialog
          open={packageDialogOpen}
          onOpenChange={setPackageDialogOpen}
          servicePackage={editingPackage}
          focusCategoryId={packageFocusCategoryId}
        />
      ) : null}

      <AlertDialog
        open={serviceToDelete !== null}
        onOpenChange={(open) => {
          if (!open) setServiceToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this global service permanently?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes{" "}
              <span className="font-medium text-foreground">
                {serviceToDelete?.name}
              </span>{" "}
              from the global master catalog for good. It only deletes the global template —
              companies that already copied it keep their own independent copy, and existing work
              orders, schedules and customers are unaffected. This can’t be undone.
              {packagesAffectedByDelete.length > 0 ? (
                <span className="mt-2 block font-medium text-foreground">
                  It’s also part of {packagesAffectedByDelete.length} global package
                  {packagesAffectedByDelete.length === 1 ? "" : "s"} — deleting it will remove it
                  from {packagesAffectedByDelete.length === 1 ? "that package" : "those packages"}.
                </span>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                void confirmDeleteService();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              <Trash2 className="h-4 w-4" /> Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

interface CategorySectionProps {
  category: ServiceCategory | null;
  services: Service[];
  /** Non-archived packages that draw at least one service from this category. */
  packages: ServicePackage[];
  /** Configured article-number series for this category, if any. */
  series?: ArticleNumberSeries;
  /** Opens the article-number series editor for this category. Omitted = hidden. */
  onConfigureSeries?: () => void;
  /** Opens the package editor focused on this category. Omitted = no tags. */
  onOpenPackage?: (pkg: ServicePackage, categoryId: string) => void;
  onEditCategory?: () => void;
  onToggleCategoryArchived?: () => void;
  onAddService: () => void;
  onEditService: (s: Service) => void;
  onToggleServiceArchived: (s: Service) => void;
  /** Permanently deletes a global service (Super Admin only). Omitted = hidden. */
  onDeleteService?: (s: Service) => void;
}

function CategorySection({
  category,
  services,
  packages,
  series,
  onConfigureSeries,
  onOpenPackage,
  onEditCategory,
  onToggleCategoryArchived,
  onAddService,
  onEditService,
  onToggleServiceArchived,
  onDeleteService,
}: CategorySectionProps) {
  const [open, setOpen] = useState<boolean>(false);
  const archived = category?.status === "archived";
  const seriesBadge = series
    ? `${Math.floor(series.rangeStart / 1000) * 1000}-series · ${series.rangeStart}–${series.rangeEnd}`
    : null;

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="rounded-xl border border-border bg-card"
    >
      <div className="flex items-center gap-2 px-3 py-2.5 sm:px-4">
        <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "" : "-rotate-90"}`}
          />
          <span className="truncate text-sm font-semibold">
            {category?.name ?? "Uncategorised"}
          </span>
          <Badge variant="secondary" className="shrink-0 font-normal tabular-nums">
            {services.length}
          </Badge>
          {archived ? (
            <Badge variant="outline" className="shrink-0 font-normal text-muted-foreground">
              Archived
            </Badge>
          ) : null}
          {seriesBadge ? (
            <Badge
              variant="outline"
              className={`hidden shrink-0 items-center gap-1 font-normal tabular-nums sm:inline-flex ${series && !series.isActive ? "text-muted-foreground" : "border-primary/40 text-primary"}`}
            >
              <Hash className="h-3 w-3" />
              {seriesBadge}
              {series && !series.isActive ? " · paused" : ""}
            </Badge>
          ) : null}
        </CollapsibleTrigger>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="shrink-0"
          onClick={onAddService}
        >
          <Plus className="h-4 w-4" /> Service
        </Button>
        {category ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {onEditCategory ? (
                <DropdownMenuItem onClick={onEditCategory}>
                  <Pencil className="h-4 w-4" /> Edit
                </DropdownMenuItem>
              ) : null}
              {onConfigureSeries ? (
                <DropdownMenuItem onClick={onConfigureSeries}>
                  <Hash className="h-4 w-4" /> {series ? "Edit article numbers" : "Set up article numbers"}
                </DropdownMenuItem>
              ) : null}
              {onToggleCategoryArchived ? (
                <DropdownMenuItem
                  onClick={onToggleCategoryArchived}
                  className={archived ? "" : "text-destructive focus:text-destructive"}
                >
                  {archived ? (
                    <>
                      <ArchiveRestore className="h-4 w-4" /> Restore
                    </>
                  ) : (
                    <>
                      <Archive className="h-4 w-4" /> Archive
                    </>
                  )}
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      {category && onOpenPackage && packages.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border px-3 py-2 sm:px-4">
          <span className="mr-0.5 text-xs text-muted-foreground">In packages</span>
          {packages.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onOpenPackage(p, category.id)}
              title={`Edit ${p.name}`}
              className="inline-flex max-w-[12rem] items-center gap-1 rounded-full border border-border bg-background px-2.5 py-0.5 text-xs font-medium text-foreground transition-colors hover:border-primary/50 hover:bg-primary/10 hover:text-primary"
            >
              <Package className="h-3 w-3 shrink-0 opacity-70" />
              <span className="truncate">{p.name}</span>
            </button>
          ))}
        </div>
      ) : null}

      <CollapsibleContent>
        <div className="space-y-1.5 border-t border-border p-3 sm:p-4">
          {category?.description ? (
            <p className="pb-1 text-xs text-muted-foreground">{category.description}</p>
          ) : null}
          {services.length === 0 ? (
            <p className="text-xs text-muted-foreground">No services in this category yet.</p>
          ) : (
            services.map((s) => (
              <ServiceRow
                key={s.id}
                service={s}
                onEdit={() => onEditService(s)}
                onToggleArchived={() => onToggleServiceArchived(s)}
                onDelete={onDeleteService ? () => onDeleteService(s) : undefined}
              />
            ))
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

interface ServiceRowProps {
  service: Service;
  categoryLabel?: string;
  onEdit: () => void;
  onToggleArchived: () => void;
  /** Permanently deletes this global service (Super Admin only). Omitted = hidden. */
  onDelete?: () => void;
}

function ServiceRow({ service, categoryLabel, onEdit, onToggleArchived, onDelete }: ServiceRowProps) {
  const archived = service.status === "archived";
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium">{service.name}</p>
          {archived ? (
            <Badge variant="outline" className="shrink-0 font-normal text-muted-foreground">
              Archived
            </Badge>
          ) : null}
        </div>
        <p className="truncate text-xs text-muted-foreground">
          {categoryLabel ? `${categoryLabel} · ` : ""}
          {service.articleNumber ? `#${service.articleNumber} · ` : ""}
          {SERVICE_BILLING_TYPE_LABELS[service.billingType]}
          {` · ${SERVICE_BASIS_TYPE_LABELS[service.serviceBasisType ?? "billable"]}`}
          {service.price !== undefined ? ` · ${service.price}` : ""}
        </p>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onEdit}>
            <Pencil className="h-4 w-4" /> Edit
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={onToggleArchived}
            className={archived ? "" : "text-destructive focus:text-destructive"}
          >
            {archived ? (
              <>
                <ArchiveRestore className="h-4 w-4" /> Restore
              </>
            ) : (
              <>
                <Archive className="h-4 w-4" /> Archive
              </>
            )}
          </DropdownMenuItem>
          {onDelete ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={onDelete}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="h-4 w-4" /> Delete permanently
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

// ── Packages ──

function PackagesTab({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const {
    currentUser,
    servicePackages,
    getSelectableServicePackages,
    getServiceScope,
    getScopedServiceCategories,
    getScopedServices,
    hasPermission,
    setServicePackageArchived,
    duplicateServicePackage,
  } = useApp();
  const { toast } = useToast();
  const mutations = useServiceCatalogMutations({
    companyId: currentUser ? getServiceScope() : undefined,
    isSuperAdmin: currentUser?.role === "super_admin",
    canManageServices:
      Boolean(currentUser) &&
      (currentUser?.role === "super_admin" || currentUser?.role === "company_admin") &&
      hasPermission("services.manage"),
    currentUserId: currentUser?.id ?? null,
  });
  const [dialogOpen, setDialogOpen] = useState<boolean>(false);
  const [editing, setEditing] = useState<ServicePackage | null>(null);
  const [showArchived, setShowArchived] = useState<boolean>(false);

  const list = isSuperAdmin
    ? servicePackages.filter((p) => (showArchived ? p.archived : !p.archived))
    : getSelectableServicePackages();

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (p: ServicePackage) => {
    setEditing(p);
    setDialogOpen(true);
  };

  const toggleArchived = async (p: ServicePackage) => {
    const result = await setServicePackageArchived(p.id, !p.archived);
    if (!result.ok) {
      toast({ title: "Couldn't update", description: result.error, variant: "destructive" });
      return;
    }
    toast({ title: p.archived ? "Package restored" : "Package archived" });
  };

  const duplicate = async (p: ServicePackage) => {
    const result = await duplicateServicePackage(p.id);
    if (!result.ok) {
      toast({ title: "Couldn't duplicate", description: result.error, variant: "destructive" });
      return;
    }
    toast({ title: "Package duplicated", description: `Created a copy of ${p.name}.` });
  };

  const apply = async (p: ServicePackage) => {
    if (mutations.isPending) return;
    try {
      const result = await mutations.applyPackage({
        pkg: p,
        existingCompanyCategories: getScopedServiceCategories(),
        existingCompanyServices: getScopedServices(),
      });
      toast({
        title: "Package copied",
        description: `Added ${result.added} service${result.added === 1 ? "" : "s"} to your catalog. Edit them anytime.`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not copy package.";
      toast({ title: "Couldn't copy", description: message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          {isSuperAdmin
            ? "Reusable groups of services companies can copy into their catalog."
            : "Copy a ready-made set of services into your company. Copies are independent."}
        </p>
        <div className="flex items-center gap-2">
          {isSuperAdmin ? (
            <>
              <div className="flex items-center gap-1.5 rounded-lg border border-border p-1">
                <Button
                  type="button"
                  variant={showArchived ? "ghost" : "secondary"}
                  size="sm"
                  onClick={() => setShowArchived(false)}
                >
                  Active
                </Button>
                <Button
                  type="button"
                  variant={showArchived ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => setShowArchived(true)}
                >
                  Archived
                </Button>
              </div>
              <Button type="button" onClick={openCreate}>
                <Plus className="h-4 w-4" /> New package
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {list.length === 0 ? (
        <EmptyState
          icon={<Package className="h-7 w-7 opacity-40" />}
          text={showArchived ? "No archived packages." : "No service packages yet."}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {list.map((p) => (
            <div key={p.id} className="flex flex-col rounded-2xl border border-border bg-card p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Package className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium leading-tight">{p.name}</p>
                    {p.description ? (
                      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                        {p.description}
                      </p>
                    ) : null}
                  </div>
                </div>
                {isSuperAdmin ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => openEdit(p)}>
                        <Pencil className="h-4 w-4" /> Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => duplicate(p)}>
                        <Copy className="h-4 w-4" /> Duplicate
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => toggleArchived(p)}
                        className={p.archived ? "" : "text-destructive focus:text-destructive"}
                      >
                        {p.archived ? (
                          <>
                            <ArchiveRestore className="h-4 w-4" /> Restore
                          </>
                        ) : (
                          <>
                            <Archive className="h-4 w-4" /> Archive
                          </>
                        )}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </div>

              <div className="mt-4 flex flex-wrap gap-1.5">
                <Badge variant="secondary" className="font-normal">
                  {p.items.length} service{p.items.length === 1 ? "" : "s"}
                </Badge>
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
                <span className="text-xs text-muted-foreground">Updated {formatDate(p.updatedAt)}</span>
                {!isSuperAdmin ? (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => apply(p)}
                    disabled={mutations.isPending}
                  >
                    <Copy className="h-4 w-4" /> Copy into company
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}

      {isSuperAdmin ? (
        <ServicePackageDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          servicePackage={editing}
        />
      ) : null}
    </div>
  );
}

// ── Import / Export (placeholders) ──

function ImportExportTab() {
  const { toast } = useToast();
  const notReady = () =>
    toast({
      title: "Coming soon",
      description: "Bulk import and export of services will be available in a future update.",
    });

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="rounded-2xl border border-dashed border-border p-6 text-center">
        <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Upload className="h-5 w-5" />
        </div>
        <p className="text-sm font-medium">Import services</p>
        <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">
          Upload a spreadsheet to add many services at once. Coming soon.
        </p>
        <Button type="button" variant="outline" size="sm" className="mt-4" onClick={notReady}>
          <Upload className="h-4 w-4" /> Import
        </Button>
      </div>
      <div className="rounded-2xl border border-dashed border-border p-6 text-center">
        <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Download className="h-5 w-5" />
        </div>
        <p className="text-sm font-medium">Export services</p>
        <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">
          Download your full catalog as a spreadsheet. Coming soon.
        </p>
        <Button type="button" variant="outline" size="sm" className="mt-4" onClick={notReady}>
          <Download className="h-4 w-4" /> Export
        </Button>
      </div>
    </div>
  );
}

function EmptyState({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border py-16 text-center text-muted-foreground">
      {icon}
      <p className="text-sm">{text}</p>
    </div>
  );
}
