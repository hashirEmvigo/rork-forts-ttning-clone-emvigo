import { describe, expect, it } from "vitest";

import { applyDisplayMode, computeDisplayPriceRange } from "./displayPricing";
import type { DisplayPricingMode } from "./types";

const INCL_BEFORE: DisplayPricingMode = { vat: "incl", rut: "before" };
const INCL_AFTER: DisplayPricingMode = { vat: "incl", rut: "after" };
const EXCL_BEFORE: DisplayPricingMode = { vat: "excl", rut: "before" };
const EXCL_AFTER: DisplayPricingMode = { vat: "excl", rut: "after" };

describe("applyDisplayMode", () => {
  it("adds VAT for incl mode and leaves excl untouched (before RUT)", () => {
    expect(
      applyDisplayMode({ exclVat: 1000, vatRatePercent: 25, rutEligible: false, rutPercent: 50, mode: INCL_BEFORE }),
    ).toBe(1250);
    expect(
      applyDisplayMode({ exclVat: 1000, vatRatePercent: 25, rutEligible: false, rutPercent: 50, mode: EXCL_BEFORE }),
    ).toBe(1000);
  });

  it("subtracts the gross RUT deduction for incl + after RUT when eligible", () => {
    // inclVat = 1250, deduction = 1250 * 0.5 = 625 → 625.
    expect(
      applyDisplayMode({ exclVat: 1000, vatRatePercent: 25, rutEligible: true, rutPercent: 50, mode: INCL_AFTER }),
    ).toBe(625);
  });

  it("ignores after-RUT entirely when the service is not RUT-eligible", () => {
    expect(
      applyDisplayMode({ exclVat: 1000, vatRatePercent: 25, rutEligible: false, rutPercent: 50, mode: INCL_AFTER }),
    ).toBe(1250);
  });

  it("handles excl + after RUT deterministically (deduction from the gross amount)", () => {
    // base = exclVat 1000; deduction = inclVat(1250) * 0.5 = 625 → 375.
    expect(
      applyDisplayMode({ exclVat: 1000, vatRatePercent: 25, rutEligible: true, rutPercent: 50, mode: EXCL_AFTER }),
    ).toBe(375);
  });

  it("never returns NaN/negative for bad input", () => {
    expect(applyDisplayMode({ exclVat: Number.NaN, vatRatePercent: 25, rutEligible: true, rutPercent: 50, mode: INCL_AFTER })).toBe(0);
    expect(
      applyDisplayMode({ exclVat: 10, vatRatePercent: 0, rutEligible: true, rutPercent: 500, mode: INCL_AFTER }),
    ).toBe(0); // clamped at 0, not negative
  });
});

describe("computeDisplayPriceRange", () => {
  it("applies mode → margins → rounding LAST (interval 100)", () => {
    // raw 1000, incl VAT 25% → point 1250; margins ±10% → 1125 / 1375.
    // round100: point 1300, min 1100, max 1400.
    const r = computeDisplayPriceRange({
      rawPriceExclVat: 1000,
      lowerMarginPercent: 10,
      upperMarginPercent: 10,
      vatRatePercent: 25,
      rutEligible: false,
      rutPercent: 50,
      mode: INCL_BEFORE,
      roundingInterval: 100,
    });
    expect(r).toEqual({ point: 1300, min: 1100, max: 1400, effectiveRoundingInterval: 100 });
  });

  it("rounds the canonical 469–563 range to 470–560 at interval 10", () => {
    // raw 516 (no VAT/RUT), symmetric margin 47/516 → endpoints 469 / 563.
    const margin = (47 / 516) * 100;
    const r = computeDisplayPriceRange({
      rawPriceExclVat: 516,
      lowerMarginPercent: margin,
      upperMarginPercent: margin,
      vatRatePercent: 0,
      rutEligible: false,
      rutPercent: 50,
      mode: EXCL_BEFORE,
      roundingInterval: 10,
    });
    expect(r.min).toBe(470);
    expect(r.max).toBe(560);
    expect(r.point).toBe(520); // 516 → 520
  });

  it("rounds the 2769–3381 range to 2800–3400 at interval 100", () => {
    const margin = (306 / 3075) * 100; // 3075 ± 306 → 2769 / 3381
    const r = computeDisplayPriceRange({
      rawPriceExclVat: 3075,
      lowerMarginPercent: margin,
      upperMarginPercent: margin,
      vatRatePercent: 0,
      rutEligible: false,
      rutPercent: 50,
      mode: EXCL_BEFORE,
      roundingInterval: 100,
    });
    expect(r.min).toBe(2800);
    expect(r.max).toBe(3400);
  });

  it("VAT toggle changes the base BEFORE rounding", () => {
    const base = {
      rawPriceExclVat: 1000,
      lowerMarginPercent: 0,
      upperMarginPercent: 0,
      vatRatePercent: 25,
      rutEligible: false,
      rutPercent: 50,
      roundingInterval: 100,
    } as const;
    expect(computeDisplayPriceRange({ ...base, mode: EXCL_BEFORE }).point).toBe(1000);
    expect(computeDisplayPriceRange({ ...base, mode: INCL_BEFORE }).point).toBe(1300); // 1250 → 1300
  });

  it("RUT toggle changes the base BEFORE rounding", () => {
    const base = {
      rawPriceExclVat: 1000,
      lowerMarginPercent: 0,
      upperMarginPercent: 0,
      vatRatePercent: 0,
      rutEligible: true,
      rutPercent: 50,
      roundingInterval: 100,
    } as const;
    expect(computeDisplayPriceRange({ ...base, mode: EXCL_BEFORE }).point).toBe(1000);
    expect(computeDisplayPriceRange({ ...base, mode: EXCL_AFTER }).point).toBe(500); // 1000 − 500
  });

  it("falls back to whole-SEK rounding when no interval is configured", () => {
    const r = computeDisplayPriceRange({
      rawPriceExclVat: 469.4,
      lowerMarginPercent: 0,
      upperMarginPercent: 0,
      vatRatePercent: 0,
      rutEligible: false,
      rutPercent: 50,
      mode: EXCL_BEFORE,
      roundingInterval: null,
    });
    expect(r.point).toBe(469);
    expect(r.effectiveRoundingInterval).toBe(1);
  });
});
