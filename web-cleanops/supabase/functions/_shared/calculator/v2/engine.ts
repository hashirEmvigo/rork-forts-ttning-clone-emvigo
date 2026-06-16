/**
 * ⚠️  FAITHFUL DENO MIRROR of `src/lib/calculator/v2/engine.ts`. Kept
 *     behaviour-identical by `src/lib/calculator/v2/parity.test.ts` (Slice V2-E1).
 *     The ONLY intentional differences vs. the canonical source are the import
 *     specifiers below (explicit `.ts` extensions, required by Deno). Any change to
 *     the canonical module must be mirrored here, or the parity test fails.
 *
 * Calculator V2 — shared calculation engine (Slice V2-B).
 *
 * One config-driven engine that turns a {@link CalculatorServiceConfigV2} plus the
 * customer's answers into a {@link RawCalculationResultV2}. It is intentionally the
 * ONLY place raw price + time are computed, so the frontend and the Deno Edge
 * Function can share identical math (later slices wire it in).
 *
 * Hard boundaries (per the approved V2 strategy):
 *   • The engine returns the RAW price EXCL VAT only. It never applies VAT, RUT,
 *     price-range margins, or display rounding — that is the display-pricing layer's
 *     job ({@link ./displayPricing}). This is the fix for the rounding saga: raw
 *     math here, display rounding strictly last and elsewhere.
 *   • The per-m² adjustment scales ONLY the per-m² time component — never start
 *     time, minimum time, add-ons, the plan start adjustment, or price.
 *   • A plan's start adjustment affects the PRICE ONLY: `pricingHours =
 *     estimatedServiceHours + startAdjustmentHours` drives the hourly price, while
 *     the customer-facing `estimatedServiceHours` is never changed by it. Both are
 *     surfaced on the result so callers bind the right field.
 *   • Generic add-on effects ({@link ./addons}) enter as three inputs: `addonMinutes`
 *     is real work (it raises BOTH the visible time estimate and the hourly price),
 *     while `addonFixedExclVat` and `addonPercent` are price-only. The net add-on
 *     percent is applied ONCE to the excl-VAT subtotal (after fixed add-ons), never
 *     compounded and never to service time. V2 NEVER reads legacy special add-on rules.
 *   • Plans are the pricing source of truth (see {@link ./planSelection}); a plan's
 *     `kind` must match the service's `pricingBasis`.
 *
 * Proven examples (see engine.test.ts):
 *   • home, 100 m² @ 2.4 min/m² with a −10% range → 216 min = 3.6 h; with a
 *     Flexibel plan (410 kr/h, −0.25 h start adj) → (3.6 + (−0.25)) × 410 = 1373.50.
 *   • move-out, 80 m² × 48 kr/m² (sqm_fixed) → 3840.
 */

import { selectPlanV2 } from "./planSelection.ts";
import type {
  CalculatorPlanV2,
  CalculatorServiceConfigV2,
  PriceIssue,
  RawCalculationResultV2,
  SqmAdjustmentRangeV2,
} from "./types.ts";

/** Inputs for one calculation. Answers are normalized before reaching the engine. */
export interface CalculationInputV2 {
  /** The fully-resolved canonical config for the service being priced. */
  config: CalculatorServiceConfigV2;
  /** Living area in m². Required for both pricing bases; null/≤0 invalidates. */
  sqm: number | null;
  /** Optional explicit plan choice; honoured only if it maps to an active plan. */
  requestedPlanKey?: string | null;
  /**
   * Extra service-time minutes from selected add-ons (hourly basis). Treated as
   * real work, so it DOES affect the visible time estimate and the price.
   */
  addonMinutes?: number;
  /** Optional flat amount (excl VAT) from selected add-ons, added to the raw price. */
  addonFixedExclVat?: number;
  /**
   * Optional NET additive percentage modifier from selected add-ons (e.g. +15 for
   * "very dirty", or a net +5 from +15 and −10). Applied ONCE to the excl-VAT
   * subtotal AFTER fixed add-ons — never compounded, never to service time, and
   * never in the display layer. Defaults to 0.
   */
  addonPercent?: number;
}

/** Rounds to öre (2 decimals) to clean float noise — NOT display rounding. */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Reads a finite number or falls back to 0 (fail-safe for optional config fields). */
function num(value: number | null | undefined): number {
  return Number.isFinite(value) ? (value as number) : 0;
}

/**
 * Resolves the per-m² % adjustment for the range that contains `sqm`. Ranges are
 * matched in ascending `fromSqm` order; the first whose `[fromSqm, toSqm]`
 * contains `sqm` wins (inclusive boundaries; `toSqm` null = open-ended top range).
 * No match → 0 %. Pure + deterministic. Faithful to the legacy
 * `resolveSqmAdjustmentPercent` so home behaviour is preserved.
 */
export function resolveSqmAdjustmentPercentV2(
  ranges: readonly SqmAdjustmentRangeV2[] | undefined,
  sqm: number,
): number {
  if (!ranges || ranges.length === 0) return 0;
  const sorted = [...ranges].sort((a, b) => a.fromSqm - b.fromSqm);
  for (const r of sorted) {
    const from = num(r.fromSqm);
    const withinUpper = r.toSqm === null || (Number.isFinite(r.toSqm) && sqm <= (r.toSqm as number));
    if (sqm >= from && withinUpper && Number.isFinite(r.adjustmentPercent)) {
      return r.adjustmentPercent;
    }
  }
  return 0;
}

/**
 * Computes the visible per-visit SERVICE time estimate in hours from the service's
 * m² time settings + add-on minutes, flooring at the configured minimum. The per-m²
 * adjustment scales ONLY the per-m² component. This is the customer-facing time and
 * is NEVER shifted by a plan's start adjustment. Returns null when the service has no
 * m² time config (e.g. a pure sqm_fixed move-out service has no time estimate).
 */
function computeEstimatedServiceHours(
  config: CalculatorServiceConfigV2,
  sqm: number,
  addonMinutes: number,
): number | null {
  const sqmTime = config.sqmTime;
  if (!sqmTime) return null;

  const adjustmentPercent = resolveSqmAdjustmentPercentV2(config.sqmAdjustments, sqm);
  const effectiveMinutesPerSqm = num(sqmTime.baseMinutesPerSqm) * (1 + adjustmentPercent / 100);
  const sqmMinutes = sqm * effectiveMinutesPerSqm;
  const serviceMinutes = num(sqmTime.startMinutes) + sqmMinutes + addonMinutes;
  const flooredMinutes = Math.max(serviceMinutes, num(sqmTime.minimumMinutes));
  return round2(flooredMinutes / 60);
}

/** Applies the net additive add-on percent ONCE to a subtotal (never compounded). */
function applyAddonPercent(subtotal: number, addonPercent: number): number {
  return subtotal * (1 + addonPercent / 100);
}

/** Clamps a raw price at 0 and the plan's optional minimum, then rounds to öre. */
function applyPriceFloor(raw: number, plan: CalculatorPlanV2): number {
  let value = Math.max(0, raw);
  if (plan.minimumPriceExclVat != null && Number.isFinite(plan.minimumPriceExclVat)) {
    value = Math.max(value, plan.minimumPriceExclVat);
  }
  return round2(value);
}

/**
 * hourly raw price excl VAT: `pricingHours × rate + fixed + addonFixed`, where
 * `pricingHours = estimatedServiceHours + plan.startAdjustmentHours` is computed by
 * the caller. Folding the start adjustment into `pricingHours` keeps it a PRICE-ONLY
 * lever: the visible `estimatedServiceHours` is unchanged, so a commercial plan
 * discount never looks like less cleaning time.
 */
function computeHourlyRawPrice(
  pricingHours: number,
  plan: CalculatorPlanV2,
  addonFixedExclVat: number,
  addonPercent: number,
): number {
  const rate = num(plan.hourlyRateExclVat);
  const fixed = num(plan.fixedAdjustmentExclVat);
  const subtotal = pricingHours * rate + fixed + addonFixedExclVat;
  const raw = applyAddonPercent(subtotal, addonPercent);
  return applyPriceFloor(raw, plan);
}

/**
 * sqm_fixed raw price excl VAT: `sqm × pricePerSqm + fixed + addonFixed`. The
 * customer-facing price is m²-based, never hourly (move-out condition plans).
 */
function computeSqmFixedRawPrice(
  sqm: number,
  plan: CalculatorPlanV2,
  addonFixedExclVat: number,
  addonPercent: number,
): number {
  const pricePerSqm = num(plan.pricePerSqmExclVat);
  const fixed = num(plan.fixedAdjustmentExclVat);
  const subtotal = sqm * pricePerSqm + fixed + addonFixedExclVat;
  const raw = applyAddonPercent(subtotal, addonPercent);
  return applyPriceFloor(raw, plan);
}

/**
 * Runs the shared engine for one service + answers. Validates inputs, selects the
 * plan, and dispatches on `pricingBasis`. Always returns a typed result: on any
 * issue it returns `valid: false` with the collected issues and null price (never
 * throws), so callers render a clean "cannot price yet" state.
 */
export function calculateRawV2(input: CalculationInputV2): RawCalculationResultV2 {
  const { config } = input;
  const issues: PriceIssue[] = [];

  const addonMinutes = Number.isFinite(input.addonMinutes) ? Math.max(0, input.addonMinutes as number) : 0;
  const addonFixedExclVat = Number.isFinite(input.addonFixedExclVat) ? (input.addonFixedExclVat as number) : 0;
  const addonPercent = Number.isFinite(input.addonPercent) ? (input.addonPercent as number) : 0;

  if (!config.enabled) {
    issues.push({ code: "service_disabled", message: "Tjänsten är inte aktiverad." });
  }

  const sqm = input.sqm;
  const sqmValid = sqm !== null && Number.isFinite(sqm) && sqm > 0;
  if (sqm === null || !Number.isFinite(sqm)) {
    issues.push({ code: "missing_sqm", field: "sqm", message: "Boyta (m²) krävs." });
  } else if (sqm <= 0) {
    issues.push({ code: "invalid_sqm", field: "sqm", message: "Boyta (m²) måste vara större än 0." });
  }

  const planResult = selectPlanV2(config.plans, input.requestedPlanKey);
  if (planResult.issue) issues.push(planResult.issue);
  const plan = planResult.plan;
  if (plan && plan.kind !== config.pricingBasis) {
    issues.push({
      code: "plan_basis_mismatch",
      field: "plan",
      message: "Vald plan matchar inte tjänstens prismodell.",
    });
  }

  const invalid = (estimatedServiceHours: number | null = null): RawCalculationResultV2 => ({
    valid: false,
    issues,
    serviceKey: config.serviceKey,
    pricingBasis: config.pricingBasis,
    estimatedServiceHours,
    pricingHours: null,
    rawPriceExclVat: null,
    selectedPlanKey: plan?.planKey ?? null,
    currency: config.currency,
  });

  if (issues.length > 0 || !sqmValid || !plan) {
    return invalid();
  }

  if (config.pricingBasis === "hourly") {
    const estimatedServiceHours = computeEstimatedServiceHours(config, sqm as number, addonMinutes);
    if (estimatedServiceHours === null) {
      issues.push({ code: "missing_time_config", message: "Tidsinställningar saknas för tjänsten." });
      return invalid();
    }
    // Start adjustment is a PRICE-ONLY lever: fold it into pricingHours and leave the
    // customer-facing estimatedServiceHours untouched.
    const pricingHours = round2(estimatedServiceHours + num(plan.startAdjustmentHours));
    return {
      valid: true,
      issues,
      serviceKey: config.serviceKey,
      pricingBasis: config.pricingBasis,
      estimatedServiceHours,
      pricingHours,
      rawPriceExclVat: computeHourlyRawPrice(pricingHours, plan, addonFixedExclVat, addonPercent),
      selectedPlanKey: plan.planKey,
      currency: config.currency,
    };
  }

  // sqm_fixed: service time may still be computed for internal planning, but it never
  // drives the price — so pricingHours is null (hours are not the price basis).
  return {
    valid: true,
    issues,
    serviceKey: config.serviceKey,
    pricingBasis: config.pricingBasis,
    estimatedServiceHours: computeEstimatedServiceHours(config, sqm as number, addonMinutes),
    pricingHours: null,
    rawPriceExclVat: computeSqmFixedRawPrice(sqm as number, plan, addonFixedExclVat, addonPercent),
    selectedPlanKey: plan.planKey,
    currency: config.currency,
  };
}
