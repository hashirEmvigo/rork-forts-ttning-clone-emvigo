/**
 * Slice V2-D — Admin write-path tests for the new V2 plan-card persistence.
 *
 * Covers the two highest-risk writes added in this slice, against a recording
 * Supabase mock (the real scoped-update path, not ideal data):
 *   • updateCleaningPlan persists `startAdjustmentHours` to the dedicated
 *     `start_adjustment_hours` column and NEVER the overloaded legacy
 *     `price_adjustment_value` / `price_adjustment_type`.
 *   • setDefaultCleaningPlan clears the sibling default FIRST (respecting the
 *     one-default-per-service unique index), promotes the chosen plan, then
 *     mirrors `settings_json.defaultPlanKey` while preserving other settings.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    from: (table: string) => mocks.from(table),
  },
}));

import { createCleaningPlan, setDefaultCleaningPlan, updateCleaningPlan } from "./calculatorConfigAdmin";

interface RecordedOp {
  table: string;
  kind: "update" | "select" | "insert";
  payload?: Record<string, unknown>;
  columns?: string;
  legacyId?: unknown;
}

let ops: RecordedOp[] = [];
let existingServiceSettings: Record<string, unknown> = {};

/** A chainable builder that records the terminal operation it represents. */
function installSupabaseMock(): void {
  mocks.from.mockImplementation((table: string) => {
    const state: RecordedOp = { table, kind: "select" };
    const builder: Record<string, unknown> = {
      update(payload: Record<string, unknown>) {
        state.kind = "update";
        state.payload = payload;
        return builder;
      },
      insert(payload: Record<string, unknown>) {
        state.kind = "insert";
        state.payload = payload;
        return builder;
      },
      select(columns?: string) {
        state.columns = columns;
        return builder;
      },
      eq(column: string, value: unknown) {
        if (column === "legacy_id") state.legacyId = value;
        return builder;
      },
      is() {
        return builder;
      },
      maybeSingle() {
        ops.push({ ...state });
        if (
          state.kind === "select" &&
          table === "calculator_services" &&
          (state.columns ?? "").includes("settings_json")
        ) {
          return Promise.resolve({ data: { settings_json: existingServiceSettings }, error: null });
        }
        return Promise.resolve({ data: { legacy_id: state.legacyId ?? "row" }, error: null });
      },
    };
    return builder;
  });
}

beforeEach(() => {
  ops = [];
  existingServiceSettings = {};
  vi.clearAllMocks();
  installSupabaseMock();
});

describe("updateCleaningPlan — V2 start adjustment", () => {
  it("writes startAdjustmentHours to start_adjustment_hours (never the legacy columns)", async () => {
    await updateCleaningPlan("plan_home_flexible", { startAdjustmentHours: 0.25 });

    const updates = ops.filter((o) => o.kind === "update");
    expect(updates).toHaveLength(1);
    expect(updates[0].table).toBe("cleaning_plans");
    expect(updates[0].legacyId).toBe("plan_home_flexible");
    expect(updates[0].payload).toEqual({ start_adjustment_hours: 0.25 });
    expect(updates[0].payload).not.toHaveProperty("price_adjustment_value");
    expect(updates[0].payload).not.toHaveProperty("price_adjustment_type");
  });

  it("writes hourly rate + start adjustment together, still no legacy adjustment columns", async () => {
    await updateCleaningPlan("plan_home_flexible", { hourlyRate: 410, startAdjustmentHours: -0.25 });

    const updates = ops.filter((o) => o.kind === "update");
    expect(updates).toHaveLength(1);
    expect(updates[0].payload).toEqual({ hourly_rate: 410, start_adjustment_hours: -0.25 });
    expect(updates[0].payload).not.toHaveProperty("price_adjustment_value");
  });
});

describe("updateCleaningPlan — V2 sqm_fixed plan-card fields (GPM-4a)", () => {
  it("writes pricePerSqmExclVat / fixedAdjustmentExclVat / minimumPriceExclVat to their dedicated columns", async () => {
    await updateCleaningPlan("plan_moveout_normal", {
      pricePerSqmExclVat: 48,
      fixedAdjustmentExclVat: 250,
      minimumPriceExclVat: 1500,
    });

    const updates = ops.filter((o) => o.kind === "update");
    expect(updates).toHaveLength(1);
    expect(updates[0].table).toBe("cleaning_plans");
    expect(updates[0].legacyId).toBe("plan_moveout_normal");
    expect(updates[0].payload).toEqual({
      price_per_sqm_excl_vat: 48,
      fixed_adjustment_excl_vat: 250,
      minimum_price_excl_vat: 1500,
    });
    // unit_based has no column yet — it must never be written by this patch.
    expect(updates[0].payload).not.toHaveProperty("price_per_unit_excl_vat");
  });

  it("clears nullable fields when passed null (price per m² + minimum price)", async () => {
    await updateCleaningPlan("plan_moveout_normal", {
      pricePerSqmExclVat: null,
      minimumPriceExclVat: null,
    });

    const updates = ops.filter((o) => o.kind === "update");
    expect(updates).toHaveLength(1);
    expect(updates[0].payload).toEqual({
      price_per_sqm_excl_vat: null,
      minimum_price_excl_vat: null,
    });
  });

  it("persists a negative fixed adjustment (a discount), which the column intentionally allows", async () => {
    await updateCleaningPlan("plan_moveout_normal", { fixedAdjustmentExclVat: -100 });

    const updates = ops.filter((o) => o.kind === "update");
    expect(updates).toHaveLength(1);
    expect(updates[0].payload).toEqual({ fixed_adjustment_excl_vat: -100 });
  });

  it("omitting the new fields writes nothing for them (no accidental column overwrite)", async () => {
    await updateCleaningPlan("plan_home_flexible", { name: "Flexibel" });

    const updates = ops.filter((o) => o.kind === "update");
    expect(updates).toHaveLength(1);
    expect(updates[0].payload).toEqual({ name: "Flexibel" });
    expect(updates[0].payload).not.toHaveProperty("price_per_sqm_excl_vat");
    expect(updates[0].payload).not.toHaveProperty("fixed_adjustment_excl_vat");
    expect(updates[0].payload).not.toHaveProperty("minimum_price_excl_vat");
  });
});

describe("createCleaningPlan — GPM-4c-1 model-aware insert", () => {
  const baseInput = {
    companyId: "co-1",
    companyLegacyId: "co_legacy_1",
    serviceId: "svc-1",
    serviceLegacyId: "svc_legacy_1",
    serviceKey: "deep_cleaning_builder",
    name: "Builder Plan",
    description: null,
    sortOrder: 3,
  };

  function insertPayload(): Record<string, unknown> {
    const inserts = ops.filter((o) => o.kind === "insert");
    expect(inserts).toHaveLength(1);
    expect(inserts[0].table).toBe("cleaning_plans");
    return inserts[0].payload ?? {};
  }

  it("writes hourly_rate (+ optional start adjustment) for hourly_by_area, never sqm/unit columns", async () => {
    await createCleaningPlan({
      ...baseInput,
      planKey: "builder_hourly",
      pricingModel: "hourly_by_area",
      hourlyRate: 455,
      startAdjustmentHours: 0.25,
    });

    const payload = insertPayload();
    expect(payload).toMatchObject({
      service_key: "deep_cleaning_builder",
      plan_key: "builder_hourly",
      name: "Builder Plan",
      hourly_rate: 455,
      start_adjustment_hours: 0.25,
      is_default: false,
      active: true,
      sort_order: 3,
    });
    expect(payload).not.toHaveProperty("price_per_sqm_excl_vat");
    expect(payload).not.toHaveProperty("price_per_unit_excl_vat");
  });

  it("omits start_adjustment_hours when not provided for hourly_by_area", async () => {
    await createCleaningPlan({
      ...baseInput,
      planKey: "builder_hourly2",
      pricingModel: "hourly_by_area",
      hourlyRate: 410,
    });
    const payload = insertPayload();
    expect(payload).toMatchObject({ hourly_rate: 410 });
    expect(payload).not.toHaveProperty("start_adjustment_hours");
  });

  it("writes hourly_rate = 0 + price_per_sqm_excl_vat (+ optional adjustments) for sqm_fixed", async () => {
    await createCleaningPlan({
      ...baseInput,
      planKey: "builder_sqm",
      pricingModel: "sqm_fixed",
      pricePerSqmExclVat: 48,
      fixedAdjustmentExclVat: 250,
      minimumPriceExclVat: 1500,
    });

    const payload = insertPayload();
    expect(payload).toMatchObject({
      hourly_rate: 0,
      price_per_sqm_excl_vat: 48,
      fixed_adjustment_excl_vat: 250,
      minimum_price_excl_vat: 1500,
      is_default: false,
      active: true,
    });
    // The hourly-only adjustment + the reserved per-unit column are never written.
    expect(payload).not.toHaveProperty("start_adjustment_hours");
    expect(payload).not.toHaveProperty("price_per_unit_excl_vat");
  });

  it("omits optional sqm_fixed adjustment columns when not provided (still hourly_rate = 0)", async () => {
    await createCleaningPlan({
      ...baseInput,
      planKey: "builder_sqm2",
      pricingModel: "sqm_fixed",
      pricePerSqmExclVat: 52,
    });
    const payload = insertPayload();
    expect(payload).toMatchObject({ hourly_rate: 0, price_per_sqm_excl_vat: 52 });
    expect(payload).not.toHaveProperty("fixed_adjustment_excl_vat");
    expect(payload).not.toHaveProperty("minimum_price_excl_vat");
  });

  it("always creates the plan as active + non-default (no service visibility touched)", async () => {
    await createCleaningPlan({
      ...baseInput,
      planKey: "builder_defaults",
      pricingModel: "hourly_by_area",
      hourlyRate: 399,
    });
    const payload = insertPayload();
    expect(payload.active).toBe(true);
    expect(payload.is_default).toBe(false);
    // The insert touches only the plan row — no calculator_services write.
    expect(ops.some((o) => o.table === "calculator_services")).toBe(false);
  });

  it("defaults pricingModel to hourly_by_area for a legacy caller (writes hourly_rate)", async () => {
    await createCleaningPlan({
      ...baseInput,
      serviceKey: "home_cleaning",
      planKey: "premium",
      hourlyRate: 499,
    });
    const payload = insertPayload();
    expect(payload).toMatchObject({ hourly_rate: 499, is_default: false, active: true });
    expect(payload).not.toHaveProperty("price_per_sqm_excl_vat");
  });

  // GPM-10-B — a newly-created generic plan must start with RUT OFF; the admin opts
  // in afterwards from the plan card. The data layer is the authoritative default.
  it("defaults RUT off for a new sqm_fixed generic plan (eligible/enabled false, percent 50)", async () => {
    await createCleaningPlan({
      ...baseInput,
      planKey: "builder_rut_default",
      pricingModel: "sqm_fixed",
      pricePerSqmExclVat: 48,
    });
    const payload = insertPayload();
    expect(payload).toMatchObject({
      rut_eligible: false,
      rut_enabled: false,
      rut_percent: 50,
      show_rut_breakdown: false,
    });
  });
});

describe("setDefaultCleaningPlan", () => {
  it("clears the sibling default first, promotes the plan, then mirrors settings_json.defaultPlanKey", async () => {
    existingServiceSettings = {
      plansEnabled: true,
      planPricingModel: "hourly_rate_by_plan",
      defaultPlanKey: "flexible",
      baseHourlyRateExclVat: 399,
    };

    await setDefaultCleaningPlan({
      planLegacyId: "plan_home_fast",
      planKey: "fast",
      serviceLegacyId: "svc_home_legacy",
      clearSiblingLegacyIds: ["plan_home_flexible"],
    });

    const updates = ops.filter((o) => o.kind === "update");
    // 1) clear sibling, 2) promote target, 3) mirror service settings.
    expect(updates).toHaveLength(3);
    expect(updates[0]).toMatchObject({
      table: "cleaning_plans",
      legacyId: "plan_home_flexible",
      payload: { is_default: false },
    });
    expect(updates[1]).toMatchObject({
      table: "cleaning_plans",
      legacyId: "plan_home_fast",
      payload: { is_default: true },
    });

    // Order matters: clear BEFORE set so the unique index is never violated.
    const clearIndex = ops.findIndex((o) => o.legacyId === "plan_home_flexible" && o.kind === "update");
    const setIndex = ops.findIndex(
      (o) => o.legacyId === "plan_home_fast" && o.kind === "update" && o.table === "cleaning_plans",
    );
    expect(clearIndex).toBeLessThan(setIndex);

    // Mirror swaps ONLY defaultPlanKey; every other settings_json field is preserved.
    expect(updates[2].table).toBe("calculator_services");
    expect(updates[2].legacyId).toBe("svc_home_legacy");
    expect(updates[2].payload).toEqual({
      settings_json: {
        plansEnabled: true,
        planPricingModel: "hourly_rate_by_plan",
        defaultPlanKey: "fast",
        baseHourlyRateExclVat: 399,
      },
    });
  });

  it("promotes a plan with no sibling default (target + mirror only)", async () => {
    await setDefaultCleaningPlan({
      planLegacyId: "plan_home_fast",
      planKey: "fast",
      serviceLegacyId: "svc_home_legacy",
      clearSiblingLegacyIds: [],
    });

    const updates = ops.filter((o) => o.kind === "update");
    expect(updates).toHaveLength(2);
    expect(updates[0]).toMatchObject({
      table: "cleaning_plans",
      legacyId: "plan_home_fast",
      payload: { is_default: true },
    });
    expect(updates[1].table).toBe("calculator_services");
    expect(updates[1].payload).toMatchObject({ settings_json: { defaultPlanKey: "fast" } });
  });
});
