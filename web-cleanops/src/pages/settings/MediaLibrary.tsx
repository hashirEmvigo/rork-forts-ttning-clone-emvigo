import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Building2,
  Image as ImageIcon,
  ImageOff,
  Lock,
  ShieldCheck,
  Upload,
} from "lucide-react";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { AccessDenied } from "@/components/AccessDenied";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  listCompanyAdminMediaLibrary,
  type CompanyAdminMediaItem,
} from "@/lib/assets";
import {
  groupItemsByAssetCategory,
  type AssetCategoryItemGroup,
} from "@/lib/assets/assetCategorySections";
import { COMPANY_MEDIA_LIBRARY_SETTINGS_VIEW_PERMISSION } from "@/lib/assets/companyMediaSettingsNav";
import { formatBytes } from "@/lib/mediaProcessing";
import { cn } from "@/lib/utils";
import { useApp } from "@/context/AppContext";

type MediaScopeFilter = "all" | "global" | "internal";

const MEDIA_SCOPE_FILTERS: { id: MediaScopeFilter; label: string; description: string }[] = [
  {
    id: "all",
    label: "All images",
    description: "Show global and internal media together.",
  },
  {
    id: "global",
    label: "Global media",
    description: "Super Admin-provided assets only.",
  },
  {
    id: "internal",
    label: "Internal media",
    description: "Company-owned assets only.",
  },
];

/** Company Admin Settings → Media Library foundation. */
export default function CompanyMediaLibrarySettings() {
  const { currentUser, hasPermission } = useApp();
  const companyId = currentUser?.companyId ?? "";
  const [scopeFilter, setScopeFilter] = useState<MediaScopeFilter>("all");

  const libraryQuery = useQuery({
    queryKey: ["company-media-library", companyId],
    queryFn: () => listCompanyAdminMediaLibrary({ companyId }),
    enabled:
      currentUser?.role === "company_admin" &&
      Boolean(companyId) &&
      hasPermission(COMPANY_MEDIA_LIBRARY_SETTINGS_VIEW_PERMISSION),
  });

  const globalGroups = useMemo<AssetCategoryItemGroup<CompanyAdminMediaItem>[]>(
    () => groupItemsByAssetCategory(libraryQuery.data?.globalItems ?? []),
    [libraryQuery.data?.globalItems],
  );
  const companyGroups = useMemo<AssetCategoryItemGroup<CompanyAdminMediaItem>[]>(
    () => groupItemsByAssetCategory(libraryQuery.data?.companyItems ?? []),
    [libraryQuery.data?.companyItems],
  );

  const showGlobalMedia = scopeFilter !== "internal";
  const showInternalMedia = scopeFilter !== "global";
  const globalCount = libraryQuery.data?.globalItems.length ?? 0;
  const internalCount = libraryQuery.data?.companyItems.length ?? 0;

  // Defense-in-depth: App.tsx gates this route to Company Admin + settings.manage.
  if (currentUser?.role !== "company_admin" || !hasPermission(COMPANY_MEDIA_LIBRARY_SETTINGS_VIEW_PERMISSION)) {
    return <AccessDenied />;
  }

  return (
    <DashboardLayout wide>
      <Link
        to="/settings"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Settings
      </Link>

      <PageHeader
        title="Media Library"
        description="Manage company media and view global assets made available by Super Admin."
      />

      <div className="space-y-5">
        <section className="rounded-2xl border border-border bg-card px-5 py-4 sm:px-6" aria-label="Media scope filter">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-sm font-semibold">Image scope</h2>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                Filter by ownership. Global media is provided by Super Admin; internal media belongs to your company.
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-3" role="group" aria-label="Filter media by scope">
              {MEDIA_SCOPE_FILTERS.map((filter) => {
                const isSelected = scopeFilter === filter.id;
                const count = filter.id === "global" ? globalCount : filter.id === "internal" ? internalCount : globalCount + internalCount;
                const description = `${filter.description} ${count} ${count === 1 ? "image" : "images"}.`;
                return (
                  <Button
                    key={filter.id}
                    type="button"
                    variant={isSelected ? "default" : "outline"}
                    className={cn("h-auto justify-start px-3 py-2 text-left", isSelected ? "shadow-sm" : "bg-background")}
                    aria-label={filter.label}
                    aria-pressed={isSelected}
                    onClick={() => setScopeFilter(filter.id)}
                  >
                    <span className="flex min-w-0 flex-col items-start gap-0.5">
                      <span className="text-sm font-semibold">{filter.label}</span>
                      <span className={cn("text-xs", isSelected ? "text-primary-foreground/75" : "text-muted-foreground")}>
                        {description}
                      </span>
                    </span>
                  </Button>
                );
              })}
            </div>
          </div>
        </section>

        {showGlobalMedia ? (
          <section className="rounded-2xl border border-border bg-card">
            <div className="flex flex-col gap-4 border-b border-border px-5 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-6">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-sky-600 dark:text-sky-400">
                  <ShieldCheck className="h-4 w-4" />
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-semibold">Global media</h2>
                    <Badge variant="outline" className="gap-1 border-transparent bg-sky-500/10 text-sky-600 dark:text-sky-400">
                      <Lock className="h-3 w-3" /> Global
                    </Badge>
                    <Badge variant="outline" className="border-transparent bg-muted text-muted-foreground">
                      Read-only
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    Super Admin-provided assets available for company use. Active assets can be selected in future flows, but cannot be archived or deleted here.
                  </p>
                </div>
              </div>
            </div>
            <div className="px-5 py-5 sm:px-6">
              <LibraryBody
                groups={globalGroups}
                loading={libraryQuery.isLoading || libraryQuery.isFetching}
                error={libraryQuery.error instanceof Error ? libraryQuery.error.message : null}
                emptyTitle="No global assets available"
                emptyDescription="When Super Admin publishes active library assets, they will appear here as read-only options."
                readOnly
              />
            </div>
          </section>
        ) : null}

        {showInternalMedia ? (
          <section className="rounded-2xl border border-border bg-card">
            <div className="flex flex-col gap-4 border-b border-border px-5 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-6">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <Building2 className="h-4 w-4" />
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-semibold">Internal media</h2>
                    <Badge variant="outline" className="border-transparent bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                      Internal
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    Company-owned media for internal use. Upload and management controls are intentionally deferred until the next safe UI slice.
                  </p>
                </div>
              </div>
              <Button variant="outline" disabled className="w-full sm:w-auto" aria-label="Upload internal media coming later">
                <Upload className="h-4 w-4" />
                Upload coming later
              </Button>
            </div>
            <div className="space-y-4 px-5 py-5 sm:px-6">
              <div className="rounded-xl border border-dashed border-border bg-muted/25 px-4 py-3 text-sm text-muted-foreground">
                Company-level hiding of global assets will be added in a later slice.
              </div>
              <LibraryBody
                groups={companyGroups}
                loading={libraryQuery.isLoading || libraryQuery.isFetching}
                error={libraryQuery.error instanceof Error ? libraryQuery.error.message : null}
                emptyTitle="No internal media yet"
                emptyDescription="This foundation is ready to show internal company-owned assets grouped by the same categories. Safe upload/manage controls arrive in a later ticket."
              />
            </div>
          </section>
        ) : null}
      </div>
    </DashboardLayout>
  );
}

function LibraryBody({
  groups,
  loading,
  error,
  emptyTitle,
  emptyDescription,
  readOnly = false,
}: {
  groups: AssetCategoryItemGroup<CompanyAdminMediaItem>[];
  loading: boolean;
  error: string | null;
  emptyTitle: string;
  emptyDescription: string;
  readOnly?: boolean;
}) {
  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading media…</p>;
  }

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
        Could not load media library. Try again later.
      </div>
    );
  }

  if (groups.length === 0) {
    return <EmptyLibrary title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <CategoryGroup key={group.section.id} group={group} readOnly={readOnly} />
      ))}
    </div>
  );
}

function CategoryGroup({
  group,
  readOnly,
}: {
  group: AssetCategoryItemGroup<CompanyAdminMediaItem>;
  readOnly: boolean;
}) {
  return (
    <section className="rounded-xl border border-border bg-background/40 p-4" data-testid={`media-category-${group.section.id}`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">{group.section.label}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{group.section.description}</p>
        </div>
        <Badge variant="secondary">{group.items.length} {group.items.length === 1 ? "asset" : "assets"}</Badge>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {group.items.map((item) => (
          <MediaAssetCard key={item.asset.id} item={item} readOnly={readOnly} />
        ))}
      </div>
    </section>
  );
}

function MediaAssetCard({ item, readOnly }: { item: CompanyAdminMediaItem; readOnly: boolean }) {
  const title = item.asset.title ?? item.asset.name;
  const isImage = item.asset.assetType === "image" || item.asset.assetType === "icon";

  return (
    <article className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="aspect-[16/10] bg-muted/50">
        {isImage && item.urls?.thumbUrl ? (
          <img src={item.urls.thumbUrl} alt={title} className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <ImageOff className="h-8 w-8" aria-hidden="true" />
          </div>
        )}
      </div>
      <div className="space-y-3 p-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{title}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{item.asset.name}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline" className="gap-1">
            <ImageIcon className="h-3 w-3" />
            {item.asset.assetType}
          </Badge>
          <span>{formatBytes(item.asset.fileSize ?? 0)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {readOnly || item.isReadOnly ? (
            <Badge variant="outline" className="gap-1 border-transparent bg-sky-500/10 text-sky-600 dark:text-sky-400">
              <Lock className="h-3 w-3" /> Global
            </Badge>
          ) : (
            <Badge variant="outline" className="border-transparent bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              Internal
            </Badge>
          )}
          <Badge
            variant="outline"
            className={cn(
              "border-transparent",
              item.canSelect
                ? "bg-primary/10 text-primary"
                : "bg-amber-500/10 text-amber-600 dark:text-amber-400",
            )}
          >
            {item.canSelect ? "Selectable" : "Legacy only"}
          </Badge>
        </div>
      </div>
    </article>
  );
}

function EmptyLibrary({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-muted/25 p-6 text-center">
      <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-background text-muted-foreground">
        <ImageOff className="h-5 w-5" />
      </div>
      <h3 className="mt-3 text-sm font-semibold">{title}</h3>
      <p className="mx-auto mt-1 max-w-xl text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
