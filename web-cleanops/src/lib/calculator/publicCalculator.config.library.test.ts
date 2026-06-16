import { describe, it, expect } from "vitest";

/**
 * GPM-CALC-LIBRARY-5 — public config compatibility for library-linked rows.
 *
 * Proves the public read CONTRACT is unchanged by the reusable question/add-on
 * library (migration 0077). The public config builder
 * ({@link buildPublicConfig}, the EXACT pure mapper the `public-calculator` Edge
 * Function runs) reads ONLY the service-scoped `calculator_questions` /
 * `calculator_addons` rows — never the library tables — and selects only named
 * public-safe columns. Therefore:
 *   • A service row ACTIVATED from a library item (carrying the new
 *     `library_item_id` back-reference) maps to byte-identical public output as a
 *     plain custom row, and `library_item_id` never crosses the wire.
 *   • Library items that were never activated onto a service produce no public
 *     question/add-on (the public path has no library input at all).
 *   • Inactive/hidden activated rows are still withheld (lifecycle filter intact).
 *   • Service-level override columns (the activation/override layer) are what the
 *     public output reflects — not the library defaults.
 *
 * This is adapter/contract hardening: no production logic changes were needed.
 */
import { buildPublicConfig } from "../../../supabase/functions/_shared/calculator/publicCalculator.ts";
import type {
  CalculatorAddonConfigRow,
  CalculatorQuestionRow,
  CalculatorServiceRow,
  CalculatorSettingsRow,
  CompanyRow,
} from "../../../supabase/functions/_shared/calculator/types.ts";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const company: CompanyRow = { id: "comp-uuid-1", name: "Städalliansen Sverige AB", legacy_id: "cmp_x1" };

function settings(enabled: boolean): CalculatorSettingsRow {
  return {
    id: "set-1",
    company_id: "comp-uuid-1",
    company_legacy_id: "cmp_x1",
    enabled,
    public_slug: "rakna-ut-ditt-pris",
    price_display_mode: "range",
    show_price_before_contact: true,
    require_contact_before_result: false,
    show_login_prompt_after_submit: false,
    quote_validity_days: 30,
    currency: "SEK",
    rut_display_mode: "none",
    content: {},
  };
}

const homeService: CalculatorServiceRow = {
  id: "svc-home",
  service_key: "home_cleaning",
  display_name: "Hemstädning",
  description: null,
  enabled: true,
  coming_soon: false,
  pricing_model: "home_cleaning_recommended_hours",
  sort_order: 1,
  settings_json: { requiresCleaningPlan: true },
};

/**
 * Builds a question row, allowing extra DB columns the public select never
 * fetches (e.g. `library_item_id`) so the leak tests can prove they are dropped.
 */
type QuestionRowInput = Partial<CalculatorQuestionRow> & {
  id: string;
  calculator_service_id: string;
  question_key: string;
  label: string;
  [extra: string]: unknown;
};
function questionRow(input: QuestionRowInput): CalculatorQuestionRow {
  return {
    help_text: null,
    input_type: "number",
    required: false,
    options_json: [],
    validation_json: {},
    sort_order: 0,
    ...input,
  } as CalculatorQuestionRow;
}

/** Builds an add-on row, allowing extra internal-only columns (e.g. `library_item_id`). */
type AddonRowInput = Partial<CalculatorAddonConfigRow> & {
  calculator_service_id: string;
  addon_key: string;
  public_label: string;
  [extra: string]: unknown;
};
function addonRow(input: AddonRowInput): CalculatorAddonConfigRow {
  return { input_type: "boolean", ...input } as CalculatorAddonConfigRow;
}

function configWith(
  questions: CalculatorQuestionRow[],
  addons: CalculatorAddonConfigRow[] = [],
) {
  return buildPublicConfig({ company, settings: settings(true), services: [homeService], questions, plans: [], addons });
}

// ── 1. Library-linked QUESTIONS map identically + never leak the back-reference ──

describe("buildPublicConfig — library-linked questions", () => {
  const direct = questionRow({
    id: "q-sqm", calculator_service_id: "svc-home", question_key: "sqm", label: "Boyta (m²)",
    input_type: "number", required: true, sort_order: 1, validation_json: { min: 10 },
  });
  const linked = questionRow({ ...direct, library_item_id: "qlib-uuid-1" });

  it("a question activated from a library item maps identically to a direct question", () => {
    const directCfg = configWith([direct]);
    const linkedCfg = configWith([linked]);
    expect(linkedCfg.services[0].questions).toEqual(directCfg.services[0].questions);
  });

  it("never exposes library_item_id on the public wire", () => {
    const cfg = configWith([linked]);
    const wire = JSON.stringify(cfg);
    expect(wire).not.toContain("library_item_id");
    expect(wire).not.toContain("libraryItemId");
    expect(wire).not.toContain("qlib-uuid-1");
    expect("libraryItemId" in cfg.services[0].questions[0]).toBe(false);
    expect("library_item_id" in cfg.services[0].questions[0]).toBe(false);
  });
});

// ── 2. Library-linked ADD-ONS map identically + never leak the back-reference ──

describe("buildPublicConfig — library-linked add-ons", () => {
  const direct = addonRow({
    calculator_service_id: "svc-home", addon_key: "oven_cleaning", public_label: "Rengöring av ugn",
    description: "Lite extra tid.", input_type: "boolean", required: false, sort_order: 1,
  });
  const linked = addonRow({ ...direct, library_item_id: "alib-uuid-1" });

  it("an add-on activated from a library item maps identically to a direct add-on", () => {
    const directCfg = configWith([], [direct]);
    const linkedCfg = configWith([], [linked]);
    expect(linkedCfg.services[0].addons).toEqual(directCfg.services[0].addons);
  });

  it("never exposes library_item_id on the public wire", () => {
    const cfg = configWith([], [linked]);
    const wire = JSON.stringify(cfg);
    expect(wire).not.toContain("library_item_id");
    expect(wire).not.toContain("libraryItemId");
    expect(wire).not.toContain("alib-uuid-1");
    expect("libraryItemId" in cfg.services[0].addons[0]).toBe(false);
  });
});

// ── 3. Inactive / un-activated library items never leak publicly ──────────────

describe("buildPublicConfig — inactive / un-activated library items", () => {
  it("withholds a deactivated activated add-on row (active:false), keeping the active one", () => {
    const cfg = configWith([], [
      addonRow({ calculator_service_id: "svc-home", addon_key: "active_lib", public_label: "Aktiv", sort_order: 1, active: true, public_visible: true, library_item_id: "alib-1" }),
      addonRow({ calculator_service_id: "svc-home", addon_key: "inactive_lib", public_label: "Inaktiv", sort_order: 2, active: false, public_visible: true, library_item_id: "alib-2" }),
      addonRow({ calculator_service_id: "svc-home", addon_key: "hidden_lib", public_label: "Dold", sort_order: 3, active: true, public_visible: false, library_item_id: "alib-3" }),
    ]);
    expect(cfg.services[0].addons.map((a) => a.addonKey)).toEqual(["active_lib"]);
  });

  it("a library item never activated onto a service produces no public question/add-on", () => {
    // The public path receives ONLY service-scoped rows; un-activated library
    // items are simply absent from the input — there is no library leak path.
    const cfg = configWith([], []);
    expect(cfg.services[0].questions).toEqual([]);
    expect(cfg.services[0].addons).toEqual([]);
  });
});

// ── 4. Service-level overrides (activation/override layer) win over library defaults ──

describe("buildPublicConfig — service-level overrides win over library defaults", () => {
  it("exposes the service row's overridden question fields, not the library defaults", () => {
    // Library default would be e.g. label "Vi har husdjur", required false, sort 5;
    // after activation the admin overrode the service row's own columns.
    const overridden = questionRow({
      id: "q-pets", calculator_service_id: "svc-home", question_key: "has_pets",
      label: "Har du husdjur? (anpassad)", input_type: "boolean", required: true,
      sort_order: 9, help_text: "Per-service override", library_item_id: "qlib-pets",
    });
    const cfg = configWith([overridden]);
    expect(cfg.services[0].questions[0]).toEqual({
      questionKey: "has_pets",
      label: "Har du husdjur? (anpassad)",
      helpText: "Per-service override",
      inputType: "boolean",
      required: true,
      options: [],
      validation: {},
      sortOrder: 9,
    });
  });

  it("exposes the service row's overridden add-on copy/effice fields, not the library defaults", () => {
    const overridden = addonRow({
      calculator_service_id: "svc-home", addon_key: "oven_cleaning",
      public_label: "Ugn (anpassad text)", description: "Override description",
      input_type: "quantity", quantity_min: 1, quantity_max: 3, quantity_step: 1, quantity_default: 1,
      required: true, sort_order: 7, library_item_id: "alib-oven",
    });
    const cfg = configWith([], [overridden]);
    expect(cfg.services[0].addons[0]).toEqual({
      addonKey: "oven_cleaning",
      publicLabel: "Ugn (anpassad text)",
      description: "Override description",
      inputType: "quantity",
      booleanDefault: false,
      quantityMin: 1,
      quantityMax: 3,
      quantityStep: 1,
      quantityDefault: 1,
      required: true,
      sortOrder: 7,
    });
  });
});
