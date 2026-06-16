/**
 * Price Calculator — Super Admin QUOTE REQUESTS inbox repository (Slice 7B).
 *
 * Supabase-authoritative, READ-ONLY reads for the locked Super Admin Calculator
 * page's quote-requests inbox. Everything goes through the AUTHENTICATED Supabase
 * client, so the calculator's super_admin-only RLS (migration 0059) gates access —
 * there is no anon path and no localStorage source of truth.
 *
 * SCOPE GUARD (this slice): visibility only. This module performs NO writes — no
 * status updates, no assignment, no conversion, no CRM behaviour. It also NEVER
 * surfaces internal-only data: the mapped views carry the stable LEGACY ids only
 * (never the row uuids) and the snapshot is reduced to a safe admin summary
 * (formula/model/plan/prices) — the raw calculation `steps[]` trace, every
 * `ruleValues` entry, `rawPrice` and the raw `inputs` blob are intentionally
 * dropped and never reach the UI.
 */
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

import { MVP_CALCULATOR_PUBLIC_SLUG } from "./calculatorAdmin";
import type { AnswerValue } from "./publicCalculatorClient";

/** Hard cap on inbox rows fetched in one read (MVP volume is tiny). */
export const MAX_QUOTE_REQUESTS = 100;

/** Columns selected from `quote_requests` (public-safe + snapshot for the summary). */
const QUOTE_REQUEST_COLUMNS =
  "legacy_id, created_at, status, calculator_service_key, " +
  "selected_cleaning_plan_name, selected_cleaning_plan_hourly_rate, " +
  "estimated_hours, calculated_price, min_price, max_price, currency, " +
  "price_display_mode, pricing_model, formula_version, requires_manual_review, " +
  "valid_until, reference, source, source_url, " +
  "customer_name, customer_email, customer_phone, address_json, " +
  "prospect_legacy_id, pricing_snapshot_json";

// ── Row shapes (snake_case, as returned by Supabase) ────────────────────────

interface QuoteRequestRow {
  legacy_id: string;
  created_at: string;
  status: string;
  calculator_service_key: string | null;
  selected_cleaning_plan_name: string | null;
  selected_cleaning_plan_hourly_rate: number | string | null;
  estimated_hours: number | string | null;
  calculated_price: number | string | null;
  min_price: number | string | null;
  max_price: number | string | null;
  currency: string | null;
  price_display_mode: string | null;
  pricing_model: string | null;
  formula_version: string | null;
  requires_manual_review: boolean | null;
  valid_until: string | null;
  reference: string | null;
  source: string | null;
  source_url: string | null;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  address_json: unknown;
  prospect_legacy_id: string | null;
  pricing_snapshot_json: unknown;
}

interface ProspectRow {
  legacy_id: string;
  prospect_status: string | null;
  source: string | null;
  source_url: string | null;
}

interface QuoteRequestAnswerRow {
  quote_request_legacy_id: string | null;
  question_key: string;
  question_label_snapshot: string | null;
  input_type_snapshot: string | null;
  answer_value_json: unknown;
  affects_pricing: boolean | null;
  sort_order: number | null;
}

interface CalculatorServiceLiteRow {
  service_key: string;
  display_name: string;
}

// ── App-facing views (camelCase, public-safe — NO uuids, NO raw trace) ──────

/** One submitted answer snapshot (label/type frozen at submission). */
export interface QuoteRequestAnswerView {
  questionKey: string;
  questionLabel: string | null;
  inputType: string | null;
  value: AnswerValue;
  affectsPricing: boolean;
  sortOrder: number;
}

/** The plan AS SELECTED, taken from the frozen snapshot. */
export interface QuoteRequestSelectedPlan {
  planKey: string | null;
  name: string | null;
  hourlyRate: number | null;
}

/**
 * The SAFE admin summary of the frozen pricing snapshot. Deliberately a small
 * allow-list: the internal `steps[]` trace, `ruleValues`, `rawPrice` and the raw
 * `inputs` blob from `pricing_snapshot_json` are NOT included here, so they can
 * never be rendered.
 */
export interface QuoteRequestSnapshotSummary {
  formulaVersion: string | null;
  pricingModel: string | null;
  selectedPlan: QuoteRequestSelectedPlan | null;
  estimatedHours: number | null;
  calculatedPrice: number | null;
  minPrice: number | null;
  maxPrice: number | null;
}

/** Contact details captured with the request (denormalised on the quote row). */
export interface QuoteRequestContact {
  name: string | null;
  email: string | null;
  phone: string | null;
  postalCode: string | null;
}

/** A single inbox quote request with its linked prospect + answers + summary. */
export interface QuoteRequestView {
  legacyId: string;
  createdAt: string;
  status: string;
  serviceKey: string | null;
  serviceDisplayName: string | null;
  selectedPlanName: string | null;
  selectedPlanHourlyRate: number | null;
  estimatedHours: number | null;
  calculatedPrice: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  currency: string;
  priceDisplayMode: string | null;
  pricingModel: string | null;
  formulaVersion: string | null;
  requiresManualReview: boolean;
  validUntil: string | null;
  reference: string | null;
  source: string | null;
  sourceUrl: string | null;
  prospectLegacyId: string | null;
  prospectStatus: string | null;
  contact: QuoteRequestContact;
  answers: QuoteRequestAnswerView[];
  snapshotSummary: QuoteRequestSnapshotSummary;
}

// ── Pure helpers + mappers (no I/O — unit-tested directly) ──────────────────

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Finite number (tolerating numeric strings), else null. */
function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Reduces a raw `pricing_snapshot_json` to the SAFE admin summary. Reads only the
 * allow-listed keys — `steps`, `ruleValues`, `rawPrice` and `inputs` are never
 * copied out, so the raw internal trace can never reach the UI.
 */
export function extractSnapshotSummary(raw: unknown): QuoteRequestSnapshotSummary {
  const snap = asRecord(raw);
  const planRaw = asRecord(snap.selectedPlanSnapshot);
  const hasPlan = snap.selectedPlanSnapshot != null && typeof snap.selectedPlanSnapshot === "object";

  return {
    formulaVersion: typeof snap.formulaVersion === "string" ? snap.formulaVersion : null,
    pricingModel: typeof snap.pricingModel === "string" ? snap.pricingModel : null,
    selectedPlan: hasPlan
      ? {
          planKey: typeof planRaw.planKey === "string" ? planRaw.planKey : null,
          name: typeof planRaw.name === "string" ? planRaw.name : null,
          hourlyRate: numberOrNull(planRaw.hourlyRate),
        }
      : null,
    estimatedHours: numberOrNull(snap.estimatedHours),
    calculatedPrice: numberOrNull(snap.calculatedPrice),
    minPrice: numberOrNull(snap.minPrice),
    maxPrice: numberOrNull(snap.maxPrice),
  };
}

/** Maps a `quote_request_answers` row to its app-facing view. */
export function mapQuoteRequestAnswerRow(row: QuoteRequestAnswerRow): QuoteRequestAnswerView {
  const valueJson = asRecord(row.answer_value_json);
  return {
    questionKey: row.question_key,
    questionLabel: row.question_label_snapshot ?? null,
    inputType: row.input_type_snapshot ?? null,
    value: (valueJson.value ?? null) as AnswerValue,
    affectsPricing: row.affects_pricing !== false,
    sortOrder: typeof row.sort_order === "number" ? row.sort_order : 0,
  };
}

/** Extra display context resolved from the sibling tables. */
export interface QuoteRequestMapContext {
  serviceDisplayName?: string | null;
  prospectStatus?: string | null;
  answers?: QuoteRequestAnswerView[];
}

/** Maps a `quote_requests` row to its public-safe inbox view (NO uuids, NO raw trace). */
export function mapQuoteRequestRow(
  row: QuoteRequestRow,
  context: QuoteRequestMapContext = {},
): QuoteRequestView {
  const address = asRecord(row.address_json);
  return {
    legacyId: row.legacy_id,
    createdAt: row.created_at,
    status: row.status,
    serviceKey: row.calculator_service_key ?? null,
    serviceDisplayName: context.serviceDisplayName ?? null,
    selectedPlanName: row.selected_cleaning_plan_name ?? null,
    selectedPlanHourlyRate: numberOrNull(row.selected_cleaning_plan_hourly_rate),
    estimatedHours: numberOrNull(row.estimated_hours),
    calculatedPrice: numberOrNull(row.calculated_price),
    minPrice: numberOrNull(row.min_price),
    maxPrice: numberOrNull(row.max_price),
    currency: typeof row.currency === "string" && row.currency !== "" ? row.currency : "SEK",
    priceDisplayMode: row.price_display_mode ?? null,
    pricingModel: row.pricing_model ?? null,
    formulaVersion: row.formula_version ?? null,
    requiresManualReview: row.requires_manual_review === true,
    validUntil: row.valid_until ?? null,
    reference: row.reference ?? null,
    source: row.source ?? null,
    sourceUrl: row.source_url ?? null,
    prospectLegacyId: row.prospect_legacy_id ?? null,
    prospectStatus: context.prospectStatus ?? null,
    contact: {
      name: row.customer_name ?? null,
      email: row.customer_email ?? null,
      phone: row.customer_phone ?? null,
      postalCode: typeof address.postalCode === "string" ? address.postalCode : null,
    },
    answers: context.answers ?? [],
    snapshotSummary: extractSnapshotSummary(row.pricing_snapshot_json),
  };
}

// ── Supabase access (read-only) ─────────────────────────────────────────────

class CalculatorQuoteRequestsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalculatorQuoteRequestsError";
  }
}

function configuredClient() {
  if (!isSupabaseConfigured || !supabase) {
    throw new CalculatorQuoteRequestsError(
      "Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }
  return supabase;
}

/**
 * Loads the Super Admin quote-requests inbox for the MVP company, resolved by the
 * stable public slug (NOT a hard-coded company id). Returns an empty list when no
 * live calculator settings row exists or when no quotes have been submitted yet,
 * so the page can render a calm empty state. READ-ONLY: only `select` is issued.
 */
export async function getCalculatorQuoteRequests(): Promise<QuoteRequestView[]> {
  const client = configuredClient();

  const { data: settingsRow, error: settingsError } = await client
    .from("calculator_settings")
    .select("company_id, company_legacy_id")
    .eq("public_slug", MVP_CALCULATOR_PUBLIC_SLUG)
    .is("deleted_at", null)
    .maybeSingle();

  if (settingsError) {
    throw new CalculatorQuoteRequestsError(`[calculator_settings] read failed: ${settingsError.message}`);
  }
  if (!settingsRow) return [];

  const companyId = (settingsRow as { company_id: string }).company_id;

  const { data: quotesData, error: quotesError } = await client
    .from("quote_requests")
    .select(QUOTE_REQUEST_COLUMNS)
    .eq("company_id", companyId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(MAX_QUOTE_REQUESTS);

  if (quotesError) {
    throw new CalculatorQuoteRequestsError(`[quote_requests] read failed: ${quotesError.message}`);
  }

  const quotes = (quotesData ?? []) as unknown as QuoteRequestRow[];
  if (quotes.length === 0) return [];

  const legacyIds = quotes.map((q) => q.legacy_id);

  const [servicesResult, prospectsResult, answersResult] = await Promise.all([
    client
      .from("calculator_services")
      .select("service_key, display_name")
      .eq("company_id", companyId)
      .is("deleted_at", null),
    client
      .from("prospects")
      .select("legacy_id, prospect_status, source, source_url")
      .eq("company_id", companyId)
      .is("deleted_at", null),
    client
      .from("quote_request_answers")
      .select(
        "quote_request_legacy_id, question_key, question_label_snapshot, input_type_snapshot, answer_value_json, affects_pricing, sort_order",
      )
      .eq("company_id", companyId)
      .in("quote_request_legacy_id", legacyIds),
  ]);

  if (servicesResult.error) {
    throw new CalculatorQuoteRequestsError(`[calculator_services] read failed: ${servicesResult.error.message}`);
  }
  if (prospectsResult.error) {
    throw new CalculatorQuoteRequestsError(`[prospects] read failed: ${prospectsResult.error.message}`);
  }
  if (answersResult.error) {
    throw new CalculatorQuoteRequestsError(`[quote_request_answers] read failed: ${answersResult.error.message}`);
  }

  const serviceNames = new Map<string, string>();
  for (const s of (servicesResult.data ?? []) as CalculatorServiceLiteRow[]) {
    serviceNames.set(s.service_key, s.display_name);
  }

  const prospectStatusByLegacyId = new Map<string, string | null>();
  for (const p of (prospectsResult.data ?? []) as ProspectRow[]) {
    prospectStatusByLegacyId.set(p.legacy_id, p.prospect_status ?? null);
  }

  const answersByQuote = new Map<string, QuoteRequestAnswerView[]>();
  for (const a of (answersResult.data ?? []) as QuoteRequestAnswerRow[]) {
    const key = a.quote_request_legacy_id ?? "";
    if (key === "") continue;
    const view = mapQuoteRequestAnswerRow(a);
    const existing = answersByQuote.get(key);
    if (existing) existing.push(view);
    else answersByQuote.set(key, [view]);
  }
  for (const list of answersByQuote.values()) {
    list.sort((x, y) => x.sortOrder - y.sortOrder);
  }

  return quotes.map((row) =>
    mapQuoteRequestRow(row, {
      serviceDisplayName: row.calculator_service_key
        ? serviceNames.get(row.calculator_service_key) ?? null
        : null,
      prospectStatus: row.prospect_legacy_id
        ? prospectStatusByLegacyId.get(row.prospect_legacy_id) ?? null
        : null,
      answers: answersByQuote.get(row.legacy_id) ?? [],
    }),
  );
}
