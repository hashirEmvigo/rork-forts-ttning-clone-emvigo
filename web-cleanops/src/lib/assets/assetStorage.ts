/**
 * Asset Center — storage helpers (Phase 1 foundation).
 *
 * Bucket constants, path builders and client-side validation for Supabase
 * Storage (buckets created by migration 0056). Two guarantees live here:
 *   1. Bucket selection follows scope — public scopes → `public-assets`,
 *      everything else → `private-assets` (never make private assets public).
 *   2. The PRIVATE company path's company segment is the company UUID, because
 *      storage RLS matches it against `current_company_id()` (see 0056).
 *
 * Upload/remove wrap the Supabase Storage SDK behind the same `isSupabaseConfigured`
 * guard the rest of the data layer uses.
 */
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import type { AssetScope, AssetStorageBucket, AssetType } from "./assetTypes";

export const PUBLIC_BUCKET: AssetStorageBucket = "public-assets";
export const PRIVATE_BUCKET: AssetStorageBucket = "private-assets";

/** Per-object size ceiling (mirrors the 50 MB `file_size_limit` set in 0056). */
export const MAX_ASSET_BYTES = 52_428_800;

/** Scopes whose objects live in the public bucket / are world-readable. */
const PUBLIC_SCOPES: ReadonlySet<AssetScope> = new Set<AssetScope>([
  "global_public",
  "website_public",
]);

/** Returns the bucket an asset of the given scope must be stored in. */
export function bucketForScope(scope: AssetScope): AssetStorageBucket {
  return PUBLIC_SCOPES.has(scope) ? PUBLIC_BUCKET : PRIVATE_BUCKET;
}

/** True when the scope's objects belong in the public (world-readable) bucket. */
export function isPublicScope(scope: AssetScope): boolean {
  return PUBLIC_SCOPES.has(scope);
}

/**
 * Allowed MIME prefixes/types per asset type. Enforced app-side (the DB buckets
 * intentionally leave `allowed_mime_types` NULL so new types need no migration).
 */
const ALLOWED_MIME: Record<AssetType, readonly string[]> = {
  image: ["image/"],
  icon: ["image/", "image/svg+xml"],
  video: ["video/"],
  pdf: ["application/pdf"],
  document: [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument",
    "application/vnd.ms-excel",
    "text/",
  ],
  attachment: [],
  other: [],
};

/** Validates a file's MIME type + size for the given asset type. */
export function validateAssetFile(input: {
  assetType: AssetType;
  mimeType: string;
  fileSize: number;
}): { ok: true } | { ok: false; reason: string } {
  if (input.fileSize <= 0) return { ok: false, reason: "File is empty." };
  if (input.fileSize > MAX_ASSET_BYTES) {
    return { ok: false, reason: `File exceeds the ${MAX_ASSET_BYTES} byte limit.` };
  }
  const allowed = ALLOWED_MIME[input.assetType];
  if (allowed.length > 0) {
    const ok = allowed.some((prefix) => input.mimeType.startsWith(prefix));
    if (!ok) {
      return {
        ok: false,
        reason: `MIME type "${input.mimeType}" is not allowed for ${input.assetType}.`,
      };
    }
  }
  return { ok: true };
}

// ── Path builders ────────────────────────────────────────────────────────────
// The final path segment carries the asset id so all renditions of one asset
// group under a single prefix (easy to enumerate / clean up later).

/** `website/{page}/{assetId}/{file}` in the PUBLIC bucket. */
export function buildPublicWebsitePath(
  page: string,
  assetId: string,
  file: string,
): string {
  return `website/${page}/${assetId}/${file}`;
}

/** `global/public/{category}/{assetId}/{file}` in the PUBLIC bucket. */
export function buildGlobalPublicPath(
  category: string,
  assetId: string,
  file: string,
): string {
  return `global/public/${category}/${assetId}/${file}`;
}

/** `global/internal/{assetId}/{file}` in the PRIVATE bucket (Super-Admin only). */
export function buildGlobalInternalPath(assetId: string, file: string): string {
  return `global/internal/${assetId}/${file}`;
}

/**
 * `companies/{companyUuid}/library/{assetId}/{file}` in the PRIVATE bucket.
 * `companyUuid` MUST be the company UUID (storage RLS matches it).
 */
export function buildCompanyLibraryPath(
  companyUuid: string,
  assetId: string,
  file: string,
): string {
  return `companies/${companyUuid}/library/${assetId}/${file}`;
}

/** `companies/{companyUuid}/customers/{customerId}/{assetId}/{file}` (PRIVATE). */
export function buildCompanyCustomerPath(
  companyUuid: string,
  customerId: string,
  assetId: string,
  file: string,
): string {
  return `companies/${companyUuid}/customers/${customerId}/${assetId}/${file}`;
}

/** `companies/{companyUuid}/protocols/{protocolId}/{assetId}/{file}` (PRIVATE). */
export function buildCompanyProtocolPath(
  companyUuid: string,
  protocolId: string,
  assetId: string,
  file: string,
): string {
  return `companies/${companyUuid}/protocols/${protocolId}/${assetId}/${file}`;
}

/** `companies/{companyUuid}/work-orders/{workOrderId}/{assetId}/{file}` (PRIVATE). */
export function buildCompanyWorkOrderPath(
  companyUuid: string,
  workOrderId: string,
  assetId: string,
  file: string,
): string {
  return `companies/${companyUuid}/work-orders/${workOrderId}/${assetId}/${file}`;
}

// ── Object upload / remove (thin SDK wrappers) ────────────────────────────────

/** Uploads a file object to a bucket/path. Throws on a missing client or error. */
export async function uploadAssetObject(input: {
  bucket: AssetStorageBucket;
  path: string;
  body: Blob | File | ArrayBuffer;
  contentType?: string;
  upsert?: boolean;
}): Promise<{ path: string }> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error("Asset Center storage requires Supabase to be configured.");
  }
  const { data, error } = await supabase.storage
    .from(input.bucket)
    .upload(input.path, input.body, {
      contentType: input.contentType,
      upsert: input.upsert ?? false,
    });
  if (error) throw new Error(`[storage:${input.bucket}] upload failed: ${error.message}`);
  return { path: data?.path ?? input.path };
}

/** Removes one or more objects from a bucket. */
export async function removeAssetObjects(
  bucket: AssetStorageBucket,
  paths: string[],
): Promise<void> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error("Asset Center storage requires Supabase to be configured.");
  }
  if (paths.length === 0) return;
  const { error } = await supabase.storage.from(bucket).remove(paths);
  if (error) throw new Error(`[storage:${bucket}] remove failed: ${error.message}`);
}
