import { describe, expect, it } from "vitest";

import {
  buildPricingRulePreview,
  pickPreviewPlan,
  PRICING_PREVIEW_SCENARIOS,
} from "./pricingRulePreview";
import type { CleaningPlanConfig, PricingRuleConfig } from "./calculatorConfigAdmin";

// ── Builders (mirror the seeded MVP numbers, migration 0060) ────────────────

function rule(over: Partial<PricingRuleConfig> & Pick<PricingRuleConfig, "ruleKey" | "ruleType" | "valueNumeric">): PricingRuleConfig {
  return {
    legacyId: `rule_${over.ruleKey}`,
    serviceId: "svc-home",
    active: true,
    sortOrder: 1,
    ...over,
  };
}

const HOME_RULES: PricingRuleConfig[] = [
  rule({ ruleKey: "base_hours", ruleType: "numeric_factor", valueNumeric: 1.5 }),
  rule({ ruleKey: "hours_per_sqm", ruleType: "numeric_factor", valueNumeric: 0.02 }),
  rule({ ruleKey: "minimum_hours", ruleType: "threshold", valueNumeric: 2 }),
  rule({ ruleKey: "bathroom_extra_hours", ruleType: "numeric_factor", valueNumeric: 0.25 }),
  rule({ ruleKey: "addon_hours_oven", ruleType: "addon_hours", valueNumeric: 0.5 }),
  rule({ ruleKey: "range_min_percent", ruleType: "margin_percent", valueNumeric: 10 }),
  rule({ ruleKey: "range_max_percent", ruleType: "margin_percent", valueNumeric: 10 }),
  rule({ ruleKey: "rounding_increment", ruleType: "rounding", valueNumeric: 50 }),
];

const MOVEOUT_RULES: PricingRuleConfig[] = [
  rule({ serviceId: "svc-mo", ruleKey: "price_per_sqm", ruleType: "numeric_factor", valueNumeric: 35 }),
  rule({ serviceId: "svc-mo", ruleKey: "minimum_price", ruleType: "threshold", valueNumeric: 1500 }),
  rule({ serviceId: "svc-mo", ruleKey: "range_min_percent", ruleType: "margin_percent", valueNumeric: 10 }),
  rule({ serviceId: "svc-mo", ruleKey: "range_max_percent", ruleType: "margin_percent", valueNumeric: 10 }),
  rule({ serviceId: "svc-mo", ruleKey: "rounding_increment", ruleType: "rounding", valueNumeric: 50 }),
];

function plan(over: Partial<CleaningPlanConfig> & Pick<CleaningPlanConfig, "planKey" | "hourlyRate">): CleaningPlanConfig {
  return {
    legacyId: `plan_${over.planKey}`,
    serviceId: null,
    serviceLegacyId: null,
    serviceKey: "home_cleaning",
    name: over.planKey,
    description: null,
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
    isDefault: false,
    active: true,
    sortOrder: 1,
    ...over,
  };
}

const FLEXIBLE_PLAN = plan({ planKey: "flexible", name: "Flexibel", hourlyRate: 349, isDefault: true });

// ── pickPreviewPlan ──────────────────────────────────────────────────────────

describe("pickPreviewPlan", () => {
  it("prefers the flexible plan", () => {
    const chosen = pickPreviewPlan([
      plan({ planKey: "fixed", hourlyRate: 399 }),
      plan({ planKey: "flexible", hourlyRate: 349 }),
    ]);
    expect(chosen?.planKey).toBe("flexible");
  });

  it("falls back to the default, then the first active plan", () => {
    expect(pickPreviewPlan([plan({ planKey: "fixed", hourlyRate: 399, isDefault: true })])?.planKey).toBe("fixed");
    expect(pickPreviewPlan([plan({ planKey: "priority", hourlyRate: 449 })])?.planKey).toBe("priority");
  });

  it("ignores inactive plans and returns null when none are active", () => {
    expect(pickPreviewPlan([plan({ planKey: "flexible", hourlyRate: 349, active: false })])).toBeNull();
    expect(pickPreviewPlan([])).toBeNull();
  });
});

// ── buildPricingRulePreview ──────────────────────────────────────────────────

describe("buildPricingRulePreview — home cleaning", () => {
  it("computes the seeded before range (70 m², var fjärde vecka, oven, flexible)", () => {
    const preview = buildPricingRulePreview({
      pricingModel: "home_cleaning_recommended_hours",
      serviceRules: HOME_RULES,
      plans: [FLEXIBLE_PLAN],
      editedRuleKey: "base_hours",
      newValue: 1.5, // unchanged → before === after
      currency: "SEK",
    });
    expect(preview).not.toBeNull();
    expect(preview?.scenarioLabel).toBe(PRICING_PREVIEW_SCENARIOS.home_cleaning_recommended_hours.label);
    // every_four_weeks = 1 visit / four-week period → per-visit total (3.4 h * 349
    // = 1 186,60 excl. VAT). The preview now shows the CUSTOMER-FACING price incl.
    // 25% VAT: the excl-VAT range 1 050–1 300 → 1 312,50–1 625 → "1 313–1 625 kr".
    expect(preview?.beforeText).toContain("1 313");
    expect(preview?.beforeText).toContain("1 625");
    // No change → no difference.
    expect(preview?.afterText).toBe(preview?.beforeText);
    expect(preview?.differenceText).toBe("Ingen förändring");
  });

  it("reflects a higher base_hours in the after range + signed difference", () => {
    const preview = buildPricingRulePreview({
      pricingModel: "home_cleaning_recommended_hours",
      serviceRules: HOME_RULES,
      plans: [FLEXIBLE_PLAN],
      editedRuleKey: "base_hours",
      newValue: 2.5,
      currency: "SEK",
    });
    // base_hours 2.5 → 4.4 h × 349 = 1 535,60 excl. VAT; excl-VAT range 1 400–1 700
    // → incl. 25% VAT → 1 750–2 125. Midpoint customer price 1 500 → 1 937,50,
    // a +437,50 change that rounds to +438 kr.
    expect(preview?.afterText).toContain("1 750");
    expect(preview?.afterText).toContain("2 125");
    expect(preview?.differenceText).toBe("+438 kr");
  });

  it("does not mutate the input rules", () => {
    const snapshot = HOME_RULES.map((r) => r.valueNumeric);
    buildPricingRulePreview({
      pricingModel: "home_cleaning_recommended_hours",
      serviceRules: HOME_RULES,
      plans: [FLEXIBLE_PLAN],
      editedRuleKey: "base_hours",
      newValue: 9,
      currency: "SEK",
    });
    expect(HOME_RULES.map((r) => r.valueNumeric)).toEqual(snapshot);
  });
});

describe("buildPricingRulePreview — move-out", () => {
  it("computes the seeded before range (70 m²) without a plan", () => {
    const preview = buildPricingRulePreview({
      pricingModel: "move_out_fixed_plus_addons",
      serviceRules: MOVEOUT_RULES,
      plans: [],
      editedRuleKey: "price_per_sqm",
      newValue: 35,
      currency: "SEK",
    });
    expect(preview?.beforeText).toContain("2 200");
    expect(preview?.beforeText).toContain("2 700");
  });

  it("raises the range when price_per_sqm increases", () => {
    const preview = buildPricingRulePreview({
      pricingModel: "move_out_fixed_plus_addons",
      serviceRules: MOVEOUT_RULES,
      plans: [],
      editedRuleKey: "price_per_sqm",
      newValue: 45,
      currency: "SEK",
    });
    expect(preview?.differenceText).toBe("+700 kr");
  });
});

describe("buildPricingRulePreview — unsupported model", () => {
  it("returns null", () => {
    expect(
      buildPricingRulePreview({
        pricingModel: "window_cleaning_unknown",
        serviceRules: HOME_RULES,
        plans: [FLEXIBLE_PLAN],
        editedRuleKey: "base_hours",
        newValue: 2,
        currency: "SEK",
      }),
    ).toBeNull();
  });
});
