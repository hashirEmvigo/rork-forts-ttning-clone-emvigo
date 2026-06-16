import { describe, expect, it, beforeEach, vi } from "vitest";

/**
 * The master REQUEST CRM frontend shell flag gates whether the dashboard +
 * request list routes/nav exist. We mock the feature-flag module so we can flip
 * it per test; the helpers read the binding at call time.
 */
const flags = vi.hoisted(() => ({ frontend: false }));

vi.mock("@/lib/featureFlags", () => ({
  get ENABLE_REQUEST_CRM_FRONTEND_SHELL() {
    return flags.frontend;
  },
  get ENABLE_REQUEST_CRM_SETTINGS_SHELL() {
    return false;
  },
}));

import {
  isRequestCrmShellEnabled,
  shouldShowRequestCrmShellNav,
  REQUEST_CRM_VIEW_PERMISSION,
  REQUEST_CRM_BASE_PATH,
  REQUEST_CRM_DASHBOARD_PATH,
  REQUEST_CRM_REQUESTS_PATH,
  REQUEST_CRM_MODULE_ID,
} from "@/lib/requestCrm/shellNav";

const grantAll = (): boolean => true;
const grantNone = (): boolean => false;
const grantViewOnly = (key: string): boolean => key === REQUEST_CRM_VIEW_PERMISSION;

beforeEach(() => {
  flags.frontend = false;
});

describe("REQUEST CRM shell gating", () => {
  it("exposes the canonical routes", () => {
    expect(REQUEST_CRM_BASE_PATH).toBe("/crm");
    expect(REQUEST_CRM_DASHBOARD_PATH).toBe("/crm/dashboard");
    expect(REQUEST_CRM_REQUESTS_PATH).toBe("/crm/requests");
  });

  it("binds the operational routes to the existing admin-requests module id", () => {
    expect(REQUEST_CRM_MODULE_ID).toBe("admin-requests");
  });

  it("is disabled by default (flag OFF)", () => {
    expect(isRequestCrmShellEnabled()).toBe(false);
    expect(shouldShowRequestCrmShellNav(grantAll)).toBe(false);
  });

  it("enables when the master frontend shell flag is ON", () => {
    flags.frontend = true;
    expect(isRequestCrmShellEnabled()).toBe(true);
  });

  it("shows the nav only with the flag ON and requests.view held", () => {
    flags.frontend = true;
    expect(shouldShowRequestCrmShellNav(grantAll)).toBe(true);
    expect(shouldShowRequestCrmShellNav(grantViewOnly)).toBe(true);
    expect(shouldShowRequestCrmShellNav(grantNone)).toBe(false);
  });

  it("hides the nav when the flag is ON but the permission is missing", () => {
    flags.frontend = true;
    expect(shouldShowRequestCrmShellNav(grantNone)).toBe(false);
  });
});
