/**
 * Service Category migration + shadow-read tooling (SVCCAT-1).
 *
 * The service-categories analogue of {@link import("./serviceMigration")}. Two
 * READ-ONLY development/admin utilities:
 *
 *   1. `migrateServiceCategories()` — copies localStorage categories INTO the
 *      Supabase `service_categories` table (idempotent upsert on `legacy_id`,
 *      `dryRun` mode). GLOBAL categories (companyId === null) migrate with
 *      `company_id = null`; company categories whose company has no Supabase row
 *      are skipped + reported.
 *
 *   2. `shadowReadServiceCategories()` — diffs localStorage vs Supabase for a
 *      scope (count / id set / name parity / detail payload).
 */
import { getServiceCategories } from "@/lib/store";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import type { ServiceCategory } from "@/types";
import { loadCompanyUuidMap } from "./customerMigration";
import {
  listServiceCategorySummariesFromSupabase,
  listFullServiceCategoriesFromSupabase,
} from "./supabaseServiceCategoryRepository";

/** A single upsert row written to (or planned for) `service_categories`. */
export interface ServiceCategoryUpsertRow {
  legacy_id: string;
  company_id: string | null;
  company_legacy_id: string | null;
  name: string;
  status: string;
  deleted_at: string | null;
  data: ServiceCategory;
}

/** Structured outcome of a category migration run (or dry-run). */
export interface ServiceCategoryMigrationReport {
  ok: boolean;
  dryRun: boolean;
  companyId: string | null;
  sourceCount: number;
  plannedCount: number;
  writtenCount: number;
  skipped: Array<{ id: string; reason: string }>;
  error?: string;
}

function scopeByCompany(
  categories: ServiceCategory[],
  companyId: string | null | undefined,
): ServiceCategory[] {
  if (companyId === undefined || companyId === null) return categories;
  return categories.filter((c) => c.companyId === companyId);
}

/**
 * Maps a localStorage {@link ServiceCategory} to a `service_categories` upsert
 * row. Shared by the migration utility and the dual-write mirror so both write
 * byte-identical rows. GLOBAL categories pass `companyUuid = null`.
 */
export function toServiceCategoryUpsertRow(
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

/** Migrates localStorage service categories into Supabase. */
export async function migrateServiceCategories(options?: {
  companyId?: string | null;
  dryRun?: boolean;
}): Promise<ServiceCategoryMigrationReport> {
  const companyId = options?.companyId ?? null;
  const dryRun = options?.dryRun ?? false;

  const source = scopeByCompany(getServiceCategories(), companyId);
  const report: ServiceCategoryMigrationReport = {
    ok: false,
    dryRun,
    companyId,
    sourceCount: source.length,
    plannedCount: 0,
    writtenCount: 0,
    skipped: [],
  };

  if (!isSupabaseConfigured || !supabase) {
    report.error = "Supabase is not configured.";
    return report;
  }

  const companyMap = await loadCompanyUuidMap();
  const rows: ServiceCategoryUpsertRow[] = [];
  for (const category of source) {
    if (category.companyId === null) {
      rows.push(toServiceCategoryUpsertRow(category, null));
      continue;
    }
    const uuid = companyMap.get(category.companyId) ?? null;
    if (!uuid) {
      report.skipped.push({
        id: category.id,
        reason: `No Supabase company found for legacy_id "${category.companyId}". Migrate companies first.`,
      });
      continue;
    }
    rows.push(toServiceCategoryUpsertRow(category, uuid));
  }
  report.plannedCount = rows.length;

  if (dryRun || rows.length === 0) {
    report.ok = report.skipped.length === 0;
    return report;
  }

  const CHUNK = 200;
  try {
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const { error } = await supabase
        .from("service_categories")
        .upsert(chunk, { onConflict: "legacy_id" });
      if (error) {
        report.error = `Upsert failed at chunk ${i / CHUNK}: ${error.message}`;
        report.writtenCount = i;
        return report;
      }
    }
    report.writtenCount = rows.length;
    report.ok = report.skipped.length === 0;
    return report;
  } catch (err) {
    report.error = err instanceof Error ? err.message : "Unknown migration error.";
    return report;
  }
}

/** Per-aspect outcome of a localStorage-vs-Supabase category comparison. */
export interface ServiceCategoryShadowReport {
  ok: boolean;
  companyId: string | null;
  localCount: number;
  supabaseCount: number;
  countMatch: boolean;
  idsMatch: boolean;
  summaryMatch: boolean;
  detailMatch: boolean;
  missingInSupabase: string[];
  extraInSupabase: string[];
  notes: string[];
}

function idSetDiff(a: string[], b: string[]): { onlyA: string[]; onlyB: string[] } {
  const setB = new Set(b);
  const setA = new Set(a);
  return { onlyA: a.filter((id) => !setB.has(id)), onlyB: b.filter((id) => !setA.has(id)) };
}

/** Compares localStorage service categories against the Supabase shadow copy. */
export async function shadowReadServiceCategories(
  companyId?: string | null,
): Promise<ServiceCategoryShadowReport> {
  const scope = companyId ?? null;
  const queryScope = companyId ?? undefined;
  const notes: string[] = [];

  const allLocal = getServiceCategories();
  const local =
    queryScope === undefined
      ? allLocal
      : allLocal.filter((c) => c.companyId === queryScope || c.companyId === null);

  const report: ServiceCategoryShadowReport = {
    ok: false,
    companyId: scope,
    localCount: local.length,
    supabaseCount: 0,
    countMatch: false,
    idsMatch: false,
    summaryMatch: false,
    detailMatch: false,
    missingInSupabase: [],
    extraInSupabase: [],
    notes,
  };

  if (!isSupabaseConfigured || !supabase) {
    notes.push("Supabase is not configured.");
    return report;
  }

  let remote: Awaited<ReturnType<typeof listServiceCategorySummariesFromSupabase>>;
  try {
    remote = await listServiceCategorySummariesFromSupabase(queryScope);
  } catch (err) {
    notes.push(err instanceof Error ? err.message : "Supabase read failed.");
    return report;
  }

  report.supabaseCount = remote.length;
  report.countMatch = local.length === remote.length;
  if (!report.countMatch) {
    notes.push(`count mismatch: local ${local.length} vs supabase ${remote.length}`);
  }

  const { onlyA, onlyB } = idSetDiff(local.map((c) => c.id), remote.map((c) => c.id));
  report.missingInSupabase = onlyA;
  report.extraInSupabase = onlyB;
  report.idsMatch = onlyA.length === 0 && onlyB.length === 0;
  if (onlyA.length > 0) notes.push(`${onlyA.length} category(ies) not yet in Supabase`);
  if (onlyB.length > 0) notes.push(`${onlyB.length} extra category(ies) in Supabase`);

  const remoteById = new Map(remote.map((c) => [c.id, c] as const));
  let summaryMatch = true;
  for (const l of local) {
    const r = remoteById.get(l.id);
    if (!r) continue;
    if (r.name !== l.name || (r.companyId ?? null) !== (l.companyId ?? null)) {
      summaryMatch = false;
      notes.push(`summary mismatch for ${l.id}`);
      break;
    }
  }
  report.summaryMatch = summaryMatch;

  let detailMatch = true;
  const sample = local.find((l) => remoteById.has(l.id));
  if (sample) {
    try {
      const remoteFull = await listFullServiceCategoriesFromSupabase(queryScope);
      const remoteDetail = remoteFull.find((c) => c.id === sample.id) ?? null;
      detailMatch =
        Boolean(remoteDetail) && JSON.stringify(remoteDetail) === JSON.stringify(sample);
      if (!detailMatch) notes.push(`detail mismatch for ${sample.id}`);
    } catch (err) {
      detailMatch = false;
      notes.push(err instanceof Error ? err.message : "detail read failed");
    }
  }
  report.detailMatch = detailMatch;

  report.ok =
    report.countMatch && report.idsMatch && report.summaryMatch && report.detailMatch;
  return report;
}

if (import.meta.env.DEV === true && typeof window !== "undefined") {
  const w = window as unknown as { __cleanopsData?: Record<string, unknown> };
  w.__cleanopsData = {
    ...(w.__cleanopsData ?? {}),
    migrateServiceCategories,
    shadowReadServiceCategories,
  };
}
