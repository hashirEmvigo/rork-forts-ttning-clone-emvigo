/**
 * Media Asset migration + shadow-read tooling (MEDIA-1).
 *
 * The Media analogue of {@link import("./areaMigration")}. Media assets are
 * company-scoped; an asset whose company has no Supabase row is skipped +
 * reported. The localStorage source is read directly from the `cleanops.media`
 * key so the tool stays self-contained (the store's reader is not exported).
 */
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import type { MediaAsset } from "@/types";
import { loadCompanyUuidMap } from "./customerMigration";
import {
  listMediaAssetSummariesFromSupabase,
  listFullMediaAssetsFromSupabase,
} from "./supabaseMediaAssetRepository";

const MEDIA_KEY = "cleanops.mediaAssets";

/** Reads the raw localStorage media assets (source of truth today). */
export function readLocalMediaAssets(): MediaAsset[] {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(MEDIA_KEY) : null;
    return raw ? (JSON.parse(raw) as MediaAsset[]) : [];
  } catch {
    return [];
  }
}

/** A single upsert row written to (or planned for) the `media_assets` table. */
export interface MediaAssetUpsertRow {
  legacy_id: string;
  company_id: string | null;
  company_legacy_id: string;
  category: string;
  entity_type: string;
  entity_id: string;
  deleted_at: string | null;
  data: MediaAsset;
}

/** Structured outcome of a media migration run (or dry-run). */
export interface MediaAssetMigrationReport {
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
  assets: MediaAsset[],
  companyId: string | null | undefined,
): MediaAsset[] {
  if (companyId === undefined || companyId === null) return assets;
  return assets.filter((a) => a.companyId === companyId);
}

/** Maps a localStorage {@link MediaAsset} to a `media_assets` upsert row. */
export function toMediaAssetUpsertRow(
  asset: MediaAsset,
  companyUuid: string | null,
): MediaAssetUpsertRow {
  return {
    legacy_id: asset.id,
    company_id: companyUuid,
    company_legacy_id: asset.companyId,
    category: asset.category,
    entity_type: asset.entityType,
    entity_id: asset.entityId,
    deleted_at: null,
    data: asset,
  };
}

/** Migrates localStorage media assets into Supabase. */
export async function migrateMediaAssets(options?: {
  companyId?: string | null;
  dryRun?: boolean;
}): Promise<MediaAssetMigrationReport> {
  const companyId = options?.companyId ?? null;
  const dryRun = options?.dryRun ?? false;

  const source = scopeByCompany(readLocalMediaAssets(), companyId);
  const report: MediaAssetMigrationReport = {
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
  const rows: MediaAssetUpsertRow[] = [];
  for (const asset of source) {
    const uuid = companyMap.get(asset.companyId) ?? null;
    if (!uuid) {
      report.skipped.push({
        id: asset.id,
        reason: `No Supabase company found for legacy_id "${asset.companyId}". Migrate companies first.`,
      });
      continue;
    }
    rows.push(toMediaAssetUpsertRow(asset, uuid));
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
        .from("media_assets")
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

/** Per-aspect outcome of a localStorage-vs-Supabase media comparison. */
export interface MediaAssetShadowReport {
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

/** Compares localStorage media against the Supabase shadow copy for a scope. */
export async function shadowReadMediaAssets(
  companyId?: string | null,
): Promise<MediaAssetShadowReport> {
  const scope = companyId ?? null;
  const queryScope = companyId ?? undefined;
  const notes: string[] = [];

  const local = scopeByCompany(readLocalMediaAssets(), queryScope);

  const report: MediaAssetShadowReport = {
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

  let remote: Awaited<ReturnType<typeof listMediaAssetSummariesFromSupabase>>;
  try {
    remote = await listMediaAssetSummariesFromSupabase(queryScope);
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
  if (onlyA.length > 0) notes.push(`${onlyA.length} asset(s) not yet in Supabase`);
  if (onlyB.length > 0) notes.push(`${onlyB.length} extra asset(s) in Supabase`);

  const remoteById = new Map(remote.map((a) => [a.id, a] as const));
  let summaryMatch = true;
  for (const l of local) {
    const r = remoteById.get(l.id);
    if (!r) continue;
    if (r.companyId !== l.companyId || r.category !== l.category) {
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
      const remoteFull = await listFullMediaAssetsFromSupabase(queryScope);
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
    migrateMediaAssets,
    shadowReadMediaAssets,
  };
}
