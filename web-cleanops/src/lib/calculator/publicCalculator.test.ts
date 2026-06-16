import { describe, expect, it } from "vitest";

/**
 * Tests the EXACT pure modules the `public-calculator` Edge Function runs
 * (`supabase/functions/_shared/calculator/*`). They live outside `src`, but the
 * app's tsconfig enables `allowImportingTsExtensions`, so we import them by their
 * explicit `.ts` path. Fixtures mirror migration 0060's seeded Städalliansen
 * config so these assertions also pin the seeded shape to public-safe output.
 */
import {
  buildHoneypotSubmitResponse,
  buildPublicConfig,
  coerceAnswers,
  isValidSlug,
  mapRulesToEngine,
  normalizeSlug,
  prepareSubmission,
  withRoundingFallback,
  requiresCleaningPlan,
  resolvePriceDisplayMode,
  runCalculation,
  validateCalculateRequest,
  validateSubmitRequest,
} from "../../../supabase/functions/_shared/calculator/publicCalculator.ts";
import type { SubmitParts } from "../../../supabase/functions/_shared/calculator/publicCalculator.ts";
import type {
  CalculatorQuestionRow,
  CalculatorServiceRow,
  CalculatorSettingsRow,
  CleaningPlanRow,
  CompanyRow,
  ExistingProspect,
  PricingRuleRow,
  PublicSubmitRequest,
} from "../../../supabase/functions/_shared/calculator/types.ts";

// ── Fixtures (mirror seed 0060) ──────────────────────────────────────────────

const company: CompanyRow = { id: "comp-uuid-1", name: "Städalliansen Sverige AB", legacy_id: "cmp_o2f6orw29m" };

function settings(enabled: boolean): CalculatorSettingsRow {
  return {
    id: "set-1",
    company_id: "comp-uuid-1",
    company_legacy_id: "cmp_o2f6orw29m",
    enabled,
    public_slug: "rakna-ut-ditt-pris",
    price_display_mode: "range",
    show_price_before_contact: true,
    require_contact_before_result: false,
    show_login_prompt_after_submit: true,
    quote_validity_days: 30,
    currency: "SEK",
    rut_display_mode: "none",
    content: {
      pageTitle: "Räkna ut ditt pris",
      contactHelp: { email: "kontakt@example.se" },
      faq: [{ q: "Hur beräknas priset?", a: "Per yta." }],
    },
  };
}

const homeService: CalculatorServiceRow = {
  id: "svc-home",
  service_key: "home_cleaning",
  display_name: "Hemstädning",
  description: "Återkommande hemstädning.",
  enabled: true,
  coming_soon: false,
  pricing_model: "home_cleaning_recommended_hours",
  sort_order: 1,
  settings_json: { requiresCleaningPlan: true },
};

const moveoutService: CalculatorServiceRow = {
  id: "svc-moveout",
  service_key: "move_out_cleaning",
  display_name: "Flyttstädning",
  description: "Noggrann flyttstädning.",
  enabled: true,
  coming_soon: false,
  pricing_model: "move_out_fixed_plus_addons",
  sort_order: 2,
  settings_json: { requiresCleaningPlan: false },
};

const comingSoonService: CalculatorServiceRow = {
  id: "svc-window",
  service_key: "window_cleaning",
  display_name: "Fönsterputs",
  description: null,
  enabled: false,
  coming_soon: true,
  pricing_model: "move_out_fixed_plus_addons",
  sort_order: 3,
  settings_json: {},
};

const homeQuestions: CalculatorQuestionRow[] = [
  {
    id: "q-home-addons", calculator_service_id: "svc-home", question_key: "addons",
    label: "Tillval", help_text: null, input_type: "multiselect", required: false,
    options_json: [{ value: "oven", label: "Ugn" }], validation_json: {}, sort_order: 5,
  },
  {
    id: "q-home-sqm", calculator_service_id: "svc-home", question_key: "sqm",
    label: "Boyta (m²)", help_text: "Ange yta.", input_type: "number", required: true,
    options_json: [], validation_json: { min: 10, max: 500 }, sort_order: 1,
  },
];

const moveoutQuestions: CalculatorQuestionRow[] = [
  {
    id: "q-mo-sqm", calculator_service_id: "svc-moveout", question_key: "sqm",
    label: "Boyta (m²)", help_text: null, input_type: "number", required: true,
    options_json: [], validation_json: {}, sort_order: 1,
  },
];

// hourly_rate intentionally a string on one plan to prove numeric coercion.
const plans: CleaningPlanRow[] = [
  {
    id: "plan-flex", plan_key: "flexible", name: "Flexibel", description: "Lägre timpris.",
    hourly_rate: 349, flexibility_level: "high", customer_day_time_control: "company_controlled",
    same_staff_preference_level: "low", booking_priority: "standard",
    cancellation_terms_summary: "48h", is_default: true, sort_order: 1,
  },
  {
    id: "plan-fixed", plan_key: "fixed", name: "Fast", description: "Fast tid.",
    hourly_rate: "399" as unknown as number, flexibility_level: "medium", customer_day_time_control: "preferred",
    same_staff_preference_level: "medium", booking_priority: "elevated",
    cancellation_terms_summary: "72h", is_default: false, sort_order: 2,
  },
  {
    id: "plan-prio", plan_key: "priority", name: "Prioritet", description: "Högsta prioritet.",
    hourly_rate: 449, flexibility_level: "low", customer_day_time_control: "guaranteed",
    same_staff_preference_level: "high", booking_priority: "priority",
    cancellation_terms_summary: "5d", is_default: false, sort_order: 3,
  },
];

// value_numeric intentionally mixes number + string to prove coercion.
const homeRules: PricingRuleRow[] = [
  { id: "r1", rule_key: "base_hours", rule_type: "numeric_factor", value_numeric: 1.5 },
  { id: "r2", rule_key: "hours_per_sqm", rule_type: "numeric_factor", value_numeric: "0.02" },
  { id: "r3", rule_key: "minimum_hours", rule_type: "threshold", value_numeric: 2 },
  { id: "r4", rule_key: "bathroom_extra_hours", rule_type: "numeric_factor", value_numeric: 0.25 },
  { id: "r5", rule_key: "addon_hours_oven", rule_type: "addon_hours", value_numeric: 0.5 },
  { id: "r6", rule_key: "addon_hours_fridge", rule_type: "addon_hours", value_numeric: 0.5 },
  { id: "r7", rule_key: "addon_hours_inside_windows", rule_type: "addon_hours", value_numeric: 0.75 },
  { id: "r8", rule_key: "range_min_percent", rule_type: "margin_percent", value_numeric: 10 },
  { id: "r9", rule_key: "range_max_percent", rule_type: "margin_percent", value_numeric: 10 },
  { id: "r10", rule_key: "rounding_increment", rule_type: "rounding", value_numeric: 50 },
];

const moveoutRules: PricingRuleRow[] = [
  { id: "m1", rule_key: "price_per_sqm", rule_type: "numeric_factor", value_numeric: 35 },
  { id: "m2", rule_key: "minimum_price", rule_type: "threshold", value_numeric: 1500 },
  { id: "m3", rule_key: "addon_glazed_balcony", rule_type: "addon_price", value_numeric: 300 },
  { id: "m4", rule_key: "addon_divisible_windows", rule_type: "addon_price", value_numeric: 250 },
  { id: "m5", rule_key: "addon_extra_bathroom", rule_type: "addon_price", value_numeric: 200 },
  { id: "m6", rule_key: "range_min_percent", rule_type: "margin_percent", value_numeric: 10 },
  { id: "m7", rule_key: "range_max_percent", rule_type: "margin_percent", value_numeric: 10 },
  { id: "m8", rule_key: "rounding_increment", rule_type: "rounding", value_numeric: 50 },
];

// Office (Slice 12E/12F) — recurring model, no plan, supervision + custom interval.
const officeService: CalculatorServiceRow = {
  id: "svc-office",
  service_key: "office_cleaning",
  display_name: "Kontorsstädning",
  description: "Återkommande kontorsstädning.",
  enabled: true,
  coming_soon: false,
  pricing_model: "office_cleaning_recurring_area_frequency",
  sort_order: 3,
  settings_json: { requiresCleaningPlan: false },
};

const officeRules: PricingRuleRow[] = [
  { id: "o1", rule_key: "base_visit_hours", rule_type: "numeric_factor", value_numeric: 1.0 },
  { id: "o2", rule_key: "hours_per_sqm", rule_type: "numeric_factor", value_numeric: 0.008 },
  { id: "o3", rule_key: "minimum_hours_per_visit", rule_type: "threshold", value_numeric: 1.5 },
  { id: "o4", rule_key: "hourly_rate", rule_type: "numeric_factor", value_numeric: 459 },
  { id: "o5", rule_key: "supervision_start_minutes", rule_type: "threshold", value_numeric: 15 },
  { id: "o6", rule_key: "range_min_percent", rule_type: "margin_percent", value_numeric: 10 },
  { id: "o7", rule_key: "range_max_percent", rule_type: "margin_percent", value_numeric: 10 },
  { id: "o8", rule_key: "rounding_increment", rule_type: "rounding", value_numeric: 50 },
];

const officeQuestions: CalculatorQuestionRow[] = [
  {
    id: "q-office-sqm", calculator_service_id: "svc-office", question_key: "sqm",
    label: "Kontorsyta (m²)", help_text: null, input_type: "number", required: true,
    options_json: [], validation_json: { min: 10, max: 5000 }, sort_order: 1, affects_pricing: true,
  },
  {
    id: "q-office-frequency", calculator_service_id: "svc-office", question_key: "frequency",
    label: "Ordinarie städning", help_text: null, input_type: "select", required: true,
    options_json: [{ value: "weekly", label: "Varje vecka" }, { value: "custom_interval", label: "Annat intervall" }],
    validation_json: {}, sort_order: 2, affects_pricing: true,
  },
];

const calcSettings = { currency: "SEK", price_display_mode: "range", enabled: true, default_vat_rate_percent: 25 } as const;

// ── helpers ──────────────────────────────────────────────────────────────────

describe("slug + mode helpers", () => {
  it("normalizes and validates slugs", () => {
    expect(normalizeSlug("  Rakna-Ut-Ditt-Pris ")).toBe("rakna-ut-ditt-pris");
    expect(isValidSlug("rakna-ut-ditt-pris")).toBe(true);
    expect(isValidSlug("")).toBe(false);
    expect(isValidSlug("-bad")).toBe(false);
    expect(isValidSlug("bad slug")).toBe(false);
    expect(isValidSlug("UPPER")).toBe(false); // normalize first
  });

  it("resolves price display mode with a safe fallback", () => {
    expect(resolvePriceDisplayMode("exact")).toBe("exact");
    expect(resolvePriceDisplayMode("range")).toBe("range");
    expect(resolvePriceDisplayMode("hidden_until_submit")).toBe("hidden_until_submit");
    expect(resolvePriceDisplayMode("nonsense")).toBe("range");
    expect(resolvePriceDisplayMode(undefined)).toBe("range");
  });

  it("requiresCleaningPlan reads the flag then falls back to the model", () => {
    expect(requiresCleaningPlan(homeService)).toBe(true);
    expect(requiresCleaningPlan(moveoutService)).toBe(false);
    expect(requiresCleaningPlan({ ...homeService, settings_json: {} })).toBe(true); // fallback by model
    expect(requiresCleaningPlan({ ...moveoutService, settings_json: {} })).toBe(false);
  });
});

// ── config action ─────────────────────────────────────────────────────────────

describe("buildPublicConfig (enabled)", () => {
  const result = buildPublicConfig({
    company,
    settings: settings(true),
    services: [moveoutService, homeService, comingSoonService], // unsorted input
    questions: [...homeQuestions, ...moveoutQuestions],
    plans,
  });

  it("returns enabled config with sorted services + grouped, sorted questions", () => {
    expect(result.enabled).toBe(true);
    expect(result.services.map((s) => s.serviceKey)).toEqual([
      "home_cleaning",
      "move_out_cleaning",
      "window_cleaning",
    ]);
    const home = result.services[0];
    expect(home.requiresCleaningPlan).toBe(true);
    expect(home.questions.map((q) => q.questionKey)).toEqual(["sqm", "addons"]); // sorted
  });

  it("shows coming-soon services as disabled cards with no questions", () => {
    const window = result.services.find((s) => s.serviceKey === "window_cleaning")!;
    expect(window.comingSoon).toBe(true);
    expect(window.enabled).toBe(false);
    expect(window.questions).toEqual([]);
  });

  it("exposes plans (incl. coerced hourly rate) and company name", () => {
    expect(result.cleaningPlans.map((p) => p.planKey)).toEqual(["flexible", "fixed", "priority"]);
    expect(result.cleaningPlans[1].hourlyRate).toBe(399); // coerced from string
    expect(result.company).toEqual({ name: "Städalliansen Sverige AB" });
  });

  it("surfaces FAQ separately and strips it from content", () => {
    expect(result.faq).toEqual([{ q: "Hur beräknas priset?", a: "Per yta." }]);
    expect(result.content.pageTitle).toBe("Räkna ut ditt pris");
    expect("faq" in result.content).toBe(false);
  });

  it("never leaks internal fields (company uuid, pricing internals, ids)", () => {
    const wire = JSON.stringify(result);
    expect(wire).not.toContain("comp-uuid-1"); // company_id uuid
    expect(wire).not.toContain("cmp_o2f6orw29m"); // company legacy id
    expect(wire).not.toContain("manual_review");
    expect(wire).not.toContain("price_per_sqm");
    expect(wire).not.toContain("svc-home"); // internal service id
    // public settings carry only the whitelisted behaviour flags
    expect(Object.keys(result.settings).sort()).toEqual(
      [
        "currency",
        "defaultVatRatePercent",
        "priceDisplayMode",
        "publicSlug",
        "quoteValidityDays",
        "requireContactBeforeResult",
        "rutDisplayMode",
        "showLoginPromptAfterSubmit",
        "showPriceBeforeContact",
      ].sort(),
    );
  });
});

describe("buildPublicConfig (disabled — MVP default)", () => {
  const result = buildPublicConfig({
    company,
    settings: settings(false),
    services: [homeService, moveoutService],
    questions: homeQuestions,
    plans,
  });

  it("withholds the calculator structure but keeps copy + flags", () => {
    expect(result.enabled).toBe(false);
    expect(result.services).toEqual([]);
    expect(result.cleaningPlans).toEqual([]);
    expect(result.content.pageTitle).toBe("Räkna ut ditt pris");
    expect(result.faq.length).toBe(1);
    expect(result.settings.publicSlug).toBe("rakna-ut-ditt-pris");
    expect(result.company).toEqual({ name: "Städalliansen Sverige AB" });
  });
});

// ── config action: generic service metadata (GPM-5c-1) ───────────────────────

describe("buildPublicConfig — generic service metadata (GPM-5c-1)", () => {
  // Additive, public-safe per-service metadata derived from the LITERAL pricing_model
  // ONLY (never alias-resolved) and exposing no pricing internals.
  function genericService(pricingModel: string, key: string): CalculatorServiceRow {
    return {
      id: `svc-${key}`,
      service_key: key,
      display_name: key,
      description: null,
      enabled: true,
      coming_soon: false,
      pricing_model: pricingModel,
      sort_order: 1,
      settings_json: {},
    };
  }

  function metaFor(pricingModel: string, key: string) {
    const result = buildPublicConfig({
      company,
      settings: settings(true),
      services: [genericService(pricingModel, key)],
      questions: [],
      plans: [],
    });
    const svc = result.services.find((s) => s.serviceKey === key);
    if (!svc) throw new Error(`service ${key} missing from config`);
    return svc;
  }

  it("literal sqm_fixed → generic, engine-supported, primaryInput sqm, unitLabel m²", () => {
    const svc = metaFor("sqm_fixed", "moveout_generic");
    expect(svc.genericPricingModel).toBe("sqm_fixed");
    expect(svc.engineSupported).toBe(true);
    expect(svc.primaryInput).toBe("sqm");
    expect(svc.unitLabel).toBe("m²");
  });

  it("literal hourly_by_area → generic but NOT engine-supported yet (still area-driven sqm input)", () => {
    const svc = metaFor("hourly_by_area", "hourly_generic");
    expect(svc.genericPricingModel).toBe("hourly_by_area");
    expect(svc.engineSupported).toBe(false);
    expect(svc.primaryInput).toBe("sqm");
    expect(svc.unitLabel).toBe("m²");
  });

  it("reserved generic models are generic, not engine-supported, and have no canonical primary input", () => {
    for (const model of ["unit_based", "fixed_package", "manual_quote"]) {
      const svc = metaFor(model, `svc_${model}`);
      expect(svc.genericPricingModel).toBe(model);
      expect(svc.engineSupported).toBe(false);
      expect(svc.primaryInput).toBeNull();
      expect(svc.unitLabel).toBeNull();
    }
  });

  it("legacy / service-named models report null generic metadata (never alias-resolved)", () => {
    const cases: Array<[string, string]> = [
      ["home_cleaning_recommended_hours", "home_cleaning"],
      ["move_out_fixed_plus_addons", "move_out_cleaning"],
      ["office_cleaning_recurring_area_frequency", "office_cleaning"],
    ];
    for (const [model, key] of cases) {
      const svc = metaFor(model, key);
      expect(svc.genericPricingModel).toBeNull();
      expect(svc.engineSupported).toBe(false);
      expect(svc.primaryInput).toBeNull();
      expect(svc.unitLabel).toBeNull();
      // The raw pricingModel field is unchanged (backward compatible).
      expect(svc.pricingModel).toBe(model);
    }
  });

  it("CRITICAL: legacy move_out_fixed_plus_addons is NOT classified as generic sqm_fixed / engine-supported", () => {
    const svc = metaFor("move_out_fixed_plus_addons", "move_out_cleaning");
    expect(svc.genericPricingModel).toBeNull();
    expect(svc.genericPricingModel).not.toBe("sqm_fixed");
    expect(svc.engineSupported).toBe(false);
  });

  it("real seed fixtures (Home/Move-out/Office) stay backward compatible — all generic metadata null/false", () => {
    const result = buildPublicConfig({
      company,
      settings: settings(true),
      services: [homeService, moveoutService, officeService],
      questions: [...homeQuestions, ...moveoutQuestions, ...officeQuestions],
      plans,
    });
    expect(result.services.length).toBe(3);
    for (const svc of result.services) {
      expect(svc.genericPricingModel).toBeNull();
      expect(svc.engineSupported).toBe(false);
      expect(svc.primaryInput).toBeNull();
      expect(svc.unitLabel).toBeNull();
    }
  });

  it("the new metadata fields never leak pricing internals", () => {
    const svc = metaFor("sqm_fixed", "moveout_generic");
    const wire = JSON.stringify(svc);
    // Raw per-m² price + plan/readiness internals must never appear via the new
    // generic metadata. NB: planPricingModel="hourly_rate_by_plan" is a public model
    // identifier (already exposed pre-GPM-5c-1), NOT a leaked rate — so we assert on
    // the raw internal FIELD names, not the substring "hourly_rate".
    expect(wire).not.toContain("price_per_sqm");
    expect(wire).not.toContain("pricePerSqm");
    expect(wire).not.toContain("minimumPriceExclVat");
    expect(wire).not.toContain("missing_price");
    expect(wire).not.toContain("readiness");
    // The generic metadata is exactly the four safe, public-safe values.
    expect(svc.genericPricingModel).toBe("sqm_fixed");
    expect(svc.engineSupported).toBe(true);
  });
});

// ── validation ─────────────────────────────────────────────────────────────────

describe("validateCalculateRequest", () => {
  it("rejects a missing/blank serviceKey", () => {
    expect(validateCalculateRequest({}).ok).toBe(false);
    expect(validateCalculateRequest({ serviceKey: "   " }).ok).toBe(false);
  });

  it("rejects non-object answers", () => {
    const r = validateCalculateRequest({ serviceKey: "home_cleaning", answers: "nope" });
    expect(r.ok).toBe(false);
  });

  it("accepts + normalizes a valid request", () => {
    const r = validateCalculateRequest({
      serviceKey: " home_cleaning ",
      answers: { sqm: 70, bathrooms: 1 },
      cleaningPlanKey: " flexible ",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.serviceKey).toBe("home_cleaning");
      expect(r.value.cleaningPlanKey).toBe("flexible");
      expect(r.value.cleaningPlanId).toBeNull();
      expect(r.value.answers).toEqual({ sqm: 70, bathrooms: 1 });
    }
  });
});

describe("coerceAnswers", () => {
  it("keeps supported types, filters arrays, truncates long strings, drops junk", () => {
    const long = "x".repeat(3000);
    const out = coerceAnswers({
      sqm: 70,
      flag: true,
      addons: ["oven", 5, "fridge"],
      note: long,
      nested: { a: 1 },
      nope: () => 1,
    });
    expect(out.sqm).toBe(70);
    expect(out.flag).toBe(true);
    expect(out.addons).toEqual(["oven", "fridge"]);
    expect((out.note as string).length).toBe(2000);
    expect("nested" in out).toBe(false);
    expect("nope" in out).toBe(false);
  });
});

describe("mapRulesToEngine", () => {
  it("normalizes rule rows and coerces string numerics", () => {
    const mapped = mapRulesToEngine(homeRules);
    expect(mapped.find((r) => r.ruleKey === "hours_per_sqm")?.valueNumeric).toBe(0.02);
    expect(mapped.find((r) => r.ruleKey === "base_hours")?.valueNumeric).toBe(1.5);
  });
});

// ── calculate action ────────────────────────────────────────────────────────────

describe("runCalculation — home cleaning", () => {
  it("computes the canonical seeded example and returns ONLY public-safe fields", () => {
    const res = runCalculation({
      settings: calcSettings,
      service: homeService,
      plans,
      rules: homeRules,
      request: { serviceKey: "home_cleaning", answers: { sqm: 70, bathrooms: 1, addons: ["oven"] }, cleaningPlanKey: "flexible" },
    });
    expect(res.valid).toBe(true);
    // Phase 1: plan hourly_rate is excl. VAT; customer-facing price includes 25% VAT.
    expect(res.estimatedHours).toBe(3.4);
    expect(res.priceExclVat).toBe(1200);
    expect(res.vatAmount).toBe(300);
    expect(res.priceInclVat).toBe(1500);
    expect(res.calculatedPrice).toBe(1500);
    expect(res.minPrice).toBe(1312.5);
    expect(res.maxPrice).toBe(1625);
    // The active rounding_increment rule MUST surface on the public calculate
    // response so the live frontend can round displayed prices to the configured
    // interval. (Regression guard: a stale Edge Function that omits this field is
    // exactly what made public rounding silently fall back to whole-krona.)
    expect(res.roundingIncrement).toBe(50);
    expect(res.displayText).toBe("1 313–1 625 kr");
    expect(res.selectedPlan).toEqual({ planKey: "flexible", name: "Flexibel", hourlyRate: 349, vatRatePercent: 25, rutEnabled: false, rutPercent: 50, showRutBreakdown: false });
    expect(res.pricingModel).toBe("home_cleaning_recommended_hours");
    expect(res.formulaVersion).toBe("v1");
    // public-safe: NO internal trace / raw price / rule values
    expect("steps" in res).toBe(false);
    expect("rawPrice" in res).toBe(false);
  });

  it("surfaces a company-wide rounding fallback when the service has no active rounding rule", () => {
    // Reproduces the live bug: home/office returned roundingIncrement=null while
    // move-out rounded, because only move-out had an ACTIVE rounding_increment
    // rule. With the company-wide fallback injected, the recurring (VAT/RUT)
    // service surfaces the same increment so the frontend rounds consistently.
    const homeRulesNoRounding: PricingRuleRow[] = homeRules.filter(
      (r) => r.rule_key !== "rounding_increment",
    );
    const withoutFallback = runCalculation({
      settings: calcSettings,
      service: homeService,
      plans,
      rules: homeRulesNoRounding,
      request: { serviceKey: "home_cleaning", answers: { sqm: 70, bathrooms: 1, addons: ["oven"] }, cleaningPlanKey: "flexible" },
    });
    expect(withoutFallback.roundingIncrement).toBeNull();

    const withFallback = runCalculation({
      settings: calcSettings,
      service: homeService,
      plans,
      // Mirrors the Edge Function: inject the company-wide increment (e.g. move-out's 50).
      rules: withRoundingFallback(homeRulesNoRounding, 50),
      request: { serviceKey: "home_cleaning", answers: { sqm: 70, bathrooms: 1, addons: ["oven"] }, cleaningPlanKey: "flexible" },
    });
    expect(withFallback.roundingIncrement).toBe(50);
  });

  it("keeps a service's OWN active rounding increment over the company-wide fallback", () => {
    const merged = withRoundingFallback(homeRules, 10);
    const res = runCalculation({
      settings: calcSettings,
      service: homeService,
      plans,
      rules: merged,
      request: { serviceKey: "home_cleaning", answers: { sqm: 70, bathrooms: 1, addons: ["oven"] }, cleaningPlanKey: "flexible" },
    });
    // home's own rule is 50 → the 10 fallback must NOT override it.
    expect(res.roundingIncrement).toBe(50);
  });

  it("resolves the plan by uuid as well as by key", () => {
    const byId = runCalculation({
      settings: calcSettings, service: homeService, plans, rules: homeRules,
      request: { serviceKey: "home_cleaning", answers: { sqm: 70, bathrooms: 1, addons: ["oven"] }, cleaningPlanId: "plan-flex" },
    });
    expect(byId.calculatedPrice).toBe(1500);
  });

  it("is invalid (missing_plan) when a required plan is not supplied", () => {
    const res = runCalculation({
      settings: calcSettings, service: homeService, plans, rules: homeRules,
      request: { serviceKey: "home_cleaning", answers: { sqm: 70, bathrooms: 1 } },
    });
    expect(res.valid).toBe(false);
    expect(res.calculatedPrice).toBeNull();
    expect(res.issues.map((i) => i.code)).toContain("missing_plan");
  });

  it("fails with plan_not_found when an unknown plan id is supplied", () => {
    const res = runCalculation({
      settings: calcSettings, service: homeService, plans, rules: homeRules,
      request: { serviceKey: "home_cleaning", answers: { sqm: 70 }, cleaningPlanId: "does-not-exist" },
    });
    expect(res.valid).toBe(false);
    expect(res.issues.map((i) => i.code)).toEqual(["plan_not_found"]);
  });

  it("is invalid (missing_sqm) when area is absent", () => {
    const res = runCalculation({
      settings: calcSettings, service: homeService, plans, rules: homeRules,
      request: { serviceKey: "home_cleaning", answers: { bathrooms: 1 }, cleaningPlanKey: "flexible" },
    });
    expect(res.issues.map((i) => i.code)).toContain("missing_sqm");
  });

  it("applies settings_json.homeSqmAdjustments to the per-m² time (Slice 12Q)", () => {
    // Clean rules isolate the per-m² component; 0 base/min/margins/rounding.
    const cleanRules: PricingRuleRow[] = [
      { id: "c1", rule_key: "base_hours", rule_type: "numeric_factor", value_numeric: 0 },
      { id: "c2", rule_key: "hours_per_sqm", rule_type: "numeric_factor", value_numeric: 0.04 },
      { id: "c3", rule_key: "minimum_hours", rule_type: "threshold", value_numeric: 0 },
      { id: "c4", rule_key: "under_minimum_visit_threshold_minutes", rule_type: "threshold", value_numeric: 0 },
      { id: "c5", rule_key: "range_min_percent", rule_type: "margin_percent", value_numeric: 0 },
      { id: "c6", rule_key: "range_max_percent", rule_type: "margin_percent", value_numeric: 0 },
    ];
    const serviceWithRanges: CalculatorServiceRow = {
      ...homeService,
      settings_json: {
        requiresCleaningPlan: true,
        homeSqmAdjustments: [{ fromSqm: 61, toSqm: 70, adjustmentPercent: -5 }],
      },
    };
    const res = runCalculation({
      settings: calcSettings, service: serviceWithRanges, plans, rules: cleanRules,
      request: { serviceKey: "home_cleaning", answers: { sqm: 65, frequency: "weekly" }, cleaningPlanKey: "flexible" },
    });
    expect(res.valid).toBe(true);
    expect(res.estimatedHours).toBe(2.47); // 65 × 0.04 × 0.95
  });

  it("does not crash and uses the legacy per-m² time when no ranges are configured", () => {
    const res = runCalculation({
      settings: calcSettings, service: homeService, plans, rules: homeRules,
      request: { serviceKey: "home_cleaning", answers: { sqm: 70, bathrooms: 1, addons: ["oven"] }, cleaningPlanKey: "flexible" },
    });
    expect(res.valid).toBe(true);
    expect(res.estimatedHours).toBe(3.4); // unchanged canonical example
  });
});

describe("runCalculation — move-out cleaning", () => {
  it("prices per m² with add-ons and needs no plan", () => {
    const res = runCalculation({
      settings: calcSettings,
      service: moveoutService,
      plans,
      rules: moveoutRules,
      request: { serviceKey: "move_out_cleaning", answers: { sqm: 70, bathrooms: 2, glazed_balcony: true } },
    });
    expect(res.valid).toBe(true);
    expect(res.estimatedHours).toBeNull();
    expect(res.calculatedPrice).toBe(2950);
    expect(res.minPrice).toBe(2650);
    expect(res.maxPrice).toBe(3250);
    expect(res.selectedPlan).toBeNull();
  });
});

describe("runCalculation — guards", () => {
  it("returns service_unavailable when the service is missing", () => {
    const res = runCalculation({
      settings: calcSettings, service: null, plans, rules: [],
      request: { serviceKey: "ghost", answers: { sqm: 70 } },
    });
    expect(res.valid).toBe(false);
    expect(res.issues.map((i) => i.code)).toEqual(["service_unavailable"]);
    expect(res.pricingModel).toBeNull();
  });

  it("returns service_unavailable when the service is disabled", () => {
    const res = runCalculation({
      settings: calcSettings, service: { ...homeService, enabled: false }, plans, rules: homeRules,
      request: { serviceKey: "home_cleaning", answers: { sqm: 70 }, cleaningPlanKey: "flexible" },
    });
    expect(res.issues.map((i) => i.code)).toEqual(["service_unavailable"]);
  });

  it("echoes enabled=false (calculate still works while the page is dark)", () => {
    const res = runCalculation({
      settings: { ...calcSettings, enabled: false },
      service: moveoutService, plans, rules: moveoutRules,
      request: { serviceKey: "move_out_cleaning", answers: { sqm: 70 } },
    });
    expect(res.enabled).toBe(false);
    expect(res.valid).toBe(true);
    expect(res.calculatedPrice).toBe(2450); // 70*35 = 2450 (> 1500 floor)
  });
});

// ── submit action ─────────────────────────────────────────────────────────────
//
// `submit` is the WRITE path. These tests pin the PURE preparation
// (`validateSubmitRequest` + `prepareSubmission`): the enabled gate, server-side
// recompute, prospect reuse, snapshot freezing, and public-safety of the
// response. The Edge Function (`index.ts`) only performs the ordered I/O the
// `ready` outcome describes; all decision logic is exercised here without a DB.

/** Full settings row incl. the submission-behaviour columns the submit path reads. */
function submitSettings(overrides: Partial<CalculatorSettingsRow> = {}): CalculatorSettingsRow {
  const base = settings(true);
  return {
    ...base,
    manual_review_threshold_amount: 10000,
    auto_create_prospect: true,
    auto_create_quote_request: true,
    default_quote_status: "submitted",
    content: {
      ...(base.content as Record<string, unknown>),
      quoteCreatedText: "Tack! Din förfrågan är mottagen.",
      loginPromptText: "Skapa ett konto för att följa din förfrågan.",
    },
    ...overrides,
  };
}

const FIXED_NOW = new Date("2026-06-08T12:00:00.000Z");

/** Deterministic, monotonic id generator so payload legacy_ids are assertable. */
function makeNewId(): (prefix: string) => string {
  let n = 0;
  return (prefix) => `${prefix}_test_${++n}`;
}

interface SubmitPartsOpts {
  enabled?: boolean;
  service?: CalculatorServiceRow | null;
  rules?: PricingRuleRow[];
  questions?: CalculatorQuestionRow[];
  request: PublicSubmitRequest;
  existingProspect?: ExistingProspect | null;
  settingsOverrides?: Partial<CalculatorSettingsRow>;
}

function buildSubmitParts(opts: SubmitPartsOpts): SubmitParts {
  return {
    settings: submitSettings({ enabled: opts.enabled ?? true, ...opts.settingsOverrides }),
    service: opts.service === undefined ? homeService : opts.service,
    plans,
    rules: opts.rules ?? homeRules,
    questions: opts.questions ?? homeQuestions,
    request: opts.request,
    existingProspect: opts.existingProspect ?? null,
    now: FIXED_NOW,
    newId: makeNewId(),
  };
}

/** A canonical valid home-cleaning submit request (sqm 70, 1 bath, oven, flexible). */
function homeRequest(overrides: Partial<PublicSubmitRequest> = {}): PublicSubmitRequest {
  return {
    serviceKey: "home_cleaning",
    answers: { sqm: 70, bathrooms: 1, addons: ["oven"] },
    cleaningPlanKey: "flexible",
    cleaningPlanId: null,
    contact: {
      name: "Test Customer",
      email: "test@example.com",
      phone: "0700000000",
      postalCode: "41700",
    },
    sourceUrl: "https://stadportalen.se/rakna-ut-ditt-pris",
    ...overrides,
  };
}

describe("validateSubmitRequest", () => {
  it("requires a contact object", () => {
    const r = validateSubmitRequest({ serviceKey: "home_cleaning", answers: { sqm: 70 } });
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.field).toBe("contact");
  });

  it("requires a contact email", () => {
    const r = validateSubmitRequest({
      serviceKey: "home_cleaning",
      answers: { sqm: 70 },
      cleaningPlanKey: "flexible",
      contact: { name: "No Email" },
    });
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.field).toBe("email");
  });

  it("rejects a malformed email", () => {
    const r = validateSubmitRequest({
      serviceKey: "home_cleaning",
      answers: { sqm: 70 },
      cleaningPlanKey: "flexible",
      contact: { email: "not-an-email" },
    });
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.field).toBe("email");
  });

  it("normalizes a valid email (trim + lowercase)", () => {
    const r = validateSubmitRequest({
      serviceKey: "home_cleaning",
      answers: { sqm: 70 },
      cleaningPlanKey: "flexible",
      contact: { email: "  Test@Example.COM " },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.contact.email).toBe("test@example.com");
  });

  it("never carries a client-sent price through validation (price is recomputed)", () => {
    const r = validateSubmitRequest({
      serviceKey: "home_cleaning",
      answers: { sqm: 70, bathrooms: 1, addons: ["oven"] },
      cleaningPlanKey: "flexible",
      contact: { email: "test@example.com" },
      calculatedPrice: 999999,
      price: 1,
      minPrice: 0,
      maxPrice: 0,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const value = r.value as unknown as Record<string, unknown>;
      expect("price" in value).toBe(false);
      expect("calculatedPrice" in value).toBe(false);
      expect("minPrice" in value).toBe(false);
    }
  });
});

describe("prepareSubmission — enabled gate (critical safety rule)", () => {
  it("writes NOTHING when the calculator is disabled (enabled=false)", () => {
    const prepared = prepareSubmission(buildSubmitParts({ enabled: false, request: homeRequest() }));
    expect(prepared.kind).toBe("disabled");
    expect(prepared.response.available).toBe(false);
    expect(prepared.response.status).toBe("not_available");
    expect(prepared.response.valid).toBe(false);
    expect(prepared.response.issues.map((i) => i.code)).toContain("calculator_disabled");
    expect(prepared.response.quoteRequestLegacyId).toBeNull();
    // The disabled outcome carries NO write payloads.
    expect("prospect" in prepared).toBe(false);
    expect("quoteRequest" in prepared).toBe(false);
    expect("answers" in prepared).toBe(false);
  });
});

describe("buildHoneypotSubmitResponse (bot honeypot — writes nothing)", () => {
  it("returns a benign accepted-looking response with NO real quote reference", () => {
    const response = buildHoneypotSubmitResponse("home_cleaning");
    // Looks accepted to a bot (no signal it was caught)...
    expect(response.ok).toBe(true);
    expect(response.available).toBe(true);
    expect(response.valid).toBe(true);
    expect(response.status).toBe("submitted");
    // ...but NOTHING was written, so there is no quote id / reference / figures.
    expect(response.quoteRequestLegacyId).toBeNull();
    expect(response.reference).toBeNull();
    expect(response.calculatedPrice).toBeNull();
    expect(response.minPrice).toBeNull();
    expect(response.maxPrice).toBeNull();
    expect(response.selectedPlan).toBeNull();
    // Carries a generic, internals-free confirmation.
    expect(response.nextStep?.confirmationText.length).toBeGreaterThan(0);
    expect(response.serviceKey).toBe("home_cleaning");
  });

  it("tolerates a null serviceKey", () => {
    expect(buildHoneypotSubmitResponse(null).serviceKey).toBeNull();
  });
});

describe("prepareSubmission — write payloads (enabled + valid)", () => {
  it("prepares prospect + quote_request + answers, recomputed server-side", () => {
    const prepared = prepareSubmission(buildSubmitParts({ request: homeRequest() }));
    expect(prepared.kind).toBe("ready");
    if (prepared.kind !== "ready") return;

    // Server-authoritative figures (bathrooms ignored, per-visit customer price incl. VAT).
    expect(prepared.response.priceExclVat).toBe(1200);
    expect(prepared.response.vatAmount).toBe(300);
    expect(prepared.response.calculatedPrice).toBe(1500);
    expect(prepared.response.minPrice).toBe(1312.5);
    expect(prepared.response.maxPrice).toBe(1625);
    expect(prepared.response.estimatedHours).toBe(3.4);
    expect(prepared.response.status).toBe("submitted");
    expect(prepared.response.valid).toBe(true);
    expect(prepared.response.validUntil).toBe(
      new Date(FIXED_NOW.getTime() + 30 * 86_400_000).toISOString(),
    );

    // Prospect insert payload.
    expect(prepared.prospect.mode).toBe("insert");
    expect(prepared.prospect.fields.email).toBe("test@example.com");
    expect(prepared.prospect.fields.prospect_status).toBe("new");
    expect(prepared.prospect.fields.source).toBe("price_calculator");

    // Quote request references the prospect by legacy id + carries the customer-facing price.
    expect(prepared.quoteRequest.fields.legacy_id).toBe(prepared.quoteRequest.legacyId);
    expect(prepared.quoteRequest.prospectLegacyId).toBe(prepared.prospect.legacyId);
    expect(prepared.quoteRequest.fields.prospect_legacy_id).toBe(prepared.prospect.legacyId);
    expect(prepared.quoteRequest.fields.calculated_price).toBe(1500);
    expect(prepared.quoteRequest.fields.status).toBe("submitted");
    expect(prepared.quoteRequest.fields.calculator_service_key).toBe("home_cleaning");

    // One answer per submitted answer key.
    expect(prepared.answers.length).toBe(3);
    expect(prepared.answers.map((a) => a.fields.question_key).sort()).toEqual([
      "addons",
      "bathrooms",
      "sqm",
    ]);
  });

  it("reuses an existing prospect by email and preserves its CRM status", () => {
    const existingProspect: ExistingProspect = {
      id: "prospect-existing-1",
      legacy_id: "prospect_existing",
      prospect_status: "qualified",
      name: "Existing Name",
      email: "test@example.com",
      phone: "0700111222",
      postal_code: "11122",
      source_url: "https://old.example/se",
    };
    const prepared = prepareSubmission(buildSubmitParts({ request: homeRequest(), existingProspect }));
    expect(prepared.kind).toBe("ready");
    if (prepared.kind !== "ready") return;
    expect(prepared.prospect.mode).toBe("update");
    expect(prepared.prospect.id).toBe("prospect-existing-1");
    expect(prepared.prospect.legacyId).toBe("prospect_existing");
    // NOT downgraded back to "new".
    expect(prepared.prospect.fields.prospect_status).toBe("qualified");
    // New contact values win.
    expect(prepared.prospect.fields.name).toBe("Test Customer");
    expect(prepared.quoteRequest.fields.prospect_legacy_id).toBe("prospect_existing");
  });

  it("rejects home cleaning without a cleaning plan (writes nothing)", () => {
    const prepared = prepareSubmission(
      buildSubmitParts({ request: homeRequest({ cleaningPlanKey: null, cleaningPlanId: null }) }),
    );
    expect(prepared.kind).toBe("invalid");
    expect(prepared.response.issues.map((i) => i.code)).toContain("missing_plan");
    expect(prepared.response.quoteRequestLegacyId).toBeNull();
  });

  it("accepts move-out cleaning WITHOUT a cleaning plan", () => {
    const prepared = prepareSubmission(
      buildSubmitParts({
        service: moveoutService,
        rules: moveoutRules,
        questions: moveoutQuestions,
        request: {
          serviceKey: "move_out_cleaning",
          answers: { sqm: 70 },
          cleaningPlanKey: null,
          cleaningPlanId: null,
          contact: { name: null, email: "test@example.com", phone: null, postalCode: null },
          sourceUrl: null,
        },
      }),
    );
    expect(prepared.kind).toBe("ready");
    if (prepared.kind !== "ready") return;
    expect(prepared.response.calculatedPrice).toBe(2450);
    expect(prepared.response.selectedPlan).toBeNull();
    expect(prepared.quoteRequest.fields.selected_cleaning_plan_id).toBeNull();
    expect(prepared.answers.length).toBe(1);
  });

  it("flags requires_manual_review when the price meets the threshold", () => {
    const prepared = prepareSubmission(
      buildSubmitParts({ request: homeRequest(), settingsOverrides: { manual_review_threshold_amount: 1000 } }),
    );
    expect(prepared.kind).toBe("ready");
    if (prepared.kind !== "ready") return;
    expect(prepared.response.requiresManualReview).toBe(true);
    expect(prepared.quoteRequest.fields.requires_manual_review).toBe(true);
  });

  it("does NOT flag manual review below the threshold", () => {
    const prepared = prepareSubmission(
      buildSubmitParts({ request: homeRequest(), settingsOverrides: { manual_review_threshold_amount: 50000 } }),
    );
    if (prepared.kind !== "ready") throw new Error("expected ready");
    expect(prepared.response.requiresManualReview).toBe(false);
    expect(prepared.quoteRequest.fields.requires_manual_review).toBe(false);
  });
});

describe("prepareSubmission — frozen snapshot + answer snapshots", () => {
  it("freezes a full pricing snapshot (formula, model, prices, plan, inputs, rules)", () => {
    const prepared = prepareSubmission(buildSubmitParts({ request: homeRequest() }));
    if (prepared.kind !== "ready") throw new Error("expected ready");
    const snap = prepared.quoteRequest.fields.pricing_snapshot_json as Record<string, unknown>;
    expect(snap.formulaVersion).toBe("v1");
    expect(snap.pricingModel).toBe("home_cleaning_recommended_hours");
    expect(snap.serviceKey).toBe("home_cleaning");
    expect(snap.priceExclVat).toBe(1200);
    expect(snap.vatAmount).toBe(300);
    expect(snap.priceInclVat).toBe(1500);
    expect(snap.calculatedPrice).toBe(1500);
    expect(snap.minPrice).toBe(1312.5);
    expect(snap.maxPrice).toBe(1625);
    expect(snap.estimatedHours).toBe(3.4);
    expect(snap.inputs).toEqual({ sqm: 70, bathrooms: 1, addons: ["oven"] });
    expect((snap.selectedPlanSnapshot as Record<string, unknown>).planKey).toBe("flexible");
    // Internal trace + every rule value used ARE persisted (admin-only truth).
    expect(Array.isArray(snap.ruleValues)).toBe(true);
    expect(Array.isArray(snap.steps)).toBe(true);
    expect((snap.ruleValues as unknown[]).length).toBe(homeRules.length);
  });

  it("freezes question label + input type onto known answers", () => {
    const prepared = prepareSubmission(buildSubmitParts({ request: homeRequest() }));
    if (prepared.kind !== "ready") throw new Error("expected ready");
    const sqmAnswer = prepared.answers.find((a) => a.fields.question_key === "sqm")!;
    expect(sqmAnswer.fields.question_label_snapshot).toBe("Boyta (m²)");
    expect(sqmAnswer.fields.input_type_snapshot).toBe("number");
    expect(sqmAnswer.fields.affects_pricing).toBe(true);
    expect(sqmAnswer.fields.answer_value_json).toEqual({ value: 70 });
  });
});

describe("prepareSubmission — office custom interval (manual review, priceless)", () => {
  /** A custom-interval office submit request (no automatic price expected). */
  function officeCustomRequest(): PublicSubmitRequest {
    return {
      serviceKey: "office_cleaning",
      answers: { sqm: 200, frequency: "custom_interval", toilets: 2 },
      cleaningPlanKey: null,
      cleaningPlanId: null,
      contact: { name: "Office Lead", email: "office@example.com", phone: null, postalCode: "11122" },
      sourceUrl: "https://stadportalen.se/rakna-ut-ditt-pris",
    };
  }

  it("persists a priceless, manual-review quote (NULL prices) the visitor can still submit", () => {
    const prepared = prepareSubmission(
      buildSubmitParts({
        service: officeService,
        rules: officeRules,
        questions: officeQuestions,
        request: officeCustomRequest(),
      }),
    );
    // The visitor IS accepted (we can follow up) even with no automatic price.
    expect(prepared.kind).toBe("ready");
    if (prepared.kind !== "ready") return;
    expect(prepared.response.requiresManualReview).toBe(true);
    expect(prepared.response.calculatedPrice).toBeNull();
    expect(prepared.response.minPrice).toBeNull();
    expect(prepared.response.maxPrice).toBeNull();
    expect(prepared.response.displayText).toBe("");
    // Quote row: NULL price fields + requires_manual_review=true.
    expect(prepared.quoteRequest.fields.requires_manual_review).toBe(true);
    expect(prepared.quoteRequest.fields.calculated_price).toBeNull();
    expect(prepared.quoteRequest.fields.min_price).toBeNull();
    expect(prepared.quoteRequest.fields.calculator_service_key).toBe("office_cleaning");
    // The snapshot records the reason but it is NOT in the public response.
    const snap = prepared.quoteRequest.fields.pricing_snapshot_json as Record<string, unknown>;
    expect(snap.manualReviewReason).toBe("custom_interval");
    expect(snap.calculatedPrice).toBeNull();
    // Answers are still frozen so the office details reach the inbox.
    expect(prepared.answers.map((a) => a.fields.question_key).sort()).toEqual([
      "frequency",
      "sqm",
      "toilets",
    ]);
  });

  it("a dark calculator still writes NOTHING for a custom-interval submit", () => {
    const prepared = prepareSubmission(
      buildSubmitParts({
        enabled: false,
        service: officeService,
        rules: officeRules,
        questions: officeQuestions,
        request: officeCustomRequest(),
      }),
    );
    expect(prepared.kind).toBe("disabled");
    expect(prepared.response.available).toBe(false);
    expect("quoteRequest" in prepared).toBe(false);
  });

  it("the manual-review public response leaks no internal pricing data", () => {
    const prepared = prepareSubmission(
      buildSubmitParts({
        service: officeService,
        rules: officeRules,
        questions: officeQuestions,
        request: officeCustomRequest(),
      }),
    );
    if (prepared.kind !== "ready") throw new Error("expected ready");
    const wire = JSON.stringify(prepared.response);
    expect(wire).not.toContain("manual_review"); // snake-case write field never on the wire
    expect(wire).not.toContain("manualReviewReason");
    expect(wire).not.toContain("ruleValues");
    expect(wire).not.toContain("supervision_start_minutes");
  });
});

describe("prepareSubmission — public response safety", () => {
  it("leaks no uuids, rule keys, raw trace, or service-role data", () => {
    const prepared = prepareSubmission(buildSubmitParts({ request: homeRequest() }));
    if (prepared.kind !== "ready") throw new Error("expected ready");
    const wire = JSON.stringify(prepared.response);
    expect(wire).not.toContain("comp-uuid-1"); // company uuid
    expect(wire).not.toContain("cmp_o2f6orw29m"); // company legacy id
    expect(wire).not.toContain("plan-flex"); // plan uuid
    expect(wire).not.toContain("hours_per_sqm"); // pricing-rule key
    expect(wire).not.toContain("ruleValues");
    expect(wire).not.toContain("steps");
    expect(wire).not.toContain("rawPrice");
    expect(wire).not.toContain("manual_review");
    // The prospect identifiers never cross the wire...
    expect(wire).not.toContain(prepared.prospect.legacyId);
    // ...but the intentionally-public quote LEGACY id does.
    expect(prepared.response.quoteRequestLegacyId).toContain("qr_");
  });
});
