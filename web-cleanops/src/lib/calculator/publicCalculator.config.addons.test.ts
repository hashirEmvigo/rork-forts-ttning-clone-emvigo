import { describe, it, expect } from "vitest";

/**
 * Slice V2-E3-1 — public config exposes GENERIC add-ons.
 *
 * Tests the EXACT pure config mapper the `public-calculator` Edge Function runs
 * (`supabase/functions/_shared/calculator/publicCalculator.ts`). The Edge
 * Function loads `calculator_addons` rows (public-safe columns only) and hands
 * them to {@link buildPublicConfig}; this suite pins the public-safe output:
 * only active + public_visible + non-deleted add-ons are exposed, grouped under
 * their service, sorted by sort_order then addon_key, with NO pricing effect
 * channels, NO internal name, and NO `single_select`.
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

const officeService: CalculatorServiceRow = {
  id: "svc-office",
  service_key: "office_cleaning",
  display_name: "Kontorsstädning",
  description: null,
  enabled: true,
  coming_soon: false,
  pricing_model: "office_cleaning_recurring_area_frequency",
  sort_order: 2,
  settings_json: {},
};

const comingSoonService: CalculatorServiceRow = {
  id: "svc-window",
  service_key: "window_cleaning",
  display_name: "Fönsterputs",
  description: null,
  enabled: false,
  coming_soon: true,
  pricing_model: "move_out_fixed_plus_addons",
  sort_order: 3,
  settings_json: {},
};

/**
 * Builds a `calculator_addons` config row from partial input. The index signature
 * lets the leak tests attach internal-only keys (name / effect_* ) that the real
 * config select never fetches, proving the mapper never copies them through.
 */
type AddonRowInput = Partial<CalculatorAddonConfigRow> & {
  calculator_service_id: string;
  addon_key: string;
  public_label: string;
  [extra: string]: unknown;
};
function addonRow(input: AddonRowInput): CalculatorAddonConfigRow {
  return { input_type: "boolean", ...input } as CalculatorAddonConfigRow;
}

function home(services = [homeService]) {
  return (addons: CalculatorAddonConfigRow[], questions: CalculatorQuestionRow[] = []) =>
    buildPublicConfig({ company, settings: true === true ? settings(true) : settings(false), services, questions, plans: [], addons });
}

// ── 1. Empty add-ons ─────────────────────────────────────────────────────────

describe("buildPublicConfig add-ons — empty", () => {
  it("returns addons: [] for every enabled service when none exist (and when omitted)", () => {
    const withEmpty = buildPublicConfig({
      company, settings: settings(true), services: [homeService, officeService], questions: [], plans: [], addons: [],
    });
    expect(withEmpty.services.map((s) => s.addons)).toEqual([[], []]);

    // `addons` is optional on ConfigParts — omitting it must behave like [].
    const omitted = buildPublicConfig({
      company, settings: settings(true), services: [homeService], questions: [], plans: [],
    });
    expect(omitted.services[0].addons).toEqual([]);
  });
});

// ── 2 + 3. Public-safe boolean + quantity fields ─────────────────────────────

describe("buildPublicConfig add-ons — public-safe fields", () => {
  const result = home()([
    addonRow({
      calculator_service_id: "svc-home", addon_key: "bathrooms", public_label: "Antal badrum",
      input_type: "quantity", quantity_min: 1, quantity_max: 5, quantity_step: 1, quantity_default: 1,
      required: true, sort_order: 1,
    }),
    addonRow({
      calculator_service_id: "svc-home", addon_key: "dog", public_label: "Har du hund?",
      description: "Lite extra tid.", input_type: "boolean", boolean_default: false, required: false, sort_order: 2,
    }),
  ]);

  it("maps a quantity add-on to its full public-safe shape", () => {
    expect(result.services[0].addons[0]).toEqual({
      addonKey: "bathrooms",
      publicLabel: "Antal badrum",
      description: null,
      inputType: "quantity",
      booleanDefault: false,
      quantityMin: 1,
      quantityMax: 5,
      quantityStep: 1,
      quantityDefault: 1,
      required: true,
      sortOrder: 1,
    });
  });

  it("maps a boolean add-on (description preserved, quantity defaults applied)", () => {
    expect(result.services[0].addons[1]).toEqual({
      addonKey: "dog",
      publicLabel: "Har du hund?",
      description: "Lite extra tid.",
      inputType: "boolean",
      booleanDefault: false,
      quantityMin: 0,
      quantityMax: null,
      quantityStep: 1,
      quantityDefault: 0,
      required: false,
      sortOrder: 2,
    });
  });

  it("coerces Postgres numeric-as-text + clamps a non-positive step to 1", () => {
    const r = home()([
      addonRow({
        calculator_service_id: "svc-home", addon_key: "windows", public_label: "Fönster",
        input_type: "quantity", quantity_min: "2", quantity_max: "10", quantity_step: "0", quantity_default: "2",
        sort_order: "4",
      }),
    ]);
    expect(r.services[0].addons[0]).toMatchObject({
      quantityMin: 2, quantityMax: 10, quantityStep: 1, quantityDefault: 2, sortOrder: 4,
    });
  });
});

// ── 4 + 5 + 6. Lifecycle filtering (defensive mirror of the SQL WHERE) ───────

describe("buildPublicConfig add-ons — lifecycle filtering", () => {
  it("hides inactive, hidden, and soft-deleted rows; keeps the visible one", () => {
    const r = home()([
      addonRow({ calculator_service_id: "svc-home", addon_key: "visible", public_label: "Synlig", sort_order: 1, active: true, public_visible: true }),
      addonRow({ calculator_service_id: "svc-home", addon_key: "inactive", public_label: "Inaktiv", sort_order: 2, active: false, public_visible: true }),
      addonRow({ calculator_service_id: "svc-home", addon_key: "hidden", public_label: "Dold", sort_order: 3, active: true, public_visible: false }),
      addonRow({ calculator_service_id: "svc-home", addon_key: "deleted", public_label: "Raderad", sort_order: 4, active: true, public_visible: true, deleted_at: "2026-01-01T00:00:00Z" }),
    ]);
    expect(r.services[0].addons.map((a) => a.addonKey)).toEqual(["visible"]);
  });

  it("treats absent lifecycle flags as visible (a public-only select omits them)", () => {
    const r = home()([
      addonRow({ calculator_service_id: "svc-home", addon_key: "plain", public_label: "Utan flaggor", sort_order: 1 }),
    ]);
    expect(r.services[0].addons.map((a) => a.addonKey)).toEqual(["plain"]);
  });
});

// ── 7 + 14. Service scoping (no cross-service leakage) ───────────────────────

describe("buildPublicConfig add-ons — service scoping", () => {
  const r = buildPublicConfig({
    company, settings: settings(true), services: [homeService, officeService], questions: [], plans: [],
    addons: [
      addonRow({ calculator_service_id: "svc-home", addon_key: "dog", public_label: "Hund", sort_order: 1 }),
      addonRow({ calculator_service_id: "svc-office", addon_key: "windows", public_label: "Fönster", sort_order: 1 }),
    ],
  });

  it("attaches each add-on only to its own service", () => {
    const homeCfg = r.services.find((s) => s.serviceKey === "home_cleaning")!;
    const officeCfg = r.services.find((s) => s.serviceKey === "office_cleaning")!;
    expect(homeCfg.addons.map((a) => a.addonKey)).toEqual(["dog"]);
    expect(officeCfg.addons.map((a) => a.addonKey)).toEqual(["windows"]);
  });

  it("never lets one service receive another service's add-ons", () => {
    const officeCfg = r.services.find((s) => s.serviceKey === "office_cleaning")!;
    expect(officeCfg.addons.some((a) => a.addonKey === "dog")).toBe(false);
  });

  it("coming-soon (disabled) services always return addons: []", () => {
    const r2 = buildPublicConfig({
      company, settings: settings(true), services: [comingSoonService], questions: [], plans: [],
      addons: [addonRow({ calculator_service_id: "svc-window", addon_key: "x", public_label: "X", sort_order: 1 })],
    });
    expect(r2.services[0].addons).toEqual([]);
  });
});

// ── 8. Sorting (sort_order, then addon_key) ──────────────────────────────────

describe("buildPublicConfig add-ons — sorting", () => {
  it("sorts by sort_order, then addon_key as a stable tie-break", () => {
    const r = home()([
      addonRow({ calculator_service_id: "svc-home", addon_key: "zebra", public_label: "Z", sort_order: 2 }),
      addonRow({ calculator_service_id: "svc-home", addon_key: "alpha", public_label: "A", sort_order: 2 }),
      addonRow({ calculator_service_id: "svc-home", addon_key: "oven", public_label: "O", sort_order: 1 }),
    ]);
    expect(r.services[0].addons.map((a) => a.addonKey)).toEqual(["oven", "alpha", "zebra"]);
  });
});

// ── 9 + 10 + 11. No pricing internals, no internal name, no single_select ────

describe("buildPublicConfig add-ons — leak + single_select guards", () => {
  const r = home()([
    addonRow({
      calculator_service_id: "svc-home", addon_key: "dog", public_label: "Har du hund?",
      input_type: "single_select", // must never be exposed — clamps to boolean
      sort_order: 1,
      // Internal-only fields the real config select NEVER fetches:
      name: "INTERNAL Dog surcharge",
      effect_time_minutes: 30,
      effect_fixed_excl_vat: 199,
      effect_percent: 15,
    }),
  ]);
  const addon = r.services[0].addons[0];
  const wire = JSON.stringify(r);

  it("never exposes pricing effect channels", () => {
    expect(wire).not.toContain("effectTime");
    expect(wire).not.toContain("effect_time_minutes");
    expect(wire).not.toContain("effectFixed");
    expect(wire).not.toContain("effectPercent");
    expect(wire).not.toContain("199");
    expect(Object.keys(addon).sort()).toEqual(
      [
        "addonKey", "booleanDefault", "description", "inputType", "publicLabel",
        "quantityDefault", "quantityMax", "quantityMin", "quantityStep", "required", "sortOrder",
      ].sort(),
    );
  });

  it("never exposes the internal admin name", () => {
    expect(wire).not.toContain("INTERNAL Dog surcharge");
    expect("name" in addon).toBe(false);
  });

  it("never exposes single_select — clamps any unexpected input_type to boolean", () => {
    expect(wire).not.toContain("single_select");
    expect(addon.inputType).toBe("boolean");
  });
});

// ── 12. Legacy calculator_questions add-on fields are NOT V2 add-ons ──────────

describe("buildPublicConfig add-ons — legacy isolation", () => {
  it("keeps the legacy `addons` multiselect QUESTION out of service.addons", () => {
    const legacyAddonsQuestion: CalculatorQuestionRow = {
      id: "q-home-addons", calculator_service_id: "svc-home", question_key: "addons",
      label: "Tillval", help_text: null, input_type: "multiselect", required: false,
      options_json: [{ value: "oven", label: "Ugn" }], validation_json: {}, sort_order: 1,
    };
    const r = home()([], [legacyAddonsQuestion]);
    // The legacy question still renders as a QUESTION...
    expect(r.services[0].questions.map((q) => q.questionKey)).toContain("addons");
    // ...but it is NEVER surfaced as a generic V2 add-on.
    expect(r.services[0].addons).toEqual([]);
  });
});

// ── 13. Existing services/questions/plans config unchanged ───────────────────

describe("buildPublicConfig add-ons — no regression to existing config", () => {
  const question: CalculatorQuestionRow = {
    id: "q-home-sqm", calculator_service_id: "svc-home", question_key: "sqm",
    label: "Boyta (m²)", help_text: null, input_type: "number", required: true,
    options_json: [], validation_json: { min: 10 }, sort_order: 1,
  };

  it("still groups/sorts questions and only ADDS the addons field", () => {
    const r = buildPublicConfig({
      company, settings: settings(true), services: [homeService], questions: [question], plans: [],
      addons: [addonRow({ calculator_service_id: "svc-home", addon_key: "dog", public_label: "Hund", sort_order: 1 })],
    });
    const svc = r.services[0];
    expect(svc.questions.map((q) => q.questionKey)).toEqual(["sqm"]);
    expect(svc.addons.map((a) => a.addonKey)).toEqual(["dog"]);
    expect(svc.serviceKey).toBe("home_cleaning");
    expect(svc.requiresCleaningPlan).toBe(true);
  });

  it("withholds add-ons entirely when the calculator is disabled", () => {
    const r = buildPublicConfig({
      company, settings: settings(false), services: [homeService], questions: [question], plans: [],
      addons: [addonRow({ calculator_service_id: "svc-home", addon_key: "dog", public_label: "Hund", sort_order: 1 })],
    });
    expect(r.enabled).toBe(false);
    expect(r.services).toEqual([]);
  });
});
