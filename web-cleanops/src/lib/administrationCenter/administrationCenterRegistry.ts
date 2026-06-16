/** Indicates whether a registry destination already has a route or is a later-slice placeholder. */
export type AdministrationCenterItemStatus = "active" | "planned";

/** Describes who owns or is referenced by an Administration Center registry item. */
export type AdministrationCenterItemScope = "super_admin" | "company_admin" | "global" | "future";

/** Registry ownership bucket used for frontend coverage and boundary mapping. */
export interface AdministrationCenterOwnershipArea {
  id: AdministrationCenterItemScope;
  title: string;
  description: string;
  boundaryLabel: string;
}

/** A display category used to group Administration Center registry items. */
export interface AdministrationCenterCategory {
  id: string;
  title: string;
  description: string;
}

/** Display-only discovery metadata for one Administration Center destination or planned surface. */
export interface AdministrationCenterItem {
  id: string;
  title: string;
  category: string;
  description: string;
  route?: string;
  breadcrumb: string[];
  keywords: string[];
  aliases: string[];
  status: AdministrationCenterItemStatus;
  scope: AdministrationCenterItemScope;
  requiredPermission?: string;
  accessNote: string;
  relatedItemIds?: string[];
}

/** Ordered ownership areas used by the Administration Center ownership map. */
export const ADMINISTRATION_CENTER_OWNERSHIP_AREAS: AdministrationCenterOwnershipArea[] = [
  {
    id: "super_admin",
    title: "Super Admin platform governance",
    description: "Platform-level administration surfaces that remain owned by Super Admin workflows and existing route guards.",
    boundaryLabel: "Platform owner",
  },
  {
    id: "company_admin",
    title: "Company Admin operational reference",
    description: "Company-local operational areas that may be referenced by the hub but remain owned by Company Admin workflows.",
    boundaryLabel: "Operational reference",
  },
  {
    id: "global",
    title: "Shared governance reference",
    description: "Cross-role or feature-gated references where the destination keeps its own established access rules.",
    boundaryLabel: "Shared reference",
  },
  {
    id: "future",
    title: "Future planned surface",
    description: "Known gaps and later-slice ideas that are visible for planning only and must not navigate yet.",
    boundaryLabel: "Planned only",
  },
];

const ownershipAreaByScope = new Map(ADMINISTRATION_CENTER_OWNERSHIP_AREAS.map((area) => [area.id, area]));

/** Ordered categories shown on the Administration Center hub. */
export const ADMINISTRATION_CENTER_CATEGORIES: AdministrationCenterCategory[] = [
  {
    id: "companies-users",
    title: "Companies & Users",
    description: "Platform identity, company records, and account administration.",
  },
  {
    id: "access-permissions",
    title: "Access & Permissions",
    description: "Roles, permission review, and platform access governance.",
  },
  {
    id: "modules-navigation",
    title: "Modules & Navigation",
    description: "Module availability and menu presentation controls.",
  },
  {
    id: "services-pricing",
    title: "Services & Pricing",
    description: "Service catalogue, entitlements, and calculator governance surfaces.",
  },
  {
    id: "content-website",
    title: "Content & Website",
    description: "Global assets and public-facing content libraries.",
  },
  {
    id: "templates",
    title: "Templates",
    description: "Global settings, agreements, checklist libraries, and reusable templates.",
  },
  {
    id: "operational-registers",
    title: "Operational Registers",
    description: "Read-only operational references and platform diagnostics.",
  },
  {
    id: "requests-crm",
    title: "Requests & CRM",
    description: "Request governance, CRM settings references, and operational ownership boundaries.",
  },
  {
    id: "plans-entitlements",
    title: "Plans & Entitlements",
    description: "Service plans, entitlement validation, and availability governance.",
  },
  {
    id: "platform-settings",
    title: "Platform Settings",
    description: "Platform-wide configuration and system controls.",
  },
  {
    id: "governance-logs",
    title: "Governance & Logs",
    description: "Auditability, runtime boundaries, and platform governance references.",
  },
];

const categoryById = new Map(ADMINISTRATION_CENTER_CATEGORIES.map((category) => [category.id, category]));

function categoryTitle(categoryId: string): string {
  return categoryById.get(categoryId)?.title ?? categoryId;
}

function item(input: Omit<AdministrationCenterItem, "category" | "breadcrumb"> & { categoryId: string; breadcrumbTail?: string[] }): AdministrationCenterItem {
  const category = categoryTitle(input.categoryId);
  return {
    id: input.id,
    title: input.title,
    category,
    description: input.description,
    route: input.route,
    breadcrumb: [category, ...(input.breadcrumbTail ?? [input.title])],
    keywords: input.keywords,
    aliases: input.aliases,
    status: input.status,
    scope: input.scope,
    requiredPermission: input.requiredPermission,
    accessNote: input.accessNote,
    relatedItemIds: input.relatedItemIds,
  };
}

/** Frontend-only Administration Center registry; route guards remain authoritative. */
export const ADMINISTRATION_CENTER_ITEMS: AdministrationCenterItem[] = [
  item({
    id: "companies",
    title: "Companies",
    categoryId: "companies-users",
    description: "Manage organisations and their platform status.",
    route: "/companies",
    keywords: ["companies", "organisations", "customers", "tenants", "platform accounts"],
    aliases: ["organizations", "clients", "company records"],
    status: "active",
    scope: "super_admin",
    requiredPermission: "companies.manage",
    accessNote: "Existing Companies route guard remains authoritative.",
    relatedItemIds: ["users", "entitlement-validation"],
  }),
  item({
    id: "users",
    title: "Users",
    categoryId: "companies-users",
    description: "Review platform users and account access.",
    route: "/users",
    keywords: ["users", "accounts", "access", "people", "staff"],
    aliases: ["account access", "user admin", "user management"],
    status: "active",
    scope: "super_admin",
    requiredPermission: "users.manage",
    accessNote: "Existing Users route guard remains authoritative.",
    relatedItemIds: ["companies", "roles-permissions"],
  }),
  item({
    id: "provisioning-workflow",
    title: "Provisioning workflow",
    categoryId: "companies-users",
    description: "Central invite and provisioning orchestration belongs in a later slice.",
    keywords: ["provisioning", "invites", "onboarding", "create user"],
    aliases: ["invite workflow", "account provisioning"],
    status: "planned",
    scope: "future",
    accessNote: "Planned item only; no route exists in this slice.",
    relatedItemIds: ["users"],
  }),
  item({
    id: "roles-permissions",
    title: "Roles & permissions",
    categoryId: "access-permissions",
    description: "Open the existing settings role-management tab.",
    route: "/settings?tab=roles",
    keywords: ["roles", "permissions", "access", "authorization", "policy"],
    aliases: ["role management", "permission review", "access control"],
    status: "active",
    scope: "super_admin",
    requiredPermission: "settings.manage",
    accessNote: "Existing Settings route and tab handling remain authoritative.",
    relatedItemIds: ["audit-log", "navigation-menus"],
  }),
  item({
    id: "audit-log",
    title: "Audit log",
    categoryId: "access-permissions",
    description: "Review the existing audit surface in Settings.",
    route: "/settings?tab=audit",
    keywords: ["audit", "activity", "log", "history", "trace"],
    aliases: ["activity log", "audit trail"],
    status: "active",
    scope: "super_admin",
    requiredPermission: "settings.manage",
    accessNote: "Existing Settings route and tab handling remain authoritative.",
    relatedItemIds: ["governance-audit-log", "roles-permissions"],
  }),
  item({
    id: "cross-role-access-review",
    title: "Cross-role access review",
    categoryId: "access-permissions",
    description: "A consolidated access review is planned after the hub foundation.",
    keywords: ["access review", "roles", "permissions", "governance"],
    aliases: ["role audit", "permission audit"],
    status: "planned",
    scope: "future",
    accessNote: "Planned item only; no route exists in this slice.",
    relatedItemIds: ["roles-permissions"],
  }),
  item({
    id: "platform-modules",
    title: "Platform modules",
    categoryId: "modules-navigation",
    description: "Open the existing module-management settings tab.",
    route: "/settings?tab=modules",
    keywords: ["modules", "availability", "features", "module access"],
    aliases: ["module management", "feature modules"],
    status: "active",
    scope: "super_admin",
    requiredPermission: "settings.manage",
    accessNote: "Existing Settings route and tab handling remain authoritative.",
    relatedItemIds: ["navigation-menus", "module-categories"],
  }),
  item({
    id: "module-categories",
    title: "Module categories",
    categoryId: "modules-navigation",
    description: "Maintain the existing category configuration surface.",
    route: "/settings?tab=categories",
    keywords: ["module categories", "categories", "menus", "grouping"],
    aliases: ["category configuration", "module groups"],
    status: "active",
    scope: "super_admin",
    requiredPermission: "settings.manage",
    accessNote: "Existing Settings route and tab handling remain authoritative.",
    relatedItemIds: ["platform-modules", "navigation-menus"],
  }),
  item({
    id: "navigation-menus",
    title: "Navigation & menus",
    categoryId: "modules-navigation",
    description: "Presentation-only menu configuration; route guards remain authoritative.",
    route: "/settings?tab=navigation",
    keywords: ["navigation", "menus", "sidebar", "presentation", "menu registry"],
    aliases: ["nav menus", "sidebar settings", "menu configuration"],
    status: "active",
    scope: "super_admin",
    requiredPermission: "settings.manage",
    accessNote: "Presentation metadata only; it is not a permission system.",
    relatedItemIds: ["platform-modules", "module-categories"],
  }),
  item({
    id: "services",
    title: "Services",
    categoryId: "services-pricing",
    description: "Manage optional features, add-ons, and company service access.",
    route: "/services",
    keywords: ["services", "service catalogue", "add-ons", "pricing", "entitlements"],
    aliases: ["service catalog", "service access", "service management"],
    status: "active",
    scope: "super_admin",
    requiredPermission: "settings_templates.manage",
    accessNote: "Existing Services route guard remains authoritative.",
    relatedItemIds: ["calculator", "entitlement-validation"],
  }),
  item({
    id: "calculator",
    title: "Calculator",
    categoryId: "services-pricing",
    description: "Open the existing calculator control surface without changing runtime behavior.",
    route: "/calculator",
    breadcrumbTail: ["Calculator builder"],
    keywords: [
      "calculator",
      "price calculator",
      "pricing",
      "quote",
      "quotation",
      "estimate",
      "service price",
      "public calculator",
      "calculator builder",
    ],
    aliases: ["quotes", "estimates", "price builder", "pricing calculator", "offer calculator"],
    status: "active",
    scope: "super_admin",
    requiredPermission: "calculator.manage",
    accessNote: "Existing Calculator route guard remains authoritative.",
    relatedItemIds: ["services", "pricing-diagnostics"],
  }),
  item({
    id: "pricing-diagnostics",
    title: "Pricing diagnostics",
    categoryId: "services-pricing",
    description: "A cross-service pricing overview is planned; no search service or backend registry is implemented here.",
    keywords: ["pricing", "diagnostics", "service price", "quote", "estimate", "calculator"],
    aliases: ["price diagnostics", "pricing overview", "quote diagnostics"],
    status: "planned",
    scope: "future",
    accessNote: "Planned item only; no route exists in this slice.",
    relatedItemIds: ["calculator", "services"],
  }),
  item({
    id: "media-center",
    title: "Media Center",
    categoryId: "content-website",
    description: "Manage platform-wide media, website images, documents, and reusable files.",
    route: "/media-center",
    keywords: ["media", "images", "documents", "website", "assets", "files"],
    aliases: ["asset library", "global media", "website assets"],
    status: "active",
    scope: "super_admin",
    requiredPermission: "settings_templates.manage",
    accessNote: "Existing Media Center route guard remains authoritative.",
  }),
  item({
    id: "website-content-governance",
    title: "Website content governance",
    categoryId: "content-website",
    description: "A consolidated website content map is planned for a future slice.",
    keywords: ["website", "content", "governance", "public pages"],
    aliases: ["content map", "website governance"],
    status: "planned",
    scope: "future",
    accessNote: "Planned item only; no route exists in this slice.",
    relatedItemIds: ["media-center"],
  }),
  item({
    id: "settings-templates",
    title: "Settings Templates",
    categoryId: "templates",
    description: "Manage global default settings templates.",
    route: "/settings-templates",
    keywords: ["settings templates", "templates", "global defaults", "configuration"],
    aliases: ["default templates", "global settings templates"],
    status: "active",
    scope: "super_admin",
    requiredPermission: "settings_templates.manage",
    accessNote: "Existing Settings Templates route guard remains authoritative.",
    relatedItemIds: ["agreement-templates", "checklist-manager"],
  }),
  item({
    id: "agreement-templates",
    title: "Agreement Templates",
    categoryId: "templates",
    description: "Maintain existing platform agreement templates.",
    route: "/agreement-templates",
    keywords: ["agreement", "templates", "contracts", "documents"],
    aliases: ["contract templates", "agreement library"],
    status: "active",
    scope: "super_admin",
    requiredPermission: "settings_templates.manage",
    accessNote: "Existing Agreement Templates route guard remains authoritative.",
    relatedItemIds: ["settings-templates"],
  }),
  item({
    id: "checklist-manager",
    title: "Checklist Manager",
    categoryId: "templates",
    description: "Open the existing checklist template management workspace.",
    route: "/modules/checklist-manager",
    keywords: ["checklist", "templates", "protocols", "global templates", "libraries"],
    aliases: ["checklist templates", "protocol templates"],
    status: "active",
    scope: "super_admin",
    requiredPermission: "checklist_templates.view",
    accessNote: "Existing Checklist Manager route guard remains authoritative.",
    relatedItemIds: ["settings-templates"],
  }),
  item({
    id: "template-dependency-map",
    title: "Template dependency map",
    categoryId: "templates",
    description: "A cross-template dependency view is planned, not implemented here.",
    keywords: ["templates", "dependencies", "map", "governance"],
    aliases: ["template map", "dependency map"],
    status: "planned",
    scope: "future",
    accessNote: "Planned item only; no route exists in this slice.",
    relatedItemIds: ["settings-templates", "agreement-templates", "checklist-manager"],
  }),
  item({
    id: "system-performance",
    title: "System Performance",
    categoryId: "operational-registers",
    description: "Inspect existing read-only performance diagnostics.",
    route: "/system-performance",
    keywords: ["system performance", "diagnostics", "health", "monitoring"],
    aliases: ["performance", "system health"],
    status: "active",
    scope: "super_admin",
    requiredPermission: "settings_templates.manage",
    accessNote: "Existing System Performance route guard remains authoritative.",
    relatedItemIds: ["development-center"],
  }),
  item({
    id: "development-center",
    title: "Development Center",
    categoryId: "operational-registers",
    description: "Open the existing internal development and diagnostics workspace.",
    route: "/development-center",
    keywords: ["development", "diagnostics", "developer", "tools"],
    aliases: ["dev center", "development tools"],
    status: "active",
    scope: "super_admin",
    requiredPermission: "settings_templates.manage",
    accessNote: "Existing Development Center route guard remains authoritative.",
    relatedItemIds: ["system-performance"],
  }),
  item({
    id: "employee-migration",
    title: "Employee Migration",
    categoryId: "operational-registers",
    description: "Use the existing migration review and tooling surface.",
    route: "/employee-migration",
    keywords: ["employee migration", "migration", "employees", "import", "review"],
    aliases: ["migration review", "employee import"],
    status: "active",
    scope: "super_admin",
    requiredPermission: "settings_templates.manage",
    accessNote: "Existing Employee Migration route guard remains authoritative.",
  }),
  item({
    id: "register-search",
    title: "Register search",
    categoryId: "operational-registers",
    description: "A unified operational-register search is a later implementation slice.",
    keywords: ["register", "search", "operational", "lookup"],
    aliases: ["registry search", "operational search"],
    status: "planned",
    scope: "future",
    accessNote: "Planned item only; no route exists in this slice.",
  }),
  item({
    id: "request-settings",
    title: "Request Settings",
    categoryId: "requests-crm",
    description: "Global Super Admin governance for Admin Requests.",
    route: "/request-settings",
    keywords: ["request settings", "admin requests", "governance", "requests", "crm"],
    aliases: ["global request settings", "admin request settings"],
    status: "active",
    scope: "super_admin",
    requiredPermission: "settings_templates.manage",
    accessNote: "Existing Super Admin Request Settings route guard remains authoritative.",
    relatedItemIds: ["request-crm-settings", "admin-requests-operations"],
  }),
  item({
    id: "request-crm-settings",
    title: "REQUEST CRM settings shell",
    categoryId: "requests-crm",
    description: "Feature-gated settings shell remains separate from this hub.",
    route: "/crm/settings",
    keywords: ["request crm", "crm settings", "request settings", "admin requests"],
    aliases: ["crm settings shell", "request crm shell"],
    status: "active",
    scope: "global",
    requiredPermission: "requests.settings.view",
    accessNote: "Existing feature flags and CRM settings route guards remain authoritative.",
    relatedItemIds: ["request-settings", "admin-requests-operations"],
  }),
  item({
    id: "admin-requests-operations",
    title: "Admin Requests operations",
    categoryId: "requests-crm",
    description: "Company Admin owns operational request handling under /crm/*; no workflow is embedded here.",
    keywords: ["admin requests", "requests", "crm", "operations", "request list"],
    aliases: ["request operations", "crm requests"],
    status: "planned",
    scope: "company_admin",
    accessNote: "Company Admin operational reference only; the Super Admin hub does not embed this workflow.",
    relatedItemIds: ["request-settings", "request-crm-settings"],
  }),
  item({
    id: "entitlement-validation",
    title: "Entitlement validation",
    categoryId: "plans-entitlements",
    description: "Run the existing read-only shadow validation surface.",
    route: "/entitlement-validation",
    keywords: ["entitlements", "validation", "plans", "services", "access"],
    aliases: ["entitlement check", "plan validation"],
    status: "active",
    scope: "super_admin",
    requiredPermission: "settings_templates.manage",
    accessNote: "Existing Entitlement Validation route guard remains authoritative.",
    relatedItemIds: ["services", "services-entitlement-history"],
  }),
  item({
    id: "services-entitlement-history",
    title: "Services entitlement history",
    categoryId: "plans-entitlements",
    description: "Open the existing Services workspace where entitlement history lives.",
    route: "/services",
    keywords: ["entitlement history", "services", "plans", "access history"],
    aliases: ["service history", "plan history"],
    status: "active",
    scope: "super_admin",
    requiredPermission: "settings_templates.manage",
    accessNote: "Existing Services route guard remains authoritative.",
    relatedItemIds: ["services", "entitlement-validation"],
  }),
  item({
    id: "plan-catalogue-overview",
    title: "Plan catalogue overview",
    categoryId: "plans-entitlements",
    description: "A consolidated plans overview is planned; no entitlement model changes are included.",
    keywords: ["plans", "catalogue", "entitlements", "subscriptions"],
    aliases: ["plan catalog", "plans overview"],
    status: "planned",
    scope: "future",
    accessNote: "Planned item only; no route exists in this slice.",
    relatedItemIds: ["entitlement-validation", "services"],
  }),
  item({
    id: "platform-settings",
    title: "Platform Settings",
    categoryId: "platform-settings",
    description: "Manage existing platform-wide configuration.",
    route: "/system-settings",
    keywords: ["platform settings", "system settings", "configuration", "controls"],
    aliases: ["system settings", "platform configuration"],
    status: "active",
    scope: "super_admin",
    requiredPermission: "settings_templates.manage",
    accessNote: "Existing Platform Settings route guard remains authoritative.",
  }),
  item({
    id: "configuration-health",
    title: "Configuration health",
    categoryId: "platform-settings",
    description: "A consolidated configuration health view belongs in a later slice.",
    keywords: ["configuration", "health", "settings", "diagnostics"],
    aliases: ["config health", "settings health"],
    status: "planned",
    scope: "future",
    accessNote: "Planned item only; no route exists in this slice.",
    relatedItemIds: ["platform-settings"],
  }),
  item({
    id: "governance-audit-log",
    title: "Audit log",
    categoryId: "governance-logs",
    description: "Open the existing audit tab without adding new activity writes.",
    route: "/settings?tab=audit",
    keywords: ["audit", "governance", "activity", "logs", "activity log"],
    aliases: ["audit trail", "governance log"],
    status: "active",
    scope: "super_admin",
    requiredPermission: "settings.manage",
    accessNote: "Existing Settings audit tab remains authoritative; this registry does not write activity logs.",
    relatedItemIds: ["audit-log", "system-performance-governance"],
  }),
  item({
    id: "system-performance-governance",
    title: "System Performance",
    categoryId: "governance-logs",
    description: "Use existing read-only performance diagnostics.",
    route: "/system-performance",
    keywords: ["system performance", "governance", "logs", "diagnostics"],
    aliases: ["performance governance", "system diagnostics"],
    status: "active",
    scope: "super_admin",
    requiredPermission: "settings_templates.manage",
    accessNote: "Existing System Performance route guard remains authoritative.",
    relatedItemIds: ["system-performance"],
  }),
  item({
    id: "governance-checklist",
    title: "Governance checklist",
    categoryId: "governance-logs",
    description: "A cross-surface governance checklist is planned, not implemented here.",
    keywords: ["governance", "checklist", "audit", "controls"],
    aliases: ["control checklist", "governance controls"],
    status: "planned",
    scope: "future",
    accessNote: "Planned item only; no route exists in this slice.",
    relatedItemIds: ["governance-audit-log"],
  }),
];

/** A category and its registry items as rendered by the hub and grouped search results. */
export interface AdministrationCenterSection {
  category: AdministrationCenterCategory;
  items: AdministrationCenterItem[];
}

/** Registry coverage counts shown in the hub and used by focused metadata tests. */
export interface AdministrationCenterCoverageSummary {
  totalItems: number;
  activeItems: number;
  plannedItems: number;
  activeRoutedItems: number;
  plannedUnroutedItems: number;
  categoriesCovered: number;
  totalCategories: number;
  scopeCounts: Record<AdministrationCenterItemScope, number>;
  statusCounts: Record<AdministrationCenterItemStatus, number>;
}

/** One ownership bucket with the registry items assigned to that owner scope. */
export interface AdministrationCenterOwnershipGroup {
  ownership: AdministrationCenterOwnershipArea;
  items: AdministrationCenterItem[];
  activeItems: number;
  plannedItems: number;
}

/** Display-only registry integrity checks for coverage and ownership maintenance. */
export interface AdministrationCenterCoverageValidation {
  duplicateIds: string[];
  unknownCategories: string[];
  missingCategories: string[];
  activeItemsWithoutRoute: string[];
  plannedItemsWithRoute: string[];
  relatedItemIdsMissing: string[];
}

/** Groups registry items by the canonical category order used by the hub. */
export function getAdministrationCenterSections(
  items: AdministrationCenterItem[] = ADMINISTRATION_CENTER_ITEMS,
): AdministrationCenterSection[] {
  return ADMINISTRATION_CENTER_CATEGORIES.map((category) => ({
    category,
    items: items.filter((registryItem) => registryItem.category === category.title),
  })).filter((section) => section.items.length > 0);
}

/** Returns the display ownership area for a registry item scope. */
export function getAdministrationCenterOwnershipArea(scope: AdministrationCenterItemScope): AdministrationCenterOwnershipArea {
  const area = ownershipAreaByScope.get(scope);
  if (!area) {
    return {
      id: "future",
      title: "Future planned surface",
      description: "Fallback planning owner for unknown Administration Center registry scopes.",
      boundaryLabel: "Planned only",
    };
  }
  return area;
}

function createScopeCounts(items: AdministrationCenterItem[]): Record<AdministrationCenterItemScope, number> {
  return {
    super_admin: items.filter((item) => item.scope === "super_admin").length,
    company_admin: items.filter((item) => item.scope === "company_admin").length,
    global: items.filter((item) => item.scope === "global").length,
    future: items.filter((item) => item.scope === "future").length,
  };
}

function createStatusCounts(items: AdministrationCenterItem[]): Record<AdministrationCenterItemStatus, number> {
  return {
    active: items.filter((item) => item.status === "active").length,
    planned: items.filter((item) => item.status === "planned").length,
  };
}

/** Summarizes frontend-only Administration Center registry coverage. */
export function getAdministrationCenterCoverageSummary(
  items: AdministrationCenterItem[] = ADMINISTRATION_CENTER_ITEMS,
): AdministrationCenterCoverageSummary {
  const categoryTitles = new Set<string>(ADMINISTRATION_CENTER_CATEGORIES.map((category) => category.title));
  const coveredCategories = new Set<string>(items.map((item) => item.category).filter((category) => categoryTitles.has(category)));

  return {
    totalItems: items.length,
    activeItems: items.filter((item) => item.status === "active").length,
    plannedItems: items.filter((item) => item.status === "planned").length,
    activeRoutedItems: items.filter((item) => item.status === "active" && Boolean(item.route)).length,
    plannedUnroutedItems: items.filter((item) => item.status === "planned" && !item.route).length,
    categoriesCovered: coveredCategories.size,
    totalCategories: ADMINISTRATION_CENTER_CATEGORIES.length,
    scopeCounts: createScopeCounts(items),
    statusCounts: createStatusCounts(items),
  };
}

/** Groups registry items by the frontend ownership areas used by the ownership map. */
export function getAdministrationCenterOwnershipMap(
  items: AdministrationCenterItem[] = ADMINISTRATION_CENTER_ITEMS,
): AdministrationCenterOwnershipGroup[] {
  return ADMINISTRATION_CENTER_OWNERSHIP_AREAS.map((ownership) => {
    const ownedItems = items.filter((item) => item.scope === ownership.id);
    return {
      ownership,
      items: ownedItems,
      activeItems: ownedItems.filter((item) => item.status === "active").length,
      plannedItems: ownedItems.filter((item) => item.status === "planned").length,
    };
  }).filter((group) => group.items.length > 0);
}

function findDuplicateIds(items: AdministrationCenterItem[]): string[] {
  const seen = new Set<string>();
  const duplicateIds = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) duplicateIds.add(item.id);
    seen.add(item.id);
  }
  return [...duplicateIds].sort();
}

/** Validates registry coverage metadata without becoming an authorization layer. */
export function validateAdministrationCenterRegistryCoverage(
  items: AdministrationCenterItem[] = ADMINISTRATION_CENTER_ITEMS,
): AdministrationCenterCoverageValidation {
  const categoryTitles = new Set<string>(ADMINISTRATION_CENTER_CATEGORIES.map((category) => category.title));
  const itemCategories = new Set<string>(items.map((item) => item.category));
  const itemIds = new Set<string>(items.map((item) => item.id));
  const relatedItemIdsMissing: string[] = [];

  for (const item of items) {
    for (const relatedItemId of item.relatedItemIds ?? []) {
      if (!itemIds.has(relatedItemId)) relatedItemIdsMissing.push(`${item.id}:${relatedItemId}`);
    }
  }

  return {
    duplicateIds: findDuplicateIds(items),
    unknownCategories: [...itemCategories].filter((category) => !categoryTitles.has(category)).sort(),
    missingCategories: ADMINISTRATION_CENTER_CATEGORIES.map((category) => category.title)
      .filter((category) => !itemCategories.has(category))
      .sort(),
    activeItemsWithoutRoute: items
      .filter((item) => item.status === "active" && !item.route)
      .map((item) => item.id)
      .sort(),
    plannedItemsWithRoute: items
      .filter((item) => item.status === "planned" && Boolean(item.route))
      .map((item) => item.id)
      .sort(),
    relatedItemIdsMissing: relatedItemIdsMissing.sort(),
  };
}

function normalizeSearchValue(value: string): string {
  return value.trim().toLowerCase();
}

function getSearchHaystack(item: AdministrationCenterItem): string {
  const ownership = getAdministrationCenterOwnershipArea(item.scope);
  return [
    item.title,
    item.description,
    item.category,
    item.breadcrumb.join(" "),
    item.keywords.join(" "),
    item.aliases.join(" "),
    item.requiredPermission ?? "",
    item.accessNote,
    ownership.title,
    ownership.boundaryLabel,
  ]
    .join(" ")
    .toLowerCase();
}

/** Performs local metadata search over Administration Center registry items. */
export function searchAdministrationCenterItems(
  query: string,
  items: AdministrationCenterItem[] = ADMINISTRATION_CENTER_ITEMS,
): AdministrationCenterItem[] {
  const normalizedQuery = normalizeSearchValue(query);
  if (!normalizedQuery) return [];
  const terms = normalizedQuery.split(/\s+/).filter(Boolean);
  return items.filter((registryItem) => {
    const haystack = getSearchHaystack(registryItem);
    return terms.every((term) => haystack.includes(term));
  });
}
