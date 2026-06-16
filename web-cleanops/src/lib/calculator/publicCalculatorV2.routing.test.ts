import { describe, expect, it } from "vitest";

/**
 * GENERIC PUBLIC RUNTIME ROUTING GUARD — `sqm_fixed` only (Slice GPM-5b-1).
 *
 * Exercises the PURE routing predicate `shouldRouteServiceToV2` + the structured
 * readiness helper `assessGenericServiceRuntimeReadiness`, plus the SAME V2 cores
 * (`runCalculationV2Home` / `prepareSubmissionV2Home`) pricing a LITERAL generic
 * `sqm_fixed` service through DB-style rows — the shapes the public-calculator Edge
 * Function loads with the service role. It proves the locked GPM-5b-1 behaviour:
 *   • Home still routes to V2 via the pilot allowlist (regardless of generic readiness).
 *   • A public/ready LITERAL `sqm_fixed` service routes to V2 and prices m²-based.
 *   • A draft/non-public, plan-less, or price-less generic service does NOT route.
 *   • Legacy service-named models that ALIAS to sqm_fixed (move_out_fixed_plus_addons)
 *     and Office/hourly/unsupported models do NOT newly route — no alias routing.
 *   • A routed sqm_fixed calculate/submit reports pricing_model "sqm_fixed" + formula v2.
 *
 * The adapter is imported from the Deno mirror with an explicit `.ts` extension; it is
 * pure (no Deno runtime imports), so it runs unchanged under vitest.
 */
import {
  assessGenericServiceRuntimeReadiness,
  prepareSubmissionV2Home,
  runCalculationV2Home,
  shouldRouteServiceToV2,
  V2_ENABLED_SERVICE_KEYS,
  type RunCalculationV2HomeParts,
  type StoredPricingSnapshotV2,
  type SubmitV2HomeParts,
} from "../../../supabase/functions/_shared/calculator/publicCalculatorV2.ts";
import type {
  CalculatorQuestionRow,
  CalculatorServiceRow,
  CalculatorSettingsRow,
  CleaningPlanRow,
  PreparedSubmission,
  PricingRuleRow,
  PublicCalculateRequest,
  PublicSubmitRequest,
} from "../../../supabase/functions/_shared/calculator/types.ts";
import type { PlanRowV2 } from "../../../supabase/functions/_shared/calculator/v2/index.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** A move-out style sqm_fixed service (admin-created generic). */
const SQM_SERVICE_KEY = "moveout_generic";

type SqmPlanRow = CleaningPlanRow & PlanRowV2;
type Settings = RunCalculationV2HomeParts["settings"];

function buildCalcSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    currency: "SEK",
    price_display_mode: "range",
    enabled: true,
    default_vat_rate_percent: 25,
    ...overrides,
  };
}

/** Public/enabled LITERAL sqm_fixed service. */
function buildSqmService(overrides: Partial<CalculatorServiceRow> = {}): CalculatorServiceRow {
  return {
    id: "svc-moveout",
    service_key: SQM_SERVICE_KEY,
    display_name: "Flyttstädning",
    description: null,
    enabled: true,
    coming_soon: false,
    pricing_model: "sqm_fixed",
    sort_order: 0,
    settings_json: { displayRoundingInterval: 10 },
    ...overrides,
  };
}

/** Active sqm_fixed plan with a positive price per m² (hourly_rate=0 sentinel, per GPM-4c-1). */
function buildSqmPlan(overrides: Partial<SqmPlanRow> = {}): SqmPlanRow {
  return {
    id: "plan-normal",
    plan_key: "normal",
    name: "Normalt skick",
    description: null,
    calculator_service_id: "svc-moveout",
    service_key: SQM_SERVICE_KEY,
    hourly_rate: 0,
    vat_rate_percent: 25,
    rut_eligible: false,
    rut_enabled: false,
    rut_percent: 50,
    flexibility_level: null,
    customer_day_time_control: null,
    same_staff_preference_level: null,
    booking_priority: null,
    cancellation_terms_summary: null,
    is_default: true,
    sort_order: 0,
    start_adjustment_hours: null,
    price_per_sqm_excl_vat: 48,
    fixed_adjustment_excl_vat: null,
    minimum_price_excl_vat: null,
    ...overrides,
  };
}

/** A legacy Home service (the V2 pilot) for the pilot-routing assertions. */
function buildHomeService(overrides: Partial<CalculatorServiceRow> = {}): CalculatorServiceRow {
  return {
    id: "svc-home",
    service_key: "home_cleaning",
    display_name: "Hemstädning",
    description: null,
    enabled: true,
    coming_soon: false,
    pricing_model: "home_cleaning_recommended_hours",
    sort_order: 0,
    settings_json: { displayRoundingInterval: 10 },
    ...overrides,
  };
}

function buildSqmRequest(overrides: Partial<PublicCalculateRequest> = {}): PublicCalculateRequest {
  return {
    serviceKey: SQM_SERVICE_KEY,
    answers: { sqm: 80 },
    cleaningPlanKey: null,
    ...overrides,
  };
}

/** Runs the V2 calculate core for the sqm_fixed service (the routed-calculate path). */
function runSqm(parts: Partial<RunCalculationV2HomeParts> = {}) {
  return runCalculationV2Home({
    settings: buildCalcSettings(),
    service: buildSqmService(),
    plans: [buildSqmPlan()],
    rules: [],
    addons: [],
    request: buildSqmRequest(),
    addonSelections: {},
    ...parts,
  });
}

// ── shouldRouteServiceToV2 / assessGenericServiceRuntimeReadiness ───────────────

describe("shouldRouteServiceToV2 — Home pilot (unchanged)", () => {
  it("routes Home to V2 via the pilot allowlist regardless of generic readiness", () => {
    expect(
      shouldRouteServiceToV2({
        service: buildHomeService(),
        serviceKey: "home_cleaning",
        plans: [],
        rules: [],
      }),
    ).toBe(true);
  });

  it("keeps V2_ENABLED_SERVICE_KEYS exactly home_cleaning (no generic key added)", () => {
    expect([...V2_ENABLED_SERVICE_KEYS]).toEqual(["home_cleaning"]);
  });
});

describe("shouldRouteServiceToV2 — literal generic sqm_fixed", () => {
  it("routes a public/ready literal sqm_fixed service to V2", () => {
    const decision = shouldRouteServiceToV2({
      service: buildSqmService(),
      serviceKey: SQM_SERVICE_KEY,
      plans: [buildSqmPlan()],
      rules: [],
    });
    expect(decision).toBe(true);
  });

  it("reports reason 'ok' + basis 'sqm_fixed' for a ready service", () => {
    const readiness = assessGenericServiceRuntimeReadiness({
      service: buildSqmService(),
      plans: [buildSqmPlan()],
      rules: [],
    });
    expect(readiness).toEqual({ ready: true, reason: "ok", basis: "sqm_fixed" });
  });

  it("routes a coming_soon (not yet enabled) sqm_fixed service with a valid plan", () => {
    const readiness = assessGenericServiceRuntimeReadiness({
      service: buildSqmService({ enabled: false, coming_soon: true }),
      plans: [buildSqmPlan()],
      rules: [],
    });
    expect(readiness.ready).toBe(true);
    expect(readiness.reason).toBe("ok");
  });
});

describe("shouldRouteServiceToV2 — security: draft/non-public never routes", () => {
  it("does NOT route a draft (disabled + not coming_soon) sqm_fixed service", () => {
    const readiness = assessGenericServiceRuntimeReadiness({
      service: buildSqmService({ enabled: false, coming_soon: false }),
      plans: [buildSqmPlan()],
      rules: [],
    });
    expect(readiness.ready).toBe(false);
    expect(readiness.reason).toBe("not_public");
    expect(
      shouldRouteServiceToV2({
        service: buildSqmService({ enabled: false, coming_soon: false }),
        serviceKey: SQM_SERVICE_KEY,
        plans: [buildSqmPlan()],
        rules: [],
      }),
    ).toBe(false);
  });
});

describe("shouldRouteServiceToV2 — unready generic services do not route", () => {
  it("does NOT route a sqm_fixed service with no active plan", () => {
    const readiness = assessGenericServiceRuntimeReadiness({
      service: buildSqmService(),
      plans: [buildSqmPlan({ active: false })],
      rules: [],
    });
    expect(readiness.ready).toBe(false);
    expect(readiness.reason).toBe("no_active_plan");
  });

  it("does NOT route a sqm_fixed service whose default plan has no positive price per m²", () => {
    const nullPrice = assessGenericServiceRuntimeReadiness({
      service: buildSqmService(),
      plans: [buildSqmPlan({ price_per_sqm_excl_vat: null })],
      rules: [],
    });
    expect(nullPrice).toEqual({ ready: false, reason: "missing_price_per_sqm", basis: null });

    const zeroPrice = assessGenericServiceRuntimeReadiness({
      service: buildSqmService(),
      plans: [buildSqmPlan({ price_per_sqm_excl_vat: 0 })],
      rules: [],
    });
    expect(zeroPrice.ready).toBe(false);
    expect(zeroPrice.reason).toBe("missing_price_per_sqm");
  });

  it("returns reason 'no_service' when no service matched", () => {
    expect(assessGenericServiceRuntimeReadiness({ service: null, plans: [], rules: [] })).toEqual({
      ready: false,
      reason: "no_service",
      basis: null,
    });
    expect(
      shouldRouteServiceToV2({ service: null, serviceKey: SQM_SERVICE_KEY, plans: [], rules: [] }),
    ).toBe(false);
  });
});

describe("shouldRouteServiceToV2 — no alias routing for legacy / unsupported models", () => {
  it("does NOT newly route legacy move_out_fixed_plus_addons (aliases to sqm_fixed)", () => {
    const readiness = assessGenericServiceRuntimeReadiness({
      service: buildSqmService({
        service_key: "move_out_cleaning",
        pricing_model: "move_out_fixed_plus_addons",
      }),
      plans: [buildSqmPlan({ service_key: "move_out_cleaning" })],
      rules: [],
    });
    expect(readiness.ready).toBe(false);
    expect(readiness.reason).toBe("not_literal_sqm_fixed");
    expect(
      shouldRouteServiceToV2({
        service: buildSqmService({
          service_key: "move_out_cleaning",
          pricing_model: "move_out_fixed_plus_addons",
        }),
        serviceKey: "move_out_cleaning",
        plans: [buildSqmPlan({ service_key: "move_out_cleaning" })],
        rules: [],
      }),
    ).toBe(false);
  });

  it("does NOT route legacy office_cleaning_recurring_area_frequency", () => {
    expect(
      shouldRouteServiceToV2({
        service: buildSqmService({
          service_key: "office_cleaning",
          pricing_model: "office_cleaning_recurring_area_frequency",
        }),
        serviceKey: "office_cleaning",
        plans: [],
        rules: [],
      }),
    ).toBe(false);
  });

  it("does NOT route hourly_by_area / unit_based / fixed_package / manual_quote in this slice", () => {
    for (const model of ["hourly_by_area", "unit_based", "fixed_package", "manual_quote"]) {
      const readiness = assessGenericServiceRuntimeReadiness({
        service: buildSqmService({ pricing_model: model }),
        plans: [buildSqmPlan()],
        rules: [],
      });
      expect(readiness.ready).toBe(false);
      expect(readiness.reason).toBe("not_literal_sqm_fixed");
    }
  });
});

// ── Routed calculate (sqm_fixed) ────────────────────────────────────────────────

describe("runCalculationV2Home — routed sqm_fixed calculate", () => {
  it("prices 80 m² × 48 kr/m² = 3840 excl VAT, reports sqm_fixed + formula v2", () => {
    const res = runSqm();
    expect(res.valid).toBe(true);
    expect(res.pricingModel).toBe("sqm_fixed");
    expect(res.formulaVersion).toBe("v2");
    expect(res.v2?.pricingBasis).toBe("sqm_fixed");
    expect(res.v2?.rawPriceExclVat).toBe(3840);
    // one-off (no frequency answer) → four-week multiplier is 1, so no scaling.
    expect(res.v2?.visitsPerFourWeeks).toBe(1);
    expect(res.priceExclVat).toBe(3840);
    // VAT 25 %, RUT off → customer price = 3840 × 1.25.
    expect(res.calculatedPrice).toBe(round2(3840 * 1.25)); // 4800
    expect(res.selectedPlan?.planKey).toBe("normal");
    // sqm_fixed has no m² time config, so there is no service-time estimate.
    expect(res.estimatedHours).toBeNull();
  });

  it("missing/invalid sqm → valid:false with null price (does not calculate)", () => {
    const missing = runSqm({ request: buildSqmRequest({ answers: {} }) });
    expect(missing.valid).toBe(false);
    expect(missing.calculatedPrice).toBeNull();
    expect(missing.priceExclVat).toBeNull();

    const zero = runSqm({ request: buildSqmRequest({ answers: { sqm: 0 } }) });
    expect(zero.valid).toBe(false);
    expect(zero.calculatedPrice).toBeNull();
  });
});

// ── Routed submit (sqm_fixed) ───────────────────────────────────────────────────

const FIXED_NOW = new Date("2026-06-08T12:00:00.000Z");

function makeNewId(): (prefix: string) => string {
  let n = 0;
  return (prefix) => `${prefix}_test_${++n}`;
}

function buildSubmitSettings(overrides: Partial<CalculatorSettingsRow> = {}): CalculatorSettingsRow {
  return {
    id: "settings-1",
    company_id: "company-1",
    company_legacy_id: "company_legacy_1",
    enabled: true,
    public_slug: "stadportalen",
    price_display_mode: "range",
    show_price_before_contact: true,
    require_contact_before_result: false,
    show_login_prompt_after_submit: true,
    quote_validity_days: 30,
    currency: "SEK",
    rut_display_mode: "after",
    default_vat_rate_percent: 25,
    content: { quoteCreatedText: "Tack!" },
    manual_review_threshold_amount: 100000,
    default_quote_status: "submitted",
    ...overrides,
  };
}

function buildSubmitQuestions(): CalculatorQuestionRow[] {
  return [
    {
      id: "q-sqm",
      calculator_service_id: "svc-moveout",
      question_key: "sqm",
      label: "Hur många kvadratmeter?",
      help_text: null,
      input_type: "number",
      required: true,
      options_json: [],
      validation_json: {},
      sort_order: 0,
      affects_pricing: true,
    },
  ];
}

function buildSqmSubmitRequest(overrides: Partial<PublicSubmitRequest> = {}): PublicSubmitRequest {
  return {
    serviceKey: SQM_SERVICE_KEY,
    answers: { sqm: 80 },
    cleaningPlanKey: null,
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

function buildSqmSubmitParts(overrides: Partial<SubmitV2HomeParts> = {}): SubmitV2HomeParts {
  return {
    settings: buildSubmitSettings(),
    service: buildSqmService(),
    plans: [buildSqmPlan()],
    rules: [],
    questions: buildSubmitQuestions(),
    request: buildSqmSubmitRequest(),
    existingProspect: null,
    now: FIXED_NOW,
    newId: makeNewId(),
    addons: [],
    addonSelections: {},
    ...overrides,
  };
}

function snapshotOf(prepared: Extract<PreparedSubmission, { kind: "ready" }>): StoredPricingSnapshotV2 {
  return prepared.quoteRequest.fields.pricing_snapshot_json as StoredPricingSnapshotV2;
}

describe("prepareSubmissionV2Home — routed sqm_fixed submit", () => {
  it("freezes a priced sqm_fixed quote stamped pricing_model 'sqm_fixed' + formula v2", () => {
    const prepared = prepareSubmissionV2Home(buildSqmSubmitParts());
    expect(prepared.kind).toBe("ready");
    if (prepared.kind !== "ready") return;

    const fields = prepared.quoteRequest.fields;
    expect(fields.formula_version).toBe("v2");
    expect(fields.pricing_model).toBe("sqm_fixed");
    expect(fields.calculated_price).toBe(round2(3840 * 1.25)); // 4800
    expect(fields.calculator_service_key).toBe(SQM_SERVICE_KEY);

    const snapshot = snapshotOf(prepared);
    expect(snapshot.formulaVersion).toBe("v2");
    expect(snapshot.pricingModel).toBe("sqm_fixed");
    expect(snapshot.pricingBasis).toBe("sqm_fixed");
    expect(snapshot.rawPriceExclVat).toBe(3840);
    expect(snapshot.selectedPlanKey).toBe("normal");
  });

  it("a dark calculator (settings.enabled=false) writes NOTHING (critical safety rule)", () => {
    const prepared = prepareSubmissionV2Home(
      buildSqmSubmitParts({ settings: buildSubmitSettings({ enabled: false }) }),
    );
    expect(prepared.kind).toBe("disabled");
  });

  it("missing sqm → invalid submit, writes NOTHING", () => {
    const prepared = prepareSubmissionV2Home(
      buildSqmSubmitParts({ request: buildSqmSubmitRequest({ answers: {} }) }),
    );
    expect(prepared.kind).toBe("invalid");
  });
});
