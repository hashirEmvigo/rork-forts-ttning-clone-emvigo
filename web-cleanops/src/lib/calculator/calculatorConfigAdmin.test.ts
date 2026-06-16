import { describe, expect, it } from "vitest";

import {
  CALCULATOR_PRICING_RULE_AUDIT_ACTION,
  computeCalculatorConfigHealth,
  mapPlanConfigRow,
  mapPricingRuleRow,
  mapServiceConfigRow,
  parsePricingRuleAuditEvent,
  parseQuestionOptions,
  parseSqmAdjustments,
  summarizeConfigHealth,
  validateNewQuestion,
  validatePricingRuleValue,
  type CalculatorConfig,
  type CalculatorQuestionConfig,
  type CalculatorServiceConfig,
  type CalculatorSettingsConfig,
  type CleaningPlanConfig,
  type PricingRuleConfig,
} from "./calculatorConfigAdmin";

// ── Builders ────────────────────────────────────────────────────────────────

function makeSettings(over: Partial<CalculatorSettingsConfig> = {}): CalculatorSettingsConfig {
  return {
    legacyId: "calc_settings_x",
    companyId: "co-uuid",
    companyLegacyId: "cmp_x",
    enabled: false,
    publicSlug: "rakna-ut-ditt-pris",
    priceDisplayMode: "range",
    showPriceBeforeContact: true,
    requireContactBeforeResult: false,
    showLoginPromptAfterSubmit: true,
    quoteValidityDays: 30,
    manualReviewThresholdAmount: null,
    currency: "SEK",
    rutDisplayMode: "none",
    defaultVatRatePercent: 25,
    autoCreateProspect: true,
    autoCreateQuoteRequest: true,
    defaultQuoteStatus: "submitted",
    ...over,
  };
}

function makeQuestion(over: Partial<CalculatorQuestionConfig> = {}): CalculatorQuestionConfig {
  return {
    legacyId: "q1",
    serviceId: "svc-1",
    serviceLegacyId: "svc_legacy_1",
    questionKey: "sqm",
    label: "Boyta (m²)",
    helpText: null,
    inputType: "integer",
    required: true,
    affectsPricing: true,
    sortOrder: 1,
    active: true,
    options: [],
    ...over,
  };
}

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
    questions: [makeQuestion()],
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

function makeRule(over: Partial<PricingRuleConfig> = {}): PricingRuleConfig {
  return {
    legacyId: "rule_base_hours",
    serviceId: "svc-1",
    ruleKey: "base_hours",
    ruleType: "numeric_factor",
    valueNumeric: 1.5,
    active: true,
    sortOrder: 1,
    ...over,
  };
}

function makeConfig(over: Partial<CalculatorConfig> = {}): CalculatorConfig {
  return {
    companyName: "Test AB",
    settings: makeSettings(),
    services: [makeService()],
    cleaningPlans: [makePlan()],
    pricingRules: [makeRule()],
    sizeBands: [],
    ...over,
  };
}

// ── parseQuestionOptions ─────────────────────────────────────────────────────

describe("parseQuestionOptions", () => {
  it("keeps valid options and falls back to value for a missing label", () => {
    expect(
      parseQuestionOptions([
        { value: "apartment", label: "Lägenhet" },
        { value: "villa" },
      ]),
    ).toEqual([
      { value: "apartment", label: "Lägenhet" },
      { value: "villa", label: "villa" },
    ]);
  });

  it("drops entries with an empty/missing value and tolerates non-arrays", () => {
    expect(parseQuestionOptions([{ value: "" }, { label: "no value" }, "x"])).toEqual([]);
    expect(parseQuestionOptions(null)).toEqual([]);
    expect(parseQuestionOptions({})).toEqual([]);
  });
});

// ── validateNewQuestion ──────────────────────────────────────────────────────

describe("validateNewQuestion", () => {
  const base = { questionKey: "has_pets", label: "Husdjur?", inputType: "boolean", options: [] };

  it("accepts a clean draft", () => {
    expect(validateNewQuestion(base, ["sqm"])).toEqual([]);
  });

  it("requires a machine-safe, unique key", () => {
    expect(validateNewQuestion({ ...base, questionKey: "" }, [])).toContain("Question key is required.");
    expect(validateNewQuestion({ ...base, questionKey: "Has Pets" }, [])[0]).toMatch(/lowercase letters/);
    expect(validateNewQuestion({ ...base, questionKey: "sqm" }, ["sqm"])[0]).toMatch(/already used/);
  });

  it("requires a label and a supported input type", () => {
    expect(validateNewQuestion({ ...base, label: "  " }, [])).toContain("Label is required.");
    expect(validateNewQuestion({ ...base, inputType: "rating" }, [])).toContain(
      "A valid input type is required.",
    );
  });

  it("requires options for select / multiselect", () => {
    expect(validateNewQuestion({ ...base, inputType: "select", options: [] }, [])[0]).toMatch(
      /at least one option/,
    );
    expect(
      validateNewQuestion({ ...base, inputType: "select", options: [{ value: "a", label: "A" }] }, []),
    ).toEqual([]);
  });
});

// ── computeCalculatorConfigHealth ────────────────────────────────────────────

describe("computeCalculatorConfigHealth", () => {
  it("returns no issues for a healthy config", () => {
    expect(computeCalculatorConfigHealth(makeConfig())).toEqual([]);
  });

  it("flags a public service with no active questions (blocking)", () => {
    const config = makeConfig({
      services: [makeService({ questions: [makeQuestion({ active: false })] })],
    });
    const codes = computeCalculatorConfigHealth(config).map((i) => i.code);
    expect(codes).toContain("service_no_active_questions");
  });

  it("flags a public service with no active pricing rules (blocking)", () => {
    const config = makeConfig({ pricingRules: [makeRule({ active: false })] });
    const codes = computeCalculatorConfigHealth(config).map((i) => i.code);
    expect(codes).toContain("service_no_active_pricing_rules");
  });

  it("flags a select question without options (blocking)", () => {
    const config = makeConfig({
      services: [
        makeService({
          questions: [
            makeQuestion({ affectsPricing: false }),
            makeQuestion({
              legacyId: "q2",
              questionKey: "property_type",
              inputType: "select",
              affectsPricing: false,
              options: [],
            }),
          ],
        }),
      ],
    });
    const codes = computeCalculatorConfigHealth(config).map((i) => i.code);
    expect(codes).toContain("question_select_without_options");
  });

  it("warns when a pricing-affecting question is unknown to the engine", () => {
    const config = makeConfig({
      services: [
        makeService({
          // bathrooms is RETIRED for home (Slice 12I) — still flagging affects_pricing warns.
          questions: [makeQuestion({ questionKey: "bathrooms", inputType: "integer", affectsPricing: true })],
        }),
      ],
    });
    const item = computeCalculatorConfigHealth(config).find((i) => i.code === "question_pricing_not_supported");
    expect(item?.level).toBe("warning");
  });

  it("flags duplicate active question keys (blocking)", () => {
    const config = makeConfig({
      services: [
        makeService({
          questions: [makeQuestion({ legacyId: "q1" }), makeQuestion({ legacyId: "q2", affectsPricing: false })],
        }),
      ],
    });
    const codes = computeCalculatorConfigHealth(config).map((i) => i.code);
    expect(codes).toContain("duplicate_question_key");
  });

  it("flags a service that requires a plan when none is active", () => {
    const config = makeConfig({ cleaningPlans: [makePlan({ active: false })] });
    const codes = computeCalculatorConfigHealth(config).map((i) => i.code);
    expect(codes).toContain("service_requires_plan_none_active");
  });

  it("adds an enabled-with-blocking-issues item when live and broken", () => {
    const config = makeConfig({
      settings: makeSettings({ enabled: true }),
      pricingRules: [makeRule({ active: false })],
    });
    const codes = computeCalculatorConfigHealth(config).map((i) => i.code);
    expect(codes).toContain("enabled_with_blocking_issues");
  });

  it("summarizes counts by level", () => {
    const config = makeConfig({ pricingRules: [makeRule({ active: false })] });
    const summary = summarizeConfigHealth(computeCalculatorConfigHealth(config));
    expect(summary.blocking).toBeGreaterThanOrEqual(1);
    expect(summary).toHaveProperty("warning");
    expect(summary).toHaveProperty("info");
  });
});

// ── GPM-6-R: config health for literal generic sqm_fixed ──────────────────────

describe("computeCalculatorConfigHealth — literal generic sqm_fixed (GPM-6-R)", () => {
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

  /** A public (enabled) sqm_fixed config with NO pricing rules — sqm_fixed is plan-priced. */
  function sqmConfig(plans: CleaningPlanConfig[] = [sqmPlan()]): CalculatorConfig {
    return makeConfig({
      settings: makeSettings({ enabled: true }),
      services: [sqmService()],
      cleaningPlans: plans,
      pricingRules: [],
    });
  }

  it("a public sqm_fixed service with an active priced plan + no rules is healthy", () => {
    const items = computeCalculatorConfigHealth(sqmConfig());
    const codes = items.map((i) => i.code);
    expect(codes).not.toContain("service_unsupported_pricing_model");
    expect(codes).not.toContain("service_no_active_pricing_rules");
    expect(items).toEqual([]);
  });

  it("never flags literal sqm_fixed as an unsupported pricing model (even when not enabled)", () => {
    const draft = makeConfig({
      settings: makeSettings({ enabled: false }),
      services: [sqmService({ enabled: false })],
      cleaningPlans: [sqmPlan()],
      pricingRules: [],
    });
    const codes = computeCalculatorConfigHealth(draft).map((i) => i.code);
    expect(codes).not.toContain("service_unsupported_pricing_model");
  });

  it("flags a public sqm_fixed plan with no positive price per m² (blocking) — not unsupported/no-rules", () => {
    const codes = computeCalculatorConfigHealth(sqmConfig([sqmPlan({ pricePerSqmExclVat: null })])).map((i) => i.code);
    expect(codes).toContain("service_sqm_fixed_missing_price_per_sqm");
    expect(codes).not.toContain("service_unsupported_pricing_model");
    expect(codes).not.toContain("service_no_active_pricing_rules");
  });

  it("flags a public sqm_fixed service with no active plan via the existing plan check", () => {
    const codes = computeCalculatorConfigHealth(sqmConfig([sqmPlan({ active: false })])).map((i) => i.code);
    expect(codes).toContain("service_requires_plan_none_active");
    expect(codes).not.toContain("service_unsupported_pricing_model");
  });
});

// ── validatePricingRuleValue ─────────────────────────────────────────────────

describe("validatePricingRuleValue", () => {
  it("rejects empty, non-numeric and negative values", () => {
    expect(validatePricingRuleValue("").error).toBe("A value is required.");
    expect(validatePricingRuleValue("   ").error).toBe("A value is required.");
    expect(validatePricingRuleValue("abc").error).toMatch(/must be a number/);
    expect(validatePricingRuleValue("-5").error).toMatch(/zero or greater/);
  });

  it("accepts zero, decimals and Swedish-formatted numbers", () => {
    expect(validatePricingRuleValue("0")).toEqual({ value: 0, error: null });
    expect(validatePricingRuleValue("0.02")).toEqual({ value: 0.02, error: null });
    expect(validatePricingRuleValue("12,5")).toEqual({ value: 12.5, error: null });
    expect(validatePricingRuleValue("1 500")).toEqual({ value: 1500, error: null });
  });
});

// ── parsePricingRuleAuditEvent ───────────────────────────────────────────────

describe("parsePricingRuleAuditEvent", () => {
  const validBlob = {
    id: "calc_pricing_audit_x_1",
    at: "2026-01-01T10:00:00.000Z",
    actorName: "Alex Admin",
    actorRole: "super_admin",
    action: CALCULATOR_PRICING_RULE_AUDIT_ACTION,
    summary: "changed",
    calculator: {
      section: "pricing_rules",
      ruleKey: "base_hours",
      ruleType: "numeric_factor",
      oldValue: 1.5,
      newValue: 2,
      currency: "SEK",
      note: "seasonal",
    },
  };

  it("maps a valid pricing-rule change blob", () => {
    expect(parsePricingRuleAuditEvent(validBlob)).toEqual({
      id: "calc_pricing_audit_x_1",
      at: "2026-01-01T10:00:00.000Z",
      actorName: "Alex Admin",
      actorRole: "super_admin",
      ruleKey: "base_hours",
      ruleType: "numeric_factor",
      oldValue: 1.5,
      newValue: 2,
      note: "seasonal",
    });
  });

  it("returns null for a non-pricing action or a malformed blob", () => {
    expect(parsePricingRuleAuditEvent({ ...validBlob, action: "auth.login" })).toBeNull();
    expect(parsePricingRuleAuditEvent({ ...validBlob, id: undefined })).toBeNull();
    expect(parsePricingRuleAuditEvent(null)).toBeNull();
    expect(parsePricingRuleAuditEvent("x")).toBeNull();
  });

  it("defaults a missing actor name and drops an empty note", () => {
    const entry = parsePricingRuleAuditEvent({
      ...validBlob,
      actorName: "",
      calculator: { ...validBlob.calculator, note: "  " },
    });
    expect(entry?.actorName).toBe("Okänd");
    expect(entry?.note).toBeNull();
  });
});

// ── Mappers ──────────────────────────────────────────────────────────────────

describe("parseSqmAdjustments (Slice 12Q)", () => {
  it("parses, sorts and tolerates an open-ended top range", () => {
    const parsed = parseSqmAdjustments([
      { fromSqm: 61, toSqm: 70, adjustmentPercent: -5 },
      { fromSqm: 0, toSqm: 60, adjustmentPercent: 0 },
      { fromSqm: 131, toSqm: null, adjustmentPercent: -15 },
    ]);
    expect(parsed).toEqual([
      { fromSqm: 0, toSqm: 60, adjustmentPercent: 0 },
      { fromSqm: 61, toSqm: 70, adjustmentPercent: -5 },
      { fromSqm: 131, toSqm: null, adjustmentPercent: -15 },
    ]);
  });

  it("drops malformed rows and tolerates non-array / missing input", () => {
    expect(parseSqmAdjustments(undefined)).toEqual([]);
    expect(parseSqmAdjustments("nope")).toEqual([]);
    expect(
      parseSqmAdjustments([
        { fromSqm: -1, toSqm: 10, adjustmentPercent: 0 }, // negative from
        { fromSqm: 10, toSqm: 5, adjustmentPercent: 0 }, // to < from
        { fromSqm: 20, adjustmentPercent: 0 }, // missing toSqm → open-ended, valid
        { fromSqm: 30, toSqm: 40 }, // missing percent → dropped
      ]),
    ).toEqual([{ fromSqm: 20, toSqm: null, adjustmentPercent: 0 }]);
  });

  it("mapServiceConfigRow surfaces homeSqmAdjustments from settings_json", () => {
    const mapped = mapServiceConfigRow({
      id: "svc-1",
      legacy_id: "svc_legacy_1",
      service_key: "home_cleaning",
      display_name: "Hemstädning",
      description: null,
      enabled: true,
      coming_soon: false,
      pricing_model: "home_cleaning_recommended_hours",
      sort_order: 1,
      settings_json: {
        homeSqmAdjustments: [{ fromSqm: 61, toSqm: 70, adjustmentPercent: -5 }],
      },
    });
    expect(mapped.homeSqmAdjustments).toEqual([{ fromSqm: 61, toSqm: 70, adjustmentPercent: -5 }]);
  });
});

describe("row mappers", () => {
  it("maps service settings_json.requiresCleaningPlan", () => {
    const mapped = mapServiceConfigRow({
      id: "svc-1",
      legacy_id: "svc_legacy_1",
      service_key: "home_cleaning",
      display_name: "Hemstädning",
      description: null,
      enabled: true,
      coming_soon: false,
      pricing_model: "home_cleaning_recommended_hours",
      sort_order: 1,
      settings_json: { requiresCleaningPlan: true },
    });
    expect(mapped.requiresCleaningPlan).toBe(true);
    expect(mapped.serviceKey).toBe("home_cleaning");
  });

  it("maps settings_json.planPricingModel time_adjustment_per_visit and defaults unknown values", () => {
    const timeAdjust = mapServiceConfigRow({
      id: "svc-1",
      legacy_id: "svc_legacy_1",
      service_key: "home_cleaning",
      display_name: "Hemstädning",
      description: null,
      enabled: true,
      coming_soon: false,
      pricing_model: "home_cleaning_recommended_hours",
      sort_order: 1,
      settings_json: { plansEnabled: true, planPricingModel: "time_adjustment_per_visit" },
    });
    expect(timeAdjust.planPricingModel).toBe("time_adjustment_per_visit");

    const bogus = mapServiceConfigRow({
      id: "svc-1",
      legacy_id: "svc_legacy_1",
      service_key: "home_cleaning",
      display_name: "Hemstädning",
      description: null,
      enabled: true,
      coming_soon: false,
      pricing_model: "home_cleaning_recommended_hours",
      sort_order: 1,
      settings_json: { planPricingModel: "totally_bogus" },
    });
    expect(bogus.planPricingModel).toBe("hourly_rate_by_plan"); // unknown → safe default
  });

  it("coerces numeric strings from Supabase to numbers", () => {
    const plan = mapPlanConfigRow({
      legacy_id: "plan_flexible",
      plan_key: "flexible",
      name: "Flexibel",
      description: null,
      hourly_rate: "349.00",
      flexibility_level: null,
      customer_day_time_control: null,
      same_staff_preference_level: null,
      booking_priority: null,
      cancellation_terms_summary: null,
      is_default: true,
      active: true,
      sort_order: 1,
    });
    expect(plan.hourlyRate).toBe(349);

    const rule = mapPricingRuleRow({
      legacy_id: "rule_base_hours",
      calculator_service_id: "svc-1",
      rule_key: "base_hours",
      rule_type: "numeric_factor",
      value_numeric: "1.5",
      active: true,
      sort_order: 1,
    });
    expect(rule.valueNumeric).toBe(1.5);
  });
});
