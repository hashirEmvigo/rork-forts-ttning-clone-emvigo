/**
 * Supabase-backed Article-Number SERIES repository (ARTNUM-1, Phase 2).
 *
 * The database is the SINGLE authority for service article numbers. This module
 * wraps the durable allocator created in migration 0051:
 *  - reads the configured series for a catalog scope,
 *  - configures (create/update) a category's range,
 *  - generates the next free article number from a category's series,
 *  - validates a manually-typed article number.
 *
 * It performs NO browser storage I/O and never computes numbers in the frontend
 * (no MAX(existing)+1). Every number/validation comes from a SECURITY DEFINER
 * RPC, so authorization and durability are enforced in the database.
 */
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";

/** Whether a series belongs to the GLOBAL master catalog or a company catalog. */
export type ArticleNumberSeriesScopeKind = "global" | "company";

/** A configured article-number series for one catalog/category. */
export interface ArticleNumberSeries {
  scopeKind: ArticleNumberSeriesScopeKind;
  /** null for global; the company legacy id for company scope. */
  companyLegacyId: string | null;
  /** Owning category (app-facing service category id). */
  categoryId: string;
  /** Inclusive owned range, e.g. 1001..1999. */
  rangeStart: number;
  rangeEnd: number;
  /** Next number the series will issue (explicit). */
  nextValue: number;
  isActive: boolean;
  /**
   * Derived: numbers have been issued, so the range START is locked and the
   * range may only be widened at the end (see configure RPC).
   */
  isLocked: boolean;
}

/** Result of a manual-entry validation (mirrors the 0051 RPC jsonb). */
export interface ArticleNumberValidation {
  ok: boolean;
  code: "ok" | "duplicate" | "out_of_range" | "not_numeric" | "no_series";
  message: string;
}

/** Identifies a single catalog/category series scope. */
export interface ArticleNumberSeriesScope {
  scopeKind: ArticleNumberSeriesScopeKind;
  /** null for global; the company legacy id for company scope. */
  companyLegacyId: string | null;
  categoryId: string;
}

interface ArticleNumberSeriesRow {
  scope_kind: ArticleNumberSeriesScopeKind;
  company_legacy_id: string | null;
  category_legacy_id: string;
  range_start: number;
  range_end: number;
  next_value: number;
  is_active: boolean;
}

class SupabaseNotConfiguredError extends Error {
  constructor() {
    super(
      "SupabaseArticleNumberSeriesRepository requires Supabase. Set " +
        "EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.",
    );
    this.name = "SupabaseNotConfiguredError";
  }
}

function rowToSeries(row: ArticleNumberSeriesRow): ArticleNumberSeries {
  return {
    scopeKind: row.scope_kind,
    companyLegacyId: row.company_legacy_id,
    categoryId: row.category_legacy_id,
    rangeStart: row.range_start,
    rangeEnd: row.range_end,
    nextValue: row.next_value,
    isActive: row.is_active,
    isLocked: row.next_value > row.range_start,
  };
}

/**
 * Lists the article-number series visible in a catalog scope. Pass a company
 * legacy id to read that company's series (plus globals, which RLS also exposes);
 * pass null/undefined for the Super Admin global catalog.
 */
export async function listArticleNumberSeriesFromSupabase(
  companyId?: string | null,
): Promise<ArticleNumberSeries[]> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const stop = perf.start("articleNumberSeries.list.supabase");
  try {
    const normalizedCompanyId = companyId == null ? null : companyId.trim();
    let query = supabase
      .from("article_number_series")
      .select(
        "scope_kind, company_legacy_id, category_legacy_id, range_start, range_end, next_value, is_active",
      );
    // Company catalog: its own rows + globals. Global catalog (null): globals only.
    query = normalizedCompanyId
      ? query.or(`company_legacy_id.eq.${normalizedCompanyId},scope_kind.eq.global`)
      : query.eq("scope_kind", "global");
    const { data, error } = await query;
    if (error) throw new Error(`[article_number_series] Supabase list failed: ${error.message}`);
    const rows = (data ?? []) as unknown as ArticleNumberSeriesRow[];
    return rows.map(rowToSeries);
  } finally {
    stop();
  }
}

/**
 * Creates or updates the article-number series for a (scope, category). Once
 * numbers have been issued the range start is locked (enforced by the RPC).
 */
export async function configureArticleNumberSeries(input: {
  scope: ArticleNumberSeriesScope;
  rangeStart: number;
  rangeEnd: number;
  isActive?: boolean;
}): Promise<ArticleNumberSeries> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const { scope, rangeStart, rangeEnd, isActive } = input;
  const { data, error } = await supabase.rpc("configure_article_number_series", {
    p_scope_kind: scope.scopeKind,
    p_company_legacy_id: scope.companyLegacyId,
    p_category_legacy_id: scope.categoryId,
    p_range_start: rangeStart,
    p_range_end: rangeEnd,
    p_is_active: isActive ?? true,
  });
  if (error) throw new Error(error.message);
  const row = (Array.isArray(data) ? data[0] : data) as ArticleNumberSeriesRow | null;
  if (!row) throw new Error("Configuring the article-number series returned no row.");
  return rowToSeries(row);
}

/**
 * Generates the next FREE article number from a category's series. Returns the
 * issued number as text (the canonical article-number string). Throws when no
 * active series exists or the range is exhausted.
 */
export async function generateArticleNumber(scope: ArticleNumberSeriesScope): Promise<string> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const { data, error } = await supabase.rpc("generate_article_number", {
    p_scope_kind: scope.scopeKind,
    p_company_legacy_id: scope.companyLegacyId,
    p_category_legacy_id: scope.categoryId,
  });
  if (error) throw new Error(error.message);
  const issued = typeof data === "string" ? data.trim() : String(data ?? "").trim();
  if (!issued) throw new Error("The article-number allocator returned an empty value.");
  return issued;
}

/**
 * Validates a manually-typed article number against the category series and the
 * scope's uniqueness. Returns a structured result; never throws on a plain
 * validation failure (only on a transport/authorization error).
 */
export async function validateManualArticleNumber(input: {
  scope: ArticleNumberSeriesScope;
  articleNumber: string;
  /** The service being edited, so its own number is ignored in the check. */
  excludeServiceId?: string | null;
}): Promise<ArticleNumberValidation> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const { scope, articleNumber, excludeServiceId } = input;
  const { data, error } = await supabase.rpc("validate_manual_article_number", {
    p_scope_kind: scope.scopeKind,
    p_company_legacy_id: scope.companyLegacyId,
    p_category_legacy_id: scope.categoryId,
    p_article_number: articleNumber,
    p_exclude_service_legacy_id: excludeServiceId ?? null,
  });
  if (error) throw new Error(error.message);
  const result = (data ?? {}) as Partial<ArticleNumberValidation>;
  return {
    ok: result.ok ?? false,
    code: result.code ?? "ok",
    message: result.message ?? "",
  };
}
