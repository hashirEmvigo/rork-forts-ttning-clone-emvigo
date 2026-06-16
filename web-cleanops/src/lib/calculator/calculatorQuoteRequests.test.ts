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
  extractSnapshotSummary,
  getCalculatorQuoteRequests,
  mapQuoteRequestAnswerRow,
  mapQuoteRequestRow,
} from "./calculatorQuoteRequests";

/**
 * A chainable Supabase query-builder stand-in. Read methods return the same
 * builder; it is awaitable (resolves to `result`) and also exposes `maybeSingle()`.
 * Write methods are spies that, if ever called, fail the read-only contract.
 */
interface MockBuilder {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  is: ReturnType<typeof vi.fn>;
  in: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  then: (onFulfilled: (value: unknown) => unknown) => Promise<unknown>;
}

function makeBuilder(result: unknown): MockBuilder {
  const builder: MockBuilder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    is: vi.fn(() => builder),
    in: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    update: vi.fn(() => builder),
    insert: vi.fn(() => builder),
    upsert: vi.fn(() => builder),
    delete: vi.fn(() => builder),
    then: (onFulfilled) => Promise.resolve(result).then(onFulfilled),
  };
  return builder;
}

const SETTINGS_ROW = {
  company_id: "00000000-0000-4000-8000-000000000abc",
  company_legacy_id: "cmp_o2f6orw29m",
};

const SENSITIVE_SNAPSHOT = {
  formulaVersion: "v1",
  pricingModel: "home_cleaning_recommended_hours",
  serviceKey: "home_cleaning",
  currency: "SEK",
  priceDisplayMode: "range",
  inputs: { sqm: 70, bathrooms: 1, addons: ["oven"] },
  selectedPlanSnapshot: { id: "uuid-secret-plan", planKey: "flexible", name: "Flexibel", hourlyRate: 349 },
  estimatedHours: 3,
  rawPrice: 88888,
  calculatedPrice: 1047,
  minPrice: 950,
  maxPrice: 1150,
  ruleValues: [{ ruleKey: "secret_margin_rule", ruleType: "multiplier", valueNumeric: 0.2 }],
  steps: [{ key: "secret_internal_step", label: "Internal trace", value: 77777 }],
  submittedAt: "2026-06-08T10:00:00.000Z",
};

const HOME_QUOTE_ROW = {
  legacy_id: "qr_home_1",
  created_at: "2026-06-08T10:00:00.000Z",
  status: "submitted",
  calculator_service_key: "home_cleaning",
  selected_cleaning_plan_name: "Flexibel",
  selected_cleaning_plan_hourly_rate: 349,
  estimated_hours: 3,
  calculated_price: 1047,
  min_price: 950,
  max_price: 1150,
  currency: "SEK",
  price_display_mode: "range",
  pricing_model: "home_cleaning_recommended_hours",
  formula_version: "v1",
  requires_manual_review: true,
  valid_until: "2026-07-08T10:00:00.000Z",
  reference: null,
  source: "price_calculator",
  source_url: "https://stadportalen.se/rakna-ut-ditt-pris",
  customer_name: "Calculator Test Customer",
  customer_email: "calculator.test@example.com",
  customer_phone: "0700000000",
  address_json: { postalCode: "41700" },
  prospect_legacy_id: "prospect_1",
  pricing_snapshot_json: SENSITIVE_SNAPSHOT,
};

const MOVE_OUT_QUOTE_ROW = {
  ...HOME_QUOTE_ROW,
  legacy_id: "qr_move_2",
  calculator_service_key: "move_out_cleaning",
  selected_cleaning_plan_name: null,
  selected_cleaning_plan_hourly_rate: null,
  pricing_model: "move_out_fixed_plus_addons",
  requires_manual_review: false,
  prospect_legacy_id: null,
  pricing_snapshot_json: { formulaVersion: "v1", pricingModel: "move_out_fixed_plus_addons", selectedPlanSnapshot: null },
};

const ANSWER_ROWS = [
  {
    quote_request_legacy_id: "qr_home_1",
    question_key: "bathrooms",
    question_label_snapshot: "Antal badrum",
    input_type_snapshot: "number",
    answer_value_json: { value: 1 },
    affects_pricing: true,
    sort_order: 2,
  },
  {
    quote_request_legacy_id: "qr_home_1",
    question_key: "sqm",
    question_label_snapshot: "Boyta (kvm)",
    input_type_snapshot: "number",
    answer_value_json: { value: 70 },
    affects_pricing: true,
    sort_order: 1,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("extractSnapshotSummary (sensitive-field drop)", () => {
  it("keeps only the safe summary fields", () => {
    const summary = extractSnapshotSummary(SENSITIVE_SNAPSHOT);
    expect(summary).toEqual({
      formulaVersion: "v1",
      pricingModel: "home_cleaning_recommended_hours",
      selectedPlan: { planKey: "flexible", name: "Flexibel", hourlyRate: 349 },
      estimatedHours: 3,
      calculatedPrice: 1047,
      minPrice: 950,
      maxPrice: 1150,
    });
  });

  it("never copies the raw trace, rule values, rawPrice, inputs or plan uuid", () => {
    const summary = extractSnapshotSummary(SENSITIVE_SNAPSHOT);
    const serialized = JSON.stringify(summary);
    expect(summary).not.toHaveProperty("steps");
    expect(summary).not.toHaveProperty("ruleValues");
    expect(summary).not.toHaveProperty("rawPrice");
    expect(summary).not.toHaveProperty("inputs");
    expect(serialized).not.toContain("secret_internal_step");
    expect(serialized).not.toContain("secret_margin_rule");
    expect(serialized).not.toContain("88888"); // rawPrice
    expect(serialized).not.toContain("uuid-secret-plan"); // plan uuid
    // selectedPlan summary keeps no `id`.
    expect(summary.selectedPlan).not.toHaveProperty("id");
  });

  it("returns a null plan and null numbers for an empty/malformed snapshot", () => {
    expect(extractSnapshotSummary(null)).toEqual({
      formulaVersion: null,
      pricingModel: null,
      selectedPlan: null,
      estimatedHours: null,
      calculatedPrice: null,
      minPrice: null,
      maxPrice: null,
    });
  });
});

describe("mapQuoteRequestAnswerRow", () => {
  it("extracts the answer value and freezes the label/type", () => {
    const view = mapQuoteRequestAnswerRow(ANSWER_ROWS[1]);
    expect(view).toEqual({
      questionKey: "sqm",
      questionLabel: "Boyta (kvm)",
      inputType: "number",
      value: 70,
      affectsPricing: true,
      sortOrder: 1,
    });
  });

  it("tolerates a missing answer_value_json", () => {
    const view = mapQuoteRequestAnswerRow({
      quote_request_legacy_id: "qr_x",
      question_key: "addons",
      question_label_snapshot: null,
      input_type_snapshot: null,
      answer_value_json: null,
      affects_pricing: null,
      sort_order: null,
    });
    expect(view.value).toBeNull();
    expect(view.affectsPricing).toBe(true);
    expect(view.sortOrder).toBe(0);
  });
});

describe("mapQuoteRequestRow", () => {
  it("maps a row into a public-safe view with no uuids", () => {
    const view = mapQuoteRequestRow(HOME_QUOTE_ROW, {
      serviceDisplayName: "Hemstädning",
      prospectStatus: "new",
      answers: [],
    });

    expect(view.legacyId).toBe("qr_home_1");
    expect(view.serviceKey).toBe("home_cleaning");
    expect(view.serviceDisplayName).toBe("Hemstädning");
    expect(view.prospectStatus).toBe("new");
    expect(view.requiresManualReview).toBe(true);
    expect(view.contact).toEqual({
      name: "Calculator Test Customer",
      email: "calculator.test@example.com",
      phone: "0700000000",
      postalCode: "41700",
    });
    // No uuid-style fields leak into the view.
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain("uuid-secret-plan");
    expect(serialized).not.toContain("secret_internal_step");
    expect(serialized).not.toContain("88888");
    expect(view).not.toHaveProperty("id");
    expect(view).not.toHaveProperty("companyId");
    expect(view).not.toHaveProperty("prospectId");
  });

  it("coerces numeric strings and defaults the currency", () => {
    const view = mapQuoteRequestRow({
      ...HOME_QUOTE_ROW,
      calculated_price: "1047" as unknown as number,
      currency: "" as unknown as string,
    });
    expect(view.calculatedPrice).toBe(1047);
    expect(view.currency).toBe("SEK");
  });
});

describe("getCalculatorQuoteRequests", () => {
  it("returns an empty list when no settings row exists", async () => {
    mocks.from.mockImplementation((table: string) => {
      if (table === "calculator_settings") return makeBuilder({ data: null, error: null });
      throw new Error(`Unexpected table read before settings resolved: ${table}`);
    });

    await expect(getCalculatorQuoteRequests()).resolves.toEqual([]);
  });

  it("returns an empty list when no quotes have been submitted", async () => {
    mocks.from.mockImplementation((table: string) => {
      if (table === "calculator_settings") return makeBuilder({ data: SETTINGS_ROW, error: null });
      if (table === "quote_requests") return makeBuilder({ data: [], error: null });
      throw new Error(`Unexpected table ${table} — sibling loads must be skipped when empty`);
    });

    await expect(getCalculatorQuoteRequests()).resolves.toEqual([]);
  });

  it("assembles quotes with linked service name, prospect status and sorted answers", async () => {
    const byTable: Record<string, MockBuilder> = {
      calculator_settings: makeBuilder({ data: SETTINGS_ROW, error: null }),
      quote_requests: makeBuilder({ data: [HOME_QUOTE_ROW, MOVE_OUT_QUOTE_ROW], error: null }),
      calculator_services: makeBuilder({
        data: [
          { service_key: "home_cleaning", display_name: "Hemstädning" },
          { service_key: "move_out_cleaning", display_name: "Flyttstädning" },
        ],
        error: null,
      }),
      prospects: makeBuilder({
        data: [{ legacy_id: "prospect_1", prospect_status: "new", source: "price_calculator", source_url: null }],
        error: null,
      }),
      quote_request_answers: makeBuilder({ data: ANSWER_ROWS, error: null }),
    };
    mocks.from.mockImplementation((table: string) => {
      const builder = byTable[table];
      if (!builder) throw new Error(`Unexpected table ${table}`);
      return builder;
    });

    const quotes = await getCalculatorQuoteRequests();

    expect(quotes).toHaveLength(2);
    const [home, moveOut] = quotes;

    expect(home.serviceDisplayName).toBe("Hemstädning");
    expect(home.prospectStatus).toBe("new");
    expect(home.requiresManualReview).toBe(true);
    // Answers are returned sorted by their snapshot sort_order.
    expect(home.answers.map((a) => a.questionKey)).toEqual(["sqm", "bathrooms"]);
    // Safe snapshot summary only.
    expect(home.snapshotSummary.selectedPlan?.name).toBe("Flexibel");
    expect(JSON.stringify(home)).not.toContain("secret_internal_step");

    expect(moveOut.serviceDisplayName).toBe("Flyttstädning");
    expect(moveOut.prospectStatus).toBeNull();
    expect(moveOut.answers).toEqual([]);

    // Answers were fetched scoped to the page of quote legacy ids.
    expect(byTable.quote_request_answers.in).toHaveBeenCalledWith("quote_request_legacy_id", [
      "qr_home_1",
      "qr_move_2",
    ]);
  });

  it("is strictly read-only — never issues a write on any table", async () => {
    const byTable: Record<string, MockBuilder> = {
      calculator_settings: makeBuilder({ data: SETTINGS_ROW, error: null }),
      quote_requests: makeBuilder({ data: [HOME_QUOTE_ROW], error: null }),
      calculator_services: makeBuilder({ data: [], error: null }),
      prospects: makeBuilder({ data: [], error: null }),
      quote_request_answers: makeBuilder({ data: ANSWER_ROWS, error: null }),
    };
    mocks.from.mockImplementation((table: string) => byTable[table] ?? makeBuilder({ data: [], error: null }));

    await getCalculatorQuoteRequests();

    for (const builder of Object.values(byTable)) {
      expect(builder.update).not.toHaveBeenCalled();
      expect(builder.insert).not.toHaveBeenCalled();
      expect(builder.upsert).not.toHaveBeenCalled();
      expect(builder.delete).not.toHaveBeenCalled();
    }
  });

  it("throws a clear error when the quote read fails", async () => {
    mocks.from.mockImplementation((table: string) => {
      if (table === "calculator_settings") return makeBuilder({ data: SETTINGS_ROW, error: null });
      if (table === "quote_requests") return makeBuilder({ data: null, error: { message: "rls denied" } });
      return makeBuilder({ data: [], error: null });
    });

    await expect(getCalculatorQuoteRequests()).rejects.toThrow(/rls denied/i);
  });
});
