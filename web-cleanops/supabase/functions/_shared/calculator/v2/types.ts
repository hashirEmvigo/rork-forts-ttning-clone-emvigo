/**
 * ⚠️  FAITHFUL DENO MIRROR of `src/lib/calculator/v2/types.ts`. Kept
 *     behaviour-identical by `src/lib/calculator/v2/parity.test.ts` (Slice V2-E1).
 *     The ONLY intentional difference vs. the canonical source is the import
 *     specifier below (explicit `.ts` extension, required by Deno). Any change to
 *     the canonical module must be mirrored here, or the parity test fails.
 *
 * Calculator V2 — canonical domain types.
 *
 * These types describe the ONE normalized shape that every calculator service
 * resolves into before any price is computed. They are deliberately decoupled
 * from the Supabase row shapes and from the legacy `pricing_rules` model: a later
 * mapping slice loads admin config and produces a {@link CalculatorServiceConfigV2}
 * which the shared engine (Slice V2-B) and the public display-pricing layer
 * (Slice V2-C) consume. Keeping the engine config-driven (never DB- or
 * company-specific) is what makes V2 pure, testable, and consistent across the
 * frontend and the Deno Edge Function.
 *
 * Source-of-truth decisions encoded here (per the approved V2 strategy):
 *   • Public display rounding is a SERVICE DISPLAY SETTING
 *     ({@link CalculatorServiceConfigV2.displayRoundingInterval}) — never an
 *     active-gated pricing rule. If admin shows a value, the calculator gets that
 *     same value; if missing, the explicit fallback is nearest whole SEK.
 *   • Plans are pricing/service-level options (NOT visit frequency). A service's
 *     plan cards are the source of truth for pricing.
 */

import type { PriceIssue } from "../types.ts";

export type { PriceIssue };

/** What drives the raw price for a service. */
export type PricingBasisV2 = "hourly" | "sqm_fixed";

/** How the service is booked — controls public presentation, not the math. */
export type BookingModeV2 = "recurring" | "one_off";

/** Which public result layout to render. Presentation only. */
export type PublicLayoutV2 = "recurring_cleaning" | "one_off_cleaning" | "move_out_cleaning";

/** Whether the public price is shown including or excluding VAT. */
export type VatDisplayMode = "incl" | "excl";

/** Whether the public price is shown before or after the RUT deduction. */
export type RutDisplayMode = "before" | "after";

/** The two independent customer-facing display toggles, resolved together. */
export interface DisplayPricingMode {
  vat: VatDisplayMode;
  rut: RutDisplayMode;
}

/** VAT behaviour for a service. */
export interface VatConfigV2 {
  /** VAT rate percent applied to excl-VAT amounts (e.g. 25). */
  ratePercent: number;
  /** Whether the public UI may toggle incl/excl VAT. */
  customerToggle: boolean;
  /** The display mode shown first. */
  defaultMode: VatDisplayMode;
}

/** RUT behaviour for a service. RUT visibility is gated on `eligible`. */
export interface RutConfigV2 {
  /** Whether this service is RUT-eligible at all (controls toggle visibility). */
  eligible: boolean;
  /** Whether RUT is applied by default when eligible. */
  enabledByDefault: boolean;
  /** RUT deduction percent (e.g. 50). */
  percent: number;
  /** Whether the public UI may toggle before/after RUT. */
  customerToggle: boolean;
}

/** Lower/upper price-range margins, expressed as percentages of the price. */
export interface PriceRangeMarginsV2 {
  /** Lower margin percent (e.g. 5 → the low end is −5%). */
  lowerPercent: number;
  /** Upper margin percent (e.g. 10 → the high end is +10%). */
  upperPercent: number;
}

/** Square-meter time settings used by the `hourly` basis (e.g. home cleaning). */
export interface SqmTimeConfigV2 {
  /** Base minutes per m² before any sqm adjustment. */
  baseMinutesPerSqm: number;
  /** Fixed start time in minutes added once per visit. */
  startMinutes: number;
  /** Minimum visit time in minutes (a floor applied to the time estimate). */
  minimumMinutes: number;
}

/**
 * Home-cleaning per-square-meter % adjustment range. Each range scales the
 * configured base minutes per m² for customers whose area falls in
 * `[fromSqm, toSqm]` (toSqm null = open-ended top range). The adjustment ONLY
 * scales the per-m² time component — never start time, minimum time, add-ons,
 * VAT, RUT, margins, or rounding.
 */
export interface SqmAdjustmentRangeV2 {
  fromSqm: number;
  toSqm: number | null;
  adjustmentPercent: number;
}

/** Plan kind — must match the owning service's pricing basis. */
export type PlanKindV2 = "hourly" | "sqm_fixed";

/**
 * A pricing/service-level plan. For hourly services a plan carries an hourly
 * rate + a start-time adjustment (Flexibel/Fast/Prioritet). For sqm_fixed
 * services a plan represents condition/effort level and carries a price per m²
 * (move-out: Mycket gott skick / Normalt skick / Mycket att göra).
 */
export interface CalculatorPlanV2 {
  planKey: string;
  label: string;
  description: string | null;
  active: boolean;
  isDefault: boolean;
  sortOrder: number;
  kind: PlanKindV2;
  /** hourly: price per hour excl VAT. null for sqm_fixed plans. */
  hourlyRateExclVat: number | null;
  /** hourly: start-time adjustment in hours (may be negative, e.g. −0.25). */
  startAdjustmentHours: number | null;
  /** sqm_fixed: price per m² excl VAT. null for hourly plans. */
  pricePerSqmExclVat: number | null;
  /** Optional fixed amount (excl VAT) added to the raw price for any basis. */
  fixedAdjustmentExclVat: number | null;
  /** Optional minimum raw price (excl VAT) floor. null = no floor. */
  minimumPriceExclVat: number | null;
}

/**
 * The canonical, fully-resolved configuration for ONE service. Everything the
 * engine and display layer need, with no DB or company specifics leaking in.
 */
export interface CalculatorServiceConfigV2 {
  serviceKey: string;
  displayName: string;
  enabled: boolean;
  pricingBasis: PricingBasisV2;
  bookingMode: BookingModeV2;
  publicLayout: PublicLayoutV2;
  vat: VatConfigV2;
  rut: RutConfigV2;
  margins: PriceRangeMarginsV2;
  /**
   * Public display rounding interval in kr. The single source of truth for
   * customer-facing rounding. null → the display layer falls back to nearest
   * whole SEK. Never derived from another service.
   */
  displayRoundingInterval: number | null;
  /** Present for the hourly basis; null for sqm_fixed. */
  sqmTime: SqmTimeConfigV2 | null;
  /** Home-cleaning per-sqm % adjustments. Empty = no adjustment. */
  sqmAdjustments: readonly SqmAdjustmentRangeV2[];
  /** Active + inactive plans for this service (selection happens at calc time). */
  plans: readonly CalculatorPlanV2[];
  /**
   * Generic, Admin-authored add-ons for this service (Slice V2-E0D). Optional and
   * defaults to an empty list: the pure resolver ({@link resolveAddonEffects}) and
   * the engine consume add-on EFFECTS, not this config field, so existing configs
   * and tests need not set it. A later slice loads authored `calculator_addons`
   * rows into here; until then it stays empty and no public/Admin runtime reads it.
   */
  addons?: readonly CalculatorAddonConfigV2[];
  /** ISO currency code; defaults to SEK upstream. */
  currency: string;
}

/**
 * The raw, pre-display result from the shared engine (Slice V2-B). Carries the
 * single-point raw price EXCL VAT plus enough context for the display layer to
 * apply VAT/RUT, margins, and final rounding. No VAT/RUT/margins/rounding has
 * been applied yet — that is the display layer's job.
 */
export interface RawCalculationResultV2 {
  valid: boolean;
  issues: PriceIssue[];
  serviceKey: string;
  pricingBasis: PricingBasisV2;
  /**
   * Customer-facing estimated cleaning duration in hours — the TRUE service time.
   * This is the value the public result card shows as "Beräknad tid per tillfälle".
   * A plan's start adjustment NEVER changes it. null when the service has no time
   * estimate (e.g. a pure sqm_fixed move-out) or the calculation is invalid.
   */
  estimatedServiceHours: number | null;
  /**
   * Internal pricing time in hours = `estimatedServiceHours + plan.startAdjustmentHours`.
   * Drives the hourly raw price ONLY and must NEVER be rendered as the customer-facing
   * service time. Surfaced for tests/debug so the pricing-time vs service-time
   * distinction is explicit and result-card wiring can't accidentally bind the wrong
   * field. null for sqm_fixed (hours don't drive the price) or invalid calculations.
   */
  pricingHours: number | null;
  /** Single-point raw price excl VAT, before margins/VAT/RUT/rounding. */
  rawPriceExclVat: number | null;
  /** The plan that was selected for this calculation, if any. */
  selectedPlanKey: string | null;
  currency: string;
}

// ── Generic add-ons (Slice V2-E0D) ────────────────────────────────────────────

/**
 * The customer input shape for a generic add-on. Only the two persisted input
 * types are supported in this slice (the `calculator_addons` CHECK constraint
 * matches): a yes/no toggle or a numeric quantity. `single_select` is
 * intentionally absent until the Admin UI, public rendering, and resolver support
 * it together — persisting it before then would be unsafe.
 */
export type CalculatorAddonInputTypeV2 = "boolean" | "quantity";

/**
 * One generic add-on for a service — the V2 replacement for the legacy hardcoded
 * special add-on rules (pet/oven/bathroom/…), which V2 deliberately IGNORES and
 * never migrates. Effects are modelled as three explicit, independent channels
 * rather than a vague "affects price" flag:
 *   • {@link effectTimeMinutes} — extra SERVICE time per unit (real work; raises
 *     the visible time estimate AND, for hourly services, the price via hours×rate).
 *   • {@link effectFixedExclVat} — flat excl-VAT amount per unit (may be negative
 *     to model a discount).
 *   • {@link effectPercent} — percentage modifier per unit (may be negative).
 * Each channel is multiplied by the resolved selection multiplier (boolean → 0/1,
 * quantity → the clamped/snapped number) by {@link resolveAddonEffects}.
 */
export interface CalculatorAddonConfigV2 {
  addonKey: string;
  name: string;
  publicLabel: string;
  description: string | null;
  inputType: CalculatorAddonInputTypeV2;
  /** Default for a boolean add-on when the customer gives no answer. */
  booleanDefault: boolean;
  /** Quantity lower bound (≥ 0). */
  quantityMin: number;
  /** Quantity upper bound, or null for no maximum. */
  quantityMax: number | null;
  /** Quantity increment (> 0; a non-positive value is treated as 1). */
  quantityStep: number;
  /** Default quantity when the customer gives no answer. */
  quantityDefault: number;
  /** Extra service minutes per unit (≥ 0). */
  effectTimeMinutes: number;
  /** Flat excl-VAT amount per unit (may be negative). */
  effectFixedExclVat: number;
  /** Percentage modifier per unit (may be negative). */
  effectPercent: number;
  active: boolean;
  /** Whether the add-on is shown in the public calculator (does NOT gate the math). */
  publicVisible: boolean;
  required: boolean;
  sortOrder: number;
}

/** A single customer answer for an add-on: a boolean toggle or a numeric quantity. */
export type AddonSelectionValueV2 = boolean | number;

/** All customer add-on answers, keyed by `addonKey`. The clean V2 answer namespace. */
export type AddonSelectionsV2 = Record<string, AddonSelectionValueV2>;

/** One add-on's resolved contribution, surfaced for transparency/debugging. */
export interface ResolvedAddonEffectLineV2 {
  addonKey: string;
  /** boolean → 0 or 1; quantity → the clamped/snapped number. */
  multiplier: number;
  timeMinutes: number;
  fixedExclVat: number;
  percent: number;
}

/**
 * The aggregated add-on effects the engine consumes. `addonPercent` is the NET
 * additive percent (e.g. +15 and −10 → +5) and is applied ONCE in the engine,
 * never compounded.
 */
export interface ResolvedAddonEffectsV2 {
  addonMinutes: number;
  addonFixedExclVat: number;
  addonPercent: number;
  lines: ResolvedAddonEffectLineV2[];
}

/**
 * The fully-resolved, customer-facing price range for ONE visible row. Every
 * row (top price, per-visit, four-week period) is produced by the SAME display
 * layer so values can never drift between rows.
 */
export interface DisplayPriceRangeV2 {
  /** Single-point rounded display price (raw, no margins). */
  point: number;
  /** Rounded low end (raw − lower margin). */
  min: number;
  /** Rounded high end (raw + upper margin). */
  max: number;
  /** The rounding interval actually applied (after fallback resolution). */
  effectiveRoundingInterval: number;
}
