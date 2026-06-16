import { describe, expect, it } from "vitest";

import {
  genericServicePlanInfo,
  planEditorLane,
  SUPPORTED_PLAN_EDITOR_SERVICE_KEYS,
  type PlanEditorLane,
} from "./cleaningPlansPresentation";
import { GENERIC_PRICING_MODELS, LEGACY_PRICING_MODELS } from "@/lib/calculator/v2/pricingModel";

/** Minimal lane input — only serviceKey + pricingModel are read. */
function laneInput(serviceKey: string, pricingModel: string) {
  return { serviceKey, pricingModel };
}

describe("planEditorLane", () => {
  it("routes the bespoke Home/Office editors to the supported_editor lane", () => {
    // Regardless of their (legacy) pricing model, Home + Office keep their editors.
    expect(planEditorLane(laneInput("home_cleaning", "home_cleaning_recommended_hours"))).toBe(
      "supported_editor",
    );
    expect(
      planEditorLane(laneInput("office_cleaning", "office_cleaning_recurring_area_frequency")),
    ).toBe("supported_editor");
  });

  it("exposes exactly Home + Office as the supported-editor keys", () => {
    expect([...SUPPORTED_PLAN_EDITOR_SERVICE_KEYS]).toEqual(["home_cleaning", "office_cleaning"]);
  });

  it.each(GENERIC_PRICING_MODELS)(
    "routes an admin-created generic-model service (%s) to the generic builder lane",
    (model) => {
      expect(planEditorLane(laneInput("my_new_service", model))).toBe("generic");
    },
  );

  it.each(
    // Office's legacy model is excluded — it is matched by key, not by model.
    LEGACY_PRICING_MODELS.filter((m) => m !== "office_cleaning_recurring_area_frequency"),
  )("routes a seeded legacy-model service (%s) to the legacy lane", (model) => {
    expect(planEditorLane(laneInput("move_out_cleaning", model))).toBe("legacy");
  });

  it("treats an unknown/blank pricing model on a non-Home/Office service as generic (never legacy)", () => {
    expect(planEditorLane(laneInput("brand_new", ""))).toBe<PlanEditorLane>("generic");
    expect(planEditorLane(laneInput("brand_new", "something_unrecognised"))).toBe<PlanEditorLane>(
      "generic",
    );
  });
});

describe("genericServicePlanInfo", () => {
  it("describes hourly_by_area as an m² + engine-supported model", () => {
    const info = genericServicePlanInfo({ pricingModel: "hourly_by_area" });
    expect(info).toMatchObject({
      model: "hourly_by_area",
      primaryInput: "sqm",
      engineSupported: true,
      modelLabel: "Hourly by area",
      primaryInputLabel: "m²",
    });
  });

  it("describes sqm_fixed as an m² + engine-supported model", () => {
    const info = genericServicePlanInfo({ pricingModel: "sqm_fixed" });
    expect(info).toMatchObject({
      model: "sqm_fixed",
      primaryInput: "sqm",
      engineSupported: true,
      modelLabel: "Fixed price per m²",
      primaryInputLabel: "m²",
    });
  });

  it("describes unit_based as a quantity model that is NOT engine-supported yet", () => {
    const info = genericServicePlanInfo({ pricingModel: "unit_based" });
    expect(info).toMatchObject({
      model: "unit_based",
      primaryInput: "quantity",
      engineSupported: false,
      modelLabel: "Unit based",
      primaryInputLabel: "Quantity",
    });
  });

  it("describes fixed_package as a no-input model that is NOT engine-supported yet", () => {
    const info = genericServicePlanInfo({ pricingModel: "fixed_package" });
    expect(info).toMatchObject({
      model: "fixed_package",
      primaryInput: "none",
      engineSupported: false,
      modelLabel: "Fixed package",
      primaryInputLabel: "No customer input",
    });
  });

  it("describes manual_quote as a no-input model that is NOT engine-supported", () => {
    const info = genericServicePlanInfo({ pricingModel: "manual_quote" });
    expect(info).toMatchObject({
      model: "manual_quote",
      primaryInput: "none",
      engineSupported: false,
      modelLabel: "Manual quote",
      primaryInputLabel: "No customer input",
    });
  });

  it("normalises an unknown pricing model to the manual_quote fallback (never auto-priceable)", () => {
    const info = genericServicePlanInfo({ pricingModel: "totally_unknown" });
    expect(info.model).toBe("manual_quote");
    expect(info.engineSupported).toBe(false);
  });

  it("is exhaustive: every generic model resolves to a non-empty label", () => {
    for (const model of GENERIC_PRICING_MODELS) {
      const info = genericServicePlanInfo({ pricingModel: model });
      expect(info.model).toBe(model);
      expect(info.modelLabel.length).toBeGreaterThan(0);
      expect(info.primaryInputLabel.length).toBeGreaterThan(0);
    }
  });
});
