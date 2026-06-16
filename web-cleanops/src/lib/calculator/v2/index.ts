/**
 * Calculator V2 — public barrel.
 *
 * Single import surface for the V2 core: canonical types, the display-pricing
 * layer, plan selection, and the shared rounding helpers (re-exported from the
 * existing `publicPriceDisplayRounding` module so there is exactly one rounding
 * implementation across the app).
 */

export * from "./types";
export * from "./pricingModel";
export * from "./displayPricing";
export * from "./planSelection";
export * from "./engine";
export * from "./addons";
export * from "./configMapping";
export {
  DISPLAY_ROUNDING_FALLBACK,
  resolveDisplayRoundingIncrement,
  roundPublicDisplayPrice,
  roundPublicDisplayPriceRange,
} from "../publicPriceDisplayRounding";
