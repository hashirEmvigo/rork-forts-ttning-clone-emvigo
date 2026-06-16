/**
 * Calculator V2 — generic pricing-model taxonomy + resolver (Slice GPM-1).
 *
 * Locks the forward-looking, ADMIN-CONFIGURABLE pricing-model contract so the
 * calculator can stop branching on hardcoded service keys. A service's PRICING
 * behaviour is driven by its GENERIC pricing model — never by `serviceKey`, which
 * now only carries identity / routing / rollout-guard / presentation meaning.
 *
 * Behaviour-preserving (GPM-1): this module ONLY adds types + pure functions. It
 * maps the existing legacy, service-named pricing models onto the new generic
 * models so current rows keep working unchanged, and it never rewrites DB rows.
 *
 * Engine support today: the V2 engine fully implements `hourly_by_area` and
 * `sqm_fixed`. The remaining generic models (`unit_based`, `fixed_package`,
 * `manual_quote`) are RESERVED contracts — {@link pricingBasisForGenericModel}
 * returns null for them so callers flag them explicitly instead of silently
 * pricing them as hourly.
 */

import type { PricingBasisV2 } from "./types";

/** The generic, admin-selectable pricing models V2 is built around. */
export const GENERIC_PRICING_MODELS = [
  "hourly_by_area",
  "sqm_fixed",
  "unit_based",
  "fixed_package",
  "manual_quote",
] as const;
export type GenericPricingModel = (typeof GENERIC_PRICING_MODELS)[number];

/**
 * The legacy, service-named pricing models still present on live rows. Both
 * historical deep-cleaning spellings are listed (`deep_cleaning_area_based` from
 * the GPM-1 brief and `deep_cleaning_area_addons` from the live admin catalogue)
 * so either resolves correctly.
 */
export const LEGACY_PRICING_MODELS = [
  "home_cleaning_recommended_hours",
  "office_cleaning_recurring_area_frequency",
  "deep_cleaning_area_based",
  "deep_cleaning_area_addons",
  "move_out_fixed_plus_addons",
  "window_cleaning_count_based",
  "stairwell_cleaning_floors_frequency",
  "inquiry_only_no_price",
] as const;
export type LegacyPricingModel = (typeof LEGACY_PRICING_MODELS)[number];

/** Any pricing-model identifier the calculator understands (legacy or generic). */
export type CalculatorPricingModel = LegacyPricingModel | GenericPricingModel;

/**
 * Maps each legacy service-named pricing model onto its generic equivalent.
 *
 * `stairwell_cleaning_floors_frequency` → `unit_based`: floors/stairwells are
 * counted objects, so a per-unit price is the closest generic fit. If a service
 * later needs area/time logic for stairwells we add configuration rather than a
 * new hardcoded branch.
 */
export const LEGACY_PRICING_MODEL_ALIASES: Readonly<Record<LegacyPricingModel, GenericPricingModel>> = {
  home_cleaning_recommended_hours: "hourly_by_area",
  office_cleaning_recurring_area_frequency: "hourly_by_area",
  deep_cleaning_area_based: "hourly_by_area",
  deep_cleaning_area_addons: "hourly_by_area",
  move_out_fixed_plus_addons: "sqm_fixed",
  window_cleaning_count_based: "unit_based",
  stairwell_cleaning_floors_frequency: "unit_based",
  inquiry_only_no_price: "manual_quote",
};

/**
 * The explicit, safe fallback for an unrecognized / missing pricing model: a
 * service we do not recognize must NOT auto-price as Home/hourly. `manual_quote`
 * collects the request for manual review instead of inventing a price.
 */
export const UNKNOWN_PRICING_MODEL_FALLBACK: GenericPricingModel = "manual_quote";

function isGenericPricingModel(value: string): value is GenericPricingModel {
  return (GENERIC_PRICING_MODELS as readonly string[]).includes(value);
}

function isLegacyPricingModel(value: string): value is LegacyPricingModel {
  return (LEGACY_PRICING_MODELS as readonly string[]).includes(value);
}

/**
 * Normalizes ANY stored pricing-model string into a generic pricing model. Pure +
 * deterministic:
 *   • a generic model returns itself,
 *   • a known legacy model returns its generic alias,
 *   • null / undefined / empty / anything unknown returns the explicit
 *     {@link UNKNOWN_PRICING_MODEL_FALLBACK} (`manual_quote`) — NEVER hourly.
 */
export function resolveGenericPricingModel(pricingModel: string | null | undefined): GenericPricingModel {
  if (typeof pricingModel !== "string") return UNKNOWN_PRICING_MODEL_FALLBACK;
  const trimmed = pricingModel.trim();
  if (trimmed === "") return UNKNOWN_PRICING_MODEL_FALLBACK;
  if (isGenericPricingModel(trimmed)) return trimmed;
  if (isLegacyPricingModel(trimmed)) return LEGACY_PRICING_MODEL_ALIASES[trimmed];
  return UNKNOWN_PRICING_MODEL_FALLBACK;
}

/**
 * The V2 engine pricing basis a generic model drives, or null when the V2 engine
 * does not implement that model yet (`unit_based` / `fixed_package` /
 * `manual_quote`). Callers MUST treat null as "not auto-priceable by V2" and never
 * silently fall back to hourly.
 */
export function pricingBasisForGenericModel(model: GenericPricingModel): PricingBasisV2 | null {
  switch (model) {
    case "hourly_by_area":
      return "hourly";
    case "sqm_fixed":
      return "sqm_fixed";
    case "unit_based":
    case "fixed_package":
    case "manual_quote":
      return null;
  }
}

/** True when the V2 engine can auto-price the given generic model today. */
export function isEngineSupportedGenericModel(model: GenericPricingModel): boolean {
  return pricingBasisForGenericModel(model) !== null;
}
