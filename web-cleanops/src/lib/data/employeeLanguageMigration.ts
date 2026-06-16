/**
 * Employee Language migration + shadow-read tooling (AREA-1).
 *
 * The Employee Languages analogue of {@link import("./areaMigration")}. Two
 * READ-ONLY development/admin utilities: `migrateEmployeeLanguages()`
 * (idempotent upsert on `legacy_id`, `dryRun`, skip+report companies with no
 * Supabase row) and `shadowReadEmployeeLanguages()` (count / id / code+name /
 * detail parity). The CRITICAL guarantee is `legacy_id` stability — employees
 * reference a language by languageId / secondaryLanguageId.
 */
import { getEmployeeLanguages } from "@/lib/store";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import type { EmployeeLanguage } from "@/types";
import { loadCompanyUuidMap } from "./customerMigration";
import {
  listEmployeeLanguageSummariesFromSupabase,
  listFullEmployeeLanguagesFromSupabase,
} from "./supabaseEmployeeLanguageRepository";

/** A single upsert row written to (or planned for) the `employee_languages` table. */
export interface EmployeeLanguageUpsertRow {
  legacy_id: string;
  company_id: string | null;
  company_legacy_id: string;
  code: string;
  name: string;
  is_active: boolean;
  is_default: boolean;
  deleted_at: string | null;
  data: EmployeeLanguage;
}

/** Structured outcome of a language migration run (or dry-run). */
export interface EmployeeLanguageMigrationReport {
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
  languages: EmployeeLanguage[],
  companyId: string | null | undefined,
): EmployeeLanguage[] {
  if (companyId === undefined || companyId === null) return languages;
  return languages.filter((l) => l.companyId === companyId);
}

/** Maps a localStorage {@link EmployeeLanguage} to an upsert row. */
export function toEmployeeLanguageUpsertRow(
  language: EmployeeLanguage,
  companyUuid: string | null,
): EmployeeLanguageUpsertRow {
  return {
    legacy_id: language.id,
    company_id: companyUuid,
    company_legacy_id: language.companyId,
    code: language.code,
    name: language.name,
    is_active: language.isActive,
    is_default: language.isDefault,
    deleted_at: null,
    data: language,
  };
}

/** Migrates localStorage employee languages into Supabase. */
export async function migrateEmployeeLanguages(options?: {
  companyId?: string | null;
  dryRun?: boolean;
}): Promise<EmployeeLanguageMigrationReport> {
  const companyId = options?.companyId ?? null;
  const dryRun = options?.dryRun ?? false;

  const source = scopeByCompany(getEmployeeLanguages(), companyId);
  const report: EmployeeLanguageMigrationReport = {
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
  const rows: EmployeeLanguageUpsertRow[] = [];
  for (const language of source) {
    const uuid = companyMap.get(language.companyId) ?? null;
    if (!uuid) {
      report.skipped.push({
        id: language.id,
        reason: `No Supabase company found for legacy_id "${language.companyId}". Migrate companies first.`,
      });
      continue;
    }
    rows.push(toEmployeeLanguageUpsertRow(language, uuid));
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
        .from("employee_languages")
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

/** Per-aspect outcome of a localStorage-vs-Supabase language comparison. */
export interface EmployeeLanguageShadowReport {
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

/** Compares localStorage employee languages against the Supabase shadow copy. */
export async function shadowReadEmployeeLanguages(
  companyId?: string | null,
): Promise<EmployeeLanguageShadowReport> {
  const scope = companyId ?? null;
  const queryScope = companyId ?? undefined;
  const notes: string[] = [];

  const local = scopeByCompany(getEmployeeLanguages(), queryScope);

  const report: EmployeeLanguageShadowReport = {
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

  let remote: Awaited<ReturnType<typeof listEmployeeLanguageSummariesFromSupabase>>;
  try {
    remote = await listEmployeeLanguageSummariesFromSupabase(queryScope);
  } catch (err) {
    notes.push(err instanceof Error ? err.message : "Supabase read failed.");
    return report;
  }

  report.supabaseCount = remote.length;
  report.countMatch = local.length === remote.length;
  if (!report.countMatch) {
    notes.push(`count mismatch: local ${local.length} vs supabase ${remote.length}`);
  }

  const { onlyA, onlyB } = idSetDiff(local.map((l) => l.id), remote.map((l) => l.id));
  report.missingInSupabase = onlyA;
  report.extraInSupabase = onlyB;
  report.idsMatch = onlyA.length === 0 && onlyB.length === 0;
  if (onlyA.length > 0) notes.push(`${onlyA.length} language(s) not yet in Supabase`);
  if (onlyB.length > 0) notes.push(`${onlyB.length} extra language(s) in Supabase`);

  const remoteById = new Map(remote.map((l) => [l.id, l] as const));
  let summaryMatch = true;
  for (const l of local) {
    const r = remoteById.get(l.id);
    if (!r) continue;
    if (r.name !== l.name || r.code !== l.code || r.companyId !== l.companyId) {
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
      const remoteFull = await listFullEmployeeLanguagesFromSupabase(queryScope);
      const remoteDetail = remoteFull.find((l) => l.id === sample.id) ?? null;
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
    migrateEmployeeLanguages,
    shadowReadEmployeeLanguages,
  };
}
