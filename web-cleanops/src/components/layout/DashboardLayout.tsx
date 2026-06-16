import { useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  Activity,
  BadgeCheck,
  Boxes,
  Briefcase,
  Building2,
  Calculator,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  DatabaseZap,
  FileText,
  FlaskConical,
  ClipboardCheck,
  Compass,
  HelpCircle,
  Images,
  Inbox,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  MessagesSquare,
  Newspaper,
  PanelLeftClose,
  PanelLeftOpen,
  PieChart,
  Receipt,
  ScrollText,
  Settings as SettingsIcon,
  SlidersHorizontal,
  Sparkles,
  UserCheck,
  UserCircle,
  UserPlus,
  Users,
  Users2,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { initials } from "@/lib/format";
import { ROLE_LABELS } from "@/types";
import { useApp } from "@/context/AppContext";
import { useNavigationMainNav } from "@/hooks/use-navigation-config-admin";
import { getNavigationIcon } from "@/lib/navigation/iconRegistry";
import { useSidebarCollapsed } from "@/hooks/use-sidebar";
import { useCustomerWriteFailureToast } from "@/hooks/use-customer-write-failure-toast";
import { ENABLE_USER_CREATION } from "@/lib/featureFlags";
import {
  shouldShowRequestCrmSettingsNav,
  REQUEST_CRM_SETTINGS_BASE_PATH,
  REQUEST_CRM_SETTINGS_VIEW_PERMISSION,
} from "@/lib/requestCrm/settingsNav";
import {
  shouldShowRequestCrmShellNav,
  REQUEST_CRM_DASHBOARD_PATH,
  REQUEST_CRM_REQUESTS_PATH,
  REQUEST_CRM_VIEW_PERMISSION,
  REQUEST_CRM_MODULE_ID,
} from "@/lib/requestCrm/shellNav";
import {
  shouldShowCompanyRequestSettingsNav,
  COMPANY_REQUEST_SETTINGS_PATH,
} from "@/lib/requestCrm/companyRequestSettingsNav";
import { ViewAsBanner } from "@/components/layout/ViewAsBanner";

interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  /** Permission key required for this item to appear. */
  permission: string;
  /**
   * Extra path prefixes that should also light up this item as active. Used when
   * an area's internal tabs live on routes outside the item's own `to` prefix
   * (e.g. Checklist Manager's Global Templates / Checklist Configuration tabs).
   */
  matchPaths?: string[];
  /**
   * Path prefixes that must NOT be treated as active for this item even if they
   * match its `to` prefix — lets another item "own" a nested route.
   */
  excludePaths?: string[];
}

interface NavSection {
  title?: string;
  items: NavItem[];
}

/**
 * Permission-driven nav sections. Items show only when the user holds the
 * permission; empty sections are dropped. Grouped by purpose — Platform admin,
 * the people Directory, and day-to-day Operations — so the console reads as a
 * focused platform-administration surface rather than a flat list.
 *
 * Checklist, module (Product), provisioning, and Settings groups are appended
 * separately below because their visibility depends on role/module state.
 */
const NAV_SECTIONS: NavSection[] = [
  {
    items: [
      { label: "Overview", to: "/dashboard", icon: LayoutDashboard, permission: "dashboard.view" },
    ],
  },
  {
    title: "Platform",
    items: [
      { label: "Companies", to: "/companies", icon: Building2, permission: "companies.manage" },
      { label: "Users", to: "/users", icon: Users, permission: "users.manage" },
    ],
  },
  {
    title: "Directory",
    items: [
      { label: "Employees", to: "/employees", icon: Briefcase, permission: "users.manage" },
      { label: "Customers", to: "/customers", icon: UserCheck, permission: "users.manage" },
      { label: "Teams", to: "/teams", icon: Users2, permission: "users.manage" },
    ],
  },
  {
    title: "Operations",
    items: [
      {
        label: "Services",
        to: "/services",
        icon: Sparkles,
        permission: "settings_templates.manage",
      },
      {
        label: "Booking List",
        to: "/booking-list",
        icon: CalendarClock,
        permission: "users.manage",
      },
      {
        label: "Schedule",
        to: "/schedule",
        icon: CalendarDays,
        permission: "users.manage",
      },
      {
        label: "Schedule Lab",
        to: "/schedule-lab",
        icon: FlaskConical,
        permission: "users.manage",
      },
    ],
  },
];

interface DashboardLayoutProps {
  children: React.ReactNode;
  /**
   * Admin-heavy pages (Settings, Services, Customer Card, Work Orders, etc.)
   * opt into a wider content area so tables and multi-column forms can use the
   * full horizontal space available on large and ultrawide monitors.
   */
  wide?: boolean;
}

export function DashboardLayout({ children, wide = false }: DashboardLayoutProps) {
  const {
    currentUser,
    companies,
    logout,
    hasPermission,
    canAccessModule,
    getNavModuleGroups,
    getMyProtocols,
  } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState<boolean>(false);
  const { collapsed, setCollapsed } = useSidebarCollapsed();

  // Slice 11C: the main-navigation presentation overlay (label / icon /
  // visibility) from the Navigation & Menu registry + Super-Admin override
  // layer, keyed by route. Pure presentation — never a permission gate.
  const mainNavPresentation = useNavigationMainNav();

  // Wave 1F: surface authoritative Customer write failures to the admin
  // (no-op unless Customers are Supabase-authoritative).
  useCustomerWriteFailureToast();

  // Core sections, filtered by permission, with empty sections dropped.
  const sections = useMemo<NavSection[]>(
    () =>
      NAV_SECTIONS.map((section) => ({
        ...section,
        items: section.items.filter((item) => hasPermission(item.permission)),
      })).filter((section) => section.items.length > 0),
    [hasPermission],
  );

  // Accessible modules grouped by their visible categories become nav sections.
  // "My Cleaning Protocols" is handled by its own gated section below, so it is
  // excluded here to avoid an ungated duplicate entry.
  const moduleSections = useMemo<NavSection[]>(
    () =>
      currentUser
        ? getNavModuleGroups(currentUser)
            .map((group) => ({
              title: group.title,
              items: group.modules
                .filter((def) => def.id !== "my-cleaning-protocols")
                .map((def) => ({
                  label: def.name,
                  to: `/modules/${def.id}`,
                  icon: def.icon,
                  permission: "",
                })),
            }))
            .filter((section) => section.items.length > 0)
        : [],
    [currentUser, getNavModuleGroups],
  );

  // Customer portal: "My Cleaning Protocols" appears only when the module is
  // enabled for the company, the customer holds the permission, and the customer
  // has at least one protocol connected to their account.
  const cleaningProtocolsSection = useMemo<NavSection[]>(() => {
    if (!currentUser || currentUser.role !== "customer") return [];
    if (!hasPermission("my_cleaning_protocols.view")) return [];
    if (!canAccessModule(currentUser, "my-cleaning-protocols")) return [];
    if (getMyProtocols(currentUser).length === 0) return [];
    return [
      {
        items: [
          {
            label: "My Cleaning Protocols",
            to: "/modules/my-cleaning-protocols",
            icon: ScrollText,
            permission: "",
          },
        ],
      },
    ];
  }, [currentUser, hasPermission, canAccessModule, getMyProtocols]);

  // Super Admin manages platform-level checklist configuration through a single
  // "Checklist Manager" entry. Its sub-areas (Templates, Libraries, Global
  // Templates, Checklist Settings) live as internal tabs, not separate nav items.
  // Operational data (Customer Protocols, Protocol Runs) is intentionally absent.
  const superAdminChecklistSection = useMemo<NavSection[]>(() => {
    if (currentUser?.role !== "super_admin") return [];
    if (!hasPermission("checklist_templates.view")) return [];
    return [
      {
        title: "Checklist",
        items: [
          {
            label: "Checklist Manager",
            to: "/modules/checklist-manager",
            icon: ClipboardCheck,
            permission: "checklist_templates.view",
            // Global Templates and Checklist Configuration tabs live on routes
            // outside this prefix; keep Checklist Manager highlighted for them.
            matchPaths: ["/global-templates", "/settings/checklists"],
          },
        ],
      },
    ];
  }, [currentUser?.role, hasPermission]);

  // Super Admin–only Media Center: the platform-level global/website asset
  // library. Gated by the same permission as the other Super Admin platform
  // tools so it collapses for everyone else.
  const mediaCenterSection = useMemo<NavSection[]>(() => {
    if (currentUser?.role !== "super_admin") return [];
    if (!hasPermission("settings_templates.manage")) return [];
    return [
      {
        title: "Library",
        items: [
          {
            label: "Media Center",
            to: "/media-center",
            icon: Images,
            permission: "settings_templates.manage",
          },
        ],
      },
    ];
  }, [currentUser?.role, hasPermission]);

  // Super Admin–only Price Calculator control page (Slice 5A): the locked MVP
  // control surface for the calculator module. Gated by the same permission as
  // the other Super Admin platform tools so it collapses for everyone else.
  const calculatorSection = useMemo<NavSection[]>(() => {
    if (currentUser?.role !== "super_admin") return [];
    if (!hasPermission("calculator.manage")) return [];
    return [
      {
        title: "Calculator",
        items: [
          {
            label: "Calculator",
            to: "/calculator",
            icon: Calculator,
            permission: "calculator.manage",
          },
        ],
      },
    ];
  }, [currentUser?.role, hasPermission]);

  // Company users keep their operational Protocol Runs entry. Super Admin does
  // not — execution records are company-level operational data.
  const protocolRunsSection = useMemo<NavSection[]>(() => {
    if (!currentUser || currentUser.role === "super_admin") return [];
    if (!hasPermission("checklists.execution.view")) return [];
    return [
      {
        title: "Checklists",
        items: [
          {
            label: "Protocol Runs",
            to: "/protocol-runs",
            icon: ClipboardCheck,
            permission: "",
          },
        ],
      },
    ];
  }, [currentUser, hasPermission]);

  // Company users reach Customer Protocols (templates already appear via module
  // categories). Shown only when the module is enabled and they hold the permission.
  const protocolSection = useMemo<NavSection[]>(() => {
    if (!currentUser || currentUser.role === "super_admin") return [];
    if (!hasPermission("customer_protocols.view")) return [];
    if (!canAccessModule(currentUser, "checklist-manager")) return [];
    return [
      {
        title: "Protocols",
        items: [
          {
            label: "Customer Protocols",
            to: "/modules/checklist-manager/protocols",
            icon: ScrollText,
            permission: "customer_protocols.view",
          },
        ],
      },
    ];
  }, [currentUser, hasPermission, canAccessModule]);

  // Step 2B.4: a Super Admin–only "Create user" entry, gated behind the
  // ENABLE_USER_CREATION flag. Dormant by default — nothing shows when off.
  const userCreationSection = useMemo<NavSection[]>(() => {
    if (!ENABLE_USER_CREATION) return [];
    if (currentUser?.role !== "super_admin") return [];
    return [
      {
        title: "Provisioning",
        items: [
          {
            label: "Create User",
            to: "/create-user",
            icon: UserPlus,
            permission: "",
          },
        ],
      },
    ];
  }, [currentUser?.role]);

  // REQUEST CRM shell (Slice 0): a shared-admin (super_admin + company_admin)
  // section. Dashboard + Requests appear when the master frontend shell flag is
  // ON and the user holds requests.view; the Settings entry additionally needs
  // the settings-shell flag and requests.settings.view. Dormant by default —
  // nothing shows when the flags are off.
  const requestCrmSection = useMemo<NavSection[]>(() => {
    const items: NavItem[] = [];
    if (shouldShowRequestCrmShellNav(hasPermission)) {
      items.push(
        {
          label: "CRM Dashboard",
          to: REQUEST_CRM_DASHBOARD_PATH,
          icon: LayoutDashboard,
          permission: REQUEST_CRM_VIEW_PERMISSION,
        },
        {
          label: "Requests",
          to: REQUEST_CRM_REQUESTS_PATH,
          icon: Inbox,
          permission: REQUEST_CRM_VIEW_PERMISSION,
        },
      );
    }
    if (shouldShowRequestCrmSettingsNav(hasPermission)) {
      items.push({
        label: "REQUEST CRM Settings",
        to: REQUEST_CRM_SETTINGS_BASE_PATH,
        icon: SlidersHorizontal,
        permission: REQUEST_CRM_SETTINGS_VIEW_PERMISSION,
      });
    }
    if (items.length === 0) return [];
    return [{ title: "Requests / CRM", items }];
  }, [hasPermission]);

  // Settings is grouped near the bottom: the main Settings hub (Roles &
  // Permissions, Activity Log, etc. live as tabs inside it), platform-wide
  // Settings Templates, and Super Admin–only Platform Settings. Each entry is
  // gated by its own permission so the section collapses for users without it.
  const settingsSection = useMemo<NavSection[]>(() => {
    const items: NavItem[] = [];
    if (hasPermission("settings.manage")) {
      items.push({
        label: "Settings",
        to: "/settings",
        icon: SettingsIcon,
        permission: "settings.manage",
        // For Super Admin, Checklist Configuration is an internal Checklist
        // Manager tab, so Settings must not claim the /settings/checklists route.
        excludePaths: currentUser?.role === "super_admin" ? ["/settings/checklists"] : undefined,
      });
    }
    if (hasPermission("settings_templates.manage")) {
      if (currentUser?.role === "super_admin") {
        items.push({
          label: "Administration Center",
          to: "/administration",
          icon: Compass,
          permission: "settings_templates.manage",
        });
      }
      items.push({
        label: "Settings Templates",
        to: "/settings-templates",
        icon: SlidersHorizontal,
        permission: "settings_templates.manage",
      });
    }
    if (currentUser?.role === "super_admin" && hasPermission("settings_templates.manage")) {
      items.push({
        label: "Agreement Templates",
        to: "/agreement-templates",
        icon: ScrollText,
        permission: "settings_templates.manage",
      });
      items.push({
        label: "Platform Settings",
        to: "/system-settings",
        icon: CalendarRange,
        permission: "settings_templates.manage",
      });
      items.push({
        label: "Request Settings",
        to: "/request-settings",
        icon: Inbox,
        permission: "settings_templates.manage",
      });
      items.push({
        label: "System Performance",
        to: "/system-performance",
        icon: Activity,
        permission: "settings_templates.manage",
      });
      items.push({
        label: "Development Center",
        to: "/development-center",
        icon: Boxes,
        permission: "settings_templates.manage",
      });
      items.push({
        label: "Employee Migration",
        to: "/employee-migration",
        icon: DatabaseZap,
        permission: "settings_templates.manage",
      });
    }
    if (items.length === 0) return [];
    return [{ title: "Settings", items }];
  }, [currentUser?.role, hasPermission]);

  /**
   * Company Admin navigation is an explicit, object-first layout rather than the
   * dynamic module-category groups. The main sidebar holds only the major work
   * areas; object-specific tools (Customer Protocols, Customer Invoices, Teams)
   * are reached from the relevant Customers / Employees pages instead of being
   * exposed as top-level entries. Items still respect existing access: static
   * entries are gated by permission, module entries by `canAccessModule`, so
   * nothing is shown that the admin cannot already open. This changes only what
   * appears in the sidebar — no routes, permissions, or modules are altered.
   */
  const companyAdminSections = useMemo<NavSection[]>(() => {
    if (currentUser?.role !== "company_admin") return [];

    const permItem = (
      permission: string,
      label: string,
      to: string,
      icon: LucideIcon,
    ): NavItem | null => (hasPermission(permission) ? { label, to, icon, permission } : null);

    const moduleItem = (id: string, label: string, icon: LucideIcon): NavItem | null =>
      canAccessModule(currentUser, id)
        ? { label, to: `/modules/${id}`, icon, permission: "" }
        : null;

    const compact = (items: (NavItem | null)[]): NavItem[] =>
      items.filter((item): item is NavItem => item !== null);

    const groups: NavSection[] = [
      {
        title: "Dashboard",
        items: compact([
          permItem("dashboard.view", "Overview", "/dashboard", LayoutDashboard),
          moduleItem("reports", "Reports", PieChart),
        ]),
      },
      {
        title: "Planning",
        items: compact([
          permItem("users.manage", "Booking List", "/booking-list", CalendarClock),
          permItem("users.manage", "Schedule", "/schedule", CalendarDays),
          permItem("users.manage", "Schedule Lab", "/schedule-lab", FlaskConical),
        ]),
      },
      {
        title: "Users",
        items: compact([
          permItem("users.manage", "Customers", "/customers", UserCheck),
          permItem("users.manage", "Employees", "/employees", Briefcase),
        ]),
      },
      {
        title: "Operations",
        items: compact([
          moduleItem("employee-customer-requests", "Requests", MessagesSquare),
          moduleItem("checklist-manager", "Checklist Manager", ClipboardCheck),
          hasPermission("checklists.execution.view")
            ? {
                label: "Protocol Runs",
                to: "/protocol-runs",
                icon: ClipboardCheck,
                permission: "checklists.execution.view",
              }
            : null,
          moduleItem("quality-control", "Quality Control", BadgeCheck),
          moduleItem("key-management", "Key Management", KeyRound),
        ]),
      },
      {
        title: "Finance & Info",
        items: compact([
          moduleItem("admin-invoices", "Admin Invoices", FileText),
          moduleItem("expense-receipts", "Expense Receipts", Receipt),
          moduleItem("news", "News", Newspaper),
        ]),
      },
      {
        title: "Help & Settings",
        items: compact([
          moduleItem("faq", "FAQ", HelpCircle),
          permItem("settings.manage", "Settings", "/settings", SettingsIcon),
          shouldShowCompanyRequestSettingsNav(
            currentUser.role,
            hasPermission,
            canAccessModule(currentUser, REQUEST_CRM_MODULE_ID),
          )
            ? {
                label: "Request Settings",
                to: COMPANY_REQUEST_SETTINGS_PATH,
                icon: Inbox,
                permission: "",
              }
            : null,
        ]),
      },
    ];

    return groups.filter((group) => group.items.length > 0);
  }, [currentUser, hasPermission, canAccessModule]);

  // Resolves which branch the sidebar takes, keeping a single source of truth
  // for the curated Company Admin layout vs. the permission-driven composition.
  const usesCompanyAdminBranch = currentUser?.role === "company_admin";

  const allSections = useMemo<NavSection[]>(() => {
    // Company Admin uses the curated object-first layout; all other roles keep
    // the permission- and module-driven composition unchanged.
    if (usesCompanyAdminBranch) return [...companyAdminSections, ...requestCrmSection];
    return [
      ...sections,
      ...mediaCenterSection,
      ...calculatorSection,
      ...superAdminChecklistSection,
      ...protocolRunsSection,
      ...protocolSection,
      ...cleaningProtocolsSection,
      ...moduleSections,
      ...userCreationSection,
      ...requestCrmSection,
      ...settingsSection,
    ];
  }, [
    usesCompanyAdminBranch,
    companyAdminSections,
    sections,
    mediaCenterSection,
    calculatorSection,
    superAdminChecklistSection,
    protocolRunsSection,
    protocolSection,
    cleaningProtocolsSection,
    moduleSections,
    userCreationSection,
    requestCrmSection,
    settingsSection,
  ]);

  // Apply the main-navigation overlay to whatever sections render (super-admin
  // composition OR the curated Company Admin layout), matched by route. A
  // managed route with an override is relabelled/re-iconed; one hidden via an
  // override is dropped (route access unchanged). Non-managed routes pass
  // through untouched. Resilient: with no overrides every managed route keeps
  // its registry default, so this is a visual no-op until customised.
  const displaySections = useMemo<NavSection[]>(
    () =>
      allSections
        .map((section) => ({
          ...section,
          items: section.items
            .map((navItem): NavItem | null => {
              const presentation = mainNavPresentation.get(navItem.to);
              if (!presentation) return navItem;
              if (!presentation.isVisible) return null;
              return { ...navItem, label: presentation.label, icon: getNavigationIcon(presentation.iconKey) };
            })
            .filter((navItem): navItem is NavItem => navItem !== null),
        }))
        .filter((section) => section.items.length > 0),
    [allSections, mainNavPresentation],
  );

  const companyName = useMemo(() => {
    if (!currentUser?.companyId) return null;
    return companies.find((c) => c.id === currentUser.companyId)?.name ?? null;
  }, [companies, currentUser?.companyId]);

  if (!currentUser) return null;

  const handleLogout = () => {
    logout();
    navigate("/login", { replace: true });
  };

  const navLinkClass = (active: boolean, isCollapsed: boolean) =>
    cn(
      "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
      isCollapsed && "justify-center px-0",
      active
        ? "bg-sidebar-accent text-sidebar-accent-foreground"
        : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground",
    );

  /**
   * The sidebar renders in two modes: full (mobile drawer + expanded desktop)
   * and collapsed (icon-only desktop rail). Collapsed mode maximizes workspace.
   */
  const renderSidebar = (isCollapsed: boolean) => (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div
        className={cn(
          "flex items-center gap-2.5 py-6",
          isCollapsed ? "flex-col gap-3 px-3" : "px-6",
        )}
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground">
          <Sparkles className="h-5 w-5" />
        </div>
        {!isCollapsed ? (
          <div className="min-w-0 flex-1 leading-tight">
            <p className="text-sm font-semibold text-sidebar-accent-foreground">CleanOps</p>
            <p className="truncate text-[11px] text-sidebar-foreground/60">
              {currentUser.role === "super_admin" ? "Platform console" : companyName ?? "Workspace"}
            </p>
          </div>
        ) : null}
        <button
          onClick={() => setCollapsed(!isCollapsed)}
          aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="hidden rounded-md p-1.5 text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground lg:block"
        >
          {isCollapsed ? (
            <PanelLeftOpen className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </button>
      </div>

      <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-2">
        {displaySections.map((section, idx) => (
          <div key={section.title ?? `section-${idx}`} className="space-y-1">
            {section.title && !isCollapsed ? (
              <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/40">
                {section.title}
              </p>
            ) : null}
            {section.items.map((item) => {
              const matchesPrefix = (prefix: string) =>
                location.pathname === prefix || location.pathname.startsWith(`${prefix}/`);
              const matchesBase =
                item.to === "/" ? location.pathname === "/" : matchesPrefix(item.to);
              const matchesExtra = item.matchPaths?.some(matchesPrefix) ?? false;
              const excluded = item.excludePaths?.some(matchesPrefix) ?? false;
              const active = (matchesBase || matchesExtra) && !excluded;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={() => setMobileOpen(false)}
                  title={isCollapsed ? item.label : undefined}
                  className={navLinkClass(active, isCollapsed)}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  {!isCollapsed ? item.label : null}
                </Link>
              );
            })}
          </div>
        ))}

        {currentUser.role === "customer" || currentUser.role === "employee" ? (
          <div className="space-y-1">
            <Link
              to="/profile"
              onClick={() => setMobileOpen(false)}
              title={isCollapsed ? "My Profile" : undefined}
              className={navLinkClass(location.pathname.startsWith("/profile"), isCollapsed)}
            >
              <UserCircle className="h-4 w-4 shrink-0" />
              {!isCollapsed ? "My Profile" : null}
            </Link>
          </div>
        ) : null}

      </nav>

      <div className="border-t border-sidebar-border p-3">
        <div
          className={cn(
            "flex items-center gap-3 rounded-lg px-3 py-2",
            isCollapsed && "flex-col gap-2 px-0",
          )}
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-xs font-semibold text-sidebar-accent-foreground">
            {initials(currentUser.name)}
          </div>
          {!isCollapsed ? (
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-sm font-medium text-sidebar-accent-foreground">
                {currentUser.name}
              </p>
              <p className="truncate text-[11px] text-sidebar-foreground/60">
                {ROLE_LABELS[currentUser.role]}
              </p>
            </div>
          ) : null}
          <button
            onClick={handleLogout}
            aria-label="Sign out"
            title={isCollapsed ? "Sign out" : undefined}
            className="rounded-md p-2 text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-background">
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 hidden border-r border-sidebar-border transition-[width] duration-200 ease-out lg:block",
          collapsed ? "w-[4.5rem]" : "w-64",
        )}
      >
        {renderSidebar(collapsed)}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-foreground/40 backdrop-blur-sm animate-fade-in"
            onClick={() => setMobileOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 w-64 animate-fade-in">
            <button
              onClick={() => setMobileOpen(false)}
              aria-label="Close menu"
              className="absolute right-3 top-5 z-10 rounded-md p-1.5 text-sidebar-foreground/70 hover:text-sidebar-accent-foreground"
            >
              <X className="h-5 w-5" />
            </button>
            {renderSidebar(false)}
          </div>
        </div>
      ) : null}

      {/* Content */}
      <div
        className={cn(
          "flex min-h-screen w-full flex-col transition-[padding] duration-200 ease-out",
          collapsed ? "lg:pl-[4.5rem]" : "lg:pl-64",
        )}
      >
        <ViewAsBanner />
        {/* Mobile top bar */}
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-background/80 px-4 py-3 backdrop-blur lg:hidden">
          <button
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
            className="rounded-md p-2 text-muted-foreground hover:bg-muted"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Sparkles className="h-4 w-4" />
            </div>
            <span className="text-sm font-semibold">CleanOps</span>
          </div>
        </header>

        <main className="flex-1 px-5 py-8 sm:px-8 lg:px-10 lg:py-10 2xl:px-12">
          <div
            className={cn(
              "mx-auto w-full animate-fade-up",
              wide ? "max-w-[1700px]" : "max-w-6xl",
            )}
          >
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
