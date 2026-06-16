import { describe, expect, it } from "vitest";

/**
 * ENGINE PARITY GUARD.
 *
 * The Edge Function cannot import the approved `src` engine (Deno needs explicit
 * `.ts` extensions and only bundles files inside `supabase/functions`), so a
 * faithful Deno port lives at
 * `supabase/functions/_shared/calculator/pricingEngine.ts`. This test runs BOTH
 * the canonical engine and the port through one input matrix and asserts deep
 * equality, so the two can never silently drift. If the approved engine changes
 * and the port is not updated to match (or vice-versa), this test fails.
 */
import * as canonical from "@/lib/calculator/pricingEngine";
import * as ported from "../../../supabase/functions/_shared/calculator/pricingEngine.ts";
import type {
  CalculatorAnswers,
  CleaningPlanSnapshot,
  PriceDisplayMode,
  PricingModel,
  PricingRuleValue,
} from "@/lib/calculator/types";

const HOME_RULES: PricingRuleValue[] = [
  { ruleKey: "base_hours", ruleType: "numeric_factor", valueNumeric: 1.5 },
  { ruleKey: "hours_per_sqm", ruleType: "numeric_factor", valueNumeric: 0.02 },
  { ruleKey: "minimum_hours", ruleType: "threshold", valueNumeric: 2 },
  { ruleKey: "bathroom_extra_hours", ruleType: "numeric_factor", valueNumeric: 0.25 },
  { ruleKey: "addon_hours_oven", ruleType: "addon_hours", valueNumeric: 0.5 },
  { ruleKey: "addon_hours_fridge", ruleType: "addon_hours", valueNumeric: 0.5 },
  { ruleKey: "addon_hours_inside_windows", ruleType: "addon_hours", valueNumeric: 0.75 },
  { ruleKey: "pet_time_percent", ruleType: "margin_percent", valueNumeric: 10 },
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

const OFFICE_RULES: PricingRuleValue[] = [
  { ruleKey: "base_visit_hours", ruleType: "numeric_factor", valueNumeric: 1.0 },
  { ruleKey: "hours_per_sqm", ruleType: "numeric_factor", valueNumeric: 0.008 },
  { ruleKey: "toilet_extra_hours", ruleType: "numeric_factor", valueNumeric: 0.2 },
  { ruleKey: "meeting_room_extra_hours", ruleType: "numeric_factor", valueNumeric: 0.15 },
  { ruleKey: "workstation_extra_hours", ruleType: "numeric_factor", valueNumeric: 0.02 },
  { ruleKey: "kitchen_extra_hours", ruleType: "numeric_factor", valueNumeric: 0.3 },
  { ruleKey: "minimum_hours_per_visit", ruleType: "threshold", valueNumeric: 1.5 },
  { ruleKey: "hourly_rate", ruleType: "numeric_factor", valueNumeric: 459 },
  { ruleKey: "supervision_start_minutes", ruleType: "threshold", valueNumeric: 15 },
  { ruleKey: "range_min_percent", ruleType: "margin_percent", valueNumeric: 10 },
  { ruleKey: "range_max_percent", ruleType: "margin_percent", valueNumeric: 10 },
  { ruleKey: "rounding_increment", ruleType: "rounding", valueNumeric: 50 },
];

/**
 * Office answer variations: the Slice 12F interval keys + a custom_interval
 * (manual review) + legacy aliases + an unknown value, and supervision on/off,
 * so BOTH engines are exercised on every office path.
 */
const OFFICE_FREQS: (string | undefined)[] = [
  undefined,
  "weekday_daily",
  "weekly",
  "biweekly",
  "every_four_weeks",
  "custom_interval",
  "daily",
  "monthly",
  "nope",
];
const OFFICE_EXTRAS: CalculatorAnswers[] = [
  {},
  { toilets: 2, meeting_rooms: 1, workstations: 10, has_kitchen: true },
  { toilets: 5, meeting_rooms: 0, workstations: 0, has_kitchen: false },
  // Supervision on/off variations (price-affecting add-on).
  { supervision_cleaning: true, supervision_visits_per_week: 2, supervision_minutes_per_visit: 30 },
  { supervision_cleaning: false, supervision_visits_per_week: 3, supervision_minutes_per_visit: 60 },
];

const PLANS: (CleaningPlanSnapshot | null)[] = [
  null,
  { planKey: "flexible", name: "Flexibel", hourlyRate: 349 },
  { planKey: "fixed", name: "Fast", hourlyRate: 399 },
  { planKey: "priority", name: "Prioritet", hourlyRate: 449 },
];

const SQMS = [0, -5, 10, 30, 55, 70, 88, 120, 200];
const BATHS = [0, 1, 2, 3];
const ADDON_SETS: CalculatorAnswers["addons"][] = [
  undefined,
  [],
  ["oven"],
  ["oven", "fridge"],
  ["oven", "fridge", "inside_windows"],
  ["unknown_addon"],
];
const MODES: PriceDisplayMode[] = ["range", "exact", "hidden_until_submit"];

/** Builds the full home + move-out input matrix. */
function* matrix(): Generator<{ model: PricingModel; answers: CalculatorAnswers; rules: PricingRuleValue[]; plan: CleaningPlanSnapshot | null }> {
  for (const sqm of SQMS) {
    for (const frequency of OFFICE_FREQS) {
      for (const extras of OFFICE_EXTRAS) {
        yield {
          model: "office_cleaning_recurring_area_frequency",
          answers: { sqm, frequency, ...extras },
          rules: OFFICE_RULES,
          plan: null,
        };
      }
    }
  }
  for (const sqm of SQMS) {
    for (const bathrooms of BATHS) {
      for (const addons of ADDON_SETS) {
        for (const plan of PLANS) {
          for (const hasPets of [undefined, true, false]) {
            yield {
              model: "home_cleaning_recommended_hours",
              answers: { sqm, bathrooms, frequency: "weekly", addons, has_pets: hasPets },
              rules: HOME_RULES,
              plan,
            };
          }
        }
        for (const glazed of [true, false]) {
          for (const windows of [true, false]) {
            yield {
              model: "move_out_fixed_plus_addons",
              answers: { sqm, bathrooms, glazed_balcony: glazed, divisible_windows: windows },
              rules: MOVEOUT_RULES,
              plan: null,
            };
          }
        }
      }
    }
  }
}

describe("engine parity (canonical src ⇔ Deno port)", () => {
  it("exposes the same FORMULA_VERSION", () => {
    expect(ported.FORMULA_VERSION).toBe(canonical.FORMULA_VERSION);
  });

  it("produces deep-equal results across the full input matrix", () => {
    let count = 0;
    for (const { model, answers, rules, plan } of matrix()) {
      const input = { pricingModel: model, answers, rules, plan, currency: "SEK" as const };
      const a = canonical.calculatePrice(input);
      const b = ported.calculatePrice(input);
      expect(b).toEqual(a);

      // Display text parity across every presentation mode.
      for (const priceDisplayMode of MODES) {
        expect(ported.buildResultDisplayText({ ...b, priceDisplayMode })).toBe(
          canonical.buildResultDisplayText({ ...a, priceDisplayMode }),
        );
      }

      // Persisted-snapshot parity (null for invalid results).
      expect(ported.toPricingSnapshot(b)).toEqual(canonical.toPricingSnapshot(a));
      count += 1;
    }
    expect(count).toBeGreaterThan(500); // matrix actually ran
  });

  it("matches on the coercion + money helpers", () => {
    for (const v of ["70", "70,5", "1 200", "", "abc", 12, true]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(ported.coerceNumber(v as any)).toBe(canonical.coerceNumber(v as any));
    }
    for (const v of [1273.85, 1146.465, 2950, 0]) {
      expect(ported.roundToIncrement(v, 50)).toBe(canonical.roundToIncrement(v, 50));
    }
    expect(ported.formatAmount(1250)).toBe(canonical.formatAmount(1250));
    expect(ported.formatAmount(1000000, "EUR")).toBe(canonical.formatAmount(1000000, "EUR"));
  });
});
