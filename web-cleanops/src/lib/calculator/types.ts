/**
 * Price Calculator — shared domain types for the PURE pricing engine.
 *
 * These types describe the engine's inputs (normalized config + visitor answers)
 * and its deterministic output (price + full calculation trace). They are
 * intentionally decoupled from the Supabase row shapes: a later Edge Function
 * (Slice 3) loads `pricing_rules` / `cleaning_plans` rows and maps them into
 * {@link PricingRuleValue} / {@link CleaningPlanSnapshot} before calling the
 * engine. Keeping the engine config-driven (never DB- or company-specific) is
 * exactly what makes it pure, multi-company-ready, and unit-testable.
 *
 * Mirrors the seeded schema (migrations 0058/0059) and the formula spec in
 * docs/architecture/price-calculator/04-cleaning-plans-and-pricing-engine.md.
 */

/** Stable machine key the engine switches on (mirrors calculator_services.pricing_model). */
export type PricingModel =
  | "home_cleaning_recommended_hours"
  | "move_out_fixed_plus_addons"
  | "office_cleaning_recurring_area_frequency";

/** How the price is presented to the visitor (mirrors calculator_settings.price_display_mode). */
export type PriceDisplayMode = "exact" | "range" | "hidden_until_submit";

/** A single answer value coming off the calculator form (intentionally permissive). */
export type AnswerValue =
  | string
  | number
  | boolean
  | readonly string[]
  | null
  | undefined;

/** All answers for one service, keyed by calculator_questions.question_key. */
export type CalculatorAnswers = Record<string, AnswerValue>;

export type PlanPricingModel =
  | "hourly_rate_by_plan"
  | "price_adjustment_per_plan"
  | "time_adjustment_per_visit"
  // Slice 12L (office pilot): per-plan hourly rate + a fixed TOTAL time
  // adjustment per visit (in hours). The per-visit time delta is stored in the
  // plan's `priceAdjustmentValue` field (reused as hours; no schema change).
  | "hourly_rate_plus_time_adjustment";
export type PlanPriceAdjustmentType = "fixed_amount" | "percent";
export type RutApplyTo = "total_customer_price" | "labor_service_price_only";

/**
 * Slice 12Q — Home Cleaning per-square-meter % adjustment range. Each range
 * adjusts the configured `hours_per_sqm` (Minutes per m²) for customers whose
 * area falls inside `[fromSqm, toSqm]` (toSqm null = open-ended top range). The
 * adjustment ONLY scales the per-m² time component — never start time, minimum
 * visit time, add-ons, VAT or RUT. Replaces the (unused) size-band model for
 * home cleaning. A missing/empty range list means no adjustment.
 */
export interface SqmAdjustmentRange {
  fromSqm: number;
  toSqm: number | null;
  adjustmentPercent: number;
}

/** Editable area→hours band used by Home Cleaning before frequency/pets/add-ons/plan price. */
export interface CalculatorSizeBandSnapshot {
  serviceKey: string;
  minSqm: number;
  maxSqm: number | null;
  recommendedHours: number;
  extraHoursPerStarted10Sqm: number | null;
  extraHoursStartAfterSqm: number | null;
  active: boolean;
  sortOrder: number;
}

/** Service-level controls for plan-aware pricing. */
export interface ServicePlanSettings {
  plansEnabled: boolean;
  planPricingModel: PlanPricingModel;
  defaultPlanKey: string | null;
  baseHourlyRateExclVat: number | null;
  defaultVatRatePercent: number;
}

/**
 * The commercial plan AS SELECTED. A plan never changes WHAT is cleaned — it
 * controls price/tax/RUT settings. This snapshot is frozen onto the quote so
 * later edits never mutate an old quote.
 */
export interface CleaningPlanSnapshot {
  id?: string;
  serviceKey?: string;
  planKey: string;
  name: string;
  /** Admin-entered hourly price before VAT. Kept as hourlyRate for compatibility. */
  hourlyRate: number;
  vatRatePercent?: number;
  priceAdjustmentType?: PlanPriceAdjustmentType;
  priceAdjustmentValue?: number;
  rutEligible?: boolean;
  rutEnabled?: boolean;
  rutPercent?: number;
  rutApplyTo?: RutApplyTo;
  showRutBreakdown?: boolean;
}

/** Normalized pricing rule — the subset of a `pricing_rules` row the engine needs. */
export interface PricingRuleValue {
  ruleKey: string;
  ruleType: string;
  valueNumeric: number | null;
}

/** Input to the pure engine — everything needed to compute a price, no I/O. */
export interface PriceCalculationInput {
  pricingModel: PricingModel;
  answers: CalculatorAnswers;
  rules: readonly PricingRuleValue[];
  /** Required only when plans are enabled for the selected service. */
  plan?: CleaningPlanSnapshot | null;
  /** Service-level plan controls; absent means legacy pricing behaviour. */
  servicePlanSettings?: ServicePlanSettings | null;
  /** Home Cleaning size bands. When valid + complete they replace the legacy base_hours + hours_per_sqm formula. */
  sizeBands?: readonly CalculatorSizeBandSnapshot[];
  /** Slice 12Q — Home Cleaning per-sqm-range % adjustments to Minutes per m². When present they are PREFERRED over size bands. */
  sqmAdjustments?: readonly SqmAdjustmentRange[];
  /** Central VAT fallback used when neither plan nor service has a rate. */
  defaultVatRatePercent?: number | null;
  /** ISO currency code; defaults to SEK. */
  currency?: string;
  /** Presentation mode for {@link buildResultDisplayText}; defaults to "range". */
  priceDisplayMode?: PriceDisplayMode;
}

/** One human-readable line of the calculation trace (admin-only detail). */
export interface PricingStep {
  key: string;
  label: string;
  value: number;
  detail?: string;
}

/** A validation problem that prevented (or qualified) a calculation. */
export interface PriceIssue {
  code: string;
  field?: string;
  message: string;
}

/**
 * Deterministic engine output: price + full internal trace. When `valid` is
 * false the price fields are `null` and `issues` explains why (e.g. missing
 * area or unselected plan), so a preview UI can render a partial state safely.
 */
export interface PriceCalculationResult {
  valid: boolean;
  issues: PriceIssue[];
  pricingModel: PricingModel;
  formulaVersion: string;
  currency: string;
  priceDisplayMode: PriceDisplayMode;
  estimatedHours: number | null;
  rawPrice: number | null;
  calculatedPrice: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  priceExclVat: number | null;
  vatRatePercent: number;
  vatAmount: number | null;
  priceInclVat: number | null;
  rutEnabled: boolean;
  rutPercent: number;
  showRutBreakdown: boolean;
  rutDeduction: number | null;
  priceAfterRut: number | null;
  /**
   * The configured price rounding interval (kr) used by the engine, or null when
   * no rounding is configured. Exposed so customer-facing surfaces can round the
   * post-VAT/RUT display price to the SAME nearest interval everywhere (the
   * engine only rounds the excl-VAT subtotal, so VAT/RUT shift it off-interval).
   */
  roundingIncrement: number | null;
  selectedPlanSnapshot: CleaningPlanSnapshot | null;
  inputs: CalculatorAnswers;
  steps: PricingStep[];
  /**
   * True when the inputs are valid-but-not-automatically-priceable and a human
   * must follow up (e.g. office cleaning "custom interval"). The price fields are
   * null, `valid` is false, but the submit path may still persist a priceless,
   * manual-review quote so the visitor can be contacted. Defaults to false.
   */
  requiresManualReview: boolean;
  /** Machine reason for the manual review (e.g. "custom_interval"), else null. */
  manualReviewReason: string | null;
}

/**
 * The persisted trace shape (doc 04). Written to
 * `quote_requests.pricing_snapshot_json` by the Slice 3 Edge Function — never
 * recomputed, so already-submitted quotes are frozen against later config edits.
 */
export interface PricingSnapshot {
  pricingModel: PricingModel;
  formulaVersion: string;
  inputs: CalculatorAnswers;
  selectedPlanSnapshot: CleaningPlanSnapshot | null;
  steps: PricingStep[];
  rawPrice: number;
  calculatedPrice: number;
  minPrice: number;
  maxPrice: number;
  estimatedHours: number | null;
  currency: string;
  priceExclVat?: number;
  vatRatePercent?: number;
  vatAmount?: number;
  priceInclVat?: number;
  rutEnabled?: boolean;
  rutPercent?: number;
  showRutBreakdown?: boolean;
  rutDeduction?: number;
  priceAfterRut?: number;
}
