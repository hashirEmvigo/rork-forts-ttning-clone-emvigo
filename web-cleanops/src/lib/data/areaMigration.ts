/**
 * Area migration + shadow-read tooling (AREA-1).
 *
 * The Areas analogue of {@link import("./teamMigration")}. Two READ-ONLY
 * development/admin utilities:
 *
 *   1. `migrateAreas()` — copies localStorage areas INTO the Supabase `areas`
 *      table (idempotent upsert on `legacy_id`, `dryRun` mode). Areas whose
 *      company has no Supabase row are skipped + reported.
 *   2. `shadowReadAreas()` — diffs localStorage vs Supabase for a company scope
 *      (count / id set / name parity / detail payload).
 *
 * localStorage stays the source of truth; these tools only populate + verify.
 * The CRITICAL guarantee is `legacy_id` stability — customers reference an area
 * by Customer.areaId and postal cities reference it by areaId.
 */
import { getAreas } from "@/lib/store";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import type { Area } from "@/types";
import { loadCompanyUuidMap } from "./customerMigration";
import {
  listAreaSummariesFromSupabase,
  listFullAreasFromSupabase,
} from "./supabaseAreaRepository";

/** A single upsert row written to (or planned for) the `areas` table. */
export interface AreaUpsertRow {
  legacy_id: string;
  company_id: string | null;
  company_legacy_id: string;
  name: string;
  is_active: boolean;
  deleted_at: string | null;
  data: Area;
}

/** Structured outcome of an area migration run (or dry-run). */
export interface AreaMigrationReport {
  ok: boolean;
  dryRun: boolean;
  companyId: string | null;
  sourceCount: number;
  plannedCount: number;
  writtenCount: number;
  skipped: Array<{ id: string; reason: string }>;
  error?: string;
}

function scopeByCompany(areas: Area[], companyId: string | null | undefined): Area[] {
  if (companyId === undefined || companyId === null) return areas;
  return areas.filter((a) => a.companyId === companyId);
}

/**
 * Maps a localStorage {@link Area} to an `areas` upsert row. Shared by the
 * migration utility and the dual-write mirror so both write byte-identical rows.
 */
export function toAreaUpsertRow(area: Area, companyUuid: string | null): AreaUpsertRow {
  return {
    legacy_id: area.id,
    company_id: companyUuid,
    company_legacy_id: area.companyId,
    name: area.name,
    is_active: area.isActive,
    deleted_at: null,
    data: area,
  };
}

/** Migrates localStorage areas into Supabase. */
export async function migrateAreas(options?: {
  companyId?: string | null;
  dryRun?: boolean;
}): Promise<AreaMigrationReport> {
  const companyId = options?.companyId ?? null;
  const dryRun = options?.dryRun ?? false;

  const source = scopeByCompany(getAreas(), companyId);
  const report: AreaMigrationReport = {
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
  const rows: AreaUpsertRow[] = [];
  for (const area of source) {
    const uuid = companyMap.get(area.companyId) ?? null;
    if (!uuid) {
      report.skipped.push({
        id: area.id,
        reason: `No Supabase company found for legacy_id "${area.companyId}". Migrate companies first.`,
      });
      continue;
    }
    rows.push(toAreaUpsertRow(area, uuid));
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
      const { error } = await supabase.from("areas").upsert(chunk, { onConflict: "legacy_id" });
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

/** Per-aspect outcome of a localStorage-vs-Supabase area comparison. */
export interface AreaShadowReport {
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

/** Compares localStorage areas against the Supabase shadow copy for a scope. */
export async function shadowReadAreas(companyId?: string | null): Promise<AreaShadowReport> {
  const scope = companyId ?? null;
  const queryScope = companyId ?? undefined;
  const notes: string[] = [];

  const local = scopeByCompany(getAreas(), queryScope);

  const report: AreaShadowReport = {
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

  let remote: Awaited<ReturnType<typeof listAreaSummariesFromSupabase>>;
  try {
    remote = await listAreaSummariesFromSupabase(queryScope);
  } catch (err) {
    notes.push(err instanceof Error ? err.message : "Supabase read failed.");
    return report;
  }

  report.supabaseCount = remote.length;
  report.countMatch = local.length === remote.length;
  if (!report.countMatch) {
    notes.push(`count mismatch: local ${local.length} vs supabase ${remote.length}`);
  }

  const { onlyA, onlyB } = idSetDiff(local.map((a) => a.id), remote.map((a) => a.id));
  report.missingInSupabase = onlyA;
  report.extraInSupabase = onlyB;
  report.idsMatch = onlyA.length === 0 && onlyB.length === 0;
  if (onlyA.length > 0) notes.push(`${onlyA.length} area(s) not yet in Supabase`);
  if (onlyB.length > 0) notes.push(`${onlyB.length} extra area(s) in Supabase`);

  const remoteById = new Map(remote.map((a) => [a.id, a] as const));
  let summaryMatch = true;
  for (const l of local) {
    const r = remoteById.get(l.id);
    if (!r) continue;
    if (r.name !== l.name || r.companyId !== l.companyId) {
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
      const remoteFull = await listFullAreasFromSupabase(queryScope);
      const remoteDetail = remoteFull.find((a) => a.id === sample.id) ?? null;
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
    migrateAreas,
    shadowReadAreas,
  };
}
