import { describe, expect, it } from "vitest";

import {
  assessGenericServiceClientReadiness,
  type GenericServiceReadinessInput,
} from "./genericServiceReadiness";
import { type PublicService } from "./publicCalculatorClient";

/**
 * Unit tests for the GPM-5c-3 client-side generic renderability helper. They pin
 * the exact decision contract the public page will rely on in a later rendering
 * slice: a structured `canRender` + `reason` for every path, with NO silent
 * fallback and no way to fabricate a renderable service from missing/invalid
 * metadata. The helper reads ONLY already-normalized public fields and never
 * prices, routes, or touches the network.
 */

/** Builds a readiness input from the four normalized fields (all overridable). */
function input(overrides: Partial<GenericServiceReadinessInput> = {}): GenericServiceReadinessInput {
  return {
    genericPricingModel: "sqm_fixed",
    engineSupported: true,
    primaryInput: "sqm",
    unitLabel: "m²",
    ...overrides,
  };
}

describe("assessGenericServiceClientReadiness", () => {
  it("renders a complete engine-supported sqm_fixed service (sqm + m²)", () => {
    expect(
      assessGenericServiceClientReadiness({
        genericPricingModel: "sqm_fixed",
        engineSupported: true,
        primaryInput: "sqm",
        unitLabel: "m²",
      }),
    ).toEqual({ canRender: true, reason: "supported" });
  });

  it("refuses a legacy/Home service with no generic model (not_generic)", () => {
    // The server reports null for a legacy service-named model (never alias-resolved).
    expect(
      assessGenericServiceClientReadiness({
        genericPricingModel: null,
        engineSupported: false,
        primaryInput: null,
        unitLabel: null,
      }),
    ).toEqual({ canRender: false, reason: "not_generic" });
  });

  it("treats an empty/whitespace generic model as not_generic (defensive)", () => {
    expect(assessGenericServiceClientReadiness(input({ genericPricingModel: "" }))).toEqual({
      canRender: false,
      reason: "not_generic",
    });
    expect(assessGenericServiceClientReadiness(input({ genericPricingModel: "   " }))).toEqual({
      canRender: false,
      reason: "not_generic",
    });
  });

  it("refuses hourly_by_area — a valid generic model the client cannot render yet (engine_not_supported)", () => {
    expect(
      assessGenericServiceClientReadiness({
        genericPricingModel: "hourly_by_area",
        engineSupported: false,
        primaryInput: "sqm",
        unitLabel: "m²",
      }),
    ).toEqual({ canRender: false, reason: "engine_not_supported" });
  });

  it("refuses an unknown/unsupported generic model (engine_not_supported)", () => {
    expect(
      assessGenericServiceClientReadiness({
        genericPricingModel: "totally_bogus_model",
        engineSupported: false,
        primaryInput: "sqm",
        unitLabel: "m²",
      }),
    ).toEqual({ canRender: false, reason: "engine_not_supported" });
  });

  it("refuses even sqm_fixed when the server marks it engineSupported=false (no silent fallback)", () => {
    // The client trusts the server's flag — it never re-derives true from the model name.
    expect(assessGenericServiceClientReadiness(input({ engineSupported: false }))).toEqual({
      canRender: false,
      reason: "engine_not_supported",
    });
  });

  it("refuses an engine-supported model that is not the renderable sqm_fixed (future-widening guard)", () => {
    // If a later server slice widens engineSupported to another model, the client must
    // still refuse to render it until it has a real input/price flow for that model.
    expect(
      assessGenericServiceClientReadiness({
        genericPricingModel: "hourly_by_area",
        engineSupported: true,
        primaryInput: "sqm",
        unitLabel: "m²",
      }),
    ).toEqual({ canRender: false, reason: "engine_not_supported" });
  });

  it("refuses an engine-supported sqm_fixed service missing its primary input (missing_primary_input)", () => {
    expect(assessGenericServiceClientReadiness(input({ primaryInput: null }))).toEqual({
      canRender: false,
      reason: "missing_primary_input",
    });
  });

  it("refuses an engine-supported sqm_fixed service with an invalid primary input (invalid_primary_input)", () => {
    expect(assessGenericServiceClientReadiness(input({ primaryInput: "square_meters" }))).toEqual({
      canRender: false,
      reason: "invalid_primary_input",
    });
  });

  it("refuses an engine-supported sqm_fixed service missing its unit label (missing_unit_label)", () => {
    expect(assessGenericServiceClientReadiness(input({ unitLabel: null }))).toEqual({
      canRender: false,
      reason: "missing_unit_label",
    });
    // An empty/whitespace label is treated as missing (defensive).
    expect(assessGenericServiceClientReadiness(input({ unitLabel: "   " }))).toEqual({
      canRender: false,
      reason: "missing_unit_label",
    });
  });

  it("checks the gates in priority order: model → engine → input → unit", () => {
    // No generic model wins over every later failure.
    expect(
      assessGenericServiceClientReadiness({
        genericPricingModel: null,
        engineSupported: true,
        primaryInput: null,
        unitLabel: null,
      }).reason,
    ).toBe("not_generic");
    // engine_not_supported wins over a missing primary input / unit label.
    expect(
      assessGenericServiceClientReadiness({
        genericPricingModel: "sqm_fixed",
        engineSupported: false,
        primaryInput: null,
        unitLabel: null,
      }).reason,
    ).toBe("engine_not_supported");
    // A present-but-invalid input is reported before the unit-label gate.
    expect(
      assessGenericServiceClientReadiness(input({ primaryInput: "square_meters", unitLabel: null })).reason,
    ).toBe("invalid_primary_input");
  });

  it("accepts a normalized PublicService shape (structural assignability — compile-time + runtime)", () => {
    // A real normalized PublicService is a valid readiness input: its
    // primaryInput ("sqm" | null) is a subset of the helper's (string | null).
    const service: Pick<
      PublicService,
      "genericPricingModel" | "engineSupported" | "primaryInput" | "unitLabel"
    > = {
      genericPricingModel: "sqm_fixed",
      engineSupported: true,
      primaryInput: "sqm",
      unitLabel: "m²",
    };
    expect(assessGenericServiceClientReadiness(service)).toEqual({ canRender: true, reason: "supported" });
  });
});
