import { describe, expect, it } from "vitest";

import { buildServiceConfigV2 } from "./configMapping";
import type { PlanRowV2, PricingRuleRowV2, ServiceRowV2 } from "./configMapping";
import { calculateRawV2 } from "./engine";

// ── Fixtures (snake_case, shaped like the loaded Supabase rows) ───────────────

/** Home cleaning: hourly, RUT-eligible, 3 plans, settings_json rounding interval 10. */
const HOME_SERVICE: ServiceRowV2 = {
  service_key: "home_cleaning",
  display_name: "Hemstädning",
  enabled: true,
  pricing_model: "home_cleaning_recommended_hours",
  settings_json: {
    displayRoundingInterval: 10,
    homeSqmAdjustments: [
      { fromSqm: 76, toSqm: 86, adjustmentPercent: -5 },
      { fromSqm: 87, toSqm: 99, adjustmentPercent: -7 },
      { fromSqm: 100, toSqm: 120, adjustmentPercent: -10 },
    ],
  },
};

const HOME_RULES: PricingRuleRowV2[] = [
  { rule_key: "base_hours", value_numeric: 0, active: true },
  // 0.04 h/m² is STORED in hours but the Admin edits it as 2.4 min/m².
  { rule_key: "hours_per_sqm", value_numeric: 0.04, active: true },
  { rule_key: "minimum_hours", value_numeric: 0, active: true },
  { rule_key: "range_min_percent", value_numeric: 9.1, active: true },
  { rule_key: "range_max_percent", value_numeric: 9.1, active: true },
  // An active-gated rounding rule that V2 must IGNORE in favour of settings_json.
  { rule_key: "rounding_increment", value_numeric: 50, active: true },
];

const HOME_PLANS: PlanRowV2[] = [
  {
    plan_key: "flexibel",
    name: "Flexibel",
    description: "Mest flexibel",
    hourly_rate: 410,
    start_adjustment_hours: -0.25,
    vat_rate_percent: 25,
    rut_eligible: true,
    rut_enabled: true,
    rut_percent: 50,
    is_default: true,
    active: true,
    sort_order: 1,
  },
  {
    plan_key: "fast",
    name: "Fast",
    hourly_rate: 399,
    start_adjustment_hours: 0,
    vat_rate_percent: 25,
    rut_eligible: true,
    rut_enabled: true,
    rut_percent: 50,
    is_default: false,
    active: true,
    sort_order: 2,
  },
  {
    plan_key: "prioritet",
    name: "Prioritet",
    hourly_rate: 449,
    start_adjustment_hours: 0.5,
    vat_rate_percent: 25,
    rut_eligible: true,
    rut_enabled: true,
    rut_percent: 50,
    is_default: false,
    active: true,
    sort_order: 3,
  },
];

/** Office: hourly, NO RUT, distinct legacy rule-key spellings, single plan. */
const OFFICE_SERVICE: ServiceRowV2 = {
  service_key: "office_cleaning",
  display_name: "Kontorsstädning",
  enabled: true,
  pricing_model: "office_cleaning_recurring_area_frequency",
  settings_json: { displayRoundingInterval: 10 },
};

const OFFICE_RULES: PricingRuleRowV2[] = [
  { rule_key: "base_visit_hours", value_numeric: 0.5, active: true }, // → startMinutes 30
  { rule_key: "hours_per_sqm", value_numeric: 0.008, active: true }, // → 0.48 min/m²
  { rule_key: "minimum_hours_per_visit", value_numeric: 1.5, active: true }, // → minimumMinutes 90
  { rule_key: "range_min_percent", value_numeric: 10, active: true },
  { rule_key: "range_max_percent", value_numeric: 10, active: true },
];

const OFFICE_PLANS: PlanRowV2[] = [
  {
    plan_key: "standard",
    name: "Standard",
    hourly_rate: 389,
    start_adjustment_hours: 0,
    vat_rate_percent: 25,
    rut_eligible: false,
    rut_enabled: false,
    rut_percent: 0,
    is_default: true,
    active: true,
    sort_order: 1,
  },
];

/** Move-out: sqm_fixed, condition/effort plans, settings_json rounding interval 100. */
const MOVEOUT_SERVICE: ServiceRowV2 = {
  service_key: "move_out_cleaning",
  display_name: "Flyttstädning",
  enabled: true,
  pricing_model: "move_out_fixed_plus_addons",
  settings_json: { displayRoundingInterval: 100 },
};

const MOVEOUT_RULES: PricingRuleRowV2[] = [
  { rule_key: "range_min_percent", value_numeric: 0, active: true },
  { rule_key: "range_max_percent", value_numeric: 0, active: true },
];

const MOVEOUT_PLANS: PlanRowV2[] = [
  {
    plan_key: "gott",
    name: "Mycket gott skick",
    price_per_sqm_excl_vat: 40,
    vat_rate_percent: 25,
    rut_eligible: false,
    is_default: false,
    active: true,
    sort_order: 1,
  },
  {
    plan_key: "normalt",
    name: "Normalt skick",
    price_per_sqm_excl_vat: 48,
    vat_rate_percent: 25,
    rut_eligible: false,
    is_default: true,
    active: true,
    sort_order: 2,
  },
  {
    plan_key: "mycket",
    name: "Mycket att göra",
    price_per_sqm_excl_vat: 60,
    vat_rate_percent: 25,
    rut_eligible: false,
    is_default: false,
    active: true,
    sort_order: 3,
  },
];

// ── 1. home_cleaning hourly config ────────────────────────────────────────────

describe("buildServiceConfigV2 — home_cleaning (hourly)", () => {
  const { config, issues } = buildServiceConfigV2({
    service: HOME_SERVICE,
    plans: HOME_PLANS,
    pricingRules: HOME_RULES,
  });

  it("maps identity, basis, and presentation", () => {
    expect(config.serviceKey).toBe("home_cleaning");
    expect(config.displayName).toBe("Hemstädning");
    expect(config.enabled).toBe(true);
    expect(config.pricingBasis).toBe("hourly");
    expect(config.bookingMode).toBe("recurring");
    expect(config.publicLayout).toBe("recurring_cleaning");
    expect(config.currency).toBe("SEK");
  });

  it("normalizes baseMinutesPerSqm from hours_per_sqm (0.04 h/m² → 2.4 min/m²)", () => {
    expect(config.sqmTime).not.toBeNull();
    expect(config.sqmTime?.baseMinutesPerSqm).toBe(2.4);
    expect(config.sqmTime?.startMinutes).toBe(0);
    expect(config.sqmTime?.minimumMinutes).toBe(0);
  });

  it("maps sqm adjustment ranges from settings_json", () => {
    expect(config.sqmAdjustments).toHaveLength(3);
    expect(config.sqmAdjustments[2]).toEqual({ fromSqm: 100, toSqm: 120, adjustmentPercent: -10 });
  });

  it("maps margins from active range_*_percent rules", () => {
    expect(config.margins).toEqual({ lowerPercent: 9.1, upperPercent: 9.1 });
  });

  it("resolves VAT/RUT from the default plan", () => {
    expect(config.vat.ratePercent).toBe(25);
    expect(config.rut.eligible).toBe(true);
    expect(config.rut.percent).toBe(50);
  });

  it("the mapped config feeds the engine and proves 100 m² → 3.6 h, 1373.50 excl VAT", () => {
    // The killer test: prove the REAL mapping path (not an ideal hand-built config)
    // produces an engine-valid config with the canonical proof-point numbers.
    const res = calculateRawV2({ config, sqm: 100 });
    expect(res.valid).toBe(true);
    expect(res.estimatedServiceHours).toBe(3.6);
    expect(res.pricingHours).toBe(3.35); // 3.6 + (−0.25)
    expect(res.rawPriceExclVat).toBe(1373.5);
    expect(res.selectedPlanKey).toBe("flexibel"); // default plan
  });

  it("maps cleanly with no error issues", () => {
    expect(issues.filter((i) => i.severity === "error")).toHaveLength(0);
  });

  it("defaults generic add-ons to an empty list (V2-E0D — not loaded from DB yet)", () => {
    expect(config.addons).toEqual([]);
  });
});

// ── 2. office_cleaning hourly config ──────────────────────────────────────────

describe("buildServiceConfigV2 — office_cleaning (hourly, no RUT)", () => {
  const { config } = buildServiceConfigV2({
    service: OFFICE_SERVICE,
    plans: OFFICE_PLANS,
    pricingRules: OFFICE_RULES,
  });

  it("maps basis + recurring presentation", () => {
    expect(config.pricingBasis).toBe("hourly");
    expect(config.bookingMode).toBe("recurring");
    expect(config.publicLayout).toBe("recurring_cleaning");
  });

  it("reads office's distinct legacy time-rule spellings (base_visit_hours / minimum_hours_per_visit)", () => {
    expect(config.sqmTime).toEqual({ baseMinutesPerSqm: 0.48, startMinutes: 30, minimumMinutes: 90 });
  });

  it("has no RUT by default", () => {
    expect(config.rut.eligible).toBe(false);
    expect(config.rut.customerToggle).toBe(false);
  });

  it("has exactly one active plan (no public plan choice needed)", () => {
    expect(config.plans).toHaveLength(1);
    expect(config.plans.filter((p) => p.active)).toHaveLength(1);
    expect(config.plans[0].kind).toBe("hourly");
  });
});

// ── 3. move_out_cleaning sqm_fixed config ─────────────────────────────────────

describe("buildServiceConfigV2 — move_out_cleaning (sqm_fixed)", () => {
  const { config } = buildServiceConfigV2({
    service: MOVEOUT_SERVICE,
    plans: MOVEOUT_PLANS,
    pricingRules: MOVEOUT_RULES,
  });

  it("maps sqm_fixed basis + one-off move-out presentation", () => {
    expect(config.pricingBasis).toBe("sqm_fixed");
    expect(config.bookingMode).toBe("one_off");
    expect(config.publicLayout).toBe("move_out_cleaning");
    expect(config.displayRoundingInterval).toBe(100);
  });

  it("has no hourly m² time config (sqm_fixed)", () => {
    expect(config.sqmTime).toBeNull();
  });

  it("maps condition plans with price per m² (kind sqm_fixed, default normalt)", () => {
    expect(config.plans).toHaveLength(3);
    const normalt = config.plans.find((p) => p.planKey === "normalt");
    expect(normalt?.kind).toBe("sqm_fixed");
    expect(normalt?.pricePerSqmExclVat).toBe(48);
    expect(normalt?.isDefault).toBe(true);
    expect(config.plans.every((p) => p.hourlyRateExclVat === null)).toBe(true);
  });

  it("feeds the engine: 80 m² × 48 = 3840 excl VAT, no hourly time", () => {
    const res = calculateRawV2({ config, sqm: 80 });
    expect(res.valid).toBe(true);
    expect(res.rawPriceExclVat).toBe(3840);
    expect(res.estimatedServiceHours).toBeNull();
    expect(calculateRawV2({ config, sqm: 80, requestedPlanKey: "mycket" }).rawPriceExclVat).toBe(4800);
  });
});

// ── 4. displayRoundingInterval source of truth ───────────────────────────────

describe("buildServiceConfigV2 — display rounding source of truth", () => {
  it("uses settings_json.displayRoundingInterval even when an INACTIVE rounding rule exists", () => {
    const { config, issues } = buildServiceConfigV2({
      service: { ...HOME_SERVICE, settings_json: { displayRoundingInterval: 10 } },
      plans: HOME_PLANS,
      pricingRules: [{ rule_key: "rounding_increment", value_numeric: 50, active: false }],
    });
    expect(config.displayRoundingInterval).toBe(10); // settings_json wins, not 50
    expect(issues.some((i) => i.code === "rounding_rule_ignored")).toBe(true);
  });

  it("ignores an ACTIVE rounding rule too — settings_json is the only source", () => {
    const { config } = buildServiceConfigV2({
      service: { ...HOME_SERVICE, settings_json: { displayRoundingInterval: 10 } },
      plans: HOME_PLANS,
      pricingRules: [{ rule_key: "rounding_increment", value_numeric: 50, active: true }],
    });
    expect(config.displayRoundingInterval).toBe(10);
  });

  it("falls back to null (nearest whole SEK) when settings_json has no interval", () => {
    const { config } = buildServiceConfigV2({
      service: { ...HOME_SERVICE, settings_json: {} },
      plans: HOME_PLANS,
      pricingRules: HOME_RULES,
    });
    expect(config.displayRoundingInterval).toBeNull();
  });
});

// ── 5. active / default / sort plan mapping ──────────────────────────────────

describe("buildServiceConfigV2 — plan active/default/sort", () => {
  it("preserves active + inactive plans, sorted by sortOrder, with the default flag", () => {
    const { config } = buildServiceConfigV2({
      service: HOME_SERVICE,
      plans: [
        { plan_key: "prioritet", name: "Prioritet", hourly_rate: 449, is_default: false, active: true, sort_order: 3 },
        { plan_key: "fast", name: "Fast", hourly_rate: 399, is_default: false, active: false, sort_order: 2 },
        { plan_key: "flexibel", name: "Flexibel", hourly_rate: 410, is_default: true, active: true, sort_order: 1 },
      ],
      pricingRules: HOME_RULES,
    });

    expect(config.plans.map((p) => p.planKey)).toEqual(["flexibel", "fast", "prioritet"]);
    expect(config.plans.find((p) => p.planKey === "fast")?.active).toBe(false); // inactive kept
    expect(config.plans.find((p) => p.isDefault)?.planKey).toBe("flexibel");
  });

  it("flags an enabled service with no active plan as an error", () => {
    const { issues } = buildServiceConfigV2({
      service: HOME_SERVICE,
      plans: [{ plan_key: "flexibel", name: "Flexibel", hourly_rate: 410, active: false, sort_order: 1 }],
      pricingRules: HOME_RULES,
    });
    const issue = issues.find((i) => i.code === "no_active_plan");
    expect(issue?.severity).toBe("error");
  });
});

// ── 6. hourly plan mapping with startAdjustmentHours ─────────────────────────

describe("buildServiceConfigV2 — hourly plan start adjustment", () => {
  it("maps startAdjustmentHours and stamps hourly kind", () => {
    const { config } = buildServiceConfigV2({
      service: HOME_SERVICE,
      plans: HOME_PLANS,
      pricingRules: HOME_RULES,
    });
    const flexibel = config.plans.find((p) => p.planKey === "flexibel");
    expect(flexibel?.kind).toBe("hourly");
    expect(flexibel?.hourlyRateExclVat).toBe(410);
    expect(flexibel?.startAdjustmentHours).toBe(-0.25);
    expect(flexibel?.pricePerSqmExclVat).toBeNull();
    // The one-time adjustment is price-only: -0.25h × 410 = -102.50 SEK (proved via the engine).
    expect(config.plans.find((p) => p.planKey === "prioritet")?.startAdjustmentHours).toBe(0.5);
  });

  it("defaults a missing start adjustment to 0 (no adjustment)", () => {
    const { config } = buildServiceConfigV2({
      service: HOME_SERVICE,
      plans: [{ plan_key: "flexibel", name: "Flexibel", hourly_rate: 410, is_default: true, active: true, sort_order: 1 }],
      pricingRules: HOME_RULES,
    });
    expect(config.plans[0].startAdjustmentHours).toBe(0);
  });
});

// ── 7. move-out sqm_fixed plan mapping with pricePerSqmExclVat ────────────────

describe("buildServiceConfigV2 — sqm_fixed plan pricing", () => {
  it("maps pricePerSqmExclVat and nulls hourly fields for sqm_fixed plans", () => {
    const { config } = buildServiceConfigV2({
      service: MOVEOUT_SERVICE,
      plans: MOVEOUT_PLANS,
      pricingRules: MOVEOUT_RULES,
    });
    for (const plan of config.plans) {
      expect(plan.kind).toBe("sqm_fixed");
      expect(plan.pricePerSqmExclVat).toBeGreaterThan(0);
      expect(plan.hourlyRateExclVat).toBeNull();
      expect(plan.startAdjustmentHours).toBeNull();
    }
  });

  it("warns when an active sqm_fixed plan has no price per m²", () => {
    const { issues } = buildServiceConfigV2({
      service: MOVEOUT_SERVICE,
      plans: [{ plan_key: "normalt", name: "Normalt", is_default: true, active: true, sort_order: 1 }],
      pricingRules: MOVEOUT_RULES,
    });
    expect(issues.some((i) => i.code === "plan_missing_price_per_sqm")).toBe(true);
  });
});

// ── 8. m² adjustment ranges ──────────────────────────────────────────────────

describe("buildServiceConfigV2 — sqm adjustment ranges", () => {
  it("parses, sorts, and drops malformed ranges", () => {
    const { config } = buildServiceConfigV2({
      service: {
        ...HOME_SERVICE,
        settings_json: {
          homeSqmAdjustments: [
            { fromSqm: 100, toSqm: 120, adjustmentPercent: -10 },
            { fromSqm: 76, toSqm: 86, adjustmentPercent: -5 },
            { fromSqm: 200, toSqm: null, adjustmentPercent: -12 }, // open-ended top range
            { fromSqm: "bad", adjustmentPercent: -1 }, // dropped
          ],
        },
      },
      plans: HOME_PLANS,
      pricingRules: HOME_RULES,
    });
    expect(config.sqmAdjustments.map((r) => r.fromSqm)).toEqual([76, 100, 200]);
    expect(config.sqmAdjustments[2]).toEqual({ fromSqm: 200, toSqm: null, adjustmentPercent: -12 });
  });
});

// ── 9. baseMinutesPerSqm unit normalization ──────────────────────────────────

describe("buildServiceConfigV2 — baseMinutesPerSqm unit normalization", () => {
  it("converts the hours-stored hours_per_sqm rule to canonical minutes (×60)", () => {
    const cases: { hoursPerSqm: number; expectedMinutes: number }[] = [
      { hoursPerSqm: 0.04, expectedMinutes: 2.4 },
      { hoursPerSqm: 0.02, expectedMinutes: 1.2 },
      { hoursPerSqm: 0.008, expectedMinutes: 0.48 },
    ];
    for (const { hoursPerSqm, expectedMinutes } of cases) {
      const { config } = buildServiceConfigV2({
        service: HOME_SERVICE,
        plans: HOME_PLANS,
        pricingRules: [{ rule_key: "hours_per_sqm", value_numeric: hoursPerSqm, active: true }],
      });
      expect(config.sqmTime?.baseMinutesPerSqm).toBe(expectedMinutes);
    }
  });
});

// ── 10. VAT/RUT disagreement precedence ──────────────────────────────────────

describe("buildServiceConfigV2 — VAT/RUT disagreement", () => {
  it("uses the default plan's VAT and warns instead of averaging when plans disagree", () => {
    const { config, issues } = buildServiceConfigV2({
      service: HOME_SERVICE,
      plans: [
        { plan_key: "flexibel", name: "Flexibel", hourly_rate: 410, vat_rate_percent: 25, is_default: true, active: true, sort_order: 1 },
        { plan_key: "fast", name: "Fast", hourly_rate: 399, vat_rate_percent: 12, is_default: false, active: true, sort_order: 2 },
      ],
      pricingRules: HOME_RULES,
    });
    expect(config.vat.ratePercent).toBe(25); // default plan wins (not 18.5 average)
    expect(issues.some((i) => i.code === "vat_mismatch_between_plans")).toBe(true);
  });

  it("uses the default plan's RUT and warns when plans disagree on eligibility/percent", () => {
    const { config, issues } = buildServiceConfigV2({
      service: HOME_SERVICE,
      plans: [
        { plan_key: "flexibel", name: "Flexibel", hourly_rate: 410, rut_eligible: true, rut_percent: 50, is_default: true, active: true, sort_order: 1 },
        { plan_key: "fast", name: "Fast", hourly_rate: 399, rut_eligible: false, rut_percent: 0, is_default: false, active: true, sort_order: 2 },
      ],
      pricingRules: HOME_RULES,
    });
    expect(config.rut.eligible).toBe(true); // default plan wins
    expect(config.rut.percent).toBe(50);
    expect(issues.some((i) => i.code === "rut_mismatch_between_plans")).toBe(true);
  });
});

// ── 11. No size-band dependency for home/office ──────────────────────────────

describe("buildServiceConfigV2 — no size-band dependency", () => {
  it("home/office configs carry no size-band concept and derive time from the linear rules", () => {
    for (const input of [
      { service: HOME_SERVICE, plans: HOME_PLANS, pricingRules: HOME_RULES },
      { service: OFFICE_SERVICE, plans: OFFICE_PLANS, pricingRules: OFFICE_RULES },
    ]) {
      const { config } = buildServiceConfigV2(input);
      expect("sizeBands" in config).toBe(false);
      expect("sizeBand" in config).toBe(false);
      expect(config.sqmTime).not.toBeNull(); // time comes from base/per-m²/minimum rules
    }
  });
});

// ── 12. deep_cleaning identity gap ───────────────────────────────────────────

describe("buildServiceConfigV2 — deep_cleaning gap", () => {
  it("maps the hidden-draft identity but flags the missing pricing config", () => {
    const { config, issues } = buildServiceConfigV2({
      service: {
        service_key: "deep_cleaning",
        display_name: "Storstädning",
        enabled: false,
        pricing_model: "deep_cleaning_area_addons",
        settings_json: {},
      },
      plans: [],
      pricingRules: [],
    });

    // Identity + presentation still resolve (one-off layout per the slice defaults).
    expect(config.serviceKey).toBe("deep_cleaning");
    expect(config.pricingBasis).toBe("hourly");
    expect(config.bookingMode).toBe("one_off");
    expect(config.publicLayout).toBe("one_off_cleaning");

    // …but it is structurally incomplete, surfaced as issues (not guessed).
    expect(config.sqmTime).toBeNull();
    expect(issues.some((i) => i.code === "missing_sqm_time_config")).toBe(true);
    expect(issues.some((i) => i.code === "no_active_plan")).toBe(true);
  });
});

// ── 13. GPM-1 generic pricing model drives the basis ─────────────────────────

describe("buildServiceConfigV2 — generic pricing model drives the basis (GPM-1)", () => {
  it("home legacy model still maps to the hourly basis", () => {
    const { config } = buildServiceConfigV2({ service: HOME_SERVICE, plans: HOME_PLANS, pricingRules: HOME_RULES });
    expect(config.pricingBasis).toBe("hourly");
  });

  it("move-out legacy model maps to sqm_fixed WITHOUT a serviceKey pricing branch", () => {
    // serviceKey is deliberately NOT move_out_cleaning — the MODEL must drive it.
    const { config, issues } = buildServiceConfigV2({
      service: {
        service_key: "flyttstad_premium",
        display_name: "Premium",
        enabled: true,
        pricing_model: "move_out_fixed_plus_addons",
        settings_json: { displayRoundingInterval: 100 },
      },
      plans: MOVEOUT_PLANS,
      pricingRules: MOVEOUT_RULES,
    });
    expect(config.pricingBasis).toBe("sqm_fixed");
    expect(issues.some((i) => i.code === "unsupported_pricing_model")).toBe(false);
  });

  it("new generic hourly_by_area maps to the hourly basis", () => {
    const { config, issues } = buildServiceConfigV2({
      service: { service_key: "generic_hourly", enabled: true, pricing_model: "hourly_by_area", settings_json: {} },
      plans: HOME_PLANS,
      pricingRules: HOME_RULES,
    });
    expect(config.pricingBasis).toBe("hourly");
    expect(config.sqmTime).not.toBeNull();
    expect(issues.some((i) => i.code === "unsupported_pricing_model")).toBe(false);
  });

  it("new generic sqm_fixed maps to the sqm_fixed basis", () => {
    const { config, issues } = buildServiceConfigV2({
      service: { service_key: "generic_sqm", enabled: true, pricing_model: "sqm_fixed", settings_json: {} },
      plans: MOVEOUT_PLANS,
      pricingRules: MOVEOUT_RULES,
    });
    expect(config.pricingBasis).toBe("sqm_fixed");
    expect(issues.some((i) => i.code === "unsupported_pricing_model")).toBe(false);
  });

  it("pricing basis comes from the model, not the serviceKey (move_out_cleaning + hourly model → hourly)", () => {
    const { config } = buildServiceConfigV2({
      service: {
        service_key: "move_out_cleaning",
        enabled: true,
        pricing_model: "home_cleaning_recommended_hours",
        settings_json: {},
      },
      plans: HOME_PLANS,
      pricingRules: HOME_RULES,
    });
    // serviceKey alone no longer forces sqm_fixed — the resolved generic model wins.
    expect(config.pricingBasis).toBe("hourly");
  });

  it("legacy-safety net: a move_out_cleaning row with no model still prices sqm_fixed", () => {
    const { config } = buildServiceConfigV2({
      service: { service_key: "move_out_cleaning", enabled: true, settings_json: {} },
      plans: MOVEOUT_PLANS,
      pricingRules: MOVEOUT_RULES,
    });
    expect(config.pricingBasis).toBe("sqm_fixed");
  });
});

// ── 14. GPM-1 unsupported models never silently price as hourly ───────────────

describe("buildServiceConfigV2 — unsupported generic models do not silently price as hourly (GPM-1)", () => {
  for (const pricingModel of [
    "unit_based",
    "fixed_package",
    "manual_quote",
    "window_cleaning_count_based",
    "inquiry_only_no_price",
    "totally_unknown",
  ]) {
    it(`flags "${pricingModel}" as unsupported and builds no hourly time config`, () => {
      const { config, issues } = buildServiceConfigV2({
        // hourly time rules ARE provided, but an unsupported model must not use them.
        service: { service_key: "x_service", enabled: true, pricing_model: pricingModel, settings_json: {} },
        plans: HOME_PLANS,
        pricingRules: HOME_RULES,
      });
      expect(issues.some((i) => i.code === "unsupported_pricing_model")).toBe(true);
      expect(config.sqmTime).toBeNull();
      expect(issues.some((i) => i.code === "missing_sqm_time_config")).toBe(false);
    });
  }

  it("the engine refuses to price an unsupported-model config (no silent hourly price)", () => {
    const { config } = buildServiceConfigV2({
      service: { service_key: "x_service", enabled: true, pricing_model: "unit_based", settings_json: {} },
      plans: HOME_PLANS,
      pricingRules: HOME_RULES,
    });
    const res = calculateRawV2({ config, sqm: 100 });
    expect(res.valid).toBe(false);
    expect(res.rawPriceExclVat).toBeNull();
  });
});
