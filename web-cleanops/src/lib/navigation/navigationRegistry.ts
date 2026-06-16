import type { UserRole } from "@/types";
import { isNavigationIconKey, type NavigationIconKey } from "./iconRegistry";

/**
 * Navigation & Menu Registry (Slice 11A).
 *
 * The single, system-managed source of truth for menu/navigation presentation.
 * It is intentionally split into three layers (see
 * docs/design/navigation-and-menu-design-standard.md):
 *
 *   • TECHNICAL REGISTRY (this file) — stable, NEVER user-editable truth:
 *     key, group, route, section, permissionKey, defaultIcon, defaultLabel,
 *     translationKey, roleContext, lockedTechnicalFields.
 *   • CUSTOMIZATION LAYER — Super-Admin presentation overrides (custom label /
 *     custom icon / sort order / visibility), stored separately and merged in.
 *   • TRANSLATION LAYER (future) — translationKey resolves to a localized label;
 *     no engine is built yet, only the key structure.
 *
 * SECURITY: customization is presentation only. The `permissionKey` here stays
 * authoritative — {@link resolveNavigationGroup} filters by it, so a visible
 * override can never reveal an item the user lacks permission for, and hiding an
 * item never changes route access.
 */

/** The menu groups registered in this slice. */
export type NavigationGroupKey = "main_navigation" | "customer_card" | "calculator";

/** Technical fields that are locked — never editable through customization. */
export const LOCKED_TECHNICAL_FIELDS = [
  "key",
  "group",
  "route",
  "section",
  "permissionKey",
  "roleContext",
] as const;

export interface NavigationRegistryItem {
  /** Stable, globally-unique menu key (e.g. "calculator.pricing"). Never a label. */
  key: string;
  group: NavigationGroupKey;
  /** Fallback label used when no custom label / translation is resolved. */
  defaultLabel: string;
  /** Stable key a future language engine resolves to a localized label. */
  translationKey: string;
  /** Default icon key from the controlled icon set. */
  defaultIcon: NavigationIconKey;
  /**
   * Authoritative permission gate. `null` means the item carries no extra gate
   * of its own (its parent route/section already enforces access).
   */
  permissionKey: string | null;
  /** Route this item points at (null for in-page sections that share a route). */
  route: string | null;
  /** In-page tab/section id (null for top-level routes). */
  section: string | null;
  sortOrder: number;
  roleContext: UserRole[];
  /** The technical fields that may never be edited via customization. */
  lockedTechnicalFields: readonly string[];
}

/** Human display title for each registered group (admin UI grouping). */
export const NAVIGATION_GROUP_TITLES: Record<NavigationGroupKey, string> = {
  main_navigation: "Main Navigation",
  customer_card: "Customer Card",
  calculator: "Calculator",
};

/**
 * Whether a group's overrides are actually CONSUMED by the live UI yet. The
 * Calculator tabs read the registry/override layer in this slice; Main
 * Navigation and Customer Card are registered for visibility/customization but
 * continue to render from their existing components until migrated later.
 */
export const NAVIGATION_GROUP_APPLIED: Record<NavigationGroupKey, boolean> = {
  calculator: true,
  customer_card: true,
  // Slice 11C: the sidebar now consumes label/icon/visibility overrides for the
  // routes it manages (see resolveMainNavPresentationByRoute). Sort-order
  // reordering for the sidebar is intentionally deferred — it is composed of
  // curated sections, so a global registry order would break their grouping.
  main_navigation: true,
};

/** Presentation state of a category shown in the Navigation & Menus settings UI. */
export type NavigationCategoryState = "live" | "registered" | "coming_soon";

/**
 * Whether a registered group's overrides are CONSUMED by the live UI ("live")
 * or only registered for customization ("registered"). Planned-but-unbuilt
 * groups are surfaced separately via {@link NAVIGATION_PLANNED_GROUPS}.
 */
export function navigationGroupState(group: NavigationGroupKey): NavigationCategoryState {
  return NAVIGATION_GROUP_APPLIED[group] ? "live" : "registered";
}

/** A planned menu group surfaced as "coming soon" in settings (not yet registered). */
export interface PlannedNavigationGroup {
  key: string;
  title: string;
}

/**
 * Groups that are planned but not yet part of the technical registry. They
 * appear in the Navigation & Menus settings UI as "coming soon" categories so
 * the roadmap stays visible, but carry no editable items until registered.
 */
export const NAVIGATION_PLANNED_GROUPS: PlannedNavigationGroup[] = [
  { key: "employee_card", title: "Employee Card" },
];

function item(
  partial: Omit<NavigationRegistryItem, "lockedTechnicalFields">,
): NavigationRegistryItem {
  return { ...partial, lockedTechnicalFields: LOCKED_TECHNICAL_FIELDS };
}

/**
 * The registry. Keep keys stable — they are the join point for overrides and
 * future translations. Sort orders leave gaps (10/20/30…) so reordering does
 * not require renumbering neighbours.
 */
export const NAVIGATION_REGISTRY: NavigationRegistryItem[] = [
  // ── Calculator tabs (Super-Admin only; CONSUMED by /calculator this slice) ──
  item({
    key: "calculator.overview",
    group: "calculator",
    defaultLabel: "Overview",
    translationKey: "calculator.overview",
    defaultIcon: "Database",
    permissionKey: "calculator.manage",
    route: "/calculator",
    section: "overview",
    sortOrder: 10,
    roleContext: ["super_admin"],
  }),
  item({
    key: "calculator.fields",
    group: "calculator",
    defaultLabel: "Fields",
    translationKey: "calculator.fields",
    defaultIcon: "Sparkles",
    permissionKey: "calculator.manage",
    route: "/calculator",
    section: "services",
    sortOrder: 20,
    roleContext: ["super_admin"],
  }),
  item({
    key: "calculator.plans",
    group: "calculator",
    defaultLabel: "Plans",
    translationKey: "calculator.plans",
    defaultIcon: "Layers",
    permissionKey: "calculator.manage",
    route: "/calculator",
    section: "plans",
    sortOrder: 30,
    roleContext: ["super_admin"],
  }),
  item({
    key: "calculator.pricing",
    group: "calculator",
    defaultLabel: "Pricing",
    translationKey: "calculator.pricing",
    defaultIcon: "SlidersHorizontal",
    permissionKey: "calculator.manage",
    route: "/calculator",
    section: "pricing",
    sortOrder: 40,
    roleContext: ["super_admin"],
  }),
  item({
    key: "calculator.addons",
    group: "calculator",
    defaultLabel: "Add-ons",
    translationKey: "calculator.addons",
    defaultIcon: "ListChecks",
    permissionKey: "calculator.manage",
    route: "/calculator",
    section: "addons",
    sortOrder: 45,
    roleContext: ["super_admin"],
  }),
  item({
    key: "calculator.settings",
    group: "calculator",
    defaultLabel: "Settings",
    translationKey: "calculator.settings",
    defaultIcon: "ShieldCheck",
    permissionKey: "calculator.manage",
    route: "/calculator",
    section: "settings",
    sortOrder: 50,
    roleContext: ["super_admin"],
  }),
  item({
    key: "calculator.requests",
    group: "calculator",
    defaultLabel: "Requests",
    translationKey: "calculator.requests",
    defaultIcon: "Receipt",
    permissionKey: "calculator.manage",
    route: "/calculator",
    section: "requests",
    sortOrder: 60,
    roleContext: ["super_admin"],
  }),

  // ── Main navigation (registered; not yet consuming overrides) ──────────────
  item({
    key: "main.dashboard",
    group: "main_navigation",
    defaultLabel: "Overview",
    translationKey: "main.dashboard",
    defaultIcon: "LayoutDashboard",
    permissionKey: "dashboard.view",
    route: "/dashboard",
    section: null,
    sortOrder: 10,
    roleContext: ["super_admin", "company_admin", "employee"],
  }),
  item({
    key: "main.companies",
    group: "main_navigation",
    defaultLabel: "Companies",
    translationKey: "main.companies",
    defaultIcon: "Building2",
    permissionKey: "companies.manage",
    route: "/companies",
    section: null,
    sortOrder: 20,
    roleContext: ["super_admin"],
  }),
  item({
    key: "main.users",
    group: "main_navigation",
    defaultLabel: "Users",
    translationKey: "main.users",
    defaultIcon: "Users",
    permissionKey: "users.manage",
    route: "/users",
    section: null,
    sortOrder: 30,
    roleContext: ["super_admin", "company_admin"],
  }),
  item({
    key: "main.customers",
    group: "main_navigation",
    defaultLabel: "Customers",
    translationKey: "main.customers",
    defaultIcon: "UserCheck",
    permissionKey: "users.manage",
    route: "/customers",
    section: null,
    sortOrder: 40,
    roleContext: ["super_admin", "company_admin"],
  }),
  item({
    key: "main.employees",
    group: "main_navigation",
    defaultLabel: "Employees",
    translationKey: "main.employees",
    defaultIcon: "Briefcase",
    permissionKey: "users.manage",
    route: "/employees",
    section: null,
    sortOrder: 50,
    roleContext: ["super_admin", "company_admin"],
  }),
  item({
    key: "main.media",
    group: "main_navigation",
    defaultLabel: "Media Center",
    translationKey: "main.media",
    defaultIcon: "Images",
    permissionKey: "settings_templates.manage",
    route: "/media-center",
    section: null,
    sortOrder: 60,
    roleContext: ["super_admin"],
  }),
  item({
    key: "main.calculator",
    group: "main_navigation",
    defaultLabel: "Calculator",
    translationKey: "main.calculator",
    defaultIcon: "Calculator",
    permissionKey: "calculator.manage",
    route: "/calculator",
    section: null,
    sortOrder: 70,
    roleContext: ["super_admin"],
  }),
  item({
    key: "main.settings",
    group: "main_navigation",
    defaultLabel: "Settings",
    translationKey: "main.settings",
    defaultIcon: "Settings",
    permissionKey: "settings.manage",
    route: "/settings",
    section: null,
    sortOrder: 80,
    roleContext: ["super_admin", "company_admin"],
  }),

  // ── Customer Card menu (the design reference; registered, not yet applied) ──
  item({
    key: "customer_card.contact",
    group: "customer_card",
    defaultLabel: "Contact",
    translationKey: "customer_card.contact",
    defaultIcon: "User",
    permissionKey: "users.manage",
    route: null,
    section: "contact",
    sortOrder: 10,
    roleContext: ["super_admin", "company_admin"],
  }),
  item({
    key: "customer_card.work_order",
    group: "customer_card",
    defaultLabel: "Work-order",
    translationKey: "customer_card.work_order",
    defaultIcon: "ClipboardList",
    permissionKey: "users.manage",
    route: null,
    section: "work_order",
    sortOrder: 20,
    roleContext: ["super_admin", "company_admin"],
  }),
  item({
    key: "customer_card.days_times",
    group: "customer_card",
    defaultLabel: "Days & Times",
    translationKey: "customer_card.days_times",
    defaultIcon: "CalendarClock",
    permissionKey: "users.manage",
    route: null,
    section: "days_times",
    sortOrder: 30,
    roleContext: ["super_admin", "company_admin"],
  }),
  item({
    key: "customer_card.cleaning_protocol",
    group: "customer_card",
    defaultLabel: "Cleaning Protocol",
    translationKey: "customer_card.cleaning_protocol",
    defaultIcon: "ListChecks",
    permissionKey: "users.manage",
    route: null,
    section: "cleaning_protocol",
    sortOrder: 40,
    roleContext: ["super_admin", "company_admin"],
  }),
  item({
    key: "customer_card.reports",
    group: "customer_card",
    defaultLabel: "Reports",
    translationKey: "customer_card.reports",
    defaultIcon: "FileText",
    permissionKey: "users.manage",
    route: null,
    section: "reports",
    sortOrder: 50,
    roleContext: ["super_admin", "company_admin"],
  }),
  item({
    key: "customer_card.invoice",
    group: "customer_card",
    defaultLabel: "Invoice",
    translationKey: "customer_card.invoice",
    defaultIcon: "Receipt",
    permissionKey: "users.manage",
    route: null,
    section: "invoice",
    sortOrder: 60,
    roleContext: ["super_admin", "company_admin"],
  }),
  item({
    key: "customer_card.notes",
    group: "customer_card",
    defaultLabel: "Notes",
    translationKey: "customer_card.notes",
    defaultIcon: "FileText",
    permissionKey: "users.manage",
    route: null,
    section: "notes",
    sortOrder: 70,
    roleContext: ["super_admin", "company_admin"],
  }),
  item({
    key: "customer_card.keys_alarm",
    group: "customer_card",
    defaultLabel: "Keys & Alarm",
    translationKey: "customer_card.keys_alarm",
    defaultIcon: "KeyRound",
    permissionKey: "users.manage",
    route: null,
    section: "keys_alarm",
    sortOrder: 80,
    roleContext: ["super_admin", "company_admin"],
  }),
  item({
    key: "customer_card.media",
    group: "customer_card",
    defaultLabel: "Media",
    translationKey: "customer_card.media",
    defaultIcon: "Images",
    permissionKey: "users.manage",
    route: null,
    section: "media",
    sortOrder: 90,
    roleContext: ["super_admin", "company_admin"],
  }),
  item({
    key: "customer_card.my_request",
    group: "customer_card",
    defaultLabel: "My Request",
    translationKey: "customer_card.my_request",
    defaultIcon: "Inbox",
    permissionKey: "users.manage",
    route: null,
    section: "my_request",
    sortOrder: 100,
    roleContext: ["super_admin", "company_admin"],
  }),
  item({
    key: "customer_card.log",
    group: "customer_card",
    defaultLabel: "Log",
    translationKey: "customer_card.log",
    defaultIcon: "ScrollText",
    permissionKey: "users.manage",
    route: null,
    section: "log",
    sortOrder: 110,
    roleContext: ["super_admin", "company_admin"],
  }),
];

// ── Customization layer (override shape) ─────────────────────────────────────

/** A Super-Admin presentation override for one menu key (no technical fields). */
export interface NavigationMenuOverride {
  menuKey: string;
  customLabel: string | null;
  customIcon: string | null;
  sortOrder: number | null;
  isVisible: boolean;
}

// ── Pure accessors + validation (unit-tested) ────────────────────────────────

/** All registered group keys in display order. */
export const NAVIGATION_GROUP_KEYS: NavigationGroupKey[] = [
  "main_navigation",
  "customer_card",
  "calculator",
];

/** Registry items for one group, sorted by their default sort order. */
export function getRegistryGroup(group: NavigationGroupKey): NavigationRegistryItem[] {
  return NAVIGATION_REGISTRY.filter((i) => i.group === group).sort(
    (a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key),
  );
}

/**
 * Returns any menu keys that appear more than once across the whole registry.
 * Keys MUST be unique — duplicates would make overrides/translations ambiguous.
 * Exported so a unit test can assert the registry stays clean.
 */
export function findDuplicateRegistryKeys(
  items: readonly NavigationRegistryItem[] = NAVIGATION_REGISTRY,
): string[] {
  const seen = new Map<string, number>();
  for (const i of items) seen.set(i.key, (seen.get(i.key) ?? 0) + 1);
  return [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);
}

/** True when every registry key is unique. */
export function isRegistryValid(items: readonly NavigationRegistryItem[] = NAVIGATION_REGISTRY): boolean {
  return findDuplicateRegistryKeys(items).length === 0;
}

function nonEmpty(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

// ── Resolution (registry + overrides), permission-authoritative ──────────────

/** A menu item resolved for actual UI rendering. */
export interface ResolvedNavigationItem {
  key: string;
  group: NavigationGroupKey;
  /** customLabel ?? defaultLabel (never blank). */
  label: string;
  /** customIcon (if a valid icon key) ?? defaultIcon. */
  iconKey: NavigationIconKey;
  permissionKey: string | null;
  route: string | null;
  section: string | null;
  sortOrder: number;
}

function overridesByKey(overrides: readonly NavigationMenuOverride[]): Map<string, NavigationMenuOverride> {
  const map = new Map<string, NavigationMenuOverride>();
  for (const o of overrides) map.set(o.menuKey, o);
  return map;
}

function resolveLabel(item: NavigationRegistryItem, override: NavigationMenuOverride | undefined): string {
  return nonEmpty(override?.customLabel) ?? item.defaultLabel;
}

function resolveIconKey(item: NavigationRegistryItem, override: NavigationMenuOverride | undefined): NavigationIconKey {
  const custom = override?.customIcon;
  return isNavigationIconKey(custom) ? custom : item.defaultIcon;
}

function resolveSortOrder(item: NavigationRegistryItem, override: NavigationMenuOverride | undefined): number {
  return typeof override?.sortOrder === "number" && Number.isFinite(override.sortOrder)
    ? override.sortOrder
    : item.sortOrder;
}

/**
 * Resolves a group's items for ACTUAL menu rendering.
 *
 * Two independent gates are applied, in this order:
 *   1. PERMISSION (authoritative): an item with a `permissionKey` the user does
 *      NOT hold is dropped — customization can never reveal it.
 *   2. VISIBILITY (presentation): an item hidden by an override is dropped from
 *      the UI. This never affects route access — the route + its permission
 *      check are unchanged.
 * The result is sorted by resolved sort order (stable by key).
 */
export function resolveNavigationGroup(
  group: NavigationGroupKey,
  overrides: readonly NavigationMenuOverride[],
  options: { hasPermission: (permission: string) => boolean },
): ResolvedNavigationItem[] {
  const map = overridesByKey(overrides);
  return getRegistryGroup(group)
    .filter((item) => item.permissionKey === null || options.hasPermission(item.permissionKey))
    .filter((item) => map.get(item.key)?.isVisible !== false)
    .map((item) => {
      const override = map.get(item.key);
      return {
        key: item.key,
        group: item.group,
        label: resolveLabel(item, override),
        iconKey: resolveIconKey(item, override),
        permissionKey: item.permissionKey,
        route: item.route,
        section: item.section,
        sortOrder: resolveSortOrder(item, override),
      };
    })
    .sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key));
}

// ── Main-navigation overlay (sidebar) — presentation only, NOT perm-filtered ──

/** Resolved presentation for one main-navigation route (sidebar overlay). */
export interface MainNavPresentation {
  /** Stable registry key (for diagnostics/tests). */
  key: string;
  /** customLabel ?? defaultLabel (never blank). */
  label: string;
  /** Valid customIcon ?? defaultIcon. */
  iconKey: NavigationIconKey;
  /** Presentation visibility — false hides the sidebar item (route access unchanged). */
  isVisible: boolean;
}

/**
 * Resolves the `main_navigation` group's PRESENTATION (label / icon /
 * visibility), keyed by route, for the live sidebar overlay.
 *
 * Unlike {@link resolveNavigationGroup} this is intentionally NOT
 * permission-filtered: the sidebar enforces its own permission gate first, so
 * the overlay is pure presentation and can never reveal an item — it only
 * relabels / re-icons / hides it. Hiding is explicit (`isVisible === false`);
 * with no overrides every managed route resolves to its registry default
 * (visible, default label/icon), so the overlay is a visual no-op until
 * customised. Sort order is deliberately NOT resolved here — the sidebar keeps
 * its curated section grouping.
 */
export function resolveMainNavPresentationByRoute(
  overrides: readonly NavigationMenuOverride[],
): Map<string, MainNavPresentation> {
  const map = overridesByKey(overrides);
  const result = new Map<string, MainNavPresentation>();
  for (const registryItem of getRegistryGroup("main_navigation")) {
    if (registryItem.route === null) continue;
    const override = map.get(registryItem.key);
    result.set(registryItem.route, {
      key: registryItem.key,
      label: resolveLabel(registryItem, override),
      iconKey: resolveIconKey(registryItem, override),
      isVisible: override?.isVisible !== false,
    });
  }
  return result;
}

// ── Admin merge (settings UI) — shows ALL items incl. hidden, not perm-filtered ──

/** A registry item merged with its current override, for the settings editor. */
export interface AdminNavigationItem {
  registry: NavigationRegistryItem;
  /** Resolved presentation (defaults applied) for preview. */
  resolvedLabel: string;
  resolvedIconKey: NavigationIconKey;
  resolvedSortOrder: number;
  isVisible: boolean;
  /** Whether a non-default override currently exists for this item. */
  hasOverride: boolean;
  override: NavigationMenuOverride | null;
}

/** True when an override actually changes anything from the registry defaults. */
export function overrideIsCustomized(
  item: NavigationRegistryItem,
  override: NavigationMenuOverride | null | undefined,
): boolean {
  if (!override) return false;
  const labelChanged = nonEmpty(override.customLabel) !== null && override.customLabel !== item.defaultLabel;
  const iconChanged = isNavigationIconKey(override.customIcon) && override.customIcon !== item.defaultIcon;
  const orderChanged =
    typeof override.sortOrder === "number" && Number.isFinite(override.sortOrder) && override.sortOrder !== item.sortOrder;
  const visibilityChanged = override.isVisible === false;
  return labelChanged || iconChanged || orderChanged || visibilityChanged;
}

/**
 * Merges a group's registry items with overrides for the SETTINGS editor. Unlike
 * {@link resolveNavigationGroup} this is NOT permission-filtered and INCLUDES
 * hidden items, because Super Admin must see and manage every registered item
 * (configuring presentation is not the same as being granted access).
 */
export function mergeAdminNavigationGroup(
  group: NavigationGroupKey,
  overrides: readonly NavigationMenuOverride[],
): AdminNavigationItem[] {
  const map = overridesByKey(overrides);
  return getRegistryGroup(group)
    .map((registry) => {
      const override = map.get(registry.key) ?? null;
      return {
        registry,
        resolvedLabel: resolveLabel(registry, override ?? undefined),
        resolvedIconKey: resolveIconKey(registry, override ?? undefined),
        resolvedSortOrder: resolveSortOrder(registry, override ?? undefined),
        isVisible: override?.isVisible !== false,
        hasOverride: overrideIsCustomized(registry, override),
        override,
      };
    })
    .sort((a, b) => a.resolvedSortOrder - b.resolvedSortOrder || a.registry.key.localeCompare(b.registry.key));
}
