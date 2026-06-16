import { describe, expect, it } from "vitest";

/**
 * Slice GPM-4a — generic pricing-model CONFIG CONTRACT helpers.
 *
 * Proves the single-source-of-truth contract for what each generic model
 * requires: primary input, plan-field requirements, engine support, and plan
 * validation. Pure functions only — no DB, no public runtime, no pricing change.
 */

import { defaultSettingsForGenericModel } from "../calculatorConfigAdmin";
import { GENERIC_PRICING_MODELS } from "./pricingModel";
import {
  isGenericModelEngineSupported,
  primaryInputForGenericModel,
  requiredPlanFieldsForGenericModel,
  validateGenericPlan,
  RESERVED_GENERIC_PLAN_FIELDS,
  WRITABLE_GENERIC_PLAN_FIELDS,
  type GenericPrimaryInput,
} from "./genericPricingContract";

describe("primaryInputForGenericModel", () => {
  it("is exhaustive: every generic model resolves to a known primary input", () => {
    const allowed: GenericPrimaryInput[] = ["sqm", "quantity", "none"];
    for (const model of GENERIC_PRICING_MODELS) {
      expect(allowed).toContain(primaryInputForGenericModel(model));
    }
  });

  it("maps each model to its approved primary input", () => {
    expect(primaryInputForGenericModel("hourly_by_area")).toBe("sqm");
    expect(primaryInputForGenericModel("sqm_fixed")).toBe("sqm");
    expect(primaryInputForGenericModel("unit_based")).toBe("quantity");
    expect(primaryInputForGenericModel("fixed_package")).toBe("none");
    expect(primaryInputForGenericModel("manual_quote")).toBe("none");
  });

  it("agrees with defaultSettingsForGenericModel primaryInput (drift guard, single source of truth)", () => {
    for (const model of GENERIC_PRICING_MODELS) {
      // manual_quote omits primaryInput in its settings defaults → treated as "none".
      const settingsPrimary = defaultSettingsForGenericModel(model).primaryInput ?? "none";
      expect(settingsPrimary).toBe(primaryInputForGenericModel(model));
    }
  });
});

describe("requiredPlanFieldsForGenericModel", () => {
  it("is exhaustive: every generic model returns a well-formed contract", () => {
    for (const model of GENERIC_PRICING_MODELS) {
      const contract = requiredPlanFieldsForGenericModel(model);
      expect(Array.isArray(contract.required)).toBe(true);
      expect(Array.isArray(contract.optional)).toBe(true);
      expect(typeof contract.engineSupported).toBe("boolean");
    }
  });

  it("hourly_by_area requires hourlyRate and is engine-supported", () => {
    const contract = requiredPlanFieldsForGenericModel("hourly_by_area");
    expect(contract.required).toContain("hourlyRate");
    expect(contract.optional).toContain("startAdjustmentHours");
    expect(contract.engineSupported).toBe(true);
  });

  it("sqm_fixed requires pricePerSqmExclVat and is engine-supported", () => {
    const contract = requiredPlanFieldsForGenericModel("sqm_fixed");
    expect(contract.required).toContain("pricePerSqmExclVat");
    expect(contract.engineSupported).toBe(true);
  });

  it("unit_based reserves the future pricePerUnitExclVat field but is NOT engine-supported yet", () => {
    const contract = requiredPlanFieldsForGenericModel("unit_based");
    expect(contract.required).toEqual(["pricePerUnitExclVat"]);
    expect(contract.engineSupported).toBe(false);
    // The reserved field has no writable column yet.
    expect(RESERVED_GENERIC_PLAN_FIELDS).toContain("pricePerUnitExclVat");
    expect(WRITABLE_GENERIC_PLAN_FIELDS).not.toContain("pricePerUnitExclVat" as never);
  });

  it("fixed_package reserves a dedicated base-price field but is NOT engine-supported yet", () => {
    const contract = requiredPlanFieldsForGenericModel("fixed_package");
    expect(contract.required).toEqual(["fixedPackagePriceExclVat"]);
    expect(contract.engineSupported).toBe(false);
    // Documents the decision NOT to overload fixedAdjustmentExclVat/minimumPriceExclVat.
    expect(RESERVED_GENERIC_PLAN_FIELDS).toContain("fixedPackagePriceExclVat");
  });

  it("manual_quote has no required pricing fields and is NOT a priceable engine model", () => {
    const contract = requiredPlanFieldsForGenericModel("manual_quote");
    expect(contract.required).toEqual([]);
    expect(contract.optional).toEqual([]);
    expect(contract.engineSupported).toBe(false);
  });
});

describe("isGenericModelEngineSupported", () => {
  it("matches GPM-1 engine support: only hourly_by_area + sqm_fixed today", () => {
    expect(isGenericModelEngineSupported("hourly_by_area")).toBe(true);
    expect(isGenericModelEngineSupported("sqm_fixed")).toBe(true);
    expect(isGenericModelEngineSupported("unit_based")).toBe(false);
    expect(isGenericModelEngineSupported("fixed_package")).toBe(false);
    expect(isGenericModelEngineSupported("manual_quote")).toBe(false);
  });
});

describe("validateGenericPlan", () => {
  it("hourly_by_area: rejects a missing required hourly rate", () => {
    expect(validateGenericPlan({}, "hourly_by_area")).toContain("Hourly rate must be a positive number.");
  });

  it("hourly_by_area: rejects a negative / zero hourly rate", () => {
    expect(validateGenericPlan({ hourlyRate: -5 }, "hourly_by_area").length).toBeGreaterThan(0);
    expect(validateGenericPlan({ hourlyRate: 0 }, "hourly_by_area").length).toBeGreaterThan(0);
  });

  it("hourly_by_area: accepts a valid plan draft (with optional start adjustment)", () => {
    expect(validateGenericPlan({ hourlyRate: 410, startAdjustmentHours: -0.25 }, "hourly_by_area")).toEqual([]);
    expect(validateGenericPlan({ hourlyRate: 410 }, "hourly_by_area")).toEqual([]);
  });

  it("hourly_by_area: range-checks optional fields only when present", () => {
    expect(validateGenericPlan({ hourlyRate: 410, startAdjustmentHours: 99 }, "hourly_by_area")).toContain(
      "Start adjustment (hours) must be between -24 and 24.",
    );
    expect(validateGenericPlan({ hourlyRate: 410, minimumPriceExclVat: -1 }, "hourly_by_area")).toContain(
      "Minimum price must be zero or greater.",
    );
    // A negative fixed adjustment models a discount → allowed.
    expect(validateGenericPlan({ hourlyRate: 410, fixedAdjustmentExclVat: -102.5 }, "hourly_by_area")).toEqual([]);
  });

  it("sqm_fixed: rejects a missing / non-positive price per m²", () => {
    expect(validateGenericPlan({}, "sqm_fixed")).toContain("Price per m² must be a positive number.");
    expect(validateGenericPlan({ pricePerSqmExclVat: 0 }, "sqm_fixed").length).toBeGreaterThan(0);
    expect(validateGenericPlan({ pricePerSqmExclVat: -3 }, "sqm_fixed").length).toBeGreaterThan(0);
  });

  it("sqm_fixed: accepts a valid plan draft", () => {
    expect(validateGenericPlan({ pricePerSqmExclVat: 48 }, "sqm_fixed")).toEqual([]);
    expect(
      validateGenericPlan({ pricePerSqmExclVat: 48, fixedAdjustmentExclVat: 250, minimumPriceExclVat: 1500 }, "sqm_fixed"),
    ).toEqual([]);
  });

  it("manual_quote: always valid (no automatic pricing fields required)", () => {
    expect(validateGenericPlan({}, "manual_quote")).toEqual([]);
  });

  it("unit_based / fixed_package: flagged as not auto-priceable yet (no silent 'valid')", () => {
    expect(validateGenericPlan({}, "unit_based")).toEqual([
      'Pricing model "unit_based" cannot be priced automatically yet.',
    ]);
    expect(validateGenericPlan({}, "fixed_package")).toEqual([
      'Pricing model "fixed_package" cannot be priced automatically yet.',
    ]);
  });
});
