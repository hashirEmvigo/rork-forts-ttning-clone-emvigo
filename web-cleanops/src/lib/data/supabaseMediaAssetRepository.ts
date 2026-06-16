/**
 * Supabase-backed Media Asset read repository (MEDIA-1).
 *
 * The Media analogue of {@link import("./supabaseAreaRepository")}. Reads the
 * `media_assets` table (migration 0027) and returns the SAME {@link MediaAsset}
 * shapes the localStorage store returns. Media assets are company-scoped (no
 * global rows). Soft-deleted rows (`deleted_at` set) are filtered out.
 */
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import type { MediaAsset } from "@/types";

const SUMMARY_COLUMNS =
  "legacy_id, company_legacy_id, category, entity_type, entity_id, deleted_at";

/** Lightweight media row for count / id-set parity checks. */
export interface MediaAssetSummary {
  id: string;
  companyId: string;
  category: string;
  entityType: string;
  entityId: string;
}

interface MediaAssetSummaryRow {
  legacy_id: string;
  company_legacy_id: string;
  category: string;
  entity_type: string;
  entity_id: string;
  deleted_at: string | null;
}

interface MediaAssetFullRow {
  data: MediaAsset;
  company_legacy_id: string;
  deleted_at: string | null;
}

class SupabaseNotConfiguredError extends Error {
  constructor() {
    super(
      "SupabaseMediaAssetRepository requires Supabase. Set EXPO_PUBLIC_SUPABASE_URL " +
        "and EXPO_PUBLIC_SUPABASE_ANON_KEY.",
    );
    this.name = "SupabaseNotConfiguredError";
  }
}

function rowToSummary(row: MediaAssetSummaryRow): MediaAssetSummary {
  return {
    id: row.legacy_id,
    companyId: row.company_legacy_id,
    category: row.category,
    entityType: row.entity_type,
    entityId: row.entity_id,
  };
}

/** Company-scoped media summary rows. Soft-deleted rows filtered out. */
export async function listMediaAssetSummariesFromSupabase(
  companyId?: string | null,
): Promise<MediaAssetSummary[]> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const stop = perf.start("mediaAssets.list.supabase.summaries");
  try {
    let query = supabase.from("media_assets").select(SUMMARY_COLUMNS);
    if (companyId !== undefined && companyId !== null) {
      query = query.eq("company_legacy_id", companyId);
    }
    const { data, error } = await query;
    if (error) throw new Error(`[media_assets] Supabase list failed: ${error.message}`);
    const rows = (data ?? []) as unknown as MediaAssetSummaryRow[];
    return rows.filter((r) => !r.deleted_at).map(rowToSummary);
  } finally {
    stop();
  }
}

/** FULL media records (lossless `data` jsonb) for a company scope. */
export async function listFullMediaAssetsFromSupabase(
  companyId?: string | null,
): Promise<MediaAsset[]> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const stop = perf.start("mediaAssets.list.supabase.full");
  perf.count("mediaAssets.list.supabase.full.calls");
  try {
    let query = supabase
      .from("media_assets")
      .select("data, company_legacy_id, deleted_at");
    if (companyId !== undefined && companyId !== null) {
      query = query.eq("company_legacy_id", companyId);
    }
    const { data, error } = await query;
    if (error) throw new Error(`[media_assets] Supabase full list failed: ${error.message}`);
    const rows = (data ?? []) as unknown as MediaAssetFullRow[];
    return rows
      .filter((r) => !r.deleted_at)
      .map((r) => r.data)
      .filter((a): a is MediaAsset => Boolean(a));
  } finally {
    stop();
  }
}
