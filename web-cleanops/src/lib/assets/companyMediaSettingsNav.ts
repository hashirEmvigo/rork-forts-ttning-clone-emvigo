import type { UserRole } from "@/types";

/** Company Admin Settings → Media Library route. */
export const COMPANY_MEDIA_LIBRARY_SETTINGS_PATH = "/settings/media" as const;

/** Company Admin owns this local settings surface; Super Admin owns global media at /media-center. */
export const COMPANY_MEDIA_LIBRARY_SETTINGS_ROLE: UserRole = "company_admin";

/** Reuses the existing Settings permission; no media-specific permission is introduced in MEDIA-004. */
export const COMPANY_MEDIA_LIBRARY_SETTINGS_VIEW_PERMISSION = "settings.manage" as const;

/** Mirrors the /settings/media route guard for the Settings tile visibility. */
export function shouldShowCompanyMediaLibrarySettingsNav(
  role: UserRole | null | undefined,
  hasPermission: (key: string) => boolean,
): boolean {
  return (
    role === COMPANY_MEDIA_LIBRARY_SETTINGS_ROLE &&
    hasPermission(COMPANY_MEDIA_LIBRARY_SETTINGS_VIEW_PERMISSION)
  );
}
