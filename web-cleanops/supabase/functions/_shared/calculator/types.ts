// ============================================================================
// Price Calculator — SHARED Deno types for the public-calculator Edge Function.
// ============================================================================
//
// Why this file lives under `supabase/functions/_shared` (NOT in `src`):
//   Deno requires explicit `.ts` extensions on relative imports and only bundles
//   files INSIDE the functions directory reliably (the documented `_shared`
//   convention). The app's pricing engine in `src/lib/calculator` uses
//   extensionless imports and the Vite toolchain, so it cannot be imported into
//   Deno directly. These types are a faithful MIRROR of
//   `src/lib/calculator/types.ts` (engine contract) PLUS the Supabase row shapes
//   and the public request/response DTOs the Edge Function exchanges with the
//   public client. The engine port in `./pricingEngine.ts` is locked to the
//   approved `src` engine by a vitest parity test, so the two never drift.
//
// SECURITY NOTE: the public DTOs intentionally OMIT internal-only fields
//   (pricing-rule values, margins, manual-review thresholds, submission
//   behaviour, ids/legacy ids, the internal calculation `steps[]` trace). Only
//   public-safe data crosses the wire.
// ============================================================================

// ── Engine contract (mirror of src/lib/calculator/types.ts) ─────────────────

/** Stable machine key the engine switches on (mirrors calculator_services.pricing_model). */
export type PricingModel =
  | "home_cleaning_recommended_hours"
  | "move_out_fixed_plus_addons"
  | "office_cleaning_recurring_area_frequency";

/**
 * A pricing-model identifier that may be STAMPED on a public response / frozen
 * snapshot. Superset of the legacy engine {@link PricingModel}: it also allows the
 * LITERAL generic `sqm_fixed` model, which the V2 runtime can now price + report
 * for admin-created generic services (GPM-5b-1). The legacy ENGINE still switches
 * only on {@link PricingModel}, so this wider type is REPORTING-ONLY and never
 * reaches the engine's exhaustiveness guard. It is intentionally NOT widened with
 * the other reserved generic models (unit_based / fixed_package / manual_quote),
 * which do not route to V2 yet.
 */
export type ReportedPricingModel = PricingModel | "sqm_fixed";

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

// "hourly_rate_plus_time_adjustment" (Slice 12L office pilot): per-plan hourly
// rate + a fixed TOTAL time adjustment per visit (hours), stored in the plan's
// priceAdjustmentValue field (reused as hours; no schema change).
export type PlanPricingModel =
  | "hourly_rate_by_plan"
  | "price_adjustment_per_plan"
  | "time_adjustment_per_visit"
  | "hourly_rate_plus_time_adjustment";
export type PlanPriceAdjustmentType = "fixed_amount" | "percent";
export type RutApplyTo = "total_customer_price" | "labor_service_price_only";

/**
 * Slice 12Q — Home Cleaning per-square-meter % adjustment range. Mirror of
 * src/lib/calculator/types.ts. Each range scales the configured `hours_per_sqm`
 * for customers whose area falls in `[fromSqm, toSqm]` (toSqm null = open-ended);
 * it only affects the per-m² time component, never start/minimum/add-ons/VAT/RUT.
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
 * false the price fields are `null` and `issues` explains why.
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
   * Configured price rounding interval (kr) used by the engine, or null when no
   * rounding is configured. Exposed so customer-facing surfaces can round the
   * post-VAT/RUT display price to the SAME nearest interval everywhere.
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

/** The persisted trace shape (doc 04). Not exposed publicly; reserved for the submit slice. */
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

// ── Supabase row shapes (only the columns the function SELECTs) ──────────────
// Loosely typed jsonb columns are `unknown` so the pure mapper validates them.

export interface CompanyRow {
  id: string;
  name: string;
  legacy_id: string | null;
}

export interface CalculatorSettingsRow {
  id: string;
  company_id: string;
  company_legacy_id: string;
  enabled: boolean;
  public_slug: string | null;
  price_display_mode: string;
  show_price_before_contact: boolean;
  require_contact_before_result: boolean;
  show_login_prompt_after_submit: boolean;
  quote_validity_days: number;
  currency: string;
  rut_display_mode: string;
  default_vat_rate_percent?: number | string | null;
  content: unknown;
  // Submission behaviour — fetched only by the submit action (optional here so the
  // config/calculate column selections, which omit them, still type-check).
  manual_review_threshold_amount?: number | string | null;
  auto_create_prospect?: boolean;
  auto_create_quote_request?: boolean;
  default_quote_status?: string;
}

export interface CalculatorServiceRow {
  id: string;
  service_key: string;
  display_name: string;
  description: string | null;
  enabled: boolean;
  coming_soon: boolean;
  pricing_model: string;
  sort_order: number;
  settings_json: unknown;
}

export interface CalculatorQuestionRow {
  id: string;
  calculator_service_id: string;
  question_key: string;
  label: string;
  help_text: string | null;
  input_type: string;
  required: boolean;
  options_json: unknown;
  validation_json: unknown;
  sort_order: number;
  /** Whether the answer feeds pricing; snapshotted onto the answer row when known. */
  affects_pricing?: boolean;
}

export interface CleaningPlanRow {
  id: string;
  plan_key: string;
  name: string;
  description: string | null;
  calculator_service_id?: string | null;
  calculator_service_legacy_id?: string | null;
  service_key?: string | null;
  hourly_rate: number;
  vat_rate_percent?: number | string | null;
  price_adjustment_type?: string | null;
  price_adjustment_value?: number | string | null;
  rut_eligible?: boolean;
  rut_enabled?: boolean;
  rut_percent?: number | string | null;
  rut_apply_to?: string | null;
  show_rut_breakdown?: boolean;
  flexibility_level: string | null;
  customer_day_time_control: string | null;
  same_staff_preference_level: string | null;
  booking_priority: string | null;
  cancellation_terms_summary: string | null;
  is_default: boolean;
  sort_order: number;
}

export interface PricingRuleRow {
  id: string;
  rule_key: string;
  rule_type: string;
  value_numeric: number | string | null;
}

export interface CalculatorSizeBandRow {
  id: string;
  calculator_service_id: string;
  calculator_service_legacy_id?: string | null;
  service_key: string;
  min_sqm: number | string;
  max_sqm?: number | string | null;
  recommended_hours: number | string;
  extra_hours_per_started_10_sqm?: number | string | null;
  extra_hours_start_after_sqm?: number | string | null;
  active: boolean;
  sort_order: number;
}

/**
 * A `calculator_addons` row as loaded by the CONFIG action (Slice V2-E3-1).
 *
 * PUBLIC-SAFETY: the config loader fetches ONLY the public-safe display columns —
 * the pricing effect channels (effect_time_minutes / effect_fixed_excl_vat /
 * effect_percent) and the internal admin `name` are NEVER selected here, so they
 * can never reach the public config mapper. `active` / `public_visible` /
 * `deleted_at` are filtered in SQL AND re-checked defensively by the pure mapper
 * ({@link buildPublicConfig}); they are optional so a public-only select still
 * type-checks. `numeric` columns arrive as text from Postgres.
 */
export interface CalculatorAddonConfigRow {
  /** Service this add-on belongs to (used to group add-ons under their service). */
  calculator_service_id: string;
  addon_key: string;
  public_label: string;
  description?: string | null;
  input_type: string;
  boolean_default?: boolean | null;
  quantity_min?: number | string | null;
  quantity_max?: number | string | null;
  quantity_step?: number | string | null;
  quantity_default?: number | string | null;
  required?: boolean | null;
  sort_order?: number | string | null;
  /** Lifecycle flags — filtered in SQL and re-checked by the mapper (optional when not selected). */
  active?: boolean | null;
  public_visible?: boolean | null;
  deleted_at?: string | null;
}

// ── Public-safe DTOs (what crosses the wire to the anonymous client) ─────────

/** Public-safe subset of calculator_settings behaviour flags. */
export interface PublicSettings {
  publicSlug: string | null;
  priceDisplayMode: PriceDisplayMode;
  currency: string;
  showPriceBeforeContact: boolean;
  requireContactBeforeResult: boolean;
  showLoginPromptAfterSubmit: boolean;
  rutDisplayMode: string;
  defaultVatRatePercent: number;
  quoteValidityDays: number;
}

/** Public-safe question (form field) — no pricing semantics exposed. */
export interface PublicQuestion {
  questionKey: string;
  label: string;
  helpText: string | null;
  inputType: string;
  required: boolean;
  options: unknown;
  validation: unknown;
  sortOrder: number;
}

/**
 * Public-safe generic add-on (Slice V2-E3-1). Customer-facing input definition
 * sourced ONLY from `calculator_addons` — it intentionally OMITS the pricing
 * effect channels (effect_time_minutes / effect_fixed_excl_vat / effect_percent)
 * and the internal admin `name`. The server stays authoritative for pricing; the
 * public client only needs enough to RENDER the input and submit a selection
 * under `answers.addonSelections` (rendered in a later slice).
 */
export interface PublicAddon {
  addonKey: string;
  publicLabel: string;
  description: string | null;
  inputType: "boolean" | "quantity";
  booleanDefault: boolean;
  quantityMin: number;
  quantityMax: number | null;
  quantityStep: number;
  quantityDefault: number;
  required: boolean;
  sortOrder: number;
}

/** Public-safe service card + its visible questions + generic add-ons. */
export interface PublicService {
  serviceKey: string;
  displayName: string;
  description: string | null;
  enabled: boolean;
  comingSoon: boolean;
  pricingModel: string;
  /**
   * GPM-5c-1 — the service's LITERAL stored generic pricing model (one of the
   * GENERIC_PRICING_MODELS: hourly_by_area / sqm_fixed / unit_based / fixed_package /
   * manual_quote), or null for a legacy/service-named model. NEVER alias-resolved, so a
   * legacy `move_out_fixed_plus_addons` service reports null here — it is not classified
   * as generic `sqm_fixed`, mirroring the GPM-5b-1 "literal sqm_fixed only" routing rule.
   */
  genericPricingModel: string | null;
  /**
   * GPM-5c-1 — whether the PUBLIC RUNTIME can price this generic model TODAY. True ONLY
   * for the literal generic `sqm_fixed` model (the only model GPM-5b-1 routes to V2).
   * `hourly_by_area`, the reserved models (unit_based / fixed_package / manual_quote),
   * and every legacy service report false. Additive metadata for the client — it does
   * NOT drive routing (the server still gates calculate/submit via shouldRouteServiceToV2).
   */
  engineSupported: boolean;
  /**
   * GPM-5c-1 — the canonical primary input the generic model needs, derived from its
   * pricing basis: "sqm" for the area-driven `hourly_by_area` + `sqm_fixed` bases, null
   * for models with no canonical primary input yet (unit_based / fixed_package /
   * manual_quote) and for legacy/non-generic services.
   */
  primaryInput: "sqm" | null;
  /**
   * GPM-5c-1 — the customer-facing unit label for {@link primaryInput} ("m²" for sqm),
   * or null when there is no canonical primary input. Purely presentational metadata.
   */
  unitLabel: string | null;
  requiresCleaningPlan: boolean;
  plansEnabled: boolean;
  planPricingModel: PlanPricingModel;
  defaultPlanKey: string | null;
  baseHourlyRateExclVat: number | null;
  defaultVatRatePercent: number;
  sortOrder: number;
  questions: PublicQuestion[];
  /**
   * Generic add-ons (Slice V2-E3-1): active + public_visible add-ons for this
   * service, sorted by sort_order then addon_key. Empty array when the service
   * has none. Coming-soon services always return []. Frontend rendering lands in
   * a later slice; the field is additive and ignored by the current client.
   */
  addons: PublicAddon[];
}

/** Public-safe cleaning plan. hourlyRate IS exposed (needed for client preview). */
export interface PublicCleaningPlan {
  id: string;
  planKey: string;
  name: string;
  description: string | null;
  serviceKey: string;
  hourlyRate: number;
  vatRatePercent: number;
  priceAdjustmentType: PlanPriceAdjustmentType;
  priceAdjustmentValue: number;
  rutEligible: boolean;
  rutEnabled: boolean;
  rutPercent: number;
  rutApplyTo: RutApplyTo;
  showRutBreakdown: boolean;
  flexibilityLevel: string | null;
  customerDayTimeControl: string | null;
  sameStaffPreferenceLevel: string | null;
  bookingPriority: string | null;
  cancellationTermsSummary: string | null;
  isDefault: boolean;
  sortOrder: number;
}

/** The public calculator config response (config action). */
export interface PublicConfigResponse {
  ok: true;
  enabled: boolean;
  company: { name: string } | null;
  settings: PublicSettings;
  content: Record<string, unknown>;
  services: PublicService[];
  cleaningPlans: PublicCleaningPlan[];
  faq: unknown[];
}

/** The public price-calculation request (calculate action). */
export interface PublicCalculateRequest {
  serviceKey: string;
  answers: CalculatorAnswers;
  /** Stable plan key OR plan uuid; required only when the service needs a plan. */
  cleaningPlanKey?: string | null;
  cleaningPlanId?: string | null;
}

/** Public-safe selected-plan summary echoed back with a calculation. */
export interface PublicSelectedPlan {
  planKey: string;
  name: string;
  hourlyRate: number;
  vatRatePercent: number;
  rutEnabled: boolean;
  rutPercent: number;
  showRutBreakdown: boolean;
}

/**
 * Additive, OPTIONAL debug block emitted ONLY by the Home Cleaning V2 calculate
 * path (Slice V2-E2). It surfaces the V2 pricing-time vs service-time split, the
 * resolved generic add-on effects, the four-week multiplier, and the rounding
 * source for tests + live verification. The public client normalizer DROPS unknown
 * keys, so this never reaches or is depended on by the result-card UI.
 */
export interface V2CalculateDebug {
  pricingBasis: "hourly" | "sqm_fixed";
  selectedPlanKey: string | null;
  /** Customer-facing PER-VISIT service time (hours) — what `estimatedHours` carries. */
  estimatedServiceHours: number | null;
  /** Internal price-only time (= estimatedServiceHours + plan start adjustment). */
  pricingHours: number | null;
  addonMinutes: number;
  addonFixedExclVat: number;
  addonPercent: number;
  /** Display rounding interval from settings_json (null → client rounds to whole SEK). */
  displayRoundingInterval: number | null;
  /** PER-VISIT raw price excl VAT before the four-week multiply. */
  rawPriceExclVat: number | null;
  visitsPerFourWeeks: number;
  /** Four-week raw excl VAT (= rawPriceExclVat × visitsPerFourWeeks). null when invalid. */
  fourWeekRawExclVat: number | null;
}

/**
 * The public price-calculation response (calculate action). Intentionally omits
 * the internal `steps[]` trace, raw rule values, and rawPrice.
 */
export interface PublicCalculateResponse {
  ok: true;
  enabled: boolean;
  valid: boolean;
  issues: PriceIssue[];
  serviceKey: string;
  pricingModel: ReportedPricingModel | null;
  formulaVersion: string;
  currency: string;
  priceDisplayMode: PriceDisplayMode;
  estimatedHours: number | null;
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
  /** Configured price rounding interval (kr), or null when no rounding is set. */
  roundingIncrement: number | null;
  displayText: string;
  selectedPlan: PublicSelectedPlan | null;
  /** Additive Home V2 debug block (Slice V2-E2); absent on the legacy path. */
  v2?: V2CalculateDebug;
}

// ── Submit action (Slice 4) ───────────────────────────────────────────────────
//
// `submit` is the WRITE path: it recomputes the price server-side (never trusts
// the client), and — only when the calculator is enabled — creates/updates a
// prospect, a quote_request (with a frozen pricing snapshot), and one
// quote_request_answers row per submitted answer. The pure layer builds the row
// PAYLOADS + the public-safe response; the Edge Function performs the ordered
// I/O and injects the DB-generated uuids.

/** Contact details captured with a submission. Email is REQUIRED; the rest optional. */
export interface PublicContact {
  name: string | null;
  /** Already normalised (trimmed + lowercased) by validateSubmitRequest. */
  email: string;
  phone: string | null;
  postalCode: string | null;
}

/** The public quote-submission request (submit action). */
export interface PublicSubmitRequest {
  serviceKey: string;
  answers: CalculatorAnswers;
  cleaningPlanKey?: string | null;
  cleaningPlanId?: string | null;
  contact: PublicContact;
  sourceUrl: string | null;
}

/** Customer-facing “what happens next” copy (no auth/magic-link wired in MVP). */
export interface PublicSubmitNextStep {
  confirmationText: string;
  showLoginPrompt: boolean;
  loginPromptText: string | null;
}

/**
 * The public submit response. A consistent superset of the calculate response:
 * carries the quote LEGACY id (never the uuid), status, validity, and next-step
 * copy. Intentionally OMITS prospect/quote uuids, rule values, and the internal
 * calculation trace.
 */
export interface PublicSubmitResponse {
  ok: true;
  enabled: boolean;
  /** false when the calculator is dark (enabled=false) — nothing was written. */
  available: boolean;
  /** 'not_available' when disabled; otherwise the created quote's status. */
  status: string | null;
  valid: boolean;
  issues: PriceIssue[];
  serviceKey: string | null;
  pricingModel: ReportedPricingModel | null;
  formulaVersion: string | null;
  currency: string | null;
  priceDisplayMode: PriceDisplayMode | null;
  estimatedHours: number | null;
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
  /** Configured price rounding interval (kr), or null when no rounding is set. */
  roundingIncrement: number | null;
  displayText: string;
  selectedPlan: PublicSelectedPlan | null;
  /** Stable business id of the created quote (NOT a uuid). null when none created. */
  quoteRequestLegacyId: string | null;
  /** Human-facing reference — not allocated in this slice (always null). */
  reference: string | null;
  validUntil: string | null;
  requiresManualReview: boolean;
  nextStep: PublicSubmitNextStep | null;
}

/** A live prospect already on file for this company + email (the upsert target). */
export interface ExistingProspect {
  id: string;
  legacy_id: string;
  prospect_status: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  postal_code: string | null;
  source_url: string | null;
}

/** The frozen pricing trace persisted to quote_requests.pricing_snapshot_json. */
export interface StoredPricingSnapshot {
  formulaVersion: string;
  pricingModel: PricingModel;
  serviceKey: string;
  currency: string;
  priceDisplayMode: PriceDisplayMode;
  inputs: CalculatorAnswers;
  selectedPlanSnapshot: CleaningPlanSnapshot | null;
  estimatedHours: number | null;
  rawPrice: number;
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
  /** Every pricing-rule value that fed the calculation (historical truth). */
  ruleValues: PricingRuleValue[];
  /** Internal calculation trace (admin-only; never returned to the client). */
  steps: PricingStep[];
  submittedAt: string;
}

/** prospects insert/update payload. `id`/`legacyId` drive insert-vs-update in the caller. */
export interface ProspectWrite {
  mode: "insert" | "update";
  /** Existing uuid for update; null for insert (DB generates). */
  id: string | null;
  legacyId: string;
  fields: {
    company_id: string;
    company_legacy_id: string;
    prospect_status: string;
    source: string;
    source_url: string | null;
    name: string | null;
    email: string;
    phone: string | null;
    postal_code: string | null;
  };
}

/**
 * quote_requests insert payload. `fields` carries every column EXCEPT prospect_id
 * (the uuid the caller fills after writing the prospect). legacy_id is inside
 * `fields`; `legacyId` mirrors it for convenience.
 */
export interface QuoteRequestWrite {
  legacyId: string;
  prospectLegacyId: string;
  fields: Record<string, unknown>;
}

/** quote_request_answers insert payload (one per submitted answer). */
export interface QuoteRequestAnswerWrite {
  legacyId: string;
  fields: {
    company_id: string;
    company_legacy_id: string;
    question_key: string;
    question_label_snapshot: string | null;
    input_type_snapshot: string | null;
    answer_value_json: { value: AnswerValue };
    affects_pricing: boolean;
    sort_order: number;
  };
}

/**
 * The outcome of the pure submit preparation:
 *   • disabled — calculator dark; write NOTHING.
 *   • invalid  — validation/recompute failed; write NOTHING.
 *   • ready    — the row payloads + public response to persist & return.
 */
export type PreparedSubmission =
  | { kind: "disabled"; response: PublicSubmitResponse }
  | { kind: "invalid"; response: PublicSubmitResponse }
  | {
      kind: "ready";
      prospect: ProspectWrite;
      quoteRequest: QuoteRequestWrite;
      answers: QuoteRequestAnswerWrite[];
      response: PublicSubmitResponse;
    };
