/**
 * Company Settings migration + shadow-read tooling (SET-1).
 *
 * The company-settings analogue of {@link import("./areaMigration")}, with one
 * twist: a {@link CompanySettings} record's identity IS its companyId (there is
 * no separate id), so `legacy_id == companyId`. Two READ-ONLY utilities:
 *
 *   1. `migrateCompanySettings()` — idempotent upsert on `legacy_id` into the
 *      `company_settings` table, `dryRun` mode. Records whose company has no
 *      Supabase row are skipped + reported.
 *   2. `shadowReadCompanySettings()` — count / id-set / initialized / detail
 *      parity for a company scope.
 */
import { getCompanySettings } from "@/lib/store";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import type { CompanySettings } from "@/types";
import { loadCompanyUuidMap } from "./customerMigration";
import {
  listCompanySettingsSummariesFromSupabase,
  listFullCompanySettingsFromSupabase,
} from "./supabaseCompanySettingsRepository";

/** A single upsert row written to (or planned for) `company_settings`. */
export interface CompanySettingsUpsertRow {
  legacy_id: string;
  company_id: string | null;
  company_legacy_id: string;
  initialized: boolean;
  source_template_id: string | null;
  deleted_at: string | null;
  data: CompanySettings;
}

/** Structured outcome of a company-settings migration run (or dry-run). */
export interface CompanySettingsMigrationReport {
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
  settings: CompanySettings[],
  companyId: string | null | undefined,
): CompanySettings[] {
  if (companyId === undefined || companyId === null) return settings;
  return settings.filter((s) => s.companyId === companyId);
}

/**
 * Maps a localStorage {@link CompanySettings} to a `company_settings` row. The
 * record's identity is its companyId, so `legacy_id == companyId`.
 */
export function toCompanySettingsUpsertRow(
  settings: CompanySettings,
  companyUuid: string | null,
): CompanySettingsUpsertRow {
  return {
    legacy_id: settings.companyId,
    company_id: companyUuid,
    company_legacy_id: settings.companyId,
    initialized: settings.initialized,
    source_template_id: settings.sourceTemplateId ?? null,
    deleted_at: null,
    data: settings,
  };
}

/** Migrates localStorage company settings into Supabase. */
export async function migrateCompanySettings(options?: {
  companyId?: string | null;
  dryRun?: boolean;
}): Promise<CompanySettingsMigrationReport> {
  const companyId = options?.companyId ?? null;
  const dryRun = options?.dryRun ?? false;

  const source = scopeByCompany(getCompanySettings(), companyId);
  const report: CompanySettingsMigrationReport = {
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
  const rows: CompanySettingsUpsertRow[] = [];
  for (const settings of source) {
    const uuid = companyMap.get(settings.companyId) ?? null;
    if (!uuid) {
      report.skipped.push({
        id: settings.companyId,
        reason: `No Supabase company found for legacy_id "${settings.companyId}". Migrate companies first.`,
      });
      continue;
    }
    rows.push(toCompanySettingsUpsertRow(settings, uuid));
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
        .from("company_settings")
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

/** Per-aspect outcome of a localStorage-vs-Supabase company-settings comparison. */
export interface CompanySettingsShadowReport {
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

/** Compares localStorage company settings against the Supabase shadow copy. */
export async function shadowReadCompanySettings(
  companyId?: string | null,
): Promise<CompanySettingsShadowReport> {
  const scope = companyId ?? null;
  const queryScope = companyId ?? undefined;
  const notes: string[] = [];

  const local = scopeByCompany(getCompanySettings(), queryScope);

  const report: CompanySettingsShadowReport = {
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

  let remote: Awaited<ReturnType<typeof listCompanySettingsSummariesFromSupabase>>;
  try {
    remote = await listCompanySettingsSummariesFromSupabase(queryScope);
  } catch (err) {
    notes.push(err instanceof Error ? err.message : "Supabase read failed.");
    return report;
  }

  report.supabaseCount = remote.length;
  report.countMatch = local.length === remote.length;
  if (!report.countMatch) {
    notes.push(`count mismatch: local ${local.length} vs supabase ${remote.length}`);
  }

  const { onlyA, onlyB } = idSetDiff(
    local.map((s) => s.companyId),
    remote.map((s) => s.id),
  );
  report.missingInSupabase = onlyA;
  report.extraInSupabase = onlyB;
  report.idsMatch = onlyA.length === 0 && onlyB.length === 0;
  if (onlyA.length > 0) notes.push(`${onlyA.length} company-settings record(s) not yet in Supabase`);
  if (onlyB.length > 0) notes.push(`${onlyB.length} extra company-settings record(s) in Supabase`);

  const remoteById = new Map(remote.map((s) => [s.id, s] as const));
  let summaryMatch = true;
  for (const l of local) {
    const r = remoteById.get(l.companyId);
    if (!r) continue;
    if (r.companyId !== l.companyId || r.initialized !== l.initialized) {
      summaryMatch = false;
      notes.push(`summary mismatch for ${l.companyId}`);
      break;
    }
  }
  report.summaryMatch = summaryMatch;

  let detailMatch = true;
  const sample = local.find((l) => remoteById.has(l.companyId));
  if (sample) {
    try {
      const remoteFull = await listFullCompanySettingsFromSupabase(queryScope);
      const remoteDetail = remoteFull.find((s) => s.companyId === sample.companyId) ?? null;
      detailMatch =
        Boolean(remoteDetail) && JSON.stringify(remoteDetail) === JSON.stringify(sample);
      if (!detailMatch) notes.push(`detail mismatch for ${sample.companyId}`);
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
    migrateCompanySettings,
    shadowReadCompanySettings,
  };
}
