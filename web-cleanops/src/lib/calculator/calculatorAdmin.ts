/**
 * Price Calculator — Super Admin control repository (Slice 5A).
 *
 * Supabase-authoritative reads/writes for the locked Super Admin Calculator
 * control page. Everything here goes through the AUTHENTICATED Supabase client,
 * so the calculator's super_admin-only RLS (migrations 0058/0059) is what gates
 * access — there is no anon path and no localStorage source of truth.
 *
 * Scope guard for this slice: the only WRITE exposed is {@link setCalculatorEnabled},
 * which updates a single column (`calculator_settings.enabled`). No other setting,
 * service, plan, question, rule, prospect or quote is ever mutated here.
 */
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

/**
 * TEMPORARY (MVP): the calculator currently targets ONE company. The public
 * slug is the stable, environment-independent handle (it is hard-coded in the
 * seed regardless of the per-environment company legacy_id), so the overview is
 * resolved by slug. `MVP_CALCULATOR_COMPANY_LEGACY_ID` is the VERIFIED live
 * owner (Städalliansen Sverige AB) used only as a consistency cross-check in the
 * UI. When Company-Admin ownership lands (Phase 2) this hard-coded target is
 * replaced by the signed-in admin's company / an explicit company selector.
 */
export const MVP_CALCULATOR_PUBLIC_SLUG = "rakna-ut-ditt-pris";
export const MVP_CALCULATOR_COMPANY_LEGACY_ID = "cmp_o2f6orw29m";

// ── Row shapes (snake_case, as returned by Supabase) ────────────────────────

interface CalculatorSettingsRow {
  legacy_id: string;
  company_id: string;
  company_legacy_id: string;
  enabled: boolean;
  public_slug: string | null;
  price_display_mode: string;
  quote_validity_days: number;
  default_quote_status: string;
  currency: string;
}

interface CalculatorServiceRow {
  legacy_id: string;
  service_key: string;
  display_name: string;
  pricing_model: string;
  enabled: boolean;
  coming_soon: boolean;
  sort_order: number;
}

interface CleaningPlanRow {
  legacy_id: string;
  plan_key: string;
  name: string;
  hourly_rate: number;
  is_default: boolean;
  active: boolean;
  sort_order: number;
}

// ── App-facing views (camelCase) ────────────────────────────────────────────

export interface CalculatorSettingsView {
  legacyId: string;
  companyId: string;
  companyLegacyId: string;
  enabled: boolean;
  publicSlug: string | null;
  priceDisplayMode: string;
  quoteValidityDays: number;
  defaultQuoteStatus: string;
  currency: string;
}

export interface CalculatorServiceView {
  legacyId: string;
  serviceKey: string;
  displayName: string;
  pricingModel: string;
  enabled: boolean;
  comingSoon: boolean;
  sortOrder: number;
}

export interface CleaningPlanView {
  legacyId: string;
  planKey: string;
  name: string;
  hourlyRate: number;
  isDefault: boolean;
  active: boolean;
  sortOrder: number;
}

/** Read-only configuration counts shown in the control page summary. */
export interface CalculatorConfigCounts {
  services: number;
  enabledServices: number;
  cleaningPlans: number;
  questions: number;
  pricingRules: number;
  prospects: number;
  quoteRequests: number;
  quoteRequestAnswers: number;
}

/** The full payload rendered by the Super Admin Calculator control page. */
export interface CalculatorAdminOverview {
  companyName: string | null;
  /** True when the loaded owner matches the verified MVP target company. */
  matchesMvpTarget: boolean;
  settings: CalculatorSettingsView;
  services: CalculatorServiceView[];
  cleaningPlans: CleaningPlanView[];
  counts: CalculatorConfigCounts;
}

// ── Pure mappers (no I/O — unit-tested directly) ────────────────────────────

/** Maps a `calculator_settings` row to its app-facing view. */
export function mapSettingsRow(row: CalculatorSettingsRow): CalculatorSettingsView {
  return {
    legacyId: row.legacy_id,
    companyId: row.company_id,
    companyLegacyId: row.company_legacy_id,
    enabled: row.enabled === true,
    publicSlug: row.public_slug ?? null,
    priceDisplayMode: row.price_display_mode,
    quoteValidityDays: row.quote_validity_days,
    defaultQuoteStatus: row.default_quote_status,
    currency: row.currency,
  };
}

/** Maps a `calculator_services` row to its app-facing view. */
export function mapServiceRow(row: CalculatorServiceRow): CalculatorServiceView {
  return {
    legacyId: row.legacy_id,
    serviceKey: row.service_key,
    displayName: row.display_name,
    pricingModel: row.pricing_model,
    enabled: row.enabled === true,
    comingSoon: row.coming_soon === true,
    sortOrder: row.sort_order ?? 0,
  };
}

/** Maps a `cleaning_plans` row to its app-facing view. */
export function mapPlanRow(row: CleaningPlanRow): CleaningPlanView {
  return {
    legacyId: row.legacy_id,
    planKey: row.plan_key,
    name: row.name,
    hourlyRate: Number(row.hourly_rate),
    isDefault: row.is_default === true,
    active: row.active === true,
    sortOrder: row.sort_order ?? 0,
  };
}

/** Counts enabled services in a mapped list (used for the summary card). */
export function countEnabledServices(services: readonly CalculatorServiceView[]): number {
  return services.filter((s) => s.enabled).length;
}

// ── Supabase access ─────────────────────────────────────────────────────────

class CalculatorAdminError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalculatorAdminError";
  }
}

function configuredClient() {
  if (!isSupabaseConfigured || !supabase) {
    throw new CalculatorAdminError(
      "Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }
  return supabase;
}

interface CountResponse {
  count: number | null;
  error: { message: string } | null;
}

interface CountQueryBuilder extends PromiseLike<CountResponse> {
  eq(column: string, value: string): CountQueryBuilder;
  is(column: string, value: null): CountQueryBuilder;
}

/**
 * Issues a single read-only `count(*)` against a company-scoped calculator
 * table. `head: true` means no rows are transferred — only the count. Live rows
 * only: every calculator table except the append-only `quote_request_answers`
 * carries `deleted_at`, so it is excluded by default.
 */
async function countCompanyRows(
  table: string,
  companyId: string,
  options: { hasDeletedAt?: boolean } = {},
): Promise<number> {
  const client = configuredClient();
  let query = client
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId) as unknown as CountQueryBuilder;

  if (options.hasDeletedAt !== false) {
    query = query.is("deleted_at", null);
  }

  const { count, error } = await query;
  if (error) {
    throw new CalculatorAdminError(`[${table}] count failed: ${error.message}`);
  }
  return count ?? 0;
}

/**
 * Loads the full Super Admin calculator overview for the MVP company, resolved
 * by the stable public slug. Returns `null` when no live calculator settings
 * row exists (e.g. the 0060 seed has not been applied in this environment) so
 * the page can render a clear "not configured" state instead of an error.
 */
export async function getCalculatorAdminOverview(): Promise<CalculatorAdminOverview | null> {
  const client = configuredClient();

  const { data: settingsRow, error: settingsError } = await client
    .from("calculator_settings")
    .select(
      "legacy_id, company_id, company_legacy_id, enabled, public_slug, price_display_mode, quote_validity_days, default_quote_status, currency",
    )
    .eq("public_slug", MVP_CALCULATOR_PUBLIC_SLUG)
    .is("deleted_at", null)
    .maybeSingle();

  if (settingsError) {
    throw new CalculatorAdminError(`[calculator_settings] read failed: ${settingsError.message}`);
  }
  if (!settingsRow) return null;

  const settings = mapSettingsRow(settingsRow as CalculatorSettingsRow);
  const companyId = settings.companyId;

  const [
    companyResult,
    servicesResult,
    plansResult,
    questions,
    pricingRules,
    prospects,
    quoteRequests,
    quoteRequestAnswers,
  ] = await Promise.all([
    client.from("companies").select("name").eq("legacy_id", settings.companyLegacyId).maybeSingle(),
    client
      .from("calculator_services")
      .select("legacy_id, service_key, display_name, pricing_model, enabled, coming_soon, sort_order")
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .order("sort_order", { ascending: true }),
    client
      .from("cleaning_plans")
      .select("legacy_id, plan_key, name, hourly_rate, is_default, active, sort_order")
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .order("sort_order", { ascending: true }),
    countCompanyRows("calculator_questions", companyId),
    countCompanyRows("pricing_rules", companyId),
    countCompanyRows("prospects", companyId),
    countCompanyRows("quote_requests", companyId),
    // quote_request_answers is append-only and has no deleted_at column.
    countCompanyRows("quote_request_answers", companyId, { hasDeletedAt: false }),
  ]);

  if (servicesResult.error) {
    throw new CalculatorAdminError(`[calculator_services] read failed: ${servicesResult.error.message}`);
  }
  if (plansResult.error) {
    throw new CalculatorAdminError(`[cleaning_plans] read failed: ${plansResult.error.message}`);
  }

  const services = ((servicesResult.data ?? []) as CalculatorServiceRow[]).map(mapServiceRow);
  const cleaningPlans = ((plansResult.data ?? []) as CleaningPlanRow[]).map(mapPlanRow);
  const companyName =
    (companyResult.data as { name?: string | null } | null)?.name ?? null;

  return {
    companyName,
    matchesMvpTarget: settings.companyLegacyId === MVP_CALCULATOR_COMPANY_LEGACY_ID,
    settings,
    services,
    cleaningPlans,
    counts: {
      services: services.length,
      enabledServices: countEnabledServices(services),
      cleaningPlans: cleaningPlans.length,
      questions,
      pricingRules,
      prospects,
      quoteRequests,
      quoteRequestAnswers,
    },
  };
}

/**
 * Toggles ONLY `calculator_settings.enabled` for the given settings row,
 * matched by its stable `legacy_id`. No other column is written (the DB trigger
 * stamps `updated_at`). Throws {@link CalculatorAdminError} on failure so the
 * React Query mutation surfaces a clear error to the operator.
 *
 * @returns the persisted `enabled` value.
 */
export async function setCalculatorEnabled(
  settingsLegacyId: string,
  enabled: boolean,
): Promise<boolean> {
  const client = configuredClient();

  const { data, error } = await client
    .from("calculator_settings")
    .update({ enabled })
    .eq("legacy_id", settingsLegacyId)
    .is("deleted_at", null)
    .select("legacy_id, enabled")
    .maybeSingle();

  if (error) {
    throw new CalculatorAdminError(`[calculator_settings] enable update failed: ${error.message}`);
  }
  if (!data) {
    throw new CalculatorAdminError(
      "Calculator settings row not found (it may have been removed). No change was made.",
    );
  }

  return (data as { enabled: boolean }).enabled === true;
}
