import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";

import type {
  Area,
  AreaScope,
  PostalCity,
  EmployeeLanguage,
  AuditAction,
  AuditEvent,
  ChecklistImage,
  ChecklistTemplate,
  ChecklistTemplateAdoption,
  CleaningTask,
  CustomerProtocol,
  CustomerProtocolStatus,
  ProtocolTaskState,
  Company,
  CompanyModuleSetting,
  CompanyServiceFavorite,
  Customer,
  CustomerCardLogEntry,
  CustomerCardLogSource,
  Employee,
  MediaCategory,
  Invoice,
  WorkOrder,
  WorkOrderStatus,
  WorkOrderNote,
  WorkOrderActivity,
  WorkOrderMediaPlacement,
  WorkOrderMediaPlacementType,
  WorkOrderServiceRow,
  RecurringVariation,
  VariationStatus,
  WorkOrderSettings,
  TimeReportSettings,
  DurationSettings,
  SystemSettings,
  ServiceFeatureKey,
  ServiceEntitlementStatus,
  ServiceGlobalEntitlement,
  CompanyServiceEntitlement,
  ServiceEntitlementLogEntry,
  TimeReport,
  BookingQueueItem,
  BookingOccurrence,
  BookingOccurrenceException,
  LibraryRoom,
  LibraryTask,
  RoomLibraryCategory,
  TaskLibraryCategory,
  Module,
  ModuleCategory,
  Role,
  Service,
  ServiceCategory,
  ServiceCategoryType,
  PayrollGroup,
  ServicePackage,
  ServicePackageItem,
  TimeCode,
  TimeCodeType,
  PayrollBasis,
  PayrollExportCapability,
  PayrollExportProfile,
  PayrollExportRun,
  PayrollExportTargetKey,
  SettingsData,
  SettingsItem,
  SettingsTemplate,
  CompanySettings,
  Team,
  User,
  UserRole,
  EntityStatus,
  CustomerType,
} from "@/types";
import {
  ROLE_LABELS,
  emptySettingsData,
  defaultWorkOrderSettings,
  normalizeWorkOrderSettings,
  defaultTimeReportSettings,
  defaultDurationSettings,
  normalizeDurationPresets,
  defaultSystemSettings,
  resolveTimeReportCheckout,
  defaultDeviationAllocation,
  buildTimeReportAuditEntry,
  TIME_REPORT_APPROVAL_STATUS_LABELS,
  TIME_REPORT_SYSTEM_APPROVER,
  resolveCustomerCardLogChangeType,
  getVariationStatus,
  VARIATION_STATUS_LABELS,
  WORK_ORDER_STATUS_LABELS,
  buildBookingSnapshot,
  normalizeUnassignedSlots,
  makeOccurrenceKey,
  occurrenceExceptionHasStaffingOverride,
  SERVICE_BASIS_TYPE_LABELS,
} from "@/types";
import { replaceVariation } from "@/lib/variationOverlap";
import { normalizeServiceBasisType } from "@/lib/serviceBasis";
import type { AreaActivationPrecheck } from "@/lib/areaScopeActivation";
import {
  validateServiceRowDelete,
  validateServiceRowForceDelete,
  validateVariationDelete,
  isOccurrenceExceptionOperational,
  isRecurring,
} from "@/lib/archiveValidation";
import {
  variationHasPastOccurrence,
  countServiceRowGeneratedOccurrences,
} from "@/lib/serviceRowOccurrences";
import {
  validateWorkOrderDelete,
  validateWorkOrderForceDelete,
  type WorkOrderRelatedData,
} from "@/lib/workOrderDelete";
import { isLiveWorkOrder } from "@/lib/serviceEndDateGuard";
import {
  describeOccurrenceCancel,
  describeOccurrenceRestore,
  describeOccurrenceReschedule,
  describeOccurrenceReassign,
  describeOccurrenceReassignCleared,
} from "@/lib/occurrenceActivity";
import {
  authenticate,
  consumeResetToken,
  createResetToken,
  getAuditEvents,
  getChecklistAdoptions,
  getChecklistTemplates,
  getCustomerProtocols,
  getLibraryRooms,
  getLibraryTasks,
  saveChecklistAdoptions,
  saveChecklistTemplates,
  saveCustomerProtocols,
  saveLibraryRooms,
  saveLibraryTasks,
  getCompanies,
  getCompanyModules,
  getCustomers,
  getEmployees,
  getModuleCategories,
  getModules,
  getRoles,
  getSessionUserId,
  getTeams,
  getAreas,
  isAreaScopedAccessEnabled,
  setAreaScopedAccessEnabled as setAreaScopedAccessEnabledInStore,
  getAreaScopedAccessActivationPrecheck,
  type SetAreaScopedAccessResult,
  createArea as createAreaInStore,
  updateArea as updateAreaInStore,
  archiveArea as archiveAreaInStore,
  restoreArea as restoreAreaInStore,
  getPostalCities,
  createPostalCity as createPostalCityInStore,
  updatePostalCity as updatePostalCityInStore,
  archivePostalCity as archivePostalCityInStore,
  restorePostalCity as restorePostalCityInStore,
  getEmployeeLanguages,
  createEmployeeLanguage as createEmployeeLanguageInStore,
  updateEmployeeLanguage as updateEmployeeLanguageInStore,
  archiveEmployeeLanguage as archiveEmployeeLanguageInStore,
  restoreEmployeeLanguage as restoreEmployeeLanguageInStore,
  setEmployeeLanguageDefault as setEmployeeLanguageDefaultInStore,
  isAutoAreaFromPostalCityEnabled,
  setAutoAreaFromPostalCityEnabled as setAutoAreaFromPostalCityEnabledInStore,
  getUserById,
  getUsers,
  makeId,
  saveAuditEvents,
  saveCompanies,
  saveCompanyModules,
  saveCustomers,
  saveEmployees,
  saveModuleCategories,
  saveModules,
  saveRoles,
  saveTeams,
  saveUsers,
  setSessionUserId,
  systemRoleId,
  getSettingsTemplates,
  saveSettingsTemplates,
  getCompanySettings,
  saveCompanySettings,
  getServiceCategories,
  saveServiceCategories,
  getPayrollGroups,
  getServices,
  saveServices,
  getServicePackages,
  saveServicePackages,
  getServiceFavorites,
  saveServiceFavorites,
  getWorkOrders,
  saveWorkOrders,
  getWorkOrderSettings,
  saveWorkOrderSettings,
  getTimeReportSettings,
  saveTimeReportSettings,
  getDurationSettings,
  saveDurationSettings,
  getSystemSettings,
  saveSystemSettings,
  getServiceGlobalEntitlements,
  saveServiceGlobalEntitlements,
  getCompanyServiceEntitlements,
  saveCompanyServiceEntitlements,
  getServiceEntitlementLog,
  saveServiceEntitlementLog,
  getTimeReports,
  saveTimeReports,
  getBookingQueue,
  saveBookingQueue,
  getBookingOccurrenceExceptions,
  saveBookingOccurrenceExceptions,
  getInvoices,
  saveInvoices,
} from "@/lib/store";
import { getTimeCodes, saveTimeCodes, normalizeTimeCode } from "@/lib/timeCodeStore";
import {
  availableTimeCodes,
  buildTimeCodeIndex,
  canDeleteTimeCode,
  linkedServices as linkedServicesForTimeCode,
  resolveTimeCode,
  timeCodeUsageMap,
} from "@/lib/timeCodeResolver";
import {
  getPayrollExportCapabilities,
  getPayrollExportProfiles,
  getPayrollExportRuns,
  savePayrollExportCapabilities,
  savePayrollExportProfiles,
  savePayrollExportRuns,
} from "@/lib/payrollExportStore";
import {
  availableTargetsForCompany,
  buildCapabilityIndex,
  isTargetEnabledForCompany,
  profilesForCompany,
  runnableProfiles,
  runsForCompany,
} from "@/lib/payrollExportResolver";
import { getPayrollExportAdapter } from "@/lib/payroll/registry";
import type { PayrollExportOutput } from "@/lib/payroll/adapter";
import { PAYROLL_EXPORT_TARGET_LABELS } from "@/types";
import {
  resolveGlobalAvailability,
  resolveCompanyEntitlementStatus,
  resolveEffectiveCompanyStatus,
  evaluateUsageGate,
  getServiceDefinition,
  MEDIA_UPLOADS_KEY,
  type UsageGateResult,
} from "@/lib/serviceRegistry";
import { createEntitlementAccessors } from "@/lib/entitlements/adapter";
import {
  summarizeCompanyMediaUsage,
  listMediaForEntity,
  deleteMediaAsset,
} from "@/lib/mediaStore";
import type { MediaUsageSummary } from "@/lib/mediaStore";
import {
  validateEmployeeDelete,
  type EmployeeDeleteContext,
  type EntityDeleteValidationResult,
} from "@/lib/entityDeleteValidation";
import {
  addPlacement,
  removePlacement as removePlacementFromList,
  removePlacementsForAsset,
  reorderPlacements,
  setPlacementEmployeeVisibility,
} from "@/lib/workOrderMediaPlacements";
import { DEFAULT_ROLE_PERMISSIONS } from "@/lib/permissions";
import { canAssignRole, resolveUserPermissions, userHoldsRole } from "@/lib/employeeRoles";
import { MODULE_DEFINITIONS, type ModuleDefinition } from "@/lib/modules";
import { isCompanyModuleAccessible } from "@/lib/moduleAccess";
import { resolveModuleEntitlementAvailability } from "@/lib/serviceModuleBridge";
import { FORBIDDEN_MESSAGE, inCompanyScope } from "@/lib/authz";
import { describeCustomerCardChanges } from "@/lib/customerLog";
import { normalizeCustomerContacts } from "@/lib/customerContacts";
import { getMediaCategory } from "@/lib/mediaCategories";
import {
  USE_SUPABASE_COMPANIES,
  ENABLE_USER_CREATION,
} from "@/lib/featureFlags";
import { perf } from "@/lib/perf";
import {
  enqueueCustomerMirror,
  shouldMirrorWrites,
  isCustomerSupabaseAuthoritative,
  recordCutoverFailure,
  addCustomerDeleteTombstone,
  bumpCustomerListReconcile,
  mirrorWorkOrderWrites,
  mirrorWorkOrderExceptionWrites,
  shouldMirrorWorkOrderWrites,
  isWorkOrderSupabaseAuthoritative,
  recordWorkOrderCutoverFailure,
  mirrorTeamWrites,
  shouldMirrorTeamWrites,
  mirrorServiceWrites,
  shouldMirrorServiceWrites,
  mirrorServiceCategoryWrites,
  shouldMirrorServiceCategoryWrites,
  mirrorServicePackageWrites,
  shouldMirrorServicePackageWrites,
  mirrorAreaWrites,
  shouldMirrorAreaWrites,
  mirrorPostalCityWrites,
  shouldMirrorPostalCityWrites,
  mirrorEmployeeLanguageWrites,
  shouldMirrorEmployeeLanguageWrites,
  mirrorRoleWrites,
  shouldMirrorRoleWrites,
  mirrorUserWrites,
  shouldMirrorUserWrites,
  mirrorTimeCodeWrites,
  shouldMirrorTimeCodeWrites,
  mirrorBookingQueueWrites,
  shouldMirrorBookingQueueWrites,
  isBookingQueueSupabaseAuthoritative,
  recordBookingQueueReadFallback,
  mirrorSettingsTemplateWrites,
  shouldMirrorSettingsTemplateWrites,
  mirrorCompanySettingsWrites,
  shouldMirrorCompanySettingsWrites,
  mirrorGlobalEntitlementWrites,
  mirrorCompanyEntitlementWrites,
  mirrorEntitlementLogAppend,
  shouldMirrorEntitlementWrites,
  shouldReadEntitlementsFromSupabase,
  upsertGlobalEntitlementInSupabase,
  upsertCompanyEntitlementInSupabase,
  appendEntitlementLogInSupabase,
  bumpEntitlementDirectoryRefresh,
  mirrorActivityAppend,
  shouldMirrorActivityWrites,
  mirrorSystemSettingsWrite,
  shouldMirrorSystemSettingsWrites,
  isSystemSettingsSupabaseAuthoritative,
  recordSystemSettingsReadFallback,
  mirrorEmployeeWrites,
  shouldMirrorEmployeeWrites,
  shouldShadowValidateEmployees,
  reconcileHydratedRecord,
  reconcileHydratedRecords,
} from "@/lib/data";
// Mission Log checkout dual-write (Slice 2c-1). Imported directly from the
// module paths (the Mission Log adapter is not re-exported from the barrel). The
// mirror is fire-and-forget and gated by MISSION_LOG_DUAL_WRITE (default OFF) —
// a Supabase failure can never affect the authoritative legacy checkout.
import { shouldMirrorMissionLogCheckout } from "@/lib/data/missionLogCutover";
import { mirrorMissionLogCheckout } from "@/lib/data/missionLogDualWrite";
// Time Reporting checkout dual-write (Slice 2c-2a). Imported directly from the
// module paths (the Time Reporting adapter is not re-exported from the barrel).
// The mirror is fire-and-forget and gated by TIME_REPORTING_DUAL_WRITE (default
// OFF) — a Supabase failure can never affect the authoritative legacy checkout.
import { shouldMirrorTimeReportingCheckout } from "@/lib/data/timeReportingCutover";
import { mirrorTimeReportingCheckout } from "@/lib/data/timeReportingDualWrite";
import { createSupabaseUser, deleteSupabaseUser } from "@/lib/adminCreateUser";
import { inviteRedirectUrl } from "@/lib/employeeLoginInvite";
import {
  getCompaniesFromSupabase,
  createCompanyInSupabase,
  updateCompanyInSupabase,
} from "@/lib/companiesSupabase";
import {
  shouldAttemptSupabaseAuth,
  loginWithSupabase,
  restoreSupabaseSession,
  hydrateSessionAfterPasswordSet,
} from "@/lib/supabaseLogin";
import { signOut as supabaseSignOut, isSupabaseAuthEnabled } from "@/lib/authSupabase";
import { formatDate } from "@/lib/format";
import { useEmployeeDirectorySource } from "@/hooks/use-employee-directory-source";
import { useTeamDirectorySource } from "@/hooks/use-team-directory-source";
import { useServiceDirectorySource } from "@/hooks/use-service-directory-source";
import { useServiceCategoryDirectorySource } from "@/hooks/use-service-category-directory-source";
import { usePayrollGroupDirectorySource } from "@/hooks/use-payroll-group-directory-source";
import { useServicePackageDirectorySource } from "@/hooks/use-service-package-directory-source";
import {
  removeServiceFromGlobalPackagesInSupabase,
  upsertServicePackageToSupabase,
} from "@/lib/data/supabaseServicePackageRepository";
import { hardDeleteGlobalServiceInSupabase } from "@/lib/data/supabaseServiceRepository";
import { bumpServiceCatalogDirectoryRefresh } from "@/lib/data/serviceCatalogDirectoryRefresh";
import {
  createTimeCodeInSupabase,
  updateTimeCodeInSupabase,
  softDeleteTimeCodeInSupabase,
} from "@/lib/data/supabaseTimeCodeRepository";
import { bumpTimeCodeDirectoryRefresh } from "@/lib/data/timeCodeDirectoryRefresh";
import { shouldReadTimeCodesFromSupabase } from "@/lib/data/timeCodeCutover";
import {
  upsertModuleInSupabase,
  upsertCompanyModuleInSupabase,
  createModuleCategoryInSupabase,
  updateModuleCategoryInSupabase,
  softDeleteModuleCategoryInSupabase,
  reorderModuleCategoriesInSupabase,
} from "@/lib/data/supabaseModuleRepository";
import { bumpModuleDirectoryRefresh } from "@/lib/data/moduleDirectoryRefresh";
import { shouldReadModulesFromSupabase } from "@/lib/data/moduleCutover";
import { isSupabaseConfigured } from "@/lib/supabase";
import { useAreaDirectorySource } from "@/hooks/use-area-directory-source";
import { usePostalCityDirectorySource } from "@/hooks/use-postal-city-directory-source";
import { useEmployeeLanguageDirectorySource } from "@/hooks/use-employee-language-directory-source";
import { useRoleDirectorySource } from "@/hooks/use-role-directory-source";
import { useUserDirectorySource } from "@/hooks/use-user-directory-source";
import { useTimeCodeDirectorySource } from "@/hooks/use-time-code-directory-source";
import { useModuleDirectorySource } from "@/hooks/use-module-directory-source";
import { useBookingQueueDirectorySource } from "@/hooks/use-booking-queue-directory-source";
import { bumpBookingQueueDirectoryRefreshAfterSuccessfulMirror } from "@/lib/data/bookingQueueDirectoryRefresh";
import { useSettingsTemplateDirectorySource } from "@/hooks/use-settings-template-directory-source";
import { useSystemSettingsSource } from "@/hooks/use-system-settings-source";
import { useCompanySettingsDirectorySource } from "@/hooks/use-company-settings-directory-source";
import { useEntitlementSource } from "@/hooks/use-entitlement-source";
import { useActivitySource } from "@/hooks/use-activity-source";
import { DIRECTORY_PROFILES_QUERY_KEY } from "@/hooks/use-directory-profiles";
import { EMPLOYEE_STAFF_NUMBERS_QUERY_KEY } from "@/hooks/use-staff-numbers";
import { ASSIGNED_USERS_ROSTER_QUERY_KEY } from "@/lib/assignedUsersRoster";
import { invalidateDomainQueryCaches } from "@/lib/clientDomainStorage";
import { shouldRunBrowserDomainMirror } from "@/lib/data/runtimeQuarantine";
import { removeGlobalCatalogService } from "@/lib/catalogHardDelete";

interface AppContextValue {
  /**
   * The user whose context the portal currently renders for. While previewing
   * as a customer this is the customer identity; otherwise it's the signed-in user.
   */
  currentUser: User | null;
  /** The real authenticated user, preserved even while previewing as a customer. */
  originalUser: User | null;
  /** Whether the app is still checking for a persisted Supabase Auth session. */
  isAuthRestoring: boolean;
  /** Whether an admin is currently previewing the portal as a customer. */
  isViewingAsCustomer: boolean;
  /** The customer record being previewed, if any. */
  viewAsCustomer: Customer | null;
  /** Whether an admin is currently previewing the portal as an employee. */
  isViewingAsEmployee: boolean;
  /** The employee record being previewed, if any. */
  viewAsEmployee: Employee | null;
  /** Whether the session is a read-only preview (no actions allowed as the previewed user). */
  isReadOnlyPreview: boolean;
  /** Begins a read-only preview of the customer portal as the given customer. */
  startViewAsCustomer: (customerId: string) => { ok: boolean; error?: string };
  /** Ends the customer preview and restores the original admin context. */
  exitViewAsCustomer: () => void;
  /** Begins a read-only preview of the employee portal as the given employee. */
  startViewAsEmployee: (employeeId: string) => { ok: boolean; error?: string };
  /** Ends the employee preview and restores the original admin context. */
  exitViewAsEmployee: () => void;
  companies: Company[];
  users: User[];
  login: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => void;
  requestReset: (email: string) => string | null;
  resetPassword: (token: string, password: string) => boolean;
  /**
   * Signs an invited user straight into the app after they set their password
   * on the onboarding/accept-invite screen. Hydrates the current Supabase
   * session (any active role, including employees) into `currentUser`. Returns
   * the signed-in user, or null if no eligible session could be hydrated.
   */
  completeOnboardingLogin: () => Promise<User | null>;
  createCompany: (
    name: string,
    status: EntityStatus,
  ) => Promise<{ ok: true; company: Company } | { ok: false; error: string }>;
  updateCompany: (
    id: string,
    patch: Partial<Pick<Company, "name" | "status">>,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  createUser: (input: {
    name: string;
    email: string;
    role: UserRole;
    companyId: string | null;
    /** Optional admin-supplied temporary password for immediate-login verification. */
    tempPassword?: string | null;
    /** Optional Area Scoped Access for the new login (defaults to all areas). */
    areaScope?: AreaScope;
  }) => Promise<{
    ok: boolean;
    error?: string;
    functionVersion?: string | null;
    /** Which credential the create request used: a real session token or the anon key. */
    authMode?: "session" | "anon";
    /** The created login's id, when creation succeeded. */
    userId?: string | null;
  }>;
  updateUser: (
    id: string,
    patch: Partial<Pick<User, "name" | "email" | "role" | "status" | "areaScope">>,
  ) => { ok: boolean; error?: string };
  roles: Role[];
  createRole: (input: {
    name: string;
    description: string;
    companyId: string | null;
    permissions: string[];
    baseRole?: UserRole;
  }) => { ok: boolean; error?: string; role?: Role };
  updateRole: (
    id: string,
    patch: Partial<Pick<Role, "name" | "description" | "permissions">>,
  ) => { ok: boolean; error?: string };
  deleteRole: (id: string) => { ok: boolean; error?: string };
  assignUserRole: (userId: string, roleId: string) => void;
  /** Resolves the effective permission keys for any user. */
  getUserPermissions: (user: User) => string[];
  /** Whether the signed-in user holds a given permission key. */
  hasPermission: (permission: string) => boolean;

  // ── Audit log ──
  /** Audit events visible to the signed-in user (company-scoped; all for Super Admin). */
  auditEvents: AuditEvent[];
  /** Records an auditable action performed by the signed-in user. */
  logAudit: (action: AuditAction, summary: string, companyId?: string | null) => void;

  // ── Directory: employees, customers, teams ──
  employees: Employee[];
  customers: Customer[];
  teams: Team[];
  /** Structured operational areas (company-scoped), active and inactive. */
  areas: Area[];
  /**
   * Whether Area Scoped Access is active for the signed-in user's company. When
   * false, area-based data filtering is bypassed (existing behavior). Foundation
   * for a future Super Admin-toggled paid module.
   */
  areaScopedAccessEnabled: boolean;
  /**
   * Runs the Area Scoped Access activation pre-check for the signed-in user's
   * company. Returns which operationally active customers still need an area
   * before the feature can be enabled.
   */
  getAreaActivationPrecheck: () => AreaActivationPrecheck;
  /**
   * Enables/disables Area Scoped Access for the signed-in user's company.
   * Enabling is rejected (and the setting left unchanged) when the activation
   * pre-check finds blocking customers; the returned precheck explains why.
   */
  setAreaScopedAccessEnabled: (enabled: boolean) => SetAreaScopedAccessResult;
  createArea: (input: { companyId: string; name: string; description?: string }) => {
    ok: boolean;
    error?: string;
  };
  updateArea: (
    id: string,
    patch: { name?: string; description?: string },
  ) => { ok: boolean; error?: string };
  /** Deactivates an area (kept for history). */
  archiveArea: (id: string) => { ok: boolean; error?: string };
  /** Reactivates a previously deactivated area. */
  restoreArea: (id: string) => { ok: boolean; error?: string };
  /** Structured postal cities (company-scoped), active and inactive. */
  postalCities: PostalCity[];
  /**
   * Whether selecting a Postal City automatically sets the customer's Area for
   * the signed-in user's company. When false, the postal city only suggests an
   * area. Independent of Area Scoped Access.
   */
  autoAreaFromPostalCityEnabled: boolean;
  /** Enables/disables automatic Area assignment from Postal City for the company. */
  setAutoAreaFromPostalCityEnabled: (enabled: boolean) => void;
  createPostalCity: (input: {
    companyId: string;
    name: string;
    areaId: string;
  }) => { ok: boolean; error?: string };
  updatePostalCity: (
    id: string,
    patch: { name?: string; areaId?: string },
  ) => { ok: boolean; error?: string };
  /** Deactivates a postal city (kept for restore/edit in settings). */
  archivePostalCity: (id: string) => { ok: boolean; error?: string };
  /** Reactivates a previously deactivated postal city. */
  restorePostalCity: (id: string) => { ok: boolean; error?: string };
  /** Controlled, company-scoped employee languages (active and inactive). */
  employeeLanguages: EmployeeLanguage[];
  createEmployeeLanguage: (input: {
    companyId: string;
    code: string;
    name: string;
    nativeName?: string;
  }) => { ok: boolean; error?: string };
  updateEmployeeLanguage: (
    id: string,
    patch: { code?: string; name?: string; nativeName?: string },
  ) => { ok: boolean; error?: string };
  /** Deactivates a language (kept for restore/edit in settings). */
  archiveEmployeeLanguage: (id: string) => { ok: boolean; error?: string };
  /** Reactivates a previously deactivated language. */
  restoreEmployeeLanguage: (id: string) => { ok: boolean; error?: string };
  /** Marks an active language as the company's sole default. */
  setEmployeeLanguageDefault: (id: string) => { ok: boolean; error?: string };
  createEmployee: (input: {
    companyId: string;
    name: string;
    email: string;
    title?: string;
    phone?: string;
    iceNumber?: string;
    address?: string;
    postalCityId?: string;
    teamIds: string[];
    userId?: string | null;
    languageId?: string | null;
    secondLanguageId?: string | null;
    availability?: Employee["availability"];
    acceptableHours?: Employee["acceptableHours"];
    preferredHours?: Employee["preferredHours"];
  }) => { ok: boolean; error?: string };
  updateEmployee: (
    id: string,
    patch: Partial<
      Pick<
        Employee,
        | "name"
        | "email"
        | "title"
        | "phone"
        | "iceNumber"
        | "address"
        | "postalCityId"
        | "status"
        | "teamIds"
        | "userId"
        | "languageId"
        | "secondLanguageId"
        | "workingSchedule"
        | "availability"
        | "acceptableHours"
        | "preferredHours"
      >
    >,
  ) => { ok: boolean; error?: string };
  /**
   * Creates an employee together with a freshly provisioned, linked login
   * (the going-forward model: no employee exists without a login). Hard-block:
   * if login provisioning fails, no employee is created. `baseRole` seeds the
   * login's access role (default "employee"); `roleId` optionally pins a custom
   * role. Optionally email a welcome/set-password link.
   */
  createEmployeeWithLogin: (input: {
    companyId: string;
    name: string;
    email: string;
    title?: string;
    phone?: string;
    iceNumber?: string;
    address?: string;
    postalCityId?: string;
    teamIds: string[];
    languageId?: string | null;
    secondLanguageId?: string | null;
    availability?: Employee["availability"];
    acceptableHours?: Employee["acceptableHours"];
    preferredHours?: Employee["preferredHours"];
    baseRole: UserRole;
    roleId?: string | null;
  }) => Promise<{ ok: boolean; error?: string }>;
  /**
   * Provisions and links a login for a legacy employee that has none, bringing
   * it into the always-has-login model. Hard-block on failure. `baseRole`
   * defaults to "employee". The employee must have an email address.
   */
  createLoginForEmployee: (
    employeeId: string,
    input?: { baseRole?: UserRole },
  ) => Promise<{ ok: boolean; error?: string }>;
  /**
   * Resolves whether an employee may be permanently deleted, returning the
   * validation result (allowed + the blocking reasons when archival is
   * required). Synthetic admin rows (no real employee record) are never
   * deletable. Used by the UI to choose Delete vs Archive.
   */
  getEmployeeDeletability: (id: string) => EntityDeleteValidationResult;
  /**
   * Permanently deletes an employee that has NO operational history (no
   * completed missions and no future assigned missions). Removes the employee
   * record and its non-operational data (media), removes the linked login/user
   * account, and clears any customer-owner references so no orphaned data
   * remains. Blocked (use {@link archiveEmployee}) once history exists. Allowed
   * only for Company Admin / Super Admin.
   */
  deleteEmployee: (id: string) => Promise<{ ok: boolean; error?: string }>;
  /**
   * Archives an employee: preserves the record and all history but sets it (and
   * any linked login) inactive and stamps `archivedAt`, so it leaves live
   * surfaces. Used when a permanent delete is blocked by operational history.
   */
  archiveEmployee: (id: string) => { ok: boolean; error?: string };
  createCustomer: (input: {
    companyId: string;
    name: string;
    email: string;
    /** Required core classification — drives recommendations and reporting. */
    customerType: CustomerType;
    /** Optional structured area assignment. */
    areaId?: string;
    /** Optional structured postal city assignment. */
    postalCityId?: string;
    /** Optional organization / registration number. */
    orgNumber?: string;
    /** Optional primary phone number. */
    phone?: string;
    /** Optional internal customer owner (employee id). */
    ownerId?: string;
    userIds: string[];
    /** When true, marks the customer as in guided onboarding on creation. */
    startOnboarding?: boolean;
  }) => { ok: boolean; error?: string; customerId?: string };
  updateCustomer: (
    id: string,
    patch: Partial<
      Pick<
        Customer,
        | "name"
        | "email"
        | "status"
        | "userIds"
        | "customerType"
        | "customerSegment"
        | "area"
        | "areaId"
        | "postalCityId"
        | "ownerId"
        | "orgNumber"
        | "onboardingStatus"
        | "onboardingStartedAt"
        | "onboardingCompletedAt"
        | "tags"
        | "mainContact"
        | "phone"
        | "addresses"
        | "contacts"
        | "internalNotes"
        | "cardNotes"
        | "schedulingPreferences"
      >
    >,
    options?: { source?: CustomerCardLogSource },
  ) => { ok: boolean; error?: string };
  /**
   * Permanently deletes a customer that has NO operational history (no work
   * orders and no scheduled visits). Removes the customer record and its
   * non-operational data (notes, card log, media, protocols) and unlinks any
   * portal logins, so no orphaned data remains. Blocked (use
   * {@link archiveCustomer}) once history exists. Allowed only for Company
   * Admin / Super Admin.
   */
  deleteCustomer: (
    id: string,
    options?: { dependencyValidation?: EntityDeleteValidationResult },
  ) => { ok: boolean; error?: string };
  /**
   * Archives a customer: preserves the record and all history but sets it
   * inactive and stamps `archivedAt`, so it leaves live surfaces. Used when a
   * permanent delete is blocked by operational history.
   */
  archiveCustomer: (id: string) => { ok: boolean; error?: string };
  /**
   * Records a Customer Card Log entry for a media-library action (upload or
   * deletion) so it appears in the customer's activity history with the actor,
   * timestamp and image category. The media asset itself is stored separately
   * via the Media Foundation; this only writes the audit trail.
   */
  logCustomerMediaActivity: (
    customerId: string,
    action: "uploaded" | "deleted",
    category: MediaCategory,
  ) => void;
  /**
   * Records a Customer Card Log entry when an image's content metadata changes
   * (category, “Used In” or “Visible For”), capturing the previous and new
   * values. The media asset itself is updated separately via the media store.
   */
  logCustomerMediaMetaChange: (
    customerId: string,
    field: string,
    oldValue: string,
    newValue: string,
  ) => void;
  /**
   * Assigns (or clears, when `assetId` is null) the customer's active cover
   * image. Reuses the existing {@link MediaAsset} — nothing is duplicated, moved
   * or deleted; only the customer's `coverMediaAssetId` pointer changes. The
   * action is recorded in the Customer Card Log.
   */
  setCustomerCoverImage: (customerId: string, assetId: string | null) => void;
  /**
   * Records a work-order activity entry when a customer media asset is attached
   * to, detached from, or uploaded into the work-order module. The asset itself
   * lives in the Customer Media Library (the customer is the owner); this only
   * writes the work order's audit trail.
   */
  logWorkOrderMediaActivity: (
    workOrderId: string,
    action: "attached" | "detached" | "uploaded",
    category: MediaCategory,
  ) => void;
  /**
   * Places a Customer Media Library asset at a location inside a work order
   * (header or a specific service row). Creates a placement *link* only — never
   * copies the image — and is a no-op if the asset is already placed in that
   * exact area. Returns the created placement, or null on failure / no-op.
   */
  addWorkOrderMediaPlacement: (
    workOrderId: string,
    input: {
      mediaAssetId: string;
      placementType: WorkOrderMediaPlacementType;
      serviceRowId?: string | null;
      visibleToEmployee?: boolean;
    },
  ) => WorkOrderMediaPlacement | null;
  /** Removes a placement link from a work order. The media asset is preserved. */
  removeWorkOrderMediaPlacement: (workOrderId: string, placementId: string) => void;
  /** Reorders the placements within one area (header or a service row). */
  reorderWorkOrderMediaPlacements: (
    workOrderId: string,
    area: { placementType: WorkOrderMediaPlacementType; serviceRowId?: string | null },
    orderedPlacementIds: string[],
  ) => void;
  /** Sets a service-row placement's “Visible in Employee App” flag (stored on the link). */
  setWorkOrderMediaPlacementEmployeeVisibility: (
    workOrderId: string,
    placementId: string,
    visibleToEmployee: boolean,
  ) => void;
  /**
   * Removes every work-order placement referencing a media asset across all
   * work orders. Call this when an asset is deleted so no dangling links remain.
   */
  purgeWorkOrderMediaPlacementsForAsset: (mediaAssetId: string) => void;
  /** Work orders connected to customers the signed-in user may see. */
  workOrders: WorkOrder[];
  /** Work orders for one customer, scoped to the signed-in user's access. */
  getCustomerWorkOrders: (customerId: string) => WorkOrder[];
  /** Creates a foundation work order for a customer. */
  createWorkOrder: (input: {
    customerId: string;
    title?: string;
    startDate?: string;
    endDate?: string;
    status?: WorkOrderStatus;
  }) => { ok: boolean; error?: string };
  /** Activates or inactivates a work order. */
  setWorkOrderActive: (id: string, active: boolean) => { ok: boolean; error?: string };
  /**
   * Archives a work order: marks it inactive so it leaves every live planning
   * surface (Schedule Board, Booking Queue) while its history stays preserved.
   * Equivalent to {@link setWorkOrderActive}(id, false) with an archive-specific
   * audit entry.
   */
  archiveWorkOrder: (id: string) => { ok: boolean; error?: string };
  /**
   * Hard-deletes a work order. Allowed ONLY for an empty/test work order with no
   * service rows, bookings, occurrences, exceptions, variations or time reports.
   * Any related data blocks the delete and the caller is told to archive instead.
   */
  deleteWorkOrder: (id: string) => { ok: boolean; error?: string };
  /**
   * Force-deletes a work order. Same empty-only gate as {@link deleteWorkOrder}
   * but requires an explicit typed confirmation ("delete").
   */
  forceDeleteWorkOrder: (
    id: string,
    confirmationInput: string,
  ) => { ok: boolean; error?: string };
  /** Resolves the related schedule/history data counts for a work order. */
  getWorkOrderRelatedData: (id: string) => WorkOrderRelatedData;
  /** Per-company Work Order cleanup settings. */
  workOrderSettings: WorkOrderSettings[];
  /** The Work Order settings for a company (defaults when not yet customized). */
  getWorkOrderSettingsFor: (companyId: string) => WorkOrderSettings;
  /** Updates a company's Work Order cleanup settings. */
  updateWorkOrderSettings: (
    companyId: string,
    patch: Partial<Pick<WorkOrderSettings, "autoArchiveEmptyAfterDays" | "autoArchiveCompletedRowsAfterDays" | "autoArchiveDelayDays" | "preferredTimeEvaluationEnabled">>,
  ) => { ok: boolean; error?: string };
  /** Per-company Time Reporting settings. */
  timeReportSettings: TimeReportSettings[];
  /** The Time Reporting settings for a company (defaults when not yet customized). */
  getTimeReportSettingsFor: (companyId: string) => TimeReportSettings;
  /** Updates a company's Time Reporting settings. */
  updateTimeReportSettings: (
    companyId: string,
    patch: Partial<Pick<TimeReportSettings, "autoApproveEnabled" | "deviationToleranceMinutes">>,
  ) => { ok: boolean; error?: string };
  /** Per-company Quick Duration settings. */
  durationSettings: DurationSettings[];
  /** The Quick Duration settings for a company (defaults when not yet customized). */
  getDurationSettingsFor: (companyId: string) => DurationSettings;
  /** Replaces a company's ordered Quick Duration presets (values in minutes). */
  updateDurationSettings: (
    companyId: string,
    presetMinutes: number[],
  ) => { ok: boolean; error?: string };
  /** Platform-wide system settings (not scoped to a company). */
  systemSettings: SystemSettings;
  /** Updates global system settings. Restricted to Super Admin. */
  updateSystemSettings: (
    patch: Partial<
      Pick<
        SystemSettings,
        | "bookingGenerationHorizonMonths"
        | "allowPreferredTimeEvaluation"
        | "entitlementsResolver"
        | "entitlementsShadowLog"
      >
    >,
  ) => { ok: boolean; error?: string };
  /** Platform-wide global availability records for entitlement-gated services. */
  serviceGlobalEntitlements: ServiceGlobalEntitlement[];
  /** Per-company entitlement (paid-access) records for optional services. */
  companyServiceEntitlements: CompanyServiceEntitlement[];
  /** Immutable entitlement-change log (billing/support trail). */
  serviceEntitlementLog: ServiceEntitlementLogEntry[];
  /** Whether a service is available platform-wide (Super Admin global gate). */
  isServiceGloballyAvailable: (serviceKey: ServiceFeatureKey) => boolean;
  /** The explicit per-company entitlement record, or null when none is stored. */
  getCompanyServiceEntitlement: (
    companyId: string,
    serviceKey: ServiceFeatureKey,
  ) => CompanyServiceEntitlement | null;
  /** Whether a company is entitled to a service (explicit record or registry default). */
  isCompanyEntitledToService: (
    companyId: string,
    serviceKey: ServiceFeatureKey,
  ) => boolean;
  /** Whether a service is usable for a company: globally available AND entitled. */
  isServiceAvailableForCompany: (
    companyId: string,
    serviceKey: ServiceFeatureKey,
  ) => boolean;
  /**
   * Sets platform-wide availability for a service. Restricted to Super Admin.
   * Authoritative: commits to Supabase first, then the read seam refetches.
   */
  setServiceGlobalAvailability: (
    serviceKey: ServiceFeatureKey,
    enabled: boolean,
  ) => Promise<{ ok: boolean; error?: string }>;
  /** Sets a company's entitlement for a service. Restricted to Super Admin. */
  setCompanyServiceEntitlement: (
    companyId: string,
    serviceKey: ServiceFeatureKey,
    enabled: boolean,
  ) => Promise<{ ok: boolean; error?: string }>;
  /** The company's tri-state status for a service (disabled/trial/enabled). */
  getCompanyServiceStatus: (
    companyId: string,
    serviceKey: ServiceFeatureKey,
  ) => ServiceEntitlementStatus;
  /**
   * The company's *effective* status, collapsing to `disabled` when the service
   * is not globally available (the global gate always wins).
   */
  getEffectiveCompanyServiceStatus: (
    companyId: string,
    serviceKey: ServiceFeatureKey,
  ) => ServiceEntitlementStatus;
  /**
   * Sets a company's tri-state status for a service (disabled/trial/enabled),
   * recording the appropriate audit/log entries. Restricted to Super Admin.
   * Authoritative: commits to Supabase first, then the read seam refetches.
   */
  setCompanyServiceStatus: (
    companyId: string,
    serviceKey: ServiceFeatureKey,
    status: ServiceEntitlementStatus,
  ) => Promise<{ ok: boolean; error?: string }>;
  /**
   * Evaluates whether a media upload may proceed for a company, given its
   * effective status and current media-asset count. Used to gate uploads and
   * to render trial usage (e.g. "23 / 30 images used").
   */
  evaluateMediaUploadGate: (companyId: string) => UsageGateResult;
  /** Aggregated media usage for a company (asset count, bytes, by category). */
  getCompanyMediaUsage: (companyId: string) => MediaUsageSummary;
  /** Employee time reports the signed-in user may see, scoped by customer access. */
  timeReports: TimeReport[];
  /** Time reports for one work order, newest first. */
  getTimeReportsForWorkOrder: (workOrderId: string) => TimeReport[];
  /**
   * Records an employee's job checkout: computes the deviation between scheduled
   * and actual time and applies the company's automatic-approval rule, storing a
   * {@link TimeReport} with the resulting status. Auto-approved reports are
   * stamped with `approvedBy = "System"` and the current time; others await
   * administrator approval.
   */
  submitTimeReportCheckout: (input: {
    workOrderId: string;
    serviceRowId?: string | null;
    jobName?: string;
    employeeId?: string | null;
    employeeName?: string;
    scheduledMinutes: number;
    actualMinutes: number;
  }) => { ok: boolean; error?: string; report?: TimeReport };
  /**
   * Booking Queue items the signed-in user may see, scoped through the parent
   * work order's customer access, newest first. The Booking Queue is the
   * planning layer between Work Orders and the future Schedule module.
   */
  bookingQueue: BookingQueueItem[];
  /**
   * Persisted overlay exceptions for individual recurring booking occurrences.
   * The service row stays the source of truth and occurrences are derived; an
   * exception is stored only when a single occurrence diverges (e.g. cancelled).
   * Empty until per-occurrence actions are built in a later step.
   */
  bookingOccurrenceExceptions: BookingOccurrenceException[];
  /** Booking Queue items for one work order, newest first. */
  getBookingQueueForWorkOrder: (workOrderId: string) => BookingQueueItem[];
  /** Cancels a booking (soft) without removing it; it stays visible behind the toggle. */
  cancelBooking: (id: string, reason?: string) => { ok: boolean; error?: string };
  /** Restores a previously cancelled booking. */
  restoreBooking: (id: string) => { ok: boolean; error?: string };
  /**
   * Cancels a single booking occurrence by writing a persisted exception keyed
   * on its stable occurrenceKey. The recurring service row and every other
   * occurrence in the series are left untouched.
   */
  cancelOccurrence: (
    occurrenceKey: string,
  ) => { ok: boolean; error?: string };
  /**
   * Restores a cancelled occurrence by removing its exception so it follows the
   * base recurrence rule again. Affects only the targeted occurrence.
   */
  restoreOccurrence: (
    occurrenceKey: string,
  ) => { ok: boolean; error?: string };
  /**
   * Moves a single booking occurrence to a new date (and optional times) by
   * writing a persisted exception keyed on its stable occurrenceKey. The
   * recurring service row, the recurrence rule and every sibling occurrence are
   * left untouched. Passing the original date with no times clears the move.
   */
  rescheduleOccurrence: (
    occurrenceKey: string,
    input: { newDate: string; newStartTime?: string | null; newEndTime?: string | null },
  ) => { ok: boolean; error?: string };
  /**
   * Reassigns the staffing of a SINGLE booking occurrence by writing a persisted
   * exception keyed on its stable occurrenceKey — the recurring service row, the
   * recurrence rule and every sibling occurrence are left untouched. This is the
   * per-occurrence assignment foundation (the safe write target for drag-and-drop
   * reassignment). Any existing cancel/reschedule overlay on the occurrence is
   * preserved; only the staffing override fields are set.
   */
  reassignOccurrence: (
    occurrenceKey: string,
    input: {
      assignedEmployeeIds: string[];
      unassignedEmployeeSlots?: number | null;
      totalLabourMinutes?: number | null;
    },
  ) => { ok: boolean; error?: string };
  /**
   * Clears a single occurrence's staffing override so it follows the series
   * assignment again. If the occurrence has no other overlay (cancel/reschedule)
   * the whole exception is removed; otherwise only the staffing override fields
   * are stripped, keeping the cancel/reschedule overlay intact.
   */
  clearOccurrenceAssignment: (
    occurrenceKey: string,
  ) => { ok: boolean; error?: string };
  /** Records a reschedule of a booking to a new date, capturing reason/comment/one-time. */
  rescheduleBooking: (
    id: string,
    input: { newDate: string; reason?: string; comment?: string; oneTime: boolean },
  ) => { ok: boolean; error?: string };
  /** A single work order, scoped to the signed-in user's access. */
  getWorkOrder: (id: string) => WorkOrder | null;
  /**
   * Back-fills a Supabase-resolved customer into the local in-memory array so
   * action/access seams (canAccessCustomer, createWorkOrder) can operate on a
   * customer that exists only in Supabase under the authoritative read path.
   * READ-side reconcile only — never mirrors back and never clobbers newer local.
   */
  hydrateCustomerFromRemote: (customer: Customer) => void;
  /**
   * Batch variant of {@link hydrateCustomerFromRemote}: back-fills many
   * Supabase-resolved customers (e.g. every Supabase-only row rendered by the
   * Customers LIST) into the local in-memory array in a single state update, so
   * list-level action/access seams (updateCustomer, deleteCustomer,
   * archiveCustomer) can resolve rows that exist only in Supabase. READ-side
   * reconcile only — never mirrors back and never clobbers newer local edits.
   */
  hydrateCustomersFromRemote: (customers: readonly Customer[]) => void;
  /**
   * Back-fills a Supabase-resolved work order into the local in-memory array so
   * action seams (getWorkOrder, checkout, update, delete service row) can operate
   * on an order that exists only in Supabase under the authoritative read path.
   * READ-side reconcile only — never mirrors back and never clobbers newer local.
   */
  hydrateWorkOrderFromRemote: (workOrder: WorkOrder) => void;
  /** Updates a work order's editable fields, logging activity. */
  updateWorkOrder: (
    id: string,
    patch: Partial<Pick<WorkOrder, "title" | "status" | "startDate" | "endDate">>,
  ) => { ok: boolean; error?: string };
  /** Adds a note to a work order. */
  addWorkOrderNote: (
    id: string,
    input: { title: string; content: string },
  ) => { ok: boolean; error?: string };
  /** Edits an existing work order note. */
  updateWorkOrderNote: (
    id: string,
    noteId: string,
    patch: { title: string; content: string },
  ) => { ok: boolean; error?: string };
  /** Archives or restores a work order note (never deletes). */
  setWorkOrderNoteArchived: (
    id: string,
    noteId: string,
    archived: boolean,
  ) => { ok: boolean; error?: string };
  /** Active services in a company's catalog, for adding to that company's work orders. */
  getServicesForCompany: (companyId: string) => Service[];
  /** Active service categories in a company's catalog, ordered by sortOrder. */
  getServiceCategoriesForCompany: (companyId: string) => ServiceCategory[];
  /** Company-scoped favorite services, newest first. A shortcut only. */
  getCompanyServiceFavorites: (companyId: string) => Service[];
  /** Whether a service is a favorite within the given company. */
  isServiceFavorite: (companyId: string, serviceId: string) => boolean;
  /**
   * Adds or removes a service from a company's favorites. A pure shortcut —
   * never affects the service, pricing, scheduling, payroll or invoicing.
   */
  toggleServiceFavorite: (
    companyId: string,
    serviceId: string,
  ) => { ok: boolean; error?: string };
  /** Adds a service row to a work order, copying a snapshot of the catalog service. */
  addWorkOrderServiceRow: (
    id: string,
    input: {
      sourceServiceId?: string | null;
      serviceName: string;
      articleNumber?: string;
      categoryName?: string;
      serviceType?: string;
      quantity: number;
      unit?: string;
      price?: number;
      vat?: number;
      status: WorkOrderServiceRow["status"];
      notes?: string;
      /** Required: the intended date the work should happen ("YYYY-MM-DD"). */
      serviceDate: string;
      plannedStartTime?: string;
      plannedEndTime?: string;
      assignedEmployeeIds?: string[];
      /** Open employee slots still to be staffed. Defaults to 0. */
      unassignedEmployeeSlots?: number;
      recurrenceInterval?: WorkOrderServiceRow["recurrenceInterval"];
      /** Optional inclusive recurrence end date ("YYYY-MM-DD"); recurring rows only. */
      serviceEndDate?: string | null;
    },
  ) => { ok: boolean; error?: string };
  /** Edits an existing work order service row. */
  updateWorkOrderServiceRow: (
    id: string,
    rowId: string,
    patch: Partial<
      Pick<
        WorkOrderServiceRow,
        | "serviceName"
        | "articleNumber"
        | "categoryName"
        | "serviceType"
        | "quantity"
        | "unit"
        | "price"
        | "vat"
        | "status"
        | "notes"
        | "serviceDate"
        | "plannedStartTime"
        | "plannedEndTime"
        | "assignedEmployeeIds"
        | "unassignedEmployeeSlots"
        | "totalLabourMinutesOverride"
        | "recurrenceInterval"
        | "serviceEndDate"
        | "customerProtocolId"
        | "protocolRunId"
      >
    >,
  ) => { ok: boolean; error?: string };
  /** Archives or restores a work order service row (never deletes). */
  setWorkOrderServiceRowArchived: (
    id: string,
    rowId: string,
    archived: boolean,
  ) => { ok: boolean; error?: string };
  /**
   * Permanently deletes a mistaken, newly-created service row that has no
   * operational history. Blocked (use archive instead) once the row has any
   * passed/completed occurrence, time report, booking exception or variation.
   * Also removes the linked Booking Queue item.
   */
  deleteWorkOrderServiceRow: (
    id: string,
    rowId: string,
  ) => { ok: boolean; error?: string };
  /**
   * Emergency cleanup for a mistaken service row created with the wrong start
   * date. Permanently removes the row and ALL of its generated bookings,
   * occurrence exceptions and (embedded) variations — even when historical
   * occurrences exist — but is blocked once any payroll/invoice basis, completed
   * time report, locked history or export references the row (use archive then).
   * Always writes a `workorder.service.force_delete` audit record.
   */
  forceDeleteWorkOrderServiceRow: (
    id: string,
    rowId: string,
  ) => { ok: boolean; error?: string };
  /** Reorders the active service rows within a work order. */
  reorderWorkOrderServiceRows: (
    id: string,
    orderedIds: string[],
  ) => { ok: boolean; error?: string };
  /**
   * Adds a recurring variation to a service row. Variations are planned
   * recurring differences from the row's default schedule; scheduling automation
   * is built later. New variations start enabled and unarchived.
   */
  addServiceRowVariation: (
    id: string,
    rowId: string,
    input: Omit<
      RecurringVariation,
      "id" | "enabled" | "archived" | "createdAt" | "updatedAt"
    >,
  ) => { ok: boolean; error?: string };
  /** Edits a recurring variation on a service row. */
  updateServiceRowVariation: (
    id: string,
    rowId: string,
    variationId: string,
    patch: Partial<
      Pick<
        RecurringVariation,
        | "name"
        | "frequency"
        | "interval"
        | "weekOfMonth"
        | "weekday"
        | "day"
        | "startTime"
        | "endTime"
        | "durationMinutes"
        | "employeeCount"
        | "assignedEmployeeIds"
        | "type"
        | "internalNote"
        | "reason"
        | "notes"
        | "appliesFrom"
        | "appliesUntil"
      >
    >,
  ) => { ok: boolean; error?: string };
  /**
   * Sets a recurring variation's lifecycle status (draft, active, inactive,
   * archived). Archived variations are hidden by default but recoverable; no
   * variation is ever permanently deleted.
   */
  setServiceRowVariationStatus: (
    id: string,
    rowId: string,
    variationId: string,
    status: VariationStatus,
  ) => { ok: boolean; error?: string };
  /**
   * Replaces one or more existing variations with a new (or edited) variation,
   * preserving full history. Superseded variations are bounded, archived, and
   * back-linked via the pure {@link replaceVariation} helper (never deleted);
   * the saved variation is forward-linked. Backs the AO conflict dialog's
   * "Replace existing variation" action so the replacement lifecycle stays
   * centralized.
   */
  replaceServiceRowVariation: (
    id: string,
    rowId: string,
    args: {
      /** When set, the edited variation's id; otherwise a new variation is created. */
      variationId?: string | null;
      input: Omit<
        RecurringVariation,
        "id" | "enabled" | "archived" | "createdAt" | "updatedAt"
      >;
      /** Ids of the existing variations to supersede. */
      replacedVariationIds: string[];
    },
  ) => { ok: boolean; error?: string };
  /** Enables or disables a recurring variation (kept but not applied). */
  setServiceRowVariationEnabled: (
    id: string,
    rowId: string,
    variationId: string,
    enabled: boolean,
  ) => { ok: boolean; error?: string };
  /** Archives or restores a recurring variation (never deletes). */
  setServiceRowVariationArchived: (
    id: string,
    rowId: string,
    variationId: string,
    archived: boolean,
  ) => { ok: boolean; error?: string };
  /**
   * Stops a recurring variation from applying to FUTURE occurrences while
   * preserving every past occurrence it already modified. Sets an inclusive
   * `appliesUntil` cutoff (defaults to today) so the resolver keeps applying the
   * variation to occurrences on/before the cutoff and drops it for every later
   * occurrence. The variation is never deleted — its history stays traceable.
   */
  stopServiceRowVariation: (
    id: string,
    rowId: string,
    variationId: string,
    cutoffIso?: string,
  ) => { ok: boolean; error?: string };
  /**
   * Permanently deletes a mistaken, freshly-created variation that has no
   * historical impact. Blocked (use {@link stopServiceRowVariation} instead)
   * once the variation has applied to a past occurrence or participates in a
   * replacement chain, so historical references are never lost.
   */
  deleteServiceRowVariation: (
    id: string,
    rowId: string,
    variationId: string,
  ) => { ok: boolean; error?: string };
  /** Invoices connected to customers the signed-in user may see (read-only). */
  invoices: Invoice[];
  /** Invoices for one customer, scoped to the signed-in user's access. */
  getCustomerInvoices: (customerId: string) => Invoice[];
  createTeam: (input: { companyId: string; name: string; description?: string }) => {
    ok: boolean;
    error?: string;
  };
  updateTeam: (
    id: string,
    patch: Partial<Pick<Team, "name" | "description">>,
  ) => { ok: boolean; error?: string };
  deleteTeam: (id: string) => void;

  // ── Modules ──
  modules: Module[];
  companyModules: CompanyModuleSetting[];
  /**
   * Super Admin: toggle a module's global platform availability. Authoritative:
   * when the catalogue reads from Supabase the change commits there FIRST and the
   * UI reflects it only after the directory refetch; resolves `{ ok: false }` with
   * a message when the write fails.
   */
  setModuleStatus: (
    moduleId: string,
    status: EntityStatus,
  ) => Promise<{ ok: boolean; error?: string }>;
  /**
   * Super Admin: set whether a module is offered to a company. Authoritative:
   * when the directory reads from Supabase the change commits there FIRST (incl.
   * the tenant UUID the RLS check needs) and the UI reflects it only after the
   * directory refetch; resolves `{ ok: false }` with a message when the write
   * fails. Withdrawing availability also switches the company's enablement off.
   */
  setModuleAvailable: (
    companyId: string,
    moduleId: string,
    available: boolean,
  ) => Promise<{ ok: boolean; error?: string }>;
  /**
   * Company Admin: switch an available module on or off. Authoritative: when the
   * directory reads from Supabase the change commits there FIRST and the UI
   * reflects it only after the directory refetch; resolves `{ ok: false }` with a
   * message when the write fails.
   */
  setModuleEnabled: (
    companyId: string,
    moduleId: string,
    enabled: boolean,
  ) => Promise<{ ok: boolean; error?: string }>;
  /** The per-company setting for a module, if any. */
  getCompanyModuleSetting: (
    companyId: string,
    moduleId: string,
  ) => CompanyModuleSetting | undefined;
  /** Whether the given user may access a module's pages/actions. */
  canAccessModule: (user: User, moduleId: string) => boolean;
  /**
   * The entitlement-derived availability for a module under the Service → Module
   * bridge (e.g. `admin-requests` ← `admin_requests`). Returns `undefined` for
   * modules with no bridge, so callers fall back to the raw
   * `company_modules.available` flag. Governs only Layer 2 (availability); the
   * Company Admin local enabled toggle stays separate.
   */
  getModuleEntitlementAvailability: (
    companyId: string,
    moduleId: string,
  ) => boolean | undefined;
  /** Module definitions the user can currently access (active + enabled + permitted). */
  getAccessibleModules: (user: User) => ModuleDefinition[];

  // ── Module categories (Super Admin) ──
  moduleCategories: ModuleCategory[];
  createCategory: (input: {
    name: string;
    description: string;
    icon: string;
    visibleUserTypes: UserRole[];
    moduleIds: string[];
    status?: EntityStatus;
  }) => Promise<{ ok: boolean; error?: string }>;
  updateCategory: (
    id: string,
    patch: Partial<
      Pick<
        ModuleCategory,
        "name" | "description" | "icon" | "status" | "visibleUserTypes" | "moduleIds"
      >
    >,
  ) => Promise<{ ok: boolean; error?: string }>;
  deleteCategory: (id: string) => Promise<{ ok: boolean; error?: string }>;
  /** Reorders categories to match the given id sequence. */
  reorderCategories: (orderedIds: string[]) => Promise<{ ok: boolean; error?: string }>;
  /**
   * Module navigation groups for a user: active categories visible to their role
   * that contain at least one accessible module, plus any uncategorised modules.
   */
  getNavModuleGroups: (
    user: User,
  ) => { id: string; title: string; modules: ModuleDefinition[] }[];

  // ── Checklist Manager: templates ──
  checklistTemplates: ChecklistTemplate[];
  checklistAdoptions: ChecklistTemplateAdoption[];
  /** Templates the user may see in the manager (own + available globals). */
  getVisibleTemplates: (user: User) => ChecklistTemplate[];
  /** Whether the user can edit a template's settings and structure. */
  canEditTemplate: (user: User, template: ChecklistTemplate) => boolean;
  createTemplate: (input: {
    companyId: string | null;
    name: string;
    description?: string;
  }) => { ok: boolean; error?: string; template?: ChecklistTemplate };
  /**
   * Clones a global template into a fully independent company template. The copy
   * includes all floors, rooms, tasks, notes and images, with fresh ids, and is
   * disconnected from the original (future edits never propagate either way).
   */
  cloneTemplate: (templateId: string) => {
    ok: boolean;
    error?: string;
    template?: ChecklistTemplate;
  };
  updateTemplate: (
    id: string,
    patch: Partial<
      Pick<
        ChecklistTemplate,
        "name" | "description" | "status" | "archived" | "availableToCompanies"
      >
    >,
  ) => { ok: boolean; error?: string };
  // Floors
  addFloor: (templateId: string, name: string) => { ok: boolean; error?: string };
  updateFloor: (templateId: string, floorId: string, name: string) => { ok: boolean; error?: string };
  deleteFloor: (templateId: string, floorId: string) => void;
  setFloorArchived: (templateId: string, floorId: string, archived: boolean) => void;
  reorderFloors: (templateId: string, orderedIds: string[]) => void;
  // Rooms
  addRoom: (templateId: string, floorId: string, name: string) => { ok: boolean; error?: string };
  updateRoom: (
    templateId: string,
    floorId: string,
    roomId: string,
    name: string,
  ) => { ok: boolean; error?: string };
  deleteRoom: (templateId: string, floorId: string, roomId: string) => void;
  setRoomArchived: (
    templateId: string,
    floorId: string,
    roomId: string,
    archived: boolean,
  ) => void;
  reorderRooms: (templateId: string, floorId: string, orderedIds: string[]) => void;
  // Tasks
  addTask: (
    templateId: string,
    floorId: string,
    roomId: string,
    input: { name: string; description?: string; autoEnabled: boolean },
  ) => { ok: boolean; error?: string };
  updateTask: (
    templateId: string,
    floorId: string,
    roomId: string,
    taskId: string,
    patch: Partial<Pick<CleaningTask, "name" | "description" | "autoEnabled">>,
  ) => { ok: boolean; error?: string };
  deleteTask: (templateId: string, floorId: string, roomId: string, taskId: string) => void;
  setTaskArchived: (
    templateId: string,
    floorId: string,
    roomId: string,
    taskId: string,
    archived: boolean,
  ) => void;
  reorderTasks: (
    templateId: string,
    floorId: string,
    roomId: string,
    orderedIds: string[],
  ) => void;
  // Notes & images on any level (template, floor, room, task)
  setChecklistNotesImages: (
    target: ChecklistTarget,
    notes: string,
    images: ChecklistImage[],
  ) => { ok: boolean; error?: string };
  // Adoption of global templates by a company
  getTemplateAdoption: (
    companyId: string,
    templateId: string,
  ) => ChecklistTemplateAdoption | undefined;
  setTemplateAdopted: (companyId: string, templateId: string, enabled: boolean) => void;

  // ── Checklist Manager: customer protocols ──
  customerProtocols: CustomerProtocol[];
  /** Protocols the user may see (all for Super Admin; own company otherwise). */
  getVisibleProtocols: (user: User) => CustomerProtocol[];
  /**
   * Read-only protocols connected to a customer's own account, for the customer
   * portal. Resolves the customer login to its customer record, then returns its
   * non-archived protocols. Returns [] for non-customers or when access is denied.
   */
  getMyProtocols: (user: User) => CustomerProtocol[];
  /** Whether a customer login may read a specific protocol (own account + company). */
  canViewMyProtocol: (user: User, protocol: CustomerProtocol) => boolean;
  /** Whether the user can edit a protocol's content (company admins in scope). */
  canEditProtocol: (user: User, protocol: CustomerProtocol) => boolean;
  /**
   * Creates a customer protocol by copying the structure of a template. Rooms
   * and tasks start inactive; the protocol is fully independent of the template.
   */
  createProtocol: (input: {
    customerId: string;
    templateId: string;
    name?: string;
    description?: string;
  }) => { ok: boolean; error?: string; protocol?: CustomerProtocol };
  updateProtocol: (
    id: string,
    patch: Partial<Pick<CustomerProtocol, "name" | "description" | "status">>,
  ) => { ok: boolean; error?: string };
  /** Archives or restores a protocol (restoring returns it to draft). */
  setProtocolArchived: (id: string, archived: boolean) => { ok: boolean; error?: string };
  /** Creates an independent deep copy of a protocol for the same customer. */
  duplicateProtocol: (
    id: string,
  ) => { ok: boolean; error?: string; protocol?: CustomerProtocol };
  /**
   * Activates or deactivates a room. Activating enables its auto-enabled tasks;
   * deactivating switches all of its tasks off.
   */
  setProtocolRoomActive: (
    protocolId: string,
    floorId: string,
    roomId: string,
    active: boolean,
  ) => { ok: boolean; error?: string };
  /**
   * Sets a task's state (active / excluded / inactive). When excluding, an
   * optional reason can be recorded; switching away from excluded clears it.
   */
  setProtocolTaskState: (
    protocolId: string,
    floorId: string,
    roomId: string,
    taskId: string,
    state: ProtocolTaskState,
    exclusionReason?: string,
  ) => { ok: boolean; error?: string };
  /** Sets a customer-specific note on any protocol node. */
  setProtocolNotes: (target: ProtocolTarget, notes: string) => { ok: boolean; error?: string };
  /**
   * Persists a full draft of a protocol's editable content (name, description,
   * status, notes and the floor/room/task tree) in one atomic save. Identity
   * and ownership fields are preserved from the stored protocol. Used by the
   * protocol editor's explicit "Save changes" action.
   */
  saveProtocol: (
    id: string,
    draft: Pick<CustomerProtocol, "name" | "description" | "status" | "notes" | "floors">,
  ) => { ok: boolean; error?: string };

  // ── Checklist Libraries: reusable rooms & cleaning tasks ──
  libraryRooms: LibraryRoom[];
  libraryTasks: LibraryTask[];
  /** Library rooms the user may use (own company + active globals; globals for Super Admin). */
  getVisibleLibraryRooms: (user: User) => LibraryRoom[];
  /** Library tasks the user may use (own company + active globals; globals for Super Admin). */
  getVisibleLibraryTasks: (user: User) => LibraryTask[];
  /** Whether the user can edit a given library room (own scope only). */
  canEditLibraryRoom: (user: User, room: LibraryRoom) => boolean;
  /** Whether the user can edit a given library task (own scope only). */
  canEditLibraryTask: (user: User, task: LibraryTask) => boolean;
  createLibraryRoom: (input: {
    name: string;
    description?: string;
    suggestedFloorType?: string;
    category: RoomLibraryCategory;
  }) => { ok: boolean; error?: string; room?: LibraryRoom };
  updateLibraryRoom: (
    id: string,
    patch: Partial<Pick<LibraryRoom, "name" | "description" | "suggestedFloorType" | "category">>,
  ) => { ok: boolean; error?: string };
  setLibraryRoomArchived: (id: string, archived: boolean) => { ok: boolean; error?: string };
  createLibraryTask: (input: {
    name: string;
    description?: string;
    defaultAutoEnabled: boolean;
    category: TaskLibraryCategory;
  }) => { ok: boolean; error?: string; task?: LibraryTask };
  updateLibraryTask: (
    id: string,
    patch: Partial<Pick<LibraryTask, "name" | "description" | "defaultAutoEnabled" | "category">>,
  ) => { ok: boolean; error?: string };
  setLibraryTaskArchived: (id: string, archived: boolean) => { ok: boolean; error?: string };
  /**
   * Adds the given library rooms to a template floor as independent copies
   * (new ids; future library edits never propagate to the template).
   */
  addRoomsFromLibrary: (
    templateId: string,
    floorId: string,
    roomIds: string[],
  ) => { ok: boolean; error?: string };
  /**
   * Adds the given library tasks to a template room as independent copies
   * (new ids; future library edits never propagate to the template).
   */
  addTasksFromLibrary: (
    templateId: string,
    floorId: string,
    roomId: string,
    taskIds: string[],
  ) => { ok: boolean; error?: string };

  // ── Settings Templates (Super Admin) & Company Settings setup ──
  settingsTemplates: SettingsTemplate[];
  companySettings: CompanySettings[];
  /** Templates a company admin may choose from at setup (active, non-archived). */
  getSelectableSettingsTemplates: () => SettingsTemplate[];
  createSettingsTemplate: (input: {
    name: string;
    description?: string;
    data?: SettingsData;
    recommendedServicePackageId?: string | null;
  }) => { ok: boolean; error?: string; template?: SettingsTemplate };
  updateSettingsTemplate: (
    id: string,
    patch: Partial<
      Pick<SettingsTemplate, "name" | "description" | "data" | "recommendedServicePackageId">
    >,
  ) => { ok: boolean; error?: string };
  setSettingsTemplateArchived: (
    id: string,
    archived: boolean,
  ) => { ok: boolean; error?: string };
  /** Creates an independent copy of a settings template. */
  duplicateSettingsTemplate: (
    id: string,
  ) => { ok: boolean; error?: string; template?: SettingsTemplate };
  /** The company's own settings, if setup has been started. */
  getCompanySettingsFor: (companyId: string) => CompanySettings | undefined;
  /**
   * Establishes a company's settings at setup. When `templateId` is given the
   * template's data is copied (independent of the source); otherwise the company
   * starts blank. Re-running replaces the existing settings.
   */
  initializeCompanySettings: (
    companyId: string,
    choice: { templateId: string } | { blank: true },
  ) => { ok: boolean; error?: string };

  // ── Services (universal catalog master data) ──
  serviceCategories: ServiceCategory[];
  services: Service[];
  servicePackages: ServicePackage[];
  /** The company scope for service management: null = global (Super Admin). */
  getServiceScope: () => string | null;
  /** Categories visible in the current scope, ordered by sortOrder. */
  getScopedServiceCategories: () => ServiceCategory[];
  /** Services visible in the current scope. */
  getScopedServices: () => Service[];
  /** Super Admin–governed payroll/statistics aggregation groups (read-only here). */
  payrollGroups: PayrollGroup[];
  createServiceCategory: (input: {
    name: string;
    description?: string;
    categoryType?: ServiceCategoryType;
  }) => { ok: boolean; error?: string; category?: ServiceCategory };
  updateServiceCategory: (
    id: string,
    patch: Partial<Pick<ServiceCategory, "name" | "description" | "categoryType">>,
  ) => { ok: boolean; error?: string };
  setServiceCategoryArchived: (
    id: string,
    archived: boolean,
  ) => { ok: boolean; error?: string };
  reorderServiceCategories: (orderedIds: string[]) => { ok: boolean; error?: string };
  createService: (
    input: Omit<Service, "id" | "companyId" | "status" | "createdBy" | "createdAt" | "updatedAt">,
  ) => { ok: boolean; error?: string; service?: Service };
  updateService: (
    id: string,
    patch: Partial<Omit<Service, "id" | "companyId" | "createdBy" | "createdAt" | "updatedAt">>,
  ) => { ok: boolean; error?: string };
  setServiceArchived: (id: string, archived: boolean) => { ok: boolean; error?: string };
  /**
   * Permanently removes a GLOBAL catalog service (Super Admin only). Deletes ONLY
   * the global template row — company-owned copies (independent rows) and any
   * work-order/schedule/customer data that snapshotted it are never affected.
   */
  hardDeleteService: (
    id: string,
  ) => Promise<{ ok: boolean; error?: string; removedFromPackages?: number }>;
  /** Packages a company admin may copy at setup (active, non-archived). */
  getSelectableServicePackages: () => ServicePackage[];
  createServicePackage: (input: {
    name: string;
    description?: string;
    items?: ServicePackageItem[];
  }) => Promise<{ ok: boolean; error?: string; servicePackage?: ServicePackage }>;
  updateServicePackage: (
    id: string,
    patch: Partial<Pick<ServicePackage, "name" | "description" | "items">>,
  ) => Promise<{ ok: boolean; error?: string }>;
  setServicePackageArchived: (
    id: string,
    archived: boolean,
  ) => Promise<{ ok: boolean; error?: string }>;
  duplicateServicePackage: (
    id: string,
  ) => Promise<{ ok: boolean; error?: string; servicePackage?: ServicePackage }>;

  // ── Time Codes (payroll foundation) ──
  /** Every time code (global master library + future company codes). */
  timeCodes: TimeCode[];
  /** Whether the current user may manage the master time-code library. */
  canManageTimeCodes: () => boolean;
  /** Whether the current user may view time codes. */
  canViewTimeCodes: () => boolean;
  /** Resolves a single time code by id in O(1). */
  getTimeCodeById: (id: string | null | undefined) => TimeCode | undefined;
  /** Active time codes assignable in the current company scope (for pickers). */
  getAvailableTimeCodes: () => TimeCode[];
  /** How many services reference a time code (O(1) read). */
  getTimeCodeUsageCount: (id: string) => number;
  /** The services linked to a time code. */
  getServicesForTimeCode: (id: string) => Service[];
  createTimeCode: (input: {
    code: string;
    name: string;
    type: TimeCodeType;
    description?: string;
    active?: boolean;
  }) => Promise<{ ok: boolean; error?: string; timeCode?: TimeCode }>;
  updateTimeCode: (
    id: string,
    patch: Partial<Pick<TimeCode, "code" | "name" | "type" | "description">>,
  ) => Promise<{ ok: boolean; error?: string }>;
  setTimeCodeActive: (id: string, active: boolean) => Promise<{ ok: boolean; error?: string }>;
  /** Soft-deletes a time code; rejected when system-managed or referenced. */
  deleteTimeCode: (id: string) => Promise<{ ok: boolean; error?: string }>;

  // ── Payroll Export (architecture foundation) ──
  /** Per-(company,target) export capabilities owned by the Super Admin. */
  payrollExportCapabilities: PayrollExportCapability[];
  /** Company-specific export setups. */
  payrollExportProfiles: PayrollExportProfile[];
  /** Immutable history of export attempts. */
  payrollExportRuns: PayrollExportRun[];
  /** Whether the user may activate export capabilities per company (Super Admin). */
  canManagePayrollExportEntitlements: () => boolean;
  /** Whether the user may view the payroll export module. */
  canViewPayrollExport: () => boolean;
  /** Whether the user may create/edit export profiles. */
  canManagePayrollExportProfiles: () => boolean;
  /** Whether the user may run exports. */
  canRunPayrollExport: () => boolean;
  /** Whether a company is entitled to an export target. */
  isPayrollExportTargetEnabled: (
    companyId: string,
    target: PayrollExportTargetKey,
  ) => boolean;
  /** Export targets enabled for a company (defaults to the current company). */
  getAvailablePayrollExportTargets: (
    companyId?: string | null,
    options?: { onlyImplemented?: boolean },
  ) => PayrollExportTargetKey[];
  /** Export profiles for a company (defaults to the current company). */
  getPayrollExportProfilesForCompany: (
    companyId?: string | null,
  ) => PayrollExportProfile[];
  /** Profiles that can actually be run (active, entitled, implemented adapter). */
  getRunnablePayrollExportProfiles: (
    companyId?: string | null,
  ) => PayrollExportProfile[];
  /** Export run history for a company, most recent first. */
  getPayrollExportRunsForCompany: (companyId?: string | null) => PayrollExportRun[];
  /** Super Admin: enable/disable an export target for a company. */
  setPayrollExportCapability: (
    companyId: string,
    target: PayrollExportTargetKey,
    enabled: boolean,
  ) => { ok: boolean; error?: string };
  /** Company Admin: create an export profile for an enabled target. */
  createPayrollExportProfile: (input: {
    companyId?: string;
    name: string;
    target: PayrollExportTargetKey;
    config?: Record<string, string | number | boolean>;
    active?: boolean;
  }) => { ok: boolean; error?: string; profile?: PayrollExportProfile };
  updatePayrollExportProfile: (
    id: string,
    patch: { name?: string; config?: Record<string, string | number | boolean> },
  ) => { ok: boolean; error?: string };
  setPayrollExportProfileActive: (
    id: string,
    active: boolean,
  ) => { ok: boolean; error?: string };
  deletePayrollExportProfile: (id: string) => { ok: boolean; error?: string };
  /**
   * Runs an export for a profile against an approved {@link PayrollBasis},
   * recording a {@link PayrollExportRun}. The basis is passed in (full payroll
   * calculation is out of scope this phase). Returns the adapter output.
   */
  runPayrollExport: (
    profileId: string,
    basis: PayrollBasis,
  ) => {
    ok: boolean;
    error?: string;
    run?: PayrollExportRun;
    output?: PayrollExportOutput;
  };
}

/** Identifies any node in a customer protocol tree, used for note edits. */
export type ProtocolTarget =
  | { level: "protocol"; protocolId: string }
  | { level: "floor"; protocolId: string; floorId: string }
  | { level: "room"; protocolId: string; floorId: string; roomId: string }
  | {
      level: "task";
      protocolId: string;
      floorId: string;
      roomId: string;
      taskId: string;
    };

/** Identifies any node in the checklist tree, used for notes/image edits. */
export type ChecklistTarget =
  | { level: "template"; templateId: string }
  | { level: "floor"; templateId: string; floorId: string }
  | { level: "room"; templateId: string; floorId: string; roomId: string }
  | {
      level: "task";
      templateId: string;
      floorId: string;
      roomId: string;
      taskId: string;
    };

const AppContext = createContext<AppContextValue | null>(null);

function shouldRestoreSupabaseSessionOnLoad(): boolean {
  if (!isSupabaseAuthEnabled) return false;
  if (getSessionUserId()) return false;
  const path = typeof window !== "undefined" ? window.location.pathname : "";
  return path !== "/accept-invite" && path !== "/reset-password";
}

export function AppProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    const id = getSessionUserId();
    const restored = id ? getUserById(id) : null;
    // Admin roles (super_admin / company_admin) are no longer allowed to hold a
    // localStorage session. A stale local admin session is ignored here; an
    // eligible admin is re-established from their real Supabase Auth session by
    // restoreSupabaseSession() below. This prevents demo/legacy admins from being
    // silently rehydrated without a Supabase token.
    if (
      restored &&
      (restored.role === "super_admin" || restored.role === "company_admin")
    ) {
      // eslint-disable-next-line no-console
      console.warn(
        "[auth.restore] Ignoring stale localStorage admin session — admins must " +
          "authenticate through Supabase Auth.",
        { role: restored.role },
      );
      return null;
    }
    return restored;
  });
  const [isAuthRestoring, setIsAuthRestoring] = useState<boolean>(() =>
    shouldRestoreSupabaseSessionOnLoad(),
  );
  // View As Customer (impersonation/preview). The real session stays in
  // `currentUser`; while previewing, `impersonatedUser` overrides what the
  // portal renders, but every mutation remains scoped to the real admin.
  const [impersonatedUser, setImpersonatedUser] = useState<User | null>(null);
  const [viewAsCustomerId, setViewAsCustomerId] = useState<string | null>(null);
  const [viewAsEmployeeId, setViewAsEmployeeId] = useState<string | null>(null);
  const [companies, setCompanies] = useState<Company[]>(() => getCompanies());
  const [users, setUsers] = useState<User[]>(() => getUsers());
  const [roles, setRoles] = useState<Role[]>(() => getRoles());
  const [employees, setEmployees] = useState<Employee[]>(() => getEmployees());
  const [customers, setCustomers] = useState<Customer[]>(() => getCustomers());
  const [teams, setTeams] = useState<Team[]>(() => getTeams());
  const [areas, setAreas] = useState<Area[]>(() => getAreas());
  const [postalCities, setPostalCities] = useState<PostalCity[]>(() => getPostalCities());
  const [employeeLanguages, setEmployeeLanguages] = useState<EmployeeLanguage[]>(
    () => getEmployeeLanguages(),
  );
  // Bumped whenever Area Scoped Access is toggled so the (store-backed) flag is
  // re-read and the value object re-renders.
  const [areaScopedAccessTick, setAreaScopedAccessTick] = useState<number>(0);
  // Bumped whenever the auto-area-from-postal-city setting is toggled so the
  // (store-backed) flag is re-read and the value object re-renders.
  const [autoAreaTick, setAutoAreaTick] = useState<number>(0);
  const [modules, setModules] = useState<Module[]>(() => getModules());
  const [companyModules, setCompanyModules] = useState<CompanyModuleSetting[]>(
    () => getCompanyModules(),
  );
  const [moduleCategories, setModuleCategories] = useState<ModuleCategory[]>(
    () => getModuleCategories(),
  );
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>(() => getAuditEvents());
  const [checklistTemplates, setChecklistTemplates] = useState<ChecklistTemplate[]>(
    () => getChecklistTemplates(),
  );
  const [checklistAdoptions, setChecklistAdoptions] = useState<ChecklistTemplateAdoption[]>(
    () => getChecklistAdoptions(),
  );
  const [customerProtocols, setCustomerProtocols] = useState<CustomerProtocol[]>(
    () => getCustomerProtocols(),
  );
  const [libraryRooms, setLibraryRooms] = useState<LibraryRoom[]>(() => getLibraryRooms());
  const [libraryTasks, setLibraryTasks] = useState<LibraryTask[]>(() => getLibraryTasks());
  const [settingsTemplates, setSettingsTemplates] = useState<SettingsTemplate[]>(
    () => getSettingsTemplates(),
  );
  const [companySettings, setCompanySettings] = useState<CompanySettings[]>(
    () => getCompanySettings(),
  );
  const [serviceCategories, setServiceCategories] = useState<ServiceCategory[]>(
    () => getServiceCategories(),
  );
  const [payrollGroups, setPayrollGroups] = useState<PayrollGroup[]>(() => getPayrollGroups());
  const [services, setServices] = useState<Service[]>(() => getServices());
  const [servicePackages, setServicePackages] = useState<ServicePackage[]>(
    () => getServicePackages(),
  );
  const [serviceFavorites, setServiceFavorites] = useState<CompanyServiceFavorite[]>(
    () => getServiceFavorites(),
  );
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>(() => getWorkOrders());
  const [workOrderSettings, setWorkOrderSettings] = useState<WorkOrderSettings[]>(
    () => getWorkOrderSettings(),
  );
  const [timeReportSettings, setTimeReportSettings] = useState<TimeReportSettings[]>(
    () => getTimeReportSettings(),
  );
  const [durationSettings, setDurationSettings] = useState<DurationSettings[]>(
    () => getDurationSettings(),
  );
  const [systemSettings, setSystemSettings] = useState<SystemSettings>(
    () => getSystemSettings(),
  );
  const [serviceGlobalEntitlements, setServiceGlobalEntitlements] = useState<
    ServiceGlobalEntitlement[]
  >(() => getServiceGlobalEntitlements());
  const [companyServiceEntitlements, setCompanyServiceEntitlements] = useState<
    CompanyServiceEntitlement[]
  >(() => getCompanyServiceEntitlements());
  const [serviceEntitlementLog, setServiceEntitlementLog] = useState<
    ServiceEntitlementLogEntry[]
  >(() => getServiceEntitlementLog());
  const [timeReports, setTimeReports] = useState<TimeReport[]>(() => getTimeReports());
  const [bookingQueue, setBookingQueue] = useState<BookingQueueItem[]>(() => getBookingQueue());
  const [bookingOccurrenceExceptions, setBookingOccurrenceExceptions] = useState<
    BookingOccurrenceException[]
  >(() => getBookingOccurrenceExceptions());
  const [invoices, setInvoices] = useState<Invoice[]>(() => getInvoices());
  const [timeCodes, setTimeCodes] = useState<TimeCode[]>(() => getTimeCodes());
  const [payrollExportCapabilities, setPayrollExportCapabilities] = useState<
    PayrollExportCapability[]
  >(() => getPayrollExportCapabilities());
  const [payrollExportProfiles, setPayrollExportProfiles] = useState<PayrollExportProfile[]>(
    () => getPayrollExportProfiles(),
  );
  const [payrollExportRuns, setPayrollExportRuns] = useState<PayrollExportRun[]>(
    () => getPayrollExportRuns(),
  );

  useEffect(() => {
    void invalidateDomainQueryCaches(queryClient);
  }, [
    queryClient,
    currentUser?.id,
    currentUser?.companyId,
    currentUser?.role,
    currentUser?.roleId,
    companies,
    roles,
  ]);

  /** Appends an audit event with an explicit actor (used before session state settles). */
  const appendAudit = useCallback((event: Omit<AuditEvent, "id" | "at">) => {
    setAuditEvents((prev) => {
      const next = [
        { ...event, id: makeId("aud"), at: new Date().toISOString() },
        ...prev,
      ].slice(0, 500);
      saveAuditEvents(next);
      // localStorage stays the source of truth (the 500-cap backout copy); under
      // the cut-over the newly-appended event is mirrored (append-only) to Supabase.
      if (shouldRunBrowserDomainMirror(shouldMirrorActivityWrites())) void mirrorActivityAppend(prev, next);
      return next;
    });
  }, []);

  const logAudit = useCallback<AppContextValue["logAudit"]>(
    (action, summary, companyId) => {
      appendAudit({
        actorId: currentUser?.id ?? null,
        actorName: currentUser?.name ?? "System",
        actorRole: currentUser?.role ?? "super_admin",
        companyId: companyId !== undefined ? companyId : currentUser?.companyId ?? null,
        action,
        summary,
      });
    },
    [appendAudit, currentUser],
  );

  /** Audit events the signed-in user may see: all for Super Admin, own company otherwise. */
  const visibleAuditEvents = useMemo<AuditEvent[]>(() => {
    if (!currentUser) return [];
    if (currentUser.role === "super_admin") return auditEvents;
    return auditEvents.filter((e) => e.companyId === currentUser.companyId);
  }, [auditEvents, currentUser]);

  const persistEmployees = useCallback((next: Employee[]) => {
    // localStorage is written first, synchronously — the authoritative write
    // target for employees (EMP-4 introduces NO authoritative-write mode). The
    // local write never blocks/fails on Supabase, so rollback stays instant and
    // data-free (flag OFF).
    // Snapshot the previous persisted state BEFORE overwriting (the mirror needs
    // the prev→next diff). getEmployees() reads the soon-to-be-replaced
    // localStorage value, so it must run before saveEmployees().
    const mirror = shouldRunBrowserDomainMirror(shouldMirrorEmployeeWrites());
    const prev = mirror ? getEmployees() : null;
    setEmployees(next);
    saveEmployees(next);
    // EMP-4 dual-write: mirror the employee write (create / update / archive /
    // delete) into Supabase in the background. Fire-and-forget — a Supabase
    // failure can never affect the employee operation. Removals soft-delete the
    // Supabase row (removal propagation). This closes the read/write asymmetry:
    // the directory READ is already Supabase-primary, so without this mirror a
    // write could be lost behind a stale Supabase read. Rollback = flag OFF.
    if (mirror && prev) {
      void mirrorEmployeeWrites(prev, next, {
        shadowValidate: shouldShadowValidateEmployees(),
      });
    }
  }, []);

  // EMP-2 — Employees Supabase read path (flag-gated, default OFF). The directory
  // is seeded SYNCHRONOUSLY from localStorage above (line 1638) so the UI never
  // flashes/blanks. The Supabase read scope is the active company for company
  // users; super admins read unscoped (RLS-visible rows across companies).
  const employeeReadScope = useMemo<string | null | undefined>(() => {
    if (!currentUser) return undefined;
    if (currentUser.role === "super_admin") return undefined;
    return currentUser.companyId ?? undefined;
  }, [currentUser]);

  // Stable auth-readiness signal for the service-catalog directory reads. When
  // Supabase Auth is enabled, those hooks skip the unauthenticated pre-auth read
  // (which returns misleading empty results under RLS) until this is non-null,
  // then re-fetch on the `null → id` transition after login.
  const authNonce = useMemo<string | null>(() => currentUser?.id ?? null, [currentUser]);

  // When the flag is OFF this hook is a no-op and `source` is always "local", so
  // the effect below never runs and behaviour is byte-identical to today. When
  // ON it reconciles the in-memory directory to a HEALTHY, non-empty Supabase
  // result; an empty Supabase result while localStorage has data is treated as
  // unsafe and the local seed is kept (never blanks). Rollback = flag OFF.
  const employeeDirectory = useEmployeeDirectorySource({
    localEmployees: employees,
    companyId: employeeReadScope,
  });

  useEffect(() => {
    // Only the Supabase path feeds the context state; writes still go exclusively
    // through persistEmployees (localStorage). No dual-write, no authoritative
    // mode — EMP-2 is read-only.
    if (employeeDirectory.source === "supabase") {
      setEmployees(employeeDirectory.employees);
    }
  }, [employeeDirectory.source, employeeDirectory.employees]);

  // TEAM-2 / TEAM-4: reconcile the team directory to a HEALTHY, non-empty
  // Supabase result when the read path is active (authoritative-ON in app
  // builds). Writes still complete against localStorage first (persistTeams);
  // under the authoritative cut-over they are then mirrored to Supabase. An
  // empty Supabase result while localStorage has data is treated as unsafe and
  // the local seed is kept (never blanks). Rollback = flag OFF.
  const teamDirectory = useTeamDirectorySource({
    localTeams: teams,
    companyId: employeeReadScope,
  });

  useEffect(() => {
    if (teamDirectory.source === "supabase") {
      setTeams(teamDirectory.teams);
    }
  }, [teamDirectory.source, teamDirectory.teams]);

  // ROLE-2 / ROLE-4: reconcile the role directory to a HEALTHY, non-empty
  // Supabase result when the read path is active (authoritative-ON in app
  // builds). The Supabase read returns the company's roles PLUS the shared
  // global templates, mirroring the in-memory array's contents. Writes still
  // complete against localStorage first (persistRoles); under the authoritative
  // cut-over they are then mirrored to Supabase. An empty Supabase result while
  // localStorage has data is treated as unsafe and the local seed is kept (never
  // blanks). Rollback = flag OFF.
  const roleDirectory = useRoleDirectorySource({
    localRoles: roles,
    companyId: employeeReadScope,
  });

  useEffect(() => {
    if (roleDirectory.source === "supabase") {
      setRoles(roleDirectory.roles);
    }
  }, [roleDirectory.source, roleDirectory.roles]);

  // USER-2 / USER-4: reconcile the login directory to a HEALTHY, non-empty
  // Supabase result when the read path is active (authoritative-ON in app
  // builds). RLS scopes visibility (company admins see their company's logins;
  // super admins see all incl. platform super-admin globals). Writes still
  // complete against localStorage first (persistUsers); under the authoritative
  // cut-over they are then mirrored to Supabase (password-free). An empty
  // Supabase result while localStorage has data is treated as unsafe and the
  // local seed is kept (never blanks). Rollback = flag OFF.
  const userDirectory = useUserDirectorySource({
    localUsers: users,
    companyId: employeeReadScope,
  });

  useEffect(() => {
    if (userDirectory.source === "supabase") {
      setUsers(userDirectory.users);
    }
  }, [userDirectory.source, userDirectory.users]);

  // TIMECODE-2 / TIMECODE-4: reconcile the time-code directory to a HEALTHY,
  // non-empty Supabase result when the read path is active (authoritative-ON in
  // app builds). The Supabase read returns the company's codes PLUS the shared
  // global master library, mirroring the in-memory array's contents. Writes still
  // complete against localStorage first (persistTimeCodes); under the
  // authoritative cut-over they are then mirrored to Supabase. An empty Supabase
  // result while localStorage has data is treated as unsafe and the local seed is
  // kept (never blanks). Rollback = flag OFF.
  const timeCodeDirectory = useTimeCodeDirectorySource({
    localTimeCodes: timeCodes,
    companyId: employeeReadScope,
  });

  useEffect(() => {
    if (timeCodeDirectory.source === "supabase") {
      setTimeCodes(timeCodeDirectory.timeCodes);
    }
  }, [timeCodeDirectory.source, timeCodeDirectory.timeCodes]);

  // Phase 2A + 2B: reconcile the Module-domain directory from Supabase when the
  // read path is active (authoritative-ON in app builds). A single fetch returns
  // the GLOBAL master catalogue (modules + module categories, world-readable) AND
  // the COMPANY-scoped company_modules availability/enablement config (RLS-scoped
  // to the signed-in user via authNonce). Writes commit to Supabase first then
  // bump the directory refresh so this reconciles the true persisted state.
  const moduleDirectory = useModuleDirectorySource({
    localModules: modules,
    localModuleCategories: moduleCategories,
    localCompanyModules: companyModules,
    authNonce,
  });

  useEffect(() => {
    if (moduleDirectory.source === "supabase") {
      setModules(moduleDirectory.modules);
      setModuleCategories(moduleDirectory.moduleCategories);
      setCompanyModules(moduleDirectory.companyModules);
    }
  }, [
    moduleDirectory.source,
    moduleDirectory.modules,
    moduleDirectory.moduleCategories,
    moduleDirectory.companyModules,
  ]);

  // SVC-2 / SVC-4: reconcile the service catalog to a HEALTHY, non-empty Supabase
  // result when the read path is active (authoritative-ON in app builds). The
  // Supabase read returns the company's services PLUS the shared global catalog,
  // mirroring the in-memory array's contents. Writes still complete against
  // localStorage first (persistServices); under the authoritative cut-over they
  // are then mirrored to Supabase. An empty Supabase result while localStorage
  // has data is treated as unsafe and the local seed is kept (never blanks).
  // Rollback = flag OFF.
  const serviceDirectory = useServiceDirectorySource({
    localServices: services,
    companyId: employeeReadScope,
    authNonce,
  });

  useEffect(() => {
    if (serviceDirectory.source === "supabase") {
      setServices(serviceDirectory.services);
    }
  }, [serviceDirectory.source, serviceDirectory.services]);

  // SVCCAT: reconcile the service-catalog directories (categories / payroll
  // groups / packages) to a HEALTHY, non-empty Supabase result when the read
  // path is active (authoritative-ON in app builds). Categories + payroll groups
  // read the company rows PLUS the shared global catalog; packages are global
  // master data (no scope). Writes still complete against localStorage first;
  // under the authoritative cut-over they are then mirrored to Supabase. An
  // empty Supabase result while localStorage has data is treated as unsafe and
  // the local seed is kept (never blanks). Rollback = flag OFF.
  const serviceCategoryDirectory = useServiceCategoryDirectorySource({
    localCategories: serviceCategories,
    companyId: employeeReadScope,
    authNonce,
  });

  useEffect(() => {
    if (serviceCategoryDirectory.source === "supabase") {
      setServiceCategories(serviceCategoryDirectory.categories);
    }
  }, [serviceCategoryDirectory.source, serviceCategoryDirectory.categories]);

  const payrollGroupDirectory = usePayrollGroupDirectorySource({
    localGroups: payrollGroups,
    companyId: employeeReadScope,
    authNonce,
  });

  useEffect(() => {
    if (payrollGroupDirectory.source === "supabase") {
      setPayrollGroups(payrollGroupDirectory.groups);
    }
  }, [payrollGroupDirectory.source, payrollGroupDirectory.groups]);

  const [servicePackageReloadToken, setServicePackageReloadToken] =
    useState<number>(0);
  const servicePackageDirectory = useServicePackageDirectorySource({
    localPackages: servicePackages,
    authNonce,
    reloadToken: servicePackageReloadToken,
  });

  useEffect(() => {
    if (servicePackageDirectory.source === "supabase") {
      setServicePackages(servicePackageDirectory.packages);
    }
  }, [servicePackageDirectory.source, servicePackageDirectory.packages]);

  // AREA cluster: reconcile the Areas / Postal Cities / Employee Languages
  // directories to a HEALTHY, non-empty Supabase result when the read path is
  // active (authoritative-ON in app builds). All three are company-scoped (no
  // globals). Writes still complete against localStorage first; under the
  // authoritative cut-over they are then mirrored to Supabase. An empty Supabase
  // result while localStorage has data is treated as unsafe and the local seed
  // is kept (never blanks). Rollback = flag OFF.
  const areaDirectory = useAreaDirectorySource({
    localAreas: areas,
    companyId: employeeReadScope,
  });

  useEffect(() => {
    if (areaDirectory.source === "supabase") {
      setAreas(areaDirectory.areas);
    }
  }, [areaDirectory.source, areaDirectory.areas]);

  const postalCityDirectory = usePostalCityDirectorySource({
    localCities: postalCities,
    companyId: employeeReadScope,
  });

  useEffect(() => {
    if (postalCityDirectory.source === "supabase") {
      setPostalCities(postalCityDirectory.cities);
    }
  }, [postalCityDirectory.source, postalCityDirectory.cities]);

  const employeeLanguageDirectory = useEmployeeLanguageDirectorySource({
    localLanguages: employeeLanguages,
    companyId: employeeReadScope,
  });

  useEffect(() => {
    if (employeeLanguageDirectory.source === "supabase") {
      setEmployeeLanguages(employeeLanguageDirectory.languages);
    }
  }, [employeeLanguageDirectory.source, employeeLanguageDirectory.languages]);

  // ENT: reconcile the three entitlement stores (global + company + log) to a
  // HEALTHY Supabase snapshot when the read path is active (authoritative-ON in
  // app builds). Globals are platform-wide (readable to all); company rows are
  // scoped. Writes still complete against localStorage first; under the
  // authoritative cut-over they are then mirrored to Supabase. An empty Supabase
  // result while localStorage has data is treated as unsafe and the local seed is
  // kept (never blanks). Rollback = flag OFF.
  const entitlementSource = useEntitlementSource({
    localGlobals: serviceGlobalEntitlements,
    localCompanies: companyServiceEntitlements,
    localLog: serviceEntitlementLog,
    companyId: employeeReadScope,
  });

  useEffect(() => {
    if (entitlementSource.source === "supabase") {
      setServiceGlobalEntitlements(entitlementSource.globals);
      setCompanyServiceEntitlements(entitlementSource.companies);
      setServiceEntitlementLog(entitlementSource.log);
    }
  }, [
    entitlementSource.source,
    entitlementSource.globals,
    entitlementSource.companies,
    entitlementSource.log,
  ]);

  // ACTIVITY: reconcile the audit trail to a HEALTHY, non-empty Supabase result
  // when the read path is active (authoritative-ON in app builds). The trail is
  // company-scoped (platform-level events for super admins). Appends still
  // complete against localStorage first; under the authoritative cut-over they
  // are then mirrored (append-only) to Supabase. An empty Supabase result while
  // localStorage has data is treated as unsafe and the local seed is kept (never
  // blanks). Rollback = flag OFF.
  const activitySource = useActivitySource({
    localEvents: auditEvents,
    companyId: employeeReadScope,
  });

  useEffect(() => {
    if (activitySource.source === "supabase") {
      setAuditEvents(activitySource.events);
    }
  }, [activitySource.source, activitySource.events]);

  // BQ: reconcile the raw Booking Queue to Supabase when the read path is active
  // (authoritative-ON in app builds). Company-scoped (no globals). Writes still
  // complete against localStorage first; under the authoritative cut-over they
  // are then mirrored to Supabase. Clean successful empty Supabase reads are
  // authoritative and stay empty; local backout rows are temporary technical debt
  // visible only on read errors or an explicit unsafe migration bridge. The
  // AppContext's syncBookingItem re-derivation + access filtering still run on
  // top, so the source swap stays transparent. Rollback = flag OFF.
  const bookingQueueDirectory = useBookingQueueDirectorySource({
    localItems: bookingQueue,
    companyId: employeeReadScope,
  });

  useEffect(() => {
    if (bookingQueueDirectory.source === "supabase") {
      setBookingQueue(bookingQueueDirectory.items);
    }
  }, [bookingQueueDirectory.source, bookingQueueDirectory.items]);

  // SET: reconcile the Settings stores to a HEALTHY, non-empty Supabase result
  // when the read path is active. settings_templates is GLOBAL master data (no
  // scope); company_settings is company-scoped. Writes still complete against
  // localStorage first; under the authoritative cut-over they are then mirrored
  // to Supabase. An empty Supabase result while localStorage has data is treated
  // as unsafe and the local seed is kept (never blanks). Rollback = flag OFF.
  const settingsTemplateDirectory = useSettingsTemplateDirectorySource({
    localTemplates: settingsTemplates,
  });

  useEffect(() => {
    if (settingsTemplateDirectory.source === "supabase") {
      setSettingsTemplates(settingsTemplateDirectory.templates);
    }
  }, [settingsTemplateDirectory.source, settingsTemplateDirectory.templates]);

  const companySettingsDirectory = useCompanySettingsDirectorySource({
    localSettings: companySettings,
    companyId: employeeReadScope,
  });

  useEffect(() => {
    if (companySettingsDirectory.source === "supabase") {
      setCompanySettings(companySettingsDirectory.settings);
    }
  }, [companySettingsDirectory.source, companySettingsDirectory.settings]);

  // SYSSET: reconcile the SINGLETON global System Settings record to the Supabase
  // copy when the read path is active. Writes still complete against localStorage
  // first; under the authoritative cut-over they are then mirrored to Supabase.
  // If Supabase has no row yet (pre-migration) the local seed is kept (never
  // blanks). Rollback = flag OFF.
  const systemSettingsSource = useSystemSettingsSource({ localSettings: systemSettings });

  useEffect(() => {
    if (systemSettingsSource.source === "supabase") {
      setSystemSettings(systemSettingsSource.settings);
    }
  }, [systemSettingsSource.source, systemSettingsSource.settings]);

  const persistCustomers = useCallback((next: Customer[]) => {
    // localStorage is written first, synchronously. Under Wave 1F authoritative
    // mode it is the BACKOUT copy (Supabase is authoritative); otherwise it is
    // the sole source of truth. Either way the local write never blocks/fails
    // on Supabase, keeping rollback instant and data-free.
    const stopLocal = perf.start("customer.write.local");
    // Snapshot the previous persisted state BEFORE overwriting (the mirror needs
    // the prev→next diff). getCustomers() reads the soon-to-be-replaced
    // localStorage value, so it must run before saveCustomers().
    const mirror = shouldRunBrowserDomainMirror(shouldMirrorWrites());
    const prev = mirror ? getCustomers() : null;
    setCustomers(next);
    saveCustomers(next);
    stopLocal();
    // Wave 1D (dual-write) / Wave 1F (authoritative): mirror the write into
    // Supabase. Fire-and-forget — a Supabase failure can never affect the
    // customer operation. Under authoritative mode the mirror is the
    // authoritative write, so failures are escalated as cut-over failures
    // (surfaced, never silent). Rollback = flag OFF.
    if (prev) {
      // Route through the per-customer ordered queue so a quick create+delete on
      // the SAME new customer mirrors in FIFO order (create upsert commits before
      // the soft-delete UPDATE runs), preventing the "delete needs two clicks"
      // race. Different customers still mirror concurrently. Fire-and-forget.
      void enqueueCustomerMirror(prev, next).then((result) => {
        // The soft-delete UPDATE has now committed. We do NOT clear the optimistic
        // delete tombstone here: the list re-read triggered by the local delete
        // can race ahead of the commit and return the row as still active. Instead
        // we bump the reconcile signal so the list hook issues a fresh read AFTER
        // the commit; the tombstone is cleared only once that read confirms the
        // row is gone (a bounded max-age fallback clears it even if all else fails).
        if (result.diff.removed.length > 0) {
          bumpCustomerListReconcile();
        }
        if (isCustomerSupabaseAuthoritative() && !result.ok) {
          const refs = [...result.diff.created, ...result.diff.updated];
          const ref = refs[0] ?? "*";
          const message =
            result.error ??
            (result.skipped.length > 0
              ? result.skipped[0].reason
              : `${result.mismatches.length} post-write mismatch(es)`);
          recordCutoverFailure("write.mirror", ref, message);
        }
      });
    }
  }, []);

  const persistWorkOrders = useCallback((next: WorkOrder[]) => {
    // localStorage is written first, synchronously — the single source of truth
    // for WO-5 (dual-write). The local write never blocks/fails on Supabase, so
    // rollback stays instant and data-free (flag OFF).
    const stopLocal = perf.start("workOrders.write.local");
    // Snapshot the previous persisted state BEFORE overwriting (the mirror needs
    // the prev→next diff). getWorkOrders() reads the soon-to-be-replaced
    // localStorage value, so it must run before saveWorkOrders().
    const mirror = shouldRunBrowserDomainMirror(shouldMirrorWorkOrderWrites());
    const prev = mirror ? getWorkOrders() : null;
    setWorkOrders(next);
    saveWorkOrders(next);
    stopLocal();
    // WO-5 dual-write: mirror the parent + service rows into Supabase in the
    // background. Fire-and-forget — a Supabase failure can never affect the
    // work-order operation. Under WO-6 authoritative mode the mirror is the
    // authoritative write (localStorage is the backout copy), so failures are
    // escalated as cut-over failures (surfaced, never silent). Rollback = flag OFF.
    if (prev) {
      void mirrorWorkOrderWrites(prev, next).then((result) => {
        if (isWorkOrderSupabaseAuthoritative() && !result.ok) {
          const refs = [...result.diff.created, ...result.diff.updated, ...result.diff.removed];
          const ref = refs[0] ?? "*";
          const message =
            result.error ??
            (result.skipped.length > 0
              ? result.skipped[0].reason
              : `${result.mismatches.length} post-write mismatch(es)`);
          recordWorkOrderCutoverFailure("write.mirror", ref, message);
        }
      });
    }
  }, []);

  const persistWorkOrderSettings = useCallback((next: WorkOrderSettings[]) => {
    setWorkOrderSettings(next);
    saveWorkOrderSettings(next);
  }, []);

  const persistTimeReportSettings = useCallback((next: TimeReportSettings[]) => {
    setTimeReportSettings(next);
    saveTimeReportSettings(next);
  }, []);

  const persistDurationSettings = useCallback((next: DurationSettings[]) => {
    setDurationSettings(next);
    saveDurationSettings(next);
  }, []);

  const persistTimeReports = useCallback((next: TimeReport[]) => {
    setTimeReports(next);
    saveTimeReports(next);
  }, []);

  const persistBookingQueue = useCallback((next: BookingQueueItem[]) => {
    // localStorage first (source of truth / backout copy). Under the BQ
    // dual-write or authoritative cut-over the change is then mirrored into the
    // Supabase `booking_queue` table fire-and-forget — a Supabase failure can
    // never affect the queue operation. getBookingQueue() reads the
    // soon-to-be-replaced value, so it must run before saveBookingQueue().
    const mirror = shouldRunBrowserDomainMirror(shouldMirrorBookingQueueWrites());
    const prev = mirror ? getBookingQueue() : null;
    setBookingQueue(next);
    saveBookingQueue(next);
    if (prev) {
      void mirrorBookingQueueWrites(prev, next).then((result) => {
        bumpBookingQueueDirectoryRefreshAfterSuccessfulMirror(result);
        if (isBookingQueueSupabaseAuthoritative() && !result.ok) {
          const refs = [...result.diff.created, ...result.diff.updated, ...result.diff.removed];
          const ref = refs[0] ?? "*";
          const message =
            result.error ??
            (result.skipped.length > 0
              ? result.skipped[0].reason
              : `${result.mismatches.length} post-write mismatch(es)`);
          recordBookingQueueReadFallback(ref, message);
        }
      });
    }
  }, []);

  const persistBookingOccurrenceExceptions = useCallback(
    (next: BookingOccurrenceException[]) => {
      // localStorage first (source of truth). WO-5 dual-write mirrors the
      // SEPARATE occurrence-exception store into Supabase fire-and-forget.
      const mirror = shouldRunBrowserDomainMirror(shouldMirrorWorkOrderWrites());
      const prev = mirror ? getBookingOccurrenceExceptions() : null;
      setBookingOccurrenceExceptions(next);
      saveBookingOccurrenceExceptions(next);
      // WO-6: under authoritative mode the exception mirror is authoritative;
      // escalate failures as cut-over failures (surfaced, never silent).
      if (prev) {
        void mirrorWorkOrderExceptionWrites(prev, next).then((result) => {
          if (isWorkOrderSupabaseAuthoritative() && !result.ok) {
            const refs = [...result.diff.created, ...result.diff.updated, ...result.diff.removed];
            const ref = refs[0] ?? "*";
            const message =
              result.error ??
              (result.skipped.length > 0
                ? result.skipped[0].reason
                : "exception mirror failed");
            recordWorkOrderCutoverFailure("write.mirror", ref, message);
          }
        });
      }
    },
    [],
  );

  const persistTeams = useCallback((next: Team[]) => {
    // localStorage is written first, synchronously. Under the TEAM-4
    // authoritative cut-over it is the BACKOUT copy (Supabase is authoritative);
    // otherwise it is the sole source of truth. Either way the local write never
    // blocks/fails on Supabase, keeping rollback instant and data-free.
    const mirror = shouldRunBrowserDomainMirror(shouldMirrorTeamWrites());
    const prev = mirror ? getTeams() : null;
    setTeams(next);
    saveTeams(next);
    // TEAM-3 (dual-write) / TEAM-4 (authoritative): mirror the write into
    // Supabase. Fire-and-forget — a Supabase failure can never affect the team
    // operation. Removals soft-delete the Supabase row (removal propagation).
    if (mirror && prev) {
      void mirrorTeamWrites(prev, next);
    }
  }, []);

  const persistModules = useCallback((next: Module[]) => {
    setModules(next);
    saveModules(next);
  }, []);

  const persistCompanyModules = useCallback((next: CompanyModuleSetting[]) => {
    setCompanyModules(next);
    saveCompanyModules(next);
  }, []);

  const persistModuleCategories = useCallback((next: ModuleCategory[]) => {
    setModuleCategories(next);
    saveModuleCategories(next);
  }, []);

  const persistRoles = useCallback((next: Role[]) => {
    // localStorage is written first, synchronously. Under the ROLE-4
    // authoritative cut-over it is the BACKOUT copy (Supabase is authoritative);
    // otherwise it is the sole source of truth. Either way the local write never
    // blocks/fails on Supabase, keeping rollback instant and data-free.
    const mirror = shouldRunBrowserDomainMirror(shouldMirrorRoleWrites());
    const prev = mirror ? getRoles() : null;
    setRoles(next);
    saveRoles(next);
    // ROLE-3 (dual-write) / ROLE-4 (authoritative): mirror the write into
    // Supabase. Fire-and-forget — a Supabase failure can never affect the role
    // operation. Removals soft-delete the Supabase row (removal propagation).
    if (mirror && prev) {
      void mirrorRoleWrites(prev, next);
    }
  }, []);

  const persistChecklistTemplates = useCallback((next: ChecklistTemplate[]) => {
    setChecklistTemplates(next);
    saveChecklistTemplates(next);
  }, []);

  const persistChecklistAdoptions = useCallback((next: ChecklistTemplateAdoption[]) => {
    setChecklistAdoptions(next);
    saveChecklistAdoptions(next);
  }, []);

  const persistCustomerProtocols = useCallback((next: CustomerProtocol[]) => {
    setCustomerProtocols(next);
    saveCustomerProtocols(next);
  }, []);

  const persistLibraryRooms = useCallback((next: LibraryRoom[]) => {
    setLibraryRooms(next);
    saveLibraryRooms(next);
  }, []);

  const persistLibraryTasks = useCallback((next: LibraryTask[]) => {
    setLibraryTasks(next);
    saveLibraryTasks(next);
  }, []);

  const persistSettingsTemplates = useCallback((next: SettingsTemplate[]) => {
    // localStorage first (source of truth / backout copy). Under the SET
    // dual-write or authoritative cut-over the change is then mirrored into the
    // Supabase `settings_templates` table fire-and-forget.
    const mirror = shouldRunBrowserDomainMirror(shouldMirrorSettingsTemplateWrites());
    const prev = mirror ? getSettingsTemplates() : null;
    setSettingsTemplates(next);
    saveSettingsTemplates(next);
    if (prev) void mirrorSettingsTemplateWrites(prev, next);
  }, []);

  const persistCompanySettings = useCallback((next: CompanySettings[]) => {
    // localStorage first (source of truth / backout copy). Under the SET
    // dual-write or authoritative cut-over the change is then mirrored into the
    // Supabase `company_settings` table fire-and-forget.
    const mirror = shouldRunBrowserDomainMirror(shouldMirrorCompanySettingsWrites());
    const prev = mirror ? getCompanySettings() : null;
    setCompanySettings(next);
    saveCompanySettings(next);
    if (prev) void mirrorCompanySettingsWrites(prev, next);
  }, []);

  /**
   * The mirror writer scope for the signed-in user. A super_admin may mirror
   * global + any company scope; everyone else is restricted to their own
   * company so cross-scope rows read from Supabase can't poison their batch.
   */
  const getMirrorWriterScope = useCallback(():
    | { companyId: string | null; isSuperAdmin: boolean }
    | undefined => {
    if (!currentUser) return undefined;
    const isSuperAdmin = currentUser.role === "super_admin";
    return {
      isSuperAdmin,
      companyId: isSuperAdmin ? null : currentUser.companyId ?? null,
    };
  }, [currentUser]);

  const persistServiceCategories = useCallback((next: ServiceCategory[]) => {
    // localStorage first (backout copy under the SVCCAT authoritative cut-over).
    const mirror = shouldRunBrowserDomainMirror(shouldMirrorServiceCategoryWrites());
    const prev = mirror ? getServiceCategories() : null;
    setServiceCategories(next);
    saveServiceCategories(next);
    // SVCCAT dual-write / authoritative: mirror into Supabase, fire-and-forget.
    // Global categories (companyId === null) mirror with company_id = null;
    // removals soft-delete the Supabase row. The writer scope excludes rows the
    // current user cannot upsert under RLS so they can't poison the batch.
    if (mirror && prev) {
      void mirrorServiceCategoryWrites(prev, next, getMirrorWriterScope());
    }
  }, [getMirrorWriterScope]);

  const persistServices = useCallback((next: Service[]) => {
    // localStorage is written first, synchronously. Under the SVC-4 authoritative
    // cut-over it is the BACKOUT copy (Supabase is authoritative); otherwise it is
    // the sole source of truth. Either way the local write never blocks/fails on
    // Supabase, keeping rollback instant and data-free.
    const mirror = shouldRunBrowserDomainMirror(shouldMirrorServiceWrites());
    const prev = mirror ? getServices() : null;
    setServices(next);
    saveServices(next);
    // SVC-3 (dual-write) / SVC-4 (authoritative): mirror the write into Supabase.
    // Fire-and-forget — a Supabase failure can never affect the service
    // operation. Removals soft-delete the Supabase row (removal propagation).
    // Global services (companyId === null) mirror with company_id = null. The
    // writer scope excludes rows the current user cannot upsert under RLS so they
    // can't poison the batch.
    if (mirror && prev) {
      void mirrorServiceWrites(prev, next, getMirrorWriterScope());
    }
  }, [getMirrorWriterScope]);

  const persistTimeCodes = useCallback((next: TimeCode[]) => {
    // localStorage is written first, synchronously. Under the TIMECODE-4
    // authoritative cut-over it is the BACKOUT copy (Supabase is authoritative);
    // otherwise it is the sole source of truth. Either way the local write never
    // blocks/fails on Supabase, keeping rollback instant and data-free.
    const mirror = shouldRunBrowserDomainMirror(shouldMirrorTimeCodeWrites());
    const prev = mirror ? getTimeCodes() : null;
    setTimeCodes(next);
    saveTimeCodes(next);
    // TIMECODE-3 (dual-write) / TIMECODE-4 (authoritative): mirror the write into
    // Supabase. Fire-and-forget — a Supabase failure can never affect the
    // time-code operation. Removals soft-delete the Supabase row (removal
    // propagation). Global codes (companyId === null) mirror with company_id null.
    if (mirror && prev) {
      void mirrorTimeCodeWrites(prev, next);
    }
  }, []);

  const persistPayrollExportCapabilities = useCallback(
    (next: PayrollExportCapability[]) => {
      setPayrollExportCapabilities(next);
      savePayrollExportCapabilities(next);
    },
    [],
  );

  const persistPayrollExportProfiles = useCallback((next: PayrollExportProfile[]) => {
    setPayrollExportProfiles(next);
    savePayrollExportProfiles(next);
  }, []);

  const persistPayrollExportRuns = useCallback((next: PayrollExportRun[]) => {
    setPayrollExportRuns(next);
    savePayrollExportRuns(next);
  }, []);

  const persistServicePackages = useCallback((next: ServicePackage[]) => {
    const mirror = shouldRunBrowserDomainMirror(shouldMirrorServicePackageWrites());
    const prev = mirror ? getServicePackages() : null;
    setServicePackages(next);
    saveServicePackages(next);
    // SVCCAT dual-write / authoritative: packages are global master data, so the
    // mirror never needs a company mapping; removals soft-delete the row.
    if (mirror && prev) {
      void mirrorServicePackageWrites(prev, next);
    }
  }, []);

  const persistServiceFavorites = useCallback((next: CompanyServiceFavorite[]) => {
    setServiceFavorites(next);
    saveServiceFavorites(next);
  }, []);

  const persistCompanies = useCallback((next: Company[]) => {
    setCompanies(next);
    saveCompanies(next);
  }, []);

  // Step 2A (read-only): when USE_SUPABASE_COMPANIES is on, refresh the in-memory
  // companies list from Supabase. This never writes to Supabase or localStorage;
  // it only swaps the rendered companies, and falls back to localStorage on any
  // failure (handled inside getCompaniesFromSupabase). Default flag is false, so
  // this effect is a no-op for the current prototype.
  useEffect(() => {
    if (!USE_SUPABASE_COMPANIES) return;
    let active = true;
    void getCompaniesFromSupabase().then(({ companies: fetched, source }) => {
      if (!active) return;
      if (source === "supabase") {
        setCompanies(fetched);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const persistUsers = useCallback((next: User[]) => {
    // localStorage is written first, synchronously. Under the USER-4
    // authoritative cut-over it is the BACKOUT copy (Supabase is authoritative);
    // otherwise it is the sole source of truth. Either way the local write never
    // blocks/fails on Supabase, keeping rollback instant and data-free. Only the
    // PASSWORD-FREE login record is mirrored (getUsers strips passwords).
    const mirror = shouldRunBrowserDomainMirror(shouldMirrorUserWrites());
    const prev = mirror ? getUsers() : null;
    setUsers(next);
    saveUsers(next);
    // USER-3 (dual-write) / USER-4 (authoritative): mirror the write into
    // Supabase. Fire-and-forget — a Supabase failure can never affect the login
    // operation. Removals soft-delete the Supabase row (removal propagation).
    if (mirror && prev) {
      void mirrorUserWrites(prev, next);
    }
  }, []);

  const login = useCallback<AppContextValue["login"]>(async (email, password) => {
    // Supabase-gated path: while EXPO_PUBLIC_USE_SUPABASE_AUTH is on we attempt
    // Supabase Auth first so eligible admins (active super_admin, or active
    // company_admin bound to a company) get a real Supabase session and token.
    // Eligibility is decided by the authenticated profile, not an email list.
    // It fails closed for security rejections (inactive / missing / misconfigured)
    // and only falls back to localStorage for unrecognised credentials or
    // non-admin roles that still use the legacy path.
    const willAttemptSupabaseAuth = shouldAttemptSupabaseAuth(email);
    // Decisive runtime trace: shows whether the Supabase Auth layer is live and
    // whether this login will even try it. If supabaseAuthEnabled is false, no
    // Supabase session can ever be created and protected Edge Functions will
    // always see an anonymous caller (base_role/status/company_id = none).
    // eslint-disable-next-line no-console
    console.info("[auth.login] path diagnostics", {
      supabaseAuthEnabled: isSupabaseAuthEnabled,
      willAttemptSupabaseAuth,
    });
    if (willAttemptSupabaseAuth) {
      const { user: supaUser, error, fallbackToLocal } = await loginWithSupabase(
        email,
        password,
      );
      if (supaUser) {
        // eslint-disable-next-line no-console
        console.info(
          "[auth.login] Supabase Auth session established — protected Edge Functions will receive a real token.",
          { role: supaUser.role },
        );
        // The Supabase client persists its own session; we deliberately do NOT
        // write the localStorage session id (that store only knows local users).
        setIsAuthRestoring(false);
        setCurrentUser(supaUser);
        appendAudit({
          actorId: supaUser.id,
          actorName: supaUser.name,
          actorRole: supaUser.role,
          companyId: supaUser.companyId,
          action: "auth.login",
          summary: `${supaUser.name} signed in via Supabase Auth.`,
        });
        return { ok: true };
      }
      // Security rejection — do not retry via localStorage.
      if (!fallbackToLocal) {
        return { ok: false, error: error ?? "Unable to sign in." };
      }
      // eslint-disable-next-line no-console
      console.warn(
        "[auth.login] Supabase Auth did not establish a session — falling back to " +
          "localStorage. Protected Supabase Edge Functions (e.g. admin-create-user) " +
          "will be UNAVAILABLE for this session because no real token is sent.",
        { reason: error },
      );
      // Otherwise fall through to the localStorage path below.
    }

    // Default localStorage path — used for employees and customers only.
    const user = authenticate(email, password);
    if (!user) {
      return { ok: false, error: "Invalid email or password, or account is inactive." };
    }
    // Admin roles are no longer allowed to authenticate via localStorage. They
    // MUST have a provisioned Supabase Auth identity (auth.users + active
    // profiles row) so protected Edge Functions receive a real session token.
    // Demo/legacy admin accounts that exist only in localStorage are rejected
    // here with a clear, actionable message.
    if (user.role === "super_admin" || user.role === "company_admin") {
      // eslint-disable-next-line no-console
      console.warn(
        "[auth.login] Admin login rejected on the localStorage path — this admin " +
          "is not provisioned in Supabase Authentication (no auth.users + active " +
          "profile). Admins cannot use the legacy demo path.",
        { role: user.role, supabaseAuthEnabled: isSupabaseAuthEnabled },
      );
      return {
        ok: false,
        error:
          "This administrator account has not been provisioned in Supabase " +
          "Authentication. Please contact a Super Admin.",
      };
    }
    setIsAuthRestoring(false);
    setSessionUserId(user.id);
    setCurrentUser(user);
    appendAudit({
      actorId: user.id,
      actorName: user.name,
      actorRole: user.role,
      companyId: user.companyId,
      action: "auth.login",
      summary: `${user.name} signed in.`,
    });
    return { ok: true };
  }, [appendAudit]);

  const logout = useCallback(() => {
    if (currentUser) {
      appendAudit({
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.role,
        companyId: currentUser.companyId,
        action: "auth.logout",
        summary: `${currentUser.name} signed out.`,
      });
    }
    setIsAuthRestoring(false);
    setSessionUserId(null);
    setCurrentUser(null);
    setImpersonatedUser(null);
    setViewAsCustomerId(null);
    setViewAsEmployeeId(null);
    // Tear down any Supabase Auth session too (no-op when the layer is dormant).
    void supabaseSignOut();
  }, [appendAudit, currentUser]);

  // Restore a previously authenticated Supabase admin session on app load.
  // Skip email-link routes: invite/recovery sessions are intentionally temporary
  // until their page validates the link and sets the password. The normal admin
  // restore path would reject employee invite sessions and sign them out too early.
  useEffect(() => {
    let active = true;
    if (!isAuthRestoring) return;
    void restoreSupabaseSession()
      .then((restored) => {
        if (active && restored) setCurrentUser(restored);
      })
      .catch((error: unknown) => {
        console.warn("[auth.restore] Supabase session restore failed.", {
          message: error instanceof Error ? error.message : "Unknown restore error.",
        });
      })
      .finally(() => {
        if (active) setIsAuthRestoring(false);
      });
    return () => {
      active = false;
    };
  }, [isAuthRestoring]);

  const completeOnboardingLogin = useCallback<
    AppContextValue["completeOnboardingLogin"]
  >(async () => {
    // Onboarding-only path: the invitee has just set their password through a
    // valid recovery session, so the Supabase session is now fully authenticated.
    // Hydrate it straight into `currentUser` (any active role, employees included)
    // so they land in the app without a second trip through the /login gate.
    const user = await hydrateSessionAfterPasswordSet();
    if (!user) return null;
    // Supabase persists its own session; we deliberately do NOT write the
    // localStorage session id (that store only knows local users), mirroring the
    // admin Supabase-login path.
    setCurrentUser(user);
    appendAudit({
      actorId: user.id,
      actorName: user.name,
      actorRole: user.role,
      companyId: user.companyId,
      action: "auth.login",
      summary: `${user.name} signed in after setting their password.`,
    });
    return user;
  }, [appendAudit]);

  const requestReset = useCallback((email: string) => createResetToken(email), []);

  const resetPassword = useCallback(
    (token: string, password: string) => {
      const ok = consumeResetToken(token, password);
      if (ok) {
        appendAudit({
          actorId: null,
          actorName: "System",
          actorRole: "super_admin",
          companyId: null,
          action: "auth.password_reset",
          summary: "A password was reset via a reset link.",
        });
      }
      return ok;
    },
    [appendAudit],
  );

  const createCompany = useCallback<AppContextValue["createCompany"]>(
    async (name, status) => {
      const legacyId = makeId("cmp");
      let company: Company = {
        id: legacyId,
        name: name.trim(),
        status,
        createdAt: new Date().toISOString(),
      };

      // Supabase is the source of truth when the flag is on. Write there FIRST;
      // if it fails, surface the error and provision nothing locally, so the UI
      // never shows a company that won't survive a refresh.
      if (USE_SUPABASE_COMPANIES) {
        const result = await createCompanyInSupabase({
          legacyId,
          name: company.name,
          status,
        });
        if (!result.ok) {
          return result;
        }
        company = result.company;
      }

      const createdAt = company.createdAt;
      persistCompanies([company, ...companies]);
      // Provision the company's built-in roles so its admin can manage access.
      const companyRoles: Role[] = (
        ["company_admin", "employee", "customer"] as UserRole[]
      ).map((r) => ({
        id: systemRoleId(r, company.id),
        name: ROLE_LABELS[r],
        description: `Built-in ${ROLE_LABELS[r]} role.`,
        companyId: company.id,
        isSystem: true,
        baseRole: r,
        permissions: [...DEFAULT_ROLE_PERMISSIONS[r]],
        createdAt,
      }));
      persistRoles([...roles, ...companyRoles]);
      // Offer every module to the new company, enabled by default.
      const newSettings: CompanyModuleSetting[] = MODULE_DEFINITIONS.map((def) => ({
        companyId: company.id,
        moduleId: def.id,
        available: true,
        enabled: true,
      }));
      persistCompanyModules([...companyModules, ...newSettings]);
      logAudit("company.create", `Created company “${company.name}”.`, company.id);
      return { ok: true, company };
    },
    [companies, persistCompanies, roles, persistRoles, companyModules, persistCompanyModules, logAudit],
  );

  const updateCompany = useCallback<AppContextValue["updateCompany"]>(
    async (id, patch) => {
      const target = companies.find((c) => c.id === id);

      // Persist to Supabase first when enabled; bail out on failure so local
      // state and the database can't drift apart.
      if (USE_SUPABASE_COMPANIES) {
        const result = await updateCompanyInSupabase(id, patch);
        if (!result.ok) {
          return result;
        }
      }

      persistCompanies(companies.map((c) => (c.id === id ? { ...c, ...patch } : c)));
      if (target) {
        const what =
          patch.status && patch.status !== target.status
            ? `${patch.status === "active" ? "Activated" : "Deactivated"} company “${target.name}”.`
            : `Updated company “${target.name}”.`;
        logAudit("company.update", what, id);
      }
      return { ok: true };
    },
    [companies, persistCompanies, logAudit],
  );

  const createUser = useCallback<AppContextValue["createUser"]>(
    async (input) => {
      // Tenant isolation: non-platform admins can only create users in their company.
      if (currentUser && !inCompanyScope(currentUser, input.companyId)) {
        return { ok: false, error: FORBIDDEN_MESSAGE };
      }
      // Security boundary: only a Super Admin may create another Super Admin.
      if (input.role === "super_admin" && currentUser?.role !== "super_admin") {
        return { ok: false, error: FORBIDDEN_MESSAGE };
      }

      // Canonical path (flag on): create a real Supabase Auth user via the
      // service_role-only Edge Function. The 0004 trigger provisions the
      // matching profile in the same transaction. Duplicate emails and rollback
      // are handled server-side; we only mirror a successful result into the
      // in-memory list so the UI updates immediately.
      if (ENABLE_USER_CREATION) {
        const tempPassword = input.tempPassword?.trim() || null;
        const result = await createSupabaseUser({
          email: input.email.trim().toLowerCase(),
          baseRole: input.role,
          companyId: input.companyId,
          fullName: input.name.trim() || null,
          tempPassword,
          redirectTo: tempPassword ? null : inviteRedirectUrl(),
        });
        if (!result.ok) {
          return {
            ok: false,
            error: result.error ?? "Unable to create user.",
            functionVersion: result.functionVersion ?? null,
            authMode: result.authMode,
          };
        }
        const createdEmail = input.email.trim();
        const user: User = {
          id: result.userId ?? makeId("usr"),
          name: input.name.trim(),
          email: createdEmail,
          role: input.role,
          companyId: input.companyId,
          status: "active",
          createdAt: new Date().toISOString(),
          areaScope: input.areaScope,
        };
        persistUsers([
          user,
          ...users.filter(
            (u) =>
              u.id !== user.id &&
              u.email.toLowerCase() !== createdEmail.toLowerCase(),
          ),
        ]);
        logAudit(
          "user.create",
          `Created user “${user.name}” (${ROLE_LABELS[user.role]}) via Supabase.`,
          user.companyId,
        );
        // A new profile now exists globally — refresh the shared directory roster
        // so the new login appears on every directory surface immediately. Also
        // refresh the Staff ID lookups so the Edge Function-issued Staff ID shows
        // on the Employees/Team page right away instead of "—" until a hard refresh.
        void queryClient.invalidateQueries({ queryKey: DIRECTORY_PROFILES_QUERY_KEY });
        void queryClient.invalidateQueries({ queryKey: ASSIGNED_USERS_ROSTER_QUERY_KEY });
        void queryClient.invalidateQueries({ queryKey: EMPLOYEE_STAFF_NUMBERS_QUERY_KEY });
        return {
          ok: true,
          functionVersion: result.functionVersion ?? null,
          authMode: result.authMode,
          userId: user.id,
        };
      }

      // Legacy localStorage path (flag off): unchanged behavior.
      const email = input.email.trim().toLowerCase();
      if (users.some((u) => u.email.toLowerCase() === email)) {
        return { ok: false, error: "A user with this email already exists." };
      }
      const user: User = {
        id: makeId("usr"),
        name: input.name.trim(),
        email: input.email.trim(),
        role: input.role,
        companyId: input.companyId,
        status: "active",
        createdAt: new Date().toISOString(),
        areaScope: input.areaScope,
      };
      persistUsers([user, ...users]);
      logAudit("user.create", `Created user “${user.name}” (${ROLE_LABELS[user.role]}).`, user.companyId);
      return { ok: true, userId: user.id };
    },
    [users, persistUsers, currentUser, logAudit, queryClient],
  );

  const updateUser = useCallback<AppContextValue["updateUser"]>(
    (id, patch) => {
      const target = users.find((u) => u.id === id);
      if (!target) return { ok: false, error: "User not found." };
      // Tenant isolation: only act on users within the actor's company scope.
      if (currentUser && !inCompanyScope(currentUser, target.companyId)) {
        return { ok: false, error: FORBIDDEN_MESSAGE };
      }
      if (patch.email) {
        const email = patch.email.trim().toLowerCase();
        if (users.some((u) => u.id !== id && u.email.toLowerCase() === email)) {
          return { ok: false, error: "A user with this email already exists." };
        }
      }
      const next = users.map((u) => (u.id === id ? { ...u, ...patch } : u));
      persistUsers(next);
      if (currentUser?.id === id) {
        setCurrentUser((prev) => (prev ? { ...prev, ...patch } : prev));
      }
      const what =
        patch.status && patch.status !== target.status
          ? `${patch.status === "active" ? "Activated" : "Deactivated"} user “${target.name}”.`
          : `Updated user “${target.name}”.`;
      logAudit("user.update", what, target.companyId);
      return { ok: true };
    },
    [users, persistUsers, currentUser, logAudit],
  );

  const createRole = useCallback<AppContextValue["createRole"]>(
    (input) => {
      const name = input.name.trim();
      if (!name) return { ok: false, error: "Role name is required." };
      const clash = roles.some(
        (r) =>
          r.companyId === input.companyId &&
          r.name.trim().toLowerCase() === name.toLowerCase(),
      );
      if (clash) return { ok: false, error: "A role with this name already exists." };
      const role: Role = {
        id: makeId("role"),
        name,
        description: input.description.trim(),
        companyId: input.companyId,
        isSystem: false,
        baseRole: input.baseRole,
        permissions: input.permissions,
        createdAt: new Date().toISOString(),
      };
      persistRoles([...roles, role]);
      logAudit("role.create", `Created role “${role.name}”.`, role.companyId);
      return { ok: true, role };
    },
    [roles, persistRoles, logAudit],
  );

  const updateRole = useCallback<AppContextValue["updateRole"]>(
    (id, patch) => {
      const target = roles.find((r) => r.id === id);
      if (!target) return { ok: false, error: "Role not found." };
      if (patch.name) {
        const name = patch.name.trim();
        const clash = roles.some(
          (r) =>
            r.id !== id &&
            r.companyId === target.companyId &&
            r.name.trim().toLowerCase() === name.toLowerCase(),
        );
        if (clash) return { ok: false, error: "A role with this name already exists." };
      }
      persistRoles(roles.map((r) => (r.id === id ? { ...r, ...patch } : r)));
      logAudit("role.update", `Updated role “${target.name}”.`, target.companyId);
      return { ok: true };
    },
    [roles, persistRoles, logAudit],
  );

  const deleteRole = useCallback<AppContextValue["deleteRole"]>(
    (id) => {
      const target = roles.find((r) => r.id === id);
      if (!target) return { ok: false, error: "Role not found." };
      if (target.isSystem) return { ok: false, error: "Built-in roles can't be deleted." };
      const inUse = users.some((u) => u.roleId === id);
      if (inUse) {
        return { ok: false, error: "Reassign users before deleting this role." };
      }
      persistRoles(roles.filter((r) => r.id !== id));
      logAudit("role.delete", `Deleted role “${target.name}”.`, target.companyId);
      return { ok: true };
    },
    [roles, users, persistRoles, logAudit],
  );

  const assignUserRole = useCallback<AppContextValue["assignUserRole"]>(
    (userId, roleId) => {
      const role = roles.find((r) => r.id === roleId);
      // Security boundary: only a Super Admin may grant the Super Admin role.
      // Enforced at the write path so a crafted call can't bypass the UI filter.
      if (role && !canAssignRole(currentUser?.role, role)) return;
      // Prevent duplicate assignment: if the user already holds this role (via an
      // explicit roleId OR the matching built-in role for their base role), there
      // is nothing to write. This keeps the handler in agreement with the shared
      // matcher the UI uses to render “Assigned”.
      const target = users.find((u) => u.id === userId);
      if (role && target && userHoldsRole(role, target)) return;
      const next = users.map((u) =>
        u.id === userId
          ? { ...u, roleId, role: role?.baseRole ?? u.role }
          : u,
      );
      persistUsers(next);
      if (currentUser?.id === userId) {
        setCurrentUser((prev) =>
          prev ? { ...prev, roleId, role: role?.baseRole ?? prev.role } : prev,
        );
      }
      const targetUser = users.find((u) => u.id === userId);
      if (targetUser && role) {
        logAudit("role.assign", `Assigned “${role.name}” to ${targetUser.name}.`, targetUser.companyId);
      }
    },
    [roles, users, persistUsers, currentUser, logAudit],
  );

  const getUserPermissions = useCallback<AppContextValue["getUserPermissions"]>(
    // Single source of truth: every permission decision flows through the shared
    // user-centric engine in lib/employeeRoles so authorization can never drift
    // between surfaces (UI, route guards, future scoping/RLS).
    (user) => resolveUserPermissions(user, { roles }),
    [roles],
  );

  const hasPermission = useCallback<AppContextValue["hasPermission"]>(
    (permission) => {
      // Permissions reflect the effective identity, so previewing as a customer
      // shows exactly what that customer would be allowed to see.
      const user = impersonatedUser ?? currentUser;
      if (!user) return false;
      return getUserPermissions(user).includes(permission);
    },
    [impersonatedUser, currentUser, getUserPermissions],
  );

  /** The customer currently being previewed, resolved from live customer data. */
  const viewAsCustomer = useMemo<Customer | null>(
    () => (viewAsCustomerId ? customers.find((c) => c.id === viewAsCustomerId) ?? null : null),
    [viewAsCustomerId, customers],
  );

  const startViewAsCustomer = useCallback<AppContextValue["startViewAsCustomer"]>(
    (customerId) => {
      if (!currentUser) return { ok: false, error: "You must be signed in." };
      // Only platform or company admins may preview, and only within their scope.
      const isAdmin =
        currentUser.role === "super_admin" || currentUser.role === "company_admin";
      if (!isAdmin) return { ok: false, error: FORBIDDEN_MESSAGE };
      const customer = customers.find((c) => c.id === customerId);
      if (!customer) return { ok: false, error: "Customer not found." };
      if (!inCompanyScope(currentUser, customer.companyId)) {
        return { ok: false, error: FORBIDDEN_MESSAGE };
      }
      // Prefer a real linked customer login so their exact role/permissions apply;
      // otherwise synthesize a transient preview identity that is never persisted.
      const linked =
        users.find(
          (u) =>
            u.role === "customer" &&
            (u.linkedCustomerId === customer.id || customer.userIds.includes(u.id)),
        ) ?? null;
      const previewUser: User = linked ?? {
        id: `preview-${customer.id}`,
        name: customer.name,
        email: customer.email,
        role: "customer",
        companyId: customer.companyId,
        status: customer.status,
        createdAt: customer.createdAt,
        linkedCustomerId: customer.id,
      };
      setImpersonatedUser(previewUser);
      setViewAsEmployeeId(null);
      setViewAsCustomerId(customer.id);
      logAudit(
        "impersonation.start",
        `${currentUser.name} started viewing the portal as customer “${customer.name}”.`,
        customer.companyId,
      );
      return { ok: true };
    },
    [currentUser, customers, users, logAudit],
  );

  const exitViewAsCustomer = useCallback<AppContextValue["exitViewAsCustomer"]>(() => {
    if (currentUser && viewAsCustomer) {
      logAudit(
        "impersonation.end",
        `${currentUser.name} stopped viewing the portal as customer “${viewAsCustomer.name}”.`,
        viewAsCustomer.companyId,
      );
    }
    setImpersonatedUser(null);
    setViewAsCustomerId(null);
  }, [currentUser, viewAsCustomer, logAudit]);

  /** The employee currently being previewed, resolved from live employee data. */
  const viewAsEmployee = useMemo<Employee | null>(
    () => (viewAsEmployeeId ? employees.find((e) => e.id === viewAsEmployeeId) ?? null : null),
    [viewAsEmployeeId, employees],
  );

  const startViewAsEmployee = useCallback<AppContextValue["startViewAsEmployee"]>(
    (employeeId) => {
      if (!currentUser) return { ok: false, error: "You must be signed in." };
      // Only platform or company admins may preview, and only within their scope.
      const isAdmin =
        currentUser.role === "super_admin" || currentUser.role === "company_admin";
      if (!isAdmin) return { ok: false, error: FORBIDDEN_MESSAGE };
      const employee = employees.find((e) => e.id === employeeId);
      if (!employee) return { ok: false, error: "Employee not found." };
      if (!inCompanyScope(currentUser, employee.companyId)) {
        return { ok: false, error: FORBIDDEN_MESSAGE };
      }
      // Prefer a real linked employee login so their exact role/permissions apply;
      // otherwise synthesize a transient preview identity that is never persisted.
      const linked =
        users.find(
          (u) =>
            u.role === "employee" &&
            (u.linkedEmployeeId === employee.id || employee.userId === u.id),
        ) ?? null;
      const previewUser: User = linked ?? {
        id: `preview-${employee.id}`,
        name: employee.name,
        email: employee.email,
        role: "employee",
        companyId: employee.companyId,
        status: employee.status,
        createdAt: employee.createdAt,
        linkedEmployeeId: employee.id,
      };
      setImpersonatedUser(previewUser);
      setViewAsCustomerId(null);
      setViewAsEmployeeId(employee.id);
      logAudit(
        "impersonation.start",
        `${currentUser.name} started viewing the portal as employee “${employee.name}”.`,
        employee.companyId,
      );
      return { ok: true };
    },
    [currentUser, employees, users, logAudit],
  );

  const exitViewAsEmployee = useCallback<AppContextValue["exitViewAsEmployee"]>(() => {
    if (currentUser && viewAsEmployee) {
      logAudit(
        "impersonation.end",
        `${currentUser.name} stopped viewing the portal as employee “${viewAsEmployee.name}”.`,
        viewAsEmployee.companyId,
      );
    }
    setImpersonatedUser(null);
    setViewAsEmployeeId(null);
  }, [currentUser, viewAsEmployee, logAudit]);

  // ── Employees ──

  const createEmployee = useCallback<AppContextValue["createEmployee"]>(
    (input) => {
      const email = input.email.trim().toLowerCase();
      if (employees.some((e) => e.companyId === input.companyId && e.email.toLowerCase() === email)) {
        return { ok: false, error: "An employee with this email already exists." };
      }
      const employee: Employee = {
        id: makeId("emp"),
        companyId: input.companyId,
        name: input.name.trim(),
        email: input.email.trim(),
        title: input.title?.trim() || undefined,
        phone: input.phone?.trim() || undefined,
        iceNumber: input.iceNumber?.trim() || undefined,
        address: input.address?.trim() || undefined,
        postalCityId: input.postalCityId || undefined,
        status: "active",
        teamIds: input.teamIds,
        userId: input.userId ?? null,
        languageId: input.languageId ?? null,
        secondLanguageId: input.secondLanguageId ?? null,
        availability: input.availability,
        acceptableHours: input.acceptableHours,
        preferredHours: input.preferredHours,
        createdAt: new Date().toISOString(),
      };
      persistEmployees([employee, ...employees]);
      if (employee.userId) {
        persistUsers(
          users.map((u) =>
            u.id === employee.userId ? { ...u, linkedEmployeeId: employee.id } : u,
          ),
        );
      }
      return { ok: true };
    },
    [employees, persistEmployees, users, persistUsers],
  );

  const updateEmployee = useCallback<AppContextValue["updateEmployee"]>(
    (id, patch) => {
      const target = employees.find((e) => e.id === id);
      if (!target) return { ok: false, error: "Employee not found." };
      if (patch.email) {
        const email = patch.email.trim().toLowerCase();
        if (
          employees.some(
            (e) => e.id !== id && e.companyId === target.companyId && e.email.toLowerCase() === email,
          )
        ) {
          return { ok: false, error: "An employee with this email already exists." };
        }
      }
      // Normalize the patch so empty-string inputs never overwrite stored data
      // with meaningless values. Only fields explicitly present in the patch are
      // touched; absent fields are preserved as-is. Optional id references clear
      // to their canonical "unset" value (undefined for postalCityId, null for
      // the nullable login/language references), and teamIds is always an array.
      const normalized: typeof patch = { ...patch };
      if ("postalCityId" in normalized) {
        normalized.postalCityId = normalized.postalCityId?.trim()
          ? normalized.postalCityId
          : undefined;
      }
      if ("userId" in normalized) {
        normalized.userId = normalized.userId ? normalized.userId : null;
      }
      if ("languageId" in normalized) {
        normalized.languageId = normalized.languageId ? normalized.languageId : null;
      }
      if ("secondLanguageId" in normalized) {
        normalized.secondLanguageId = normalized.secondLanguageId
          ? normalized.secondLanguageId
          : null;
      }
      if ("teamIds" in normalized) {
        normalized.teamIds = Array.isArray(normalized.teamIds) ? normalized.teamIds : [];
      }
      persistEmployees(employees.map((e) => (e.id === id ? { ...e, ...normalized } : e)));
      // Keep linked-login pointers in sync when the connection changes.
      if (normalized.userId !== undefined && normalized.userId !== target.userId) {
        persistUsers(
          users.map((u) => {
            if (u.id === target.userId) return { ...u, linkedEmployeeId: null };
            if (u.id === normalized.userId) return { ...u, linkedEmployeeId: id };
            return u;
          }),
        );
      }
      return { ok: true };
    },
    [employees, persistEmployees, users, persistUsers],
  );

  const createEmployeeWithLogin = useCallback<AppContextValue["createEmployeeWithLogin"]>(
    async (input) => {
      const email = input.email.trim();
      const emailLc = email.toLowerCase();
      if (!email) return { ok: false, error: "An email address is required." };
      // Security boundary: only a Super Admin may provision a Super Admin login,
      // whether via the base role or a pinned custom role.
      const pinnedRole = input.roleId ? roles.find((r) => r.id === input.roleId) : null;
      if (
        (input.baseRole === "super_admin" ||
          (pinnedRole && !canAssignRole(currentUser?.role, pinnedRole))) &&
        currentUser?.role !== "super_admin"
      ) {
        return { ok: false, error: FORBIDDEN_MESSAGE };
      }
      if (
        employees.some(
          (e) => e.companyId === input.companyId && e.email.toLowerCase() === emailLc,
        )
      ) {
        return { ok: false, error: "An employee with this email already exists." };
      }

      const empId = makeId("emp");

      // Provision the login FIRST. Hard-block: if this fails, no employee is
      // created, so the system never lands in a half-created
      // employee-without-login state.
      let loginId: string;
      if (ENABLE_USER_CREATION) {
        const result = await createSupabaseUser({
          email: emailLc,
          baseRole: input.baseRole,
          companyId: input.companyId,
          fullName: input.name.trim() || null,
          redirectTo: inviteRedirectUrl(),
        });
        if (!result.ok) {
          return { ok: false, error: result.error ?? "Could not create login access." };
        }
        loginId = result.userId ?? makeId("usr");
      } else {
        if (users.some((u) => u.email.toLowerCase() === emailLc)) {
          return { ok: false, error: "A login with this email already exists." };
        }
        loginId = makeId("usr");
      }

      const now = new Date().toISOString();
      const user: User = {
        id: loginId,
        name: input.name.trim(),
        email,
        role: input.baseRole,
        roleId: input.roleId ?? undefined,
        companyId: input.companyId,
        status: "active",
        createdAt: now,
        linkedEmployeeId: empId,
      };
      const employee: Employee = {
        id: empId,
        companyId: input.companyId,
        name: input.name.trim(),
        email,
        title: input.title?.trim() || undefined,
        phone: input.phone?.trim() || undefined,
        iceNumber: input.iceNumber?.trim() || undefined,
        address: input.address?.trim() || undefined,
        postalCityId: input.postalCityId || undefined,
        status: "active",
        teamIds: input.teamIds,
        userId: loginId,
        languageId: input.languageId ?? null,
        secondLanguageId: input.secondLanguageId ?? null,
        availability: input.availability,
        acceptableHours: input.acceptableHours,
        preferredHours: input.preferredHours,
        createdAt: now,
      };

      // Compose both writes off the same closure state so neither overwrites the
      // other (the new login carries its employee back-pointer up front).
      persistUsers([
        user,
        ...users.filter((u) => u.id !== loginId && u.email.toLowerCase() !== emailLc),
      ]);
      persistEmployees([employee, ...employees]);
      logAudit(
        "user.create",
        `Created employee “${employee.name}” with a linked ${ROLE_LABELS[input.baseRole]} login.`,
        input.companyId,
      );
      // Refresh the shared directory roster so the new login is consistent across
      // every directory surface (and other devices) right away — and the Staff ID
      // lookups so the new employee/login shows its allocated Staff ID immediately.
      void queryClient.invalidateQueries({ queryKey: DIRECTORY_PROFILES_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: ASSIGNED_USERS_ROSTER_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: EMPLOYEE_STAFF_NUMBERS_QUERY_KEY });
      return { ok: true };
    },
    [employees, users, roles, currentUser, persistEmployees, persistUsers, logAudit, queryClient],
  );

  const createLoginForEmployee = useCallback<AppContextValue["createLoginForEmployee"]>(
    async (employeeId, input) => {
      const target = employees.find((e) => e.id === employeeId);
      if (!target) return { ok: false, error: "Employee not found." };
      if (target.userId) {
        return { ok: false, error: "This employee already has a linked login." };
      }
      const email = target.email.trim();
      const emailLc = email.toLowerCase();
      if (!email) {
        return { ok: false, error: "Add an email address before creating a login." };
      }
      const baseRole: UserRole = input?.baseRole ?? "employee";

      let loginId: string;
      if (ENABLE_USER_CREATION) {
        const result = await createSupabaseUser({
          email: emailLc,
          baseRole,
          companyId: target.companyId,
          fullName: target.name.trim() || null,
          redirectTo: inviteRedirectUrl(),
        });
        if (!result.ok) {
          return { ok: false, error: result.error ?? "Could not create login access." };
        }
        loginId = result.userId ?? makeId("usr");
      } else {
        if (users.some((u) => u.email.toLowerCase() === emailLc)) {
          return { ok: false, error: "A login with this email already exists." };
        }
        loginId = makeId("usr");
      }

      const user: User = {
        id: loginId,
        name: target.name.trim(),
        email,
        role: baseRole,
        companyId: target.companyId,
        status: "active",
        createdAt: new Date().toISOString(),
        linkedEmployeeId: employeeId,
      };
      persistUsers([
        user,
        ...users.filter((u) => u.id !== loginId && u.email.toLowerCase() !== emailLc),
      ]);
      persistEmployees(
        employees.map((e) => (e.id === employeeId ? { ...e, userId: loginId } : e)),
      );
      logAudit(
        "user.create",
        `Created and linked a ${ROLE_LABELS[baseRole]} login for employee “${target.name}”.`,
        target.companyId,
      );
      void queryClient.invalidateQueries({ queryKey: DIRECTORY_PROFILES_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: ASSIGNED_USERS_ROSTER_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: EMPLOYEE_STAFF_NUMBERS_QUERY_KEY });
      return { ok: true };
    },
    [employees, users, persistEmployees, persistUsers, logAudit, queryClient],
  );

  // ── Customers ──

  // NUM-1: customer creation is database-authoritative. The visible customer
  // number is issued exclusively by the Supabase create path through the
  // allocate_number RPC (createCustomerInSupabase / useCustomerMutations). This
  // legacy local path is intentionally neutralised so localStorage can never
  // mint or mirror an authoritative customer number — there is no MAX(existing)+1
  // and no front-end calculation here, which removes the dirty-browser
  // resurrection risk for customer numbers.
  const createCustomer = useCallback<AppContextValue["createCustomer"]>(
    () => ({
      ok: false,
      error:
        "Customer creation is database-authoritative. Create customers through the " +
        "Supabase customer create path (useCustomerMutations.createCustomer); the local " +
        "path can no longer allocate customer numbers.",
    }),
    [],
  );

  const updateCustomer = useCallback<AppContextValue["updateCustomer"]>(
    (id, patch, options) => {
      const target = customers.find((c) => c.id === id);
      if (!target) return { ok: false, error: "Customer not found." };
      if (patch.email) {
        const email = patch.email.trim().toLowerCase();
        if (
          customers.some(
            (c) => c.id !== id && c.companyId === target.companyId && c.email.toLowerCase() === email,
          )
        ) {
          return { ok: false, error: "A customer with this email already exists." };
        }
      }
      // Enforce contact-people exclusivity (one invoice/agreement/primary) and
      // the "at least one primary" rule centrally, so every save path is safe.
      const effectivePatch =
        patch.contacts !== undefined
          ? { ...patch, contacts: normalizeCustomerContacts(patch.contacts) }
          : patch;
      const now = new Date().toISOString();
      // Record an immutable Customer Card Log entry for each meaningful change.
      const source: CustomerCardLogSource = options?.source ?? "admin_portal";
      const changeType = resolveCustomerCardLogChangeType(source, Boolean(currentUser));
      const logEntries: CustomerCardLogEntry[] = describeCustomerCardChanges(target, effectivePatch).map(
        (change) => ({
          id: makeId("clog"),
          at: now,
          section: change.section,
          field: change.field,
          changeType,
          oldValue: change.oldValue,
          newValue: change.newValue,
          changedById: currentUser?.id ?? null,
          changedByName: currentUser?.name ?? "System",
          changedByRole: currentUser?.role ?? "company_admin",
          source,
        }),
      );
      persistCustomers(
        customers.map((c) =>
          c.id === id
            ? {
                ...c,
                ...effectivePatch,
                cardLog: logEntries.length
                  ? [...logEntries, ...(c.cardLog ?? [])].slice(0, 500)
                  : c.cardLog,
                updatedAt: now,
              }
            : c,
        ),
      );
      // When a customer is deactivated, suspend all of their non-archived
      // protocols so employees receive no active assignments. Reactivation is
      // handled manually by a company admin per protocol.
      if (patch.status === "inactive" && target.status !== "inactive") {
        const affected = customerProtocols.filter(
          (p) => p.customerId === id && p.status !== "archived",
        );
        if (affected.length > 0) {
          const ts = new Date().toISOString();
          persistCustomerProtocols(
            customerProtocols.map((p) =>
              p.customerId === id && p.status !== "archived"
                ? { ...p, status: "inactive_customer", updatedAt: ts }
                : p,
            ),
          );
          logAudit(
            "protocol.update",
            `Suspended ${affected.length} protocol(s) after deactivating ${target.name}.`,
            target.companyId,
          );
        }
      }
      if (patch.userIds) {
        const nextIds = patch.userIds;
        persistUsers(
          users.map((u) => {
            const wasLinked = target.userIds.includes(u.id);
            const nowLinked = nextIds.includes(u.id);
            if (wasLinked === nowLinked) return u;
            return { ...u, linkedCustomerId: nowLinked ? id : null };
          }),
        );
      }
      return { ok: true };
    },
    [
      customers,
      persistCustomers,
      users,
      persistUsers,
      customerProtocols,
      persistCustomerProtocols,
      logAudit,
      currentUser,
    ],
  );

  const logCustomerMediaActivity = useCallback<
    AppContextValue["logCustomerMediaActivity"]
  >(
    (customerId, action, category) => {
      const target = customers.find((c) => c.id === customerId);
      if (!target) return;
      const now = new Date().toISOString();
      const categoryLabel = getMediaCategory(category)?.label ?? category;
      const entry: CustomerCardLogEntry = {
        id: makeId("clog"),
        at: now,
        section: "Media Library",
        field: categoryLabel,
        changeType: resolveCustomerCardLogChangeType(
          "admin_portal",
          Boolean(currentUser),
        ),
        oldValue: action === "deleted" ? "Image" : "",
        newValue: action === "deleted" ? "Image deleted" : "Image uploaded",
        changedById: currentUser?.id ?? null,
        changedByName: currentUser?.name ?? "System",
        changedByRole: currentUser?.role ?? "company_admin",
        source: "admin_portal",
      };
      persistCustomers(
        customers.map((c) =>
          c.id === customerId
            ? { ...c, cardLog: [entry, ...(c.cardLog ?? [])].slice(0, 500) }
            : c,
        ),
      );
    },
    [customers, persistCustomers, currentUser],
  );

  const logCustomerMediaMetaChange = useCallback<
    AppContextValue["logCustomerMediaMetaChange"]
  >(
    (customerId, field, oldValue, newValue) => {
      const target = customers.find((c) => c.id === customerId);
      if (!target) return;
      const now = new Date().toISOString();
      const entry: CustomerCardLogEntry = {
        id: makeId("clog"),
        at: now,
        section: "Media Library",
        field,
        changeType: resolveCustomerCardLogChangeType(
          "admin_portal",
          Boolean(currentUser),
        ),
        oldValue,
        newValue,
        changedById: currentUser?.id ?? null,
        changedByName: currentUser?.name ?? "System",
        changedByRole: currentUser?.role ?? "company_admin",
        source: "admin_portal",
      };
      persistCustomers(
        customers.map((c) =>
          c.id === customerId
            ? { ...c, cardLog: [entry, ...(c.cardLog ?? [])].slice(0, 500) }
            : c,
        ),
      );
    },
    [customers, persistCustomers, currentUser],
  );

  const setCustomerCoverImage = useCallback<
    AppContextValue["setCustomerCoverImage"]
  >(
    (customerId, assetId) => {
      const target = customers.find((c) => c.id === customerId);
      if (!target) return;
      // No-op when the pointer is already in the requested state.
      const current = target.coverMediaAssetId ?? null;
      if (current === assetId) return;
      const now = new Date().toISOString();
      const assigning = assetId != null;
      const entry: CustomerCardLogEntry = {
        id: makeId("clog"),
        at: now,
        section: "Media Library",
        field: "Cover image",
        changeType: resolveCustomerCardLogChangeType(
          "admin_portal",
          Boolean(currentUser),
        ),
        oldValue: assigning ? "" : "Cover image",
        newValue: assigning ? "Cover assigned" : "Cover removed",
        changedById: currentUser?.id ?? null,
        changedByName: currentUser?.name ?? "System",
        changedByRole: currentUser?.role ?? "company_admin",
        source: "admin_portal",
      };
      persistCustomers(
        customers.map((c) =>
          c.id === customerId
            ? {
                ...c,
                coverMediaAssetId: assetId ?? undefined,
                cardLog: [entry, ...(c.cardLog ?? [])].slice(0, 500),
                updatedAt: now,
              }
            : c,
        ),
      );
    },
    [customers, persistCustomers, currentUser],
  );

  // ── Work orders & invoices (customer-card foundation) ──

  /** Whether the signed-in user may access a given customer's card data. */
  const canAccessCustomer = useCallback(
    (customerId: string): Customer | null => {
      const customer = customers.find((c) => c.id === customerId);
      if (!customer) return null;
      if (currentUser?.role === "super_admin") return customer;
      if (
        currentUser?.companyId != null &&
        customer.companyId === currentUser.companyId
      ) {
        return customer;
      }
      return null;
    },
    [customers, currentUser],
  );

  const getCustomerWorkOrders = useCallback<AppContextValue["getCustomerWorkOrders"]>(
    (customerId) => {
      if (!canAccessCustomer(customerId)) return [];
      return workOrders
        .filter((w) => w.customerId === customerId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    [workOrders, canAccessCustomer],
  );

  // ── Customer & employee delete / archive ──

  /** Whether the signed-in user may delete/archive directory records. */
  const canManageDirectoryLifecycle =
    currentUser?.role === "super_admin" || currentUser?.role === "company_admin";

  const deleteCustomer = useCallback<AppContextValue["deleteCustomer"]>(
    (id, options) => {
      const customer = canAccessCustomer(id);
      if (!customer) return { ok: false, error: "Customer not found." };
      if (!canManageDirectoryLifecycle) return { ok: false, error: FORBIDDEN_MESSAGE };
      const validation = options?.dependencyValidation;
      if (!validation) {
        return {
          ok: false,
          error:
            "Customer delete requires a shared Supabase dependency check. Archive the customer instead if the check is unavailable.",
        };
      }
      if (!validation.allowed) return { ok: false, error: validation.blockedMessage };
      // Remove customer-owned media assets. Safe: a deletable customer has no
      // work orders, so no work-order placements can reference these assets.
      if (currentUser) {
        const perms = getUserPermissions(currentUser);
        for (const asset of listMediaForEntity(currentUser, perms, "customer", id)) {
          deleteMediaAsset(currentUser, perms, asset.id);
        }
      }
      // Remove customer-scoped cleaning protocols.
      const remainingProtocols = customerProtocols.filter((p) => p.customerId !== id);
      if (remainingProtocols.length !== customerProtocols.length) {
        persistCustomerProtocols(remainingProtocols);
      }
      // Unlink any portal logins pointing at this customer.
      if (customer.userIds.length > 0) {
        persistUsers(
          users.map((u) =>
            customer.userIds.includes(u.id) ? { ...u, linkedCustomerId: null } : u,
          ),
        );
      }
      // Remove the record itself — notes, card log, contacts and addresses all
      // live on the customer record and are removed with it.
      persistCustomers(customers.filter((c) => c.id !== id));
      // Optimistic suppression: hide this id from list reads immediately, even if
      // Supabase (authoritative) still returns it until the soft-delete mirror
      // lands. Cleared on mirror success or after a bounded max age.
      addCustomerDeleteTombstone(id);
      logAudit(
        "customer.delete",
        `Permanently deleted customer “${customer.name}” (${customer.customerNumber}). No operational history existed.`,
        customer.companyId,
      );
      return { ok: true };
    },
    [
      canAccessCustomer,
      canManageDirectoryLifecycle,
      currentUser,
      getUserPermissions,
      customerProtocols,
      persistCustomerProtocols,
      users,
      persistUsers,
      customers,
      persistCustomers,
      logAudit,
    ],
  );

  const archiveCustomer = useCallback<AppContextValue["archiveCustomer"]>(
    (id) => {
      const customer = canAccessCustomer(id);
      if (!customer) return { ok: false, error: "Customer not found." };
      if (!canManageDirectoryLifecycle) return { ok: false, error: FORBIDDEN_MESSAGE };
      const now = new Date().toISOString();
      persistCustomers(
        customers.map((c) =>
          c.id === id
            ? { ...c, status: "inactive", archivedAt: now, updatedAt: now }
            : c,
        ),
      );
      // Mirror deactivation: suspend non-archived protocols so employees receive
      // no active assignments from an archived customer.
      const affected = customerProtocols.filter(
        (p) => p.customerId === id && p.status !== "archived",
      );
      if (affected.length > 0) {
        persistCustomerProtocols(
          customerProtocols.map((p) =>
            p.customerId === id && p.status !== "archived"
              ? { ...p, status: "inactive_customer", updatedAt: now }
              : p,
          ),
        );
      }
      logAudit(
        "customer.archive",
        `Archived customer “${customer.name}” (${customer.customerNumber}). Operational history preserved.`,
        customer.companyId,
      );
      return { ok: true };
    },
    [
      canAccessCustomer,
      canManageDirectoryLifecycle,
      customers,
      persistCustomers,
      customerProtocols,
      persistCustomerProtocols,
      logAudit,
    ],
  );

  /** Resolves an employee's operational dependency counts (completed + future missions). */
  const getEmployeeDeleteContext = useCallback(
    (id: string): EmployeeDeleteContext => {
      const completedMissionCount = timeReports.filter((t) => t.employeeId === id).length;
      const todayIso = new Date().toISOString().slice(0, 10);
      let futureAssignedMissionCount = 0;
      for (const w of workOrders) {
        for (const row of w.serviceRows ?? []) {
          if (row.archived) continue;
          if (!(row.assignedEmployeeIds ?? []).includes(id)) continue;
          // A future assignment = a one-time row dated today or later, or an
          // ongoing recurring row that has not yet ended.
          if (row.serviceDate >= todayIso) {
            futureAssignedMissionCount++;
          } else if (isRecurring(row) && (!row.serviceEndDate || row.serviceEndDate >= todayIso)) {
            futureAssignedMissionCount++;
          }
        }
      }
      return { completedMissionCount, futureAssignedMissionCount };
    },
    [timeReports, workOrders],
  );

  const getEmployeeDeletability = useCallback<AppContextValue["getEmployeeDeletability"]>(
    (id) => {
      // Synthetic admin rows (no real employee record) are never deletable.
      if (!employees.some((e) => e.id === id)) {
        return {
          allowed: false,
          blockingFactors: [],
          reasons: [],
          blockedMessage: "This account has no employee profile to delete.",
        };
      }
      return validateEmployeeDelete(getEmployeeDeleteContext(id));
    },
    [employees, getEmployeeDeleteContext],
  );

  const deleteEmployee = useCallback<AppContextValue["deleteEmployee"]>(
    async (id) => {
      const target = employees.find((e) => e.id === id);
      if (!target) return { ok: false, error: "Employee not found." };
      if (!canManageDirectoryLifecycle) return { ok: false, error: FORBIDDEN_MESSAGE };
      if (target.userId && target.userId === currentUser?.id) {
        return { ok: false, error: "You cannot delete your own account." };
      }
      const validation = validateEmployeeDelete(getEmployeeDeleteContext(id));
      if (!validation.allowed) return { ok: false, error: validation.blockedMessage };
      // Release the Supabase Auth user FIRST when the cloud user path is active.
      // Deleting the auth user cascades to its `profiles` row (migration 0003),
      // which frees the email for reuse. We do this BEFORE removing local
      // records so that, if the cloud deletion fails, we abort and leave the
      // employee intact rather than orphaning the auth user / locking the email.
      //
      // We pass BOTH the (possibly local/non-UUID) userId and the email so the
      // Edge Function can fall back to an email lookup for legacy users whose
      // local id is not a real Supabase UUID but whose orphaned auth/profile
      // still reserves the email.
      if (ENABLE_USER_CREATION && (target.userId || target.email)) {
        const released = await deleteSupabaseUser(
          target.userId ?? "",
          target.email,
        );
        if (!released.ok) {
          return {
            ok: false,
            error:
              (released.error ?? "Could not remove the linked login.") +
              " The employee was not deleted so no orphaned login remains.",
          };
        }
      }
      // Remove employee-owned media assets.
      if (currentUser) {
        const perms = getUserPermissions(currentUser);
        for (const asset of listMediaForEntity(currentUser, perms, "employee", id)) {
          deleteMediaAsset(currentUser, perms, asset.id);
        }
      }
      // Remove the linked login/user account so no orphaned credential remains.
      if (target.userId) {
        const loginId = target.userId;
        persistUsers(users.filter((u) => u.id !== loginId));
      }
      // Clear customer-owner references to prevent dangling pointers.
      const ownedCustomers = customers.filter((c) => c.ownerId === id);
      if (ownedCustomers.length > 0) {
        persistCustomers(
          customers.map((c) => (c.ownerId === id ? { ...c, ownerId: undefined } : c)),
        );
      }
      // Remove the employee record (teams membership lives on the record itself).
      persistEmployees(employees.filter((e) => e.id !== id));
      logAudit(
        "employee.delete",
        `Permanently deleted employee “${target.name}” and their linked login. No operational history existed.`,
        target.companyId,
      );
      // The deleted auth user cascaded to its `profiles` row. Invalidate the
      // shared directory roster so every directory surface (Employees + Roles &
      // Permissions → Assigned Users) drops the user immediately instead of
      // showing the stale, cached profile.
      void queryClient.invalidateQueries({ queryKey: DIRECTORY_PROFILES_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: ASSIGNED_USERS_ROSTER_QUERY_KEY });
      return { ok: true };
    },
    [
      employees,
      persistEmployees,
      canManageDirectoryLifecycle,
      currentUser,
      getEmployeeDeleteContext,
      getUserPermissions,
      users,
      persistUsers,
      customers,
      persistCustomers,
      logAudit,
      queryClient,
    ],
  );

  const archiveEmployee = useCallback<AppContextValue["archiveEmployee"]>(
    (id) => {
      const target = employees.find((e) => e.id === id);
      if (!target) return { ok: false, error: "Employee not found." };
      if (!canManageDirectoryLifecycle) return { ok: false, error: FORBIDDEN_MESSAGE };
      if (target.userId && target.userId === currentUser?.id) {
        return { ok: false, error: "You cannot archive your own account." };
      }
      const now = new Date().toISOString();
      persistEmployees(
        employees.map((e) =>
          e.id === id ? { ...e, status: "inactive", archivedAt: now } : e,
        ),
      );
      // Disable the linked login so an archived employee can no longer sign in.
      if (target.userId) {
        const loginId = target.userId;
        persistUsers(
          users.map((u) =>
            u.id === loginId && u.status !== "inactive" ? { ...u, status: "inactive" } : u,
          ),
        );
      }
      logAudit(
        "employee.archive",
        `Archived employee “${target.name}”. Operational history preserved.`,
        target.companyId,
      );
      // Refresh the shared directory roster so the archived status is reflected
      // on every directory surface without waiting for staleTime.
      void queryClient.invalidateQueries({ queryKey: DIRECTORY_PROFILES_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: ASSIGNED_USERS_ROSTER_QUERY_KEY });
      return { ok: true };
    },
    [
      employees,
      persistEmployees,
      canManageDirectoryLifecycle,
      currentUser,
      users,
      persistUsers,
      logAudit,
      queryClient,
    ],
  );

  /** Builds an activity-log entry stamped with the current actor and time. */
  const buildActivity = useCallback(
    (action: WorkOrderActivity["action"], summary: string): WorkOrderActivity => ({
      id: makeId("woact"),
      action,
      summary,
      actorId: currentUser?.id ?? null,
      actorName: currentUser?.name ?? "System",
      at: new Date().toISOString(),
    }),
    [currentUser],
  );

  const logWorkOrderMediaActivity = useCallback<
    AppContextValue["logWorkOrderMediaActivity"]
  >(
    (workOrderId, action, category) => {
      const order = workOrders.find((w) => w.id === workOrderId);
      if (!order) return;
      const label = getMediaCategory(category)?.label ?? category;
      const detail: Record<
        "attached" | "detached" | "uploaded",
        { action: WorkOrderActivity["action"]; summary: string }
      > = {
        attached: {
          action: "media_attached",
          summary: `Attached ${label} image from customer library`,
        },
        detached: {
          action: "media_detached",
          summary: `Removed ${label} image from work order`,
        },
        uploaded: {
          action: "media_uploaded",
          summary: `Uploaded ${label} image`,
        },
      };
      const { action: woAction, summary } = detail[action];
      const entry = buildActivity(woAction, summary);
      const now = new Date().toISOString();
      persistWorkOrders(
        workOrders.map((w) =>
          w.id === workOrderId
            ? { ...w, activity: [...(w.activity ?? []), entry], updatedAt: now }
            : w,
        ),
      );
    },
    [workOrders, persistWorkOrders, buildActivity],
  );

  const addWorkOrderMediaPlacement = useCallback<
    AppContextValue["addWorkOrderMediaPlacement"]
  >(
    (workOrderId, input) => {
      const order = workOrders.find((w) => w.id === workOrderId);
      if (!order || !canAccessCustomer(order.customerId)) return null;
      const { placements, added } = addPlacement(
        order.mediaPlacements,
        input,
        makeId("woplace"),
        new Date().toISOString(),
      );
      if (!added) return null;
      const now = new Date().toISOString();
      const where = added.placementType === "header" ? "header" : "service row";
      const entry = buildActivity("media_placed", `Image placed on work order ${where}`);
      persistWorkOrders(
        workOrders.map((w) =>
          w.id === workOrderId
            ? {
                ...w,
                mediaPlacements: placements,
                activity: [...(w.activity ?? []), entry],
                updatedAt: now,
              }
            : w,
        ),
      );
      return added;
    },
    [workOrders, persistWorkOrders, canAccessCustomer, buildActivity],
  );

  const removeWorkOrderMediaPlacement = useCallback<
    AppContextValue["removeWorkOrderMediaPlacement"]
  >(
    (workOrderId, placementId) => {
      const order = workOrders.find((w) => w.id === workOrderId);
      if (!order || !canAccessCustomer(order.customerId)) return;
      const placement = (order.mediaPlacements ?? []).find((p) => p.id === placementId);
      if (!placement) return;
      const now = new Date().toISOString();
      const where = placement.placementType === "header" ? "header" : "service row";
      const entry = buildActivity(
        "media_placement_removed",
        `Image removed from work order ${where}`,
      );
      persistWorkOrders(
        workOrders.map((w) =>
          w.id === workOrderId
            ? {
                ...w,
                mediaPlacements: removePlacementFromList(w.mediaPlacements, placementId),
                activity: [...(w.activity ?? []), entry],
                updatedAt: now,
              }
            : w,
        ),
      );
    },
    [workOrders, persistWorkOrders, canAccessCustomer, buildActivity],
  );

  const reorderWorkOrderMediaPlacements = useCallback<
    AppContextValue["reorderWorkOrderMediaPlacements"]
  >(
    (workOrderId, area, orderedPlacementIds) => {
      const order = workOrders.find((w) => w.id === workOrderId);
      if (!order || !canAccessCustomer(order.customerId)) return;
      const now = new Date().toISOString();
      persistWorkOrders(
        workOrders.map((w) =>
          w.id === workOrderId
            ? {
                ...w,
                mediaPlacements: reorderPlacements(
                  w.mediaPlacements,
                  area,
                  orderedPlacementIds,
                ),
                updatedAt: now,
              }
            : w,
        ),
      );
    },
    [workOrders, persistWorkOrders, canAccessCustomer],
  );

  const setWorkOrderMediaPlacementEmployeeVisibility = useCallback<
    AppContextValue["setWorkOrderMediaPlacementEmployeeVisibility"]
  >(
    (workOrderId, placementId, visibleToEmployee) => {
      const order = workOrders.find((w) => w.id === workOrderId);
      if (!order || !canAccessCustomer(order.customerId)) return;
      const now = new Date().toISOString();
      persistWorkOrders(
        workOrders.map((w) =>
          w.id === workOrderId
            ? {
                ...w,
                mediaPlacements: setPlacementEmployeeVisibility(
                  w.mediaPlacements,
                  placementId,
                  visibleToEmployee,
                ),
                updatedAt: now,
              }
            : w,
        ),
      );
    },
    [workOrders, persistWorkOrders, canAccessCustomer],
  );

  const purgeWorkOrderMediaPlacementsForAsset = useCallback<
    AppContextValue["purgeWorkOrderMediaPlacementsForAsset"]
  >(
    (mediaAssetId) => {
      let changed = false;
      const next = workOrders.map((w) => {
        const placements = w.mediaPlacements ?? [];
        if (!placements.some((p) => p.mediaAssetId === mediaAssetId)) return w;
        changed = true;
        return {
          ...w,
          mediaPlacements: removePlacementsForAsset(placements, mediaAssetId),
        };
      });
      if (changed) persistWorkOrders(next);
    },
    [workOrders, persistWorkOrders],
  );

  const createWorkOrder = useCallback<AppContextValue["createWorkOrder"]>(
    (input) => {
      const customer = canAccessCustomer(input.customerId);
      if (!customer) return { ok: false, error: FORBIDDEN_MESSAGE };
      const existing = workOrders.filter((w) => w.companyId === customer.companyId);
      const number = `WO-${1001 + existing.length}`;
      const now = new Date().toISOString();
      const order: WorkOrder = {
        id: makeId("wo"),
        companyId: customer.companyId,
        customerId: customer.id,
        number,
        title: input.title?.trim() || undefined,
        status: input.status ?? "draft",
        startDate: input.startDate,
        endDate: input.endDate,
        createdBy: currentUser?.id ?? null,
        createdByName: currentUser?.name ?? "System",
        notes: [],
        activity: [buildActivity("created", "Work order created")],
        createdAt: now,
        updatedAt: now,
      };
      persistWorkOrders([order, ...workOrders]);
      logAudit("workorder.create", `Created work order ${number} for ${customer.name}.`, customer.companyId);
      return { ok: true };
    },
    [workOrders, persistWorkOrders, canAccessCustomer, logAudit, currentUser, buildActivity],
  );

  const setWorkOrderActive = useCallback<AppContextValue["setWorkOrderActive"]>(
    (id, active) => {
      const order = workOrders.find((w) => w.id === id);
      if (!order) return { ok: false, error: "Work order not found." };
      if (!canAccessCustomer(order.customerId)) return { ok: false, error: FORBIDDEN_MESSAGE };
      const now = new Date().toISOString();
      const nextStatus: WorkOrderStatus = active ? "planned" : "inactive";
      const entry = buildActivity(
        active ? "activated" : "inactivated",
        active ? "Work order activated" : "Work order inactivated",
      );
      persistWorkOrders(
        workOrders.map((w) =>
          w.id === id
            ? { ...w, status: nextStatus, updatedAt: now, activity: [...(w.activity ?? []), entry] }
            : w,
        ),
      );
      logAudit(
        "workorder.update",
        `${active ? "Activated" : "Inactivated"} work order ${order.number}.`,
        order.companyId,
      );
      return { ok: true };
    },
    [workOrders, persistWorkOrders, canAccessCustomer, logAudit, buildActivity],
  );

  const getWorkOrderRelatedData = useCallback<AppContextValue["getWorkOrderRelatedData"]>(
    (id) => {
      const order = workOrders.find((w) => w.id === id);
      if (!order) {
        return {
          serviceRowCount: 0,
          bookingItemCount: 0,
          futureOccurrenceCount: 0,
          occurrenceExceptionCount: 0,
          variationCount: 0,
          timeReportCount: 0,
        };
      }
      const rows = order.serviceRows ?? [];
      const rowIds = new Set(rows.map((r) => r.id));
      let futureOccurrenceCount = 0;
      let variationCount = 0;
      for (const row of rows) {
        variationCount += (row.variations ?? []).length;
        // Only LIVE rows still drive future work; archived rows are superseded.
        if (row.archived) continue;
        futureOccurrenceCount += countServiceRowGeneratedOccurrences(row).future;
      }
      return {
        serviceRowCount: rows.length,
        bookingItemCount: bookingQueue.filter((b) => rowIds.has(b.serviceRowId)).length,
        futureOccurrenceCount,
        occurrenceExceptionCount: bookingOccurrenceExceptions.filter((e) =>
          rowIds.has(e.parentServiceRowId),
        ).length,
        variationCount,
        timeReportCount: timeReports.filter((t) => rowIds.has(t.serviceRowId)).length,
      };
    },
    [workOrders, bookingQueue, bookingOccurrenceExceptions, timeReports],
  );

  const archiveWorkOrder = useCallback<AppContextValue["archiveWorkOrder"]>(
    (id) => {
      const order = workOrders.find((w) => w.id === id);
      if (!order) return { ok: false, error: "Work order not found." };
      if (!canAccessCustomer(order.customerId)) return { ok: false, error: FORBIDDEN_MESSAGE };
      const now = new Date().toISOString();
      const entry = buildActivity("inactivated", "Work order archived");
      persistWorkOrders(
        workOrders.map((w) =>
          w.id === id
            ? { ...w, status: "inactive" as const, updatedAt: now, activity: [...(w.activity ?? []), entry] }
            : w,
        ),
      );
      logAudit(
        "workorder.update",
        `Archived work order ${order.number} (removed from live planning, history preserved).`,
        order.companyId,
      );
      return { ok: true };
    },
    [workOrders, persistWorkOrders, canAccessCustomer, logAudit, buildActivity],
  );

  const deleteWorkOrder = useCallback<AppContextValue["deleteWorkOrder"]>(
    (id) => {
      const order = workOrders.find((w) => w.id === id);
      if (!order) return { ok: false, error: "Work order not found." };
      if (!canAccessCustomer(order.customerId)) return { ok: false, error: FORBIDDEN_MESSAGE };
      const validation = validateWorkOrderDelete(getWorkOrderRelatedData(id));
      if (!validation.allowed) {
        return { ok: false, error: validation.blockedMessage };
      }
      // Empty/test work order — safe to remove entirely.
      persistWorkOrders(workOrders.filter((w) => w.id !== id));
      logAudit(
        "workorder.update",
        `Deleted empty work order ${order.number}.`,
        order.companyId,
      );
      return { ok: true };
    },
    [workOrders, persistWorkOrders, canAccessCustomer, logAudit, getWorkOrderRelatedData],
  );

  const forceDeleteWorkOrder = useCallback<AppContextValue["forceDeleteWorkOrder"]>(
    (id, confirmationInput) => {
      const order = workOrders.find((w) => w.id === id);
      if (!order) return { ok: false, error: "Work order not found." };
      if (!canAccessCustomer(order.customerId)) return { ok: false, error: FORBIDDEN_MESSAGE };
      const validation = validateWorkOrderForceDelete(
        getWorkOrderRelatedData(id),
        confirmationInput,
      );
      if (!validation.allowed) {
        return { ok: false, error: validation.blockedMessage };
      }
      persistWorkOrders(workOrders.filter((w) => w.id !== id));
      logAudit(
        "workorder.update",
        `Force deleted empty work order ${order.number}.`,
        order.companyId,
      );
      return { ok: true };
    },
    [workOrders, persistWorkOrders, canAccessCustomer, logAudit, getWorkOrderRelatedData],
  );

  const getWorkOrderSettingsFor = useCallback<AppContextValue["getWorkOrderSettingsFor"]>(
    (companyId) => {
      const existing = workOrderSettings.find((s) => s.companyId === companyId);
      return existing ? normalizeWorkOrderSettings(existing) : defaultWorkOrderSettings(companyId);
    },
    [workOrderSettings],
  );

  const updateWorkOrderSettings = useCallback<AppContextValue["updateWorkOrderSettings"]>(
    (companyId, patch) => {
      if (
        currentUser?.role === "company_admin" &&
        currentUser.companyId !== companyId
      ) {
        return { ok: false, error: FORBIDDEN_MESSAGE };
      }
      if (
        patch.preferredTimeEvaluationEnabled === true &&
        systemSettings.allowPreferredTimeEvaluation !== true
      ) {
        return {
          ok: false,
          error:
            "Preferred Time Evaluation is not available. Ask your platform administrator to enable it.",
        };
      }
      const found = workOrderSettings.find((s) => s.companyId === companyId);
      const base = found ? normalizeWorkOrderSettings(found) : defaultWorkOrderSettings(companyId);
      const next: WorkOrderSettings = {
        ...base,
        ...patch,
        companyId,
        updatedAt: new Date().toISOString(),
      };
      const others = workOrderSettings.filter((s) => s.companyId !== companyId);
      persistWorkOrderSettings([...others, next]);
      return { ok: true };
    },
    [workOrderSettings, persistWorkOrderSettings, currentUser, systemSettings],
  );

  const getTimeReportSettingsFor = useCallback<AppContextValue["getTimeReportSettingsFor"]>(
    (companyId) => {
      const existing = timeReportSettings.find((s) => s.companyId === companyId);
      return existing ?? defaultTimeReportSettings(companyId);
    },
    [timeReportSettings],
  );

  const updateTimeReportSettings = useCallback<AppContextValue["updateTimeReportSettings"]>(
    (companyId, patch) => {
      if (
        currentUser?.role === "company_admin" &&
        currentUser.companyId !== companyId
      ) {
        return { ok: false, error: FORBIDDEN_MESSAGE };
      }
      const base = timeReportSettings.find((s) => s.companyId === companyId)
        ?? defaultTimeReportSettings(companyId);
      const next: TimeReportSettings = {
        ...base,
        ...patch,
        companyId,
        updatedAt: new Date().toISOString(),
      };
      const others = timeReportSettings.filter((s) => s.companyId !== companyId);
      persistTimeReportSettings([...others, next]);
      return { ok: true };
    },
    [timeReportSettings, persistTimeReportSettings, currentUser],
  );

  const getDurationSettingsFor = useCallback<AppContextValue["getDurationSettingsFor"]>(
    (companyId) => {
      const existing = durationSettings.find((s) => s.companyId === companyId);
      return existing ?? defaultDurationSettings(companyId);
    },
    [durationSettings],
  );

  const updateDurationSettings = useCallback<AppContextValue["updateDurationSettings"]>(
    (companyId, presetMinutes) => {
      if (
        currentUser?.role === "company_admin" &&
        currentUser.companyId !== companyId
      ) {
        return { ok: false, error: FORBIDDEN_MESSAGE };
      }
      const normalized = normalizeDurationPresets(presetMinutes);
      if (normalized.length === 0) {
        return { ok: false, error: "Add at least one duration preset." };
      }
      const next: DurationSettings = {
        companyId,
        presetMinutes: normalized,
        updatedAt: new Date().toISOString(),
      };
      const others = durationSettings.filter((s) => s.companyId !== companyId);
      persistDurationSettings([...others, next]);
      return { ok: true };
    },
    [durationSettings, persistDurationSettings, currentUser],
  );

  const updateSystemSettings = useCallback<AppContextValue["updateSystemSettings"]>(
    (patch) => {
      if (currentUser?.role !== "super_admin") {
        return { ok: false, error: FORBIDDEN_MESSAGE };
      }
      const next: SystemSettings = {
        ...systemSettings,
        ...patch,
        updatedAt: new Date().toISOString(),
      };
      // localStorage is written first, synchronously. Under the SYSSET
      // authoritative cut-over it is the BACKOUT copy (Supabase is
      // authoritative); otherwise it is the sole source of truth. Either way the
      // local write never blocks/fails on Supabase, keeping rollback instant.
      const mirror = shouldRunBrowserDomainMirror(shouldMirrorSystemSettingsWrites());
      const prev = mirror ? systemSettings : null;
      setSystemSettings(next);
      saveSystemSettings(next);
      // SYSSET dual-write / authoritative: mirror the single record into
      // Supabase. Fire-and-forget — a Supabase failure can never affect the
      // settings update. Under authoritative mode a mirror failure is escalated
      // as a cut-over failure (surfaced, never silent). Rollback = flag OFF.
      if (prev) {
        void mirrorSystemSettingsWrite(prev, next).then((result) => {
          if (isSystemSettingsSupabaseAuthoritative() && !result.ok) {
            recordSystemSettingsReadFallback(
              "global",
              result.error ?? "system-settings mirror failed",
            );
          }
        });
      }
      // Dedicated audit trail for the entitlement-resolver cutover controls
      // (actor + timestamp are captured by logAudit; include old → new value).
      if (next.entitlementsResolver !== systemSettings.entitlementsResolver) {
        logAudit(
          "entitlements.resolver_changed",
          `Entitlement resolver changed from "${systemSettings.entitlementsResolver}" to "${next.entitlementsResolver}".`,
          null,
        );
      }
      if (next.entitlementsShadowLog !== systemSettings.entitlementsShadowLog) {
        logAudit(
          "entitlements.shadow_log_changed",
          `Entitlement shadow logging ${systemSettings.entitlementsShadowLog ? "enabled" : "disabled"} → ${next.entitlementsShadowLog ? "enabled" : "disabled"}.`,
          null,
        );
      }
      logAudit(
        "system_settings.update",
        `Updated system settings (booking horizon ${next.bookingGenerationHorizonMonths} months, preferred time evaluation ${next.allowPreferredTimeEvaluation ? "allowed" : "blocked"}, entitlement resolver ${next.entitlementsResolver}, shadow log ${next.entitlementsShadowLog ? "on" : "off"}).`,
        null,
      );
      return { ok: true };
    },
    [currentUser, systemSettings, logAudit],
  );

  // ── Service / Feature Entitlements (paid add-on foundation) ──

  // ENT-2 authoritative-write gate (the Entitlements analogue of
  // `modulesSupabaseAuthoritative`). When the entitlement stores READ from
  // Supabase, their WRITES must too — otherwise a toggle persists only to
  // localStorage while the read seam restores the stale Supabase row on refresh.
  // ON in real app builds (the read flag defaults on via cutoverFlag), OFF under
  // vitest / rollback so the legacy localStorage path keeps validating.
  const entitlementsSupabaseAuthoritative = useMemo(
    () => shouldReadEntitlementsFromSupabase() && isSupabaseConfigured,
    [],
  );

  const persistServiceGlobalEntitlements = useCallback(
    (next: ServiceGlobalEntitlement[]) => {
      const prev = shouldRunBrowserDomainMirror(shouldMirrorEntitlementWrites()) ? getServiceGlobalEntitlements() : null;
      setServiceGlobalEntitlements(next);
      saveServiceGlobalEntitlements(next);
      if (prev) void mirrorGlobalEntitlementWrites(prev, next);
    },
    [],
  );

  const persistCompanyServiceEntitlements = useCallback(
    (next: CompanyServiceEntitlement[]) => {
      const prev = shouldRunBrowserDomainMirror(shouldMirrorEntitlementWrites()) ? getCompanyServiceEntitlements() : null;
      setCompanyServiceEntitlements(next);
      saveCompanyServiceEntitlements(next);
      if (prev) void mirrorCompanyEntitlementWrites(prev, next);
    },
    [],
  );

  /** Appends an immutable entitlement-change log entry (billing/support trail). */
  const appendServiceEntitlementLog = useCallback(
    (entry: Omit<ServiceEntitlementLogEntry, "id" | "changedAt">) => {
      const prev = shouldRunBrowserDomainMirror(shouldMirrorEntitlementWrites()) ? getServiceEntitlementLog() : null;
      setServiceEntitlementLog((prevState) => {
        const next = [
          { ...entry, id: makeId("ent"), changedAt: new Date().toISOString() },
          ...prevState,
        ].slice(0, 500);
        saveServiceEntitlementLog(next);
        if (prev) void mirrorEntitlementLogAppend(prev, next);
        return next;
      });
    },
    [],
  );

  /**
   * Phase 6 switching mechanism. The five company-entitlement accessors are
   * backed by either the legacy resolver or the new bundle pipeline, selected by
   * `systemSettings.entitlementsResolver` (default `"legacy"`). The adapter is
   * fail-safe (falls back to legacy on any bundle error) and, when
   * `entitlementsShadowLog` is on, runs the bundle path in parallel and logs any
   * divergence without changing the served value. No data is migrated.
   */
  const entitlementAccessors = useMemo(
    () =>
      createEntitlementAccessors({
        mode: systemSettings.entitlementsResolver,
        shadowLog: systemSettings.entitlementsShadowLog,
        inputs: {
          companyIds: companies.map((c) => c.id),
          companyEntitlements: companyServiceEntitlements,
          globalEntitlements: serviceGlobalEntitlements,
          systemSettings,
        },
      }),
    [systemSettings, companies, companyServiceEntitlements, serviceGlobalEntitlements],
  );

  const isServiceGloballyAvailable = useCallback<
    AppContextValue["isServiceGloballyAvailable"]
  >(
    (serviceKey) => entitlementAccessors.isServiceGloballyAvailable(serviceKey),
    [entitlementAccessors],
  );

  const getCompanyServiceEntitlement = useCallback<
    AppContextValue["getCompanyServiceEntitlement"]
  >(
    (companyId, serviceKey) =>
      companyServiceEntitlements.find(
        (e) => e.companyId === companyId && e.serviceKey === serviceKey,
      ) ?? null,
    [companyServiceEntitlements],
  );

  const isCompanyEntitledToService = useCallback<
    AppContextValue["isCompanyEntitledToService"]
  >(
    (companyId, serviceKey) =>
      entitlementAccessors.isCompanyEntitledToService(companyId, serviceKey),
    [entitlementAccessors],
  );

  const isServiceAvailableForCompany = useCallback<
    AppContextValue["isServiceAvailableForCompany"]
  >(
    (companyId, serviceKey) =>
      entitlementAccessors.isServiceAvailableForCompany(companyId, serviceKey),
    [entitlementAccessors],
  );

  const setServiceGlobalAvailability = useCallback<
    AppContextValue["setServiceGlobalAvailability"]
  >(
    async (serviceKey, enabled) => {
      if (currentUser?.role !== "super_admin") {
        return { ok: false, error: FORBIDDEN_MESSAGE };
      }
      const def = getServiceDefinition(serviceKey);
      if (!def) return { ok: false, error: "Unknown service." };
      const previous = resolveGlobalAvailability(serviceKey, {
        systemSettings,
        globalEntitlements: serviceGlobalEntitlements,
      });
      if (previous === enabled) return { ok: true };
      const now = new Date().toISOString();
      // Preferred Time Evaluation bridges to the legacy master gate so the
      // existing control stays the single source of truth (its own SYSSET
      // authority), so it never routes through the entitlement table.
      const isPreferredTimeBridge = serviceKey === "preferred_time_evaluation";
      const nextGlobal: ServiceGlobalEntitlement = {
        serviceKey,
        enabled,
        updatedBy: currentUser?.id ?? null,
        updatedAt: now,
      };
      const writeSystemSettingsBridge = (): void => {
        const nextSettings: SystemSettings = {
          ...systemSettings,
          allowPreferredTimeEvaluation: enabled,
          updatedAt: now,
        };
        setSystemSettings(nextSettings);
        saveSystemSettings(nextSettings);
      };
      const logPart: Omit<ServiceEntitlementLogEntry, "id" | "changedAt"> = {
        serviceKey,
        companyId: null,
        action: enabled ? "global_enabled" : "global_disabled",
        previousValue: previous,
        newValue: enabled,
        changedBy: currentUser?.id ?? null,
      };
      const auditChange = (): void =>
        logAudit(
          "service_entitlement.global",
          `${enabled ? "Enabled" : "Disabled"} ${def.name} globally.`,
          null,
        );

      // Authoritative (app builds): commit to Supabase FIRST then refetch — NO
      // localStorage authority, NO browser-domain mirror; a failed write changes
      // nothing and surfaces the error.
      if (entitlementsSupabaseAuthoritative) {
        try {
          if (isPreferredTimeBridge) {
            writeSystemSettingsBridge();
          } else {
            await upsertGlobalEntitlementInSupabase(nextGlobal);
          }
          await appendEntitlementLogInSupabase({
            ...logPart,
            id: makeId("ent"),
            changedAt: new Date().toISOString(),
          });
        } catch (err) {
          return {
            ok: false,
            error:
              err instanceof Error
                ? err.message
                : "Failed to update global availability.",
          };
        }
        bumpEntitlementDirectoryRefresh();
        auditChange();
        return { ok: true };
      }

      // Legacy localStorage path (flag OFF / vitest / rollback).
      if (isPreferredTimeBridge) {
        writeSystemSettingsBridge();
      } else {
        const others = serviceGlobalEntitlements.filter(
          (g) => g.serviceKey !== serviceKey,
        );
        persistServiceGlobalEntitlements([...others, nextGlobal]);
      }
      appendServiceEntitlementLog(logPart);
      auditChange();
      return { ok: true };
    },
    [
      currentUser,
      systemSettings,
      serviceGlobalEntitlements,
      entitlementsSupabaseAuthoritative,
      persistServiceGlobalEntitlements,
      appendServiceEntitlementLog,
      logAudit,
    ],
  );

  const getCompanyServiceStatus = useCallback<
    AppContextValue["getCompanyServiceStatus"]
  >(
    (companyId, serviceKey) =>
      entitlementAccessors.getCompanyServiceStatus(companyId, serviceKey),
    [entitlementAccessors],
  );

  const getEffectiveCompanyServiceStatus = useCallback<
    AppContextValue["getEffectiveCompanyServiceStatus"]
  >(
    (companyId, serviceKey) =>
      entitlementAccessors.getEffectiveCompanyServiceStatus(companyId, serviceKey),
    [entitlementAccessors],
  );

  /**
   * Core tri-state entitlement setter. Writes the company's status, keeps the
   * legacy `enabled` flag in sync, stamps the relevant timestamps, and records
   * the appropriate change-log + audit entries (including trial transitions).
   */
  const setCompanyServiceStatus = useCallback<
    AppContextValue["setCompanyServiceStatus"]
  >(
    async (companyId, serviceKey, status) => {
      if (currentUser?.role !== "super_admin") {
        return { ok: false, error: FORBIDDEN_MESSAGE };
      }
      const def = getServiceDefinition(serviceKey);
      if (!def) return { ok: false, error: "Unknown service." };
      if (status === "trial" && !def.supportsTrial) {
        return { ok: false, error: `${def.name} does not support a trial.` };
      }
      const existing = companyServiceEntitlements.find(
        (e) => e.companyId === companyId && e.serviceKey === serviceKey,
      );
      const previousStatus = resolveCompanyEntitlementStatus(
        serviceKey,
        companyId,
        companyServiceEntitlements,
      );
      if (previousStatus === status) return { ok: true };
      const previouslyEntitled = previousStatus !== "disabled";
      const enabled = status !== "disabled";
      const now = new Date().toISOString();
      const next: CompanyServiceEntitlement = {
        companyId,
        serviceKey,
        status,
        enabled,
        enabledAt: enabled ? existing?.enabledAt ?? now : existing?.enabledAt ?? null,
        disabledAt: enabled ? null : now,
        trialStartedAt:
          status === "trial" ? now : existing?.trialStartedAt ?? null,
        trialEndedAt:
          previousStatus === "trial" && status !== "trial"
            ? now
            : existing?.trialEndedAt ?? null,
        updatedBy: currentUser?.id ?? null,
        updatedAt: now,
      };
      const others = companyServiceEntitlements.filter(
        (e) => !(e.companyId === companyId && e.serviceKey === serviceKey),
      );

      // The 0-2 log lines this transition records (a trial transition and/or an
      // access change), shared by both the authoritative and legacy paths.
      const logParts: Array<Omit<ServiceEntitlementLogEntry, "id" | "changedAt">> = [];
      if (status === "trial") {
        logParts.push({
          serviceKey,
          companyId,
          action: "company_trial_started",
          previousValue: previouslyEntitled,
          newValue: true,
          changedBy: currentUser?.id ?? null,
        });
      } else if (previousStatus === "trial") {
        logParts.push({
          serviceKey,
          companyId,
          action: "company_trial_ended",
          previousValue: true,
          newValue: enabled,
          changedBy: currentUser?.id ?? null,
        });
      }
      if (previouslyEntitled !== enabled && status !== "trial") {
        logParts.push({
          serviceKey,
          companyId,
          action: enabled ? "company_enabled" : "company_disabled",
          previousValue: previouslyEntitled,
          newValue: enabled,
          changedBy: currentUser?.id ?? null,
        });
      }
      const auditChange = (): void =>
        logAudit(
          "service_entitlement.company",
          `Set ${def.name} to ${status} for a company.`,
          companyId,
        );

      // Authoritative (app builds): commit the entitlement + its log lines to
      // Supabase FIRST then refetch — NO localStorage authority, NO browser-domain
      // mirror; a failed write changes nothing and surfaces the error.
      if (entitlementsSupabaseAuthoritative) {
        try {
          await upsertCompanyEntitlementInSupabase(next);
          for (const part of logParts) {
            await appendEntitlementLogInSupabase({
              ...part,
              id: makeId("ent"),
              changedAt: new Date().toISOString(),
            });
          }
        } catch (err) {
          return {
            ok: false,
            error:
              err instanceof Error
                ? err.message
                : "Failed to update the company's service access.",
          };
        }
        bumpEntitlementDirectoryRefresh();
        auditChange();
        return { ok: true };
      }

      // Legacy localStorage path (flag OFF / vitest / rollback).
      persistCompanyServiceEntitlements([...others, next]);
      for (const part of logParts) appendServiceEntitlementLog(part);
      auditChange();
      return { ok: true };
    },
    [
      currentUser,
      systemSettings,
      companyServiceEntitlements,
      entitlementsSupabaseAuthoritative,
      persistCompanyServiceEntitlements,
      appendServiceEntitlementLog,
      logAudit,
    ],
  );

  const setCompanyServiceEntitlement = useCallback<
    AppContextValue["setCompanyServiceEntitlement"]
  >(
    (companyId, serviceKey, enabled) =>
      setCompanyServiceStatus(companyId, serviceKey, enabled ? "enabled" : "disabled"),
    [setCompanyServiceStatus],
  );

  const getCompanyMediaUsage = useCallback<AppContextValue["getCompanyMediaUsage"]>(
    (companyId) => {
      if (!currentUser) {
        return { count: 0, storedBytes: 0, byCategory: [] };
      }
      return summarizeCompanyMediaUsage(
        currentUser,
        getUserPermissions(currentUser),
        companyId,
      );
    },
    [currentUser, getUserPermissions],
  );

  const evaluateMediaUploadGate = useCallback<
    AppContextValue["evaluateMediaUploadGate"]
  >(
    (companyId) => {
      const status = resolveEffectiveCompanyStatus(MEDIA_UPLOADS_KEY, companyId, {
        systemSettings,
        globalEntitlements: serviceGlobalEntitlements,
        companyEntitlements: companyServiceEntitlements,
      });
      const usage = getCompanyMediaUsage(companyId);
      return evaluateUsageGate(MEDIA_UPLOADS_KEY, status, usage.count);
    },
    [
      systemSettings,
      serviceGlobalEntitlements,
      companyServiceEntitlements,
      getCompanyMediaUsage,
    ],
  );

  /** Time reports the signed-in user may see (scoped through the parent work order). */
  const visibleTimeReports = useMemo<TimeReport[]>(() => {
    const allowed = new Set(
      workOrders.filter((w) => canAccessCustomer(w.customerId)).map((w) => w.id),
    );
    return timeReports.filter((r) => allowed.has(r.workOrderId));
  }, [timeReports, workOrders, canAccessCustomer]);

  const getTimeReportsForWorkOrder = useCallback<AppContextValue["getTimeReportsForWorkOrder"]>(
    (workOrderId) => {
      const order = workOrders.find((w) => w.id === workOrderId);
      if (!order || !canAccessCustomer(order.customerId)) return [];
      return timeReports
        .filter((r) => r.workOrderId === workOrderId)
        .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
    },
    [timeReports, workOrders, canAccessCustomer],
  );

  /**
   * Re-derives a Booking Queue item's display values from its source work order
   * and service row, which remain the single source of truth. Snapshot fields
   * (service, date, planned times, duration, employees, recurrence, assignment
   * status) plus the work-order number and customer name are refreshed; the
   * item's booking-level fields (cancellation, reschedule, schedule placement)
   * are preserved. Items whose source row no longer exists keep their stored
   * snapshot so nothing silently disappears.
   */
  const syncBookingItem = useCallback(
    (item: BookingQueueItem): BookingQueueItem => {
      const order = workOrders.find((w) => w.id === item.workOrderId);
      const row = order?.serviceRows?.find((r) => r.id === item.serviceRowId);
      if (!order || !row) return item;
      const snapshot = buildBookingSnapshot(
        row,
        (eid) => employees.find((e) => e.id === eid)?.name,
      );
      const customerName =
        customers.find((c) => c.id === order.customerId)?.name ?? item.customerName;
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
    },
    [workOrders, employees, customers],
  );

  /** Booking Queue items the signed-in user may see (scoped through the parent work order). */
  const visibleBookingQueue = useMemo<BookingQueueItem[]>(() => {
    const allowed = new Set(
      workOrders.filter((w) => canAccessCustomer(w.customerId)).map((w) => w.id),
    );
    return bookingQueue
      .filter((b) => allowed.has(b.workOrderId))
      .map(syncBookingItem)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [bookingQueue, workOrders, canAccessCustomer, syncBookingItem]);

  const getBookingQueueForWorkOrder = useCallback<AppContextValue["getBookingQueueForWorkOrder"]>(
    (workOrderId) => {
      const order = workOrders.find((w) => w.id === workOrderId);
      if (!order || !canAccessCustomer(order.customerId)) return [];
      return bookingQueue
        .filter((b) => b.workOrderId === workOrderId)
        .map(syncBookingItem)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    [bookingQueue, workOrders, canAccessCustomer, syncBookingItem],
  );

  const cancelBooking = useCallback<AppContextValue["cancelBooking"]>(
    (id, reason) => {
      const item = bookingQueue.find((b) => b.id === id);
      if (!item) return { ok: false, error: "Booking not found." };
      if (!canAccessCustomer(item.customerId)) return { ok: false, error: FORBIDDEN_MESSAGE };
      if (item.cancelledAt) return { ok: true };
      const now = new Date().toISOString();
      const trimmedReason = reason?.trim() || undefined;
      persistBookingQueue(
        bookingQueue.map((b) =>
          b.id === id
            ? { ...b, cancelledAt: now, cancelReason: trimmedReason ?? null, updatedAt: now }
            : b,
        ),
      );
      const summary = `Booking cancelled: ${item.serviceName}${trimmedReason ? ` — ${trimmedReason}` : ""}`;
      const entry = buildActivity("booking_cancelled", summary);
      persistWorkOrders(
        workOrders.map((w) =>
          w.id === item.workOrderId
            ? { ...w, activity: [...(w.activity ?? []), entry], updatedAt: now }
            : w,
        ),
      );
      logAudit(
        "bookingqueue.cancel",
        `Cancelled Booking Queue item “${item.serviceName}” (${item.workOrderNumber}).`,
        item.companyId,
      );
      return { ok: true };
    },
    [bookingQueue, workOrders, canAccessCustomer, persistBookingQueue, persistWorkOrders, buildActivity, logAudit],
  );

  const restoreBooking = useCallback<AppContextValue["restoreBooking"]>(
    (id) => {
      const item = bookingQueue.find((b) => b.id === id);
      if (!item) return { ok: false, error: "Booking not found." };
      if (!canAccessCustomer(item.customerId)) return { ok: false, error: FORBIDDEN_MESSAGE };
      if (!item.cancelledAt) return { ok: true };
      const now = new Date().toISOString();
      persistBookingQueue(
        bookingQueue.map((b) =>
          b.id === id ? { ...b, cancelledAt: null, cancelReason: null, updatedAt: now } : b,
        ),
      );
      const entry = buildActivity("booking_restored", `Booking restored: ${item.serviceName}`);
      persistWorkOrders(
        workOrders.map((w) =>
          w.id === item.workOrderId
            ? { ...w, activity: [...(w.activity ?? []), entry], updatedAt: now }
            : w,
        ),
      );
      logAudit(
        "bookingqueue.restore",
        `Restored Booking Queue item “${item.serviceName}” (${item.workOrderNumber}).`,
        item.companyId,
      );
      return { ok: true };
    },
    [bookingQueue, workOrders, canAccessCustomer, persistBookingQueue, persistWorkOrders, buildActivity, logAudit],
  );

  /**
   * Resolves the work order + service row that owns an occurrence's parent
   * service row, so per-occurrence dispatcher actions can write activity/audit
   * against the correct work order. Returns null for orphaned occurrences whose
   * row no longer exists (logging is skipped, the overlay write still applies).
   */
  const findServiceRowLocation = useCallback(
    (parentServiceRowId: string) => {
      for (const wo of workOrders) {
        const row = (wo.serviceRows ?? []).find((r) => r.id === parentServiceRowId);
        if (row) return { workOrder: wo, row };
      }
      return null;
    },
    [workOrders],
  );

  /** Appends a work-order activity entry + audit record for an occurrence action. */
  const logOccurrenceAction = useCallback(
    (
      parentServiceRowId: string,
      occurrenceDate: string,
      build: (meta: {
        serviceName: string;
        workOrderNumber: string;
        occurrenceDate: string;
      }) => {
        activityAction: WorkOrderActivity["action"];
        activitySummary: string;
        auditAction: AuditAction;
        auditSummary: string;
      },
    ) => {
      const loc = findServiceRowLocation(parentServiceRowId);
      if (!loc) return;
      const log = build({
        serviceName: loc.row.serviceName,
        workOrderNumber: loc.workOrder.number,
        occurrenceDate,
      });
      const now = new Date().toISOString();
      const entry = buildActivity(log.activityAction, log.activitySummary);
      persistWorkOrders(
        workOrders.map((w) =>
          w.id === loc.workOrder.id
            ? { ...w, activity: [...(w.activity ?? []), entry], updatedAt: now }
            : w,
        ),
      );
      logAudit(log.auditAction, log.auditSummary, loc.workOrder.companyId);
    },
    [workOrders, findServiceRowLocation, buildActivity, persistWorkOrders, logAudit],
  );

  const cancelOccurrence = useCallback<AppContextValue["cancelOccurrence"]>(
    (occurrenceKey) => {
      if (!occurrenceKey) return { ok: false, error: "Occurrence not found." };
      const now = new Date().toISOString();
      const existing = bookingOccurrenceExceptions.find(
        (e) => e.occurrenceKey === occurrenceKey,
      );
      // Already cancelled — nothing to do; never create a duplicate exception.
      if (existing?.status === "cancelled") return { ok: true };
      // Derive the occurrence's parent service row + date from the stable key
      // (`parentServiceRowId:occurrenceDate`). The date is the trailing segment.
      const sep = occurrenceKey.lastIndexOf(":");
      const parentServiceRowId = sep >= 0 ? occurrenceKey.slice(0, sep) : occurrenceKey;
      const occurrenceDate = sep >= 0 ? occurrenceKey.slice(sep + 1) : "";
      const next: BookingOccurrenceException[] = existing
        ? bookingOccurrenceExceptions.map((e) =>
            e.occurrenceKey === occurrenceKey
              ? { ...e, status: "cancelled" as const, updatedAt: now }
              : e,
          )
        : [
            {
              id: makeId("bocc"),
              occurrenceKey,
              parentServiceRowId,
              occurrenceDate,
              status: "cancelled" as const,
              createdAt: now,
              updatedAt: now,
            },
            ...bookingOccurrenceExceptions,
          ];
      // Only the exception overlay is written — the work order service row and
      // every sibling occurrence in the series are left untouched.
      persistBookingOccurrenceExceptions(next);
      logOccurrenceAction(parentServiceRowId, occurrenceDate, describeOccurrenceCancel);
      return { ok: true };
    },
    [bookingOccurrenceExceptions, persistBookingOccurrenceExceptions, logOccurrenceAction],
  );

  const restoreOccurrence = useCallback<AppContextValue["restoreOccurrence"]>(
    (occurrenceKey) => {
      if (!occurrenceKey) return { ok: false, error: "Occurrence not found." };
      const existing = bookingOccurrenceExceptions.find(
        (e) => e.occurrenceKey === occurrenceKey && e.status === "cancelled",
      );
      // No cancelled exception — already active; nothing to do.
      if (!existing) return { ok: true };
      // Removing the exception returns the occurrence to its base-rule (active)
      // state; only this occurrence is affected. The work order service row and
      // every sibling occurrence in the series are left untouched.
      persistBookingOccurrenceExceptions(
        bookingOccurrenceExceptions.filter(
          (e) => e.occurrenceKey !== occurrenceKey,
        ),
      );
      logOccurrenceAction(
        existing.parentServiceRowId,
        existing.occurrenceDate,
        describeOccurrenceRestore,
      );
      return { ok: true };
    },
    [bookingOccurrenceExceptions, persistBookingOccurrenceExceptions, logOccurrenceAction],
  );

  const rescheduleOccurrence = useCallback<AppContextValue["rescheduleOccurrence"]>(
    (occurrenceKey, input) => {
      if (!occurrenceKey) return { ok: false, error: "Occurrence not found." };
      const newDate = input.newDate?.trim();
      if (!newDate || !/^\d{4}-\d{2}-\d{2}$/.test(newDate)) {
        return { ok: false, error: "Pick a valid new date." };
      }
      const now = new Date().toISOString();
      // Derive the occurrence's parent service row + original date from the
      // stable key (`parentServiceRowId:occurrenceDate`).
      const sep = occurrenceKey.lastIndexOf(":");
      const parentServiceRowId = sep >= 0 ? occurrenceKey.slice(0, sep) : occurrenceKey;
      const occurrenceDate = sep >= 0 ? occurrenceKey.slice(sep + 1) : "";
      const newStartTime = input.newStartTime?.trim() || null;
      const newEndTime = input.newEndTime?.trim() || null;
      const existing = bookingOccurrenceExceptions.find(
        (e) => e.occurrenceKey === occurrenceKey,
      );
      // Moving back to the original date with no time change clears the move so
      // the occurrence simply follows the base rule again (no stale exception).
      if (newDate === occurrenceDate && !newStartTime && !newEndTime) {
        if (!existing) return { ok: true };
        persistBookingOccurrenceExceptions(
          bookingOccurrenceExceptions.filter((e) => e.occurrenceKey !== occurrenceKey),
        );
        logOccurrenceAction(parentServiceRowId, occurrenceDate, (meta) =>
          describeOccurrenceReschedule(meta, newDate),
        );
        return { ok: true };
      }
      const next: BookingOccurrenceException[] = existing
        ? bookingOccurrenceExceptions.map((e) =>
            e.occurrenceKey === occurrenceKey
              ? {
                  ...e,
                  status: "rescheduled" as const,
                  overrideOccurrenceDate: newDate,
                  overrideStartTime: newStartTime,
                  overrideEndTime: newEndTime,
                  updatedAt: now,
                }
              : e,
          )
        : [
            {
              id: makeId("bocc"),
              occurrenceKey,
              parentServiceRowId,
              occurrenceDate,
              status: "rescheduled" as const,
              overrideOccurrenceDate: newDate,
              overrideStartTime: newStartTime,
              overrideEndTime: newEndTime,
              createdAt: now,
              updatedAt: now,
            },
            ...bookingOccurrenceExceptions,
          ];
      // Only the exception overlay is written — the work order service row, the
      // recurrence rule and every sibling occurrence are left untouched.
      persistBookingOccurrenceExceptions(next);
      logOccurrenceAction(parentServiceRowId, occurrenceDate, (meta) =>
        describeOccurrenceReschedule(meta, newDate),
      );
      return { ok: true };
    },
    [bookingOccurrenceExceptions, persistBookingOccurrenceExceptions, logOccurrenceAction],
  );

  const reassignOccurrence = useCallback<AppContextValue["reassignOccurrence"]>(
    (occurrenceKey, input) => {
      if (!occurrenceKey) return { ok: false, error: "Occurrence not found." };
      const now = new Date().toISOString();
      // Derive the parent service row + identity date from the stable key
      // (`parentServiceRowId:occurrenceDate`).
      const sep = occurrenceKey.lastIndexOf(":");
      const parentServiceRowId = sep >= 0 ? occurrenceKey.slice(0, sep) : occurrenceKey;
      const occurrenceDate = sep >= 0 ? occurrenceKey.slice(sep + 1) : "";
      const assignedEmployeeIds = Array.isArray(input.assignedEmployeeIds)
        ? input.assignedEmployeeIds.filter(
            (id): id is string => typeof id === "string" && id.length > 0,
          )
        : [];
      const overrideUnassignedEmployeeSlots =
        typeof input.unassignedEmployeeSlots === "number"
          ? normalizeUnassignedSlots(input.unassignedEmployeeSlots)
          : null;
      const rawLabour = input.totalLabourMinutes;
      const overrideTotalLabourMinutes =
        typeof rawLabour === "number" && Number.isFinite(rawLabour) && rawLabour > 0
          ? rawLabour
          : null;
      // A booking must never silently require nobody.
      if (assignedEmployeeIds.length === 0 && (overrideUnassignedEmployeeSlots ?? 0) === 0) {
        return {
          ok: false,
          error: "A booking occurrence needs at least one assigned employee or open slot.",
        };
      }
      const existing = bookingOccurrenceExceptions.find(
        (e) => e.occurrenceKey === occurrenceKey,
      );
      const next: BookingOccurrenceException[] = existing
        ? bookingOccurrenceExceptions.map((e) =>
            e.occurrenceKey === occurrenceKey
              ? {
                  ...e,
                  // Preserve any cancel/reschedule overlay already on this
                  // occurrence; only set the staffing override fields.
                  overrideAssignedEmployeeIds: assignedEmployeeIds,
                  overrideUnassignedEmployeeSlots,
                  overrideTotalLabourMinutes,
                  updatedAt: now,
                }
              : e,
          )
        : [
            {
              id: makeId("bocc"),
              occurrenceKey,
              parentServiceRowId,
              occurrenceDate,
              status: "active" as const,
              overrideAssignedEmployeeIds: assignedEmployeeIds,
              overrideUnassignedEmployeeSlots,
              overrideTotalLabourMinutes,
              createdAt: now,
              updatedAt: now,
            },
            ...bookingOccurrenceExceptions,
          ];
      // Only the exception overlay is written — the work order service row, the
      // recurrence rule and every sibling occurrence are left untouched.
      persistBookingOccurrenceExceptions(next);
      logOccurrenceAction(parentServiceRowId, occurrenceDate, (meta) =>
        describeOccurrenceReassign(meta, assignedEmployeeIds.length),
      );
      return { ok: true };
    },
    [bookingOccurrenceExceptions, persistBookingOccurrenceExceptions, logOccurrenceAction],
  );

  const clearOccurrenceAssignment = useCallback<AppContextValue["clearOccurrenceAssignment"]>(
    (occurrenceKey) => {
      if (!occurrenceKey) return { ok: false, error: "Occurrence not found." };
      const existing = bookingOccurrenceExceptions.find(
        (e) => e.occurrenceKey === occurrenceKey,
      );
      // No staffing override present — nothing to clear.
      if (!existing || !occurrenceExceptionHasStaffingOverride(existing)) return { ok: true };
      const now = new Date().toISOString();
      // If the occurrence carries no other overlay (still "active" after dropping
      // the staffing override), remove the exception entirely so the occurrence
      // follows the series rule again. Otherwise keep the cancel/reschedule
      // overlay and only strip the staffing override fields.
      const keepsOverlay =
        existing.status === "cancelled" || existing.status === "rescheduled";
      const next: BookingOccurrenceException[] = keepsOverlay
        ? bookingOccurrenceExceptions.map((e) =>
            e.occurrenceKey === occurrenceKey
              ? {
                  ...e,
                  overrideAssignedEmployeeIds: null,
                  overrideUnassignedEmployeeSlots: null,
                  overrideTotalLabourMinutes: null,
                  updatedAt: now,
                }
              : e,
          )
        : bookingOccurrenceExceptions.filter((e) => e.occurrenceKey !== occurrenceKey);
      persistBookingOccurrenceExceptions(next);
      logOccurrenceAction(
        existing.parentServiceRowId,
        existing.occurrenceDate,
        describeOccurrenceReassignCleared,
      );
      return { ok: true };
    },
    [bookingOccurrenceExceptions, persistBookingOccurrenceExceptions, logOccurrenceAction],
  );

  const rescheduleBooking = useCallback<AppContextValue["rescheduleBooking"]>(
    (id, input) => {
      const item = bookingQueue.find((b) => b.id === id);
      if (!item) return { ok: false, error: "Booking not found." };
      if (!canAccessCustomer(item.customerId)) return { ok: false, error: FORBIDDEN_MESSAGE };
      const newDate = input.newDate?.trim();
      if (!newDate || !/^\d{4}-\d{2}-\d{2}$/.test(newDate)) {
        return { ok: false, error: "Pick a valid new date." };
      }
      // The booking-level reschedule now writes a BookingOccurrenceException —
      // the SINGLE source of truth read by Schedule Core, Schedule, Schedule Lab
      // and the Booking Queue — instead of the legacy `item.reschedule` overlay.
      // The occurrence is keyed on its rule (identity) date, which the occurrence
      // generator anchors to. `item.reschedule` is never written again.
      const ruleDate =
        item.serviceDate && /^\d{4}-\d{2}-\d{2}$/.test(item.serviceDate)
          ? item.serviceDate
          : null;
      if (!ruleDate) {
        return { ok: false, error: "This booking has no schedulable date." };
      }
      const now = new Date().toISOString();
      const occurrenceKey = makeOccurrenceKey(item.serviceRowId, ruleDate);
      const existing = bookingOccurrenceExceptions.find(
        (e) => e.occurrenceKey === occurrenceKey,
      );

      // Moving back to the rule date clears any move so the occurrence follows
      // the base rule again (no stale exception left behind).
      if (newDate === ruleDate) {
        if (existing) {
          persistBookingOccurrenceExceptions(
            bookingOccurrenceExceptions.filter((e) => e.occurrenceKey !== occurrenceKey),
          );
        }
      } else {
        const next: BookingOccurrenceException[] = existing
          ? bookingOccurrenceExceptions.map((e) =>
              e.occurrenceKey === occurrenceKey
                ? {
                    ...e,
                    status: "rescheduled" as const,
                    overrideOccurrenceDate: newDate,
                    updatedAt: now,
                  }
                : e,
            )
          : [
              {
                id: makeId("bocc"),
                occurrenceKey,
                parentServiceRowId: item.serviceRowId,
                occurrenceDate: ruleDate,
                status: "rescheduled" as const,
                overrideOccurrenceDate: newDate,
                overrideStartTime: null,
                overrideEndTime: null,
                createdAt: now,
                updatedAt: now,
              },
              ...bookingOccurrenceExceptions,
            ];
        persistBookingOccurrenceExceptions(next);
      }

      const reason = input.reason?.trim();
      const summary = `Booking rescheduled: ${item.serviceName} → ${formatDate(`${newDate}T00:00:00`)}${
        input.oneTime ? " (one-time change)" : ""
      }${reason ? ` — ${reason}` : ""}`;
      const entry = buildActivity("booking_rescheduled", summary);
      persistWorkOrders(
        workOrders.map((w) =>
          w.id === item.workOrderId
            ? { ...w, activity: [...(w.activity ?? []), entry], updatedAt: now }
            : w,
        ),
      );
      logAudit(
        "bookingqueue.reschedule",
        `Rescheduled Booking Queue item “${item.serviceName}” (${item.workOrderNumber}) to ${formatDate(`${newDate}T00:00:00`)}.`,
        item.companyId,
      );
      return { ok: true };
    },
    [
      bookingQueue,
      workOrders,
      bookingOccurrenceExceptions,
      canAccessCustomer,
      persistBookingOccurrenceExceptions,
      persistWorkOrders,
      buildActivity,
      logAudit,
    ],
  );

  const submitTimeReportCheckout = useCallback<AppContextValue["submitTimeReportCheckout"]>(
    (input) => {
      const order = workOrders.find((w) => w.id === input.workOrderId);
      if (!order) return { ok: false, error: "Work order not found." };
      if (!canAccessCustomer(order.customerId)) return { ok: false, error: FORBIDDEN_MESSAGE };

      const scheduledMinutes = Math.round(input.scheduledMinutes);
      const actualMinutes = Math.round(input.actualMinutes);
      if (!Number.isFinite(scheduledMinutes) || scheduledMinutes < 0) {
        return { ok: false, error: "Scheduled time must be 0 minutes or more." };
      }
      if (!Number.isFinite(actualMinutes) || actualMinutes < 0) {
        return { ok: false, error: "Actual time must be 0 minutes or more." };
      }

      const settings = getTimeReportSettingsFor(order.companyId);
      const now = new Date().toISOString();
      const { deviationMinutes, approvalStatus, approvedBy, approvedAt } = resolveTimeReportCheckout(
        settings,
        scheduledMinutes,
        actualMinutes,
        now,
      );

      const row = input.serviceRowId
        ? (order.serviceRows ?? []).find((r) => r.id === input.serviceRowId)
        : undefined;
      const jobName = input.jobName?.trim() || row?.serviceName || order.title || order.number;
      const employeeName = input.employeeName?.trim() || currentUser?.name || "Employee";
      const employeeId =
        input.employeeId !== undefined ? input.employeeId : currentUser?.id ?? null;

      const { billableDeviationMinutes, internalDeviationMinutes } =
        defaultDeviationAllocation(deviationMinutes);
      const statusLabel = TIME_REPORT_APPROVAL_STATUS_LABELS[approvalStatus];
      const checkoutEntry = buildTimeReportAuditEntry({
        action: "checked_out",
        description: `${employeeName} checked out of ${jobName}: ${actualMinutes} min vs ${scheduledMinutes} min scheduled (deviation ${deviationMinutes} min).`,
        actor: employeeName,
        at: now,
        snapshot: {
          deviationMinutes,
          billableDeviationMinutes,
          internalDeviationMinutes,
          approvalStatus,
        },
      });
      const auditHistory =
        approvalStatus === "auto_approved"
          ? [
              checkoutEntry,
              buildTimeReportAuditEntry({
                action: "auto_approved",
                description: `Auto approved — deviation ${deviationMinutes} min within tolerance.`,
                actor: TIME_REPORT_SYSTEM_APPROVER,
                at: now,
                snapshot: {
                  deviationMinutes,
                  billableDeviationMinutes,
                  internalDeviationMinutes,
                  approvalStatus,
                },
              }),
            ]
          : [
              checkoutEntry,
              buildTimeReportAuditEntry({
                action: "submitted_for_review",
                description: `Submitted for administrator review — deviation ${deviationMinutes} min exceeds tolerance.`,
                actor: employeeName,
                at: now,
                snapshot: {
                  deviationMinutes,
                  billableDeviationMinutes,
                  internalDeviationMinutes,
                  approvalStatus,
                },
              }),
            ];

      const report: TimeReport = {
        id: makeId("trep"),
        companyId: order.companyId,
        workOrderId: order.id,
        serviceRowId: input.serviceRowId ?? null,
        jobName,
        employeeId,
        employeeName,
        scheduledMinutes,
        actualMinutes,
        deviationMinutes,
        bookingId: null,
        billableDeviationMinutes,
        internalDeviationMinutes,
        deviationReason: null,
        deviationComment: null,
        auditHistory,
        approvalStatus,
        approvedBy,
        approvedAt,
        submittedAt: now,
        createdAt: now,
        updatedAt: now,
      };

      persistTimeReports([report, ...timeReports]);
      // Mission Log checkout dual-write (Slice 2c-1) — fire-and-forget mirror of
      // this checkout into the execution ledger, gated by MISSION_LOG_DUAL_WRITE
      // (default OFF). The legacy checkout above is authoritative and has already
      // succeeded; a Supabase mirror failure is recorded in the Mission Log
      // cut-over state and never surfaced here.
      if (shouldRunBrowserDomainMirror(shouldMirrorMissionLogCheckout())) {
        void mirrorMissionLogCheckout(report, { customerId: order.customerId });
      }
      // Time Reporting checkout dual-write (Slice 2c-2a) — fire-and-forget mirror
      // of this checkout into the Time Reporting CORE tables, gated by
      // TIME_REPORTING_DUAL_WRITE (default OFF). The legacy checkout above is
      // authoritative and has already succeeded; a Supabase mirror failure is
      // recorded in the Time Reporting cut-over state and never surfaced here.
      if (shouldRunBrowserDomainMirror(shouldMirrorTimeReportingCheckout())) {
        void mirrorTimeReportingCheckout(report, { customerId: order.customerId });
      }
      const entry = buildActivity(
        "time_reported",
        `Time report for ${jobName}: ${actualMinutes} min vs ${scheduledMinutes} min scheduled (deviation ${deviationMinutes} min) — ${statusLabel}`,
      );
      persistWorkOrders(
        workOrders.map((w) =>
          w.id === order.id
            ? { ...w, updatedAt: now, activity: [...(w.activity ?? []), entry] }
            : w,
        ),
      );
      logAudit(
        "workorder.timereport",
        `Time report submitted for ${order.number} (${statusLabel}).`,
        order.companyId,
      );
      return { ok: true, report };
    },
    [
      workOrders,
      timeReports,
      canAccessCustomer,
      getTimeReportSettingsFor,
      persistTimeReports,
      persistWorkOrders,
      buildActivity,
      logAudit,
      currentUser,
    ],
  );

  const getWorkOrder = useCallback<AppContextValue["getWorkOrder"]>(
    (id) => {
      const order = workOrders.find((w) => w.id === id);
      if (!order) return null;
      if (!canAccessCustomer(order.customerId)) return null;
      return order;
    },
    [workOrders, canAccessCustomer],
  );

  // ── Remote-only detail hydration (read/action consistency) ──
  // Phase 1 safety: Supabase-resolved records may be copied into React memory so
  // action/access seams can operate during the active session, but they are never
  // persisted back into browser storage and never mirrored back to Supabase.
  const hydrateCustomerFromRemote = useCallback<
    AppContextValue["hydrateCustomerFromRemote"]
  >((customer) => {
    setCustomers((prev) => {
      const { list, changed } = reconcileHydratedRecord(prev, customer);
      if (!changed) return prev;
      return list;
    });
  }, []);

  const hydrateCustomersFromRemote = useCallback<
    AppContextValue["hydrateCustomersFromRemote"]
  >((records) => {
    if (records.length === 0) return;
    setCustomers((prev) => {
      const { list, changed } = reconcileHydratedRecords(prev, records);
      if (!changed) return prev;
      return list;
    });
  }, []);

  const hydrateWorkOrderFromRemote = useCallback<
    AppContextValue["hydrateWorkOrderFromRemote"]
  >((workOrder) => {
    setWorkOrders((prev) => {
      const { list, changed } = reconcileHydratedRecord(prev, workOrder);
      if (!changed) return prev;
      return list;
    });
  }, []);

  const updateWorkOrder = useCallback<AppContextValue["updateWorkOrder"]>(
    (id, patch) => {
      const order = workOrders.find((w) => w.id === id);
      if (!order) return { ok: false, error: "Work order not found." };
      if (!canAccessCustomer(order.customerId)) return { ok: false, error: FORBIDDEN_MESSAGE };
      const now = new Date().toISOString();
      const entries: WorkOrderActivity[] = [];
      const nextTitle = patch.title !== undefined ? patch.title.trim() || undefined : order.title;
      if (patch.status !== undefined && patch.status !== order.status) {
        entries.push(
          buildActivity(
            "status_changed",
            `Status changed from ${WORK_ORDER_STATUS_LABELS[order.status]} to ${WORK_ORDER_STATUS_LABELS[patch.status]}`,
          ),
        );
      }
      const detailChanged =
        nextTitle !== order.title ||
        (patch.startDate !== undefined && patch.startDate !== order.startDate) ||
        (patch.endDate !== undefined && patch.endDate !== order.endDate);
      if (detailChanged) {
        entries.push(buildActivity("updated", "Work order details updated"));
      }
      if (entries.length === 0) return { ok: true };
      persistWorkOrders(
        workOrders.map((w) =>
          w.id === id
            ? {
                ...w,
                title: nextTitle,
                status: patch.status ?? w.status,
                startDate: patch.startDate !== undefined ? patch.startDate : w.startDate,
                endDate: patch.endDate !== undefined ? patch.endDate : w.endDate,
                updatedAt: now,
                activity: [...(w.activity ?? []), ...entries],
              }
            : w,
        ),
      );
      logAudit("workorder.update", `Updated work order ${order.number}.`, order.companyId);
      return { ok: true };
    },
    [workOrders, persistWorkOrders, canAccessCustomer, logAudit, buildActivity],
  );

  const addWorkOrderNote = useCallback<AppContextValue["addWorkOrderNote"]>(
    (id, input) => {
      const order = workOrders.find((w) => w.id === id);
      if (!order) return { ok: false, error: "Work order not found." };
      if (!canAccessCustomer(order.customerId)) return { ok: false, error: FORBIDDEN_MESSAGE };
      if (!input.title.trim() && !input.content.trim()) {
        return { ok: false, error: "Add a title or content." };
      }
      const now = new Date().toISOString();
      const note: WorkOrderNote = {
        id: makeId("wonote"),
        title: input.title.trim() || "Untitled note",
        content: input.content.trim(),
        authorId: currentUser?.id ?? null,
        authorName: currentUser?.name ?? "Admin",
        createdAt: now,
        updatedAt: now,
        status: "active",
      };
      const entry = buildActivity("note_added", `Note added: ${note.title}`);
      persistWorkOrders(
        workOrders.map((w) =>
          w.id === id
            ? { ...w, notes: [note, ...(w.notes ?? [])], updatedAt: now, activity: [...(w.activity ?? []), entry] }
            : w,
        ),
      );
      logAudit("workorder.note", `Added note to work order ${order.number}.`, order.companyId);
      return { ok: true };
    },
    [workOrders, persistWorkOrders, canAccessCustomer, logAudit, currentUser, buildActivity],
  );

  const updateWorkOrderNote = useCallback<AppContextValue["updateWorkOrderNote"]>(
    (id, noteId, patch) => {
      const order = workOrders.find((w) => w.id === id);
      if (!order) return { ok: false, error: "Work order not found." };
      if (!canAccessCustomer(order.customerId)) return { ok: false, error: FORBIDDEN_MESSAGE };
      const now = new Date().toISOString();
      const title = patch.title.trim() || "Untitled note";
      const entry = buildActivity("note_edited", `Note edited: ${title}`);
      persistWorkOrders(
        workOrders.map((w) =>
          w.id === id
            ? {
                ...w,
                notes: (w.notes ?? []).map((n) =>
                  n.id === noteId ? { ...n, title, content: patch.content.trim(), updatedAt: now } : n,
                ),
                updatedAt: now,
                activity: [...(w.activity ?? []), entry],
              }
            : w,
        ),
      );
      logAudit("workorder.note", `Edited note on work order ${order.number}.`, order.companyId);
      return { ok: true };
    },
    [workOrders, persistWorkOrders, canAccessCustomer, logAudit, buildActivity],
  );

  const setWorkOrderNoteArchived = useCallback<AppContextValue["setWorkOrderNoteArchived"]>(
    (id, noteId, archived) => {
      const order = workOrders.find((w) => w.id === id);
      if (!order) return { ok: false, error: "Work order not found." };
      if (!canAccessCustomer(order.customerId)) return { ok: false, error: FORBIDDEN_MESSAGE };
      const note = (order.notes ?? []).find((n) => n.id === noteId);
      if (!note) return { ok: false, error: "Note not found." };
      const now = new Date().toISOString();
      const entry = buildActivity(
        archived ? "note_archived" : "note_restored",
        `Note ${archived ? "archived" : "restored"}: ${note.title}`,
      );
      persistWorkOrders(
        workOrders.map((w) =>
          w.id === id
            ? {
                ...w,
                notes: (w.notes ?? []).map((n) =>
                  n.id === noteId ? { ...n, status: archived ? "inactive" : "active", updatedAt: now } : n,
                ),
                updatedAt: now,
                activity: [...(w.activity ?? []), entry],
              }
            : w,
        ),
      );
      logAudit("workorder.note", `${archived ? "Archived" : "Restored"} note on work order ${order.number}.`, order.companyId);
      return { ok: true };
    },
    [workOrders, persistWorkOrders, canAccessCustomer, logAudit, buildActivity],
  );

  const getServicesForCompany = useCallback<AppContextValue["getServicesForCompany"]>(
    (companyId) =>
      services
        .filter((s) => s.companyId === companyId && s.status === "active")
        .sort((a, b) => a.name.localeCompare(b.name)),
    [services],
  );

  const getServiceCategoriesForCompany = useCallback<
    AppContextValue["getServiceCategoriesForCompany"]
  >(
    (companyId) =>
      serviceCategories
        .filter((c) => c.companyId === companyId && c.status === "active")
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [serviceCategories],
  );

  const getCompanyServiceFavorites = useCallback<
    AppContextValue["getCompanyServiceFavorites"]
  >(
    (companyId) => {
      const favs = serviceFavorites
        .filter((f) => f.companyId === companyId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const result: Service[] = [];
      for (const fav of favs) {
        const service = services.find(
          (s) => s.id === fav.serviceId && s.companyId === companyId && s.status === "active",
        );
        if (service) result.push(service);
      }
      return result;
    },
    [serviceFavorites, services],
  );

  const isServiceFavorite = useCallback<AppContextValue["isServiceFavorite"]>(
    (companyId, serviceId) =>
      serviceFavorites.some(
        (f) => f.companyId === companyId && f.serviceId === serviceId,
      ),
    [serviceFavorites],
  );

  const toggleServiceFavorite = useCallback<AppContextValue["toggleServiceFavorite"]>(
    (companyId, serviceId) => {
      if (
        currentUser?.role === "company_admin" &&
        currentUser.companyId !== companyId
      ) {
        return { ok: false, error: FORBIDDEN_MESSAGE };
      }
      const exists = serviceFavorites.some(
        (f) => f.companyId === companyId && f.serviceId === serviceId,
      );
      if (exists) {
        persistServiceFavorites(
          serviceFavorites.filter(
            (f) => !(f.companyId === companyId && f.serviceId === serviceId),
          ),
        );
      } else {
        persistServiceFavorites([
          { companyId, serviceId, createdAt: new Date().toISOString() },
          ...serviceFavorites,
        ]);
      }
      return { ok: true };
    },
    [serviceFavorites, persistServiceFavorites, currentUser],
  );

  const addWorkOrderServiceRow = useCallback<AppContextValue["addWorkOrderServiceRow"]>(
    (id, input) => {
      const order = workOrders.find((w) => w.id === id);
      if (!order) return { ok: false, error: "Work order not found." };
      if (!canAccessCustomer(order.customerId)) return { ok: false, error: FORBIDDEN_MESSAGE };
      const name = input.serviceName.trim();
      if (!name) return { ok: false, error: "A service is required." };
      const serviceDate = input.serviceDate?.trim();
      if (!serviceDate) {
        return { ok: false, error: "A service date is required." };
      }
      const recurrenceInterval = input.recurrenceInterval ?? "one_time";
      // End date is only meaningful for recurring rows and must be on/after the
      // service date. One-time rows never carry an end date.
      const rawEnd = input.serviceEndDate?.trim();
      const serviceEndDate =
        recurrenceInterval !== "one_time" && rawEnd ? rawEnd : undefined;
      if (serviceEndDate && serviceEndDate < serviceDate) {
        return { ok: false, error: "The end date must be on or after the service date." };
      }
      const now = new Date().toISOString();
      const existing = order.serviceRows ?? [];
      const maxOrder = existing.reduce((m, r) => Math.max(m, r.sortOrder), -1);
      const row: WorkOrderServiceRow = {
        id: makeId("worow"),
        sourceServiceId: input.sourceServiceId ?? null,
        serviceName: name,
        articleNumber: input.articleNumber?.trim() || undefined,
        categoryName: input.categoryName?.trim() || undefined,
        serviceType: input.serviceType?.trim() || undefined,
        quantity: input.quantity,
        unit: input.unit?.trim() || undefined,
        price: input.price,
        vat: input.vat,
        status: input.status,
        notes: input.notes?.trim() || undefined,
        serviceDate,
        serviceEndDate,
        plannedStartTime: input.plannedStartTime?.trim() || undefined,
        plannedEndTime: input.plannedEndTime?.trim() || undefined,
        assignedEmployeeIds: input.assignedEmployeeIds ?? [],
        unassignedEmployeeSlots: normalizeUnassignedSlots(input.unassignedEmployeeSlots),
        recurrenceInterval,
        sortOrder: maxOrder + 1,
        createdAt: now,
        updatedAt: now,
      };
      // Every new service row enters the Booking Queue — the planning layer
      // between Work Orders and the future Schedule module. The item starts
      // Unassigned/Unscheduled and carries snapshot values for list display.
      const customerName =
        customers.find((c) => c.id === order.customerId)?.name ?? "Unknown customer";
      const snapshot = buildBookingSnapshot(
        row,
        (eid) => employees.find((e) => e.id === eid)?.name,
      );
      const bookingItem: BookingQueueItem = {
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
        reschedule: null,
        createdAt: now,
        updatedAt: now,
      };
      const entry = buildActivity("service_added", `Service added: ${name}`);
      const bookingEntry = buildActivity(
        "booking_queued",
        `Added to Booking Lists: ${name} (Unassigned · Unscheduled)`,
      );
      persistWorkOrders(
        workOrders.map((w) =>
          w.id === id
            ? {
                ...w,
                serviceRows: [...existing, row],
                updatedAt: now,
                activity: [...(w.activity ?? []), entry, bookingEntry],
              }
            : w,
        ),
      );
      persistBookingQueue([bookingItem, ...bookingQueue]);
      logAudit("workorder.service", `Added service “${name}” to work order ${order.number}.`, order.companyId);
      logAudit(
        "bookingqueue.create",
        `Booking Lists item created for “${name}” (${order.number}).`,
        order.companyId,
      );
      return { ok: true };
    },
    [
      workOrders,
      persistWorkOrders,
      canAccessCustomer,
      logAudit,
      buildActivity,
      customers,
      bookingQueue,
      persistBookingQueue,
      employees,
    ],
  );

  const updateWorkOrderServiceRow = useCallback<AppContextValue["updateWorkOrderServiceRow"]>(
    (id, rowId, patch) => {
      const order = workOrders.find((w) => w.id === id);
      if (!order) return { ok: false, error: "Work order not found." };
      if (!canAccessCustomer(order.customerId)) return { ok: false, error: FORBIDDEN_MESSAGE };
      const row = (order.serviceRows ?? []).find((r) => r.id === rowId);
      if (!row) return { ok: false, error: "Service row not found." };
      if (patch.serviceName !== undefined && !patch.serviceName.trim()) {
        return { ok: false, error: "A service is required." };
      }
      if (patch.serviceDate !== undefined && !patch.serviceDate.trim()) {
        return { ok: false, error: "A service date is required." };
      }
      // Normalize/validate the recurrence end date against the effective values.
      // One-time rows never keep an end date; recurring end dates must be on or
      // after the service date.
      const effectiveInterval =
        patch.recurrenceInterval ?? row.recurrenceInterval ?? "one_time";
      const effectiveServiceDate =
        patch.serviceDate !== undefined ? patch.serviceDate.trim() : row.serviceDate;
      let normalizedEnd: string | null | undefined;
      if (patch.serviceEndDate !== undefined || patch.recurrenceInterval !== undefined) {
        const rawEnd =
          patch.serviceEndDate !== undefined
            ? patch.serviceEndDate?.trim() || null
            : row.serviceEndDate?.trim() || null;
        normalizedEnd = effectiveInterval !== "one_time" ? rawEnd : null;
        if (normalizedEnd && effectiveServiceDate && normalizedEnd < effectiveServiceDate) {
          return { ok: false, error: "The end date must be on or after the service date." };
        }
      }
      const now = new Date().toISOString();
      const entry = buildActivity(
        "service_edited",
        `Service edited: ${patch.serviceName?.trim() || row.serviceName}`,
      );
      // The updated row is the source of truth; compute it once so we can both
      // persist it on the work order and re-sync the linked Booking Queue item.
      const updatedRow: WorkOrderServiceRow = {
        ...row,
        ...patch,
        serviceName:
          patch.serviceName !== undefined ? patch.serviceName.trim() : row.serviceName,
        serviceDate:
          patch.serviceDate !== undefined ? patch.serviceDate.trim() : row.serviceDate,
        serviceEndDate: normalizedEnd !== undefined ? normalizedEnd : row.serviceEndDate,
        updatedAt: now,
      };
      persistWorkOrders(
        workOrders.map((w) =>
          w.id === id
            ? {
                ...w,
                serviceRows: (w.serviceRows ?? []).map((r) =>
                  r.id === rowId ? updatedRow : r,
                ),
                updatedAt: now,
                activity: [...(w.activity ?? []), entry],
              }
            : w,
        ),
      );
      // Keep the linked Booking Queue item's stored snapshot in sync. Booking-
      // level fields (cancellation, reschedule, schedule placement) are left
      // untouched — only the service-row snapshot is refreshed.
      const snapshot = buildBookingSnapshot(
        updatedRow,
        (eid) => employees.find((e) => e.id === eid)?.name,
      );
      const linkedExists = bookingQueue.some(
        (b) => b.workOrderId === id && b.serviceRowId === rowId,
      );
      if (linkedExists) {
        persistBookingQueue(
          bookingQueue.map((b) =>
            b.workOrderId === id && b.serviceRowId === rowId
              ? {
                  ...b,
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
                  updatedAt: now,
                }
              : b,
          ),
        );
      }
      logAudit("workorder.service", `Edited a service on work order ${order.number}.`, order.companyId);
      return { ok: true };
    },
    [
      workOrders,
      persistWorkOrders,
      canAccessCustomer,
      logAudit,
      buildActivity,
      bookingQueue,
      persistBookingQueue,
      employees,
    ],
  );

  const setWorkOrderServiceRowArchived = useCallback<
    AppContextValue["setWorkOrderServiceRowArchived"]
  >(
    (id, rowId, archived) => {
      const order = workOrders.find((w) => w.id === id);
      if (!order) return { ok: false, error: "Work order not found." };
      if (!canAccessCustomer(order.customerId)) return { ok: false, error: FORBIDDEN_MESSAGE };
      const row = (order.serviceRows ?? []).find((r) => r.id === rowId);
      if (!row) return { ok: false, error: "Service row not found." };
      const now = new Date().toISOString();
      const entry = buildActivity(
        archived ? "service_archived" : "service_restored",
        `Service ${archived ? "archived" : "restored"}: ${row.serviceName}`,
      );
      persistWorkOrders(
        workOrders.map((w) =>
          w.id === id
            ? {
                ...w,
                serviceRows: (w.serviceRows ?? []).map((r) =>
                  r.id === rowId ? { ...r, archived, updatedAt: now } : r,
                ),
                updatedAt: now,
                activity: [...(w.activity ?? []), entry],
              }
            : w,
        ),
      );
      logAudit(
        "workorder.service",
        `${archived ? "Archived" : "Restored"} a service on work order ${order.number}.`,
        order.companyId,
      );
      return { ok: true };
    },
    [workOrders, persistWorkOrders, canAccessCustomer, logAudit, buildActivity],
  );

  const deleteWorkOrderServiceRow = useCallback<
    AppContextValue["deleteWorkOrderServiceRow"]
  >(
    (id, rowId) => {
      const order = workOrders.find((w) => w.id === id);
      if (!order) return { ok: false, error: "Work order not found." };
      if (!canAccessCustomer(order.customerId)) return { ok: false, error: FORBIDDEN_MESSAGE };
      const row = (order.serviceRows ?? []).find((r) => r.id === rowId);
      if (!row) return { ok: false, error: "Service row not found." };

      // Safe delete is only for mistaken, history-free rows. Resolve the history
      // signals the validator can't derive on its own, then gate the deletion.
      const hasTimeReports = timeReports.some((t) => t.serviceRowId === rowId);
      // Only exceptions touching a PAST occurrence count as operational history.
      // Future-only exceptions (e.g. created while testing reschedule/cancel on a
      // service that hasn't started) must not block deleting a mistaken row.
      const hasOccurrenceExceptions = bookingOccurrenceExceptions.some(
        (e) => e.parentServiceRowId === rowId && isOccurrenceExceptionOperational(e),
      );
      const validation = validateServiceRowDelete(row, {
        hasTimeReports,
        hasOccurrenceExceptions,
      });
      if (!validation.allowed) {
        return { ok: false, error: validation.blockedMessage };
      }

      const now = new Date().toISOString();
      const entry = buildActivity(
        "service_deleted",
        `Service deleted: ${row.serviceName}`,
      );
      persistWorkOrders(
        workOrders.map((w) =>
          w.id === id
            ? {
                ...w,
                serviceRows: (w.serviceRows ?? []).filter((r) => r.id !== rowId),
                updatedAt: now,
                activity: [...(w.activity ?? []), entry],
              }
            : w,
        ),
      );
      // Remove the linked Booking Queue item(s) for this row — a deleted row
      // never produced operational history, so nothing downstream is lost.
      const hadBooking = bookingQueue.some((b) => b.serviceRowId === rowId);
      if (hadBooking) {
        persistBookingQueue(bookingQueue.filter((b) => b.serviceRowId !== rowId));
      }
      // Clean up any future-only occurrence exceptions for this row. Deletion is
      // only permitted when no past (operational) exception exists, so every
      // remaining exception here is future-only and safe to discard with the row.
      const hadFutureExceptions = bookingOccurrenceExceptions.some(
        (e) => e.parentServiceRowId === rowId,
      );
      if (hadFutureExceptions) {
        persistBookingOccurrenceExceptions(
          bookingOccurrenceExceptions.filter((e) => e.parentServiceRowId !== rowId),
        );
      }
      logAudit(
        "workorder.service",
        `Deleted a service on work order ${order.number}.`,
        order.companyId,
      );
      if (hadBooking) {
        logAudit(
          "bookingqueue.delete",
          `Booking Lists item removed for “${row.serviceName}” (${order.number}).`,
          order.companyId,
        );
      }
      return { ok: true };
    },
    [
      workOrders,
      persistWorkOrders,
      canAccessCustomer,
      logAudit,
      buildActivity,
      timeReports,
      bookingOccurrenceExceptions,
      persistBookingOccurrenceExceptions,
      bookingQueue,
      persistBookingQueue,
    ],
  );

  const forceDeleteWorkOrderServiceRow = useCallback<
    AppContextValue["forceDeleteWorkOrderServiceRow"]
  >(
    (id, rowId) => {
      const order = workOrders.find((w) => w.id === id);
      if (!order) return { ok: false, error: "Work order not found." };
      if (!canAccessCustomer(order.customerId)) return { ok: false, error: FORBIDDEN_MESSAGE };
      const row = (order.serviceRows ?? []).find((r) => r.id === rowId);
      if (!row) return { ok: false, error: "Service row not found." };

      // Force delete tolerates historical *generated* occurrences (the reason it
      // exists) but is blocked by any financial/locked dependency. Today only
      // completed time reports are derivable; the payroll/invoice/export gates
      // are future extension points and resolve to false until those exist.
      const hasCompletedTimeReports = timeReports.some((t) => t.serviceRowId === rowId);
      const validation = validateServiceRowForceDelete({
        hasPayrollBasis: false,
        hasInvoiceBasis: false,
        hasCompletedTimeReports,
        hasLockedHistory: false,
        hasExportedPayroll: false,
        hasExportedInvoice: false,
      });
      if (!validation.allowed) {
        return { ok: false, error: validation.blockedMessage };
      }

      const counts = countServiceRowGeneratedOccurrences(row);
      const removedOccurrences = counts.total;
      const now = new Date().toISOString();
      const entry = buildActivity(
        "service_force_deleted",
        `Force deleted mistaken service: ${row.serviceName}`,
      );
      persistWorkOrders(
        workOrders.map((w) =>
          w.id === id
            ? {
                ...w,
                // Removing the row also removes its embedded variations.
                serviceRows: (w.serviceRows ?? []).filter((r) => r.id !== rowId),
                updatedAt: now,
                activity: [...(w.activity ?? []), entry],
              }
            : w,
        ),
      );
      // Remove every linked Booking Queue item for this row.
      const hadBooking = bookingQueue.some((b) => b.serviceRowId === rowId);
      if (hadBooking) {
        persistBookingQueue(bookingQueue.filter((b) => b.serviceRowId !== rowId));
      }
      // Remove occurrence exceptions belonging only to this row.
      const hadExceptions = bookingOccurrenceExceptions.some(
        (e) => e.parentServiceRowId === rowId,
      );
      if (hadExceptions) {
        persistBookingOccurrenceExceptions(
          bookingOccurrenceExceptions.filter((e) => e.parentServiceRowId !== rowId),
        );
      }
      const startDate = row.serviceDate || "—";
      const endDate = (isRecurring(row) ? row.serviceEndDate : row.serviceDate) || "—";
      logAudit(
        "workorder.service.force_delete",
        `Force deleted mistaken service “${row.serviceName}” on work order ${order.number} ` +
          `(start ${startDate}, end ${endDate}, ${removedOccurrences} generated occurrence` +
          `${removedOccurrences === 1 ? "" : "s"} removed).`,
        order.companyId,
      );
      return { ok: true };
    },
    [
      workOrders,
      persistWorkOrders,
      canAccessCustomer,
      logAudit,
      buildActivity,
      timeReports,
      bookingOccurrenceExceptions,
      persistBookingOccurrenceExceptions,
      bookingQueue,
      persistBookingQueue,
    ],
  );

  const reorderWorkOrderServiceRows = useCallback<
    AppContextValue["reorderWorkOrderServiceRows"]
  >(
    (id, orderedIds) => {
      const order = workOrders.find((w) => w.id === id);
      if (!order) return { ok: false, error: "Work order not found." };
      if (!canAccessCustomer(order.customerId)) return { ok: false, error: FORBIDDEN_MESSAGE };
      const orderMap = new Map(orderedIds.map((rowId, idx) => [rowId, idx]));
      const now = new Date().toISOString();
      const entry = buildActivity("service_reordered", "Service rows reordered");
      persistWorkOrders(
        workOrders.map((w) =>
          w.id === id
            ? {
                ...w,
                serviceRows: (w.serviceRows ?? []).map((r) =>
                  orderMap.has(r.id) ? { ...r, sortOrder: orderMap.get(r.id) as number } : r,
                ),
                updatedAt: now,
                activity: [...(w.activity ?? []), entry],
              }
            : w,
        ),
      );
      return { ok: true };
    },
    [workOrders, persistWorkOrders, canAccessCustomer, buildActivity],
  );

  /** Applies a transform to a single service row's variations and logs activity. */
  const mutateRowVariations = useCallback(
    (
      id: string,
      rowId: string,
      transform: (variations: RecurringVariation[]) => RecurringVariation[],
      action: WorkOrderActivity["action"],
      summary: string,
      auditSummary: string,
    ): { ok: boolean; error?: string } => {
      const order = workOrders.find((w) => w.id === id);
      if (!order) return { ok: false, error: "Work order not found." };
      if (!canAccessCustomer(order.customerId)) return { ok: false, error: FORBIDDEN_MESSAGE };
      const row = (order.serviceRows ?? []).find((r) => r.id === rowId);
      if (!row) return { ok: false, error: "Service row not found." };
      const now = new Date().toISOString();
      const entry = buildActivity(action, summary);
      persistWorkOrders(
        workOrders.map((w) =>
          w.id === id
            ? {
                ...w,
                serviceRows: (w.serviceRows ?? []).map((r) =>
                  r.id === rowId
                    ? { ...r, variations: transform(r.variations ?? []), updatedAt: now }
                    : r,
                ),
                updatedAt: now,
                activity: [...(w.activity ?? []), entry],
              }
            : w,
        ),
      );
      logAudit("workorder.service", auditSummary, order.companyId);
      return { ok: true };
    },
    [workOrders, persistWorkOrders, canAccessCustomer, logAudit, buildActivity],
  );

  const addServiceRowVariation = useCallback<AppContextValue["addServiceRowVariation"]>(
    (id, rowId, input) => {
      const name = input.name.trim();
      if (!name) return { ok: false, error: "A variation name is required." };
      const now = new Date().toISOString();
      const status: VariationStatus = input.status ?? "draft";
      const variation: RecurringVariation = {
        ...input,
        id: makeId("wovar"),
        name,
        notes: input.notes?.trim() || undefined,
        internalNote: input.internalNote?.trim() || undefined,
        reason: input.reason?.trim() || undefined,
        appliesFrom: input.appliesFrom?.trim() || undefined,
        appliesUntil: input.appliesUntil?.trim() || undefined,
        status,
        enabled: status === "active",
        archived: status === "archived",
        createdAt: now,
        updatedAt: now,
      };
      return mutateRowVariations(
        id,
        rowId,
        (vars) => [...vars, variation],
        "variation_added",
        `Variation added: ${name}`,
        `Added recurring variation “${name}” to a service.`,
      );
    },
    [mutateRowVariations],
  );

  const updateServiceRowVariation = useCallback<AppContextValue["updateServiceRowVariation"]>(
    (id, rowId, variationId, patch) => {
      if (patch.name !== undefined && !patch.name.trim()) {
        return { ok: false, error: "A variation name is required." };
      }
      const nextFrom =
        patch.appliesFrom !== undefined ? patch.appliesFrom.trim() || undefined : undefined;
      const nextUntil =
        patch.appliesUntil !== undefined ? patch.appliesUntil.trim() || undefined : undefined;
      if (
        patch.appliesFrom !== undefined &&
        patch.appliesUntil !== undefined &&
        nextFrom &&
        nextUntil &&
        nextUntil < nextFrom
      ) {
        return { ok: false, error: "The end date cannot be before the start date." };
      }
      const now = new Date().toISOString();
      let label = "variation";
      // Detect validity-period changes to log them specifically.
      const existing = workOrders
        .find((w) => w.id === id)
        ?.serviceRows?.find((r) => r.id === rowId)
        ?.variations?.find((v) => v.id === variationId);
      const datesChanged =
        existing != null &&
        ((patch.appliesFrom !== undefined && nextFrom !== existing.appliesFrom) ||
          (patch.appliesUntil !== undefined && nextUntil !== existing.appliesUntil));
      return mutateRowVariations(
        id,
        rowId,
        (vars) =>
          vars.map((v) => {
            if (v.id !== variationId) return v;
            const next: RecurringVariation = {
              ...v,
              ...patch,
              name: patch.name !== undefined ? patch.name.trim() : v.name,
              notes:
                patch.notes !== undefined ? patch.notes.trim() || undefined : v.notes,
              internalNote:
                patch.internalNote !== undefined
                  ? patch.internalNote.trim() || undefined
                  : v.internalNote,
              reason:
                patch.reason !== undefined
                  ? patch.reason.trim() || undefined
                  : v.reason,
              appliesFrom:
                patch.appliesFrom !== undefined ? nextFrom : v.appliesFrom,
              appliesUntil:
                patch.appliesUntil !== undefined ? nextUntil : v.appliesUntil,
              updatedAt: now,
            };
            label = next.name;
            return next;
          }),
        datesChanged ? "variation_dates_changed" : "variation_edited",
        datesChanged
          ? `Variation validity period updated: ${patch.name?.trim() || label}`
          : `Variation edited: ${patch.name?.trim() || label}`,
        datesChanged
          ? `Updated the validity period of a recurring service variation.`
          : `Edited a recurring service variation.`,
      );
    },
    [mutateRowVariations, workOrders],
  );

  const replaceServiceRowVariation = useCallback<
    AppContextValue["replaceServiceRowVariation"]
  >(
    (id, rowId, args) => {
      const name = args.input.name.trim();
      if (!name) return { ok: false, error: "A variation name is required." };
      const now = new Date().toISOString();
      const status: VariationStatus = args.input.status ?? "active";
      const targetId = args.variationId ?? makeId("wovar");
      const replacedSet = new Set(args.replacedVariationIds);
      const replacedCount = args.replacedVariationIds.length;

      return mutateRowVariations(
        id,
        rowId,
        (vars) => {
          const existingTarget = vars.find((v) => v.id === targetId);
          const replacement: RecurringVariation = {
            ...(existingTarget ?? {}),
            ...args.input,
            id: targetId,
            name,
            notes: args.input.notes?.trim() || undefined,
            internalNote: args.input.internalNote?.trim() || undefined,
            reason: args.input.reason?.trim() || undefined,
            appliesFrom: args.input.appliesFrom?.trim() || undefined,
            appliesUntil: args.input.appliesUntil?.trim() || undefined,
            status,
            enabled: status === "active",
            archived: status === "archived",
            replacesVariationId: args.replacedVariationIds[0],
            createdAt: existingTarget?.createdAt ?? now,
            updatedAt: now,
          };
          // Bound + archive + back-link every superseded variation via the pure
          // helper, then save the replacement (in place when editing, else new).
          const mapped = vars.map((v) => {
            if (replacedSet.has(v.id)) {
              return replaceVariation({ existing: v, replacement, now }).existing;
            }
            if (v.id === targetId) return replacement;
            return v;
          });
          return existingTarget ? mapped : [...mapped, replacement];
        },
        args.variationId ? "variation_edited" : "variation_added",
        `Variation “${name}” replaced ${replacedCount} existing variation${replacedCount === 1 ? "" : "s"}`,
        `Replaced ${replacedCount} recurring service variation${replacedCount === 1 ? "" : "s"} with “${name}”.`,
      );
    },
    [mutateRowVariations],
  );

  const setServiceRowVariationEnabled = useCallback<
    AppContextValue["setServiceRowVariationEnabled"]
  >(
    (id, rowId, variationId, enabled) => {
      const now = new Date().toISOString();
      let label = "variation";
      return mutateRowVariations(
        id,
        rowId,
        (vars) =>
          vars.map((v) => {
            if (v.id !== variationId) return v;
            label = v.name;
            return { ...v, enabled, updatedAt: now };
          }),
        enabled ? "variation_enabled" : "variation_disabled",
        `Variation ${enabled ? "enabled" : "disabled"}: ${label}`,
        `${enabled ? "Enabled" : "Disabled"} a recurring service variation.`,
      );
    },
    [mutateRowVariations],
  );

  const setServiceRowVariationArchived = useCallback<
    AppContextValue["setServiceRowVariationArchived"]
  >(
    (id, rowId, variationId, archived) => {
      const now = new Date().toISOString();
      let label = "variation";
      return mutateRowVariations(
        id,
        rowId,
        (vars) =>
          vars.map((v) => {
            if (v.id !== variationId) return v;
            label = v.name;
            return { ...v, archived, updatedAt: now };
          }),
        archived ? "variation_archived" : "variation_restored",
        `Variation ${archived ? "archived" : "restored"}: ${label}`,
        `${archived ? "Archived" : "Restored"} a recurring service variation.`,
      );
    },
    [mutateRowVariations],
  );

  const stopServiceRowVariation = useCallback<
    AppContextValue["stopServiceRowVariation"]
  >(
    (id, rowId, variationId, cutoffIso) => {
      const now = new Date().toISOString();
      const cutoff = cutoffIso?.trim() || now.slice(0, 10);
      let label = "variation";
      return mutateRowVariations(
        id,
        rowId,
        (vars) =>
          vars.map((v) => {
            if (v.id !== variationId) return v;
            label = v.name;
            // Bound the variation with an inclusive cutoff. Status is intentionally
            // left unchanged (not archived): the resolver evaluates each occurrence
            // against its own date, so occurrences on/before the cutoff still
            // resolve the variation (history stays traceable) while later ones do
            // not. Only tighten an already-earlier end date — never extend it.
            const appliesUntil =
              v.appliesUntil && v.appliesUntil < cutoff ? v.appliesUntil : cutoff;
            return { ...v, appliesUntil, updatedAt: now };
          }),
        "variation_stopped",
        `Variation stopped: ${label}`,
        `Stopped a recurring service variation from applying to future bookings.`,
      );
    },
    [mutateRowVariations],
  );

  const deleteServiceRowVariation = useCallback<
    AppContextValue["deleteServiceRowVariation"]
  >(
    (id, rowId, variationId) => {
      const order = workOrders.find((w) => w.id === id);
      if (!order) return { ok: false, error: "Work order not found." };
      if (!canAccessCustomer(order.customerId)) {
        return { ok: false, error: FORBIDDEN_MESSAGE };
      }
      const row = (order.serviceRows ?? []).find((r) => r.id === rowId);
      const variation = (row?.variations ?? []).find((v) => v.id === variationId);
      if (!row || !variation) {
        return { ok: false, error: "Variation not found." };
      }
      // Safe delete is only for a mistaken variation with no historical impact;
      // anything with history must be stopped instead so it stays traceable.
      const todayIso = new Date().toISOString().slice(0, 10);
      const appliedInPast = variationHasPastOccurrence(row, variation, todayIso);
      const check = validateVariationDelete(variation, { appliedInPast });
      if (!check.allowed) {
        return { ok: false, error: check.blockedMessage };
      }
      const name = variation.name;
      return mutateRowVariations(
        id,
        rowId,
        (vars) => vars.filter((v) => v.id !== variationId),
        "variation_deleted",
        `Variation deleted: ${name}`,
        `Deleted a recurring service variation with no history.`,
      );
    },
    [workOrders, canAccessCustomer, mutateRowVariations],
  );

  const setServiceRowVariationStatus = useCallback<
    AppContextValue["setServiceRowVariationStatus"]
  >(
    (id, rowId, variationId, status) => {
      const now = new Date().toISOString();
      let label = "variation";
      let from = "active" as VariationStatus;
      const action: WorkOrderActivity["action"] =
        status === "archived"
          ? "variation_archived"
          : "variation_status_changed";
      return mutateRowVariations(
        id,
        rowId,
        (vars) =>
          vars.map((v) => {
            if (v.id !== variationId) return v;
            label = v.name;
            from = getVariationStatus(v);
            return {
              ...v,
              status,
              // Keep legacy booleans in sync for any code still reading them.
              enabled: status === "active",
              archived: status === "archived",
              updatedAt: now,
            };
          }),
        from === "archived" && status !== "archived" ? "variation_restored" : action,
        `Variation status changed to ${VARIATION_STATUS_LABELS[status]}: ${label}`,
        `Set a recurring service variation to ${VARIATION_STATUS_LABELS[status]}.`,
      );
    },
    [mutateRowVariations],
  );

  const getCustomerInvoices = useCallback<AppContextValue["getCustomerInvoices"]>(
    (customerId) => {
      if (!canAccessCustomer(customerId)) return [];
      return invoices
        .filter((i) => i.customerId === customerId)
        .sort((a, b) => b.invoiceDate.localeCompare(a.invoiceDate));
    },
    [invoices, canAccessCustomer],
  );

  // ── Teams ──

  const createTeam = useCallback<AppContextValue["createTeam"]>(
    (input) => {
      const name = input.name.trim();
      if (!name) return { ok: false, error: "Team name is required." };
      const clash = teams.some(
        (t) => t.companyId === input.companyId && t.name.trim().toLowerCase() === name.toLowerCase(),
      );
      if (clash) return { ok: false, error: "A team with this name already exists." };
      const team: Team = {
        id: makeId("team"),
        companyId: input.companyId,
        name,
        description: input.description?.trim() || undefined,
        createdAt: new Date().toISOString(),
      };
      persistTeams([team, ...teams]);
      return { ok: true };
    },
    [teams, persistTeams],
  );

  const updateTeam = useCallback<AppContextValue["updateTeam"]>(
    (id, patch) => {
      const target = teams.find((t) => t.id === id);
      if (!target) return { ok: false, error: "Team not found." };
      if (patch.name) {
        const name = patch.name.trim();
        const clash = teams.some(
          (t) =>
            t.id !== id &&
            t.companyId === target.companyId &&
            t.name.trim().toLowerCase() === name.toLowerCase(),
        );
        if (clash) return { ok: false, error: "A team with this name already exists." };
      }
      persistTeams(teams.map((t) => (t.id === id ? { ...t, ...patch } : t)));
      return { ok: true };
    },
    [teams, persistTeams],
  );

  const deleteTeam = useCallback<AppContextValue["deleteTeam"]>(
    (id) => {
      persistTeams(teams.filter((t) => t.id !== id));
      // Remove the team from any employee memberships.
      persistEmployees(
        employees.map((e) =>
          e.teamIds.includes(id) ? { ...e, teamIds: e.teamIds.filter((t) => t !== id) } : e,
        ),
      );
    },
    [teams, persistTeams, employees, persistEmployees],
  );

  // ── Areas ──

  const createArea = useCallback<AppContextValue["createArea"]>(
    (input) => {
      if (!input.name.trim()) return { ok: false, error: "Area name is required." };
      const prev = shouldRunBrowserDomainMirror(shouldMirrorAreaWrites()) ? getAreas() : null;
      const created = createAreaInStore(input.companyId, {
        name: input.name,
        description: input.description,
      });
      if (!created) return { ok: false, error: "An area with this name already exists." };
      const next = getAreas();
      setAreas(next);
      if (prev) void mirrorAreaWrites(prev, next);
      return { ok: true };
    },
    [],
  );

  const updateArea = useCallback<AppContextValue["updateArea"]>(
    (id, patch) => {
      if (patch.name !== undefined && !patch.name.trim()) {
        return { ok: false, error: "Area name is required." };
      }
      const prev = shouldRunBrowserDomainMirror(shouldMirrorAreaWrites()) ? getAreas() : null;
      const updated = updateAreaInStore(id, patch);
      if (!updated) return { ok: false, error: "An area with this name already exists." };
      const next = getAreas();
      setAreas(next);
      if (prev) void mirrorAreaWrites(prev, next);
      return { ok: true };
    },
    [],
  );

  const archiveArea = useCallback<AppContextValue["archiveArea"]>(
    (id) => {
      const prev = shouldRunBrowserDomainMirror(shouldMirrorAreaWrites()) ? getAreas() : null;
      const updated = archiveAreaInStore(id);
      if (!updated) return { ok: false, error: "Area not found." };
      const next = getAreas();
      setAreas(next);
      if (prev) void mirrorAreaWrites(prev, next);
      return { ok: true };
    },
    [],
  );

  const restoreArea = useCallback<AppContextValue["restoreArea"]>(
    (id) => {
      const prev = shouldRunBrowserDomainMirror(shouldMirrorAreaWrites()) ? getAreas() : null;
      const updated = restoreAreaInStore(id);
      if (!updated) return { ok: false, error: "Area not found." };
      const next = getAreas();
      setAreas(next);
      if (prev) void mirrorAreaWrites(prev, next);
      return { ok: true };
    },
    [],
  );

  const activeCompanyId = (impersonatedUser ?? currentUser)?.companyId ?? null;

  const getAreaActivationPrecheck = useCallback<
    AppContextValue["getAreaActivationPrecheck"]
  >(() => {
    if (!activeCompanyId) {
      return {
        canEnable: false,
        blockingCustomers: [],
        counts: { blocking: 0, activeCustomers: 0, activeServices: 0, futureBookings: 0 },
      };
    }
    return getAreaScopedAccessActivationPrecheck(activeCompanyId);
  }, [activeCompanyId]);

  const setAreaScopedAccessEnabled = useCallback<
    AppContextValue["setAreaScopedAccessEnabled"]
  >(
    (enabled) => {
      if (!activeCompanyId) return { ok: false };
      const result = setAreaScopedAccessEnabledInStore(activeCompanyId, enabled);
      if (result.ok) setAreaScopedAccessTick((t) => t + 1);
      return result;
    },
    [activeCompanyId],
  );

  // ── Postal Cities ──

  const createPostalCity = useCallback<AppContextValue["createPostalCity"]>(
    (input) => {
      if (!input.name.trim()) return { ok: false, error: "Postal city name is required." };
      if (!input.areaId) return { ok: false, error: "Select an area for the postal city." };
      const prev = shouldRunBrowserDomainMirror(shouldMirrorPostalCityWrites()) ? getPostalCities() : null;
      const created = createPostalCityInStore({
        companyId: input.companyId,
        name: input.name,
        areaId: input.areaId,
      });
      if (!created) {
        return {
          ok: false,
          error: "An active postal city with this name already exists, or the area is invalid.",
        };
      }
      const next = getPostalCities();
      setPostalCities(next);
      if (prev) void mirrorPostalCityWrites(prev, next);
      return { ok: true };
    },
    [],
  );

  const updatePostalCity = useCallback<AppContextValue["updatePostalCity"]>(
    (id, patch) => {
      if (patch.name !== undefined && !patch.name.trim()) {
        return { ok: false, error: "Postal city name is required." };
      }
      const prev = shouldRunBrowserDomainMirror(shouldMirrorPostalCityWrites()) ? getPostalCities() : null;
      const updated = updatePostalCityInStore(id, patch);
      if (!updated) {
        return {
          ok: false,
          error: "An active postal city with this name already exists, or the area is invalid.",
        };
      }
      const next = getPostalCities();
      setPostalCities(next);
      if (prev) void mirrorPostalCityWrites(prev, next);
      return { ok: true };
    },
    [],
  );

  const archivePostalCity = useCallback<AppContextValue["archivePostalCity"]>(
    (id) => {
      const prev = shouldRunBrowserDomainMirror(shouldMirrorPostalCityWrites()) ? getPostalCities() : null;
      const updated = archivePostalCityInStore(id);
      if (!updated) return { ok: false, error: "Postal city not found." };
      const next = getPostalCities();
      setPostalCities(next);
      if (prev) void mirrorPostalCityWrites(prev, next);
      return { ok: true };
    },
    [],
  );

  const restorePostalCity = useCallback<AppContextValue["restorePostalCity"]>(
    (id) => {
      const prev = shouldRunBrowserDomainMirror(shouldMirrorPostalCityWrites()) ? getPostalCities() : null;
      const updated = restorePostalCityInStore(id);
      if (!updated) return { ok: false, error: "Postal city not found." };
      const next = getPostalCities();
      setPostalCities(next);
      if (prev) void mirrorPostalCityWrites(prev, next);
      return { ok: true };
    },
    [],
  );

  // ── Employee Languages ──

  const createEmployeeLanguage = useCallback<AppContextValue["createEmployeeLanguage"]>(
    (input) => {
      if (!input.code.trim()) return { ok: false, error: "Language code is required." };
      if (!input.name.trim()) return { ok: false, error: "Language name is required." };
      const prev = shouldRunBrowserDomainMirror(shouldMirrorEmployeeLanguageWrites()) ? getEmployeeLanguages() : null;
      const created = createEmployeeLanguageInStore({
        companyId: input.companyId,
        code: input.code,
        name: input.name,
        nativeName: input.nativeName,
      });
      if (!created) {
        return { ok: false, error: "A language with this code already exists." };
      }
      const next = getEmployeeLanguages();
      setEmployeeLanguages(next);
      if (prev) void mirrorEmployeeLanguageWrites(prev, next);
      return { ok: true };
    },
    [],
  );

  const updateEmployeeLanguage = useCallback<AppContextValue["updateEmployeeLanguage"]>(
    (id, patch) => {
      if (patch.code !== undefined && !patch.code.trim()) {
        return { ok: false, error: "Language code is required." };
      }
      if (patch.name !== undefined && !patch.name.trim()) {
        return { ok: false, error: "Language name is required." };
      }
      const prev = shouldRunBrowserDomainMirror(shouldMirrorEmployeeLanguageWrites()) ? getEmployeeLanguages() : null;
      const updated = updateEmployeeLanguageInStore(id, patch);
      if (!updated) {
        return { ok: false, error: "A language with this code already exists." };
      }
      const next = getEmployeeLanguages();
      setEmployeeLanguages(next);
      if (prev) void mirrorEmployeeLanguageWrites(prev, next);
      return { ok: true };
    },
    [],
  );

  const archiveEmployeeLanguage = useCallback<AppContextValue["archiveEmployeeLanguage"]>(
    (id) => {
      const prev = shouldRunBrowserDomainMirror(shouldMirrorEmployeeLanguageWrites()) ? getEmployeeLanguages() : null;
      const updated = archiveEmployeeLanguageInStore(id);
      if (!updated) return { ok: false, error: "Language not found." };
      const next = getEmployeeLanguages();
      setEmployeeLanguages(next);
      if (prev) void mirrorEmployeeLanguageWrites(prev, next);
      return { ok: true };
    },
    [],
  );

  const restoreEmployeeLanguage = useCallback<AppContextValue["restoreEmployeeLanguage"]>(
    (id) => {
      const prev = shouldRunBrowserDomainMirror(shouldMirrorEmployeeLanguageWrites()) ? getEmployeeLanguages() : null;
      const updated = restoreEmployeeLanguageInStore(id);
      if (!updated) return { ok: false, error: "Language not found." };
      const next = getEmployeeLanguages();
      setEmployeeLanguages(next);
      if (prev) void mirrorEmployeeLanguageWrites(prev, next);
      return { ok: true };
    },
    [],
  );

  const setEmployeeLanguageDefault = useCallback<
    AppContextValue["setEmployeeLanguageDefault"]
  >(
    (id) => {
      const prev = shouldRunBrowserDomainMirror(shouldMirrorEmployeeLanguageWrites()) ? getEmployeeLanguages() : null;
      const updated = setEmployeeLanguageDefaultInStore(id);
      if (!updated) {
        return { ok: false, error: "Only an active language can be the default." };
      }
      const next = getEmployeeLanguages();
      setEmployeeLanguages(next);
      if (prev) void mirrorEmployeeLanguageWrites(prev, next);
      return { ok: true };
    },
    [],
  );

  const setAutoAreaFromPostalCityEnabled = useCallback<
    AppContextValue["setAutoAreaFromPostalCityEnabled"]
  >(
    (enabled) => {
      if (!activeCompanyId) return;
      setAutoAreaFromPostalCityEnabledInStore(activeCompanyId, enabled);
      setAutoAreaTick((t) => t + 1);
    },
    [activeCompanyId],
  );

  // ── Modules ──

  // Phase 2A: when the Module catalogue is read from Supabase (cut-over ON in app
  // builds), every GLOBAL module / category mutation MUST commit to Supabase FIRST
  // and the UI updates only via the post-write directory refetch — no localStorage
  // authority, no browser-domain mirror, no optimistic persistence. Flag OFF
  // (vitest/rollback) keeps the legacy localStorage path so rollback stays instant.
  const modulesSupabaseAuthoritative = useMemo(
    () => shouldReadModulesFromSupabase() && isSupabaseConfigured,
    [],
  );

  const setModuleStatus = useCallback<AppContextValue["setModuleStatus"]>(
    async (moduleId, status) => {
      const target = modules.find((m) => m.id === moduleId);
      const name = target?.name ?? moduleId;
      const auditStatusChange = (): void =>
        logAudit(
          "module.status",
          `${status === "active" ? "Enabled" : "Disabled"} module “${name}” platform-wide.`,
          null,
        );
      if (modulesSupabaseAuthoritative) {
        if (!target) return { ok: false, error: "Module not found." };
        try {
          await upsertModuleInSupabase({ ...target, status });
        } catch (err) {
          return {
            ok: false,
            error: err instanceof Error ? err.message : "Failed to update the module status.",
          };
        }
        bumpModuleDirectoryRefresh();
        auditStatusChange();
        return { ok: true };
      }
      persistModules(modules.map((m) => (m.id === moduleId ? { ...m, status } : m)));
      auditStatusChange();
      return { ok: true };
    },
    [modules, modulesSupabaseAuthoritative, persistModules, logAudit],
  );

  // Legacy localStorage path for company-module config (flag OFF / vitest /
  // rollback only). Under the Phase-2B authoritative cut-over Supabase is the sole
  // authority and this is never reached.
  const upsertCompanyModule = useCallback(
    (companyId: string, moduleId: string, patch: Partial<CompanyModuleSetting>) => {
      const exists = companyModules.some(
        (s) => s.companyId === companyId && s.moduleId === moduleId,
      );
      if (exists) {
        persistCompanyModules(
          companyModules.map((s) =>
            s.companyId === companyId && s.moduleId === moduleId ? { ...s, ...patch } : s,
          ),
        );
      } else {
        persistCompanyModules([
          ...companyModules,
          { companyId, moduleId, available: true, enabled: true, ...patch },
        ]);
      }
    },
    [companyModules, persistCompanyModules],
  );

  // Merges a patch onto the current company-module setting (or a sensible default
  // for a not-yet-offered module) to produce the FULL record an authoritative
  // upsert commits — so the persisted row always carries a coherent
  // available/enabled pair regardless of which toggle fired.
  const computeCompanyModuleSetting = useCallback(
    (
      companyId: string,
      moduleId: string,
      patch: Partial<CompanyModuleSetting>,
    ): CompanyModuleSetting => {
      const existing = companyModules.find(
        (s) => s.companyId === companyId && s.moduleId === moduleId,
      );
      const base: CompanyModuleSetting = existing ?? {
        companyId,
        moduleId,
        available: true,
        enabled: true,
      };
      return { ...base, ...patch };
    },
    [companyModules],
  );

  // Persists a company-module patch. Authoritative (app builds): commit to
  // Supabase FIRST then bump the directory refresh so the UI reflects the true
  // persisted state only after a confirmed write — NO localStorage authority, NO
  // browser-domain mirror, NO optimistic persistence; a failed write resolves
  // `{ ok: false }` and changes nothing. Flag OFF (vitest/rollback): the legacy
  // localStorage path keeps rollback instant.
  const persistCompanyModulePatch = useCallback(
    async (
      companyId: string,
      moduleId: string,
      patch: Partial<CompanyModuleSetting>,
    ): Promise<{ ok: boolean; error?: string }> => {
      if (modulesSupabaseAuthoritative) {
        const next = computeCompanyModuleSetting(companyId, moduleId, patch);
        try {
          await upsertCompanyModuleInSupabase(next);
        } catch (err) {
          return {
            ok: false,
            error:
              err instanceof Error
                ? err.message
                : "Failed to update module availability.",
          };
        }
        bumpModuleDirectoryRefresh();
        return { ok: true };
      }
      upsertCompanyModule(companyId, moduleId, patch);
      return { ok: true };
    },
    [
      modulesSupabaseAuthoritative,
      computeCompanyModuleSetting,
      upsertCompanyModule,
    ],
  );

  const setModuleAvailable = useCallback<AppContextValue["setModuleAvailable"]>(
    async (companyId, moduleId, available) => {
      // Turning availability off also switches the company's enablement off.
      const result = await persistCompanyModulePatch(
        companyId,
        moduleId,
        available ? { available } : { available, enabled: false },
      );
      if (!result.ok) return result;
      const name = modules.find((m) => m.id === moduleId)?.name ?? moduleId;
      logAudit(
        "module.available",
        `${available ? "Made available" : "Withdrew"} module “${name}” for company.`,
        companyId,
      );
      return result;
    },
    [persistCompanyModulePatch, modules, logAudit],
  );

  const setModuleEnabled = useCallback<AppContextValue["setModuleEnabled"]>(
    async (companyId, moduleId, enabled) => {
      const result = await persistCompanyModulePatch(companyId, moduleId, { enabled });
      if (!result.ok) return result;
      const name = modules.find((m) => m.id === moduleId)?.name ?? moduleId;
      logAudit(
        "module.enabled",
        `${enabled ? "Enabled" : "Disabled"} module “${name}”.`,
        companyId,
      );
      return result;
    },
    [persistCompanyModulePatch, modules, logAudit],
  );

  const getCompanyModuleSetting = useCallback<AppContextValue["getCompanyModuleSetting"]>(
    (companyId, moduleId) =>
      companyModules.find((s) => s.companyId === companyId && s.moduleId === moduleId),
    [companyModules],
  );

  const getModuleEntitlementAvailability = useCallback<
    AppContextValue["getModuleEntitlementAvailability"]
  >(
    (companyId, moduleId) =>
      resolveModuleEntitlementAvailability(moduleId, companyId, {
        systemSettings,
        globalEntitlements: serviceGlobalEntitlements,
        companyEntitlements: companyServiceEntitlements,
      }),
    [systemSettings, serviceGlobalEntitlements, companyServiceEntitlements],
  );

  const canAccessModule = useCallback<AppContextValue["canAccessModule"]>(
    (user, moduleId) => {
      const def = MODULE_DEFINITIONS.find((d) => d.id === moduleId);
      if (!def) return false;
      // Module pages are company-scoped; Super Admin manages them but doesn't use them.
      if (!user.companyId) return false;
      if (!def.allowedUserTypes.includes(user.role)) return false;
      // Authoritative 3-layer gate (global status → company available → company
      // enabled) resolved through the single source of truth, so a globally
      // inactive module can NEVER be reached via a stale available/enabled row.
      const mod = modules.find((m) => m.id === moduleId);
      const setting = companyModules.find(
        (s) => s.companyId === user.companyId && s.moduleId === moduleId,
      );
      // Service → Module bridge: for bridged modules (e.g. `admin-requests`)
      // Layer 2 availability is derived from the company's effective service
      // entitlement; `undefined` for un-bridged modules keeps the raw
      // company_modules.available flag authoritative (existing behavior).
      const entitlementAvailability = getModuleEntitlementAvailability(
        user.companyId,
        moduleId,
      );
      if (!isCompanyModuleAccessible({ module: mod, setting, entitlementAvailability }))
        return false;
      // Category gate: if the module is connected to any category, at least one of
      // those categories must be active and visible for the user's role.
      const linkedCategories = moduleCategories.filter((c) => c.moduleIds.includes(moduleId));
      if (linkedCategories.length > 0) {
        const visible = linkedCategories.some(
          (c) => c.status === "active" && c.visibleUserTypes.includes(user.role),
        );
        if (!visible) return false;
      }
      return true;
    },
    [modules, companyModules, moduleCategories, getModuleEntitlementAvailability],
  );

  const getAccessibleModules = useCallback<AppContextValue["getAccessibleModules"]>(
    (user) => MODULE_DEFINITIONS.filter((def) => canAccessModule(user, def.id)),
    [canAccessModule],
  );

  // ── Module categories ──

  const createCategory = useCallback<AppContextValue["createCategory"]>(
    async (input) => {
      const name = input.name.trim();
      if (!name) return { ok: false, error: "Category name is required." };
      const clash = moduleCategories.some(
        (c) => c.name.trim().toLowerCase() === name.toLowerCase(),
      );
      if (clash) return { ok: false, error: "A category with this name already exists." };
      const maxOrder = moduleCategories.reduce((m, c) => Math.max(m, c.sortOrder), -1);
      const category: ModuleCategory = {
        id: makeId("cat"),
        name,
        description: input.description.trim(),
        icon: input.icon,
        sortOrder: maxOrder + 1,
        status: input.status ?? "active",
        visibleUserTypes: input.visibleUserTypes,
        moduleIds: input.moduleIds,
        createdAt: new Date().toISOString(),
      };
      if (modulesSupabaseAuthoritative) {
        try {
          await createModuleCategoryInSupabase(category);
        } catch (err) {
          return {
            ok: false,
            error: err instanceof Error ? err.message : "Failed to create the category.",
          };
        }
        bumpModuleDirectoryRefresh();
        logAudit("category.create", `Created module category “${category.name}”.`, null);
        return { ok: true };
      }
      persistModuleCategories([...moduleCategories, category]);
      logAudit("category.create", `Created module category “${category.name}”.`, null);
      return { ok: true };
    },
    [moduleCategories, modulesSupabaseAuthoritative, persistModuleCategories, logAudit],
  );

  const updateCategory = useCallback<AppContextValue["updateCategory"]>(
    async (id, patch) => {
      const target = moduleCategories.find((c) => c.id === id);
      if (!target) return { ok: false, error: "Category not found." };
      if (patch.name) {
        const name = patch.name.trim();
        const clash = moduleCategories.some(
          (c) => c.id !== id && c.name.trim().toLowerCase() === name.toLowerCase(),
        );
        if (clash) return { ok: false, error: "A category with this name already exists." };
      }
      const updated: ModuleCategory = { ...target, ...patch };
      if (modulesSupabaseAuthoritative) {
        try {
          await updateModuleCategoryInSupabase(updated);
        } catch (err) {
          return {
            ok: false,
            error: err instanceof Error ? err.message : "Failed to update the category.",
          };
        }
        bumpModuleDirectoryRefresh();
        logAudit("category.update", `Updated module category “${updated.name}”.`, null);
        return { ok: true };
      }
      persistModuleCategories(
        moduleCategories.map((c) => (c.id === id ? updated : c)),
      );
      logAudit("category.update", `Updated module category “${updated.name}”.`, null);
      return { ok: true };
    },
    [moduleCategories, modulesSupabaseAuthoritative, persistModuleCategories, logAudit],
  );

  const deleteCategory = useCallback<AppContextValue["deleteCategory"]>(
    async (id) => {
      const target = moduleCategories.find((c) => c.id === id);
      if (!target) return { ok: false, error: "Category not found." };
      if (modulesSupabaseAuthoritative) {
        try {
          await softDeleteModuleCategoryInSupabase(id);
        } catch (err) {
          return {
            ok: false,
            error: err instanceof Error ? err.message : "Failed to delete the category.",
          };
        }
        bumpModuleDirectoryRefresh();
        logAudit("category.delete", `Deleted module category “${target.name}”.`, null);
        return { ok: true };
      }
      persistModuleCategories(moduleCategories.filter((c) => c.id !== id));
      logAudit("category.delete", `Deleted module category “${target.name}”.`, null);
      return { ok: true };
    },
    [moduleCategories, modulesSupabaseAuthoritative, persistModuleCategories, logAudit],
  );

  const reorderCategories = useCallback<AppContextValue["reorderCategories"]>(
    async (orderedIds) => {
      const orderMap = new Map(orderedIds.map((id, idx) => [id, idx]));
      const reordered = moduleCategories.map((c) => ({
        ...c,
        sortOrder: orderMap.get(c.id) ?? c.sortOrder,
      }));
      if (modulesSupabaseAuthoritative) {
        try {
          await reorderModuleCategoriesInSupabase(reordered);
        } catch (err) {
          return {
            ok: false,
            error: err instanceof Error ? err.message : "Failed to reorder categories.",
          };
        }
        bumpModuleDirectoryRefresh();
        return { ok: true };
      }
      persistModuleCategories(reordered);
      return { ok: true };
    },
    [moduleCategories, modulesSupabaseAuthoritative, persistModuleCategories],
  );

  const getNavModuleGroups = useCallback<AppContextValue["getNavModuleGroups"]>(
    (user) => {
      const accessible = getAccessibleModules(user);
      const accessibleIds = new Set(accessible.map((d) => d.id));
      const groups: { id: string; title: string; modules: ModuleDefinition[] }[] = [];

      const visibleCategories = [...moduleCategories]
        .filter((c) => c.status === "active" && c.visibleUserTypes.includes(user.role))
        .sort((a, b) => a.sortOrder - b.sortOrder);

      for (const category of visibleCategories) {
        const mods = category.moduleIds
          .filter((mid) => accessibleIds.has(mid))
          .map((mid) => MODULE_DEFINITIONS.find((d) => d.id === mid))
          .filter((d): d is ModuleDefinition => Boolean(d));
        if (mods.length > 0) {
          groups.push({ id: category.id, title: category.name, modules: mods });
        }
      }

      // Modules not connected to any category still surface under a generic group.
      const uncategorized = accessible.filter(
        (d) => !moduleCategories.some((c) => c.moduleIds.includes(d.id)),
      );
      if (uncategorized.length > 0) {
        groups.push({ id: "_uncategorized", title: "Modules", modules: uncategorized });
      }

      return groups;
    },
    [getAccessibleModules, moduleCategories],
  );

  // ── Checklist Manager: templates ──

  const canEditTemplate = useCallback<AppContextValue["canEditTemplate"]>(
    (user, template) => {
      if (!getUserPermissions(user).includes("checklist_templates.edit")) return false;
      if (user.role === "super_admin") return template.companyId === null;
      if (user.role === "company_admin") {
        return template.companyId !== null && template.companyId === user.companyId;
      }
      return false;
    },
    [getUserPermissions],
  );

  const getVisibleTemplates = useCallback<AppContextValue["getVisibleTemplates"]>(
    (user) => {
      if (!getUserPermissions(user).includes("checklist_templates.view")) return [];
      if (user.role === "super_admin") {
        return checklistTemplates.filter((t) => t.companyId === null);
      }
      if (user.role === "company_admin" && user.companyId) {
        const own = checklistTemplates.filter((t) => t.companyId === user.companyId);
        const availableGlobals = checklistTemplates.filter(
          (t) =>
            t.companyId === null &&
            t.availableToCompanies &&
            t.status === "active" &&
            !t.archived,
        );
        return [...own, ...availableGlobals];
      }
      return [];
    },
    [checklistTemplates, getUserPermissions],
  );

  /** Applies an updater to a template after an edit-permission check. */
  const patchTemplate = useCallback(
    (
      id: string,
      updater: (template: ChecklistTemplate) => ChecklistTemplate,
    ): { ok: boolean; error?: string } => {
      const target = checklistTemplates.find((t) => t.id === id);
      if (!target) return { ok: false, error: "Template not found." };
      if (currentUser && !canEditTemplate(currentUser, target)) {
        return { ok: false, error: FORBIDDEN_MESSAGE };
      }
      persistChecklistTemplates(
        checklistTemplates.map((t) =>
          t.id === id ? { ...updater(t), updatedAt: new Date().toISOString() } : t,
        ),
      );
      return { ok: true };
    },
    [checklistTemplates, persistChecklistTemplates, currentUser, canEditTemplate],
  );

  const createTemplate = useCallback<AppContextValue["createTemplate"]>(
    (input) => {
      const name = input.name.trim();
      if (!name) return { ok: false, error: "Template name is required." };
      // Scope guard: only the Super Admin owns global templates; company admins own theirs.
      if (currentUser) {
        if (!getUserPermissions(currentUser).includes("checklist_templates.create")) {
          return { ok: false, error: FORBIDDEN_MESSAGE };
        }
        if (input.companyId === null && currentUser.role !== "super_admin") {
          return { ok: false, error: FORBIDDEN_MESSAGE };
        }
        if (
          input.companyId !== null &&
          currentUser.role !== "super_admin" &&
          !inCompanyScope(currentUser, input.companyId)
        ) {
          return { ok: false, error: FORBIDDEN_MESSAGE };
        }
      }
      const now = new Date().toISOString();
      const template: ChecklistTemplate = {
        id: makeId("chk"),
        companyId: input.companyId,
        name,
        description: input.description?.trim() || undefined,
        status: "active",
        archived: false,
        availableToCompanies: false,
        templateType: input.companyId === null ? "global" : "company",
        createdBy: currentUser?.id ?? null,
        notes: undefined,
        images: [],
        floors: [],
        createdAt: now,
        updatedAt: now,
      };
      persistChecklistTemplates([template, ...checklistTemplates]);
      logAudit("checklist.create", `Created checklist template “${name}”.`, template.companyId);
      return { ok: true, template };
    },
    [checklistTemplates, persistChecklistTemplates, currentUser, getUserPermissions, logAudit],
  );

  const updateTemplate = useCallback<AppContextValue["updateTemplate"]>(
    (id, patch) => {
      const target = checklistTemplates.find((t) => t.id === id);
      if (!target) return { ok: false, error: "Template not found." };
      const result = patchTemplate(id, (t) => ({ ...t, ...patch }));
      if (!result.ok) return result;
      if (patch.archived === true && !target.archived) {
        logAudit("checklist.archive", `Archived checklist template “${target.name}”.`, target.companyId);
      } else {
        logAudit("checklist.update", `Updated checklist template “${target.name}”.`, target.companyId);
      }
      return result;
    },
    [checklistTemplates, patchTemplate, logAudit],
  );

  const cloneTemplate = useCallback<AppContextValue["cloneTemplate"]>(
    (templateId) => {
      const source = checklistTemplates.find((t) => t.id === templateId);
      if (!source) return { ok: false, error: "Template not found." };
      if (!currentUser) return { ok: false, error: FORBIDDEN_MESSAGE };
      // Cloning is a company action: needs create permission, a company, and the
      // source must be a global template currently visible/available to them.
      if (!getUserPermissions(currentUser).includes("checklist_templates.create")) {
        return { ok: false, error: FORBIDDEN_MESSAGE };
      }
      if (currentUser.role !== "company_admin" || !currentUser.companyId) {
        return { ok: false, error: FORBIDDEN_MESSAGE };
      }
      if (source.companyId !== null) {
        return { ok: false, error: "Only global templates can be cloned." };
      }
      const visible = getVisibleTemplates(currentUser).some((t) => t.id === templateId);
      if (!visible) return { ok: false, error: FORBIDDEN_MESSAGE };

      const now = new Date().toISOString();
      const cloneImages = (images?: ChecklistImage[]): ChecklistImage[] =>
        (images ?? []).map((img) => ({ ...img, id: makeId("img") }));

      // Deep copy the structure with brand-new ids so the clone is independent.
      const floors = source.floors.map((f) => ({
        ...f,
        id: makeId("flr"),
        notes: f.notes,
        images: cloneImages(f.images),
        rooms: f.rooms.map((r) => ({
          ...r,
          id: makeId("rm"),
          notes: r.notes,
          images: cloneImages(r.images),
          tasks: r.tasks.map((k) => ({
            ...k,
            id: makeId("tsk"),
            notes: k.notes,
            images: cloneImages(k.images),
          })),
        })),
      }));

      const clone: ChecklistTemplate = {
        id: makeId("chk"),
        companyId: currentUser.companyId,
        name: `${source.name} - Copy`,
        description: source.description,
        status: "active",
        archived: false,
        availableToCompanies: false,
        templateType: "company",
        createdBy: currentUser.id,
        notes: source.notes,
        images: cloneImages(source.images),
        floors,
        createdAt: now,
        updatedAt: now,
      };
      persistChecklistTemplates([clone, ...checklistTemplates]);
      logAudit(
        "checklist.clone",
        `Cloned global template “${source.name}” into “${clone.name}”.`,
        clone.companyId,
      );
      return { ok: true, template: clone };
    },
    [
      checklistTemplates,
      persistChecklistTemplates,
      currentUser,
      getUserPermissions,
      getVisibleTemplates,
      logAudit,
    ],
  );

  // Floors
  const addFloor = useCallback<AppContextValue["addFloor"]>(
    (templateId, name) => {
      if (!name.trim()) return { ok: false, error: "Floor name is required." };
      return patchTemplate(templateId, (t) => {
        const sortOrder = t.floors.reduce((m, f) => Math.max(m, f.sortOrder), -1) + 1;
        return {
          ...t,
          floors: [...t.floors, { id: makeId("flr"), name: name.trim(), sortOrder, rooms: [] }],
        };
      });
    },
    [patchTemplate],
  );

  const updateFloor = useCallback<AppContextValue["updateFloor"]>(
    (templateId, floorId, name) => {
      if (!name.trim()) return { ok: false, error: "Floor name is required." };
      return patchTemplate(templateId, (t) => ({
        ...t,
        floors: t.floors.map((f) => (f.id === floorId ? { ...f, name: name.trim() } : f)),
      }));
    },
    [patchTemplate],
  );

  const deleteFloor = useCallback<AppContextValue["deleteFloor"]>(
    (templateId, floorId) => {
      patchTemplate(templateId, (t) => ({
        ...t,
        floors: t.floors.filter((f) => f.id !== floorId),
      }));
    },
    [patchTemplate],
  );

  const setFloorArchived = useCallback<AppContextValue["setFloorArchived"]>(
    (templateId, floorId, archived) => {
      patchTemplate(templateId, (t) => ({
        ...t,
        floors: t.floors.map((f) => (f.id === floorId ? { ...f, archived } : f)),
      }));
    },
    [patchTemplate],
  );

  const reorderFloors = useCallback<AppContextValue["reorderFloors"]>(
    (templateId, orderedIds) => {
      const order = new Map(orderedIds.map((id, idx) => [id, idx]));
      patchTemplate(templateId, (t) => ({
        ...t,
        floors: t.floors.map((f) => ({ ...f, sortOrder: order.get(f.id) ?? f.sortOrder })),
      }));
    },
    [patchTemplate],
  );

  // Rooms
  const addRoom = useCallback<AppContextValue["addRoom"]>(
    (templateId, floorId, name) => {
      if (!name.trim()) return { ok: false, error: "Room name is required." };
      return patchTemplate(templateId, (t) => ({
        ...t,
        floors: t.floors.map((f) => {
          if (f.id !== floorId) return f;
          const sortOrder = f.rooms.reduce((m, r) => Math.max(m, r.sortOrder), -1) + 1;
          return {
            ...f,
            rooms: [...f.rooms, { id: makeId("rm"), name: name.trim(), sortOrder, tasks: [] }],
          };
        }),
      }));
    },
    [patchTemplate],
  );

  const updateRoom = useCallback<AppContextValue["updateRoom"]>(
    (templateId, floorId, roomId, name) => {
      if (!name.trim()) return { ok: false, error: "Room name is required." };
      return patchTemplate(templateId, (t) => ({
        ...t,
        floors: t.floors.map((f) =>
          f.id !== floorId
            ? f
            : {
                ...f,
                rooms: f.rooms.map((r) => (r.id === roomId ? { ...r, name: name.trim() } : r)),
              },
        ),
      }));
    },
    [patchTemplate],
  );

  const deleteRoom = useCallback<AppContextValue["deleteRoom"]>(
    (templateId, floorId, roomId) => {
      patchTemplate(templateId, (t) => ({
        ...t,
        floors: t.floors.map((f) =>
          f.id !== floorId ? f : { ...f, rooms: f.rooms.filter((r) => r.id !== roomId) },
        ),
      }));
    },
    [patchTemplate],
  );

  const setRoomArchived = useCallback<AppContextValue["setRoomArchived"]>(
    (templateId, floorId, roomId, archived) => {
      patchTemplate(templateId, (t) => ({
        ...t,
        floors: t.floors.map((f) =>
          f.id !== floorId
            ? f
            : {
                ...f,
                rooms: f.rooms.map((r) => (r.id === roomId ? { ...r, archived } : r)),
              },
        ),
      }));
    },
    [patchTemplate],
  );

  const reorderRooms = useCallback<AppContextValue["reorderRooms"]>(
    (templateId, floorId, orderedIds) => {
      const order = new Map(orderedIds.map((id, idx) => [id, idx]));
      patchTemplate(templateId, (t) => ({
        ...t,
        floors: t.floors.map((f) =>
          f.id !== floorId
            ? f
            : {
                ...f,
                rooms: f.rooms.map((r) => ({ ...r, sortOrder: order.get(r.id) ?? r.sortOrder })),
              },
        ),
      }));
    },
    [patchTemplate],
  );

  // Tasks
  const addTask = useCallback<AppContextValue["addTask"]>(
    (templateId, floorId, roomId, input) => {
      if (!input.name.trim()) return { ok: false, error: "Task name is required." };
      return patchTemplate(templateId, (t) => ({
        ...t,
        floors: t.floors.map((f) =>
          f.id !== floorId
            ? f
            : {
                ...f,
                rooms: f.rooms.map((r) => {
                  if (r.id !== roomId) return r;
                  const sortOrder = r.tasks.reduce((m, k) => Math.max(m, k.sortOrder), -1) + 1;
                  return {
                    ...r,
                    tasks: [
                      ...r.tasks,
                      {
                        id: makeId("tsk"),
                        name: input.name.trim(),
                        description: input.description?.trim() || undefined,
                        autoEnabled: input.autoEnabled,
                        sortOrder,
                      },
                    ],
                  };
                }),
              },
        ),
      }));
    },
    [patchTemplate],
  );

  const updateTask = useCallback<AppContextValue["updateTask"]>(
    (templateId, floorId, roomId, taskId, patch) => {
      if (patch.name !== undefined && !patch.name.trim()) {
        return { ok: false, error: "Task name is required." };
      }
      return patchTemplate(templateId, (t) => ({
        ...t,
        floors: t.floors.map((f) =>
          f.id !== floorId
            ? f
            : {
                ...f,
                rooms: f.rooms.map((r) =>
                  r.id !== roomId
                    ? r
                    : {
                        ...r,
                        tasks: r.tasks.map((k) =>
                          k.id === taskId
                            ? {
                                ...k,
                                ...patch,
                                name: patch.name !== undefined ? patch.name.trim() : k.name,
                                description:
                                  patch.description !== undefined
                                    ? patch.description.trim() || undefined
                                    : k.description,
                              }
                            : k,
                        ),
                      },
                ),
              },
        ),
      }));
    },
    [patchTemplate],
  );

  const deleteTask = useCallback<AppContextValue["deleteTask"]>(
    (templateId, floorId, roomId, taskId) => {
      patchTemplate(templateId, (t) => ({
        ...t,
        floors: t.floors.map((f) =>
          f.id !== floorId
            ? f
            : {
                ...f,
                rooms: f.rooms.map((r) =>
                  r.id !== roomId
                    ? r
                    : { ...r, tasks: r.tasks.filter((k) => k.id !== taskId) },
                ),
              },
        ),
      }));
    },
    [patchTemplate],
  );

  const setTaskArchived = useCallback<AppContextValue["setTaskArchived"]>(
    (templateId, floorId, roomId, taskId, archived) => {
      patchTemplate(templateId, (t) => ({
        ...t,
        floors: t.floors.map((f) =>
          f.id !== floorId
            ? f
            : {
                ...f,
                rooms: f.rooms.map((r) =>
                  r.id !== roomId
                    ? r
                    : {
                        ...r,
                        tasks: r.tasks.map((k) =>
                          k.id === taskId ? { ...k, archived } : k,
                        ),
                      },
                ),
              },
        ),
      }));
    },
    [patchTemplate],
  );

  const reorderTasks = useCallback<AppContextValue["reorderTasks"]>(
    (templateId, floorId, roomId, orderedIds) => {
      const order = new Map(orderedIds.map((id, idx) => [id, idx]));
      patchTemplate(templateId, (t) => ({
        ...t,
        floors: t.floors.map((f) =>
          f.id !== floorId
            ? f
            : {
                ...f,
                rooms: f.rooms.map((r) =>
                  r.id !== roomId
                    ? r
                    : {
                        ...r,
                        tasks: r.tasks.map((k) => ({
                          ...k,
                          sortOrder: order.get(k.id) ?? k.sortOrder,
                        })),
                      },
                ),
              },
        ),
      }));
    },
    [patchTemplate],
  );

  // Notes & images on any level
  const applyNotesImages = useCallback(
    (target: ChecklistTarget, patch: { notes?: string; images?: ChecklistImage[] }) =>
      patchTemplate(target.templateId, (t) => {
        if (target.level === "template") return { ...t, ...patch };
        return {
          ...t,
          floors: t.floors.map((f) => {
            if (f.id !== target.floorId) return f;
            if (target.level === "floor") return { ...f, ...patch };
            return {
              ...f,
              rooms: f.rooms.map((r) => {
                if (r.id !== target.roomId) return r;
                if (target.level === "room") return { ...r, ...patch };
                return {
                  ...r,
                  tasks: r.tasks.map((k) =>
                    k.id === target.taskId ? { ...k, ...patch } : k,
                  ),
                };
              }),
            };
          }),
        };
      }),
    [patchTemplate],
  );

  const setChecklistNotesImages = useCallback<AppContextValue["setChecklistNotesImages"]>(
    (target, notes, images) =>
      applyNotesImages(target, { notes: notes.trim() || undefined, images }),
    [applyNotesImages],
  );

  // Adoption
  const getTemplateAdoption = useCallback<AppContextValue["getTemplateAdoption"]>(
    (companyId, templateId) =>
      checklistAdoptions.find(
        (a) => a.companyId === companyId && a.templateId === templateId,
      ),
    [checklistAdoptions],
  );

  const setTemplateAdopted = useCallback<AppContextValue["setTemplateAdopted"]>(
    (companyId, templateId, enabled) => {
      // Tenant isolation: only act within the actor's company scope.
      if (currentUser && !inCompanyScope(currentUser, companyId)) return;
      const exists = checklistAdoptions.some(
        (a) => a.companyId === companyId && a.templateId === templateId,
      );
      const next = exists
        ? checklistAdoptions.map((a) =>
            a.companyId === companyId && a.templateId === templateId ? { ...a, enabled } : a,
          )
        : [...checklistAdoptions, { companyId, templateId, enabled }];
      persistChecklistAdoptions(next);
      const name = checklistTemplates.find((t) => t.id === templateId)?.name ?? templateId;
      logAudit(
        "checklist.adopt",
        `${enabled ? "Activated" : "Deactivated"} template “${name}” for company.`,
        companyId,
      );
    },
    [checklistAdoptions, persistChecklistAdoptions, checklistTemplates, currentUser, logAudit],
  );

  // ── Checklist Manager: customer protocols ──

  const canEditProtocol = useCallback<AppContextValue["canEditProtocol"]>(
    (user, protocol) => {
      if (!getUserPermissions(user).includes("customer_protocols.edit")) return false;
      // Only company admins edit; super admins view all and manage global structures.
      if (user.role !== "company_admin") return false;
      return inCompanyScope(user, protocol.companyId);
    },
    [getUserPermissions],
  );

  const getVisibleProtocols = useCallback<AppContextValue["getVisibleProtocols"]>(
    (user) => {
      if (!getUserPermissions(user).includes("customer_protocols.view")) return [];
      if (user.role === "super_admin") return customerProtocols;
      if (user.companyId) {
        return customerProtocols.filter((p) => p.companyId === user.companyId);
      }
      return [];
    },
    [customerProtocols, getUserPermissions],
  );

  /** Resolves the customer record a customer login belongs to, within its company. */
  const resolveOwnCustomer = useCallback(
    (user: User): Customer | null => {
      if (user.role !== "customer" || !user.companyId) return null;
      return (
        customers.find(
          (c) =>
            c.companyId === user.companyId &&
            (c.id === user.linkedCustomerId || c.userIds.includes(user.id)),
        ) ?? null
      );
    },
    [customers],
  );

  const getMyProtocols = useCallback<AppContextValue["getMyProtocols"]>(
    (user) => {
      if (!getUserPermissions(user).includes("my_cleaning_protocols.view")) return [];
      const customer = resolveOwnCustomer(user);
      if (!customer || customer.status !== "active") return [];
      return customerProtocols.filter(
        (p) =>
          p.customerId === customer.id &&
          p.companyId === customer.companyId &&
          p.status !== "archived" &&
          p.status !== "inactive_customer",
      );
    },
    [customerProtocols, getUserPermissions, resolveOwnCustomer],
  );

  const canViewMyProtocol = useCallback<AppContextValue["canViewMyProtocol"]>(
    (user, protocol) => {
      if (!getUserPermissions(user).includes("my_cleaning_protocols.view")) return false;
      const customer = resolveOwnCustomer(user);
      if (!customer || customer.status !== "active") return false;
      return (
        protocol.customerId === customer.id &&
        protocol.companyId === customer.companyId &&
        protocol.status !== "archived" &&
        protocol.status !== "inactive_customer"
      );
    },
    [getUserPermissions, resolveOwnCustomer],
  );

  /** Applies an updater to a protocol after an edit-permission check. */
  const patchProtocol = useCallback(
    (
      id: string,
      updater: (protocol: CustomerProtocol) => CustomerProtocol,
    ): { ok: boolean; error?: string } => {
      const target = customerProtocols.find((p) => p.id === id);
      if (!target) return { ok: false, error: "Protocol not found." };
      if (currentUser && !canEditProtocol(currentUser, target)) {
        return { ok: false, error: FORBIDDEN_MESSAGE };
      }
      persistCustomerProtocols(
        customerProtocols.map((p) =>
          p.id === id ? { ...updater(p), updatedAt: new Date().toISOString() } : p,
        ),
      );
      return { ok: true };
    },
    [customerProtocols, persistCustomerProtocols, currentUser, canEditProtocol],
  );

  const createProtocol = useCallback<AppContextValue["createProtocol"]>(
    (input) => {
      if (!currentUser) return { ok: false, error: FORBIDDEN_MESSAGE };
      if (!getUserPermissions(currentUser).includes("customer_protocols.create")) {
        return { ok: false, error: FORBIDDEN_MESSAGE };
      }
      if (currentUser.role !== "company_admin" || !currentUser.companyId) {
        return { ok: false, error: FORBIDDEN_MESSAGE };
      }
      const companyId = currentUser.companyId;

      const customer = customers.find((c) => c.id === input.customerId);
      if (!customer || customer.companyId !== companyId) {
        return { ok: false, error: "Select a customer from your company." };
      }

      // The source template must be visible to this company (own or available global).
      const source = getVisibleTemplates(currentUser).find((t) => t.id === input.templateId);
      if (!source) return { ok: false, error: "Select a template available to you." };

      // Copy structure, omitting archived nodes; rooms and tasks start inactive.
      const floors = [...source.floors]
        .filter((f) => !f.archived)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((f, fi) => ({
          id: makeId("pflr"),
          name: f.name,
          sortOrder: fi,
          notes: undefined,
          rooms: [...f.rooms]
            .filter((r) => !r.archived)
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((r, ri) => ({
              id: makeId("prm"),
              name: r.name,
              active: false,
              sortOrder: ri,
              notes: undefined,
              tasks: [...r.tasks]
                .filter((k) => !k.archived)
                .sort((a, b) => a.sortOrder - b.sortOrder)
                .map((k, ki) => ({
                  id: makeId("ptsk"),
                  name: k.name,
                  description: k.description,
                  autoEnabled: k.autoEnabled,
                  state: "inactive" as ProtocolTaskState,
                  sortOrder: ki,
                  notes: undefined,
                })),
            })),
        }));

      const now = new Date().toISOString();
      const protocol: CustomerProtocol = {
        id: makeId("prot"),
        companyId,
        customerId: customer.id,
        name: input.name?.trim() || `${customer.name} — ${source.name}`,
        description: input.description?.trim() || undefined,
        sourceTemplateId: source.id,
        sourceTemplateName: source.name,
        createdBy: currentUser.id,
        status: "draft",
        notes: undefined,
        floors,
        createdAt: now,
        updatedAt: now,
      };
      persistCustomerProtocols([protocol, ...customerProtocols]);
      logAudit(
        "protocol.create",
        `Created protocol “${protocol.name}” for ${customer.name}.`,
        companyId,
      );
      return { ok: true, protocol };
    },
    [
      currentUser,
      customers,
      customerProtocols,
      persistCustomerProtocols,
      getUserPermissions,
      getVisibleTemplates,
      logAudit,
    ],
  );

  const updateProtocol = useCallback<AppContextValue["updateProtocol"]>(
    (id, patch) => {
      const target = customerProtocols.find((p) => p.id === id);
      if (!target) return { ok: false, error: "Protocol not found." };
      const result = patchProtocol(id, (p) => ({
        ...p,
        ...patch,
        name: patch.name !== undefined ? patch.name.trim() || p.name : p.name,
        description:
          patch.description !== undefined
            ? patch.description.trim() || undefined
            : p.description,
      }));
      if (!result.ok) return result;
      logAudit("protocol.update", `Updated protocol “${target.name}”.`, target.companyId);
      return result;
    },
    [customerProtocols, patchProtocol, logAudit],
  );

  const setProtocolArchived = useCallback<AppContextValue["setProtocolArchived"]>(
    (id, archived) => {
      const target = customerProtocols.find((p) => p.id === id);
      if (!target) return { ok: false, error: "Protocol not found." };
      const nextStatus: CustomerProtocolStatus = archived ? "archived" : "draft";
      const result = patchProtocol(id, (p) => ({ ...p, status: nextStatus }));
      if (!result.ok) return result;
      logAudit(
        "protocol.archive",
        `${archived ? "Archived" : "Restored"} protocol “${target.name}”.`,
        target.companyId,
      );
      return result;
    },
    [customerProtocols, patchProtocol, logAudit],
  );

  const duplicateProtocol = useCallback<AppContextValue["duplicateProtocol"]>(
    (id) => {
      if (!currentUser) return { ok: false, error: FORBIDDEN_MESSAGE };
      if (!getUserPermissions(currentUser).includes("customer_protocols.create")) {
        return { ok: false, error: FORBIDDEN_MESSAGE };
      }
      const source = customerProtocols.find((p) => p.id === id);
      if (!source) return { ok: false, error: "Protocol not found." };
      if (!inCompanyScope(currentUser, source.companyId)) {
        return { ok: false, error: FORBIDDEN_MESSAGE };
      }
      // Deep, fully independent copy with fresh ids; preserves notes & activation.
      const floors = source.floors.map((f) => ({
        ...f,
        id: makeId("pflr"),
        rooms: f.rooms.map((r) => ({
          ...r,
          id: makeId("prm"),
          tasks: r.tasks.map((k) => ({ ...k, id: makeId("ptsk") })),
        })),
      }));
      const now = new Date().toISOString();
      const copy: CustomerProtocol = {
        ...source,
        id: makeId("prot"),
        name: `${source.name} (Copy)`,
        status: "draft",
        createdBy: currentUser.id,
        floors,
        createdAt: now,
        updatedAt: now,
      };
      persistCustomerProtocols([copy, ...customerProtocols]);
      logAudit(
        "protocol.create",
        `Duplicated protocol “${source.name}”.`,
        source.companyId,
      );
      return { ok: true, protocol: copy };
    },
    [currentUser, customerProtocols, persistCustomerProtocols, getUserPermissions, logAudit],
  );

  const setProtocolRoomActive = useCallback<AppContextValue["setProtocolRoomActive"]>(
    (protocolId, floorId, roomId, active) =>
      patchProtocol(protocolId, (p) => ({
        ...p,
        floors: p.floors.map((f) =>
          f.id !== floorId
            ? f
            : {
                ...f,
                rooms: f.rooms.map((r) => {
                  if (r.id !== roomId) return r;
                  return {
                    ...r,
                    active,
                    // Activating enables auto-enabled tasks; deactivating turns all off.
                    tasks: r.tasks.map((k) => ({
                      ...k,
                      state: (active
                        ? k.autoEnabled
                          ? "active"
                          : "inactive"
                        : "inactive") as ProtocolTaskState,
                      exclusionReason: undefined,
                    })),
                  };
                }),
              },
        ),
      })),
    [patchProtocol],
  );

  const setProtocolTaskState = useCallback<AppContextValue["setProtocolTaskState"]>(
    (protocolId, floorId, roomId, taskId, state, exclusionReason) =>
      patchProtocol(protocolId, (p) => ({
        ...p,
        floors: p.floors.map((f) =>
          f.id !== floorId
            ? f
            : {
                ...f,
                rooms: f.rooms.map((r) =>
                  r.id !== roomId
                    ? r
                    : {
                        ...r,
                        tasks: r.tasks.map((k) =>
                          k.id === taskId
                            ? {
                                ...k,
                                state,
                                exclusionReason:
                                  state === "excluded"
                                    ? exclusionReason?.trim() || k.exclusionReason
                                    : undefined,
                              }
                            : k,
                        ),
                      },
                ),
              },
        ),
      })),
    [patchProtocol],
  );

  const setProtocolNotes = useCallback<AppContextValue["setProtocolNotes"]>(
    (target, rawNotes) => {
      const notes = rawNotes.trim() || undefined;
      return patchProtocol(target.protocolId, (p) => {
        if (target.level === "protocol") return { ...p, notes };
        return {
          ...p,
          floors: p.floors.map((f) => {
            if (f.id !== target.floorId) return f;
            if (target.level === "floor") return { ...f, notes };
            return {
              ...f,
              rooms: f.rooms.map((r) => {
                if (r.id !== target.roomId) return r;
                if (target.level === "room") return { ...r, notes };
                return {
                  ...r,
                  tasks: r.tasks.map((k) =>
                    k.id === target.taskId ? { ...k, notes } : k,
                  ),
                };
              }),
            };
          }),
        };
      });
    },
    [patchProtocol],
  );

  const saveProtocol = useCallback<AppContextValue["saveProtocol"]>(
    (id, draft) => {
      const target = customerProtocols.find((p) => p.id === id);
      if (!target) return { ok: false, error: "Protocol not found." };
      const result = patchProtocol(id, (p) => ({
        ...p,
        name: draft.name.trim() || p.name,
        description: draft.description?.trim() || undefined,
        status: draft.status,
        notes: draft.notes?.trim() || undefined,
        floors: draft.floors,
      }));
      if (!result.ok) return result;
      logAudit("protocol.update", `Saved changes to protocol \u201c${target.name}\u201d.`, target.companyId);
      return result;
    },
    [customerProtocols, patchProtocol, logAudit],
  );

  // ── Checklist Libraries ──

  const canEditLibraryRoom = useCallback<AppContextValue["canEditLibraryRoom"]>(
    (user, room) => {
      if (!getUserPermissions(user).includes("checklist_templates.edit")) return false;
      if (user.role === "super_admin") return room.companyId === null;
      if (user.role === "company_admin") {
        return room.companyId !== null && room.companyId === user.companyId;
      }
      return false;
    },
    [getUserPermissions],
  );

  const canEditLibraryTask = useCallback<AppContextValue["canEditLibraryTask"]>(
    (user, task) => {
      if (!getUserPermissions(user).includes("checklist_templates.edit")) return false;
      if (user.role === "super_admin") return task.companyId === null;
      if (user.role === "company_admin") {
        return task.companyId !== null && task.companyId === user.companyId;
      }
      return false;
    },
    [getUserPermissions],
  );

  const getVisibleLibraryRooms = useCallback<AppContextValue["getVisibleLibraryRooms"]>(
    (user) => {
      if (!getUserPermissions(user).includes("checklist_templates.view")) return [];
      if (user.role === "super_admin") return libraryRooms.filter((r) => r.companyId === null);
      if (user.role === "company_admin" && user.companyId) {
        const own = libraryRooms.filter((r) => r.companyId === user.companyId);
        const globals = libraryRooms.filter(
          (r) => r.companyId === null && r.status === "active",
        );
        return [...own, ...globals];
      }
      return [];
    },
    [libraryRooms, getUserPermissions],
  );

  const getVisibleLibraryTasks = useCallback<AppContextValue["getVisibleLibraryTasks"]>(
    (user) => {
      if (!getUserPermissions(user).includes("checklist_templates.view")) return [];
      if (user.role === "super_admin") return libraryTasks.filter((t) => t.companyId === null);
      if (user.role === "company_admin" && user.companyId) {
        const own = libraryTasks.filter((t) => t.companyId === user.companyId);
        const globals = libraryTasks.filter(
          (t) => t.companyId === null && t.status === "active",
        );
        return [...own, ...globals];
      }
      return [];
    },
    [libraryTasks, getUserPermissions],
  );

  /** Resolves the owning company for a new library item, or an error. */
  const resolveLibraryOwner = useCallback(
    (): { ok: true; companyId: string | null } | { ok: false; error: string } => {
      if (!currentUser) return { ok: false, error: FORBIDDEN_MESSAGE };
      if (!getUserPermissions(currentUser).includes("checklist_templates.create")) {
        return { ok: false, error: FORBIDDEN_MESSAGE };
      }
      if (currentUser.role === "super_admin") return { ok: true, companyId: null };
      if (currentUser.role === "company_admin" && currentUser.companyId) {
        return { ok: true, companyId: currentUser.companyId };
      }
      return { ok: false, error: FORBIDDEN_MESSAGE };
    },
    [currentUser, getUserPermissions],
  );

  const createLibraryRoom = useCallback<AppContextValue["createLibraryRoom"]>(
    (input) => {
      const name = input.name.trim();
      if (!name) return { ok: false, error: "Room name is required." };
      const owner = resolveLibraryOwner();
      if (!owner.ok) return owner;
      const room: LibraryRoom = {
        id: makeId("lib_rm"),
        companyId: owner.companyId,
        name,
        description: input.description?.trim() || undefined,
        suggestedFloorType: input.suggestedFloorType?.trim() || undefined,
        category: input.category,
        status: "active",
        createdBy: currentUser?.id ?? null,
        createdAt: new Date().toISOString(),
      };
      persistLibraryRooms([room, ...libraryRooms]);
      logAudit("library.create", `Added room “${name}” to the room library.`, room.companyId);
      return { ok: true, room };
    },
    [libraryRooms, persistLibraryRooms, resolveLibraryOwner, currentUser, logAudit],
  );

  const updateLibraryRoom = useCallback<AppContextValue["updateLibraryRoom"]>(
    (id, patch) => {
      const target = libraryRooms.find((r) => r.id === id);
      if (!target) return { ok: false, error: "Room not found." };
      if (currentUser && !canEditLibraryRoom(currentUser, target)) {
        return { ok: false, error: FORBIDDEN_MESSAGE };
      }
      if (patch.name !== undefined && !patch.name.trim()) {
        return { ok: false, error: "Room name is required." };
      }
      persistLibraryRooms(
        libraryRooms.map((r) =>
          r.id === id
            ? {
                ...r,
                ...patch,
                name: patch.name !== undefined ? patch.name.trim() : r.name,
                description:
                  patch.description !== undefined
                    ? patch.description.trim() || undefined
                    : r.description,
                suggestedFloorType:
                  patch.suggestedFloorType !== undefined
                    ? patch.suggestedFloorType.trim() || undefined
                    : r.suggestedFloorType,
              }
            : r,
        ),
      );
      logAudit("library.update", `Updated library room “${target.name}”.`, target.companyId);
      return { ok: true };
    },
    [libraryRooms, persistLibraryRooms, currentUser, canEditLibraryRoom, logAudit],
  );

  const setLibraryRoomArchived = useCallback<AppContextValue["setLibraryRoomArchived"]>(
    (id, archived) => {
      const target = libraryRooms.find((r) => r.id === id);
      if (!target) return { ok: false, error: "Room not found." };
      if (currentUser && !canEditLibraryRoom(currentUser, target)) {
        return { ok: false, error: FORBIDDEN_MESSAGE };
      }
      persistLibraryRooms(
        libraryRooms.map((r) =>
          r.id === id ? { ...r, status: archived ? "archived" : "active" } : r,
        ),
      );
      logAudit(
        "library.archive",
        `${archived ? "Archived" : "Restored"} library room “${target.name}”.`,
        target.companyId,
      );
      return { ok: true };
    },
    [libraryRooms, persistLibraryRooms, currentUser, canEditLibraryRoom, logAudit],
  );

  const createLibraryTask = useCallback<AppContextValue["createLibraryTask"]>(
    (input) => {
      const name = input.name.trim();
      if (!name) return { ok: false, error: "Task name is required." };
      const owner = resolveLibraryOwner();
      if (!owner.ok) return owner;
      const task: LibraryTask = {
        id: makeId("lib_tsk"),
        companyId: owner.companyId,
        name,
        description: input.description?.trim() || undefined,
        defaultAutoEnabled: input.defaultAutoEnabled,
        category: input.category,
        status: "active",
        createdBy: currentUser?.id ?? null,
        createdAt: new Date().toISOString(),
      };
      persistLibraryTasks([task, ...libraryTasks]);
      logAudit("library.create", `Added task “${name}” to the task library.`, task.companyId);
      return { ok: true, task };
    },
    [libraryTasks, persistLibraryTasks, resolveLibraryOwner, currentUser, logAudit],
  );

  const updateLibraryTask = useCallback<AppContextValue["updateLibraryTask"]>(
    (id, patch) => {
      const target = libraryTasks.find((t) => t.id === id);
      if (!target) return { ok: false, error: "Task not found." };
      if (currentUser && !canEditLibraryTask(currentUser, target)) {
        return { ok: false, error: FORBIDDEN_MESSAGE };
      }
      if (patch.name !== undefined && !patch.name.trim()) {
        return { ok: false, error: "Task name is required." };
      }
      persistLibraryTasks(
        libraryTasks.map((t) =>
          t.id === id
            ? {
                ...t,
                ...patch,
                name: patch.name !== undefined ? patch.name.trim() : t.name,
                description:
                  patch.description !== undefined
                    ? patch.description.trim() || undefined
                    : t.description,
              }
            : t,
        ),
      );
      logAudit("library.update", `Updated library task “${target.name}”.`, target.companyId);
      return { ok: true };
    },
    [libraryTasks, persistLibraryTasks, currentUser, canEditLibraryTask, logAudit],
  );

  const setLibraryTaskArchived = useCallback<AppContextValue["setLibraryTaskArchived"]>(
    (id, archived) => {
      const target = libraryTasks.find((t) => t.id === id);
      if (!target) return { ok: false, error: "Task not found." };
      if (currentUser && !canEditLibraryTask(currentUser, target)) {
        return { ok: false, error: FORBIDDEN_MESSAGE };
      }
      persistLibraryTasks(
        libraryTasks.map((t) =>
          t.id === id ? { ...t, status: archived ? "archived" : "active" } : t,
        ),
      );
      logAudit(
        "library.archive",
        `${archived ? "Archived" : "Restored"} library task “${target.name}”.`,
        target.companyId,
      );
      return { ok: true };
    },
    [libraryTasks, persistLibraryTasks, currentUser, canEditLibraryTask, logAudit],
  );

  const addRoomsFromLibrary = useCallback<AppContextValue["addRoomsFromLibrary"]>(
    (templateId, floorId, roomIds) => {
      if (roomIds.length === 0) return { ok: false, error: "Select at least one room." };
      const visible = currentUser ? getVisibleLibraryRooms(currentUser) : [];
      const picked = roomIds
        .map((id) => visible.find((r) => r.id === id))
        .filter((r): r is LibraryRoom => Boolean(r));
      if (picked.length === 0) return { ok: false, error: "No matching rooms available." };
      return patchTemplate(templateId, (t) => ({
        ...t,
        floors: t.floors.map((f) => {
          if (f.id !== floorId) return f;
          let sortOrder = f.rooms.reduce((m, r) => Math.max(m, r.sortOrder), -1);
          const copies = picked.map((lib) => {
            sortOrder += 1;
            return {
              id: makeId("rm"),
              name: lib.name,
              sortOrder,
              tasks: [],
              notes: lib.description || undefined,
            };
          });
          return { ...f, rooms: [...f.rooms, ...copies] };
        }),
      }));
    },
    [currentUser, getVisibleLibraryRooms, patchTemplate],
  );

  const addTasksFromLibrary = useCallback<AppContextValue["addTasksFromLibrary"]>(
    (templateId, floorId, roomId, taskIds) => {
      if (taskIds.length === 0) return { ok: false, error: "Select at least one task." };
      const visible = currentUser ? getVisibleLibraryTasks(currentUser) : [];
      const picked = taskIds
        .map((id) => visible.find((t) => t.id === id))
        .filter((t): t is LibraryTask => Boolean(t));
      if (picked.length === 0) return { ok: false, error: "No matching tasks available." };
      return patchTemplate(templateId, (t) => ({
        ...t,
        floors: t.floors.map((f) =>
          f.id !== floorId
            ? f
            : {
                ...f,
                rooms: f.rooms.map((r) => {
                  if (r.id !== roomId) return r;
                  let sortOrder = r.tasks.reduce((m, k) => Math.max(m, k.sortOrder), -1);
                  const copies = picked.map((lib) => {
                    sortOrder += 1;
                    return {
                      id: makeId("tsk"),
                      name: lib.name,
                      description: lib.description,
                      autoEnabled: lib.defaultAutoEnabled,
                      sortOrder,
                    };
                  });
                  return { ...r, tasks: [...r.tasks, ...copies] };
                }),
              },
        ),
      }));
    },
    [currentUser, getVisibleLibraryTasks, patchTemplate],
  );

  // ── Settings Templates & Company Settings ──

  /** Deep-copies settings data, assigning fresh ids to every item. */
  const cloneSettingsData = useCallback((data: SettingsData): SettingsData => {
    const cloneList = (items: SettingsItem[]): SettingsItem[] =>
      items.map((it) => ({ ...it, id: makeId("set") }));
    return {
      services: cloneList(data.services),
      customerTypes: cloneList(data.customerTypes),
      areas: cloneList(data.areas),
      tags: cloneList(data.tags),
      tagGroups: cloneList(data.tagGroups),
      materials: cloneList(data.materials),
      workOrderGroups: cloneList(data.workOrderGroups),
      timeCodes: cloneList(data.timeCodes),
      publicHolidays: cloneList(data.publicHolidays),
    };
  }, []);

  /** Whether the signed-in user may manage settings templates. */
  const canManageSettingsTemplates = useCallback((): boolean => {
    if (!currentUser) return false;
    return (
      currentUser.role === "super_admin" &&
      getUserPermissions(currentUser).includes("settings_templates.manage")
    );
  }, [currentUser, getUserPermissions]);

  const getSelectableSettingsTemplates = useCallback<
    AppContextValue["getSelectableSettingsTemplates"]
  >(() => settingsTemplates.filter((t) => !t.archived), [settingsTemplates]);

  const createSettingsTemplate = useCallback<AppContextValue["createSettingsTemplate"]>(
    (input) => {
      if (!canManageSettingsTemplates()) return { ok: false, error: FORBIDDEN_MESSAGE };
      const name = input.name.trim();
      if (!name) return { ok: false, error: "Template name is required." };
      const clash = settingsTemplates.some(
        (t) => t.name.trim().toLowerCase() === name.toLowerCase(),
      );
      if (clash) return { ok: false, error: "A settings template with this name already exists." };
      const now = new Date().toISOString();
      const template: SettingsTemplate = {
        id: makeId("set_tpl"),
        name,
        description: input.description?.trim() || undefined,
        archived: false,
        createdBy: currentUser?.id ?? null,
        recommendedServicePackageId: input.recommendedServicePackageId ?? null,
        data: input.data ?? emptySettingsData(),
        createdAt: now,
        updatedAt: now,
      };
      persistSettingsTemplates([template, ...settingsTemplates]);
      logAudit("settings_template.create", `Created settings template \u201c${name}\u201d.`, null);
      return { ok: true, template };
    },
    [canManageSettingsTemplates, settingsTemplates, persistSettingsTemplates, currentUser, logAudit],
  );

  const updateSettingsTemplate = useCallback<AppContextValue["updateSettingsTemplate"]>(
    (id, patch) => {
      if (!canManageSettingsTemplates()) return { ok: false, error: FORBIDDEN_MESSAGE };
      const target = settingsTemplates.find((t) => t.id === id);
      if (!target) return { ok: false, error: "Template not found." };
      if (patch.name !== undefined) {
        const name = patch.name.trim();
        if (!name) return { ok: false, error: "Template name is required." };
        const clash = settingsTemplates.some(
          (t) => t.id !== id && t.name.trim().toLowerCase() === name.toLowerCase(),
        );
        if (clash) return { ok: false, error: "A settings template with this name already exists." };
      }
      persistSettingsTemplates(
        settingsTemplates.map((t) =>
          t.id === id
            ? {
                ...t,
                ...patch,
                name: patch.name !== undefined ? patch.name.trim() : t.name,
                description:
                  patch.description !== undefined
                    ? patch.description.trim() || undefined
                    : t.description,
                updatedAt: new Date().toISOString(),
              }
            : t,
        ),
      );
      logAudit("settings_template.update", `Updated settings template \u201c${target.name}\u201d.`, null);
      return { ok: true };
    },
    [canManageSettingsTemplates, settingsTemplates, persistSettingsTemplates, logAudit],
  );

  const setSettingsTemplateArchived = useCallback<
    AppContextValue["setSettingsTemplateArchived"]
  >(
    (id, archived) => {
      if (!canManageSettingsTemplates()) return { ok: false, error: FORBIDDEN_MESSAGE };
      const target = settingsTemplates.find((t) => t.id === id);
      if (!target) return { ok: false, error: "Template not found." };
      persistSettingsTemplates(
        settingsTemplates.map((t) =>
          t.id === id ? { ...t, archived, updatedAt: new Date().toISOString() } : t,
        ),
      );
      logAudit(
        "settings_template.archive",
        `${archived ? "Archived" : "Restored"} settings template \u201c${target.name}\u201d.`,
        null,
      );
      return { ok: true };
    },
    [canManageSettingsTemplates, settingsTemplates, persistSettingsTemplates, logAudit],
  );

  const duplicateSettingsTemplate = useCallback<
    AppContextValue["duplicateSettingsTemplate"]
  >(
    (id) => {
      if (!canManageSettingsTemplates()) return { ok: false, error: FORBIDDEN_MESSAGE };
      const source = settingsTemplates.find((t) => t.id === id);
      if (!source) return { ok: false, error: "Template not found." };
      const now = new Date().toISOString();
      const copy: SettingsTemplate = {
        ...source,
        id: makeId("set_tpl"),
        name: `${source.name} (Copy)`,
        archived: false,
        createdBy: currentUser?.id ?? null,
        data: cloneSettingsData(source.data),
        createdAt: now,
        updatedAt: now,
      };
      persistSettingsTemplates([copy, ...settingsTemplates]);
      logAudit("settings_template.clone", `Duplicated settings template \u201c${source.name}\u201d.`, null);
      return { ok: true, template: copy };
    },
    [canManageSettingsTemplates, settingsTemplates, persistSettingsTemplates, cloneSettingsData, currentUser, logAudit],
  );

  const getCompanySettingsFor = useCallback<AppContextValue["getCompanySettingsFor"]>(
    (companyId) => companySettings.find((s) => s.companyId === companyId),
    [companySettings],
  );

  const initializeCompanySettings = useCallback<
    AppContextValue["initializeCompanySettings"]
  >(
    (companyId, choice) => {
      if (!currentUser) return { ok: false, error: FORBIDDEN_MESSAGE };
      // Tenant isolation: only act within the actor's company scope.
      if (!inCompanyScope(currentUser, companyId)) {
        return { ok: false, error: FORBIDDEN_MESSAGE };
      }
      if (!getUserPermissions(currentUser).includes("settings.manage")) {
        return { ok: false, error: FORBIDDEN_MESSAGE };
      }
      let data: SettingsData = emptySettingsData();
      let sourceTemplateId: string | null = null;
      let sourceTemplateName: string | null = null;
      if ("templateId" in choice) {
        const source = settingsTemplates.find(
          (t) => t.id === choice.templateId && !t.archived,
        );
        if (!source) return { ok: false, error: "Select an available settings template." };
        // Copy — never live-link — so later template edits don't change the company.
        data = cloneSettingsData(source.data);
        sourceTemplateId = source.id;
        sourceTemplateName = source.name;
      }
      const next: CompanySettings = {
        companyId,
        initialized: true,
        sourceTemplateId,
        sourceTemplateName,
        data,
        updatedAt: new Date().toISOString(),
      };
      const exists = companySettings.some((s) => s.companyId === companyId);
      persistCompanySettings(
        exists
          ? companySettings.map((s) => (s.companyId === companyId ? next : s))
          : [...companySettings, next],
      );
      logAudit(
        "company_settings.initialize",
        sourceTemplateName
          ? `Started company settings from template \u201c${sourceTemplateName}\u201d.`
          : "Started company settings from blank.",
        companyId,
      );
      return { ok: true };
    },
    [
      currentUser,
      settingsTemplates,
      companySettings,
      persistCompanySettings,
      cloneSettingsData,
      getUserPermissions,
      logAudit,
    ],
  );

  // ── Services (universal catalog) ──

  /** Whether the signed-in user may manage the service catalog. */
  const canManageServices = useCallback((): boolean => {
    if (!currentUser) return false;
    return (
      (currentUser.role === "super_admin" || currentUser.role === "company_admin") &&
      getUserPermissions(currentUser).includes("services.manage")
    );
  }, [currentUser, getUserPermissions]);

  /** The company scope services are managed in: null = global (Super Admin). */
  const getServiceScope = useCallback<AppContextValue["getServiceScope"]>(() => {
    if (!currentUser) return null;
    return currentUser.role === "super_admin" ? null : currentUser.companyId ?? null;
  }, [currentUser]);

  const getScopedServiceCategories = useCallback<
    AppContextValue["getScopedServiceCategories"]
  >(() => {
    const scope = getServiceScope();
    return serviceCategories
      .filter((c) => c.companyId === scope)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }, [serviceCategories, getServiceScope]);

  const getScopedServices = useCallback<AppContextValue["getScopedServices"]>(() => {
    const scope = getServiceScope();
    return services.filter((s) => s.companyId === scope);
  }, [services, getServiceScope]);

  const createServiceCategory = useCallback<AppContextValue["createServiceCategory"]>(
    (input) => {
      if (!canManageServices()) return { ok: false, error: FORBIDDEN_MESSAGE };
      const name = input.name.trim();
      if (!name) return { ok: false, error: "Category name is required." };
      const scope = getServiceScope();
      const clash = serviceCategories.some(
        (c) => c.companyId === scope && c.name.trim().toLowerCase() === name.toLowerCase(),
      );
      if (clash) return { ok: false, error: "A category with this name already exists." };
      const maxOrder = serviceCategories
        .filter((c) => c.companyId === scope)
        .reduce((m, c) => Math.max(m, c.sortOrder), -1);
      const nowIso = new Date().toISOString();
      const category: ServiceCategory = {
        id: makeId("svc_cat"),
        companyId: scope,
        name,
        categoryType: input.categoryType,
        description: input.description?.trim() || undefined,
        sortOrder: maxOrder + 1,
        status: "active",
        createdBy: currentUser?.id ?? null,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      persistServiceCategories([...serviceCategories, category]);
      logAudit("service_category.create", `Created service category “${name}”.`, scope);
      return { ok: true, category };
    },
    [canManageServices, getServiceScope, serviceCategories, persistServiceCategories, currentUser, logAudit],
  );

  const updateServiceCategory = useCallback<AppContextValue["updateServiceCategory"]>(
    (id, patch) => {
      if (!canManageServices()) return { ok: false, error: FORBIDDEN_MESSAGE };
      const target = serviceCategories.find((c) => c.id === id);
      if (!target || target.companyId !== getServiceScope()) {
        return { ok: false, error: "Category not found." };
      }
      if (patch.name !== undefined) {
        const name = patch.name.trim();
        if (!name) return { ok: false, error: "Category name is required." };
        const clash = serviceCategories.some(
          (c) =>
            c.id !== id &&
            c.companyId === target.companyId &&
            c.name.trim().toLowerCase() === name.toLowerCase(),
        );
        if (clash) return { ok: false, error: "A category with this name already exists." };
      }
      persistServiceCategories(
        serviceCategories.map((c) =>
          c.id === id
            ? {
                ...c,
                name: patch.name !== undefined ? patch.name.trim() : c.name,
                categoryType:
                  patch.categoryType !== undefined ? patch.categoryType : c.categoryType,
                description:
                  patch.description !== undefined
                    ? patch.description.trim() || undefined
                    : c.description,
                updatedAt: new Date().toISOString(),
              }
            : c,
        ),
      );
      logAudit("service_category.update", `Updated service category “${target.name}”.`, target.companyId);
      return { ok: true };
    },
    [canManageServices, getServiceScope, serviceCategories, persistServiceCategories, logAudit],
  );

  const setServiceCategoryArchived = useCallback<
    AppContextValue["setServiceCategoryArchived"]
  >(
    (id, archived) => {
      if (!canManageServices()) return { ok: false, error: FORBIDDEN_MESSAGE };
      const target = serviceCategories.find((c) => c.id === id);
      if (!target || target.companyId !== getServiceScope()) {
        return { ok: false, error: "Category not found." };
      }
      persistServiceCategories(
        serviceCategories.map((c) =>
          c.id === id ? { ...c, status: archived ? "archived" : "active" } : c,
        ),
      );
      logAudit(
        "service_category.archive",
        `${archived ? "Archived" : "Restored"} service category “${target.name}”.`,
        target.companyId,
      );
      return { ok: true };
    },
    [canManageServices, getServiceScope, serviceCategories, persistServiceCategories, logAudit],
  );

  const reorderServiceCategories = useCallback<
    AppContextValue["reorderServiceCategories"]
  >(
    (orderedIds) => {
      if (!canManageServices()) return { ok: false, error: FORBIDDEN_MESSAGE };
      const scope = getServiceScope();
      const orderMap = new Map(orderedIds.map((id, idx) => [id, idx]));
      persistServiceCategories(
        serviceCategories.map((c) =>
          c.companyId === scope && orderMap.has(c.id)
            ? { ...c, sortOrder: orderMap.get(c.id) as number }
            : c,
        ),
      );
      return { ok: true };
    },
    [canManageServices, getServiceScope, serviceCategories, persistServiceCategories],
  );

  const createService = useCallback<AppContextValue["createService"]>(
    (input) => {
      if (!canManageServices()) return { ok: false, error: FORBIDDEN_MESSAGE };
      const name = input.name.trim();
      if (!name) return { ok: false, error: "Service name is required." };
      const scope = getServiceScope();
      const now = new Date().toISOString();
      const service: Service = {
        ...input,
        id: makeId("svc"),
        companyId: scope,
        name,
        serviceBasisType: normalizeServiceBasisType(input.serviceBasisType),
        status: "active",
        createdBy: currentUser?.id ?? null,
        createdAt: now,
        updatedAt: now,
      };
      persistServices([service, ...services]);
      logAudit("service.create", `Created service “${name}”.`, scope);
      if (service.timeCodeId) {
        const code = resolveTimeCode(buildTimeCodeIndex(timeCodes), service.timeCodeId);
        logAudit(
          "timecode.assign",
          `Assigned time code “${code ? `${code.code} — ${code.name}` : service.timeCodeId}” to service “${name}”.`,
          scope,
        );
      }
      return { ok: true, service };
    },
    [canManageServices, getServiceScope, services, persistServices, currentUser, logAudit, timeCodes],
  );

  const updateService = useCallback<AppContextValue["updateService"]>(
    (id, patch) => {
      if (!canManageServices()) return { ok: false, error: FORBIDDEN_MESSAGE };
      const target = services.find((s) => s.id === id);
      if (!target || target.companyId !== getServiceScope()) {
        return { ok: false, error: "Service not found." };
      }
      if (patch.name !== undefined && !patch.name.trim()) {
        return { ok: false, error: "Service name is required." };
      }
      persistServices(
        services.map((s) =>
          s.id === id
            ? {
                ...s,
                ...patch,
                name: patch.name !== undefined ? patch.name.trim() : s.name,
                updatedAt: new Date().toISOString(),
              }
            : s,
        ),
      );
      logAudit("service.update", `Updated service “${target.name}”.`, target.companyId);
      // Record an explicit assignment-change event when the linked time code
      // changes, so payroll/attendance auditing has a precise trail.
      if (patch.timeCodeId !== undefined && patch.timeCodeId !== (target.timeCodeId ?? null)) {
        const index = buildTimeCodeIndex(timeCodes);
        const before = resolveTimeCode(index, target.timeCodeId);
        const after = resolveTimeCode(index, patch.timeCodeId);
        const label = (c: TimeCode | undefined, fallback: string | null | undefined): string =>
          c ? `${c.code} — ${c.name}` : fallback ?? "none";
        logAudit(
          "timecode.assign",
          `Changed time code on service “${target.name}” from “${label(before, target.timeCodeId)}” to “${label(after, patch.timeCodeId)}”.`,
          target.companyId,
        );
      }
      // Record basis-type reclassification explicitly: it changes payroll/invoice
      // inclusion for future generated rows, so it needs a precise audit trail.
      if (
        patch.serviceBasisType !== undefined &&
        patch.serviceBasisType !== target.serviceBasisType
      ) {
        logAudit(
          "service.basis_type",
          `Changed basis type on service “${target.name}” from “${SERVICE_BASIS_TYPE_LABELS[target.serviceBasisType]}” to “${SERVICE_BASIS_TYPE_LABELS[patch.serviceBasisType]}”.`,
          target.companyId,
        );
      }
      return { ok: true };
    },
    [canManageServices, getServiceScope, services, persistServices, logAudit, timeCodes],
  );

  const setServiceArchived = useCallback<AppContextValue["setServiceArchived"]>(
    (id, archived) => {
      if (!canManageServices()) return { ok: false, error: FORBIDDEN_MESSAGE };
      const target = services.find((s) => s.id === id);
      if (!target || target.companyId !== getServiceScope()) {
        return { ok: false, error: "Service not found." };
      }
      persistServices(
        services.map((s) =>
          s.id === id
            ? { ...s, status: archived ? "archived" : "active", updatedAt: new Date().toISOString() }
            : s,
        ),
      );
      logAudit(
        "service.archive",
        `${archived ? "Archived" : "Restored"} service “${target.name}”.`,
        target.companyId,
      );
      return { ok: true };
    },
    [canManageServices, getServiceScope, services, persistServices, logAudit],
  );

  const hardDeleteService = useCallback<AppContextValue["hardDeleteService"]>(
    async (id) => {
      // Only the Super Admin governs the global master catalog. Company admins
      // archive their own copies; they never reach this destructive path.
      if (!currentUser || currentUser.role !== "super_admin" || !canManageServices()) {
        return { ok: false, error: FORBIDDEN_MESSAGE };
      }
      const target = services.find((s) => s.id === id);
      // Client-side guard: the shared safety rule refuses any company-owned
      // service, so a tenant's copied catalog can never be reached even before we
      // touch Supabase.
      const guard = removeGlobalCatalogService(services, id);
      if (!guard.ok) {
        return { ok: false, error: guard.error ?? "Service not found." };
      }
      // Step 1 — clean affected GLOBAL packages in Supabase FIRST. Package items
      // are snapshots that record `sourceServiceId`; permanently deleting a global
      // service must not leave global packages pointing at a row that no longer
      // exists. Doing this BEFORE the destructive delete means a failure here
      // aborts the whole operation (nothing changes) and a hard refresh can never
      // resurrect an orphaned package item. Packages are global master data, so
      // this never touches any company-owned copied service/category. The cleanup
      // is idempotent, so retrying after a partial failure is safe.
      let cleanedPackages: ServicePackage[] = [];
      try {
        cleanedPackages = await removeServiceFromGlobalPackagesInSupabase(id);
      } catch (err) {
        return {
          ok: false,
          error: `Couldn't update the packages that use this service. ${err instanceof Error ? err.message : "Please try again."}`,
        };
      }
      // Reflect the committed package cleanup in local state immediately (Supabase
      // is already authoritative for it) and trigger a directory refetch so the
      // editor/catalog tags drop the orphaned items right away.
      if (cleanedPackages.length > 0) {
        const cleanedById = new Map(cleanedPackages.map((p) => [p.id, p]));
        persistServicePackages(
          servicePackages.map((p) => cleanedById.get(p.id) ?? p),
        );
        setServicePackageReloadToken((n) => n + 1);
      }
      // Step 2 — delete the GLOBAL service row. The repository DELETE is pinned to
      // company_id/company_legacy_id null and the migration-0049 RLS policy
      // independently enforces super-admin + global-only, so company copies are
      // protected at the database level too. A 0-row result (RLS block / already
      // gone) or any error keeps the service visible and surfaces the failure —
      // no localStorage / browser-domain mirror fallback.
      try {
        const deletedCount = await hardDeleteGlobalServiceInSupabase(id);
        if (deletedCount < 1) {
          return {
            ok: false,
            error:
              "Supabase did not delete the global service. It may be protected or already removed — the service was kept.",
          };
        }
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Supabase delete failed.",
        };
      }
      // Only AFTER a confirmed Supabase delete do we refresh the catalog directory
      // so the read seam refetches and the UI renders without the row. No
      // persistServices / localStorage write happens on this path.
      bumpServiceCatalogDirectoryRefresh();
      logAudit(
        "service.delete",
        `Permanently deleted global catalog service “${target?.name ?? id}”.`,
        null,
      );
      return { ok: true, removedFromPackages: cleanedPackages.length };
    },
    [
      currentUser,
      canManageServices,
      services,
      servicePackages,
      persistServicePackages,
      logAudit,
    ],
  );

  // ── Time Codes (payroll foundation) ──

  /** Whether the current user may manage the master time-code library. */
  const canManageTimeCodes = useCallback((): boolean => {
    if (!currentUser) return false;
    return (
      currentUser.role === "super_admin" &&
      getUserPermissions(currentUser).includes("settings.timecodes.manage")
    );
  }, [currentUser, getUserPermissions]);

  /** Whether the current user may view time codes. */
  const canViewTimeCodes = useCallback((): boolean => {
    if (!currentUser) return false;
    return getUserPermissions(currentUser).includes("settings.timecodes.view");
  }, [currentUser, getUserPermissions]);

  /** O(1) lookup index over all time codes, rebuilt only when the list changes. */
  const timeCodeIndex = useMemo(() => buildTimeCodeIndex(timeCodes), [timeCodes]);

  /** Usage counts keyed by time-code id, computed once per service-list change. */
  const timeCodeUsage = useMemo(() => timeCodeUsageMap(services), [services]);

  // TIMECODE-5: when the directory is read from Supabase (cut-over ON in app
  // builds), every mutation MUST commit to Supabase FIRST and the UI updates
  // only via the post-write directory refetch — no localStorage authority, no
  // browser-domain mirror, no optimistic persistence. Flag OFF (vitest/rollback)
  // keeps the legacy localStorage path so rollback stays instant + data-free.
  const timeCodesSupabaseAuthoritative = useMemo(
    () => shouldReadTimeCodesFromSupabase() && isSupabaseConfigured,
    [],
  );

  const getTimeCodeById = useCallback<AppContextValue["getTimeCodeById"]>(
    (id) => resolveTimeCode(timeCodeIndex, id),
    [timeCodeIndex],
  );

  const getAvailableTimeCodes = useCallback<AppContextValue["getAvailableTimeCodes"]>(
    () => availableTimeCodes(timeCodes, currentUser?.companyId ?? null),
    [timeCodes, currentUser?.companyId],
  );

  const getTimeCodeUsageCount = useCallback<AppContextValue["getTimeCodeUsageCount"]>(
    (id) => timeCodeUsage.get(id) ?? 0,
    [timeCodeUsage],
  );

  const getServicesForTimeCode = useCallback<AppContextValue["getServicesForTimeCode"]>(
    (id) => linkedServicesForTimeCode(id, services),
    [services],
  );

  const createTimeCode = useCallback<AppContextValue["createTimeCode"]>(
    async (input) => {
      if (!canManageTimeCodes()) return { ok: false, error: FORBIDDEN_MESSAGE };
      const code = input.code.trim();
      const name = input.name.trim();
      if (!code) return { ok: false, error: "Code is required." };
      if (!name) return { ok: false, error: "Name is required." };
      const normalized = normalizeTimeCode(code);
      const clash = timeCodes.some(
        (t) => t.companyId === null && normalizeTimeCode(t.code) === normalized,
      );
      if (clash) return { ok: false, error: "A time code with this code already exists." };
      const now = new Date().toISOString();
      const timeCode: TimeCode = {
        id: makeId("tc"),
        companyId: null,
        code,
        name,
        type: input.type,
        description: input.description?.trim() || undefined,
        active: input.active ?? true,
        systemManaged: false,
        createdAt: now,
        updatedAt: now,
      };
      if (timeCodesSupabaseAuthoritative) {
        try {
          await createTimeCodeInSupabase(timeCode);
        } catch (err) {
          return {
            ok: false,
            error: err instanceof Error ? err.message : "Failed to create the time code.",
          };
        }
        bumpTimeCodeDirectoryRefresh();
        logAudit("timecode.create", `Created time code “${code} — ${name}”.`, null);
        return { ok: true, timeCode };
      }
      persistTimeCodes([...timeCodes, timeCode]);
      logAudit("timecode.create", `Created time code “${code} — ${name}”.`, null);
      return { ok: true, timeCode };
    },
    [canManageTimeCodes, timeCodes, timeCodesSupabaseAuthoritative, persistTimeCodes, logAudit],
  );

  const updateTimeCode = useCallback<AppContextValue["updateTimeCode"]>(
    async (id, patch) => {
      if (!canManageTimeCodes()) return { ok: false, error: FORBIDDEN_MESSAGE };
      const target = timeCodes.find((t) => t.id === id);
      if (!target) return { ok: false, error: "Time code not found." };
      if (patch.code !== undefined) {
        const code = patch.code.trim();
        if (!code) return { ok: false, error: "Code is required." };
        const normalized = normalizeTimeCode(code);
        const clash = timeCodes.some(
          (t) =>
            t.id !== id &&
            t.companyId === target.companyId &&
            normalizeTimeCode(t.code) === normalized,
        );
        if (clash) return { ok: false, error: "A time code with this code already exists." };
      }
      if (patch.name !== undefined && !patch.name.trim()) {
        return { ok: false, error: "Name is required." };
      }
      const updated: TimeCode = {
        ...target,
        code: patch.code !== undefined ? patch.code.trim() : target.code,
        name: patch.name !== undefined ? patch.name.trim() : target.name,
        type: patch.type ?? target.type,
        description:
          patch.description !== undefined
            ? patch.description.trim() || undefined
            : target.description,
        updatedAt: new Date().toISOString(),
      };
      if (timeCodesSupabaseAuthoritative) {
        try {
          await updateTimeCodeInSupabase(updated);
        } catch (err) {
          return {
            ok: false,
            error: err instanceof Error ? err.message : "Failed to update the time code.",
          };
        }
        bumpTimeCodeDirectoryRefresh();
        logAudit("timecode.update", `Updated time code “${updated.code} — ${updated.name}”.`, null);
        return { ok: true };
      }
      persistTimeCodes(timeCodes.map((t) => (t.id === id ? updated : t)));
      logAudit("timecode.update", `Updated time code “${updated.code} — ${updated.name}”.`, null);
      return { ok: true };
    },
    [canManageTimeCodes, timeCodes, timeCodesSupabaseAuthoritative, persistTimeCodes, logAudit],
  );

  const setTimeCodeActive = useCallback<AppContextValue["setTimeCodeActive"]>(
    async (id, active) => {
      if (!canManageTimeCodes()) return { ok: false, error: FORBIDDEN_MESSAGE };
      const target = timeCodes.find((t) => t.id === id);
      if (!target) return { ok: false, error: "Time code not found." };
      if (target.active === active) return { ok: true };
      const updated: TimeCode = { ...target, active, updatedAt: new Date().toISOString() };
      const auditActiveChange = (): void =>
        logAudit(
          active ? "timecode.activate" : "timecode.deactivate",
          `${active ? "Activated" : "Deactivated"} time code “${target.code} — ${target.name}”.`,
          null,
        );
      if (timeCodesSupabaseAuthoritative) {
        try {
          await updateTimeCodeInSupabase(updated);
        } catch (err) {
          return {
            ok: false,
            error: err instanceof Error ? err.message : "Failed to update the time code status.",
          };
        }
        bumpTimeCodeDirectoryRefresh();
        auditActiveChange();
        return { ok: true };
      }
      persistTimeCodes(timeCodes.map((t) => (t.id === id ? updated : t)));
      auditActiveChange();
      return { ok: true };
    },
    [canManageTimeCodes, timeCodes, timeCodesSupabaseAuthoritative, persistTimeCodes, logAudit],
  );

  const deleteTimeCode = useCallback<AppContextValue["deleteTimeCode"]>(
    async (id) => {
      if (!canManageTimeCodes()) return { ok: false, error: FORBIDDEN_MESSAGE };
      const target = timeCodes.find((t) => t.id === id);
      if (!target) return { ok: false, error: "Time code not found." };
      if (!canDeleteTimeCode(target, timeCodeUsage)) {
        return {
          ok: false,
          error: target.systemManaged
            ? "System-managed time codes cannot be deleted. Deactivate it instead."
            : "This time code is in use by one or more services. Deactivate it instead.",
        };
      }
      if (timeCodesSupabaseAuthoritative) {
        try {
          await softDeleteTimeCodeInSupabase(id);
        } catch (err) {
          return {
            ok: false,
            error: err instanceof Error ? err.message : "Failed to delete the time code.",
          };
        }
        bumpTimeCodeDirectoryRefresh();
        logAudit("timecode.update", `Deleted time code “${target.code} — ${target.name}”.`, null);
        return { ok: true };
      }
      persistTimeCodes(timeCodes.filter((t) => t.id !== id));
      logAudit("timecode.update", `Deleted time code “${target.code} — ${target.name}”.`, null);
      return { ok: true };
    },
    [
      canManageTimeCodes,
      timeCodes,
      timeCodeUsage,
      timeCodesSupabaseAuthoritative,
      persistTimeCodes,
      logAudit,
    ],
  );

  // ── Payroll Export (architecture foundation) ──

  /** Whether the current user may activate export capabilities (Super Admin). */
  const canManagePayrollExportEntitlements = useCallback((): boolean => {
    if (!currentUser) return false;
    return (
      currentUser.role === "super_admin" &&
      getUserPermissions(currentUser).includes("payroll.export.entitlements.manage")
    );
  }, [currentUser, getUserPermissions]);

  /** Whether the current user may view the payroll export module. */
  const canViewPayrollExport = useCallback((): boolean => {
    if (!currentUser) return false;
    return getUserPermissions(currentUser).includes("payroll.export.view");
  }, [currentUser, getUserPermissions]);

  /** Whether the current user may create/edit export profiles. */
  const canManagePayrollExportProfiles = useCallback((): boolean => {
    if (!currentUser) return false;
    return getUserPermissions(currentUser).includes("payroll.export.manage");
  }, [currentUser, getUserPermissions]);

  /** Whether the current user may run exports. */
  const canRunPayrollExport = useCallback((): boolean => {
    if (!currentUser) return false;
    return getUserPermissions(currentUser).includes("payroll.export.run");
  }, [currentUser, getUserPermissions]);

  /** Whether the current user may act on resources owned by a given company. */
  const canActOnPayrollCompany = useCallback(
    (companyId: string): boolean => {
      if (!currentUser) return false;
      return inCompanyScope(currentUser, companyId);
    },
    [currentUser],
  );

  /** O(1) capability index, rebuilt only when capabilities change. */
  const payrollCapabilityIndex = useMemo(
    () => buildCapabilityIndex(payrollExportCapabilities),
    [payrollExportCapabilities],
  );

  const isPayrollExportTargetEnabled = useCallback<
    AppContextValue["isPayrollExportTargetEnabled"]
  >(
    (companyId, target) => isTargetEnabledForCompany(payrollCapabilityIndex, companyId, target),
    [payrollCapabilityIndex],
  );

  const getAvailablePayrollExportTargets = useCallback<
    AppContextValue["getAvailablePayrollExportTargets"]
  >(
    (companyId, options) => {
      const scope = companyId ?? currentUser?.companyId ?? null;
      if (!scope) return [];
      return availableTargetsForCompany(payrollCapabilityIndex, scope, options);
    },
    [payrollCapabilityIndex, currentUser?.companyId],
  );

  const getPayrollExportProfilesForCompany = useCallback<
    AppContextValue["getPayrollExportProfilesForCompany"]
  >(
    (companyId) => {
      const scope = companyId ?? currentUser?.companyId ?? null;
      if (!scope) return [];
      return profilesForCompany(payrollExportProfiles, scope);
    },
    [payrollExportProfiles, currentUser?.companyId],
  );

  const getRunnablePayrollExportProfiles = useCallback<
    AppContextValue["getRunnablePayrollExportProfiles"]
  >(
    (companyId) => {
      const scope = companyId ?? currentUser?.companyId ?? null;
      if (!scope) return [];
      return runnableProfiles(payrollExportProfiles, payrollCapabilityIndex, scope);
    },
    [payrollExportProfiles, payrollCapabilityIndex, currentUser?.companyId],
  );

  const getPayrollExportRunsForCompany = useCallback<
    AppContextValue["getPayrollExportRunsForCompany"]
  >(
    (companyId) => {
      const scope = companyId ?? currentUser?.companyId ?? null;
      if (!scope) return [];
      return runsForCompany(payrollExportRuns, scope);
    },
    [payrollExportRuns, currentUser?.companyId],
  );

  const setPayrollExportCapability = useCallback<
    AppContextValue["setPayrollExportCapability"]
  >(
    (companyId, target, enabled) => {
      if (!canManagePayrollExportEntitlements()) {
        return { ok: false, error: FORBIDDEN_MESSAGE };
      }
      const now = new Date().toISOString();
      const existing = payrollExportCapabilities.find(
        (c) => c.companyId === companyId && c.target === target,
      );
      if (existing && existing.enabled === enabled) return { ok: true };
      const updated: PayrollExportCapability = {
        companyId,
        target,
        enabled,
        enabledAt: enabled ? now : existing?.enabledAt ?? null,
        updatedBy: currentUser?.id ?? null,
        updatedAt: now,
      };
      const next = existing
        ? payrollExportCapabilities.map((c) =>
            c.companyId === companyId && c.target === target ? updated : c,
          )
        : [...payrollExportCapabilities, updated];
      persistPayrollExportCapabilities(next);
      logAudit(
        enabled ? "payroll.export.capability.enable" : "payroll.export.capability.disable",
        `${enabled ? "Enabled" : "Disabled"} payroll export “${PAYROLL_EXPORT_TARGET_LABELS[target]}” for company.`,
        companyId,
      );
      return { ok: true };
    },
    [
      canManagePayrollExportEntitlements,
      payrollExportCapabilities,
      persistPayrollExportCapabilities,
      currentUser?.id,
      logAudit,
    ],
  );

  const createPayrollExportProfile = useCallback<
    AppContextValue["createPayrollExportProfile"]
  >(
    (input) => {
      if (!canManagePayrollExportProfiles()) return { ok: false, error: FORBIDDEN_MESSAGE };
      const companyId = input.companyId ?? currentUser?.companyId ?? null;
      if (!companyId) return { ok: false, error: "A company is required." };
      if (!canActOnPayrollCompany(companyId)) return { ok: false, error: FORBIDDEN_MESSAGE };
      const name = input.name.trim();
      if (!name) return { ok: false, error: "Name is required." };
      if (!isTargetEnabledForCompany(payrollCapabilityIndex, companyId, input.target)) {
        return {
          ok: false,
          error: "This export type is not enabled for the company. Ask a platform admin to enable it.",
        };
      }
      const now = new Date().toISOString();
      const profile: PayrollExportProfile = {
        id: makeId("pep"),
        companyId,
        name,
        target: input.target,
        active: input.active ?? true,
        config: input.config ?? {},
        credentialsRef: null,
        createdBy: currentUser?.id ?? null,
        createdAt: now,
        updatedAt: now,
      };
      persistPayrollExportProfiles([...payrollExportProfiles, profile]);
      logAudit(
        "payroll.export.profile.create",
        `Created payroll export profile “${name}” (${PAYROLL_EXPORT_TARGET_LABELS[input.target]}).`,
        companyId,
      );
      return { ok: true, profile };
    },
    [
      canManagePayrollExportProfiles,
      canActOnPayrollCompany,
      currentUser?.companyId,
      currentUser?.id,
      payrollCapabilityIndex,
      payrollExportProfiles,
      persistPayrollExportProfiles,
      logAudit,
    ],
  );

  const updatePayrollExportProfile = useCallback<
    AppContextValue["updatePayrollExportProfile"]
  >(
    (id, patch) => {
      if (!canManagePayrollExportProfiles()) return { ok: false, error: FORBIDDEN_MESSAGE };
      const target = payrollExportProfiles.find((p) => p.id === id);
      if (!target) return { ok: false, error: "Export profile not found." };
      if (!canActOnPayrollCompany(target.companyId)) {
        return { ok: false, error: FORBIDDEN_MESSAGE };
      }
      if (patch.name !== undefined && !patch.name.trim()) {
        return { ok: false, error: "Name is required." };
      }
      const updated: PayrollExportProfile = {
        ...target,
        name: patch.name !== undefined ? patch.name.trim() : target.name,
        config: patch.config ?? target.config,
        updatedAt: new Date().toISOString(),
      };
      persistPayrollExportProfiles(
        payrollExportProfiles.map((p) => (p.id === id ? updated : p)),
      );
      logAudit(
        "payroll.export.profile.update",
        `Updated payroll export profile “${updated.name}”.`,
        target.companyId,
      );
      return { ok: true };
    },
    [
      canManagePayrollExportProfiles,
      canActOnPayrollCompany,
      payrollExportProfiles,
      persistPayrollExportProfiles,
      logAudit,
    ],
  );

  const setPayrollExportProfileActive = useCallback<
    AppContextValue["setPayrollExportProfileActive"]
  >(
    (id, active) => {
      if (!canManagePayrollExportProfiles()) return { ok: false, error: FORBIDDEN_MESSAGE };
      const target = payrollExportProfiles.find((p) => p.id === id);
      if (!target) return { ok: false, error: "Export profile not found." };
      if (!canActOnPayrollCompany(target.companyId)) {
        return { ok: false, error: FORBIDDEN_MESSAGE };
      }
      if (target.active === active) return { ok: true };
      persistPayrollExportProfiles(
        payrollExportProfiles.map((p) =>
          p.id === id ? { ...p, active, updatedAt: new Date().toISOString() } : p,
        ),
      );
      logAudit(
        active ? "payroll.export.profile.activate" : "payroll.export.profile.deactivate",
        `${active ? "Activated" : "Deactivated"} payroll export profile “${target.name}”.`,
        target.companyId,
      );
      return { ok: true };
    },
    [
      canManagePayrollExportProfiles,
      canActOnPayrollCompany,
      payrollExportProfiles,
      persistPayrollExportProfiles,
      logAudit,
    ],
  );

  const deletePayrollExportProfile = useCallback<
    AppContextValue["deletePayrollExportProfile"]
  >(
    (id) => {
      if (!canManagePayrollExportProfiles()) return { ok: false, error: FORBIDDEN_MESSAGE };
      const target = payrollExportProfiles.find((p) => p.id === id);
      if (!target) return { ok: false, error: "Export profile not found." };
      if (!canActOnPayrollCompany(target.companyId)) {
        return { ok: false, error: FORBIDDEN_MESSAGE };
      }
      persistPayrollExportProfiles(payrollExportProfiles.filter((p) => p.id !== id));
      logAudit(
        "payroll.export.profile.delete",
        `Deleted payroll export profile “${target.name}”.`,
        target.companyId,
      );
      return { ok: true };
    },
    [
      canManagePayrollExportProfiles,
      canActOnPayrollCompany,
      payrollExportProfiles,
      persistPayrollExportProfiles,
      logAudit,
    ],
  );

  const runPayrollExport = useCallback<AppContextValue["runPayrollExport"]>(
    (profileId, basis) => {
      if (!canRunPayrollExport()) return { ok: false, error: FORBIDDEN_MESSAGE };
      const profile = payrollExportProfiles.find((p) => p.id === profileId);
      if (!profile) return { ok: false, error: "Export profile not found." };
      if (!canActOnPayrollCompany(profile.companyId)) {
        return { ok: false, error: FORBIDDEN_MESSAGE };
      }
      if (!profile.active) return { ok: false, error: "Export profile is inactive." };
      if (!isTargetEnabledForCompany(payrollCapabilityIndex, profile.companyId, profile.target)) {
        return { ok: false, error: "This export type is no longer enabled for the company." };
      }
      if (basis.companyId !== profile.companyId) {
        return { ok: false, error: "Payroll basis belongs to a different company." };
      }
      const adapter = getPayrollExportAdapter(profile.target);
      const result = adapter.transform({
        profile,
        basis,
        timeCodes: timeCodeIndex.byId,
        now: new Date(),
      });
      const now = new Date().toISOString();
      const run: PayrollExportRun = {
        id: makeId("per"),
        companyId: profile.companyId,
        profileId: profile.id,
        basisId: basis.id,
        status: result.ok
          ? result.warnings.length > 0
            ? "partial"
            : "success"
          : "failed",
        timestamp: now,
        userId: currentUser?.id ?? null,
        rowsIncluded: result.rowsIncluded,
        warnings: result.warnings,
        errors: result.errors,
        resultRef:
          result.output.kind === "file"
            ? result.output.filename
            : result.output.kind === "reference"
              ? result.output.reference
              : null,
        createdAt: now,
      };
      persistPayrollExportRuns([run, ...payrollExportRuns]);
      logAudit(
        "payroll.export.run",
        `Ran payroll export “${profile.name}” (${PAYROLL_EXPORT_TARGET_LABELS[profile.target]}) — ${run.status}, ${run.rowsIncluded} row(s).`,
        profile.companyId,
      );
      return { ok: result.ok, run, output: result.output };
    },
    [
      canRunPayrollExport,
      canActOnPayrollCompany,
      payrollExportProfiles,
      payrollCapabilityIndex,
      timeCodeIndex,
      currentUser?.id,
      payrollExportRuns,
      persistPayrollExportRuns,
      logAudit,
    ],
  );

  // ── Service Packages (Super Admin) ──

  const getSelectableServicePackages = useCallback<
    AppContextValue["getSelectableServicePackages"]
  >(() => servicePackages.filter((p) => !p.archived), [servicePackages]);

  const createServicePackage = useCallback<AppContextValue["createServicePackage"]>(
    async (input) => {
      if (!currentUser || currentUser.role !== "super_admin" || !canManageServices()) {
        return { ok: false, error: FORBIDDEN_MESSAGE };
      }
      const name = input.name.trim();
      if (!name) return { ok: false, error: "Package name is required." };
      const clash = servicePackages.some(
        (p) => p.name.trim().toLowerCase() === name.toLowerCase(),
      );
      if (clash) return { ok: false, error: "A service package with this name already exists." };
      const now = new Date().toISOString();
      const servicePackage: ServicePackage = {
        id: makeId("svc_pkg"),
        name,
        description: input.description?.trim() || undefined,
        archived: false,
        createdBy: currentUser.id,
        items: input.items ?? [],
        createdAt: now,
        updatedAt: now,
      };
      // Supabase is authoritative: persist to the server FIRST. Only commit the
      // optimistic UI change after the write succeeds so a failure never leaves a
      // package that vanishes on refresh.
      try {
        await upsertServicePackageToSupabase(servicePackage);
      } catch (err) {
        return {
          ok: false,
          error: `Couldn't save the package. ${err instanceof Error ? err.message : "Please try again."}`,
        };
      }
      persistServicePackages([servicePackage, ...servicePackages]);
      setServicePackageReloadToken((n) => n + 1);
      logAudit("service_package.create", `Created service package “${name}”.`, null);
      return { ok: true, servicePackage };
    },
    [currentUser, canManageServices, servicePackages, persistServicePackages, logAudit],
  );

  const updateServicePackage = useCallback<AppContextValue["updateServicePackage"]>(
    async (id, patch) => {
      if (!currentUser || currentUser.role !== "super_admin" || !canManageServices()) {
        return { ok: false, error: FORBIDDEN_MESSAGE };
      }
      const target = servicePackages.find((p) => p.id === id);
      if (!target) return { ok: false, error: "Service package not found." };
      if (patch.name !== undefined) {
        const name = patch.name.trim();
        if (!name) return { ok: false, error: "Package name is required." };
        const clash = servicePackages.some(
          (p) => p.id !== id && p.name.trim().toLowerCase() === name.toLowerCase(),
        );
        if (clash) return { ok: false, error: "A service package with this name already exists." };
      }
      const updated: ServicePackage = {
        ...target,
        ...patch,
        name: patch.name !== undefined ? patch.name.trim() : target.name,
        description:
          patch.description !== undefined
            ? patch.description.trim() || undefined
            : target.description,
        updatedAt: new Date().toISOString(),
      };
      try {
        await upsertServicePackageToSupabase(updated);
      } catch (err) {
        return {
          ok: false,
          error: `Couldn't save the package. ${err instanceof Error ? err.message : "Please try again."}`,
        };
      }
      persistServicePackages(servicePackages.map((p) => (p.id === id ? updated : p)));
      setServicePackageReloadToken((n) => n + 1);
      logAudit("service_package.update", `Updated service package “${target.name}”.`, null);
      return { ok: true };
    },
    [currentUser, canManageServices, servicePackages, persistServicePackages, logAudit],
  );

  const setServicePackageArchived = useCallback<
    AppContextValue["setServicePackageArchived"]
  >(
    async (id, archived) => {
      if (!currentUser || currentUser.role !== "super_admin" || !canManageServices()) {
        return { ok: false, error: FORBIDDEN_MESSAGE };
      }
      const target = servicePackages.find((p) => p.id === id);
      if (!target) return { ok: false, error: "Service package not found." };
      // Archive/restore is a reversible status flip persisted to Supabase — the
      // row is kept (never hard-deleted), so it can always be restored.
      const updated: ServicePackage = {
        ...target,
        archived,
        updatedAt: new Date().toISOString(),
      };
      try {
        await upsertServicePackageToSupabase(updated);
      } catch (err) {
        return {
          ok: false,
          error: `Couldn't ${archived ? "archive" : "restore"} the package. ${err instanceof Error ? err.message : "Please try again."}`,
        };
      }
      persistServicePackages(servicePackages.map((p) => (p.id === id ? updated : p)));
      setServicePackageReloadToken((n) => n + 1);
      logAudit(
        "service_package.archive",
        `${archived ? "Archived" : "Restored"} service package “${target.name}”.`,
        null,
      );
      return { ok: true };
    },
    [currentUser, canManageServices, servicePackages, persistServicePackages, logAudit],
  );

  const duplicateServicePackage = useCallback<
    AppContextValue["duplicateServicePackage"]
  >(
    async (id) => {
      if (!currentUser || currentUser.role !== "super_admin" || !canManageServices()) {
        return { ok: false, error: FORBIDDEN_MESSAGE };
      }
      const source = servicePackages.find((p) => p.id === id);
      if (!source) return { ok: false, error: "Service package not found." };
      const now = new Date().toISOString();
      const copy: ServicePackage = {
        ...source,
        id: makeId("svc_pkg"),
        name: `${source.name} (Copy)`,
        archived: false,
        createdBy: currentUser.id,
        items: source.items.map((it) => ({ ...it, id: makeId("svc_pkg_item") })),
        createdAt: now,
        updatedAt: now,
      };
      try {
        await upsertServicePackageToSupabase(copy);
      } catch (err) {
        return {
          ok: false,
          error: `Couldn't duplicate the package. ${err instanceof Error ? err.message : "Please try again."}`,
        };
      }
      persistServicePackages([copy, ...servicePackages]);
      setServicePackageReloadToken((n) => n + 1);
      logAudit("service_package.clone", `Duplicated service package “${source.name}”.`, null);
      return { ok: true, servicePackage: copy };
    },
    [currentUser, canManageServices, servicePackages, persistServicePackages, logAudit],
  );

  const value = useMemo<AppContextValue>(
    () => ({
      currentUser: impersonatedUser ?? currentUser,
      originalUser: currentUser,
      isAuthRestoring,
      isViewingAsCustomer: viewAsCustomerId !== null,
      viewAsCustomer,
      isViewingAsEmployee: viewAsEmployeeId !== null,
      viewAsEmployee,
      isReadOnlyPreview: impersonatedUser !== null,
      timeReports: visibleTimeReports,
      getTimeReportsForWorkOrder,
      submitTimeReportCheckout,
      bookingQueue: visibleBookingQueue,
      bookingOccurrenceExceptions,
      getBookingQueueForWorkOrder,
      cancelBooking,
      restoreBooking,
      cancelOccurrence,
      restoreOccurrence,
      rescheduleOccurrence,
      reassignOccurrence,
      clearOccurrenceAssignment,
      rescheduleBooking,
      startViewAsCustomer,
      exitViewAsCustomer,
      startViewAsEmployee,
      exitViewAsEmployee,
      companies,
      users,
      login,
      logout,
      requestReset,
      resetPassword,
      completeOnboardingLogin,
      createCompany,
      updateCompany,
      createUser,
      updateUser,
      roles,
      createRole,
      updateRole,
      deleteRole,
      assignUserRole,
      getUserPermissions,
      hasPermission,
      auditEvents: visibleAuditEvents,
      logAudit,
      employees,
      customers,
      teams,
      areas,
      areaScopedAccessEnabled:
        areaScopedAccessTick >= 0 &&
        isAreaScopedAccessEnabled((impersonatedUser ?? currentUser)?.companyId ?? null),
      getAreaActivationPrecheck,
      setAreaScopedAccessEnabled,
      createArea,
      updateArea,
      archiveArea,
      restoreArea,
      postalCities,
      autoAreaFromPostalCityEnabled:
        autoAreaTick >= 0 &&
        isAutoAreaFromPostalCityEnabled((impersonatedUser ?? currentUser)?.companyId ?? null),
      setAutoAreaFromPostalCityEnabled,
      createPostalCity,
      updatePostalCity,
      archivePostalCity,
      restorePostalCity,
      employeeLanguages,
      createEmployeeLanguage,
      updateEmployeeLanguage,
      archiveEmployeeLanguage,
      restoreEmployeeLanguage,
      setEmployeeLanguageDefault,
      createEmployee,
      updateEmployee,
      createEmployeeWithLogin,
      createLoginForEmployee,
      getEmployeeDeletability,
      deleteEmployee,
      archiveEmployee,
      createCustomer,
      updateCustomer,
      deleteCustomer,
      archiveCustomer,
      logCustomerMediaActivity,
      logCustomerMediaMetaChange,
      setCustomerCoverImage,
      logWorkOrderMediaActivity,
      addWorkOrderMediaPlacement,
      removeWorkOrderMediaPlacement,
      reorderWorkOrderMediaPlacements,
      setWorkOrderMediaPlacementEmployeeVisibility,
      purgeWorkOrderMediaPlacementsForAsset,
      workOrders,
      getCustomerWorkOrders,
      createWorkOrder,
      setWorkOrderActive,
      archiveWorkOrder,
      deleteWorkOrder,
      forceDeleteWorkOrder,
      getWorkOrderRelatedData,
      workOrderSettings,
      getWorkOrderSettingsFor,
      updateWorkOrderSettings,
      timeReportSettings,
      getTimeReportSettingsFor,
      updateTimeReportSettings,
      durationSettings,
      getDurationSettingsFor,
      updateDurationSettings,
      systemSettings,
      updateSystemSettings,
      serviceGlobalEntitlements,
      companyServiceEntitlements,
      serviceEntitlementLog,
      isServiceGloballyAvailable,
      getCompanyServiceEntitlement,
      isCompanyEntitledToService,
      isServiceAvailableForCompany,
      setServiceGlobalAvailability,
      setCompanyServiceEntitlement,
      getCompanyServiceStatus,
      getEffectiveCompanyServiceStatus,
      setCompanyServiceStatus,
      evaluateMediaUploadGate,
      getCompanyMediaUsage,
      getWorkOrder,
      hydrateCustomerFromRemote,
      hydrateCustomersFromRemote,
      hydrateWorkOrderFromRemote,
      updateWorkOrder,
      addWorkOrderNote,
      updateWorkOrderNote,
      setWorkOrderNoteArchived,
      getServicesForCompany,
      getServiceCategoriesForCompany,
      getCompanyServiceFavorites,
      isServiceFavorite,
      toggleServiceFavorite,
      addWorkOrderServiceRow,
      updateWorkOrderServiceRow,
      setWorkOrderServiceRowArchived,
      deleteWorkOrderServiceRow,
      forceDeleteWorkOrderServiceRow,
      reorderWorkOrderServiceRows,
      addServiceRowVariation,
      updateServiceRowVariation,
      replaceServiceRowVariation,
      setServiceRowVariationEnabled,
      setServiceRowVariationArchived,
      stopServiceRowVariation,
      deleteServiceRowVariation,
      setServiceRowVariationStatus,
      invoices,
      getCustomerInvoices,
      createTeam,
      updateTeam,
      deleteTeam,
      modules,
      companyModules,
      setModuleStatus,
      setModuleAvailable,
      setModuleEnabled,
      getCompanyModuleSetting,
      canAccessModule,
      getModuleEntitlementAvailability,
      getAccessibleModules,
      moduleCategories,
      createCategory,
      updateCategory,
      deleteCategory,
      reorderCategories,
      getNavModuleGroups,
      checklistTemplates,
      checklistAdoptions,
      getVisibleTemplates,
      canEditTemplate,
      createTemplate,
      cloneTemplate,
      updateTemplate,
      addFloor,
      updateFloor,
      deleteFloor,
      setFloorArchived,
      reorderFloors,
      addRoom,
      updateRoom,
      deleteRoom,
      setRoomArchived,
      reorderRooms,
      addTask,
      updateTask,
      deleteTask,
      setTaskArchived,
      reorderTasks,
      setChecklistNotesImages,
      getTemplateAdoption,
      setTemplateAdopted,
      customerProtocols,
      getVisibleProtocols,
      getMyProtocols,
      canViewMyProtocol,
      canEditProtocol,
      createProtocol,
      updateProtocol,
      setProtocolArchived,
      duplicateProtocol,
      setProtocolRoomActive,
      setProtocolTaskState,
      setProtocolNotes,
      saveProtocol,
      libraryRooms,
      libraryTasks,
      getVisibleLibraryRooms,
      getVisibleLibraryTasks,
      canEditLibraryRoom,
      canEditLibraryTask,
      createLibraryRoom,
      updateLibraryRoom,
      setLibraryRoomArchived,
      createLibraryTask,
      updateLibraryTask,
      setLibraryTaskArchived,
      addRoomsFromLibrary,
      addTasksFromLibrary,
      settingsTemplates,
      companySettings,
      getSelectableSettingsTemplates,
      createSettingsTemplate,
      updateSettingsTemplate,
      setSettingsTemplateArchived,
      duplicateSettingsTemplate,
      getCompanySettingsFor,
      initializeCompanySettings,
      serviceCategories,
      payrollGroups,
      services,
      servicePackages,
      getServiceScope,
      getScopedServiceCategories,
      getScopedServices,
      createServiceCategory,
      updateServiceCategory,
      setServiceCategoryArchived,
      reorderServiceCategories,
      createService,
      updateService,
      setServiceArchived,
      hardDeleteService,
      getSelectableServicePackages,
      createServicePackage,
      updateServicePackage,
      setServicePackageArchived,
      duplicateServicePackage,
      timeCodes,
      canManageTimeCodes,
      canViewTimeCodes,
      getTimeCodeById,
      getAvailableTimeCodes,
      getTimeCodeUsageCount,
      getServicesForTimeCode,
      createTimeCode,
      updateTimeCode,
      setTimeCodeActive,
      deleteTimeCode,
      payrollExportCapabilities,
      payrollExportProfiles,
      payrollExportRuns,
      canManagePayrollExportEntitlements,
      canViewPayrollExport,
      canManagePayrollExportProfiles,
      canRunPayrollExport,
      isPayrollExportTargetEnabled,
      getAvailablePayrollExportTargets,
      getPayrollExportProfilesForCompany,
      getRunnablePayrollExportProfiles,
      getPayrollExportRunsForCompany,
      setPayrollExportCapability,
      createPayrollExportProfile,
      updatePayrollExportProfile,
      setPayrollExportProfileActive,
      deletePayrollExportProfile,
      runPayrollExport,
    }),
    [
      currentUser,
      impersonatedUser,
      isAuthRestoring,
      viewAsCustomerId,
      viewAsCustomer,
      viewAsEmployeeId,
      viewAsEmployee,
      visibleTimeReports,
      getTimeReportsForWorkOrder,
      submitTimeReportCheckout,
      visibleBookingQueue,
      bookingOccurrenceExceptions,
      getBookingQueueForWorkOrder,
      cancelBooking,
      restoreBooking,
      cancelOccurrence,
      restoreOccurrence,
      rescheduleOccurrence,
      reassignOccurrence,
      clearOccurrenceAssignment,
      rescheduleBooking,
      startViewAsCustomer,
      exitViewAsCustomer,
      startViewAsEmployee,
      exitViewAsEmployee,
      companies,
      users,
      login,
      logout,
      requestReset,
      resetPassword,
      completeOnboardingLogin,
      createCompany,
      updateCompany,
      createUser,
      updateUser,
      roles,
      createRole,
      updateRole,
      deleteRole,
      assignUserRole,
      getUserPermissions,
      hasPermission,
      visibleAuditEvents,
      logAudit,
      employees,
      customers,
      teams,
      areas,
      areaScopedAccessTick,
      getAreaActivationPrecheck,
      setAreaScopedAccessEnabled,
      createArea,
      updateArea,
      archiveArea,
      restoreArea,
      postalCities,
      autoAreaTick,
      setAutoAreaFromPostalCityEnabled,
      createPostalCity,
      updatePostalCity,
      archivePostalCity,
      restorePostalCity,
      employeeLanguages,
      createEmployeeLanguage,
      updateEmployeeLanguage,
      archiveEmployeeLanguage,
      restoreEmployeeLanguage,
      setEmployeeLanguageDefault,
      createEmployee,
      updateEmployee,
      createEmployeeWithLogin,
      createLoginForEmployee,
      getEmployeeDeletability,
      deleteEmployee,
      archiveEmployee,
      createCustomer,
      updateCustomer,
      deleteCustomer,
      archiveCustomer,
      logCustomerMediaActivity,
      logCustomerMediaMetaChange,
      setCustomerCoverImage,
      logWorkOrderMediaActivity,
      addWorkOrderMediaPlacement,
      removeWorkOrderMediaPlacement,
      reorderWorkOrderMediaPlacements,
      setWorkOrderMediaPlacementEmployeeVisibility,
      purgeWorkOrderMediaPlacementsForAsset,
      workOrders,
      getCustomerWorkOrders,
      createWorkOrder,
      setWorkOrderActive,
      archiveWorkOrder,
      deleteWorkOrder,
      forceDeleteWorkOrder,
      getWorkOrderRelatedData,
      workOrderSettings,
      getWorkOrderSettingsFor,
      updateWorkOrderSettings,
      timeReportSettings,
      getTimeReportSettingsFor,
      updateTimeReportSettings,
      durationSettings,
      getDurationSettingsFor,
      updateDurationSettings,
      systemSettings,
      updateSystemSettings,
      serviceGlobalEntitlements,
      companyServiceEntitlements,
      serviceEntitlementLog,
      isServiceGloballyAvailable,
      getCompanyServiceEntitlement,
      isCompanyEntitledToService,
      isServiceAvailableForCompany,
      setServiceGlobalAvailability,
      setCompanyServiceEntitlement,
      getCompanyServiceStatus,
      getEffectiveCompanyServiceStatus,
      setCompanyServiceStatus,
      evaluateMediaUploadGate,
      getCompanyMediaUsage,
      getWorkOrder,
      hydrateCustomerFromRemote,
      hydrateCustomersFromRemote,
      hydrateWorkOrderFromRemote,
      updateWorkOrder,
      addWorkOrderNote,
      updateWorkOrderNote,
      setWorkOrderNoteArchived,
      getServicesForCompany,
      getServiceCategoriesForCompany,
      getCompanyServiceFavorites,
      isServiceFavorite,
      toggleServiceFavorite,
      addWorkOrderServiceRow,
      updateWorkOrderServiceRow,
      setWorkOrderServiceRowArchived,
      deleteWorkOrderServiceRow,
      forceDeleteWorkOrderServiceRow,
      reorderWorkOrderServiceRows,
      addServiceRowVariation,
      updateServiceRowVariation,
      replaceServiceRowVariation,
      setServiceRowVariationEnabled,
      setServiceRowVariationArchived,
      stopServiceRowVariation,
      deleteServiceRowVariation,
      setServiceRowVariationStatus,
      invoices,
      getCustomerInvoices,
      createTeam,
      updateTeam,
      deleteTeam,
      modules,
      companyModules,
      setModuleStatus,
      setModuleAvailable,
      setModuleEnabled,
      getCompanyModuleSetting,
      canAccessModule,
      getModuleEntitlementAvailability,
      getAccessibleModules,
      moduleCategories,
      createCategory,
      updateCategory,
      deleteCategory,
      reorderCategories,
      getNavModuleGroups,
      checklistTemplates,
      checklistAdoptions,
      getVisibleTemplates,
      canEditTemplate,
      createTemplate,
      cloneTemplate,
      updateTemplate,
      addFloor,
      updateFloor,
      deleteFloor,
      setFloorArchived,
      reorderFloors,
      addRoom,
      updateRoom,
      deleteRoom,
      setRoomArchived,
      reorderRooms,
      addTask,
      updateTask,
      deleteTask,
      setTaskArchived,
      reorderTasks,
      setChecklistNotesImages,
      getTemplateAdoption,
      setTemplateAdopted,
      customerProtocols,
      getVisibleProtocols,
      getMyProtocols,
      canViewMyProtocol,
      canEditProtocol,
      createProtocol,
      updateProtocol,
      setProtocolArchived,
      duplicateProtocol,
      setProtocolRoomActive,
      setProtocolTaskState,
      setProtocolNotes,
      saveProtocol,
      libraryRooms,
      libraryTasks,
      getVisibleLibraryRooms,
      getVisibleLibraryTasks,
      canEditLibraryRoom,
      canEditLibraryTask,
      createLibraryRoom,
      updateLibraryRoom,
      setLibraryRoomArchived,
      createLibraryTask,
      updateLibraryTask,
      setLibraryTaskArchived,
      addRoomsFromLibrary,
      addTasksFromLibrary,
      settingsTemplates,
      companySettings,
      getSelectableSettingsTemplates,
      createSettingsTemplate,
      updateSettingsTemplate,
      setSettingsTemplateArchived,
      duplicateSettingsTemplate,
      getCompanySettingsFor,
      initializeCompanySettings,
      serviceCategories,
      payrollGroups,
      services,
      servicePackages,
      getServiceScope,
      getScopedServiceCategories,
      getScopedServices,
      createServiceCategory,
      updateServiceCategory,
      setServiceCategoryArchived,
      reorderServiceCategories,
      createService,
      updateService,
      setServiceArchived,
      hardDeleteService,
      getSelectableServicePackages,
      createServicePackage,
      updateServicePackage,
      setServicePackageArchived,
      duplicateServicePackage,
      timeCodes,
      canManageTimeCodes,
      canViewTimeCodes,
      getTimeCodeById,
      getAvailableTimeCodes,
      getTimeCodeUsageCount,
      getServicesForTimeCode,
      createTimeCode,
      updateTimeCode,
      setTimeCodeActive,
      deleteTimeCode,
      payrollExportCapabilities,
      payrollExportProfiles,
      payrollExportRuns,
      canManagePayrollExportEntitlements,
      canViewPayrollExport,
      canManagePayrollExportProfiles,
      canRunPayrollExport,
      isPayrollExportTargetEnabled,
      getAvailablePayrollExportTargets,
      getPayrollExportProfilesForCompany,
      getRunnablePayrollExportProfiles,
      getPayrollExportRunsForCompany,
      setPayrollExportCapability,
      createPayrollExportProfile,
      updatePayrollExportProfile,
      setPayrollExportProfileActive,
      deletePayrollExportProfile,
      runPayrollExport,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within an AppProvider");
  return ctx;
}
