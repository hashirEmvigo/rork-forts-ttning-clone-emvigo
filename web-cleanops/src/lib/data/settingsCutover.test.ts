import { beforeEach, describe, expect, it } from "vitest";

/**
 * SET-1 — Settings wave cutover telemetry runtimes (settings_templates +
 * company_settings). Under vitest every Settings flag resolves OFF, so the
 * decisions are false here; this suite exercises the telemetry counters.
 */

import {
  shouldReadSettingsTemplatesFromSupabase,
  shouldMirrorSettingsTemplateWrites,
  getSettingsTemplateCutoverState,
  resetSettingsTemplateCutoverState,
  recordSettingsTemplateSupabaseRead,
  recordSettingsTemplateUnsafeEmpty,
} from "./settingsTemplateCutover";
import {
  shouldReadCompanySettingsFromSupabase,
  shouldMirrorCompanySettingsWrites,
  getCompanySettingsCutoverState,
  resetCompanySettingsCutoverState,
  recordCompanySettingsReadFallback,
  recordCompanySettingsShadowDrift,
} from "./companySettingsCutover";

beforeEach(() => {
  resetSettingsTemplateCutoverState();
  resetCompanySettingsCutoverState();
});

describe("SET cutover telemetry · settings_templates", () => {
  it("defaults to the localStorage-authoritative path under vitest", () => {
    expect(shouldReadSettingsTemplatesFromSupabase()).toBe(false);
    expect(shouldMirrorSettingsTemplateWrites()).toBe(false);
    expect(getSettingsTemplateCutoverState().readSource).toBe("localStorage");
  });

  it("records a healthy read and an unsafe-empty", () => {
    recordSettingsTemplateSupabaseRead();
    recordSettingsTemplateUnsafeEmpty("*");
    const state = getSettingsTemplateCutoverState();
    expect(state.supabaseReads).toBe(1);
    expect(state.unsafeEmptyReads).toBe(1);
    expect(state.recentFailures[0]?.kind).toBe("unsafe.empty");
  });
});

describe("SET cutover telemetry · company_settings", () => {
  it("defaults to the localStorage-authoritative path under vitest", () => {
    expect(shouldReadCompanySettingsFromSupabase()).toBe(false);
    expect(shouldMirrorCompanySettingsWrites()).toBe(false);
    expect(getCompanySettingsCutoverState().readSource).toBe("localStorage");
  });

  it("records a read fallback and shadow drift", () => {
    recordCompanySettingsReadFallback("cmp_x", "network down");
    recordCompanySettingsShadowDrift("count mismatch");
    const state = getCompanySettingsCutoverState();
    expect(state.fallbacks).toBe(1);
    expect(state.shadowDrift).toBe(1);
    expect(state.lastMismatch).toBe("count mismatch");
  });
});
