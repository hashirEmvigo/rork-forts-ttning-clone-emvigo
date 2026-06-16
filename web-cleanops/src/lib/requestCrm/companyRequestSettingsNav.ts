/**
 * Company Admin local Request settings — route + nav gating helpers.
 *
 * Centralizes the "may this Company Admin see/reach the local Request settings
 * foundation" logic so the route guard (`App.tsx`) and the sidebar nav
 * (`DashboardLayout.tsx`) stay in lockstep and the behaviour is unit-testable
 * without mounting the whole app.
 *
 * This is the Company-Admin-local counterpart to the Super Admin global
 * governance surface at `/request-settings`. It is tied to the same Admin
 * Requests product and reuses existing seams only:
 *  - the existing `requests.settings.view` permission (no new permission key),
 *  - the existing `admin-requests` module access seam via `canAccessModule`
 *    (the Service → Module bridge from WAVE-003H-R / WAVE-003I-R).
 *
 * No new entitlement model, module model, or settings framework is introduced.
 */
import { REQUEST_CRM_SETTINGS_VIEW_PERMISSION } from "@/lib/requestCrm/settingsNav";
import { REQUEST_CRM_MODULE_ID } from "@/lib/requestCrm/shellNav";
import type { UserRole } from "@/types";

/** Company Admin local Request settings route (distinct from Super Admin `/request-settings`). */
export const COMPANY_REQUEST_SETTINGS_PATH = "/settings/request" as const;

/** The single role that owns the local Request settings foundation. */
export const COMPANY_REQUEST_SETTINGS_ROLE: UserRole = "company_admin";

/**
 * Permission required to view the local Request settings foundation. Reuses the
 * existing request-settings view permission so no new permission key is added.
 */
export const COMPANY_REQUEST_SETTINGS_VIEW_PERMISSION =
  REQUEST_CRM_SETTINGS_VIEW_PERMISSION;

/**
 * The module whose access additionally gates the local Request settings surface,
 * resolved through the single `canAccessModule` seam — the existing
 * `admin-requests` module offered by the `admin_requests` service. Re-exported so
 * the route guard and nav consume one shared id.
 */
export { REQUEST_CRM_MODULE_ID };

/**
 * Whether the Company Admin local Request settings nav entry should be shown for
 * the current user. It is Company-Admin-only, requires the existing
 * request-settings view permission, and requires the `admin-requests` module to
 * be usable through the existing module access seam. This mirrors the
 * `/settings/request` route guard so nav and route stay in lockstep — Super Admin
 * is intentionally excluded because Super Admin governs globally at
 * `/request-settings`.
 */
export function shouldShowCompanyRequestSettingsNav(
  role: UserRole | null | undefined,
  hasPermission: (key: string) => boolean,
  canAccessAdminRequestsModule: boolean,
): boolean {
  return (
    role === COMPANY_REQUEST_SETTINGS_ROLE &&
    hasPermission(COMPANY_REQUEST_SETTINGS_VIEW_PERMISSION) &&
    canAccessAdminRequestsModule
  );
}
