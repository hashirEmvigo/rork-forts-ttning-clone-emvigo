/**
 * Module-domain migration + shadow-read tooling (MOD-1).
 *
 * Migrates the three Module-domain stores into Supabase:
 *   • modules / module_categories — GLOBAL master data (never skipped).
 *   • company_modules             — COMPANY-scoped; a config whose company has
 *                                   no Supabase row is skipped + reported.
 * company_modules has no own id; its legacy_id is "<companyId>:<moduleId>".
 */
import {
  getModules,
  getModuleCategories,
  getCompanyModules,
} from "@/lib/store";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import type { Module, ModuleCategory, CompanyModuleSetting } from "@/types";
import { loadCompanyUuidMap } from "./customerMigration";
import {
  listFullModulesFromSupabase,
  listFullModuleCategoriesFromSupabase,
  listFullCompanyModulesFromSupabase,
} from "./supabaseModuleRepository";

/** Stable composite legacy id for a company-module config row. */
export function companyModuleLegacyId(setting: CompanyModuleSetting): string {
  return `${setting.companyId}:${setting.moduleId}`;
}

export interface ModuleUpsertRow {
  legacy_id: string;
  name: string;
  status: string;
  data: Module;
  deleted_at: string | null;
}
export interface ModuleCategoryUpsertRow {
  legacy_id: string;
  name: string;
  status: string;
  sort_order: number;
  data: ModuleCategory;
  deleted_at: string | null;
}
export interface CompanyModuleUpsertRow {
  legacy_id: string;
  company_id: string | null;
  company_legacy_id: string;
  module_legacy_id: string;
  available: boolean;
  enabled: boolean;
  data: CompanyModuleSetting;
  deleted_at: string | null;
}

export function toModuleUpsertRow(module: Module): ModuleUpsertRow {
  return {
    legacy_id: module.id,
    name: module.name,
    status: module.status,
    data: module,
    deleted_at: null,
  };
}

export function toModuleCategoryUpsertRow(category: ModuleCategory): ModuleCategoryUpsertRow {
  return {
    legacy_id: category.id,
    name: category.name,
    status: category.status,
    sort_order: category.sortOrder,
    data: category,
    deleted_at: null,
  };
}

export function toCompanyModuleUpsertRow(
  setting: CompanyModuleSetting,
  companyUuid: string | null,
): CompanyModuleUpsertRow {
  return {
    legacy_id: companyModuleLegacyId(setting),
    company_id: companyUuid,
    company_legacy_id: setting.companyId,
    module_legacy_id: setting.moduleId,
    available: setting.available,
    enabled: setting.enabled,
    data: setting,
    deleted_at: null,
  };
}

/** Structured outcome of a module-domain migration run (or dry-run). */
export interface ModuleMigrationReport {
  ok: boolean;
  dryRun: boolean;
  modules: number;
  categories: number;
  companyModules: number;
  skipped: Array<{ id: string; reason: string }>;
  error?: string;
}

async function upsertChunked<T extends object>(
  table: string,
  rows: ReadonlyArray<T>,
): Promise<string | null> {
  if (!supabase || rows.length === 0) return null;
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await supabase.from(table).upsert(chunk, { onConflict: "legacy_id" });
    if (error) return `[${table}] upsert failed at chunk ${i / CHUNK}: ${error.message}`;
  }
  return null;
}

/** Migrates all three Module-domain stores into Supabase. */
export async function migrateModules(options?: {
  dryRun?: boolean;
}): Promise<ModuleMigrationReport> {
  const dryRun = options?.dryRun ?? false;
  const modules = getModules();
  const categories = getModuleCategories();
  const companyModules = getCompanyModules();

  const report: ModuleMigrationReport = {
    ok: false,
    dryRun,
    modules: modules.length,
    categories: categories.length,
    companyModules: 0,
    skipped: [],
  };

  if (!isSupabaseConfigured || !supabase) {
    report.error = "Supabase is not configured.";
    return report;
  }

  const companyMap = await loadCompanyUuidMap();
  const companyRows: CompanyModuleUpsertRow[] = [];
  for (const setting of companyModules) {
    const uuid = companyMap.get(setting.companyId) ?? null;
    if (!uuid) {
      report.skipped.push({
        id: companyModuleLegacyId(setting),
        reason: `No Supabase company found for legacy_id "${setting.companyId}". Migrate companies first.`,
      });
      continue;
    }
    companyRows.push(toCompanyModuleUpsertRow(setting, uuid));
  }
  report.companyModules = companyRows.length;

  if (dryRun) {
    report.ok = report.skipped.length === 0;
    return report;
  }

  try {
    const moduleErr = await upsertChunked("modules", modules.map(toModuleUpsertRow));
    if (moduleErr) {
      report.error = moduleErr;
      return report;
    }
    const categoryErr = await upsertChunked(
      "module_categories",
      categories.map(toModuleCategoryUpsertRow),
    );
    if (categoryErr) {
      report.error = categoryErr;
      return report;
    }
    const companyErr = await upsertChunked("company_modules", companyRows);
    if (companyErr) {
      report.error = companyErr;
      return report;
    }
    report.ok = report.skipped.length === 0;
    return report;
  } catch (err) {
    report.error = err instanceof Error ? err.message : "Unknown migration error.";
    return report;
  }
}

/** Per-aspect outcome of a localStorage-vs-Supabase module-domain comparison. */
export interface ModuleShadowReport {
  ok: boolean;
  modulesMatch: boolean;
  categoriesMatch: boolean;
  companyModulesMatch: boolean;
  notes: string[];
}

function countMatch(label: string, local: number, remote: number, notes: string[]): boolean {
  if (local === remote) return true;
  notes.push(`${label} count mismatch: local ${local} vs supabase ${remote}`);
  return false;
}

/** Compares all three Module-domain stores against the Supabase shadow copy. */
export async function shadowReadModules(options?: {
  companyId?: string | null;
}): Promise<ModuleShadowReport> {
  const notes: string[] = [];
  const report: ModuleShadowReport = {
    ok: false,
    modulesMatch: false,
    categoriesMatch: false,
    companyModulesMatch: false,
    notes,
  };

  if (!isSupabaseConfigured || !supabase) {
    notes.push("Supabase is not configured.");
    return report;
  }

  const queryScope = options?.companyId ?? undefined;
  try {
    const [rModules, rCategories, rCompany] = await Promise.all([
      listFullModulesFromSupabase(),
      listFullModuleCategoriesFromSupabase(),
      listFullCompanyModulesFromSupabase(queryScope),
    ]);

    const localCompany =
      queryScope === undefined
        ? getCompanyModules()
        : getCompanyModules().filter((s) => s.companyId === queryScope);

    report.modulesMatch = countMatch("modules", getModules().length, rModules.length, notes);
    report.categoriesMatch = countMatch(
      "module_categories",
      getModuleCategories().length,
      rCategories.length,
      notes,
    );
    report.companyModulesMatch = countMatch(
      "company_modules",
      localCompany.length,
      rCompany.length,
      notes,
    );
    report.ok =
      report.modulesMatch && report.categoriesMatch && report.companyModulesMatch;
    return report;
  } catch (err) {
    notes.push(err instanceof Error ? err.message : "Supabase read failed.");
    return report;
  }
}

if (import.meta.env.DEV === true && typeof window !== "undefined") {
  const w = window as unknown as { __cleanopsData?: Record<string, unknown> };
  w.__cleanopsData = {
    ...(w.__cleanopsData ?? {}),
    migrateModules,
    shadowReadModules,
  };
}
