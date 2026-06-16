import { beforeEach, describe, expect, it } from "vitest";

import {
  getFeature,
  isKnownFeatureId,
  listFeatures,
  type FeatureId,
} from "./features";
import { isFeatureEnabled, setFeatureEnabled } from "./store";

const COMPANY = "cmp_nordlys";
const OTHER = "cmp_other";

beforeEach(() => {
  localStorage.clear();
});

describe("feature registry", () => {
  it("lists registered features with well-formed definitions", () => {
    const features = listFeatures();
    expect(features.length).toBeGreaterThan(0);
    for (const f of features) {
      expect(f.id).toBeTruthy();
      expect(f.name).toBeTruthy();
      expect(f.description).toBeTruthy();
      expect(typeof f.defaultEnabled).toBe("boolean");
      expect(typeof f.requiresSetup).toBe("boolean");
    }
  });

  it("has unique feature ids", () => {
    const ids = listFeatures().map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("looks up a feature by id", () => {
    const feature = getFeature("area_scoped_access");
    expect(feature?.name).toBe("Area Scoped Access");
    expect(getFeature("does_not_exist")).toBeUndefined();
  });

  it("recognizes known feature ids", () => {
    expect(isKnownFeatureId("customer_owner")).toBe(true);
    expect(isKnownFeatureId("nope")).toBe(false);
  });
});

describe("feature flags (per company)", () => {
  it("falls back to the registered default when no override exists", () => {
    expect(isFeatureEnabled(COMPANY, "customer_owner")).toBe(false);
  });

  it("persists an explicit override per company", () => {
    setFeatureEnabled(COMPANY, "customer_owner", true);
    expect(isFeatureEnabled(COMPANY, "customer_owner")).toBe(true);
    // Other companies are unaffected.
    expect(isFeatureEnabled(OTHER, "customer_owner")).toBe(false);
  });

  it("can disable a feature explicitly", () => {
    setFeatureEnabled(COMPANY, "time_bank", true);
    expect(isFeatureEnabled(COMPANY, "time_bank")).toBe(true);
    setFeatureEnabled(COMPANY, "time_bank", false);
    expect(isFeatureEnabled(COMPANY, "time_bank")).toBe(false);
  });

  it("keeps overrides for different features independent", () => {
    setFeatureEnabled(COMPANY, "time_bank", true);
    setFeatureEnabled(COMPANY, "multilingual", true);
    expect(isFeatureEnabled(COMPANY, "time_bank")).toBe(true);
    expect(isFeatureEnabled(COMPANY, "multilingual")).toBe(true);
    expect(isFeatureEnabled(COMPANY, "advanced_reporting")).toBe(false);
  });

  it("ignores unknown feature ids and missing companies safely", () => {
    expect(setFeatureEnabled(COMPANY, "bogus" as FeatureId, true)).toBe(false);
    expect(isFeatureEnabled(COMPANY, "bogus")).toBe(false);
    expect(setFeatureEnabled(null, "customer_owner", true)).toBe(false);
    expect(isFeatureEnabled(null, "customer_owner")).toBe(false);
  });
});
