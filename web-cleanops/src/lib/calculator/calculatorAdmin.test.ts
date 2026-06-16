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

import {
  countEnabledServices,
  getCalculatorAdminOverview,
  mapPlanRow,
  mapServiceRow,
  mapSettingsRow,
  setCalculatorEnabled,
  MVP_CALCULATOR_COMPANY_LEGACY_ID,
} from "./calculatorAdmin";

/**
 * A chainable Supabase query-builder stand-in. Every filter method returns the
 * same builder; the builder is awaitable (resolves to `result`) and also exposes
 * `maybeSingle()` resolving to `result`, so it can model both the count/list
 * `await query` chains and the `.maybeSingle()` single-row chains.
 */
interface MockBuilder {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  is: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
  then: (onFulfilled: (value: unknown) => unknown) => Promise<unknown>;
}

function makeBuilder(result: unknown): MockBuilder {
  const builder: MockBuilder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    is: vi.fn(() => builder),
    order: vi.fn(() => builder),
    update: vi.fn(() => builder),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    then: (onFulfilled) => Promise.resolve(result).then(onFulfilled),
  };
  return builder;
}

const SETTINGS_ROW = {
  legacy_id: "calc_settings_cmp_o2f6orw29m",
  company_id: "00000000-0000-4000-8000-000000000abc",
  company_legacy_id: "cmp_o2f6orw29m",
  enabled: false,
  public_slug: "rakna-ut-ditt-pris",
  price_display_mode: "range",
  quote_validity_days: 30,
  default_quote_status: "submitted",
  currency: "SEK",
};

const HOME_SERVICE_ROW = {
  legacy_id: "calc_svc_home_cleaning_cmp_o2f6orw29m",
  service_key: "home_cleaning",
  display_name: "Hemstädning",
  pricing_model: "home_cleaning_recommended_hours",
  enabled: true,
  coming_soon: false,
  sort_order: 1,
};

const MOVEOUT_SERVICE_ROW = {
  legacy_id: "calc_svc_move_out_cleaning_cmp_o2f6orw29m",
  service_key: "move_out_cleaning",
  display_name: "Flyttstädning",
  pricing_model: "move_out_fixed_plus_addons",
  enabled: true,
  coming_soon: false,
  sort_order: 2,
};

const FLEX_PLAN_ROW = {
  legacy_id: "clean_plan_flexible_cmp_o2f6orw29m",
  plan_key: "flexible",
  name: "Flexibel",
  hourly_rate: 349,
  is_default: true,
  active: true,
  sort_order: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("calculatorAdmin pure mappers", () => {
  it("maps a settings row to its app-facing view", () => {
    const view = mapSettingsRow(SETTINGS_ROW);
    expect(view).toEqual({
      legacyId: "calc_settings_cmp_o2f6orw29m",
      companyId: "00000000-0000-4000-8000-000000000abc",
      companyLegacyId: "cmp_o2f6orw29m",
      enabled: false,
      publicSlug: "rakna-ut-ditt-pris",
      priceDisplayMode: "range",
      quoteValidityDays: 30,
      defaultQuoteStatus: "submitted",
      currency: "SEK",
    });
  });

  it("maps a service row and coerces booleans", () => {
    const view = mapServiceRow(MOVEOUT_SERVICE_ROW);
    expect(view).toEqual({
      legacyId: "calc_svc_move_out_cleaning_cmp_o2f6orw29m",
      serviceKey: "move_out_cleaning",
      displayName: "Flyttstädning",
      pricingModel: "move_out_fixed_plus_addons",
      enabled: true,
      comingSoon: false,
      sortOrder: 2,
    });
  });

  it("maps a plan row and numifies the hourly rate", () => {
    const view = mapPlanRow({ ...FLEX_PLAN_ROW, hourly_rate: "349" as unknown as number });
    expect(view.hourlyRate).toBe(349);
    expect(typeof view.hourlyRate).toBe("number");
    expect(view.isDefault).toBe(true);
  });

  it("counts only enabled services", () => {
    const services = [
      mapServiceRow(HOME_SERVICE_ROW),
      mapServiceRow({ ...MOVEOUT_SERVICE_ROW, enabled: false }),
    ];
    expect(countEnabledServices(services)).toBe(1);
  });
});

describe("setCalculatorEnabled", () => {
  it("updates ONLY the enabled column and returns the persisted value", async () => {
    const builder = makeBuilder({ data: { legacy_id: "calc_settings_cmp_o2f6orw29m", enabled: true }, error: null });
    mocks.from.mockReturnValue(builder);

    const result = await setCalculatorEnabled("calc_settings_cmp_o2f6orw29m", true);

    expect(result).toBe(true);
    expect(mocks.from).toHaveBeenCalledWith("calculator_settings");
    // Exactly one column is written.
    expect(builder.update).toHaveBeenCalledTimes(1);
    expect(builder.update).toHaveBeenCalledWith({ enabled: true });
    expect(builder.eq).toHaveBeenCalledWith("legacy_id", "calc_settings_cmp_o2f6orw29m");
    expect(builder.is).toHaveBeenCalledWith("deleted_at", null);
  });

  it("throws when the settings row is missing (no silent success)", async () => {
    mocks.from.mockReturnValue(makeBuilder({ data: null, error: null }));
    await expect(setCalculatorEnabled("missing", true)).rejects.toThrow(/not found/i);
  });

  it("throws when Supabase returns an error", async () => {
    mocks.from.mockReturnValue(makeBuilder({ data: null, error: { message: "rls denied" } }));
    await expect(setCalculatorEnabled("calc_settings_cmp_o2f6orw29m", false)).rejects.toThrow(/rls denied/i);
  });
});

describe("getCalculatorAdminOverview", () => {
  it("returns null when no live settings row exists", async () => {
    mocks.from.mockImplementation((table: string) => {
      if (table === "calculator_settings") return makeBuilder({ data: null, error: null });
      throw new Error(`Unexpected table read before settings resolved: ${table}`);
    });

    const overview = await getCalculatorAdminOverview();
    expect(overview).toBeNull();
  });

  it("assembles the overview with mapped rows and counts", async () => {
    const byTable: Record<string, MockBuilder> = {
      calculator_settings: makeBuilder({ data: SETTINGS_ROW, error: null }),
      companies: makeBuilder({ data: { name: "Städalliansen Sverige AB" }, error: null }),
      calculator_services: makeBuilder({ data: [HOME_SERVICE_ROW, MOVEOUT_SERVICE_ROW], error: null }),
      cleaning_plans: makeBuilder({ data: [FLEX_PLAN_ROW], error: null }),
      calculator_questions: makeBuilder({ count: 12, error: null }),
      pricing_rules: makeBuilder({ count: 18, error: null }),
      prospects: makeBuilder({ count: 0, error: null }),
      quote_requests: makeBuilder({ count: 0, error: null }),
      quote_request_answers: makeBuilder({ count: 0, error: null }),
    };
    mocks.from.mockImplementation((table: string) => {
      const builder = byTable[table];
      if (!builder) throw new Error(`Unexpected table ${table}`);
      return builder;
    });

    const overview = await getCalculatorAdminOverview();
    expect(overview).not.toBeNull();
    if (!overview) return;

    expect(overview.companyName).toBe("Städalliansen Sverige AB");
    expect(overview.matchesMvpTarget).toBe(true);
    expect(overview.settings.companyLegacyId).toBe(MVP_CALCULATOR_COMPANY_LEGACY_ID);
    expect(overview.settings.enabled).toBe(false);
    expect(overview.services.map((s) => s.serviceKey)).toEqual(["home_cleaning", "move_out_cleaning"]);
    expect(overview.cleaningPlans.map((p) => p.planKey)).toEqual(["flexible"]);
    expect(overview.counts).toEqual({
      services: 2,
      enabledServices: 2,
      cleaningPlans: 1,
      questions: 12,
      pricingRules: 18,
      prospects: 0,
      quoteRequests: 0,
      quoteRequestAnswers: 0,
    });

    // quote_request_answers is append-only: counted without a deleted_at filter.
    expect(byTable.quote_request_answers.is).not.toHaveBeenCalled();
    expect(byTable.quote_requests.is).toHaveBeenCalledWith("deleted_at", null);
  });
});
