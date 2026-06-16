/**
 * Supabase-backed Module repository (MOD-1 reads + Phase-2A authoritative writes).
 *
 * Reads the three Module-domain tables (migration 0027 schema, created + seeded
 * onto the live DB by 0053):
 *   • modules            — GLOBAL master catalogue ({@link Module}).
 *   • module_categories  — GLOBAL groupings ({@link ModuleCategory}).
 *   • company_modules    — COMPANY-scoped per-company config
 *                          ({@link CompanyModuleSetting}).
 * Modules / categories are global master data (no companyId), so every signed-in
 * user reads the full catalogue (like settings_templates). company_modules is
 * company-scoped. Soft-deleted rows (`deleted_at` set) are filtered out.
 *
 * WRITES (Phase 2A) cover the GLOBAL master catalogue only and are AUTHORITATIVE
 * and direct: each module status change / category create / edit / archive /
 * restore / reorder / delete commits to Supabase FIRST and the caller updates the
 * UI only after a confirmed write + directory refetch. There is NO localStorage
 * authority, NO browser-domain mirror, and NO optimistic persistence on this
 * path.
 *
 * WRITES (Phase 2B) extend that same authoritative model to the COMPANY-scoped
 * company_modules availability/enablement config via
 * {@link upsertCompanyModuleInSupabase}: a Super-Admin availability change or a
 * Company-Admin enable/disable commits to Supabase FIRST (resolving the tenant
 * UUID the RLS company_id check needs) and the caller refetches the directory.
 * Still NO localStorage authority and NO browser-domain mirror.
 */
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import type { Module, ModuleCategory, CompanyModuleSetting } from "@/types";
import { loadCompanyUuidMap } from "./customerMigration";

interface ModuleFullRow {
  data: Module;
  deleted_at: string | null;
}
interface ModuleCategoryFullRow {
  data: ModuleCategory;
  deleted_at: string | null;
}
interface CompanyModuleFullRow {
  data: CompanyModuleSetting;
  company_legacy_id: string;
  deleted_at: string | null;
}

class SupabaseNotConfiguredError extends Error {
  constructor() {
    super(
      "SupabaseModuleRepository requires Supabase. Set EXPO_PUBLIC_SUPABASE_URL " +
        "and EXPO_PUBLIC_SUPABASE_ANON_KEY.",
    );
    this.name = "SupabaseNotConfiguredError";
  }
}

/** FULL global module records (lossless `data` jsonb). */
export async function listFullModulesFromSupabase(): Promise<Module[]> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const stop = perf.start("modules.list.supabase.full");
  try {
    const { data, error } = await supabase.from("modules").select("data, deleted_at");
    if (error) throw new Error(`[modules] Supabase full list failed: ${error.message}`);
    const rows = (data ?? []) as unknown as ModuleFullRow[];
    return rows
      .filter((r) => !r.deleted_at)
      .map((r) => r.data)
      .filter((m): m is Module => Boolean(m));
  } finally {
    stop();
  }
}

/** FULL global module-category records (lossless `data` jsonb). */
export async function listFullModuleCategoriesFromSupabase(): Promise<ModuleCategory[]> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const stop = perf.start("moduleCategories.list.supabase.full");
  try {
    const { data, error } = await supabase
      .from("module_categories")
      .select("data, deleted_at");
    if (error) {
      throw new Error(`[module_categories] Supabase full list failed: ${error.message}`);
    }
    const rows = (data ?? []) as unknown as ModuleCategoryFullRow[];
    return rows
      .filter((r) => !r.deleted_at)
      .map((r) => r.data)
      .filter((c): c is ModuleCategory => Boolean(c));
  } finally {
    stop();
  }
}

// ── Authoritative writes (Phase 2A · GLOBAL master catalogue only) ──────────

/** The columns an authoritative module write commits (status archive/restore). */
interface ModuleWriteRow {
  legacy_id: string;
  name: string;
  status: string;
  /** Lossless record the read path reconstructs from. */
  data: Module;
}

/** The columns an authoritative module-category write commits. */
interface ModuleCategoryWriteRow {
  legacy_id: string;
  name: string;
  status: string;
  sort_order: number;
  data: ModuleCategory;
}

/** Shape of the `data` jsonb returned by a write's `.select("data")`. */
interface ModuleDataRow {
  data: Module;
}
interface ModuleCategoryDataRow {
  data: ModuleCategory;
}

function toModuleRow(module: Module): ModuleWriteRow {
  return { legacy_id: module.id, name: module.name, status: module.status, data: module };
}

function toModuleCategoryRow(category: ModuleCategory): ModuleCategoryWriteRow {
  return {
    legacy_id: category.id,
    name: category.name,
    status: category.status,
    sort_order: category.sortOrder,
    data: category,
  };
}

/**
 * Authoritatively upserts a GLOBAL module by `legacy_id`. The only module
 * mutation today is the platform status toggle (archive = 'inactive', restore =
 * 'active'); an upsert keeps it self-healing if the seeded row is ever missing.
 * Updates the flat `name`/`status` columns AND the lossless `data` jsonb.
 */
export async function upsertModuleInSupabase(module: Module): Promise<Module> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const stop = perf.start("modules.upsert.supabase");
  try {
    const { data, error } = await supabase
      .from("modules")
      .upsert(toModuleRow(module), { onConflict: "legacy_id" })
      .select("data")
      .single();
    if (error) throw new Error(`[modules] upsert failed: ${error.message}`);
    const saved = (data as ModuleDataRow | null)?.data;
    if (!saved) throw new Error("[modules] upsert returned no row.");
    return saved;
  } finally {
    stop();
  }
}

/**
 * Authoritatively INSERTS a new GLOBAL module category. Resolves with the
 * persisted record (reconstructed from `data`). Rejects when Supabase is
 * unconfigured, RLS blocks the insert, or the unique `legacy_id` index is
 * violated — the caller surfaces the error and leaves the directory untouched.
 */
export async function createModuleCategoryInSupabase(
  category: ModuleCategory,
): Promise<ModuleCategory> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const stop = perf.start("moduleCategories.create.supabase");
  try {
    const { data, error } = await supabase
      .from("module_categories")
      .insert(toModuleCategoryRow(category))
      .select("data")
      .single();
    if (error) throw new Error(`[module_categories] create failed: ${error.message}`);
    const created = (data as ModuleCategoryDataRow | null)?.data;
    if (!created) throw new Error("[module_categories] create returned no row.");
    return created;
  } finally {
    stop();
  }
}

/**
 * Authoritatively UPDATES an existing, non-deleted GLOBAL module category (edit
 * + the status archive/restore toggle both route here with the fully-computed
 * record). Updates the flat columns AND the lossless `data` jsonb, scoped to
 * `legacy_id` + `deleted_at is null`; if it affects 0 rows (not found, already
 * soft-deleted, or RLS-blocked) it REJECTS — never a silent no-op.
 */
export async function updateModuleCategoryInSupabase(
  category: ModuleCategory,
): Promise<ModuleCategory> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const stop = perf.start("moduleCategories.update.supabase");
  try {
    const { data, error } = await supabase
      .from("module_categories")
      .update({
        name: category.name,
        status: category.status,
        sort_order: category.sortOrder,
        data: category,
      })
      .eq("legacy_id", category.id)
      .is("deleted_at", null)
      .select("data");
    if (error) throw new Error(`[module_categories] update failed: ${error.message}`);
    const rows = (data ?? []) as unknown as ModuleCategoryDataRow[];
    if (rows.length === 0) {
      throw new Error(
        "[module_categories] update affected 0 rows — the category was not found or you " +
          "don't have permission to change it.",
      );
    }
    return rows[0].data;
  } finally {
    stop();
  }
}

/**
 * Authoritatively SOFT-DELETES a GLOBAL module category by setting `deleted_at`,
 * scoped to `legacy_id` + `deleted_at is null` so a repeated delete is a
 * confirmed no-op rather than a false success; if it affects 0 rows it REJECTS.
 */
export async function softDeleteModuleCategoryInSupabase(id: string): Promise<void> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const stop = perf.start("moduleCategories.softDelete.supabase");
  try {
    const { data, error } = await supabase
      .from("module_categories")
      .update({ deleted_at: new Date().toISOString() })
      .eq("legacy_id", id)
      .is("deleted_at", null)
      .select("legacy_id");
    if (error) throw new Error(`[module_categories] delete failed: ${error.message}`);
    const rows = (data ?? []) as unknown as Array<{ legacy_id: string }>;
    if (rows.length === 0) {
      throw new Error(
        "[module_categories] delete affected 0 rows — the category was not found or you " +
          "don't have permission to delete it.",
      );
    }
  } finally {
    stop();
  }
}

/**
 * Authoritatively persists a category REORDER by upserting each (non-deleted)
 * category's new `sort_order` (flat column + `data.sortOrder`) on `legacy_id`.
 * A no-op for an empty list.
 */
export async function reorderModuleCategoriesInSupabase(
  categories: ModuleCategory[],
): Promise<void> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  if (categories.length === 0) return;
  const stop = perf.start("moduleCategories.reorder.supabase");
  try {
    const { error } = await supabase
      .from("module_categories")
      .upsert(categories.map(toModuleCategoryRow), { onConflict: "legacy_id" });
    if (error) throw new Error(`[module_categories] reorder failed: ${error.message}`);
  } finally {
    stop();
  }
}

// ── Authoritative company-module writes (Phase 2B · COMPANY-scoped config) ──

/**
 * Stable composite identity for a company-module config row
 * ("<companyId>:<moduleId>"). Inlined here (rather than imported from
 * {@link import("./moduleMigration").companyModuleLegacyId}) to keep this
 * repository free of an import cycle — moduleMigration imports this module's
 * list functions. Both formats MUST stay byte-identical.
 */
function companyModuleLegacyId(setting: CompanyModuleSetting): string {
  return `${setting.companyId}:${setting.moduleId}`;
}

/** The columns an authoritative company-module write commits. */
interface CompanyModuleWriteRow {
  legacy_id: string;
  /** Real tenant UUID FK the RLS `company_id = current_company_id()` check needs. */
  company_id: string;
  /** App-facing company id (the company `legacy_id`) for cheap query scoping. */
  company_legacy_id: string;
  module_legacy_id: string;
  available: boolean;
  enabled: boolean;
  /** Lossless record the read path reconstructs from. */
  data: CompanyModuleSetting;
  deleted_at: string | null;
}

/** Shape of the `data` jsonb returned by a write's `.select("data")`. */
interface CompanyModuleDataRow {
  data: CompanyModuleSetting;
}

/**
 * Authoritatively UPSERTS a company-module config row by its composite
 * `legacy_id` ("<companyId>:<moduleId>"). Used by BOTH the Super-Admin
 * availability toggle and the Company-Admin enable/disable toggle — each commits
 * the FULLY-computed {@link CompanyModuleSetting} so the persisted row always
 * carries a coherent available/enabled pair.
 *
 * The app's company id space is the company `legacy_id`, but RLS checks the real
 * `company_id` UUID, so the tenant UUID is resolved via {@link loadCompanyUuidMap}
 * and written into `company_id`. A setting whose company has no Supabase row is
 * REJECTED up-front (rather than written with a null tenant that RLS would
 * silently drop), so the caller surfaces the error and leaves the UI untouched.
 * Updates the flat columns AND the lossless `data` jsonb; resolves with the
 * persisted setting reconstructed from `data`.
 */
export async function upsertCompanyModuleInSupabase(
  setting: CompanyModuleSetting,
): Promise<CompanyModuleSetting> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const stop = perf.start("companyModules.upsert.supabase");
  try {
    const companyMap = await loadCompanyUuidMap();
    const companyUuid = companyMap.get(setting.companyId);
    if (!companyUuid) {
      throw new Error(
        `[company_modules] No Supabase company found for "${setting.companyId}" — ` +
          "cannot persist module availability for an unmapped company.",
      );
    }
    const row: CompanyModuleWriteRow = {
      legacy_id: companyModuleLegacyId(setting),
      company_id: companyUuid,
      company_legacy_id: setting.companyId,
      module_legacy_id: setting.moduleId,
      available: setting.available,
      enabled: setting.enabled,
      data: setting,
      deleted_at: null,
    };
    const { data, error } = await supabase
      .from("company_modules")
      .upsert(row, { onConflict: "legacy_id" })
      .select("data")
      .single();
    if (error) throw new Error(`[company_modules] upsert failed: ${error.message}`);
    const saved = (data as CompanyModuleDataRow | null)?.data;
    if (!saved) throw new Error("[company_modules] upsert returned no row.");
    return saved;
  } finally {
    stop();
  }
}

/** FULL company-module config rows (lossless `data` jsonb) for a company scope. */
export async function listFullCompanyModulesFromSupabase(
  companyId?: string | null,
): Promise<CompanyModuleSetting[]> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const stop = perf.start("companyModules.list.supabase.full");
  try {
    let query = supabase
      .from("company_modules")
      .select("data, company_legacy_id, deleted_at");
    if (companyId !== undefined && companyId !== null) {
      query = query.eq("company_legacy_id", companyId);
    }
    const { data, error } = await query;
    if (error) {
      throw new Error(`[company_modules] Supabase full list failed: ${error.message}`);
    }
    const rows = (data ?? []) as unknown as CompanyModuleFullRow[];
    return rows
      .filter((r) => !r.deleted_at)
      .map((r) => r.data)
      .filter((s): s is CompanyModuleSetting => Boolean(s));
  } finally {
    stop();
  }
}
