import type {
  Area,
  PostalCity,
  EmployeeLanguage,
  AuditEvent,
  ChecklistTemplate,
  ChecklistTemplateAdoption,
  CustomerProtocol,
  Company,
  CompanyModuleSetting,
  CompanyServiceFavorite,
  Customer,
  Employee,
  Invoice,
  LibraryRoom,
  LibraryTask,
  Module,
  ModuleCategory,
  ProtocolTask,
  Role,
  Service,
  ServiceCategory,
  PayrollGroup,
  ServicePackage,
  SettingsData,
  SettingsTemplate,
  CompanySettings,
  Team,
  TimeReport,
  BookingQueueItem,
  BookingOccurrenceException,
  User,
  UserRole,
  WorkOrder,
  WorkOrderSettings,
  TimeReportSettings,
  DurationSettings,
  SystemSettings,
  ServiceGlobalEntitlement,
  CompanyServiceEntitlement,
  ServiceEntitlementLogEntry,
  EntityStatus,
} from "@/types";
import { emptySettingsData, defaultDeviationAllocation, buildTimeReportAuditEntry, defaultSystemSettings, normalizeSystemSettings, buildBookingSnapshot, normalizeUnassignedSlots } from "@/types";
import { DEFAULT_ROLE_PERMISSIONS } from "@/lib/permissions";
import { normalizeCustomerType, segmentForCustomerType } from "@/lib/customerType";
import { DEFAULT_AREA_NAMES, matchAreaByName, normalizeAreaName } from "@/lib/area";
import { normalizePostalCityName, resolvePostalCityArea } from "@/lib/postalCity";
import { normalizeServiceBasisType } from "@/lib/serviceBasis";
import {
  buildGlobalServiceCategories,
  globalCategoryId,
  legacyCategoryTypeForId,
} from "@/lib/serviceCategoryTypes";
import { buildGlobalPayrollGroups } from "@/lib/payrollGroups";
import { SERVICE_CATEGORY_TYPES } from "@/types";
import {
  DEFAULT_EMPLOYEE_LANGUAGES,
  normalizeEmployeeLanguages,
  normalizeLanguageCode,
  setDefaultEmployeeLanguage as setDefaultEmployeeLanguagePure,
} from "@/lib/employeeLanguage";
import {
  checkAreaScopedAccessActivation,
  type AreaActivationPrecheck,
} from "@/lib/areaScopeActivation";
import { MODULE_DEFINITIONS } from "@/lib/modules";
import { getFeature, type FeatureId } from "@/lib/features";
import { ROLE_LABELS } from "@/types";

const COMPANIES_KEY = "cleanops.companies";
const USERS_KEY = "cleanops.users";
const ROLES_KEY = "cleanops.roles";
const SESSION_KEY = "cleanops.session";
const RESET_KEY = "cleanops.resetTokens";
const EMPLOYEES_KEY = "cleanops.employees";
const CUSTOMERS_KEY = "cleanops.customers";
const TEAMS_KEY = "cleanops.teams";
const AREAS_KEY = "cleanops.areas";
const POSTAL_CITIES_KEY = "cleanops.postalCities";
const EMPLOYEE_LANGUAGES_KEY = "cleanops.employeeLanguages";
const AUTO_AREA_FROM_POSTAL_CITY_KEY = "cleanops.autoAreaFromPostalCity";
const AREA_SCOPED_ACCESS_KEY = "cleanops.areaScopedAccess";
const FEATURE_FLAGS_KEY = "cleanops.featureFlags";
const AREA_SCOPED_ACCESS_FEATURE_MIGRATION_KEY = "cleanops.migration.areaScopedAccessToFeature";
const CUSTOMER_AREA_BACKFILL_MIGRATION_KEY = "cleanops.migration.customerAreaIds";
const MODULES_KEY = "cleanops.modules";
const COMPANY_MODULES_KEY = "cleanops.companyModules";
const MODULE_CATEGORIES_KEY = "cleanops.moduleCategories";
const AUDIT_KEY = "cleanops.auditEvents";
const CHECKLIST_TEMPLATES_KEY = "cleanops.checklistTemplates";
const CHECKLIST_ADOPTIONS_KEY = "cleanops.checklistAdoptions";
const CHECKLIST_PERMS_MIGRATION_KEY = "cleanops.migration.checklistPerms";
const CHECKLIST_SETTINGS_PERMS_MIGRATION_KEY = "cleanops.migration.checklistSettingsPerms";
const CHECKLIST_EXECUTION_PERMS_MIGRATION_KEY = "cleanops.migration.checklistExecutionPerms";
const GLOBAL_TEMPLATES_PERMS_MIGRATION_KEY = "cleanops.migration.globalTemplatesPerms";
const CUSTOMER_PROTOCOLS_KEY = "cleanops.customerProtocols";
const PROTOCOL_PERMS_MIGRATION_KEY = "cleanops.migration.protocolPerms";
const LIBRARY_ROOMS_KEY = "cleanops.libraryRooms";
const LIBRARY_TASKS_KEY = "cleanops.libraryTasks";
const MY_PROTOCOLS_PERMS_MIGRATION_KEY = "cleanops.migration.myProtocolsPerms";
const SETTINGS_TEMPLATES_KEY = "cleanops.settingsTemplates";
const COMPANY_SETTINGS_KEY = "cleanops.companySettings";
const SETTINGS_TEMPLATES_PERMS_MIGRATION_KEY = "cleanops.migration.settingsTemplatesPerms";
const CALCULATOR_PERMS_MIGRATION_KEY = "cleanops.migration.calculatorPerms";
const NAVIGATION_PERMS_MIGRATION_KEY = "cleanops.migration.navigationPerms";
const SERVICE_CATEGORIES_KEY = "cleanops.serviceCategories";
const PAYROLL_GROUPS_KEY = "cleanops.payrollGroups";
const SERVICE_CATEGORY_GOVERNANCE_MIGRATION_KEY =
  "cleanops.migration.serviceCategoryGovernance";
const SERVICES_KEY = "cleanops.services";
const SERVICE_PACKAGES_KEY = "cleanops.servicePackages";
const SERVICE_FAVORITES_KEY = "cleanops.serviceFavorites";
const SERVICES_PERMS_MIGRATION_KEY = "cleanops.migration.servicesPerms";
const WORK_ORDERS_KEY = "cleanops.workOrders";
const WORK_ORDER_SETTINGS_KEY = "cleanops.workOrderSettings";
const TIME_REPORT_SETTINGS_KEY = "cleanops.timeReportSettings";
const DURATION_SETTINGS_KEY = "cleanops.durationSettings";
const TIME_REPORTS_KEY = "cleanops.timeReports";
const INVOICES_KEY = "cleanops.invoices";
const BOOKING_QUEUE_KEY = "cleanops.bookingQueue";
const BOOKING_OCCURRENCE_EXCEPTIONS_KEY = "cleanops.bookingOccurrenceExceptions";
const SYSTEM_SETTINGS_KEY = "cleanops.systemSettings";
const SERVICE_GLOBAL_ENTITLEMENTS_KEY = "cleanops.serviceGlobalEntitlements";
const COMPANY_SERVICE_ENTITLEMENTS_KEY = "cleanops.companyServiceEntitlements";
const SERVICE_ENTITLEMENT_LOG_KEY = "cleanops.serviceEntitlementLog";
const BOOKING_QUEUE_BACKFILL_MIGRATION_KEY = "cleanops.migration.bookingQueueBackfill";
const BOOKING_QUEUE_SNAPSHOT_MIGRATION_KEY = "cleanops.migration.bookingQueueSnapshot.v2";
/** One-time guard so the legacy demo-seed purge runs at most once per browser. */
const LEGACY_DEMO_SEED_PURGE_KEY = "cleanops.migration.legacyDemoSeedPurged.v1";

/**
 * Demo seeding is enabled ONLY under vitest (MODE === "test") so the unit /
 * integration suites keep their deterministic fixtures. Real app builds (dev +
 * production) never inject demo operational data — Supabase is the authoritative
 * source, and an empty Supabase result is a valid empty state, NOT a trigger to
 * resurrect seeded companies/users/customers/employees.
 */
const DEMO_SEED_ENABLED: boolean = import.meta.env.MODE === "test";

/** Stable ids of the legacy demo companies + logins seeded by earlier builds. */
const DEMO_COMPANY_IDS: ReadonlySet<string> = new Set([
  "cmp_nordlys",
  "cmp_fjord",
  "cmp_polar",
  "cmp_aurora",
]);
const DEMO_USER_IDS: ReadonlySet<string> = new Set([
  "usr_emp1",
  "usr_emp2",
  "usr_emp3",
  "usr_cust1",
  "usr_cust2",
]);

/** Permission keys granted to the checklist template administrators. */
const CHECKLIST_ADMIN_PERMISSIONS = [
  "checklist_templates.view",
  "checklist_templates.create",
  "checklist_templates.edit",
  "checklist_templates.archive",
];

/** Checklist Manager settings permissions granted to admin roles (Phase 1). */
const CHECKLIST_SETTINGS_ADMIN_PERMISSIONS = [
  "checklists.settings.view",
  "checklists.settings.manage",
];

/** Checklist Manager execution permissions granted to admin roles (Phase 3A). */
const CHECKLIST_EXECUTION_ADMIN_PERMISSIONS = [
  "checklists.execution.view",
  "checklists.execution.complete",
  "checklists.execution.inspect",
];

/**
 * Global template permissions. The Super Admin fully manages the system-owned
 * library; Company Admins get read-only visibility so they can view and copy
 * globals (copying/customer-protocol creation runs under their existing
 * checklist/customer-protocol permissions) without ever editing a global.
 */
const GLOBAL_TEMPLATES_SUPER_ADMIN_PERMISSIONS = [
  "global_templates.view",
  "global_templates.create",
  "global_templates.edit",
  "global_templates.archive",
];
const GLOBAL_TEMPLATES_COMPANY_ADMIN_PERMISSIONS = ["global_templates.view"];

/** Read-only customer-facing protocol permission for the customer role. */
const MY_PROTOCOLS_CUSTOMER_PERMISSIONS = ["my_cleaning_protocols.view"];

/** Settings template management is a Super Admin platform capability. */
const SETTINGS_TEMPLATES_SUPER_ADMIN_PERMISSIONS = ["settings_templates.manage"];

/**
 * Price-calculator management is a Super Admin platform capability for the MVP.
 * Company Admin ownership is intentionally deferred to Phase 2, so these keys are
 * granted to the Super Admin role only.
 */
const CALCULATOR_SUPER_ADMIN_PERMISSIONS = ["calculator.view", "calculator.manage"];

/**
 * Navigation & Menu registry management is a Super Admin platform capability
 * (Slice 11A). Presentation only — it never grants access. Company Admin is
 * intentionally not granted this; platform menu config is Super-Admin governed.
 */
const NAVIGATION_SUPER_ADMIN_PERMISSIONS = ["navigation.manage"];

/** Service catalog management is granted to Super Admin and Company Admin. */
const SERVICES_ADMIN_PERMISSIONS = ["services.manage"];

/** Protocol permissions for the Super Admin (view all) and Company Admin (full). */
const PROTOCOL_SUPER_ADMIN_PERMISSIONS = ["customer_protocols.view"];
const PROTOCOL_COMPANY_ADMIN_PERMISSIONS = [
  "customer_protocols.view",
  "customer_protocols.create",
  "customer_protocols.edit",
  "customer_protocols.archive",
];

/** Stable id for a built-in role, so users can reference it deterministically. */
export function systemRoleId(baseRole: UserRole, companyId: string | null): string {
  return companyId ? `role_${companyId}_${baseRole}` : `role_tpl_${baseRole}`;
}

/**
 * Canonical one-line description for each built-in role. Single source of truth
 * for both the localStorage seed (seedRoles) and the global-template seed
 * mirror ({@link import("@/lib/companyRoleSeed").buildGlobalRoleTemplates}).
 */
export const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  super_admin: "Full platform oversight across every company.",
  company_admin: "Manages their company's team, roles and settings.",
  employee: "Front-line staff with access to the employee portal.",
  customer: "Client account with access to the customer portal.",
};

/** Generates a short, readable id. */
export function makeId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.error("Failed to persist data", err);
  }
}

interface SeedUser extends User {
  password: string;
}

/** Seeds demo companies and users on first launch. */
function seed(): { companies: Company[]; users: SeedUser[] } {
  const now = new Date();
  const daysAgo = (d: number): string =>
    new Date(now.getTime() - d * 86400000).toISOString();

  const companies: Company[] = [
    { id: "cmp_nordlys", name: "Nordlys Cleaning AS", status: "active", createdAt: daysAgo(210) },
    { id: "cmp_fjord", name: "Fjord Facility Services", status: "active", createdAt: daysAgo(120) },
    { id: "cmp_polar", name: "Polar Shine Co.", status: "inactive", createdAt: daysAgo(64) },
    { id: "cmp_aurora", name: "Aurora Hygiene Group", status: "active", createdAt: daysAgo(18) },
  ];

  // NOTE: Administrative accounts (super_admin / company_admin) are intentionally
  // NOT seeded here. Admins must be provisioned in Supabase Auth + profiles
  // (see scripts/create-company-admin.mjs). The legacy localStorage auth layer
  // also fails closed for admin roles — see authenticate()/reset-token helpers.
  const users: SeedUser[] = [
    { id: "usr_emp1", name: "Ingrid Sand", email: "ingrid@nordlys.io", role: "employee", companyId: "cmp_nordlys", status: "active", createdAt: daysAgo(180) },
    { id: "usr_emp2", name: "Lars Vik", email: "lars@nordlys.io", role: "employee", companyId: "cmp_nordlys", status: "active", createdAt: daysAgo(96) },
    { id: "usr_cust1", name: "Bergen Office Park", email: "facility@bergenpark.no", role: "customer", companyId: "cmp_nordlys", status: "active", createdAt: daysAgo(60) },
    { id: "usr_cust2", name: "Solveig Lund", email: "solveig@kontorhuset.no", role: "customer", companyId: "cmp_nordlys", status: "inactive", createdAt: daysAgo(40) },
    // Demo admin identities are intentionally not seeded — admins must be provisioned
    // via Supabase Auth + profiles (scripts/create-company-admin.mjs).
    { id: "usr_emp3", name: "Tobias Aas", email: "tobias@fjord.io", role: "employee", companyId: "cmp_fjord", status: "active", createdAt: daysAgo(70) },
  ].map((u) => ({
    password: "password",
    ...u,
    roleId: systemRoleId(u.role as UserRole, (u.companyId as string | null) ?? null),
  })) as SeedUser[];

  return { companies, users };
}

/** The built-in roles assignable across the platform for a given company set. */
function seedRoles(companies: Company[]): Role[] {
  const createdAt = new Date().toISOString();
  const baseRoles: UserRole[] = ["super_admin", "company_admin", "employee", "customer"];

  const buildRole = (baseRole: UserRole, companyId: string | null): Role => ({
    id: systemRoleId(baseRole, companyId),
    name: ROLE_LABELS[baseRole],
    description: ROLE_DESCRIPTIONS[baseRole],
    companyId,
    isSystem: true,
    baseRole,
    permissions: [...DEFAULT_ROLE_PERMISSIONS[baseRole]],
    createdAt,
  });

  // Global templates managed by the Super Admin.
  const templates = baseRoles.map((r) => buildRole(r, null));

  // Per-company copies of the company-scoped roles.
  const companyRoles = companies.flatMap((c) =>
    (["company_admin", "employee", "customer"] as UserRole[]).map((r) => buildRole(r, c.id)),
  );

  return [...templates, ...companyRoles];
}

/** Seeds internal staff, external customers and teams for the demo companies. */
function seedDirectory(): {
  employees: Employee[];
  customers: Customer[];
  teams: Team[];
} {
  const now = new Date();
  const daysAgo = (d: number): string =>
    new Date(now.getTime() - d * 86400000).toISOString();

  const teams: Team[] = [
    { id: "team_nordlys_cleaning", companyId: "cmp_nordlys", name: "Cleaning Team", description: "Front-line cleaning staff.", createdAt: daysAgo(200) },
    { id: "team_nordlys_quality", companyId: "cmp_nordlys", name: "Quality Team", description: "Inspections and quality control.", createdAt: daysAgo(150) },
    { id: "team_nordlys_gothenburg", companyId: "cmp_nordlys", name: "Gothenburg Team", description: "Regional crew for Gothenburg.", createdAt: daysAgo(90) },
    { id: "team_fjord_admin", companyId: "cmp_fjord", name: "Admin Team", description: "Office and administration.", createdAt: daysAgo(110) },
  ];

  const employees: Employee[] = [
    { id: "emp_ingrid", companyId: "cmp_nordlys", name: "Ingrid Sand", email: "ingrid@nordlys.io", title: "Team Lead", status: "active", teamIds: ["team_nordlys_cleaning", "team_nordlys_quality"], userId: "usr_emp1", createdAt: daysAgo(180) },
    { id: "emp_lars", companyId: "cmp_nordlys", name: "Lars Vik", email: "lars@nordlys.io", title: "Cleaner", status: "active", teamIds: ["team_nordlys_cleaning"], userId: "usr_emp2", createdAt: daysAgo(96) },
    { id: "emp_kari", companyId: "cmp_nordlys", name: "Kari Moen", email: "kari@nordlys.io", title: "Cleaner", status: "active", teamIds: ["team_nordlys_gothenburg"], userId: null, createdAt: daysAgo(50) },
    { id: "emp_tobias", companyId: "cmp_fjord", name: "Tobias Aas", email: "tobias@fjord.io", title: "Supervisor", status: "active", teamIds: ["team_fjord_admin"], userId: "usr_emp3", createdAt: daysAgo(70) },
  ];

  const customers: Customer[] = [
    { id: "cust_bergen", companyId: "cmp_nordlys", name: "Bergen Office Park", customerNumber: "C-1001", email: "facility@bergenpark.no", status: "active", customerType: "commercial", customerSegment: "b2b", area: "Bergen", tags: ["Priority", "Office"], mainContact: "Ingrid Halvorsen", phone: "+47 55 12 34 56", addresses: [
      { id: "addr_bergen1", label: "Head office", street: "Kanalveien 12", postalCode: "5068", country: "Norway", isInvoice: false, isDelivery: true },
      { id: "addr_bergen2", label: "Billing", street: "Postboks 204", postalCode: "5001", country: "Norway", isInvoice: true, isDelivery: false },
    ], contacts: [
      { id: "con_bergen1", name: "Ingrid Halvorsen", title: "Facility Manager", email: "ingrid@bergenpark.no", phone: "+47 55 12 34 56", isPrimary: true },
      { id: "con_bergen2", name: "Per Strand", title: "Accounts", email: "invoices@bergenpark.no", phone: "+47 55 12 34 90", isPrimary: false },
    ], internalNotes: [
      { id: "note_bergen1", text: "Access card needed for the parking garage — collect from reception.", authorId: null, authorName: "System", createdAt: daysAgo(20) },
    ], cardNotes: [
      { id: "cnote_bergen1", type: "admin", title: "Garage access", content: "Access card needed for the parking garage — collect from reception.", authorId: null, authorName: "System", createdAt: daysAgo(20), updatedAt: daysAgo(20), status: "active" },
      { id: "cnote_bergen2", type: "assignment", title: "Evening entry", content: "Enter via the loading bay after 18:00. Confirm alarm code with reception.", authorId: null, authorName: "System", createdAt: daysAgo(15), updatedAt: daysAgo(15), status: "active" },
      { id: "cnote_bergen3", type: "finance", title: "PO required", content: "Customer requires a purchase-order number on every invoice.", authorId: null, authorName: "System", createdAt: daysAgo(10), updatedAt: daysAgo(10), status: "active" },
    ], userIds: ["usr_cust1"], createdAt: daysAgo(60), updatedAt: daysAgo(5) },
    { id: "cust_solveig", companyId: "cmp_nordlys", name: "Solveig Lund", customerNumber: "C-1002", email: "solveig@kontorhuset.no", status: "inactive", customerType: "private", customerSegment: "b2c", area: "Oslo", tags: ["Move-out"], mainContact: "Solveig Lund", phone: "+47 22 98 76 54", userIds: ["usr_cust2"], createdAt: daysAgo(40), updatedAt: daysAgo(12) },
  ];

  return { employees, customers, teams };
}

/** Global module records, seeded from the catalogue as active platform-wide. */
function seedModules(): Module[] {
  const createdAt = new Date().toISOString();
  return MODULE_DEFINITIONS.map((def) => ({
    id: def.id,
    name: def.name,
    description: def.description,
    status: "active" as EntityStatus,
    allowedUserTypes: [...def.allowedUserTypes],
    createdAt,
  }));
}

/** Global module categories managed by the Super Admin, seeded on first launch. */
function seedModuleCategories(): ModuleCategory[] {
  const createdAt = new Date().toISOString();
  return [
    {
      id: "cat_operations",
      name: "Operations",
      description: "Features connected to daily operational work.",
      icon: "wrench",
      sortOrder: 0,
      status: "active",
      visibleUserTypes: ["company_admin", "employee"],
      moduleIds: [
        "checklist-manager",
        "quality-control",
        "key-management",
        "employee-customer-requests",
      ],
      createdAt,
    },
    {
      id: "cat_backoffice",
      name: "Backoffice",
      description: "Features connected to administration, reporting and finance.",
      icon: "briefcase",
      sortOrder: 1,
      status: "active",
      visibleUserTypes: ["company_admin"],
      moduleIds: ["reports", "admin-invoices", "expense-receipts", "faq"],
      createdAt,
    },
    {
      id: "cat_customer_portal",
      name: "Customer Portal",
      description: "Features available for customer-facing workflows.",
      icon: "headset",
      sortOrder: 2,
      status: "active",
      visibleUserTypes: ["customer", "company_admin"],
      moduleIds: ["customer-invoices", "faq", "news", "employee-customer-requests"],
      createdAt,
    },
  ];
}

/** Seeds per-company module settings: available and enabled by default. */
function seedCompanyModules(companies: Company[]): CompanyModuleSetting[] {
  return companies.flatMap((c) =>
    MODULE_DEFINITIONS.map((def) => ({
      companyId: c.id,
      moduleId: def.id,
      available: true,
      enabled: true,
    })),
  );
}

function ensureSeeded(): void {
  if (DEMO_SEED_ENABLED && (!localStorage.getItem(USERS_KEY) || !localStorage.getItem(COMPANIES_KEY))) {
    const { companies, users } = seed();
    write(COMPANIES_KEY, companies);
    write(USERS_KEY, users);
  }
  ensureRolesSeeded();
  if (DEMO_SEED_ENABLED) ensureDirectorySeeded();
  ensureModulesSeeded();
  ensureModuleCategoriesSeeded();
  if (DEMO_SEED_ENABLED) ensureAreasSeeded();
  ensureCustomerAreaIdsBackfilled();
  ensureEmployeeLanguagesSeeded();
  migrateAreaScopedAccessToFeatureFlag();
  ensureChecklistSeeded();
  ensureSettingsTemplatesSeeded();
  ensureServicesSeeded();
  if (DEMO_SEED_ENABLED) ensureWorkOrdersAndInvoicesSeeded();
  ensureBookingQueueBackfilled();
  ensureBookingQueueSnapshotSynced();
  // Real (non-test) builds: strip any legacy demo seed rows a previous build
  // wrote into this browser. Runs LAST so it also catches demo company-scoped
  // rows that the platform-global seeds (services/protocols) may have created.
  if (!DEMO_SEED_ENABLED) purgeLegacyDemoSeed();
}

/**
 * One-time, idempotent purge of legacy DEMO seed data from this browser's
 * localStorage. Earlier builds seeded demo companies (Nordlys, Fjord, Polar,
 * Aurora) and their users/customers/employees/teams/work orders/etc. Now that
 * Supabase is the authoritative source, those rows must never linger as a
 * localStorage fallback — otherwise an intentionally-empty Supabase result
 * (e.g. after a database reset) gets masked by stale demo data.
 *
 * Safe by construction: it only removes rows tied to the well-known demo
 * company ids / demo login ids (a real tenant can never own `cmp_nordlys`),
 * and global platform master data (module catalogue, role templates, checklist
 * / settings templates, the global service catalog) is left untouched.
 */
function purgeLegacyDemoSeed(): void {
  if (localStorage.getItem(LEGACY_DEMO_SEED_PURGE_KEY)) return;

  const isDemoCompany = (id: string | null | undefined): boolean =>
    typeof id === "string" && DEMO_COMPANY_IDS.has(id);

  // Demo companies themselves.
  const companies = read<Company[]>(COMPANIES_KEY, []);
  const keptCompanies = companies.filter((c) => !DEMO_COMPANY_IDS.has(c.id));
  if (keptCompanies.length !== companies.length) write(COMPANIES_KEY, keptCompanies);

  // Demo logins (by stable id) + any login bound to a demo company.
  const users = read<User[]>(USERS_KEY, []);
  const keptUsers = users.filter(
    (u) => !DEMO_USER_IDS.has(u.id) && !isDemoCompany(u.companyId ?? null),
  );
  if (keptUsers.length !== users.length) write(USERS_KEY, keptUsers);

  // Company-scoped arrays: drop every row owned by a demo company.
  const companyScopedKeys: readonly string[] = [
    CUSTOMERS_KEY,
    EMPLOYEES_KEY,
    TEAMS_KEY,
    AREAS_KEY,
    POSTAL_CITIES_KEY,
    EMPLOYEE_LANGUAGES_KEY,
    WORK_ORDERS_KEY,
    INVOICES_KEY,
    BOOKING_QUEUE_KEY,
    COMPANY_MODULES_KEY,
    CUSTOMER_PROTOCOLS_KEY,
    SERVICES_KEY,
  ];
  for (const key of companyScopedKeys) {
    const raw = read<unknown>(key, []);
    if (!Array.isArray(raw)) continue;
    const rows = raw as Array<{ companyId?: string | null }>;
    const kept = rows.filter((r) => !isDemoCompany(r.companyId ?? null));
    if (kept.length !== rows.length) write(key, kept);
  }

  // Per-company role copies carry a demo companyId; global templates (null) stay.
  const roles = read<Role[]>(ROLES_KEY, []);
  const keptRoles = roles.filter((r) => !isDemoCompany(r.companyId ?? null));
  if (keptRoles.length !== roles.length) write(ROLES_KEY, keptRoles);

  localStorage.setItem(LEGACY_DEMO_SEED_PURGE_KEY, "1");
}

/**
 * One-time, idempotent migration that creates Booking Queue items for service
 * rows on existing work orders that predate the Booking Queue feature. Runs once
 * (guarded by a migration flag) during seeding/initialization.
 *
 * Rules: only creates an item when none already exists for the same
 * workOrderId + serviceRowId; never duplicates or overwrites existing items;
 * new items start Unassigned / Unscheduled with null scheduling fields.
 */
function ensureBookingQueueBackfilled(): void {
  if (localStorage.getItem(BOOKING_QUEUE_BACKFILL_MIGRATION_KEY)) return;

  const workOrders = read<WorkOrder[]>(WORK_ORDERS_KEY, []);
  const existing = read<BookingQueueItem[]>(BOOKING_QUEUE_KEY, []);
  const customers = read<Customer[]>(CUSTOMERS_KEY, []);

  // Dedupe key per (work order, service row) so we never create a duplicate.
  const employees = read<Employee[]>(EMPLOYEES_KEY, []);
  const resolveEmployeeName = (id: string): string | undefined =>
    employees.find((e) => e.id === id)?.name;
  const seen = new Set(existing.map((b) => `${b.workOrderId}::${b.serviceRowId}`));
  const now = new Date().toISOString();
  const created: BookingQueueItem[] = [];

  for (const order of workOrders) {
    for (const row of order.serviceRows ?? []) {
      const key = `${order.id}::${row.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const customerName =
        customers.find((c) => c.id === order.customerId)?.name ?? "Unknown customer";
      const snapshot = buildBookingSnapshot(row, resolveEmployeeName);
      created.push({
        id: makeId("book"),
        companyId: order.companyId,
        workOrderId: order.id,
        workOrderNumber: order.number,
        serviceRowId: row.id,
        customerId: order.customerId,
        customerName,
        serviceName: snapshot.serviceName,
        serviceDate: snapshot.serviceDate,
        serviceEndDate: snapshot.serviceEndDate,
        plannedStartTime: snapshot.plannedStartTime,
        plannedEndTime: snapshot.plannedEndTime,
        assignedEmployeeIds: snapshot.assignedEmployeeIds,
        unassignedEmployeeSlots: snapshot.unassignedEmployeeSlots,
        recurrenceInterval: snapshot.recurrenceInterval,
        employeeTimeOverrides: snapshot.employeeTimeOverrides,
        hasCustomEmployeeTimes: snapshot.hasCustomEmployeeTimes,
        assignmentStatus: snapshot.assignmentStatus,
        scheduleStatus: "unscheduled",
        scheduledDate: null,
        scheduledStartTime: null,
        scheduledEndTime: null,
        durationMinutes: snapshot.durationMinutes,
        assignedEmployeeNames: snapshot.assignedEmployeeNames,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  if (created.length > 0) {
    // Newest-first, matching the live creation path which prepends.
    saveBookingQueue([...created, ...existing]);

    // One summary audit event per company keeps the trail meaningful without
    // emitting a noisy per-item log for a bulk one-time migration.
    const countByCompany = new Map<string, number>();
    for (const item of created) {
      countByCompany.set(item.companyId, (countByCompany.get(item.companyId) ?? 0) + 1);
    }
    const events = read<AuditEvent[]>(AUDIT_KEY, []);
    const backfillEvents: AuditEvent[] = [];
    for (const [companyId, count] of countByCompany) {
      backfillEvents.push({
        id: makeId("aud"),
        at: now,
        actorId: null,
        actorName: "System",
        actorRole: "super_admin",
        companyId,
        action: "bookingqueue.create",
        summary: `Backfilled ${count} Booking Lists item${count === 1 ? "" : "s"} for existing work order service rows.`,
      });
    }
    saveAuditEvents([...backfillEvents, ...events].slice(0, 500));
  }

  localStorage.setItem(BOOKING_QUEUE_BACKFILL_MIGRATION_KEY, "1");
}

/**
 * One-time, idempotent migration that re-syncs the planning snapshot fields
 * (service date, planned times, duration, assigned employees, recurrence,
 * assignment status) onto Booking Queue items that predate those fields, by
 * reading their source work-order service row — the source of truth. Items whose
 * source row no longer exists are left untouched. Booking-level fields
 * (cancellation, reschedule, schedule placement) are never modified.
 */
function ensureBookingQueueSnapshotSynced(): void {
  if (localStorage.getItem(BOOKING_QUEUE_SNAPSHOT_MIGRATION_KEY)) return;

  const items = read<BookingQueueItem[]>(BOOKING_QUEUE_KEY, []);
  if (items.length === 0) {
    localStorage.setItem(BOOKING_QUEUE_SNAPSHOT_MIGRATION_KEY, "1");
    return;
  }

  const workOrders = read<WorkOrder[]>(WORK_ORDERS_KEY, []).map(normalizeWorkOrder);
  const customers = read<Customer[]>(CUSTOMERS_KEY, []);
  const employees = read<Employee[]>(EMPLOYEES_KEY, []);
  const resolveEmployeeName = (id: string): string | undefined =>
    employees.find((e) => e.id === id)?.name;

  let changed = false;
  const synced = items.map((item) => {
    const order = workOrders.find((w) => w.id === item.workOrderId);
    const row = order?.serviceRows?.find((r) => r.id === item.serviceRowId);
    if (!order || !row) return item;
    const snapshot = buildBookingSnapshot(row, resolveEmployeeName);
    const customerName =
      customers.find((c) => c.id === order.customerId)?.name ?? item.customerName;
    changed = true;
    return {
      ...item,
      workOrderNumber: order.number,
      customerId: order.customerId,
      customerName,
      serviceName: snapshot.serviceName,
      serviceDate: snapshot.serviceDate,
      serviceEndDate: snapshot.serviceEndDate,
      plannedStartTime: snapshot.plannedStartTime,
      plannedEndTime: snapshot.plannedEndTime,
      durationMinutes: snapshot.durationMinutes,
      assignedEmployeeIds: snapshot.assignedEmployeeIds,
      assignedEmployeeNames: snapshot.assignedEmployeeNames,
      unassignedEmployeeSlots: snapshot.unassignedEmployeeSlots,
      assignmentStatus: snapshot.assignmentStatus,
      recurrenceInterval: snapshot.recurrenceInterval,
      employeeTimeOverrides: snapshot.employeeTimeOverrides,
      hasCustomEmployeeTimes: snapshot.hasCustomEmployeeTimes,
    };
  });

  if (changed) saveBookingQueue(synced);
  localStorage.setItem(BOOKING_QUEUE_SNAPSHOT_MIGRATION_KEY, "1");
}

/** Seeds demo work orders and invoices for the Bergen customer on first launch. */
function ensureWorkOrdersAndInvoicesSeeded(): void {
  const now = new Date();
  const daysAgo = (d: number): string =>
    new Date(now.getTime() - d * 86400000).toISOString();
  const daysAhead = (d: number): string =>
    new Date(now.getTime() + d * 86400000).toISOString();

  if (!localStorage.getItem(WORK_ORDERS_KEY)) {
    const seedActivity = (at: string): WorkOrder["activity"] => [
      { id: makeId("woact"), action: "created", summary: "Work order created", actorId: null, actorName: "System", at },
    ];
    const workOrders: WorkOrder[] = [
      { id: "wo_bergen_1", companyId: "cmp_nordlys", customerId: "cust_bergen", number: "WO-1001", title: "Regular Cleaning", status: "planned", startDate: daysAhead(2), endDate: daysAhead(2), createdBy: null, createdByName: "System", notes: [], activity: seedActivity(daysAgo(10)), createdAt: daysAgo(10), updatedAt: daysAgo(2) },
      { id: "wo_bergen_2", companyId: "cmp_nordlys", customerId: "cust_bergen", number: "WO-1002", title: "Window Cleaning", status: "in_progress", startDate: daysAgo(1), endDate: daysAhead(1), createdBy: null, createdByName: "System", notes: [], activity: seedActivity(daysAgo(6)), createdAt: daysAgo(6), updatedAt: daysAgo(1) },
      { id: "wo_bergen_3", companyId: "cmp_nordlys", customerId: "cust_bergen", number: "WO-0990", title: "Deep Cleaning", status: "completed", startDate: daysAgo(30), endDate: daysAgo(30), createdBy: null, createdByName: "System", notes: [], activity: seedActivity(daysAgo(35)), createdAt: daysAgo(35), updatedAt: daysAgo(28) },
      { id: "wo_bergen_4", companyId: "cmp_nordlys", customerId: "cust_bergen", number: "WO-0975", title: "Move-Out Cleaning", status: "inactive", startDate: daysAgo(60), endDate: daysAgo(60), createdBy: null, createdByName: "System", notes: [], activity: seedActivity(daysAgo(64)), createdAt: daysAgo(64), updatedAt: daysAgo(58) },
    ];
    write(WORK_ORDERS_KEY, workOrders);
  }

  if (!localStorage.getItem(INVOICES_KEY)) {
    const invoices: Invoice[] = [
      { id: "inv_bergen_1", companyId: "cmp_nordlys", customerId: "cust_bergen", number: "INV-2001", status: "paid", amountToPay: 4900, amountPaid: 4900, invoiceDate: daysAgo(40), dueDate: daysAgo(26), fullyPaidDate: daysAgo(24), createdAt: daysAgo(40) },
      { id: "inv_bergen_2", companyId: "cmp_nordlys", customerId: "cust_bergen", number: "INV-2014", status: "unpaid", amountToPay: 3500, amountPaid: 0, invoiceDate: daysAgo(8), dueDate: daysAhead(6), createdAt: daysAgo(8) },
      { id: "inv_bergen_3", companyId: "cmp_nordlys", customerId: "cust_bergen", number: "INV-1998", status: "overdue", amountToPay: 6200, amountPaid: 2000, invoiceDate: daysAgo(45), dueDate: daysAgo(15), reminderDate: daysAgo(5), createdAt: daysAgo(45) },
    ];
    write(INVOICES_KEY, invoices);
  }

  if (!localStorage.getItem(WORK_ORDER_SETTINGS_KEY)) {
    write(WORK_ORDER_SETTINGS_KEY, [] as WorkOrderSettings[]);
  }

  if (!localStorage.getItem(TIME_REPORT_SETTINGS_KEY)) {
    write(TIME_REPORT_SETTINGS_KEY, [] as TimeReportSettings[]);
  }

  if (!localStorage.getItem(DURATION_SETTINGS_KEY)) {
    write(DURATION_SETTINGS_KEY, [] as DurationSettings[]);
  }

  if (!localStorage.getItem(TIME_REPORTS_KEY)) {
    write(TIME_REPORTS_KEY, [] as TimeReport[]);
  }

  if (!localStorage.getItem(BOOKING_QUEUE_KEY)) {
    write(BOOKING_QUEUE_KEY, [] as BookingQueueItem[]);
  }

  if (!localStorage.getItem(SYSTEM_SETTINGS_KEY)) {
    write(SYSTEM_SETTINGS_KEY, defaultSystemSettings());
  }

  if (!localStorage.getItem(SERVICE_GLOBAL_ENTITLEMENTS_KEY)) {
    write(SERVICE_GLOBAL_ENTITLEMENTS_KEY, [] as ServiceGlobalEntitlement[]);
  }

  if (!localStorage.getItem(COMPANY_SERVICE_ENTITLEMENTS_KEY)) {
    // Seed the primary demo company onto a Media Uploads trial so the premium
    // gate and the "X / limit images used" meter are immediately demonstrable.
    // Brand-new companies receive no record and default to disabled.
    const trialAt = daysAgo(14);
    write(COMPANY_SERVICE_ENTITLEMENTS_KEY, [
      {
        companyId: "cmp_nordlys",
        serviceKey: "media_uploads",
        status: "trial",
        enabled: true,
        enabledAt: trialAt,
        disabledAt: null,
        trialStartedAt: trialAt,
        trialEndedAt: null,
        updatedBy: null,
        updatedAt: trialAt,
      },
    ] as CompanyServiceEntitlement[]);
  }

  if (!localStorage.getItem(SERVICE_ENTITLEMENT_LOG_KEY)) {
    write(SERVICE_ENTITLEMENT_LOG_KEY, [] as ServiceEntitlementLogEntry[]);
  }
}

// ── Work orders & invoices (customer-card foundation) ──

/**
 * Backfills service-row fields added after some work orders were already
 * persisted, so legacy data reads safely. `serviceDate` is required going
 * forward; for older rows it falls back to the row's (or order's) creation
 * date so the row still has a valid planning date. `assignedEmployeeIds`
 * defaults to an empty array (no employees assigned). New rows already include
 * these fields, so this is a no-op for them.
 */
function normalizeWorkOrder(order: WorkOrder): WorkOrder {
  const rows = order.serviceRows;
  if (!rows || rows.length === 0) return order;
  let changed = false;
  const normalizedRows = rows.map((row) => {
    const hasDate = typeof row.serviceDate === "string" && row.serviceDate.trim().length > 0;
    const hasEmployees = Array.isArray(row.assignedEmployeeIds);
    const hasSlots = typeof row.unassignedEmployeeSlots === "number";
    if (hasDate && hasEmployees && hasSlots) return row;
    changed = true;
    const fallbackDate = (row.createdAt ?? order.createdAt ?? new Date().toISOString()).slice(0, 10);
    return {
      ...row,
      serviceDate: hasDate ? row.serviceDate : fallbackDate,
      assignedEmployeeIds: hasEmployees ? row.assignedEmployeeIds : [],
      unassignedEmployeeSlots: normalizeUnassignedSlots(row.unassignedEmployeeSlots),
    };
  });
  return changed ? { ...order, serviceRows: normalizedRows } : order;
}

export function getWorkOrders(): WorkOrder[] {
  ensureSeeded();
  return read<WorkOrder[]>(WORK_ORDERS_KEY, []).map(normalizeWorkOrder);
}

export function saveWorkOrders(workOrders: WorkOrder[]): void {
  write(WORK_ORDERS_KEY, workOrders);
}

export function getWorkOrderSettings(): WorkOrderSettings[] {
  ensureSeeded();
  return read<WorkOrderSettings[]>(WORK_ORDER_SETTINGS_KEY, []);
}

export function saveWorkOrderSettings(settings: WorkOrderSettings[]): void {
  write(WORK_ORDER_SETTINGS_KEY, settings);
}

export function getTimeReportSettings(): TimeReportSettings[] {
  ensureSeeded();
  return read<TimeReportSettings[]>(TIME_REPORT_SETTINGS_KEY, []);
}

export function saveTimeReportSettings(settings: TimeReportSettings[]): void {
  write(TIME_REPORT_SETTINGS_KEY, settings);
}

export function getDurationSettings(): DurationSettings[] {
  ensureSeeded();
  return read<DurationSettings[]>(DURATION_SETTINGS_KEY, []);
}

export function saveDurationSettings(settings: DurationSettings[]): void {
  write(DURATION_SETTINGS_KEY, settings);
}

export function getSystemSettings(): SystemSettings {
  ensureSeeded();
  return normalizeSystemSettings(
    read<SystemSettings>(SYSTEM_SETTINGS_KEY, defaultSystemSettings()),
  );
}

export function saveSystemSettings(settings: SystemSettings): void {
  write(SYSTEM_SETTINGS_KEY, settings);
}

export function getServiceGlobalEntitlements(): ServiceGlobalEntitlement[] {
  ensureSeeded();
  return read<ServiceGlobalEntitlement[]>(SERVICE_GLOBAL_ENTITLEMENTS_KEY, []);
}

export function saveServiceGlobalEntitlements(items: ServiceGlobalEntitlement[]): void {
  write(SERVICE_GLOBAL_ENTITLEMENTS_KEY, items);
}

export function getCompanyServiceEntitlements(): CompanyServiceEntitlement[] {
  ensureSeeded();
  return read<CompanyServiceEntitlement[]>(COMPANY_SERVICE_ENTITLEMENTS_KEY, []);
}

export function saveCompanyServiceEntitlements(items: CompanyServiceEntitlement[]): void {
  write(COMPANY_SERVICE_ENTITLEMENTS_KEY, items);
}

export function getServiceEntitlementLog(): ServiceEntitlementLogEntry[] {
  ensureSeeded();
  return read<ServiceEntitlementLogEntry[]>(SERVICE_ENTITLEMENT_LOG_KEY, []);
}

export function saveServiceEntitlementLog(items: ServiceEntitlementLogEntry[]): void {
  write(SERVICE_ENTITLEMENT_LOG_KEY, items);
}

/**
 * Backfills the forward-compatible deviation-allocation and audit fields on
 * time reports persisted before those fields existed, so legacy data reads
 * safely. The full deviation defaults to billable (worked time is never lost),
 * and a synthetic `checked_out` audit entry is seeded when none exists. New
 * reports already include these fields, so this is a no-op for them.
 */
function normalizeTimeReport(report: TimeReport): TimeReport {
  const hasAllocation =
    typeof report.billableDeviationMinutes === "number" &&
    typeof report.internalDeviationMinutes === "number";
  const allocation = hasAllocation
    ? {
        billableDeviationMinutes: report.billableDeviationMinutes,
        internalDeviationMinutes: report.internalDeviationMinutes,
      }
    : defaultDeviationAllocation(report.deviationMinutes ?? 0);

  const auditHistory =
    Array.isArray(report.auditHistory) && report.auditHistory.length > 0
      ? report.auditHistory
      : [
          buildTimeReportAuditEntry({
            action: "checked_out",
            description: `Time report recorded for ${report.jobName ?? "job"}.`,
            actor: report.employeeName ?? "Employee",
            at: report.submittedAt ?? report.createdAt ?? new Date().toISOString(),
            snapshot: {
              deviationMinutes: report.deviationMinutes ?? 0,
              billableDeviationMinutes: allocation.billableDeviationMinutes,
              internalDeviationMinutes: allocation.internalDeviationMinutes,
              approvalStatus: report.approvalStatus,
            },
          }),
        ];

  return {
    ...report,
    bookingId: report.bookingId ?? null,
    billableDeviationMinutes: allocation.billableDeviationMinutes,
    internalDeviationMinutes: allocation.internalDeviationMinutes,
    deviationReason: report.deviationReason ?? null,
    deviationComment: report.deviationComment ?? null,
    auditHistory,
  };
}

export function getTimeReports(): TimeReport[] {
  ensureSeeded();
  return read<TimeReport[]>(TIME_REPORTS_KEY, []).map(normalizeTimeReport);
}

export function saveTimeReports(reports: TimeReport[]): void {
  write(TIME_REPORTS_KEY, reports);
}

export function getBookingQueue(): BookingQueueItem[] {
  ensureSeeded();
  return read<BookingQueueItem[]>(BOOKING_QUEUE_KEY, []);
}

export function saveBookingQueue(items: BookingQueueItem[]): void {
  write(BOOKING_QUEUE_KEY, items);
}

/**
 * Persisted overlay layer for the Booking Queue: only occurrences that diverge
 * from their base recurrence rule are stored here, keyed by occurrence key. The
 * service row remains the source of truth; an empty list means every occurrence
 * follows its rule.
 */
export function getBookingOccurrenceExceptions(): BookingOccurrenceException[] {
  ensureSeeded();
  return read<BookingOccurrenceException[]>(BOOKING_OCCURRENCE_EXCEPTIONS_KEY, []);
}

export function saveBookingOccurrenceExceptions(items: BookingOccurrenceException[]): void {
  write(BOOKING_OCCURRENCE_EXCEPTIONS_KEY, items);
}

export function getInvoices(): Invoice[] {
  ensureSeeded();
  return read<Invoice[]>(INVOICES_KEY, []);
}

export function saveInvoices(invoices: Invoice[]): void {
  write(INVOICES_KEY, invoices);
}

function ensureRolesSeeded(): void {
  if (localStorage.getItem(ROLES_KEY)) return;
  const companies = read<Company[]>(COMPANIES_KEY, []);
  write(ROLES_KEY, seedRoles(companies));
}

function ensureDirectorySeeded(): void {
  if (localStorage.getItem(EMPLOYEES_KEY)) return;
  const { employees, customers, teams } = seedDirectory();
  write(EMPLOYEES_KEY, employees);
  write(CUSTOMERS_KEY, customers);
  write(TEAMS_KEY, teams);
}

function ensureModulesSeeded(): void {
  if (!localStorage.getItem(MODULES_KEY)) {
    write(MODULES_KEY, seedModules());
  }
  if (!localStorage.getItem(COMPANY_MODULES_KEY)) {
    const companies = read<Company[]>(COMPANIES_KEY, []);
    write(COMPANY_MODULES_KEY, seedCompanyModules(companies));
  }
  ensureModulesUpToDate();
}

/**
 * Reconciles persisted module records with the catalogue so newly-shipped
 * modules (e.g. My Cleaning Protocols) appear for already-seeded workspaces.
 * Adds any missing global module record and a per-company setting (available
 * and enabled by default) without disturbing existing toggles.
 */
function ensureModulesUpToDate(): void {
  const modules = read<Module[]>(MODULES_KEY, []);
  const knownIds = new Set(modules.map((m) => m.id));
  const missing = MODULE_DEFINITIONS.filter((def) => !knownIds.has(def.id));
  if (missing.length > 0) {
    const createdAt = new Date().toISOString();
    const added: Module[] = missing.map((def) => ({
      id: def.id,
      name: def.name,
      description: def.description,
      status: "active" as EntityStatus,
      allowedUserTypes: [...def.allowedUserTypes],
      createdAt,
    }));
    write(MODULES_KEY, [...modules, ...added]);
  }

  const companies = read<Company[]>(COMPANIES_KEY, []);
  const settings = read<CompanyModuleSetting[]>(COMPANY_MODULES_KEY, []);
  const settingKey = (companyId: string, moduleId: string) => `${companyId}::${moduleId}`;
  const present = new Set(settings.map((s) => settingKey(s.companyId, s.moduleId)));
  const newSettings: CompanyModuleSetting[] = [];
  for (const company of companies) {
    for (const def of MODULE_DEFINITIONS) {
      if (!present.has(settingKey(company.id, def.id))) {
        newSettings.push({ companyId: company.id, moduleId: def.id, available: true, enabled: true });
      }
    }
  }
  if (newSettings.length > 0) {
    write(COMPANY_MODULES_KEY, [...settings, ...newSettings]);
  }
}

function ensureModuleCategoriesSeeded(): void {
  if (!localStorage.getItem(MODULE_CATEGORIES_KEY)) {
    write(MODULE_CATEGORIES_KEY, seedModuleCategories());
  }
}

/** Seeds a few starter checklist templates so the editor isn't empty on first run. */
function seedChecklistTemplates(): ChecklistTemplate[] {
  const now = new Date();
  const daysAgo = (d: number): string =>
    new Date(now.getTime() - d * 86400000).toISOString();

  return [
    {
      id: "chk_tpl_office",
      companyId: null,
      name: "Standard Office Cleaning",
      description: "A baseline daily office cleaning routine across two floors.",
      status: "active",
      archived: false,
      availableToCompanies: true,
      templateType: "global",
      createdBy: "usr_root",
      notes: "Use for standard commercial office contracts. Confirm access codes before each visit.",
      images: [],
      createdAt: daysAgo(40),
      updatedAt: daysAgo(5),
      floors: [
        {
          id: "flr_office_1",
          name: "Ground Floor",
          sortOrder: 0,
          rooms: [
            {
              id: "rm_office_reception",
              name: "Reception",
              sortOrder: 0,
              tasks: [
                { id: "tsk_o1", name: "Wipe reception desk", description: "Disinfect all surfaces.", autoEnabled: true, sortOrder: 0 },
                { id: "tsk_o2", name: "Vacuum entrance mats", autoEnabled: true, sortOrder: 1 },
                { id: "tsk_o3", name: "Empty waste bins", autoEnabled: false, sortOrder: 2 },
              ],
            },
            {
              id: "rm_office_wc_g",
              name: "Restrooms",
              sortOrder: 1,
              tasks: [
                { id: "tsk_o4", name: "Clean and disinfect toilets", autoEnabled: true, sortOrder: 0 },
                { id: "tsk_o5", name: "Refill soap and paper", autoEnabled: true, sortOrder: 1 },
              ],
            },
          ],
        },
        {
          id: "flr_office_2",
          name: "First Floor",
          sortOrder: 1,
          rooms: [
            {
              id: "rm_office_open",
              name: "Open Workspace",
              sortOrder: 0,
              tasks: [
                { id: "tsk_o6", name: "Wipe desks and monitors", autoEnabled: true, sortOrder: 0 },
                { id: "tsk_o7", name: "Vacuum carpet", autoEnabled: true, sortOrder: 1 },
              ],
            },
            {
              id: "rm_office_kitchen",
              name: "Kitchen",
              sortOrder: 1,
              tasks: [
                { id: "tsk_o8", name: "Clean counters and sink", autoEnabled: true, sortOrder: 0 },
                { id: "tsk_o9", name: "Wipe appliances", autoEnabled: false, sortOrder: 1 },
              ],
            },
          ],
        },
      ],
    },
    {
      id: "chk_tpl_nordlys_clinic",
      companyId: "cmp_nordlys",
      name: "Clinic Deep Clean",
      description: "Company-owned protocol for medical clinic clients.",
      status: "active",
      archived: false,
      availableToCompanies: false,
      templateType: "company",
      createdBy: "usr_admin1",
      notes: "Follow infection-control guidance. Use colour-coded cloths per zone.",
      images: [],
      createdAt: daysAgo(20),
      updatedAt: daysAgo(2),
      floors: [
        {
          id: "flr_clinic_1",
          name: "Treatment Floor",
          sortOrder: 0,
          rooms: [
            {
              id: "rm_clinic_exam",
              name: "Exam Room",
              sortOrder: 0,
              tasks: [
                { id: "tsk_c1", name: "Disinfect exam table", autoEnabled: true, sortOrder: 0 },
                { id: "tsk_c2", name: "Sanitise instrument trays", autoEnabled: true, sortOrder: 1 },
              ],
            },
          ],
        },
      ],
    },
  ];
}

function ensureChecklistSeeded(): void {
  if (!localStorage.getItem(CHECKLIST_TEMPLATES_KEY)) {
    write(CHECKLIST_TEMPLATES_KEY, seedChecklistTemplates());
  }
  if (!localStorage.getItem(CHECKLIST_ADOPTIONS_KEY)) {
    write(CHECKLIST_ADOPTIONS_KEY, [] as ChecklistTemplateAdoption[]);
  }
  ensureChecklistRolePermissions();
  ensureChecklistSettingsRolePermissions();
  ensureChecklistExecutionRolePermissions();
  ensureGlobalTemplatesRolePermissions();
  ensureProtocolsSeeded();
}

/** Seeds one demo customer protocol so the editor isn't empty on first run. */
function seedCustomerProtocols(): CustomerProtocol[] {
  const now = new Date();
  const daysAgo = (d: number): string =>
    new Date(now.getTime() - d * 86400000).toISOString();

  return [
    {
      id: "prot_bergen_office",
      companyId: "cmp_nordlys",
      customerId: "cust_bergen",
      name: "Bergen Office Park — Daily Clean",
      description: "Customer protocol derived from the standard office routine.",
      sourceTemplateId: "chk_tpl_office",
      sourceTemplateName: "Standard Office Cleaning",
      createdBy: "usr_admin1",
      status: "active",
      notes: "Access via the loading bay after 18:00. Confirm alarm code with reception.",
      createdAt: daysAgo(12),
      updatedAt: daysAgo(3),
      floors: [
        {
          id: "pflr_bergen_g",
          name: "Ground Floor",
          sortOrder: 0,
          rooms: [
            {
              id: "prm_bergen_reception",
              name: "Reception",
              active: true,
              sortOrder: 0,
              notes: "Do not move the coffee machine.",
              tasks: [
                { id: "ptsk_b1", name: "Wipe reception desk", description: "Disinfect all surfaces.", autoEnabled: true, state: "active", sortOrder: 0 },
                { id: "ptsk_b2", name: "Vacuum entrance mats", autoEnabled: true, state: "active", sortOrder: 1 },
                { id: "ptsk_b3", name: "Empty waste bins", autoEnabled: false, state: "excluded", exclusionReason: "Customer empties bins in-house.", sortOrder: 2 },
              ],
            },
            {
              id: "prm_bergen_wc",
              name: "Restrooms",
              active: false,
              sortOrder: 1,
              tasks: [
                { id: "ptsk_b4", name: "Clean and disinfect toilets", autoEnabled: true, state: "inactive", sortOrder: 0 },
                { id: "ptsk_b5", name: "Refill soap and paper", autoEnabled: true, state: "inactive", sortOrder: 1 },
              ],
            },
          ],
        },
        {
          id: "pflr_bergen_1",
          name: "First Floor",
          sortOrder: 1,
          rooms: [
            {
              id: "prm_bergen_open",
              name: "Open Workspace",
              active: false,
              sortOrder: 0,
              tasks: [
                { id: "ptsk_b6", name: "Wipe desks and monitors", autoEnabled: true, state: "inactive", sortOrder: 0 },
                { id: "ptsk_b7", name: "Vacuum carpet", autoEnabled: true, state: "inactive", sortOrder: 1 },
              ],
            },
            {
              id: "prm_bergen_kitchen",
              name: "Kitchen",
              active: false,
              sortOrder: 1,
              tasks: [
                { id: "ptsk_b8", name: "Clean counters and sink", autoEnabled: true, state: "inactive", sortOrder: 0 },
                { id: "ptsk_b9", name: "Wipe appliances", autoEnabled: false, state: "inactive", sortOrder: 1 },
              ],
            },
          ],
        },
      ],
    },
  ];
}

function ensureProtocolsSeeded(): void {
  if (!localStorage.getItem(CUSTOMER_PROTOCOLS_KEY)) {
    write(CUSTOMER_PROTOCOLS_KEY, seedCustomerProtocols());
  }
  ensureProtocolRolePermissions();
  ensureMyProtocolsRolePermissions();
  ensureLibrariesSeeded();
}

/**
 * Grants the read-only "My Cleaning Protocols" permission to existing built-in
 * roles. Customers gain access to their own protocols; admins keep oversight.
 * Runs once so prior workspaces gain the permission without wiping custom edits.
 */
function ensureMyProtocolsRolePermissions(): void {
  if (localStorage.getItem(MY_PROTOCOLS_PERMS_MIGRATION_KEY)) return;
  const roles = read<Role[]>(ROLES_KEY, []);
  const next = roles.map((r) => {
    if (
      r.isSystem &&
      (r.baseRole === "customer" ||
        r.baseRole === "company_admin" ||
        r.baseRole === "super_admin")
    ) {
      return {
        ...r,
        permissions: Array.from(new Set([...r.permissions, ...MY_PROTOCOLS_CUSTOMER_PERMISSIONS])),
      };
    }
    return r;
  });
  write(ROLES_KEY, next);
  localStorage.setItem(MY_PROTOCOLS_PERMS_MIGRATION_KEY, "1");
}

/** Seeds the global Room and Cleaning Task libraries so they aren't empty. */
function seedLibraryRooms(): LibraryRoom[] {
  const createdAt = new Date().toISOString();
  const make = (
    id: string,
    name: string,
    category: LibraryRoom["category"],
    description: string,
  ): LibraryRoom => ({
    id,
    companyId: null,
    name,
    description,
    category,
    status: "active",
    createdBy: "usr_root",
    createdAt,
  });
  return [
    make("lib_rm_kitchen", "Kitchen", "common_area", "Shared kitchen or kitchenette."),
    make("lib_rm_bathroom", "Bathroom", "sanitary_area", "Toilet and washing facilities."),
    make("lib_rm_office", "Office", "office", "Private or shared office space."),
    make("lib_rm_conference", "Conference Room", "office", "Meeting and conference space."),
    make("lib_rm_entrance", "Entrance", "common_area", "Main entrance and lobby area."),
    make("lib_rm_staircase", "Staircase", "common_area", "Stairwells between floors."),
    make("lib_rm_break", "Break Room", "common_area", "Staff break and rest area."),
    make("lib_rm_laundry", "Laundry Room", "sanitary_area", "Laundry and utility space."),
    make("lib_rm_storage", "Storage Room", "storage", "Storage and supply room."),
  ];
}

function seedLibraryTasks(): LibraryTask[] {
  const createdAt = new Date().toISOString();
  const make = (
    id: string,
    name: string,
    category: LibraryTask["category"],
    defaultAutoEnabled: boolean,
    description?: string,
  ): LibraryTask => ({
    id,
    companyId: null,
    name,
    description,
    defaultAutoEnabled,
    category,
    status: "active",
    createdBy: "usr_root",
    createdAt,
  });
  return [
    make("lib_tsk_dust", "Dust surfaces", "dusting", true, "Dust all reachable surfaces."),
    make("lib_tsk_vacuum", "Vacuum floor", "floor_care", true),
    make("lib_tsk_mop", "Wet mop floor", "floor_care", true),
    make("lib_tsk_bins", "Empty bins", "waste", true, "Empty and reline waste bins."),
    make("lib_tsk_mirrors", "Clean mirrors", "glass", true),
    make("lib_tsk_doors", "Remove stains from doors", "surface_cleaning", false),
    make("lib_tsk_sink", "Clean sink", "bathroom", true),
    make("lib_tsk_toilet", "Clean toilet", "bathroom", true),
    make("lib_tsk_soap", "Refill soap", "refill", true),
    make("lib_tsk_tables", "Clean tables", "surface_cleaning", true),
  ];
}

function ensureLibrariesSeeded(): void {
  if (!localStorage.getItem(LIBRARY_ROOMS_KEY)) {
    write(LIBRARY_ROOMS_KEY, seedLibraryRooms());
  }
  if (!localStorage.getItem(LIBRARY_TASKS_KEY)) {
    write(LIBRARY_TASKS_KEY, seedLibraryTasks());
  }
}

/** Seeds starter settings templates so the Super Admin console isn't empty. */
function seedSettingsTemplates(): SettingsTemplate[] {
  const now = new Date().toISOString();
  let counter = 0;
  const item = (name: string, detail?: string): { id: string; name: string; detail?: string } => {
    counter += 1;
    return { id: `set_seed_${counter}`, name, detail };
  };

  const build = (
    id: string,
    name: string,
    description: string,
    data: Partial<SettingsData>,
  ): SettingsTemplate => ({
    id,
    name,
    description,
    archived: false,
    createdBy: "usr_root",
    data: { ...emptySettingsData(), ...data },
    createdAt: now,
    updatedAt: now,
  });

  return [
    build("set_tpl_default", "Default Cleaning Company Setup", "A sensible baseline for a new cleaning company.", {
      services: [item("Regular Cleaning", "Recurring scheduled cleaning"), item("Deep Cleaning"), item("Window Cleaning"), item("Move-Out Cleaning")],
      customerTypes: [item("Residential"), item("Commercial"), item("Office")],
      areas: [item("City Centre"), item("North"), item("South")],
      tagGroups: [item("Priority"), item("Access")],
      tags: [item("VIP", "Priority"), item("Key Holder", "Access"), item("Alarm", "Access")],
      materials: [item("All-purpose Cleaner"), item("Microfiber Cloth"), item("Vacuum")],
      workOrderGroups: [item("Standard"), item("Urgent")],
      timeCodes: [item("Regular Hours", "T-100"), item("Overtime", "T-200")],
      publicHolidays: [item("New Year's Day", "1 Jan"), item("Christmas Day", "25 Dec")],
    }),
    build("set_tpl_sweden", "Sweden", "Swedish defaults including public holidays.", {
      services: [item("St\u00e4dning", "Regular cleaning"), item("Storst\u00e4dning", "Deep cleaning"), item("F\u00f6nsterputs", "Window cleaning")],
      customerTypes: [item("Privat"), item("F\u00f6retag")],
      areas: [item("Stockholm"), item("G\u00f6teborg"), item("Malm\u00f6")],
      tagGroups: [item("Prioritet")],
      tags: [item("VIP", "Prioritet")],
      materials: [item("Allrang\u00f6ring"), item("Mikrofiberduk")],
      workOrderGroups: [item("Standard")],
      timeCodes: [item("Ordinarie", "T-100"), item("\u00d6vertid", "T-200")],
      publicHolidays: [item("Ny\u00e5rsdagen", "1 Jan"), item("Midsommarafton", "21 Jun"), item("Nationaldagen", "6 Jun")],
    }),
    build("set_tpl_uk", "United Kingdom", "UK defaults including bank holidays.", {
      services: [item("Regular Cleaning"), item("End of Tenancy"), item("Window Cleaning")],
      customerTypes: [item("Domestic"), item("Commercial")],
      areas: [item("London"), item("Manchester"), item("Birmingham")],
      tagGroups: [item("Priority")],
      tags: [item("VIP", "Priority")],
      materials: [item("All-purpose Cleaner"), item("Microfibre Cloth")],
      workOrderGroups: [item("Standard")],
      timeCodes: [item("Standard Hours", "T-100")],
      publicHolidays: [item("New Year's Day", "1 Jan"), item("Boxing Day", "26 Dec")],
    }),
    build("set_tpl_norway", "Norway", "Norwegian defaults including public holidays.", {
      services: [item("Renhold", "Regular cleaning"), item("Hovedrengj\u00f8ring", "Deep cleaning")],
      customerTypes: [item("Privat"), item("Bedrift")],
      areas: [item("Oslo"), item("Bergen"), item("Trondheim")],
      tagGroups: [item("Prioritet")],
      tags: [item("VIP", "Prioritet")],
      materials: [item("Allrengj\u00f8ring"), item("Mikrofiberklut")],
      workOrderGroups: [item("Standard")],
      timeCodes: [item("Ordin\u00e6r", "T-100")],
      publicHolidays: [item("Nytt\u00e5rsdag", "1 Jan"), item("Grunnlovsdag", "17 Mai")],
    }),
    build("set_tpl_denmark", "Denmark", "Danish defaults including public holidays.", {
      services: [item("Reng\u00f8ring", "Regular cleaning"), item("Hovedreng\u00f8ring", "Deep cleaning")],
      customerTypes: [item("Privat"), item("Erhverv")],
      areas: [item("K\u00f8benhavn"), item("Aarhus"), item("Odense")],
      tagGroups: [item("Prioritet")],
      tags: [item("VIP", "Prioritet")],
      materials: [item("Universalreng\u00f8ring"), item("Mikrofiberklud")],
      workOrderGroups: [item("Standard")],
      timeCodes: [item("Normal", "T-100")],
      publicHolidays: [item("Nyt\u00e5rsdag", "1 Jan"), item("Grundlovsdag", "5 Jun")],
    }),
  ];
}

function ensureSettingsTemplatesSeeded(): void {
  if (!localStorage.getItem(SETTINGS_TEMPLATES_KEY)) {
    write(SETTINGS_TEMPLATES_KEY, seedSettingsTemplates());
  }
  if (!localStorage.getItem(COMPANY_SETTINGS_KEY)) {
    write(COMPANY_SETTINGS_KEY, [] as CompanySettings[]);
  }
  ensureSettingsTemplatesRolePermissions();
  ensureCalculatorRolePermissions();
  ensureNavigationRolePermissions();
}

/**
 * Grants the settings-template management permission to the Super Admin role.
 * Runs once so previously-seeded workspaces gain the capability without wiping
 * any custom role edits.
 */
function ensureSettingsTemplatesRolePermissions(): void {
  if (localStorage.getItem(SETTINGS_TEMPLATES_PERMS_MIGRATION_KEY)) return;
  const roles = read<Role[]>(ROLES_KEY, []);
  const next = roles.map((r) =>
    r.isSystem && r.baseRole === "super_admin"
      ? { ...r, permissions: Array.from(new Set([...r.permissions, ...SETTINGS_TEMPLATES_SUPER_ADMIN_PERMISSIONS])) }
      : r,
  );
  write(ROLES_KEY, next);
  localStorage.setItem(SETTINGS_TEMPLATES_PERMS_MIGRATION_KEY, "1");
}

/**
 * Grants the price-calculator permissions to the Super Admin role. Runs once so
 * previously-seeded workspaces gain `calculator.view`/`calculator.manage` without
 * wiping custom role edits. Company Admin is intentionally left untouched —
 * calculator ownership for company admins is Phase 2.
 */
function ensureCalculatorRolePermissions(): void {
  if (localStorage.getItem(CALCULATOR_PERMS_MIGRATION_KEY)) return;
  const roles = read<Role[]>(ROLES_KEY, []);
  const next = roles.map((r) =>
    r.isSystem && r.baseRole === "super_admin"
      ? { ...r, permissions: Array.from(new Set([...r.permissions, ...CALCULATOR_SUPER_ADMIN_PERMISSIONS])) }
      : r,
  );
  write(ROLES_KEY, next);
  localStorage.setItem(CALCULATOR_PERMS_MIGRATION_KEY, "1");
}

/**
 * Grants the navigation/menu management permission to the Super Admin role.
 * Runs once so previously-seeded workspaces gain `navigation.manage` without
 * wiping custom role edits. Company Admin is intentionally left untouched.
 */
function ensureNavigationRolePermissions(): void {
  if (localStorage.getItem(NAVIGATION_PERMS_MIGRATION_KEY)) return;
  const roles = read<Role[]>(ROLES_KEY, []);
  const next = roles.map((r) =>
    r.isSystem && r.baseRole === "super_admin"
      ? { ...r, permissions: Array.from(new Set([...r.permissions, ...NAVIGATION_SUPER_ADMIN_PERMISSIONS])) }
      : r,
  );
  write(ROLES_KEY, next);
  localStorage.setItem(NAVIGATION_PERMS_MIGRATION_KEY, "1");
}

/**
 * Grants customer-protocol permissions to existing built-in admin roles. Runs
 * once so previously-seeded workspaces gain the new module's permissions without
 * wiping any custom role edits.
 */
function ensureProtocolRolePermissions(): void {
  if (localStorage.getItem(PROTOCOL_PERMS_MIGRATION_KEY)) return;
  const roles = read<Role[]>(ROLES_KEY, []);
  const next = roles.map((r) => {
    if (r.isSystem && r.baseRole === "super_admin") {
      return { ...r, permissions: Array.from(new Set([...r.permissions, ...PROTOCOL_SUPER_ADMIN_PERMISSIONS])) };
    }
    if (r.isSystem && r.baseRole === "company_admin") {
      return { ...r, permissions: Array.from(new Set([...r.permissions, ...PROTOCOL_COMPANY_ADMIN_PERMISSIONS])) };
    }
    return r;
  });
  write(ROLES_KEY, next);
  localStorage.setItem(PROTOCOL_PERMS_MIGRATION_KEY, "1");
}

/**
 * Grants the checklist template permissions to existing built-in admin roles.
 * Runs once so previously-seeded workspaces gain the new module's permissions
 * without wiping any custom role edits.
 */
function ensureChecklistRolePermissions(): void {
  if (localStorage.getItem(CHECKLIST_PERMS_MIGRATION_KEY)) return;
  const roles = read<Role[]>(ROLES_KEY, []);
  const next = roles.map((r) => {
    if (r.isSystem && (r.baseRole === "super_admin" || r.baseRole === "company_admin")) {
      const merged = Array.from(new Set([...r.permissions, ...CHECKLIST_ADMIN_PERMISSIONS]));
      return { ...r, permissions: merged };
    }
    return r;
  });
  write(ROLES_KEY, next);
  localStorage.setItem(CHECKLIST_PERMS_MIGRATION_KEY, "1");
}

/**
 * Grants the Checklist Manager settings permissions to existing built-in Super
 * Admin and Company Admin roles. Runs once so previously-seeded workspaces gain
 * the new permissions without wiping any custom role edits.
 */
function ensureChecklistSettingsRolePermissions(): void {
  if (localStorage.getItem(CHECKLIST_SETTINGS_PERMS_MIGRATION_KEY)) return;
  const roles = read<Role[]>(ROLES_KEY, []);
  const next = roles.map((r) =>
    r.isSystem && (r.baseRole === "super_admin" || r.baseRole === "company_admin")
      ? { ...r, permissions: Array.from(new Set([...r.permissions, ...CHECKLIST_SETTINGS_ADMIN_PERMISSIONS])) }
      : r,
  );
  write(ROLES_KEY, next);
  localStorage.setItem(CHECKLIST_SETTINGS_PERMS_MIGRATION_KEY, "1");
}

/**
 * Grants the Checklist Manager execution permissions to existing built-in Super
 * Admin and Company Admin roles. Runs once so previously-seeded workspaces gain
 * the new permissions without wiping any custom role edits.
 */
function ensureChecklistExecutionRolePermissions(): void {
  if (localStorage.getItem(CHECKLIST_EXECUTION_PERMS_MIGRATION_KEY)) return;
  const roles = read<Role[]>(ROLES_KEY, []);
  const next = roles.map((r) =>
    r.isSystem && (r.baseRole === "super_admin" || r.baseRole === "company_admin")
      ? { ...r, permissions: Array.from(new Set([...r.permissions, ...CHECKLIST_EXECUTION_ADMIN_PERMISSIONS])) }
      : r,
  );
  write(ROLES_KEY, next);
  localStorage.setItem(CHECKLIST_EXECUTION_PERMS_MIGRATION_KEY, "1");
}

/**
 * Grants Global Template permissions to existing built-in roles: full
 * management for the Super Admin and read-only visibility for the Company
 * Admin. Runs once so previously-seeded workspaces gain the new permissions
 * without wiping any custom role edits.
 */
function ensureGlobalTemplatesRolePermissions(): void {
  if (localStorage.getItem(GLOBAL_TEMPLATES_PERMS_MIGRATION_KEY)) return;
  const roles = read<Role[]>(ROLES_KEY, []);
  const next = roles.map((r) => {
    if (!r.isSystem) return r;
    if (r.baseRole === "super_admin") {
      return {
        ...r,
        permissions: Array.from(
          new Set([...r.permissions, ...GLOBAL_TEMPLATES_SUPER_ADMIN_PERMISSIONS]),
        ),
      };
    }
    if (r.baseRole === "company_admin") {
      return {
        ...r,
        permissions: Array.from(
          new Set([...r.permissions, ...GLOBAL_TEMPLATES_COMPANY_ADMIN_PERMISSIONS]),
        ),
      };
    }
    return r;
  });
  write(ROLES_KEY, next);
  localStorage.setItem(GLOBAL_TEMPLATES_PERMS_MIGRATION_KEY, "1");
}

// ── Services (universal catalog) ─────────────────────────

/**
 * Seeds the governed global Service Category catalogue (Super Admin owned). The
 * catalogue is derived from {@link SERVICE_CATEGORY_TYPES} so the stable
 * {@link ServiceCategoryType} keys drive all downstream flows.
 */
function seedServiceCategories(): ServiceCategory[] {
  return buildGlobalServiceCategories(new Date().toISOString());
}

/** Seeds the governed global Payroll Group catalogue (Super Admin owned). */
function seedPayrollGroups(): PayrollGroup[] {
  return buildGlobalPayrollGroups(new Date().toISOString());
}

function seedServices(): Service[] {
  const now = new Date().toISOString();
  const make = (
    id: string,
    categoryId: string,
    name: string,
    extra: Partial<Service> = {},
  ): Service => ({
    id,
    companyId: null,
    categoryId,
    name,
    billingType: "fixed",
    serviceBasisType: "billable",
    deductionEligible: false,
    deductionType: "none",
    smsEnabled: false,
    status: "active",
    createdBy: "usr_root",
    createdAt: now,
    updatedAt: now,
    ...extra,
  });
  return [
    make("svc_regular", globalCategoryId("recurring_service"), "Regular Cleaning", { description: "Recurring scheduled cleaning.", articleNumber: "1001", serviceType: "Cleaning", timeCode: "T-100", billingType: "hourly", deductionEligible: true, deductionType: "rut", price: 49, vat: 25, smsEnabled: true }),
    make("svc_deep", globalCategoryId("one_time_service"), "Deep Cleaning", { description: "Intensive top-to-bottom clean.", articleNumber: "1002", serviceType: "Cleaning", price: 89, vat: 25, deductionEligible: true, deductionType: "rut" }),
    make("svc_window", globalCategoryId("window_cleaning"), "Window Cleaning", { articleNumber: "1003", serviceType: "Cleaning", price: 35, vat: 25 }),
    make("svc_office", globalCategoryId("recurring_service"), "Office Cleaning", { articleNumber: "1004", serviceType: "Commercial", billingType: "subscription", price: 120, vat: 25 }),
    make("svc_moveout", globalCategoryId("one_time_service"), "Move-Out Cleaning", { articleNumber: "1005", serviceType: "Cleaning", price: 150, vat: 25, deductionEligible: true, deductionType: "rut" }),
  ];
}

function seedServicePackages(): ServicePackage[] {
  const now = new Date().toISOString();
  let counter = 0;
  const item = (
    name: string,
    categoryName: string,
    extra: Partial<ServicePackage["items"][number]> = {},
  ): ServicePackage["items"][number] => {
    counter += 1;
    return {
      id: `svc_pkg_item_${counter}`,
      name,
      categoryName,
      billingType: "fixed",
      serviceBasisType: "billable",
      deductionEligible: false,
      deductionType: "none",
      smsEnabled: false,
      ...extra,
    };
  };
  const build = (
    id: string,
    name: string,
    description: string,
    items: ServicePackage["items"],
  ): ServicePackage => ({ id, name, description, archived: false, createdBy: "usr_root", items, createdAt: now, updatedAt: now });

  return [
    build("svc_pkg_starter", "Cleaning Company Starter", "A sensible baseline for a new cleaning company.", [
      item("Regular Cleaning", "Recurring Cleaning", { billingType: "hourly", deductionEligible: true, deductionType: "rut", price: 49, vat: 25 }),
      item("Deep Cleaning", "Deep Cleaning", { price: 89, vat: 25 }),
      item("Window Cleaning", "Specialty", { price: 35, vat: 25 }),
    ]),
    build("svc_pkg_residential", "Residential Cleaning", "Services for homes and apartments.", [
      item("Home Cleaning", "Recurring Cleaning", { billingType: "hourly", deductionEligible: true, deductionType: "rut", price: 45, vat: 25 }),
      item("Move-Out Cleaning", "Deep Cleaning", { price: 150, vat: 25, deductionEligible: true, deductionType: "rut" }),
    ]),
    build("svc_pkg_commercial", "Commercial Cleaning", "Services for offices and businesses.", [
      item("Office Cleaning", "Commercial", { billingType: "subscription", price: 120, vat: 25 }),
      item("Window Cleaning", "Specialty", { price: 35, vat: 25 }),
    ]),
  ];
}

function ensureServicesSeeded(): void {
  if (!localStorage.getItem(SERVICE_CATEGORIES_KEY)) {
    write(SERVICE_CATEGORIES_KEY, seedServiceCategories());
  }
  if (!localStorage.getItem(SERVICES_KEY)) {
    write(SERVICES_KEY, seedServices());
  }
  if (!localStorage.getItem(SERVICE_PACKAGES_KEY)) {
    write(SERVICE_PACKAGES_KEY, seedServicePackages());
  }
  if (!localStorage.getItem(PAYROLL_GROUPS_KEY)) {
    write(PAYROLL_GROUPS_KEY, seedPayrollGroups());
  }
  ensureServiceCategoryGovernance();
  ensureServicesRolePermissions();
}

/**
 * One-time, idempotent, NON-DESTRUCTIVE migration that upgrades existing
 * installs to the governed Service Category model:
 *  - backfills `categoryType` + `updatedAt` on existing global categories using
 *    a best-effort legacy id map (data preserved, never deleted);
 *  - inserts any governed {@link ServiceCategoryType} categories that are
 *    missing so type-scoped flows always have a target;
 *  - ensures the global Payroll Group catalogue exists.
 * Company-scoped categories are left untouched (categoryType stays undefined).
 */
function ensureServiceCategoryGovernance(): void {
  if (localStorage.getItem(SERVICE_CATEGORY_GOVERNANCE_MIGRATION_KEY)) return;
  const now = new Date().toISOString();
  const existing = read<ServiceCategory[]>(SERVICE_CATEGORIES_KEY, []);

  // 1. Backfill categoryType/updatedAt on legacy global categories.
  const backfilled = existing.map((c) => {
    if (c.companyId !== null || c.categoryType) return c;
    const inferred = legacyCategoryTypeForId(c.id);
    return inferred
      ? { ...c, categoryType: inferred, updatedAt: c.updatedAt ?? now }
      : c;
  });

  // 2. Ensure every governed type exists as a global category.
  const presentTypes = new Set(
    backfilled.filter((c) => c.companyId === null && c.categoryType).map((c) => c.categoryType),
  );
  const maxOrder = backfilled
    .filter((c) => c.companyId === null)
    .reduce((m, c) => Math.max(m, c.sortOrder), -1);
  const missing: ServiceCategory[] = SERVICE_CATEGORY_TYPES.filter(
    (t) => !presentTypes.has(t.value),
  ).map((t, i) => ({
    id: globalCategoryId(t.value),
    companyId: null,
    name: t.label,
    categoryType: t.value,
    description: t.description,
    sortOrder: maxOrder + 1 + i,
    status: "active" as const,
    createdBy: "usr_root",
    createdAt: now,
    updatedAt: now,
  }));

  write(SERVICE_CATEGORIES_KEY, [...backfilled, ...missing]);

  // 3. Ensure the global Payroll Group catalogue exists.
  if (!localStorage.getItem(PAYROLL_GROUPS_KEY)) {
    write(PAYROLL_GROUPS_KEY, seedPayrollGroups());
  }

  localStorage.setItem(SERVICE_CATEGORY_GOVERNANCE_MIGRATION_KEY, "1");
}

/**
 * Grants the services management permission to existing built-in Super Admin
 * and Company Admin roles. Runs once so prior workspaces gain the capability
 * without wiping custom role edits.
 */
function ensureServicesRolePermissions(): void {
  if (localStorage.getItem(SERVICES_PERMS_MIGRATION_KEY)) return;
  const roles = read<Role[]>(ROLES_KEY, []);
  const next = roles.map((r) =>
    r.isSystem && (r.baseRole === "super_admin" || r.baseRole === "company_admin")
      ? { ...r, permissions: Array.from(new Set([...r.permissions, ...SERVICES_ADMIN_PERMISSIONS])) }
      : r,
  );
  write(ROLES_KEY, next);
  localStorage.setItem(SERVICES_PERMS_MIGRATION_KEY, "1");
}

export function getServiceCategories(): ServiceCategory[] {
  ensureSeeded();
  return read<ServiceCategory[]>(SERVICE_CATEGORIES_KEY, []);
}

export function saveServiceCategories(categories: ServiceCategory[]): void {
  write(SERVICE_CATEGORIES_KEY, categories);
}

export function getPayrollGroups(): PayrollGroup[] {
  ensureSeeded();
  return read<PayrollGroup[]>(PAYROLL_GROUPS_KEY, []);
}

export function savePayrollGroups(groups: PayrollGroup[]): void {
  write(PAYROLL_GROUPS_KEY, groups);
}

export function getServices(): Service[] {
  ensureSeeded();
  // Backfill: services persisted before serviceBasisType existed default to
  // `billable`, so payroll/invoice/statistics consumers can rely on the field.
  return read<Service[]>(SERVICES_KEY, []).map((s) => ({
    ...s,
    serviceBasisType: normalizeServiceBasisType(s.serviceBasisType),
  }));
}

export function saveServices(services: Service[]): void {
  write(SERVICES_KEY, services);
}

export function getServicePackages(): ServicePackage[] {
  ensureSeeded();
  // Backfill: package items written before serviceBasisType existed default to
  // `billable` so the classification survives a package copy.
  return read<ServicePackage[]>(SERVICE_PACKAGES_KEY, []).map((pkg) => ({
    ...pkg,
    items: pkg.items.map((it) => ({
      ...it,
      serviceBasisType: normalizeServiceBasisType(it.serviceBasisType),
    })),
  }));
}

export function saveServicePackages(packages: ServicePackage[]): void {
  write(SERVICE_PACKAGES_KEY, packages);
}

export function getServiceFavorites(): CompanyServiceFavorite[] {
  ensureSeeded();
  return read<CompanyServiceFavorite[]>(SERVICE_FAVORITES_KEY, []);
}

export function saveServiceFavorites(favorites: CompanyServiceFavorite[]): void {
  write(SERVICE_FAVORITES_KEY, favorites);
}

// ── Employees ─────────────────────────────────

export function getEmployees(): Employee[] {
  ensureSeeded();
  return read<Employee[]>(EMPLOYEES_KEY, []);
}

export function saveEmployees(employees: Employee[]): void {
  write(EMPLOYEES_KEY, employees);
}

// ── Customers ───────────────────────────────

export function getCustomers(): Customer[] {
  ensureSeeded();
  return read<Customer[]>(CUSTOMERS_KEY, []).map(normalizeCustomerRecord);
}

/**
 * Migrates a persisted customer onto the fixed Customer Type classification:
 * normalizes legacy free-text {@link Customer.customerType} values to the
 * hardcoded set and derives {@link Customer.customerSegment} from the type so
 * the recommendation layer stays consistent. Non-destructive — unknown legacy
 * values simply stay unclassified.
 */
function normalizeCustomerRecord(customer: Customer): Customer {
  const customerType = normalizeCustomerType(customer.customerType);
  const customerSegment = segmentForCustomerType(customerType) ?? customer.customerSegment;
  if (customerType === customer.customerType && customerSegment === customer.customerSegment) {
    return customer;
  }
  return { ...customer, customerType, customerSegment };
}

export function saveCustomers(customers: Customer[]): void {
  write(CUSTOMERS_KEY, customers);
}

// ── Teams ──────────────────────────────────

export function getTeams(): Team[] {
  ensureSeeded();
  return read<Team[]>(TEAMS_KEY, []);
}

export function saveTeams(teams: Team[]): void {
  write(TEAMS_KEY, teams);
}

// ── Areas ──────────────────────────────────

/** All areas across every company (active and inactive). */
export function getAreas(): Area[] {
  ensureSeeded();
  return read<Area[]>(AREAS_KEY, []);
}

export function saveAreas(areas: Area[]): void {
  write(AREAS_KEY, areas);
}

/** A company's areas, optionally limited to active ones. */
export function getCompanyAreas(
  companyId: string,
  options?: { activeOnly?: boolean },
): Area[] {
  const owned = getAreas().filter((a) => a.companyId === companyId);
  const filtered = options?.activeOnly ? owned.filter((a) => a.isActive) : owned;
  return filtered.sort((a, b) => a.name.localeCompare(b.name));
}

/** A company's active areas, sorted by name. */
export function getActiveAreas(companyId: string): Area[] {
  return getCompanyAreas(companyId, { activeOnly: true });
}

/**
 * Creates a company-scoped area. Names are unique within a company
 * (case-insensitive, trimmed) across active and inactive areas; a duplicate or
 * empty name returns null.
 */
export function createArea(
  companyId: string,
  input: { name: string; description?: string },
): Area | null {
  const name = input.name.trim();
  if (!name) return null;
  const all = getAreas();
  const normalized = normalizeAreaName(name);
  const clash = all.some(
    (a) => a.companyId === companyId && normalizeAreaName(a.name) === normalized,
  );
  if (clash) return null;
  const now = new Date().toISOString();
  const area: Area = {
    id: makeId("area"),
    companyId,
    name,
    description: input.description?.trim() || undefined,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };
  saveAreas([...all, area]);
  return area;
}

/** Updates an area's editable metadata. Renaming to a clashing name is rejected. */
export function updateArea(
  areaId: string,
  input: { name?: string; description?: string },
): Area | null {
  const all = getAreas();
  const target = all.find((a) => a.id === areaId);
  if (!target) return null;
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) return null;
    const normalized = normalizeAreaName(name);
    const clash = all.some(
      (a) =>
        a.id !== areaId &&
        a.companyId === target.companyId &&
        normalizeAreaName(a.name) === normalized,
    );
    if (clash) return null;
  }
  const updated: Area = {
    ...target,
    name: input.name !== undefined ? input.name.trim() : target.name,
    description:
      input.description !== undefined
        ? input.description.trim() || undefined
        : target.description,
    updatedAt: new Date().toISOString(),
  };
  saveAreas(all.map((a) => (a.id === areaId ? updated : a)));
  return updated;
}

/** Sets an area's active flag. Returns the updated area or null. */
function setAreaActive(areaId: string, isActive: boolean): Area | null {
  const all = getAreas();
  const target = all.find((a) => a.id === areaId);
  if (!target) return null;
  if (target.isActive === isActive) return target;
  const updated: Area = { ...target, isActive, updatedAt: new Date().toISOString() };
  saveAreas(all.map((a) => (a.id === areaId ? updated : a)));
  return updated;
}

/** Deactivates (archives) an area — hidden from pickers, kept for history. */
export function archiveArea(areaId: string): Area | null {
  return setAreaActive(areaId, false);
}

/** Reactivates a previously deactivated area. */
export function restoreArea(areaId: string): Area | null {
  return setAreaActive(areaId, true);
}

// ── Postal Cities ──────────────────────────

/** All postal cities across every company (active and inactive). */
export function getPostalCities(): PostalCity[] {
  ensureSeeded();
  return read<PostalCity[]>(POSTAL_CITIES_KEY, []);
}

export function savePostalCities(cities: PostalCity[]): void {
  write(POSTAL_CITIES_KEY, cities);
}

/** A company's postal cities, optionally limited to active ones, sorted by name. */
export function listPostalCities(
  companyId: string,
  options?: { activeOnly?: boolean },
): PostalCity[] {
  const owned = getPostalCities().filter((c) => c.companyId === companyId);
  const filtered = options?.activeOnly ? owned.filter((c) => c.isActive) : owned;
  return filtered.sort((a, b) => a.name.localeCompare(b.name));
}

/** A company's active postal cities, sorted by name. */
export function getActivePostalCities(companyId: string): PostalCity[] {
  return listPostalCities(companyId, { activeOnly: true });
}

/**
 * Creates a company-scoped postal city linked to an area. Names are unique
 * within a company among ACTIVE postal cities (case-insensitive, trimmed); a
 * duplicate active name, an empty name, or a missing area returns null.
 */
export function createPostalCity(input: {
  companyId: string;
  name: string;
  areaId: string;
}): PostalCity | null {
  const name = input.name.trim();
  if (!name || !input.areaId) return null;
  // The linked area must exist and belong to the same company.
  const area = getAreas().find(
    (a) => a.id === input.areaId && a.companyId === input.companyId,
  );
  if (!area) return null;
  const all = getPostalCities();
  const normalized = normalizePostalCityName(name);
  const clash = all.some(
    (c) =>
      c.companyId === input.companyId &&
      c.isActive &&
      normalizePostalCityName(c.name) === normalized,
  );
  if (clash) return null;
  const now = new Date().toISOString();
  const city: PostalCity = {
    id: makeId("pcity"),
    companyId: input.companyId,
    name,
    areaId: input.areaId,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };
  savePostalCities([...all, city]);
  return city;
}

/**
 * Updates a postal city's name and/or linked area. Renaming to a name that
 * clashes with another ACTIVE postal city in the same company is rejected. A
 * new area must exist within the same company. Returns the updated city or null.
 */
export function updatePostalCity(
  id: string,
  input: { name?: string; areaId?: string },
): PostalCity | null {
  const all = getPostalCities();
  const target = all.find((c) => c.id === id);
  if (!target) return null;
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) return null;
    const normalized = normalizePostalCityName(name);
    const clash = all.some(
      (c) =>
        c.id !== id &&
        c.companyId === target.companyId &&
        c.isActive &&
        normalizePostalCityName(c.name) === normalized,
    );
    if (clash) return null;
  }
  if (input.areaId !== undefined) {
    const area = getAreas().find(
      (a) => a.id === input.areaId && a.companyId === target.companyId,
    );
    if (!area) return null;
  }
  const updated: PostalCity = {
    ...target,
    name: input.name !== undefined ? input.name.trim() : target.name,
    areaId: input.areaId !== undefined ? input.areaId : target.areaId,
    updatedAt: new Date().toISOString(),
  };
  savePostalCities(all.map((c) => (c.id === id ? updated : c)));
  return updated;
}

/** Sets a postal city's active flag. Returns the updated city or null. */
function setPostalCityActive(id: string, isActive: boolean): PostalCity | null {
  const all = getPostalCities();
  const target = all.find((c) => c.id === id);
  if (!target) return null;
  if (target.isActive === isActive) return target;
  const updated: PostalCity = { ...target, isActive, updatedAt: new Date().toISOString() };
  savePostalCities(all.map((c) => (c.id === id ? updated : c)));
  return updated;
}

/** Deactivates (archives) a postal city — hidden from customer pickers. */
export function archivePostalCity(id: string): PostalCity | null {
  return setPostalCityActive(id, false);
}

/** Reactivates a previously deactivated postal city. */
export function restorePostalCity(id: string): PostalCity | null {
  return setPostalCityActive(id, true);
}

/**
 * Resolves the active {@link Area} a postal city maps to, by id. Returns null
 * when the city is unknown or its area is missing/inactive — so callers never
 * auto-assign an unusable area. Never throws.
 */
export function resolveAreaForPostalCity(postalCityId: string): Area | null {
  const city = getPostalCities().find((c) => c.id === postalCityId);
  if (!city) return null;
  return resolvePostalCityArea(city, getAreas()) ?? null;
}

// ── Automatic Area assignment from Postal City (company setting) ──

/**
 * Per-company map (`cleanops.autoAreaFromPostalCity`) of whether selecting a
 * Postal City should automatically set the customer's Area (true) or only
 * suggest it (false, the default). Separate from Area Scoped Access and does
 * not depend on it.
 */
function getAutoAreaFromPostalCityMap(): Record<string, boolean> {
  return read<Record<string, boolean>>(AUTO_AREA_FROM_POSTAL_CITY_KEY, {});
}

/** Whether automatic Area assignment from Postal City is enabled (default false). */
export function isAutoAreaFromPostalCityEnabled(
  companyId: string | null | undefined,
): boolean {
  if (!companyId) return false;
  return getAutoAreaFromPostalCityMap()[companyId] === true;
}

/** Enables/disables automatic Area assignment from Postal City for a company. */
export function setAutoAreaFromPostalCityEnabled(
  companyId: string,
  enabled: boolean,
): void {
  const map = getAutoAreaFromPostalCityMap();
  map[companyId] = enabled;
  write(AUTO_AREA_FROM_POSTAL_CITY_KEY, map);
}

// ── Area Scoped Access (company feature flag) ───────────────

/**
 * Legacy per-company Area Scoped Access map (`cleanops.areaScopedAccess`),
 * keyed by companyId. As of the Feature Activation Framework migration this is
 * NO LONGER the source of truth — the `area_scoped_access` feature flag is.
 * The map is retained only so the one-time migration
 * ({@link migrateAreaScopedAccessToFeatureFlag}) can read pre-existing values;
 * it is intentionally not deleted to avoid risky data loss.
 */
export function getAreaScopedAccessMap(): Record<string, boolean> {
  return read<Record<string, boolean>>(AREA_SCOPED_ACCESS_KEY, {});
}

/**
 * Whether Area Scoped Access is enabled for a company (default false).
 * Source of truth is the Feature Activation Framework: this simply reads the
 * `area_scoped_access` feature flag. Kept as a named helper for compatibility.
 */
export function isAreaScopedAccessEnabled(companyId: string | null | undefined): boolean {
  return isFeatureEnabled(companyId, "area_scoped_access");
}

/**
 * One-time, idempotent migration that folds the legacy Area Scoped Access map
 * into the Feature Activation Framework. Companies that had the legacy flag set
 * to `true` are enabled for the `area_scoped_access` feature; legacy `false` /
 * missing values are left untouched (resolving to the feature default of
 * disabled), so no company is accidentally activated. The activation pre-check
 * is intentionally NOT re-run here: already-enabled companies stay enabled
 * exactly as before. Guarded by a migration flag so it runs at most once.
 */
export function migrateAreaScopedAccessToFeatureFlag(): void {
  if (localStorage.getItem(AREA_SCOPED_ACCESS_FEATURE_MIGRATION_KEY)) return;
  const legacy = read<Record<string, boolean>>(AREA_SCOPED_ACCESS_KEY, {});
  const flags = getFeatureFlagMap();
  for (const [companyId, enabled] of Object.entries(legacy)) {
    if (enabled !== true) continue;
    // Don't clobber an explicit feature-flag value if one already exists.
    if (typeof flags[companyId]?.["area_scoped_access"] === "boolean") continue;
    flags[companyId] = { ...(flags[companyId] ?? {}), area_scoped_access: true };
  }
  write(FEATURE_FLAGS_KEY, flags);
  localStorage.setItem(AREA_SCOPED_ACCESS_FEATURE_MIGRATION_KEY, "1");
}

/** Result of attempting to toggle Area Scoped Access. */
export interface SetAreaScopedAccessResult {
  /** True when the requested state was applied. */
  ok: boolean;
  /**
   * Present when an enable attempt was blocked by the activation pre-check. The
   * setting is left unchanged in that case.
   */
  precheck?: AreaActivationPrecheck;
}

/**
 * Runs the activation pre-check for a company against its current customers and
 * work orders. Used by the UI to preview blockers before/while toggling.
 */
export function getAreaScopedAccessActivationPrecheck(
  companyId: string,
): AreaActivationPrecheck {
  const customers = getCustomers().filter((c) => c.companyId === companyId);
  const workOrders = getWorkOrders().filter((w) => w.companyId === companyId);
  const areas = getAreas().filter((a) => a.companyId === companyId);
  return checkAreaScopedAccessActivation({ customers, workOrders, areas });
}

/**
 * Enables or disables Area Scoped Access for a company. Disabling is always
 * allowed. Enabling first runs the activation pre-check: if any operationally
 * active customer is missing an area, the feature stays disabled and the
 * blocking pre-check is returned so the caller can guide cleanup.
 */
export function setAreaScopedAccessEnabled(
  companyId: string,
  enabled: boolean,
): SetAreaScopedAccessResult {
  if (enabled) {
    const precheck = getAreaScopedAccessActivationPrecheck(companyId);
    if (!precheck.canEnable) return { ok: false, precheck };
  }
  // Feature Activation Framework is the source of truth.
  setFeatureEnabled(companyId, "area_scoped_access", enabled);
  return { ok: true };
}

// ── Feature Registry flags (company-level) ──────────────────

/**
 * Per-company override map for registered features, keyed by companyId then
 * featureId: `{ [companyId]: { [featureId]: boolean } }`. Only entries that
 * differ from a feature's {@link FeatureDefinition.defaultEnabled} need to be
 * stored, but any explicit value is honored. Foundation only — no billing,
 * trials, or Super Admin controls.
 */
function getFeatureFlagMap(): Record<string, Record<string, boolean>> {
  return read<Record<string, Record<string, boolean>>>(FEATURE_FLAGS_KEY, {});
}

/**
 * Whether a feature is enabled for a company. Returns the company's explicit
 * override when present; otherwise falls back to the feature's registered
 * default. Unknown feature ids and missing companies resolve to false.
 */
export function isFeatureEnabled(
  companyId: string | null | undefined,
  featureId: FeatureId | string,
): boolean {
  const feature = getFeature(featureId);
  if (!feature) return false;
  if (!companyId) return false;
  const override = getFeatureFlagMap()[companyId]?.[featureId];
  return typeof override === "boolean" ? override : feature.defaultEnabled;
}

/**
 * Enables or disables a registered feature for a company. No-op for unknown
 * feature ids or missing companies. Returns the resulting enabled state.
 */
export function setFeatureEnabled(
  companyId: string | null | undefined,
  featureId: FeatureId | string,
  enabled: boolean,
): boolean {
  const feature = getFeature(featureId);
  if (!feature || !companyId) return false;
  const map = getFeatureFlagMap();
  const companyFlags = { ...(map[companyId] ?? {}) };
  companyFlags[featureId] = enabled;
  map[companyId] = companyFlags;
  write(FEATURE_FLAGS_KEY, map);
  return enabled;
}

/**
 * Seeds default areas per company on first launch. For each company it creates
 * the {@link DEFAULT_AREA_NAMES} plus an area for any distinct legacy free-text
 * customer area value not already covered — so no existing assignment is lost.
 * Idempotent: only runs while the areas collection is empty.
 */
function ensureAreasSeeded(): void {
  if (localStorage.getItem(AREAS_KEY)) return;
  const companies = read<Company[]>(COMPANIES_KEY, []);
  const customers = read<Customer[]>(CUSTOMERS_KEY, []);
  const now = new Date().toISOString();
  const areas: Area[] = [];
  for (const company of companies) {
    const seen = new Set<string>();
    const names = [...DEFAULT_AREA_NAMES];
    // Preserve any legacy free-text areas so existing assignments survive.
    for (const c of customers) {
      if (c.companyId !== company.id) continue;
      const legacy = c.area?.trim();
      if (legacy && !names.some((n) => normalizeAreaName(n) === normalizeAreaName(legacy))) {
        names.push(legacy);
      }
    }
    for (const name of names) {
      const norm = normalizeAreaName(name);
      if (seen.has(norm)) continue;
      seen.add(norm);
      areas.push({
        id: makeId("area"),
        companyId: company.id,
        name,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    }
  }
  write(AREAS_KEY, areas);
}

/**
 * One-time migration: derives {@link Customer.areaId} from the legacy free-text
 * {@link Customer.area} by matching the area name within the same company. Runs
 * once (guarded by a migration flag); unmatched values are left unassigned and
 * the legacy text is preserved. Never crashes on unknown data.
 */
function ensureCustomerAreaIdsBackfilled(): void {
  if (localStorage.getItem(CUSTOMER_AREA_BACKFILL_MIGRATION_KEY)) return;
  const areas = read<Area[]>(AREAS_KEY, []);
  const customers = read<Customer[]>(CUSTOMERS_KEY, []);
  let changed = false;
  const next = customers.map((c) => {
    if (c.areaId) return c;
    const match = matchAreaByName(areas, c.companyId, c.area);
    if (!match) return c;
    changed = true;
    return { ...c, areaId: match.id };
  });
  if (changed) write(CUSTOMERS_KEY, next);
  localStorage.setItem(CUSTOMER_AREA_BACKFILL_MIGRATION_KEY, "1");
}

// ── Employee Languages ──────────────────────

/** All employee languages across every company (active and inactive). */
export function getEmployeeLanguages(): EmployeeLanguage[] {
  ensureSeeded();
  return read<EmployeeLanguage[]>(EMPLOYEE_LANGUAGES_KEY, []);
}

export function saveEmployeeLanguages(languages: EmployeeLanguage[]): void {
  write(EMPLOYEE_LANGUAGES_KEY, languages);
}

/** A company's languages, optionally limited to active ones, sorted by name. */
export function listEmployeeLanguages(
  companyId: string,
  options?: { activeOnly?: boolean },
): EmployeeLanguage[] {
  const owned = getEmployeeLanguages().filter((l) => l.companyId === companyId);
  const filtered = options?.activeOnly ? owned.filter((l) => l.isActive) : owned;
  return filtered.sort((a, b) => a.name.localeCompare(b.name));
}

/** A company's active (assignable) languages, sorted by name. */
export function getActiveEmployeeLanguages(companyId: string): EmployeeLanguage[] {
  return listEmployeeLanguages(companyId, { activeOnly: true });
}

/**
 * Creates a company-scoped language. Codes are unique within a company
 * (case-insensitive, trimmed) across active and inactive languages; a duplicate
 * code, an empty code, or an empty name returns null. New languages start
 * active and never become the default automatically.
 */
export function createEmployeeLanguage(input: {
  companyId: string;
  code: string;
  name: string;
  nativeName?: string;
}): EmployeeLanguage | null {
  const code = input.code.trim();
  const name = input.name.trim();
  if (!code || !name) return null;
  const all = getEmployeeLanguages();
  const normalized = normalizeLanguageCode(code);
  const clash = all.some(
    (l) => l.companyId === input.companyId && normalizeLanguageCode(l.code) === normalized,
  );
  if (clash) return null;
  const now = new Date().toISOString();
  const language: EmployeeLanguage = {
    id: makeId("lang"),
    companyId: input.companyId,
    code,
    name,
    nativeName: input.nativeName?.trim() || name,
    isActive: true,
    isDefault: false,
    createdAt: now,
    updatedAt: now,
  };
  saveEmployeeLanguages([...all, language]);
  return language;
}

/**
 * Updates a language's editable metadata (code/name/native name). Renaming the
 * code to one that clashes with another language in the same company is
 * rejected. Returns the updated language or null.
 */
export function updateEmployeeLanguage(
  id: string,
  input: { code?: string; name?: string; nativeName?: string },
): EmployeeLanguage | null {
  const all = getEmployeeLanguages();
  const target = all.find((l) => l.id === id);
  if (!target) return null;
  if (input.code !== undefined) {
    const code = input.code.trim();
    if (!code) return null;
    const normalized = normalizeLanguageCode(code);
    const clash = all.some(
      (l) =>
        l.id !== id &&
        l.companyId === target.companyId &&
        normalizeLanguageCode(l.code) === normalized,
    );
    if (clash) return null;
  }
  if (input.name !== undefined && !input.name.trim()) return null;
  const updated: EmployeeLanguage = {
    ...target,
    code: input.code !== undefined ? input.code.trim() : target.code,
    name: input.name !== undefined ? input.name.trim() : target.name,
    nativeName:
      input.nativeName !== undefined
        ? input.nativeName.trim() || target.name
        : target.nativeName,
    updatedAt: new Date().toISOString(),
  };
  saveEmployeeLanguages(all.map((l) => (l.id === id ? updated : l)));
  return updated;
}

/**
 * Sets a language's active flag and re-normalizes its company so the
 * single-default invariant always holds: deactivating the default promotes
 * another active language. Returns the updated language or null.
 */
function setEmployeeLanguageActive(
  id: string,
  isActive: boolean,
): EmployeeLanguage | null {
  const all = getEmployeeLanguages();
  const target = all.find((l) => l.id === id);
  if (!target) return null;
  if (target.isActive === isActive) return target;
  const now = new Date().toISOString();
  const changed = all.map((l) =>
    l.id === id ? { ...l, isActive, updatedAt: now } : l,
  );
  const companyLangs = changed.filter((l) => l.companyId === target.companyId);
  const normalized = normalizeEmployeeLanguages(companyLangs);
  const byId = new Map(normalized.map((l) => [l.id, l]));
  const next = changed.map((l) => byId.get(l.id) ?? l);
  saveEmployeeLanguages(next);
  return next.find((l) => l.id === id) ?? null;
}

/** Deactivates a language — hidden from pickers, kept for history. */
export function archiveEmployeeLanguage(id: string): EmployeeLanguage | null {
  return setEmployeeLanguageActive(id, false);
}

/** Reactivates a previously deactivated language. */
export function restoreEmployeeLanguage(id: string): EmployeeLanguage | null {
  return setEmployeeLanguageActive(id, true);
}

/**
 * Marks a language as the company's sole default. The target must exist and be
 * active; otherwise null is returned and no change is made. All other languages
 * in the same company lose the default flag.
 */
export function setEmployeeLanguageDefault(id: string): EmployeeLanguage | null {
  const all = getEmployeeLanguages();
  const target = all.find((l) => l.id === id);
  if (!target || !target.isActive) return null;
  const companyLangs = all.filter((l) => l.companyId === target.companyId);
  const normalized = setDefaultEmployeeLanguagePure(companyLangs, id);
  const byId = new Map(normalized.map((l) => [l.id, l]));
  const next = all.map((l) => byId.get(l.id) ?? l);
  saveEmployeeLanguages(next);
  return next.find((l) => l.id === id) ?? null;
}

/**
 * Seeds the default language list per company on first launch and for any
 * company that has none yet. Idempotent: a company that already has at least
 * one language is never touched, so no duplicates are created on repeated loads.
 */
function ensureEmployeeLanguagesSeeded(): void {
  const companies = read<Company[]>(COMPANIES_KEY, []);
  if (companies.length === 0) return;
  const existing = read<EmployeeLanguage[]>(EMPLOYEE_LANGUAGES_KEY, []);
  const seeded = new Set(existing.map((l) => l.companyId));
  const missing = companies.filter((c) => !seeded.has(c.id));
  if (missing.length === 0) {
    if (!localStorage.getItem(EMPLOYEE_LANGUAGES_KEY)) {
      write(EMPLOYEE_LANGUAGES_KEY, existing);
    }
    return;
  }
  const now = new Date().toISOString();
  const added: EmployeeLanguage[] = [];
  for (const company of missing) {
    for (const seed of DEFAULT_EMPLOYEE_LANGUAGES) {
      added.push({
        id: makeId("lang"),
        companyId: company.id,
        code: seed.code,
        name: seed.name,
        nativeName: seed.nativeName,
        isActive: seed.isActive,
        isDefault: seed.isDefault,
        createdAt: now,
        updatedAt: now,
      });
    }
  }
  write(EMPLOYEE_LANGUAGES_KEY, [...existing, ...added]);
}

// ── Modules ────────────────────────────────

export function getModules(): Module[] {
  ensureSeeded();
  return read<Module[]>(MODULES_KEY, []);
}

export function saveModules(modules: Module[]): void {
  write(MODULES_KEY, modules);
}

export function getCompanyModules(): CompanyModuleSetting[] {
  ensureSeeded();
  return read<CompanyModuleSetting[]>(COMPANY_MODULES_KEY, []);
}

export function saveCompanyModules(settings: CompanyModuleSetting[]): void {
  write(COMPANY_MODULES_KEY, settings);
}

// ── Module categories ──────────────────────

export function getModuleCategories(): ModuleCategory[] {
  ensureSeeded();
  return read<ModuleCategory[]>(MODULE_CATEGORIES_KEY, []);
}

export function saveModuleCategories(categories: ModuleCategory[]): void {
  write(MODULE_CATEGORIES_KEY, categories);
}

// ── Audit log ───────────────────────

export function getAuditEvents(): AuditEvent[] {
  ensureSeeded();
  return read<AuditEvent[]>(AUDIT_KEY, []);
}

export function saveAuditEvents(events: AuditEvent[]): void {
  write(AUDIT_KEY, events);
}

// ── Checklist templates ────────────────────────

export function getChecklistTemplates(): ChecklistTemplate[] {
  ensureSeeded();
  return read<ChecklistTemplate[]>(CHECKLIST_TEMPLATES_KEY, []);
}

export function saveChecklistTemplates(templates: ChecklistTemplate[]): void {
  write(CHECKLIST_TEMPLATES_KEY, templates);
}

export function getChecklistAdoptions(): ChecklistTemplateAdoption[] {
  ensureSeeded();
  return read<ChecklistTemplateAdoption[]>(CHECKLIST_ADOPTIONS_KEY, []);
}

export function saveChecklistAdoptions(adoptions: ChecklistTemplateAdoption[]): void {
  write(CHECKLIST_ADOPTIONS_KEY, adoptions);
}

// ── Customer protocols ──────────────────────

export function getCustomerProtocols(): CustomerProtocol[] {
  ensureSeeded();
  return read<CustomerProtocol[]>(CUSTOMER_PROTOCOLS_KEY, []).map(migrateProtocol);
}

/**
 * Backfills the three-state task model for protocols persisted before task
 * states existed (legacy tasks only carried a boolean `active`).
 */
function migrateProtocol(protocol: CustomerProtocol): CustomerProtocol {
  return {
    ...protocol,
    floors: protocol.floors.map((f) => ({
      ...f,
      rooms: f.rooms.map((r) => ({
        ...r,
        tasks: r.tasks.map((k) => {
          const legacy = k as ProtocolTask & { active?: boolean };
          if (legacy.state) return k;
          return {
            ...k,
            state: legacy.active ? "active" : "inactive",
          } as ProtocolTask;
        }),
      })),
    })),
  };
}

export function saveCustomerProtocols(protocols: CustomerProtocol[]): void {
  write(CUSTOMER_PROTOCOLS_KEY, protocols);
}

// ── Checklist libraries ───────────────────

export function getLibraryRooms(): LibraryRoom[] {
  ensureSeeded();
  return read<LibraryRoom[]>(LIBRARY_ROOMS_KEY, []);
}

export function saveLibraryRooms(rooms: LibraryRoom[]): void {
  write(LIBRARY_ROOMS_KEY, rooms);
}

export function getLibraryTasks(): LibraryTask[] {
  ensureSeeded();
  return read<LibraryTask[]>(LIBRARY_TASKS_KEY, []);
}

export function saveLibraryTasks(tasks: LibraryTask[]): void {
  write(LIBRARY_TASKS_KEY, tasks);
}

// ── Settings templates & company settings ─────────────

export function getSettingsTemplates(): SettingsTemplate[] {
  ensureSeeded();
  return read<SettingsTemplate[]>(SETTINGS_TEMPLATES_KEY, []);
}

export function saveSettingsTemplates(templates: SettingsTemplate[]): void {
  write(SETTINGS_TEMPLATES_KEY, templates);
}

export function getCompanySettings(): CompanySettings[] {
  ensureSeeded();
  return read<CompanySettings[]>(COMPANY_SETTINGS_KEY, []);
}

export function saveCompanySettings(settings: CompanySettings[]): void {
  write(COMPANY_SETTINGS_KEY, settings);
}

// ── Roles ──────────────────────────────────────────

export function getRoles(): Role[] {
  ensureSeeded();
  return read<Role[]>(ROLES_KEY, []);
}

export function saveRoles(roles: Role[]): void {
  write(ROLES_KEY, roles);
}

// ── Companies ──────────────────────────────────────────────

export function getCompanies(): Company[] {
  ensureSeeded();
  return read<Company[]>(COMPANIES_KEY, []);
}

export function saveCompanies(companies: Company[]): void {
  write(COMPANIES_KEY, companies);
}

// ── Users ──────────────────────────────────────────────────

export function getUsers(): User[] {
  ensureSeeded();
  return read<SeedUser[]>(USERS_KEY, []).map(({ password: _pw, ...rest }) => rest);
}

function getRawUsers(): SeedUser[] {
  ensureSeeded();
  return read<SeedUser[]>(USERS_KEY, []);
}

export function saveUsers(users: User[]): void {
  // Preserve passwords already stored against existing ids.
  const existing = getRawUsers();
  const pwById = new Map(existing.map((u) => [u.id, u.password]));
  const merged: SeedUser[] = users.map((u) => ({
    ...u,
    password: pwById.get(u.id) ?? "password",
  }));
  write(USERS_KEY, merged);
}

// ── Auth ───────────────────────────────────────────────────

/**
 * Administrative roles must authenticate through Supabase Auth + profiles only.
 * The localStorage layer fails closed for these roles so demo/legacy admins can
 * never obtain a (token-less) local session or recover credentials offline.
 */
const LOCAL_AUTH_FORBIDDEN_ROLES: ReadonlySet<UserRole> = new Set<UserRole>([
  "super_admin",
  "company_admin",
]);

export function authenticate(email: string, password: string): User | null {
  const user = getRawUsers().find(
    (u) => u.email.toLowerCase() === email.trim().toLowerCase(),
  );
  if (!user) return null;
  if (user.status === "inactive") return null;
  // Admins are never authenticated via localStorage (defense in depth).
  if (LOCAL_AUTH_FORBIDDEN_ROLES.has(user.role)) return null;
  if ((user.password ?? "password") !== password) return null;
  const { password: _pw, ...safe } = user;
  return safe;
}

export function getSessionUserId(): string | null {
  return read<string | null>(SESSION_KEY, null);
}

export function setSessionUserId(id: string | null): void {
  if (id) write(SESSION_KEY, id);
  else localStorage.removeItem(SESSION_KEY);
}

export function getUserById(id: string): User | null {
  return getUsers().find((u) => u.id === id) ?? null;
}

/** Creates a password reset token for a known email. Returns token or null. */
export function createResetToken(email: string): string | null {
  // Admins recover credentials through Supabase Auth, never via local reset
  // tokens — refuse to mint a token for an admin email.
  const match = getRawUsers().find(
    (u) => u.email.toLowerCase() === email.trim().toLowerCase(),
  );
  if (!match) return null;
  if (LOCAL_AUTH_FORBIDDEN_ROLES.has(match.role)) return null;
  const token = makeId("rst");
  const tokens = read<Record<string, string>>(RESET_KEY, {});
  tokens[token] = email.trim().toLowerCase();
  write(RESET_KEY, tokens);
  return token;
}

/** Consumes a reset token and updates the matching user's password. */
export function consumeResetToken(token: string, newPassword: string): boolean {
  const tokens = read<Record<string, string>>(RESET_KEY, {});
  const email = tokens[token];
  if (!email) return false;
  const users = getRawUsers();
  const idx = users.findIndex((u) => u.email.toLowerCase() === email);
  if (idx === -1) return false;
  // Never let a local reset token recover an administrative account.
  if (LOCAL_AUTH_FORBIDDEN_ROLES.has(users[idx].role)) return false;
  users[idx] = { ...users[idx], password: newPassword };
  write(USERS_KEY, users);
  delete tokens[token];
  write(RESET_KEY, tokens);
  return true;
}

export type { UserRole, EntityStatus };
