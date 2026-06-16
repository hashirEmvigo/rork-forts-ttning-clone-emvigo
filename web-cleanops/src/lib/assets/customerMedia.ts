/**
 * Customer Media Center — Supabase-authoritative data layer (Phase 2).
 *
 * Backs the Customer Media Center on top of the Phase 1 Asset Center foundation
 * (migrations 0055/0056). Every read/write goes DIRECTLY to Supabase + Supabase
 * Storage — there is NO localStorage authority and NO browser-domain mirror on
 * this path. The legacy localStorage media path (src/lib/mediaStore.ts) is NOT
 * imported here, so legacy Customer Media Center items can never resurrect into
 * this surface.
 *
 * Customer media is private by default:
 *   • "internal"        → scope `customer_internal`, visibility `internal`
 *                         (admin/staff only — the default for every new upload).
 *   • "customer-visible"→ scope `customer_visible`,  visibility `customer_visible`
 *                         (explicit opt-in; still NEVER `public`).
 * Both live in the PRIVATE bucket under
 * `companies/{companyUuid}/customers/{customerId}/{assetId}/...`, so objects are
 * only reachable through short-lived signed URLs minted on read.
 *
 * The proven 3-layer image pipeline (src/lib/mediaProcessing.ts) is reused; the
 * three derived WebP layers map onto the asset's three storage slots:
 *   • micro   → thumbnail slot  (lists / grids)
 *   • hover   → preview slot    (hover / popover)
 *   • preview → storage slot    (the canonical object; full viewer)
 */
import { loadCompanyUuidMap } from "@/lib/data/customerMigration";
import { makeId } from "@/lib/store";
import type { MediaCategory } from "@/types";
import type { ProcessedImage } from "@/lib/mediaProcessing";

import {
  createAsset,
  updateAsset,
  softDeleteAsset,
  listAssets,
  getAssetById,
  type Asset,
} from "./assetRepository";
import {
  PRIVATE_BUCKET,
  buildCompanyCustomerPath,
  removeAssetObjects,
  uploadAssetObject,
} from "./assetStorage";
import { createSignedUrls } from "./assetUrlResolver";
import type { AssetScope, AssetVisibility } from "./assetTypes";

/** The customer-media scopes the Customer Media Center reads + manages. */
const CUSTOMER_MEDIA_SCOPES: ReadonlySet<AssetScope> = new Set<AssetScope>([
  "customer_internal",
  "customer_visible",
]);

/** File names for the three stored WebP layers (grouped under the asset id). */
const LAYER_FILE = {
  micro: "micro.webp",
  hover: "hover.webp",
  preview: "preview.webp",
} as const;

/** Signed-URL layer triplet, structurally compatible with `MediaImageSource`. */
export interface CustomerMediaSource {
  microThumbnailUrl: string;
  hoverThumbnailUrl: string;
  previewImageUrl: string;
  caption?: string;
}

/**
 * Resolves the (scope, visibility) pair for a customer-media item.
 * `customer-visible` must always be an explicit choice — the default is the
 * admin/internal pair.
 */
export function customerMediaScopeVisibility(visible: boolean): {
  scope: AssetScope;
  visibility: AssetVisibility;
} {
  return visible
    ? { scope: "customer_visible", visibility: "customer_visible" }
    : { scope: "customer_internal", visibility: "internal" };
}

/** Whether an asset is currently customer-visible (vs admin/internal). */
export function isCustomerVisible(asset: Pick<Asset, "visibility">): boolean {
  return asset.visibility === "customer_visible";
}

/** The legacy media category an asset was uploaded under (from metadata). */
export function customerMediaCategory(asset: Asset): MediaCategory {
  const raw = asset.metadata?.mediaCategory;
  return (typeof raw === "string" ? raw : "customer") as MediaCategory;
}

async function requireCompanyUuid(companyId: string): Promise<string> {
  const normalized = companyId.trim();
  if (!normalized) throw new Error("Customer media requires a company context.");
  const map = await loadCompanyUuidMap();
  const uuid = map.get(normalized) ?? null;
  if (!uuid) {
    throw new Error(`No Supabase company found for "${normalized}".`);
  }
  return uuid;
}

/** Decodes a data URL (the processing pipeline output) into a Blob for upload. */
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
 * Lists a customer's media (newest first). Scoped to the customer + company and
 * narrowed to the customer-media scopes; archived/soft-deleted rows are excluded
 * by the repository.
 *
 * ISOLATION INVARIANT: a Customer Media Center read is ALWAYS bound to exactly
 * one customer. A missing/blank `customerId` (or `companyId`) returns `[]` and
 * NEVER calls `listAssets()` unscoped — an unscoped `listAssets` would return
 * EVERY customer's media for the company and leak it across customer cards.
 * The per-row `customerId` re-check is defense-in-depth so this surface stays
 * isolated even if `listAssets`' filter is ever relaxed.
 */
export async function listCustomerMedia(params: {
  companyId: string;
  customerId: string;
}): Promise<Asset[]> {
  const companyId = params.companyId?.trim() ?? "";
  const customerId = params.customerId?.trim() ?? "";
  if (!companyId || !customerId) return [];

  const assets = await listAssets({ companyId, customerId });
  return assets
    .filter((a) => CUSTOMER_MEDIA_SCOPES.has(a.scope))
    .filter((a) => a.customerId === customerId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export interface UploadCustomerMediaInput {
  companyId: string;
  customerId: string;
  /** Output of the client-side pipeline. Only the 3 derived layers are stored. */
  processed: ProcessedImage;
  /** Legacy media category, preserved in metadata + tags for filtering. */
  category: MediaCategory;
  /** Explicit opt-in to customer visibility. Defaults to admin/internal. */
  visible?: boolean;
  createdBy?: string | null;
}

/**
 * Uploads a processed image as a customer-scoped asset. The three WebP layers
 * are written to the PRIVATE bucket, then the asset metadata row is created. If
 * the metadata write fails, the just-uploaded objects are cleaned up so a failed
 * upload never leaves orphans.
 */
export async function uploadCustomerMedia(
  input: UploadCustomerMediaInput,
): Promise<Asset> {
  const companyUuid = await requireCompanyUuid(input.companyId);
  const assetId = makeId("asset");
  const { scope, visibility } = customerMediaScopeVisibility(input.visible ?? false);

  const layers = [
    { file: LAYER_FILE.micro, layer: input.processed.micro },
    { file: LAYER_FILE.hover, layer: input.processed.hover },
    { file: LAYER_FILE.preview, layer: input.processed.preview },
  ];

  const uploadedPaths: string[] = [];
  try {
    for (const { file, layer } of layers) {
      const path = buildCompanyCustomerPath(
        companyUuid,
        input.customerId,
        assetId,
        file,
      );
      await uploadAssetObject({
        bucket: PRIVATE_BUCKET,
        path,
        body: dataUrlToBlob(layer.url),
        contentType: "image/webp",
      });
      uploadedPaths.push(path);
    }

    const microPath = buildCompanyCustomerPath(companyUuid, input.customerId, assetId, LAYER_FILE.micro);
    const hoverPath = buildCompanyCustomerPath(companyUuid, input.customerId, assetId, LAYER_FILE.hover);
    const previewPath = buildCompanyCustomerPath(companyUuid, input.customerId, assetId, LAYER_FILE.preview);

    return await createAsset({
      id: assetId,
      companyId: input.companyId,
      companyUuid,
      customerId: input.customerId,
      scope,
      visibility,
      assetType: "image",
      mimeType: "image/webp",
      name: `${input.category}-${assetId}.webp`,
      tags: [input.category],
      // preview (largest kept) = canonical object; micro = thumbnail; hover = preview slot.
      storageBucket: PRIVATE_BUCKET,
      storagePath: previewPath,
      thumbnailBucket: PRIVATE_BUCKET,
      thumbnailPath: microPath,
      previewBucket: PRIVATE_BUCKET,
      previewPath: hoverPath,
      width: input.processed.sourceWidth,
      height: input.processed.sourceHeight,
      fileSize: input.processed.totalBytes,
      metadata: { mediaCategory: input.category },
      createdBy: input.createdBy ?? null,
    });
  } catch (err) {
    // Best-effort cleanup so a failed metadata write leaves no orphaned objects.
    if (uploadedPaths.length > 0) {
      try {
        await removeAssetObjects(PRIVATE_BUCKET, uploadedPaths);
      } catch (cleanupErr) {
        console.error("[customerMedia] orphan cleanup failed", cleanupErr);
      }
    }
    throw err;
  }
}

/**
 * Switches a customer-media item between admin/internal and customer-visible.
 * Updates BOTH scope and visibility together so the stored representation stays
 * consistent (and RLS-checks the new pair as company-manageable).
 */
export async function setCustomerMediaVisibility(
  assetId: string,
  visible: boolean,
  updatedBy?: string | null,
): Promise<Asset> {
  const { scope, visibility } = customerMediaScopeVisibility(visible);
  return updateAsset(assetId, { scope, visibility, updatedBy: updatedBy ?? null });
}

/**
 * Removes a customer-media item from the Center (soft-delete). The storage
 * objects are intentionally left for a later controlled orphan-cleanup pass
 * (archive-over-hard-delete); a soft-deleted row never reappears in reads.
 */
export async function archiveCustomerMedia(assetId: string): Promise<void> {
  await softDeleteAsset(assetId);
}

/**
 * Resolves signed-URL layer triplets for many assets in ONE storage round-trip.
 * Returns a `assetId → CustomerMediaSource` map; assets whose objects could not
 * be signed are omitted. Signed URLs are short-lived and never persisted.
 */
export async function resolveCustomerMediaSources(
  assets: Asset[],
): Promise<Map<string, CustomerMediaSource>> {
  const out = new Map<string, CustomerMediaSource>();
  if (assets.length === 0) return out;

  const paths: string[] = [];
  for (const a of assets) {
    if (a.thumbnailPath) paths.push(a.thumbnailPath);
    if (a.previewPath) paths.push(a.previewPath);
    if (a.storagePath) paths.push(a.storagePath);
  }
  const signed = await createSignedUrls(PRIVATE_BUCKET, paths);

  for (const a of assets) {
    const micro = a.thumbnailPath ? signed.get(a.thumbnailPath) : undefined;
    const hover = a.previewPath ? signed.get(a.previewPath) : undefined;
    const preview = a.storagePath ? signed.get(a.storagePath) : undefined;
    // The canonical (preview) object is the minimum we need to render anything.
    if (!preview) continue;
    out.set(a.id, {
      microThumbnailUrl: micro ?? preview,
      hoverThumbnailUrl: hover ?? micro ?? preview,
      previewImageUrl: preview,
      caption: a.title ?? undefined,
    });
  }
  return out;
}

/**
 * Resolves a single asset (by app-facing id) to its signed-URL layer triplet —
 * used to render the customer cover image. Returns null when Supabase is
 * unconfigured, the asset is gone, or its objects can't be signed (callers fall
 * back to a placeholder). Never throws.
 *
 * When `expectedCustomerId` is supplied, the asset is ALSO checked to belong to
 * that customer; a pointer that resolves a DIFFERENT customer's asset (e.g. a
 * stale/foreign `coverMediaAssetId`) returns null instead of leaking another
 * customer's image onto the card.
 */
export async function resolveCustomerMediaSourceById(
  assetId: string,
  expectedCustomerId?: string | null,
): Promise<CustomerMediaSource | null> {
  try {
    const asset = await getAssetById(assetId);
    if (!asset) return null;
    const expected = expectedCustomerId?.trim();
    if (expected && asset.customerId !== expected) return null;
    const sources = await resolveCustomerMediaSources([asset]);
    return sources.get(asset.id) ?? null;
  } catch (err) {
    console.error("[customerMedia] cover resolve failed", err);
    return null;
  }
}
