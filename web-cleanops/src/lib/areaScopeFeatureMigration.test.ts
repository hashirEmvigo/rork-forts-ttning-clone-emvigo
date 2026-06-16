import { beforeEach, describe, expect, it } from "vitest";

import {
  getAreaScopedAccessActivationPrecheck,
  isAreaScopedAccessEnabled,
  isFeatureEnabled,
  migrateAreaScopedAccessToFeatureFlag,
  setAreaScopedAccessEnabled,
  setFeatureEnabled,
} from "./store";

/**
 * Verifies Area Scoped Access is now governed by the Feature Activation
 * Framework (`area_scoped_access`), while the activation pre-check and legacy
 * migration behavior are preserved.
 */

const COMPANY = "cmp_nordlys";
const LEGACY_KEY = "cleanops.areaScopedAccess";
const FEATURE_KEY = "cleanops.featureFlags";
const MIGRATION_KEY = "cleanops.migration.areaScopedAccessToFeature";

beforeEach(() => {
  localStorage.clear();
});

describe("area scoped access — feature framework as source of truth", () => {
  it("reads the area_scoped_access feature flag", () => {
    expect(isAreaScopedAccessEnabled(COMPANY)).toBe(false);
    setFeatureEnabled(COMPANY, "area_scoped_access", true);
    expect(isAreaScopedAccessEnabled(COMPANY)).toBe(true);
  });

  it("enabling writes the feature flag (no blocking customers)", () => {
    const result = setAreaScopedAccessEnabled(COMPANY, true);
    expect(result.ok).toBe(true);
    expect(isFeatureEnabled(COMPANY, "area_scoped_access")).toBe(true);
    expect(isAreaScopedAccessEnabled(COMPANY)).toBe(true);
  });

  it("disabling clears the feature flag", () => {
    setFeatureEnabled(COMPANY, "area_scoped_access", true);
    const result = setAreaScopedAccessEnabled(COMPANY, false);
    expect(result.ok).toBe(true);
    expect(isFeatureEnabled(COMPANY, "area_scoped_access")).toBe(false);
    expect(isAreaScopedAccessEnabled(COMPANY)).toBe(false);
  });
});

describe("area scoped access — activation pre-check is preserved", () => {
  it("blocks enabling when an active customer has no area, leaving the flag off", () => {
    const now = new Date().toISOString();
    localStorage.setItem(
      "cleanops.companies",
      JSON.stringify([{ id: COMPANY, name: "Nordlys", createdAt: now }]),
    );
    // Pre-populate users + areas so demo seeding does not overwrite fixtures.
    localStorage.setItem(
      "cleanops.users",
      JSON.stringify([{ id: "u1", companyId: COMPANY, email: "a@b.c", role: "company_admin" }]),
    );
    localStorage.setItem("cleanops.areas", JSON.stringify([]));
    localStorage.setItem(
      "cleanops.customers",
      JSON.stringify([
        {
          id: "c1",
          companyId: COMPANY,
          name: "No Area Co",
          customerNumber: "C-1",
          email: "a@b.c",
          status: "active",
          userIds: [],
          createdAt: now,
        },
      ]),
    );

    const precheck = getAreaScopedAccessActivationPrecheck(COMPANY);
    expect(precheck.canEnable).toBe(false);

    const result = setAreaScopedAccessEnabled(COMPANY, true);
    expect(result.ok).toBe(false);
    expect(result.precheck?.canEnable).toBe(false);
    // Feature flag stays disabled after the blocked activation.
    expect(isFeatureEnabled(COMPANY, "area_scoped_access")).toBe(false);
  });
});

describe("area scoped access — legacy migration", () => {
  it("migrates an enabled legacy flag into the feature flag", () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify({ [COMPANY]: true }));
    migrateAreaScopedAccessToFeatureFlag();
    expect(isFeatureEnabled(COMPANY, "area_scoped_access")).toBe(true);
    expect(isAreaScopedAccessEnabled(COMPANY)).toBe(true);
  });

  it("does not enable the feature for a disabled legacy flag", () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify({ [COMPANY]: false }));
    migrateAreaScopedAccessToFeatureFlag();
    expect(isFeatureEnabled(COMPANY, "area_scoped_access")).toBe(false);
  });

  it("defaults to disabled when no legacy flag exists", () => {
    migrateAreaScopedAccessToFeatureFlag();
    expect(isFeatureEnabled(COMPANY, "area_scoped_access")).toBe(false);
  });

  it("runs at most once and does not clobber an explicit feature value", () => {
    // A company explicitly disabled via the feature framework...
    setFeatureEnabled(COMPANY, "area_scoped_access", false);
    // ...with a stale legacy "enabled" value must not be re-enabled.
    localStorage.setItem(LEGACY_KEY, JSON.stringify({ [COMPANY]: true }));
    migrateAreaScopedAccessToFeatureFlag();
    expect(isFeatureEnabled(COMPANY, "area_scoped_access")).toBe(false);
    expect(localStorage.getItem(MIGRATION_KEY)).toBe("1");

    // Second run is a guarded no-op.
    localStorage.setItem(FEATURE_KEY, JSON.stringify({}));
    migrateAreaScopedAccessToFeatureFlag();
    expect(isFeatureEnabled(COMPANY, "area_scoped_access")).toBe(false);
  });
});
