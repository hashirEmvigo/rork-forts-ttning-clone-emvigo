import { describe, expect, it } from "vitest";

import {
  assessSqmFixedReadiness,
  ENGINE_BACKED_GENERIC_PRICING_MODEL,
  hasSqmPrimaryInput,
  isEngineBackedGenericPricingModel,
  SQM_FIXED_PRIMARY_INPUT_DEFAULT,
  SQM_FIXED_PRIMARY_INPUT_KEY,
  type SqmFixedReadinessPlan,
  type SqmFixedReadinessQuestion,
} from "./genericAdminReadiness";
import { assessGenericServiceRuntimeReadiness } from "../../../supabase/functions/_shared/calculator/publicCalculatorV2.ts";
import type {
  CalculatorServiceRow,
  CleaningPlanRow,
} from "../../../supabase/functions/_shared/calculator/types.ts";
import type { PlanRowV2 } from "../../../supabase/functions/_shared/calculator/v2/index.ts";

/**
 * GPM-6-R — ADMIN generic readiness helper + Admin↔runtime parity.
 *
 * Proves the pure Admin helper {@link assessSqmFixedReadiness} treats LITERAL
 * `sqm_fixed` as engine-backed (priced by the plan's price per m², never by legacy
 * pricing rules) AND that its priceability decision mirrors the public runtime gate
 * `assessGenericServiceRuntimeReadiness` for the same plan configuration — so the
 * Admin badge and the public engine can never disagree about a literal `sqm_fixed`
 * service.
 */

// ── Admin-side helper builders ──────────────────────────────────────────────

function adminPlan(over: Partial<SqmFixedReadinessPlan> = {}): SqmFixedReadinessPlan {
  return { active: true, isDefault: true, pricePerSqmExclVat: 48, ...over };
}

// ── Runtime (Edge Function) row builders — mirror publicCalculatorV2.routing.test ──

const SQM_SERVICE_KEY = "moveout_generic";
type SqmPlanRow = CleaningPlanRow & PlanRowV2;

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

// ── isEngineBackedGenericPricingModel ───────────────────────────────────────

describe("isEngineBackedGenericPricingModel", () => {
  it("matches ONLY the literal generic sqm_fixed model", () => {
    expect(ENGINE_BACKED_GENERIC_PRICING_MODEL).toBe("sqm_fixed");
    expect(isEngineBackedGenericPricingModel("sqm_fixed")).toBe(true);
  });

  it("does NOT match reserved generic models, legacy models, or unknown strings", () => {
    for (const model of [
      "hourly_by_area",
      "unit_based",
      "fixed_package",
      "manual_quote",
      // Legacy `move_out_fixed_plus_addons` ALIASES to the sqm_fixed basis but is not
      // the literal generic model — it must keep its own legacy readiness path.
      "move_out_fixed_plus_addons",
      "home_cleaning_recommended_hours",
      "office_cleaning_recurring_area_frequency",
      "",
      "SQM_FIXED",
    ]) {
      expect(isEngineBackedGenericPricingModel(model)).toBe(false);
    }
  });
});

// ── assessSqmFixedReadiness ─────────────────────────────────────────────────

describe("assessSqmFixedReadiness", () => {
  it("priceable when a literal sqm_fixed service has an active default plan with positive price/m²", () => {
    expect(assessSqmFixedReadiness("sqm_fixed", [adminPlan({ pricePerSqmExclVat: 48 })])).toEqual({
      priceable: true,
      reason: "ok",
    });
  });

  it("rejects a non-literal model (reason not_sqm_fixed) — never consults plans", () => {
    expect(assessSqmFixedReadiness("move_out_fixed_plus_addons", [adminPlan()])).toEqual({
      priceable: false,
      reason: "not_sqm_fixed",
    });
    expect(assessSqmFixedReadiness("hourly_by_area", [adminPlan()]).reason).toBe("not_sqm_fixed");
  });

  it("reason no_active_plan when no plan is active", () => {
    expect(assessSqmFixedReadiness("sqm_fixed", [])).toEqual({ priceable: false, reason: "no_active_plan" });
    expect(assessSqmFixedReadiness("sqm_fixed", [adminPlan({ active: false })]).reason).toBe("no_active_plan");
  });

  it("reason missing_price_per_sqm when the default plan lacks a positive price/m²", () => {
    for (const price of [null, undefined, 0, -3]) {
      expect(
        assessSqmFixedReadiness("sqm_fixed", [adminPlan({ pricePerSqmExclVat: price })]).reason,
      ).toBe("missing_price_per_sqm");
    }
  });

  it("evaluates the DEFAULT active plan's price (default wins over a priced non-default)", () => {
    const plans: SqmFixedReadinessPlan[] = [
      { active: true, isDefault: false, pricePerSqmExclVat: 60 },
      { active: true, isDefault: true, pricePerSqmExclVat: null },
    ];
    // The default plan has no price → not priceable even though another active plan is priced.
    expect(assessSqmFixedReadiness("sqm_fixed", plans).reason).toBe("missing_price_per_sqm");
  });

  it("falls back to the first active plan when none is marked default", () => {
    const plans: SqmFixedReadinessPlan[] = [
      { active: false, isDefault: false, pricePerSqmExclVat: 999 },
      { active: true, isDefault: false, pricePerSqmExclVat: 52 },
    ];
    expect(assessSqmFixedReadiness("sqm_fixed", plans)).toEqual({ priceable: true, reason: "ok" });
  });
});

// ── sqm_fixed primary input (GPM-7 authoring contract) ──────────────────

function question(over: Partial<SqmFixedReadinessQuestion> = {}): SqmFixedReadinessQuestion {
  return { active: true, questionKey: SQM_FIXED_PRIMARY_INPUT_KEY, ...over };
}

describe("SQM_FIXED_PRIMARY_INPUT_KEY + hasSqmPrimaryInput (GPM-7)", () => {
  it("the primary-input key is the literal `sqm` the V2 engine reads as area", () => {
    expect(SQM_FIXED_PRIMARY_INPUT_KEY).toBe("sqm");
  });

  it("true only when an ACTIVE question keyed `sqm` is present", () => {
    expect(hasSqmPrimaryInput([question()])).toBe(true);
    // Other active questions never satisfy the gate — the engine prices ONLY from `sqm`.
    expect(hasSqmPrimaryInput([question({ questionKey: "rooms" })])).toBe(false);
    expect(
      hasSqmPrimaryInput([question({ questionKey: "frequency" }), question({ questionKey: "has_pets" })]),
    ).toBe(false);
    expect(hasSqmPrimaryInput([])).toBe(false);
  });

  it("an ARCHIVED (inactive) sqm question does NOT satisfy the gate", () => {
    expect(hasSqmPrimaryInput([question({ active: false })])).toBe(false);
    // …but an additional ACTIVE sqm question does.
    expect(hasSqmPrimaryInput([question({ active: false }), question({ active: true })])).toBe(true);
  });
});

describe("SQM_FIXED_PRIMARY_INPUT_DEFAULT (GPM-7 canonical setup draft)", () => {
  it("is the one priced area input: keyed `sqm`, whole-m² integer, required, affects price", () => {
    expect(SQM_FIXED_PRIMARY_INPUT_DEFAULT).toEqual({
      questionKey: "sqm",
      label: "Boyta (m²)",
      inputType: "integer",
      required: true,
      affectsPricing: true,
    });
  });

  it("the canonical default itself satisfies the primary-input gate when active", () => {
    expect(
      hasSqmPrimaryInput([{ active: true, questionKey: SQM_FIXED_PRIMARY_INPUT_DEFAULT.questionKey }]),
    ).toBe(true);
  });
});

// ── Admin ↔ runtime parity (the GPM-6-R contract) ───────────────────────────

describe("Admin ↔ runtime parity for literal sqm_fixed (GPM-6-R)", () => {
  it("ready: active plan + positive price/m² → priceable on BOTH sides (reason ok)", () => {
    const runtime = assessGenericServiceRuntimeReadiness({
      service: buildSqmService(),
      plans: [buildSqmPlan({ price_per_sqm_excl_vat: 48 })],
      rules: [],
    });
    const admin = assessSqmFixedReadiness("sqm_fixed", [adminPlan({ pricePerSqmExclVat: 48 })]);
    expect(runtime.ready).toBe(true);
    expect(runtime.reason).toBe("ok");
    expect(admin).toEqual({ priceable: true, reason: "ok" });
  });

  it("no active plan → not ready on BOTH sides (reason no_active_plan)", () => {
    const runtime = assessGenericServiceRuntimeReadiness({
      service: buildSqmService(),
      plans: [buildSqmPlan({ active: false })],
      rules: [],
    });
    const admin = assessSqmFixedReadiness("sqm_fixed", [adminPlan({ active: false })]);
    expect(runtime.ready).toBe(false);
    expect(runtime.reason).toBe("no_active_plan");
    expect(admin).toEqual({ priceable: false, reason: "no_active_plan" });
  });

  it("default plan missing a positive price/m² → not ready on BOTH sides (reason missing_price_per_sqm)", () => {
    for (const price of [null, 0]) {
      const runtime = assessGenericServiceRuntimeReadiness({
        service: buildSqmService(),
        plans: [buildSqmPlan({ price_per_sqm_excl_vat: price })],
        rules: [],
      });
      const admin = assessSqmFixedReadiness("sqm_fixed", [adminPlan({ pricePerSqmExclVat: price })]);
      expect(runtime.reason).toBe("missing_price_per_sqm");
      expect(admin.reason).toBe("missing_price_per_sqm");
      expect(runtime.ready).toBe(admin.priceable);
    }
  });

  it("legacy move_out_fixed_plus_addons (aliases to sqm_fixed) is NOT the literal gate on EITHER side", () => {
    const runtime = assessGenericServiceRuntimeReadiness({
      service: buildSqmService({ pricing_model: "move_out_fixed_plus_addons" }),
      plans: [buildSqmPlan()],
      rules: [],
    });
    const admin = assessSqmFixedReadiness("move_out_fixed_plus_addons", [adminPlan()]);
    expect(runtime.ready).toBe(false);
    expect(runtime.reason).toBe("not_literal_sqm_fixed");
    expect(admin).toEqual({ priceable: false, reason: "not_sqm_fixed" });
  });
});
