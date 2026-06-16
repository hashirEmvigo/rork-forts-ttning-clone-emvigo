/**
 * Price Calculator — Super Admin CONFIGURATION editor repository (Slice 10A).
 *
 * Supabase-authoritative reads/writes for the Super Admin Calculator
 * configuration editor (`/calculator`). Everything goes through the
 * AUTHENTICATED Supabase client, so the calculator's super_admin-only RLS
 * (migrations 0058/0059) is what gates access — there is no anon path and no
 * localStorage source of truth.
 *
 * SCOPE / SAFETY RULES encoded here:
 *   • Reads load the FULL editable config for the MVP company (resolved by the
 *     stable public slug, never a hard-coded uuid).
 *   • Writes are SMALL and TARGETED: each update touches one row matched by its
 *     stable `legacy_id` (+ `deleted_at is null`) and writes only the supplied
 *     columns. Stable machine keys (service_key / question_key / plan_key /
 *     rule_key / pricing_model) and internal identifiers are NEVER written.
 *   • No hard delete anywhere — "removing" a question is `active = false`.
 *   • Pricing-rule VALUES are intentionally NOT writable here (Slice 10A keeps
 *     pricing rules read-only); only their safe display fields are read.
 *   • `enabled` is NOT written here — that deliberate switch stays single-sourced
 *     in {@link setCalculatorEnabled} (calculatorAdmin.ts) behind its own confirm.
 */
import type { UserRole } from "@/types";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

import { MVP_CALCULATOR_PUBLIC_SLUG } from "./calculatorAdmin";
import { GENERIC_PRICING_MODELS, type GenericPricingModel } from "./v2/pricingModel";
import {
  isGenericModelEngineSupported,
  validateGenericPlan,
  type GenericPlanDraft,
} from "./v2/genericPricingContract";
import {
  assessSqmFixedReadiness,
  hasSqmPrimaryInput,
  isEngineBackedGenericPricingModel,
  SQM_FIXED_PRIMARY_INPUT_KEY,
} from "./genericAdminReadiness";
import {
  mapAddonLibraryItemRow,
  mapQuestionLibraryItemRow,
  type AddonLibraryItem,
  type AddonLibraryItemRow,
  type QuestionLibraryItem,
  type QuestionLibraryItemRow,
} from "./libraryItems";

// ── Stable vocabularies (mirror the DB CHECK constraints + the pure engine) ──

/**
 * The ONLY question keys the pure pricing engine understands per pricing model
 * (see `_shared/calculator/pricingEngine.ts`). A question with
 * `affects_pricing = true` whose key is NOT in this set silently does nothing —
 * the editor warns about exactly that ("requires pricing support").
 */
export const PRICING_SUPPORTED_QUESTION_KEYS: Record<string, readonly string[]> = {
  // Slice 12I: bathrooms retired; frequency (four-week interval) + has_pets now
  // affect the home price (rule-driven time adjustments + pets uplift).
  home_cleaning_recommended_hours: ["sqm", "frequency", "addons", "has_pets"],
  move_out_fixed_plus_addons: ["sqm", "bathrooms", "glazed_balcony", "divisible_windows"],
  // GPM-7: the LITERAL generic `sqm_fixed` engine prices from the customer's area
  // answer (`request.answers.sqm`). Declaring `sqm` here is what makes the Admin editor
  // treat the area question as a real pricing input ("Affects price", no acknowledgement
  // prompt) instead of an unsupported one. Admin-only vocabulary — the runtime reads
  // `answers.sqm` directly and never consults this map.
  sqm_fixed: [SQM_FIXED_PRIMARY_INPUT_KEY],
  office_cleaning_recurring_area_frequency: [
    "sqm",
    "frequency",
    "toilets",
    "workstations",
    "meeting_rooms",
    "has_kitchen",
    // Slice 12F — supervision cleaning (tillsynsstädning) price-affecting inputs.
    "supervision_cleaning",
    "supervision_visits_per_week",
    "supervision_minutes_per_visit",
  ],
};

/**
 * Pricing-rule keys an engine-backed model REQUIRES to price correctly. A service
 * missing any active required rule is "Missing pricing" (never public-ready) even
 * if it has SOME active rules — used by {@link computeServiceReadiness}. Models
 * without an entry only need ≥ 1 active rule (the pre-12F behaviour). Office
 * cleaning needs its hourly_rate AND the supervision_start_minutes rule (Slice
 * 12F) so the supervision add-on is always rule-driven, never silently 0.
 */
export const REQUIRED_PRICING_RULE_KEYS: Record<string, readonly string[]> = {
  office_cleaning_recurring_area_frequency: ["hourly_rate", "supervision_start_minutes"],
};

/** Pricing models the pure ENGINE actually implements (the only ones that can go public). */
export const SUPPORTED_PRICING_MODELS = [
  "home_cleaning_recommended_hours",
  "move_out_fixed_plus_addons",
  "office_cleaning_recurring_area_frequency",
] as const;
export type SupportedLegacyPricingModel = (typeof SUPPORTED_PRICING_MODELS)[number];

/** A pricing-model choice offered when creating a service. */
export interface PricingModelOption {
  value: string;
  label: string;
  /** True when the pure engine implements it (so the service can become public-ready). */
  supported: boolean;
  /**
   * True for legacy, service-named models (GPM-1). Kept selectable for backward-
   * compat but de-emphasized: the generic models are the forward direction.
   */
  legacy?: boolean;
}

/** Admin-facing labels for the generic pricing models (GPM-1). */
export const GENERIC_PRICING_MODEL_LABELS: Readonly<Record<GenericPricingModel, string>> = {
  hourly_by_area: "Hourly by area",
  sqm_fixed: "Fixed price per m²",
  unit_based: "Unit based",
  fixed_package: "Fixed package",
  manual_quote: "Manual quote",
};

/**
 * Generic pricing-model options (GPM-1) — the forward direction AND the only models
 * offered when creating a NEW service (GPM-3b). Marked `supported: false` for now
 * because a brand-new standalone generic-model service is not yet routed to a pricing
 * engine (routing still keys off service identity), so it stays a draft until a later
 * slice wires generic routing. They are NOT legacy. Ordered by
 * {@link GENERIC_PRICING_MODELS}.
 */
export const GENERIC_PRICING_MODEL_OPTIONS: readonly PricingModelOption[] = GENERIC_PRICING_MODELS.map((value) => ({
  value,
  label: GENERIC_PRICING_MODEL_LABELS[value],
  supported: false,
  legacy: false,
}));

/** A short, admin-facing explanation of a generic pricing model (GPM-3b dialog preview). */
export interface GenericPricingModelSummary {
  /** Friendly label (same as {@link GENERIC_PRICING_MODEL_LABELS}). */
  label: string;
  /** What the customer's primary input is, in words. */
  primaryInput: string;
  /** One line on how the price is produced. */
  pricing: string;
  /** Example services that typically use this model. */
  typicalUse: string;
}

/**
 * Per-model copy shown in the create-service dialog so an admin can see what a
 * generic pricing model means before committing (GPM-3b). Presentation-only — it
 * drives no pricing or routing. Exhaustive over {@link GenericPricingModel} so the
 * compiler forces every model to declare its preview.
 */
export const GENERIC_PRICING_MODEL_SUMMARIES: Readonly<Record<GenericPricingModel, GenericPricingModelSummary>> = {
  hourly_by_area: {
    label: GENERIC_PRICING_MODEL_LABELS.hourly_by_area,
    primaryInput: "Area (m²)",
    pricing: "Estimated hours × plan hourly rate",
    typicalUse: "Home, Office, Deep cleaning",
  },
  sqm_fixed: {
    label: GENERIC_PRICING_MODEL_LABELS.sqm_fixed,
    primaryInput: "Area (m²)",
    pricing: "m² × plan price per m²",
    typicalUse: "Move-out cleaning",
  },
  unit_based: {
    label: GENERIC_PRICING_MODEL_LABELS.unit_based,
    primaryInput: "Quantity",
    pricing: "Quantity × plan unit price",
    typicalUse: "Window cleaning",
  },
  fixed_package: {
    label: GENERIC_PRICING_MODEL_LABELS.fixed_package,
    primaryInput: "None",
    pricing: "Plan fixed price",
    typicalUse: "Package / fixed-price services",
  },
  manual_quote: {
    label: GENERIC_PRICING_MODEL_LABELS.manual_quote,
    primaryInput: "None",
    pricing: "No automatic price — manual review",
    typicalUse: "Procurement / custom jobs",
  },
};

/**
 * Pricing models selectable when scaffolding a service. Legacy, service-named
 * models (flagged `legacy`) come first for backward-compat: the three engine-
 * backed ones (home/move-out/office) can still go public immediately; the rest are
 * reserved template identifiers (allowed by the DB CHECK from migration 0065). The
 * generic models (GPM-1) are appended as the forward direction. A service using a
 * model the engine cannot price yet stays non-public ("Unsupported pricing") until
 * it is implemented + parity-tested.
 */
export const SELECTABLE_PRICING_MODELS: readonly PricingModelOption[] = [
  { value: "home_cleaning_recommended_hours", label: "Home cleaning — recommended hours", supported: true, legacy: true },
  { value: "move_out_fixed_plus_addons", label: "Move-out — fixed price + add-ons", supported: true, legacy: true },
  { value: "office_cleaning_recurring_area_frequency", label: "Office — area × frequency", supported: true, legacy: true },
  { value: "window_cleaning_count_based", label: "Window — count based (template)", supported: false, legacy: true },
  { value: "deep_cleaning_area_addons", label: "Deep cleaning — area + add-ons (template)", supported: false, legacy: true },
  { value: "stairwell_cleaning_floors_frequency", label: "Stairwell — floors × frequency (template)", supported: false, legacy: true },
  { value: "inquiry_only_no_price", label: "Inquiry only — no price (template)", supported: false, legacy: true },
  ...GENERIC_PRICING_MODEL_OPTIONS,
];

/** Whether the pure engine implements a pricing model (i.e. it can be public-ready). */
export function isSupportedPricingModel(model: string): boolean {
  return SUPPORTED_PRICING_MODELS.includes(model as SupportedLegacyPricingModel);
}

/**
 * Whether the Admin readiness/health surface should treat a pricing model as
 * ENGINE-BACKED (so it can become public-ready and must NOT read as "Unsupported
 * pricing"). This is the single source of truth shared by {@link computeServiceReadiness}
 * and {@link computeCalculatorConfigHealth}: the three legacy engine models
 * ({@link SUPPORTED_PRICING_MODELS}) PLUS the LITERAL generic `sqm_fixed` the V2
 * runtime prices today (GPM-6-R). Reserved generic models
 * (`unit_based`/`fixed_package`/`manual_quote`) and unimplemented legacy templates
 * stay false. Mirrors the runtime so Admin and the public engine never disagree.
 */
export function isEngineBackedPricingModel(model: string): boolean {
  return isSupportedPricingModel(model) || isEngineBackedGenericPricingModel(model);
}

// ── Generic service creation (GPM-3a) ───────────────────────────────────────

/** True when a raw string is one of the GPM-1 generic pricing models. */
function isGenericPricingModelValue(value: string): value is GenericPricingModel {
  return (GENERIC_PRICING_MODELS as readonly string[]).includes(value);
}

/**
 * The generic pricing model preselected when scaffolding a new service (GPM-3a).
 * Brand-new services are generic-only, so the default points at the first generic
 * model rather than a legacy, service-named one.
 */
export const DEFAULT_NEW_SERVICE_PRICING_MODEL: GenericPricingModel = GENERIC_PRICING_MODELS[0];

/**
 * The safe `settings_json` a brand-new service of each generic pricing model is
 * created with (GPM-3a). These are presentation/booking DEFAULTS only — nothing
 * here enables the service or makes it public (creation always forces
 * enabled=false + coming_soon=false). The fields are additive: no public or
 * pricing runtime consumes them yet; they seed the canonical V2 service config
 * that later slices will read.
 */
export interface GenericServiceSettingsDefaults {
  /** What the customer's primary input is (drives the public primary field later). */
  primaryInput?: "sqm" | "quantity" | "none";
  /** Customer-facing unit label for the primary input, when it has one. */
  unitLabel?: string;
  /** Recurring vs one-off booking cadence. */
  bookingMode: "recurring" | "one_off";
  /** Which public result layout this service presents with. */
  publicLayout: "recurring_cleaning" | "one_off_cleaning" | "move_out_cleaning";
  /** Final display rounding interval in SEK (null = nearest whole SEK fallback). */
  displayRoundingInterval: number | null;
  /** Whether a cleaning plan is required (mirrors the seed flag). */
  requiresCleaningPlan: boolean;
  /** Whether the model produces an automatic price (false → manual quote). */
  automaticPricing?: boolean;
}

/**
 * Returns the approved default `settings_json` for a generic pricing model
 * (GPM-3a). Pure + exhaustive over {@link GenericPricingModel} so the compiler
 * forces every model to declare its defaults.
 */
export function defaultSettingsForGenericModel(model: GenericPricingModel): GenericServiceSettingsDefaults {
  switch (model) {
    case "hourly_by_area":
      return {
        primaryInput: "sqm",
        unitLabel: "m²",
        bookingMode: "recurring",
        publicLayout: "recurring_cleaning",
        displayRoundingInterval: null,
        requiresCleaningPlan: true,
      };
    case "sqm_fixed":
      return {
        primaryInput: "sqm",
        unitLabel: "m²",
        bookingMode: "one_off",
        publicLayout: "one_off_cleaning",
        displayRoundingInterval: null,
        requiresCleaningPlan: true,
      };
    case "unit_based":
      return {
        primaryInput: "quantity",
        unitLabel: "st",
        bookingMode: "one_off",
        publicLayout: "one_off_cleaning",
        displayRoundingInterval: null,
        requiresCleaningPlan: true,
      };
    case "fixed_package":
      return {
        primaryInput: "none",
        bookingMode: "one_off",
        publicLayout: "one_off_cleaning",
        displayRoundingInterval: null,
        requiresCleaningPlan: true,
      };
    case "manual_quote":
      return {
        automaticPricing: false,
        bookingMode: "one_off",
        publicLayout: "one_off_cleaning",
        displayRoundingInterval: null,
        requiresCleaningPlan: false,
      };
  }
}

/** Question input types allowed by the DB CHECK constraint (0058). */
export const SUPPORTED_INPUT_TYPES = [
  "number",
  "integer",
  "select",
  "multiselect",
  "boolean",
  "text",
  "postal_code",
  "date",
] as const;
export type CalculatorInputType = (typeof SUPPORTED_INPUT_TYPES)[number];

/** Input types that REQUIRE a non-empty option set. */
export const OPTION_INPUT_TYPES: readonly CalculatorInputType[] = ["select", "multiselect"];

/**
 * Slice V2-E0E-1 — generic add-on customer input types persisted by
 * `calculator_addons` (migration 0074). ONLY these two are allowed: a yes/no
 * toggle or a numeric quantity. `single_select` is intentionally absent until the
 * Admin UI, public rendering, and the V2 resolver support it together — persisting
 * it before then would let rows exist that nothing can render or price.
 */
export const SUPPORTED_ADDON_INPUT_TYPES = ["boolean", "quantity"] as const;
export type CalculatorAddonInputType = (typeof SUPPORTED_ADDON_INPUT_TYPES)[number];

/** Settings enums (mirror the calculator_settings CHECK constraints). */
export const PRICE_DISPLAY_MODES = ["exact", "range", "hidden_until_submit"] as const;
export type PriceDisplayModeValue = (typeof PRICE_DISPLAY_MODES)[number];
export const DEFAULT_QUOTE_STATUSES = ["submitted", "pending_review", "ready_for_customer"] as const;
export type DefaultQuoteStatusValue = (typeof DEFAULT_QUOTE_STATUSES)[number];
export const RUT_DISPLAY_MODES = ["none", "show_after_rut", "show_before_after"] as const;
export type RutDisplayModeValue = (typeof RUT_DISPLAY_MODES)[number];
export const PLAN_PRICING_MODELS = [
  "hourly_rate_by_plan",
  "price_adjustment_per_plan",
  "time_adjustment_per_visit",
  // Slice 12L office pilot — per-plan hourly rate + fixed time adjustment per visit.
  "hourly_rate_plus_time_adjustment",
] as const;
export type PlanPricingModelValue = (typeof PLAN_PRICING_MODELS)[number];
export const PLAN_PRICE_ADJUSTMENT_TYPES = ["fixed_amount", "percent"] as const;
export type PlanPriceAdjustmentTypeValue = (typeof PLAN_PRICE_ADJUSTMENT_TYPES)[number];
export const RUT_APPLY_TO_VALUES = ["total_customer_price", "labor_service_price_only"] as const;
export type RutApplyToValue = (typeof RUT_APPLY_TO_VALUES)[number];

/** A machine-safe key: lowercase letters, digits and underscores, starting with a letter. */
export const MACHINE_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;
/** A machine-safe question key (alias kept for existing imports). */
export const QUESTION_KEY_PATTERN = MACHINE_KEY_PATTERN;
/** A machine-safe cleaning-plan key. */
export const PLAN_KEY_PATTERN = MACHINE_KEY_PATTERN;
/** A machine-safe service key. */
export const SERVICE_KEY_PATTERN = MACHINE_KEY_PATTERN;
/** A machine-safe generic add-on key. */
export const ADDON_KEY_PATTERN = MACHINE_KEY_PATTERN;

// ── Row shapes (snake_case, as returned by Supabase) ────────────────────────

interface FullSettingsRow {
  legacy_id: string;
  company_id: string;
  company_legacy_id: string;
  enabled: boolean;
  public_slug: string | null;
  price_display_mode: string;
  show_price_before_contact: boolean;
  require_contact_before_result: boolean;
  show_login_prompt_after_submit: boolean;
  quote_validity_days: number;
  manual_review_threshold_amount: number | string | null;
  currency: string;
  rut_display_mode: string;
  default_vat_rate_percent?: number | string | null;
  auto_create_prospect: boolean;
  auto_create_quote_request: boolean;
  default_quote_status: string;
}

interface FullServiceRow {
  id: string;
  legacy_id: string;
  service_key: string;
  display_name: string;
  description: string | null;
  enabled: boolean;
  coming_soon: boolean;
  pricing_model: string;
  sort_order: number;
  settings_json: unknown;
}

/**
 * Slice 12Q — a single Home Cleaning per-square-meter adjustment range. Stored
 * inside `calculator_services.settings_json.homeSqmAdjustments` (no schema
 * change). Each range scales the configured Minutes per m² by `adjustmentPercent`
 * for areas inside `[fromSqm, toSqm]` (toSqm null = open-ended top range).
 */
export interface SqmAdjustmentRangeConfig {
  fromSqm: number;
  toSqm: number | null;
  adjustmentPercent: number;
}

interface ServiceSettingsJson {
  requiresCleaningPlan?: boolean;
  plansEnabled?: boolean;
  planPricingModel?: PlanPricingModelValue;
  defaultPlanKey?: string | null;
  baseHourlyRateExclVat?: number | null;
  defaultVatRatePercent?: number;
  homeSqmAdjustments?: SqmAdjustmentRangeConfig[];
}

interface FullQuestionRow {
  legacy_id: string;
  calculator_service_id: string;
  calculator_service_legacy_id: string | null;
  question_key: string;
  label: string;
  help_text: string | null;
  input_type: string;
  required: boolean;
  options_json: unknown;
  validation_json: unknown;
  affects_pricing: boolean;
  sort_order: number;
  active: boolean;
}

interface FullPlanRow {
  legacy_id: string;
  calculator_service_id?: string | null;
  calculator_service_legacy_id?: string | null;
  service_key?: string | null;
  plan_key: string;
  name: string;
  description: string | null;
  hourly_rate: number | string;
  vat_rate_percent?: number | string | null;
  price_adjustment_type?: string | null;
  price_adjustment_value?: number | string | null;
  rut_eligible?: boolean;
  rut_enabled?: boolean;
  rut_percent?: number | string | null;
  rut_apply_to?: string | null;
  show_rut_breakdown?: boolean;
  // Slice V2-D0 (migration 0073) — explicit, typed V2 plan-card pricing columns.
  start_adjustment_hours?: number | string | null;
  price_per_sqm_excl_vat?: number | string | null;
  fixed_adjustment_excl_vat?: number | string | null;
  minimum_price_excl_vat?: number | string | null;
  flexibility_level: string | null;
  customer_day_time_control: string | null;
  same_staff_preference_level: string | null;
  booking_priority: string | null;
  cancellation_terms_summary: string | null;
  is_default: boolean;
  active: boolean;
  sort_order: number;
}

interface FullPricingRuleRow {
  legacy_id: string;
  calculator_service_id: string;
  rule_key: string;
  rule_type: string;
  value_numeric: number | string | null;
  active: boolean;
  sort_order: number;
}

interface FullSizeBandRow {
  legacy_id: string;
  calculator_service_id: string;
  calculator_service_legacy_id: string | null;
  service_key: string;
  min_sqm: number | string;
  max_sqm: number | string | null;
  recommended_hours: number | string;
  extra_hours_per_started_10_sqm: number | string | null;
  extra_hours_start_after_sqm: number | string | null;
  active: boolean;
  sort_order: number;
}

interface FullAddonRow {
  legacy_id: string;
  calculator_service_id: string;
  calculator_service_legacy_id: string | null;
  service_key: string;
  addon_key: string;
  name: string;
  public_label: string;
  description: string | null;
  input_type: string;
  boolean_default: boolean;
  quantity_min: number | string;
  quantity_max: number | string | null;
  quantity_step: number | string;
  quantity_default: number | string;
  effect_time_minutes: number | string;
  effect_fixed_excl_vat: number | string;
  effect_percent: number | string;
  active: boolean;
  public_visible: boolean;
  required: boolean;
  sort_order: number;
}

// ── App-facing views (camelCase) ────────────────────────────────────────────

/** A single (multi)select option. */
export interface QuestionOption {
  value: string;
  label: string;
}

export interface CalculatorQuestionConfig {
  legacyId: string;
  serviceId: string;
  serviceLegacyId: string | null;
  questionKey: string;
  label: string;
  helpText: string | null;
  inputType: string;
  required: boolean;
  affectsPricing: boolean;
  sortOrder: number;
  active: boolean;
  options: QuestionOption[];
}

export interface CalculatorServiceConfig {
  id: string;
  legacyId: string;
  serviceKey: string;
  displayName: string;
  description: string | null;
  enabled: boolean;
  comingSoon: boolean;
  pricingModel: string;
  sortOrder: number;
  requiresCleaningPlan: boolean;
  plansEnabled: boolean;
  planPricingModel: PlanPricingModelValue;
  defaultPlanKey: string | null;
  baseHourlyRateExclVat: number | null;
  defaultVatRatePercent: number;
  /** Slice 12Q — Home Cleaning per-sqm-range % adjustments to Minutes per m². Optional so existing fixtures/callers stay valid; the mapper always supplies a (possibly empty) array. */
  homeSqmAdjustments?: SqmAdjustmentRangeConfig[];
  questions: CalculatorQuestionConfig[];
}

export interface CleaningPlanConfig {
  legacyId: string;
  serviceId: string | null;
  serviceLegacyId: string | null;
  serviceKey: string;
  planKey: string;
  name: string;
  description: string | null;
  hourlyRate: number;
  vatRatePercent: number;
  priceAdjustmentType: PlanPriceAdjustmentTypeValue;
  priceAdjustmentValue: number;
  rutEligible: boolean;
  rutEnabled: boolean;
  rutPercent: number;
  rutApplyTo: RutApplyToValue;
  showRutBreakdown: boolean;
  /**
   * Slice V2-D — clean, explicit V2 plan-card pricing fields (migration 0073).
   * Optional so existing fixtures/callers stay valid; {@link mapPlanConfigRow}
   * always supplies them. `startAdjustmentHours` is a PRICE-only adjustment in V2
   * (it never changes the customer-facing estimated service time).
   */
  startAdjustmentHours?: number;
  pricePerSqmExclVat?: number | null;
  fixedAdjustmentExclVat?: number;
  minimumPriceExclVat?: number | null;
  flexibilityLevel: string | null;
  customerDayTimeControl: string | null;
  sameStaffPreferenceLevel: string | null;
  bookingPriority: string | null;
  cancellationTermsSummary: string | null;
  isDefault: boolean;
  active: boolean;
  sortOrder: number;
}

export interface PricingRuleConfig {
  legacyId: string;
  serviceId: string;
  ruleKey: string;
  ruleType: string;
  valueNumeric: number | null;
  active: boolean;
  sortOrder: number;
}

export interface CalculatorSizeBandConfig {
  legacyId: string;
  serviceId: string;
  serviceLegacyId: string | null;
  serviceKey: string;
  minSqm: number;
  maxSqm: number | null;
  recommendedHours: number;
  extraHoursPerStarted10Sqm: number | null;
  extraHoursStartAfterSqm: number | null;
  active: boolean;
  sortOrder: number;
}

/**
 * Slice V2-E0E-1 — Admin editor view of a generic add-on (`calculator_addons`,
 * migration 0074). Same semantics as the pure V2 runtime add-on type but a
 * different layer: this carries the Admin row identity (legacyId / serviceId) the
 * editor needs, decoupled from the engine's resolved shape. Effects are three
 * explicit channels — time (minutes/unit), fixed (excl VAT/unit, may be ±), and
 * percent (±) — never a vague "affects price" flag.
 */
export interface CalculatorAddonConfig {
  legacyId: string;
  serviceId: string;
  serviceLegacyId: string | null;
  serviceKey: string;
  addonKey: string;
  name: string;
  publicLabel: string;
  description: string | null;
  inputType: CalculatorAddonInputType;
  booleanDefault: boolean;
  quantityMin: number;
  quantityMax: number | null;
  quantityStep: number;
  quantityDefault: number;
  effectTimeMinutes: number;
  effectFixedExclVat: number;
  effectPercent: number;
  active: boolean;
  publicVisible: boolean;
  required: boolean;
  sortOrder: number;
}

export interface CalculatorSettingsConfig {
  legacyId: string;
  companyId: string;
  companyLegacyId: string;
  enabled: boolean;
  publicSlug: string | null;
  priceDisplayMode: string;
  showPriceBeforeContact: boolean;
  requireContactBeforeResult: boolean;
  showLoginPromptAfterSubmit: boolean;
  quoteValidityDays: number;
  manualReviewThresholdAmount: number | null;
  currency: string;
  rutDisplayMode: string;
  defaultVatRatePercent: number;
  autoCreateProspect: boolean;
  autoCreateQuoteRequest: boolean;
  defaultQuoteStatus: string;
}

/** The full editable configuration rendered by the Super Admin editor. */
export interface CalculatorConfig {
  companyName: string | null;
  settings: CalculatorSettingsConfig;
  services: CalculatorServiceConfig[];
  cleaningPlans: CleaningPlanConfig[];
  pricingRules: PricingRuleConfig[];
  sizeBands: CalculatorSizeBandConfig[];
  /**
   * Slice V2-E0E-1 — generic add-ons for every service (`calculator_addons`).
   * Optional so existing fixtures/callers stay valid; {@link getCalculatorConfig}
   * always supplies a (possibly empty) array. No public/Admin runtime consumes it
   * yet — this slice only loads + exposes the data for the upcoming Add-ons UI.
   */
  addons?: CalculatorAddonConfig[];
}

// ── Pure helpers + mappers (no I/O — unit-tested directly) ──────────────────

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function numberOrDefault(value: unknown, fallback: number): number {
  const n = numberOrNull(value);
  return n === null ? fallback : n;
}

function planPricingModelOrDefault(value: unknown): PlanPricingModelValue {
  return PLAN_PRICING_MODELS.includes(value as PlanPricingModelValue)
    ? (value as PlanPricingModelValue)
    : "hourly_rate_by_plan";
}

function planAdjustmentTypeOrDefault(value: unknown): PlanPriceAdjustmentTypeValue {
  return PLAN_PRICE_ADJUSTMENT_TYPES.includes(value as PlanPriceAdjustmentTypeValue)
    ? (value as PlanPriceAdjustmentTypeValue)
    : "fixed_amount";
}

function rutApplyToOrDefault(value: unknown): RutApplyToValue {
  return RUT_APPLY_TO_VALUES.includes(value as RutApplyToValue)
    ? (value as RutApplyToValue)
    : "total_customer_price";
}

/**
 * Slice 12Q — parses a loosely-typed `homeSqmAdjustments` blob into a clean,
 * sorted range list. Drops malformed rows; tolerates missing/legacy data (empty
 * list = no adjustment). `toSqm` may be null (open-ended top range).
 */
export function parseSqmAdjustments(raw: unknown): SqmAdjustmentRangeConfig[] {
  if (!Array.isArray(raw)) return [];
  const out: SqmAdjustmentRangeConfig[] = [];
  for (const item of raw) {
    const obj = asRecord(item);
    const fromSqm = numberOrNull(obj.fromSqm);
    const adjustmentPercent = numberOrNull(obj.adjustmentPercent);
    if (fromSqm === null || fromSqm < 0 || adjustmentPercent === null) continue;
    const toSqm = numberOrNull(obj.toSqm);
    if (toSqm !== null && toSqm < fromSqm) continue;
    out.push({ fromSqm, toSqm, adjustmentPercent });
  }
  return out.sort((a, b) => a.fromSqm - b.fromSqm);
}

function serviceSettings(value: unknown): ServiceSettingsJson {
  const obj = asRecord(value);
  return {
    requiresCleaningPlan: typeof obj.requiresCleaningPlan === "boolean" ? obj.requiresCleaningPlan : undefined,
    plansEnabled: typeof obj.plansEnabled === "boolean" ? obj.plansEnabled : undefined,
    planPricingModel: planPricingModelOrDefault(obj.planPricingModel),
    defaultPlanKey: typeof obj.defaultPlanKey === "string" ? obj.defaultPlanKey : null,
    baseHourlyRateExclVat: numberOrNull(obj.baseHourlyRateExclVat),
    defaultVatRatePercent: numberOrDefault(obj.defaultVatRatePercent, 25),
    homeSqmAdjustments: parseSqmAdjustments(obj.homeSqmAdjustments),
  };
}

/** Parses a loosely-typed `options_json` blob into a clean `{value,label}[]`. */
export function parseQuestionOptions(raw: unknown): QuestionOption[] {
  if (!Array.isArray(raw)) return [];
  const out: QuestionOption[] = [];
  for (const item of raw) {
    const obj = asRecord(item);
    const value = typeof obj.value === "string" ? obj.value : null;
    if (value === null || value === "") continue;
    const label = typeof obj.label === "string" && obj.label.trim() !== "" ? obj.label : value;
    out.push({ value, label });
  }
  return out;
}

/** Maps a `calculator_questions` row to its editor view. */
export function mapQuestionRow(row: FullQuestionRow): CalculatorQuestionConfig {
  return {
    legacyId: row.legacy_id,
    serviceId: row.calculator_service_id,
    serviceLegacyId: row.calculator_service_legacy_id ?? null,
    questionKey: row.question_key,
    label: row.label,
    helpText: row.help_text ?? null,
    inputType: row.input_type,
    required: row.required === true,
    affectsPricing: row.affects_pricing === true,
    sortOrder: row.sort_order ?? 0,
    active: row.active === true,
    options: parseQuestionOptions(row.options_json),
  };
}

/** Maps a `calculator_services` row to its editor view (questions attached separately). */
export function mapServiceConfigRow(row: FullServiceRow): Omit<CalculatorServiceConfig, "questions"> {
  const settings = serviceSettings(row.settings_json);
  const requiresCleaningPlan = settings.requiresCleaningPlan ?? row.pricing_model === "home_cleaning_recommended_hours";
  const plansEnabled = settings.plansEnabled ?? requiresCleaningPlan;
  return {
    id: row.id,
    legacyId: row.legacy_id,
    serviceKey: row.service_key,
    displayName: row.display_name,
    description: row.description ?? null,
    enabled: row.enabled === true,
    comingSoon: row.coming_soon === true,
    pricingModel: row.pricing_model,
    sortOrder: row.sort_order ?? 0,
    requiresCleaningPlan,
    plansEnabled,
    planPricingModel: settings.planPricingModel ?? "hourly_rate_by_plan",
    defaultPlanKey: settings.defaultPlanKey ?? null,
    baseHourlyRateExclVat: settings.baseHourlyRateExclVat ?? null,
    defaultVatRatePercent: settings.defaultVatRatePercent ?? 25,
    homeSqmAdjustments: settings.homeSqmAdjustments ?? [],
  };
}

/** Maps a `cleaning_plans` row to its editor view. */
export function mapPlanConfigRow(row: FullPlanRow): CleaningPlanConfig {
  return {
    legacyId: row.legacy_id,
    serviceId: row.calculator_service_id ?? null,
    serviceLegacyId: row.calculator_service_legacy_id ?? null,
    serviceKey: row.service_key ?? "home_cleaning",
    planKey: row.plan_key,
    name: row.name,
    description: row.description ?? null,
    hourlyRate: Number(row.hourly_rate),
    vatRatePercent: numberOrDefault(row.vat_rate_percent, 25),
    priceAdjustmentType: planAdjustmentTypeOrDefault(row.price_adjustment_type),
    priceAdjustmentValue: numberOrDefault(row.price_adjustment_value, 0),
    rutEligible: row.rut_eligible === true,
    rutEnabled: row.rut_enabled === true,
    rutPercent: numberOrDefault(row.rut_percent, 50),
    rutApplyTo: rutApplyToOrDefault(row.rut_apply_to),
    showRutBreakdown: row.show_rut_breakdown === true,
    startAdjustmentHours: numberOrDefault(row.start_adjustment_hours, 0),
    pricePerSqmExclVat: numberOrNull(row.price_per_sqm_excl_vat),
    fixedAdjustmentExclVat: numberOrDefault(row.fixed_adjustment_excl_vat, 0),
    minimumPriceExclVat: numberOrNull(row.minimum_price_excl_vat),
    flexibilityLevel: row.flexibility_level ?? null,
    customerDayTimeControl: row.customer_day_time_control ?? null,
    sameStaffPreferenceLevel: row.same_staff_preference_level ?? null,
    bookingPriority: row.booking_priority ?? null,
    cancellationTermsSummary: row.cancellation_terms_summary ?? null,
    isDefault: row.is_default === true,
    active: row.active === true,
    sortOrder: row.sort_order ?? 0,
  };
}

/** Maps a `pricing_rules` row to its read-only editor view. */
export function mapPricingRuleRow(row: FullPricingRuleRow): PricingRuleConfig {
  return {
    legacyId: row.legacy_id,
    serviceId: row.calculator_service_id,
    ruleKey: row.rule_key,
    ruleType: row.rule_type,
    valueNumeric: numberOrNull(row.value_numeric),
    active: row.active === true,
    sortOrder: row.sort_order ?? 0,
  };
}

/** Maps a `calculator_size_bands` row to its editor view. */
export function mapSizeBandRow(row: FullSizeBandRow): CalculatorSizeBandConfig {
  return {
    legacyId: row.legacy_id,
    serviceId: row.calculator_service_id,
    serviceLegacyId: row.calculator_service_legacy_id ?? null,
    serviceKey: row.service_key,
    minSqm: numberOrDefault(row.min_sqm, 0),
    maxSqm: numberOrNull(row.max_sqm),
    recommendedHours: numberOrDefault(row.recommended_hours, 0),
    extraHoursPerStarted10Sqm: numberOrNull(row.extra_hours_per_started_10_sqm),
    extraHoursStartAfterSqm: numberOrNull(row.extra_hours_start_after_sqm),
    active: row.active === true,
    sortOrder: row.sort_order ?? 0,
  };
}

/** Coerces a raw add-on input type to a supported value (defaults to boolean). */
function addonInputTypeOrDefault(value: unknown): CalculatorAddonInputType {
  return value === "quantity" ? "quantity" : "boolean";
}

/** Maps a `calculator_addons` row to its editor view. */
export function mapAddonRow(row: FullAddonRow): CalculatorAddonConfig {
  return {
    legacyId: row.legacy_id,
    serviceId: row.calculator_service_id,
    serviceLegacyId: row.calculator_service_legacy_id ?? null,
    serviceKey: row.service_key,
    addonKey: row.addon_key,
    name: row.name,
    publicLabel: row.public_label,
    description: row.description ?? null,
    inputType: addonInputTypeOrDefault(row.input_type),
    booleanDefault: row.boolean_default === true,
    quantityMin: numberOrDefault(row.quantity_min, 0),
    quantityMax: numberOrNull(row.quantity_max),
    quantityStep: numberOrDefault(row.quantity_step, 1),
    quantityDefault: numberOrDefault(row.quantity_default, 0),
    effectTimeMinutes: numberOrDefault(row.effect_time_minutes, 0),
    effectFixedExclVat: numberOrDefault(row.effect_fixed_excl_vat, 0),
    effectPercent: numberOrDefault(row.effect_percent, 0),
    active: row.active === true,
    publicVisible: row.public_visible === true,
    required: row.required === true,
    sortOrder: row.sort_order ?? 0,
  };
}

/** Maps a `calculator_settings` row to the editor settings view. */
export function mapSettingsConfigRow(row: FullSettingsRow): CalculatorSettingsConfig {
  return {
    legacyId: row.legacy_id,
    companyId: row.company_id,
    companyLegacyId: row.company_legacy_id,
    enabled: row.enabled === true,
    publicSlug: row.public_slug ?? null,
    priceDisplayMode: row.price_display_mode,
    showPriceBeforeContact: row.show_price_before_contact === true,
    requireContactBeforeResult: row.require_contact_before_result === true,
    showLoginPromptAfterSubmit: row.show_login_prompt_after_submit === true,
    quoteValidityDays: row.quote_validity_days ?? 0,
    manualReviewThresholdAmount: numberOrNull(row.manual_review_threshold_amount),
    currency: row.currency,
    rutDisplayMode: row.rut_display_mode,
    defaultVatRatePercent: numberOrDefault(row.default_vat_rate_percent, 25),
    autoCreateProspect: row.auto_create_prospect === true,
    autoCreateQuoteRequest: row.auto_create_quote_request === true,
    defaultQuoteStatus: row.default_quote_status,
  };
}

// ── Configuration health (pure, exported, unit-tested) ──────────────────────

export type ConfigHealthLevel = "blocking" | "warning" | "info";

export interface ConfigHealthItem {
  level: ConfigHealthLevel;
  code: string;
  message: string;
  /** Optional human context (e.g. the service/question this refers to). */
  context?: string;
}

/**
 * Detects unsafe or incomplete calculator configuration. Pure + deterministic so
 * the editor can render a live health panel and the result is unit-testable.
 * "Blocking" issues mean the service/calculator would not work correctly if live.
 */
export function computeCalculatorConfigHealth(config: CalculatorConfig): ConfigHealthItem[] {
  const items: ConfigHealthItem[] = [];

  for (const service of config.services) {
    const servicePlansEnabled = service.plansEnabled ?? service.requiresCleaningPlan;
    const servicePlans = config.cleaningPlans.filter((p) => (p.serviceKey ?? "home_cleaning") === service.serviceKey);
    const anyActiveServicePlan = servicePlans.some((p) => p.active);
    const isPublic = service.enabled && !service.comingSoon;
    const activeQuestions = service.questions.filter((q) => q.active);
    const serviceRules = config.pricingRules.filter((r) => r.serviceId === service.id);
    const activeRules = serviceRules.filter((r) => r.active);
    const supportedKeys = PRICING_SUPPORTED_QUESTION_KEYS[service.pricingModel] ?? null;

    // Engine-backed = the legacy engine models PLUS the literal generic `sqm_fixed`
    // the V2 runtime prices today (GPM-6-R). A literal `sqm_fixed` service must NOT be
    // flagged "unsupported pricing model" here.
    const isSqmFixed = isEngineBackedGenericPricingModel(service.pricingModel);
    if (!isEngineBackedPricingModel(service.pricingModel)) {
      items.push({
        level: service.enabled ? "blocking" : "warning",
        code: "service_unsupported_pricing_model",
        message: `Service "${service.displayName}" uses an unsupported pricing model (${service.pricingModel}).`,
        context: service.serviceKey,
      });
    }

    if (service.enabled && service.comingSoon) {
      items.push({
        level: "warning",
        code: "service_public_and_coming_soon",
        message: `Service "${service.displayName}" is enabled but also marked "coming soon".`,
        context: service.serviceKey,
      });
    }

    if (isPublic && activeQuestions.length === 0) {
      items.push({
        level: "blocking",
        code: "service_no_active_questions",
        message: `Public service "${service.displayName}" has no active questions.`,
        context: service.serviceKey,
      });
    }

    // `sqm_fixed` is priced from the plan's price per m², NOT from legacy pricing
    // rules, so it is exempt from the active-rules requirement (GPM-6-R).
    if (isPublic && !isSqmFixed && activeRules.length === 0) {
      items.push({
        level: "blocking",
        code: "service_no_active_pricing_rules",
        message: `Public service "${service.displayName}" has no active pricing rules.`,
        context: service.serviceKey,
      });
    }

    if (isPublic && servicePlansEnabled && !anyActiveServicePlan) {
      items.push({
        level: "blocking",
        code: "service_requires_plan_none_active",
        message: `"${service.displayName}" requires a cleaning plan but no plan is active.`,
        context: service.serviceKey,
      });
    }

    // For a public `sqm_fixed` service WITH an active plan, the default/selected plan
    // must carry a positive price per m² — the figure the V2 engine multiplies by area
    // (GPM-6-R). Mirrors the runtime's `missing_price_per_sqm` gate.
    if (isPublic && isSqmFixed) {
      const sqmReadiness = assessSqmFixedReadiness(service.pricingModel, servicePlans);
      if (sqmReadiness.reason === "missing_price_per_sqm") {
        items.push({
          level: "blocking",
          code: "service_sqm_fixed_missing_price_per_sqm",
          message: `Service "${service.displayName}" prices by m² but its active cleaning plan has no positive price per m².`,
          context: service.serviceKey,
        });
      }
    }

    // Per-question checks.
    const seenKeys = new Map<string, number>();
    for (const q of activeQuestions) {
      seenKeys.set(q.questionKey, (seenKeys.get(q.questionKey) ?? 0) + 1);

      if (OPTION_INPUT_TYPES.includes(q.inputType as CalculatorInputType) && q.options.length === 0) {
        items.push({
          level: "blocking",
          code: "question_select_without_options",
          message: `Question "${q.label}" is a ${q.inputType} but has no options.`,
          context: `${service.serviceKey} · ${q.questionKey}`,
        });
      }

      if (q.affectsPricing && supportedKeys && !supportedKeys.includes(q.questionKey)) {
        items.push({
          level: "warning",
          code: "question_pricing_not_supported",
          message: `Question "${q.label}" affects pricing, but the engine has no support for "${q.questionKey}" — it will not change the price.`,
          context: `${service.serviceKey} · ${q.questionKey}`,
        });
      }
    }
    for (const [key, n] of seenKeys) {
      if (n > 1) {
        items.push({
          level: "blocking",
          code: "duplicate_question_key",
          message: `Service "${service.displayName}" has ${n} active questions sharing the key "${key}".`,
          context: service.serviceKey,
        });
      }
    }
  }

  // Plans: all inactive while some live service needs one.
  const someServiceNeedsPlan = config.services.some(
    (s) => s.enabled && !s.comingSoon && (s.plansEnabled ?? s.requiresCleaningPlan),
  );
  const anyNeededServiceHasNoActivePlan = config.services.some(
    (s) =>
      s.enabled &&
      !s.comingSoon &&
      (s.plansEnabled ?? s.requiresCleaningPlan) &&
      !config.cleaningPlans.some((p) => (p.serviceKey ?? "home_cleaning") === s.serviceKey && p.active),
  );
  if (config.cleaningPlans.length > 0 && anyNeededServiceHasNoActivePlan && someServiceNeedsPlan) {
    items.push({
      level: "blocking",
      code: "all_plans_inactive",
      message: "All cleaning plans are inactive, but a public service requires a plan.",
    });
  }

  // Enabled while blocking issues exist.
  const hasBlocking = items.some((i) => i.level === "blocking");
  if (config.settings.enabled && hasBlocking) {
    items.push({
      level: "blocking",
      code: "enabled_with_blocking_issues",
      message: "The public calculator is enabled while configuration has blocking issues.",
    });
  }

  return items;
}

// ── Service readiness (pure, exported, unit-tested) ─────────────────────────

/** A service's public-readiness status (drives the admin badge + public gating). */
export type ServiceReadinessStatus =
  | "ready"
  | "draft"
  | "missing_fields"
  | "missing_pricing"
  | "unsupported_pricing";

export interface ServiceReadiness {
  status: ServiceReadinessStatus;
  label: string;
  tone: "green" | "blue" | "amber" | "red" | "muted";
  /** True when the service is structurally complete enough to be shown publicly. */
  publicReady: boolean;
  /** Specific, human-readable gaps (empty when fully ready). */
  reasons: string[];
}

const SERVICE_READINESS_META: Record<
  ServiceReadinessStatus,
  { label: string; tone: ServiceReadiness["tone"] }
> = {
  ready: { label: "Ready", tone: "green" },
  draft: { label: "Draft", tone: "blue" },
  missing_fields: { label: "Missing fields", tone: "amber" },
  missing_pricing: { label: "Missing pricing", tone: "amber" },
  unsupported_pricing: { label: "Unsupported pricing", tone: "red" },
};

/**
 * Computes a service's public readiness from its live config. Pure + deterministic
 * so the admin can render a clear badge AND public gating can reuse the same
 * `publicReady` decision. A service is public-ready ONLY when its pricing model is
 * engine-backed and it has active questions + active pricing rules (+ an active
 * plan when it requires one). `ready` vs `draft` distinguishes a complete service
 * that is currently public from one that is complete but still hidden.
 */
export function computeServiceReadiness(
  service: CalculatorServiceConfig,
  pricingRules: readonly PricingRuleConfig[],
  plans: readonly CleaningPlanConfig[],
): ServiceReadiness {
  // LITERAL generic `sqm_fixed` (GPM-6-R) is engine-backed but priced from the plan's
  // price per m² — NOT from legacy `pricing_rules`. It takes a dedicated readiness path
  // that mirrors the V2 runtime (`assessGenericServiceRuntimeReadiness`) so the Admin
  // badge and the public engine never disagree. Legacy models keep the unchanged,
  // rule-based path below (incl. `move_out_fixed_plus_addons`, which aliases to the
  // sqm_fixed BASIS but is not the literal generic model).
  if (isEngineBackedGenericPricingModel(service.pricingModel)) {
    return computeSqmFixedServiceReadiness(service, plans);
  }

  const supportedModel = isSupportedPricingModel(service.pricingModel);
  const activeRuleKeys = new Set(
    pricingRules.filter((r) => r.serviceId === service.id && r.active).map((r) => r.ruleKey),
  );
  const activeQuestions = service.questions.filter((q) => q.active).length;
  const activeRules = activeRuleKeys.size;
  const servicePlansEnabled = service.plansEnabled ?? service.requiresCleaningPlan;
  const anyActivePlan = plans.some((p) => (p.serviceKey ?? "home_cleaning") === service.serviceKey && p.active);
  const planOk = !servicePlansEnabled || anyActivePlan;

  // Engine-backed models may REQUIRE specific rule keys (e.g. office cleaning needs
  // hourly_rate + supervision_start_minutes). A missing required rule keeps the
  // service "Missing pricing" even when it has other active rules.
  const requiredRuleKeys = REQUIRED_PRICING_RULE_KEYS[service.pricingModel] ?? [];
  const missingRequiredRules = requiredRuleKeys.filter((k) => !activeRuleKeys.has(k));
  const hasRequiredRules = missingRequiredRules.length === 0;

  const reasons: string[] = [];
  if (!supportedModel) {
    reasons.push(`Pricing model "${service.pricingModel}" is not implemented by the engine yet.`);
  }
  if (activeQuestions === 0) reasons.push("No active questions.");
  if (activeRules === 0) reasons.push("No active pricing rules.");
  else if (!hasRequiredRules) {
    reasons.push(`Missing required pricing rule(s): ${missingRequiredRules.join(", ")}.`);
  }
  if (!planOk) reasons.push("Requires an active cleaning plan, but none is active.");

  const publicReady =
    supportedModel && activeQuestions > 0 && activeRules > 0 && hasRequiredRules && planOk;

  let status: ServiceReadinessStatus;
  if (!supportedModel) status = "unsupported_pricing";
  else if (activeQuestions === 0) status = "missing_fields";
  else if (activeRules === 0 || !hasRequiredRules || !planOk) status = "missing_pricing";
  else status = service.enabled && !service.comingSoon ? "ready" : "draft";

  return {
    status,
    label: SERVICE_READINESS_META[status].label,
    tone: SERVICE_READINESS_META[status].tone,
    publicReady,
    reasons,
  };
}

/**
 * Readiness for a LITERAL generic `sqm_fixed` service (GPM-6-R). Pure + deterministic.
 * `sqm_fixed` is engine-backed, so it NEVER reads as "Unsupported pricing"; its price
 * comes from the plan's price per m², so it NEVER requires legacy `pricing_rules`.
 * Priceability mirrors the runtime ({@link assessSqmFixedReadiness}): ≥1 active plan
 * whose default/selected plan carries a positive price per m². At least one active
 * question is still required as the customer's input (the area/m² primary input).
 */
function computeSqmFixedServiceReadiness(
  service: CalculatorServiceConfig,
  plans: readonly CleaningPlanConfig[],
): ServiceReadiness {
  // GPM-7: the customer's AREA answer is the only input that drives a `sqm_fixed` price
  // (the runtime reads `answers.sqm`). Readiness therefore requires the ACTIVE sqm
  // PRIMARY INPUT specifically — not just any active question — so the Admin badge can
  // never read "Ready" for a service the public engine would reject with `missing_sqm`.
  const hasPrimaryInput = hasSqmPrimaryInput(service.questions);
  const servicePlans = plans.filter((p) => (p.serviceKey ?? "home_cleaning") === service.serviceKey);
  const planReadiness = assessSqmFixedReadiness(service.pricingModel, servicePlans);

  const reasons: string[] = [];
  if (!hasPrimaryInput) {
    reasons.push("Add the area (m²) input customers enter — the price is calculated from it.");
  }
  if (planReadiness.reason === "no_active_plan") {
    reasons.push("Requires an active cleaning plan, but none is active.");
  } else if (planReadiness.reason === "missing_price_per_sqm") {
    reasons.push("The active cleaning plan needs a positive price per m².");
  }

  const publicReady = hasPrimaryInput && planReadiness.priceable;

  let status: ServiceReadinessStatus;
  if (!hasPrimaryInput) status = "missing_fields";
  else if (!planReadiness.priceable) status = "missing_pricing";
  else status = service.enabled && !service.comingSoon ? "ready" : "draft";

  return {
    status,
    label: SERVICE_READINESS_META[status].label,
    tone: SERVICE_READINESS_META[status].tone,
    publicReady,
    reasons,
  };
}

/** Convenience: count health items by level. */
export function summarizeConfigHealth(items: readonly ConfigHealthItem[]): Record<ConfigHealthLevel, number> {
  return items.reduce(
    (acc, item) => {
      acc[item.level] += 1;
      return acc;
    },
    { blocking: 0, warning: 0, info: 0 } as Record<ConfigHealthLevel, number>,
  );
}

// ── Validation (pure, exported) ─────────────────────────────────────────────

export interface NewQuestionDraft {
  questionKey: string;
  label: string;
  inputType: string;
  options: QuestionOption[];
}

/**
 * Validates a new-question draft against the schema + uniqueness rules. Returns
 * a list of human-readable problems ([] when valid). `existingKeys` is the set
 * of question keys already used by the SAME service (live rows).
 */
export function validateNewQuestion(
  draft: NewQuestionDraft,
  existingKeys: readonly string[],
): string[] {
  const errors: string[] = [];
  const key = draft.questionKey.trim();

  if (key === "") {
    errors.push("Question key is required.");
  } else if (!QUESTION_KEY_PATTERN.test(key)) {
    errors.push("Question key must be lowercase letters, digits and underscores, starting with a letter.");
  } else if (existingKeys.includes(key)) {
    errors.push(`Question key "${key}" is already used by this service.`);
  }

  if (draft.label.trim() === "") {
    errors.push("Label is required.");
  }

  if (!SUPPORTED_INPUT_TYPES.includes(draft.inputType as CalculatorInputType)) {
    errors.push("A valid input type is required.");
  }

  if (
    OPTION_INPUT_TYPES.includes(draft.inputType as CalculatorInputType) &&
    draft.options.filter((o) => o.value.trim() !== "").length === 0
  ) {
    errors.push("Select / multiselect questions need at least one option.");
  }

  return errors;
}

// ── Pricing-rule value validation (Slice 10B) ────────────────────────────────

export interface PricingRuleValueValidation {
  /** Parsed numeric value when valid, else null. */
  value: number | null;
  /** Human-readable problem when invalid, else null. */
  error: string | null;
}

/**
 * Validates a raw pricing-rule value string for the "edit existing value" flow.
 * Tolerates Swedish input ("1 200,5"). Rejects empty/NaN/negative — every seeded
 * rule (factors, thresholds, add-on prices/hours, margins, rounding) is ≥ 0, so a
 * negative value is never valid. Zero is allowed (e.g. rounding_increment = 0).
 */
export function validatePricingRuleValue(raw: string): PricingRuleValueValidation {
  const trimmed = raw.trim();
  if (trimmed === "") return { value: null, error: "A value is required." };
  const cleaned = trimmed.replace(/\s/g, "").replace(",", ".");
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return { value: null, error: "Value must be a number." };
  if (n < 0) return { value: null, error: "Value must be zero or greater." };
  return { value: n, error: null };
}

// ── Supabase access ─────────────────────────────────────────────────────────

class CalculatorConfigAdminError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalculatorConfigAdminError";
  }
}

function configuredClient() {
  if (!isSupabaseConfigured || !supabase) {
    throw new CalculatorConfigAdminError(
      "Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }
  return supabase;
}

const SETTINGS_COLUMNS =
  "legacy_id, company_id, company_legacy_id, enabled, public_slug, price_display_mode, " +
  "show_price_before_contact, require_contact_before_result, show_login_prompt_after_submit, " +
  "quote_validity_days, manual_review_threshold_amount, currency, rut_display_mode, " +
  "default_vat_rate_percent, auto_create_prospect, auto_create_quote_request, default_quote_status";

const LEGACY_SETTINGS_COLUMNS =
  "legacy_id, company_id, company_legacy_id, enabled, public_slug, price_display_mode, " +
  "show_price_before_contact, require_contact_before_result, show_login_prompt_after_submit, " +
  "quote_validity_days, manual_review_threshold_amount, currency, rut_display_mode, " +
  "auto_create_prospect, auto_create_quote_request, default_quote_status";

const SERVICE_COLUMNS =
  "id, legacy_id, service_key, display_name, description, enabled, coming_soon, pricing_model, sort_order, settings_json";

const QUESTION_COLUMNS =
  "legacy_id, calculator_service_id, calculator_service_legacy_id, question_key, label, help_text, " +
  "input_type, required, options_json, validation_json, affects_pricing, sort_order, active";

const PLAN_COLUMNS =
  "legacy_id, calculator_service_id, calculator_service_legacy_id, service_key, plan_key, name, description, " +
  "hourly_rate, vat_rate_percent, price_adjustment_type, price_adjustment_value, rut_eligible, rut_enabled, " +
  "rut_percent, rut_apply_to, show_rut_breakdown, start_adjustment_hours, price_per_sqm_excl_vat, " +
  "fixed_adjustment_excl_vat, minimum_price_excl_vat, flexibility_level, customer_day_time_control, " +
  "same_staff_preference_level, booking_priority, cancellation_terms_summary, is_default, active, sort_order";

const LEGACY_PLAN_COLUMNS =
  "legacy_id, plan_key, name, description, hourly_rate, flexibility_level, customer_day_time_control, " +
  "same_staff_preference_level, booking_priority, cancellation_terms_summary, is_default, active, sort_order";

const PRICING_RULE_COLUMNS =
  "legacy_id, calculator_service_id, rule_key, rule_type, value_numeric, active, sort_order";

const SIZE_BAND_COLUMNS =
  "legacy_id, calculator_service_id, calculator_service_legacy_id, service_key, min_sqm, max_sqm, " +
  "recommended_hours, extra_hours_per_started_10_sqm, extra_hours_start_after_sqm, active, sort_order";

const ADDON_COLUMNS =
  "legacy_id, calculator_service_id, calculator_service_legacy_id, service_key, addon_key, name, public_label, " +
  "description, input_type, boolean_default, quantity_min, quantity_max, quantity_step, quantity_default, " +
  "effect_time_minutes, effect_fixed_excl_vat, effect_percent, active, public_visible, required, sort_order";

function isMissingColumnError(error: { message?: string } | null | undefined, columnName: string): boolean {
  const message = error?.message?.toLowerCase() ?? "";
  return message.includes(columnName.toLowerCase()) && message.includes("does not exist");
}

/**
 * True when an error indicates a missing relation/table (older environment without
 * a newer additive table yet). Looser than {@link isMissingColumnError}: a missing
 * table is tolerated by returning an empty list rather than failing the whole load.
 */
function isMissingRelationError(error: { message?: string } | null | undefined, relation: string): boolean {
  const message = error?.message?.toLowerCase() ?? "";
  return message.includes(relation.toLowerCase()) || message.includes("does not exist");
}

async function readSettingsRow(client: ReturnType<typeof configuredClient>): Promise<FullSettingsRow | null> {
  const result = await client
    .from("calculator_settings")
    .select(SETTINGS_COLUMNS)
    .eq("public_slug", MVP_CALCULATOR_PUBLIC_SLUG)
    .is("deleted_at", null)
    .maybeSingle();

  if (!result.error) return (result.data as unknown as FullSettingsRow | null) ?? null;

  if (!isMissingColumnError(result.error, "default_vat_rate_percent")) {
    throw new CalculatorConfigAdminError(`[calculator_settings] read failed: ${result.error.message}`);
  }

  const legacyResult = await client
    .from("calculator_settings")
    .select(LEGACY_SETTINGS_COLUMNS)
    .eq("public_slug", MVP_CALCULATOR_PUBLIC_SLUG)
    .is("deleted_at", null)
    .maybeSingle();

  if (legacyResult.error) {
    throw new CalculatorConfigAdminError(`[calculator_settings] read failed: ${legacyResult.error.message}`);
  }

  return (legacyResult.data as unknown as FullSettingsRow | null) ?? null;
}

async function readPlanRows(client: ReturnType<typeof configuredClient>, companyId: string): Promise<FullPlanRow[]> {
  const result = await client
    .from("cleaning_plans")
    .select(PLAN_COLUMNS)
    .eq("company_id", companyId)
    .is("deleted_at", null)
    .order("sort_order", { ascending: true });

  if (!result.error) return (result.data ?? []) as unknown as FullPlanRow[];

  const phaseOneColumns = [
    "calculator_service_id",
    "calculator_service_legacy_id",
    "service_key",
    "vat_rate_percent",
    "price_adjustment_type",
    "price_adjustment_value",
    "rut_eligible",
    "rut_enabled",
    "rut_percent",
    "rut_apply_to",
    "show_rut_breakdown",
    // Slice V2-D0 (migration 0073) — fall back gracefully on a DB without these yet.
    "start_adjustment_hours",
    "price_per_sqm_excl_vat",
    "fixed_adjustment_excl_vat",
    "minimum_price_excl_vat",
  ];
  const canUseLegacyPlanRead = phaseOneColumns.some((column) => isMissingColumnError(result.error, column));

  if (!canUseLegacyPlanRead) {
    throw new CalculatorConfigAdminError(`[cleaning_plans] read failed: ${result.error.message}`);
  }

  const legacyResult = await client
    .from("cleaning_plans")
    .select(LEGACY_PLAN_COLUMNS)
    .eq("company_id", companyId)
    .is("deleted_at", null)
    .order("sort_order", { ascending: true });

  if (legacyResult.error) {
    throw new CalculatorConfigAdminError(`[cleaning_plans] read failed: ${legacyResult.error.message}`);
  }

  return (legacyResult.data ?? []) as unknown as FullPlanRow[];
}

/**
 * Reads the company's live generic add-ons (Slice V2-E0E-1, migration 0074),
 * ordered by service → sort order → key. Mirrors {@link readPlanRows}'s migration
 * tolerance: a DB without the `calculator_addons` table yet (older environment)
 * must NOT fail the whole config load — it falls back to an empty list so the rest
 * of the editor still renders.
 */
async function readAddonRows(
  client: ReturnType<typeof configuredClient>,
  companyId: string,
): Promise<FullAddonRow[]> {
  const result = await client
    .from("calculator_addons")
    .select(ADDON_COLUMNS)
    .eq("company_id", companyId)
    .is("deleted_at", null)
    .order("calculator_service_id", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("addon_key", { ascending: true });

  // `as unknown as` satisfies the typed Supabase client (whose select() infers a
  // GenericStringError for this table); the older read helpers above carry the
  // same pre-existing cast debt without the `unknown` hop.
  if (!result.error) return (result.data ?? []) as unknown as FullAddonRow[];

  // A missing table (relation does not exist) is tolerated → empty add-on list.
  if (isMissingRelationError(result.error, "calculator_addons")) return [];
  throw new CalculatorConfigAdminError(`[calculator_addons] read failed: ${result.error.message}`);
}

/**
 * Loads the full editable calculator configuration for the MVP company, resolved
 * by the stable public slug. Returns `null` when no live settings row exists, so
 * the editor can render the same clear "not configured" state as the overview.
 */
export async function getCalculatorConfig(): Promise<CalculatorConfig | null> {
  const client = configuredClient();

  const settingsRow = await readSettingsRow(client);
  if (!settingsRow) return null;

  const settings = mapSettingsConfigRow(settingsRow);
  const companyId = settings.companyId;

  const [companyResult, servicesResult, questionsResult, planRows, rulesResult, sizeBandsResult, addonRows] = await Promise.all([
    client.from("companies").select("name").eq("legacy_id", settings.companyLegacyId).maybeSingle(),
    client
      .from("calculator_services")
      .select(SERVICE_COLUMNS)
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .order("sort_order", { ascending: true }),
    client
      .from("calculator_questions")
      .select(QUESTION_COLUMNS)
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .order("sort_order", { ascending: true }),
    readPlanRows(client, companyId),
    client
      .from("pricing_rules")
      .select(PRICING_RULE_COLUMNS)
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .order("sort_order", { ascending: true }),
    client
      .from("calculator_size_bands")
      .select(SIZE_BAND_COLUMNS)
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .order("sort_order", { ascending: true }),
    readAddonRows(client, companyId),
  ]);

  if (servicesResult.error) {
    throw new CalculatorConfigAdminError(`[calculator_services] read failed: ${servicesResult.error.message}`);
  }
  if (questionsResult.error) {
    throw new CalculatorConfigAdminError(`[calculator_questions] read failed: ${questionsResult.error.message}`);
  }
  if (rulesResult.error) {
    throw new CalculatorConfigAdminError(`[pricing_rules] read failed: ${rulesResult.error.message}`);
  }
  const sizeBandsMissing = Boolean(
    sizeBandsResult.error?.message?.toLowerCase().includes("calculator_size_bands") ||
      sizeBandsResult.error?.message?.toLowerCase().includes("does not exist"),
  );
  if (sizeBandsResult.error && !sizeBandsMissing) {
    throw new CalculatorConfigAdminError(`[calculator_size_bands] read failed: ${sizeBandsResult.error.message}`);
  }

  const questions = ((questionsResult.data ?? []) as unknown as FullQuestionRow[]).map(mapQuestionRow);
  const questionsByServiceId = new Map<string, CalculatorQuestionConfig[]>();
  for (const q of questions) {
    const list = questionsByServiceId.get(q.serviceId);
    if (list) list.push(q);
    else questionsByServiceId.set(q.serviceId, [q]);
  }

  const services: CalculatorServiceConfig[] = ((servicesResult.data ?? []) as FullServiceRow[]).map((row) => {
    const base = mapServiceConfigRow(row);
    const serviceQuestions = (questionsByServiceId.get(base.id) ?? []).sort((a, b) => a.sortOrder - b.sortOrder);
    return { ...base, questions: serviceQuestions };
  });

  const cleaningPlans = planRows.map(mapPlanConfigRow);
  const pricingRules = ((rulesResult.data ?? []) as FullPricingRuleRow[]).map(mapPricingRuleRow);
  const sizeBands = sizeBandsMissing ? [] : ((sizeBandsResult.data ?? []) as unknown as FullSizeBandRow[]).map(mapSizeBandRow);
  const addons = addonRows.map(mapAddonRow);
  const companyName = (companyResult.data as { name?: string | null } | null)?.name ?? null;

  return { companyName, settings, services, cleaningPlans, pricingRules, sizeBands, addons };
}

/** Throws if a scoped update matched no live row (mirrors setCalculatorEnabled). */
async function runScopedUpdate(
  table: string,
  legacyId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  if (Object.keys(payload).length === 0) return; // nothing changed → no write
  const client = configuredClient();
  const { data, error } = await client
    .from(table)
    .update(payload)
    .eq("legacy_id", legacyId)
    .is("deleted_at", null)
    .select("legacy_id")
    .maybeSingle();

  if (error) {
    throw new CalculatorConfigAdminError(`[${table}] update failed: ${error.message}`);
  }
  if (!data) {
    throw new CalculatorConfigAdminError(
      `[${table}] row not found (it may have been removed). No change was made.`,
    );
  }
}

// ── Service writes (safe fields only — keys/pricing model are locked) ────────

export interface ServicePatch {
  displayName?: string;
  description?: string | null;
  sortOrder?: number;
  enabled?: boolean;
  comingSoon?: boolean;
  plansEnabled?: boolean;
  planPricingModel?: PlanPricingModelValue;
  defaultPlanKey?: string | null;
  baseHourlyRateExclVat?: number | null;
  defaultVatRatePercent?: number;
  /** Slice 12Q — Home Cleaning per-sqm-range % adjustments (stored in settings_json). */
  homeSqmAdjustments?: SqmAdjustmentRangeConfig[];
}

async function readServiceSettingsForUpdate(legacyId: string): Promise<Record<string, unknown>> {
  const client = configuredClient();
  const { data, error } = await client
    .from("calculator_services")
    .select("settings_json")
    .eq("legacy_id", legacyId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    throw new CalculatorConfigAdminError(`[calculator_services] settings read failed: ${error.message}`);
  }
  if (!data) {
    throw new CalculatorConfigAdminError(
      "[calculator_services] row not found (it may have been removed). No change was made.",
    );
  }
  return asRecord((data as { settings_json?: unknown }).settings_json);
}

export async function updateCalculatorService(legacyId: string, patch: ServicePatch): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (patch.displayName !== undefined) payload.display_name = patch.displayName;
  if (patch.description !== undefined) payload.description = patch.description;
  if (patch.sortOrder !== undefined) payload.sort_order = patch.sortOrder;
  if (patch.enabled !== undefined) payload.enabled = patch.enabled;
  if (patch.comingSoon !== undefined) payload.coming_soon = patch.comingSoon;

  const settingsPatch: Record<string, unknown> = {};
  if (patch.plansEnabled !== undefined) settingsPatch.plansEnabled = patch.plansEnabled;
  if (patch.planPricingModel !== undefined) settingsPatch.planPricingModel = patch.planPricingModel;
  if (patch.defaultPlanKey !== undefined) settingsPatch.defaultPlanKey = patch.defaultPlanKey;
  if (patch.baseHourlyRateExclVat !== undefined) settingsPatch.baseHourlyRateExclVat = patch.baseHourlyRateExclVat;
  if (patch.defaultVatRatePercent !== undefined) settingsPatch.defaultVatRatePercent = patch.defaultVatRatePercent;
  if (patch.homeSqmAdjustments !== undefined) settingsPatch.homeSqmAdjustments = patch.homeSqmAdjustments;
  if (Object.keys(settingsPatch).length > 0) {
    payload.settings_json = { ...(await readServiceSettingsForUpdate(legacyId)), ...settingsPatch };
  }

  await runScopedUpdate("calculator_services", legacyId, payload);
}

// ── Service create + archive (Slice 12C — SaaS service management) ─────────────

/** A new-service draft validated before insert. */
export interface NewServiceDraft {
  serviceKey: string;
  displayName: string;
  pricingModel: string;
}

/**
 * Validates a new-service draft against the schema + uniqueness rules. GPM-3a: a
 * brand-new service must use one of the GENERIC pricing models
 * ({@link GENERIC_PRICING_MODELS}). The legacy, service-named models stay valid
 * on EXISTING rows but can no longer be chosen for a new service. Returns
 * human-readable problems ([] = ok).
 */
export function validateNewService(draft: NewServiceDraft, existingKeys: readonly string[]): string[] {
  const errors: string[] = [];
  const key = draft.serviceKey.trim();

  if (key === "") {
    errors.push("Service key is required.");
  } else if (!SERVICE_KEY_PATTERN.test(key)) {
    errors.push("Service key must be lowercase letters, digits and underscores, starting with a letter.");
  } else if (existingKeys.includes(key)) {
    errors.push(`Service key "${key}" is already used by this company.`);
  }

  if (draft.displayName.trim() === "") {
    errors.push("Display name is required.");
  }

  if (!isGenericPricingModelValue(draft.pricingModel)) {
    errors.push("A valid pricing model is required.");
  }

  return errors;
}

export interface NewServiceInput {
  companyId: string;
  companyLegacyId: string;
  serviceKey: string;
  displayName: string;
  description: string | null;
  pricingModel: string;
  requiresCleaningPlan: boolean;
  sortOrder: number;
}

/**
 * Inserts a new calculator service. GPM-3a: the pricing model MUST be generic —
 * guarded here (not only in {@link validateNewService}) so the data layer can
 * never persist a legacy/unknown model even if a caller bypasses validation.
 * Always created as a HIDDEN DRAFT (enabled=false, coming_soon=false) so it can
 * never reach the public calculator before it is fully configured. `settings_json`
 * is seeded from {@link defaultSettingsForGenericModel}; the explicit
 * `requiresCleaningPlan` from the caller (the Admin switch) still wins.
 */
export async function createCalculatorService(input: NewServiceInput): Promise<void> {
  const client = configuredClient();

  const pricingModel = input.pricingModel;
  if (!isGenericPricingModelValue(pricingModel)) {
    throw new CalculatorConfigAdminError(
      `Cannot create a service with a non-generic pricing model "${pricingModel}". ` +
        `Choose one of: ${GENERIC_PRICING_MODELS.join(", ")}.`,
    );
  }

  const settings_json = {
    ...defaultSettingsForGenericModel(pricingModel),
    requiresCleaningPlan: input.requiresCleaningPlan,
  };

  const payload = {
    legacy_id: newConfigLegacyId(`calc_svc_${input.serviceKey}`),
    company_id: input.companyId,
    company_legacy_id: input.companyLegacyId,
    service_key: input.serviceKey,
    display_name: input.displayName,
    description: input.description,
    enabled: false,
    coming_soon: false,
    pricing_model: pricingModel,
    sort_order: input.sortOrder,
    settings_json,
  };

  const { data, error } = await client
    .from("calculator_services")
    .insert(payload)
    .select("legacy_id")
    .maybeSingle();

  if (error) {
    throw new CalculatorConfigAdminError(`[calculator_services] insert failed: ${error.message}`);
  }
  if (!data) {
    throw new CalculatorConfigAdminError("Service was not created. No change was made.");
  }
}

/**
 * Archives a service via soft-delete (`deleted_at`) — never a hard delete, so
 * submitted quotes keep their frozen service snapshot. Scoped by stable
 * legacy_id; throws if no live row matched.
 */
export async function archiveCalculatorService(legacyId: string): Promise<void> {
  const client = configuredClient();
  const { data, error } = await client
    .from("calculator_services")
    .update({ deleted_at: new Date().toISOString() })
    .eq("legacy_id", legacyId)
    .is("deleted_at", null)
    .select("legacy_id")
    .maybeSingle();

  if (error) {
    throw new CalculatorConfigAdminError(`[calculator_services] archive failed: ${error.message}`);
  }
  if (!data) {
    throw new CalculatorConfigAdminError(
      "[calculator_services] row not found (it may already be archived). No change was made.",
    );
  }
}

// ── Question writes (safe fields; question_key locked; archive via active) ───

export interface QuestionPatch {
  label?: string;
  helpText?: string | null;
  required?: boolean;
  affectsPricing?: boolean;
  sortOrder?: number;
  options?: QuestionOption[];
  active?: boolean;
}

export async function updateCalculatorQuestion(legacyId: string, patch: QuestionPatch): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (patch.label !== undefined) payload.label = patch.label;
  if (patch.helpText !== undefined) payload.help_text = patch.helpText;
  if (patch.required !== undefined) payload.required = patch.required;
  if (patch.affectsPricing !== undefined) payload.affects_pricing = patch.affectsPricing;
  if (patch.sortOrder !== undefined) payload.sort_order = patch.sortOrder;
  if (patch.options !== undefined) payload.options_json = patch.options;
  if (patch.active !== undefined) payload.active = patch.active;
  await runScopedUpdate("calculator_questions", legacyId, payload);
}

export interface NewQuestionInput {
  companyId: string;
  companyLegacyId: string;
  serviceId: string;
  serviceLegacyId: string;
  questionKey: string;
  label: string;
  helpText: string | null;
  inputType: CalculatorInputType;
  required: boolean;
  affectsPricing: boolean;
  sortOrder: number;
  options: QuestionOption[];
  /**
   * GPM-CALC-LIBRARY-3 — optional link to the reusable question library item this
   * row was ACTIVATED from (migration 0077). Omitted/undefined for a plain custom
   * question, so the insert payload is byte-identical to before — existing callers
   * are completely unaffected. Only written when a non-empty id is supplied.
   */
  libraryItemId?: string | null;
}

/**
 * Inserts a new calculator question scoped to one service. The legacy_id is
 * deterministic (`<serviceLegacyId>_q_<questionKey>`) so it is globally unique
 * and a duplicate insert is rejected by the DB's `(service, key)` unique index.
 */
export async function createCalculatorQuestion(input: NewQuestionInput): Promise<void> {
  const client = configuredClient();
  const legacyId = `${input.serviceLegacyId}_q_${input.questionKey}`;
  const payload = {
    legacy_id: legacyId,
    company_id: input.companyId,
    company_legacy_id: input.companyLegacyId,
    calculator_service_id: input.serviceId,
    calculator_service_legacy_id: input.serviceLegacyId,
    question_key: input.questionKey,
    label: input.label,
    help_text: input.helpText,
    input_type: input.inputType,
    required: input.required,
    options_json: input.options,
    validation_json: {},
    affects_pricing: input.affectsPricing,
    sort_order: input.sortOrder,
    active: true,
    // Only stamp the library link when activating a library item; omitting the key
    // keeps the payload identical to the pre-library custom-question insert.
    ...(input.libraryItemId ? { library_item_id: input.libraryItemId } : {}),
  };

  const { data, error } = await client
    .from("calculator_questions")
    .insert(payload)
    .select("legacy_id")
    .maybeSingle();

  if (error) {
    throw new CalculatorConfigAdminError(`[calculator_questions] insert failed: ${error.message}`);
  }
  if (!data) {
    throw new CalculatorConfigAdminError("Question was not created. No change was made.");
  }
}

/**
 * GPM-CALC-LIBRARY-3 — builds the service-scoped question insert input that
 * ACTIVATES a reusable question library item onto a service. It copies the library
 * defaults (label / help / input type / required / affects-pricing / options) and
 * stamps `libraryItemId` so the created calculator_questions row links back to its
 * library source. The admin can still override every field afterwards via the
 * normal question edit path. Pure (no I/O) so it is unit-tested directly;
 * `sortOrder` is supplied by the caller (placement on the service).
 */
export function buildQuestionLibraryActivationInput(
  item: QuestionLibraryItem,
  target: { companyId: string; companyLegacyId: string; serviceId: string; serviceLegacyId: string },
  sortOrder: number,
): NewQuestionInput {
  const inputType: CalculatorInputType = SUPPORTED_INPUT_TYPES.includes(item.inputType as CalculatorInputType)
    ? (item.inputType as CalculatorInputType)
    : "text";
  return {
    companyId: target.companyId,
    companyLegacyId: target.companyLegacyId,
    serviceId: target.serviceId,
    serviceLegacyId: target.serviceLegacyId,
    questionKey: item.questionKey,
    label: item.label,
    helpText: item.helpText,
    inputType,
    required: item.defaultRequired,
    affectsPricing: item.defaultAffectsPricing,
    sortOrder,
    options: item.defaultOptions,
    libraryItemId: item.id,
  };
}

// ── Cleaning plan writes (safe fields only; plan_key locked) ─────────────────

export interface PlanPatch {
  name?: string;
  description?: string | null;
  hourlyRate?: number;
  vatRatePercent?: number;
  priceAdjustmentType?: PlanPriceAdjustmentTypeValue;
  priceAdjustmentValue?: number;
  rutEligible?: boolean;
  rutEnabled?: boolean;
  rutPercent?: number;
  rutApplyTo?: RutApplyToValue;
  showRutBreakdown?: boolean;
  /**
   * Slice V2-D — V2 hourly start-time PRICE adjustment in hours (migration 0073).
   * Stored in the dedicated `start_adjustment_hours` column, NOT the overloaded
   * legacy `price_adjustment_value`. Price-only: it never changes displayed time.
   */
  startAdjustmentHours?: number;
  /**
   * Slice GPM-4a — the remaining V2 plan-card pricing fields (migration 0073
   * columns), now WRITABLE so a plan can PERSIST what {@link mapPlanConfigRow}
   * already reads back. Additive + behaviour-preserving: no public runtime reads
   * these via this patch; only the Admin write path gains them. `null` clears a
   * nullable column.
   *   • `pricePerSqmExclVat` — price per m² for `sqm_fixed` plans (null clears it).
   *   • `fixedAdjustmentExclVat` — flat excl-VAT adjustment (may be ± for a discount).
   *   • `minimumPriceExclVat` — optional raw-price floor (null clears it).
   * `pricePerUnitExclVat` (unit_based) is intentionally ABSENT — it has no column
   * yet (added with its engine runtime in a later slice).
   */
  pricePerSqmExclVat?: number | null;
  fixedAdjustmentExclVat?: number;
  minimumPriceExclVat?: number | null;
  sortOrder?: number;
  active?: boolean;
}

export async function updateCleaningPlan(legacyId: string, patch: PlanPatch): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (patch.name !== undefined) payload.name = patch.name;
  if (patch.description !== undefined) payload.description = patch.description;
  if (patch.hourlyRate !== undefined) payload.hourly_rate = patch.hourlyRate;
  if (patch.vatRatePercent !== undefined) payload.vat_rate_percent = patch.vatRatePercent;
  if (patch.priceAdjustmentType !== undefined) payload.price_adjustment_type = patch.priceAdjustmentType;
  if (patch.priceAdjustmentValue !== undefined) payload.price_adjustment_value = patch.priceAdjustmentValue;
  if (patch.rutEligible !== undefined) payload.rut_eligible = patch.rutEligible;
  if (patch.rutEnabled !== undefined) payload.rut_enabled = patch.rutEnabled;
  if (patch.rutPercent !== undefined) payload.rut_percent = patch.rutPercent;
  if (patch.rutApplyTo !== undefined) payload.rut_apply_to = patch.rutApplyTo;
  if (patch.showRutBreakdown !== undefined) payload.show_rut_breakdown = patch.showRutBreakdown;
  if (patch.startAdjustmentHours !== undefined) payload.start_adjustment_hours = patch.startAdjustmentHours;
  if (patch.pricePerSqmExclVat !== undefined) payload.price_per_sqm_excl_vat = patch.pricePerSqmExclVat;
  if (patch.fixedAdjustmentExclVat !== undefined) payload.fixed_adjustment_excl_vat = patch.fixedAdjustmentExclVat;
  if (patch.minimumPriceExclVat !== undefined) payload.minimum_price_excl_vat = patch.minimumPriceExclVat;
  if (patch.sortOrder !== undefined) payload.sort_order = patch.sortOrder;
  if (patch.active !== undefined) payload.active = patch.active;
  await runScopedUpdate("cleaning_plans", legacyId, payload);
}

// ── Default-plan selection (Slice V2-D) ───────────────────────────────────────

/**
 * A single "make this plan the default" operation. Kept SEPARATE from
 * {@link updateCleaningPlan} because promoting a default must respect the
 * `uq_cleaning_plans_one_default_per_service` unique index (one default per
 * company+service): the currently-default sibling(s) are cleared FIRST, then the
 * chosen plan is promoted, so the index is never transiently violated.
 *
 * The chosen `plan_key` is also mirrored to `settings_json.defaultPlanKey` so the
 * LEGACY public calculator keeps resolving the same default until the V2 runtime
 * wiring (Slice V2-E/H) removes that source. This mirror is the only settings_json
 * field touched; every other field is preserved by {@link updateCalculatorService}.
 */
export interface SetDefaultPlanInput {
  /** Stable legacy_id of the plan to promote to default. */
  planLegacyId: string;
  /** The plan_key mirrored to settings_json.defaultPlanKey (legacy public source). */
  planKey: string;
  /** Owning service's legacy_id, for the settings_json mirror. */
  serviceLegacyId: string;
  /** Currently-default sibling plan legacy_ids to clear before promoting (≤ 1 by invariant). */
  clearSiblingLegacyIds: readonly string[];
}

export async function setDefaultCleaningPlan(input: SetDefaultPlanInput): Promise<void> {
  // 1. Clear the current default sibling(s) FIRST so the one-default-per-service
  //    unique index is never transiently violated by two defaults at once.
  for (const legacyId of input.clearSiblingLegacyIds) {
    if (legacyId === input.planLegacyId) continue;
    await runScopedUpdate("cleaning_plans", legacyId, { is_default: false });
  }
  // 2. Promote the selected plan.
  await runScopedUpdate("cleaning_plans", input.planLegacyId, { is_default: true });
  // 3. Mirror the legacy public default source (preserves other settings_json fields).
  await updateCalculatorService(input.serviceLegacyId, { defaultPlanKey: input.planKey });
}

/**
 * Generates a globally-unique legacy_id for an admin-created config row. A random
 * tail is appended so re-creating a key whose previous row was archived (still
 * holding its deterministic legacy_id) can never collide on the global
 * `legacy_id` unique constraint.
 */
function newConfigLegacyId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}

// ── Cleaning plan create + archive (Slice 12C — SaaS plan management) ─────────

/**
 * A new-cleaning-plan draft validated before insert. Model-aware (Slice GPM-4c-1):
 * `pricingModel` selects which pricing fields the draft must carry and defaults to
 * `hourly_by_area`, so existing hourly callers keep their exact behaviour. Only the
 * engine-supported generic models (`hourly_by_area`, `sqm_fixed`) may create a
 * plan; reserved models are rejected by {@link validateNewPlan}.
 */
export interface NewPlanDraft {
  planKey: string;
  name: string;
  /** Generic pricing model the plan is created for (default `hourly_by_area`). */
  pricingModel?: GenericPricingModel;
  /** `hourly_by_area` required per-hour price excl VAT. */
  hourlyRate?: number | null;
  /** `hourly_by_area` optional price-only start adjustment in hours. */
  startAdjustmentHours?: number | null;
  /** `sqm_fixed` required price per m² excl VAT. */
  pricePerSqmExclVat?: number | null;
  /** `sqm_fixed` optional flat adjustment excl VAT (may be negative). */
  fixedAdjustmentExclVat?: number | null;
  /** `sqm_fixed` optional raw-price floor excl VAT. */
  minimumPriceExclVat?: number | null;
}

/**
 * Validates a new-plan draft against the schema + uniqueness rules, then the
 * model-specific pricing contract. Returns a list of human-readable problems
 * ([] when valid). `existingKeys` is the set of plan keys already used by the
 * company (live rows).
 *
 * Model-aware (Slice GPM-4c-1): the key/name/uniqueness checks are unchanged;
 * pricing validation is delegated to the GPM-4a {@link validateGenericPlan}
 * contract for the draft's model (default `hourly_by_area`). Only the engine-
 * supported generic models may create a plan — a reserved model
 * (`unit_based` / `fixed_package` / `manual_quote`) is rejected outright so the
 * Admin never creates an unpriceable plan, and `manual_quote` stays plan-less.
 */
export function validateNewPlan(draft: NewPlanDraft, existingKeys: readonly string[]): string[] {
  const errors: string[] = [];
  const key = draft.planKey.trim();

  if (key === "") {
    errors.push("Plan key is required.");
  } else if (!PLAN_KEY_PATTERN.test(key)) {
    errors.push("Plan key must be lowercase letters, digits and underscores, starting with a letter.");
  } else if (existingKeys.includes(key)) {
    errors.push(`Plan key "${key}" is already used by this company.`);
  }

  if (draft.name.trim() === "") {
    errors.push("Plan name is required.");
  }

  const model: GenericPricingModel = draft.pricingModel ?? "hourly_by_area";
  if (!isGenericModelEngineSupported(model)) {
    errors.push(`Plan creation is not available for the "${model}" pricing model yet.`);
    return errors;
  }

  const planDraft: GenericPlanDraft = {
    hourlyRate: draft.hourlyRate,
    startAdjustmentHours: draft.startAdjustmentHours,
    pricePerSqmExclVat: draft.pricePerSqmExclVat,
    fixedAdjustmentExclVat: draft.fixedAdjustmentExclVat,
    minimumPriceExclVat: draft.minimumPriceExclVat,
  };
  errors.push(...validateGenericPlan(planDraft, model));

  return errors;
}

export interface NewPlanInput {
  companyId: string;
  companyLegacyId: string;
  serviceId?: string | null;
  serviceLegacyId?: string | null;
  serviceKey?: string;
  planKey: string;
  name: string;
  description: string | null;
  /**
   * Generic pricing model that shapes which price columns are written
   * (Slice GPM-4c-1; default `hourly_by_area` for existing hourly callers).
   */
  pricingModel?: GenericPricingModel;
  /**
   * `hourly_by_area` per-hour price excl VAT. For `sqm_fixed` the stored
   * `hourly_rate` is forced to the 0 sentinel (the column is NOT NULL and the
   * sqm_fixed basis does not use it), so this may be omitted for that model.
   */
  hourlyRate?: number;
  /** `hourly_by_area` optional price-only start adjustment in hours. */
  startAdjustmentHours?: number | null;
  /** `sqm_fixed` required price per m² excl VAT. */
  pricePerSqmExclVat?: number | null;
  /** `sqm_fixed` optional flat adjustment excl VAT (may be negative). */
  fixedAdjustmentExclVat?: number | null;
  /** `sqm_fixed` optional raw-price floor excl VAT. */
  minimumPriceExclVat?: number | null;
  vatRatePercent?: number;
  rutEligible?: boolean;
  rutEnabled?: boolean;
  rutPercent?: number;
  showRutBreakdown?: boolean;
  sortOrder: number;
}

/**
 * Inserts a new cleaning plan. Model-aware (Slice GPM-4c-1): `pricingModel`
 * (default `hourly_by_area`) selects which price columns are written —
 * `hourly_by_area` writes `hourly_rate` (+ optional `start_adjustment_hours`),
 * while `sqm_fixed` writes the 0 `hourly_rate` sentinel plus
 * `price_per_sqm_excl_vat` (+ optional `fixed_adjustment_excl_vat` /
 * `minimum_price_excl_vat`). Reserved models are rejected upstream by
 * {@link validateNewPlan}, so they never reach this insert. The reserved
 * per-unit / package columns are never written (they have no migration yet).
 *
 * Never the default plan — `is_default` stays false (a single seeded default per
 * company is preserved) — and always `active`. No service visibility / public
 * field is touched. The legacy_id is globally unique (random tail) so it
 * survives the archive → recreate cycle.
 */
export async function createCleaningPlan(input: NewPlanInput): Promise<void> {
  const client = configuredClient();
  const model: GenericPricingModel = input.pricingModel ?? "hourly_by_area";
  const isSqmFixed = model === "sqm_fixed";
  // sqm_fixed stores the 0 hourly_rate sentinel (NOT NULL column, unused by that
  // basis); hourly_by_area stores its real per-hour price.
  const hourlyRate = isSqmFixed ? 0 : input.hourlyRate ?? 0;

  const payload: Record<string, unknown> = {
    legacy_id: newConfigLegacyId(`clean_plan_${input.planKey}`),
    company_id: input.companyId,
    company_legacy_id: input.companyLegacyId,
    calculator_service_id: input.serviceId ?? null,
    calculator_service_legacy_id: input.serviceLegacyId ?? null,
    service_key: input.serviceKey ?? "home_cleaning",
    plan_key: input.planKey,
    name: input.name,
    description: input.description,
    hourly_rate: hourlyRate,
    vat_rate_percent: input.vatRatePercent ?? 25,
    rut_eligible: input.rutEligible ?? false,
    rut_enabled: input.rutEnabled ?? false,
    rut_percent: input.rutPercent ?? 50,
    show_rut_breakdown: input.showRutBreakdown ?? false,
    is_default: false,
    active: true,
    sort_order: input.sortOrder,
  };

  // Write only the price columns the chosen model uses.
  if (model === "hourly_by_area") {
    if (input.startAdjustmentHours != null) payload.start_adjustment_hours = input.startAdjustmentHours;
  } else if (isSqmFixed) {
    if (input.pricePerSqmExclVat != null) payload.price_per_sqm_excl_vat = input.pricePerSqmExclVat;
    if (input.fixedAdjustmentExclVat != null) payload.fixed_adjustment_excl_vat = input.fixedAdjustmentExclVat;
    if (input.minimumPriceExclVat != null) payload.minimum_price_excl_vat = input.minimumPriceExclVat;
  }

  const { data, error } = await client
    .from("cleaning_plans")
    .insert(payload)
    .select("legacy_id")
    .maybeSingle();

  if (error) {
    throw new CalculatorConfigAdminError(`[cleaning_plans] insert failed: ${error.message}`);
  }
  if (!data) {
    throw new CalculatorConfigAdminError("Plan was not created. No change was made.");
  }
}

/**
 * Archives a cleaning plan via soft-delete (`deleted_at`), the calculator-wide
 * "never hard delete" convention. Scoped by stable legacy_id; throws if no live
 * row matched. Historical quotes keep their frozen plan snapshot regardless.
 */
export async function archiveCleaningPlan(legacyId: string): Promise<void> {
  const client = configuredClient();
  const { data, error } = await client
    .from("cleaning_plans")
    .update({ deleted_at: new Date().toISOString() })
    .eq("legacy_id", legacyId)
    .is("deleted_at", null)
    .select("legacy_id")
    .maybeSingle();

  if (error) {
    throw new CalculatorConfigAdminError(`[cleaning_plans] archive failed: ${error.message}`);
  }
  if (!data) {
    throw new CalculatorConfigAdminError(
      "[cleaning_plans] row not found (it may already be archived). No change was made.",
    );
  }
}

// ── Quote settings writes (safe fields only; enabled + slug NOT here) ────────

export interface SettingsPatch {
  priceDisplayMode?: PriceDisplayModeValue;
  defaultQuoteStatus?: DefaultQuoteStatusValue;
  rutDisplayMode?: RutDisplayModeValue;
  quoteValidityDays?: number;
  manualReviewThresholdAmount?: number | null;
  showPriceBeforeContact?: boolean;
  requireContactBeforeResult?: boolean;
  showLoginPromptAfterSubmit?: boolean;
  autoCreateProspect?: boolean;
  autoCreateQuoteRequest?: boolean;
}

export async function updateCalculatorSettingsConfig(legacyId: string, patch: SettingsPatch): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (patch.priceDisplayMode !== undefined) payload.price_display_mode = patch.priceDisplayMode;
  if (patch.defaultQuoteStatus !== undefined) payload.default_quote_status = patch.defaultQuoteStatus;
  if (patch.rutDisplayMode !== undefined) payload.rut_display_mode = patch.rutDisplayMode;
  if (patch.quoteValidityDays !== undefined) payload.quote_validity_days = patch.quoteValidityDays;
  if (patch.manualReviewThresholdAmount !== undefined)
    payload.manual_review_threshold_amount = patch.manualReviewThresholdAmount;
  if (patch.showPriceBeforeContact !== undefined) payload.show_price_before_contact = patch.showPriceBeforeContact;
  if (patch.requireContactBeforeResult !== undefined)
    payload.require_contact_before_result = patch.requireContactBeforeResult;
  if (patch.showLoginPromptAfterSubmit !== undefined)
    payload.show_login_prompt_after_submit = patch.showLoginPromptAfterSubmit;
  if (patch.autoCreateProspect !== undefined) payload.auto_create_prospect = patch.autoCreateProspect;
  if (patch.autoCreateQuoteRequest !== undefined) payload.auto_create_quote_request = patch.autoCreateQuoteRequest;
  await runScopedUpdate("calculator_settings", legacyId, payload);
}

// ══ Pricing-rule VALUE edit + audit (Slice 10B) ════════════════════════════
//
// Only an EXISTING rule's numeric value is writable (rule_key / rule_type /
// pricing_model / formula stay locked). Every change is recorded in the existing
// append-only `activity_events` audit trail (migration 0029) — reused rather than
// adding a new table — scoped to the calculator company. Reads/writes are
// Supabase-authoritative and gated by the calculator's super_admin-only RLS.

/** Audit action written to / read from `activity_events` for a pricing-rule change. */
export const CALCULATOR_PRICING_RULE_AUDIT_ACTION = "calculator.pricing_rule_update" as const;

/** Who performed a pricing-rule change (resolved from the signed-in Super Admin). */
export interface PricingRuleAuditActor {
  id: string | null;
  name: string;
  role: UserRole;
}

/** A single, fully-scoped pricing-rule value change to apply + audit. */
export interface PricingRuleValueChange {
  /** Stable legacy_id of the pricing_rules row (matched on update). */
  legacyId: string;
  ruleKey: string;
  ruleType: string;
  /** Previous value (for the audit trail); null when it had none. */
  oldValue: number | null;
  /** New, already-validated value to persist. */
  newValue: number;
  /** Optional active-state change used by the business-friendly pricing blocks. */
  newActive?: boolean;
  /** Company UUID — scopes both the update guard and the audit row. */
  companyId: string;
  /** App-facing company id — audit scope + history filter. */
  companyLegacyId: string;
  currency: string;
  actor: PricingRuleAuditActor;
  /** Optional free-text reason captured with the change. */
  note?: string | null;
}

function buildPricingRuleAuditSummary(change: PricingRuleValueChange): string {
  const oldText = change.oldValue === null ? "—" : String(change.oldValue);
  return `Pricing rule "${change.ruleKey}" changed from ${oldText} to ${change.newValue}.`;
}

/**
 * Appends a pricing-rule change to the immutable `activity_events` trail. The
 * `data` jsonb carries a full AuditEvent plus a `calculator` detail block
 * (section / rule key / old + new value / note) so the history view can render
 * the change without leaking pricing internals elsewhere.
 */
async function recordPricingRuleAuditEvent(change: PricingRuleValueChange): Promise<void> {
  const client = configuredClient();
  const nowIso = new Date().toISOString();
  const legacyId = `calc_pricing_audit_${change.legacyId}_${Date.now()}`;
  const summary = buildPricingRuleAuditSummary(change);

  const row = {
    legacy_id: legacyId,
    company_id: change.companyId,
    company_legacy_id: change.companyLegacyId,
    actor_id: change.actor.id,
    actor_name: change.actor.name,
    actor_role: change.actor.role,
    action: CALCULATOR_PRICING_RULE_AUDIT_ACTION,
    occurred_at: nowIso,
    data: {
      id: legacyId,
      at: nowIso,
      actorId: change.actor.id,
      actorName: change.actor.name,
      actorRole: change.actor.role,
      companyId: change.companyLegacyId,
      action: CALCULATOR_PRICING_RULE_AUDIT_ACTION,
      summary,
      calculator: {
        section: "pricing_rules",
        ruleKey: change.ruleKey,
        ruleType: change.ruleType,
        oldValue: change.oldValue,
        newValue: change.newValue,
        currency: change.currency,
        note: change.note ?? null,
      },
    },
  };

  const { error } = await client.from("activity_events").insert(row);
  if (error) {
    // Slice 12O — audit logging is best-effort and must NEVER block the actual
    // pricing-setting save. The append-only `activity_events` trail (migration
    // 0029) may be absent / not yet in the PostgREST schema cache on a given
    // dev/test DB; in that case the save already succeeded and we only surface a
    // dev diagnostic instead of throwing a fatal error to the admin.
    throw new CalculatorConfigAdminError(`[activity_events] audit insert failed: ${error.message}`);
  }
}

/**
 * Updates ONE pricing rule's numeric value (scoped by stable legacy_id + company)
 * and records the change in the audit trail. Writes nothing else: rule_key,
 * rule_type, pricing model and all internal fields are never touched.
 */
export async function updatePricingRuleValue(change: PricingRuleValueChange): Promise<void> {
  const client = configuredClient();
  const { data, error } = await client
    .from("pricing_rules")
    .update({
      value_numeric: change.newValue,
      ...(change.newActive !== undefined ? { active: change.newActive } : {}),
    })
    .eq("legacy_id", change.legacyId)
    .eq("company_id", change.companyId)
    .is("deleted_at", null)
    .select("legacy_id")
    .maybeSingle();

  if (error) {
    throw new CalculatorConfigAdminError(`[pricing_rules] update failed: ${error.message}`);
  }
  if (!data) {
    throw new CalculatorConfigAdminError(
      "[pricing_rules] row not found (it may have been removed). No change was made.",
    );
  }

  // The value save above already succeeded and surfaces failures loudly. Audit
  // logging is non-blocking: a missing `activity_events` table or stale schema
  // cache must not roll back or hide a successful pricing-setting change.
  try {
    await recordPricingRuleAuditEvent(change);
  } catch (auditError) {
    if (typeof console !== "undefined") {
      console.warn(
        "[calculator] pricing-rule saved, but audit logging failed (non-blocking):",
        auditError instanceof Error ? auditError.message : auditError,
      );
    }
  }
}

// ── Size-band writes (Phase 2 — business-friendly Home Cleaning time rules) ──

export interface SizeBandPatch {
  minSqm?: number;
  maxSqm?: number | null;
  recommendedHours?: number;
  extraHoursPerStarted10Sqm?: number | null;
  extraHoursStartAfterSqm?: number | null;
  active?: boolean;
  sortOrder?: number;
}

export async function updateCalculatorSizeBand(legacyId: string, patch: SizeBandPatch): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (patch.minSqm !== undefined) payload.min_sqm = patch.minSqm;
  if (patch.maxSqm !== undefined) payload.max_sqm = patch.maxSqm;
  if (patch.recommendedHours !== undefined) payload.recommended_hours = patch.recommendedHours;
  if (patch.extraHoursPerStarted10Sqm !== undefined) payload.extra_hours_per_started_10_sqm = patch.extraHoursPerStarted10Sqm;
  if (patch.extraHoursStartAfterSqm !== undefined) payload.extra_hours_start_after_sqm = patch.extraHoursStartAfterSqm;
  if (patch.active !== undefined) payload.active = patch.active;
  if (patch.sortOrder !== undefined) payload.sort_order = patch.sortOrder;
  await runScopedUpdate("calculator_size_bands", legacyId, payload);
}

export interface NewSizeBandInput {
  companyId: string;
  companyLegacyId: string;
  serviceId: string;
  serviceLegacyId: string;
  serviceKey: string;
  minSqm: number;
  maxSqm: number | null;
  recommendedHours: number;
  extraHoursPerStarted10Sqm: number | null;
  extraHoursStartAfterSqm: number | null;
  sortOrder: number;
}

export async function createCalculatorSizeBand(input: NewSizeBandInput): Promise<void> {
  const client = configuredClient();
  const payload = {
    legacy_id: newConfigLegacyId(`calc_size_${input.serviceKey}`),
    company_id: input.companyId,
    company_legacy_id: input.companyLegacyId,
    calculator_service_id: input.serviceId,
    calculator_service_legacy_id: input.serviceLegacyId,
    service_key: input.serviceKey,
    min_sqm: input.minSqm,
    max_sqm: input.maxSqm,
    recommended_hours: input.recommendedHours,
    extra_hours_per_started_10_sqm: input.extraHoursPerStarted10Sqm,
    extra_hours_start_after_sqm: input.extraHoursStartAfterSqm,
    active: true,
    sort_order: input.sortOrder,
    data: {},
  };

  const { data, error } = await client
    .from("calculator_size_bands")
    .insert(payload)
    .select("legacy_id")
    .maybeSingle();

  if (error) {
    throw new CalculatorConfigAdminError(`[calculator_size_bands] insert failed: ${error.message}`);
  }
  if (!data) {
    throw new CalculatorConfigAdminError("Size band was not created. No change was made.");
  }
}

export async function archiveCalculatorSizeBand(legacyId: string): Promise<void> {
  const client = configuredClient();
  const { data, error } = await client
    .from("calculator_size_bands")
    .update({ deleted_at: new Date().toISOString() })
    .eq("legacy_id", legacyId)
    .is("deleted_at", null)
    .select("legacy_id")
    .maybeSingle();

  if (error) {
    throw new CalculatorConfigAdminError(`[calculator_size_bands] archive failed: ${error.message}`);
  }
  if (!data) {
    throw new CalculatorConfigAdminError(
      "[calculator_size_bands] row not found (it may already be archived). No change was made.",
    );
  }
}

// ══ Generic add-on writes (Slice V2-E0E-1 — calculator_addons data access) ═══
//
// The Admin data layer for the generic add-on engine (migration 0074). Mirrors
// the calculator-wide write conventions exactly: stable machine keys + scope are
// LOCKED after creation (addon_key / service / company are never updated), there
// is NO hard delete (archive flips `deleted_at`), and effects are three explicit
// typed channels. V2 NEVER reads legacy `pricing_rules` add-on keys or legacy
// `calculator_questions` — add-ons come only from this table.

/** Safe, updatable fields of an add-on (addon_key + service/company scope locked). */
export interface CalculatorAddonPatch {
  name?: string;
  publicLabel?: string;
  description?: string | null;
  inputType?: CalculatorAddonInputType;
  booleanDefault?: boolean;
  quantityMin?: number;
  quantityMax?: number | null;
  quantityStep?: number;
  quantityDefault?: number;
  effectTimeMinutes?: number;
  effectFixedExclVat?: number;
  effectPercent?: number;
  active?: boolean;
  publicVisible?: boolean;
  required?: boolean;
  sortOrder?: number;
}

/** Everything needed to insert a new add-on. Optional fields fall back to the DB defaults. */
export interface NewAddonInput {
  companyId: string;
  companyLegacyId: string;
  serviceId: string;
  serviceLegacyId: string | null;
  serviceKey: string;
  addonKey: string;
  name: string;
  publicLabel: string;
  description?: string | null;
  inputType: CalculatorAddonInputType;
  booleanDefault?: boolean;
  quantityMin?: number;
  quantityMax?: number | null;
  quantityStep?: number;
  quantityDefault?: number;
  effectTimeMinutes?: number;
  effectFixedExclVat?: number;
  effectPercent?: number;
  active?: boolean;
  publicVisible?: boolean;
  required?: boolean;
  sortOrder: number;
  /**
   * GPM-CALC-LIBRARY-4 — optional link to the reusable add-on library item this
   * row was ACTIVATED from (migration 0077). Omitted for a plain custom add-on so
   * the insert payload is byte-identical to before — existing callers unaffected.
   * Only written when a non-empty id is supplied.
   */
  libraryItemId?: string | null;
}

/** A new/edited add-on draft validated before persisting (UI-facing shape). */
export interface NewAddonDraft {
  addonKey: string;
  name: string;
  publicLabel: string;
  inputType: string;
  quantityMin: number;
  quantityMax: number | null;
  quantityStep: number;
  quantityDefault: number;
  effectTimeMinutes: number;
  effectFixedExclVat: number;
  effectPercent: number;
}

/**
 * Validates a new/edited add-on draft against the schema + the migration 0074
 * CHECK constraints (so the UI catches problems before the DB rejects them).
 * Returns human-readable problems ([] when valid). `existingKeys` is the set of
 * add-on keys already used by the SAME service (live rows) — duplicates are
 * rejected to match the `(service, addon_key) where deleted_at is null` unique
 * index. A negative fixed effect is allowed (discount); `single_select` is NOT a
 * valid input type yet.
 */
export function validateNewAddon(draft: NewAddonDraft, existingKeys: readonly string[]): string[] {
  const errors: string[] = [];
  const key = draft.addonKey.trim();

  if (key === "") {
    errors.push("Add-on key is required.");
  } else if (!ADDON_KEY_PATTERN.test(key)) {
    errors.push("Add-on key must be lowercase letters, digits and underscores, starting with a letter.");
  } else if (existingKeys.includes(key)) {
    errors.push(`Add-on key "${key}" is already used by this service.`);
  }

  if (draft.name.trim() === "") errors.push("Name is required.");
  if (draft.publicLabel.trim() === "") errors.push("Public label is required.");

  if (!SUPPORTED_ADDON_INPUT_TYPES.includes(draft.inputType as CalculatorAddonInputType)) {
    errors.push("Input type must be boolean or quantity.");
  }

  // Quantity bounds — validated for both input types so persisted data is always
  // consistent (a boolean add-on still carries safe quantity columns).
  if (!Number.isFinite(draft.quantityMin) || draft.quantityMin < 0) {
    errors.push("Quantity min must be zero or greater.");
  }
  if (!Number.isFinite(draft.quantityStep) || draft.quantityStep <= 0) {
    errors.push("Quantity step must be greater than zero.");
  }
  if (draft.quantityMax !== null) {
    if (!Number.isFinite(draft.quantityMax)) {
      errors.push("Quantity max must be a number or empty.");
    } else if (draft.quantityMax < draft.quantityMin) {
      errors.push("Quantity max must be greater than or equal to quantity min.");
    }
  }
  if (!Number.isFinite(draft.quantityDefault)) {
    errors.push("Quantity default must be a number.");
  } else {
    if (draft.quantityDefault < draft.quantityMin) {
      errors.push("Quantity default must be greater than or equal to quantity min.");
    }
    if (
      draft.quantityMax !== null &&
      Number.isFinite(draft.quantityMax) &&
      draft.quantityDefault > draft.quantityMax
    ) {
      errors.push("Quantity default must be less than or equal to quantity max.");
    }
  }

  // Effect typo guards (mirror the DB CHECK constraints exactly).
  if (!Number.isFinite(draft.effectTimeMinutes) || draft.effectTimeMinutes < 0 || draft.effectTimeMinutes > 1440) {
    errors.push("Time effect must be between 0 and 1440 minutes.");
  }
  if (!Number.isFinite(draft.effectPercent) || draft.effectPercent < -100 || draft.effectPercent > 100) {
    errors.push("Percent effect must be between -100 and 100.");
  }
  if (!Number.isFinite(draft.effectFixedExclVat)) {
    errors.push("Fixed effect must be a number.");
  }
  // effectFixedExclVat may be positive OR negative (surcharge/discount) — no sign check.

  return errors;
}

/**
 * True when an add-on draft has NO pricing effect on any channel. Pure helper the
 * Admin UI can use to surface a soft, NON-blocking warning ("this add-on changes
 * nothing"). Deliberately NOT part of {@link validateNewAddon} — a zero-effect
 * add-on is allowed (it just does nothing yet).
 */
export function addonHasNoEffect(
  draft: Pick<NewAddonDraft, "effectTimeMinutes" | "effectFixedExclVat" | "effectPercent">,
): boolean {
  return (
    numberOrDefault(draft.effectTimeMinutes, 0) === 0 &&
    numberOrDefault(draft.effectFixedExclVat, 0) === 0 &&
    numberOrDefault(draft.effectPercent, 0) === 0
  );
}

/**
 * Inserts a new generic add-on for one service. The legacy_id is globally unique
 * (random tail) so it survives an archive → recreate cycle. Optional fields fall
 * back to the migration 0074 defaults. NO legacy add-on rule is read or seeded.
 */
export async function createCalculatorAddon(input: NewAddonInput): Promise<void> {
  const client = configuredClient();
  const payload = {
    legacy_id: newConfigLegacyId(`calc_addon_${input.addonKey}`),
    company_id: input.companyId,
    company_legacy_id: input.companyLegacyId,
    calculator_service_id: input.serviceId,
    calculator_service_legacy_id: input.serviceLegacyId ?? null,
    service_key: input.serviceKey,
    addon_key: input.addonKey,
    name: input.name,
    public_label: input.publicLabel,
    description: input.description ?? null,
    input_type: input.inputType,
    boolean_default: input.booleanDefault ?? false,
    quantity_min: input.quantityMin ?? 0,
    quantity_max: input.quantityMax ?? null,
    quantity_step: input.quantityStep ?? 1,
    quantity_default: input.quantityDefault ?? 0,
    effect_time_minutes: input.effectTimeMinutes ?? 0,
    effect_fixed_excl_vat: input.effectFixedExclVat ?? 0,
    effect_percent: input.effectPercent ?? 0,
    active: input.active ?? true,
    public_visible: input.publicVisible ?? true,
    required: input.required ?? false,
    sort_order: input.sortOrder,
    data: {},
    // Only stamp the library link when activating a library item; omitting the key
    // keeps the payload identical to the pre-library custom add-on insert.
    ...(input.libraryItemId ? { library_item_id: input.libraryItemId } : {}),
  };

  const { data, error } = await client
    .from("calculator_addons")
    .insert(payload)
    .select("legacy_id")
    .maybeSingle();

  if (error) {
    throw new CalculatorConfigAdminError(`[calculator_addons] insert failed: ${error.message}`);
  }
  if (!data) {
    throw new CalculatorConfigAdminError("Add-on was not created. No change was made.");
  }
}

/**
 * GPM-CALC-LIBRARY-4 — builds the service-scoped add-on insert input that ACTIVATES
 * a reusable add-on library item onto a service. Copies the library defaults (copy +
 * input model + the three effect channels) and stamps `libraryItemId` so the created
 * calculator_addons row links back to its library source. The admin can still
 * override every field afterwards via the normal add-on edit card. Pure (no I/O);
 * `sortOrder` is supplied by the caller (placement on the service).
 */
export function buildAddonLibraryActivationInput(
  item: AddonLibraryItem,
  target: {
    companyId: string;
    companyLegacyId: string;
    serviceId: string;
    serviceLegacyId: string | null;
    serviceKey: string;
  },
  sortOrder: number,
): NewAddonInput {
  return {
    companyId: target.companyId,
    companyLegacyId: target.companyLegacyId,
    serviceId: target.serviceId,
    serviceLegacyId: target.serviceLegacyId,
    serviceKey: target.serviceKey,
    addonKey: item.addonKey,
    name: item.name,
    publicLabel: item.publicLabel,
    description: item.description,
    inputType: item.inputType,
    booleanDefault: item.booleanDefault,
    quantityMin: item.quantityMin,
    quantityMax: item.quantityMax,
    quantityStep: item.quantityStep,
    quantityDefault: item.quantityDefault,
    effectTimeMinutes: item.effectTimeMinutes,
    effectFixedExclVat: item.effectFixedExclVat,
    effectPercent: item.effectPercent,
    sortOrder,
    libraryItemId: item.id,
  };
}

/**
 * Updates ONE add-on's safe fields, scoped by stable legacy_id. The addon_key,
 * owning service and company scope are intentionally NOT writable (mirrors the
 * locked plan_key / question_key convention). Writes only the supplied columns.
 */
export async function updateCalculatorAddon(legacyId: string, patch: CalculatorAddonPatch): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (patch.name !== undefined) payload.name = patch.name;
  if (patch.publicLabel !== undefined) payload.public_label = patch.publicLabel;
  if (patch.description !== undefined) payload.description = patch.description;
  if (patch.inputType !== undefined) payload.input_type = patch.inputType;
  if (patch.booleanDefault !== undefined) payload.boolean_default = patch.booleanDefault;
  if (patch.quantityMin !== undefined) payload.quantity_min = patch.quantityMin;
  if (patch.quantityMax !== undefined) payload.quantity_max = patch.quantityMax;
  if (patch.quantityStep !== undefined) payload.quantity_step = patch.quantityStep;
  if (patch.quantityDefault !== undefined) payload.quantity_default = patch.quantityDefault;
  if (patch.effectTimeMinutes !== undefined) payload.effect_time_minutes = patch.effectTimeMinutes;
  if (patch.effectFixedExclVat !== undefined) payload.effect_fixed_excl_vat = patch.effectFixedExclVat;
  if (patch.effectPercent !== undefined) payload.effect_percent = patch.effectPercent;
  if (patch.active !== undefined) payload.active = patch.active;
  if (patch.publicVisible !== undefined) payload.public_visible = patch.publicVisible;
  if (patch.required !== undefined) payload.required = patch.required;
  if (patch.sortOrder !== undefined) payload.sort_order = patch.sortOrder;
  await runScopedUpdate("calculator_addons", legacyId, payload);
}

/**
 * Archives an add-on via soft-delete (`deleted_at`) — never a hard delete, the
 * calculator-wide convention. Scoped by stable legacy_id; throws if no live row
 * matched. Frees the `(service, addon_key)` live-unique slot so the same key can
 * be recreated later.
 */
export async function archiveCalculatorAddon(legacyId: string): Promise<void> {
  const client = configuredClient();
  const { data, error } = await client
    .from("calculator_addons")
    .update({ deleted_at: new Date().toISOString() })
    .eq("legacy_id", legacyId)
    .is("deleted_at", null)
    .select("legacy_id")
    .maybeSingle();

  if (error) {
    throw new CalculatorConfigAdminError(`[calculator_addons] archive failed: ${error.message}`);
  }
  if (!data) {
    throw new CalculatorConfigAdminError(
      "[calculator_addons] row not found (it may already be archived). No change was made.",
    );
  }
}

// ══ Calculator library items (GPM-CALC-LIBRARY-2B — reusable question/add-on defaults) ══
//
// Data-access for the reusable, company-scoped library tables (migration 0077):
//   • calculator_question_library_items
//   • calculator_addon_library_items
// These hold DEFAULTS only — they are NEVER the public read model and NEVER
// service-scoped. Activating a library item onto a service (a later ticket) copies
// these defaults onto a calculator_questions / calculator_addons row and stamps
// that row's library_item_id. Mirrors the calculator-wide write conventions
// exactly: stable machine keys (question_key / addon_key) + company scope are
// LOCKED after creation, there is NO hard delete (archive flips deleted_at), and a
// missing table (older environment) is tolerated by returning an empty list. NO
// existing service-scoped question/add-on read or write path is touched here.

const QUESTION_LIBRARY_COLUMNS =
  "id, legacy_id, company_id, company_legacy_id, question_key, label, help_text, input_type, " +
  "default_required, default_affects_pricing, default_options_json, default_validation_json, " +
  "default_sort_order, description, active";

const ADDON_LIBRARY_COLUMNS =
  "id, legacy_id, company_id, company_legacy_id, addon_key, name, public_label, description, " +
  "input_type, boolean_default, quantity_min, quantity_max, quantity_step, quantity_default, " +
  "effect_time_minutes, effect_fixed_excl_vat, effect_percent, default_sort_order, active";

/**
 * Reads the company's live reusable QUESTION library items (migration 0077),
 * ordered by sort order → key. Mirrors {@link readAddonRows}'s migration
 * tolerance: a DB without the table yet falls back to an empty list rather than
 * failing the whole load.
 */
async function readQuestionLibraryItemRows(
  client: ReturnType<typeof configuredClient>,
  companyId: string,
): Promise<QuestionLibraryItemRow[]> {
  const result = await client
    .from("calculator_question_library_items")
    .select(QUESTION_LIBRARY_COLUMNS)
    .eq("company_id", companyId)
    .is("deleted_at", null)
    .order("default_sort_order", { ascending: true })
    .order("question_key", { ascending: true });

  if (!result.error) return (result.data ?? []) as unknown as QuestionLibraryItemRow[];
  if (isMissingRelationError(result.error, "calculator_question_library_items")) return [];
  throw new CalculatorConfigAdminError(
    `[calculator_question_library_items] read failed: ${result.error.message}`,
  );
}

/** Lists the company's reusable question library items as camelCase editor views. */
export async function listQuestionLibraryItems(companyId: string): Promise<QuestionLibraryItem[]> {
  const client = configuredClient();
  const rows = await readQuestionLibraryItemRows(client, companyId);
  return rows.map(mapQuestionLibraryItemRow);
}

/**
 * Reads the company's live reusable ADD-ON library items (migration 0077),
 * ordered by sort order → key. Missing table is tolerated → empty list.
 */
async function readAddonLibraryItemRows(
  client: ReturnType<typeof configuredClient>,
  companyId: string,
): Promise<AddonLibraryItemRow[]> {
  const result = await client
    .from("calculator_addon_library_items")
    .select(ADDON_LIBRARY_COLUMNS)
    .eq("company_id", companyId)
    .is("deleted_at", null)
    .order("default_sort_order", { ascending: true })
    .order("addon_key", { ascending: true });

  if (!result.error) return (result.data ?? []) as unknown as AddonLibraryItemRow[];
  if (isMissingRelationError(result.error, "calculator_addon_library_items")) return [];
  throw new CalculatorConfigAdminError(
    `[calculator_addon_library_items] read failed: ${result.error.message}`,
  );
}

/** Lists the company's reusable add-on library items as camelCase editor views. */
export async function listAddonLibraryItems(companyId: string): Promise<AddonLibraryItem[]> {
  const client = configuredClient();
  const rows = await readAddonLibraryItemRows(client, companyId);
  return rows.map(mapAddonLibraryItemRow);
}

/** Everything needed to create a reusable question library item. */
export interface NewQuestionLibraryItemInput {
  companyId: string;
  companyLegacyId: string;
  questionKey: string;
  label: string;
  helpText?: string | null;
  inputType: CalculatorInputType;
  defaultRequired?: boolean;
  defaultAffectsPricing?: boolean;
  defaultOptions?: QuestionOption[];
  defaultValidation?: Record<string, unknown>;
  defaultSortOrder?: number;
  description?: string | null;
}

/**
 * Inserts a reusable question library item. The legacy_id carries a random tail
 * so re-creating a key whose previous library item was archived never collides on
 * the global legacy_id unique constraint; the live `(company, question_key)` unique
 * index still rejects a duplicate active key. NO service-scoped row is created.
 */
export async function createQuestionLibraryItem(input: NewQuestionLibraryItemInput): Promise<void> {
  const client = configuredClient();
  const payload = {
    legacy_id: newConfigLegacyId(`calc_qlib_${input.questionKey}`),
    company_id: input.companyId,
    company_legacy_id: input.companyLegacyId,
    question_key: input.questionKey,
    label: input.label,
    help_text: input.helpText ?? null,
    input_type: input.inputType,
    default_required: input.defaultRequired ?? false,
    default_affects_pricing: input.defaultAffectsPricing ?? true,
    default_options_json: input.defaultOptions ?? [],
    default_validation_json: input.defaultValidation ?? {},
    default_sort_order: input.defaultSortOrder ?? 0,
    description: input.description ?? null,
    active: true,
    data: {},
  };

  const { data, error } = await client
    .from("calculator_question_library_items")
    .insert(payload)
    .select("legacy_id")
    .maybeSingle();

  if (error) {
    throw new CalculatorConfigAdminError(`[calculator_question_library_items] insert failed: ${error.message}`);
  }
  if (!data) {
    throw new CalculatorConfigAdminError("Question library item was not created. No change was made.");
  }
}

/** Safe, updatable fields of a question library item (question_key + scope locked). */
export interface QuestionLibraryItemPatch {
  label?: string;
  helpText?: string | null;
  inputType?: CalculatorInputType;
  defaultRequired?: boolean;
  defaultAffectsPricing?: boolean;
  defaultOptions?: QuestionOption[];
  defaultValidation?: Record<string, unknown>;
  defaultSortOrder?: number;
  description?: string | null;
  active?: boolean;
}

/** Updates ONE question library item's safe fields, scoped by stable legacy_id. */
export async function updateQuestionLibraryItem(
  legacyId: string,
  patch: QuestionLibraryItemPatch,
): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (patch.label !== undefined) payload.label = patch.label;
  if (patch.helpText !== undefined) payload.help_text = patch.helpText;
  if (patch.inputType !== undefined) payload.input_type = patch.inputType;
  if (patch.defaultRequired !== undefined) payload.default_required = patch.defaultRequired;
  if (patch.defaultAffectsPricing !== undefined) payload.default_affects_pricing = patch.defaultAffectsPricing;
  if (patch.defaultOptions !== undefined) payload.default_options_json = patch.defaultOptions;
  if (patch.defaultValidation !== undefined) payload.default_validation_json = patch.defaultValidation;
  if (patch.defaultSortOrder !== undefined) payload.default_sort_order = patch.defaultSortOrder;
  if (patch.description !== undefined) payload.description = patch.description;
  if (patch.active !== undefined) payload.active = patch.active;
  await runScopedUpdate("calculator_question_library_items", legacyId, payload);
}

/** Archives a question library item via soft-delete (never a hard delete). */
export async function archiveQuestionLibraryItem(legacyId: string): Promise<void> {
  const client = configuredClient();
  const { data, error } = await client
    .from("calculator_question_library_items")
    .update({ deleted_at: new Date().toISOString() })
    .eq("legacy_id", legacyId)
    .is("deleted_at", null)
    .select("legacy_id")
    .maybeSingle();

  if (error) {
    throw new CalculatorConfigAdminError(`[calculator_question_library_items] archive failed: ${error.message}`);
  }
  if (!data) {
    throw new CalculatorConfigAdminError(
      "[calculator_question_library_items] row not found (it may already be archived). No change was made.",
    );
  }
}

/** Everything needed to create a reusable add-on library item. */
export interface NewAddonLibraryItemInput {
  companyId: string;
  companyLegacyId: string;
  addonKey: string;
  name: string;
  publicLabel: string;
  description?: string | null;
  inputType: CalculatorAddonInputType;
  booleanDefault?: boolean;
  quantityMin?: number;
  quantityMax?: number | null;
  quantityStep?: number;
  quantityDefault?: number;
  effectTimeMinutes?: number;
  effectFixedExclVat?: number;
  effectPercent?: number;
  defaultSortOrder?: number;
}

/**
 * Inserts a reusable add-on library item. Mirrors {@link createCalculatorAddon}
 * conventions (random legacy_id tail, optional fields fall back to the migration
 * 0077 defaults). NO service-scoped calculator_addons row is created.
 */
export async function createAddonLibraryItem(input: NewAddonLibraryItemInput): Promise<void> {
  const client = configuredClient();
  const payload = {
    legacy_id: newConfigLegacyId(`calc_alib_${input.addonKey}`),
    company_id: input.companyId,
    company_legacy_id: input.companyLegacyId,
    addon_key: input.addonKey,
    name: input.name,
    public_label: input.publicLabel,
    description: input.description ?? null,
    input_type: input.inputType,
    boolean_default: input.booleanDefault ?? false,
    quantity_min: input.quantityMin ?? 0,
    quantity_max: input.quantityMax ?? null,
    quantity_step: input.quantityStep ?? 1,
    quantity_default: input.quantityDefault ?? 0,
    effect_time_minutes: input.effectTimeMinutes ?? 0,
    effect_fixed_excl_vat: input.effectFixedExclVat ?? 0,
    effect_percent: input.effectPercent ?? 0,
    default_sort_order: input.defaultSortOrder ?? 0,
    active: true,
    data: {},
  };

  const { data, error } = await client
    .from("calculator_addon_library_items")
    .insert(payload)
    .select("legacy_id")
    .maybeSingle();

  if (error) {
    throw new CalculatorConfigAdminError(`[calculator_addon_library_items] insert failed: ${error.message}`);
  }
  if (!data) {
    throw new CalculatorConfigAdminError("Add-on library item was not created. No change was made.");
  }
}

/** Safe, updatable fields of an add-on library item (addon_key + scope locked). */
export interface AddonLibraryItemPatch {
  name?: string;
  publicLabel?: string;
  description?: string | null;
  inputType?: CalculatorAddonInputType;
  booleanDefault?: boolean;
  quantityMin?: number;
  quantityMax?: number | null;
  quantityStep?: number;
  quantityDefault?: number;
  effectTimeMinutes?: number;
  effectFixedExclVat?: number;
  effectPercent?: number;
  defaultSortOrder?: number;
  active?: boolean;
}

/** Updates ONE add-on library item's safe fields, scoped by stable legacy_id. */
export async function updateAddonLibraryItem(legacyId: string, patch: AddonLibraryItemPatch): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (patch.name !== undefined) payload.name = patch.name;
  if (patch.publicLabel !== undefined) payload.public_label = patch.publicLabel;
  if (patch.description !== undefined) payload.description = patch.description;
  if (patch.inputType !== undefined) payload.input_type = patch.inputType;
  if (patch.booleanDefault !== undefined) payload.boolean_default = patch.booleanDefault;
  if (patch.quantityMin !== undefined) payload.quantity_min = patch.quantityMin;
  if (patch.quantityMax !== undefined) payload.quantity_max = patch.quantityMax;
  if (patch.quantityStep !== undefined) payload.quantity_step = patch.quantityStep;
  if (patch.quantityDefault !== undefined) payload.quantity_default = patch.quantityDefault;
  if (patch.effectTimeMinutes !== undefined) payload.effect_time_minutes = patch.effectTimeMinutes;
  if (patch.effectFixedExclVat !== undefined) payload.effect_fixed_excl_vat = patch.effectFixedExclVat;
  if (patch.effectPercent !== undefined) payload.effect_percent = patch.effectPercent;
  if (patch.defaultSortOrder !== undefined) payload.default_sort_order = patch.defaultSortOrder;
  if (patch.active !== undefined) payload.active = patch.active;
  await runScopedUpdate("calculator_addon_library_items", legacyId, payload);
}

/** Archives an add-on library item via soft-delete (never a hard delete). */
export async function archiveAddonLibraryItem(legacyId: string): Promise<void> {
  const client = configuredClient();
  const { data, error } = await client
    .from("calculator_addon_library_items")
    .update({ deleted_at: new Date().toISOString() })
    .eq("legacy_id", legacyId)
    .is("deleted_at", null)
    .select("legacy_id")
    .maybeSingle();

  if (error) {
    throw new CalculatorConfigAdminError(`[calculator_addon_library_items] archive failed: ${error.message}`);
  }
  if (!data) {
    throw new CalculatorConfigAdminError(
      "[calculator_addon_library_items] row not found (it may already be archived). No change was made.",
    );
  }
}

// ── Pricing-rule audit history (read) ────────────────────────────────────

/** A pricing-rule change as shown in the history list. */
export interface PricingRuleAuditEntry {
  id: string;
  at: string;
  actorName: string;
  actorRole: string;
  ruleKey: string;
  ruleType: string | null;
  oldValue: number | null;
  newValue: number | null;
  note: string | null;
}

/**
 * Parses an `activity_events.data` blob into a {@link PricingRuleAuditEntry}.
 * Pure + defensive: returns null for anything that is not a pricing-rule change,
 * so a malformed or unrelated row can never crash the history view.
 */
export function parsePricingRuleAuditEvent(raw: unknown): PricingRuleAuditEntry | null {
  const obj = asRecord(raw);
  if (obj.action !== CALCULATOR_PRICING_RULE_AUDIT_ACTION) return null;
  const id = typeof obj.id === "string" ? obj.id : null;
  const at = typeof obj.at === "string" ? obj.at : null;
  if (id === null || at === null) return null;
  const calc = asRecord(obj.calculator);
  return {
    id,
    at,
    actorName: typeof obj.actorName === "string" && obj.actorName.trim() !== "" ? obj.actorName : "Okänd",
    actorRole: typeof obj.actorRole === "string" ? obj.actorRole : "",
    ruleKey: typeof calc.ruleKey === "string" ? calc.ruleKey : "",
    ruleType: typeof calc.ruleType === "string" ? calc.ruleType : null,
    oldValue: numberOrNull(calc.oldValue),
    newValue: numberOrNull(calc.newValue),
    note: typeof calc.note === "string" && calc.note.trim() !== "" ? calc.note : null,
  };
}

/**
 * Recent pricing-rule changes for one calculator company, newest first. Reads the
 * append-only `activity_events` trail directly (Supabase-authoritative), filtered
 * to the pricing-rule action + company scope.
 */
export async function listPricingRuleAuditEvents(
  companyLegacyId: string,
  limit = 20,
): Promise<PricingRuleAuditEntry[]> {
  const client = configuredClient();
  const { data, error } = await client
    .from("activity_events")
    .select("data, occurred_at")
    .eq("company_legacy_id", companyLegacyId)
    .eq("action", CALCULATOR_PRICING_RULE_AUDIT_ACTION)
    .order("occurred_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new CalculatorConfigAdminError(`[activity_events] audit read failed: ${error.message}`);
  }
  const rows = (data ?? []) as Array<{ data: unknown }>;
  return rows
    .map((r) => parsePricingRuleAuditEvent(r.data))
    .filter((e): e is PricingRuleAuditEntry => e !== null);
}
