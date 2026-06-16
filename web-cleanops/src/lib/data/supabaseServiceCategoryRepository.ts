/**
 * Supabase-backed Service Category repository (SVCCAT-1 + CORE-WRITES-A1).
 *
 * Reads and authoritative create/update writes for `service_categories`. The
 * table stores flat indexed columns plus the complete ServiceCategory payload in
 * `data` jsonb so UI shapes stay unchanged.
 */
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import type { ServiceCategory } from "@/types";
import { loadCompanyUuidMap } from "./customerMigration";

const SUMMARY_COLUMNS = "legacy_id, company_legacy_id, name, status, deleted_at";

/** Lightweight category row for count / id-set parity checks. */
export interface ServiceCategorySummary {
  id: string;
  companyId: string | null;
  name: string;
}

interface ServiceCategorySummaryRow {
  legacy_id: string;
  company_legacy_id: string | null;
  name: string;
  status: string;
  deleted_at: string | null;
}

interface ServiceCategoryFullRow {
  data: ServiceCategory;
  company_legacy_id: string | null;
  deleted_at: string | null;
}

interface ServiceCategoryUpsertRow {
  legacy_id: string;
  company_id: string | null;
  company_legacy_id: string | null;
  name: string;
  status: string;
  deleted_at: string | null;
  data: ServiceCategory;
}

export interface SupabaseServiceCategoryCreateInput {
  /** null = Super Admin global catalog row; string = company-owned row. */
  companyId: string | null;
  name: string;
  description?: string;
  categoryType?: ServiceCategory["categoryType"];
  sortOrder?: number;
  createdBy?: string | null;
}

export type SupabaseServiceCategoryUpdatePatch = Partial<
  Pick<ServiceCategory, "name" | "description" | "categoryType">
>;

class SupabaseNotConfiguredError extends Error {
  constructor() {
    super(
      "SupabaseServiceCategoryRepository requires Supabase. Set " +
        "EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.",
    );
    this.name = "SupabaseNotConfiguredError";
  }
}

function rowToSummary(row: ServiceCategorySummaryRow): ServiceCategorySummary {
  return { id: row.legacy_id, companyId: row.company_legacy_id, name: row.name };
}

function makeCategoryId(): string {
  return `svc_cat_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
}

function normalizeOptionalText(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : undefined;
}

async function requireCompanyUuid(companyId: string | null): Promise<string | null> {
  if (companyId === null) return null;
  const normalizedCompanyId = companyId.trim();
  if (!normalizedCompanyId) throw new Error("Service category save requires a company context.");
  const companyMap = await loadCompanyUuidMap();
  const uuid = companyMap.get(normalizedCompanyId) ?? null;
  if (!uuid) {
    throw new Error(`No Supabase company found for service category company "${normalizedCompanyId}".`);
  }
  return uuid;
}

function categoryToUpsertRow(
  category: ServiceCategory,
  companyUuid: string | null,
): ServiceCategoryUpsertRow {
  return {
    legacy_id: category.id,
    company_id: companyUuid,
    company_legacy_id: category.companyId,
    name: category.name,
    status: category.status,
    deleted_at: null,
    data: category,
  };
}

async function upsertCategory(
  category: ServiceCategory,
  companyUuid: string | null,
): Promise<ServiceCategory> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const { error } = await supabase
    .from("service_categories")
    .upsert([categoryToUpsertRow(category, companyUuid)], { onConflict: "legacy_id" });
  if (error) {
    throw new Error(`[service_categories] Supabase category write failed: ${error.message}`);
  }
  return category;
}

function applyScope<T extends { or: (f: string) => T }>(
  query: T,
  companyId: string | null | undefined,
): T {
  if (companyId === undefined || companyId === null) return query;
  return query.or(`company_legacy_id.eq.${companyId},company_legacy_id.is.null`);
}

/** Company-scoped (+ global) summary rows. Soft-deleted rows filtered out. */
export async function listServiceCategorySummariesFromSupabase(
  companyId?: string | null,
): Promise<ServiceCategorySummary[]> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const stop = perf.start("serviceCategories.list.supabase.summaries");
  try {
    const query = applyScope(
      supabase.from("service_categories").select(SUMMARY_COLUMNS),
      companyId,
    );
    const { data, error } = await query;
    if (error) throw new Error(`[service_categories] Supabase list failed: ${error.message}`);
    const rows = (data ?? []) as unknown as ServiceCategorySummaryRow[];
    return rows.filter((r) => !r.deleted_at).map(rowToSummary);
  } finally {
    stop();
  }
}

/** FULL category records (lossless `data` jsonb) for a company scope (+ globals). */
export async function listFullServiceCategoriesFromSupabase(
  companyId?: string | null,
): Promise<ServiceCategory[]> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const stop = perf.start("serviceCategories.list.supabase.full");
  perf.count("serviceCategories.list.supabase.full.calls");
  try {
    const query = applyScope(
      supabase.from("service_categories").select("data, company_legacy_id, deleted_at"),
      companyId,
    );
    const { data, error } = await query;
    if (error) throw new Error(`[service_categories] Supabase full list failed: ${error.message}`);
    const rows = (data ?? []) as unknown as ServiceCategoryFullRow[];
    return rows
      .filter((r) => !r.deleted_at)
      .map((r) => r.data)
      .filter((c): c is ServiceCategory => Boolean(c));
  } finally {
    stop();
  }
}

async function getCategoryFromSupabaseForExactScope(
  categoryId: string,
  companyId: string | null,
): Promise<ServiceCategory | null> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const { data, error } = await supabase
    .from("service_categories")
    .select("data, company_legacy_id, deleted_at")
    .eq("legacy_id", categoryId)
    .maybeSingle();
  if (error) throw new Error(`[service_categories] Supabase detail failed: ${error.message}`);
  if (!data) return null;
  const row = data as unknown as ServiceCategoryFullRow;
  if (row.deleted_at) return null;
  if ((row.company_legacy_id ?? null) !== companyId) return null;
  return row.data ?? null;
}

/** Creates one Supabase-authoritative service category row and returns it. */
export async function createServiceCategoryInSupabase(
  input: SupabaseServiceCategoryCreateInput,
): Promise<ServiceCategory> {
  const name = input.name.trim();
  if (!name) throw new Error("Category name is required.");

  const companyId = input.companyId === null ? null : input.companyId.trim();
  const companyUuid = await requireCompanyUuid(companyId);
  const now = new Date().toISOString();
  const category: ServiceCategory = {
    id: makeCategoryId(),
    companyId,
    name,
    categoryType: input.categoryType,
    description: normalizeOptionalText(input.description),
    sortOrder: input.sortOrder ?? 0,
    status: "active",
    createdBy: input.createdBy ?? null,
    createdAt: now,
    updatedAt: now,
  };

  return upsertCategory(category, companyUuid);
}

/** Updates one existing Supabase-authoritative service category row and returns it. */
export async function updateServiceCategoryInSupabase(
  companyId: string | null,
  categoryId: string,
  patch: SupabaseServiceCategoryUpdatePatch,
): Promise<ServiceCategory> {
  const normalizedCategoryId = categoryId.trim();
  if (!normalizedCategoryId) throw new Error("Category update requires a category id.");
  const normalizedCompanyId = companyId === null ? null : companyId.trim();
  const existing = await getCategoryFromSupabaseForExactScope(normalizedCategoryId, normalizedCompanyId);
  if (!existing) throw new Error("Category not found in Supabase for this scope.");
  const companyUuid = await requireCompanyUuid(normalizedCompanyId);

  const normalizedPatch: SupabaseServiceCategoryUpdatePatch = { ...patch };
  if ("name" in normalizedPatch && normalizedPatch.name !== undefined) {
    normalizedPatch.name = normalizedPatch.name.trim();
    if (!normalizedPatch.name) throw new Error("Category name is required.");
  }
  if ("description" in normalizedPatch) {
    normalizedPatch.description = normalizeOptionalText(normalizedPatch.description);
  }

  const updated: ServiceCategory = {
    ...existing,
    ...normalizedPatch,
    companyId: normalizedCompanyId,
    updatedAt: new Date().toISOString(),
  };
  return upsertCategory(updated, companyUuid);
}
