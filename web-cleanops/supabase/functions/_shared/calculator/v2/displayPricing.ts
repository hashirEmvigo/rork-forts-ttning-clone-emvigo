/**
 * ⚠️  FAITHFUL DENO MIRROR of `src/lib/calculator/v2/displayPricing.ts`. Kept
 *     behaviour-identical by `src/lib/calculator/v2/parity.test.ts` (Slice V2-E1).
 *     The ONLY intentional differences vs. the canonical source are the import
 *     specifiers below (explicit `.ts` extensions, required by Deno). Any change to
 *     the canonical module must be mirrored here, or the parity test fails.
 *
 * Calculator V2 — public display-pricing layer.
 *
 * This is the SINGLE place that turns a raw excl-VAT price into the rounded,
 * customer-facing figures shown on the public calculator. It enforces the
 * required pipeline order (per the approved V2 strategy):
 *
 *   1. Start from the raw price (excl VAT).
 *   2. Select the active display mode (incl/excl VAT, before/after RUT).
 *   3. Apply lower/upper price-range margins.
 *   4. Round the final customer-facing values to the configured interval — LAST.
 *
 * Every visible price row (large top price, "Pris per tillfälle", "Pris per
 * fyra veckors period", etc.) must be produced through {@link computeDisplayPriceRange}
 * so no row can ever drift between raw and rounded values. The fix that makes
 * home/office round correctly is that rounding happens AFTER VAT/RUT — the legacy
 * engine rounded the excl-VAT subtotal first, so VAT/RUT then shifted it off the
 * rounding grid.
 *
 * Rounding itself is delegated to the shared `publicPriceDisplayRounding` module
 * so there is exactly one rounding implementation across the app.
 */

import {
  resolveDisplayRoundingIncrement,
  roundPublicDisplayPrice,
} from "../publicPriceDisplayRounding.ts";
import type { DisplayPriceRangeV2, DisplayPricingMode } from "./types.ts";

/** Inputs for the VAT/RUT display-mode transform (step 2 of the pipeline). */
export interface ApplyDisplayModeInput {
  /** The raw price excluding VAT. */
  exclVat: number;
  /** VAT rate percent (e.g. 25). */
  vatRatePercent: number;
  /** Whether the service is RUT-eligible (gates the after-RUT branch entirely). */
  rutEligible: boolean;
  /** RUT deduction percent (e.g. 50). */
  rutPercent: number;
  /** The selected VAT + RUT display mode. */
  mode: DisplayPricingMode;
}

/**
 * Applies the VAT/RUT display mode to a single excl-VAT amount and returns the
 * customer-facing value (still UNROUNDED — rounding is the final pipeline step).
 *
 * Semantics (faithful to the legacy engine's customer-price math):
 *   • VAT: incl → `exclVat × (1 + vat/100)`; excl → `exclVat`.
 *   • RUT: only when the service is eligible AND the mode is "after". The RUT
 *     deduction is the legal amount computed on the VAT-inclusive (gross) price
 *     (`inclVat × rut/100`) and subtracted from whichever base is shown, floored
 *     at 0. The "incl VAT + after RUT" combination yields the standard
 *     customer-facing after-RUT price; "excl VAT + after RUT" is an unusual combo
 *     but is handled deterministically rather than throwing.
 */
export function applyDisplayMode(input: ApplyDisplayModeInput): number {
  const { exclVat, vatRatePercent, rutEligible, rutPercent, mode } = input;
  if (!Number.isFinite(exclVat)) return 0;

  const vat = Number.isFinite(vatRatePercent) ? vatRatePercent : 0;
  const inclVat = exclVat * (1 + vat / 100);
  const base = mode.vat === "incl" ? inclVat : exclVat;

  if (rutEligible && mode.rut === "after") {
    const pct = Number.isFinite(rutPercent) ? rutPercent : 0;
    const deduction = inclVat * (pct / 100);
    return Math.max(0, base - deduction);
  }
  return base;
}

/** Inputs for the full display pipeline that yields a rounded price range. */
export interface DisplayPriceRangeInput {
  /** Raw single-point price excluding VAT (engine output). */
  rawPriceExclVat: number;
  /** Lower margin percent (e.g. 5 → low end is −5%). */
  lowerMarginPercent: number;
  /** Upper margin percent (e.g. 10 → high end is +10%). */
  upperMarginPercent: number;
  /** VAT rate percent. */
  vatRatePercent: number;
  /** Whether the service is RUT-eligible. */
  rutEligible: boolean;
  /** RUT deduction percent. */
  rutPercent: number;
  /** Selected VAT + RUT display mode. */
  mode: DisplayPricingMode;
  /** Configured display rounding interval (kr); null → fallback to whole SEK. */
  roundingInterval: number | null;
}

/**
 * Runs the full display pipeline for ONE row and returns the rounded point + range.
 *
 * Margins are applied to the post-VAT/RUT display value, then BOTH endpoints and
 * the point are rounded with the SAME interval as the final step. Because VAT and
 * RUT are linear scalings of the excl-VAT amount, applying the percentage margins
 * after the mode transform yields the same proportional range as before — the
 * essential change vs. the legacy engine is that rounding is genuinely last.
 */
export function computeDisplayPriceRange(input: DisplayPriceRangeInput): DisplayPriceRangeV2 {
  const point = applyDisplayMode({
    exclVat: input.rawPriceExclVat,
    vatRatePercent: input.vatRatePercent,
    rutEligible: input.rutEligible,
    rutPercent: input.rutPercent,
    mode: input.mode,
  });

  const lower = Number.isFinite(input.lowerMarginPercent) ? input.lowerMarginPercent : 0;
  const upper = Number.isFinite(input.upperMarginPercent) ? input.upperMarginPercent : 0;
  const minDisplay = point * (1 - lower / 100);
  const maxDisplay = point * (1 + upper / 100);

  return {
    point: roundPublicDisplayPrice(point, input.roundingInterval),
    min: roundPublicDisplayPrice(minDisplay, input.roundingInterval),
    max: roundPublicDisplayPrice(maxDisplay, input.roundingInterval),
    effectiveRoundingInterval: resolveDisplayRoundingIncrement(input.roundingInterval),
  };
}
