/**
 * REQUEST CRM Dashboard + Request List shell — flag + permission gating helpers.
 *
 * Centralizes the "is this surface allowed to appear" logic for the read-only
 * `/crm`, `/crm/dashboard` and `/crm/requests` shells so the route guard
 * (`App.tsx`) and the sidebar nav (`DashboardLayout.tsx`) stay in lockstep and
 * the behaviour is unit-testable without mounting the whole app.
 *
 * This sub-slice lives under the master REQUEST CRM shell flag only
 * (`ENABLE_REQUEST_CRM_FRONTEND_SHELL`); the settings shell keeps its own extra
 * sub-flag. Everything defaults OFF, and the user must hold `requests.view`.
 * Role scoping (shared admin only) is enforced by the route guard + nav
 * placement, exactly like the settings shell.
 */
import { ENABLE_REQUEST_CRM_FRONTEND_SHELL } from "@/lib/featureFlags";
import { REQUEST_CRM_ADMIN_ROLES } from "@/lib/requestCrm/settingsNav";

/** Permission required to view the REQUEST CRM dashboard + request list shells. */
export const REQUEST_CRM_VIEW_PERMISSION = "requests.view" as const;

/** Base route for the REQUEST CRM workspace; redirects to the dashboard. */
export const REQUEST_CRM_BASE_PATH = "/crm" as const;

/** Read-only dashboard route. */
export const REQUEST_CRM_DASHBOARD_PATH = "/crm/dashboard" as const;

/** Read-only request list route. */
export const REQUEST_CRM_REQUESTS_PATH = "/crm/requests" as const;

/**
 * The Modules-model id whose access additionally gates the REQUEST CRM
 * **operational** routes (`/crm`, `/crm/dashboard`, `/crm/requests`). This is the
 * existing `admin-requests` module offered by the `admin_requests` service
 * through the Service → Module bridge (WAVE-003H-R); the operational shell is
 * reachable only when `canAccessModule(currentUser, REQUEST_CRM_MODULE_ID)` is
 * true for the company. The settings routes are deliberately NOT gated by this.
 */
export const REQUEST_CRM_MODULE_ID = "admin-requests" as const;

export { REQUEST_CRM_ADMIN_ROLES };

/**
 * True when the master REQUEST CRM frontend shell flag is enabled. The
 * dashboard/list routes + nav must not exist otherwise.
 */
export function isRequestCrmShellEnabled(): boolean {
  return ENABLE_REQUEST_CRM_FRONTEND_SHELL;
}

/**
 * Whether the REQUEST CRM dashboard/list nav entries should be shown for the
 * current user: shell flag enabled AND the user holds `requests.view`. Role
 * scoping (shared admin only) is enforced by the route guard + nav placement.
 */
export function shouldShowRequestCrmShellNav(
  hasPermission: (key: string) => boolean,
): boolean {
  return isRequestCrmShellEnabled() && hasPermission(REQUEST_CRM_VIEW_PERMISSION);
}
