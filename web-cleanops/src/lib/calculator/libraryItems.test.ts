/**
 * GPM-CALC-LIBRARY-2A — pure mapper tests for the calculator library item views
 * (migration 0077). These mappers do no I/O, so no Supabase mock is needed.
 *   • mapQuestionLibraryItemRow turns a snake_case question-library row into the
 *     camelCase editor view (options parsed, validation passed through, defaults).
 *   • mapAddonLibraryItemRow turns a snake_case add-on-library row into the
 *     camelCase editor view (string numerics coerced, unknown input_type → boolean).
 */
import { describe, expect, it } from "vitest";

import {
  mapAddonLibraryItemRow,
  mapQuestionLibraryItemRow,
  type AddonLibraryItemRow,
  type QuestionLibraryItemRow,
} from "./libraryItems";

describe("mapQuestionLibraryItemRow", () => {
  it("maps a full question library row to its camelCase view", () => {
    const row: QuestionLibraryItemRow = {
      id: "qlib-uuid-1",
      legacy_id: "calc_qlib_has_pets_acme",
      company_id: "company-uuid",
      company_legacy_id: "acme",
      question_key: "has_pets",
      label: "Vi har husdjur",
      help_text: "Markera om det finns husdjur i hemmet.",
      input_type: "boolean",
      default_required: false,
      default_affects_pricing: true,
      default_options_json: [{ value: "yes", label: "Ja" }, { value: "no", label: "Nej" }],
      default_validation_json: { min: 0, max: 1 },
      default_sort_order: 7,
      description: "Reusable pets question",
      active: true,
    };

    expect(mapQuestionLibraryItemRow(row)).toEqual({
      id: "qlib-uuid-1",
      legacyId: "calc_qlib_has_pets_acme",
      companyId: "company-uuid",
      companyLegacyId: "acme",
      questionKey: "has_pets",
      label: "Vi har husdjur",
      helpText: "Markera om det finns husdjur i hemmet.",
      inputType: "boolean",
      defaultRequired: false,
      defaultAffectsPricing: true,
      defaultOptions: [{ value: "yes", label: "Ja" }, { value: "no", label: "Nej" }],
      defaultValidation: { min: 0, max: 1 },
      defaultSortOrder: 7,
      description: "Reusable pets question",
      active: true,
    });
  });

  it("falls back to safe defaults for null/malformed fields", () => {
    const row: QuestionLibraryItemRow = {
      id: "qlib-uuid-2",
      legacy_id: "calc_qlib_sqm_acme",
      company_id: "company-uuid",
      company_legacy_id: "acme",
      question_key: "sqm",
      label: "Boyta (m\u00b2)",
      help_text: null,
      input_type: "number",
      default_required: true,
      default_affects_pricing: true,
      default_options_json: "not-an-array",
      default_validation_json: null,
      default_sort_order: 0,
      description: null,
      active: false,
    };

    const view = mapQuestionLibraryItemRow(row);
    expect(view.helpText).toBeNull();
    expect(view.description).toBeNull();
    expect(view.defaultOptions).toEqual([]);
    expect(view.defaultValidation).toEqual({});
    expect(view.defaultRequired).toBe(true);
    expect(view.active).toBe(false);
  });
});

describe("mapAddonLibraryItemRow", () => {
  it("maps a full add-on library row, coercing string numerics", () => {
    const row: AddonLibraryItemRow = {
      id: "alib-uuid-1",
      legacy_id: "calc_alib_oven_acme",
      company_id: "company-uuid",
      company_legacy_id: "acme",
      addon_key: "oven_cleaning",
      name: "Ugnsreng\u00f6ring",
      public_label: "Reng\u00f6ring av ugn",
      description: "St\u00e4dning av ugn inuti.",
      input_type: "boolean",
      boolean_default: false,
      quantity_min: "0",
      quantity_max: null,
      quantity_step: "1",
      quantity_default: "0",
      effect_time_minutes: "30",
      effect_fixed_excl_vat: "150",
      effect_percent: "0",
      default_sort_order: 3,
      active: true,
    };

    expect(mapAddonLibraryItemRow(row)).toEqual({
      id: "alib-uuid-1",
      legacyId: "calc_alib_oven_acme",
      companyId: "company-uuid",
      companyLegacyId: "acme",
      addonKey: "oven_cleaning",
      name: "Ugnsreng\u00f6ring",
      publicLabel: "Reng\u00f6ring av ugn",
      description: "St\u00e4dning av ugn inuti.",
      inputType: "boolean",
      booleanDefault: false,
      quantityMin: 0,
      quantityMax: null,
      quantityStep: 1,
      quantityDefault: 0,
      effectTimeMinutes: 30,
      effectFixedExclVat: 150,
      effectPercent: 0,
      defaultSortOrder: 3,
      active: true,
    });
  });

  it("defaults an unknown input_type to boolean and preserves quantity bounds", () => {
    const row: AddonLibraryItemRow = {
      id: "alib-uuid-2",
      legacy_id: "calc_alib_bathrooms_acme",
      company_id: "company-uuid",
      company_legacy_id: "acme",
      addon_key: "extra_bathroom",
      name: "Extra badrum",
      public_label: "Antal extra badrum",
      description: null,
      input_type: "single_select",
      boolean_default: false,
      quantity_min: 1,
      quantity_max: 5,
      quantity_step: 1,
      quantity_default: 1,
      effect_time_minutes: 20,
      effect_fixed_excl_vat: 0,
      effect_percent: 0,
      default_sort_order: 0,
      active: true,
    };

    const view = mapAddonLibraryItemRow(row);
    expect(view.inputType).toBe("boolean");
    expect(view.quantityMin).toBe(1);
    expect(view.quantityMax).toBe(5);
    expect(view.quantityDefault).toBe(1);
  });
});
