/**
 * Price Calculator — PURE pricing engine.
 *
 * Deterministic, side-effect-free price computation for the public calculator.
 * Given normalized config (pricing rules + selected plan) and visitor answers,
 * it returns the estimated hours/price, a +/- range, and a full calculation
 * trace. It performs NO I/O: the Slice 3 Edge Function loads the Supabase rows,
 * maps them into {@link PriceCalculationInput}, and calls this for the trusted
 * server-side price; a client preview may call the same code for an instant
 * (non-authoritative) estimate. Because pricing lives here — never in the DB or
 * the UI — it is testable in isolation and identical on both paths.
 *
 * Formulas (docs/architecture/price-calculator/04):
 *   Home cleaning (home_cleaning_recommended_hours) — a RECURRING four-week
 *   estimate (Slice 12I). No bathrooms factor anymore; the hourly rate is
 *   constant and package/interval differences are rule-driven TIME adjustments:
 *     base_visit_hours  = base_hours + sqm*hours_per_sqm + Σ addon_hours
 *     adjusted_hours    = base_visit_hours
 *                         + every_four_weeks_start_minutes (when interval=every_four_weeks)
 *                         + under_minimum_visit_start_minutes (when base visit < threshold)
 *                         + strict_setup_start_minutes
 *                         + pets % (when has_pets)
 *     estimated_hours   = max(adjusted_hours, minimum_hours)   // per VISIT
 *     price_per_visit   = estimated_hours * plan.hourly_rate
 *     raw_price         = price_per_visit * visits_per_four_week_period
 *                         (weekly=4, biweekly=2, every_four_weeks=1)
 *   Move-out (move_out_fixed_plus_addons):
 *     base_price = max(minimum_price, sqm*price_per_sqm)
 *     addons     = glazed_balcony + divisible_windows + (bathrooms-1)*extra_bathroom
 *     raw_price  = base_price + addons
 *   Both then apply: price_range = raw_price ± margin%, rounded to increment.
 */

import type {
  AnswerValue,
  CalculatorSizeBandSnapshot,
  CleaningPlanSnapshot,
  PriceCalculationInput,
  PriceCalculationResult,
  PriceDisplayMode,
  PriceIssue,
  PricingRuleValue,
  PricingSnapshot,
  PricingStep,
  SqmAdjustmentRange,
} from "./types";

/** Bump when a formula changes so old snapshots stay attributable to their math. */
export const FORMULA_VERSION = "v1" as const;

const DEFAULT_CURRENCY = "SEK";
const DEFAULT_DISPLAY_MODE: PriceDisplayMode = "range";

// ── Value coercion (answers arrive loosely typed from JSON/forms) ───────────

/** Coerces an answer to a finite number, tolerating Swedish "1 200,5" style input. Returns null when not numeric. */
export function coerceNumber(value: AnswerValue): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const cleaned = value.trim().replace(/\s/g, "").replace(",", ".");
    if (cleaned === "") return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Coerces an answer to a boolean toggle (accepts true/1/"true"/"yes"/"ja"). */
export function coerceBoolean(value: AnswerValue): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    return v === "true" || v === "yes" || v === "ja" || v === "1";
  }
  return false;
}

/** Coerces a multiselect answer to a clean string[] (single string → one-element array). */
export function coerceStringArray(value: AnswerValue): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string" && v.trim() !== "");
  }
  if (typeof value === "string" && value.trim() !== "") return [value.trim()];
  return [];
}

// ── Rule lookup + money helpers ─────────────────────────────────────────────

/** Indexes pricing rules by rule_key, keeping only finite numeric values. */
export function indexPricingRules(
  rules: readonly PricingRuleValue[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of rules) {
    if (
      r &&
      typeof r.ruleKey === "string" &&
      typeof r.valueNumeric === "number" &&
      Number.isFinite(r.valueNumeric)
    ) {
      map.set(r.ruleKey, r.valueNumeric);
    }
  }
  return map;
}

function ruleValue(index: Map<string, number>, key: string, fallback = 0): number {
  const v = index.get(key);
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** Rounds to 2 decimals, taming float noise (e.g. 70*0.02 → 1.4). */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Rounds to the nearest multiple of `increment` (e.g. 1273.85 @ 50 → 1250). Increment ≤ 0 → nearest integer. */
export function roundToIncrement(value: number, increment: number | null | undefined): number {
  if (!increment || increment <= 0) return Math.round(value);
  return Math.round(value / increment) * increment;
}

function currencySuffix(currency: string): string {
  return currency === "SEK" ? "kr" : currency;
}

/** Groups an integer amount with thin spaces (deterministic, locale-free): 1250 → "1 250". */
function groupDigits(amount: number): string {
  const rounded = Math.round(amount);
  const sign = rounded < 0 ? "-" : "";
  return (
    sign + Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ")
  );
}

/** Formats a single amount with its currency suffix: 1250 → "1 250 kr". */
export function formatAmount(amount: number, currency: string = DEFAULT_CURRENCY): string {
  return `${groupDigits(amount)} ${currencySuffix(currency)}`;
}

/**
 * Builds the customer-facing price text from a result, respecting the display
 * mode. Returns "" for invalid results so the UI shows a neutral/partial state.
 */
export function buildResultDisplayText(result: PriceCalculationResult): string {
  if (!result.valid || result.calculatedPrice === null) return "";
  const { priceDisplayMode, currency } = result;

  if (priceDisplayMode === "hidden_until_submit") {
    return "Pris visas när du skickat din förfrågan.";
  }
  if (priceDisplayMode === "exact") {
    return `Cirka ${formatAmount(result.calculatedPrice, currency)}`;
  }
  // "range" (default)
  const min = result.minPrice ?? result.calculatedPrice;
  const max = result.maxPrice ?? result.calculatedPrice;
  if (min === max) return `Cirka ${formatAmount(min, currency)}`;
  return `${groupDigits(min)}–${groupDigits(max)} ${currencySuffix(currency)}`;
}

// ── Result assembly ─────────────────────────────────────────────────────────

interface PricedCore {
  estimatedHours: number | null;
  /** Raw subtotal before VAT/RUT. */
  rawPrice: number;
  steps: PricingStep[];
}

const DEFAULT_VAT_RATE_PERCENT = 25;
const DEFAULT_RUT_PERCENT = 50;

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function resolvedVatRate(input: PriceCalculationInput, plan: CleaningPlanSnapshot | null): number {
  if (plan) {
    return finiteOrNull(plan.vatRatePercent)
      ?? finiteOrNull(input.servicePlanSettings?.defaultVatRatePercent)
      ?? finiteOrNull(input.defaultVatRatePercent)
      ?? DEFAULT_VAT_RATE_PERCENT;
  }
  if (input.servicePlanSettings?.plansEnabled === true) {
    return finiteOrNull(input.servicePlanSettings.defaultVatRatePercent)
      ?? finiteOrNull(input.defaultVatRatePercent)
      ?? DEFAULT_VAT_RATE_PERCENT;
  }
  return 0;
}

function resolvedRutPercent(plan: CleaningPlanSnapshot | null): number {
  return finiteOrNull(plan?.rutPercent) ?? DEFAULT_RUT_PERCENT;
}

function buildTaxAndRut(
  input: PriceCalculationInput,
  plan: CleaningPlanSnapshot | null,
  priceExclVat: number,
): {
  vatRatePercent: number;
  vatAmount: number;
  priceInclVat: number;
  rutEnabled: boolean;
  rutPercent: number;
  showRutBreakdown: boolean;
  rutDeduction: number;
  priceAfterRut: number;
} {
  const vatRatePercent = resolvedVatRate(input, plan);
  const vatAmount = round2(priceExclVat * (vatRatePercent / 100));
  const priceInclVat = round2(priceExclVat + vatAmount);
  const rutEnabled = Boolean(plan?.rutEnabled) && plan?.rutEligible !== false;
  const rutPercent = resolvedRutPercent(plan);
  const rutDeduction = rutEnabled ? round2(priceInclVat * (rutPercent / 100)) : 0;
  const priceAfterRut = round2(Math.max(0, priceInclVat - rutDeduction));
  return {
    vatRatePercent,
    vatAmount,
    priceInclVat,
    rutEnabled,
    rutPercent,
    showRutBreakdown: rutEnabled && plan?.showRutBreakdown === true,
    rutDeduction,
    priceAfterRut,
  };
}

function customerPriceFromExVat(input: PriceCalculationInput, plan: CleaningPlanSnapshot | null, priceExclVat: number): number {
  const tax = buildTaxAndRut(input, plan, priceExclVat);
  return tax.rutEnabled ? tax.priceAfterRut : tax.priceInclVat;
}

function planHourlyRate(plan: CleaningPlanSnapshot | null, fallback: number | null): number {
  return finiteOrNull(plan?.hourlyRate) ?? finiteOrNull(fallback) ?? 0;
}

function planAdjustedSubtotal(
  baseSubtotalExclVat: number,
  input: PriceCalculationInput,
  plan: CleaningPlanSnapshot | null,
): { subtotal: number; adjustment: number; detail: string | undefined } {
  if (input.servicePlanSettings?.plansEnabled === false) {
    return { subtotal: baseSubtotalExclVat, adjustment: 0, detail: "Planer avstängda" };
  }
  if (input.servicePlanSettings?.planPricingModel !== "price_adjustment_per_plan" || !plan) {
    return { subtotal: baseSubtotalExclVat, adjustment: 0, detail: undefined };
  }
  const value = finiteOrNull(plan.priceAdjustmentValue) ?? 0;
  const adjustment = plan.priceAdjustmentType === "percent" ? baseSubtotalExclVat * (value / 100) : value;
  return {
    subtotal: Math.max(0, baseSubtotalExclVat + adjustment),
    adjustment,
    detail: plan.priceAdjustmentType === "percent" ? `${value > 0 ? "+" : ""}${value}%` : `${value > 0 ? "+" : ""}${value}`,
  };
}

/** Applies the shared margin-range + rounding tail and assembles a valid result. */
function finalizeResult(
  input: PriceCalculationInput,
  index: Map<string, number>,
  plan: CleaningPlanSnapshot | null,
  core: PricedCore,
): PriceCalculationResult {
  const currency = input.currency ?? DEFAULT_CURRENCY;
  const priceDisplayMode = input.priceDisplayMode ?? DEFAULT_DISPLAY_MODE;
  const minPct = ruleValue(index, "range_min_percent", 0);
  const maxPct = ruleValue(index, "range_max_percent", 0);
  const increment = ruleValue(index, "rounding_increment", 0);

  const rawPrice = round2(core.rawPrice);
  const priceExclVat = roundToIncrement(rawPrice, increment);
  const minPriceExclVat = roundToIncrement(rawPrice * (1 - minPct / 100), increment);
  const maxPriceExclVat = roundToIncrement(rawPrice * (1 + maxPct / 100), increment);
  const tax = buildTaxAndRut(input, plan, priceExclVat);
  const calculatedPrice = customerPriceFromExVat(input, plan, priceExclVat);
  const minPrice = customerPriceFromExVat(input, plan, minPriceExclVat);
  const maxPrice = customerPriceFromExVat(input, plan, maxPriceExclVat);

  const steps: PricingStep[] = [
    ...core.steps,
    { key: "raw_price", label: "Råpris", value: rawPrice },
    {
      key: "price_excl_vat",
      label: "Pris exkl. moms",
      value: priceExclVat,
      detail: increment > 0 ? `Avrundat till närmaste ${increment}` : undefined,
    },
    { key: "vat_amount", label: "Moms", value: tax.vatAmount, detail: `${tax.vatRatePercent}%` },
    { key: "price_incl_vat", label: "Pris inkl. moms", value: tax.priceInclVat },
    ...(tax.rutEnabled
      ? [
          {
            key: "rut_deduction",
            label: "RUT-avdrag",
            value: -tax.rutDeduction,
            detail: `${tax.rutPercent}%`,
          },
        ]
      : []),
    {
      key: "calculated_price",
      label: tax.rutEnabled ? "Kundpris efter RUT" : "Kundpris",
      value: calculatedPrice,
    },
    { key: "min_price", label: "Lägsta pris", value: minPrice, detail: `−${minPct}%` },
    { key: "max_price", label: "Högsta pris", value: maxPrice, detail: `+${maxPct}%` },
  ];

  return {
    valid: true,
    issues: [],
    pricingModel: input.pricingModel,
    formulaVersion: FORMULA_VERSION,
    currency,
    priceDisplayMode,
    estimatedHours: core.estimatedHours,
    rawPrice,
    calculatedPrice,
    minPrice,
    maxPrice,
    priceExclVat,
    vatRatePercent: tax.vatRatePercent,
    vatAmount: tax.vatAmount,
    priceInclVat: tax.priceInclVat,
    rutEnabled: tax.rutEnabled,
    rutPercent: tax.rutPercent,
    showRutBreakdown: tax.showRutBreakdown,
    rutDeduction: tax.rutDeduction,
    priceAfterRut: tax.priceAfterRut,
    roundingIncrement: increment > 0 ? increment : null,
    selectedPlanSnapshot: plan,
    inputs: { ...input.answers },
    steps,
    requiresManualReview: false,
    manualReviewReason: null,
  };
}

/**
 * Builds an invalid result (no price) carrying the validation issues. When
 * `manualReview` is supplied the result is flagged for human follow-up (e.g. the
 * office "custom interval"): `valid` is still false and the price fields stay
 * null, but the submit path may persist a priceless, manual-review quote.
 */
function invalidResult(
  input: PriceCalculationInput,
  issues: PriceIssue[],
  plan: CleaningPlanSnapshot | null,
  manualReview: { reason: string } | null = null,
): PriceCalculationResult {
  return {
    valid: false,
    issues,
    pricingModel: input.pricingModel,
    formulaVersion: FORMULA_VERSION,
    currency: input.currency ?? DEFAULT_CURRENCY,
    priceDisplayMode: input.priceDisplayMode ?? DEFAULT_DISPLAY_MODE,
    estimatedHours: null,
    rawPrice: null,
    calculatedPrice: null,
    minPrice: null,
    maxPrice: null,
    priceExclVat: null,
    vatRatePercent: resolvedVatRate(input, plan),
    vatAmount: null,
    priceInclVat: null,
    rutEnabled: Boolean(plan?.rutEnabled) && plan?.rutEligible !== false,
    rutPercent: resolvedRutPercent(plan),
    showRutBreakdown: Boolean(plan?.rutEnabled) && plan?.showRutBreakdown === true,
    rutDeduction: null,
    priceAfterRut: null,
    roundingIncrement: null,
    selectedPlanSnapshot: plan,
    inputs: { ...input.answers },
    steps: [],
    requiresManualReview: manualReview !== null,
    manualReviewReason: manualReview?.reason ?? null,
  };
}

// ── Per-model calculators ────────────────────────────────────────────────────

/**
 * Visits per FOUR-WEEK period implied by the home cleaning interval (Slice 12I).
 * Private home cleaning supports exactly three recurring intervals; the four-week
 * total = price-per-visit × this multiplier. An unknown/absent interval falls to
 * 1 (the per-visit price is shown until an interval is chosen — never a
 * misleading four-week total). Legacy `monthly`/`one_time` answers map to 1 too.
 */
const HOME_VISITS_PER_FOUR_WEEKS: Record<string, number> = {
  weekly: 4,
  biweekly: 2,
  every_four_weeks: 1,
};

/** Max number of legacy rule-key home size bands the engine scans (bounded + deterministic). */
const HOME_SIZE_BAND_MAX_INDEX = 16;

/** Resolved per-visit base hours from a configured home size band (Slice 12J). */
interface HomeSizeBandResult {
  hours: number;
  detail: string;
}

/**
 * Resolves the recommended per-visit BASE hours from the configurable home size
 * bands (Slice 12J). Closed bands are keyed `home_size_band_{i}_max_sqm` +
 * `home_size_band_{i}_hours` (i ≥ 1); the open-ended top band is
 * `home_size_band_open_min_sqm` / `_open_hours` / `_open_extra_hours_per_10sqm`.
 * Lookup is deterministic and STEPPED (no interpolation): the first closed band
 * whose max ≥ sqm wins; above all closed bands the open band applies, adding
 * `extra_hours_per_10sqm` per STARTED 10 m² above its min. Returns null when NO
 * band is configured, so the caller falls back to the legacy linear model
 * (base_hours + sqm × hours_per_sqm) — keeping old data + the parity matrix intact.
 */
function resolveConfiguredHomeSizeBandHours(
  bands: readonly CalculatorSizeBandSnapshot[] | undefined,
  sqm: number,
): HomeSizeBandResult | null {
  const active = (bands ?? [])
    .filter((band) =>
      band.active === true &&
      band.serviceKey === "home_cleaning" &&
      Number.isFinite(band.minSqm) &&
      (band.maxSqm === null || Number.isFinite(band.maxSqm)) &&
      Number.isFinite(band.recommendedHours) &&
      band.recommendedHours > 0,
    )
    .sort((a, b) => a.sortOrder - b.sortOrder || a.minSqm - b.minSqm);
  if (active.length === 0) return null;

  const openBands = active.filter((band) => band.maxSqm === null);
  if (openBands.length > 1) return null;

  let expectedStart: number | null = null;
  for (const band of active) {
    if (expectedStart !== null && band.minSqm > expectedStart) return null;
    if (band.maxSqm !== null && band.maxSqm < band.minSqm) return null;
    expectedStart = band.maxSqm === null ? null : band.maxSqm + 1;
  }

  const matched = active.find((band) => sqm >= band.minSqm && (band.maxSqm === null || sqm <= band.maxSqm));
  if (!matched) return null;
  if (matched.maxSqm === null) {
    const startAfter = matched.extraHoursStartAfterSqm ?? matched.minSqm;
    const extraPer10 = matched.extraHoursPerStarted10Sqm ?? 0;
    const startedBlocks = sqm > startAfter ? Math.ceil((sqm - startAfter) / 10) : 0;
    return {
      hours: matched.recommendedHours + startedBlocks * extraPer10,
      detail: `${matched.minSqm}+ m²`,
    };
  }
  return { hours: matched.recommendedHours, detail: `${matched.minSqm}–${matched.maxSqm} m²` };
}

function resolveLegacyHomeSizeBandHours(
  index: Map<string, number>,
  sqm: number,
): HomeSizeBandResult | null {
  const closed: { maxSqm: number; hours: number }[] = [];
  for (let i = 1; i <= HOME_SIZE_BAND_MAX_INDEX; i++) {
    const maxKey = `home_size_band_${i}_max_sqm`;
    const hoursKey = `home_size_band_${i}_hours`;
    if (index.has(maxKey) && index.has(hoursKey)) {
      closed.push({ maxSqm: ruleValue(index, maxKey), hours: ruleValue(index, hoursKey) });
    }
  }
  const hasOpen = index.has("home_size_band_open_hours");
  if (closed.length === 0 && !hasOpen) return null;

  closed.sort((a, b) => a.maxSqm - b.maxSqm);
  for (const band of closed) {
    if (sqm <= band.maxSqm) {
      return { hours: band.hours, detail: `≤ ${band.maxSqm} m²` };
    }
  }

  if (hasOpen) {
    const openMin = ruleValue(index, "home_size_band_open_min_sqm", 0);
    const openHours = ruleValue(index, "home_size_band_open_hours", 0);
    const extraPer10 = ruleValue(index, "home_size_band_open_extra_hours_per_10sqm", 0);
    const over = Math.max(0, sqm - openMin);
    const startedBlocks = over > 0 ? Math.ceil(over / 10) : 0;
    return { hours: openHours + startedBlocks * extraPer10, detail: `${openMin}+ m²` };
  }

  // sqm exceeds every closed band but no open band configured → use the largest.
  const largest = closed[closed.length - 1];
  return { hours: largest.hours, detail: `≤ ${largest.maxSqm} m²` };
}

/**
 * Slice 12Q — resolves the % adjustment applied to the configured `hours_per_sqm`
 * (Minutes per m²) for the home-cleaning size range that contains `sqm`. Ranges
 * are matched in ascending `fromSqm` order; the first range whose
 * `[fromSqm, toSqm]` contains `sqm` wins (toSqm null = open-ended top range). No
 * matching range → 0 % (the per-m² time is used as-is). Pure + deterministic.
 */
export function resolveSqmAdjustmentPercent(
  ranges: readonly SqmAdjustmentRange[] | undefined,
  sqm: number,
): number {
  if (!ranges || ranges.length === 0) return 0;
  const sorted = [...ranges].sort((a, b) => a.fromSqm - b.fromSqm);
  for (const r of sorted) {
    const from = Number.isFinite(r.fromSqm) ? r.fromSqm : 0;
    const withinUpper = r.toSqm === null || (Number.isFinite(r.toSqm) && sqm <= (r.toSqm as number));
    if (sqm >= from && withinUpper && Number.isFinite(r.adjustmentPercent)) {
      return r.adjustmentPercent;
    }
  }
  return 0;
}

/** Interval → rule key for the optional percentage TIME adjustment (Slice 12J). */
const HOME_INTERVAL_PERCENT_RULE_KEY: Record<string, string> = {
  weekly: "weekly_interval_time_percent_adjustment",
  biweekly: "biweekly_interval_time_percent_adjustment",
  every_four_weeks: "every_four_weeks_interval_time_percent_adjustment",
};

/**
 * Home cleaning (home_cleaning_recommended_hours): a RECURRING four-week estimate
 * (Slice 12I). The hourly rate is CONSTANT — package/interval differences are
 * expressed as rule-driven TIME adjustments (never different rates, never visible
 * surcharges). Requires a positive `sqm` answer and a plan. Bathrooms NO LONGER
 * affect the price (the field is retired). Deterministic order:
 *   1. base visit time from area + add-ons
 *   2. + every_four_weeks_start_minutes (interval = every_four_weeks)
 *   3. + under_minimum_visit_start_minutes (when the BASE visit time, before any
 *        adjustment, is under under_minimum_visit_threshold_minutes)
 *   4. + strict_setup_start_minutes
 *   5. + pets % (has_pets → pet_time_percent uplift on the adjusted time)
 *   6. floor at minimum_hours → estimated_hours (per VISIT)
 *   7. price_per_visit = estimated_hours × hourly_rate
 *   8. raw_price = price_per_visit × visits_per_four_week_period
 * Every adjustment is a configurable rule read by key (never hardcoded); a
 * missing rule means 0 (no effect, fail-safe).
 */
export function calculateHomeCleaningPrice(
  input: PriceCalculationInput,
): PriceCalculationResult {
  const index = indexPricingRules(input.rules);
  const plan = input.plan ?? null;
  const issues: PriceIssue[] = [];

  const sqm = coerceNumber(input.answers.sqm);
  if (sqm === null) {
    issues.push({ code: "missing_sqm", field: "sqm", message: "Boyta (m²) krävs." });
  } else if (sqm <= 0) {
    issues.push({ code: "invalid_sqm", field: "sqm", message: "Boyta (m²) måste vara större än 0." });
  }

  const plansEnabled = input.servicePlanSettings?.plansEnabled ?? true;
  if (plansEnabled && !plan) {
    issues.push({ code: "missing_plan", field: "cleaningPlanId", message: "Välj en plan för att se priset." });
  } else if (plan && (!Number.isFinite(plan.hourlyRate) || plan.hourlyRate < 0)) {
    issues.push({ code: "invalid_plan_rate", field: "cleaningPlanId", message: "Ogiltigt timpris för vald plan." });
  }

  if (issues.length > 0 || sqm === null || (plansEnabled && !plan)) {
    return invalidResult(input, issues, plan);
  }

  const minimumHours = ruleValue(index, "minimum_hours", 0);

  // Add-on hours (area-independent extras) — applied on top of the base time.
  const selectedAddons = coerceStringArray(input.answers.addons);
  let addonHours = 0;
  const addonSteps: PricingStep[] = [];
  for (const addon of selectedAddons) {
    const hours = ruleValue(index, `addon_hours_${addon}`, 0);
    if (hours !== 0) {
      addonHours += hours;
      addonSteps.push({ key: `addon_hours_${addon}`, label: `Tillval: ${addon}`, value: round2(hours) });
    }
  }

  // 1. Base per-visit time. Slice 12Q: when home per-sqm ADJUSTMENT ranges are
  //    configured they are PREFERRED — the engine uses the legacy linear model
  //    (base_hours + sqm × effective hours_per_sqm) and size bands are skipped
  //    entirely (no parallel size-band logic). With no adjustment ranges the
  //    prior behaviour is unchanged: configurable size bands (Slice 12J) win,
  //    else the legacy linear model.
  const sqmAdjustments = input.sqmAdjustments ?? [];
  const hasSqmAdjustments = sqmAdjustments.length > 0;
  const sizeBand = hasSqmAdjustments
    ? null
    : resolveConfiguredHomeSizeBandHours(input.sizeBands, sqm) ?? resolveLegacyHomeSizeBandHours(index, sqm);
  const baseSteps: PricingStep[] = [];
  let baseTimeHours: number;
  if (sizeBand) {
    baseTimeHours = sizeBand.hours;
    baseSteps.push({
      key: "size_band_hours",
      label: "Rekommenderad tid (boyta)",
      value: round2(sizeBand.hours),
      detail: sizeBand.detail,
    });
  } else {
    const baseHours = ruleValue(index, "base_hours", 0);
    const hoursPerSqm = ruleValue(index, "hours_per_sqm", 0);
    // Slice 12Q: scale ONLY the per-m² time component by the matching range %.
    const sqmAdjustPct = resolveSqmAdjustmentPercent(sqmAdjustments, sqm);
    const effectiveHoursPerSqm = hoursPerSqm * (1 + sqmAdjustPct / 100);
    baseTimeHours = baseHours + sqm * effectiveHoursPerSqm;
    baseSteps.push(
      { key: "base_hours", label: "Grundtimmar", value: round2(baseHours) },
      {
        key: "sqm_hours",
        label: "Timmar för yta",
        value: round2(sqm * effectiveHoursPerSqm),
        detail:
          sqmAdjustPct !== 0
            ? `${sqm} m² × ${hoursPerSqm} (${sqmAdjustPct > 0 ? "+" : ""}${sqmAdjustPct}%)`
            : `${sqm} m² × ${hoursPerSqm}`,
      },
    );
  }

  const baseVisitHours = baseTimeHours + addonHours;
  const baseVisitMinutes = baseVisitHours * 60;

  const frequency =
    typeof input.answers.frequency === "string" ? input.answers.frequency.trim().toLowerCase() : "";

  // 2. Optional interval-based PERCENTAGE time adjustment. Gated by
  //    interval_time_adjustments_enabled (>0 = on); each interval's percent is a
  //    rule (weekly −5, biweekly 0, every_four_weeks +5 by default). Applied to
  //    the base per-visit time. Missing/disabled → 0 % (no effect, fail-safe).
  const intervalAdjEnabled = ruleValue(index, "interval_time_adjustments_enabled", 0) > 0;
  const intervalPctRuleKey = HOME_INTERVAL_PERCENT_RULE_KEY[frequency];
  const intervalPct =
    intervalAdjEnabled && intervalPctRuleKey ? ruleValue(index, intervalPctRuleKey, 0) : 0;
  const hoursAfterIntervalPct = baseVisitHours * (1 + intervalPct / 100);

  // Rule-driven minute adjustments (each read by key; missing → 0, fail-safe).
  const everyFourWeeksStartMinutes = ruleValue(index, "every_four_weeks_start_minutes", 0);
  const underMinThresholdMinutes = ruleValue(index, "under_minimum_visit_threshold_minutes", 0);
  const underMinStartMinutes = ruleValue(index, "under_minimum_visit_start_minutes", 0);
  const strictSetupStartMinutes = ruleValue(index, "strict_setup_start_minutes", 0);

  // 3. Interval start-minutes (only for the every_four_weeks interval).
  const intervalMinutes = frequency === "every_four_weeks" ? everyFourWeeksStartMinutes : 0;
  // Under-minimum adjustment, decided on the ORIGINAL base visit time (pre-%).
  const underMinutes =
    underMinThresholdMinutes > 0 && baseVisitMinutes < underMinThresholdMinutes ? underMinStartMinutes : 0;
  // 4. Strict-setup minutes (admin-only rule; default 0, no public field).
  const strictMinutes = strictSetupStartMinutes;

  const adjustmentMinutes = intervalMinutes + underMinutes + strictMinutes;
  const hoursAfterFixed = hoursAfterIntervalPct + adjustmentMinutes / 60;

  // 5. Pets: rule-driven percentage uplift on the adjusted time (home only).
  const hasPets = coerceBoolean(input.answers.has_pets);
  const petTimePercent = ruleValue(index, "pet_time_percent", 0);
  const petExtraHours = hasPets ? hoursAfterFixed * (petTimePercent / 100) : 0;
  const hoursAfterPets = hoursAfterFixed + petExtraHours;

  // 6. Plan TIME adjustment per visit (Slice 12J). ONLY applied when the service's
  //    plan pricing model is "time_adjustment_per_visit": every plan then shares ONE
  //    hourly rate and differs only by this rule-driven per-visit time delta
  //    (flexible −0.25 h, fixed +0.25 h, priority +0.5 h by default), read by the
  //    selected plan's key. In any other mode (hourly_rate_by_plan,
  //    price_adjustment_per_plan) the rule is IGNORED even when present, so plans
  //    differ by rate/adjustment instead. Missing rule → 0 (fail-safe).
  const planTimeAdjustHours =
    plan && input.servicePlanSettings?.planPricingModel === "time_adjustment_per_visit"
      ? ruleValue(index, `plan_time_adjustment_hours_${plan.planKey}`, 0)
      : 0;
  const recommendedHours = hoursAfterPets + planTimeAdjustHours;

  // 7. Floor at the minimum hours → estimated hours PER VISIT.
  const estimatedHours = round2(Math.max(recommendedHours, minimumHours));
  const clampedToMinimum = recommendedHours < minimumHours;

  // 8 + 9. Per-visit price excl. VAT, then the four-week period subtotal.
  const visitsPerFourWeeks = HOME_VISITS_PER_FOUR_WEEKS[frequency] ?? 1;
  const baseRate = input.servicePlanSettings?.baseHourlyRateExclVat;
  const rate = planHourlyRate(plan, baseRate);
  const basePricePerVisitRaw = estimatedHours * rate;
  const planPricing = planAdjustedSubtotal(basePricePerVisitRaw, input, plan);
  const pricePerVisitRaw = planPricing.subtotal;
  const rawPrice = pricePerVisitRaw * visitsPerFourWeeks;

  const steps: PricingStep[] = [
    ...baseSteps,
    ...addonSteps,
    { key: "base_visit_hours", label: "Grundtid per tillfälle", value: round2(baseVisitHours) },
  ];

  if (intervalPct !== 0) {
    steps.push({
      key: "interval_percent",
      label: "Intervalljustering",
      value: round2(hoursAfterIntervalPct - baseVisitHours),
      detail: `${intervalPct > 0 ? "+" : ""}${intervalPct}%`,
    });
  }
  if (intervalMinutes !== 0) {
    steps.push({
      key: "every_four_weeks_minutes",
      label: "Tillägg var fjärde vecka",
      value: round2(intervalMinutes / 60),
      detail: `+${intervalMinutes} min`,
    });
  }
  if (underMinutes !== 0) {
    steps.push({
      key: "under_minimum_minutes",
      label: "Tillägg kortare besök",
      value: round2(underMinutes / 60),
      detail: `+${underMinutes} min`,
    });
  }
  if (strictMinutes !== 0) {
    steps.push({
      key: "strict_setup_minutes",
      label: "Tillägg upplägg",
      value: round2(strictMinutes / 60),
      detail: `+${strictMinutes} min`,
    });
  }
  if (hasPets && petExtraHours !== 0) {
    steps.push({
      key: "pet_time",
      label: "Tillägg för husdjur",
      value: round2(petExtraHours),
      detail: `+${petTimePercent}%`,
    });
  }
  if (planTimeAdjustHours !== 0) {
    steps.push({
      key: "plan_time_adjustment",
      label: "Justering för upplägg",
      value: round2(planTimeAdjustHours),
      detail: `${planTimeAdjustHours > 0 ? "+" : ""}${round2(planTimeAdjustHours)} h`,
    });
  }

  steps.push(
    {
      key: "estimated_hours",
      label: "Beräknade timmar per tillfälle",
      value: estimatedHours,
      detail: clampedToMinimum ? `Minst ${minimumHours} h` : undefined,
    },
    { key: "hourly_rate", label: "Timpris exkl. moms", value: rate, detail: plan?.name },
    ...(planPricing.adjustment !== 0
      ? [{ key: "plan_price_adjustment", label: "Planjustering", value: round2(planPricing.adjustment), detail: planPricing.detail }]
      : []),
    { key: "price_per_visit_excl_vat", label: "Pris per tillfälle exkl. moms", value: round2(pricePerVisitRaw) },
    {
      key: "visits_per_four_weeks",
      label: "Tillfällen per fyraveckorsperiod",
      value: visitsPerFourWeeks,
      detail: frequency || "—",
    },
  );

  return finalizeResult(input, index, plan, { estimatedHours, rawPrice, steps });
}

/**
 * Move-out cleaning: fixed price per m² (floored at minimum_price) plus explicit
 * add-ons. Requires a positive `sqm`; needs no cleaning plan in MVP. The first
 * bathroom is included; extra bathrooms beyond the first are priced per unit.
 */
export function calculateMoveOutCleaningPrice(
  input: PriceCalculationInput,
): PriceCalculationResult {
  const index = indexPricingRules(input.rules);
  const issues: PriceIssue[] = [];

  const sqm = coerceNumber(input.answers.sqm);
  if (sqm === null) {
    issues.push({ code: "missing_sqm", field: "sqm", message: "Boyta (m²) krävs." });
  } else if (sqm <= 0) {
    issues.push({ code: "invalid_sqm", field: "sqm", message: "Boyta (m²) måste vara större än 0." });
  }

  if (issues.length > 0 || sqm === null) {
    return invalidResult(input, issues, null);
  }

  const pricePerSqm = ruleValue(index, "price_per_sqm", 0);
  const minimumPrice = ruleValue(index, "minimum_price", 0);

  const sqmPrice = sqm * pricePerSqm;
  const basePrice = Math.max(minimumPrice, sqmPrice);
  const minimumApplied = sqmPrice < minimumPrice;

  // First bathroom included; floor at 1 so "extra" never goes negative.
  const bathrooms = Math.max(1, Math.floor(coerceNumber(input.answers.bathrooms) ?? 1));
  const extraBathrooms = Math.max(0, bathrooms - 1);

  const steps: PricingStep[] = [
    { key: "sqm_price", label: "Pris för yta", value: round2(sqmPrice), detail: `${sqm} m² × ${pricePerSqm}` },
    {
      key: "base_price",
      label: "Grundpris",
      value: round2(basePrice),
      detail: minimumApplied ? `Minimipris ${minimumPrice}` : undefined,
    },
  ];

  let addons = 0;
  if (coerceBoolean(input.answers.glazed_balcony)) {
    const v = ruleValue(index, "addon_glazed_balcony", 0);
    addons += v;
    steps.push({ key: "addon_glazed_balcony", label: "Tillval: inglasad balkong", value: round2(v) });
  }
  if (coerceBoolean(input.answers.divisible_windows)) {
    const v = ruleValue(index, "addon_divisible_windows", 0);
    addons += v;
    steps.push({ key: "addon_divisible_windows", label: "Tillval: spröjsade fönster", value: round2(v) });
  }
  if (extraBathrooms > 0) {
    const per = ruleValue(index, "addon_extra_bathroom", 0);
    const v = per * extraBathrooms;
    addons += v;
    steps.push({
      key: "addon_extra_bathroom",
      label: "Tillval: extra badrum",
      value: round2(v),
      detail: `${extraBathrooms} × ${per}`,
    });
  }

  const rawPrice = basePrice + addons;

  return finalizeResult(input, index, null, { estimatedHours: null, rawPrice, steps });
}

/** Average weeks per month (52 / 12 ≈ 4.33) — turns per-week schedules into monthly. */
const WEEKS_PER_MONTH = 4.33;

/**
 * Visits-per-month implied by the office cleaning `frequency` answer (Slice 12F):
 * visits-per-week × {@link WEEKS_PER_MONTH}. "weekday_daily" = 5 weekday visits/week
 * (5 × 4.33 ≈ 21.65). Keys MUST match the seeded office `frequency` option values.
 * The legacy `daily`/`monthly` keys are kept as back-compat aliases so any row
 * seeded before 12F still prices.
 */
const OFFICE_VISITS_PER_MONTH: Record<string, number> = {
  weekday_daily: 21.65, // 5 visits/week
  weekly: 4.33, // 1 visit/week
  biweekly: 2.165, // 0.5 visits/week
  every_four_weeks: 1.0825, // 0.25 visits/week
  // Back-compat aliases (pre-12F seed) — never advertised in the new option set.
  daily: 21.65,
  monthly: 1,
};

/**
 * The office "custom interval" choice. It is a VALID selection but has no
 * automatic price — many office setups need a bespoke schedule we cannot price
 * deterministically — so it routes to MANUAL REVIEW instead of a misleading total.
 */
const OFFICE_CUSTOM_INTERVAL = "custom_interval";

/**
 * Office cleaning (office_cleaning_recurring_area_frequency): a RECURRING monthly
 * estimate. Hours-per-visit are built from the area plus per-unit extras (toilets,
 * meeting rooms, workstations, an optional kitchen/pantry), floored at a minimum
 * per visit, then multiplied by the visits-per-month implied by the chosen
 * `frequency` and the office `hourly_rate` rule to give a MONTHLY raw price.
 * Requires a positive `sqm` and a known `frequency`; needs NO cleaning plan
 * (offices price on their own hourly_rate rule, not a commercial plan).
 */
export function calculateOfficeCleaningPrice(
  input: PriceCalculationInput,
): PriceCalculationResult {
  const index = indexPricingRules(input.rules);
  const issues: PriceIssue[] = [];

  const frequency =
    typeof input.answers.frequency === "string" ? input.answers.frequency.trim().toLowerCase() : "";

  // Custom interval → MANUAL REVIEW. A bespoke schedule cannot be priced
  // automatically, so short-circuit BEFORE other validation (the visitor can
  // still submit with minimal info and we follow up). No misleading price.
  if (frequency === OFFICE_CUSTOM_INTERVAL) {
    return invalidResult(
      input,
      [
        {
          code: "manual_review_required",
          field: "frequency",
          message:
            "Anpassat intervall kräver en manuell genomgång innan vi kan ge ett pris.",
        },
      ],
      null,
      { reason: OFFICE_CUSTOM_INTERVAL },
    );
  }

  const sqm = coerceNumber(input.answers.sqm);
  if (sqm === null) {
    issues.push({ code: "missing_sqm", field: "sqm", message: "Yta (m²) krävs." });
  } else if (sqm <= 0) {
    issues.push({ code: "invalid_sqm", field: "sqm", message: "Yta (m²) måste vara större än 0." });
  }

  const visitsPerMonth = OFFICE_VISITS_PER_MONTH[frequency];
  if (visitsPerMonth === undefined) {
    issues.push({
      code: "missing_frequency",
      field: "frequency",
      message: "Välj hur ofta kontoret ska städas.",
    });
  }

  if (issues.length > 0 || sqm === null || visitsPerMonth === undefined) {
    return invalidResult(input, issues, null);
  }

  const baseVisitHours = ruleValue(index, "base_visit_hours", 0);
  const hoursPerSqm = ruleValue(index, "hours_per_sqm", 0);
  const toiletExtraHours = ruleValue(index, "toilet_extra_hours", 0);
  const meetingRoomExtraHours = ruleValue(index, "meeting_room_extra_hours", 0);
  const workstationExtraHours = ruleValue(index, "workstation_extra_hours", 0);
  const kitchenExtraHours = ruleValue(index, "kitchen_extra_hours", 0);
  const minimumHoursPerVisit = ruleValue(index, "minimum_hours_per_visit", 0);
  const ruleHourlyRate = ruleValue(index, "hourly_rate", 0);
  const plansEnabled = input.servicePlanSettings?.plansEnabled === true;
  const plan = plansEnabled ? input.plan ?? null : null;
  if (plansEnabled && !plan) {
    return invalidResult(input, [{ code: "missing_plan", field: "cleaningPlanId", message: "Välj en plan för att se priset." }], null);
  }
  const hourlyRate = plansEnabled
    ? planHourlyRate(plan, input.servicePlanSettings?.baseHourlyRateExclVat ?? ruleHourlyRate)
    : ruleHourlyRate;

  const toilets = Math.max(0, Math.floor(coerceNumber(input.answers.toilets) ?? 0));
  const meetingRooms = Math.max(0, Math.floor(coerceNumber(input.answers.meeting_rooms) ?? 0));
  const workstations = Math.max(0, Math.floor(coerceNumber(input.answers.workstations) ?? 0));
  const hasKitchen = coerceBoolean(input.answers.has_kitchen);

  const sqmHours = sqm * hoursPerSqm;
  const toiletHours = toilets * toiletExtraHours;
  const meetingRoomHours = meetingRooms * meetingRoomExtraHours;
  const workstationHours = workstations * workstationExtraHours;
  const kitchenHours = hasKitchen ? kitchenExtraHours : 0;

  const visitHoursRaw =
    baseVisitHours + sqmHours + toiletHours + meetingRoomHours + workstationHours + kitchenHours;
  const hoursPerVisit = round2(Math.max(visitHoursRaw, minimumHoursPerVisit));
  const clampedToMinimum = visitHoursRaw < minimumHoursPerVisit;
  // Slice 12L (office pilot): fixed TOTAL time adjustment per visit. When the
  // service uses "hourly_rate_plus_time_adjustment" the SELECTED plan adds a fixed
  // per-VISIT hour delta (stored in the plan's priceAdjustmentValue, reused as
  // hours — applied ONCE per visit, never per hour, never a price surcharge).
  // Default 0 in every other mode so existing office pricing is unchanged.
  const planTimeAdjustHours =
    plansEnabled && plan && input.servicePlanSettings?.planPricingModel === "hourly_rate_plus_time_adjustment"
      ? finiteOrNull(plan.priceAdjustmentValue) ?? 0
      : 0;
  const adjustedHoursPerVisit = round2(Math.max(0, hoursPerVisit + planTimeAdjustHours));
  const baseMonthlySubtotal = adjustedHoursPerVisit * visitsPerMonth * hourlyRate;
  const planPricing = plansEnabled ? planAdjustedSubtotal(baseMonthlySubtotal, input, plan) : { subtotal: baseMonthlySubtotal, adjustment: 0, detail: undefined };
  const baseMonthlyPrice = planPricing.subtotal;

  // ── Supervision cleaning (tillsynsstädning) — a price-affecting recurring
  //    add-on. When active, each visit gets a fixed `supervision_start_minutes`
  //    overhead (a rule, never hardcoded) added to the customer's minutes, then
  //    the monthly cost = effective hours × visits/week × weeks/month × rate.
  const supervisionActive = coerceBoolean(input.answers.supervision_cleaning);
  const supervisionStartMinutes = ruleValue(index, "supervision_start_minutes", 0);
  const supervisionVisitsPerWeek = supervisionActive
    ? Math.max(0, coerceNumber(input.answers.supervision_visits_per_week) ?? 0)
    : 0;
  const supervisionMinutesPerVisit = supervisionActive
    ? Math.max(0, coerceNumber(input.answers.supervision_minutes_per_visit) ?? 0)
    : 0;
  const supervisionEffectiveMinutes = supervisionActive
    ? supervisionMinutesPerVisit + supervisionStartMinutes
    : 0;
  const supervisionMonthlyHours = supervisionActive
    ? (supervisionEffectiveMinutes / 60) * supervisionVisitsPerWeek * WEEKS_PER_MONTH
    : 0;
  const supervisionMonthlyPrice = supervisionMonthlyHours * hourlyRate;

  const rawPrice = baseMonthlyPrice + supervisionMonthlyPrice;

  const steps: PricingStep[] = [
    { key: "base_visit_hours", label: "Grundtimmar per tillfälle", value: round2(baseVisitHours) },
    { key: "sqm_hours", label: "Timmar för yta", value: round2(sqmHours), detail: `${sqm} m² × ${hoursPerSqm}` },
    { key: "toilet_hours", label: "Timmar för toaletter", value: round2(toiletHours), detail: `${toilets} × ${toiletExtraHours}` },
    { key: "meeting_room_hours", label: "Timmar för mötesrum", value: round2(meetingRoomHours), detail: `${meetingRooms} × ${meetingRoomExtraHours}` },
    { key: "workstation_hours", label: "Timmar för arbetsplatser", value: round2(workstationHours), detail: `${workstations} × ${workstationExtraHours}` },
    { key: "kitchen_hours", label: "Timmar för kök/pentry", value: round2(kitchenHours), detail: hasKitchen ? "Ingår" : "—" },
    {
      key: "hours_per_visit",
      label: "Timmar per tillfälle",
      value: hoursPerVisit,
      detail: clampedToMinimum ? `Minst ${minimumHoursPerVisit} h` : undefined,
    },
    { key: "visits_per_month", label: "Tillfällen per månad", value: round2(visitsPerMonth), detail: frequency },
    { key: "hourly_rate", label: "Timpris exkl. moms", value: hourlyRate, detail: plan?.name },
  ];

  if (planTimeAdjustHours !== 0) {
    steps.push({
      key: "office_plan_time_adjustment",
      label: "Justering per tillfälle (upplägg)",
      value: round2(planTimeAdjustHours),
      detail: `${planTimeAdjustHours > 0 ? "+" : ""}${round2(planTimeAdjustHours)} h`,
    });
    steps.push({
      key: "adjusted_hours_per_visit",
      label: "Timmar per tillfälle efter justering",
      value: adjustedHoursPerVisit,
    });
  }

  if (planPricing.adjustment !== 0) {
    steps.push({
      key: "plan_price_adjustment",
      label: "Planjustering",
      value: round2(planPricing.adjustment),
      detail: planPricing.detail,
    });
  }

  if (supervisionActive) {
    steps.push({
      key: "supervision_monthly_price",
      label: "Tillsynsstädning per månad",
      value: round2(supervisionMonthlyPrice),
      detail: `(${supervisionMinutesPerVisit} + ${supervisionStartMinutes}) min × ${supervisionVisitsPerWeek}/v × ${WEEKS_PER_MONTH}`,
    });
  }

  return finalizeResult(input, index, plan, { estimatedHours: adjustedHoursPerVisit, rawPrice, steps });
}

// ── Public entry points ──────────────────────────────────────────────────────

/** Dispatches to the calculator for the given pricing model. Pure + deterministic. */
export function calculatePrice(input: PriceCalculationInput): PriceCalculationResult {
  switch (input.pricingModel) {
    case "home_cleaning_recommended_hours":
      return calculateHomeCleaningPrice(input);
    case "move_out_fixed_plus_addons":
      return calculateMoveOutCleaningPrice(input);
    case "office_cleaning_recurring_area_frequency":
      return calculateOfficeCleaningPrice(input);
    default: {
      // Exhaustiveness guard — also protects against an unknown model at runtime.
      const unknownModel: never = input.pricingModel;
      return invalidResult(
        input,
        [{ code: "unknown_pricing_model", message: `Okänd prismodell: ${String(unknownModel)}` }],
        input.plan ?? null,
      );
    }
  }
}

/**
 * Maps a VALID result to the persisted snapshot shape (doc 04) for
 * `quote_requests.pricing_snapshot_json`. Returns null for invalid results so a
 * priceless quote can never be persisted as if it had a frozen total.
 */
export function toPricingSnapshot(result: PriceCalculationResult): PricingSnapshot | null {
  if (
    !result.valid ||
    result.rawPrice === null ||
    result.calculatedPrice === null ||
    result.minPrice === null ||
    result.maxPrice === null
  ) {
    return null;
  }
  return {
    pricingModel: result.pricingModel,
    formulaVersion: result.formulaVersion,
    inputs: result.inputs,
    selectedPlanSnapshot: result.selectedPlanSnapshot,
    steps: result.steps,
    rawPrice: result.rawPrice,
    calculatedPrice: result.calculatedPrice,
    minPrice: result.minPrice,
    maxPrice: result.maxPrice,
    estimatedHours: result.estimatedHours,
    currency: result.currency,
    priceExclVat: result.priceExclVat,
    vatRatePercent: result.vatRatePercent,
    vatAmount: result.vatAmount,
    priceInclVat: result.priceInclVat,
    rutEnabled: result.rutEnabled,
    rutPercent: result.rutPercent,
    showRutBreakdown: result.showRutBreakdown,
    rutDeduction: result.rutDeduction,
    priceAfterRut: result.priceAfterRut,
  };
}
