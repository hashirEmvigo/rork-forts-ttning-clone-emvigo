/**
 * Public price DISPLAY rounding — the single, explicit layer that turns raw
 * customer-facing amounts into clean, consistent figures for the public price
 * calculator (Slice 12Q follow-up rebuild).
 *
 * Why a dedicated module: rounding had been re-implemented ad hoc in several
 * places, and one path could round while another stayed raw (e.g. the top price
 * vs. the "Pris per fyra veckors period" row). Centralising it here guarantees
 * every customer-facing price in the result card runs through the SAME helper,
 * applied as the FINAL display step — i.e. after the VAT/RUT display mode and the
 * price-range margins have already been chosen.
 *
 * This is DISPLAY rounding only. It never feeds back into the pricing engine
 * formulas, quote persistence, or any server-authoritative figure. A few kronor
 * up or down does not matter; clean, consistent public prices do.
 */

/**
 * The explicit fallback increment used when no configured interval is available.
 * Rounding to the nearest whole krona keeps the displayed value tidy without
 * inventing a coarser interval the admin never configured.
 */
export const DISPLAY_ROUNDING_FALLBACK = 1;

/**
 * Resolves the effective display rounding increment. A positive, finite number
 * is used as-is; anything else (null, undefined, 0, negative, NaN) falls back to
 * {@link DISPLAY_ROUNDING_FALLBACK} (nearest whole krona). Exposed so the UI/tests
 * can assert the exact increment that will be applied for a given service.
 */
export function resolveDisplayRoundingIncrement(increment: number | null | undefined): number {
  if (typeof increment === "number" && Number.isFinite(increment) && increment > 0) {
    return increment;
  }
  return DISPLAY_ROUNDING_FALLBACK;
}

/**
 * Rounds a single customer-facing amount to the NEAREST configured interval.
 * Uses half-up rounding via Math.round on the increment grid, so 469→470 and
 * 563→560 at increment 10. Non-finite inputs return 0 (never NaN in the UI).
 */
export function roundPublicDisplayPrice(value: number, increment: number | null | undefined): number {
  if (!Number.isFinite(value)) return 0;
  const inc = resolveDisplayRoundingIncrement(increment);
  return Math.round(value / inc) * inc;
}

/**
 * Rounds both endpoints of a price range to the configured interval and returns
 * them as numbers. The caller formats them (currency/locale) so this stays a pure
 * numeric helper that is trivial to unit-test (e.g. 469–563 @10 → 470–560).
 */
export function roundPublicDisplayPriceRange(
  min: number,
  max: number,
  increment: number | null | undefined,
): { min: number; max: number } {
  return {
    min: roundPublicDisplayPrice(min, increment),
    max: roundPublicDisplayPrice(max, increment),
  };
}
