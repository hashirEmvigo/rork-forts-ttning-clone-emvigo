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

import { getCalculatorConfig } from "./calculatorConfigAdmin";

interface MockBuilder {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  is: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
  then: (onFulfilled: (value: unknown) => unknown) => Promise<unknown>;
}

function makeBuilder(result: unknown): MockBuilder {
  const builder: MockBuilder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    is: vi.fn(() => builder),
    order: vi.fn(() => builder),
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
  show_price_before_contact: true,
  require_contact_before_result: false,
  show_login_prompt_after_submit: true,
  quote_validity_days: 30,
  manual_review_threshold_amount: null,
  currency: "SEK",
  rut_display_mode: "none",
  auto_create_prospect: true,
  auto_create_quote_request: true,
  default_quote_status: "submitted",
};

const SERVICE_ROW = {
  id: "svc-home",
  legacy_id: "calc_svc_home_cleaning_cmp_o2f6orw29m",
  service_key: "home_cleaning",
  display_name: "Hemstädning",
  description: null,
  enabled: true,
  coming_soon: false,
  pricing_model: "home_cleaning_recommended_hours",
  sort_order: 1,
  settings_json: { requiresCleaningPlan: true },
};

const QUESTION_ROW = {
  legacy_id: "q-sqm",
  calculator_service_id: "svc-home",
  calculator_service_legacy_id: "calc_svc_home_cleaning_cmp_o2f6orw29m",
  question_key: "sqm",
  label: "Boyta",
  help_text: null,
  input_type: "integer",
  required: true,
  options_json: [],
  validation_json: {},
  affects_pricing: true,
  sort_order: 1,
  active: true,
};

const LEGACY_PLAN_ROW = {
  legacy_id: "clean_plan_fixed_cmp_o2f6orw29m",
  plan_key: "fixed",
  name: "Fast",
  description: null,
  hourly_rate: 399,
  flexibility_level: null,
  customer_day_time_control: null,
  same_staff_preference_level: null,
  booking_priority: null,
  cancellation_terms_summary: null,
  is_default: true,
  active: true,
  sort_order: 1,
};

const RULE_ROW = {
  legacy_id: "rule-base-hours",
  calculator_service_id: "svc-home",
  rule_key: "base_hours",
  rule_type: "numeric_factor",
  value_numeric: 1.5,
  active: true,
  sort_order: 1,
};

const ADDON_ROW = {
  legacy_id: "calc_addon_dog_cmp",
  calculator_service_id: "svc-home",
  calculator_service_legacy_id: "calc_svc_home_cleaning_cmp_o2f6orw29m",
  service_key: "home_cleaning",
  addon_key: "dog",
  name: "Dog in home",
  public_label: "Finns hund i hemmet?",
  description: null,
  input_type: "boolean",
  boolean_default: false,
  quantity_min: 0,
  quantity_max: null,
  quantity_step: 1,
  quantity_default: 0,
  effect_time_minutes: 20,
  effect_fixed_excl_vat: 0,
  effect_percent: 0,
  active: true,
  public_visible: true,
  required: false,
  sort_order: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getCalculatorConfig migration-tolerant reads", () => {
  it("falls back to legacy settings and plan columns when Phase 1 VAT/RUT schema is not applied yet", async () => {
    const settingsMissingVat = makeBuilder({
      data: null,
      error: { message: "column calculator_settings.default_vat_rate_percent does not exist" },
    });
    const settingsLegacy = makeBuilder({ data: SETTINGS_ROW, error: null });
    const company = makeBuilder({ data: { name: "Städalliansen Sverige AB" }, error: null });
    const services = makeBuilder({ data: [SERVICE_ROW], error: null });
    const questions = makeBuilder({ data: [QUESTION_ROW], error: null });
    const plansMissingVat = makeBuilder({
      data: null,
      error: { message: "column cleaning_plans.vat_rate_percent does not exist" },
    });
    const plansLegacy = makeBuilder({ data: [LEGACY_PLAN_ROW], error: null });
    const rules = makeBuilder({ data: [RULE_ROW], error: null });
    // Phase 2 `calculator_size_bands` table also does not exist yet in this
    // "Phase 1 schema not applied" world; the loader must tolerate it and fall
    // back to empty size bands rather than hard-failing.
    const sizeBandsMissing = makeBuilder({
      data: null,
      error: { message: 'relation "calculator_size_bands" does not exist' },
    });
    // The generic add-on table (migration 0074) also does not exist in this
    // "Phase 1 schema not applied" world; the loader must tolerate it too.
    const addonsMissing = makeBuilder({
      data: null,
      error: { message: 'relation "calculator_addons" does not exist' },
    });

    const settingsQueue = [settingsMissingVat, settingsLegacy];
    const plansQueue = [plansMissingVat, plansLegacy];
    mocks.from.mockImplementation((table: string) => {
      if (table === "calculator_settings") return settingsQueue.shift() ?? settingsLegacy;
      if (table === "companies") return company;
      if (table === "calculator_services") return services;
      if (table === "calculator_questions") return questions;
      if (table === "cleaning_plans") return plansQueue.shift() ?? plansLegacy;
      if (table === "pricing_rules") return rules;
      if (table === "calculator_size_bands") return sizeBandsMissing;
      if (table === "calculator_addons") return addonsMissing;
      throw new Error(`Unexpected table ${table}`);
    });

    const config = await getCalculatorConfig();

    expect(config).not.toBeNull();
    expect(config?.settings.defaultVatRatePercent).toBe(25);
    // Size bands table missing → loader falls back to an empty list, not a throw.
    expect(config?.sizeBands).toEqual([]);
    // Add-ons table missing → loader falls back to an empty list, not a throw.
    expect(config?.addons).toEqual([]);
    expect(config?.cleaningPlans).toHaveLength(1);
    expect(config?.cleaningPlans[0]).toMatchObject({
      serviceKey: "home_cleaning",
      hourlyRate: 399,
      vatRatePercent: 25,
      rutEnabled: false,
      showRutBreakdown: false,
    });
    expect(settingsMissingVat.select).toHaveBeenCalledWith(expect.stringContaining("default_vat_rate_percent"));
    expect(settingsLegacy.select).not.toHaveBeenCalledWith(expect.stringContaining("default_vat_rate_percent"));
    expect(plansMissingVat.select).toHaveBeenCalledWith(expect.stringContaining("vat_rate_percent"));
    expect(plansLegacy.select).not.toHaveBeenCalledWith(expect.stringContaining("vat_rate_percent"));
  });

  it("includes mapped generic add-ons when the calculator_addons table has rows", async () => {
    const settings = makeBuilder({ data: SETTINGS_ROW, error: null });
    const company = makeBuilder({ data: { name: "Städalliansen Sverige AB" }, error: null });
    const services = makeBuilder({ data: [SERVICE_ROW], error: null });
    const questions = makeBuilder({ data: [QUESTION_ROW], error: null });
    const plans = makeBuilder({ data: [LEGACY_PLAN_ROW], error: null });
    const rules = makeBuilder({ data: [RULE_ROW], error: null });
    const sizeBands = makeBuilder({ data: [], error: null });
    const addons = makeBuilder({ data: [ADDON_ROW], error: null });

    mocks.from.mockImplementation((table: string) => {
      if (table === "calculator_settings") return settings;
      if (table === "companies") return company;
      if (table === "calculator_services") return services;
      if (table === "calculator_questions") return questions;
      if (table === "cleaning_plans") return plans;
      if (table === "pricing_rules") return rules;
      if (table === "calculator_size_bands") return sizeBands;
      if (table === "calculator_addons") return addons;
      throw new Error(`Unexpected table ${table}`);
    });

    const config = await getCalculatorConfig();

    expect(config?.addons).toHaveLength(1);
    expect(config?.addons?.[0]).toMatchObject({
      legacyId: "calc_addon_dog_cmp",
      serviceId: "svc-home",
      serviceKey: "home_cleaning",
      addonKey: "dog",
      name: "Dog in home",
      publicLabel: "Finns hund i hemmet?",
      inputType: "boolean",
      booleanDefault: false,
      effectTimeMinutes: 20,
      effectFixedExclVat: 0,
      effectPercent: 0,
      active: true,
      publicVisible: true,
      required: false,
    });
    // The add-on read is ordered (service → sort → key), never unordered.
    expect(addons.order).toHaveBeenCalled();
  });

  it("falls back to an empty add-on list when the calculator_addons table is missing", async () => {
    const settings = makeBuilder({ data: SETTINGS_ROW, error: null });
    const company = makeBuilder({ data: { name: "Städalliansen Sverige AB" }, error: null });
    const services = makeBuilder({ data: [SERVICE_ROW], error: null });
    const questions = makeBuilder({ data: [QUESTION_ROW], error: null });
    const plans = makeBuilder({ data: [LEGACY_PLAN_ROW], error: null });
    const rules = makeBuilder({ data: [RULE_ROW], error: null });
    const sizeBands = makeBuilder({ data: [], error: null });
    const addonsMissing = makeBuilder({
      data: null,
      error: { message: 'relation "calculator_addons" does not exist' },
    });

    mocks.from.mockImplementation((table: string) => {
      if (table === "calculator_settings") return settings;
      if (table === "companies") return company;
      if (table === "calculator_services") return services;
      if (table === "calculator_questions") return questions;
      if (table === "cleaning_plans") return plans;
      if (table === "pricing_rules") return rules;
      if (table === "calculator_size_bands") return sizeBands;
      if (table === "calculator_addons") return addonsMissing;
      throw new Error(`Unexpected table ${table}`);
    });

    const config = await getCalculatorConfig();

    expect(config).not.toBeNull();
    expect(config?.addons).toEqual([]);
  });
});
