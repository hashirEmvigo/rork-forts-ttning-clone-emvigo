import { describe, expect, it } from "vitest";

import type { UserRole } from "@/types";

import {
  COMPANY_MEDIA_LIBRARY_SETTINGS_PATH,
  COMPANY_MEDIA_LIBRARY_SETTINGS_ROLE,
  COMPANY_MEDIA_LIBRARY_SETTINGS_VIEW_PERMISSION,
  shouldShowCompanyMediaLibrarySettingsNav,
} from "./companyMediaSettingsNav";

describe("Company Admin Settings Media Library nav helper", () => {
  const grantSettings = (permission: string): boolean => permission === "settings.manage";
  const grantNone = (): boolean => false;

  it("uses the approved /settings/media path and existing Settings permission", () => {
    expect(COMPANY_MEDIA_LIBRARY_SETTINGS_PATH).toBe("/settings/media");
    expect(COMPANY_MEDIA_LIBRARY_SETTINGS_ROLE).toBe("company_admin");
    expect(COMPANY_MEDIA_LIBRARY_SETTINGS_VIEW_PERMISSION).toBe("settings.manage");
  });

  it("shows only for Company Admin users with settings.manage", () => {
    expect(shouldShowCompanyMediaLibrarySettingsNav("company_admin", grantSettings)).toBe(true);
    expect(shouldShowCompanyMediaLibrarySettingsNav("company_admin", grantNone)).toBe(false);

    for (const role of ["super_admin", "employee", "customer", null, undefined] as Array<UserRole | null | undefined>) {
      expect(shouldShowCompanyMediaLibrarySettingsNav(role, grantSettings)).toBe(false);
    }
  });
});
