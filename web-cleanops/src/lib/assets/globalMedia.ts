/**
 * Super Admin Media Center — Supabase-authoritative data layer (Phase 1).
 *
 * Backs the platform-level global/website asset library on top of the Asset
 * Center foundation (migrations 0055/0056/0057). Every read/write goes DIRECTLY
 * to Supabase + Supabase Storage — there is NO localStorage authority, NO
 * mediaStore fallback and NO browser-domain mirror on this path. The legacy
 * localStorage media path (src/lib/mediaStore.ts) is never imported here.
 *
 * This surface manages ONLY platform-owned assets (company_id / customer_id are
 * always null):
 *   • "internal" → scope `global_internal`, visibility `internal`, PRIVATE bucket
 *                  (platform/internal/template material; signed URLs on read).
 *   • "public"   → scope `website_public`,  visibility `public`,   PUBLIC bucket
 *                  (login/website/marketing media; stable public URLs).
 *
 * Unlike the Customer Media Center (which discards originals and stores 3 derived
 * WebP layers), the Media Center is a real LIBRARY: the ORIGINAL file is always
 * preserved as the canonical object so videos, PDFs, icons (SVG) and documents
 * round-trip exactly and public assets expose a usable "Copy URL". For images we
 * additionally derive a small WebP thumbnail + preview (best-effort) so grids
 * stay light; if that derivation fails the original is still usable.
 */
import { makeId } from "@/lib/store";
import { processImageFile } from "@/lib/mediaProcessing";

import {
  archiveAsset,
  createAsset,
  listAssets,
  restoreAsset,
  updateAsset,
} from "./assetRepository";
import {
  PRIVATE_BUCKET,
  PUBLIC_BUCKET,
  buildGlobalInternalPath,
  buildGlobalPublicPath,
  buildPublicWebsitePath,
  removeAssetObjects,
  uploadAssetObject,
  validateAssetFile,
} from "./assetStorage";
import { createSignedUrls, resolvePublicUrl } from "./assetUrlResolver";
import type {
  Asset,
  AssetScope,
  AssetStorageBucket,
  AssetType,
  AssetVisibility,
} from "./assetTypes";

/** The scopes the Super Admin Media Center reads + manages (platform-owned). */
export const GLOBAL_MEDIA_SCOPES: ReadonlySet<AssetScope> = new Set<AssetScope>([
  "global_internal",
  "global_public",
  "website_public",
]);

/** The two exposure choices a Super Admin picks when uploading. */
export type GlobalMediaVisibilityTarget = "internal" | "public";

/** Resolves the (scope, visibility, bucket) triple for a chosen exposure. */
export function globalMediaPlacement(target: GlobalMediaVisibilityTarget): {
  scope: AssetScope;
  visibility: AssetVisibility;
  bucket: AssetStorageBucket;
} {
  return target === "public"
    ? { scope: "website_public", visibility: "public", bucket: PUBLIC_BUCKET }
    : { scope: "global_internal", visibility: "internal", bucket: PRIVATE_BUCKET };
}

/** Whether an asset is publicly exposed (drives the "Copy URL" affordance). */
export function isPublicGlobalAsset(asset: Pick<Asset, "visibility">): boolean {
  return asset.visibility === "public";
}

/** Maps a file's MIME type / name to an Asset Center {@link AssetType}. */
export function assetTypeForFile(mimeType: string, fileName: string): AssetType {
  const mime = (mimeType || "").toLowerCase();
  const name = (fileName || "").toLowerCase();
  if (mime === "image/svg+xml" || name.endsWith(".svg")) return "icon";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (
    mime === "application/msword" ||
    mime === "application/vnd.ms-excel" ||
    mime.startsWith("application/vnd.openxmlformats-officedocument") ||
    mime.startsWith("application/vnd.ms-") ||
    mime.startsWith("text/") ||
    /\.(docx?|xlsx?|pptx?|txt|csv|rtf|md)$/.test(name)
  ) {
    return "document";
  }
  return "other";
}

const MIME_EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "image/avif": "avif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "application/pdf": "pdf",
};

/** Derives a safe lowercase file extension from a file name (or its MIME type). */
function fileExtension(mimeType: string, fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  if (dot > 0 && dot < fileName.length - 1) {
    const ext = fileName.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "");
    if (ext) return ext;
  }
  return MIME_EXTENSION[(mimeType || "").toLowerCase()] ?? "bin";
}

/**
 * Returns a path builder bound to a scope (+ optional slug). All renditions of
 * one asset group under a single prefix so they are easy to enumerate / clean up.
 */
function objectPathBuilder(
  scope: AssetScope,
  pathSlug: string | null,
): (assetId: string, file: string) => string {
  const slug = (pathSlug ?? "").trim() || "general";
  if (scope === "website_public") {
    return (assetId, file) => buildPublicWebsitePath(slug, assetId, file);
  }
  if (scope === "global_public") {
    return (assetId, file) => buildGlobalPublicPath(slug, assetId, file);
  }
  return (assetId, file) => buildGlobalInternalPath(assetId, file);
}

/** Decodes a data URL (image pipeline output) into a Blob for upload. */
function dataUrlToBlob(dataUrl: string): Blob {
  const commaIdx = dataUrl.indexOf(",");
  const header = commaIdx >= 0 ? dataUrl.slice(0, commaIdx) : "";
  const base64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
  const mime = /data:([^;]+)/.exec(header)?.[1] ?? "image/webp";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/**
 * Lists the platform's global/website media (newest first). Each global scope is
 * queried explicitly so this surface can NEVER return company- or customer-owned
 * assets — even though Super-Admin RLS would otherwise allow reading them. The
 * per-row `!companyId && !customerId` re-check is defense-in-depth so a stray
 * company/customer row can never leak onto the platform media page.
 */
export async function listGlobalMedia(
  opts: { includeArchived?: boolean } = {},
): Promise<Asset[]> {
  const includeArchived = opts.includeArchived ?? true;
  const scopes: AssetScope[] = ["global_internal", "global_public", "website_public"];
  const results = await Promise.all(
    scopes.map((scope) => listAssets({ scope, includeArchived })),
  );
  return results
    .flat()
    .filter((a) => !a.companyId && !a.customerId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export interface UploadGlobalMediaInput {
  /** The raw file the Super Admin picked. The ORIGINAL is preserved as-is. */
  file: File;
  /** Exposure choice: PRIVATE global library, or PUBLIC website asset. */
  target: GlobalMediaVisibilityTarget;
  title?: string | null;
  description?: string | null;
  tags?: string[];
  /** Global asset category (legacy id), purely organisational. */
  categoryId?: string | null;
  /** Global asset folder (legacy id), purely organisational. */
  folderId?: string | null;
  /** Storage grouping slug (e.g. website page / public category). */
  pathSlug?: string | null;
  createdBy?: string | null;
}

/**
 * Uploads a platform asset. The original object is written to the scope's bucket
 * first; for images a small WebP thumbnail + preview are derived (best-effort).
 * The metadata row is created last. If anything fails after objects were stored,
 * the just-uploaded objects are removed so a failed upload leaves no orphans.
 */
export async function uploadGlobalMedia(input: UploadGlobalMediaInput): Promise<Asset> {
  const { scope, visibility, bucket } = globalMediaPlacement(input.target);
  const assetType = assetTypeForFile(input.file.type, input.file.name);

  const validation = validateAssetFile({
    assetType,
    mimeType: input.file.type,
    fileSize: input.file.size,
  });
  if (validation.ok === false) throw new Error(validation.reason);

  const assetId = makeId("asset");
  const ext = fileExtension(input.file.type, input.file.name);
  const buildPath = objectPathBuilder(scope, input.pathSlug ?? null);
  const originalPath = buildPath(assetId, `original.${ext}`);

  const uploadedPaths: string[] = [];
  try {
    await uploadAssetObject({
      bucket,
      path: originalPath,
      body: input.file,
      contentType: input.file.type || undefined,
    });
    uploadedPaths.push(originalPath);

    let thumbnailPath: string | null = null;
    let previewPath: string | null = null;
    let width: number | null = null;
    let height: number | null = null;

    // Real raster images get lightweight derived layers for fast grids. SVG
    // icons / videos / PDFs / documents keep ONLY the original (canvas decode is
    // unreliable / meaningless for them).
    if (assetType === "image") {
      try {
        const processed = await processImageFile(input.file);
        width = processed.sourceWidth;
        height = processed.sourceHeight;
        const tPath = buildPath(assetId, "thumb.webp");
        const pPath = buildPath(assetId, "preview.webp");
        await uploadAssetObject({
          bucket,
          path: tPath,
          body: dataUrlToBlob(processed.micro.url),
          contentType: "image/webp",
        });
        uploadedPaths.push(tPath);
        await uploadAssetObject({
          bucket,
          path: pPath,
          body: dataUrlToBlob(processed.preview.url),
          contentType: "image/webp",
        });
        uploadedPaths.push(pPath);
        thumbnailPath = tPath;
        previewPath = pPath;
      } catch (err) {
        console.error("[globalMedia] thumbnail derivation failed; using original only", err);
      }
    }

    const publicUrl =
      bucket === PUBLIC_BUCKET ? resolvePublicUrl(PUBLIC_BUCKET, originalPath) : null;

    return await createAsset({
      id: assetId,
      scope,
      visibility,
      assetType,
      mimeType: input.file.type || null,
      name: input.file.name,
      title: input.title ?? null,
      description: input.description ?? null,
      tags: input.tags ?? [],
      categoryId: input.categoryId ?? null,
      folderId: input.folderId ?? null,
      storageBucket: bucket,
      storagePath: originalPath,
      publicUrl,
      thumbnailBucket: thumbnailPath ? bucket : null,
      thumbnailPath,
      previewBucket: previewPath ? bucket : null,
      previewPath,
      width,
      height,
      fileSize: input.file.size,
      createdBy: input.createdBy ?? null,
    });
  } catch (err) {
    if (uploadedPaths.length > 0) {
      try {
        await removeAssetObjects(bucket, uploadedPaths);
      } catch (cleanupErr) {
        console.error("[globalMedia] orphan cleanup failed", cleanupErr);
      }
    }
    throw err;
  }
}

/** Editable metadata fields for a platform asset. */
export interface UpdateGlobalMediaInput {
  title?: string | null;
  description?: string | null;
  tags?: string[];
  categoryId?: string | null;
  folderId?: string | null;
  updatedBy?: string | null;
}

/** Updates a platform asset's organisational metadata (title/description/tags/…). */
export async function updateGlobalMediaMeta(
  assetId: string,
  input: UpdateGlobalMediaInput,
): Promise<Asset> {
  return updateAsset(assetId, {
    title: input.title,
    description: input.description,
    tags: input.tags,
    categoryId: input.categoryId,
    folderId: input.folderId,
    updatedBy: input.updatedBy ?? null,
  });
}

/** Archives a platform asset (reversible). */
export async function archiveGlobalMedia(assetId: string): Promise<void> {
  await archiveAsset(assetId);
}

/** Restores a previously-archived platform asset. */
export async function restoreGlobalMedia(assetId: string): Promise<void> {
  await restoreAsset(assetId);
}

/**
 * Removes a platform asset from the active global library without deleting the
 * asset record or storage object. Existing links/usages keep resolving the same
 * asset; future pickers hide it because they read only active assets.
 */
export async function removeGlobalMediaFromLibrary(assetId: string): Promise<void> {
  await archiveGlobalMedia(assetId);
}

/**
 * Back-compat alias for older callers. Global Media Center "delete" semantics
 * are intentionally archive/remove-from-library only; hard/soft deletion is
 * reserved for a later explicit maintenance cleanup flow.
 */
export async function deleteGlobalMedia(assetId: string): Promise<void> {
  await removeGlobalMediaFromLibrary(assetId);
}

/** Resolved, ready-to-render URLs for one asset. Never persisted. */
export interface GlobalMediaUrls {
  /** Small grid/list preview (thumbnail → preview → original fallback). */
  thumbUrl: string | null;
  /** The canonical original object (full viewer / open / download / Copy URL). */
  fullUrl: string | null;
}

/**
 * Resolves viewable URLs for many assets in as few round-trips as possible:
 *   • PUBLIC bucket  → stable public URLs (no signing).
 *   • PRIVATE bucket → short-lived SIGNED URLs minted in ONE batch.
 * Signed URLs are never persisted. Assets that cannot be resolved map to nulls.
 */
export async function resolveGlobalMediaUrls(
  assets: Asset[],
): Promise<Map<string, GlobalMediaUrls>> {
  const out = new Map<string, GlobalMediaUrls>();
  if (assets.length === 0) return out;

  const privatePaths: string[] = [];
  for (const a of assets) {
    if (a.storageBucket === PRIVATE_BUCKET) {
      for (const p of [a.thumbnailPath, a.previewPath, a.storagePath]) {
        if (p) privatePaths.push(p);
      }
    }
  }
  const signed =
    privatePaths.length > 0
      ? await createSignedUrls(PRIVATE_BUCKET, privatePaths)
      : new Map<string, string>();

  for (const a of assets) {
    const thumbPath = a.thumbnailPath ?? a.previewPath ?? a.storagePath ?? null;
    let thumbUrl: string | null = null;
    let fullUrl: string | null = null;

    if (a.storageBucket === PUBLIC_BUCKET) {
      fullUrl =
        a.publicUrl ?? (a.storagePath ? resolvePublicUrl(PUBLIC_BUCKET, a.storagePath) : null);
      thumbUrl = thumbPath ? resolvePublicUrl(PUBLIC_BUCKET, thumbPath) : fullUrl;
    } else if (a.storageBucket === PRIVATE_BUCKET) {
      fullUrl = a.storagePath ? (signed.get(a.storagePath) ?? null) : null;
      thumbUrl = thumbPath ? (signed.get(thumbPath) ?? fullUrl) : fullUrl;
    } else {
      fullUrl = a.publicUrl ?? null;
      thumbUrl = fullUrl;
    }

    out.set(a.id, { thumbUrl, fullUrl });
  }
  return out;
}
