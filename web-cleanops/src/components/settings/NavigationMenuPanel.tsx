import { useCallback, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  Eye,
  EyeOff,
  Globe,
  Loader2,
  Lock,
  Pencil,
  RefreshCw,
  RotateCcw,
} from "lucide-react";

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
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useApp } from "@/context/AppContext";
import { useToast } from "@/hooks/use-toast";
import { useNavigationConfig } from "@/hooks/use-navigation-config-admin";
import {
  getNavigationIcon,
  NAVIGATION_ICON_KEYS,
  type NavigationIconKey,
} from "@/lib/navigation/iconRegistry";
import {
  NAVIGATION_GROUP_KEYS,
  NAVIGATION_GROUP_TITLES,
  NAVIGATION_PLANNED_GROUPS,
  navigationGroupState,
  type AdminNavigationItem,
  type NavigationCategoryState,
  type NavigationGroupKey,
} from "@/lib/navigation/navigationRegistry";
import { MAX_CUSTOM_LABEL_LENGTH, type OverrideDraft } from "@/lib/navigation/navigationOverridesAdmin";

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong. No change was saved.";
}

/** A small, consistent status chip for the navigation editor. */
function Chip({
  tone,
  children,
}: {
  tone: "green" | "amber" | "blue" | "muted";
  children: React.ReactNode;
}) {
  const cls = {
    green: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    blue: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
    muted: "bg-muted text-muted-foreground",
  }[tone];
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-medium", cls)}>
      {children}
    </span>
  );
}

/** A muted "locked" read-only field used for technical, non-editable values. */
function LockedField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
        <Lock className="h-3 w-3" />
        {value}
      </span>
    </div>
  );
}

// ── Edit dialog ──────────────────────────────────────────────────────────────

function EditMenuItemDialog({
  item,
  open,
  isSaving,
  onClose,
  onSave,
  onReset,
}: {
  item: AdminNavigationItem;
  open: boolean;
  isSaving: boolean;
  onClose: () => void;
  onSave: (draft: OverrideDraft) => Promise<void>;
  onReset: (menuKey: string) => Promise<void>;
}) {
  const { registry } = item;
  const [label, setLabel] = useState<string>(item.override?.customLabel ?? "");
  const [iconKey, setIconKey] = useState<NavigationIconKey | null>(
    (item.override?.customIcon as NavigationIconKey | null | undefined) ?? null,
  );
  const [sortOrder, setSortOrder] = useState<string>(String(item.resolvedSortOrder));
  const [isVisible, setIsVisible] = useState<boolean>(item.isVisible);
  const [error, setError] = useState<string | null>(null);

  const parsedSort = sortOrder.trim() === "" ? null : Number(sortOrder);
  const sortInvalid = parsedSort !== null && (!Number.isFinite(parsedSort) || !Number.isInteger(parsedSort));
  const labelTooLong = label.trim().length > MAX_CUSTOM_LABEL_LENGTH;

  const handleSave = useCallback(async () => {
    setError(null);
    try {
      await onSave({
        menuKey: registry.key,
        customLabel: label.trim() === "" ? null : label.trim(),
        customIcon: iconKey,
        sortOrder: parsedSort,
        isVisible,
      });
      onClose();
    } catch (err) {
      setError(toErrorMessage(err));
    }
  }, [onSave, registry.key, label, iconKey, parsedSort, isVisible, onClose]);

  const handleReset = useCallback(async () => {
    setError(null);
    try {
      await onReset(registry.key);
      onClose();
    } catch (err) {
      setError(toErrorMessage(err));
    }
  }, [onReset, registry.key, onClose]);

  const effectiveIcon = iconKey ?? registry.defaultIcon;

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Customize menu item</DialogTitle>
          <DialogDescription>
            Change how this item appears. Presentation only — it never changes who can access it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Locked technical fields (read-only) */}
          <div className="space-y-2">
            <LockedField label="Menu key" value={registry.key} />
            <LockedField label="Route / section" value={registry.route ?? registry.section ?? "—"} />
            <LockedField label="Permission" value={registry.permissionKey ?? "—"} />
          </div>

          {/* Custom label */}
          <div className="space-y-1.5">
            <Label htmlFor="nav-label">Custom label</Label>
            <Input
              id="nav-label"
              value={label}
              maxLength={MAX_CUSTOM_LABEL_LENGTH + 10}
              placeholder={`Default: ${registry.defaultLabel}`}
              onChange={(e) => setLabel(e.target.value)}
            />
            <p className={cn("text-[11px]", labelTooLong ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}>
              Leave blank to use the default ({registry.defaultLabel}). Max {MAX_CUSTOM_LABEL_LENGTH} characters.
            </p>
          </div>

          {/* Icon picker (controlled set only) */}
          <div className="space-y-1.5">
            <Label>Icon</Label>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant={iconKey === null ? "default" : "outline"}
                onClick={() => setIconKey(null)}
              >
                Default
              </Button>
              <span className="text-[11px] text-muted-foreground">
                Currently: {effectiveIcon}
              </span>
            </div>
            <div className="mt-1 grid grid-cols-8 gap-1.5 rounded-xl border border-border bg-muted/20 p-2">
              {NAVIGATION_ICON_KEYS.map((key) => {
                const Icon = getNavigationIcon(key);
                const selected = iconKey === key;
                return (
                  <button
                    key={key}
                    type="button"
                    aria-label={`Icon ${key}`}
                    aria-pressed={selected}
                    title={key}
                    onClick={() => setIconKey(key)}
                    className={cn(
                      "flex h-9 items-center justify-center rounded-lg border transition-colors",
                      selected
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </button>
                );
              })}
            </div>
          </div>

          {/* Sort order + visibility */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="nav-sort">Sort order</Label>
              <Input
                id="nav-sort"
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
              />
              {sortInvalid ? (
                <p className="text-[11px] text-red-600 dark:text-red-400">Must be a whole number.</p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nav-visible">Visibility</Label>
              <div className="flex h-10 items-center gap-2 rounded-md border border-border px-3">
                <Switch id="nav-visible" checked={isVisible} onCheckedChange={setIsVisible} aria-label="Visible" />
                <span className="text-sm text-muted-foreground">{isVisible ? "Shown in menu" : "Hidden from menu"}</span>
              </div>
            </div>
          </div>

          <p className="flex items-start gap-1.5 rounded-lg border border-border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Hiding an item only removes it from the menu. It does not change route access — the permission check stays
            authoritative.
          </p>

          {error ? (
            <p className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
          <Button type="button" variant="ghost" onClick={handleReset} disabled={isSaving} className="text-muted-foreground">
            <RotateCcw className="h-4 w-4" /> Reset to default
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={isSaving}>
              Cancel
            </Button>
            <Button type="button" onClick={handleSave} disabled={isSaving || sortInvalid || labelTooLong}>
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Item card ────────────────────────────────────────────────────────────────

function MenuItemCard({ item, onEdit }: { item: AdminNavigationItem; onEdit: () => void }) {
  const Icon = getNavigationIcon(item.resolvedIconKey);
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h4 className="truncate text-sm font-semibold">{item.resolvedLabel}</h4>
            {item.hasOverride ? <Chip tone="blue">Customized</Chip> : null}
            <Chip tone={item.isVisible ? "green" : "muted"}>
              {item.isVisible ? (
                <>
                  <Eye className="h-3 w-3" /> Visible
                </>
              ) : (
                <>
                  <EyeOff className="h-3 w-3" /> Hidden
                </>
              )}
            </Chip>
          </div>
          <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">{item.registry.key}</p>
        </div>
      </div>

      <dl className="space-y-1 text-[11px]">
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Default label</dt>
          <dd className="font-medium">{item.registry.defaultLabel}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Route / section</dt>
          <dd className="font-mono">{item.registry.route ?? item.registry.section ?? "—"}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Permission</dt>
          <dd className="font-mono">{item.registry.permissionKey ?? "—"}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Sort order</dt>
          <dd className="tabular-nums">{item.resolvedSortOrder}</dd>
        </div>
      </dl>

      <div className="flex justify-end">
        <Button type="button" size="sm" variant="outline" aria-label={`Edit ${item.resolvedLabel}`} onClick={onEdit}>
          <Pencil className="h-3.5 w-3.5" /> Edit
        </Button>
      </div>
    </div>
  );
}

// ── Category state badge ──────────────────────────────────────────────────────

/** Maps a category's lifecycle state to its badge label + tone (pure, tested). */
export function categoryStateBadge(state: NavigationCategoryState): {
  label: string;
  tone: "green" | "amber" | "muted";
} {
  switch (state) {
    case "live":
      return { label: "Live", tone: "green" };
    case "registered":
      return { label: "Registered", tone: "amber" };
    case "coming_soon":
      return { label: "Coming soon", tone: "muted" };
  }
}

function StateBadge({ state }: { state: NavigationCategoryState }) {
  const { label, tone } = categoryStateBadge(state);
  return <Chip tone={tone}>{label}</Chip>;
}

// ── Language selector (future-ready; English only for now) ────────────────────

/**
 * The label languages the registry is designed to support later. Only English
 * is active in this slice — the others are shown disabled to communicate that
 * the menu registry (stable translation keys per item) is the foundation for
 * future multi-language labels. No translation engine is built yet.
 */
const MENU_LANGUAGES: { code: string; label: string; active: boolean }[] = [
  { code: "en-US", label: "English", active: true },
  { code: "sv-SE", label: "Svenska", active: false },
  { code: "nb-NO", label: "Norsk", active: false },
  { code: "da-DK", label: "Dansk", active: false },
];

function LanguageSelector() {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Globe className="h-3.5 w-3.5" /> Language
      </div>
      <div className="flex flex-wrap gap-2">
        {MENU_LANGUAGES.map((lang) =>
          lang.active ? (
            <button
              key={lang.code}
              type="button"
              aria-pressed
              className="inline-flex items-center gap-1.5 rounded-xl border border-primary bg-primary/10 px-3.5 py-1.5 text-sm font-medium text-primary"
            >
              {lang.label}
            </button>
          ) : (
            <button
              key={lang.code}
              type="button"
              disabled
              title="More languages are coming soon"
              className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-xl border border-border bg-card px-3.5 py-1.5 text-sm font-medium text-muted-foreground opacity-50"
            >
              {lang.label}
              <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-semibold">Soon</span>
            </button>
          ),
        )}
      </div>
    </div>
  );
}

// ── Category selector ─────────────────────────────────────────────────────────

interface CategoryDescriptor {
  key: string;
  title: string;
  state: NavigationCategoryState;
  /** A registered group resolves to a real registry group; planned ones don't. */
  group: NavigationGroupKey | null;
}

function CategoryButton({
  category,
  selected,
  onSelect,
}: {
  category: CategoryDescriptor;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      aria-label={category.title}
      onClick={onSelect}
      className={cn(
        "inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-medium transition-colors",
        selected
          ? "border-primary bg-primary/10 text-primary"
          : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <span className="max-w-[12rem] truncate">{category.title}</span>
      <StateBadge state={category.state} />
    </button>
  );
}

// ── Panel ────────────────────────────────────────────────────────────────────

/**
 * Super-Admin Navigation & Menus settings surface (Slice 11A; categorized in
 * Slice 11C). Menu groups are shown as compact category buttons — only the
 * selected category's items render, so the page is no longer a wall of every
 * group at once. A future-ready language selector sits above the categories.
 * Within a category the Super Admin safely customizes presentation (label,
 * icon, order, visibility) or resets to default; technical fields (key, route,
 * section, permission, group) are read-only. The permission system stays
 * authoritative — customization never grants access.
 */
export function NavigationMenuPanel() {
  const { currentUser, hasPermission } = useApp();
  const { toast } = useToast();
  const cfg = useNavigationConfig();

  const categories = useMemo<CategoryDescriptor[]>(
    () => [
      ...NAVIGATION_GROUP_KEYS.map((group) => ({
        key: group,
        title: NAVIGATION_GROUP_TITLES[group],
        state: navigationGroupState(group),
        group,
      })),
      ...NAVIGATION_PLANNED_GROUPS.map((planned) => ({
        key: planned.key,
        title: planned.title,
        state: "coming_soon" as const,
        group: null,
      })),
    ],
    [],
  );

  const [activeKey, setActiveKey] = useState<string>(categories[0]?.key ?? "");
  const [editingKey, setEditingKey] = useState<string | null>(null);

  const activeCategory = useMemo(
    () => categories.find((c) => c.key === activeKey) ?? categories[0] ?? null,
    [categories, activeKey],
  );

  const items = useMemo<AdminNavigationItem[]>(
    () => (activeCategory?.group ? cfg.adminGroup(activeCategory.group) : []),
    [cfg, activeCategory],
  );

  const editingItem = useMemo<AdminNavigationItem | null>(
    () => (editingKey === null ? null : items.find((i) => i.registry.key === editingKey) ?? null),
    [editingKey, items],
  );

  // Defense in depth on top of the Settings tab gate.
  if (currentUser?.role !== "super_admin" || !hasPermission("navigation.manage")) {
    return (
      <div className="rounded-2xl border border-border bg-muted/40 px-4 py-6 text-sm text-muted-foreground">
        You don't have permission to manage navigation &amp; menus.
      </div>
    );
  }

  const handleSave = async (draft: OverrideDraft) => {
    await cfg.saveOverride(draft);
    toast({ title: "Menu updated", description: "Your navigation change has been saved." });
  };

  const handleReset = async (menuKey: string) => {
    await cfg.resetOverride(menuKey);
    toast({ title: "Reset to default", description: "This item now uses its default presentation." });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-2 rounded-xl border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <p>
          Rename, re-icon, reorder or hide menu items. This changes presentation only — the permission system stays
          authoritative, so a hidden item is still access-controlled and a visible item still only appears for users who
          already hold its permission.
        </p>
      </div>

      <LanguageSelector />

      {/* Category selector — only the selected category's items render below. */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">Menu category</p>
        <div role="tablist" aria-label="Menu category" className="flex flex-wrap gap-2">
          {categories.map((category) => (
            <CategoryButton
              key={category.key}
              category={category}
              selected={category.key === activeKey}
              onSelect={() => {
                setActiveKey(category.key);
                setEditingKey(null);
              }}
            />
          ))}
        </div>
      </div>

      {cfg.error ? (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-red-600 dark:text-red-400">
            <AlertTriangle className="h-4 w-4" /> Could not load navigation overrides
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{cfg.error.message}</p>
          <Button variant="outline" className="mt-3" onClick={cfg.refetch}>
            <RefreshCw className="h-4 w-4" /> Try again
          </Button>
        </div>
      ) : null}

      {/* Selected-category content. */}
      {activeCategory ? (
        <section className="space-y-3" aria-label={`${activeCategory.title} menu items`}>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">{activeCategory.title}</h3>
            {activeCategory.group ? <Chip tone="muted">{items.length}</Chip> : null}
            <StateBadge state={activeCategory.state} />
          </div>

          {activeCategory.group === null ? (
            <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-8 text-center">
              <p className="text-sm font-semibold">{activeCategory.title} is coming soon</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                This menu isn't part of the navigation registry yet. Once its menu is migrated, its items will appear
                here for customization.
              </p>
            </div>
          ) : cfg.isLoading ? (
            <div className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-card p-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading menus…
            </div>
          ) : (
            <>
              {activeCategory.state === "registered" ? (
                <p className="text-[11px] text-muted-foreground">
                  Registered for customization. This menu still renders from its existing component and will consume
                  overrides in a later slice.
                </p>
              ) : null}
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
                {items.map((item) => (
                  <MenuItemCard key={item.registry.key} item={item} onEdit={() => setEditingKey(item.registry.key)} />
                ))}
              </div>
            </>
          )}
        </section>
      ) : null}

      {editingItem ? (
        <EditMenuItemDialog
          key={editingItem.registry.key}
          item={editingItem}
          open
          isSaving={cfg.isSaving}
          onClose={() => setEditingKey(null)}
          onSave={handleSave}
          onReset={handleReset}
        />
      ) : null}
    </div>
  );
}
