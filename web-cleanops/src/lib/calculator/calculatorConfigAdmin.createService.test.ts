import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Slice GPM-3a — data-access proof for createCalculatorService. Mocks the
 * Supabase client (mirroring calculatorConfigAdmin.load.test.ts) and captures the
 * INSERT payload so we can assert the behaviour without a database:
 *   • generic-model services are created as HIDDEN DRAFTS (enabled=false,
 *     coming_soon=false) — never public,
 *   • settings_json is seeded from defaultSettingsForGenericModel, with the
 *     caller's requiresCleaningPlan still winning,
 *   • a legacy / unknown pricing model is rejected BEFORE any insert.
 */

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  insert: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    from: (table: string) => mocks.from(table),
  },
}));

import {
  createCalculatorService,
  defaultSettingsForGenericModel,
  type NewServiceInput,
} from "./calculatorConfigAdmin";
import { GENERIC_PRICING_MODELS } from "./v2/pricingModel";

/** Wires from→insert→select→maybeSingle to a successful insert by default. */
function mockInsert(result: { data: unknown; error: { message: string } | null }): void {
  mocks.insert.mockReturnValue({
    select: vi.fn(() => ({
      maybeSingle: vi.fn(() => Promise.resolve(result)),
    })),
  });
  mocks.from.mockReturnValue({ insert: mocks.insert });
}

function baseInput(over: Partial<NewServiceInput> = {}): NewServiceInput {
  return {
    companyId: "00000000-0000-4000-8000-000000000abc",
    companyLegacyId: "cmp_x",
    serviceKey: "garden_care",
    displayName: "Trädgårdsskötsel",
    description: null,
    pricingModel: "hourly_by_area",
    requiresCleaningPlan: true,
    sortOrder: 9,
    ...over,
  };
}

/** The captured INSERT payload from the most recent createCalculatorService call. */
function insertedPayload(): Record<string, unknown> {
  expect(mocks.insert).toHaveBeenCalledTimes(1);
  return mocks.insert.mock.calls[0][0] as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockInsert({ data: { legacy_id: "calc_svc_x" }, error: null });
});

describe("createCalculatorService — generic service shell (GPM-3a)", () => {
  it("creates a HIDDEN DRAFT (enabled=false, coming_soon=false), never public", async () => {
    await createCalculatorService(baseInput());
    const payload = insertedPayload();
    expect(payload.enabled).toBe(false);
    expect(payload.coming_soon).toBe(false);
    expect(payload.pricing_model).toBe("hourly_by_area");
    expect(payload.service_key).toBe("garden_care");
    expect(payload.sort_order).toBe(9);
  });

  it("seeds settings_json from the selected generic model defaults", async () => {
    await createCalculatorService(baseInput({ pricingModel: "hourly_by_area", requiresCleaningPlan: true }));
    expect(insertedPayload().settings_json).toEqual(defaultSettingsForGenericModel("hourly_by_area"));
  });

  it("applies the correct settings_json defaults for every generic model", async () => {
    for (const model of GENERIC_PRICING_MODELS) {
      vi.clearAllMocks();
      mockInsert({ data: { legacy_id: "calc_svc_x" }, error: null });
      const requiresCleaningPlan = defaultSettingsForGenericModel(model).requiresCleaningPlan;
      await createCalculatorService(baseInput({ pricingModel: model, requiresCleaningPlan }));
      const payload = insertedPayload();
      expect(payload.pricing_model).toBe(model);
      expect(payload.settings_json).toEqual({
        ...defaultSettingsForGenericModel(model),
        requiresCleaningPlan,
      });
    }
  });

  it("lets the caller's requiresCleaningPlan override the model default", async () => {
    // hourly_by_area defaults requiresCleaningPlan=true; the explicit false wins.
    await createCalculatorService(baseInput({ pricingModel: "hourly_by_area", requiresCleaningPlan: false }));
    const settings = insertedPayload().settings_json as Record<string, unknown>;
    expect(settings.requiresCleaningPlan).toBe(false);
    // The remaining model-derived fields are untouched.
    expect(settings.primaryInput).toBe("sqm");
    expect(settings.bookingMode).toBe("recurring");
    expect(settings.publicLayout).toBe("recurring_cleaning");
  });

  it("manual_quote seeds automaticPricing=false and no cleaning plan", async () => {
    await createCalculatorService(baseInput({ pricingModel: "manual_quote", requiresCleaningPlan: false }));
    const settings = insertedPayload().settings_json as Record<string, unknown>;
    expect(settings.automaticPricing).toBe(false);
    expect(settings.requiresCleaningPlan).toBe(false);
    expect(settings.bookingMode).toBe("one_off");
  });

  it("rejects a LEGACY pricing model without inserting", async () => {
    await expect(
      createCalculatorService(baseInput({ pricingModel: "home_cleaning_recommended_hours" })),
    ).rejects.toThrow(/non-generic pricing model/i);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("rejects an UNKNOWN pricing model without inserting", async () => {
    await expect(createCalculatorService(baseInput({ pricingModel: "nope" }))).rejects.toThrow(
      /non-generic pricing model/i,
    );
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("surfaces a Supabase insert error", async () => {
    mockInsert({ data: null, error: { message: "boom" } });
    await expect(createCalculatorService(baseInput())).rejects.toThrow(/insert failed: boom/i);
  });
});
