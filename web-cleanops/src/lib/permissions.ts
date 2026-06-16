import type { UserRole } from "@/types";

/**
 * Every action a permission can grant. New business modules (e.g. Cleaning
 * Protocols) reuse these verbs so the access model stays consistent platform-wide.
 */
export type PermissionAction =
  | "view"
  | "create"
  | "edit"
  | "delete"
  | "archive"
  | "approve"
  | "assign"
  | "manage"
  | "access";

export interface PermissionDef {
  /** Stable key stored on roles, e.g. "users.manage" or "protocols.create". */
  key: string;
  action: PermissionAction;
  label: string;
}

export interface PermissionModule {
  id: string;
  label: string;
  description: string;
  /** Set true for modules not yet shipped — shown in the matrix but disabled. */
  comingSoon?: boolean;
  permissions: PermissionDef[];
}

/** Human-readable verb used when auto-generating CRUD-style permission labels. */
const ACTION_VERB: Record<PermissionAction, string> = {
  view: "View",
  create: "Create",
  edit: "Edit",
  delete: "Delete",
  archive: "Archive",
  approve: "Approve",
  assign: "Assign",
  manage: "Manage",
  access: "Access",
};

/**
 * Builds a permission module from a set of actions. Future modules register
 * themselves through this helper, e.g.:
 *
 *   buildModule("protocols", "Cleaning Protocols", "Standard cleaning routines.",
 *     ["view", "create", "edit", "assign", "approve"])
 */
export function buildModule(
  id: string,
  label: string,
  description: string,
  actions: PermissionAction[],
  options?: { comingSoon?: boolean; noun?: string },
): PermissionModule {
  const noun = options?.noun ?? label;
  return {
    id,
    label,
    description,
    comingSoon: options?.comingSoon,
    permissions: actions.map((action) => ({
      key: `${id}.${action}`,
      action,
      label: `${ACTION_VERB[action]} ${noun}`,
    })),
  };
}

/**
 * The platform permission catalogue. Core foundation modules ship now; business
 * modules are added here as they are built using {@link buildModule}.
 */
export const PERMISSION_MODULES: PermissionModule[] = [
  buildModule(
    "customers",
    "Customers",
    "Customer cards: identity, addresses, contacts and scheduling preferences.",
    ["view", "create", "edit", "delete"],
    { noun: "customers" },
  ),
  buildModule(
    "employees",
    "Employees",
    "Internal staff members, their profiles, teams and availability.",
    ["view", "create", "edit", "delete"],
    { noun: "employees" },
  ),
  {
    id: "schedule",
    label: "Schedule",
    description: "The planning calendar of customer bookings and visits.",
    permissions: [
      { key: "schedule.view", action: "view", label: "View schedule" },
      { key: "schedule.edit", action: "edit", label: "Edit schedule" },
    ],
  },
  {
    id: "work_orders",
    label: "Work Orders",
    description: "Work orders containing services, assignments and execution.",
    permissions: [
      { key: "workOrders.view", action: "view", label: "View work orders" },
      { key: "workOrders.manage", action: "manage", label: "Manage work orders" },
    ],
  },
  buildModule(
    "checklist_templates",
    "Checklist Templates",
    "Reusable cleaning checklist templates: floors, rooms and tasks.",
    ["view", "create", "edit", "archive"],
    { noun: "Checklist Templates" },
  ),
  buildModule(
    "customer_protocols",
    "Customer Protocols",
    "Customer-specific cleaning protocols created from templates.",
    ["view", "create", "edit", "archive"],
    { noun: "Customer Protocols" },
  ),
  buildModule(
    "global_templates",
    "Global Templates",
    "System-owned best-practice templates. Super Admin manages them; company admins can view and copy.",
    ["view", "create", "edit", "archive"],
    { noun: "Global Templates" },
  ),
  buildModule(
    "my_cleaning_protocols",
    "My Cleaning Protocols",
    "Customers view the cleaning protocols connected to their own account.",
    ["view"],
    { noun: "My Cleaning Protocols" },
  ),
  {
    id: "dashboard",
    label: "Dashboard",
    description: "The role's landing overview and key metrics.",
    permissions: [{ key: "dashboard.view", action: "view", label: "View dashboard" }],
  },
  {
    id: "users",
    label: "Users",
    description: "Team members, invitations and account status.",
    permissions: [{ key: "users.manage", action: "manage", label: "Manage users" }],
  },
  {
    id: "companies",
    label: "Companies",
    description: "Organisations on the platform (Super Admin scope).",
    permissions: [{ key: "companies.manage", action: "manage", label: "Manage companies" }],
  },
  {
    id: "roles",
    label: "Roles & Permissions",
    description: "Custom roles and what each role can access.",
    permissions: [{ key: "roles.manage", action: "manage", label: "Manage roles" }],
  },
  {
    id: "reports",
    label: "Reports",
    description: "Analytics and exported insights.",
    permissions: [{ key: "reports.view", action: "view", label: "View reports" }],
  },
  {
    id: "services",
    label: "Services",
    description: "Universal service catalog: categories, services and packages.",
    permissions: [{ key: "services.manage", action: "manage", label: "Manage services" }],
  },
  {
    id: "media",
    label: "Media",
    description: "Compressed image attachments across customers, work orders and more.",
    permissions: [{ key: "media.manage", action: "manage", label: "Manage media" }],
  },
  {
    id: "settings_templates",
    label: "Settings Templates",
    description: "Global settings templates companies can start from (Super Admin scope).",
    permissions: [
      { key: "settings_templates.manage", action: "manage", label: "Manage settings templates" },
    ],
  },
  {
    id: "calculator",
    label: "Price Calculator",
    description:
      "Public price-calculator module: settings, services, plans, pricing rules and quote requests (Super Admin scope for MVP; Company Admin ownership is Phase 2).",
    permissions: [
      { key: "calculator.view", action: "view", label: "View calculator" },
      { key: "calculator.manage", action: "manage", label: "Manage calculator" },
    ],
  },
  {
    id: "navigation",
    label: "Navigation & Menus",
    description:
      "Platform navigation/menu presentation: rename, re-icon, reorder and show/hide menu items (Super Admin scope). Presentation only — never grants access; the permission system stays authoritative.",
    permissions: [{ key: "navigation.manage", action: "manage", label: "Manage navigation & menus" }],
  },
  {
    id: "settings_timecodes",
    label: "Time Codes",
    description:
      "Payroll-foundation time codes (attendance/absence). Super Admin owns the master library; company admins view and assign them to services.",
    permissions: [
      {
        key: "settings.timecodes.view",
        action: "view",
        label: "View time codes",
      },
      {
        key: "settings.timecodes.manage",
        action: "manage",
        label: "Manage time codes",
      },
    ],
  },
  {
    id: "payroll_export",
    label: "Payroll Export",
    description:
      "Payroll export architecture: export profiles and runs. Super Admin activates export capabilities per company; company admins configure enabled profiles and run exports.",
    permissions: [
      {
        key: "payroll.export.view",
        action: "view",
        label: "View payroll export",
      },
      {
        key: "payroll.export.manage",
        action: "manage",
        label: "Manage payroll export profiles",
      },
      {
        key: "payroll.export.run",
        action: "access",
        label: "Run payroll exports",
      },
      {
        key: "payroll.export.entitlements.manage",
        action: "manage",
        label: "Manage payroll export capabilities",
      },
    ],
  },
  {
    id: "settings",
    label: "Settings",
    description: "Workspace configuration and preferences.",
    permissions: [
      { key: "settings.view", action: "view", label: "View settings" },
      { key: "settings.manage", action: "manage", label: "Manage settings" },
      {
        key: "settings.manageEmployeeRoles",
        action: "manage",
        label: "Manage employee roles",
      },
    ],
  },
  {
    id: "checklists",
    label: "Checklist Settings",
    description:
      "Configuration for Checklist Manager: floor presets, categories and libraries.",
    permissions: [
      { key: "checklists.settings.view", action: "view", label: "View checklist settings" },
      {
        key: "checklists.settings.manage",
        action: "manage",
        label: "Manage checklist settings",
      },
    ],
  },
  {
    id: "checklists_execution",
    label: "Checklist Execution",
    description:
      "Running checklist protocols generated from templates: viewing, completing and inspecting runs.",
    permissions: [
      { key: "checklists.execution.view", action: "view", label: "View protocol runs" },
      {
        key: "checklists.execution.complete",
        action: "edit",
        label: "Complete protocol runs",
      },
      {
        key: "checklists.execution.inspect",
        action: "approve",
        label: "Inspect protocol runs",
      },
    ],
  },
  {
    id: "requests",
    label: "Requests / CRM",
    description:
      "REQUEST CRM: customer/employee requests, threads, internal tasks, notifications and chat intake. Slice 0 ships a feature-flagged, shared-admin-only, read-only settings shell; automation/AI/runtime policy stays owned by Automation & AI Center.",
    permissions: [
      { key: "requests.view", action: "view", label: "View requests" },
      { key: "requests.manage", action: "manage", label: "Manage requests" },
      {
        key: "requests.settings.view",
        action: "view",
        label: "View REQUEST CRM settings",
      },
      {
        key: "requests.settings.manage",
        action: "manage",
        label: "Manage REQUEST CRM settings",
      },
    ],
  },
  {
    id: "employee_portal",
    label: "Employee Portal",
    description: "The on-the-ground workspace for staff.",
    permissions: [
      { key: "employee_portal.access", action: "access", label: "Access employee portal" },
    ],
  },
  {
    id: "customer_portal",
    label: "Customer Portal",
    description: "The client-facing area for customers.",
    permissions: [
      { key: "customer_portal.access", action: "access", label: "Access customer portal" },
    ],
  },
];

/** Flat list of every permission key the platform knows about. */
export const ALL_PERMISSIONS: string[] = PERMISSION_MODULES.flatMap((m) =>
  m.permissions.map((p) => p.key),
);

const PERMISSION_LABELS: Record<string, string> = Object.fromEntries(
  PERMISSION_MODULES.flatMap((m) => m.permissions.map((p) => [p.key, p.label])),
);

/** Returns the human-readable label for a permission key. */
export function permissionLabel(key: string): string {
  return PERMISSION_LABELS[key] ?? key;
}

/**
 * The baseline permissions granted to each built-in role. These act as the
 * fallback when a user has no custom role assigned, and seed the default roles.
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<UserRole, string[]> = {
  super_admin: [
    "dashboard.view",
    "companies.manage",
    "roles.manage",
    "reports.view",
    "settings.view",
    "settings.manage",
    "settings.manageEmployeeRoles",
    "customers.view",
    "customers.create",
    "customers.edit",
    "customers.delete",
    "employees.view",
    "employees.create",
    "employees.edit",
    "employees.delete",
    "schedule.view",
    "schedule.edit",
    "workOrders.view",
    "workOrders.manage",
    "checklists.settings.view",
    "checklists.settings.manage",
    "checklists.execution.view",
    "checklists.execution.complete",
    "checklists.execution.inspect",
    "checklist_templates.view",
    "checklist_templates.create",
    "checklist_templates.edit",
    "checklist_templates.archive",
    "global_templates.view",
    "global_templates.create",
    "global_templates.edit",
    "global_templates.archive",
    "customer_protocols.view",
    "my_cleaning_protocols.view",
    "settings_templates.manage",
    "calculator.view",
    "calculator.manage",
    "navigation.manage",
    "services.manage",
    "media.manage",
    "settings.timecodes.view",
    "settings.timecodes.manage",
    "payroll.export.view",
    "payroll.export.manage",
    "payroll.export.run",
    "payroll.export.entitlements.manage",
    "requests.view",
    "requests.manage",
    "requests.settings.view",
    "requests.settings.manage",
  ],
  company_admin: [
    "dashboard.view",
    "users.manage",
    "roles.manage",
    "reports.view",
    "settings.view",
    "settings.manage",
    "settings.manageEmployeeRoles",
    "customers.view",
    "customers.create",
    "customers.edit",
    "customers.delete",
    "employees.view",
    "employees.create",
    "employees.edit",
    "employees.delete",
    "schedule.view",
    "schedule.edit",
    "workOrders.view",
    "workOrders.manage",
    "checklists.settings.view",
    "checklists.settings.manage",
    "checklists.execution.view",
    "checklists.execution.complete",
    "checklists.execution.inspect",
    "checklist_templates.view",
    "checklist_templates.create",
    "checklist_templates.edit",
    "checklist_templates.archive",
    "global_templates.view",
    "customer_protocols.view",
    "customer_protocols.create",
    "customer_protocols.edit",
    "customer_protocols.archive",
    "my_cleaning_protocols.view",
    "services.manage",
    "media.manage",
    "settings.timecodes.view",
    "payroll.export.view",
    "payroll.export.manage",
    "payroll.export.run",
    "requests.view",
    "requests.manage",
    "requests.settings.view",
    "requests.settings.manage",
  ],
  employee: [
    "dashboard.view",
    "employee_portal.access",
    "media.manage",
    "customers.view",
    "schedule.view",
    "workOrders.view",
  ],
  customer: ["customer_portal.access", "my_cleaning_protocols.view"],
};
