/**
 * REQUEST CRM Slice 0 mock fixtures (in-`src` adapter layer).
 *
 * These typed modules mirror `mock-data/request-crm/*.seed.json` so Vite bundles
 * them. The package JSON remains the spec; everything here is read-only test
 * data (`isTestData: true`, batch "RC-DEMO"). No localStorage authority, no
 * Supabase writes, no network mutations.
 */
export {
  REQUEST_CRM_TEST_BATCH_ID,
  REQUEST_CRM_SETTINGS_ITEMS,
  getRequestCrmSettingsItems,
} from "@/lib/requestCrm/mockData/settingsShell";
export { REQUEST_CRM_AUTOMATION_CANDIDATES } from "@/lib/requestCrm/mockData/automationCandidates";
export { REQUEST_CRM_RUNTIME_SAFETY } from "@/lib/requestCrm/mockData/runtimeSafety";
export { REQUEST_CRM_DASHBOARD_CARDS } from "@/lib/requestCrm/mockData/requestDashboard";
export {
  REQUEST_CRM_REQUESTS,
  REQUEST_CRM_CATEGORIES,
  REQUEST_CRM_REQUEST_TYPES,
  REQUEST_CRM_OWNERS,
  REQUEST_CRM_CUSTOMERS,
} from "@/lib/requestCrm/mockData/requestList";
