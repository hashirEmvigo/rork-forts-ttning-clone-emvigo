import { describe, expect, it } from "vitest";

import {
  DISPLAY_ROUNDING_FALLBACK,
  resolveDisplayRoundingIncrement,
  roundPublicDisplayPrice,
  roundPublicDisplayPriceRange,
} from "./publicPriceDisplayRounding";

describe("publicPriceDisplayRounding", () => {
  describe("resolveDisplayRoundingIncrement", () => {
    it("keeps a positive finite increment", () => {
      expect(resolveDisplayRoundingIncrement(10)).toBe(10);
      expect(resolveDisplayRoundingIncrement(100)).toBe(100);
      expect(resolveDisplayRoundingIncrement(50)).toBe(50);
    });

    it("falls back to whole krona for null/undefined/0/negative/NaN", () => {
      expect(resolveDisplayRoundingIncrement(null)).toBe(DISPLAY_ROUNDING_FALLBACK);
      expect(resolveDisplayRoundingIncrement(undefined)).toBe(DISPLAY_ROUNDING_FALLBACK);
      expect(resolveDisplayRoundingIncrement(0)).toBe(DISPLAY_ROUNDING_FALLBACK);
      expect(resolveDisplayRoundingIncrement(-10)).toBe(DISPLAY_ROUNDING_FALLBACK);
      expect(resolveDisplayRoundingIncrement(Number.NaN)).toBe(DISPLAY_ROUNDING_FALLBACK);
      expect(DISPLAY_ROUNDING_FALLBACK).toBe(1);
    });
  });

  describe("roundPublicDisplayPrice", () => {
    it("rounds to the nearest configured interval (the canonical case)", () => {
      expect(roundPublicDisplayPrice(469, 10)).toBe(470);
      expect(roundPublicDisplayPrice(563, 10)).toBe(560);
      expect(roundPublicDisplayPrice(922, 10)).toBe(920);
      expect(roundPublicDisplayPrice(1125, 10)).toBe(1130); // half-up
      expect(roundPublicDisplayPrice(1124, 10)).toBe(1120);
    });

    it("rounds to nearest 100 when configured", () => {
      expect(roundPublicDisplayPrice(2769, 100)).toBe(2800);
      expect(roundPublicDisplayPrice(3381, 100)).toBe(3400);
    });

    it("falls back to whole-krona rounding when no increment is configured", () => {
      expect(roundPublicDisplayPrice(469.4, null)).toBe(469);
      expect(roundPublicDisplayPrice(469.6, 0)).toBe(470);
    });

    it("never returns NaN for bad input", () => {
      expect(roundPublicDisplayPrice(Number.NaN, 10)).toBe(0);
    });
  });

  describe("roundPublicDisplayPriceRange", () => {
    it("rounds both endpoints (469–563 @10 → 470–560)", () => {
      expect(roundPublicDisplayPriceRange(469, 563, 10)).toEqual({ min: 470, max: 560 });
    });
  });
});
