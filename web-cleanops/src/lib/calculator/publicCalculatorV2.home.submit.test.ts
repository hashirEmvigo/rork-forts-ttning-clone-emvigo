import { describe, expect, it } from "vitest";

/**
 * HOME CLEANING V2 SUBMIT PARITY (Slice V2-E2b).
 *
 * Exercises the PURE Edge submit adapter `prepareSubmissionV2Home` through DB-style rows
 * — the same shapes the public-calculator Edge Function loads with the service role — and
 * proves the locked V2-E2b behaviour:
 *   • Home submit prices through the SAME V2 core as calculate (`runCalculationV2Home`),
 *     so the frozen snapshot can never diverge from the public quote.
 *   • The quote row + snapshot are stamped formula_version / formulaVersion = "v2".
 *   • `estimated_hours` is the per-visit SERVICE time (estimatedServiceHours), NOT pricingHours.
 *   • start_adjustment_hours is price-only; addonMinutes raises service time; fixed applies
 *     before percent; percent is net-additive applied once; four-week total = per-visit × visits.
 *   • Generic add-ons come ONLY from calculator_addons / answers.addonSelections; legacy
 *     answers.addons / has_pets and legacy pricing rules are ignored.
 *   • The frozen snapshot stays compatible with the Admin request view (`extractSnapshotSummary`).
 *   • The critical safety rule holds: a dark calculator (enabled=false) writes NOTHING.
 *
 * The adapter is imported from the Deno mirror with an explicit `.ts` extension; it is pure
 * (no Deno runtime imports), so it runs unchanged under vitest.
 */
import {
  prepareSubmissionV2Home,
  runCalculationV2Home,
  V2_ENABLED_SERVICE_KEYS,
  type CalculatorAddonRowV2,
  type RunCalculationV2HomeParts,
  type StoredPricingSnapshotV2,
  type SubmitV2HomeParts,
} from "../../../supabase/functions/_shared/calculator/publicCalculatorV2.ts";
import type {
  CalculatorQuestionRow,
  CalculatorServiceRow,
  CalculatorSettingsRow,
  CleaningPlanRow,
  ExistingProspect,
  PreparedSubmission,
  PricingRuleRow,
  PublicSubmitRequest,
} from "../../../supabase/functions/_shared/calculator/types.ts";
import type {
  AddonSelectionsV2,
  PlanRowV2,
} from "../../../supabase/functions/_shared/calculator/v2/index.ts";
import { extractSnapshotSummary } from "./calculatorQuoteRequests";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Rounds to öre (2 decimals) — mirrors the engine/adapter round2 for exact expected values. */
const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** Per-visit base raw (no add-ons): 100 m² → 3.6 h service, −0.25 start adj → 3.35 pricing h × 410. */
const BASE_PER_VISIT_RAW = round2(3.35 * 410); // 1373.50
const FOUR_WEEK_RAW = round2(BASE_PER_VISIT_RAW * 4); // 5494.00

const FIXED_NOW = new Date("2026-06-08T12:00:00.000Z");

type HomePlanRow = CleaningPlanRow & PlanRowV2;

/** Deterministic, monotonic id generator so payload legacy_ids are assertable. */
function makeNewId(): (prefix: string) => string {
  let n = 0;
  return (prefix) => `${prefix}_test_${++n}`;
}

/** FULL settings row incl. the submission-behaviour columns the submit path reads. */
function buildSettings(overrides: Partial<CalculatorSettingsRow> = {}): CalculatorSettingsRow {
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
    content: {
      quoteCreatedText: "Tack! Din förfrågan är mottagen.",
      loginPromptText: "Skapa ett konto för att följa din förfrågan.",
    },
    manual_review_threshold_amount: 100000,
    default_quote_status: "submitted",
    ...overrides,
  };
}

function buildService(overrides: Partial<CalculatorServiceRow> = {}): CalculatorServiceRow {
  return {
    id: "svc-home",
    service_key: "home_cleaning",
    display_name: "Hemstädning",
    description: null,
    enabled: true,
    coming_soon: false,
    pricing_model: "home_cleaning_recommended_hours",
    sort_order: 0,
    settings_json: {
      displayRoundingInterval: 10,
      homeSqmAdjustments: [{ fromSqm: 0, toSqm: null, adjustmentPercent: -10 }],
    },
    ...overrides,
  };
}

function buildPlan(overrides: Partial<HomePlanRow> = {}): HomePlanRow {
  return {
    id: "plan-flex",
    plan_key: "flexible",
    name: "Flexibel",
    description: null,
    calculator_service_id: "svc-home",
    service_key: "home_cleaning",
    hourly_rate: 410,
    vat_rate_percent: 25,
    rut_eligible: true,
    rut_enabled: true,
    rut_percent: 50,
    flexibility_level: null,
    customer_day_time_control: null,
    same_staff_preference_level: null,
    booking_priority: null,
    cancellation_terms_summary: null,
    is_default: true,
    sort_order: 0,
    start_adjustment_hours: -0.25,
    price_per_sqm_excl_vat: null,
    fixed_adjustment_excl_vat: null,
    minimum_price_excl_vat: null,
    ...overrides,
  };
}

/** Home V2 m² time + margin rules (0.04 h/m² → 2.4 min/m²; min 2 h; range 5/10 %). */
function buildRules(extra: PricingRuleRow[] = []): PricingRuleRow[] {
  return [
    { id: "r1", rule_key: "hours_per_sqm", rule_type: "numeric_factor", value_numeric: 0.04 },
    { id: "r2", rule_key: "minimum_hours", rule_type: "threshold", value_numeric: 2 },
    { id: "r3", rule_key: "range_min_percent", rule_type: "margin_percent", value_numeric: 5 },
    { id: "r4", rule_key: "range_max_percent", rule_type: "margin_percent", value_numeric: 10 },
    ...extra,
  ];
}

function buildQuestions(): CalculatorQuestionRow[] {
  return [
    {
      id: "q-sqm",
      calculator_service_id: "svc-home",
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
    {
      id: "q-freq",
      calculator_service_id: "svc-home",
      question_key: "frequency",
      label: "Hur ofta?",
      help_text: null,
      input_type: "select",
      required: true,
      options_json: [],
      validation_json: {},
      sort_order: 1,
      affects_pricing: true,
    },
  ];
}

function buildRequest(overrides: Partial<PublicSubmitRequest> = {}): PublicSubmitRequest {
  return {
    serviceKey: "home_cleaning",
    answers: { sqm: 100, frequency: "weekly" },
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

function buildAddon(overrides: Partial<CalculatorAddonRowV2>): CalculatorAddonRowV2 {
  return {
    addon_key: "x",
    name: "X",
    public_label: "X?",
    description: null,
    input_type: "boolean",
    boolean_default: false,
    quantity_min: 0,
    quantity_max: null,
    quantity_step: 1,
    quantity_default: 0,
    effect_time_minutes: 0,
    effect_fixed_excl_vat: 0,
    effect_percent: 0,
    active: true,
    public_visible: true,
    required: false,
    sort_order: 0,
    ...overrides,
  };
}

function buildSubmitParts(overrides: Partial<SubmitV2HomeParts> = {}): SubmitV2HomeParts {
  return {
    settings: buildSettings(),
    service: buildService(),
    plans: [buildPlan()],
    rules: buildRules(),
    questions: buildQuestions(),
    request: buildRequest(),
    existingProspect: null,
    now: FIXED_NOW,
    newId: makeNewId(),
    addons: [],
    addonSelections: {},
    ...overrides,
  };
}

/** Runs the calculate core directly (the parity reference) with the Pick settings subset. */
function runCalc(
  overrides: Partial<RunCalculationV2HomeParts> = {},
): ReturnType<typeof runCalculationV2Home> {
  return runCalculationV2Home({
    settings: buildSettings(),
    service: buildService(),
    plans: [buildPlan()],
    rules: buildRules(),
    addons: [],
    request: buildRequest(),
    addonSelections: {},
    ...overrides,
  });
}

/** Convenience: runs submit prep and returns the `ready` outcome (or fails the test). */
function runReady(overrides: Partial<SubmitV2HomeParts> = {}) {
  const prepared = prepareSubmissionV2Home(buildSubmitParts(overrides));
  if (prepared.kind !== "ready") {
    throw new Error(`expected ready, got ${prepared.kind}`);
  }
  return prepared;
}

/** Reads the frozen snapshot off a ready quote payload. */
function snapshotOf(prepared: Extract<PreparedSubmission, { kind: "ready" }>): StoredPricingSnapshotV2 {
  return prepared.quoteRequest.fields.pricing_snapshot_json as StoredPricingSnapshotV2;
}

// ── Calculate / submit parity ──────────────────────────────────────────────────

describe("prepareSubmissionV2Home — calculate/submit parity", () => {
  it("submit figures match the calculate result field-for-field (same V2 core)", () => {
    const calc = runCalc();
    const prepared = runReady();

    expect(prepared.response.calculatedPrice).toBe(calc.calculatedPrice);
    expect(prepared.response.minPrice).toBe(calc.minPrice);
    expect(prepared.response.maxPrice).toBe(calc.maxPrice);
    expect(prepared.response.priceExclVat).toBe(calc.priceExclVat);
    expect(prepared.response.estimatedHours).toBe(calc.estimatedHours);
    expect(prepared.response.formulaVersion).toBe("v2");
    expect(prepared.response.selectedPlan).toEqual(calc.selectedPlan);
  });

  it("the frozen quote row + snapshot match the calculate result", () => {
    const calc = runCalc();
    const prepared = runReady();
    const fields = prepared.quoteRequest.fields;
    const snap = snapshotOf(prepared);

    expect(fields.calculated_price).toBe(calc.calculatedPrice);
    expect(fields.min_price).toBe(calc.minPrice);
    expect(fields.max_price).toBe(calc.maxPrice);
    expect(fields.estimated_hours).toBe(calc.estimatedHours);

    expect(snap.calculatedPrice).toBe(calc.calculatedPrice);
    expect(snap.minPrice).toBe(calc.minPrice);
    expect(snap.maxPrice).toBe(calc.maxPrice);
    expect(snap.estimatedHours).toBe(calc.estimatedHours);
  });

  it("add-on input produces the same priced result on calculate and submit", () => {
    const dog = buildAddon({ addon_key: "dog", effect_time_minutes: 30 });
    const calc = runCalc({ addons: [dog], addonSelections: { dog: true } });
    const prepared = runReady({ addons: [dog], addonSelections: { dog: true } });

    expect(prepared.response.calculatedPrice).toBe(calc.calculatedPrice);
    expect(prepared.response.estimatedHours).toBe(calc.estimatedHours);
    expect(snapshotOf(prepared).addonMinutes).toBe(calc.v2?.addonMinutes);
  });
});

// ── Home submit V2 behaviour ─────────────────────────────────────────────────────

describe("prepareSubmissionV2Home — V2 stamping + service-time", () => {
  it("stamps formula_version 'v2' on the quote row and the snapshot", () => {
    const prepared = runReady();
    expect(prepared.quoteRequest.fields.formula_version).toBe("v2");
    expect(snapshotOf(prepared).formulaVersion).toBe("v2");
    expect(prepared.response.formulaVersion).toBe("v2");
  });

  it("estimated_hours is the per-visit service time, never pricingHours", () => {
    const prepared = runReady();
    const snap = snapshotOf(prepared);
    expect(prepared.quoteRequest.fields.estimated_hours).toBe(3.6);
    expect(snap.estimatedServiceHours).toBe(3.6);
    expect(snap.pricingHours).toBe(3.35);
    expect(prepared.quoteRequest.fields.estimated_hours).not.toBe(snap.pricingHours);
  });

  it("start_adjustment_hours affects the submit price only (service time unchanged)", () => {
    const withAdj = runReady({ plans: [buildPlan({ start_adjustment_hours: -0.25 })] });
    const noAdj = runReady({ plans: [buildPlan({ start_adjustment_hours: 0 })] });

    expect(withAdj.quoteRequest.fields.estimated_hours).toBe(3.6);
    expect(noAdj.quoteRequest.fields.estimated_hours).toBe(3.6);
    expect(snapshotOf(withAdj).rawPriceExclVat).toBe(round2(3.35 * 410)); // 1373.50
    expect(snapshotOf(noAdj).rawPriceExclVat).toBe(round2(3.6 * 410)); // 1476.00
    expect(withAdj.quoteRequest.fields.calculated_price).not.toBe(
      noAdj.quoteRequest.fields.calculated_price,
    );
  });

  it("four-week total = per-visit raw × visitsPerFourWeeks", () => {
    const prepared = runReady();
    const snap = snapshotOf(prepared);
    expect(snap.visitsPerFourWeeks).toBe(4);
    expect(snap.rawPriceExclVat).toBe(BASE_PER_VISIT_RAW);
    expect(snap.fourWeekRawExclVat).toBe(FOUR_WEEK_RAW);
    expect(prepared.response.priceExclVat).toBe(FOUR_WEEK_RAW);
  });

  it("weekly / biweekly / every_four_weeks scale the submit four-week price", () => {
    const cases: [string, number][] = [
      ["weekly", 4],
      ["biweekly", 2],
      ["every_four_weeks", 1],
    ];
    for (const [frequency, visits] of cases) {
      const prepared = runReady({ request: buildRequest({ answers: { sqm: 100, frequency } }) });
      expect(snapshotOf(prepared).visitsPerFourWeeks).toBe(visits);
      expect(prepared.quoteRequest.fields.calculated_price).toBe(
        runCalc({ request: buildRequest({ answers: { sqm: 100, frequency } }) }).calculatedPrice,
      );
    }
  });

  it("roundingIncrement/displayRoundingInterval come from settings_json (match calculate)", () => {
    const prepared = runReady();
    expect(prepared.response.roundingIncrement).toBe(10);
    expect(snapshotOf(prepared).displayRoundingInterval).toBe(10);
  });

  it("ignores legacy pricing_rules.rounding_increment on the submit path", () => {
    const prepared = runReady({
      rules: buildRules([
        { id: "rr", rule_key: "rounding_increment", rule_type: "rounding", value_numeric: 50 },
      ]),
    });
    expect(prepared.response.roundingIncrement).toBe(10); // not 50
    expect(snapshotOf(prepared).displayRoundingInterval).toBe(10);
  });
});

// ── Add-on effects on submit ─────────────────────────────────────────────────────

describe("prepareSubmissionV2Home — add-on effects + traceability", () => {
  it("addonMinutes raises the submit estimated service time", () => {
    const dog = buildAddon({ addon_key: "dog", effect_time_minutes: 30 });
    const prepared = runReady({ addons: [dog], addonSelections: { dog: true } });
    expect(snapshotOf(prepared).addonMinutes).toBe(30);
    expect(prepared.quoteRequest.fields.estimated_hours).toBe(4.1); // 216 + 30 = 246 min
  });

  it("addonFixedExclVat applies BEFORE addonPercent", () => {
    const fixed = buildAddon({ addon_key: "oven", effect_fixed_excl_vat: 250 });
    const percent = buildAddon({ addon_key: "dirty", effect_percent: 15 });
    const prepared = runReady({
      addons: [fixed, percent],
      addonSelections: { oven: true, dirty: true },
    });
    const snap = snapshotOf(prepared);
    expect(snap.rawPriceExclVat).toBe(round2((3.35 * 410 + 250) * 1.15));
    expect(snap.rawPriceExclVat).not.toBe(round2(3.35 * 410 * 1.15 + 250));
  });

  it("addonPercent is net additive (+15 and −10 → +5) applied once", () => {
    const up = buildAddon({ addon_key: "up", effect_percent: 15 });
    const down = buildAddon({ addon_key: "down", effect_percent: -10 });
    const prepared = runReady({ addons: [up, down], addonSelections: { up: true, down: true } });
    const snap = snapshotOf(prepared);
    expect(snap.addonPercent).toBe(5);
    expect(snap.rawPriceExclVat).toBe(round2(3.35 * 410 * 1.05));
  });

  it("negative fixed discount lowers the submit price", () => {
    const disc = buildAddon({ addon_key: "disc", effect_fixed_excl_vat: -100 });
    const prepared = runReady({ addons: [disc], addonSelections: { disc: true } });
    expect(snapshotOf(prepared).addonFixedExclVat).toBe(-100);
    expect(snapshotOf(prepared).rawPriceExclVat).toBe(round2(3.35 * 410 - 100));
  });

  it("stores normalized add-on selections + resolved effect lines in the snapshot", () => {
    const bathrooms = buildAddon({
      addon_key: "bathrooms",
      input_type: "quantity",
      quantity_min: 0,
      quantity_max: 5,
      quantity_step: 1,
      quantity_default: 0,
      effect_time_minutes: 15,
    });
    const prepared = runReady({ addons: [bathrooms], addonSelections: { bathrooms: 2 } });
    const snap = snapshotOf(prepared);
    expect(snap.addonSelections).toEqual({ bathrooms: 2 });
    expect(snap.addonEffectLines).toEqual([
      { addonKey: "bathrooms", multiplier: 2, timeMinutes: 30, fixedExclVat: 0, percent: 0 },
    ]);
    expect(snap.addonMinutes).toBe(30);
  });

  it("ignores unknown add-on selection keys safely", () => {
    const prepared = runReady({ addonSelections: { not_a_real_addon: true } });
    expect(snapshotOf(prepared).addonMinutes).toBe(0);
    expect(snapshotOf(prepared).rawPriceExclVat).toBe(BASE_PER_VISIT_RAW);
  });

  it("ignores legacy answers.addons and has_pets entirely", () => {
    const prepared = runReady({
      request: buildRequest({
        answers: { sqm: 100, frequency: "weekly", addons: ["oven", "dog"], has_pets: true },
      }),
    });
    const snap = snapshotOf(prepared);
    expect(snap.addonMinutes).toBe(0);
    expect(snap.addonFixedExclVat).toBe(0);
    expect(snap.addonPercent).toBe(0);
    expect(snap.rawPriceExclVat).toBe(BASE_PER_VISIT_RAW);
  });
});

// ── Write flow + lifecycle ───────────────────────────────────────────────────────

describe("prepareSubmissionV2Home — write payloads + gates", () => {
  it("prepares prospect + quote_request + answers (reusing the legacy freezers)", () => {
    const prepared = runReady();
    expect(prepared.prospect.mode).toBe("insert");
    expect(prepared.prospect.fields.email).toBe("test@example.com");
    expect(prepared.prospect.fields.source).toBe("price_calculator");

    expect(prepared.quoteRequest.fields.prospect_legacy_id).toBe(prepared.prospect.legacyId);
    expect(prepared.quoteRequest.fields.calculator_service_key).toBe("home_cleaning");
    expect(prepared.quoteRequest.fields.selected_cleaning_plan_id).toBe("plan-flex");
    expect(prepared.quoteRequest.fields.selected_cleaning_plan_name).toBe("Flexibel");

    // One answer per submitted (flat) answer key — add-on selections live in the snapshot.
    expect(prepared.answers.map((a) => a.fields.question_key).sort()).toEqual(["frequency", "sqm"]);
  });

  it("writes NOTHING when the calculator is dark (enabled=false)", () => {
    const prepared = prepareSubmissionV2Home(
      buildSubmitParts({ settings: buildSettings({ enabled: false }) }),
    );
    expect(prepared.kind).toBe("disabled");
    expect(prepared.response.available).toBe(false);
    expect(prepared.response.status).toBe("not_available");
    expect("prospect" in prepared).toBe(false);
    expect("quoteRequest" in prepared).toBe(false);
  });

  it("rejects invalid input (missing sqm) and writes NOTHING", () => {
    const prepared = prepareSubmissionV2Home(
      buildSubmitParts({ request: buildRequest({ answers: { frequency: "weekly" } }) }),
    );
    expect(prepared.kind).toBe("invalid");
    expect(prepared.response.calculatedPrice).toBeNull();
    expect(prepared.response.quoteRequestLegacyId).toBeNull();
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
    const prepared = runReady({ existingProspect });
    expect(prepared.prospect.mode).toBe("update");
    expect(prepared.prospect.id).toBe("prospect-existing-1");
    expect(prepared.prospect.fields.prospect_status).toBe("qualified");
    expect(prepared.quoteRequest.fields.prospect_legacy_id).toBe("prospect_existing");
  });

  it("flags (but still prices) a quote over the manual-review threshold", () => {
    const prepared = runReady({ settings: buildSettings({ manual_review_threshold_amount: 1000 }) });
    expect(prepared.response.requiresManualReview).toBe(true);
    expect(prepared.quoteRequest.fields.requires_manual_review).toBe(true);
    // A priced V2 quote stays priced — it is only FLAGGED, never turned priceless.
    expect(prepared.quoteRequest.fields.calculated_price).toBeGreaterThan(0);
  });

  it("does NOT flag manual review below the threshold", () => {
    const prepared = runReady({ settings: buildSettings({ manual_review_threshold_amount: 999999 }) });
    expect(prepared.response.requiresManualReview).toBe(false);
    expect(prepared.quoteRequest.fields.requires_manual_review).toBe(false);
  });
});

// ── Admin request-view compatibility ─────────────────────────────────────────────

describe("prepareSubmissionV2Home — Admin snapshot compatibility", () => {
  it("extractSnapshotSummary reads the v2 snapshot unchanged", () => {
    const calc = runCalc();
    const prepared = runReady();
    const summary = extractSnapshotSummary(snapshotOf(prepared));

    expect(summary.formulaVersion).toBe("v2");
    expect(summary.pricingModel).toBe("home_cleaning_recommended_hours");
    expect(summary.selectedPlan).toEqual({ planKey: "flexible", name: "Flexibel", hourlyRate: 410 });
    expect(summary.estimatedHours).toBe(calc.estimatedHours);
    expect(summary.calculatedPrice).toBe(calc.calculatedPrice);
    expect(summary.minPrice).toBe(calc.minPrice);
    expect(summary.maxPrice).toBe(calc.maxPrice);
  });
});

// ── Service guard (home-only rollout) ────────────────────────────────────────────

describe("V2_ENABLED_SERVICE_KEYS — submit stays home-only", () => {
  it("routes ONLY home_cleaning to V2 (office/move-out/deep stay legacy)", () => {
    expect([...V2_ENABLED_SERVICE_KEYS]).toEqual(["home_cleaning"]);
    expect(V2_ENABLED_SERVICE_KEYS.has("office_cleaning")).toBe(false);
    expect(V2_ENABLED_SERVICE_KEYS.has("move_out_cleaning")).toBe(false);
    expect(V2_ENABLED_SERVICE_KEYS.has("deep_cleaning")).toBe(false);
    expect(V2_ENABLED_SERVICE_KEYS.has("storstadning")).toBe(false);
  });
});
