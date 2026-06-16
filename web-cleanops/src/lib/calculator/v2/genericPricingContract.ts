/**
 * Calculator V2 — generic pricing-model CONFIG CONTRACTS (Slice GPM-4a).
 *
 * The single source of truth for what each GENERIC pricing model (GPM-1) requires
 * from a service's configuration: the customer's primary input, the plan-card
 * pricing fields a plan must carry, and how to validate a plan draft against the
 * model. Pure + behaviour-preserving — this module only ADDS types + pure
 * functions. It drives no public runtime, no pricing, and no DB writes; the Admin
 * generic-service slices (GPM-4b onward) consume it.
 *
 * Engine support today (from GPM-1): `hourly_by_area` and `sqm_fixed` are engine-
 * backed; `unit_based`, `fixed_package`, and `manual_quote` are RESERVED
 * contracts. A reserved model can DESCRIBE its future required plan field here
 * without that field being writable or auto-priceable yet — callers gate
 * priceability on {@link isGenericModelEngineSupported}, never on the presence of
 * a contract entry.
 *
 * `fixed_package` design note: a fixed package price is a positive BASE price,
 * whereas the existing `fixedAdjustmentExclVat` column is a signed ADJUSTMENT
 * (may be negative, layered on a raw price). Overloading the adjustment column as
 * a standalone base price would be a category error, so this contract reserves a
 * dedicated future field name ({@link RESERVED_GENERIC_PLAN_FIELDS}) rather than
 * reusing `fixedAdjustmentExclVat`/`minimumPriceExclVat`. No column is added in
 * this slice.
 */

import { isEngineSupportedGenericModel, type GenericPricingModel } from "./pricingModel";

/**
 * GPM-4a alias of GPM-1's {@link isEngineSupportedGenericModel}, named per the
 * GPM-4 contract. It delegates to the SAME single source of truth so the two can
 * never disagree: true only for the engine-backed models (`hourly_by_area`,
 * `sqm_fixed`) today.
 */
export const isGenericModelEngineSupported = isEngineSupportedGenericModel;

/** The customer's primary numeric input for a service, derived from its model. */
export type GenericPrimaryInput = "sqm" | "quantity" | "none";

/**
 * The customer's primary input for a generic pricing model. Pure + exhaustive
 * over {@link GenericPricingModel} (no `default` case, so adding a model is a
 * compile error until it declares its input). Mirrors the `primaryInput` seeded
 * by `defaultSettingsForGenericModel` (GPM-3a) — a drift guard test asserts the
 * two agree.
 */
export function primaryInputForGenericModel(model: GenericPricingModel): GenericPrimaryInput {
  switch (model) {
    case "hourly_by_area":
    case "sqm_fixed":
      return "sqm";
    case "unit_based":
      return "quantity";
    case "fixed_package":
    case "manual_quote":
      return "none";
  }
}

/**
 * Plan-card pricing fields WRITABLE today (the V2 columns from migration 0073,
 * surfaced through `PlanPatch`):
 *   • `hourlyRate` — price per hour excl VAT (drives `hourly_by_area`).
 *   • `startAdjustmentHours` — price-only start adjustment in hours (may be ±).
 *   • `pricePerSqmExclVat` — price per m² excl VAT (drives `sqm_fixed`).
 *   • `fixedAdjustmentExclVat` — flat excl-VAT adjustment (may be ± for a discount).
 *   • `minimumPriceExclVat` — optional raw-price floor (≥ 0 or null).
 */
export const WRITABLE_GENERIC_PLAN_FIELDS = [
  "hourlyRate",
  "startAdjustmentHours",
  "pricePerSqmExclVat",
  "fixedAdjustmentExclVat",
  "minimumPriceExclVat",
] as const;
export type WritableGenericPlanField = (typeof WRITABLE_GENERIC_PLAN_FIELDS)[number];

/**
 * Plan-field names a model will REQUIRE once its engine runtime lands, but which
 * have NO writable column yet. They exist only so the contract can describe the
 * forward requirement; nothing validates or persists them in this slice:
 *   • `pricePerUnitExclVat` — `unit_based` per-unit price (added with its runtime, GPM-4c).
 *   • `fixedPackagePriceExclVat` — `fixed_package` base price (dedicated future column).
 */
export const RESERVED_GENERIC_PLAN_FIELDS = ["pricePerUnitExclVat", "fixedPackagePriceExclVat"] as const;
export type ReservedGenericPlanField = (typeof RESERVED_GENERIC_PLAN_FIELDS)[number];

/** Any plan-field name a generic-model contract can reference (writable or reserved). */
export type GenericPlanFieldKey = WritableGenericPlanField | ReservedGenericPlanField;

/** A generic model's plan-field contract: what a plan MUST and MAY carry. */
export interface GenericPlanFieldContract {
  /** Fields a priceable plan MUST supply a valid value for. */
  required: readonly GenericPlanFieldKey[];
  /** Fields a plan MAY supply (validated only when present, never demanded). */
  optional: readonly GenericPlanFieldKey[];
  /** Whether the V2 engine can auto-price this model today (mirrors the GPM-1 predicate). */
  engineSupported: boolean;
}

/** Pure required/optional field split per model — exhaustive over GenericPricingModel. */
function genericPlanFields(
  model: GenericPricingModel,
): { required: readonly GenericPlanFieldKey[]; optional: readonly GenericPlanFieldKey[] } {
  switch (model) {
    case "hourly_by_area":
      return {
        required: ["hourlyRate"],
        optional: ["startAdjustmentHours", "fixedAdjustmentExclVat", "minimumPriceExclVat"],
      };
    case "sqm_fixed":
      return {
        required: ["pricePerSqmExclVat"],
        optional: ["fixedAdjustmentExclVat", "minimumPriceExclVat"],
      };
    case "unit_based":
      // RESERVED: needs a per-unit column + engine runtime first (GPM-4c).
      return { required: ["pricePerUnitExclVat"], optional: [] };
    case "fixed_package":
      // RESERVED: needs a dedicated base-price column + engine runtime first.
      return { required: ["fixedPackagePriceExclVat"], optional: [] };
    case "manual_quote":
      // No automatic pricing — a manual-quote service is complete with no price fields.
      return { required: [], optional: [] };
  }
}

/**
 * The plan-field contract for a generic pricing model: which plan-card fields are
 * required vs optional, plus whether the engine can auto-price it today. Pure +
 * exhaustive. For reserved models the `required` list names the FUTURE field
 * (see {@link RESERVED_GENERIC_PLAN_FIELDS}); `engineSupported` stays false so
 * callers never treat such a plan as priceable.
 */
export function requiredPlanFieldsForGenericModel(model: GenericPricingModel): GenericPlanFieldContract {
  const { required, optional } = genericPlanFields(model);
  return { required, optional, engineSupported: isGenericModelEngineSupported(model) };
}

/**
 * A plan draft validated against a generic model. Carries only the WRITABLE V2
 * plan-card fields (migration 0073); reserved per-unit / package-base fields are
 * intentionally absent because they have no column yet. All optional so callers
 * can validate a partial draft. `null` means "explicitly cleared".
 */
export interface GenericPlanDraft {
  hourlyRate?: number | null;
  startAdjustmentHours?: number | null;
  pricePerSqmExclVat?: number | null;
  fixedAdjustmentExclVat?: number | null;
  minimumPriceExclVat?: number | null;
}

/** Pushes an error unless `value` is a finite number strictly greater than zero. */
function requirePositiveAmount(value: number | null | undefined, label: string, errors: string[]): void {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) {
    errors.push(`${label} must be a positive number.`);
  }
}

/** Pushes an error if `value` is present but not a finite number ≥ 0 (an optional floor). */
function checkOptionalFloor(value: number | null | undefined, label: string, errors: string[]): void {
  if (value === null || value === undefined) return;
  if (!Number.isFinite(value) || value < 0) {
    errors.push(`${label} must be zero or greater.`);
  }
}

/** Pushes an error if `value` is present but not a finite number (sign allowed — e.g. a discount). */
function checkOptionalSigned(value: number | null | undefined, label: string, errors: string[]): void {
  if (value === null || value === undefined) return;
  if (!Number.isFinite(value)) {
    errors.push(`${label} must be a valid number.`);
  }
}

/** Pushes an error if a start adjustment is present but outside the DB-allowed [-24, 24] hour range. */
function checkOptionalStartAdjustment(value: number | null | undefined, errors: string[]): void {
  if (value === null || value === undefined) return;
  if (!Number.isFinite(value) || value < -24 || value > 24) {
    errors.push("Start adjustment (hours) must be between -24 and 24.");
  }
}

/**
 * Validates a plan draft against its generic pricing model and returns a list of
 * human-readable problems ([] when valid). Pure + exhaustive over the five
 * models:
 *   • `hourly_by_area` requires a positive `hourlyRate`; optional adjustments are
 *     range-checked when present.
 *   • `sqm_fixed` requires a positive `pricePerSqmExclVat`; optional adjustments
 *     are range-checked when present.
 *   • `manual_quote` needs NO pricing fields (it is intentionally not auto-priced)
 *     → always valid.
 *   • `unit_based` / `fixed_package` cannot be auto-priced yet (no column/runtime)
 *     → a single explicit "not available" problem, so an Admin caller never
 *     concludes the plan is ready to price.
 */
export function validateGenericPlan(draft: GenericPlanDraft, model: GenericPricingModel): string[] {
  const errors: string[] = [];
  switch (model) {
    case "hourly_by_area":
      requirePositiveAmount(draft.hourlyRate, "Hourly rate", errors);
      checkOptionalStartAdjustment(draft.startAdjustmentHours, errors);
      checkOptionalSigned(draft.fixedAdjustmentExclVat, "Fixed adjustment", errors);
      checkOptionalFloor(draft.minimumPriceExclVat, "Minimum price", errors);
      return errors;
    case "sqm_fixed":
      requirePositiveAmount(draft.pricePerSqmExclVat, "Price per m²", errors);
      checkOptionalSigned(draft.fixedAdjustmentExclVat, "Fixed adjustment", errors);
      checkOptionalFloor(draft.minimumPriceExclVat, "Minimum price", errors);
      return errors;
    case "manual_quote":
      return errors;
    case "unit_based":
    case "fixed_package":
      errors.push(`Pricing model "${model}" cannot be priced automatically yet.`);
      return errors;
  }
}
