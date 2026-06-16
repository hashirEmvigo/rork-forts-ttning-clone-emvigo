import { describe, expect, it } from "vitest";

import { resolveAddonEffects } from "./addons";
import type { AddonSelectionsV2, CalculatorAddonConfigV2 } from "./types";

/** Builds an add-on definition with safe defaults (boolean, no effects, active). */
function addon(
  overrides: Partial<CalculatorAddonConfigV2> & Pick<CalculatorAddonConfigV2, "addonKey">,
): CalculatorAddonConfigV2 {
  return {
    name: overrides.addonKey,
    publicLabel: overrides.addonKey,
    description: null,
    inputType: "boolean",
    booleanDefault: false,
    quantityMin: 0,
    quantityMax: null,
    quantityStep: 1,
    quantityDefault: 0,
    effectTimeMinutes: 0,
    effectFixedExclVat: 0,
    effectPercent: 0,
    active: true,
    publicVisible: true,
    required: false,
    sortOrder: 0,
    ...overrides,
  };
}

const boolAddon = (overrides: Partial<CalculatorAddonConfigV2> & Pick<CalculatorAddonConfigV2, "addonKey">) =>
  addon({ inputType: "boolean", ...overrides });

const qtyAddon = (overrides: Partial<CalculatorAddonConfigV2> & Pick<CalculatorAddonConfigV2, "addonKey">) =>
  addon({ inputType: "quantity", ...overrides });

describe("resolveAddonEffects — boolean inputs", () => {
  it("true → multiplier 1 and applies each effect channel once", () => {
    const dog = boolAddon({ addonKey: "dog", effectTimeMinutes: 20, effectFixedExclVat: 50, effectPercent: 5 });
    const res = resolveAddonEffects([dog], { dog: true });

    expect(res.addonMinutes).toBe(20);
    expect(res.addonFixedExclVat).toBe(50);
    expect(res.addonPercent).toBe(5);
    expect(res.lines).toHaveLength(1);
    expect(res.lines[0]).toEqual({ addonKey: "dog", multiplier: 1, timeMinutes: 20, fixedExclVat: 50, percent: 5 });
  });

  it("false → multiplier 0, no effect and no line", () => {
    const dog = boolAddon({ addonKey: "dog", effectTimeMinutes: 20, effectFixedExclVat: 50, effectPercent: 5 });
    const res = resolveAddonEffects([dog], { dog: false });

    expect(res.addonMinutes).toBe(0);
    expect(res.addonFixedExclVat).toBe(0);
    expect(res.addonPercent).toBe(0);
    expect(res.lines).toHaveLength(0);
  });

  it("missing answer → uses booleanDefault", () => {
    const onByDefault = boolAddon({ addonKey: "dog", booleanDefault: true, effectTimeMinutes: 20 });
    const offByDefault = boolAddon({ addonKey: "cat", booleanDefault: false, effectTimeMinutes: 20 });

    expect(resolveAddonEffects([onByDefault], {}).addonMinutes).toBe(20);
    expect(resolveAddonEffects([offByDefault], {}).addonMinutes).toBe(0);
  });
});

describe("resolveAddonEffects — quantity inputs", () => {
  it("multiplier equals the entered quantity", () => {
    const sprojs = qtyAddon({ addonKey: "sprojs", effectTimeMinutes: 3 });
    const divisible = qtyAddon({ addonKey: "divisible_windows", effectFixedExclVat: 40 });

    expect(resolveAddonEffects([sprojs], { sprojs: 12 }).addonMinutes).toBe(36); // 12 × 3
    expect(resolveAddonEffects([divisible], { divisible_windows: 5 }).addonFixedExclVat).toBe(200); // 5 × 40
  });

  it("clamps below min up to min and above max down to max", () => {
    const bathrooms = qtyAddon({ addonKey: "bathrooms", quantityMin: 1, quantityMax: 5, effectTimeMinutes: 15 });

    expect(resolveAddonEffects([bathrooms], { bathrooms: 0 }).addonMinutes).toBe(15); // clamped up to 1 → 15
    expect(resolveAddonEffects([bathrooms], { bathrooms: 9 }).addonMinutes).toBe(75); // clamped down to 5 → 75
    expect(resolveAddonEffects([bathrooms], { bathrooms: 3 }).addonMinutes).toBe(45); // in range → 3 × 15
  });

  it("snaps to the nearest step (relative to min) consistently", () => {
    const stepped = qtyAddon({ addonKey: "panes", quantityMin: 0, quantityMax: 20, quantityStep: 5, effectFixedExclVat: 10 });

    // 12 → nearest multiple of 5 is 10 → 10 × 10 = 100.
    expect(resolveAddonEffects([stepped], { panes: 12 }).addonFixedExclVat).toBe(100);
    // 13 → nearest multiple of 5 is 15 → 15 × 10 = 150.
    expect(resolveAddonEffects([stepped], { panes: 13 }).addonFixedExclVat).toBe(150);

    const offsetStep = qtyAddon({ addonKey: "pairs", quantityMin: 2, quantityStep: 2, effectFixedExclVat: 1 });
    // min 2, step 2 → grid 2,4,6…; 5 snaps to 6.
    expect(resolveAddonEffects([offsetStep], { pairs: 5 }).addonFixedExclVat).toBe(6);
  });

  it("missing quantity answer → uses quantityDefault", () => {
    const withDefault = qtyAddon({ addonKey: "bathrooms", quantityDefault: 2, effectTimeMinutes: 15 });
    expect(resolveAddonEffects([withDefault], {}).addonMinutes).toBe(30); // 2 × 15
  });

  it("never produces a negative multiplier even with a negative min", () => {
    const odd = qtyAddon({ addonKey: "weird", quantityMin: -10, effectFixedExclVat: 5 });
    // min floored at 0; a missing/zero answer → 0 → no effect.
    expect(resolveAddonEffects([odd], { weird: -3 }).addonFixedExclVat).toBe(0);
  });
});

describe("resolveAddonEffects — effect aggregation", () => {
  it("aggregates time + fixed + percent across multiple add-ons", () => {
    const addons = [
      boolAddon({ addonKey: "dog", effectTimeMinutes: 20 }),
      qtyAddon({ addonKey: "bathrooms", effectTimeMinutes: 15 }),
      boolAddon({ addonKey: "oven", effectFixedExclVat: 250 }),
      boolAddon({ addonKey: "dirty", effectPercent: 15 }),
    ];
    const res = resolveAddonEffects(addons, { dog: true, bathrooms: 2, oven: true, dirty: true });

    expect(res.addonMinutes).toBe(50); // 20 + 2×15
    expect(res.addonFixedExclVat).toBe(250);
    expect(res.addonPercent).toBe(15);
    expect(res.lines).toHaveLength(4);
  });

  it("supports a negative fixed effect (discount)", () => {
    const discount = boolAddon({ addonKey: "voucher", effectFixedExclVat: -100 });
    expect(resolveAddonEffects([discount], { voucher: true }).addonFixedExclVat).toBe(-100);
  });

  it("percent effects are ADDITIVE: +15 and −10 aggregate to +5 (never compounded)", () => {
    const addons = [
      boolAddon({ addonKey: "dirty", effectPercent: 15 }),
      boolAddon({ addonKey: "campaign", effectPercent: -10 }),
    ];
    expect(resolveAddonEffects(addons, { dirty: true, campaign: true }).addonPercent).toBe(5);
  });
});

describe("resolveAddonEffects — safety + inclusion", () => {
  it("ignores inactive add-ons entirely", () => {
    const inactive = boolAddon({ addonKey: "dog", active: false, effectTimeMinutes: 20, effectFixedExclVat: 50 });
    const res = resolveAddonEffects([inactive], { dog: true });

    expect(res.addonMinutes).toBe(0);
    expect(res.addonFixedExclVat).toBe(0);
    expect(res.lines).toHaveLength(0);
  });

  it("includes a non-public add-on in the math (publicVisible does not gate calculation)", () => {
    const internal = boolAddon({ addonKey: "internal_fee", publicVisible: false, effectFixedExclVat: 75 });
    expect(resolveAddonEffects([internal], { internal_fee: true }).addonFixedExclVat).toBe(75);
  });

  it("ignores unknown selection keys safely", () => {
    const dog = boolAddon({ addonKey: "dog", effectTimeMinutes: 20 });
    const res = resolveAddonEffects([dog], { dog: true, unknown_addon: 99, another: true });

    expect(res.addonMinutes).toBe(20);
    expect(res.lines).toHaveLength(1);
  });

  it("falls back safely on invalid input types without crashing", () => {
    const dog = boolAddon({ addonKey: "dog", booleanDefault: false, effectTimeMinutes: 20 });
    const bathrooms = qtyAddon({ addonKey: "bathrooms", quantityDefault: 1, effectTimeMinutes: 15 });
    // Simulate bad client data: a string for a boolean, a string for a quantity.
    const bad = { dog: "yes", bathrooms: "lots" } as unknown as AddonSelectionsV2;

    const res = resolveAddonEffects([dog, bathrooms], bad);
    expect(res.addonMinutes).toBe(15); // dog → default false (0); bathrooms → default 1 × 15
    expect(res.lines.map((l) => l.addonKey)).toEqual(["bathrooms"]);
  });

  it("returns zeroed effects for empty/undefined inputs", () => {
    const empty = resolveAddonEffects(undefined, undefined);
    expect(empty).toEqual({ addonMinutes: 0, addonFixedExclVat: 0, addonPercent: 0, lines: [] });
    expect(resolveAddonEffects([], { dog: true })).toEqual({
      addonMinutes: 0,
      addonFixedExclVat: 0,
      addonPercent: 0,
      lines: [],
    });
  });
});
