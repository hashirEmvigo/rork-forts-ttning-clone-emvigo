// ============================================================================
// Price Calculator — PURE config + calculate mapping (Deno + vitest).
// ============================================================================
//
// This module is the bridge between Supabase row shapes and the pure pricing
// engine. It performs NO I/O: the Edge Function (`../../public-calculator/
// index.ts`) loads the rows with the service role and hands them here; this
// module validates input, strips internal-only fields, maps rows into the
// engine's {@link PriceCalculationInput}, runs the APPROVED engine, and shapes a
// public-safe response. Keeping it pure makes both paths unit-testable with
// vitest (see `src/lib/calculator/publicCalculator.test.ts`).
//
// PUBLIC-SAFETY CONTRACT (enforced here, not in the function):
//   • Config never exposes pricing_rules, margins, manual-review thresholds,
//     submission behaviour, ids/legacy ids, or the company uuid.
//   • Calculate never exposes the internal `steps[]` trace, raw rule values, or
//     rawPrice — only the final figures + display text + plan summary.
// ============================================================================

import {
  buildResultDisplayText,
  calculatePrice,
} from "./pricingEngine.ts";
import {
  GENERIC_PRICING_MODELS,
  pricingBasisForGenericModel,
} from "./v2/pricingModel.ts";
import type { GenericPricingModel } from "./v2/pricingModel.ts";
import type {
  AnswerValue,
  CalculatorAddonConfigRow,
  CalculatorAnswers,
  CalculatorQuestionRow,
  CalculatorServiceRow,
  CalculatorSettingsRow,
  CalculatorSizeBandRow,
  CleaningPlanRow,
  CleaningPlanSnapshot,
  CompanyRow,
  CalculatorSizeBandSnapshot,
  ExistingProspect,
  PreparedSubmission,
  PriceCalculationResult,
  PlanPricingModel,
  PriceDisplayMode,
  PriceIssue,
  PricingModel,
  PricingRuleRow,
  PricingRuleValue,
  ProspectWrite,
  PublicAddon,
  PublicCalculateRequest,
  PublicCalculateResponse,
  PublicCleaningPlan,
  PublicConfigResponse,
  PublicContact,
  PublicQuestion,
  PublicService,
  PublicSettings,
  PublicSubmitNextStep,
  PublicSubmitRequest,
  PublicSubmitResponse,
  QuoteRequestAnswerWrite,
  QuoteRequestWrite,
  StoredPricingSnapshot,
} from "./types.ts";

// ── Small, defensive coercion helpers ───────────────────────────────────────

const PRICE_DISPLAY_MODES: readonly PriceDisplayMode[] = [
  "exact",
  "range",
  "hidden_until_submit",
];
const PRICING_MODELS: readonly PricingModel[] = [
  "home_cleaning_recommended_hours",
  "move_out_fixed_plus_addons",
  "office_cleaning_recurring_area_frequency",
];
const PLAN_PRICING_MODELS = [
  "hourly_rate_by_plan",
  "price_adjustment_per_plan",
  "time_adjustment_per_visit",
  "hourly_rate_plus_time_adjustment",
] as const;
const PRICE_ADJUSTMENT_TYPES = ["fixed_amount", "percent"] as const;
const RUT_APPLY_TO_VALUES = ["total_customer_price", "labor_service_price_only"] as const;

/** Coerces a possibly-string numeric (Supabase returns `numeric` as text) to a finite number, else null. */
function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Treats unknown jsonb as a plain object (defaults to {}). */
function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function planPricingModel(value: unknown): PlanPricingModel {
  return PLAN_PRICING_MODELS.includes(value as PlanPricingModel)
    ? (value as PlanPricingModel)
    : "hourly_rate_by_plan";
}

function priceAdjustmentType(value: unknown): "fixed_amount" | "percent" {
  return PRICE_ADJUSTMENT_TYPES.includes(value as "fixed_amount" | "percent")
    ? (value as "fixed_amount" | "percent")
    : "fixed_amount";
}

function rutApplyTo(value: unknown): "total_customer_price" | "labor_service_price_only" {
  return RUT_APPLY_TO_VALUES.includes(value as "total_customer_price" | "labor_service_price_only")
    ? (value as "total_customer_price" | "labor_service_price_only")
    : "total_customer_price";
}

function servicePlanSettings(service: CalculatorServiceRow) {
  const settings = asObject(service.settings_json);
  const legacyRequires = service.pricing_model === "home_cleaning_recommended_hours";
  const plansEnabled = typeof settings.plansEnabled === "boolean"
    ? settings.plansEnabled
    : typeof settings.requiresCleaningPlan === "boolean"
      ? settings.requiresCleaningPlan
      : legacyRequires;
  return {
    plansEnabled,
    planPricingModel: planPricingModel(settings.planPricingModel),
    defaultPlanKey: typeof settings.defaultPlanKey === "string" ? settings.defaultPlanKey : null,
    baseHourlyRateExclVat: toFiniteNumber(settings.baseHourlyRateExclVat),
    defaultVatRatePercent: toFiniteNumber(settings.defaultVatRatePercent) ?? 25,
  };
}

/**
 * Slice 12Q — parses `settings_json.homeSqmAdjustments` into the engine's sqm
 * adjustment ranges. Drops malformed rows; tolerates missing/legacy data (empty
 * list = no adjustment). `toSqm` may be null (open-ended top range). Mirrors the
 * frontend `parseSqmAdjustments` so both engine paths see identical input.
 */
function parseSqmAdjustments(raw: unknown): { fromSqm: number; toSqm: number | null; adjustmentPercent: number }[] {
  if (!Array.isArray(raw)) return [];
  const out: { fromSqm: number; toSqm: number | null; adjustmentPercent: number }[] = [];
  for (const item of raw) {
    const obj = asObject(item);
    const fromSqm = toFiniteNumber(obj.fromSqm);
    const adjustmentPercent = toFiniteNumber(obj.adjustmentPercent);
    if (fromSqm === null || fromSqm < 0 || adjustmentPercent === null) continue;
    const toSqm = toFiniteNumber(obj.toSqm);
    if (toSqm !== null && toSqm < fromSqm) continue;
    out.push({ fromSqm, toSqm, adjustmentPercent });
  }
  return out.sort((a, b) => a.fromSqm - b.fromSqm);
}

/** Validates a price-display mode, falling back to "range". */
export function resolvePriceDisplayMode(value: unknown): PriceDisplayMode {
  return PRICE_DISPLAY_MODES.includes(value as PriceDisplayMode)
    ? (value as PriceDisplayMode)
    : "range";
}

/** Whether a value is one of the engine's known pricing models. */
function isPricingModel(value: unknown): value is PricingModel {
  return PRICING_MODELS.includes(value as PricingModel);
}

/**
 * Whether a service requires a cleaning plan. Prefers the explicit
 * `settings_json.requiresCleaningPlan` flag; falls back to the pricing model
 * (home cleaning needs a plan, move-out does not — confirmation locked in MVP).
 */
export function requiresCleaningPlan(service: CalculatorServiceRow): boolean {
  return servicePlanSettings(service).plansEnabled;
}

/** Additive, public-safe generic metadata derived from a service's LITERAL pricing model (GPM-5c-1). */
interface PublicGenericServiceMeta {
  genericPricingModel: GenericPricingModel | null;
  engineSupported: boolean;
  primaryInput: "sqm" | null;
  unitLabel: string | null;
}

/**
 * Derives the ADDITIVE, public-safe generic metadata for a service from its LITERAL
 * stored `pricing_model` (GPM-5c-1). Deliberately NEVER alias-resolves: a legacy
 * service-named model (e.g. `move_out_fixed_plus_addons`) is NOT a generic model, so it
 * reports `genericPricingModel: null` / `engineSupported: false` and can never be
 * mistaken for generic `sqm_fixed` — the same "literal sqm_fixed only" rule the GPM-5b-1
 * runtime routing guard enforces. `engineSupported` mirrors that routing reality: TRUE
 * ONLY for the literal `sqm_fixed` model the public runtime can price today (NOT
 * `hourly_by_area`, NOT the reserved models). `primaryInput` / `unitLabel` are derived
 * canonically from the model's pricing basis — the area-driven `hourly_by_area` +
 * `sqm_fixed` bases need m² square meters; the reserved models have no canonical primary
 * input yet. Exposes NO pricing internals (no rates, margins, plan fields, or readiness).
 */
function resolveGenericServiceMeta(pricingModel: string): PublicGenericServiceMeta {
  // LITERAL match only — never the alias resolver (which would map legacy models in).
  if (!(GENERIC_PRICING_MODELS as readonly string[]).includes(pricingModel)) {
    return { genericPricingModel: null, engineSupported: false, primaryInput: null, unitLabel: null };
  }
  const model = pricingModel as GenericPricingModel;
  // Public RUNTIME support today = literal `sqm_fixed` ONLY (GPM-5b-1). NOT hourly_by_area.
  const engineSupported = model === "sqm_fixed";
  // Canonical primary input from the pricing basis: hourly + sqm_fixed are area-driven.
  const primaryInput: "sqm" | null = pricingBasisForGenericModel(model) === null ? null : "sqm";
  return {
    genericPricingModel: model,
    engineSupported,
    primaryInput,
    unitLabel: primaryInput === "sqm" ? "m²" : null,
  };
}

// ── Public config builder (config action) ────────────────────────────────────

export interface ConfigParts {
  company: CompanyRow | null;
  settings: CalculatorSettingsRow;
  services: CalculatorServiceRow[];
  questions: CalculatorQuestionRow[];
  plans: CleaningPlanRow[];
  /**
   * Generic add-ons for the enabled services (Slice V2-E3-1). Optional so existing
   * callers/tests that predate add-ons still type-check (treated as none). The
   * mapper groups them by service and re-checks active/public_visible/deleted_at
   * defensively, so a stray hidden/inactive/deleted row can never leak publicly.
   */
  addons?: CalculatorAddonConfigRow[];
}

/** Maps a question row to its public-safe form-field shape (no pricing semantics). */
function toPublicQuestion(q: CalculatorQuestionRow): PublicQuestion {
  return {
    questionKey: q.question_key,
    label: q.label,
    helpText: q.help_text ?? null,
    inputType: q.input_type,
    required: Boolean(q.required),
    options: q.options_json ?? [],
    validation: q.validation_json ?? {},
    sortOrder: q.sort_order ?? 0,
  };
}

/**
 * Whether a config add-on row may be exposed publicly. Defensive mirror of the
 * SQL WHERE (active = true AND public_visible = true AND deleted_at IS NULL):
 * absent flags (a public-only select omits them) default to visible, an explicit
 * false hides the row, and any deleted_at hides it. Guarantees that even a
 * mis-scoped load can never surface a hidden, inactive, or soft-deleted add-on.
 */
function isPublicAddonRow(a: CalculatorAddonConfigRow): boolean {
  return a.active !== false && a.public_visible !== false && (a.deleted_at ?? null) === null;
}

/**
 * Maps a calculator_addons row to its public-safe input shape. Mirrors the V2
 * resolver's column normalization (snake_case → camelCase, numeric coercion,
 * DB-default clamps) but EXPOSES ONLY display fields — the pricing effect
 * channels and the internal admin `name` are never read here (the config loader
 * does not even fetch them). `input_type` is clamped to the two persisted types,
 * so a stray value can never expose `single_select`.
 */
function toPublicAddon(a: CalculatorAddonConfigRow): PublicAddon {
  const step = toFiniteNumber(a.quantity_step);
  return {
    addonKey: a.addon_key,
    publicLabel: a.public_label,
    description: typeof a.description === "string" ? a.description : null,
    inputType: a.input_type === "quantity" ? "quantity" : "boolean",
    booleanDefault: a.boolean_default === true,
    quantityMin: Math.max(0, toFiniteNumber(a.quantity_min) ?? 0),
    quantityMax: toFiniteNumber(a.quantity_max),
    quantityStep: step !== null && step > 0 ? step : 1,
    quantityDefault: toFiniteNumber(a.quantity_default) ?? 0,
    required: a.required === true,
    sortOrder: toFiniteNumber(a.sort_order) ?? 0,
  };
}

/** Maps a cleaning-plan row to its public-safe shape (hourlyRate IS public). */
function toPublicPlan(p: CleaningPlanRow): PublicCleaningPlan {
  return {
    id: p.id,
    planKey: p.plan_key,
    name: p.name,
    description: p.description ?? null,
    serviceKey: p.service_key ?? "home_cleaning",
    hourlyRate: toFiniteNumber(p.hourly_rate) ?? 0,
    vatRatePercent: toFiniteNumber(p.vat_rate_percent) ?? 25,
    priceAdjustmentType: priceAdjustmentType(p.price_adjustment_type),
    priceAdjustmentValue: toFiniteNumber(p.price_adjustment_value) ?? 0,
    rutEligible: p.rut_eligible === true,
    rutEnabled: p.rut_enabled === true,
    rutPercent: toFiniteNumber(p.rut_percent) ?? 50,
    rutApplyTo: rutApplyTo(p.rut_apply_to),
    showRutBreakdown: p.show_rut_breakdown === true,
    flexibilityLevel: p.flexibility_level ?? null,
    customerDayTimeControl: p.customer_day_time_control ?? null,
    sameStaffPreferenceLevel: p.same_staff_preference_level ?? null,
    bookingPriority: p.booking_priority ?? null,
    cancellationTermsSummary: p.cancellation_terms_summary ?? null,
    isDefault: Boolean(p.is_default),
    sortOrder: p.sort_order ?? 0,
  };
}

function toPublicSettings(s: CalculatorSettingsRow): PublicSettings {
  return {
    publicSlug: s.public_slug ?? null,
    priceDisplayMode: resolvePriceDisplayMode(s.price_display_mode),
    currency: s.currency ?? "SEK",
    showPriceBeforeContact: Boolean(s.show_price_before_contact),
    requireContactBeforeResult: Boolean(s.require_contact_before_result),
    showLoginPromptAfterSubmit: Boolean(s.show_login_prompt_after_submit),
    rutDisplayMode: s.rut_display_mode ?? "none",
    defaultVatRatePercent: toFiniteNumber(s.default_vat_rate_percent) ?? 25,
    quoteValidityDays: toFiniteNumber(s.quote_validity_days) ?? 0,
  };
}

/**
 * Builds the public-safe calculator config. When the calculator is DISABLED
 * (`settings.enabled = false`, the MVP default) the structural parts — services,
 * questions, cleaning plans — are withheld (empty arrays) so the calculator's
 * shape and pricing surface never leak before launch; only the page copy
 * (`content` / `faq`), the public behaviour flags, and the company name are
 * returned, with `enabled: false`. Callers should still return HTTP 200 for a
 * disabled-but-found calculator, and 404 only when the slug resolves to nothing.
 */
export function buildPublicConfig(parts: ConfigParts): PublicConfigResponse {
  const { company, settings, services, questions, plans, addons = [] } = parts;
  const enabled = Boolean(settings.enabled);

  // Page copy lives in settings.content; surface FAQ separately (doc 07) and
  // strip it from the returned content object to avoid duplication.
  const content = { ...asObject(settings.content) };
  const faqRaw = content.faq;
  const faq = Array.isArray(faqRaw) ? faqRaw : [];
  delete content.faq;

  if (!enabled) {
    return {
      ok: true,
      enabled: false,
      company: company ? { name: company.name } : null,
      settings: toPublicSettings(settings),
      content,
      services: [],
      cleaningPlans: [],
      faq,
    };
  }

  // Group visible questions under their service.
  const questionsByService = new Map<string, CalculatorQuestionRow[]>();
  for (const q of questions) {
    const list = questionsByService.get(q.calculator_service_id) ?? [];
    list.push(q);
    questionsByService.set(q.calculator_service_id, list);
  }

  // Group public-visible add-ons under their service (Slice V2-E3-1). Rows are
  // re-checked here so a hidden/inactive/soft-deleted row can never leak even if
  // the SQL WHERE were ever loosened. Pricing effect channels are not present on
  // these rows (the config loader never fetches them).
  const addonsByService = new Map<string, CalculatorAddonConfigRow[]>();
  for (const a of addons) {
    if (!isPublicAddonRow(a)) continue;
    const list = addonsByService.get(a.calculator_service_id) ?? [];
    list.push(a);
    addonsByService.set(a.calculator_service_id, list);
  }

  const publicServices: PublicService[] = services
    .map((svc): PublicService => {
      const svcQuestions = (questionsByService.get(svc.id) ?? [])
        .slice()
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        .map(toPublicQuestion);
      // Add-ons sort by sort_order, then addon_key as a stable tie-break.
      const svcAddons = (addonsByService.get(svc.id) ?? [])
        .slice()
        .sort(
          (a, b) =>
            (toFiniteNumber(a.sort_order) ?? 0) - (toFiniteNumber(b.sort_order) ?? 0) ||
            a.addon_key.localeCompare(b.addon_key),
        )
        .map(toPublicAddon);
      const planSettings = servicePlanSettings(svc);
      const genericMeta = resolveGenericServiceMeta(svc.pricing_model);
      return {
        serviceKey: svc.service_key,
        displayName: svc.display_name,
        description: svc.description ?? null,
        enabled: Boolean(svc.enabled),
        comingSoon: Boolean(svc.coming_soon),
        pricingModel: svc.pricing_model,
        genericPricingModel: genericMeta.genericPricingModel,
        engineSupported: genericMeta.engineSupported,
        primaryInput: genericMeta.primaryInput,
        unitLabel: genericMeta.unitLabel,
        requiresCleaningPlan: requiresCleaningPlan(svc),
        plansEnabled: planSettings.plansEnabled,
        planPricingModel: planSettings.planPricingModel,
        defaultPlanKey: planSettings.defaultPlanKey,
        baseHourlyRateExclVat: planSettings.baseHourlyRateExclVat,
        defaultVatRatePercent: planSettings.defaultVatRatePercent,
        sortOrder: svc.sort_order ?? 0,
        // Coming-soon services are shown as disabled cards with no questions/add-ons.
        questions: svc.enabled ? svcQuestions : [],
        addons: svc.enabled ? svcAddons : [],
      };
    })
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const publicPlans: PublicCleaningPlan[] = plans
    .map(toPublicPlan)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  return {
    ok: true,
    enabled: true,
    company: company ? { name: company.name } : null,
    settings: toPublicSettings(settings),
    content,
    services: publicServices,
    cleaningPlans: publicPlans,
    faq,
  };
}

// ── Request validation (calculate action) ────────────────────────────────────

/** Hard caps to keep the public surface safe for future rate limiting / abuse. */
const MAX_ANSWER_KEYS = 60;
const MAX_STRING_LEN = 2000;
const MAX_ARRAY_LEN = 50;

/** Sanitises a single answer value to the permissive {@link AnswerValue} union. */
function sanitizeAnswerValue(value: unknown): AnswerValue | undefined {
  if (value === null) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") return value.slice(0, MAX_STRING_LEN);
  if (Array.isArray(value)) {
    return value
      .filter((v): v is string => typeof v === "string")
      .slice(0, MAX_ARRAY_LEN)
      .map((v) => v.slice(0, MAX_STRING_LEN));
  }
  return undefined;
}

/** Coerces an untrusted body into a clean answers map (drops unsupported types). */
export function coerceAnswers(raw: unknown): CalculatorAnswers {
  const obj = asObject(raw);
  const out: CalculatorAnswers = {};
  let count = 0;
  for (const [key, value] of Object.entries(obj)) {
    if (count >= MAX_ANSWER_KEYS) break;
    if (typeof key !== "string" || key.length === 0 || key.length > 200) continue;
    const clean = sanitizeAnswerValue(value);
    if (clean !== undefined) {
      out[key] = clean;
      count += 1;
    }
  }
  return out;
}

export type CalculateValidation =
  | { ok: true; value: PublicCalculateRequest }
  | { ok: false; error: string };

/** Validates + normalises the calculate request body. */
export function validateCalculateRequest(raw: unknown): CalculateValidation {
  const body = asObject(raw);

  const serviceKey =
    typeof body.serviceKey === "string" ? body.serviceKey.trim() : "";
  if (serviceKey === "" || serviceKey.length > 100) {
    return { ok: false, error: "A valid serviceKey is required." };
  }

  if (body.answers !== undefined && typeof body.answers !== "object") {
    return { ok: false, error: "answers must be an object." };
  }
  const answers = coerceAnswers(body.answers);

  const cleaningPlanKey =
    typeof body.cleaningPlanKey === "string" && body.cleaningPlanKey.trim() !== ""
      ? body.cleaningPlanKey.trim()
      : null;
  const cleaningPlanId =
    typeof body.cleaningPlanId === "string" && body.cleaningPlanId.trim() !== ""
      ? body.cleaningPlanId.trim()
      : null;

  return {
    ok: true,
    value: { serviceKey, answers, cleaningPlanKey, cleaningPlanId },
  };
}

// ── Row → engine mapping ─────────────────────────────────────────────────────

/** Maps pricing_rules rows into the engine's normalized rule values. */
export function mapRulesToEngine(rows: readonly PricingRuleRow[]): PricingRuleValue[] {
  return rows.map((r) => ({
    ruleKey: r.rule_key,
    ruleType: r.rule_type,
    valueNumeric: toFiniteNumber(r.value_numeric),
  }));
}

/**
 * Slice 12Q follow-up — keep customer-facing rounding CONSISTENT across every
 * public service. Rounding is stored as a per-service `rounding_increment`
 * pricing rule, so a service whose own rule is inactive/absent silently loses
 * rounding (a service WITHOUT VAT/RUT still looks rounded only because the engine
 * rounds the excl-VAT subtotal, but VAT/RUT services do not). To guarantee the
 * SAME interval everywhere, the calculate path resolves a company-wide fallback
 * increment and this helper injects it as a synthetic rounding rule whenever the
 * target service has no active rounding increment of its own. A service that DOES
 * define its own active increment always keeps it (per-service override wins).
 */
export function withRoundingFallback(
  rules: readonly PricingRuleRow[],
  fallbackIncrement: number | null | undefined,
): PricingRuleRow[] {
  const list = [...rules];
  const hasActiveRounding = list.some(
    (r) => r.rule_key === "rounding_increment" && (toFiniteNumber(r.value_numeric) ?? 0) > 0,
  );
  const inc = toFiniteNumber(fallbackIncrement ?? null);
  if (hasActiveRounding || inc === null || inc <= 0) return list;
  list.push({
    id: "synthetic-company-rounding",
    rule_key: "rounding_increment",
    rule_type: "rounding",
    value_numeric: inc,
  });
  return list;
}

/** Maps a cleaning_plans row into the engine's frozen plan snapshot. */
export function mapPlanToSnapshot(row: CleaningPlanRow): CleaningPlanSnapshot {
  return {
    id: row.id,
    serviceKey: row.service_key ?? "home_cleaning",
    planKey: row.plan_key,
    name: row.name,
    hourlyRate: toFiniteNumber(row.hourly_rate) ?? 0,
    vatRatePercent: toFiniteNumber(row.vat_rate_percent) ?? 25,
    priceAdjustmentType: priceAdjustmentType(row.price_adjustment_type),
    priceAdjustmentValue: toFiniteNumber(row.price_adjustment_value) ?? 0,
    rutEligible: row.rut_eligible === true,
    rutEnabled: row.rut_enabled === true,
    rutPercent: toFiniteNumber(row.rut_percent) ?? 50,
    rutApplyTo: rutApplyTo(row.rut_apply_to),
    showRutBreakdown: row.show_rut_breakdown === true,
  };
}

/** Maps editable calculator_size_bands rows into engine snapshots. */
export function mapSizeBandsToEngine(rows: readonly CalculatorSizeBandRow[]): CalculatorSizeBandSnapshot[] {
  return rows.map((row) => ({
    serviceKey: row.service_key,
    minSqm: toFiniteNumber(row.min_sqm) ?? 0,
    maxSqm: toFiniteNumber(row.max_sqm),
    recommendedHours: toFiniteNumber(row.recommended_hours) ?? 0,
    extraHoursPerStarted10Sqm: toFiniteNumber(row.extra_hours_per_started_10_sqm),
    extraHoursStartAfterSqm: toFiniteNumber(row.extra_hours_start_after_sqm),
    active: row.active === true,
    sortOrder: toFiniteNumber(row.sort_order) ?? 0,
  }));
}

/** Finds the selected plan by uuid first, then by stable plan key. */
function resolveSelectedPlan(
  plans: readonly CleaningPlanRow[],
  request: PublicCalculateRequest,
): CleaningPlanRow | null {
  if (request.cleaningPlanId) {
    const byId = plans.find((p) => p.id === request.cleaningPlanId);
    if (byId) return byId;
  }
  if (request.cleaningPlanKey) {
    const byKey = plans.find((p) => p.plan_key === request.cleaningPlanKey);
    if (byKey) return byKey;
  }
  return null;
}

// ── Calculate orchestration ──────────────────────────────────────────────────

export interface CalculateParts {
  settings: Pick<CalculatorSettingsRow, "currency" | "price_display_mode" | "enabled" | "default_vat_rate_percent">;
  /** The service matched by serviceKey (null when missing/disabled/soft-deleted). */
  service: CalculatorServiceRow | null;
  plans: CleaningPlanRow[];
  rules: PricingRuleRow[];
  sizeBands?: CalculatorSizeBandRow[];
  request: PublicCalculateRequest;
}

/** Builds an invalid calculate response carrying a single issue. */
function invalidCalculate(
  parts: CalculateParts,
  pricingModel: PricingModel | null,
  issueCode: string,
  message: string,
  field?: string,
): PublicCalculateResponse {
  return {
    ok: true,
    enabled: Boolean(parts.settings.enabled),
    valid: false,
    issues: [{ code: issueCode, message, ...(field ? { field } : {}) }],
    serviceKey: parts.request.serviceKey,
    pricingModel,
    formulaVersion: "v1",
    currency: parts.settings.currency ?? "SEK",
    priceDisplayMode: resolvePriceDisplayMode(parts.settings.price_display_mode),
    estimatedHours: null,
    calculatedPrice: null,
    minPrice: null,
    maxPrice: null,
    priceExclVat: null,
    vatRatePercent: toFiniteNumber(parts.settings.default_vat_rate_percent) ?? 25,
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
  };
}

/**
 * The shared core behind both calculate and submit: resolves the service + plan
 * and runs the APPROVED pure engine. `ok:false` means resolution failed BEFORE
 * the engine ran (service missing/disabled, unknown model, unresolved plan);
 * `ok:true` carries the full engine result, which may itself be `valid:false`
 * for bad inputs (missing_sqm, missing_plan, …). Never trusts a client price.
 */
type QuoteComputation =
  | { ok: false; issue: PriceIssue; pricingModel: PricingModel | null }
  | {
      ok: true;
      service: CalculatorServiceRow;
      planRow: CleaningPlanRow | null;
      result: PriceCalculationResult;
    };

function computeQuote(parts: CalculateParts): QuoteComputation {
  const { settings, service, plans, rules, sizeBands = [], request } = parts;

  // Service must exist, be active, and use a known pricing model.
  if (!service || !service.enabled) {
    return {
      ok: false,
      pricingModel: null,
      issue: {
        code: "service_unavailable",
        field: "serviceKey",
        message: "Den valda tjänsten är inte tillgänglig.",
      },
    };
  }
  if (!isPricingModel(service.pricing_model)) {
    return {
      ok: false,
      pricingModel: null,
      issue: {
        code: "unknown_pricing_model",
        field: "serviceKey",
        message: "Tjänsten saknar en giltig prismodell.",
      },
    };
  }
  const pricingModel = service.pricing_model;

  // Plan resolution is service-scoped. If plans are disabled for the service,
  // any supplied plan is ignored and legacy rule-based pricing remains unchanged.
  const planSettings = servicePlanSettings(service);
  const servicePlans = plans.filter((p) => (p.service_key ?? "home_cleaning") === service.service_key);
  const planIdentifierSupplied = Boolean(request.cleaningPlanId || request.cleaningPlanKey);
  const selectedPlanRow = planSettings.plansEnabled ? resolveSelectedPlan(servicePlans, request) : null;
  if (planSettings.plansEnabled && planIdentifierSupplied && !selectedPlanRow) {
    return {
      ok: false,
      pricingModel,
      issue: {
        code: "plan_not_found",
        field: "cleaningPlanId",
        message: "Den valda planen hittades inte.",
      },
    };
  }
  const planSnapshot = selectedPlanRow ? mapPlanToSnapshot(selectedPlanRow) : null;

  const result = calculatePrice({
    pricingModel,
    answers: request.answers,
    rules: mapRulesToEngine(rules),
    plan: planSnapshot,
    servicePlanSettings: planSettings,
    sizeBands: mapSizeBandsToEngine(sizeBands.filter((band) => band.service_key === service.service_key)),
    sqmAdjustments: parseSqmAdjustments(asObject(service.settings_json).homeSqmAdjustments),
    defaultVatRatePercent: toFiniteNumber(settings.default_vat_rate_percent) ?? 25,
    currency: settings.currency ?? "SEK",
    priceDisplayMode: resolvePriceDisplayMode(settings.price_display_mode),
  });

  return { ok: true, service, planRow: selectedPlanRow, result };
}

/** Maps a valid engine result to the public-safe selected-plan summary. */
function toPublicSelectedPlan(result: PriceCalculationResult) {
  return result.selectedPlanSnapshot
    ? {
        planKey: result.selectedPlanSnapshot.planKey,
        name: result.selectedPlanSnapshot.name,
        hourlyRate: result.selectedPlanSnapshot.hourlyRate,
        vatRatePercent: result.selectedPlanSnapshot.vatRatePercent ?? result.vatRatePercent,
        rutEnabled: result.rutEnabled,
        rutPercent: result.rutPercent,
        showRutBreakdown: result.showRutBreakdown,
      }
    : null;
}

/**
 * Server-authoritative calculation. Validates the service is active and that a
 * plan is supplied when required, maps the rows into the approved engine input,
 * runs the engine, and shapes a public-safe response. Never trusts any
 * client-supplied price. Writes nothing.
 */
export function runCalculation(parts: CalculateParts): PublicCalculateResponse {
  const comp = computeQuote(parts);
  if (comp.ok === false) {
    return invalidCalculate(
      parts,
      comp.pricingModel,
      comp.issue.code,
      comp.issue.message,
      comp.issue.field,
    );
  }
  const { service, result } = comp;
  return {
    ok: true,
    enabled: Boolean(parts.settings.enabled),
    valid: result.valid,
    issues: result.issues,
    serviceKey: service.service_key,
    pricingModel: result.pricingModel,
    formulaVersion: result.formulaVersion,
    currency: result.currency,
    priceDisplayMode: result.priceDisplayMode,
    estimatedHours: result.estimatedHours,
    calculatedPrice: result.calculatedPrice,
    minPrice: result.minPrice,
    maxPrice: result.maxPrice,
    priceExclVat: result.priceExclVat,
    vatRatePercent: result.vatRatePercent,
    vatAmount: result.vatAmount,
    priceInclVat: result.priceInclVat,
    rutEnabled: result.rutEnabled,
    rutPercent: result.rutPercent,
    showRutBreakdown: result.showRutBreakdown,
    rutDeduction: result.rutDeduction,
    priceAfterRut: result.priceAfterRut,
    roundingIncrement: result.roundingIncrement,
    displayText: buildResultDisplayText(result),
    selectedPlan: toPublicSelectedPlan(result),
  };
}

// ── Submit orchestration (submit action) ─────────────────────────────────────
//
// `submit` is the WRITE path. It enforces the critical safety rule (NOTHING is
// written while the calculator is dark), recomputes the price server-side, and
// — only when enabled + valid — produces the prospect/quote/answer row PAYLOADS
// plus the public-safe response. The Edge Function performs the ordered I/O and
// injects the DB-generated uuids. All decision logic lives here so it is unit
// testable without a database.

/** RFC-pragmatic email shape guard (local@domain.tld, no spaces). */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_CONTACT_LEN = 200;
const MAX_PHONE_LEN = 60;
const MAX_POSTAL_LEN = 20;
const MAX_URL_LEN = 2000;
const DEFAULT_QUOTE_STATUSES: readonly string[] = [
  "submitted",
  "pending_review",
  "ready_for_customer",
];
const MS_PER_DAY = 86_400_000;

export function isValidEmail(value: string): boolean {
  return value.length <= 320 && EMAIL_RE.test(value);
}

/** Trims a string, returns null when empty/non-string, caps to maxLen. */
function cleanContactString(value: unknown, maxLen: number = MAX_CONTACT_LEN): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t === "" ? null : t.slice(0, maxLen);
}

/** Reads a string from settings.content, falling back when missing/blank. */
function contentText(settings: CalculatorSettingsRow, key: string, fallback: string): string {
  const v = asObject(settings.content)[key];
  return typeof v === "string" && v.trim() !== "" ? v : fallback;
}

/**
 * Validates the default quote status against the allowed MVP subset. Exported so
 * the Home V2 submit path (`publicCalculatorV2.ts`, Slice V2-E2b) resolves the
 * SAME status without duplicating the allow-list.
 */
export function resolveDefaultQuoteStatus(value: unknown): string {
  return typeof value === "string" && DEFAULT_QUOTE_STATUSES.includes(value)
    ? value
    : "submitted";
}

export type SubmitValidation =
  | { ok: true; value: PublicSubmitRequest }
  | { ok: false; error: string; field?: string };

/**
 * Validates + normalises a submit request. Builds on validateCalculateRequest
 * (serviceKey/answers/plan) and additionally REQUIRES a contact object with a
 * present, well-formed email. Name/phone/postalCode/sourceUrl are optional and
 * sanitised. The client price (if any) is ignored entirely — never read here.
 */
export function validateSubmitRequest(raw: unknown): SubmitValidation {
  const base = validateCalculateRequest(raw);
  if (base.ok === false) return { ok: false, error: base.error };

  const body = asObject(raw);
  const contactRaw = body.contact;
  if (!contactRaw || typeof contactRaw !== "object" || Array.isArray(contactRaw)) {
    return { ok: false, error: "A contact object is required.", field: "contact" };
  }
  const contactObj = contactRaw as Record<string, unknown>;

  const email =
    typeof contactObj.email === "string" ? contactObj.email.trim().toLowerCase() : "";
  if (email === "") {
    return { ok: false, error: "An email address is required.", field: "email" };
  }
  if (!isValidEmail(email)) {
    return { ok: false, error: "A valid email address is required.", field: "email" };
  }

  const contact: PublicContact = {
    name: cleanContactString(contactObj.name),
    email,
    phone: cleanContactString(contactObj.phone, MAX_PHONE_LEN),
    postalCode: cleanContactString(
      contactObj.postalCode ?? contactObj.postal_code,
      MAX_POSTAL_LEN,
    ),
  };
  const sourceUrl = cleanContactString(body.sourceUrl ?? body.source_url, MAX_URL_LEN);

  return { ok: true, value: { ...base.value, contact, sourceUrl } };
}

export interface SubmitParts {
  /** FULL settings row (needs submission columns: thresholds, validity, status). */
  settings: CalculatorSettingsRow;
  service: CalculatorServiceRow | null;
  plans: CleaningPlanRow[];
  rules: PricingRuleRow[];
  sizeBands?: CalculatorSizeBandRow[];
  /** Questions for the matched service — used to freeze answer label/type snapshots. */
  questions: CalculatorQuestionRow[];
  request: PublicSubmitRequest;
  /** A live prospect already on file for (company + lower(email)), else null. */
  existingProspect: ExistingProspect | null;
  /** Injected for deterministic valid_until + submittedAt. */
  now: Date;
  /** Injected id generator for the row legacy_ids (testable + non-uuid). */
  newId: (prefix: string) => string;
}

/** The disabled (calculator-dark) response. Writes NOTHING; the critical rule. */
export function buildDisabledSubmitResponse(serviceKey: string | null): PublicSubmitResponse {
  return {
    ok: true,
    enabled: false,
    available: false,
    status: "not_available",
    valid: false,
    issues: [
      { code: "calculator_disabled", message: "Priskalkylatorn är inte aktiv just nu." },
    ],
    serviceKey,
    pricingModel: null,
    formulaVersion: null,
    currency: null,
    priceDisplayMode: null,
    estimatedHours: null,
    calculatedPrice: null,
    minPrice: null,
    maxPrice: null,
    priceExclVat: null,
    vatRatePercent: 25,
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
 * The honeypot (bot) response. A bot that fills the hidden honeypot field gets a
 * benign, accepted-LOOKING 200 so it cannot learn it was caught — but the Edge
 * Function returns this BEFORE any recompute or write, so NOTHING is persisted
 * (no prospect, quote, or answer; no quote reference). A real person never fills
 * the field (it is hidden, non-tabbable, autocomplete-off), so the negligible
 * false-positive simply sees a generic "received" confirmation. The critical
 * write-nothing guarantee is preserved exactly as for the disabled path.
 */
export function buildHoneypotSubmitResponse(serviceKey: string | null): PublicSubmitResponse {
  return {
    ok: true,
    enabled: true,
    available: true,
    status: "submitted",
    valid: true,
    issues: [],
    serviceKey,
    pricingModel: null,
    formulaVersion: null,
    currency: null,
    priceDisplayMode: null,
    estimatedHours: null,
    calculatedPrice: null,
    minPrice: null,
    maxPrice: null,
    priceExclVat: null,
    vatRatePercent: 25,
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
    // NOTHING was written, so there is no real quote reference to hand back.
    quoteRequestLegacyId: null,
    reference: null,
    validUntil: null,
    requiresManualReview: false,
    nextStep: {
      confirmationText: "Tack! Din förfrågan är mottagen. Vi återkommer inom kort.",
      showLoginPrompt: false,
      loginPromptText: null,
    },
  };
}

/** An enabled-but-rejected response (validation/recompute failed). Writes NOTHING. */
function invalidSubmitResponse(
  request: PublicSubmitRequest,
  settings: CalculatorSettingsRow,
  pricingModel: PricingModel | null,
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
    formulaVersion: "v1",
    currency: settings.currency ?? "SEK",
    priceDisplayMode: resolvePriceDisplayMode(settings.price_display_mode),
    estimatedHours: null,
    calculatedPrice: null,
    minPrice: null,
    maxPrice: null,
    priceExclVat: null,
    vatRatePercent: toFiniteNumber(settings.default_vat_rate_percent) ?? 25,
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

/** Freezes the full calculation (incl. every rule value used) for historical truth. */
function buildStoredSnapshot(
  result: PriceCalculationResult,
  serviceKey: string,
  rules: readonly PricingRuleRow[],
  now: Date,
): StoredPricingSnapshot {
  return {
    formulaVersion: result.formulaVersion,
    pricingModel: result.pricingModel,
    serviceKey,
    currency: result.currency,
    priceDisplayMode: result.priceDisplayMode,
    inputs: result.inputs,
    selectedPlanSnapshot: result.selectedPlanSnapshot,
    estimatedHours: result.estimatedHours,
    rawPrice: result.rawPrice ?? 0,
    calculatedPrice: result.calculatedPrice ?? 0,
    minPrice: result.minPrice ?? 0,
    maxPrice: result.maxPrice ?? 0,
    priceExclVat: result.priceExclVat ?? 0,
    vatRatePercent: result.vatRatePercent,
    vatAmount: result.vatAmount ?? 0,
    priceInclVat: result.priceInclVat ?? 0,
    rutEnabled: result.rutEnabled,
    rutPercent: result.rutPercent,
    showRutBreakdown: result.showRutBreakdown,
    rutDeduction: result.rutDeduction ?? 0,
    priceAfterRut: result.priceAfterRut ?? 0,
    ruleValues: mapRulesToEngine(rules),
    steps: result.steps,
    submittedAt: now.toISOString(),
  };
}

/**
 * Builds the prospect upsert payload. Reuses an existing live prospect (found by
 * company + lower(email)) when present — refreshing contact fields (prefer the
 * new value, keep the old when missing) and PRESERVING its CRM status; otherwise
 * inserts a fresh `new` prospect. Email is the normalised dedup key.
 */
export function buildProspectWrite(parts: SubmitParts, existing: ExistingProspect | null): ProspectWrite {
  const { settings, request, newId } = parts;
  const c = request.contact;
  const base = {
    company_id: settings.company_id,
    company_legacy_id: settings.company_legacy_id,
    source: "price_calculator",
  };

  if (existing) {
    return {
      mode: "update",
      id: existing.id,
      legacyId: existing.legacy_id,
      fields: {
        ...base,
        prospect_status: existing.prospect_status ?? "new",
        source_url: request.sourceUrl ?? existing.source_url ?? null,
        name: c.name ?? existing.name ?? null,
        email: c.email,
        phone: c.phone ?? existing.phone ?? null,
        postal_code: c.postalCode ?? existing.postal_code ?? null,
      },
    };
  }

  return {
    mode: "insert",
    id: null,
    legacyId: newId("prospect"),
    fields: {
      ...base,
      prospect_status: "new",
      source_url: request.sourceUrl,
      name: c.name,
      email: c.email,
      phone: c.phone,
      postal_code: c.postalCode,
    },
  };
}

interface QuoteRequestBuild {
  quoteRequest: QuoteRequestWrite;
  status: string;
  validUntil: string | null;
  requiresManualReview: boolean;
}

/** Builds the quote_requests payload with the frozen snapshot + status/validity/review. */
function buildQuoteRequestWrite(
  parts: SubmitParts,
  result: PriceCalculationResult,
  snapshot: StoredPricingSnapshot,
  prospect: ProspectWrite,
): QuoteRequestBuild {
  const { settings, service, request, now, newId } = parts;
  const c = request.contact;
  const status = resolveDefaultQuoteStatus(settings.default_quote_status);
  const validityDays = toFiniteNumber(settings.quote_validity_days) ?? 0;
  const validUntil =
    validityDays > 0 ? new Date(now.getTime() + validityDays * MS_PER_DAY).toISOString() : null;
  const threshold = toFiniteNumber(settings.manual_review_threshold_amount);
  const calculatedPrice = result.calculatedPrice ?? 0;
  const requiresManualReview = threshold !== null && calculatedPrice >= threshold;
  const plan = result.selectedPlanSnapshot;
  const legacyId = newId("qr");

  const fields: Record<string, unknown> = {
    legacy_id: legacyId,
    company_id: settings.company_id,
    company_legacy_id: settings.company_legacy_id,
    prospect_legacy_id: prospect.legacyId,
    customer_id: null,
    calculator_service_id: service ? service.id : null,
    calculator_service_key: request.serviceKey,
    selected_cleaning_plan_id: plan?.id ?? null,
    selected_cleaning_plan_name: plan?.name ?? null,
    selected_cleaning_plan_hourly_rate: plan?.hourlyRate ?? null,
    estimated_hours: result.estimatedHours,
    calculated_price: result.calculatedPrice,
    min_price: result.minPrice,
    max_price: result.maxPrice,
    currency: result.currency,
    price_display_mode: result.priceDisplayMode,
    pricing_model: result.pricingModel,
    formula_version: result.formulaVersion,
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
 * Builds one immutable answer snapshot per submitted answer. Known questions
 * freeze their label + input type; unknown answers are still preserved (already
 * sanitised by coerceAnswers) with null snapshots so the submission stays whole.
 */
export function buildAnswerWrites(parts: SubmitParts): QuoteRequestAnswerWrite[] {
  const { settings, request, questions, newId } = parts;
  const byKey = new Map<string, CalculatorQuestionRow>();
  for (const q of questions) byKey.set(q.question_key, q);

  return Object.entries(request.answers).map(([key, value], i): QuoteRequestAnswerWrite => {
    const q = byKey.get(key) ?? null;
    return {
      legacyId: newId("qra"),
      fields: {
        company_id: settings.company_id,
        company_legacy_id: settings.company_legacy_id,
        question_key: key,
        question_label_snapshot: q ? q.label : null,
        input_type_snapshot: q ? q.input_type : null,
        answer_value_json: { value: value ?? null },
        affects_pricing: q && typeof q.affects_pricing === "boolean" ? q.affects_pricing : true,
        sort_order: q ? (q.sort_order ?? i) : i,
      },
    };
  });
}

/** Public-safe success response — quote LEGACY id only, no uuids/rules/trace. */
function buildSubmitSuccessResponse(
  parts: SubmitParts,
  result: PriceCalculationResult,
  meta: { quoteRequestLegacyId: string; status: string; validUntil: string | null; requiresManualReview: boolean },
): PublicSubmitResponse {
  const { settings, request } = parts;
  const showLoginPrompt = Boolean(settings.show_login_prompt_after_submit);
  const loginText = contentText(settings, "loginPromptText", "");
  const nextStep: PublicSubmitNextStep = {
    confirmationText: contentText(
      settings,
      "quoteCreatedText",
      "Tack! Din förfrågan är mottagen. Vi återkommer inom kort.",
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
    serviceKey: request.serviceKey,
    pricingModel: result.pricingModel,
    formulaVersion: result.formulaVersion,
    currency: result.currency,
    priceDisplayMode: result.priceDisplayMode,
    estimatedHours: result.estimatedHours,
    calculatedPrice: result.calculatedPrice,
    minPrice: result.minPrice,
    maxPrice: result.maxPrice,
    priceExclVat: result.priceExclVat,
    vatRatePercent: result.vatRatePercent,
    vatAmount: result.vatAmount,
    priceInclVat: result.priceInclVat,
    rutEnabled: result.rutEnabled,
    rutPercent: result.rutPercent,
    showRutBreakdown: result.showRutBreakdown,
    rutDeduction: result.rutDeduction,
    priceAfterRut: result.priceAfterRut,
    roundingIncrement: result.roundingIncrement,
    displayText: buildResultDisplayText(result),
    selectedPlan: toPublicSelectedPlan(result),
    quoteRequestLegacyId: meta.quoteRequestLegacyId,
    reference: null,
    validUntil: meta.validUntil,
    requiresManualReview: meta.requiresManualReview,
    nextStep,
  };
}

/**
 * Freezes a MANUAL-REVIEW submission (no automatic price) into the snapshot
 * shape. Mirrors {@link buildStoredSnapshot} but with NULL price fields and an
 * empty rule/step trace — there is no priced calculation, only the captured
 * inputs + the machine reason (e.g. "custom_interval"). The reason is stored for
 * the admin's later context; it is NOT in {@link extractSnapshotSummary}'s
 * allow-list, so it never reaches the inbox UI.
 */
function buildManualReviewSnapshot(
  result: PriceCalculationResult,
  serviceKey: string,
  now: Date,
): Record<string, unknown> {
  return {
    formulaVersion: result.formulaVersion,
    pricingModel: result.pricingModel,
    serviceKey,
    currency: result.currency,
    priceDisplayMode: result.priceDisplayMode,
    inputs: result.inputs,
    selectedPlanSnapshot: null,
    estimatedHours: null,
    rawPrice: null,
    calculatedPrice: null,
    minPrice: null,
    maxPrice: null,
    ruleValues: [],
    steps: [],
    manualReviewReason: result.manualReviewReason,
    submittedAt: now.toISOString(),
  };
}

/**
 * Builds the quote_requests payload for a MANUAL-REVIEW submission: NULL price
 * fields, no plan, requires_manual_review=true. Status + validity follow the
 * same settings as a priced quote so the inbox treats it consistently.
 */
function buildManualReviewQuoteRequestWrite(
  parts: SubmitParts,
  result: PriceCalculationResult,
  prospect: ProspectWrite,
): QuoteRequestBuild {
  const { settings, service, request, now, newId } = parts;
  const c = request.contact;
  const status = resolveDefaultQuoteStatus(settings.default_quote_status);
  const validityDays = toFiniteNumber(settings.quote_validity_days) ?? 0;
  const validUntil =
    validityDays > 0 ? new Date(now.getTime() + validityDays * MS_PER_DAY).toISOString() : null;
  const legacyId = newId("qr");
  const snapshot = buildManualReviewSnapshot(result, request.serviceKey, now);

  const fields: Record<string, unknown> = {
    legacy_id: legacyId,
    company_id: settings.company_id,
    company_legacy_id: settings.company_legacy_id,
    prospect_legacy_id: prospect.legacyId,
    customer_id: null,
    calculator_service_id: service ? service.id : null,
    calculator_service_key: request.serviceKey,
    selected_cleaning_plan_id: null,
    selected_cleaning_plan_name: null,
    selected_cleaning_plan_hourly_rate: null,
    estimated_hours: null,
    calculated_price: null,
    min_price: null,
    max_price: null,
    currency: result.currency,
    price_display_mode: result.priceDisplayMode,
    pricing_model: result.pricingModel,
    formula_version: result.formulaVersion,
    pricing_snapshot_json: snapshot,
    status,
    source: "price_calculator",
    source_url: request.sourceUrl,
    customer_name: c.name,
    customer_email: c.email,
    customer_phone: c.phone,
    address_json: c.postalCode ? { postalCode: c.postalCode } : {},
    valid_until: validUntil,
    requires_manual_review: true,
    reference: null,
  };

  return {
    quoteRequest: { legacyId, prospectLegacyId: prospect.legacyId, fields },
    status,
    validUntil,
    requiresManualReview: true,
  };
}

/**
 * Assembles a ready-to-write MANUAL-REVIEW submission (prospect + priceless quote
 * + frozen answers + public response). The visitor is accepted (so we can follow
 * up) even though no price was computed; the response carries null figures,
 * requiresManualReview=true and the standard confirmation copy.
 */
function buildManualReviewSubmission(
  parts: SubmitParts,
  result: PriceCalculationResult,
): PreparedSubmission {
  const prospect = buildProspectWrite(parts, parts.existingProspect);
  const { quoteRequest, status, validUntil } = buildManualReviewQuoteRequestWrite(
    parts,
    result,
    prospect,
  );
  const answers = buildAnswerWrites(parts);
  const response = buildSubmitSuccessResponse(parts, result, {
    quoteRequestLegacyId: quoteRequest.legacyId,
    status,
    validUntil,
    requiresManualReview: true,
  });
  return { kind: "ready", prospect, quoteRequest, answers, response };
}

/**
 * Pure submit preparation. Order: (1) ENABLED gate — dark calculator writes
 * NOTHING; (2) recompute server-side; (3) MANUAL-REVIEW path (valid-but-not-
 * priceable, e.g. office custom interval) persists a priceless quote so the
 * visitor can be contacted; (4) reject genuinely-invalid input/price; (5) build
 * the priced prospect/quote/answer payloads + frozen snapshot + public response.
 * The caller performs the ordered writes and fills DB-generated uuids.
 */
export function prepareSubmission(parts: SubmitParts): PreparedSubmission {
  const { settings, service, plans, rules, request, existingProspect } = parts;

  // (1) Critical safety rule: never write while the calculator is dark.
  if (!settings.enabled) {
    return { kind: "disabled", response: buildDisabledSubmitResponse(request.serviceKey) };
  }

  // (2) Server-authoritative recompute (client price is never read).
  const comp = computeQuote({ settings, service, plans, rules, request });
  if (comp.ok === false) {
    return {
      kind: "invalid",
      response: invalidSubmitResponse(request, settings, comp.pricingModel, [comp.issue]),
    };
  }
  const { result } = comp;

  // (3) MANUAL REVIEW: a valid-but-not-priceable choice (e.g. office "custom
  //     interval"). No automatic price, but the visitor must still be able to
  //     submit so we can follow up → persist a priceless quote with
  //     requires_manual_review=true (NULL price fields). The dark/honeypot/invalid
  //     write-nothing guarantees are unaffected.
  if (result.requiresManualReview) {
    return buildManualReviewSubmission(parts, result);
  }

  // (4) Reject invalid inputs / priceless results — nothing is written.
  if (!result.valid || result.calculatedPrice === null) {
    return {
      kind: "invalid",
      response: invalidSubmitResponse(request, settings, result.pricingModel, result.issues),
    };
  }

  // (5) Build the frozen snapshot + write payloads + public response.
  const snapshot = buildStoredSnapshot(result, request.serviceKey, rules, parts.now);
  const prospect = buildProspectWrite(parts, existingProspect);
  const { quoteRequest, status, validUntil, requiresManualReview } = buildQuoteRequestWrite(
    parts,
    result,
    snapshot,
    prospect,
  );
  const answers = buildAnswerWrites(parts);
  const response = buildSubmitSuccessResponse(parts, result, {
    quoteRequestLegacyId: quoteRequest.legacyId,
    status,
    validUntil,
    requiresManualReview,
  });

  return { kind: "ready", prospect, quoteRequest, answers, response };
}

/** Normalises a public slug from the request (lowercased, trimmed, length-checked). */
export function normalizeSlug(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase().slice(0, 200) : "";
}

/** A conservative slug shape guard (letters, digits, hyphens; matches the seeded slug). */
export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,198}[a-z0-9])?$/.test(slug);
}
