import { describe, expect, it } from "vitest";

import {
  computeServiceReadiness,
  defaultSettingsForGenericModel,
  GENERIC_PRICING_MODEL_OPTIONS,
  GENERIC_PRICING_MODEL_SUMMARIES,
  isSupportedPricingModel,
  SELECTABLE_PRICING_MODELS,
  validateNewPlan,
  validateNewService,
  type CalculatorServiceConfig,
  type CleaningPlanConfig,
  type PricingRuleConfig,
} from "./calculatorConfigAdmin";
import { GENERIC_PRICING_MODELS, type GenericPricingModel } from "./v2/pricingModel";

function makeService(over: Partial<CalculatorServiceConfig> = {}): CalculatorServiceConfig {
  const requiresCleaningPlan = over.requiresCleaningPlan ?? true;
  return {
    id: "svc-1",
    legacyId: "svc_legacy_1",
    serviceKey: "home_cleaning",
    displayName: "Hemstädning",
    description: null,
    enabled: true,
    comingSoon: false,
    pricingModel: "home_cleaning_recommended_hours",
    sortOrder: 1,
    requiresCleaningPlan,
    plansEnabled: requiresCleaningPlan,
    planPricingModel: "hourly_rate_by_plan",
    defaultPlanKey: null,
    baseHourlyRateExclVat: null,
    defaultVatRatePercent: 25,
    questions: [
      {
        legacyId: "q1",
        serviceId: "svc-1",
        serviceLegacyId: "svc_legacy_1",
        questionKey: "sqm",
        label: "Boyta",
        helpText: null,
        inputType: "number",
        required: true,
        affectsPricing: true,
        sortOrder: 1,
        active: true,
        options: [],
      },
    ],
    ...over,
  };
}

function makeRule(over: Partial<PricingRuleConfig> = {}): PricingRuleConfig {
  return {
    legacyId: "rule_1",
    serviceId: "svc-1",
    ruleKey: "base_hours",
    ruleType: "numeric_factor",
    valueNumeric: 1.5,
    active: true,
    sortOrder: 1,
    ...over,
  };
}

function makePlan(over: Partial<CleaningPlanConfig> = {}): CleaningPlanConfig {
  return {
    legacyId: "plan_flexible",
    serviceId: "svc-1",
    serviceLegacyId: "svc_legacy_1",
    serviceKey: "home_cleaning",
    planKey: "flexible",
    name: "Flexibel",
    description: null,
    hourlyRate: 349,
    vatRatePercent: 25,
    priceAdjustmentType: "fixed_amount",
    priceAdjustmentValue: 0,
    rutEligible: true,
    rutEnabled: true,
    rutPercent: 50,
    rutApplyTo: "total_customer_price",
    showRutBreakdown: true,
    flexibilityLevel: null,
    customerDayTimeControl: null,
    sameStaffPreferenceLevel: null,
    bookingPriority: null,
    cancellationTermsSummary: null,
    isDefault: true,
    active: true,
    sortOrder: 1,
    ...over,
  };
}

describe("validateNewPlan", () => {
  it("accepts a valid plan", () => {
    expect(validateNewPlan({ planKey: "premium", name: "Premium", hourlyRate: 499 }, ["flexible"])).toEqual([]);
  });
  it("rejects a bad key, duplicate key, missing name and non-positive rate", () => {
    expect(validateNewPlan({ planKey: "", name: "", hourlyRate: 0 }, [])).toEqual([
      "Plan key is required.",
      "Plan name is required.",
      "Hourly rate must be a positive number.",
    ]);
    expect(validateNewPlan({ planKey: "Bad Key", name: "X", hourlyRate: 1 }, [])[0]).toMatch(/lowercase letters/);
    expect(validateNewPlan({ planKey: "flexible", name: "X", hourlyRate: 1 }, ["flexible"])[0]).toMatch(
      /already used/,
    );
    expect(validateNewPlan({ planKey: "x", name: "X", hourlyRate: null }, [])).toContain(
      "Hourly rate must be a positive number.",
    );
  });
});

describe("validateNewPlan (GPM-4c-1: model-aware create-plan)", () => {
  it("accepts a valid hourly_by_area plan (hourly rate required)", () => {
    expect(
      validateNewPlan({ planKey: "premium", name: "Premium", pricingModel: "hourly_by_area", hourlyRate: 499 }, []),
    ).toEqual([]);
  });

  it("rejects a missing/zero/negative hourly rate for hourly_by_area", () => {
    for (const rate of [0, -5, null]) {
      expect(
        validateNewPlan({ planKey: "premium", name: "Premium", pricingModel: "hourly_by_area", hourlyRate: rate }, []),
      ).toContain("Hourly rate must be a positive number.");
    }
    // Omitting the rate entirely is also a missing required field.
    expect(
      validateNewPlan({ planKey: "premium", name: "Premium", pricingModel: "hourly_by_area" }, []),
    ).toContain("Hourly rate must be a positive number.");
  });

  it("accepts a valid sqm_fixed plan (price per m² required, no hourly rate needed)", () => {
    expect(
      validateNewPlan(
        { planKey: "normal", name: "Normalt skick", pricingModel: "sqm_fixed", pricePerSqmExclVat: 48 },
        [],
      ),
    ).toEqual([]);
  });

  it("rejects a missing/zero/negative price per m² for sqm_fixed", () => {
    for (const price of [0, -1]) {
      expect(
        validateNewPlan({ planKey: "normal", name: "Normal", pricingModel: "sqm_fixed", pricePerSqmExclVat: price }, []),
      ).toContain("Price per m² must be a positive number.");
    }
    expect(
      validateNewPlan({ planKey: "normal", name: "Normal", pricingModel: "sqm_fixed" }, []),
    ).toContain("Price per m² must be a positive number.");
  });

  it("accepts optional sqm_fixed adjustments (signed flat, non-negative floor) and range-checks them", () => {
    // A negative fixed adjustment (a discount) is allowed; a negative floor is not.
    expect(
      validateNewPlan(
        {
          planKey: "normal",
          name: "Normal",
          pricingModel: "sqm_fixed",
          pricePerSqmExclVat: 48,
          fixedAdjustmentExclVat: -100,
          minimumPriceExclVat: 1500,
        },
        [],
      ),
    ).toEqual([]);
    expect(
      validateNewPlan(
        { planKey: "normal", name: "Normal", pricingModel: "sqm_fixed", pricePerSqmExclVat: 48, minimumPriceExclVat: -1 },
        [],
      ),
    ).toContain("Minimum price must be zero or greater.");
  });

  it.each([["unit_based"], ["fixed_package"], ["manual_quote"]])(
    "rejects create-plan for the reserved %s model (not engine-supported yet)",
    (model) => {
      const errors = validateNewPlan(
        {
          planKey: "valid_key",
          name: "Valid",
          pricingModel: model as GenericPricingModel,
          hourlyRate: 499,
          pricePerSqmExclVat: 48,
        },
        [],
      );
      expect(errors).toContain(`Plan creation is not available for the "${model}" pricing model yet.`);
      // A reserved model must not also leak hourly/sqm pricing-field problems.
      expect(errors.some((e) => /Hourly rate|Price per m²/.test(e))).toBe(false);
    },
  );

  it("still blocks an invalid plan key and a duplicate key for a generic model", () => {
    expect(
      validateNewPlan({ planKey: "Bad Key", name: "X", pricingModel: "hourly_by_area", hourlyRate: 1 }, [])[0],
    ).toMatch(/lowercase letters/);
    expect(
      validateNewPlan(
        { planKey: "flexible", name: "X", pricingModel: "sqm_fixed", pricePerSqmExclVat: 48 },
        ["flexible"],
      )[0],
    ).toMatch(/already used/);
  });
});

describe("validateNewService (GPM-3a: generic-only)", () => {
  it("accepts a valid service with a generic pricing model", () => {
    expect(
      validateNewService({ serviceKey: "garden_care", displayName: "Trädgård", pricingModel: "hourly_by_area" }, [
        "home_cleaning",
      ]),
    ).toEqual([]);
  });

  it("accepts every generic pricing model", () => {
    for (const model of GENERIC_PRICING_MODELS) {
      expect(
        validateNewService({ serviceKey: "new_service", displayName: "Ny tjänst", pricingModel: model }, []),
      ).toEqual([]);
    }
  });

  it("rejects every LEGACY service-named pricing model for a new service", () => {
    const legacyModels = [
      "home_cleaning_recommended_hours",
      "move_out_fixed_plus_addons",
      "office_cleaning_recurring_area_frequency",
      "window_cleaning_count_based",
      "deep_cleaning_area_addons",
      "deep_cleaning_area_based",
      "stairwell_cleaning_floors_frequency",
      "inquiry_only_no_price",
    ];
    for (const model of legacyModels) {
      expect(
        validateNewService({ serviceKey: "new_service", displayName: "Ny tjänst", pricingModel: model }, []),
      ).toContain("A valid pricing model is required.");
    }
  });

  it("rejects bad key, missing name and an unknown model", () => {
    expect(validateNewService({ serviceKey: "", displayName: "", pricingModel: "nope" }, [])).toEqual([
      "Service key is required.",
      "Display name is required.",
      "A valid pricing model is required.",
    ]);
  });

  it("rejects a non-machine service key and a duplicate key (with a valid generic model)", () => {
    expect(
      validateNewService({ serviceKey: "Bad Key", displayName: "X", pricingModel: "sqm_fixed" }, [])[0],
    ).toMatch(/lowercase letters/);
    expect(
      validateNewService({ serviceKey: "home_cleaning", displayName: "X", pricingModel: "hourly_by_area" }, [
        "home_cleaning",
      ])[0],
    ).toMatch(/already used/);
  });
});

describe("defaultSettingsForGenericModel (GPM-3a)", () => {
  it("hourly_by_area: recurring sqm cleaning that requires a plan", () => {
    expect(defaultSettingsForGenericModel("hourly_by_area")).toEqual({
      primaryInput: "sqm",
      unitLabel: "m²",
      bookingMode: "recurring",
      publicLayout: "recurring_cleaning",
      displayRoundingInterval: null,
      requiresCleaningPlan: true,
    });
  });

  it("sqm_fixed: one-off sqm pricing that requires a plan", () => {
    expect(defaultSettingsForGenericModel("sqm_fixed")).toEqual({
      primaryInput: "sqm",
      unitLabel: "m²",
      bookingMode: "one_off",
      publicLayout: "one_off_cleaning",
      displayRoundingInterval: null,
      requiresCleaningPlan: true,
    });
  });

  it("unit_based: one-off quantity pricing", () => {
    expect(defaultSettingsForGenericModel("unit_based")).toEqual({
      primaryInput: "quantity",
      unitLabel: "st",
      bookingMode: "one_off",
      publicLayout: "one_off_cleaning",
      displayRoundingInterval: null,
      requiresCleaningPlan: true,
    });
  });

  it("fixed_package: one-off package with no primary unit", () => {
    expect(defaultSettingsForGenericModel("fixed_package")).toEqual({
      primaryInput: "none",
      bookingMode: "one_off",
      publicLayout: "one_off_cleaning",
      displayRoundingInterval: null,
      requiresCleaningPlan: true,
    });
  });

  it("manual_quote: no automatic price and no cleaning plan", () => {
    expect(defaultSettingsForGenericModel("manual_quote")).toEqual({
      automaticPricing: false,
      bookingMode: "one_off",
      publicLayout: "one_off_cleaning",
      displayRoundingInterval: null,
      requiresCleaningPlan: false,
    });
  });

  it("never enables or publishes a service on its own (presentation defaults only)", () => {
    for (const model of GENERIC_PRICING_MODELS) {
      const s = defaultSettingsForGenericModel(model);
      expect(s).not.toHaveProperty("enabled");
      expect(s).not.toHaveProperty("public");
      expect(s).not.toHaveProperty("comingSoon");
    }
  });
});

describe("isSupportedPricingModel / SELECTABLE_PRICING_MODELS", () => {
  it("the three engine models are supported (home, move-out, office)", () => {
    expect(isSupportedPricingModel("home_cleaning_recommended_hours")).toBe(true);
    expect(isSupportedPricingModel("move_out_fixed_plus_addons")).toBe(true);
    // Slice 12E: office cleaning is now engine-backed (recurring monthly model).
    expect(isSupportedPricingModel("office_cleaning_recurring_area_frequency")).toBe(true);
    // The remaining template identifiers are still unimplemented.
    expect(isSupportedPricingModel("window_cleaning_count_based")).toBe(false);
  });
  it("exposes exactly three engine-backed (supported) options", () => {
    expect(SELECTABLE_PRICING_MODELS.filter((m) => m.supported).map((m) => m.value)).toEqual([
      "home_cleaning_recommended_hours",
      "move_out_fixed_plus_addons",
      "office_cleaning_recurring_area_frequency",
    ]);
    // GPM-1: 4 legacy template identifiers + 5 generic models, none engine-backed yet.
    expect(SELECTABLE_PRICING_MODELS.filter((m) => !m.supported)).toHaveLength(9);
  });

  it("GPM-1: offers the five generic pricing models, flagged non-legacy", () => {
    const generic = SELECTABLE_PRICING_MODELS.filter((m) => m.legacy === false);
    expect(generic.map((m) => m.value)).toEqual([
      "hourly_by_area",
      "sqm_fixed",
      "unit_based",
      "fixed_package",
      "manual_quote",
    ]);
    // Every service-named model is flagged legacy (incl. the engine-backed ones).
    const legacyValues = SELECTABLE_PRICING_MODELS.filter((m) => m.legacy === true).map((m) => m.value);
    expect(legacyValues).toContain("home_cleaning_recommended_hours");
    expect(legacyValues).toContain("office_cleaning_recurring_area_frequency");
    expect(legacyValues).toContain("move_out_fixed_plus_addons");
  });
});

describe("GENERIC_PRICING_MODEL_OPTIONS / GENERIC_PRICING_MODEL_SUMMARIES (GPM-3b)", () => {
  it("offers exactly the five generic models, in canonical order, none flagged legacy", () => {
    expect(GENERIC_PRICING_MODEL_OPTIONS.map((m) => m.value)).toEqual([...GENERIC_PRICING_MODELS]);
    expect(GENERIC_PRICING_MODEL_OPTIONS.every((m) => m.legacy === false)).toBe(true);
  });

  it("never offers a legacy/service-named model for new-service creation", () => {
    const values = GENERIC_PRICING_MODEL_OPTIONS.map((m) => m.value);
    expect(values).not.toContain("home_cleaning_recommended_hours");
    expect(values).not.toContain("move_out_fixed_plus_addons");
    expect(values).not.toContain("office_cleaning_recurring_area_frequency");
    expect(values).not.toContain("window_cleaning_count_based");
  });

  it("exposes a preview for every generic model with non-empty copy", () => {
    for (const model of GENERIC_PRICING_MODELS) {
      const summary = GENERIC_PRICING_MODEL_SUMMARIES[model];
      expect(summary.label.length).toBeGreaterThan(0);
      expect(summary.primaryInput.length).toBeGreaterThan(0);
      expect(summary.pricing.length).toBeGreaterThan(0);
      expect(summary.typicalUse.length).toBeGreaterThan(0);
    }
  });

  it("summarises hourly_by_area as area-driven hourly pricing", () => {
    expect(GENERIC_PRICING_MODEL_SUMMARIES.hourly_by_area).toEqual({
      label: "Hourly by area",
      primaryInput: "Area (m²)",
      pricing: "Estimated hours × plan hourly rate",
      typicalUse: "Home, Office, Deep cleaning",
    });
  });

  it("summarises manual_quote as having no automatic price", () => {
    expect(GENERIC_PRICING_MODEL_SUMMARIES.manual_quote.pricing).toMatch(/no automatic price/i);
  });
});

describe("computeServiceReadiness", () => {
  it("ready: supported model + active questions + active rules + plan ok + enabled", () => {
    const r = computeServiceReadiness(makeService(), [makeRule()], [makePlan()]);
    expect(r.status).toBe("ready");
    expect(r.publicReady).toBe(true);
    expect(r.reasons).toEqual([]);
  });

  it("draft: complete + supported but not enabled", () => {
    const r = computeServiceReadiness(makeService({ enabled: false }), [makeRule()], [makePlan()]);
    expect(r.status).toBe("draft");
    expect(r.publicReady).toBe(true);
  });

  it("unsupported_pricing: template model never public-ready", () => {
    const r = computeServiceReadiness(
      // window_cleaning_count_based is still an unimplemented template model.
      makeService({ pricingModel: "window_cleaning_count_based", enabled: false }),
      [makeRule()],
      [makePlan()],
    );
    expect(r.status).toBe("unsupported_pricing");
    expect(r.publicReady).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/not implemented/);
  });

  it("missing_fields: no active questions", () => {
    const r = computeServiceReadiness(makeService({ questions: [] }), [makeRule()], [makePlan()]);
    expect(r.status).toBe("missing_fields");
    expect(r.publicReady).toBe(false);
  });

  it("missing_pricing: no active rules", () => {
    const r = computeServiceReadiness(makeService(), [], [makePlan()]);
    expect(r.status).toBe("missing_pricing");
    expect(r.publicReady).toBe(false);
  });

  it("missing_pricing: requires a plan but none is active", () => {
    const r = computeServiceReadiness(makeService(), [makeRule()], [makePlan({ active: false })]);
    expect(r.status).toBe("missing_pricing");
    expect(r.publicReady).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/active cleaning plan/);
  });

  it("a service that does not require a plan is fine with no plans", () => {
    const r = computeServiceReadiness(
      makeService({ requiresCleaningPlan: false, pricingModel: "move_out_fixed_plus_addons" }),
      [makeRule()],
      [],
    );
    expect(r.status).toBe("ready");
    expect(r.publicReady).toBe(true);
  });

  // ── Slice 12F: office requires hourly_rate AND supervision_start_minutes ──────
  function officeService(over: Partial<CalculatorServiceConfig> = {}): CalculatorServiceConfig {
    return makeService({
      serviceKey: "office_cleaning",
      displayName: "Kontorsstädning",
      pricingModel: "office_cleaning_recurring_area_frequency",
      requiresCleaningPlan: false,
      ...over,
    });
  }
  const officeRateRule = makeRule({ legacyId: "r_rate", ruleKey: "hourly_rate", valueNumeric: 459 });
  const officeSupervisionRule = makeRule({
    legacyId: "r_sup",
    ruleKey: "supervision_start_minutes",
    ruleType: "threshold",
    valueNumeric: 15,
  });

  it("office is Ready with its required rules (hourly_rate + supervision_start_minutes)", () => {
    const r = computeServiceReadiness(officeService(), [officeRateRule, officeSupervisionRule], []);
    expect(r.status).toBe("ready");
    expect(r.publicReady).toBe(true);
    expect(r.reasons).toEqual([]);
  });

  it("office is Missing pricing when the supervision_start_minutes rule is absent", () => {
    const r = computeServiceReadiness(officeService(), [officeRateRule], []);
    expect(r.status).toBe("missing_pricing");
    expect(r.publicReady).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/supervision_start_minutes/);
  });
});

// ── GPM-6-R: literal generic sqm_fixed readiness (plan-priced, not rule-priced) ──

describe("computeServiceReadiness — literal generic sqm_fixed (GPM-6-R)", () => {
  const SQM_KEY = "moveout_generic";

  function sqmService(over: Partial<CalculatorServiceConfig> = {}): CalculatorServiceConfig {
    // makeService() seeds one active "sqm" question (the m² primary input).
    return makeService({ serviceKey: SQM_KEY, displayName: "Flyttstädning", pricingModel: "sqm_fixed", ...over });
  }

  function sqmPlan(over: Partial<CleaningPlanConfig> = {}): CleaningPlanConfig {
    return makePlan({
      serviceKey: SQM_KEY,
      planKey: "normal",
      name: "Normalt skick",
      pricePerSqmExclVat: 48,
      isDefault: true,
      active: true,
      ...over,
    });
  }

  it("Ready with an active plan + positive price/m² — NO unsupported badge, NO pricing-rule requirement", () => {
    // Note: ZERO pricing rules passed — sqm_fixed is priced by the plan's price/m².
    const r = computeServiceReadiness(sqmService(), [], [sqmPlan()]);
    expect(r.status).toBe("ready");
    expect(r.publicReady).toBe(true);
    expect(r.reasons).toEqual([]);
    expect(r.reasons.join(" ")).not.toMatch(/not implemented/i);
    expect(r.reasons.join(" ")).not.toMatch(/pricing rule/i);
  });

  it("is NEVER 'unsupported_pricing' for literal sqm_fixed, even with no rules at all", () => {
    const r = computeServiceReadiness(sqmService(), [], [sqmPlan()]);
    expect(r.status).not.toBe("unsupported_pricing");
  });

  it("Draft when complete but not enabled", () => {
    const r = computeServiceReadiness(sqmService({ enabled: false }), [], [sqmPlan()]);
    expect(r.status).toBe("draft");
    expect(r.publicReady).toBe(true);
  });

  it("missing_pricing (NOT unsupported) with a missing-plan reason when no plan is active", () => {
    const r = computeServiceReadiness(sqmService(), [], [sqmPlan({ active: false })]);
    expect(r.status).toBe("missing_pricing");
    expect(r.publicReady).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/active cleaning plan/i);
    expect(r.reasons.join(" ")).not.toMatch(/not implemented/i);
    expect(r.reasons.join(" ")).not.toMatch(/pricing rule/i);
  });

  it("missing_pricing with a clear price/m² reason when the active plan has no positive price/m²", () => {
    for (const price of [null, 0, -2] as const) {
      const r = computeServiceReadiness(sqmService(), [], [sqmPlan({ pricePerSqmExclVat: price })]);
      expect(r.status).toBe("missing_pricing");
      expect(r.publicReady).toBe(false);
      expect(r.reasons.join(" ")).toMatch(/price per m²/i);
    }
  });

  it("missing_fields when there is no active question (the m² primary input)", () => {
    const r = computeServiceReadiness(sqmService({ questions: [] }), [], [sqmPlan()]);
    expect(r.status).toBe("missing_fields");
    expect(r.publicReady).toBe(false);
  });

  // GPM-7: the runtime prices ONLY from answers.sqm, so readiness requires the sqm
  // PRIMARY INPUT specifically — not just any active question (Admin↔runtime parity).
  it("missing_fields (NOT ready) when the only active question is NOT the sqm primary input", () => {
    const nonSqm = { ...makeService().questions[0], legacyId: "q_rooms", questionKey: "rooms", label: "Antal rum" };
    const r = computeServiceReadiness(sqmService({ questions: [nonSqm] }), [], [sqmPlan()]);
    expect(r.status).toBe("missing_fields");
    expect(r.publicReady).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/area \(m²\)/i);
  });

  it("missing_fields when the sqm primary input exists but is archived (inactive)", () => {
    const archivedSqm = { ...makeService().questions[0], active: false };
    const r = computeServiceReadiness(sqmService({ questions: [archivedSqm] }), [], [sqmPlan()]);
    expect(r.status).toBe("missing_fields");
    expect(r.publicReady).toBe(false);
  });

  it("names the area (m²) input as the missing setup step (not a generic 'No active questions')", () => {
    const r = computeServiceReadiness(sqmService({ questions: [] }), [], [sqmPlan()]);
    expect(r.reasons.join(" ")).toMatch(/area \(m²\)/i);
    expect(r.reasons.join(" ")).not.toMatch(/no active questions/i);
  });

  it("reaches Ready (still hidden as Draft until enabled) once the sqm input + priced plan exist", () => {
    // Adding the canonical sqm input to a draft service makes it READY-eligible, but it
    // stays a Draft (not public) until the admin explicitly enables it — readiness and
    // publishing are separate.
    const draft = computeServiceReadiness(sqmService({ enabled: false }), [], [sqmPlan()]);
    expect(draft.status).toBe("draft");
    expect(draft.publicReady).toBe(true);
    expect(draft.reasons).toEqual([]);
  });

  it("never requires legacy pricing rules: Ready whether rules are absent or unrelated rules exist", () => {
    const withoutRules = computeServiceReadiness(sqmService(), [], [sqmPlan()]);
    const withUnrelatedRule = computeServiceReadiness(sqmService(), [makeRule({ serviceId: "svc-1" })], [sqmPlan()]);
    expect(withoutRules.status).toBe("ready");
    expect(withUnrelatedRule.status).toBe("ready");
  });

  it("reserved / not-yet-engine generic models stay 'unsupported_pricing'", () => {
    for (const model of ["hourly_by_area", "unit_based", "fixed_package", "manual_quote"]) {
      const r = computeServiceReadiness(sqmService({ pricingModel: model }), [], [sqmPlan()]);
      expect(r.status).toBe("unsupported_pricing");
      expect(r.publicReady).toBe(false);
      expect(r.reasons.join(" ")).toMatch(/not implemented/i);
    }
  });

  it("legacy move_out_fixed_plus_addons keeps its rule-based path (NOT the literal sqm_fixed branch)", () => {
    const base = makeService({
      serviceKey: "move_out_cleaning",
      pricingModel: "move_out_fixed_plus_addons",
      requiresCleaningPlan: false,
    });
    // Ready with an active rule (unchanged legacy behaviour)…
    expect(computeServiceReadiness(base, [makeRule()], []).status).toBe("ready");
    // …and STILL missing_pricing without a rule, proving it is not treated like sqm_fixed.
    expect(computeServiceReadiness(base, [], []).status).toBe("missing_pricing");
  });

  // GPM-10-B: plan-level RUT is a deduction CAPABILITY, never a readiness/enable gate.
  // Flipping RUT on the priced plan must not change the readiness verdict at all (so it
  // also cannot change the GPM-8 enable/public guard, which derives from readiness).
  it("ignores plan-level RUT settings: readiness is identical whether RUT is on or off", () => {
    const rutOn = computeServiceReadiness(
      sqmService(),
      [],
      [sqmPlan({ rutEligible: true, rutEnabled: true, rutPercent: 50, showRutBreakdown: true })],
    );
    const rutOff = computeServiceReadiness(
      sqmService(),
      [],
      [sqmPlan({ rutEligible: false, rutEnabled: false, rutPercent: 0, showRutBreakdown: false })],
    );
    expect(rutOn.status).toBe("ready");
    expect(rutOn).toEqual(rutOff);
  });
});
