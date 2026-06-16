import { describe, expect, it } from "vitest";

import {
  GENERIC_PRICING_MODELS,
  LEGACY_PRICING_MODELS,
  UNKNOWN_PRICING_MODEL_FALLBACK,
  isEngineSupportedGenericModel,
  pricingBasisForGenericModel,
  resolveGenericPricingModel,
  type GenericPricingModel,
} from "./pricingModel";

/**
 * GPM-1 — generic pricing-model resolver. Locks the legacy → generic aliases and
 * the explicit "unknown is NEVER hourly" fallback, plus the engine-support map the
 * config mapper uses to decide the pricing basis from the model (not serviceKey).
 */

describe("resolveGenericPricingModel — generic models pass through", () => {
  it("returns each generic model unchanged", () => {
    for (const model of GENERIC_PRICING_MODELS) {
      expect(resolveGenericPricingModel(model)).toBe(model);
    }
  });
});

describe("resolveGenericPricingModel — legacy aliases", () => {
  const cases: { legacy: string; generic: GenericPricingModel }[] = [
    { legacy: "home_cleaning_recommended_hours", generic: "hourly_by_area" },
    { legacy: "office_cleaning_recurring_area_frequency", generic: "hourly_by_area" },
    { legacy: "deep_cleaning_area_based", generic: "hourly_by_area" },
    // The live admin catalogue uses the `_addons` spelling — both must resolve.
    { legacy: "deep_cleaning_area_addons", generic: "hourly_by_area" },
    { legacy: "move_out_fixed_plus_addons", generic: "sqm_fixed" },
    { legacy: "window_cleaning_count_based", generic: "unit_based" },
    // Floors/stairwells are counted objects → unit_based (justified in the module).
    { legacy: "stairwell_cleaning_floors_frequency", generic: "unit_based" },
    { legacy: "inquiry_only_no_price", generic: "manual_quote" },
  ];

  for (const { legacy, generic } of cases) {
    it(`maps ${legacy} → ${generic}`, () => {
      expect(resolveGenericPricingModel(legacy)).toBe(generic);
    });
  }

  it("every catalogued legacy model has an alias (no silent gaps)", () => {
    for (const legacy of LEGACY_PRICING_MODELS) {
      const resolved = resolveGenericPricingModel(legacy);
      expect(GENERIC_PRICING_MODELS).toContain(resolved);
    }
  });
});

describe("resolveGenericPricingModel — unknown is explicit and never hourly", () => {
  it("falls back to manual_quote (not hourly) for unknown / missing models", () => {
    expect(UNKNOWN_PRICING_MODEL_FALLBACK).toBe("manual_quote");
    for (const raw of [null, undefined, "", "   ", "garbage", "home", "HOURLY_BY_AREA", "unit"]) {
      const resolved = resolveGenericPricingModel(raw);
      expect(resolved).toBe("manual_quote");
      expect(resolved).not.toBe("hourly_by_area");
    }
  });

  it("trims surrounding whitespace before resolving", () => {
    expect(resolveGenericPricingModel("  home_cleaning_recommended_hours  ")).toBe("hourly_by_area");
    expect(resolveGenericPricingModel("  sqm_fixed ")).toBe("sqm_fixed");
  });
});

describe("pricingBasisForGenericModel — only hourly_by_area / sqm_fixed are engine-priced", () => {
  it("maps the two supported models to their pricing basis", () => {
    expect(pricingBasisForGenericModel("hourly_by_area")).toBe("hourly");
    expect(pricingBasisForGenericModel("sqm_fixed")).toBe("sqm_fixed");
  });

  it("returns null (not hourly) for engine-unsupported models", () => {
    for (const model of ["unit_based", "fixed_package", "manual_quote"] as const) {
      expect(pricingBasisForGenericModel(model)).toBeNull();
    }
  });

  it("isEngineSupportedGenericModel agrees with the basis map", () => {
    expect(isEngineSupportedGenericModel("hourly_by_area")).toBe(true);
    expect(isEngineSupportedGenericModel("sqm_fixed")).toBe(true);
    expect(isEngineSupportedGenericModel("unit_based")).toBe(false);
    expect(isEngineSupportedGenericModel("fixed_package")).toBe(false);
    expect(isEngineSupportedGenericModel("manual_quote")).toBe(false);
  });
});
