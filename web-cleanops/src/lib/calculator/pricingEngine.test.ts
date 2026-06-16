import { describe, expect, it } from "vitest";

import {
  buildResultDisplayText,
  calculateHomeCleaningPrice,
  calculateMoveOutCleaningPrice,
  calculateOfficeCleaningPrice,
  calculatePrice,
  coerceBoolean,
  coerceNumber,
  coerceStringArray,
  formatAmount,
  FORMULA_VERSION,
  indexPricingRules,
  resolveSqmAdjustmentPercent,
  round2,
  roundToIncrement,
  toPricingSnapshot,
} from "./pricingEngine";
import type {
  CalculatorAnswers,
  CleaningPlanSnapshot,
  PlanPricingModel,
  PricingRuleValue,
} from "./types";

/**
 * Fixtures mirror migration 0060's seeded defaults for Städalliansen, so these
 * tests also assert the SEEDED numbers produce sane prices. (Placeholder
 * business numbers — the math, not the figures, is what's under test.)
 */
const HOME_RULES: PricingRuleValue[] = [
  { ruleKey: "base_hours", ruleType: "numeric_factor", valueNumeric: 1.5 },
  { ruleKey: "hours_per_sqm", ruleType: "numeric_factor", valueNumeric: 0.02 },
  { ruleKey: "minimum_hours", ruleType: "threshold", valueNumeric: 2 },
  // bathroom_extra_hours is retired in 12I (kept here to prove the engine IGNORES it).
  { ruleKey: "bathroom_extra_hours", ruleType: "numeric_factor", valueNumeric: 0.25 },
  { ruleKey: "addon_hours_oven", ruleType: "addon_hours", valueNumeric: 0.5 },
  { ruleKey: "addon_hours_fridge", ruleType: "addon_hours", valueNumeric: 0.5 },
  { ruleKey: "addon_hours_inside_windows", ruleType: "addon_hours", valueNumeric: 0.75 },
  // Slice 12G: pets time uplift (% added to recommended hours when has_pets is true).
  { ruleKey: "pet_time_percent", ruleType: "margin_percent", valueNumeric: 10 },
  // Slice 12I: rule-driven home time adjustments (minutes).
  { ruleKey: "every_four_weeks_start_minutes", ruleType: "threshold", valueNumeric: 30 },
  { ruleKey: "under_minimum_visit_threshold_minutes", ruleType: "threshold", valueNumeric: 180 },
  { ruleKey: "under_minimum_visit_start_minutes", ruleType: "threshold", valueNumeric: 15 },
  { ruleKey: "strict_setup_start_minutes", ruleType: "threshold", valueNumeric: 0 },
  { ruleKey: "range_min_percent", ruleType: "margin_percent", valueNumeric: 10 },
  { ruleKey: "range_max_percent", ruleType: "margin_percent", valueNumeric: 10 },
  { ruleKey: "rounding_increment", ruleType: "rounding", valueNumeric: 50 },
];

const MOVEOUT_RULES: PricingRuleValue[] = [
  { ruleKey: "price_per_sqm", ruleType: "numeric_factor", valueNumeric: 35 },
  { ruleKey: "minimum_price", ruleType: "threshold", valueNumeric: 1500 },
  { ruleKey: "addon_glazed_balcony", ruleType: "addon_price", valueNumeric: 300 },
  { ruleKey: "addon_divisible_windows", ruleType: "addon_price", valueNumeric: 250 },
  { ruleKey: "addon_extra_bathroom", ruleType: "addon_price", valueNumeric: 200 },
  { ruleKey: "range_min_percent", ruleType: "margin_percent", valueNumeric: 10 },
  { ruleKey: "range_max_percent", ruleType: "margin_percent", valueNumeric: 10 },
  { ruleKey: "rounding_increment", ruleType: "rounding", valueNumeric: 50 },
];

const FLEXIBLE: CleaningPlanSnapshot = { planKey: "flexible", name: "Flexibel", hourlyRate: 349 };
const FIXED: CleaningPlanSnapshot = { planKey: "fixed", name: "Fast", hourlyRate: 399 };
const PRIORITY: CleaningPlanSnapshot = { planKey: "priority", name: "Prioritet", hourlyRate: 449 };

function home(
  answers: CalculatorAnswers,
  plan: CleaningPlanSnapshot | null = FLEXIBLE,
  rules: PricingRuleValue[] = HOME_RULES,
) {
  return calculateHomeCleaningPrice({
    pricingModel: "home_cleaning_recommended_hours",
    answers,
    rules,
    plan,
  });
}

function moveOut(answers: CalculatorAnswers) {
  return calculateMoveOutCleaningPrice({
    pricingModel: "move_out_fixed_plus_addons",
    answers,
    rules: MOVEOUT_RULES,
  });
}

/** Office rules mirror migration 0066 + 0067's seeded placeholders. */
const OFFICE_RULES: PricingRuleValue[] = [
  { ruleKey: "base_visit_hours", ruleType: "numeric_factor", valueNumeric: 1.0 },
  { ruleKey: "hours_per_sqm", ruleType: "numeric_factor", valueNumeric: 0.008 },
  { ruleKey: "toilet_extra_hours", ruleType: "numeric_factor", valueNumeric: 0.2 },
  { ruleKey: "meeting_room_extra_hours", ruleType: "numeric_factor", valueNumeric: 0.15 },
  { ruleKey: "workstation_extra_hours", ruleType: "numeric_factor", valueNumeric: 0.02 },
  { ruleKey: "kitchen_extra_hours", ruleType: "numeric_factor", valueNumeric: 0.3 },
  { ruleKey: "minimum_hours_per_visit", ruleType: "threshold", valueNumeric: 1.5 },
  { ruleKey: "hourly_rate", ruleType: "numeric_factor", valueNumeric: 459 },
  // Slice 12F: supervision per-visit start overhead (minutes).
  { ruleKey: "supervision_start_minutes", ruleType: "threshold", valueNumeric: 15 },
  { ruleKey: "range_min_percent", ruleType: "margin_percent", valueNumeric: 10 },
  { ruleKey: "range_max_percent", ruleType: "margin_percent", valueNumeric: 10 },
  { ruleKey: "rounding_increment", ruleType: "rounding", valueNumeric: 50 },
];

function office(answers: CalculatorAnswers, rules: PricingRuleValue[] = OFFICE_RULES) {
  return calculateOfficeCleaningPrice({
    pricingModel: "office_cleaning_recurring_area_frequency",
    answers,
    rules,
  });
}

describe("coercion helpers", () => {
  it("coerceNumber accepts numbers, numeric + Swedish-formatted strings", () => {
    expect(coerceNumber(70)).toBe(70);
    expect(coerceNumber("70")).toBe(70);
    expect(coerceNumber("70,5")).toBe(70.5);
    expect(coerceNumber("1 200")).toBe(1200);
  });

  it("coerceNumber rejects empty / non-numeric / non-finite", () => {
    expect(coerceNumber("")).toBeNull();
    expect(coerceNumber("   ")).toBeNull();
    expect(coerceNumber("abc")).toBeNull();
    expect(coerceNumber(null)).toBeNull();
    expect(coerceNumber(undefined)).toBeNull();
    expect(coerceNumber(Number.NaN)).toBeNull();
    expect(coerceNumber(true)).toBeNull();
  });

  it("coerceBoolean reads common truthy tokens", () => {
    expect(coerceBoolean(true)).toBe(true);
    expect(coerceBoolean("true")).toBe(true);
    expect(coerceBoolean("ja")).toBe(true);
    expect(coerceBoolean("yes")).toBe(true);
    expect(coerceBoolean(1)).toBe(true);
    expect(coerceBoolean(false)).toBe(false);
    expect(coerceBoolean("no")).toBe(false);
    expect(coerceBoolean(undefined)).toBe(false);
  });

  it("coerceStringArray normalizes arrays and single strings", () => {
    expect(coerceStringArray(["oven", "fridge"])).toEqual(["oven", "fridge"]);
    expect(coerceStringArray("oven")).toEqual(["oven"]);
    expect(coerceStringArray(["oven", "", " "])).toEqual(["oven"]);
    expect(coerceStringArray("")).toEqual([]);
    expect(coerceStringArray(null)).toEqual([]);
  });
});

describe("math + format helpers", () => {
  it("round2 tames float noise", () => {
    expect(round2(70 * 0.02 + 1.5 + 0.25 + 0.5)).toBe(3.65);
    expect(round2(1.005)).toBe(1.01);
  });

  it("roundToIncrement rounds to the nearest multiple", () => {
    expect(roundToIncrement(1273.85, 50)).toBe(1250);
    expect(roundToIncrement(1146.465, 50)).toBe(1150);
    expect(roundToIncrement(2950, 50)).toBe(2950);
    expect(roundToIncrement(0, 50)).toBe(0);
  });

  it("roundToIncrement with no/zero increment rounds to integer", () => {
    expect(roundToIncrement(1273.85, 0)).toBe(1274);
    expect(roundToIncrement(1273.85, null)).toBe(1274);
    expect(roundToIncrement(1273.85, undefined)).toBe(1274);
  });

  it("formatAmount groups thousands and appends a currency suffix", () => {
    expect(formatAmount(1250)).toBe("1 250 kr");
    expect(formatAmount(1000000)).toBe("1 000 000 kr");
    expect(formatAmount(700, "SEK")).toBe("700 kr");
    expect(formatAmount(700, "EUR")).toBe("700 EUR");
  });

  it("indexPricingRules keeps only finite numeric values", () => {
    const index = indexPricingRules([
      { ruleKey: "a", ruleType: "numeric_factor", valueNumeric: 2 },
      { ruleKey: "b", ruleType: "numeric_factor", valueNumeric: null },
    ]);
    expect(index.get("a")).toBe(2);
    expect(index.has("b")).toBe(false);
  });
});

describe("home cleaning pricing (Slice 12I — four-week period + time rules)", () => {
  it("prices the canonical example as a four-week period (70 m², weekly, oven)", () => {
    const r = home({ sqm: 70, frequency: "weekly", addons: ["oven"] });
    expect(r.valid).toBe(true);
    expect(r.estimatedHours).toBe(3.4); // 1.5 + 1.4 + 0.5 per visit (NO bathrooms)
    expect(r.rawPrice).toBe(4746.4); // 3.4 h * 349 kr * 4 visits / four weeks
    expect(r.priceExclVat).toBe(4750);
    expect(r.vatRatePercent).toBe(25);
    expect(r.vatAmount).toBe(1187.5);
    expect(r.priceInclVat).toBe(5937.5);
    expect(r.calculatedPrice).toBe(5937.5);
    expect(r.minPrice).toBe(5312.5); // -10%, then VAT
    expect(r.maxPrice).toBe(6500); // +10%, then VAT
    expect(r.currency).toBe("SEK");
    expect(r.formulaVersion).toBe(FORMULA_VERSION);
    expect(r.selectedPlanSnapshot).toEqual(FLEXIBLE);
  });

  it("multiplies the per-visit price by the four-week interval (weekly=4, biweekly=2)", () => {
    // 90 m² → 3.3 h/visit, ≥180 min so no under-minimum, no every-four-weeks bump.
    const weekly = home({ sqm: 90, frequency: "weekly" });
    const biweekly = home({ sqm: 90, frequency: "biweekly" });
    expect(weekly.estimatedHours).toBe(3.3);
    expect(biweekly.estimatedHours).toBe(3.3); // per-visit hours are interval-independent here
    expect(weekly.rawPrice!).toBeCloseTo(biweekly.rawPrice! * 2, 6); // 4 visits vs 2
    expect(weekly.calculatedPrice!).toBeGreaterThan(biweekly.calculatedPrice!);
  });

  it("shows a per-visit total before an interval is chosen (multiplier 1, never a four-week total)", () => {
    const perVisitOnly = home({ sqm: 90 }); // no frequency → multiplier 1
    const weekly = home({ sqm: 90, frequency: "weekly" });
    expect(weekly.rawPrice!).toBeCloseTo(perVisitOnly.rawPrice! * 4, 6);
  });

  it("adds every_four_weeks_start_minutes (+30) for the four-weekly interval, per visit", () => {
    const weekly = home({ sqm: 90, frequency: "weekly" }); // 3.3 h
    const everyFour = home({ sqm: 90, frequency: "every_four_weeks" }); // 3.3 + 0.5
    expect(weekly.estimatedHours).toBe(3.3);
    expect(everyFour.estimatedHours).toBe(3.8);
    expect(everyFour.steps.some((s) => s.key === "every_four_weeks_minutes")).toBe(true);
  });

  it("adds under-minimum start minutes (+15) for short BASE visits only", () => {
    // 50 m² → base 2.5 h = 150 min < 180 → +15 min = 0.25 h.
    const short = home({ sqm: 50, frequency: "weekly" });
    expect(short.estimatedHours).toBe(2.75);
    expect(short.steps.some((s) => s.key === "under_minimum_minutes")).toBe(true);
    // 90 m² → base 3.3 h = 198 min ≥ 180 → no under-minimum add.
    const long = home({ sqm: 90, frequency: "weekly" });
    expect(long.estimatedHours).toBe(3.3);
    expect(long.steps.some((s) => s.key === "under_minimum_minutes")).toBe(false);
  });

  it("stacks every_four_weeks (+30) and under-3h (+15) to +45 min (spec example)", () => {
    // 50 m² → base 2.5 h = 150 min. every_four_weeks (+30) + under-minimum (+15) = +45.
    const r = home({ sqm: 50, frequency: "every_four_weeks" });
    expect(r.estimatedHours).toBe(3.25); // 2.5 + 0.75
  });

  it("no longer charges for bathrooms (the field is retired)", () => {
    const withBaths = home({ sqm: 70, frequency: "weekly", bathrooms: 5, addons: ["oven"] });
    const noBaths = home({ sqm: 70, frequency: "weekly", addons: ["oven"] });
    expect(withBaths.estimatedHours).toBe(noBaths.estimatedHours);
    expect(withBaths.calculatedPrice).toBe(noBaths.calculatedPrice);
    expect(withBaths.steps.some((s) => s.key === "bathroom_hours")).toBe(false);
  });

  it("has no monthly behavior — legacy intervals fall back to a per-visit total", () => {
    const noFreq = home({ sqm: 90 });
    const monthly = home({ sqm: 90, frequency: "monthly" }); // legacy → multiplier 1, no bump
    expect(monthly.estimatedHours).toBe(noFreq.estimatedHours);
    expect(monthly.rawPrice).toBe(noFreq.rawPrice);
  });

  it("clamps to minimum_hours for tiny apartments", () => {
    // 10 m² → base 1.7 h = 102 min → +15 under-min = 1.95 h → clamped to 2 h.
    const r = home({ sqm: 10, frequency: "weekly" });
    expect(r.estimatedHours).toBe(2);
    expect(r.priceExclVat).toBe(2800); // 2 h * 349 * 4 = 2792 → 2800 excl. VAT
    expect(r.calculatedPrice).toBe(3500); // +25% VAT
    expect(r.steps.find((s) => s.key === "estimated_hours")?.detail).toContain("Minst");
  });

  it("a higher-rate plan yields a higher price for identical answers", () => {
    const answers: CalculatorAnswers = { sqm: 70, frequency: "weekly", addons: ["oven"] };
    const flx = home(answers, FLEXIBLE);
    const fix = home(answers, FIXED);
    const pri = home(answers, PRIORITY);
    expect(flx.estimatedHours).toBe(fix.estimatedHours); // hours independent of plan
    expect(pri.calculatedPrice!).toBeGreaterThan(fix.calculatedPrice!);
    expect(fix.calculatedPrice!).toBeGreaterThan(flx.calculatedPrice!);
  });

  it("sums multiple add-on hours and ignores unknown add-ons", () => {
    const all = home({ sqm: 70, frequency: "weekly", addons: ["oven", "fridge", "inside_windows"] });
    expect(all.estimatedHours).toBe(4.65); // 1.5 + 1.4 + (0.5 + 0.5 + 0.75)

    const withUnknown = home({ sqm: 70, frequency: "weekly", addons: ["does_not_exist"] });
    const none = home({ sqm: 70, frequency: "weekly" });
    expect(withUnknown.calculatedPrice).toBe(none.calculatedPrice);
  });

  it("is invalid without area or plan", () => {
    const noSqm = home({ frequency: "weekly" });
    expect(noSqm.valid).toBe(false);
    expect(noSqm.calculatedPrice).toBeNull();
    expect(noSqm.issues.map((i) => i.code)).toContain("missing_sqm");

    const zeroSqm = home({ sqm: 0 });
    expect(zeroSqm.issues.map((i) => i.code)).toContain("invalid_sqm");

    const noPlan = home({ sqm: 70 }, null);
    expect(noPlan.valid).toBe(false);
    expect(noPlan.issues.map((i) => i.code)).toContain("missing_plan");
  });
});

describe("home cleaning plan TIME adjustment (Slice 12J — gated by plan model)", () => {
  // In time_adjustment_per_visit mode every plan shares ONE hourly rate (399) and
  // differs ONLY by a rule-driven per-visit time delta keyed by plan_key.
  const FAST_PLAN: CleaningPlanSnapshot = { planKey: "fixed", name: "Fast", hourlyRate: 399 };
  const FLEX_PLAN: CleaningPlanSnapshot = { planKey: "flexible", name: "Flexibel", hourlyRate: 399 };
  const PRIO_PLAN: CleaningPlanSnapshot = { planKey: "priority", name: "Prioritet", hourlyRate: 399 };
  const TIME_ADJ_RULES: PricingRuleValue[] = [
    ...HOME_RULES,
    { ruleKey: "plan_time_adjustment_hours_flexible", ruleType: "threshold", valueNumeric: -0.25 },
    { ruleKey: "plan_time_adjustment_hours_fixed", ruleType: "threshold", valueNumeric: 0.25 },
    { ruleKey: "plan_time_adjustment_hours_priority", ruleType: "threshold", valueNumeric: 0.5 },
  ];

  // 90 m² weekly → 3.3 h base (no under-minimum, no four-week bump, no pets), so
  // the only variable is the gated plan time adjustment.
  function homeWithMode(planPricingModel: PlanPricingModel, plan: CleaningPlanSnapshot) {
    return calculateHomeCleaningPrice({
      pricingModel: "home_cleaning_recommended_hours",
      answers: { sqm: 90, frequency: "weekly" },
      rules: TIME_ADJ_RULES,
      plan,
      servicePlanSettings: {
        plansEnabled: true,
        planPricingModel,
        defaultPlanKey: plan.planKey,
        baseHourlyRateExclVat: 399,
        defaultVatRatePercent: 25,
      },
    });
  }

  it("applies the plan delta ONLY in time_adjustment_per_visit mode (Fast +0.25 h)", () => {
    const r = homeWithMode("time_adjustment_per_visit", FAST_PLAN);
    expect(r.estimatedHours).toBe(3.55); // 3.3 + 0.25
    expect(r.steps.some((s) => s.key === "plan_time_adjustment")).toBe(true);
  });

  it("applies the configured Flexibel −0.25 h / Fast +0.25 h / Prioritet +0.5 h deltas per visit", () => {
    expect(homeWithMode("time_adjustment_per_visit", FLEX_PLAN).estimatedHours).toBe(3.05);
    expect(homeWithMode("time_adjustment_per_visit", FAST_PLAN).estimatedHours).toBe(3.55);
    expect(homeWithMode("time_adjustment_per_visit", PRIO_PLAN).estimatedHours).toBe(3.8);
  });

  it("IGNORES plan_time_adjustment_hours in hourly_rate_by_plan mode even when the rule exists", () => {
    const r = homeWithMode("hourly_rate_by_plan", FAST_PLAN);
    expect(r.estimatedHours).toBe(3.3); // unchanged base — delta not applied
    expect(r.steps.some((s) => s.key === "plan_time_adjustment")).toBe(false);
  });

  it("IGNORES plan_time_adjustment_hours in price_adjustment_per_plan mode even when the rule exists", () => {
    const r = homeWithMode("price_adjustment_per_plan", FAST_PLAN);
    expect(r.estimatedHours).toBe(3.3); // unchanged base — delta not applied
    expect(r.steps.some((s) => s.key === "plan_time_adjustment")).toBe(false);
  });

  it("keeps ONE hourly rate across plans (only the per-visit time differs → Fast > Flexibel)", () => {
    const fast = homeWithMode("time_adjustment_per_visit", FAST_PLAN);
    const flexible = homeWithMode("time_adjustment_per_visit", FLEX_PLAN);
    const fastRate = fast.steps.find((s) => s.key === "hourly_rate")?.value;
    const flexRate = flexible.steps.find((s) => s.key === "hourly_rate")?.value;
    expect(fastRate).toBe(flexRate); // same rate (399) — never a per-plan rate
    expect(fast.calculatedPrice!).toBeGreaterThan(flexible.calculatedPrice!);
  });
});

describe("home cleaning pets (Slice 12G)", () => {
  const ANSWERS: CalculatorAnswers = { sqm: 70, frequency: "weekly", addons: ["oven"] };

  it("has_pets false (or absent) adds NO time — identical to the baseline price", () => {
    const baseline = home(ANSWERS);
    const petsOff = home({ ...ANSWERS, has_pets: false });
    expect(petsOff.estimatedHours).toBe(baseline.estimatedHours);
    expect(petsOff.calculatedPrice).toBe(baseline.calculatedPrice);
    // No pet step is added when the toggle is off.
    expect(petsOff.steps.some((s) => s.key === "pet_time")).toBe(false);
  });

  it("has_pets true increases the estimated time by the configured percent", () => {
    const baseline = home(ANSWERS); // 3.4 h/visit
    const withPets = home({ ...ANSWERS, has_pets: true });
    // 3.4 h + 10% = 3.74; price rises above the baseline.
    expect(withPets.estimatedHours).toBe(3.74);
    expect(withPets.estimatedHours!).toBeGreaterThan(baseline.estimatedHours!);
    expect(withPets.calculatedPrice!).toBeGreaterThan(baseline.calculatedPrice!);
    expect(withPets.steps.find((s) => s.key === "pet_time")?.detail).toContain("+10%");
  });

  it("reads the percentage from the rule (NOT hardcoded) — a bigger rule means more time", () => {
    const tenPercent = home({ ...ANSWERS, has_pets: true });
    const twentyPercent = home(
      { ...ANSWERS, has_pets: true },
      FLEXIBLE,
      HOME_RULES.map((r) => (r.ruleKey === "pet_time_percent" ? { ...r, valueNumeric: 20 } : r)),
    );
    expect(twentyPercent.estimatedHours!).toBeGreaterThan(tenPercent.estimatedHours!);
  });

  it("fails safely when the pet_time_percent rule is absent (0% → no effect, no crash)", () => {
    const noRule = HOME_RULES.filter((r) => r.ruleKey !== "pet_time_percent");
    const baseline = home(ANSWERS, FLEXIBLE, noRule);
    const withPets = home({ ...ANSWERS, has_pets: true }, FLEXIBLE, noRule);
    expect(withPets.valid).toBe(true);
    // Missing rule → 0% uplift → identical to baseline (fail-safe).
    expect(withPets.estimatedHours).toBe(baseline.estimatedHours);
    expect(withPets.calculatedPrice).toBe(baseline.calculatedPrice);
  });

  it("does NOT affect move-out (pets is a home-only factor)", () => {
    const a = moveOut({ sqm: 70, bathrooms: 1 });
    const b = moveOut({ sqm: 70, bathrooms: 1, has_pets: true });
    expect(b.calculatedPrice).toBe(a.calculatedPrice);
  });
});

describe("move-out cleaning pricing", () => {
  it("prices per m² with a glazed balcony and one extra bathroom", () => {
    const r = moveOut({ sqm: 70, bathrooms: 2, glazed_balcony: true });
    expect(r.valid).toBe(true);
    expect(r.estimatedHours).toBeNull(); // move-out is not hours-based
    expect(r.rawPrice).toBe(2950); // max(1500, 2450) + 300 + 200
    expect(r.calculatedPrice).toBe(2950);
    expect(r.minPrice).toBe(2650);
    expect(r.maxPrice).toBe(3250);
    expect(r.selectedPlanSnapshot).toBeNull(); // no plan required
  });

  it("applies the minimum price floor for small areas", () => {
    const r = moveOut({ sqm: 30, bathrooms: 1 }); // 30*35 = 1050 < 1500
    expect(r.rawPrice).toBe(1500);
    expect(r.calculatedPrice).toBe(1500);
    expect(r.minPrice).toBe(1350);
    expect(r.maxPrice).toBe(1650);
    expect(r.steps.find((s) => s.key === "base_price")?.detail).toContain("Minimipris");
  });

  it("stacks divisible windows and multiple extra bathrooms", () => {
    const r = moveOut({ sqm: 100, bathrooms: 3, divisible_windows: true });
    // base 3500 + div 250 + (3-1)*200 = 4150
    expect(r.rawPrice).toBe(4150);
    expect(r.calculatedPrice).toBe(4150);
    expect(r.minPrice).toBe(3750); // 3735 → 3750
    expect(r.maxPrice).toBe(4550); // 4565 → 4550
  });

  it("charges nothing extra when there is only one bathroom", () => {
    const single = moveOut({ sqm: 70, bathrooms: 1 });
    const noBathAnswer = moveOut({ sqm: 70 }); // defaults to 1
    expect(single.calculatedPrice).toBe(noBathAnswer.calculatedPrice);
    expect(single.steps.some((s) => s.key === "addon_extra_bathroom")).toBe(false);
  });

  it("is invalid without a positive area", () => {
    expect(moveOut({}).issues.map((i) => i.code)).toContain("missing_sqm");
    expect(moveOut({ sqm: -5 }).issues.map((i) => i.code)).toContain("invalid_sqm");
  });
});

describe("office cleaning pricing (recurring monthly)", () => {
  const FULL: CalculatorAnswers = {
    sqm: 200,
    frequency: "weekly",
    toilets: 2,
    meeting_rooms: 1,
    workstations: 10,
    has_kitchen: true,
  };

  it("prices the canonical office example as a monthly estimate", () => {
    const r = office(FULL);
    expect(r.valid).toBe(true);
    // estimatedHours is hours PER VISIT (1 + 1.6 + 0.4 + 0.15 + 0.2 + 0.3).
    expect(r.estimatedHours).toBe(3.65);
    expect(r.rawPrice).toBe(7254.27); // 3.65 h * 4.33 visits/mo * 459 kr/h
    expect(r.calculatedPrice).toBe(7250);
    expect(r.minPrice).toBe(6550); // -10%
    expect(r.maxPrice).toBe(8000); // +10%
    expect(r.selectedPlanSnapshot).toBeNull(); // office never uses a cleaning plan
  });

  it("scales the monthly price by frequency (daily > weekly > monthly)", () => {
    const daily = office({ ...FULL, frequency: "daily" });
    const weekly = office({ ...FULL, frequency: "weekly" });
    const monthly = office({ ...FULL, frequency: "monthly" });
    expect(daily.calculatedPrice!).toBeGreaterThan(weekly.calculatedPrice!);
    expect(weekly.calculatedPrice!).toBeGreaterThan(monthly.calculatedPrice!);
  });

  it("each pricing input raises the price (sqm, toilets, meeting rooms, kitchen, workstations)", () => {
    const base = office({ sqm: 100, frequency: "weekly" });
    expect(office({ sqm: 200, frequency: "weekly" }).calculatedPrice!).toBeGreaterThan(base.calculatedPrice!);
    expect(office({ sqm: 100, frequency: "weekly", toilets: 3 }).calculatedPrice!).toBeGreaterThan(base.calculatedPrice!);
    expect(office({ sqm: 100, frequency: "weekly", meeting_rooms: 4 }).calculatedPrice!).toBeGreaterThan(base.calculatedPrice!);
    expect(office({ sqm: 100, frequency: "weekly", has_kitchen: true }).calculatedPrice!).toBeGreaterThan(base.calculatedPrice!);
    expect(office({ sqm: 100, frequency: "weekly", workstations: 50 }).calculatedPrice!).toBeGreaterThan(base.calculatedPrice!);
  });

  it("floors a tiny office at minimum_hours_per_visit", () => {
    const r = office({ sqm: 10, frequency: "monthly" }); // 1.0 + 0.08 = 1.08 → clamped to 1.5
    expect(r.estimatedHours).toBe(1.5);
    expect(r.calculatedPrice).toBe(700); // 1.5 * 1 * 459 = 688.5 → 700
    expect(r.steps.find((s) => s.key === "hours_per_visit")?.detail).toContain("Minst");
  });

  it("applies the ± margin range snapped to the rounding increment", () => {
    const r = office(FULL);
    expect(r.minPrice!).toBeLessThan(r.calculatedPrice!);
    expect(r.maxPrice!).toBeGreaterThan(r.calculatedPrice!);
    expect(r.calculatedPrice! % 50).toBe(0);
    expect(r.minPrice! % 50).toBe(0);
    expect(r.maxPrice! % 50).toBe(0);
  });

  it("is invalid without a positive area or a known frequency", () => {
    expect(office({ frequency: "weekly" }).issues.map((i) => i.code)).toContain("missing_sqm");
    expect(office({ sqm: -5, frequency: "weekly" }).issues.map((i) => i.code)).toContain("invalid_sqm");
    expect(office({ sqm: 200 }).issues.map((i) => i.code)).toContain("missing_frequency");
    expect(office({ sqm: 200, frequency: "nope" }).issues.map((i) => i.code)).toContain("missing_frequency");
    expect(office({ sqm: 200 }).calculatedPrice).toBeNull();
  });

  // ── Slice 12F: interval set, custom-interval manual review, supervision ──────
  it("maps the new interval keys monotonically (weekday_daily > weekly > biweekly > every_four_weeks)", () => {
    const wd = office({ sqm: 100, frequency: "weekday_daily" }).calculatedPrice!;
    const wk = office({ sqm: 100, frequency: "weekly" }).calculatedPrice!;
    const bw = office({ sqm: 100, frequency: "biweekly" }).calculatedPrice!;
    const e4 = office({ sqm: 100, frequency: "every_four_weeks" }).calculatedPrice!;
    expect(wd).toBeGreaterThan(wk);
    expect(wk).toBeGreaterThan(bw);
    expect(bw).toBeGreaterThan(e4);
    // weekday_daily is 5 visits/week vs weekly's 1 → ~5× the monthly cost (the
    // tiny gap is just round2 applied to each rawPrice independently).
    expect(office({ sqm: 100, frequency: "weekday_daily" }).rawPrice!).toBeCloseTo(
      office({ sqm: 100, frequency: "weekly" }).rawPrice! * 5,
      1,
    );
  });

  it("routes custom_interval to MANUAL REVIEW (no price, valid:false, requiresManualReview)", () => {
    const r = office({ sqm: 200, frequency: "custom_interval", toilets: 2 });
    expect(r.valid).toBe(false);
    expect(r.calculatedPrice).toBeNull();
    expect(r.requiresManualReview).toBe(true);
    expect(r.manualReviewReason).toBe("custom_interval");
    expect(r.issues.map((i) => i.code)).toContain("manual_review_required");
    // Short-circuits BEFORE sqm validation, so it never blocks on missing area.
    const noSqm = office({ frequency: "custom_interval" });
    expect(noSqm.requiresManualReview).toBe(true);
    expect(noSqm.issues.map((i) => i.code)).not.toContain("missing_sqm");
  });

  it("a normal (priced) office result never flags manual review", () => {
    const r = office({ sqm: 200, frequency: "weekly" });
    expect(r.valid).toBe(true);
    expect(r.requiresManualReview).toBe(false);
    expect(r.manualReviewReason).toBeNull();
  });

  it("supervision OFF adds no cost (visits/minutes ignored when the toggle is off)", () => {
    const off = office({ sqm: 100, frequency: "weekly" });
    const offWithDetails = office({
      sqm: 100,
      frequency: "weekly",
      supervision_cleaning: false,
      supervision_visits_per_week: 3,
      supervision_minutes_per_visit: 60,
    });
    expect(offWithDetails.calculatedPrice).toBe(off.calculatedPrice);
    expect(off.steps.some((s) => s.key === "supervision_monthly_price")).toBe(false);
  });

  it("supervision ON adds a recurring cost on top of the base monthly price", () => {
    const base = office({ sqm: 100, frequency: "weekly" });
    const withSup = office({
      sqm: 100,
      frequency: "weekly",
      supervision_cleaning: true,
      supervision_visits_per_week: 2,
      supervision_minutes_per_visit: 30,
    });
    expect(withSup.rawPrice!).toBeGreaterThan(base.rawPrice!);
    expect(withSup.steps.some((s) => s.key === "supervision_monthly_price")).toBe(true);
    // More visits and more minutes both raise the price.
    expect(
      office({ sqm: 100, frequency: "weekly", supervision_cleaning: true, supervision_visits_per_week: 3, supervision_minutes_per_visit: 30 }).rawPrice!,
    ).toBeGreaterThan(withSup.rawPrice!);
    expect(
      office({ sqm: 100, frequency: "weekly", supervision_cleaning: true, supervision_visits_per_week: 2, supervision_minutes_per_visit: 60 }).rawPrice!,
    ).toBeGreaterThan(withSup.rawPrice!);
  });

  it("adds supervision_start_minutes to the customer's minutes (30 + 15 = 45 effective)", () => {
    // Scenario A: 45 min entered, 0 start. Scenario B: 30 min entered, 15 start.
    // Both yield 45 effective minutes → identical price, proving the addition.
    const startZero = OFFICE_RULES.map((r) =>
      r.ruleKey === "supervision_start_minutes" ? { ...r, valueNumeric: 0 } : r,
    );
    const a = office(
      { sqm: 100, frequency: "weekly", supervision_cleaning: true, supervision_visits_per_week: 2, supervision_minutes_per_visit: 45 },
      startZero,
    );
    const b = office({
      sqm: 100,
      frequency: "weekly",
      supervision_cleaning: true,
      supervision_visits_per_week: 2,
      supervision_minutes_per_visit: 30,
    });
    expect(a.rawPrice).toBe(b.rawPrice);
  });

  it("fails safely when supervision_start_minutes rule is absent (start defaults to 0)", () => {
    const noStartRule = OFFICE_RULES.filter((r) => r.ruleKey !== "supervision_start_minutes");
    const r = office(
      { sqm: 100, frequency: "weekly", supervision_cleaning: true, supervision_visits_per_week: 2, supervision_minutes_per_visit: 30 },
      noStartRule,
    );
    // No crash; supervision still priced with a 0-minute start (30 min effective).
    expect(r.valid).toBe(true);
    expect(r.calculatedPrice).not.toBeNull();
  });
});

describe("office cleaning plan TIME adjustment (Slice 12L — per-plan hourly price + fixed time per visit)", () => {
  const OFFICE_FULL: CalculatorAnswers = {
    sqm: 200,
    frequency: "weekly",
    toilets: 2,
    meeting_rooms: 1,
    workstations: 10,
    has_kitchen: true,
  };

  function officePlan(over: Partial<CleaningPlanSnapshot> = {}): CleaningPlanSnapshot {
    return {
      planKey: "standard",
      name: "Standard",
      hourlyRate: 459,
      vatRatePercent: 25,
      priceAdjustmentType: "fixed_amount",
      priceAdjustmentValue: 0,
      rutEligible: false,
      rutEnabled: false,
      ...over,
    };
  }

  function officeAdjusted(plan: CleaningPlanSnapshot, model: PlanPricingModel = "hourly_rate_plus_time_adjustment") {
    return calculateOfficeCleaningPrice({
      pricingModel: "office_cleaning_recurring_area_frequency",
      answers: OFFICE_FULL,
      rules: OFFICE_RULES,
      plan,
      servicePlanSettings: {
        plansEnabled: true,
        planPricingModel: model,
        defaultPlanKey: plan.planKey,
        baseHourlyRateExclVat: null,
        defaultVatRatePercent: 25,
      },
    });
  }

  it("applies a fixed total time adjustment ONCE per visit (3.65 h + 0.25 = 3.90 h)", () => {
    const base = officeAdjusted(officePlan({ priceAdjustmentValue: 0 }));
    const plus = officeAdjusted(officePlan({ priceAdjustmentValue: 0.25 }));
    expect(base.estimatedHours).toBe(3.65);
    expect(plus.estimatedHours).toBe(3.9); // once per visit, not per hour
    expect(plus.steps.some((s) => s.key === "office_plan_time_adjustment")).toBe(true);
  });

  it("subtracts a negative adjustment once per visit (3.65 h - 0.25 = 3.40 h)", () => {
    const minus = officeAdjusted(officePlan({ priceAdjustmentValue: -0.25 }));
    expect(minus.estimatedHours).toBe(3.4);
  });

  it("adds the adjustment ONCE per visit (price delta = adj h × visits/month × rate), never per hour", () => {
    const base = officeAdjusted(officePlan({ priceAdjustmentValue: 0 }));
    const plus = officeAdjusted(officePlan({ priceAdjustmentValue: 1 }));
    // 1 h once per visit × 4.33 visits/month × 459 kr/h.
    expect(plus.rawPrice! - base.rawPrice!).toBeCloseTo(1 * 4.33 * 459, 2);
  });

  it("uses the SELECTED plan's hourly price (different rate → different price)", () => {
    const cheap = officeAdjusted(officePlan({ hourlyRate: 429 }));
    const dear = officeAdjusted(officePlan({ hourlyRate: 499 }));
    expect(dear.rawPrice!).toBeGreaterThan(cheap.rawPrice!);
  });

  it("IGNORES the time adjustment in other plan models (price_adjustment_value not treated as hours)", () => {
    const adjusted = officeAdjusted(officePlan({ priceAdjustmentValue: 0.25 }), "hourly_rate_by_plan");
    expect(adjusted.estimatedHours).toBe(3.65); // unchanged — no time delta applied
    expect(adjusted.steps.some((s) => s.key === "office_plan_time_adjustment")).toBe(false);
  });

  it("supports the three pilot business cases (same rate + diff time / diff rate + no time / diff rate + diff time)", () => {
    // Same hourly price + different fixed time adjustment.
    const sameRateNoAdj = officeAdjusted(officePlan({ hourlyRate: 459, priceAdjustmentValue: 0 }));
    const sameRatePlus = officeAdjusted(officePlan({ hourlyRate: 459, priceAdjustmentValue: 0.5 }));
    expect(sameRatePlus.estimatedHours!).toBeGreaterThan(sameRateNoAdj.estimatedHours!);
    expect(sameRatePlus.rawPrice!).toBeGreaterThan(sameRateNoAdj.rawPrice!);

    // Different hourly price + no time adjustment.
    const lowRate = officeAdjusted(officePlan({ hourlyRate: 429, priceAdjustmentValue: 0 }));
    const highRate = officeAdjusted(officePlan({ hourlyRate: 499, priceAdjustmentValue: 0 }));
    expect(lowRate.estimatedHours).toBe(highRate.estimatedHours);
    expect(highRate.rawPrice!).toBeGreaterThan(lowRate.rawPrice!);

    // Different hourly price + different fixed time adjustment.
    const combo = officeAdjusted(officePlan({ hourlyRate: 499, priceAdjustmentValue: 0.25 }));
    expect(combo.estimatedHours).toBe(3.9);
  });
});

describe("calculatePrice dispatcher", () => {
  it("routes to the home calculator", () => {
    const viaDispatch = calculatePrice({
      pricingModel: "home_cleaning_recommended_hours",
      answers: { sqm: 70, bathrooms: 1, addons: ["oven"] },
      rules: HOME_RULES,
      plan: FLEXIBLE,
    });
    expect(viaDispatch.calculatedPrice).toBe(home({ sqm: 70, bathrooms: 1, addons: ["oven"] }).calculatedPrice);
  });

  it("routes to the move-out calculator", () => {
    const viaDispatch = calculatePrice({
      pricingModel: "move_out_fixed_plus_addons",
      answers: { sqm: 70, bathrooms: 2, glazed_balcony: true },
      rules: MOVEOUT_RULES,
    });
    expect(viaDispatch.calculatedPrice).toBe(2950);
  });

  it("routes to the office calculator", () => {
    const viaDispatch = calculatePrice({
      pricingModel: "office_cleaning_recurring_area_frequency",
      answers: { sqm: 200, frequency: "weekly", toilets: 2, meeting_rooms: 1, workstations: 10, has_kitchen: true },
      rules: OFFICE_RULES,
    });
    expect(viaDispatch.calculatedPrice).toBe(7250);
  });

  it("is deterministic — same input yields a deeply equal result", () => {
    const input = {
      pricingModel: "home_cleaning_recommended_hours" as const,
      answers: { sqm: 88, bathrooms: 2, addons: ["fridge"] },
      rules: HOME_RULES,
      plan: PRIORITY,
    };
    expect(calculatePrice(input)).toEqual(calculatePrice(input));
  });
});

describe("display text", () => {
  it("formats a range, an exact, and a hidden price", () => {
    // No interval → multiplier 1 (per-visit total): 3.4 h * 349 = 1186.6.
    const r = home({ sqm: 70, addons: ["oven"] });
    expect(buildResultDisplayText({ ...r, priceDisplayMode: "range" })).toBe("1 313–1 625 kr");
    expect(buildResultDisplayText({ ...r, priceDisplayMode: "exact" })).toBe("Cirka 1 500 kr");
    expect(buildResultDisplayText({ ...r, priceDisplayMode: "hidden_until_submit" })).toBe(
      "Pris visas när du skickat din förfrågan.",
    );
  });

  it("returns an empty string for an invalid result", () => {
    expect(buildResultDisplayText(home({}))).toBe("");
  });
});

describe("pricing snapshot", () => {
  it("freezes a valid result into the persisted snapshot shape", () => {
    const r = home({ sqm: 70, addons: ["oven"] }); // no interval → per-visit total
    const snap = toPricingSnapshot(r);
    expect(snap).not.toBeNull();
    expect(snap!.pricingModel).toBe("home_cleaning_recommended_hours");
    expect(snap!.formulaVersion).toBe(FORMULA_VERSION);
    expect(snap!.priceExclVat).toBe(1200);
    expect(snap!.vatRatePercent).toBe(25);
    expect(snap!.calculatedPrice).toBe(1500);
    expect(snap!.selectedPlanSnapshot).toEqual(FLEXIBLE);
    expect(snap!.inputs).toMatchObject({ sqm: 70 });
  });

  it("returns null for an invalid result (no priceless quote can be frozen)", () => {
    expect(toPricingSnapshot(home({}))).toBeNull();
  });
});

describe("home cleaning per-sqm adjustment (Slice 12Q)", () => {
  // Clean rules that isolate the per-m² time component: no start time, no floor,
  // no interval/under-minimum minutes, no margins/rounding affecting hours.
  const CLEAN_RULES: PricingRuleValue[] = [
    { ruleKey: "base_hours", ruleType: "numeric_factor", valueNumeric: 0 },
    { ruleKey: "hours_per_sqm", ruleType: "numeric_factor", valueNumeric: 0.04 },
    { ruleKey: "minimum_hours", ruleType: "threshold", valueNumeric: 0 },
    { ruleKey: "under_minimum_visit_threshold_minutes", ruleType: "threshold", valueNumeric: 0 },
    { ruleKey: "range_min_percent", ruleType: "margin_percent", valueNumeric: 0 },
    { ruleKey: "range_max_percent", ruleType: "margin_percent", valueNumeric: 0 },
  ];
  const RANGES = [
    { fromSqm: 0, toSqm: 60, adjustmentPercent: 0 },
    { fromSqm: 61, toSqm: 70, adjustmentPercent: -5 },
    { fromSqm: 71, toSqm: 80, adjustmentPercent: -7.5 },
  ];

  function homeSqm(sqm: number, ranges = RANGES, rules = CLEAN_RULES) {
    return calculateHomeCleaningPrice({
      pricingModel: "home_cleaning_recommended_hours",
      answers: { sqm, frequency: "weekly" },
      rules,
      plan: FLEXIBLE,
      sqmAdjustments: ranges,
    });
  }

  it("resolveSqmAdjustmentPercent matches the containing range (else 0)", () => {
    expect(resolveSqmAdjustmentPercent(RANGES, 50)).toBe(0);
    expect(resolveSqmAdjustmentPercent(RANGES, 65)).toBe(-5);
    expect(resolveSqmAdjustmentPercent(RANGES, 75)).toBe(-7.5);
    expect(resolveSqmAdjustmentPercent(RANGES, 200)).toBe(0); // no match
    expect(resolveSqmAdjustmentPercent([], 65)).toBe(0);
    expect(resolveSqmAdjustmentPercent(undefined, 65)).toBe(0);
  });

  it("open-ended top range (toSqm null) matches all larger areas", () => {
    const ranges = [{ fromSqm: 131, toSqm: null, adjustmentPercent: -15 }];
    expect(resolveSqmAdjustmentPercent(ranges, 200)).toBe(-15);
    expect(resolveSqmAdjustmentPercent(ranges, 130)).toBe(0);
  });

  it("50 m² @ 0.04 h/m² with 0% = 2 h", () => {
    expect(homeSqm(50).estimatedHours).toBe(2); // 50 × 0.04 × 1.00
  });

  it("65 m² @ 0.04 h/m² with -5% = 2.47 h (148.2 min)", () => {
    expect(homeSqm(65).estimatedHours).toBe(2.47); // 65 × 0.04 × 0.95
  });

  it("75 m² @ 0.04 h/m² with -7.5% = 2.775 h (rounds to 2.78 for display)", () => {
    // 75 × 0.04 × 0.925 = 2.775; estimatedHours is round2'd.
    expect(homeSqm(75).estimatedHours).toBe(2.78);
  });

  it("a positive adjustment increases the per-m² time", () => {
    const ranges = [{ fromSqm: 0, toSqm: null, adjustmentPercent: 10 }];
    expect(homeSqm(50, ranges).estimatedHours).toBe(2.2); // 50 × 0.04 × 1.10
  });

  it("adjustment scales ONLY the per-m² component, not the fixed start time", () => {
    const withStart: PricingRuleValue[] = [
      ...CLEAN_RULES.filter((r) => r.ruleKey !== "base_hours"),
      { ruleKey: "base_hours", ruleType: "numeric_factor", valueNumeric: 1 },
    ];
    const ranges = [{ fromSqm: 0, toSqm: null, adjustmentPercent: -50 }];
    // start 1 h (unscaled) + 50 × 0.04 × 0.5 (=1) = 2 h. If start were scaled it'd be 1.5 h.
    expect(homeSqm(50, ranges, withStart).estimatedHours).toBe(2);
  });

  it("adjustment does not multiply the minimum-visit floor", () => {
    const withMin: PricingRuleValue[] = [
      ...CLEAN_RULES.filter((r) => r.ruleKey !== "minimum_hours"),
      { ruleKey: "minimum_hours", ruleType: "threshold", valueNumeric: 3 },
    ];
    const ranges = [{ fromSqm: 0, toSqm: null, adjustmentPercent: -90 }];
    // sqm time collapses to ~0.2 h but the 3 h floor stands, unscaled.
    expect(homeSqm(50, ranges, withMin).estimatedHours).toBe(3);
  });

  it("no adjustment ranges leaves the legacy per-m² time unchanged", () => {
    expect(homeSqm(65, []).estimatedHours).toBe(2.6); // 65 × 0.04, no %
  });
});
