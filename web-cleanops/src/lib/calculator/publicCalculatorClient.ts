/**
 * Price Calculator — PUBLIC (unauthenticated) client.
 *
 * The public calculator page never touches the calculator tables directly (they
 * have NO anon RLS — see migrations 0058/0059). Every public request goes through
 * the deployed `public-calculator` Edge Function, which holds the service role and
 * does all the public-safety filtering. This module is the browser-side wrapper
 * for that function's two READ actions used by Slice 6A:
 *
 *   • config    — public-safe calculator config for a slug.
 *   • calculate — server-authoritative price for a service + answers.
 *
 * The `submit` (write) action is intentionally NOT wired here in this slice.
 *
 * The public DTO types below MIRROR the Edge Function's public response shapes
 * (`supabase/functions/_shared/calculator/types.ts`). They are re-declared here
 * (rather than imported from the Deno function) so the browser bundle stays
 * decoupled from the server runtime and the public surface is explicit.
 */

import { z } from "zod";

/** The deployed Edge Function name (verify_jwt=false — callable anonymously). */
const PUBLIC_CALCULATOR_FUNCTION = "public-calculator";

/**
 * The hidden honeypot field name (MIRRORS abuseGuard.ts `HONEYPOT_FIELD` on the
 * server). A real person never fills it (it is visually hidden, non-tabbable,
 * autocomplete-off); a bot that fills every field reveals itself. It is sent on
 * the wire ONLY when non-empty, so a normal submission's payload is unchanged.
 */
export const HONEYPOT_FIELD = "company_website";

/** Friendly Swedish fallback shown when the server rate-limits a request (HTTP 429). */
const RATE_LIMITED_MESSAGE =
  "För många förfrågningar just nu. Vänta en liten stund och försök igen.";

// ── Public DTOs (mirror of the Edge Function's public-safe response shapes) ───

/** How the price is presented to the visitor. */
export type PriceDisplayMode = "exact" | "range" | "hidden_until_submit";

/** A single answer value coming off the calculator form (intentionally permissive). */
export type AnswerValue = string | number | boolean | string[] | null | undefined;

/** All answers for one service, keyed by question_key. */
export type CalculatorAnswers = Record<string, AnswerValue>;

/**
 * A single generic add-on selection: a boolean toggle (on/off) or a quantity. This
 * MIRRORS the V2 runtime's `AddonSelectionValueV2`; the server clamps/snaps/coerces
 * authoritatively (see `coerceAddonSelections` + `resolveAddonEffects`).
 */
export type AddonSelectionValue = boolean | number;

/**
 * Customer add-on selections keyed by `addonKey`. Sent on the wire NESTED under
 * `answers.addonSelections` (the established server contract the V2 runtime reads),
 * but carried as a SEPARATE field on the request DTOs so the public form keeps its
 * flat {@link CalculatorAnswers} shape and the transport merges it in one place.
 */
export type AddonSelections = Record<string, AddonSelectionValue>;

/** A validation problem returned by the server-side engine. */
export interface PriceIssue {
  code: string;
  field?: string;
  message: string;
}

/** Public-safe form field (no pricing semantics exposed). */
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
 * Public-safe generic add-on (Slice V2-E3-2). MIRRORS the Edge Function's
 * `PublicAddon` — the customer-facing input definition sourced ONLY from
 * `calculator_addons`. It intentionally carries NO pricing effect channels
 * (effect time/fixed/percent) and no internal admin `name`; the server stays
 * authoritative for pricing. The client needs just enough to RENDER the input
 * and (in a later slice) submit a selection under `answers.addonSelections`.
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
   * GPM-5c-2 — the service's LITERAL stored generic pricing model, mirrored from the
   * server's additive GPM-5c-1 config field (one of the generic models, e.g.
   * `hourly_by_area` / `sqm_fixed`), or null for a legacy/service-named model. Defaults
   * to null when an older deploy omits it. NEVER alias-resolved client-side, so a legacy
   * `move_out_fixed_plus_addons` service reports null here (not generic `sqm_fixed`).
   */
  genericPricingModel: string | null;
  /**
   * GPM-5c-2 — whether the PUBLIC RUNTIME can price this generic model TODAY, mirrored
   * from the server flag (true today ONLY for literal `sqm_fixed`). Defaults to false and
   * is additionally refused unless a `genericPricingModel` is present, so a missing or
   * mistyped payload can never FABRICATE an engine-supported service. Additive metadata
   * only — it does NOT drive calculate/submit (the server stays authoritative for routing).
   */
  engineSupported: boolean;
  /**
   * GPM-5c-2 — the canonical primary input the generic model needs ("sqm"), or null when
   * there is no canonical primary input (reserved models / legacy services). Defaults to null.
   */
  primaryInput: "sqm" | null;
  /**
   * GPM-5c-2 — the customer-facing unit label for {@link primaryInput} ("m²"), or null when
   * there is no canonical primary input. Purely presentational metadata. Defaults to null.
   */
  unitLabel: string | null;
  requiresCleaningPlan: boolean;
  plansEnabled: boolean;
  planPricingModel:
    | "hourly_rate_by_plan"
    | "price_adjustment_per_plan"
    | "time_adjustment_per_visit"
    | "hourly_rate_plus_time_adjustment";
  defaultPlanKey: string | null;
  baseHourlyRateExclVat: number | null;
  defaultVatRatePercent: number;
  sortOrder: number;
  questions: PublicQuestion[];
  /**
   * Generic add-ons (Slice V2-E3-2): the service's active + public_visible
   * add-ons, parsed defensively from the additive `addons` config field. Always
   * an array — empty when the service has none (or an older deploy omits it).
   * Only `boolean` / `quantity` inputs survive parsing; rendering lands later.
   */
  addons: PublicAddon[];
}

/** Public-safe cleaning plan (hourlyRate IS exposed for client preview). */
export interface PublicCleaningPlan {
  id: string;
  planKey: string;
  name: string;
  description: string | null;
  serviceKey: string;
  hourlyRate: number;
  vatRatePercent: number;
  priceAdjustmentType: "fixed_amount" | "percent";
  priceAdjustmentValue: number;
  rutEligible: boolean;
  rutEnabled: boolean;
  rutPercent: number;
  rutApplyTo: "total_customer_price" | "labor_service_price_only";
  showRutBreakdown: boolean;
  flexibilityLevel: string | null;
  customerDayTimeControl: string | null;
  sameStaffPreferenceLevel: string | null;
  bookingPriority: string | null;
  cancellationTermsSummary: string | null;
  isDefault: boolean;
  sortOrder: number;
}

/** Public-safe subset of the calculator behaviour flags. */
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

/** The public price-calculation response (calculate action). */
export interface PublicCalculateResponse {
  ok: true;
  enabled: boolean;
  valid: boolean;
  issues: PriceIssue[];
  serviceKey: string;
  pricingModel: string | null;
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
}

/** The browser-side calculate request (the slug is supplied separately). */
export interface PublicCalculateRequest {
  serviceKey: string;
  answers: CalculatorAnswers;
  /** Required only when the selected service needs a cleaning plan. */
  cleaningPlanKey?: string | null;
  /**
   * Generic add-on selections (Slice GPM-10-C). Merged into the wire `answers`
   * under `answers.addonSelections` by the transport; omitted entirely when absent
   * or empty so a service without add-ons sends the exact established payload.
   */
  addonSelections?: AddonSelections | null;
}

// ── Submit DTOs (mirror of the Edge Function's submit request/response) ───────

/** Contact details captured with a submission. Email is REQUIRED; the rest optional. */
export interface PublicSubmitContact {
  name?: string | null;
  email: string;
  phone?: string | null;
  postalCode?: string | null;
}

/** The browser-side submit request (the slug is supplied separately). */
export interface PublicSubmitRequest {
  serviceKey: string;
  answers: CalculatorAnswers;
  /** Sent only when the selected service needs a cleaning plan. */
  cleaningPlanKey?: string | null;
  contact: PublicSubmitContact;
  /**
   * Generic add-on selections (Slice GPM-10-C). Merged into the wire `answers`
   * under `answers.addonSelections` exactly as on the calculate path, so the
   * server recomputes the SAME add-on effects it priced. Omitted when absent/empty.
   */
  addonSelections?: AddonSelections | null;
  /** The public page URL the submission originated from (best-effort). */
  sourceUrl?: string | null;
  /**
   * Hidden honeypot value. A real person leaves this empty, so it is OMITTED from
   * the wire payload unless non-empty (keeping a normal submission's body
   * unchanged). Only a bot that fills every field populates it.
   */
  honeypot?: string | null;
}

/** Customer-facing "what happens next" copy echoed back on a successful submit. */
export interface PublicSubmitNextStep {
  confirmationText: string;
  showLoginPrompt: boolean;
  loginPromptText: string | null;
}

/**
 * The public submit response. A consistent superset of the calculate response
 * that additionally carries the quote LEGACY id (never a uuid), status, validity
 * and next-step copy. Intentionally OMITS prospect/quote uuids, rule values and
 * the internal calculation trace — only public-safe data crosses the wire.
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
  pricingModel: string | null;
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

/** Result of loading config: a found+ok config, an explicit not-found, or an error. */
export type PublicCalculatorConfigResult =
  | { status: "ok"; config: PublicConfigResponse }
  | { status: "not_found" }
  | { status: "error"; message: string };

/** Options carried by a {@link PublicCalculatorError} (e.g. a rate-limit hit). */
export interface PublicCalculatorErrorOptions {
  /** True when the server returned HTTP 429 (the request was rate-limited). */
  rateLimited?: boolean;
  /** Seconds to wait before retrying, when the server supplied one. */
  retryAfterSeconds?: number | null;
}

/** Error thrown by the calculate/submit paths so React Query can surface an error state. */
export class PublicCalculatorError extends Error {
  /** True when this error represents a rate-limit (HTTP 429) response. */
  readonly rateLimited: boolean;
  /** Seconds to wait before retrying (from the server), or null when unknown. */
  readonly retryAfterSeconds: number | null;

  constructor(message: string, options: PublicCalculatorErrorOptions = {}) {
    super(message);
    this.name = "PublicCalculatorError";
    this.rateLimited = options.rateLimited ?? false;
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
  }
}

// ── Editable page copy parsing (settings.content) ─────────────────────────────

export interface CalculatorBackLink {
  label: string;
  href: string;
}

export interface CalculatorContactHelp {
  heading: string | null;
  text: string | null;
  email: string | null;
  phone: string | null;
}

export interface CalculatorCtaLabels {
  start: string | null;
  next: string | null;
  back: string | null;
  getPrice: string | null;
  submitQuote: string | null;
}

/** Strongly-typed view of the editable page copy stored in settings.content. */
export interface CalculatorContent {
  pageTitle: string | null;
  pageSubtitle: string | null;
  introText: string | null;
  resultPanelText: string | null;
  loginPromptText: string | null;
  backToWebsite: CalculatorBackLink | null;
  contactHelp: CalculatorContactHelp | null;
  ctaLabels: CalculatorCtaLabels;
}

/** One FAQ entry (the server returns `{ q, a }` objects). */
export interface CalculatorFaqItem {
  question: string;
  answer: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Reads a trimmed non-empty string from an object, else null. */
function str(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

/** Defensively maps the loosely-typed `content` jsonb into {@link CalculatorContent}. */
export function parseCalculatorContent(content: Record<string, unknown> | null | undefined): CalculatorContent {
  const c = asRecord(content);
  const back = asRecord(c.backToWebsite);
  const help = asRecord(c.contactHelp);
  const cta = asRecord(c.ctaLabels);

  const backLabel = str(back, "label");
  const backHref = str(back, "href");

  return {
    pageTitle: str(c, "pageTitle"),
    pageSubtitle: str(c, "pageSubtitle"),
    introText: str(c, "introText"),
    resultPanelText: str(c, "resultPanelText"),
    loginPromptText: str(c, "loginPromptText"),
    backToWebsite: backHref ? { label: backLabel ?? "Tillbaka", href: backHref } : null,
    contactHelp: {
      heading: str(help, "heading"),
      text: str(help, "text"),
      email: str(help, "email"),
      phone: str(help, "phone"),
    },
    ctaLabels: {
      start: str(cta, "start"),
      next: str(cta, "next"),
      back: str(cta, "back"),
      getPrice: str(cta, "getPrice"),
      submitQuote: str(cta, "submitQuote"),
    },
  };
}

/** Maps the server's FAQ array (`{ q, a }`) into a clean, render-ready list. */
export function parseCalculatorFaq(faq: unknown[] | undefined): CalculatorFaqItem[] {
  if (!Array.isArray(faq)) return [];
  const items: CalculatorFaqItem[] = [];
  for (const raw of faq) {
    const obj = asRecord(raw);
    const question = str(obj, "q") ?? str(obj, "question");
    const answer = str(obj, "a") ?? str(obj, "answer");
    if (question && answer) items.push({ question, answer });
  }
  return items;
}

// ── Runtime response validation + normalization ───────────────────────────────
//
// The Edge Function is the trusted boundary, but the browser must NEVER assume a
// well-formed payload: a stale deploy, a partial 200, or a future internal field
// could otherwise crash the page or leak an unexpected key into the UI. Every
// response is parsed through these tolerant schemas which:
//   1. DROP unknown keys — so internal-only data (pricing-rule values, margins,
//      manual-review thresholds, the calculation `steps[]` trace, CRM fields)
//      can never reach the client even if a future bug returned them;
//   2. COERCE missing/mistyped fields to safe defaults (graceful, never throws);
//   3. FILTER individual malformed array items — one bad service/plan/question
//      never nukes the whole config.

const priceDisplayModeSchema = z
  .enum(["exact", "range", "hidden_until_submit"])
  .catch("range");

/** Safe defaults used when `settings` is missing or not an object at all. */
export const DEFAULT_PUBLIC_SETTINGS: PublicSettings = {
  publicSlug: null,
  priceDisplayMode: "range",
  currency: "SEK",
  showPriceBeforeContact: true,
  requireContactBeforeResult: false,
  showLoginPromptAfterSubmit: false,
  rutDisplayMode: "none",
  defaultVatRatePercent: 25,
  quoteValidityDays: 30,
};

const settingsSchema = z
  .object({
    publicSlug: z.string().nullable().catch(null),
    priceDisplayMode: priceDisplayModeSchema,
    currency: z.string().min(1).catch("SEK"),
    showPriceBeforeContact: z.boolean().catch(true),
    requireContactBeforeResult: z.boolean().catch(false),
    showLoginPromptAfterSubmit: z.boolean().catch(false),
    rutDisplayMode: z.string().catch("none"),
    defaultVatRatePercent: z.number().catch(25),
    quoteValidityDays: z.number().catch(30),
  })
  .catch(DEFAULT_PUBLIC_SETTINGS);

const questionSchema = z.object({
  questionKey: z.string().min(1),
  label: z.string().catch(""),
  helpText: z.string().nullable().catch(null),
  inputType: z.string().catch("text"),
  required: z.boolean().catch(false),
  options: z.unknown(),
  validation: z.unknown(),
  sortOrder: z.number().catch(0),
});

/**
 * Public add-on parse contract (Slice V2-E3-2). `addonKey` is required (a row
 * without one is dropped) and `inputType` is restricted to the two supported
 * kinds — anything else (e.g. a legacy `single_select`) FAILS the parse so the
 * add-on is dropped rather than rendered as an input the client can't handle.
 * The object schema STRIPS unknown keys, so a stale/buggy deploy can never leak
 * a pricing effect channel (time/fixed/percent) or the internal name into the
 * public DTO. Numeric fields coerce non-finite/mistyped values to safe defaults.
 */
const addonSchema = z.object({
  addonKey: z.string().min(1),
  publicLabel: z.string().catch(""),
  description: z.string().nullable().catch(null),
  inputType: z.enum(["boolean", "quantity"]),
  booleanDefault: z.boolean().catch(false),
  quantityMin: z.number().finite().catch(0),
  quantityMax: z.number().finite().nullable().catch(null),
  quantityStep: z.number().finite().catch(1),
  quantityDefault: z.number().finite().catch(0),
  required: z.boolean().catch(false),
  sortOrder: z.number().finite().catch(0),
});

/** Service identity/flags WITHOUT questions (questions are filtered separately). */
const serviceBaseSchema = z.object({
  serviceKey: z.string().min(1),
  displayName: z.string().catch(""),
  description: z.string().nullable().catch(null),
  enabled: z.boolean().catch(false),
  comingSoon: z.boolean().catch(false),
  pricingModel: z.string().catch(""),
  requiresCleaningPlan: z.boolean().catch(false),
  plansEnabled: z.boolean().catch(false),
  planPricingModel: z
    .enum([
      "hourly_rate_by_plan",
      "price_adjustment_per_plan",
      "time_adjustment_per_visit",
      "hourly_rate_plus_time_adjustment",
    ])
    .catch("hourly_rate_by_plan"),
  defaultPlanKey: z.string().nullable().catch(null),
  baseHourlyRateExclVat: z.number().nullable().catch(null),
  defaultVatRatePercent: z.number().catch(25),
  sortOrder: z.number().catch(0),
});

const planSchema = z.object({
  id: z.string().catch(""),
  planKey: z.string().min(1),
  name: z.string().catch(""),
  description: z.string().nullable().catch(null),
  serviceKey: z.string().catch("home_cleaning"),
  hourlyRate: z.number().catch(0),
  vatRatePercent: z.number().catch(25),
  priceAdjustmentType: z.enum(["fixed_amount", "percent"]).catch("fixed_amount"),
  priceAdjustmentValue: z.number().catch(0),
  rutEligible: z.boolean().catch(false),
  rutEnabled: z.boolean().catch(false),
  rutPercent: z.number().catch(50),
  rutApplyTo: z.enum(["total_customer_price", "labor_service_price_only"]).catch("total_customer_price"),
  showRutBreakdown: z.boolean().catch(false),
  flexibilityLevel: z.string().nullable().catch(null),
  customerDayTimeControl: z.string().nullable().catch(null),
  sameStaffPreferenceLevel: z.string().nullable().catch(null),
  bookingPriority: z.string().nullable().catch(null),
  cancellationTermsSummary: z.string().nullable().catch(null),
  isDefault: z.boolean().catch(false),
  sortOrder: z.number().catch(0),
});

const issueSchema = z.object({
  code: z.string().catch("unknown"),
  field: z.string().optional(),
  message: z.string().catch(""),
});

const selectedPlanSchema = z.object({
  planKey: z.string().catch(""),
  name: z.string().catch(""),
  hourlyRate: z.number().catch(0),
  vatRatePercent: z.number().catch(25),
  rutEnabled: z.boolean().catch(false),
  rutPercent: z.number().catch(50),
  showRutBreakdown: z.boolean().catch(false),
});

const nextStepSchema = z.object({
  confirmationText: z.string().catch(""),
  showLoginPrompt: z.boolean().catch(false),
  loginPromptText: z.string().nullable().catch(null),
});

/** Finite number or null (NaN/Infinity/strings all collapse to null). */
function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** A string value, or the fallback when missing/mistyped. */
function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

/** Reads a non-empty server error string, else the supplied fallback. */
function readErrorMessage(payload: Record<string, unknown> | null, fallback: string): string {
  return typeof payload?.error === "string" && payload.error.trim() !== "" ? payload.error : fallback;
}

/** Reads the server's friendly rate-limit `message`, else the Swedish fallback. */
function readRateLimitMessage(payload: Record<string, unknown> | null): string {
  return typeof payload?.message === "string" && payload.message.trim() !== ""
    ? payload.message
    : RATE_LIMITED_MESSAGE;
}

/** Reads a non-negative `retryAfterSeconds` from a 429 body, else null. */
function readRetryAfterSeconds(payload: Record<string, unknown> | null): number | null {
  const raw = payload?.retryAfterSeconds;
  return typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : null;
}

function normalizeQuestion(raw: unknown): PublicQuestion | null {
  const parsed = questionSchema.safeParse(raw);
  return parsed.success ? (parsed.data as PublicQuestion) : null;
}

/**
 * Parses one public add-on, returning null when it is malformed (no `addonKey`)
 * or carries an unsupported `inputType` (the caller filters nulls). Unknown keys
 * are stripped, so pricing internals can never survive into the public DTO.
 */
function normalizeAddon(raw: unknown): PublicAddon | null {
  const parsed = addonSchema.safeParse(raw);
  return parsed.success ? (parsed.data as PublicAddon) : null;
}

/**
 * The additive generic-service metadata fields (GPM-5c-2) mirrored from the
 * server's GPM-5c-1 additions to PublicService. Grouped so the parse + safe
 * defaults live in one tested place.
 */
export interface PublicGenericServiceMetadata {
  genericPricingModel: string | null;
  engineSupported: boolean;
  primaryInput: "sqm" | null;
  unitLabel: string | null;
}

/** Safe defaults applied when a config payload omits the GPM-5c-1 generic metadata entirely. */
export const DEFAULT_GENERIC_SERVICE_METADATA: PublicGenericServiceMetadata = {
  genericPricingModel: null,
  engineSupported: false,
  primaryInput: null,
  unitLabel: null,
};

/**
 * Defensively parses the additive GPM-5c-1 generic metadata off a raw service.
 * Every field independently coerces to its safe default, so an older deploy that
 * OMITS them — or a stale/buggy payload that MISTYPES them — can never crash the
 * page or surface an unexpected value:
 *   • genericPricingModel — a non-empty string is kept verbatim (the LITERAL model
 *     the server reported); anything else → null. Never re-derived client-side.
 *   • engineSupported — survives as true ONLY when it is a real boolean `true` AND a
 *     genericPricingModel is present. A mistyped ("true"/1) or ORPHANED `true` (no
 *     model) collapses to false, so the client can never FABRICATE an
 *     engine-supported service. The supported set is the server's call (it may
 *     widen in a later slice), so this deliberately never hardcodes a model name.
 *   • primaryInput — only the literal "sqm" survives; anything else → null.
 *   • unitLabel — a non-empty string is kept; anything else → null.
 */
function normalizeGenericServiceMetadata(raw: Record<string, unknown>): PublicGenericServiceMetadata {
  const genericPricingModel =
    typeof raw.genericPricingModel === "string" && raw.genericPricingModel.trim() !== ""
      ? raw.genericPricingModel
      : null;
  const primaryInput: "sqm" | null = raw.primaryInput === "sqm" ? "sqm" : null;
  const unitLabel =
    typeof raw.unitLabel === "string" && raw.unitLabel.trim() !== "" ? raw.unitLabel : null;
  const engineSupported = raw.engineSupported === true && genericPricingModel !== null;
  return { genericPricingModel, engineSupported, primaryInput, unitLabel };
}

function normalizeService(raw: unknown): PublicService | null {
  const parsed = serviceBaseSchema.safeParse(raw);
  if (!parsed.success) return null;
  const record = asRecord(raw);
  const questionsRaw = record.questions;
  const questions = Array.isArray(questionsRaw)
    ? questionsRaw.map(normalizeQuestion).filter((q): q is PublicQuestion => q !== null)
    : [];
  const addonsRaw = record.addons;
  const addons = Array.isArray(addonsRaw)
    ? addonsRaw.map(normalizeAddon).filter((a): a is PublicAddon => a !== null)
    : [];
  const generic = normalizeGenericServiceMetadata(record);
  // `serviceBaseSchema` guarantees `serviceKey` (`.min(1)` fails the parse above
  // otherwise) and `.catch(...)` supplies every remaining field, so the spread is a
  // complete `PublicService` at runtime. The cast only bridges zod's non-strict-mode
  // inference, which marks every property optional — matching the sibling
  // `normalizePlan` below. No values are changed.
  return { ...parsed.data, ...generic, questions, addons } as PublicService;
}

function normalizePlan(raw: unknown): PublicCleaningPlan | null {
  const parsed = planSchema.safeParse(raw);
  return parsed.success ? (parsed.data as PublicCleaningPlan) : null;
}

function normalizeCompany(raw: unknown): { name: string } | null {
  const r = asRecord(raw);
  return typeof r.name === "string" && r.name.trim() !== "" ? { name: r.name } : null;
}

/**
 * Validates + normalizes a raw `config` payload into a clean {@link PublicConfigResponse}.
 * Returns null ONLY when the payload is fundamentally unusable (`ok !== true`),
 * which the caller maps to an error state. A partial-but-ok payload yields a
 * defaulted config so the page can still render (e.g. a calm coming-soon state).
 */
export function normalizePublicConfigResponse(raw: unknown): PublicConfigResponse | null {
  const r = asRecord(raw);
  if (r.ok !== true) return null;

  const services = Array.isArray(r.services)
    ? r.services.map(normalizeService).filter((s): s is PublicService => s !== null)
    : [];
  const cleaningPlans = Array.isArray(r.cleaningPlans)
    ? r.cleaningPlans.map(normalizePlan).filter((p): p is PublicCleaningPlan => p !== null)
    : [];

  return {
    ok: true,
    enabled: typeof r.enabled === "boolean" ? r.enabled : false,
    company: normalizeCompany(r.company),
    settings: settingsSchema.parse(r.settings) as PublicSettings,
    content: asRecord(r.content),
    services,
    cleaningPlans,
    faq: Array.isArray(r.faq) ? r.faq : [],
  };
}

/**
 * Validates + normalizes a raw `calculate` payload into a clean
 * {@link PublicCalculateResponse}. Returns null when the payload is unusable
 * (`ok !== true` or no boolean `valid`), which the caller turns into a thrown
 * error so React Query surfaces the friendly error state.
 */
export function normalizePublicCalculateResponse(raw: unknown): PublicCalculateResponse | null {
  const r = asRecord(raw);
  if (r.ok !== true) return null;
  if (typeof r.valid !== "boolean") return null;

  const issues: PriceIssue[] = [];
  if (Array.isArray(r.issues)) {
    for (const item of r.issues) {
      const parsed = issueSchema.safeParse(item);
      if (parsed.success) {
        // `issueSchema` applies `.catch(...)` to `code`/`message`, so both are always
        // present strings at runtime; zod's non-strict-mode inference just types them
        // optional. Re-map with the SAME catch defaults to preserve behavior exactly.
        issues.push({
          code: parsed.data.code ?? "unknown",
          message: parsed.data.message ?? "",
          ...(typeof parsed.data.field === "string" ? { field: parsed.data.field } : {}),
        });
      }
    }
  }

  const planParsed = selectedPlanSchema.safeParse(r.selectedPlan);

  return {
    ok: true,
    enabled: typeof r.enabled === "boolean" ? r.enabled : true,
    valid: r.valid,
    issues,
    serviceKey: stringOr(r.serviceKey, ""),
    pricingModel: typeof r.pricingModel === "string" ? r.pricingModel : null,
    formulaVersion: stringOr(r.formulaVersion, "unknown"),
    currency: stringOr(r.currency, "SEK"),
    priceDisplayMode: priceDisplayModeSchema.parse(r.priceDisplayMode),
    estimatedHours: numberOrNull(r.estimatedHours),
    calculatedPrice: numberOrNull(r.calculatedPrice),
    minPrice: numberOrNull(r.minPrice),
    maxPrice: numberOrNull(r.maxPrice),
    priceExclVat: numberOrNull(r.priceExclVat),
    vatRatePercent: numberOrNull(r.vatRatePercent) ?? 0,
    vatAmount: numberOrNull(r.vatAmount),
    priceInclVat: numberOrNull(r.priceInclVat),
    rutEnabled: typeof r.rutEnabled === "boolean" ? r.rutEnabled : false,
    rutPercent: numberOrNull(r.rutPercent) ?? 50,
    showRutBreakdown: typeof r.showRutBreakdown === "boolean" ? r.showRutBreakdown : false,
    rutDeduction: numberOrNull(r.rutDeduction),
    priceAfterRut: numberOrNull(r.priceAfterRut),
    roundingIncrement: numberOrNull(r.roundingIncrement),
    displayText: stringOr(r.displayText, ""),
    selectedPlan: r.selectedPlan != null && planParsed.success ? (planParsed.data as PublicSelectedPlan) : null,
  };
}

/**
 * Validates + normalizes a raw `submit` payload into a clean
 * {@link PublicSubmitResponse}. Returns null when the payload is unusable
 * (`ok !== true`), which the caller turns into a thrown error so the mutation
 * surfaces a friendly failure. Constructed field-by-field, so internal-only keys
 * (rule values, margins, uuids, the calculation trace, CRM fields) can NEVER
 * reach the client even if a future bug returned them.
 */
export function normalizePublicSubmitResponse(raw: unknown): PublicSubmitResponse | null {
  const r = asRecord(raw);
  if (r.ok !== true) return null;

  const issues: PriceIssue[] = [];
  if (Array.isArray(r.issues)) {
    for (const item of r.issues) {
      const parsed = issueSchema.safeParse(item);
      if (parsed.success) {
        // `issueSchema` applies `.catch(...)` to `code`/`message`, so both are always
        // present strings at runtime; zod's non-strict-mode inference just types them
        // optional. Re-map with the SAME catch defaults to preserve behavior exactly.
        issues.push({
          code: parsed.data.code ?? "unknown",
          message: parsed.data.message ?? "",
          ...(typeof parsed.data.field === "string" ? { field: parsed.data.field } : {}),
        });
      }
    }
  }

  const planParsed = selectedPlanSchema.safeParse(r.selectedPlan);
  const nextParsed = nextStepSchema.safeParse(r.nextStep);

  return {
    ok: true,
    enabled: typeof r.enabled === "boolean" ? r.enabled : false,
    available: typeof r.available === "boolean" ? r.available : false,
    status: typeof r.status === "string" ? r.status : null,
    valid: typeof r.valid === "boolean" ? r.valid : false,
    issues,
    serviceKey: typeof r.serviceKey === "string" ? r.serviceKey : null,
    pricingModel: typeof r.pricingModel === "string" ? r.pricingModel : null,
    formulaVersion: typeof r.formulaVersion === "string" ? r.formulaVersion : null,
    currency: typeof r.currency === "string" ? r.currency : null,
    priceDisplayMode:
      typeof r.priceDisplayMode === "string" ? priceDisplayModeSchema.parse(r.priceDisplayMode) : null,
    estimatedHours: numberOrNull(r.estimatedHours),
    calculatedPrice: numberOrNull(r.calculatedPrice),
    minPrice: numberOrNull(r.minPrice),
    maxPrice: numberOrNull(r.maxPrice),
    priceExclVat: numberOrNull(r.priceExclVat),
    vatRatePercent: numberOrNull(r.vatRatePercent) ?? 0,
    vatAmount: numberOrNull(r.vatAmount),
    priceInclVat: numberOrNull(r.priceInclVat),
    rutEnabled: typeof r.rutEnabled === "boolean" ? r.rutEnabled : false,
    rutPercent: numberOrNull(r.rutPercent) ?? 50,
    showRutBreakdown: typeof r.showRutBreakdown === "boolean" ? r.showRutBreakdown : false,
    rutDeduction: numberOrNull(r.rutDeduction),
    priceAfterRut: numberOrNull(r.priceAfterRut),
    roundingIncrement: numberOrNull(r.roundingIncrement),
    displayText: stringOr(r.displayText, ""),
    selectedPlan: r.selectedPlan != null && planParsed.success ? (planParsed.data as PublicSelectedPlan) : null,
    quoteRequestLegacyId: typeof r.quoteRequestLegacyId === "string" ? r.quoteRequestLegacyId : null,
    reference: typeof r.reference === "string" ? r.reference : null,
    validUntil: typeof r.validUntil === "string" ? r.validUntil : null,
    requiresManualReview: typeof r.requiresManualReview === "boolean" ? r.requiresManualReview : false,
    nextStep: r.nextStep != null && nextParsed.success ? (nextParsed.data as PublicSubmitNextStep) : null,
  };
}

// ── Result view derivation (pure; drives the result panel) ────────────────────

/** The discriminated state the result panel renders. */
export type ResultStatus = "idle" | "updating" | "error" | "valid" | "invalid";

/** A render-ready view of the current calculation for the result panel. */
export interface CalculatorResultView {
  status: ResultStatus;
  displayText: string;
  estimatedHours: number | null;
  planName: string | null;
  planRate: number | null;
  /** Customer-facing price range endpoints (incl. VAT, after RUT when enabled). */
  minPrice: number | null;
  maxPrice: number | null;
  /** Configured price rounding interval (kr), or null when no rounding is set. */
  roundingIncrement: number | null;
  priceExclVat: number | null;
  vatRatePercent: number;
  vatAmount: number | null;
  priceInclVat: number | null;
  rutEnabled: boolean;
  rutPercent: number;
  showRutBreakdown: boolean;
  rutDeduction: number | null;
  priceAfterRut: number | null;
  issues: string[];
}

/** Inputs to {@link resolveResultView}. */
export interface ResolveResultViewParams {
  /** Inputs are sufficient to price (service chosen, drivers present, plan when required). */
  isReady: boolean;
  /** A calculate request is currently in flight. */
  isFetching: boolean;
  /** The last calculate request failed (transport/shape). */
  isError: boolean;
  /**
   * The live (pre-debounce) request equals the request that produced `calc`.
   * When false the on-screen inputs have moved ahead of the latest result, so a
   * stale figure must never be presented as final.
   */
  inputsSettled: boolean;
  /** The latest calculate response for the settled request (may be a previous one). */
  calc: PublicCalculateResponse | null | undefined;
}

/**
 * Derives the result-panel status from the query + input state. This is the
 * single guard that stops an older debounced / in-flight calculation from being
 * shown as the FINAL price after the inputs have changed: whenever a fetch is in
 * flight OR the inputs have moved ahead of the latest result (`!inputsSettled`),
 * the status is `updating` (never `valid`/`invalid`). Previous valid figures are
 * still carried so the panel can dim them instead of flickering to empty. Pure +
 * deterministic, so the stale-handling contract is unit-testable without timers.
 */
export function resolveResultView(params: ResolveResultViewParams): CalculatorResultView {
  const { isReady, isFetching, isError, inputsSettled, calc } = params;
  const empty = {
    displayText: "",
    estimatedHours: null,
    planName: null,
    planRate: null,
    minPrice: null,
    maxPrice: null,
    roundingIncrement: null,
    priceExclVat: null,
    vatRatePercent: 0,
    vatAmount: null,
    priceInclVat: null,
    rutEnabled: false,
    rutPercent: 50,
    showRutBreakdown: false,
    rutDeduction: null,
    priceAfterRut: null,
    issues: [] as string[],
  };

  if (!isReady) return { status: "idle", ...empty };
  if (isError) return { status: "error", ...empty };

  const validCalc = calc && calc.valid === true ? calc : null;
  const figures = {
    displayText: stringOr(validCalc?.displayText, ""),
    estimatedHours: numberOrNull(validCalc?.estimatedHours),
    planName: validCalc?.selectedPlan?.name ?? null,
    planRate: numberOrNull(validCalc?.selectedPlan?.hourlyRate),
    minPrice: numberOrNull(validCalc?.minPrice),
    maxPrice: numberOrNull(validCalc?.maxPrice),
    roundingIncrement: numberOrNull(validCalc?.roundingIncrement),
    priceExclVat: numberOrNull(validCalc?.priceExclVat),
    vatRatePercent: numberOrNull(validCalc?.vatRatePercent) ?? 0,
    vatAmount: numberOrNull(validCalc?.vatAmount),
    priceInclVat: numberOrNull(validCalc?.priceInclVat),
    rutEnabled: validCalc?.rutEnabled === true,
    rutPercent: numberOrNull(validCalc?.rutPercent) ?? 50,
    showRutBreakdown: validCalc?.showRutBreakdown === true,
    rutDeduction: numberOrNull(validCalc?.rutDeduction),
    priceAfterRut: numberOrNull(validCalc?.priceAfterRut),
    issues: [] as string[],
  };

  if (isFetching || !inputsSettled) return { status: "updating", ...figures };
  if (validCalc) return { status: "valid", ...figures };
  if (calc && calc.valid === false) {
    const issues = (Array.isArray(calc.issues) ? calc.issues : [])
      .map((i) => (i && typeof i.message === "string" ? i.message : ""))
      .filter((m) => m.trim() !== "");
    return { status: "invalid", ...empty, issues };
  }
  return { status: "updating", ...figures };
}

// ── Transport ─────────────────────────────────────────────────────────────────

/** Reads the Supabase env lazily so it is overridable in tests. */
function readEnv(): { supabaseUrl: string | undefined; anonKey: string | undefined } {
  return {
    supabaseUrl: import.meta.env.EXPO_PUBLIC_SUPABASE_URL as string | undefined,
    anonKey: import.meta.env.EXPO_PUBLIC_SUPABASE_ANON_KEY as string | undefined,
  };
}

/** True when the Supabase env needed to reach the Edge Function is present. */
export function isPublicCalculatorConfigured(): boolean {
  const { supabaseUrl, anonKey } = readEnv();
  return Boolean(supabaseUrl && anonKey);
}

/** RFC-pragmatic email shape guard (mirrors the Edge Function's server-side check). */
const PUBLIC_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Lightweight client-side email check used to BLOCK an obviously-invalid submit
 * before any network call. The server re-validates authoritatively; this only
 * improves UX (the trusted boundary is always the Edge Function).
 */
export function isLikelyEmail(value: string): boolean {
  const v = value.trim();
  return v.length > 0 && v.length <= 320 && PUBLIC_EMAIL_RE.test(v);
}

interface RawResponse {
  httpStatus: number;
  payload: Record<string, unknown> | null;
}

/**
 * Merges generic add-on selections into the wire `answers` under the established
 * `answers.addonSelections` key the V2 runtime reads (`coerceAddonSelections`).
 * With no selections it returns a plain copy of `answers`, so a service WITHOUT
 * add-ons sends the exact established payload and the server's flat answer
 * coercion is unaffected.
 */
function answersWithAddonSelections(
  answers: CalculatorAnswers,
  addonSelections: AddonSelections | null | undefined,
): Record<string, unknown> {
  if (!addonSelections || Object.keys(addonSelections).length === 0) {
    return { ...answers };
  }
  return { ...answers, addonSelections };
}

/**
 * POSTs an action to the public-calculator Edge Function. The anon key is sent
 * as both `apikey` and the bearer (the Supabase gateway requires a key to route,
 * even though the function runs with verify_jwt=false). No session is needed —
 * this is the anonymous public path.
 */
async function postAction(body: Record<string, unknown>): Promise<RawResponse> {
  const { supabaseUrl, anonKey } = readEnv();
  if (!supabaseUrl || !anonKey) {
    throw new PublicCalculatorError("Priskalkylatorn är inte konfigurerad.");
  }

  const url = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/${PUBLIC_CALCULATOR_FUNCTION}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    },
    body: JSON.stringify(body),
  });

  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  return { httpStatus: response.status, payload };
}

/**
 * Loads the public-safe calculator config for a slug (config action). Resolves to
 * an explicit `not_found` for an unknown slug (HTTP 404), `ok` with the config
 * otherwise, or `error` on any transport/shape failure. Never throws.
 */
export async function fetchPublicCalculatorConfig(slug: string): Promise<PublicCalculatorConfigResult> {
  try {
    const { httpStatus, payload } = await postAction({ action: "config", slug });

    if (httpStatus === 404) return { status: "not_found" };

    const config = normalizePublicConfigResponse(payload);
    if (!config) {
      return { status: "error", message: readErrorMessage(payload, "Kunde inte ladda priskalkylatorn.") };
    }
    return { status: "ok", config };
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : "Kunde inte ladda priskalkylatorn.",
    };
  }
}

/**
 * Requests a server-authoritative price (calculate action). The server recomputes
 * from its own rules and never trusts any client-side figure. Throws a
 * {@link PublicCalculatorError} on transport/shape failure so React Query exposes
 * an error state; a `valid:false` engine result is returned (not thrown) so the UI
 * can render the validation issues.
 */
export async function requestPublicCalculation(
  slug: string,
  request: PublicCalculateRequest,
): Promise<PublicCalculateResponse> {
  const { httpStatus, payload } = await postAction({
    action: "calculate",
    slug,
    serviceKey: request.serviceKey,
    answers: answersWithAddonSelections(request.answers, request.addonSelections),
    ...(request.cleaningPlanKey ? { cleaningPlanKey: request.cleaningPlanKey } : {}),
  });

  if (httpStatus === 429) {
    throw new PublicCalculatorError(readRateLimitMessage(payload), {
      rateLimited: true,
      retryAfterSeconds: readRetryAfterSeconds(payload),
    });
  }
  if (httpStatus !== 200) {
    throw new PublicCalculatorError(readErrorMessage(payload, "Kunde inte beräkna priset."));
  }
  const result = normalizePublicCalculateResponse(payload);
  if (!result) {
    throw new PublicCalculatorError(readErrorMessage(payload, "Kunde inte beräkna priset."));
  }
  return result;
}

/**
 * Submits a real quote request (submit action — the WRITE path). The server
 * recomputes the price authoritatively and, ONLY when the calculator is enabled
 * and the recompute is valid, creates the prospect/quote/answers. Throws a
 * {@link PublicCalculatorError} on transport/validation/shape failure so the
 * mutation surfaces a friendly error; a `valid:false` or `available:false`
 * outcome is RETURNED (not thrown) so the page can react without writing.
 *
 * `cleaningPlanKey` is omitted from the wire payload when absent (move-out needs
 * no plan), mirroring the calculate path. The client price is never sent — the
 * server is the single source of truth.
 */
export async function submitPublicQuoteRequest(
  slug: string,
  request: PublicSubmitRequest,
): Promise<PublicSubmitResponse> {
  const honeypot = typeof request.honeypot === "string" ? request.honeypot.trim() : "";
  const { httpStatus, payload } = await postAction({
    action: "submit",
    slug,
    serviceKey: request.serviceKey,
    answers: answersWithAddonSelections(request.answers, request.addonSelections),
    ...(request.cleaningPlanKey ? { cleaningPlanKey: request.cleaningPlanKey } : {}),
    contact: {
      name: request.contact.name ?? null,
      email: request.contact.email,
      phone: request.contact.phone ?? null,
      postalCode: request.contact.postalCode ?? null,
    },
    ...(request.sourceUrl ? { sourceUrl: request.sourceUrl } : {}),
    // Sent ONLY when a bot has filled it; a normal (empty) submit omits it so the
    // wire payload is byte-for-byte the established shape.
    ...(honeypot !== "" ? { [HONEYPOT_FIELD]: honeypot } : {}),
  });

  // Rate-limited (HTTP 429): surface a friendly, retry-aware error so the page
  // shows calm copy instead of a raw failure or technical throttle internals.
  if (httpStatus === 429) {
    throw new PublicCalculatorError(readRateLimitMessage(payload), {
      rateLimited: true,
      retryAfterSeconds: readRetryAfterSeconds(payload),
    });
  }
  if (httpStatus !== 200) {
    throw new PublicCalculatorError(readErrorMessage(payload, "Vi kunde inte skicka din förfrågan."));
  }
  const result = normalizePublicSubmitResponse(payload);
  if (!result) {
    throw new PublicCalculatorError(readErrorMessage(payload, "Vi kunde inte skicka din förfrågan."));
  }
  return result;
}
