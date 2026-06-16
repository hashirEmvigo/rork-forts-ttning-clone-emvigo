// ============================================================================
// Price Calculator — Home Cleaning V2 calculate + submit adapter
// (Slice V2-E2 calculate, Slice V2-E2b submit parity).
// ============================================================================
//
// The PURE bridge that lets the public `calculate` action price `home_cleaning`
// through the Calculator V2 core (canonical config → shared engine → generic
// add-on resolver) while preserving the EXISTING public response contract so the
// result card renders unchanged. It performs NO I/O: the Edge Function loads the
// rows (settings/service/plans/rules/add-ons) with the service role and hands the
// grouped rows here; this module builds the canonical {@link CalculatorServiceConfigV2},
// maps authored `calculator_addons` rows into the V2 add-on config, resolves the
// customer's add-on selections, runs {@link calculateRawV2} for the PER-VISIT raw
// price, multiplies by the four-week visit count, and shapes the public-safe
// {@link PublicCalculateResponse}.
//
// LOCKED V2-E product decisions encoded here:
//   • V2 NEVER reads legacy special add-on rules (addon_hours_*, pet_time_percent,
//     legacy `answers.addons`, has_pets, bathroom/WC rules, size bands, interval
//     time tweaks). Generic add-ons come ONLY from `calculator_addons`, and add-on
//     answers ONLY from `answers.addonSelections`.
//   • Fixed + percent add-ons are PER VISIT: the four-week total = per-visit raw ×
//     visitsPerFourWeeks (weekly 4 / biweekly 2 / every_four_weeks 1; else 1).
//   • `estimatedHours` is the customer-facing PER-VISIT service time
//     (`estimatedServiceHours`) — NEVER `pricingHours` (which folds the plan's
//     price-only start adjustment).
//   • Display rounding source is `settings_json.displayRoundingInterval` (resolved
//     into `config.displayRoundingInterval`). The server returns clean öre-level
//     four-week component totals and sets `roundingIncrement`; the existing client
//     display layer rounds LAST. NO `withRoundingFallback`, NO synthetic rounding,
//     NO active-gated `pricing_rules.rounding_increment`.
//
// SCOPE: Home Cleaning `calculate` (Slice V2-E2) AND `submit` (Slice V2-E2b) both
// route through the SAME V2 core ({@link runCalculationV2Home}), so the public
// quote, the frozen submit snapshot, and the Admin request view can never diverge:
// {@link prepareSubmissionV2Home} recomputes with the SAME function the calculate
// path uses and freezes its result. Only `home_cleaning` may enter (see
// {@link V2_ENABLED_SERVICE_KEYS}); office/move-out/deep stay legacy. The submit
// path REUSES the legacy prospect + answer-freezing helpers (buildProspectWrite /
// buildAnswerWrites) and the legacy disabled-gate response — only the price,
// snapshot, and quote_request payload are V2-specific.
// ============================================================================

import {
  buildServiceConfigV2,
  calculateRawV2,
  resolveAddonEffects,
} from "./v2/index.ts";
import type {
  AddonSelectionsV2,
  CalculatorAddonConfigV2,
  CalculatorServiceConfigV2,
  PlanRowV2,
  PricingRuleRowV2,
  RawCalculationResultV2,
  ResolvedAddonEffectLineV2,
  ResolvedAddonEffectsV2,
} from "./v2/index.ts";
import {
  buildAnswerWrites,
  buildDisabledSubmitResponse,
  buildProspectWrite,
  resolveDefaultQuoteStatus,
} from "./publicCalculator.ts";
import type { SubmitParts } from "./publicCalculator.ts";
import type {
  CalculatorAnswers,
  CalculatorServiceRow,
  CalculatorSettingsRow,
  CleaningPlanRow,
  ExistingProspect,
  PreparedSubmission,
  PriceDisplayMode,
  PriceIssue,
  PricingModel,
  PricingRuleRow,
  ReportedPricingModel,
  ProspectWrite,
  PublicCalculateRequest,
  PublicCalculateResponse,
  PublicSelectedPlan,
  PublicSubmitNextStep,
  PublicSubmitRequest,
  PublicSubmitResponse,
  QuoteRequestWrite,
  V2CalculateDebug,
} from "./types.ts";

// ── Rollout guard ────────────────────────────────────────────────────────────

/**
 * The ONLY service keys allowed to route through the Calculator V2 calculate path
 * in this slice. Everything else (office_cleaning, move_out_cleaning,
 * deep_cleaning / storstädning, future services) stays on the legacy engine.
 * Rollback = empty this set and redeploy.
 */
export const V2_ENABLED_SERVICE_KEYS: ReadonlySet<string> = new Set<string>([
  "home_cleaning",
]);

// ── Generic public runtime routing guard (GPM-5b-1) ──────────────────────────
//
// Lets the public calculate + submit paths route an ADMIN-CREATED generic service
// stored with the LITERAL pricing_model `sqm_fixed` through the SAME V2 core that
// prices Home — but ONLY when the service is public/published AND V2-ready. The
// Home pilot keeps routing via {@link V2_ENABLED_SERVICE_KEYS} unchanged. This is
// the first generic public-runtime step: `hourly_by_area` and the reserved models
// (unit_based / fixed_package / manual_quote) are NOT routed yet.
//
// Hard rules (mirrored by the routing tests):
//   • LITERAL `sqm_fixed` ONLY — never alias-resolved, so a legacy service-named
//     model that maps to sqm_fixed (e.g. move_out_fixed_plus_addons) is NOT routed
//     here; live Office/Move-out stay on the legacy engine.
//   • Public/published ONLY (enabled OR coming_soon) — a draft/non-public service
//     can never be priced by the public calculate/submit path.
//   • No error-severity config blockers, at least one active plan, and the
//     default/selected plan must carry a positive price per m².
//   • No silent fallback to Home/hourly: an unready service simply does not route
//     and the caller falls through to the legacy path, which returns a safe invalid
//     response and writes nothing.

/** Why a service did (`ok`) or did not route to the generic V2 runtime. */
export type GenericRuntimeRoutingReason =
  | "ok"
  | "no_service"
  | "not_literal_sqm_fixed"
  | "not_public"
  | "config_error"
  | "no_active_plan"
  | "missing_price_per_sqm";

/** The outcome of assessing whether a generic service may be priced by V2 at runtime. */
export interface GenericServiceRuntimeReadiness {
  /** True ONLY for a public/ready LITERAL generic `sqm_fixed` service. */
  ready: boolean;
  /** Machine reason (for logging + tests). */
  reason: GenericRuntimeRoutingReason;
  /** Resolved V2 basis when ready (always "sqm_fixed" in this slice), else null. */
  basis: "sqm_fixed" | null;
}

/** Pre-loaded rows for a runtime-routing assessment (no I/O happens here). */
export interface GenericRuntimeRoutingParts {
  /** The matched calculator_services row, or null when no service matched. */
  service: CalculatorServiceRow | null;
  /** Company cleaning_plans rows (scoped to the service inside). */
  plans: readonly CleaningPlanRow[];
  /** The service's active pricing_rules (unused by sqm_fixed; threaded for config-mapping parity). */
  rules: readonly PricingRuleRow[];
  /** Central fallbacks; do not affect readiness, threaded only for config-mapping parity. */
  defaults?: { defaultVatRatePercent?: number | null; currency?: string };
}

/**
 * Assesses whether an admin-created generic service may be priced by the V2 runtime
 * (GPM-5b-1: LITERAL `sqm_fixed` only). Pure + deterministic; never throws. Returns a
 * structured decision so the Edge Function can log the reason and tests can assert it.
 */
export function assessGenericServiceRuntimeReadiness(
  parts: GenericRuntimeRoutingParts,
): GenericServiceRuntimeReadiness {
  const { service } = parts;
  if (!service) return { ready: false, reason: "no_service", basis: null };

  // LITERAL generic sqm_fixed ONLY — never alias-resolved.
  if (service.pricing_model !== "sqm_fixed") {
    return { ready: false, reason: "not_literal_sqm_fixed", basis: null };
  }

  // Public/published per the current config rules (enabled OR coming_soon).
  const isPublic = service.enabled === true || service.coming_soon === true;
  if (!isPublic) return { ready: false, reason: "not_public", basis: null };

  // Canonical config from SERVICE-SCOPED plans (same scoping the V2 core uses).
  const servicePlans = parts.plans.filter(
    (p) => (p.service_key ?? "home_cleaning") === service.service_key,
  );
  const { config, issues } = buildServiceConfigV2({
    service,
    plans: servicePlans as readonly PlanRowV2[],
    pricingRules: parts.rules as readonly PricingRuleRowV2[],
    defaults: {
      defaultVatRatePercent:
        typeof parts.defaults?.defaultVatRatePercent === "number"
          ? parts.defaults.defaultVatRatePercent
          : undefined,
      currency: parts.defaults?.currency,
    },
  });

  // Defensive: a literal sqm_fixed service must resolve to the sqm_fixed basis.
  if (config.pricingBasis !== "sqm_fixed") {
    return { ready: false, reason: "config_error", basis: null };
  }

  // At least one active plan, and the default/selected plan must carry a positive
  // price per m² (the figure the sqm_fixed engine multiplies by area).
  const activePlans = config.plans.filter((p) => p.active);
  if (activePlans.length === 0) {
    return { ready: false, reason: "no_active_plan", basis: null };
  }
  const defaultPlan = activePlans.find((p) => p.isDefault) ?? activePlans[0];
  const pricePerSqm = defaultPlan.pricePerSqmExclVat;
  if (!(typeof pricePerSqm === "number" && pricePerSqm > 0)) {
    return { ready: false, reason: "missing_price_per_sqm", basis: null };
  }

  // Catch-all: any remaining error-severity config blocker keeps the service off V2.
  if (issues.some((i) => i.severity === "error")) {
    return { ready: false, reason: "config_error", basis: null };
  }

  return { ready: true, reason: "ok", basis: "sqm_fixed" };
}

/**
 * The single routing predicate the Edge Function calls for BOTH calculate and submit:
 * a service routes to Calculator V2 when it is the Home pilot
 * ({@link V2_ENABLED_SERVICE_KEYS} — unchanged behaviour, routes regardless of generic
 * readiness) OR a public/ready LITERAL generic `sqm_fixed` service (GPM-5b-1). Pure +
 * deterministic; never throws.
 */
export function shouldRouteServiceToV2(
  parts: GenericRuntimeRoutingParts & { serviceKey: string },
): boolean {
  const { service, serviceKey } = parts;
  if (!service) return false;
  if (V2_ENABLED_SERVICE_KEYS.has(serviceKey)) return true;
  return assessGenericServiceRuntimeReadiness(parts).ready;
}

/**
 * Visits per FOUR-WEEK period implied by the home cleaning interval. Mirrors the
 * legacy engine's `HOME_VISITS_PER_FOUR_WEEKS` and the public UI's
 * `HOME_VISITS_PER_FOUR_WEEKS_UI` so the four-week total (and the client's
 * per-visit split = four-week ÷ visits) stays consistent. Unknown/absent → 1.
 */
export const HOME_VISITS_PER_FOUR_WEEKS_V2: Readonly<Record<string, number>> = {
  weekly: 4,
  biweekly: 2,
  every_four_weeks: 1,
};

/** Formula tag stamped on V2 calculate responses (distinct from the legacy "v1"). */
const FORMULA_VERSION_V2 = "v2" as const;

/** Hard cap on accepted add-on selections (defensive bound for the public surface). */
const MAX_ADDON_SELECTIONS = 100;

const PRICE_DISPLAY_MODES: readonly PriceDisplayMode[] = ["exact", "range", "hidden_until_submit"];
/**
 * Pricing-model strings the V2 adapter may STAMP on a response / frozen snapshot:
 * the three legacy engine models PLUS the literal generic `sqm_fixed` (GPM-5b-1),
 * which V2 now prices for admin-created generic services. Anything else is reported
 * as null rather than leaking an arbitrary string. This is reporting-only; the
 * legacy engine still switches solely on {@link PricingModel}.
 */
const REPORTABLE_PRICING_MODELS: readonly ReportedPricingModel[] = [
  "home_cleaning_recommended_hours",
  "move_out_fixed_plus_addons",
  "office_cleaning_recurring_area_frequency",
  "sqm_fixed",
];

// ── Coercion helpers (loosely-typed rows/answers from JSON/Postgres) ─────────

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Rounds to öre (2 decimals) to tame float noise. NOT display rounding. */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Coerces an answer to a finite number, tolerating Swedish "1 200,5" style input. */
function coerceNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const cleaned = value.trim().replace(/\s/g, "").replace(",", ".");
    if (cleaned === "") return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Numeric column (Postgres `numeric` arrives as text) → finite number or null. */
function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function numberOrDefault(value: unknown, fallback: number): number {
  const n = numberOrNull(value);
  return n === null ? fallback : n;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() !== "" ? value : fallback;
}

function resolvePriceDisplayModeV2(value: unknown): PriceDisplayMode {
  return typeof value === "string" && (PRICE_DISPLAY_MODES as readonly string[]).includes(value)
    ? (value as PriceDisplayMode)
    : "range";
}

/** Resolves the stored pricing_model to the value V2 reports, or null when unrecognized. */
function resolveReportedPricingModel(value: unknown): ReportedPricingModel | null {
  return typeof value === "string" && (REPORTABLE_PRICING_MODELS as readonly string[]).includes(value)
    ? (value as ReportedPricingModel)
    : null;
}

/** Resolves the four-week visit multiplier from the `frequency` answer. */
export function resolveVisitsPerFourWeeks(frequency: unknown): number {
  const key = typeof frequency === "string" ? frequency.trim().toLowerCase() : "";
  return HOME_VISITS_PER_FOUR_WEEKS_V2[key] ?? 1;
}

// ── Add-on selections (clean V2 namespace: answers.addonSelections) ──────────

/**
 * Extracts the customer's add-on selections from `answers.addonSelections` into a
 * clean {@link AddonSelectionsV2} map. Tolerant + defensive: keeps booleans and
 * finite numbers, coerces string-encoded booleans/numbers, and DROPS anything
 * else (objects, arrays, NaN). Never reads legacy `answers.addons`. The pure
 * resolver additionally ignores unknown keys + inactive add-ons, so a malformed
 * client payload can never crash or mis-price the calculation.
 */
export function coerceAddonSelections(rawAnswers: unknown): AddonSelectionsV2 {
  const answers = asRecord(rawAnswers);
  const rawSelections = asRecord(answers.addonSelections);
  const out: AddonSelectionsV2 = {};
  let count = 0;

  for (const [key, value] of Object.entries(rawSelections)) {
    if (count >= MAX_ADDON_SELECTIONS) break;
    if (typeof key !== "string" || key.length === 0 || key.length > 200) continue;

    if (typeof value === "boolean") {
      out[key] = value;
      count += 1;
    } else if (typeof value === "number" && Number.isFinite(value)) {
      out[key] = value;
      count += 1;
    } else if (typeof value === "string" && value.trim() !== "") {
      const v = value.trim().toLowerCase();
      if (v === "true" || v === "yes" || v === "ja") {
        out[key] = true;
        count += 1;
      } else if (v === "false" || v === "no" || v === "nej") {
        out[key] = false;
        count += 1;
      } else {
        const n = coerceNumber(value);
        if (n !== null) {
          out[key] = n;
          count += 1;
        }
      }
    }
    // Other types (objects/arrays/null) are ignored safely.
  }
  return out;
}

// ── Add-on rows → canonical V2 add-on config ─────────────────────────────────

/**
 * A `calculator_addons` row, as loaded by the Edge Function for the matched
 * service (active + not soft-deleted). `numeric` columns arrive as text from
 * Postgres, hence the loose `number | string | null` typing.
 */
export interface CalculatorAddonRowV2 {
  addon_key: string;
  name: string;
  public_label: string;
  description?: string | null;
  input_type: string;
  boolean_default?: boolean | null;
  quantity_min?: number | string | null;
  quantity_max?: number | string | null;
  quantity_step?: number | string | null;
  quantity_default?: number | string | null;
  effect_time_minutes?: number | string | null;
  effect_fixed_excl_vat?: number | string | null;
  effect_percent?: number | string | null;
  active?: boolean | null;
  public_visible?: boolean | null;
  required?: boolean | null;
  sort_order?: number | string | null;
}

/**
 * Maps loaded `calculator_addons` rows into canonical {@link CalculatorAddonConfigV2}
 * definitions. Pure column→field normalization (snake_case → camelCase) with
 * defensive numeric coercion and the same defaults the DB CHECK constraints
 * enforce (quantity_min ≥ 0, quantity_step > 0). `input_type` is clamped to the
 * only two persisted types; anything unexpected falls back to "boolean".
 */
export function mapAddonRowsToConfigV2(
  rows: readonly CalculatorAddonRowV2[],
): CalculatorAddonConfigV2[] {
  return rows.map((row): CalculatorAddonConfigV2 => {
    const step = numberOrNull(row.quantity_step);
    return {
      addonKey: row.addon_key,
      name: stringOr(row.name, row.addon_key),
      publicLabel: stringOr(row.public_label, stringOr(row.name, row.addon_key)),
      description: typeof row.description === "string" ? row.description : null,
      inputType: row.input_type === "quantity" ? "quantity" : "boolean",
      booleanDefault: row.boolean_default === true,
      quantityMin: Math.max(0, numberOrDefault(row.quantity_min, 0)),
      quantityMax: numberOrNull(row.quantity_max),
      quantityStep: step !== null && step > 0 ? step : 1,
      quantityDefault: numberOrDefault(row.quantity_default, 0),
      effectTimeMinutes: numberOrDefault(row.effect_time_minutes, 0),
      effectFixedExclVat: numberOrDefault(row.effect_fixed_excl_vat, 0),
      effectPercent: numberOrDefault(row.effect_percent, 0),
      active: row.active !== false,
      publicVisible: row.public_visible !== false,
      required: row.required === true,
      sortOrder: numberOrDefault(row.sort_order, 0),
    };
  });
}

// ── Display text (faithful to the legacy buildResultDisplayText output) ──────

function currencySuffix(currency: string): string {
  return currency === "SEK" ? "kr" : currency;
}

function groupDigits(amount: number): string {
  const rounded = Math.round(amount);
  const sign = rounded < 0 ? "-" : "";
  return sign + Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/**
 * Builds the customer-facing price text, mirroring the legacy engine's
 * {@link buildResultDisplayText} so the result card's `hasNumber` gate + text
 * fallback behave identically. The client re-derives the toggle-aware rounded
 * range from the component fields; this text is the fallback + non-empty signal.
 */
function buildDisplayText(
  mode: PriceDisplayMode,
  currency: string,
  calculatedPrice: number,
  minPrice: number,
  maxPrice: number,
): string {
  if (mode === "hidden_until_submit") return "Pris visas när du skickat din förfrågan.";
  if (mode === "exact") return `Cirka ${groupDigits(calculatedPrice)} ${currencySuffix(currency)}`;
  if (minPrice === maxPrice) return `Cirka ${groupDigits(minPrice)} ${currencySuffix(currency)}`;
  return `${groupDigits(minPrice)}–${groupDigits(maxPrice)} ${currencySuffix(currency)}`;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

/** Grouped, pre-loaded rows for the Home V2 calculation (no I/O happens here). */
export interface RunCalculationV2HomeParts {
  /** Subset of the calculator_settings row the calculate path selects. */
  settings: Pick<
    CalculatorSettingsRow,
    "currency" | "price_display_mode" | "enabled" | "default_vat_rate_percent"
  >;
  /** The matched calculator_services row (carries settings_json for V2 config). */
  service: CalculatorServiceRow;
  /** Company cleaning_plans rows (filtered to this service inside). Must include the V2 columns. */
  plans: readonly CleaningPlanRow[];
  /** This service's active pricing_rules (m² time + range margins only in V2). */
  rules: readonly PricingRuleRow[];
  /** Active, non-deleted calculator_addons rows for this service. */
  addons: readonly CalculatorAddonRowV2[];
  /** The validated calculate request (serviceKey/answers/cleaningPlanKey). */
  request: PublicCalculateRequest;
  /** Sanitized add-on selections (extracted from the RAW body, since coerceAnswers strips nested objects). */
  addonSelections: AddonSelectionsV2;
}

/** Assembles the additive V2 debug block (ignored by the public client normalizer). */
function buildDebug(
  config: CalculatorServiceConfigV2,
  raw: RawCalculationResultV2,
  effects: ResolvedAddonEffectsV2,
  visitsPerFourWeeks: number,
  fourWeekRawExclVat: number | null,
): V2CalculateDebug {
  return {
    pricingBasis: config.pricingBasis,
    selectedPlanKey: raw.selectedPlanKey,
    estimatedServiceHours: raw.estimatedServiceHours,
    pricingHours: raw.pricingHours,
    addonMinutes: effects.addonMinutes,
    addonFixedExclVat: effects.addonFixedExclVat,
    addonPercent: effects.addonPercent,
    displayRoundingInterval: config.displayRoundingInterval,
    rawPriceExclVat: raw.rawPriceExclVat,
    visitsPerFourWeeks,
    fourWeekRawExclVat,
  };
}

/** Builds the public-safe selected-plan summary from the canonical config. */
function buildSelectedPlan(
  config: CalculatorServiceConfigV2,
  selectedPlanKey: string | null,
  tax: { vatRatePercent: number; rutEnabled: boolean; rutPercent: number },
): PublicSelectedPlan | null {
  if (!selectedPlanKey) return null;
  const plan = config.plans.find((p) => p.planKey === selectedPlanKey);
  if (!plan) return null;
  return {
    planKey: plan.planKey,
    name: plan.label,
    hourlyRate: plan.hourlyRateExclVat ?? 0,
    vatRatePercent: tax.vatRatePercent,
    rutEnabled: tax.rutEnabled,
    rutPercent: tax.rutPercent,
    showRutBreakdown: tax.rutEnabled,
  };
}

/**
 * Prices `home_cleaning` through Calculator V2 and shapes the existing public
 * calculate response. Never throws: an invalid engine result maps to the standard
 * invalid response (null prices) so the result card renders a clean "cannot price
 * yet" state. The client price is never trusted — everything is computed here from
 * the loaded rows.
 */
export function runCalculationV2Home(parts: RunCalculationV2HomeParts): PublicCalculateResponse {
  const { settings, service, plans, rules, addons, request, addonSelections } = parts;

  const currency = settings.currency ?? "SEK";
  const priceDisplayMode = resolvePriceDisplayModeV2(settings.price_display_mode);
  const enabled = Boolean(settings.enabled);

  // 1. Canonical V2 config — service-scoped plans only (the calculate path loads
  //    all company plans). settings_json on the SERVICE row carries
  //    displayRoundingInterval + homeSqmAdjustments + VAT/RUT presentation.
  const servicePlans = plans.filter(
    (p) => (p.service_key ?? "home_cleaning") === service.service_key,
  );
  const { config: baseConfig } = buildServiceConfigV2({
    service,
    plans: servicePlans as readonly PlanRowV2[],
    pricingRules: rules as readonly PricingRuleRowV2[],
    defaults: {
      defaultVatRatePercent: coerceNumber(settings.default_vat_rate_percent) ?? 25,
      currency,
    },
  });

  // 2. Map authored add-on rows into the canonical add-on config (generic engine).
  const config: CalculatorServiceConfigV2 = {
    ...baseConfig,
    addons: mapAddonRowsToConfigV2(addons),
  };

  // 3 + 4. Resolve add-on effects from the sanitized selections.
  const effects = resolveAddonEffects(config.addons, addonSelections);

  // 5. Shared engine → PER-VISIT raw price + customer-facing service time.
  const sqm = coerceNumber(request.answers.sqm);
  const raw = calculateRawV2({
    config,
    sqm,
    requestedPlanKey: request.cleaningPlanKey ?? null,
    addonMinutes: effects.addonMinutes,
    addonFixedExclVat: effects.addonFixedExclVat,
    addonPercent: effects.addonPercent,
  });

  // 6. Four-week multiplier from the recurring interval.
  const visitsPerFourWeeks = resolveVisitsPerFourWeeks(request.answers.frequency);
  const pricingModel = resolveReportedPricingModel(service.pricing_model);

  // Invalid → no price (preserves the existing invalid response shape).
  if (!raw.valid || raw.rawPriceExclVat === null) {
    return {
      ok: true,
      enabled,
      valid: false,
      issues: raw.issues,
      serviceKey: config.serviceKey,
      pricingModel,
      formulaVersion: FORMULA_VERSION_V2,
      currency,
      priceDisplayMode,
      estimatedHours: raw.estimatedServiceHours,
      calculatedPrice: null,
      minPrice: null,
      maxPrice: null,
      priceExclVat: null,
      vatRatePercent: config.vat.ratePercent,
      vatAmount: null,
      priceInclVat: null,
      rutEnabled: false,
      rutPercent: config.rut.percent,
      showRutBreakdown: false,
      rutDeduction: null,
      priceAfterRut: null,
      roundingIncrement: config.displayRoundingInterval,
      displayText: "",
      selectedPlan: null,
      v2: buildDebug(config, raw, effects, visitsPerFourWeeks, null),
    };
  }

  // 7. Per-visit raw → four-week raw (excl VAT). Fixed/percent add-ons are already
  //    baked into the per-visit raw by the engine, so they scale per visit too.
  const fourWeekRawExclVat = round2(raw.rawPriceExclVat * visitsPerFourWeeks);

  // VAT/RUT/margins from the canonical config's DEFAULT display mode.
  const vatRatePercent = config.vat.ratePercent;
  const rutEnabled = config.rut.eligible && config.rut.enabledByDefault;
  const rutPercent = config.rut.percent;
  const lowerMargin = config.margins.lowerPercent;
  const upperMargin = config.margins.upperPercent;

  // Component math — öre-level ONLY. Display rounding happens LAST on the client
  // using `roundingIncrement`. The server never display-rounds (the V2 fix: VAT/RUT
  // first, rounding last), and no legacy rounding fallback is involved.
  const priceExclVat = round2(fourWeekRawExclVat);
  const minPriceExclVat = round2(fourWeekRawExclVat * (1 - lowerMargin / 100));
  const maxPriceExclVat = round2(fourWeekRawExclVat * (1 + upperMargin / 100));

  const vatAmount = round2(priceExclVat * (vatRatePercent / 100));
  const priceInclVat = round2(priceExclVat + vatAmount);
  const rutDeduction = rutEnabled ? round2(priceInclVat * (rutPercent / 100)) : 0;
  const priceAfterRut = round2(Math.max(0, priceInclVat - rutDeduction));

  // Customer-facing price for a given excl-VAT amount (incl VAT, after RUT when on).
  const customerPrice = (exclVat: number): number => {
    const incl = round2(exclVat * (1 + vatRatePercent / 100));
    if (!rutEnabled) return incl;
    const ded = round2(incl * (rutPercent / 100));
    return round2(Math.max(0, incl - ded));
  };
  const calculatedPrice = customerPrice(priceExclVat);
  const minPrice = customerPrice(minPriceExclVat);
  const maxPrice = customerPrice(maxPriceExclVat);

  return {
    ok: true,
    enabled,
    valid: true,
    issues: [],
    serviceKey: config.serviceKey,
    pricingModel,
    formulaVersion: FORMULA_VERSION_V2,
    currency,
    priceDisplayMode,
    // PER-VISIT service time — never pricingHours (which folds the plan start adj).
    estimatedHours: raw.estimatedServiceHours,
    calculatedPrice,
    minPrice,
    maxPrice,
    priceExclVat,
    vatRatePercent,
    vatAmount,
    priceInclVat,
    rutEnabled,
    rutPercent,
    showRutBreakdown: rutEnabled,
    rutDeduction,
    priceAfterRut,
    roundingIncrement: config.displayRoundingInterval,
    displayText: buildDisplayText(priceDisplayMode, currency, calculatedPrice, minPrice, maxPrice),
    selectedPlan: buildSelectedPlan(config, raw.selectedPlanKey, {
      vatRatePercent,
      rutEnabled,
      rutPercent,
    }),
    v2: buildDebug(config, raw, effects, visitsPerFourWeeks, fourWeekRawExclVat),
  };
}

// ── Submit parity (Slice V2-E2b) ─────────────────────────────────────────────
//
// Home Cleaning submit/freeze/snapshot runs through the SAME {@link runCalculationV2Home}
// core as calculate, so the public quote, the frozen quote_requests snapshot, and the
// Admin request view can never diverge. The Edge Function loads the same rows it loads
// for the calculate branch (plus the FULL settings row + questions + existing prospect),
// hands them here, and this pure function builds the prospect/quote/answer payloads.
// The prospect + answer-freezing logic and the disabled-gate response are REUSED from
// the legacy module; only the price, the frozen snapshot, and the quote_request payload
// are V2-specific. Returns the standard {@link PreparedSubmission} so the Edge Function's
// ordered-write code (prospect → quote_request → answers) is reused UNCHANGED.

/** One day in milliseconds — for the quote validity window. */
const MS_PER_DAY = 86_400_000;

/** Grouped, pre-loaded rows for the Home V2 submit (no I/O happens here). Same parts as
 *  the legacy {@link SubmitParts} plus the generic add-on rows + sanitized selections. */
export interface SubmitV2HomeParts extends SubmitParts {
  /** Active, non-deleted calculator_addons rows for this service (same as the calculate branch). */
  addons: readonly CalculatorAddonRowV2[];
  /** Sanitized add-on selections (from coerceAddonSelections on the RAW body — coerceAnswers strips nested objects). */
  addonSelections: AddonSelectionsV2;
}

/**
 * The frozen V2 pricing snapshot persisted to quote_requests.pricing_snapshot_json.
 * A superset of the keys {@link extractSnapshotSummary} reads (formulaVersion /
 * pricingModel / selectedPlanSnapshot / estimatedHours / calculatedPrice / minPrice /
 * maxPrice) so the Admin request view renders UNCHANGED, plus the V2 historical truth
 * (pricing-time vs service-time split, generic add-on effects, four-week multiplier,
 * rounding source) and the add-on selection trace.
 */
export interface StoredPricingSnapshotV2 {
  formulaVersion: "v2";
  pricingModel: ReportedPricingModel | null;
  serviceKey: string;
  currency: string;
  priceDisplayMode: PriceDisplayMode;
  /** Admin-compatible plan summary (extractSnapshotSummary reads planKey/name/hourlyRate). */
  selectedPlanSnapshot: {
    planKey: string;
    name: string;
    hourlyRate: number;
    vatRatePercent: number;
    rutEnabled: boolean;
    rutPercent: number;
    showRutBreakdown: boolean;
  } | null;
  /** Per-visit service time (hours) — NEVER pricingHours. Mirrors the response's estimatedHours. */
  estimatedHours: number | null;
  /** Four-week totals (same figures the public quote + quote columns carry). */
  calculatedPrice: number;
  minPrice: number;
  maxPrice: number;
  priceExclVat: number;
  vatRatePercent: number;
  vatAmount: number;
  priceInclVat: number;
  rutEnabled: boolean;
  rutPercent: number;
  showRutBreakdown: boolean;
  rutDeduction: number;
  priceAfterRut: number;
  // ── V2 historical truth ──
  pricingBasis: "hourly" | "sqm_fixed";
  selectedPlanKey: string | null;
  /** Per-visit customer-facing service time (= estimatedHours). */
  estimatedServiceHours: number | null;
  /** Per-visit internal price-only time (folds the plan start adjustment). */
  pricingHours: number | null;
  addonMinutes: number;
  addonFixedExclVat: number;
  addonPercent: number;
  displayRoundingInterval: number | null;
  /** Per-visit raw price excl VAT (before the four-week multiply). */
  rawPriceExclVat: number | null;
  visitsPerFourWeeks: number;
  fourWeekRawExclVat: number | null;
  // ── Add-on traceability ──
  /** Normalized customer selections (coerced; pre clamp/step). */
  addonSelections: AddonSelectionsV2;
  /** Resolved per-add-on effect lines (clamped/snapped multipliers the price used). */
  addonEffectLines: ResolvedAddonEffectLineV2[];
  /** The validated answers that fed the calculation (historical truth). */
  inputs: CalculatorAnswers;
  submittedAt: string;
}

/** Internal builder result mirroring the legacy QuoteRequestBuild shape. */
interface QuoteRequestBuildV2 {
  quoteRequest: QuoteRequestWrite;
  status: string;
  validUntil: string | null;
  requiresManualReview: boolean;
}

/** Reads a string from settings.content, falling back when missing/blank (mirrors the legacy contentText). */
function contentTextV2(content: unknown, key: string, fallback: string): string {
  const v = asRecord(content)[key];
  return typeof v === "string" && v.trim() !== "" ? v : fallback;
}

/** An enabled-but-rejected submit response (validation/recompute failed). Writes NOTHING. */
function buildInvalidSubmitResponseV2(
  request: PublicSubmitRequest,
  settings: Pick<CalculatorSettingsRow, "currency" | "price_display_mode" | "default_vat_rate_percent">,
  pricingModel: ReportedPricingModel | null,
  issues: PriceIssue[],
): PublicSubmitResponse {
  return {
    ok: true,
    enabled: true,
    available: true,
    status: null,
    valid: false,
    issues,
    serviceKey: request.serviceKey,
    pricingModel,
    formulaVersion: FORMULA_VERSION_V2,
    currency: settings.currency ?? "SEK",
    priceDisplayMode: resolvePriceDisplayModeV2(settings.price_display_mode),
    estimatedHours: null,
    calculatedPrice: null,
    minPrice: null,
    maxPrice: null,
    priceExclVat: null,
    vatRatePercent: coerceNumber(settings.default_vat_rate_percent) ?? 25,
    vatAmount: null,
    priceInclVat: null,
    rutEnabled: false,
    rutPercent: 50,
    showRutBreakdown: false,
    rutDeduction: null,
    priceAfterRut: null,
    roundingIncrement: null,
    displayText: "",
    selectedPlan: null,
    quoteRequestLegacyId: null,
    reference: null,
    validUntil: null,
    requiresManualReview: false,
    nextStep: null,
  };
}

/**
 * Freezes the V2 calculate result + generic add-on trace into the stored snapshot.
 * Built ENTIRELY from the {@link runCalculationV2Home} response (`calc`) so the snapshot
 * can never disagree with the public quote. `estimatedHours` is the per-visit SERVICE
 * time; the price fields are four-week totals (consistent with the response + quote row).
 */
function buildStoredSnapshotV2(
  calc: PublicCalculateResponse,
  request: PublicSubmitRequest,
  addonSelections: AddonSelectionsV2,
  addonEffectLines: readonly ResolvedAddonEffectLineV2[],
  now: Date,
): StoredPricingSnapshotV2 {
  const v2 = calc.v2;
  const plan = calc.selectedPlan;
  return {
    formulaVersion: FORMULA_VERSION_V2,
    pricingModel: calc.pricingModel,
    serviceKey: calc.serviceKey,
    currency: calc.currency,
    priceDisplayMode: calc.priceDisplayMode,
    selectedPlanSnapshot: plan
      ? {
          planKey: plan.planKey,
          name: plan.name,
          hourlyRate: plan.hourlyRate,
          vatRatePercent: plan.vatRatePercent,
          rutEnabled: plan.rutEnabled,
          rutPercent: plan.rutPercent,
          showRutBreakdown: plan.showRutBreakdown,
        }
      : null,
    estimatedHours: calc.estimatedHours,
    calculatedPrice: calc.calculatedPrice ?? 0,
    minPrice: calc.minPrice ?? 0,
    maxPrice: calc.maxPrice ?? 0,
    priceExclVat: calc.priceExclVat ?? 0,
    vatRatePercent: calc.vatRatePercent,
    vatAmount: calc.vatAmount ?? 0,
    priceInclVat: calc.priceInclVat ?? 0,
    rutEnabled: calc.rutEnabled,
    rutPercent: calc.rutPercent,
    showRutBreakdown: calc.showRutBreakdown,
    rutDeduction: calc.rutDeduction ?? 0,
    priceAfterRut: calc.priceAfterRut ?? 0,
    pricingBasis: v2?.pricingBasis ?? "hourly",
    selectedPlanKey: v2?.selectedPlanKey ?? plan?.planKey ?? null,
    estimatedServiceHours: v2?.estimatedServiceHours ?? calc.estimatedHours,
    pricingHours: v2?.pricingHours ?? null,
    addonMinutes: v2?.addonMinutes ?? 0,
    addonFixedExclVat: v2?.addonFixedExclVat ?? 0,
    addonPercent: v2?.addonPercent ?? 0,
    displayRoundingInterval: v2?.displayRoundingInterval ?? calc.roundingIncrement,
    rawPriceExclVat: v2?.rawPriceExclVat ?? null,
    visitsPerFourWeeks: v2?.visitsPerFourWeeks ?? 1,
    fourWeekRawExclVat: v2?.fourWeekRawExclVat ?? null,
    addonSelections,
    addonEffectLines: [...addonEffectLines],
    inputs: request.answers,
    submittedAt: now.toISOString(),
  };
}

/**
 * Builds the quote_requests payload from the V2 calculate result + the frozen snapshot.
 * `formula_version` is "v2", `estimated_hours` is the per-visit SERVICE time (never
 * pricingHours), and the prices are the four-week totals. Status/validity/manual-review
 * follow the SAME settings the legacy path uses (resolveDefaultQuoteStatus +
 * quote_validity_days + manual_review_threshold_amount). A priced V2 quote is only
 * FLAGGED for manual review over the threshold — it is never turned priceless.
 */
function buildQuoteRequestWriteV2(
  parts: SubmitV2HomeParts,
  calc: PublicCalculateResponse,
  snapshot: StoredPricingSnapshotV2,
  prospect: ProspectWrite,
): QuoteRequestBuildV2 {
  const { settings, service, plans, request, now, newId } = parts;
  const c = request.contact;
  const status = resolveDefaultQuoteStatus(settings.default_quote_status);
  const validityDays = numberOrNull(settings.quote_validity_days) ?? 0;
  const validUntil =
    validityDays > 0 ? new Date(now.getTime() + validityDays * MS_PER_DAY).toISOString() : null;
  const threshold = numberOrNull(settings.manual_review_threshold_amount);
  const calculatedPrice = calc.calculatedPrice ?? 0;
  const requiresManualReview = threshold !== null && calculatedPrice >= threshold;

  // Resolve the selected plan's uuid from the loaded rows (the V2 PublicSelectedPlan
  // carries only the stable plan key) so the quote keeps its plan link, like legacy.
  const selectedPlanKey = calc.v2?.selectedPlanKey ?? calc.selectedPlan?.planKey ?? null;
  const serviceKey = service?.service_key ?? "home_cleaning";
  const selectedPlanRow = selectedPlanKey
    ? plans.find(
        (p) => (p.service_key ?? "home_cleaning") === serviceKey && p.plan_key === selectedPlanKey,
      ) ?? null
    : null;
  const legacyId = newId("qr");

  const fields: Record<string, unknown> = {
    legacy_id: legacyId,
    company_id: settings.company_id,
    company_legacy_id: settings.company_legacy_id,
    prospect_legacy_id: prospect.legacyId,
    customer_id: null,
    calculator_service_id: service ? service.id : null,
    calculator_service_key: request.serviceKey,
    selected_cleaning_plan_id: selectedPlanRow?.id ?? null,
    selected_cleaning_plan_name: calc.selectedPlan?.name ?? null,
    selected_cleaning_plan_hourly_rate: calc.selectedPlan?.hourlyRate ?? null,
    // Per-visit SERVICE time — never pricingHours.
    estimated_hours: calc.estimatedHours,
    calculated_price: calc.calculatedPrice,
    min_price: calc.minPrice,
    max_price: calc.maxPrice,
    currency: calc.currency,
    price_display_mode: calc.priceDisplayMode,
    pricing_model: calc.pricingModel,
    formula_version: calc.formulaVersion,
    pricing_snapshot_json: snapshot,
    status,
    source: "price_calculator",
    source_url: request.sourceUrl,
    customer_name: c.name,
    customer_email: c.email,
    customer_phone: c.phone,
    address_json: c.postalCode ? { postalCode: c.postalCode } : {},
    valid_until: validUntil,
    requires_manual_review: requiresManualReview,
    reference: null,
  };

  return {
    quoteRequest: { legacyId, prospectLegacyId: prospect.legacyId, fields },
    status,
    validUntil,
    requiresManualReview,
  };
}

/**
 * Builds the public submit response from the V2 calculate response + submit meta.
 * Spreading the SAME `calc` figures guarantees the submit response matches the public
 * quote field-for-field; only the submit-specific fields (available/status/quote id/
 * validity/manual-review/next-step) are added.
 */
function buildSubmitResponseV2(
  parts: SubmitV2HomeParts,
  calc: PublicCalculateResponse,
  meta: { quoteRequestLegacyId: string; status: string; validUntil: string | null; requiresManualReview: boolean },
): PublicSubmitResponse {
  const { settings } = parts;
  const showLoginPrompt = Boolean(settings.show_login_prompt_after_submit);
  const loginText = contentTextV2(settings.content, "loginPromptText", "");
  const nextStep: PublicSubmitNextStep = {
    confirmationText: contentTextV2(
      settings.content,
      "quoteCreatedText",
      "Tack! Din f\u00f6rfr\u00e5gan \u00e4r mottagen. Vi \u00e5terkommer inom kort.",
    ),
    showLoginPrompt,
    loginPromptText: showLoginPrompt && loginText !== "" ? loginText : null,
  };

  return {
    ok: true,
    enabled: true,
    available: true,
    status: meta.status,
    valid: true,
    issues: [],
    serviceKey: calc.serviceKey,
    pricingModel: calc.pricingModel,
    formulaVersion: calc.formulaVersion,
    currency: calc.currency,
    priceDisplayMode: calc.priceDisplayMode,
    estimatedHours: calc.estimatedHours,
    calculatedPrice: calc.calculatedPrice,
    minPrice: calc.minPrice,
    maxPrice: calc.maxPrice,
    priceExclVat: calc.priceExclVat,
    vatRatePercent: calc.vatRatePercent,
    vatAmount: calc.vatAmount,
    priceInclVat: calc.priceInclVat,
    rutEnabled: calc.rutEnabled,
    rutPercent: calc.rutPercent,
    showRutBreakdown: calc.showRutBreakdown,
    rutDeduction: calc.rutDeduction,
    priceAfterRut: calc.priceAfterRut,
    roundingIncrement: calc.roundingIncrement,
    displayText: calc.displayText,
    selectedPlan: calc.selectedPlan,
    quoteRequestLegacyId: meta.quoteRequestLegacyId,
    reference: null,
    validUntil: meta.validUntil,
    requiresManualReview: meta.requiresManualReview,
    nextStep,
  };
}

/**
 * Pure Home Cleaning V2 submit preparation. Order mirrors the legacy {@link prepareSubmission}:
 *   (1) ENABLED gate — dark calculator writes NOTHING (reuses the legacy disabled response);
 *   (2) recompute server-side through the SAME {@link runCalculationV2Home} core as calculate;
 *   (3) reject invalid input / priceless result — write NOTHING;
 *   (4) freeze the V2 snapshot + build the prospect/quote/answer payloads + public response.
 * Returns the standard {@link PreparedSubmission} so the Edge Function performs the ordered
 * writes unchanged. The client price is never read. Home Cleaning is always priceable when
 * valid (no office-style "manual review priceless" path), so a valid quote is always priced.
 */
export function prepareSubmissionV2Home(parts: SubmitV2HomeParts): PreparedSubmission {
  const { settings, service, plans, rules, addons, request, existingProspect, now, addonSelections } = parts;

  // (1) Critical safety rule: never write while the calculator is dark.
  if (!settings.enabled) {
    return { kind: "disabled", response: buildDisabledSubmitResponse(request.serviceKey) };
  }

  // Defensive: the Edge Function only routes a matched home service here, but keep the
  // pure function self-contained so it can never throw on a null service.
  if (!service) {
    return {
      kind: "invalid",
      response: buildInvalidSubmitResponseV2(request, settings, null, [
        {
          code: "service_unavailable",
          field: "serviceKey",
          message: "Den valda tj\u00e4nsten \u00e4r inte tillg\u00e4nglig.",
        },
      ]),
    };
  }

  // (2) Server-authoritative recompute through the SAME V2 core as calculate, so the frozen
  //     snapshot can NEVER diverge from the public quote (parity by construction).
  const calc = runCalculationV2Home({ settings, service, plans, rules, addons, request, addonSelections });

  // (3) Reject invalid inputs / priceless results — nothing is written.
  if (!calc.valid || calc.calculatedPrice === null) {
    return {
      kind: "invalid",
      response: buildInvalidSubmitResponseV2(request, settings, calc.pricingModel, calc.issues),
    };
  }

  // (4) Freeze the snapshot + build write payloads + public response. The add-on effect
  //     lines are re-resolved deterministically from the SAME rows/selections the price
  //     used (pure + identical inputs → identical result) for Admin/history traceability.
  const effects = resolveAddonEffects(mapAddonRowsToConfigV2(addons), addonSelections);
  const snapshot = buildStoredSnapshotV2(calc, request, addonSelections, effects.lines, now);
  const prospect = buildProspectWrite(parts, existingProspect);
  const { quoteRequest, status, validUntil, requiresManualReview } = buildQuoteRequestWriteV2(
    parts,
    calc,
    snapshot,
    prospect,
  );
  const answers = buildAnswerWrites(parts);
  const response = buildSubmitResponseV2(parts, calc, {
    quoteRequestLegacyId: quoteRequest.legacyId,
    status,
    validUntil,
    requiresManualReview,
  });

  return { kind: "ready", prospect, quoteRequest, answers, response };
}
