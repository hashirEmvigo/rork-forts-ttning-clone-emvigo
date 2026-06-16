import { classifyServiceGroup } from "@/components/calculator/serviceListPresentation";
import type { CalculatorServiceConfig } from "@/lib/calculator/calculatorConfigAdmin";
import {
  isGenericModelEngineSupported,
  primaryInputForGenericModel,
  type GenericPrimaryInput,
} from "@/lib/calculator/v2/genericPricingContract";
import { resolveGenericPricingModel, type GenericPricingModel } from "@/lib/calculator/v2/pricingModel";

/**
 * Cleaning Plans editor presentation helpers (Slice GPM-4b-1).
 *
 * Pure + presentation-only. These helpers decide WHICH lane a calculator service
 * renders in inside the admin Cleaning Plans editor and surface read-only generic
 * pricing-model metadata for its card. They NEVER change pricing, public
 * visibility, plans, or DB state. No classification logic is duplicated here — the
 * lane reuses GPM-2a's {@link classifyServiceGroup} and the model metadata reuses
 * GPM-1/GPM-4a (`resolveGenericPricingModel`, `primaryInputForGenericModel`,
 * `isGenericModelEngineSupported`).
 */

/**
 * The two service keys that own bespoke, fully-wired plan editors today (the V2
 * Home pilot and the Office pilot). Their existing cards and save behaviour are
 * deliberately unchanged by GPM-4b-1, so they are matched by key BEFORE any
 * generic/legacy grouping is applied.
 */
export const SUPPORTED_PLAN_EDITOR_SERVICE_KEYS = ["home_cleaning", "office_cleaning"] as const;

/**
 * Which lane a service renders in within the Cleaning Plans editor:
 *  • `supported_editor` — Home / Office, the bespoke editors left untouched here.
 *  • `generic`          — an admin-created service on a GENERIC pricing model.
 *                         Shown in the builder lane with a SAFE, read-only card
 *                         (no plan pricing fields yet — that is GPM-4b-2).
 *  • `legacy`           — a seeded, service-named legacy service (other than the
 *                         Home/Office editors). Collapsed behind the legacy toggle.
 */
export type PlanEditorLane = "supported_editor" | "generic" | "legacy";

type LaneInput = Pick<CalculatorServiceConfig, "serviceKey" | "pricingModel">;

function isSupportedEditorKey(serviceKey: string): boolean {
  return (SUPPORTED_PLAN_EDITOR_SERVICE_KEYS as readonly string[]).includes(serviceKey);
}

/**
 * Classifies a service into its Cleaning Plans editor lane. Home/Office always map
 * to `supported_editor` (their bespoke editors stay unchanged); every other service
 * reuses GPM-2a grouping — a seeded legacy-model service falls into `legacy`, while
 * any admin-built generic-model (or not-yet-recognised) service joins the `generic`
 * builder lane.
 */
export function planEditorLane(service: LaneInput): PlanEditorLane {
  if (isSupportedEditorKey(service.serviceKey)) return "supported_editor";
  return classifyServiceGroup(service) === "legacy" ? "legacy" : "generic";
}

/** Human-readable label for each generic pricing model (admin-facing). */
const GENERIC_MODEL_LABELS: Readonly<Record<GenericPricingModel, string>> = {
  hourly_by_area: "Hourly by area",
  sqm_fixed: "Fixed price per m²",
  unit_based: "Unit based",
  fixed_package: "Fixed package",
  manual_quote: "Manual quote",
};

/** Human-readable label for each primary input. */
const PRIMARY_INPUT_LABELS: Readonly<Record<GenericPrimaryInput, string>> = {
  sqm: "m²",
  quantity: "Quantity",
  none: "No customer input",
};

/** Read-only generic pricing-model metadata used to render a generic service card. */
export interface GenericServicePlanInfo {
  /** The resolved generic pricing model (legacy/unknown values are normalised). */
  model: GenericPricingModel;
  /** The customer's primary numeric input for the model. */
  primaryInput: GenericPrimaryInput;
  /** Whether the V2 engine can auto-price this model today (GPM-1/GPM-4a). */
  engineSupported: boolean;
  /** Admin-facing model label, e.g. "Hourly by area". */
  modelLabel: string;
  /** Admin-facing primary-input label, e.g. "m²". */
  primaryInputLabel: string;
}

/**
 * Resolves the read-only generic pricing-model metadata for a service card. Pure;
 * delegates entirely to the GPM-1/GPM-4a single sources of truth so it can never
 * disagree about a model's engine support or primary input.
 */
export function genericServicePlanInfo(
  service: Pick<CalculatorServiceConfig, "pricingModel">,
): GenericServicePlanInfo {
  const model = resolveGenericPricingModel(service.pricingModel);
  const primaryInput = primaryInputForGenericModel(model);
  return {
    model,
    primaryInput,
    engineSupported: isGenericModelEngineSupported(model),
    modelLabel: GENERIC_MODEL_LABELS[model],
    primaryInputLabel: PRIMARY_INPUT_LABELS[primaryInput],
  };
}
