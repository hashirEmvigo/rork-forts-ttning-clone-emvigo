/**
 * Asset Center — URL resolution (Phase 1 foundation).
 *
 * Resolves a viewable URL for an asset's stored object at READ time:
 *   • PUBLIC bucket  → a stable public URL (no expiry, no auth).
 *   • PRIVATE bucket → a short-lived SIGNED URL minted on demand.
 *
 * CRITICAL: signed URLs are NEVER persisted to the database — they are computed
 * here per-request. Only `storage_bucket` + `storage_path` live in the row.
 */
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import type { Asset, AssetStorageBucket } from "./assetTypes";
import { PUBLIC_BUCKET } from "./assetStorage";

/** Default signed-URL lifetime for private objects (1 hour). */
export const DEFAULT_SIGNED_URL_TTL_SECONDS = 3600;

/** Returns the stable public URL for an object in a (public) bucket. */
export function resolvePublicUrl(
  bucket: AssetStorageBucket,
  path: string,
): string | null {
  if (!isSupabaseConfigured || !supabase) return null;
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data?.publicUrl ?? null;
}

/**
 * Mints short-lived signed URLs for many private objects in ONE round-trip,
 * returned as a `path → signedUrl` map (paths that fail to sign are omitted).
 * All paths must live in the same bucket. Never persist the results.
 */
export async function createSignedUrls(
  bucket: AssetStorageBucket,
  paths: string[],
  expiresInSeconds: number = DEFAULT_SIGNED_URL_TTL_SECONDS,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!isSupabaseConfigured || !supabase || paths.length === 0) return out;
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrls(paths, expiresInSeconds);
  if (error) {
    console.error(`[storage:${bucket}] batch signed URLs failed: ${error.message}`);
    return out;
  }
  for (const row of data ?? []) {
    if (row.path && row.signedUrl) out.set(row.path, row.signedUrl);
  }
  return out;
}

/** Mints a short-lived signed URL for a private object. Never persist the result. */
export async function createSignedUrl(
  bucket: AssetStorageBucket,
  path: string,
  expiresInSeconds: number = DEFAULT_SIGNED_URL_TTL_SECONDS,
): Promise<string | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, expiresInSeconds);
  if (error) {
    console.error(`[storage:${bucket}] signed URL failed: ${error.message}`);
    return null;
  }
  return data?.signedUrl ?? null;
}

/**
 * Resolves the best viewable URL for an asset's original object:
 *   • already-stored `publicUrl` → returned as-is.
 *   • public bucket → public URL.
 *   • private bucket → freshly minted signed URL.
 * Returns null when the asset has no stored object or Supabase is unconfigured.
 */
export async function resolveAssetUrl(
  asset: Pick<Asset, "storageBucket" | "storagePath" | "publicUrl">,
  expiresInSeconds: number = DEFAULT_SIGNED_URL_TTL_SECONDS,
): Promise<string | null> {
  if (asset.publicUrl) return asset.publicUrl;
  if (!asset.storageBucket || !asset.storagePath) return null;
  if (asset.storageBucket === PUBLIC_BUCKET) {
    return resolvePublicUrl(asset.storageBucket, asset.storagePath);
  }
  return createSignedUrl(asset.storageBucket, asset.storagePath, expiresInSeconds);
}
