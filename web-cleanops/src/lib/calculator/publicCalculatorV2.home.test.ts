import { describe, expect, it } from "vitest";

/**
 * HOME CLEANING V2 calculate adapter + dispatch guard (Slice V2-E2).
 *
 * Exercises the PURE Edge adapter `runCalculationV2Home` (and its helpers) through
 * DB-style rows — the same shapes the public-calculator Edge Function loads with the
 * service role — and asserts the locked V2-E behaviour:
 *   • estimatedServiceHours is the customer-facing service time (NOT pricingHours).
 *   • start_adjustment_hours is price-only.
 *   • addonMinutes raises service time; fixed applies before percent; percent is
 *     net-additive and applied once; negative fixed discounts work; price floors at 0.
 *   • Four-week total = per-visit raw × visitsPerFourWeeks (weekly 4 / biweekly 2 /
 *     every_four_weeks 1; unknown → 1).
 *   • Generic add-ons come ONLY from calculator_addons / answers.addonSelections;
 *     legacy answers.addons / has_pets are ignored.
 *   • roundingIncrement comes from settings_json.displayRoundingInterval; the legacy
 *     pricing_rules.rounding_increment is ignored and there is no synthetic fallback.
 *   • The home-only rollout guard routes ONLY home_cleaning to V2.
 *
 * The adapter is imported from the Deno mirror with an explicit `.ts` extension
 * (same convention as the parity tests); it is pure (no Deno runtime imports), so it
 * runs unchanged under vitest.
 */
import {
  coerceAddonSelections,
  mapAddonRowsToConfigV2,
  resolveVisitsPerFourWeeks,
  runCalculationV2Home,
  V2_ENABLED_SERVICE_KEYS,
  type CalculatorAddonRowV2,
  type RunCalculationV2HomeParts,
} from "../../../supabase/functions/_shared/calculator/publicCalculatorV2.ts";
import type {
  CalculatorServiceRow,
  CleaningPlanRow,
  PricingRuleRow,
  PublicCalculateRequest,
} from "../../../supabase/functions/_shared/calculator/types.ts";
import type { PlanRowV2 } from "../../../supabase/functions/_shared/calculator/v2/index.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Rounds to öre (2 decimals) — mirrors the engine/adapter round2 for exact expected values. */
const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** Per-visit base raw (no add-ons): 100 m² → 3.6 h service, −0.25 start adj → 3.35 pricing h × 410. */
const BASE_PER_VISIT_RAW = round2(3.35 * 410); // 1373.50

type HomePlanRow = CleaningPlanRow & PlanRowV2;
type Settings = RunCalculationV2HomeParts["settings"];

function buildSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    currency: "SEK",
    price_display_mode: "range",
    enabled: true,
    default_vat_rate_percent: 25,
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
    // V2 plan columns (migration 0073, Slice V2-D0).
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

function buildRequest(overrides: Partial<PublicCalculateRequest> = {}): PublicCalculateRequest {
  return {
    serviceKey: "home_cleaning",
    answers: { sqm: 100, frequency: "weekly" },
    cleaningPlanKey: null,
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

function runHome(parts: Partial<RunCalculationV2HomeParts> = {}) {
  return runCalculationV2Home({
    settings: buildSettings(),
    service: buildService(),
    plans: [buildPlan()],
    rules: buildRules(),
    addons: [],
    request: buildRequest(),
    addonSelections: {},
    ...parts,
  });
}

// ── Core home calculation ──────────────────────────────────────────────────────

describe("runCalculationV2Home — core calculation", () => {
  it("100 m², 2.4 min/m², −10% adjustment → estimatedServiceHours = 3.6", () => {
    const res = runHome();
    expect(res.valid).toBe(true);
    expect(res.v2?.estimatedServiceHours).toBe(3.6);
    expect(res.estimatedHours).toBe(3.6);
    expect(res.v2?.rawPriceExclVat).toBe(BASE_PER_VISIT_RAW); // 1373.50
  });

  it("start_adjustment_hours affects price only (service time unchanged)", () => {
    const withAdj = runHome({ plans: [buildPlan({ start_adjustment_hours: -0.25 })] });
    const noAdj = runHome({ plans: [buildPlan({ start_adjustment_hours: 0 })] });

    // Same visible service time on both.
    expect(withAdj.estimatedHours).toBe(3.6);
    expect(noAdj.estimatedHours).toBe(3.6);
    // Price differs: −0.25 h × 410 cheaper per visit.
    expect(withAdj.v2?.rawPriceExclVat).toBe(round2(3.35 * 410)); // 1373.50
    expect(noAdj.v2?.rawPriceExclVat).toBe(round2(3.6 * 410)); // 1476.00
    expect(withAdj.v2?.rawPriceExclVat).not.toBe(noAdj.v2?.rawPriceExclVat);
  });

  it("estimatedHours equals estimatedServiceHours, never pricingHours", () => {
    const res = runHome();
    expect(res.v2?.pricingHours).toBe(3.35);
    expect(res.estimatedHours).toBe(res.v2?.estimatedServiceHours);
    expect(res.estimatedHours).not.toBe(res.v2?.pricingHours);
  });
});

// ── Add-on effects ──────────────────────────────────────────────────────────────

describe("runCalculationV2Home — add-on effects", () => {
  it("addonMinutes increases estimatedServiceHours (dog +30 min → 4.1 h)", () => {
    const dog = buildAddon({ addon_key: "dog", effect_time_minutes: 30 });
    const res = runHome({ addons: [dog], addonSelections: { dog: true } });
    expect(res.v2?.addonMinutes).toBe(30);
    expect(res.estimatedHours).toBe(4.1); // 216 + 30 = 246 min
  });

  it("quantity add-on: bathrooms 2 × 15 min → +30 min", () => {
    const bathrooms = buildAddon({
      addon_key: "bathrooms",
      input_type: "quantity",
      quantity_min: 0,
      quantity_max: 5,
      quantity_step: 1,
      quantity_default: 0,
      effect_time_minutes: 15,
    });
    const res = runHome({ addons: [bathrooms], addonSelections: { bathrooms: 2 } });
    expect(res.v2?.addonMinutes).toBe(30);
    expect(res.estimatedHours).toBe(4.1);
  });

  it("quantity fixed add-on: delbara rutor 5 × 40 → +200 SEK excl VAT", () => {
    const rutor = buildAddon({
      addon_key: "rutor",
      input_type: "quantity",
      quantity_min: 0,
      quantity_max: 100,
      quantity_step: 1,
      quantity_default: 0,
      effect_fixed_excl_vat: 40,
    });
    const res = runHome({ addons: [rutor], addonSelections: { rutor: 5 } });
    expect(res.v2?.addonFixedExclVat).toBe(200);
    expect(res.v2?.rawPriceExclVat).toBe(round2(3.35 * 410 + 200)); // 1573.50
  });

  it("applies addonFixedExclVat BEFORE addonPercent", () => {
    const fixed = buildAddon({ addon_key: "oven", effect_fixed_excl_vat: 250 });
    const percent = buildAddon({ addon_key: "dirty", effect_percent: 15 });
    const res = runHome({ addons: [fixed, percent], addonSelections: { oven: true, dirty: true } });

    const fixedBeforePercent = round2((3.35 * 410 + 250) * 1.15);
    const fixedAfterPercent = round2(3.35 * 410 * 1.15 + 250);
    expect(res.v2?.rawPriceExclVat).toBe(fixedBeforePercent);
    expect(res.v2?.rawPriceExclVat).not.toBe(fixedAfterPercent);
  });

  it("addonPercent is net additive (+15 and −10 → +5) and applied once", () => {
    const up = buildAddon({ addon_key: "up", effect_percent: 15 });
    const down = buildAddon({ addon_key: "down", effect_percent: -10 });
    const res = runHome({ addons: [up, down], addonSelections: { up: true, down: true } });
    expect(res.v2?.addonPercent).toBe(5);
    expect(res.v2?.rawPriceExclVat).toBe(round2(3.35 * 410 * 1.05)); // applied once
  });

  it("Extra dirty boolean +15% → +15 percent effect", () => {
    const dirty = buildAddon({ addon_key: "dirty", effect_percent: 15 });
    const res = runHome({ addons: [dirty], addonSelections: { dirty: true } });
    expect(res.v2?.addonPercent).toBe(15);
    expect(res.v2?.rawPriceExclVat).toBe(round2(3.35 * 410 * 1.15));
  });

  it("negative fixed discount lowers the raw price", () => {
    const disc = buildAddon({ addon_key: "disc", effect_fixed_excl_vat: -100 });
    const res = runHome({ addons: [disc], addonSelections: { disc: true } });
    expect(res.v2?.addonFixedExclVat).toBe(-100);
    expect(res.v2?.rawPriceExclVat).toBe(round2(3.35 * 410 - 100)); // 1273.50
  });

  it("raw price floors at 0 and never goes negative or invalid", () => {
    const bigDisc = buildAddon({ addon_key: "huge", effect_fixed_excl_vat: -999999 });
    const res = runHome({ addons: [bigDisc], addonSelections: { huge: true } });
    expect(res.valid).toBe(true);
    expect(res.v2?.rawPriceExclVat).toBe(0);
    expect(res.priceExclVat).toBe(0);
    expect(res.calculatedPrice).toBe(0);
  });

  it("inactive add-ons never contribute to pricing", () => {
    const inactive = buildAddon({ addon_key: "ghost", active: false, effect_time_minutes: 999 });
    const res = runHome({ addons: [inactive], addonSelections: { ghost: true } });
    expect(res.v2?.addonMinutes).toBe(0);
    expect(res.v2?.rawPriceExclVat).toBe(BASE_PER_VISIT_RAW);
  });

  it("unknown add-on selection keys are ignored safely", () => {
    const res = runHome({ addonSelections: { not_a_real_addon: true } });
    expect(res.v2?.addonMinutes).toBe(0);
    expect(res.v2?.rawPriceExclVat).toBe(BASE_PER_VISIT_RAW);
  });
});

// ── Four-week multiplier ─────────────────────────────────────────────────────────

describe("runCalculationV2Home — four-week total", () => {
  it("four-week total = per-visit raw × visitsPerFourWeeks (weekly = 4)", () => {
    const res = runHome();
    expect(res.v2?.visitsPerFourWeeks).toBe(4);
    expect(res.v2?.fourWeekRawExclVat).toBe(round2(BASE_PER_VISIT_RAW * 4));
    expect(res.priceExclVat).toBe(res.v2?.fourWeekRawExclVat);
  });

  it("weekly / biweekly / every_four_weeks multipliers scale the four-week price", () => {
    const cases: [string, number][] = [
      ["weekly", 4],
      ["biweekly", 2],
      ["every_four_weeks", 1],
    ];
    for (const [frequency, visits] of cases) {
      const res = runHome({ request: buildRequest({ answers: { sqm: 100, frequency } }) });
      expect(res.v2?.visitsPerFourWeeks).toBe(visits);
      expect(res.priceExclVat).toBe(round2(BASE_PER_VISIT_RAW * visits));
    }
  });

  it("unknown frequency falls back to 1 visit", () => {
    const res = runHome({ request: buildRequest({ answers: { sqm: 100, frequency: "monthly" } }) });
    expect(res.v2?.visitsPerFourWeeks).toBe(1);
    expect(res.priceExclVat).toBe(BASE_PER_VISIT_RAW);
  });
});

// ── Legacy add-on rules are ignored ─────────────────────────────────────────────

describe("runCalculationV2Home — no legacy add-on inputs", () => {
  it("ignores legacy answers.addons and has_pets entirely", () => {
    const res = runHome({
      request: buildRequest({
        answers: { sqm: 100, frequency: "weekly", addons: ["oven", "dog"], has_pets: true },
      }),
    });
    expect(res.v2?.addonMinutes).toBe(0);
    expect(res.v2?.addonFixedExclVat).toBe(0);
    expect(res.v2?.addonPercent).toBe(0);
    expect(res.v2?.rawPriceExclVat).toBe(BASE_PER_VISIT_RAW);
  });
});

// ── Rounding source ──────────────────────────────────────────────────────────────

describe("runCalculationV2Home — display rounding source", () => {
  it("roundingIncrement comes from settings_json.displayRoundingInterval", () => {
    expect(runHome().roundingIncrement).toBe(10);

    const res100 = runHome({
      service: buildService({
        settings_json: {
          displayRoundingInterval: 100,
          homeSqmAdjustments: [{ fromSqm: 0, toSqm: null, adjustmentPercent: -10 }],
        },
      }),
    });
    expect(res100.roundingIncrement).toBe(100);
  });

  it("ignores pricing_rules.rounding_increment (settings_json wins)", () => {
    const res = runHome({
      rules: buildRules([
        { id: "rr", rule_key: "rounding_increment", rule_type: "rounding", value_numeric: 50 },
      ]),
    });
    expect(res.roundingIncrement).toBe(10); // not 50
  });

  it("no synthetic fallback: missing displayRoundingInterval → null (client rounds to whole SEK)", () => {
    const res = runHome({
      service: buildService({
        settings_json: { homeSqmAdjustments: [{ fromSqm: 0, toSqm: null, adjustmentPercent: -10 }] },
      }),
      // A rounding_increment rule is present but must STILL be ignored (no borrow).
      rules: buildRules([
        { id: "rr", rule_key: "rounding_increment", rule_type: "rounding", value_numeric: 50 },
      ]),
    });
    expect(res.roundingIncrement).toBeNull();
  });
});

// ── VAT / RUT presentation ──────────────────────────────────────────────────────

describe("runCalculationV2Home — VAT/RUT", () => {
  it("surfaces default-plan VAT/RUT and a clean öre-level four-week price", () => {
    const res = runHome();
    expect(res.vatRatePercent).toBe(25);
    expect(res.rutEnabled).toBe(true);
    expect(res.rutPercent).toBe(50);

    const fourWeekRaw = round2(BASE_PER_VISIT_RAW * 4); // 5494.00
    expect(res.priceExclVat).toBe(fourWeekRaw);
    expect(res.vatAmount).toBe(round2(fourWeekRaw * 0.25));
    expect(res.priceInclVat).toBe(round2(fourWeekRaw * 1.25));
    // RUT on: customer pays incl VAT minus 50 % RUT.
    expect(res.calculatedPrice).toBe(round2(round2(fourWeekRaw * 1.25) * 0.5));
  });
});

// ── Invalid input ────────────────────────────────────────────────────────────────

describe("runCalculationV2Home — invalid input", () => {
  it("missing sqm → valid:false with null prices but a present debug block", () => {
    const res = runHome({ request: buildRequest({ answers: { frequency: "weekly" } }) });
    expect(res.valid).toBe(false);
    expect(res.calculatedPrice).toBeNull();
    expect(res.priceExclVat).toBeNull();
    expect(res.v2).toBeDefined();
    expect(res.roundingIncrement).toBe(10);
  });
});

// ── Home-only rollout guard ──────────────────────────────────────────────────────

describe("V2_ENABLED_SERVICE_KEYS — home-only rollout guard", () => {
  it("routes ONLY home_cleaning to V2", () => {
    expect(V2_ENABLED_SERVICE_KEYS.has("home_cleaning")).toBe(true);
  });

  it("keeps office_cleaning, move_out_cleaning, deep_cleaning, storstädning on legacy", () => {
    expect(V2_ENABLED_SERVICE_KEYS.has("office_cleaning")).toBe(false);
    expect(V2_ENABLED_SERVICE_KEYS.has("move_out_cleaning")).toBe(false);
    expect(V2_ENABLED_SERVICE_KEYS.has("deep_cleaning")).toBe(false);
    expect(V2_ENABLED_SERVICE_KEYS.has("storstadning")).toBe(false);
    expect(V2_ENABLED_SERVICE_KEYS.has("storstädning")).toBe(false);
  });

  it("contains exactly home_cleaning (no accidental extra services)", () => {
    expect([...V2_ENABLED_SERVICE_KEYS]).toEqual(["home_cleaning"]);
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────────────

describe("coerceAddonSelections", () => {
  it("keeps booleans and finite numbers under answers.addonSelections", () => {
    expect(coerceAddonSelections({ addonSelections: { dog: true, bathrooms: 2, off: false } })).toEqual({
      dog: true,
      bathrooms: 2,
      off: false,
    });
  });

  it("coerces string-encoded booleans (incl. Swedish ja/nej) and numbers", () => {
    expect(
      coerceAddonSelections({ addonSelections: { a: "ja", b: "nej", c: "true", d: "3", e: "1 200" } }),
    ).toEqual({ a: true, b: false, c: true, d: 3, e: 1200 });
  });

  it("drops objects, arrays, null and NaN safely", () => {
    expect(
      coerceAddonSelections({ addonSelections: { obj: {}, arr: [], nil: null, nan: Number.NaN } }),
    ).toEqual({});
  });

  it("never reads legacy answers.addons", () => {
    expect(coerceAddonSelections({ addons: ["dog", "oven"], has_pets: true })).toEqual({});
  });

  it("tolerates a non-object body", () => {
    expect(coerceAddonSelections(null)).toEqual({});
    expect(coerceAddonSelections(undefined)).toEqual({});
    expect(coerceAddonSelections("nope")).toEqual({});
  });
});

describe("mapAddonRowsToConfigV2", () => {
  it("maps snake_case rows (incl. text numerics) to canonical camelCase config", () => {
    const [config] = mapAddonRowsToConfigV2([
      buildAddon({
        addon_key: "bathrooms",
        name: "Badrum",
        public_label: "Antal badrum?",
        input_type: "quantity",
        quantity_min: "0",
        quantity_max: "5",
        quantity_step: "1",
        quantity_default: "1",
        effect_time_minutes: "15",
        sort_order: "3",
      }),
    ]);
    expect(config).toMatchObject({
      addonKey: "bathrooms",
      name: "Badrum",
      publicLabel: "Antal badrum?",
      inputType: "quantity",
      quantityMin: 0,
      quantityMax: 5,
      quantityStep: 1,
      quantityDefault: 1,
      effectTimeMinutes: 15,
      sortOrder: 3,
      active: true,
    });
  });

  it("clamps an unexpected input_type to boolean and a non-positive step to 1", () => {
    const [config] = mapAddonRowsToConfigV2([
      buildAddon({ addon_key: "weird", input_type: "single_select", quantity_step: 0 }),
    ]);
    expect(config.inputType).toBe("boolean");
    expect(config.quantityStep).toBe(1);
  });
});

describe("resolveVisitsPerFourWeeks", () => {
  it("maps known recurring intervals", () => {
    expect(resolveVisitsPerFourWeeks("weekly")).toBe(4);
    expect(resolveVisitsPerFourWeeks("biweekly")).toBe(2);
    expect(resolveVisitsPerFourWeeks("every_four_weeks")).toBe(1);
  });

  it("falls back to 1 for unknown/absent intervals", () => {
    expect(resolveVisitsPerFourWeeks("custom_interval")).toBe(1);
    expect(resolveVisitsPerFourWeeks(undefined)).toBe(1);
    expect(resolveVisitsPerFourWeeks(42)).toBe(1);
  });
});
