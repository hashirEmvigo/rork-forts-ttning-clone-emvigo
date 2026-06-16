/**
 * Price Calculator — PUBLIC client generic-renderability helper (GPM-5c-3).
 *
 * Pure, side-effect-free decision logic that answers ONE question for the public
 * page: "Can the public client render this already-normalized service as a
 * generic V2 service today?". It is the CLIENT-side counterpart to the server's
 * `assessGenericServiceRuntimeReadiness` / `shouldRouteServiceToV2` — but it makes
 * a strictly NARROWER, presentation-only decision: it never prices, never routes,
 * and never trusts a value the server did not already classify.
 *
 * It reads ONLY the additive, public-safe generic metadata fields surfaced by
 * GPM-5c-1 and mirrored client-side by GPM-5c-2 (`genericPricingModel`,
 * `engineSupported`, `primaryInput`, `unitLabel`). It returns a STRUCTURED result
 * (`canRender` + a discrete `reason`) rather than a bare boolean, so a future
 * rendering ticket can branch on the reason for UI status and tests can assert the
 * exact decision path.
 *
 * IMPORTANT: this helper is NOT wired into any production path in this ticket. It
 * exists as tested, reusable logic for a later rendering slice. It performs no
 * calculate/submit, no routing, and no serviceKey-specific pricing.
 */

/**
 * The only generic pricing model the public client can render an input/price flow
 * for TODAY (GPM-5b-1 made the V2 runtime price LITERAL `sqm_fixed` only). This is
 * the client's own rendering capability gate, deliberately kept separate from the
 * server's `engineSupported` flag so a future server widening can never silently
 * make the client render a model it has no UI for.
 */
const RENDERABLE_GENERIC_MODEL = "sqm_fixed";

/** The canonical primary input a renderable generic `sqm_fixed` service must declare. */
const RENDERABLE_PRIMARY_INPUT = "sqm";

/**
 * Discrete outcomes of {@link assessGenericServiceClientReadiness}. Exactly one is
 * returned per call; there is no silent fallback.
 *   • `supported`             — all gates pass; the client may render this service.
 *   • `not_generic`           — no generic model present (legacy/Home, or absent).
 *   • `engine_not_supported`  — generic, but the client has no price/render flow for
 *                               it today: the server did not classify it
 *                               engine-supported, OR the model is not the one
 *                               renderable model (`sqm_fixed`).
 *   • `missing_primary_input` — engine-supported, but no canonical primary input.
 *   • `invalid_primary_input` — engine-supported, but the primary input is present
 *                               and is NOT the expected `sqm`.
 *   • `missing_unit_label`    — engine-supported with a valid input, but no unit label.
 */
export type GenericServiceClientReadinessReason =
  | "supported"
  | "not_generic"
  | "engine_not_supported"
  | "missing_primary_input"
  | "missing_unit_label"
  | "invalid_primary_input";

/** Structured readiness decision: a boolean gate plus the discrete reason behind it. */
export interface GenericServiceClientReadiness {
  canRender: boolean;
  reason: GenericServiceClientReadinessReason;
}

/**
 * The minimal, already-normalized public fields the helper reads. A normalized
 * `PublicService` (and {@link PublicGenericServiceMetadata}) is structurally
 * assignable to this — its `primaryInput: "sqm" | null` is a subset of the
 * `string | null` accepted here. The looser `primaryInput` type is intentional:
 * it lets the helper distinguish a MISSING input (null) from an INVALID one (a
 * non-`sqm` value) defensively, even though today's normalizer only ever yields
 * `"sqm" | null`.
 */
export interface GenericServiceReadinessInput {
  genericPricingModel: string | null;
  engineSupported: boolean;
  primaryInput: string | null;
  unitLabel: string | null;
}

/** Trimmed non-empty string, or null. */
function nonEmptyString(value: string | null): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/**
 * Decides whether the public client may render an already-normalized service as a
 * generic V2 service. Pure + deterministic; never throws. Renders ONLY when, in
 * order: a generic model is present, the server marked it engine-supported AND it
 * is the lone renderable model (`sqm_fixed`), it declares the canonical `sqm`
 * primary input, and it carries a customer-facing unit label. Any failure returns
 * `canRender: false` with the specific {@link GenericServiceClientReadinessReason}
 * — never a silent fallback, and never a fabricated `true`.
 */
export function assessGenericServiceClientReadiness(
  service: GenericServiceReadinessInput,
): GenericServiceClientReadiness {
  // 1) Not a generic service at all (legacy/Home, or the field was absent → null).
  const genericPricingModel = nonEmptyString(service.genericPricingModel);
  if (genericPricingModel === null) {
    return { canRender: false, reason: "not_generic" };
  }

  // 2) Generic, but the client has no price/render flow for it today. This holds when
  //    the server did NOT classify it engine-supported, OR the model is not the single
  //    model the client can render (`sqm_fixed`). Trusting the server's flag here means
  //    even a literal sqm_fixed never renders if the server reports engineSupported=false.
  if (service.engineSupported !== true || genericPricingModel !== RENDERABLE_GENERIC_MODEL) {
    return { canRender: false, reason: "engine_not_supported" };
  }

  // 3) An engine-supported sqm_fixed service MUST declare its canonical primary input.
  const primaryInput = nonEmptyString(service.primaryInput);
  if (primaryInput === null) {
    return { canRender: false, reason: "missing_primary_input" };
  }
  if (primaryInput !== RENDERABLE_PRIMARY_INPUT) {
    return { canRender: false, reason: "invalid_primary_input" };
  }

  // 4) ...and a customer-facing unit label to render alongside the input.
  if (nonEmptyString(service.unitLabel) === null) {
    return { canRender: false, reason: "missing_unit_label" };
  }

  // 5) Every client renderability gate passes.
  return { canRender: true, reason: "supported" };
}
