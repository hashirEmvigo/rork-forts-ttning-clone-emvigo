/**
 * Calculator V2 — ADMIN generic-service readiness + authoring helper (GPM-6-R, GPM-7).
 *
 * Pure, side-effect-free source of truth for how the ADMIN Calculator readiness/
 * health surface treats the ONE engine-backed generic pricing model today: LITERAL
 * `sqm_fixed`. It is the Admin-side counterpart to the Edge Function runtime helper
 * `assessGenericServiceRuntimeReadiness`
 * (supabase/functions/_shared/calculator/publicCalculatorV2.ts) and mirrors its
 * `sqm_fixed` pricing gates so the Admin badge and the public runtime can never
 * disagree about whether a literal `sqm_fixed` service is priceable.
 *
 * Product rules encoded here (GPM-6-R):
 *   • LITERAL `sqm_fixed` is engine-backed — it must NOT read as "Unsupported
 *     pricing" in the Admin readiness/health surface.
 *   • `sqm_fixed` is priced from the plan's price per m² (`pricePerSqmExclVat`),
 *     NEVER from legacy `pricing_rules` — so this helper never consults rules.
 *   • A literal `sqm_fixed` service is priceable only with ≥1 active plan whose
 *     default/selected plan carries a positive price per m² — the same figure the
 *     V2 engine multiplies by area at runtime.
 *   • Reserved generic models (`unit_based`, `fixed_package`, `manual_quote`) and
 *     the unimplemented legacy templates stay NOT engine-backed here; only literal
 *     `sqm_fixed` is matched (legacy `move_out_fixed_plus_addons` aliases to the
 *     sqm_fixed basis but keeps its own unchanged legacy readiness path).
 *
 * Authoring contract added in GPM-7:
 *   • A literal `sqm_fixed` service prices from the customer's AREA answer, which the
 *     V2 runtime reads as `request.answers.sqm` (→ engine `input.sqm`). Its required
 *     PRIMARY INPUT is therefore an ACTIVE question keyed exactly
 *     {@link SQM_FIXED_PRIMARY_INPUT_KEY}. Without it the public engine returns
 *     `missing_sqm`, so Admin readiness must require it too (parity).
 *   • {@link SQM_FIXED_PRIMARY_INPUT_DEFAULT} is the canonical question the Admin
 *     "Add area (m²) input" setup path pre-fills — the one input the engine prices
 *     from. It is presentation/authoring metadata only: nothing here enables,
 *     publishes, or prices a service.
 *
 * This module changes no runtime/engine/Edge Function behaviour. It is consumed
 * only by the Admin readiness/health logic in `calculatorConfigAdmin.ts` and the
 * Admin authoring UI (`ServicesFieldsEditor.tsx`).
 */

/**
 * The single LITERAL generic pricing model the V2 engine prices today
 * (GPM-5b-1: literal `sqm_fixed` only — never an alias-resolved legacy model).
 * Named so Admin readiness/health and the runtime stay in lockstep on the one
 * generic model that is engine-backed.
 */
export const ENGINE_BACKED_GENERIC_PRICING_MODEL = "sqm_fixed" as const;

/**
 * True when a pricing-model string is the LITERAL generic `sqm_fixed` model the V2
 * engine prices today. Deliberately literal: legacy models such as
 * `move_out_fixed_plus_addons` that ALIAS to the sqm_fixed basis are NOT matched
 * here — they keep their own (unchanged) legacy, rule-based readiness path.
 */
export function isEngineBackedGenericPricingModel(model: string): boolean {
  return model === ENGINE_BACKED_GENERIC_PRICING_MODEL;
}

/** Why a literal `sqm_fixed` service is / is not priceable by the Admin readiness gate. */
export type SqmFixedReadinessReason = "ok" | "not_sqm_fixed" | "no_active_plan" | "missing_price_per_sqm";

/**
 * The minimal plan shape the sqm_fixed readiness gate reads — a structural subset of
 * the Admin `CleaningPlanConfig` (and of the runtime plan row). `pricePerSqmExclVat`
 * is optional/nullable so a partially-configured plan is handled defensively.
 */
export interface SqmFixedReadinessPlan {
  active: boolean;
  isDefault: boolean;
  pricePerSqmExclVat?: number | null;
}

/** Structured decision: a boolean priceability gate plus the discrete reason behind it. */
export interface SqmFixedReadiness {
  /** True only for a literal `sqm_fixed` service with an active, positively-priced default plan. */
  priceable: boolean;
  reason: SqmFixedReadinessReason;
}

/**
 * Assesses whether a literal `sqm_fixed` service is priceable from its plans, using
 * the SAME gates as the runtime `assessGenericServiceRuntimeReadiness`: a literal
 * `sqm_fixed` model, ≥1 active plan, and a default/selected active plan carrying a
 * positive price per m². Pure + deterministic; never throws.
 *
 * It deliberately OMITS the runtime's public (enabled/coming_soon) gate because
 * Admin readiness reports structural completeness (Ready vs Draft) independently of
 * whether the service is currently public — the Admin caller decides Ready vs Draft
 * from the enabled flag once this gate passes.
 *
 * `servicePlans` MUST already be scoped to the service (the caller filters by
 * serviceKey), matching the runtime's service-scoped plan selection.
 */
export function assessSqmFixedReadiness(
  pricingModel: string,
  servicePlans: readonly SqmFixedReadinessPlan[],
): SqmFixedReadiness {
  if (!isEngineBackedGenericPricingModel(pricingModel)) {
    return { priceable: false, reason: "not_sqm_fixed" };
  }

  const activePlans = servicePlans.filter((p) => p.active);
  if (activePlans.length === 0) {
    return { priceable: false, reason: "no_active_plan" };
  }

  // Same default/selected-plan rule the runtime uses: the default plan wins, else the
  // first active plan. Its price per m² is the figure the sqm_fixed engine multiplies.
  const defaultPlan = activePlans.find((p) => p.isDefault) ?? activePlans[0];
  const pricePerSqm = defaultPlan.pricePerSqmExclVat;
  if (!(typeof pricePerSqm === "number" && pricePerSqm > 0)) {
    return { priceable: false, reason: "missing_price_per_sqm" };
  }

  return { priceable: true, reason: "ok" };
}

// ── sqm_fixed PRIMARY INPUT (GPM-7 authoring contract) ──────────────────────

/**
 * The customer answer key the V2 `sqm_fixed` engine reads as living area
 * (`request.answers.sqm` → engine `input.sqm`). A literal `sqm_fixed` service is only
 * priceable when the customer can supply this value, so its required PRIMARY INPUT is
 * an ACTIVE question whose key is exactly this. Literal so Admin authoring/readiness
 * and the public engine agree on the single input that drives the price.
 */
export const SQM_FIXED_PRIMARY_INPUT_KEY = "sqm" as const;

/**
 * The minimal question shape the primary-input gate reads — a structural subset of the
 * Admin `CalculatorQuestionConfig`. Only the active flag + machine key matter here.
 */
export interface SqmFixedReadinessQuestion {
  active: boolean;
  questionKey: string;
}

/**
 * True when `questions` contains the ACTIVE sqm primary input the runtime requires (an
 * active question keyed {@link SQM_FIXED_PRIMARY_INPUT_KEY}). Any number of OTHER active
 * questions is irrelevant: without this one, the public `sqm_fixed` engine has no area to
 * price and returns `missing_sqm`. Pure + deterministic; never throws.
 */
export function hasSqmPrimaryInput(questions: readonly SqmFixedReadinessQuestion[]): boolean {
  return questions.some((q) => q.active && q.questionKey === SQM_FIXED_PRIMARY_INPUT_KEY);
}

/**
 * The canonical question the Admin "Add area (m²) input" setup path pre-fills for a literal
 * `sqm_fixed` service (GPM-7) — exactly the one primary input the engine prices from: a
 * whole-m² area question, required, that affects the price. Authoring metadata ONLY:
 * persisting it never enables, publishes, or prices the service (creation stays a hidden
 * draft; publishing is a separate, explicit step).
 */
export const SQM_FIXED_PRIMARY_INPUT_DEFAULT = {
  questionKey: SQM_FIXED_PRIMARY_INPUT_KEY,
  label: "Boyta (m²)",
  inputType: "integer",
  required: true,
  affectsPricing: true,
} as const;
