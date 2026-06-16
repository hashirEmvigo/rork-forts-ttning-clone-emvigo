/**
 * Postal City migration + shadow-read tooling (AREA-1).
 *
 * The Postal Cities analogue of {@link import("./areaMigration")}. Two READ-ONLY
 * development/admin utilities: `migratePostalCities()` (idempotent upsert on
 * `legacy_id`, `dryRun`, skip+report companies with no Supabase row) and
 * `shadowReadPostalCities()` (count / id / name / detail parity). The CRITICAL
 * guarantee is `legacy_id` stability — customers reference a postal city by id.
 */
import { getPostalCities } from "@/lib/store";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import type { PostalCity } from "@/types";
import { loadCompanyUuidMap } from "./customerMigration";
import {
  listPostalCitySummariesFromSupabase,
  listFullPostalCitiesFromSupabase,
} from "./supabasePostalCityRepository";

/** A single upsert row written to (or planned for) the `postal_cities` table. */
export interface PostalCityUpsertRow {
  legacy_id: string;
  company_id: string | null;
  company_legacy_id: string;
  name: string;
  area_legacy_id: string;
  is_active: boolean;
  deleted_at: string | null;
  data: PostalCity;
}

/** Structured outcome of a postal-city migration run (or dry-run). */
export interface PostalCityMigrationReport {
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
  cities: PostalCity[],
  companyId: string | null | undefined,
): PostalCity[] {
  if (companyId === undefined || companyId === null) return cities;
  return cities.filter((c) => c.companyId === companyId);
}

/** Maps a localStorage {@link PostalCity} to a `postal_cities` upsert row. */
export function toPostalCityUpsertRow(
  city: PostalCity,
  companyUuid: string | null,
): PostalCityUpsertRow {
  return {
    legacy_id: city.id,
    company_id: companyUuid,
    company_legacy_id: city.companyId,
    name: city.name,
    area_legacy_id: city.areaId,
    is_active: city.isActive,
    deleted_at: null,
    data: city,
  };
}

/** Migrates localStorage postal cities into Supabase. */
export async function migratePostalCities(options?: {
  companyId?: string | null;
  dryRun?: boolean;
}): Promise<PostalCityMigrationReport> {
  const companyId = options?.companyId ?? null;
  const dryRun = options?.dryRun ?? false;

  const source = scopeByCompany(getPostalCities(), companyId);
  const report: PostalCityMigrationReport = {
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
  const rows: PostalCityUpsertRow[] = [];
  for (const city of source) {
    const uuid = companyMap.get(city.companyId) ?? null;
    if (!uuid) {
      report.skipped.push({
        id: city.id,
        reason: `No Supabase company found for legacy_id "${city.companyId}". Migrate companies first.`,
      });
      continue;
    }
    rows.push(toPostalCityUpsertRow(city, uuid));
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
        .from("postal_cities")
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

/** Per-aspect outcome of a localStorage-vs-Supabase postal-city comparison. */
export interface PostalCityShadowReport {
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

/** Compares localStorage postal cities against the Supabase shadow copy. */
export async function shadowReadPostalCities(
  companyId?: string | null,
): Promise<PostalCityShadowReport> {
  const scope = companyId ?? null;
  const queryScope = companyId ?? undefined;
  const notes: string[] = [];

  const local = scopeByCompany(getPostalCities(), queryScope);

  const report: PostalCityShadowReport = {
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

  let remote: Awaited<ReturnType<typeof listPostalCitySummariesFromSupabase>>;
  try {
    remote = await listPostalCitySummariesFromSupabase(queryScope);
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
  if (onlyA.length > 0) notes.push(`${onlyA.length} postal city(ies) not yet in Supabase`);
  if (onlyB.length > 0) notes.push(`${onlyB.length} extra postal city(ies) in Supabase`);

  const remoteById = new Map(remote.map((c) => [c.id, c] as const));
  let summaryMatch = true;
  for (const l of local) {
    const r = remoteById.get(l.id);
    if (!r) continue;
    if (r.name !== l.name || r.companyId !== l.companyId || r.areaId !== l.areaId) {
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
      const remoteFull = await listFullPostalCitiesFromSupabase(queryScope);
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
    migratePostalCities,
    shadowReadPostalCities,
  };
}
