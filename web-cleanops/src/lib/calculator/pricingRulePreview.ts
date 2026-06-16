/**
 * Price Calculator — pricing-rule edit PREVIEW (Slice 10B).
 *
 * Pure, deterministic before/after price preview for the Super Admin
 * "edit existing pricing-rule value" flow. Given a service's current pricing
 * rules and the single value being changed, it runs the SAME pure pricing engine
 * the public calculator + Edge Function use ({@link calculatePrice}) over a fixed,
 * representative scenario and returns the current vs. proposed price range. It
 * performs NO I/O and never mutates the input rules — the "after" run simply
 * swaps the edited rule's value in a fresh copy — so it is safe to call on every
 * keystroke and is unit-testable in isolation.
 *
 * Scenarios (doc 04 / Slice 10B / Slice 12E / Slice 12G):
 *   • home_cleaning_recommended_hours          → 70 m², var fjärde vecka, oven add-on, pets, flexible plan
 *   • move_out_fixed_plus_addons               → 70 m²
 *   • office_cleaning_recurring_area_frequency → 200 m², weekly, 2 toilets, 1 meeting room, kitchen, supervision 2×30 min/wk
 */
import { buildResultDisplayText, calculatePrice, formatAmount } from "./pricingEngine";
import type {
  CalculatorAnswers,
  CleaningPlanSnapshot,
  PriceCalculationResult,
  PricingModel,
  PricingRuleValue,
} from "./types";
import type { CleaningPlanConfig, PricingRuleConfig } from "./calculatorConfigAdmin";

interface ScenarioDef {
  /** Customer-facing scenario label (Swedish, to match the calculator UI). */
  label: string;
  answers: CalculatorAnswers;
  /** Home cleaning prices by the selected plan's hourly rate; move-out does not. */
  needsPlan: boolean;
}

/** The fixed preview scenario per pricing model (mirrors the Slice 10B brief). */
export const PRICING_PREVIEW_SCENARIOS: Record<PricingModel, ScenarioDef> = {
  home_cleaning_recommended_hours: {
    label: "70 m², var fjärde vecka, ugn, husdjur, flexibel plan",
    // every_four_weeks + has_pets active so editing the new home time rules
    // (every_four_weeks_start_minutes, under_minimum_visit_*, pet_time_percent)
    // all show a real before/after diff; missing rules → 0 (no effect, fail-safe).
    answers: { sqm: 70, frequency: "every_four_weeks", addons: ["oven"], has_pets: true },
    needsPlan: true,
  },
  move_out_fixed_plus_addons: {
    label: "70 m²",
    answers: { sqm: 70 },
    needsPlan: false,
  },
  office_cleaning_recurring_area_frequency: {
    label: "200 m², varje vecka, 2 toaletter, 1 mötesrum, kök, tillsyn 2×30 min/v",
    answers: {
      sqm: 200,
      frequency: "weekly",
      toilets: 2,
      meeting_rooms: 1,
      workstations: 10,
      has_kitchen: true,
      // Supervision active so editing supervision_start_minutes shows a real diff.
      supervision_cleaning: true,
      supervision_visits_per_week: 2,
      supervision_minutes_per_visit: 30,
    },
    needsPlan: false,
  },
};

function isSupportedModel(model: string): model is PricingModel {
  return (
    model === "home_cleaning_recommended_hours" ||
    model === "move_out_fixed_plus_addons" ||
    model === "office_cleaning_recurring_area_frequency"
  );
}

/**
 * Picks the representative plan for the home-cleaning preview: the flexible plan
 * if present, else the default plan, else the first active plan, else null.
 */
export function pickPreviewPlan(
  plans: readonly CleaningPlanConfig[],
): CleaningPlanSnapshot | null {
  const active = plans.filter((p) => p.active);
  const chosen =
    active.find((p) => p.planKey === "flexible") ??
    active.find((p) => p.isDefault) ??
    active[0] ??
    null;
  if (!chosen) return null;
  return { planKey: chosen.planKey, name: chosen.name, hourlyRate: chosen.hourlyRate };
}

/** Maps active config rules to engine values, optionally swapping one rule's value. */
function toRuleValues(
  rules: readonly PricingRuleConfig[],
  override: { ruleKey: string; value: number } | null,
): PricingRuleValue[] {
  return rules
    .filter((r) => r.active)
    .map((r) => ({
      ruleKey: r.ruleKey,
      ruleType: r.ruleType,
      valueNumeric:
        override !== null && r.ruleKey === override.ruleKey ? override.value : r.valueNumeric,
    }));
}

/** Signed, rounded difference of the midpoint price (after − before), or null. */
function diffText(
  before: PriceCalculationResult,
  after: PriceCalculationResult,
  currency: string,
): string | null {
  if (
    !before.valid ||
    !after.valid ||
    before.calculatedPrice === null ||
    after.calculatedPrice === null
  ) {
    return null;
  }
  const delta = Math.round(after.calculatedPrice - before.calculatedPrice);
  if (delta === 0) return "Ingen förändring";
  const sign = delta > 0 ? "+" : "−";
  return `${sign}${formatAmount(Math.abs(delta), currency)}`;
}

export interface PricingRulePreview {
  scenarioLabel: string;
  before: PriceCalculationResult;
  after: PriceCalculationResult;
  /** Display-ready price text (range mode) for the current value. */
  beforeText: string;
  /** Display-ready price text (range mode) for the proposed value. */
  afterText: string;
  /** Signed midpoint difference, or null when either result is invalid. */
  differenceText: string | null;
}

/**
 * Builds a before/after preview for changing ONE rule value. Uses the pure
 * pricing engine over the rule's service scenario. Returns null when the
 * service's pricing model has no preview scenario (unsupported model).
 */
export function buildPricingRulePreview(args: {
  pricingModel: string;
  serviceRules: readonly PricingRuleConfig[];
  plans: readonly CleaningPlanConfig[];
  editedRuleKey: string;
  newValue: number;
  currency: string;
}): PricingRulePreview | null {
  const { pricingModel, serviceRules, plans, editedRuleKey, newValue, currency } = args;
  if (!isSupportedModel(pricingModel)) return null;

  const scenario = PRICING_PREVIEW_SCENARIOS[pricingModel];
  const plan = scenario.needsPlan ? pickPreviewPlan(plans) : null;
  const base = {
    pricingModel,
    answers: scenario.answers,
    plan,
    currency,
    priceDisplayMode: "range" as const,
  };

  const before = calculatePrice({ ...base, rules: toRuleValues(serviceRules, null) });
  const after = calculatePrice({
    ...base,
    rules: toRuleValues(serviceRules, { ruleKey: editedRuleKey, value: newValue }),
  });

  return {
    scenarioLabel: scenario.label,
    before,
    after,
    beforeText: buildResultDisplayText(before) || "—",
    afterText: buildResultDisplayText(after) || "—",
    differenceText: diffText(before, after, currency),
  };
}
