import { describe, expect, it, beforeEach, vi } from "vitest";

/**
 * The flag gating drives whether the REQUEST CRM settings route + nav exist.
 * We mock the feature-flag module so we can flip the two shell flags per test;
 * the helpers read those bindings at call time.
 */
const flags = vi.hoisted(() => ({ frontend: false, settings: false }));

vi.mock("@/lib/featureFlags", () => ({
  get ENABLE_REQUEST_CRM_FRONTEND_SHELL() {
    return flags.frontend;
  },
  get ENABLE_REQUEST_CRM_SETTINGS_SHELL() {
    return flags.settings;
  },
}));

import {
  isRequestCrmSettingsShellEnabled,
  shouldShowRequestCrmSettingsNav,
  REQUEST_CRM_SETTINGS_VIEW_PERMISSION,
  REQUEST_CRM_SETTINGS_BASE_PATH,
} from "@/lib/requestCrm/settingsNav";

const grantAll = (): boolean => true;
const grantNone = (): boolean => false;
const grantViewOnly = (key: string): boolean => key === REQUEST_CRM_SETTINGS_VIEW_PERMISSION;

beforeEach(() => {
  flags.frontend = false;
  flags.settings = false;
});

describe("REQUEST CRM settings shell gating", () => {
  it("exposes the canonical base path", () => {
    expect(REQUEST_CRM_SETTINGS_BASE_PATH).toBe("/crm/settings");
  });

  it("is disabled by default (both flags OFF)", () => {
    expect(isRequestCrmSettingsShellEnabled()).toBe(false);
    expect(shouldShowRequestCrmSettingsNav(grantAll)).toBe(false);
  });

  it("stays disabled when only one flag is ON", () => {
    flags.frontend = true;
    expect(isRequestCrmSettingsShellEnabled()).toBe(false);

    flags.frontend = false;
    flags.settings = true;
    expect(isRequestCrmSettingsShellEnabled()).toBe(false);
  });

  it("enables only when BOTH flags are ON", () => {
    flags.frontend = true;
    flags.settings = true;
    expect(isRequestCrmSettingsShellEnabled()).toBe(true);
  });

  it("shows the nav only with both flags ON and the view permission held", () => {
    flags.frontend = true;
    flags.settings = true;
    expect(shouldShowRequestCrmSettingsNav(grantAll)).toBe(true);
    expect(shouldShowRequestCrmSettingsNav(grantViewOnly)).toBe(true);
    expect(shouldShowRequestCrmSettingsNav(grantNone)).toBe(false);
  });

  it("hides the nav when flags are ON but the permission is missing", () => {
    flags.frontend = true;
    flags.settings = true;
    expect(shouldShowRequestCrmSettingsNav(grantNone)).toBe(false);
  });
});
