import { describe, expect, it } from "vitest";

import {
  COMPANY_REQUEST_SETTINGS_PATH,
  COMPANY_REQUEST_SETTINGS_ROLE,
  COMPANY_REQUEST_SETTINGS_VIEW_PERMISSION,
  REQUEST_CRM_MODULE_ID,
  shouldShowCompanyRequestSettingsNav,
} from "@/lib/requestCrm/companyRequestSettingsNav";

/**
 * The Company Admin local Request settings foundation (`/settings/request`,
 * WAVE-003J-R) is the Company-Admin counterpart to the Super Admin global
 * governance surface at `/request-settings`. These tests pin its gating
 * constants and the nav/route lockstep predicate, which reuses existing seams
 * only — the `requests.settings.view` permission and the `admin-requests`
 * module access seam — with no new permission/entitlement/module model.
 */
const grantAll = (): boolean => true;
const grantNone = (): boolean => false;
const grantSettingsViewOnly = (key: string): boolean =>
  key === COMPANY_REQUEST_SETTINGS_VIEW_PERMISSION;

describe("Company Admin local Request settings gating", () => {
  it("targets the Company-Admin-local route, distinct from the Super Admin one", () => {
    expect(COMPANY_REQUEST_SETTINGS_PATH).toBe("/settings/request");
    expect(COMPANY_REQUEST_SETTINGS_PATH).not.toBe("/request-settings");
  });

  it("reuses the existing request-settings permission and admin-requests module id", () => {
    expect(COMPANY_REQUEST_SETTINGS_VIEW_PERMISSION).toBe("requests.settings.view");
    expect(REQUEST_CRM_MODULE_ID).toBe("admin-requests");
    expect(COMPANY_REQUEST_SETTINGS_ROLE).toBe("company_admin");
  });

  it("shows the nav for a Company Admin with the permission AND a usable admin-requests module", () => {
    expect(shouldShowCompanyRequestSettingsNav("company_admin", grantAll, true)).toBe(true);
    expect(
      shouldShowCompanyRequestSettingsNav("company_admin", grantSettingsViewOnly, true),
    ).toBe(true);
  });

  it("hides the nav for a Company Admin whose admin-requests module is not usable", () => {
    expect(shouldShowCompanyRequestSettingsNav("company_admin", grantAll, false)).toBe(false);
  });

  it("hides the nav for a Company Admin who lacks the request-settings permission", () => {
    expect(shouldShowCompanyRequestSettingsNav("company_admin", grantNone, true)).toBe(false);
  });

  it("hides the nav for Super Admin (they govern globally at /request-settings)", () => {
    expect(shouldShowCompanyRequestSettingsNav("super_admin", grantAll, true)).toBe(false);
  });

  it("hides the nav for other roles and signed-out users", () => {
    expect(shouldShowCompanyRequestSettingsNav("employee", grantAll, true)).toBe(false);
    expect(shouldShowCompanyRequestSettingsNav("customer", grantAll, true)).toBe(false);
    expect(shouldShowCompanyRequestSettingsNav(null, grantAll, true)).toBe(false);
    expect(shouldShowCompanyRequestSettingsNav(undefined, grantAll, true)).toBe(false);
  });
});
