import { describe, expect, it } from "vitest";

/**
 * V2 PARITY GUARD — canonical frontend V2 ⇔ Deno/shared V2 mirror (Slice V2-E1).
 *
 * The Edge Function cannot import the approved `src` V2 modules (Deno needs
 * explicit `.ts` extensions and only bundles files inside `supabase/functions`),
 * so a faithful Deno mirror lives at
 * `supabase/functions/_shared/calculator/v2/**`. This test runs BOTH the canonical
 * modules and the mirror through identical input matrices and asserts deep
 * equality, so the two can never silently drift. If either side changes without
 * the other, this test fails.
 *
 * It also pins the locked V2 invariants (Slice V2-E):
 *   • `addonMinutes` raises `estimatedServiceHours`; `startAdjustmentHours` does NOT.
 *   • `startAdjustmentHours` is price-only (it shifts `pricingHours`).
 *   • `addonFixedExclVat` is applied BEFORE `addonPercent`.
 *   • `addonPercent` is NET additive (+15 and −10 → +5) and applied ONCE.
 *   • Display rounding happens last; no legacy add-on rules are involved.
 */
import * as canonical from "@/lib/calculator/v2";
import * as ported from "../../../../supabase/functions/_shared/calculator/v2/index.ts";
import type {
  AddonSelectionsV2,
  BuildServiceConfigInputV2,
  CalculationInputV2,
  CalculatorAddonConfigV2,
  CalculatorPlanV2,
  CalculatorServiceConfigV2,
  DisplayPriceRangeInput,
  DisplayPricingMode,
} from "@/lib/calculator/v2";

// ── Builders ──────────────────────────────────────────────────────────────────

function hourlyPlan(overrides: Partial<CalculatorPlanV2> = {}): CalculatorPlanV2 {
  return {
    planKey: "flexible",
    label: "Flexibel",
    description: null,
    active: true,
    isDefault: true,
    sortOrder: 0,
    kind: "hourly",
    hourlyRateExclVat: 410,
    startAdjustmentHours: -0.25,
    pricePerSqmExclVat: null,
    fixedAdjustmentExclVat: null,
    minimumPriceExclVat: null,
    ...overrides,
  };
}

function sqmFixedPlan(overrides: Partial<CalculatorPlanV2> = {}): CalculatorPlanV2 {
  return {
    planKey: "normal",
    label: "Normalt skick",
    description: null,
    active: true,
    isDefault: true,
    sortOrder: 0,
    kind: "sqm_fixed",
    hourlyRateExclVat: null,
    startAdjustmentHours: null,
    pricePerSqmExclVat: 48,
    fixedAdjustmentExclVat: null,
    minimumPriceExclVat: null,
    ...overrides,
  };
}

function hourlyConfig(
  plans: CalculatorPlanV2[],
  overrides: Partial<CalculatorServiceConfigV2> = {},
): CalculatorServiceConfigV2 {
  return {
    serviceKey: "home_cleaning",
    displayName: "Hemstädning",
    enabled: true,
    pricingBasis: "hourly",
    bookingMode: "recurring",
    publicLayout: "recurring_cleaning",
    vat: { ratePercent: 25, customerToggle: true, defaultMode: "incl" },
    rut: { eligible: true, enabledByDefault: true, percent: 50, customerToggle: true },
    margins: { lowerPercent: 5, upperPercent: 10 },
    displayRoundingInterval: 10,
    sqmTime: { baseMinutesPerSqm: 2.4, startMinutes: 0, minimumMinutes: 120 },
    sqmAdjustments: [{ fromSqm: 0, toSqm: null, adjustmentPercent: -10 }],
    plans,
    currency: "SEK",
    ...overrides,
  };
}

function sqmFixedConfig(
  plans: CalculatorPlanV2[],
  overrides: Partial<CalculatorServiceConfigV2> = {},
): CalculatorServiceConfigV2 {
  return {
    serviceKey: "move_out_cleaning",
    displayName: "Flyttstädning",
    enabled: true,
    pricingBasis: "sqm_fixed",
    bookingMode: "one_off",
    publicLayout: "move_out_cleaning",
    vat: { ratePercent: 25, customerToggle: false, defaultMode: "incl" },
    rut: { eligible: true, enabledByDefault: true, percent: 50, customerToggle: true },
    margins: { lowerPercent: 10, upperPercent: 10 },
    displayRoundingInterval: 100,
    sqmTime: null,
    sqmAdjustments: [],
    plans,
    currency: "SEK",
    ...overrides,
  };
}

function addon(overrides: Partial<CalculatorAddonConfigV2>): CalculatorAddonConfigV2 {
  return {
    addonKey: "x",
    name: "X",
    publicLabel: "X?",
    description: null,
    inputType: "boolean",
    booleanDefault: false,
    quantityMin: 0,
    quantityMax: null,
    quantityStep: 1,
    quantityDefault: 0,
    effectTimeMinutes: 0,
    effectFixedExclVat: 0,
    effectPercent: 0,
    active: true,
    publicVisible: true,
    required: false,
    sortOrder: 0,
    ...overrides,
  };
}

// ── Plan sets ─────────────────────────────────────────────────────────────────

const HOURLY_SINGLE: CalculatorPlanV2[] = [hourlyPlan()];
const HOURLY_MULTI: CalculatorPlanV2[] = [
  hourlyPlan({ planKey: "flexible", isDefault: false, sortOrder: 0, hourlyRateExclVat: 410, startAdjustmentHours: -0.25 }),
  hourlyPlan({ planKey: "fast", label: "Fast", isDefault: true, sortOrder: 1, hourlyRateExclVat: 450, startAdjustmentHours: 0 }),
  hourlyPlan({ planKey: "priority", label: "Prioritet", isDefault: false, sortOrder: 2, hourlyRateExclVat: 500, startAdjustmentHours: 0.25 }),
];
const HOURLY_NONE: CalculatorPlanV2[] = [hourlyPlan({ active: false })];
const HOURLY_FLOOR: CalculatorPlanV2[] = [hourlyPlan({ minimumPriceExclVat: 2000 })];

const SQM_SINGLE: CalculatorPlanV2[] = [sqmFixedPlan()];
const SQM_MULTI: CalculatorPlanV2[] = [
  sqmFixedPlan({ planKey: "good", label: "Mycket gott skick", isDefault: false, sortOrder: 0, pricePerSqmExclVat: 40 }),
  sqmFixedPlan({ planKey: "normal", label: "Normalt skick", isDefault: true, sortOrder: 1, pricePerSqmExclVat: 48 }),
  sqmFixedPlan({ planKey: "messy", label: "Mycket att göra", isDefault: false, sortOrder: 2, pricePerSqmExclVat: 60 }),
];
const SQM_FLOOR: CalculatorPlanV2[] = [sqmFixedPlan({ minimumPriceExclVat: 1500 })];

// ── Engine matrix ─────────────────────────────────────────────────────────────

function* engineMatrix(): Generator<CalculationInputV2> {
  const sqms: (number | null)[] = [null, 0, 50, 100, 200];
  const addonFixedSet = [0, 250, -100];
  const addonPercentSet = [0, 15, -10];

  for (const plans of [HOURLY_SINGLE, HOURLY_MULTI, HOURLY_NONE, HOURLY_FLOOR]) {
    for (const sqm of sqms) {
      for (const requestedPlanKey of [undefined, "fast", "ghost"]) {
        for (const addonMinutes of [0, 30]) {
          for (const addonFixedExclVat of addonFixedSet) {
            for (const addonPercent of addonPercentSet) {
              for (const enabled of [true, false]) {
                yield {
                  config: hourlyConfig(plans, { enabled }),
                  sqm,
                  requestedPlanKey,
                  addonMinutes,
                  addonFixedExclVat,
                  addonPercent,
                };
              }
            }
          }
        }
      }
    }
  }

  for (const plans of [SQM_SINGLE, SQM_MULTI, SQM_FLOOR]) {
    for (const sqm of sqms) {
      for (const requestedPlanKey of [undefined, "normal", "ghost"]) {
        for (const addonFixedExclVat of addonFixedSet) {
          for (const addonPercent of addonPercentSet) {
            yield {
              config: sqmFixedConfig(plans),
              sqm,
              requestedPlanKey,
              addonFixedExclVat,
              addonPercent,
            };
          }
        }
      }
    }
  }
}

// ── Add-on resolver matrix ────────────────────────────────────────────────────

const ADDON_DEFS: CalculatorAddonConfigV2[] = [
  addon({ addonKey: "dog", inputType: "boolean", effectTimeMinutes: 20 }),
  addon({ addonKey: "oven", inputType: "boolean", effectFixedExclVat: 250 }),
  addon({ addonKey: "dirty", inputType: "boolean", effectPercent: 15 }),
  addon({ addonKey: "discount", inputType: "boolean", effectPercent: -10, booleanDefault: true }),
  addon({ addonKey: "bathrooms", inputType: "quantity", quantityMin: 0, quantityMax: 5, quantityStep: 1, quantityDefault: 1, effectTimeMinutes: 15 }),
  addon({ addonKey: "windows", inputType: "quantity", quantityMin: 0, quantityMax: 20, quantityStep: 2, quantityDefault: 0, effectFixedExclVat: 40 }),
  addon({ addonKey: "inactive", inputType: "boolean", active: false, effectTimeMinutes: 999 }),
];

const ADDON_SELECTIONS: AddonSelectionsV2[] = [
  {},
  { dog: true },
  { dog: false },
  { oven: true, dirty: true },
  { discount: false },
  { bathrooms: 2 },
  { bathrooms: 99 },
  { bathrooms: -3 },
  { windows: 7 },
  { dirty: true, discount: true },
  { inactive: true },
  { unknown_key: true },
  { dog: 5 },
  { bathrooms: "x" as unknown as number },
];

// ── Display pricing matrix ────────────────────────────────────────────────────

function* displayMatrix(): Generator<DisplayPriceRangeInput> {
  const modes: DisplayPricingMode[] = [
    { vat: "incl", rut: "before" },
    { vat: "incl", rut: "after" },
    { vat: "excl", rut: "before" },
    { vat: "excl", rut: "after" },
  ];
  for (const rawPriceExclVat of [0, 469, 563, 2769, 3381, 1373.5]) {
    for (const m of [{ l: 0, u: 0 }, { l: 5, u: 10 }, { l: 10, u: 10 }]) {
      for (const vatRatePercent of [0, 25]) {
        for (const rutEligible of [true, false]) {
          for (const rutPercent of [0, 50]) {
            for (const mode of modes) {
              for (const roundingInterval of [null, 1, 10, 100]) {
                yield {
                  rawPriceExclVat,
                  lowerMarginPercent: m.l,
                  upperMarginPercent: m.u,
                  vatRatePercent,
                  rutEligible,
                  rutPercent,
                  mode,
                  roundingInterval,
                };
              }
            }
          }
        }
      }
    }
  }
}

// ── Config-mapper inputs ──────────────────────────────────────────────────────

const MAPPER_INPUTS: BuildServiceConfigInputV2[] = [
  {
    service: {
      service_key: "home_cleaning",
      display_name: "Hemstädning",
      enabled: true,
      pricing_model: "home_cleaning_recommended_hours",
      settings_json: {
        displayRoundingInterval: 10,
        homeSqmAdjustments: [{ fromSqm: 0, toSqm: 100, adjustmentPercent: -10 }],
      },
    },
    plans: [
      {
        plan_key: "flexible",
        name: "Flexibel",
        is_default: true,
        sort_order: 0,
        hourly_rate: 410,
        start_adjustment_hours: -0.25,
        vat_rate_percent: 25,
        rut_eligible: true,
        rut_enabled: true,
        rut_percent: 50,
      },
    ],
    pricingRules: [
      { rule_key: "hours_per_sqm", value_numeric: 0.04 },
      { rule_key: "base_hours", value_numeric: 0 },
      { rule_key: "minimum_hours", value_numeric: 2 },
      { rule_key: "range_min_percent", value_numeric: 5 },
      { rule_key: "range_max_percent", value_numeric: 10 },
      { rule_key: "rounding_increment", value_numeric: 50 },
    ],
  },
  {
    service: {
      service_key: "move_out_cleaning",
      display_name: "Flyttstädning",
      enabled: true,
      pricing_model: "move_out_fixed_plus_addons",
      settings_json: { displayRoundingInterval: 100 },
    },
    plans: [
      { plan_key: "normal", name: "Normalt skick", is_default: true, sort_order: 1, price_per_sqm_excl_vat: 48, vat_rate_percent: 25, rut_eligible: true, rut_percent: 50 },
    ],
  },
  { service: { service_key: "deep_cleaning", display_name: "Storstädning", enabled: true, settings_json: {} } },
  { service: { service_key: "disabled_service", enabled: false, settings_json: {} } },
  // GPM-1: generic-model services + an engine-unsupported model, so the parity
  // guard covers the new model→basis resolution identically across both mirrors.
  {
    service: {
      service_key: "generic_hourly",
      display_name: "Generic hourly",
      enabled: true,
      pricing_model: "hourly_by_area",
      settings_json: { displayRoundingInterval: 10 },
    },
    plans: [
      { plan_key: "std", name: "Standard", is_default: true, sort_order: 0, hourly_rate: 400, start_adjustment_hours: 0, vat_rate_percent: 25 },
    ],
    pricingRules: [
      { rule_key: "hours_per_sqm", value_numeric: 0.04 },
      { rule_key: "minimum_hours", value_numeric: 2 },
    ],
  },
  {
    service: {
      service_key: "generic_sqm",
      display_name: "Generic sqm",
      enabled: true,
      pricing_model: "sqm_fixed",
      settings_json: { displayRoundingInterval: 100 },
    },
    plans: [
      { plan_key: "flat", name: "Flat", is_default: true, sort_order: 0, price_per_sqm_excl_vat: 50, vat_rate_percent: 25 },
    ],
  },
  { service: { service_key: "generic_units", display_name: "Generic units", enabled: true, pricing_model: "unit_based", settings_json: {} } },
];

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("V2 engine parity (canonical src ⇔ Deno mirror)", () => {
  it("produces deep-equal raw results across the full input matrix", () => {
    let count = 0;
    for (const input of engineMatrix()) {
      expect(ported.calculateRawV2(input)).toEqual(canonical.calculateRawV2(input));
      count += 1;
    }
    expect(count).toBeGreaterThan(500);
  });

  it("resolves identical plans across requested keys", () => {
    for (const key of [undefined, null, "flexible", "fast", "priority", "ghost"]) {
      expect(ported.selectPlanV2(HOURLY_MULTI, key)).toEqual(canonical.selectPlanV2(HOURLY_MULTI, key));
    }
    expect(ported.selectPlanV2(HOURLY_NONE)).toEqual(canonical.selectPlanV2(HOURLY_NONE));
  });

  it("resolves identical per-m² adjustment percents", () => {
    const ranges = [
      { fromSqm: 0, toSqm: 60, adjustmentPercent: 10 },
      { fromSqm: 61, toSqm: 120, adjustmentPercent: -10 },
      { fromSqm: 121, toSqm: null, adjustmentPercent: -20 },
    ];
    for (const sqm of [-5, 0, 60, 61, 100, 121, 500]) {
      expect(ported.resolveSqmAdjustmentPercentV2(ranges, sqm)).toBe(
        canonical.resolveSqmAdjustmentPercentV2(ranges, sqm),
      );
    }
  });
});

describe("V2 add-on resolver parity (canonical src ⇔ Deno mirror)", () => {
  it("resolves identical add-on effects across the selection matrix", () => {
    for (const selections of ADDON_SELECTIONS) {
      expect(ported.resolveAddonEffects(ADDON_DEFS, selections)).toEqual(
        canonical.resolveAddonEffects(ADDON_DEFS, selections),
      );
    }
  });

  it("aggregates percent effects additively (+15 and −10 → net +5), once", () => {
    const defs = [addon({ addonKey: "up", effectPercent: 15 }), addon({ addonKey: "down", effectPercent: -10 })];
    const result = canonical.resolveAddonEffects(defs, { up: true, down: true });
    expect(result.addonPercent).toBe(5);
    expect(ported.resolveAddonEffects(defs, { up: true, down: true })).toEqual(result);
  });
});

describe("V2 display-pricing parity (canonical src ⇔ Deno mirror)", () => {
  it("produces deep-equal display ranges across the full matrix", () => {
    let count = 0;
    for (const input of displayMatrix()) {
      expect(ported.computeDisplayPriceRange(input)).toEqual(canonical.computeDisplayPriceRange(input));
      count += 1;
    }
    expect(count).toBeGreaterThan(500);
  });

  it("matches on the rounding helpers (no rule-based fallback)", () => {
    for (const inc of [null, 0, -5, 1, 10, 50, 100]) {
      expect(ported.resolveDisplayRoundingIncrement(inc)).toBe(canonical.resolveDisplayRoundingIncrement(inc));
    }
    for (const v of [469, 563, 2769, 3381, 0, -5, 1373.5]) {
      for (const inc of [10, 100]) {
        expect(ported.roundPublicDisplayPrice(v, inc)).toBe(canonical.roundPublicDisplayPrice(v, inc));
      }
    }
  });
});

describe("V2 config-mapper parity (canonical src ⇔ Deno mirror)", () => {
  it("maps identical canonical configs + issues from DB-style rows", () => {
    for (const input of MAPPER_INPUTS) {
      expect(ported.buildServiceConfigV2(input)).toEqual(canonical.buildServiceConfigV2(input));
    }
  });
});

describe("V2 pricing-model resolver parity (canonical src ⇔ Deno mirror)", () => {
  const MODELS: (string | null | undefined)[] = [
    "hourly_by_area",
    "sqm_fixed",
    "unit_based",
    "fixed_package",
    "manual_quote",
    "home_cleaning_recommended_hours",
    "office_cleaning_recurring_area_frequency",
    "deep_cleaning_area_based",
    "deep_cleaning_area_addons",
    "move_out_fixed_plus_addons",
    "window_cleaning_count_based",
    "stairwell_cleaning_floors_frequency",
    "inquiry_only_no_price",
    "",
    "   ",
    "garbage",
    null,
    undefined,
  ];

  it("resolves identical generic models for every input across mirrors", () => {
    for (const m of MODELS) {
      expect(ported.resolveGenericPricingModel(m)).toBe(canonical.resolveGenericPricingModel(m));
    }
  });

  it("maps identical pricing basis + engine support per generic model", () => {
    for (const m of canonical.GENERIC_PRICING_MODELS) {
      expect(ported.pricingBasisForGenericModel(m)).toBe(canonical.pricingBasisForGenericModel(m));
      expect(ported.isEngineSupportedGenericModel(m)).toBe(canonical.isEngineSupportedGenericModel(m));
    }
  });
});

describe("V2 locked invariants (held identically by both mirrors)", () => {
  it("addonMinutes raises estimatedServiceHours; startAdjustment is price-only", () => {
    const config = hourlyConfig([hourlyPlan({ startAdjustmentHours: -0.25 })]);
    const noAddon = canonical.calculateRawV2({ config, sqm: 100, addonMinutes: 0 });
    const withAddon = canonical.calculateRawV2({ config, sqm: 100, addonMinutes: 30 });

    expect(noAddon.estimatedServiceHours).toBe(3.6); // 100 × 2.4 × 0.9 = 216 min
    expect(withAddon.estimatedServiceHours).toBe(4.1); // + 30 min = 246 min
    // startAdjustment shifts pricingHours, never the visible service time.
    expect(noAddon.pricingHours).toBe(3.35);
    expect(noAddon.estimatedServiceHours).not.toBe(noAddon.pricingHours);

    expect(ported.calculateRawV2({ config, sqm: 100, addonMinutes: 30 })).toEqual(withAddon);
  });

  it("applies addonFixedExclVat BEFORE addonPercent", () => {
    const config = hourlyConfig([hourlyPlan({ hourlyRateExclVat: 410, startAdjustmentHours: -0.25 })]);
    // The engine rounds the raw price to öre, so reproduce its round2 to compare exactly.
    // Fixed-before-percent: (3.35h × 410 + 250 fixed) × 1.15 = 1867.03 (NOT 3.35×410×1.15 + 250).
    const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
    const fixedBeforePercent = round2((3.35 * 410 + 250) * 1.15);
    const fixedAfterPercent = round2(3.35 * 410 * 1.15 + 250);
    const r = canonical.calculateRawV2({ config, sqm: 100, addonFixedExclVat: 250, addonPercent: 15 });
    expect(r.rawPriceExclVat).toBe(fixedBeforePercent);
    expect(r.rawPriceExclVat).not.toBe(fixedAfterPercent);
    expect(ported.calculateRawV2({ config, sqm: 100, addonFixedExclVat: 250, addonPercent: 15 })).toEqual(r);
  });

  it("sqm_fixed: 80 m² × 48 = 3840, with no time-driven service hours", () => {
    const config = sqmFixedConfig([sqmFixedPlan({ pricePerSqmExclVat: 48 })]);
    const r = canonical.calculateRawV2({ config, sqm: 80 });
    expect(r.rawPriceExclVat).toBe(3840);
    expect(r.estimatedServiceHours).toBeNull();
    expect(r.pricingHours).toBeNull();
    expect(ported.calculateRawV2({ config, sqm: 80 })).toEqual(r);
  });

  it("exposes the same V2 rounding fallback constant", () => {
    expect(ported.DISPLAY_ROUNDING_FALLBACK).toBe(canonical.DISPLAY_ROUNDING_FALLBACK);
  });
});
