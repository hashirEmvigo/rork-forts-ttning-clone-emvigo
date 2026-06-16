/**
 * Query layer (Migration Wave 0) — public surface.
 *
 * The storage-agnostic data-access boundary for operational entities. Today the
 * only live implementation is {@link localDataLayer} (wrapping the existing
 * store getters); {@link supabaseDataLayer} is a typed placeholder for later
 * waves. No UI is wired onto this layer yet — Wave 0 only creates and validates
 * the seam.
 */
export type {
  ListParams,
  CountParams,
  DetailParams,
  ListResult,
  CustomerSummary,
  CustomerDetail,
  EmployeeSummary,
  EmployeeDetail,
  WorkOrderSummary,
  WorkOrderDetail,
  WorkOrderServiceRowSummary,
  WorkOrderServiceRowDetail,
  WorkOrderVariationSummary,
  WorkOrderExceptionSummary,
  ScheduleOccurrenceSummary,
  ScheduleOccurrenceDetail,
  ActivityEventSummary,
  ActivityEventDetail,
  TimeReportSummary,
  TimeReportDetail,
} from "./types";
export type {
  ReadRepository,
  CustomerRepository,
  EmployeeRepository,
  WorkOrderRepository,
  ScheduleRepository,
  ActivityLogRepository,
  TimeReportRepository,
  DataLayer,
  CustomerListParams,
  EmployeeListParams,
  WorkOrderListParams,
  ServiceRowListParams,
  OccurrenceExceptionListParams,
  ScheduleListParams,
  ActivityListParams,
  TimeReportListParams,
} from "./contracts";
export { localDataLayer } from "./localStorageAdapters";
export { supabaseDataLayer, NotImplementedError } from "./supabaseAdapters";
export {
  supabaseCustomerRepository,
  listFullCustomersFromSupabase,
} from "./supabaseCustomerRepository";
export {
  supabaseWorkOrderRepository,
  listFullWorkOrdersFromSupabase,
  fetchScheduleIntervalFromSupabase,
  type ScheduleIntervalQueryParams,
  type ScheduleIntervalFetch,
} from "./supabaseWorkOrderRepository";
export {
  supabaseEmployeeRepository,
  listFullEmployeesFromSupabase,
} from "./supabaseEmployeeRepository";
export {
  listFullTeamsFromSupabase,
  listTeamSummariesFromSupabase,
  type TeamSummary,
} from "./supabaseTeamRepository";
export {
  migrateTeams,
  shadowReadTeams,
  toTeamUpsertRow,
  type TeamUpsertRow,
  type TeamMigrationReport,
  type TeamShadowReport,
} from "./teamMigration";
export {
  mirrorTeamWrites,
  getTeamDualWriteState,
  resetTeamDualWriteState,
  type TeamDualWriteResult,
  type TeamDualWriteState,
  type TeamWriteMismatch,
  type TeamWriteDiff,
} from "./teamDualWrite";
export {
  shouldReadTeamsFromSupabase,
  shouldMirrorTeamWrites,
  getTeamCutoverState,
  resetTeamCutoverState,
  recordTeamSupabaseRead,
  recordTeamReadFallback,
  recordTeamUnsafeEmpty,
  recordTeamShadowDrift,
  type TeamCutoverState,
  type TeamReadSource,
  type TeamReadFailure,
} from "./teamCutover";
export {
  listFullServicesFromSupabase,
  listServiceSummariesFromSupabase,
  type ServiceSummary,
} from "./supabaseServiceRepository";
export {
  migrateServices,
  shadowReadServices,
  toServiceUpsertRow,
  type ServiceUpsertRow,
  type ServiceMigrationReport,
  type ServiceShadowReport,
} from "./serviceMigration";
export {
  mirrorServiceWrites,
  getServiceDualWriteState,
  resetServiceDualWriteState,
  type ServiceDualWriteResult,
  type ServiceDualWriteState,
  type ServiceWriteMismatch,
  type ServiceWriteDiff,
} from "./serviceDualWrite";
export {
  shouldReadServicesFromSupabase,
  shouldMirrorServiceWrites,
  getServiceCutoverState,
  resetServiceCutoverState,
  recordServiceSupabaseRead,
  recordServiceReadFallback,
  recordServiceUnsafeEmpty,
  recordServiceShadowDrift,
  type ServiceCutoverState,
  type ServiceReadSource,
  type ServiceReadFailure,
} from "./serviceCutover";
// ── Service-catalog wave (SVCCAT) ────────────────────────────────────────
export {
  listFullServiceCategoriesFromSupabase,
  listServiceCategorySummariesFromSupabase,
  type ServiceCategorySummary,
} from "./supabaseServiceCategoryRepository";
export {
  migrateServiceCategories,
  shadowReadServiceCategories,
  toServiceCategoryUpsertRow,
  type ServiceCategoryUpsertRow,
  type ServiceCategoryMigrationReport,
  type ServiceCategoryShadowReport,
} from "./serviceCategoryMigration";
export {
  mirrorServiceCategoryWrites,
  getServiceCategoryDualWriteState,
  resetServiceCategoryDualWriteState,
  type ServiceCategoryDualWriteResult,
  type ServiceCategoryDualWriteState,
  type ServiceCategoryWriteMismatch,
  type ServiceCategoryWriteDiff,
} from "./serviceCategoryDualWrite";
export {
  shouldReadServiceCategoriesFromSupabase,
  shouldMirrorServiceCategoryWrites,
  getServiceCategoryCutoverState,
  resetServiceCategoryCutoverState,
  recordServiceCategorySupabaseRead,
  recordServiceCategoryReadFallback,
  recordServiceCategoryUnsafeEmpty,
  recordServiceCategoryShadowDrift,
  type ServiceCategoryCutoverState,
  type ServiceCategoryReadSource,
  type ServiceCategoryReadFailure,
} from "./serviceCategoryCutover";
export {
  listFullPayrollGroupsFromSupabase,
  listPayrollGroupSummariesFromSupabase,
  type PayrollGroupSummary,
} from "./supabasePayrollGroupRepository";
export {
  migratePayrollGroups,
  shadowReadPayrollGroups,
  toPayrollGroupUpsertRow,
  type PayrollGroupUpsertRow,
  type PayrollGroupMigrationReport,
  type PayrollGroupShadowReport,
} from "./payrollGroupMigration";
export {
  mirrorPayrollGroupWrites,
  getPayrollGroupDualWriteState,
  resetPayrollGroupDualWriteState,
  type PayrollGroupDualWriteResult,
  type PayrollGroupDualWriteState,
  type PayrollGroupWriteMismatch,
  type PayrollGroupWriteDiff,
} from "./payrollGroupDualWrite";
export {
  shouldReadPayrollGroupsFromSupabase,
  shouldMirrorPayrollGroupWrites,
  getPayrollGroupCutoverState,
  resetPayrollGroupCutoverState,
  recordPayrollGroupSupabaseRead,
  recordPayrollGroupReadFallback,
  recordPayrollGroupUnsafeEmpty,
  recordPayrollGroupShadowDrift,
  type PayrollGroupCutoverState,
  type PayrollGroupReadSource,
  type PayrollGroupReadFailure,
} from "./payrollGroupCutover";
export {
  listFullServicePackagesFromSupabase,
  listServicePackageSummariesFromSupabase,
  type ServicePackageSummary,
} from "./supabaseServicePackageRepository";
export {
  migrateServicePackages,
  shadowReadServicePackages,
  toServicePackageUpsertRow,
  type ServicePackageUpsertRow,
  type ServicePackageMigrationReport,
  type ServicePackageShadowReport,
} from "./servicePackageMigration";
export {
  mirrorServicePackageWrites,
  getServicePackageDualWriteState,
  resetServicePackageDualWriteState,
  type ServicePackageDualWriteResult,
  type ServicePackageDualWriteState,
  type ServicePackageWriteMismatch,
  type ServicePackageWriteDiff,
} from "./servicePackageDualWrite";
export {
  shouldReadServicePackagesFromSupabase,
  shouldMirrorServicePackageWrites,
  getServicePackageCutoverState,
  resetServicePackageCutoverState,
  recordServicePackageSupabaseRead,
  recordServicePackageReadFallback,
  recordServicePackageUnsafeEmpty,
  recordServicePackageShadowDrift,
  type ServicePackageCutoverState,
  type ServicePackageReadSource,
  type ServicePackageReadFailure,
} from "./servicePackageCutover";
// ── Area cluster (AREA): Areas / Postal Cities / Employee Languages ──────────
export {
  listFullAreasFromSupabase,
  listAreaSummariesFromSupabase,
  type AreaSummary,
} from "./supabaseAreaRepository";
export {
  migrateAreas,
  shadowReadAreas,
  toAreaUpsertRow,
  type AreaUpsertRow,
  type AreaMigrationReport,
  type AreaShadowReport,
} from "./areaMigration";
export {
  mirrorAreaWrites,
  getAreaDualWriteState,
  resetAreaDualWriteState,
  type AreaDualWriteResult,
  type AreaDualWriteState,
  type AreaWriteMismatch,
  type AreaWriteDiff,
} from "./areaDualWrite";
export {
  shouldReadAreasFromSupabase,
  shouldMirrorAreaWrites,
  getAreaCutoverState,
  resetAreaCutoverState,
  recordAreaSupabaseRead,
  recordAreaReadFallback,
  recordAreaUnsafeEmpty,
  recordAreaShadowDrift,
  type AreaCutoverState,
  type AreaReadSource,
  type AreaReadFailure,
} from "./areaCutover";
export {
  listFullPostalCitiesFromSupabase,
  listPostalCitySummariesFromSupabase,
  type PostalCitySummary,
} from "./supabasePostalCityRepository";
export {
  migratePostalCities,
  shadowReadPostalCities,
  toPostalCityUpsertRow,
  type PostalCityUpsertRow,
  type PostalCityMigrationReport,
  type PostalCityShadowReport,
} from "./postalCityMigration";
export {
  mirrorPostalCityWrites,
  getPostalCityDualWriteState,
  resetPostalCityDualWriteState,
  type PostalCityDualWriteResult,
  type PostalCityDualWriteState,
  type PostalCityWriteMismatch,
  type PostalCityWriteDiff,
} from "./postalCityDualWrite";
export {
  shouldReadPostalCitiesFromSupabase,
  shouldMirrorPostalCityWrites,
  getPostalCityCutoverState,
  resetPostalCityCutoverState,
  recordPostalCitySupabaseRead,
  recordPostalCityReadFallback,
  recordPostalCityUnsafeEmpty,
  recordPostalCityShadowDrift,
  type PostalCityCutoverState,
  type PostalCityReadSource,
  type PostalCityReadFailure,
} from "./postalCityCutover";
export {
  listFullEmployeeLanguagesFromSupabase,
  listEmployeeLanguageSummariesFromSupabase,
  type EmployeeLanguageSummary,
} from "./supabaseEmployeeLanguageRepository";
export {
  migrateEmployeeLanguages,
  shadowReadEmployeeLanguages,
  toEmployeeLanguageUpsertRow,
  type EmployeeLanguageUpsertRow,
  type EmployeeLanguageMigrationReport,
  type EmployeeLanguageShadowReport,
} from "./employeeLanguageMigration";
export {
  mirrorEmployeeLanguageWrites,
  getEmployeeLanguageDualWriteState,
  resetEmployeeLanguageDualWriteState,
  type EmployeeLanguageDualWriteResult,
  type EmployeeLanguageDualWriteState,
  type EmployeeLanguageWriteMismatch,
  type EmployeeLanguageWriteDiff,
} from "./employeeLanguageDualWrite";
export {
  shouldReadEmployeeLanguagesFromSupabase,
  shouldMirrorEmployeeLanguageWrites,
  getEmployeeLanguageCutoverState,
  resetEmployeeLanguageCutoverState,
  recordEmployeeLanguageSupabaseRead,
  recordEmployeeLanguageReadFallback,
  recordEmployeeLanguageUnsafeEmpty,
  recordEmployeeLanguageShadowDrift,
  type EmployeeLanguageCutoverState,
  type EmployeeLanguageReadSource,
  type EmployeeLanguageReadFailure,
} from "./employeeLanguageCutover";
// ── Missions / Visit Occurrences (MISSION) ───────────────────────────────────
export {
  listFullVisitOccurrencesFromSupabase,
  listVisitOccurrenceSummariesFromSupabase,
  type VisitOccurrenceSummary,
} from "./supabaseVisitOccurrenceRepository";
export {
  migrateVisitOccurrences,
  shadowReadVisitOccurrences,
  toVisitOccurrenceUpsertRow,
  type VisitOccurrenceUpsertRow,
  type VisitOccurrenceMigrationReport,
  type VisitOccurrenceShadowReport,
} from "./visitOccurrenceMigration";
export {
  mirrorVisitOccurrenceWrites,
  getVisitOccurrenceDualWriteState,
  resetVisitOccurrenceDualWriteState,
  type VisitOccurrenceDualWriteResult,
  type VisitOccurrenceDualWriteState,
  type VisitOccurrenceWriteMismatch,
  type VisitOccurrenceWriteDiff,
} from "./visitOccurrenceDualWrite";
export {
  shouldReadVisitOccurrencesFromSupabase,
  shouldMirrorVisitOccurrenceWrites,
  getVisitOccurrenceCutoverState,
  resetVisitOccurrenceCutoverState,
  recordVisitOccurrenceSupabaseRead,
  recordVisitOccurrenceReadFallback,
  recordVisitOccurrenceUnsafeEmpty,
  recordVisitOccurrenceShadowDrift,
  type VisitOccurrenceCutoverState,
  type VisitOccurrenceReadSource,
  type VisitOccurrenceReadFailure,
} from "./visitOccurrenceCutover";
// ── Identity wave (ROLE): Roles & Permissions ────────────────────────────────
export {
  listFullRolesFromSupabase,
  listRoleSummariesFromSupabase,
  type RoleSummary,
} from "./supabaseRoleRepository";
export {
  migrateRoles,
  shadowReadRoles,
  toRoleUpsertRow,
  type RoleUpsertRow,
  type RoleMigrationReport,
  type RoleShadowReport,
} from "./roleMigration";
export {
  mirrorRoleWrites,
  getRoleDualWriteState,
  resetRoleDualWriteState,
  type RoleDualWriteResult,
  type RoleDualWriteState,
  type RoleWriteMismatch,
  type RoleWriteDiff,
} from "./roleDualWrite";
export {
  shouldReadRolesFromSupabase,
  shouldMirrorRoleWrites,
  getRoleCutoverState,
  resetRoleCutoverState,
  recordRoleSupabaseRead,
  recordRoleReadFallback,
  recordRoleUnsafeEmpty,
  recordRoleShadowDrift,
  type RoleCutoverState,
  type RoleReadSource,
  type RoleReadFailure,
} from "./roleCutover";
// ── Identity wave (USER): Users / logins ─────────────────────────────────────
export {
  listFullUsersFromSupabase,
  listUserSummariesFromSupabase,
  type UserSummary,
} from "./supabaseUserRepository";
export {
  migrateUsers,
  shadowReadUsers,
  toUserUpsertRow,
  type UserUpsertRow,
  type UserMigrationReport,
  type UserShadowReport,
} from "./userMigration";
export {
  mirrorUserWrites,
  getUserDualWriteState,
  resetUserDualWriteState,
  type UserDualWriteResult,
  type UserDualWriteState,
  type UserWriteMismatch,
  type UserWriteDiff,
} from "./userDualWrite";
export {
  shouldReadUsersFromSupabase,
  shouldMirrorUserWrites,
  getUserCutoverState,
  resetUserCutoverState,
  recordUserSupabaseRead,
  recordUserReadFallback,
  recordUserUnsafeEmpty,
  recordUserShadowDrift,
  type UserCutoverState,
  type UserReadSource,
  type UserReadFailure,
} from "./userCutover";
// ── Service Entitlements wave (ENT): global + company + log ──────────────────
export {
  listGlobalEntitlementsFromSupabase,
  listCompanyEntitlementsFromSupabase,
  listEntitlementLogFromSupabase,
  upsertGlobalEntitlementInSupabase,
  upsertCompanyEntitlementInSupabase,
  appendEntitlementLogInSupabase,
} from "./supabaseEntitlementRepository";
export {
  bumpEntitlementDirectoryRefresh,
  getEntitlementDirectoryRefreshVersion,
  subscribeEntitlementDirectoryRefresh,
} from "./entitlementDirectoryRefresh";
export {
  migrateEntitlements,
  shadowReadEntitlements,
  companyEntitlementLegacyId,
  toGlobalEntitlementUpsertRow,
  toCompanyEntitlementUpsertRow,
  toEntitlementLogUpsertRow,
  type GlobalEntitlementUpsertRow,
  type CompanyEntitlementUpsertRow,
  type EntitlementLogUpsertRow,
  type EntitlementMigrationReport,
  type EntitlementShadowReport,
} from "./entitlementMigration";
export {
  mirrorGlobalEntitlementWrites,
  mirrorCompanyEntitlementWrites,
  mirrorEntitlementLogAppend,
  getEntitlementDualWriteState,
  resetEntitlementDualWriteState,
  type EntitlementDualWriteResult,
  type EntitlementDualWriteState,
} from "./entitlementDualWrite";
export {
  shouldReadEntitlementsFromSupabase,
  shouldMirrorEntitlementWrites,
  getEntitlementCutoverState,
  resetEntitlementCutoverState,
  recordEntitlementSupabaseRead,
  recordEntitlementReadFallback,
  recordEntitlementUnsafeEmpty,
  recordEntitlementShadowDrift,
  type EntitlementCutoverState,
  type EntitlementReadSource,
  type EntitlementReadFailure,
} from "./entitlementCutover";
// ── Activity Log wave (ACTIVITY): append-only audit trail ────────────────────
export {
  listActivityEventsFromSupabase,
  listActivityEventSummariesFromSupabase,
  type ActivityEventRowSummary,
} from "./supabaseActivityRepository";
export {
  migrateActivityEvents,
  shadowReadActivityEvents,
  toActivityEventUpsertRow,
  type ActivityEventUpsertRow,
  type ActivityMigrationReport,
  type ActivityShadowReport,
} from "./activityMigration";
export {
  mirrorActivityAppend,
  getActivityDualWriteState,
  resetActivityDualWriteState,
  type ActivityDualWriteResult,
  type ActivityDualWriteState,
} from "./activityDualWrite";
export {
  shouldReadActivityFromSupabase,
  shouldMirrorActivityWrites,
  getActivityCutoverState,
  resetActivityCutoverState,
  recordActivitySupabaseRead,
  recordActivityReadFallback,
  recordActivityUnsafeEmpty,
  recordActivityShadowDrift,
  type ActivityCutoverState,
  type ActivityReadSource,
  type ActivityReadFailure,
} from "./activityCutover";
// ── Payroll/Time wave (TIMECODE): Time Codes ───────────────────────────
export {
  listFullTimeCodesFromSupabase,
  listTimeCodeSummariesFromSupabase,
  createTimeCodeInSupabase,
  updateTimeCodeInSupabase,
  softDeleteTimeCodeInSupabase,
  type TimeCodeSummary,
} from "./supabaseTimeCodeRepository";
export {
  migrateTimeCodes,
  shadowReadTimeCodes,
  toTimeCodeUpsertRow,
  type TimeCodeUpsertRow,
  type TimeCodeMigrationReport,
  type TimeCodeShadowReport,
} from "./timeCodeMigration";
export {
  mirrorTimeCodeWrites,
  getTimeCodeDualWriteState,
  resetTimeCodeDualWriteState,
  type TimeCodeDualWriteResult,
  type TimeCodeDualWriteState,
  type TimeCodeWriteMismatch,
  type TimeCodeWriteDiff,
} from "./timeCodeDualWrite";
export {
  shouldReadTimeCodesFromSupabase,
  shouldMirrorTimeCodeWrites,
  getTimeCodeCutoverState,
  resetTimeCodeCutoverState,
  recordTimeCodeSupabaseRead,
  recordTimeCodeReadFallback,
  recordTimeCodeUnsafeEmpty,
  recordTimeCodeShadowDrift,
  type TimeCodeCutoverState,
  type TimeCodeReadSource,
  type TimeCodeReadFailure,
} from "./timeCodeCutover";
// ── Booking Ledger wave (BL): generated actual booking jobs ────────────────
export {
  listBookingLedgerEntriesFromSupabase,
} from "./supabaseBookingLedgerRepository";

// ── Booking Queue wave (BQ): legacy planning layer between Work Orders + Schedule ──
export {
  listFullBookingQueueFromSupabase,
  listBookingQueueSummariesFromSupabase,
  type BookingQueueSummary,
} from "./supabaseBookingQueueRepository";
export {
  migrateBookingQueue,
  shadowReadBookingQueue,
  toBookingQueueUpsertRow,
  type BookingQueueUpsertRow,
  type BookingQueueMigrationReport,
  type BookingQueueShadowReport,
} from "./bookingQueueMigration";
export {
  mirrorBookingQueueWrites,
  getBookingQueueDualWriteState,
  resetBookingQueueDualWriteState,
  type BookingQueueDualWriteResult,
  type BookingQueueDualWriteState,
  type BookingQueueWriteMismatch,
  type BookingQueueWriteDiff,
} from "./bookingQueueDualWrite";
export {
  shouldReadBookingQueueFromSupabase,
  shouldMirrorBookingQueueWrites,
  shouldUseBookingQueueLocalBackoutBridge,
  isBookingQueueSupabaseAuthoritative,
  getBookingQueueCutoverState,
  resetBookingQueueCutoverState,
  recordBookingQueueSupabaseRead,
  recordBookingQueueReadFallback,
  recordBookingQueueUnsafeEmpty,
  recordBookingQueueShadowDrift,
  type BookingQueueCutoverState,
  type BookingQueueReadSource,
  type BookingQueueReadFailure,
} from "./bookingQueueCutover";
// ── Settings wave (SET): settings_templates (global) + company_settings ──
export {
  listFullSettingsTemplatesFromSupabase,
  listSettingsTemplateSummariesFromSupabase,
  type SettingsTemplateSummary,
} from "./supabaseSettingsTemplateRepository";
export {
  migrateSettingsTemplates,
  shadowReadSettingsTemplates,
  toSettingsTemplateUpsertRow,
  type SettingsTemplateUpsertRow,
  type SettingsTemplateMigrationReport,
  type SettingsTemplateShadowReport,
} from "./settingsTemplateMigration";
export {
  mirrorSettingsTemplateWrites,
  getSettingsTemplateDualWriteState,
  resetSettingsTemplateDualWriteState,
  type SettingsTemplateDualWriteResult,
  type SettingsTemplateDualWriteState,
  type SettingsTemplateWriteMismatch,
  type SettingsTemplateWriteDiff,
} from "./settingsTemplateDualWrite";
export {
  shouldReadSettingsTemplatesFromSupabase,
  shouldMirrorSettingsTemplateWrites,
  getSettingsTemplateCutoverState,
  resetSettingsTemplateCutoverState,
  recordSettingsTemplateSupabaseRead,
  recordSettingsTemplateReadFallback,
  recordSettingsTemplateUnsafeEmpty,
  recordSettingsTemplateShadowDrift,
  type SettingsTemplateCutoverState,
  type SettingsTemplateReadSource,
  type SettingsTemplateReadFailure,
} from "./settingsTemplateCutover";
export {
  listFullCompanySettingsFromSupabase,
  listCompanySettingsSummariesFromSupabase,
  type CompanySettingsSummary,
} from "./supabaseCompanySettingsRepository";
export {
  migrateCompanySettings,
  shadowReadCompanySettings,
  toCompanySettingsUpsertRow,
  type CompanySettingsUpsertRow,
  type CompanySettingsMigrationReport,
  type CompanySettingsShadowReport,
} from "./companySettingsMigration";
export {
  mirrorCompanySettingsWrites,
  getCompanySettingsDualWriteState,
  resetCompanySettingsDualWriteState,
  type CompanySettingsDualWriteResult,
  type CompanySettingsDualWriteState,
  type CompanySettingsWriteMismatch,
  type CompanySettingsWriteDiff,
} from "./companySettingsDualWrite";
export {
  shouldReadCompanySettingsFromSupabase,
  shouldMirrorCompanySettingsWrites,
  getCompanySettingsCutoverState,
  resetCompanySettingsCutoverState,
  recordCompanySettingsSupabaseRead,
  recordCompanySettingsReadFallback,
  recordCompanySettingsUnsafeEmpty,
  recordCompanySettingsShadowDrift,
  type CompanySettingsCutoverState,
  type CompanySettingsReadSource,
  type CompanySettingsReadFailure,
} from "./companySettingsCutover";
// ── System Settings wave (SYSSET): system_settings (singleton global record) ──
export {
  getSystemSettingsFromSupabase,
  SYSTEM_SETTINGS_LEGACY_ID,
} from "./supabaseSystemSettingsRepository";
export {
  migrateSystemSettings,
  shadowReadSystemSettings,
  toSystemSettingsUpsertRow,
  type SystemSettingsUpsertRow,
  type SystemSettingsMigrationReport,
  type SystemSettingsShadowReport,
} from "./systemSettingsMigration";
export {
  mirrorSystemSettingsWrite,
  getSystemSettingsDualWriteState,
  resetSystemSettingsDualWriteState,
  type SystemSettingsDualWriteResult,
  type SystemSettingsDualWriteState,
} from "./systemSettingsDualWrite";
export {
  shouldReadSystemSettingsFromSupabase,
  shouldMirrorSystemSettingsWrites,
  isSystemSettingsSupabaseAuthoritative,
  getSystemSettingsCutoverState,
  resetSystemSettingsCutoverState,
  recordSystemSettingsSupabaseRead,
  recordSystemSettingsReadFallback,
  recordSystemSettingsUnsafeEmpty,
  recordSystemSettingsShadowDrift,
  type SystemSettingsCutoverState,
  type SystemSettingsReadSource,
  type SystemSettingsReadFailure,
} from "./systemSettingsCutover";
export {
  supabaseCustomerAgreementRepository,
  toCustomerAgreementUpsertRow,
  toCustomerAgreementLineUpsertRow,
  type CustomerAgreementUpsertRow,
  type CustomerAgreementLineUpsertRow,
  type CustomerAgreementSummary,
  type CustomerAgreementListParams,
} from "./customerAgreementRepository";
export {
  migrateCustomerAgreements,
  shadowReadCustomerAgreements,
  buildSyntheticAgreement,
  compareCustomerAgreementRows,
  compareCustomerAgreementLines,
  syntheticAgreementGroupId,
  syntheticAgreementId,
  syntheticLineId,
  type SyntheticAgreementBuild,
  type CustomerAgreementMigrationReport,
  type CustomerAgreementShadowReport,
  type FieldMismatch,
} from "./customerAgreementMigration";
export {
  TERMINAL_AGREEMENT_STATUSES,
  LIVE_AGREEMENT_STATUSES,
  isTerminalStatus,
  isLiveStatus,
  canBeSuperseded,
  listVersionsForGroup,
  findVersionById,
  resolveCurrentVersion,
  resolveVersionActiveOn,
  createNewAgreementVersion,
  snapshotLinesForNewVersion,
  diffRequiresNewVersion,
  normalizeToVersionOne,
  validateVersionChain,
  timeBankWalletBindingKey,
  resolveCurrentVersionForGroup,
  resolveVersionActiveOnForGroup,
  type VersionChangeInput,
  type CreateVersionOptions,
  type CreateVersionResult,
  type VersionDiffResult,
  type ChainIntegrityResult,
} from "./agreementVersioning";
export {
  persistAgreementVersion,
  persistNewAgreementVersion,
  type PersistOptions,
  type PersistVersionReport,
  type PersistNewVersionOptions,
  type PersistNewVersionResult,
} from "./agreementVersionPersistence";
export {
  transactionKind,
  affectsReserved,
  normalizeMinutes,
  deriveBalance,
  deriveBalanceAsOf,
  orderLedger,
  walletBindingKey,
  walletMatchesAgreementChain,
  canRecordTransaction,
  evaluateConsumption,
  evaluateReservationWarning,
  buildTransaction,
  defaultTimeBankRules,
  buildWalletForAgreement,
  defaultCancellationPolicy,
  validateCancellationPolicy,
  calculateCancellationCredit,
  buildCancellationCreditTransaction,
  validateLedger,
  buildStatement,
  carryoverExpiryDelta,
  type TransactionGateResult,
  type ConsumptionEvaluation,
  type TimeBankWarningLevel,
  type BuildTransactionInput,
  type BuildWalletInput,
  type CancellationPolicyValidation,
  type BuildCancellationCreditInput,
  type LedgerIntegrityResult,
  type TimeBankStatement,
  type StatementWindow,
} from "./timeBank";
export {
  supabaseTimeBankRepository,
  toTimeBankWalletUpsertRow,
  toTimeBankTransactionUpsertRow,
  toTimeBankLegacyNoteInsertRow,
  type TimeBankWalletUpsertRow,
  type TimeBankTransactionUpsertRow,
  type TimeBankLegacyNoteInsertRow,
} from "./timeBankRepository";
export {
  ensureWalletForAgreement,
  appendWalletTransaction,
  recordOpeningBalance,
  recordLegacyHistoryNote,
  setWalletStatus,
  type SetWalletStatusInput,
  type SetWalletStatusResult,
  readWalletBalance,
  readWalletBalanceAsOf,
  readWalletStatement,
  type TimeBankPersistOptions,
  type EnsureWalletInput,
  type EnsureWalletResult,
  type AppendTransactionInput,
  type AppendTransactionResult,
  type OpeningBalanceInput,
  type LegacyHistoryNoteInput,
  type LegacyHistoryNoteResult,
  planWalletRefill,
  executeRefillPlan,
  type PlanWalletRefillInput,
  type ExecuteRefillPlanInput,
  type ExecuteRefillPlanResult,
} from "./timeBankPersistence";
export {
  isAutoRefillFrequency,
  refillPeriodKey,
  refillPeriodStart,
  refillTransactionId,
  refillExpiryTransactionId,
  expiryTransactionId,
  planTimeBankRefill,
  planTimeBankExpiry,
  computeAgeExpiry,
  evaluateWalletWarnings,
  type PlannedTimeBankTransaction,
  type PlanRefillInput,
  type RefillPlan,
  type RefillDecision,
  type PlanExpiryInput,
  type ExpiryPlan,
  type ExpiryComputation,
  type WalletWarnings,
  type EvaluateWarningsInput,
} from "./timeBankRefill";
export {
  openingBalanceTransactionId,
  buildOpeningBalanceTransaction,
  findOpeningBalances,
  hasOpeningBalance,
  validateSingleOpeningBalance,
  buildLegacyHistoryNote,
  validateLegacyHistoryNote,
  buildAdminHistoryView,
  buildCustomerHistoryView,
  type BuildOpeningBalanceInput,
  type SingleOpeningBalanceResult,
  type BuildLegacyHistoryNoteInput,
  type LegacyHistoryNoteValidation,
  type TimeBankHistoryView,
} from "./timeBankMigration";
export {
  buildAgreementTemplate,
  buildAgreementTemplateLine,
  createAgreementFromTemplate,
  resetTemplateSequencers,
  validateTemplateForCreation,
  type BuildAgreementTemplateInput,
  type BuildAgreementTemplateLineInput,
  type TemplateValidationResult,
  type CreateAgreementFromTemplateInput,
  type CreateAgreementOverrides,
  type CreateAgreementFromTemplateResult,
  copyTemplateToCompany,
  type CopyTemplateResult,
} from "./agreementTemplates";
export {
  supabaseAgreementTemplatesRepository,
  toAgreementTemplateUpsertRow,
  toAgreementTemplateLineUpsertRow,
  type AgreementTemplateUpsertRow,
  type AgreementTemplateLineUpsertRow,
  type AgreementTemplateListParams,
} from "./agreementTemplatesRepository";
export {
  TIME_BANK_REFILL_FREQUENCY_LABELS,
  TIME_BANK_CARRYOVER_POLICY_LABELS,
  toTemplateListRow,
  toLatestVersionRows,
  toTemplateLineRows,
  toTimeBankDefaultsView,
  toCancellationDefaultsView,
  toVersionChain,
  type TemplateListRow,
  type TemplateLineRow,
  type TimeBankDefaultsView,
  type CancellationDefaultsView,
  type VersionChainEntry,
} from "./agreementTemplatesAdminModel";
export {
  persistTemplate,
  copyGlobalTemplateToCompany,
  archiveTemplate,
  createAgreementFromPersistedTemplate,
  type PersistTemplateInput,
  type PersistTemplateResult,
  type CopyGlobalToCompanyInput,
  type CopyGlobalToCompanyResult,
  type ArchiveTemplateInput,
  type ArchiveTemplateResult,
  type CreateAgreementFromPersistedTemplateInput,
  type CreateAgreementFromPersistedTemplateResult,
} from "./agreementTemplatesPersistence";
export {
  createCustomerAgreementFromTemplate,
  type CreateCustomerAgreementFromTemplateInput,
  type CreateCustomerAgreementReport,
  type TimeBankCreationOutcome,
  type TimeBankDecisionReason,
  type TimeBankEntitlementGate,
  type TimeBankGateResult,
} from "./agreementTemplateOrchestration";
export {
  decideTimeBankEntitlement,
  resolveTimeBankEntitlement,
  createTimeBankEntitlementGate,
  type TimeBankEntitlementDecision,
  type TimeBankEntitlementSource,
  type CreateTimeBankEntitlementGateOptions,
  type EntitlementContextLoader,
} from "./timeBankEntitlement";
export {
  migrateEmployees,
  shadowReadEmployees,
  inspectEmployeeBackfill,
  toEmployeeUpsertRow,
  type EmployeeMigrationReport,
  type EmployeeShadowReport,
  type EmployeeUpsertRow,
  type EmployeeBackfillInspection,
  type EmployeeCompanyReadiness,
  type EmployeeCompanyReadinessStatus,
} from "./employeeMigration";
export {
  validateWave0Parity,
  type ParityCheck,
  type ParityReport,
} from "./parity";
export {
  validateWorkOrderParity,
  type WorkOrderParityCheck,
  type WorkOrderParityReport,
} from "./workOrderParity";
export {
  migrateWorkOrders,
  shadowReadWorkOrders,
  shadowReadWorkOrderDetail,
  toWorkOrderUpsertRow,
  toServiceRowUpsertRow,
  toExceptionUpsertRow,
  type WorkOrderMigrationReport,
  type WorkOrderShadowReport,
  type WorkOrderDetailShadowReport,
  type WorkOrderUpsertRow,
  type WorkOrderServiceRowUpsertRow,
  type WorkOrderExceptionUpsertRow,
} from "./workOrderMigration";
export {
  mirrorWorkOrderWrites,
  mirrorWorkOrderExceptionWrites,
  shouldMirrorWorkOrderWrites,
  getWorkOrderDualWriteState,
  resetWorkOrderDualWriteState,
  type WorkOrderDualWriteResult,
  type WorkOrderExceptionDualWriteResult,
  type WorkOrderDualWriteState,
  type WorkOrderWriteDiff,
  type WorkOrderWriteMismatch,
  type WorkOrderWriteField,
} from "./workOrderDualWrite";
export {
  validateServiceRowFieldParity,
  validateVariationParity,
  validateExceptionParity,
  buildScheduleInputFromSupabase,
  buildScheduleInputFromLocal,
  reconstructExceptionsFromSupabase,
  compareScheduleInterval,
  compareScheduleEntries,
  validateWorkOrderScheduleDependency,
  RESOLVER_INPUT_COVERAGE,
  type ScheduleParityCheck,
  type ResolverFieldCoverage,
  type CoverageSource,
  type ScheduleReconstructionOptions,
  type ScheduleIntervalComparison,
  type OccurrenceDivergence,
  type WorkOrderScheduleValidationReport,
} from "./workOrderScheduleValidation";
export {
  migrateCustomers,
  shadowReadCustomers,
  shadowReadCustomerDetail,
  loadCompanyUuidMap,
  toCustomerUpsertRow,
  type CustomerMigrationReport,
  type CustomerShadowReport,
  type CustomerDetailShadowReport,
  type CustomerUpsertRow,
} from "./customerMigration";
export {
  mirrorCustomerWrites,
  affectedCustomerIds,
  getCustomerDualWriteState,
  resetCustomerDualWriteState,
  type CustomerDualWriteResult,
  type CustomerDualWriteState,
  type CustomerWriteDiff,
  type CustomerWriteMismatch,
  type CustomerWriteField,
} from "./customerDualWrite";
export {
  enqueueCustomerMirror,
  __setCustomerMirrorRunner,
  __resetCustomerMirrorQueue,
  type CustomerMirrorRunner,
} from "./customerMirrorQueue";
export {
  addCustomerDeleteTombstone,
  clearCustomerDeleteTombstone,
  clearCustomerDeleteTombstones,
  getCustomerDeleteTombstones,
  subscribeCustomerDeleteTombstones,
  __resetCustomerDeleteTombstones,
  CUSTOMER_DELETE_TOMBSTONE_MAX_AGE_MS,
  bumpCustomerListReconcile,
  getCustomerListReconcileVersion,
  subscribeCustomerListReconcile,
} from "./customerDeleteTombstones";
export {
  addCustomerPendingCreate,
  clearCustomerPendingCreate,
  clearCustomerPendingCreates,
  getCustomerPendingCreates,
  subscribeCustomerPendingCreates,
  __resetCustomerPendingCreates,
  CUSTOMER_PENDING_CREATE_MAX_AGE_MS,
} from "./customerPendingCreates";
export {
  resolveDetailMirrorWindow,
  isLocalRecordFresher,
  type DetailMirrorSource,
  type DetailMirrorResolution,
  type MirrorWindowRecord,
} from "./detailMirrorWindow";
export {
  mergeServiceDirectory,
  DEFAULT_MIRROR_WINDOW_MS,
} from "./serviceDirectoryMerge";
export {
  reconcileHydratedRecord,
  reconcileHydratedRecords,
  type HydratableRecord,
  type HydrationResult,
} from "./remoteRecordHydration";
export {
  runCustomerSoak,
  type CustomerSoakOptions,
  type CustomerSoakReport,
  type SoakWorkflow,
  type SoakWorkflowCounts,
  type SoakPerfObservation,
} from "./customerSoak";
export {
  runWorkOrderSoak,
  type WorkOrderSoakOptions,
  type WorkOrderSoakReport,
  type WorkOrderSoakWorkflow,
  type WorkOrderSoakWorkflowCounts,
  type WorkOrderSoakPerfObservation,
} from "./workOrderSoak";
export {
  collectCustomerStagingReport,
  formatCustomerStagingReport,
  runCustomerStagingReport,
  type CustomerStagingReport,
  type CustomerStagingFlagStates,
  type CustomerStagingCompanyCount,
} from "./customerStagingReport";
export {
  exportCustomerBackout,
  getLastCustomerBackout,
  getCustomerBackoutMeta,
  verifyCustomerBackout,
  type CustomerBackoutMeta,
  type CustomerBackoutSnapshot,
  type CustomerBackoutCompanyCount,
} from "./customerBackout";
export {
  isCustomerSupabaseAuthoritative,
  shouldReadListFromSupabase,
  shouldReadDetailFromSupabase,
  shouldMirrorWrites,
  getCustomerCutoverState,
  resetCustomerCutoverState,
  recordCutoverRead,
  recordCutoverFailure,
  subscribeCustomerCutoverFailure,
  type CutoverSource,
  type CutoverFallbackKind,
  type CutoverFailure,
  type CutoverFailureListener,
  type CustomerCutoverState,
} from "./customerCutover";
export {
  isWorkOrderSupabaseAuthoritative,
  shouldReadWorkOrderListFromSupabase,
  shouldReadWorkOrderDetailFromSupabase,
  getWorkOrderCutoverState,
  resetWorkOrderCutoverState,
  recordWorkOrderCutoverRead,
  recordWorkOrderCutoverFailure,
  type WorkOrderCutoverSource,
  type WorkOrderCutoverFallbackKind,
  type WorkOrderCutoverFailure,
  type WorkOrderCutoverState,
} from "./workOrderCutover";
export {
  exportWorkOrderBackout,
  getLastWorkOrderBackout,
  getWorkOrderBackoutMeta,
  verifyWorkOrderBackout,
  type WorkOrderBackoutMeta,
  type WorkOrderBackoutSnapshot,
  type WorkOrderBackoutCompanyCount,
} from "./workOrderBackout";
export {
  shouldReadScheduleFromSupabase,
  isScheduleSupabaseAuthoritative,
  getScheduleCutoverState,
  resetScheduleCutoverState,
  recordScheduleSupabaseInput,
  recordScheduleInputFallback,
  recordScheduleShadowDrift,
  recordScheduleIntervalQuery,
  type ScheduleInputSource,
  type ScheduleInputAuthority,
  type ScheduleInputFailure,
  type ScheduleIntervalQueryStat,
  type ScheduleCutoverState,
} from "./scheduleCutover";
export {
  shouldReadEmployeesFromSupabase,
  shouldMirrorEmployeeWrites,
  shouldShadowValidateEmployees,
  getEmployeeCutoverState,
  resetEmployeeCutoverState,
  recordEmployeeSupabaseRead,
  recordEmployeeReadFallback,
  recordEmployeeUnsafeEmpty,
  recordEmployeeShadowDrift,
  type EmployeeReadSource,
  type EmployeeReadFailureKind,
  type EmployeeReadFailure,
  type EmployeeCutoverState,
} from "./employeeCutover";
export {
  mirrorEmployeeWrites,
  getEmployeeDualWriteState,
  resetEmployeeDualWriteState,
  type EmployeeDualWriteResult,
  type EmployeeDualWriteState,
  type EmployeeWriteMismatch,
  type EmployeeWriteDiff,
  type EmployeeWriteField,
} from "./employeeDualWrite";
export {
  runScheduleAuthoritativeSoak,
  listScheduleSoakCompanies,
  type ScheduleSoakOptions,
  type ScheduleSoakReport,
  type ScheduleSoakViewMode,
  type ScheduleSoakIntervalResult,
  type ScheduleSoakPerfObservation,
} from "./scheduleAuthoritativeSoak";
// ── MCPM wave (MEDIA): Media Assets ───────────────────────────────────
export {
  listFullMediaAssetsFromSupabase,
  listMediaAssetSummariesFromSupabase,
  type MediaAssetSummary,
} from "./supabaseMediaAssetRepository";
export {
  migrateMediaAssets,
  shadowReadMediaAssets,
  toMediaAssetUpsertRow,
  readLocalMediaAssets,
  type MediaAssetUpsertRow,
  type MediaAssetMigrationReport,
  type MediaAssetShadowReport,
} from "./mediaAssetMigration";
export {
  mirrorMediaAssetWrites,
  getMediaAssetDualWriteState,
  resetMediaAssetDualWriteState,
  type MediaAssetDualWriteResult,
  type MediaAssetDualWriteState,
  type MediaAssetWriteMismatch,
  type MediaAssetWriteDiff,
} from "./mediaAssetDualWrite";
export {
  shouldReadMediaAssetsFromSupabase,
  shouldMirrorMediaAssetWrites,
  isMediaAssetsSupabaseAuthoritative,
  getMediaAssetCutoverState,
  resetMediaAssetCutoverState,
  recordMediaAssetSupabaseRead,
  recordMediaAssetReadFallback,
  recordMediaAssetUnsafeEmpty,
  recordMediaAssetShadowDrift,
  type MediaAssetCutoverState,
  type MediaAssetReadSource,
  type MediaAssetReadFailure,
} from "./mediaAssetCutover";
// ── MCPM wave (CHK): Checklist Templates (aggregate) ───────────────────
export {
  listFullChecklistTemplatesFromSupabase,
  listChecklistTemplateSummariesFromSupabase,
  type ChecklistTemplateAggregate,
  type ChecklistTemplateSummary,
} from "./supabaseChecklistTemplateRepository";
export {
  migrateChecklistTemplates,
  shadowReadChecklistTemplates,
  toChecklistTemplateUpsertRow,
  readLocalChecklistAggregates,
  type ChecklistTemplateUpsertRow,
  type ChecklistTemplateMigrationReport,
  type ChecklistTemplateShadowReport,
} from "./checklistTemplateMigration";
export {
  mirrorChecklistTemplateWrites,
  getChecklistTemplateDualWriteState,
  resetChecklistTemplateDualWriteState,
  type ChecklistTemplateDualWriteResult,
  type ChecklistTemplateDualWriteState,
  type ChecklistTemplateWriteMismatch,
  type ChecklistTemplateWriteDiff,
} from "./checklistTemplateDualWrite";
export {
  shouldReadChecklistTemplatesFromSupabase,
  shouldMirrorChecklistTemplateWrites,
  isChecklistTemplatesSupabaseAuthoritative,
  getChecklistTemplateCutoverState,
  resetChecklistTemplateCutoverState,
  recordChecklistTemplateSupabaseRead,
  recordChecklistTemplateReadFallback,
  recordChecklistTemplateUnsafeEmpty,
  recordChecklistTemplateShadowDrift,
  type ChecklistTemplateCutoverState,
  type ChecklistTemplateReadSource,
  type ChecklistTemplateReadFailure,
} from "./checklistTemplateCutover";
// ── MCPM wave (PROT): Customer Protocols (aggregate) ───────────────────
export {
  listFullCustomerProtocolsFromSupabase,
  listCustomerProtocolSummariesFromSupabase,
  type CustomerProtocolAggregate,
  type CustomerProtocolSummary,
} from "./supabaseCustomerProtocolRepository";
export {
  migrateCustomerProtocols,
  shadowReadCustomerProtocols,
  toCustomerProtocolUpsertRow,
  readLocalCustomerProtocolAggregates,
  type CustomerProtocolUpsertRow,
  type CustomerProtocolMigrationReport,
  type CustomerProtocolShadowReport,
} from "./customerProtocolMigration";
export {
  mirrorCustomerProtocolWrites,
  getCustomerProtocolDualWriteState,
  resetCustomerProtocolDualWriteState,
  type CustomerProtocolDualWriteResult,
  type CustomerProtocolDualWriteState,
  type CustomerProtocolWriteMismatch,
  type CustomerProtocolWriteDiff,
} from "./customerProtocolDualWrite";
export {
  shouldReadCustomerProtocolsFromSupabase,
  shouldMirrorCustomerProtocolWrites,
  isCustomerProtocolsSupabaseAuthoritative,
  getCustomerProtocolCutoverState,
  resetCustomerProtocolCutoverState,
  recordCustomerProtocolSupabaseRead,
  recordCustomerProtocolReadFallback,
  recordCustomerProtocolUnsafeEmpty,
  recordCustomerProtocolShadowDrift,
  type CustomerProtocolCutoverState,
  type CustomerProtocolReadSource,
  type CustomerProtocolReadFailure,
} from "./customerProtocolCutover";
// ── MCPM wave (MOD): Modules / Module Categories / Company Modules ───────
export {
  listFullModulesFromSupabase,
  listFullModuleCategoriesFromSupabase,
  listFullCompanyModulesFromSupabase,
} from "./supabaseModuleRepository";
export {
  migrateModules,
  shadowReadModules,
  toModuleUpsertRow,
  toModuleCategoryUpsertRow,
  toCompanyModuleUpsertRow,
  companyModuleLegacyId,
  type ModuleUpsertRow,
  type ModuleCategoryUpsertRow,
  type CompanyModuleUpsertRow,
  type ModuleMigrationReport,
  type ModuleShadowReport,
} from "./moduleMigration";
export {
  mirrorModuleWrites,
  mirrorModuleCategoryWrites,
  mirrorCompanyModuleWrites,
  getModuleDualWriteState,
  resetModuleDualWriteState,
  type ModuleDualWriteResult,
  type ModuleDualWriteState,
  type ModuleWriteDiff,
} from "./moduleDualWrite";
export {
  shouldReadModulesFromSupabase,
  shouldMirrorModuleWrites,
  isModulesSupabaseAuthoritative,
  getModuleCutoverState,
  resetModuleCutoverState,
  recordModuleSupabaseRead,
  recordModuleReadFallback,
  recordModuleUnsafeEmpty,
  recordModuleShadowDrift,
  type ModuleCutoverState,
  type ModuleReadSource,
  type ModuleReadFailure,
} from "./moduleCutover";
