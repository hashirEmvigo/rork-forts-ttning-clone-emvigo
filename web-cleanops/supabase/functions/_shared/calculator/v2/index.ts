/**
 * ⚠️  FAITHFUL DENO MIRROR of `src/lib/calculator/v2/index.ts`. Kept
 *     behaviour-identical by `src/lib/calculator/v2/parity.test.ts` (Slice V2-E1).
 *     The ONLY intentional differences vs. the canonical source are the import
 *     specifiers below (explicit `.ts` extensions, required by Deno). Any change to
 *     the canonical module must be mirrored here, or the parity test fails.
 *
 * Calculator V2 — shared (Deno) barrel.
 *
 * Single import surface for the V2 core: canonical types, the display-pricing
 * layer, plan selection, and the shared rounding helpers (re-exported from the
 * sibling `publicPriceDisplayRounding` mirror so there is exactly one rounding
 * implementation across the Edge shared layer).
 */

export * from "./types.ts";
export * from "./pricingModel.ts";
export * from "./displayPricing.ts";
export * from "./planSelection.ts";
export * from "./engine.ts";
export * from "./addons.ts";
export * from "./configMapping.ts";
export {
  DISPLAY_ROUNDING_FALLBACK,
  resolveDisplayRoundingIncrement,
  roundPublicDisplayPrice,
  roundPublicDisplayPriceRange,
} from "../publicPriceDisplayRounding.ts";
