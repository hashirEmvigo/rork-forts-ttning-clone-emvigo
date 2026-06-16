import { describe, expect, it } from "vitest";

import { normalizePublicConfigResponse, type PublicAddon } from "./publicCalculatorClient";

/**
 * V2-E3-2 — frontend client parsing of the public-safe generic `addons` array
 * the config action now returns per service (exposed server-side in V2-E3-1).
 *
 * These pin the browser-side contract for ADD-ONS specifically:
 *   • each service carries `addons: PublicAddon[]` (always an array, [] when absent);
 *   • only `boolean` / `quantity` inputs survive (a legacy `single_select` is dropped);
 *   • malformed rows are dropped without crashing the rest of the config;
 *   • pricing effect channels (time/fixed/percent) and the internal admin `name`
 *     can NEVER appear on a parsed public add-on;
 *   • existing service / question / plan parsing is left untouched.
 *
 * The broader config-parsing contract is covered in publicCalculatorClient.test.ts.
 */

/** A well-formed boolean add-on exactly as the Edge Function emits it on the wire. */
function booleanAddonWire(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    addonKey: "dog",
    publicLabel: "Hund i hemmet",
    description: "Vi anpassar städningen.",
    inputType: "boolean",
    booleanDefault: false,
    quantityMin: 0,
    quantityMax: null,
    quantityStep: 1,
    quantityDefault: 0,
    required: false,
    sortOrder: 10,
    ...overrides,
  };
}

/** A well-formed quantity add-on exactly as the Edge Function emits it on the wire. */
function quantityAddonWire(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    addonKey: "bathrooms",
    publicLabel: "Antal badrum",
    description: null,
    inputType: "quantity",
    booleanDefault: false,
    quantityMin: 1,
    quantityMax: 6,
    quantityStep: 1,
    quantityDefault: 1,
    required: true,
    sortOrder: 20,
    ...overrides,
  };
}

/** Builds an ok config payload carrying a single home_cleaning service with `addons`. */
function configWithAddons(addons: unknown): unknown {
  return {
    ok: true,
    enabled: true,
    services: [
      {
        serviceKey: "home_cleaning",
        displayName: "Hemstädning",
        enabled: true,
        questions: [],
        addons,
      },
    ],
  };
}

/** The canonical public add-on key set — nothing more may appear on a parsed add-on. */
const PUBLIC_ADDON_KEYS = [
  "addonKey",
  "booleanDefault",
  "description",
  "inputType",
  "publicLabel",
  "quantityDefault",
  "quantityMax",
  "quantityMin",
  "quantityStep",
  "required",
  "sortOrder",
] as const;

/** Pricing effect channels + internal name that must NEVER reach the public add-on DTO. */
const FORBIDDEN_ADDON_KEYS = [
  "effectTimeMinutes",
  "effect_time_minutes",
  "effectFixedExclVat",
  "effect_fixed_excl_vat",
  "effectPercent",
  "effect_percent",
  "name",
  "active",
  "public_visible",
  "deleted_at",
  "companyId",
  "company_id",
] as const;

describe("normalizePublicConfigResponse — generic add-ons (V2-E3-2)", () => {
  it("parses a service's addons array (boolean + quantity) preserving order", () => {
    const config = normalizePublicConfigResponse(
      configWithAddons([booleanAddonWire(), quantityAddonWire()]),
    );

    const addons = config?.services[0]?.addons;
    expect(addons).toHaveLength(2);
    expect(addons?.[0]?.addonKey).toBe("dog");
    expect(addons?.[1]?.addonKey).toBe("bathrooms");
  });

  it("defaults a missing OR non-array addons field to [] (never throws)", () => {
    const missing = normalizePublicConfigResponse({
      ok: true,
      enabled: true,
      services: [{ serviceKey: "home_cleaning", displayName: "Hemstädning", enabled: true, questions: [] }],
    });
    expect(missing?.services[0]?.addons).toEqual([]);

    const corrupt = normalizePublicConfigResponse(configWithAddons("not-an-array"));
    expect(corrupt?.services[0]?.addons).toEqual([]);
  });

  it("parses a boolean add-on into the exact public shape", () => {
    const config = normalizePublicConfigResponse(configWithAddons([booleanAddonWire()]));
    const addon = config?.services[0]?.addons[0] as PublicAddon;

    expect(addon).toEqual({
      addonKey: "dog",
      publicLabel: "Hund i hemmet",
      description: "Vi anpassar städningen.",
      inputType: "boolean",
      booleanDefault: false,
      quantityMin: 0,
      quantityMax: null,
      quantityStep: 1,
      quantityDefault: 0,
      required: false,
      sortOrder: 10,
    });
  });

  it("parses a quantity add-on with its min/max/step/default and required flag", () => {
    const config = normalizePublicConfigResponse(configWithAddons([quantityAddonWire()]));
    const addon = config?.services[0]?.addons[0] as PublicAddon;

    expect(addon.inputType).toBe("quantity");
    expect(addon.quantityMin).toBe(1);
    expect(addon.quantityMax).toBe(6);
    expect(addon.quantityStep).toBe(1);
    expect(addon.quantityDefault).toBe(1);
    expect(addon.required).toBe(true);
  });

  it("ignores unknown forward-compatible wire fields but keeps the add-on", () => {
    const config = normalizePublicConfigResponse(
      configWithAddons([booleanAddonWire({ futureFlag: true, someNewField: "x" })]),
    );
    const addon = config?.services[0]?.addons[0];

    expect(addon?.addonKey).toBe("dog");
    expect(Object.keys(addon as object).sort()).toEqual([...PUBLIC_ADDON_KEYS]);
    expect("futureFlag" in (addon as object)).toBe(false);
  });

  it("NEVER exposes pricing effect channels or the internal name on a parsed add-on", () => {
    const leaky = booleanAddonWire({
      effectTimeMinutes: 30,
      effect_time_minutes: 30,
      effectFixedExclVat: 199,
      effect_fixed_excl_vat: 199,
      effectPercent: 12,
      effect_percent: 12,
      name: "INTERNAL dog add-on",
      active: true,
      public_visible: true,
      deleted_at: null,
      company_id: "co_1",
    });
    const config = normalizePublicConfigResponse(configWithAddons([leaky, quantityAddonWire()]));
    const addons = config?.services[0]?.addons ?? [];

    expect(addons).toHaveLength(2);
    for (const addon of addons) {
      for (const forbidden of FORBIDDEN_ADDON_KEYS) {
        expect(forbidden in (addon as object)).toBe(false);
      }
      expect(Object.keys(addon as object).sort()).toEqual([...PUBLIC_ADDON_KEYS]);
    }
  });

  it("drops add-ons whose inputType is not boolean/quantity (e.g. legacy single_select)", () => {
    const config = normalizePublicConfigResponse(
      configWithAddons([
        booleanAddonWire(),
        booleanAddonWire({ addonKey: "legacy_multi", inputType: "single_select" }),
        booleanAddonWire({ addonKey: "legacy_text", inputType: "text" }),
        quantityAddonWire(),
      ]),
    );
    const keys = (config?.services[0]?.addons ?? []).map((a) => a.addonKey);

    expect(keys).toEqual(["dog", "bathrooms"]);
    expect(keys).not.toContain("legacy_multi");
    expect(keys).not.toContain("legacy_text");
  });

  it("drops malformed add-ons (missing key / not an object) without losing the good ones", () => {
    const config = normalizePublicConfigResponse(
      configWithAddons([
        booleanAddonWire(),
        booleanAddonWire({ addonKey: "" }), // empty key → dropped
        { publicLabel: "No key at all", inputType: "boolean" }, // missing key → dropped
        "not-an-object",
        null,
        quantityAddonWire(),
      ]),
    );
    const addons = config?.services[0]?.addons ?? [];

    expect(addons.map((a) => a.addonKey)).toEqual(["dog", "bathrooms"]);
  });

  it("coerces mistyped/non-finite numeric + boolean fields to safe defaults (never drops the add-on)", () => {
    const config = normalizePublicConfigResponse(
      configWithAddons([
        quantityAddonWire({
          quantityMin: "oops",
          quantityMax: "nope",
          quantityStep: undefined,
          quantityDefault: Number.NaN,
          booleanDefault: "yes",
          required: 1,
          sortOrder: "5",
        }),
      ]),
    );
    const addon = config?.services[0]?.addons[0];

    expect(addon?.addonKey).toBe("bathrooms");
    expect(addon?.quantityMin).toBe(0); // string → default 0
    expect(addon?.quantityMax).toBeNull(); // string → null
    expect(addon?.quantityStep).toBe(1); // undefined → default 1
    expect(addon?.quantityDefault).toBe(0); // NaN → default 0 (finite guard)
    expect(addon?.booleanDefault).toBe(false); // non-bool → default false
    expect(addon?.required).toBe(false); // non-bool → default false
    expect(addon?.sortOrder).toBe(0); // string → default 0
  });

  it("leaves a service with no add-ons at [] and keeps its question parsing intact (scoping)", () => {
    const config = normalizePublicConfigResponse({
      ok: true,
      enabled: true,
      services: [
        {
          serviceKey: "office_cleaning",
          displayName: "Kontorsstädning",
          enabled: true,
          questions: [{ questionKey: "sqm", label: "Yta", inputType: "number", required: true }],
          // no addons field at all
        },
        {
          serviceKey: "home_cleaning",
          displayName: "Hemstädning",
          enabled: true,
          questions: [],
          addons: [booleanAddonWire()],
        },
      ],
    });

    // Service without add-ons → [], and its existing question parsing is untouched.
    expect(config?.services[0]?.addons).toEqual([]);
    expect(config?.services[0]?.questions).toHaveLength(1);
    expect(config?.services[0]?.questions[0]?.questionKey).toBe("sqm");
    // Add-ons stay scoped to the service that declared them.
    expect(config?.services[1]?.addons).toHaveLength(1);
    expect(config?.services[1]?.addons[0]?.addonKey).toBe("dog");
  });
});
