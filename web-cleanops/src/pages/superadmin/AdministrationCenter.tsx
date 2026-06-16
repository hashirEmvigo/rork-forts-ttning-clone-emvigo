import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  BadgeCheck,
  Blocks,
  Building2,
  Calculator,
  ClipboardCheck,
  Compass,
  FileText,
  GitCompare,
  Images,
  Inbox,
  KeyRound,
  Layers3,
  Lock,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { AccessDenied } from "@/components/AccessDenied";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useApp } from "@/context/AppContext";
import {
  getAdministrationCenterCoverageSummary,
  getAdministrationCenterOwnershipArea,
  getAdministrationCenterSections,
  searchAdministrationCenterItems,
  type AdministrationCenterCoverageSummary,
  type AdministrationCenterItem,
  type AdministrationCenterItemScope,
  type AdministrationCenterItemStatus,
  type AdministrationCenterSection,
} from "@/lib/administrationCenter/administrationCenterRegistry";
import { cn } from "@/lib/utils";

export const ADMINISTRATION_CENTER_PATH = "/administration";
export const ADMINISTRATION_CENTER_PERMISSION = "settings_templates.manage";

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  "Companies & Users": Building2,
  "Access & Permissions": KeyRound,
  "Modules & Navigation": Blocks,
  "Services & Pricing": Sparkles,
  "Content & Website": Images,
  Templates: FileText,
  "Operational Registers": ClipboardCheck,
  "Requests & CRM": Inbox,
  "Plans & Entitlements": GitCompare,
  "Platform Settings": Settings,
  "Governance & Logs": ShieldCheck,
};

const ITEM_ICONS: Record<string, LucideIcon> = {
  companies: Building2,
  users: KeyRound,
  "provisioning-workflow": Sparkles,
  "roles-permissions": ShieldCheck,
  "audit-log": ClipboardCheck,
  "cross-role-access-review": KeyRound,
  "platform-modules": Blocks,
  "module-categories": Layers3,
  "navigation-menus": Compass,
  services: Sparkles,
  calculator: Calculator,
  "pricing-diagnostics": BadgeCheck,
  "media-center": Images,
  "website-content-governance": Images,
  "settings-templates": Settings,
  "agreement-templates": FileText,
  "checklist-manager": ClipboardCheck,
  "template-dependency-map": Layers3,
  "system-performance": BadgeCheck,
  "development-center": Blocks,
  "employee-migration": GitCompare,
  "register-search": Search,
  "request-settings": Inbox,
  "request-crm-settings": Settings,
  "admin-requests-operations": Inbox,
  "entitlement-validation": GitCompare,
  "services-entitlement-history": Sparkles,
  "plan-catalogue-overview": Layers3,
  "platform-settings": Settings,
  "configuration-health": BadgeCheck,
  "governance-audit-log": ClipboardCheck,
  "system-performance-governance": ShieldCheck,
  "governance-checklist": ClipboardCheck,
};

function scopeLabel(scope: AdministrationCenterItemScope): string {
  switch (scope) {
    case "super_admin":
      return "Super Admin";
    case "company_admin":
      return "Company Admin";
    case "global":
      return "Shared reference";
    case "future":
      return "Future";
  }
}

function StatusBadge({ status }: { status: AdministrationCenterItemStatus }) {
  const isActive = status === "active";
  return (
    <Badge
      variant="outline"
      className={cn(
        "shrink-0 font-medium",
        isActive
          ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
          : "border-border bg-muted text-muted-foreground",
      )}
    >
      {isActive ? "Existing route" : "Planned"}
    </Badge>
  );
}

function ScopeBadge({ scope }: { scope: AdministrationCenterItemScope }) {
  return (
    <Badge variant="outline" className="border-border bg-background text-[11px] font-medium text-muted-foreground">
      {scopeLabel(scope)}
    </Badge>
  );
}

function HubAction({ item }: { item: AdministrationCenterItem }) {
  if (item.status === "planned" || !item.route) {
    return (
      <Button type="button" variant="outline" size="sm" disabled aria-disabled="true" data-testid="administration-planned-action">
        <Lock className="h-3.5 w-3.5" />
        Later slice
      </Button>
    );
  }

  return (
    <Button asChild variant="outline" size="sm">
      <Link to={item.route} data-testid="administration-existing-link">
        Open existing route
        <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </Button>
  );
}

function CategoryNavButton({
  section,
  selected,
  onSelect,
}: {
  section: AdministrationCenterSection;
  selected: boolean;
  onSelect: () => void;
}) {
  const Icon = CATEGORY_ICONS[section.category.title] ?? Compass;
  const activeItems = section.items.filter((item) => item.status === "active").length;
  return (
    <button
      type="button"
      aria-current={selected ? "page" : undefined}
      onClick={onSelect}
      data-testid={`administration-category-${section.category.id}`}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-sm transition-colors",
        selected
          ? "border-primary bg-primary/10 text-primary shadow-sm"
          : "border-transparent bg-transparent text-muted-foreground hover:border-border hover:bg-muted/50 hover:text-foreground",
      )}
    >
      <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", selected ? "bg-background text-primary" : "bg-muted text-muted-foreground")}>
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{section.category.title}</span>
        <span className="block text-[11px] text-muted-foreground">
          {activeItems} active · {section.items.length - activeItems} planned
        </span>
      </span>
    </button>
  );
}

function ItemMenuButton({
  item,
  selected,
  onSelect,
}: {
  item: AdministrationCenterItem;
  selected: boolean;
  onSelect: () => void;
}) {
  const Icon = ITEM_ICONS[item.id] ?? Compass;
  const isPlanned = item.status === "planned" || !item.route;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      aria-disabled={isPlanned ? "true" : undefined}
      disabled={isPlanned}
      onClick={onSelect}
      data-testid="administration-item-tab"
      className={cn(
        "group relative flex h-20 w-[116px] shrink-0 flex-col items-center justify-start gap-2 whitespace-normal rounded-xl border px-2 py-2.5 text-center text-[11px] font-semibold leading-tight transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-55",
        selected
          ? "border-primary bg-primary/10 text-primary shadow-sm"
          : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
        isPlanned ? "border-dashed" : "",
      )}
    >
      <span className={cn("flex h-8 w-8 items-center justify-center rounded-xl", selected ? "bg-background text-primary" : "bg-muted text-muted-foreground")}>
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="line-clamp-2 min-h-[28px] text-balance">{item.title}</span>
      {isPlanned ? (
        <span className="absolute right-2 top-2 rounded-full bg-muted px-1.5 text-[10px] font-bold text-muted-foreground">
          Planned
        </span>
      ) : null}
    </button>
  );
}

function FocusedItemDetails({ item }: { item: AdministrationCenterItem }) {
  const ownership = getAdministrationCenterOwnershipArea(item.scope);
  const breadcrumb = item.breadcrumb.join(" → ");
  const Icon = ITEM_ICONS[item.id] ?? CATEGORY_ICONS[item.category] ?? Compass;
  return (
    <Card className="rounded-2xl" data-testid="administration-item-detail">
      <CardHeader className="border-b border-border bg-muted/20">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Icon className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <CardTitle className="text-lg">{item.title}</CardTitle>
              <CardDescription className="mt-1">{item.description}</CardDescription>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusBadge status={item.status} />
            <ScopeBadge scope={item.scope} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5 p-5 sm:p-6">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <div className="rounded-xl border border-border bg-background p-4 lg:col-span-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Breadcrumb</p>
            <p className="mt-1 text-sm font-semibold text-foreground">{breadcrumb}</p>
          </div>
          <div className="rounded-xl border border-border bg-background p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Ownership</p>
            <p className="mt-1 text-sm font-semibold text-foreground">{ownership.boundaryLabel}</p>
            <p className="mt-1 text-xs text-muted-foreground">{ownership.title}</p>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-muted/20 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Guardrail</p>
          <p className="mt-1 text-sm text-muted-foreground">{item.accessNote}</p>
          <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
            {item.route ? <span className="rounded-md bg-background px-2 py-1 font-mono">{item.route}</span> : null}
            {item.requiredPermission ? <span className="rounded-md bg-background px-2 py-1">Permission: {item.requiredPermission}</span> : null}
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            Administration Center remains a finder workspace. Destination pages and route guards stay authoritative.
          </p>
          <HubAction item={item} />
        </div>
      </CardContent>
    </Card>
  );
}

function SearchResultRow({ item }: { item: AdministrationCenterItem }) {
  const breadcrumb = item.breadcrumb.join(" → ");
  const Icon = ITEM_ICONS[item.id] ?? CATEGORY_ICONS[item.category] ?? Compass;
  return (
    <div
      className={cn(
        "rounded-xl border p-4 transition-colors",
        item.status === "active" ? "border-border bg-background" : "border-dashed border-border bg-muted/30",
      )}
      data-testid={item.status === "planned" ? "administration-planned-item" : "administration-existing-item"}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="h-4 w-4" aria-hidden="true" />
          </div>
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground">{item.title}</h3>
              <StatusBadge status={item.status} />
              <ScopeBadge scope={item.scope} />
            </div>
            <p className="text-xs font-medium text-muted-foreground">{breadcrumb}</p>
            <p className="text-sm text-muted-foreground">{item.description}</p>
          </div>
        </div>
        <HubAction item={item} />
      </div>
    </div>
  );
}

function SearchResults({ query, results }: { query: string; results: AdministrationCenterItem[] }) {
  const groupedResults = useMemo<AdministrationCenterSection[]>(() => getAdministrationCenterSections(results), [results]);
  const hasQuery = query.trim().length > 0;

  if (!hasQuery) return null;

  return (
    <Card className="rounded-2xl" data-testid="administration-search-results">
      <CardHeader className="border-b border-border bg-muted/20">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-base">Search results</CardTitle>
            <CardDescription>
              Local results from the Administration Center registry. This is not a backend search service or command palette.
            </CardDescription>
          </div>
          <Badge variant="outline">{results.length} result{results.length === 1 ? "" : "s"}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5 p-4 sm:p-5">
        {results.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-muted/30 p-4 text-sm text-muted-foreground">
            No Administration Center registry items match “{query}”.
          </div>
        ) : (
          groupedResults.map((section) => (
            <section key={`search-${section.category.id}`} className="space-y-3">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-foreground">{section.category.title}</p>
                <Badge variant="outline" className="text-[11px]">
                  {section.items.length}
                </Badge>
              </div>
              {section.items.map((item) => (
                <SearchResultRow key={`search-${item.id}`} item={item} />
              ))}
            </section>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function SelectedCategoryWorkspace({ section, selectedItemId, onSelectItem }: {
  section: AdministrationCenterSection;
  selectedItemId: string | null;
  onSelectItem: (itemId: string) => void;
}) {
  const Icon = CATEGORY_ICONS[section.category.title] ?? Compass;
  const selectedItem = section.items.find((item) => item.id === selectedItemId && item.status === "active" && item.route) ??
    section.items.find((item) => item.status === "active" && item.route) ??
    section.items[0] ?? null;

  return (
    <div className="space-y-5" data-testid="administration-selected-category">
      <Card className="rounded-2xl">
        <CardHeader className="border-b border-border bg-muted/20">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Icon className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <CardTitle className="text-lg">{section.category.title}</CardTitle>
              <CardDescription className="mt-1">{section.category.description}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-4 sm:p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Section menu</p>
            <Badge variant="outline" className="text-[11px]">
              {section.items.length} item{section.items.length === 1 ? "" : "s"}
            </Badge>
          </div>
          <div
            role="tablist"
            aria-label={`${section.category.title} items`}
            className="flex flex-wrap gap-2 rounded-2xl border border-border bg-muted/35 p-2"
            data-testid="administration-item-menu"
          >
            {section.items.map((item) => (
              <ItemMenuButton
                key={item.id}
                item={item}
                selected={selectedItem?.id === item.id}
                onSelect={() => onSelectItem(item.id)}
              />
            ))}
          </div>
        </CardContent>
      </Card>

      {selectedItem ? <FocusedItemDetails item={selectedItem} /> : null}
    </div>
  );
}

/** Super Admin Administration Center workspace: left category navigation plus focused registry search/details. */
export default function AdministrationCenter() {
  const { currentUser } = useApp();
  const [searchQuery, setSearchQuery] = useState<string>("");
  const sections = useMemo<AdministrationCenterSection[]>(() => getAdministrationCenterSections(), []);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>(sections[0]?.category.id ?? "");
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  const selectedSection = useMemo<AdministrationCenterSection | null>(
    () => sections.find((section) => section.category.id === selectedCategoryId) ?? sections[0] ?? null,
    [sections, selectedCategoryId],
  );
  const searchResults = useMemo<AdministrationCenterItem[]>(
    () => searchAdministrationCenterItems(searchQuery),
    [searchQuery],
  );
  const coverageSummary = useMemo<AdministrationCenterCoverageSummary>(() => getAdministrationCenterCoverageSummary(), []);
  const hasSearchQuery = searchQuery.trim().length > 0;

  if (currentUser?.role !== "super_admin") return <AccessDenied />;

  return (
    <DashboardLayout wide>
      <PageHeader
        title="Administration Center"
        description="A focused Super Admin workspace for finding existing platform administration surfaces. Destination pages remain the source of truth."
        action={
          <Badge variant="outline" className="border-primary/20 bg-primary/10 text-primary">
            Frontend registry + local search
          </Badge>
        }
      />

      <div className="mb-6 rounded-2xl border border-sky-200 bg-sky-50 px-5 py-4 text-sm text-sky-900 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-100">
        <div className="flex items-start gap-3">
          <Compass className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-semibold">Finder workspace only</p>
            <p className="mt-1">
              Administration Center does not replace Settings, Services, CRM, Calculator, Templates, or Company Admin operations. Use the category panel to focus one area at a time; planned surfaces remain disabled until later slices.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[320px_minmax(0,1fr)]" data-testid="administration-workspace">
        <aside className="space-y-4" data-testid="administration-left-panel">
          <Card className="rounded-2xl xl:sticky xl:top-4">
            <CardHeader className="border-b border-border bg-muted/20">
              <CardTitle className="flex items-center gap-2 text-base">
                <Search className="h-4 w-4 text-primary" />
                Find admin area
              </CardTitle>
              <CardDescription>Local registry search only.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 p-4">
              <div>
                <label className="sr-only" htmlFor="administration-search">
                  Search Administration Center
                </label>
                <Input
                  id="administration-search"
                  data-testid="administration-search-input"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search calculator, quote, requests..."
                />
              </div>

              <div className="grid grid-cols-3 gap-2 rounded-xl border border-border bg-muted/30 p-2 text-center text-[11px] text-muted-foreground">
                <div>
                  <p className="text-sm font-semibold text-foreground">{coverageSummary.activeRoutedItems}</p>
                  <p>active</p>
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">{coverageSummary.categoriesCovered}</p>
                  <p>areas</p>
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">{coverageSummary.plannedUnroutedItems}</p>
                  <p>planned</p>
                </div>
              </div>

              <nav aria-label="Administration Center categories" className="space-y-1" data-testid="administration-category-nav">
                {sections.map((section) => (
                  <CategoryNavButton
                    key={section.category.id}
                    section={section}
                    selected={selectedSection?.category.id === section.category.id}
                    onSelect={() => {
                      setSelectedCategoryId(section.category.id);
                      setSelectedItemId(null);
                    }}
                  />
                ))}
              </nav>
            </CardContent>
          </Card>
        </aside>

        <main className="min-w-0">
          {hasSearchQuery ? (
            <SearchResults query={searchQuery} results={searchResults} />
          ) : selectedSection ? (
            <SelectedCategoryWorkspace
              section={selectedSection}
              selectedItemId={selectedItemId}
              onSelectItem={setSelectedItemId}
            />
          ) : null}
        </main>
      </div>
    </DashboardLayout>
  );
}
