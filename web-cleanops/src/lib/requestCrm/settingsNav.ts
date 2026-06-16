/**
 * REQUEST CRM Settings Shell — flag + permission gating helpers.
 *
 * Centralizes the "is this surface allowed to appear" logic so the route guard
 * (`App.tsx`) and the sidebar nav (`DashboardLayout.tsx`) stay in lockstep and
 * the behaviour is unit-testable without mounting the whole app.
 *
 * Everything defaults OFF: both the master shell flag and the settings-shell
 * flag must be ON, and the user must hold the view permission.
 */
import {
  ENABLE_REQUEST_CRM_FRONTEND_SHELL,
  ENABLE_REQUEST_CRM_SETTINGS_SHELL,
} from "@/lib/featureFlags";
import { REQUEST_CRM_SETTINGS_BASE_PATH } from "@/lib/requestCrm/settingsTabs";

/** Permission required to view the REQUEST CRM settings shell. */
export const REQUEST_CRM_SETTINGS_VIEW_PERMISSION = "requests.settings.view" as const;

/** Permission required to (eventually) manage REQUEST CRM settings. */
export const REQUEST_CRM_SETTINGS_MANAGE_PERMISSION = "requests.settings.manage" as const;

/** Roles allowed into the REQUEST CRM settings shell (shared admin only). */
export const REQUEST_CRM_ADMIN_ROLES = ["super_admin", "company_admin"] as const;

export { REQUEST_CRM_SETTINGS_BASE_PATH };

/**
 * True only when BOTH the master REQUEST CRM shell flag and the settings-shell
 * flag are enabled. The settings route/nav must not exist otherwise.
 */
export function isRequestCrmSettingsShellEnabled(): boolean {
  return ENABLE_REQUEST_CRM_FRONTEND_SHELL && ENABLE_REQUEST_CRM_SETTINGS_SHELL;
}

/**
 * Whether the REQUEST CRM settings nav entry should be shown for the current
 * user: flags enabled AND the user holds `requests.settings.view`. Role scoping
 * is enforced by the route guard + nav placement (shared admin only).
 */
export function shouldShowRequestCrmSettingsNav(
  hasPermission: (key: string) => boolean,
): boolean {
  return (
    isRequestCrmSettingsShellEnabled() &&
    hasPermission(REQUEST_CRM_SETTINGS_VIEW_PERMISSION)
  );
}
