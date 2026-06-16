import { describe, expect, it } from "vitest";

import { resolveAddonEffects } from "./addons";
import { calculateRawV2, resolveSqmAdjustmentPercentV2 } from "./engine";
import type { CalculatorAddonConfigV2, CalculatorPlanV2, CalculatorServiceConfigV2 } from "./types";

function baseConfig(overrides: Partial<CalculatorServiceConfigV2> = {}): CalculatorServiceConfigV2 {
  return {
    serviceKey: "home_cleaning",
    displayName: "Hemstädning",
    enabled: true,
    pricingBasis: "hourly",
    bookingMode: "recurring",
    publicLayout: "recurring_cleaning",
    vat: { ratePercent: 25, customerToggle: true, defaultMode: "incl" },
    rut: { eligible: true, enabledByDefault: true, percent: 50, customerToggle: true },
    margins: { lowerPercent: 0, upperPercent: 0 },
    displayRoundingInterval: 10,
    sqmTime: { baseMinutesPerSqm: 2.4, startMinutes: 0, minimumMinutes: 0 },
    sqmAdjustments: [],
    plans: [],
    currency: "SEK",
    ...overrides,
  };
}

function hourlyPlan(
  overrides: Partial<CalculatorPlanV2> & Pick<CalculatorPlanV2, "planKey">,
): CalculatorPlanV2 {
  return {
    label: overrides.planKey,
    description: null,
    active: true,
    isDefault: false,
    sortOrder: 0,
    kind: "hourly",
    hourlyRateExclVat: 410,
    startAdjustmentHours: 0,
    pricePerSqmExclVat: null,
    fixedAdjustmentExclVat: null,
    minimumPriceExclVat: null,
    ...overrides,
  };
}

function sqmPlan(
  overrides: Partial<CalculatorPlanV2> & Pick<CalculatorPlanV2, "planKey">,
): CalculatorPlanV2 {
  return {
    label: overrides.planKey,
    description: null,
    active: true,
    isDefault: false,
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

function addon(
  overrides: Partial<CalculatorAddonConfigV2> & Pick<CalculatorAddonConfigV2, "addonKey">,
): CalculatorAddonConfigV2 {
  return {
    name: overrides.addonKey,
    publicLabel: overrides.addonKey,
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

describe("resolveSqmAdjustmentPercentV2", () => {
  const ranges = [
    { fromSqm: 76, toSqm: 86, adjustmentPercent: -5 },
    { fromSqm: 87, toSqm: 99, adjustmentPercent: -7 },
    { fromSqm: 100, toSqm: 120, adjustmentPercent: -10 },
  ];

  it("matches inclusive boundaries", () => {
    expect(resolveSqmAdjustmentPercentV2(ranges, 76)).toBe(-5);
    expect(resolveSqmAdjustmentPercentV2(ranges, 86)).toBe(-5);
    expect(resolveSqmAdjustmentPercentV2(ranges, 87)).toBe(-7);
    expect(resolveSqmAdjustmentPercentV2(ranges, 100)).toBe(-10);
    expect(resolveSqmAdjustmentPercentV2(ranges, 120)).toBe(-10);
  });

  it("returns 0 outside every range / with no ranges", () => {
    expect(resolveSqmAdjustmentPercentV2(ranges, 50)).toBe(0);
    expect(resolveSqmAdjustmentPercentV2(ranges, 200)).toBe(0);
    expect(resolveSqmAdjustmentPercentV2([], 100)).toBe(0);
    expect(resolveSqmAdjustmentPercentV2(undefined, 100)).toBe(0);
  });

  it("supports an open-ended top range (toSqm null)", () => {
    expect(
      resolveSqmAdjustmentPercentV2([{ fromSqm: 100, toSqm: null, adjustmentPercent: -12 }], 5000),
    ).toBe(-12);
  });
});

describe("calculateRawV2 — hourly basis", () => {
  it("home 100 m² @ 2.4 min/m² with a −10% range → 3.6 h and 1373.50 excl VAT", () => {
    // 2.4 × (1 − 0.10) = 2.16 min/m² → 100 × 2.16 = 216 min = 3.6 h.
    // (3.6 + (−0.25)) × 410 = 1373.50.
    const config = baseConfig({
      sqmAdjustments: [
        { fromSqm: 76, toSqm: 86, adjustmentPercent: -5 },
        { fromSqm: 87, toSqm: 99, adjustmentPercent: -7 },
        { fromSqm: 100, toSqm: 120, adjustmentPercent: -10 },
      ],
      plans: [hourlyPlan({ planKey: "flexibel", hourlyRateExclVat: 410, startAdjustmentHours: -0.25 })],
    });

    const res = calculateRawV2({ config, sqm: 100 });

    expect(res.valid).toBe(true);
    expect(res.estimatedServiceHours).toBe(3.6); // customer-facing time
    expect(res.pricingHours).toBe(3.35); // 3.6 + (−0.25), price-only
    expect(res.rawPriceExclVat).toBe(1373.5);
    expect(res.selectedPlanKey).toBe("flexibel");
    expect(res.pricingBasis).toBe("hourly");
  });

  it("NEGATIVE plan start adjustment lowers price ONLY, not the visible service time", () => {
    // No adjustment range → 100 × 2.4 = 240 min = 4 h service time.
    // Visible service time stays 4 h; pricingHours = 4 + (−0.25) = 3.75;
    // price = 3.75 × 410 = 1537.50.
    const config = baseConfig({
      plans: [hourlyPlan({ planKey: "flexibel", startAdjustmentHours: -0.25 })],
    });

    const res = calculateRawV2({ config, sqm: 100 });

    expect(res.estimatedServiceHours).toBe(4);
    expect(res.pricingHours).toBe(3.75);
    expect(res.rawPriceExclVat).toBe(1537.5);
  });

  it("POSITIVE plan start adjustment raises price ONLY, not the visible service time", () => {
    // No adjustment range → 100 × 2.4 = 240 min = 4 h service time.
    // +1.0 h start adjustment → pricingHours = 5.0; price = 5.0 × 410 = 2050.
    // The customer must still see 4.0 h as "Beräknad tid per tillfälle".
    const config = baseConfig({
      plans: [hourlyPlan({ planKey: "prioritet", hourlyRateExclVat: 410, startAdjustmentHours: 1 })],
    });

    const res = calculateRawV2({ config, sqm: 100 });

    expect(res.estimatedServiceHours).toBe(4); // customer-facing time unchanged
    expect(res.pricingHours).toBe(5); // 4 + 1, price-only
    expect(res.rawPriceExclVat).toBe(2050); // 5 × 410
  });

  it("adds fixed start minutes to the service time", () => {
    const config = baseConfig({
      sqmTime: { baseMinutesPerSqm: 2.4, startMinutes: 30, minimumMinutes: 0 },
      plans: [hourlyPlan({ planKey: "flexibel" })],
    });

    // 240 + 30 = 270 min = 4.5 h.
    expect(calculateRawV2({ config, sqm: 100 }).estimatedServiceHours).toBe(4.5);
  });

  it("floors the service time at the configured minimum minutes", () => {
    const config = baseConfig({
      sqmTime: { baseMinutesPerSqm: 2.4, startMinutes: 0, minimumMinutes: 300 },
      plans: [hourlyPlan({ planKey: "flexibel" })],
    });

    // 240 min < 300 → floored to 300 = 5 h; price 5 × 410 = 2050.
    const res = calculateRawV2({ config, sqm: 100 });
    expect(res.estimatedServiceHours).toBe(5);
    expect(res.pricingHours).toBe(5); // default plan has 0 start adjustment
    expect(res.rawPriceExclVat).toBe(2050);
  });

  it("invalidates a service with hourly basis but no m² time config", () => {
    const config = baseConfig({ sqmTime: null, plans: [hourlyPlan({ planKey: "flexibel" })] });
    const res = calculateRawV2({ config, sqm: 100 });
    expect(res.valid).toBe(false);
    expect(res.issues.some((i) => i.code === "missing_time_config")).toBe(true);
  });
});

describe("calculateRawV2 — sqm_fixed basis", () => {
  function moveOutConfig(overrides: Partial<CalculatorServiceConfigV2> = {}): CalculatorServiceConfigV2 {
    return baseConfig({
      serviceKey: "move_out_cleaning",
      displayName: "Flyttstädning",
      pricingBasis: "sqm_fixed",
      bookingMode: "one_off",
      publicLayout: "move_out_cleaning",
      sqmTime: null,
      plans: [sqmPlan({ planKey: "normalt", pricePerSqmExclVat: 48 })],
      ...overrides,
    });
  }

  it("80 m² × 48 SEK/m² = 3840 excl VAT, with no hourly time estimate", () => {
    const res = calculateRawV2({ config: moveOutConfig(), sqm: 80 });
    expect(res.valid).toBe(true);
    expect(res.rawPriceExclVat).toBe(3840);
    expect(res.estimatedServiceHours).toBeNull();
    expect(res.pricingHours).toBeNull(); // hours never drive sqm_fixed price
    expect(res.pricingBasis).toBe("sqm_fixed");
  });

  it("condition/effort plans price by their own price per m²", () => {
    const config = moveOutConfig({
      plans: [
        sqmPlan({ planKey: "gott", label: "Mycket gott skick", pricePerSqmExclVat: 40, sortOrder: 0, isDefault: true }),
        sqmPlan({ planKey: "normalt", label: "Normalt skick", pricePerSqmExclVat: 48, sortOrder: 1 }),
        sqmPlan({ planKey: "mycket", label: "Mycket att göra", pricePerSqmExclVat: 60, sortOrder: 2 }),
      ],
    });

    expect(calculateRawV2({ config, sqm: 80, requestedPlanKey: "mycket" }).rawPriceExclVat).toBe(4800);
    expect(calculateRawV2({ config, sqm: 80, requestedPlanKey: "gott" }).rawPriceExclVat).toBe(3200);
    // No request → default plan "gott".
    expect(calculateRawV2({ config, sqm: 80 }).selectedPlanKey).toBe("gott");
  });

  it("applies a fixed adjustment then the minimum price floor", () => {
    const config = moveOutConfig({
      plans: [
        sqmPlan({ planKey: "normalt", pricePerSqmExclVat: 48, fixedAdjustmentExclVat: 200, minimumPriceExclVat: 4500 }),
      ],
    });
    // 80 × 48 + 200 = 4040 → floored to 4500.
    expect(calculateRawV2({ config, sqm: 80 }).rawPriceExclVat).toBe(4500);
  });
});

describe("calculateRawV2 — generic add-on effects (hourly)", () => {
  // baseConfig: 2.4 min/m², no adjustment → 100 m² = 240 min = 4 h baseline; rate 410.
  const config = baseConfig({ plans: [hourlyPlan({ planKey: "flexibel" })] });

  it("addonMinutes raise BOTH the visible service time and the hourly price (time × rate)", () => {
    const baseline = calculateRawV2({ config, sqm: 100 });
    expect(baseline.estimatedServiceHours).toBe(4);
    expect(baseline.rawPriceExclVat).toBe(1640); // 4 × 410

    const withAddon = calculateRawV2({ config, sqm: 100, addonMinutes: 60 });
    expect(withAddon.estimatedServiceHours).toBe(5); // 300 min, add-on time is real work
    expect(withAddon.pricingHours).toBe(5);
    expect(withAddon.rawPriceExclVat).toBe(2050); // 5 × 410
  });

  it("plan startAdjustmentHours stays price-only even WITH add-on minutes", () => {
    const withStartAdj = baseConfig({
      plans: [hourlyPlan({ planKey: "flexibel", startAdjustmentHours: -0.25 })],
    });
    const res = calculateRawV2({ config: withStartAdj, sqm: 100, addonMinutes: 60 });
    expect(res.estimatedServiceHours).toBe(5); // add-on time IN, start adjustment OUT
    expect(res.pricingHours).toBe(4.75); // 5 + (−0.25)
    expect(res.rawPriceExclVat).toBe(1947.5); // 4.75 × 410
  });

  it("addonFixedExclVat adds to the raw price without changing the service time", () => {
    const res = calculateRawV2({ config, sqm: 100, addonFixedExclVat: 250 });
    expect(res.estimatedServiceHours).toBe(4);
    expect(res.rawPriceExclVat).toBe(1890); // 1640 + 250
  });

  it("addonPercent applies ONCE to the subtotal AFTER fixed effects", () => {
    const res = calculateRawV2({ config, sqm: 100, addonFixedExclVat: 250, addonPercent: 15 });
    // (1640 + 250) × 1.15 = 1890 × 1.15 = 2173.50.
    expect(res.rawPriceExclVat).toBe(2173.5);
  });

  it("addonPercent is the NET additive percent applied once, not compounded", () => {
    // A net +5 (from +15 and −10) → 1640 × 1.05 = 1722.
    // Compounding 1640 × 1.15 × 0.90 would give 1697.40 — proving it is NOT compounded.
    expect(calculateRawV2({ config, sqm: 100, addonPercent: 5 }).rawPriceExclVat).toBe(1722);
  });

  it("supports a negative percent discount", () => {
    expect(calculateRawV2({ config, sqm: 100, addonPercent: -20 }).rawPriceExclVat).toBe(1312); // 1640 × 0.8
  });

  it("never produces a negative raw price (percent or fixed discount floored at 0)", () => {
    expect(calculateRawV2({ config, sqm: 100, addonPercent: -150 }).rawPriceExclVat).toBe(0);
    expect(calculateRawV2({ config, sqm: 100, addonFixedExclVat: -5000 }).rawPriceExclVat).toBe(0);
  });

  it("worked example: resolver effects feed the engine end-to-end", () => {
    const addons: CalculatorAddonConfigV2[] = [
      addon({ addonKey: "dog", effectTimeMinutes: 20 }),
      addon({ addonKey: "bathrooms", inputType: "quantity", effectTimeMinutes: 15 }),
      addon({ addonKey: "oven", effectFixedExclVat: 250 }),
      addon({ addonKey: "dirty", effectPercent: 15 }),
    ];
    const effects = resolveAddonEffects(addons, { dog: true, bathrooms: 2, oven: true, dirty: true });
    expect(effects.addonMinutes).toBe(50); // 20 + 2×15
    expect(effects.addonFixedExclVat).toBe(250);
    expect(effects.addonPercent).toBe(15);

    const homeConfig = baseConfig({
      sqmAdjustments: [{ fromSqm: 100, toSqm: 120, adjustmentPercent: -10 }],
      plans: [hourlyPlan({ planKey: "flexibel", hourlyRateExclVat: 410, startAdjustmentHours: -0.25 })],
    });
    const res = calculateRawV2({
      config: homeConfig,
      sqm: 100,
      addonMinutes: effects.addonMinutes,
      addonFixedExclVat: effects.addonFixedExclVat,
      addonPercent: effects.addonPercent,
    });
    // Base 100×2.16=216 + 50 add-on = 266 min = 4.43 h (customer-facing, add-on time IN).
    expect(res.estimatedServiceHours).toBe(4.43);
    // pricingHours = 4.43 + (−0.25) = 4.18 (start adjustment price-only).
    expect(res.pricingHours).toBe(4.18);
    // (4.18×410 + 250) × 1.15 = 1963.80 × 1.15 = 2258.37.
    expect(res.rawPriceExclVat).toBe(2258.37);
  });
});

describe("calculateRawV2 — generic add-on effects (sqm_fixed)", () => {
  const config = baseConfig({
    serviceKey: "move_out_cleaning",
    pricingBasis: "sqm_fixed",
    sqmTime: null,
    plans: [sqmPlan({ planKey: "normalt", pricePerSqmExclVat: 48 })],
  });

  it("applies fixed + percent effects but never derives service hours from add-on minutes", () => {
    const res = calculateRawV2({
      config,
      sqm: 80,
      addonFixedExclVat: 200,
      addonPercent: 10,
      addonMinutes: 100, // must NOT create a displayed time for a no-time-model service
    });
    // (80×48 + 200) × 1.10 = 4040 × 1.10 = 4444.
    expect(res.rawPriceExclVat).toBe(4444);
    expect(res.estimatedServiceHours).toBeNull();
    expect(res.pricingHours).toBeNull();
  });
});

describe("calculateRawV2 — validation", () => {
  it("invalidates missing / non-positive sqm", () => {
    const config = baseConfig({ plans: [hourlyPlan({ planKey: "flexibel" })] });

    const missing = calculateRawV2({ config, sqm: null });
    expect(missing.valid).toBe(false);
    expect(missing.rawPriceExclVat).toBeNull();
    expect(missing.issues.some((i) => i.code === "missing_sqm")).toBe(true);

    const zero = calculateRawV2({ config, sqm: 0 });
    expect(zero.valid).toBe(false);
    expect(zero.issues.some((i) => i.code === "invalid_sqm")).toBe(true);
  });

  it("invalidates when no plan is active", () => {
    const config = baseConfig({ plans: [hourlyPlan({ planKey: "flexibel", active: false })] });
    const res = calculateRawV2({ config, sqm: 100 });
    expect(res.valid).toBe(false);
    expect(res.issues.some((i) => i.code === "no_active_plan")).toBe(true);
  });

  it("invalidates a plan whose kind does not match the pricing basis", () => {
    const config = baseConfig({ pricingBasis: "hourly", plans: [sqmPlan({ planKey: "normalt" })] });
    const res = calculateRawV2({ config, sqm: 100 });
    expect(res.valid).toBe(false);
    expect(res.issues.some((i) => i.code === "plan_basis_mismatch")).toBe(true);
  });

  it("invalidates a disabled service", () => {
    const config = baseConfig({ enabled: false, plans: [hourlyPlan({ planKey: "flexibel" })] });
    const res = calculateRawV2({ config, sqm: 100 });
    expect(res.valid).toBe(false);
    expect(res.issues.some((i) => i.code === "service_disabled")).toBe(true);
  });
});
