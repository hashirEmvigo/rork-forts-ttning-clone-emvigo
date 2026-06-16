/**
 * Company Admin Media Library — global/local data-access foundation.
 *
 * This is intentionally NOT a new route or UI. It defines the safe boundary a
 * future Company Admin Media Center can consume:
 *   • global Super Admin assets are read-only source assets;
 *   • active global assets are selectable for new usage;
 *   • archived global assets can only be returned as explicit legacy references;
 *   • company-owned library assets are separate `company_internal` rows;
 *   • Company Admin archive operations are restricted to own-company local rows.
 */
import { loadCompanyUuidMap } from "@/lib/data/customerMigration";
import { processImageFile } from "@/lib/mediaProcessing";
import { makeId } from "@/lib/store";

import { canManageAsset, type AssetViewerContext } from "./assetPermissions";
import {
  archiveAsset,
  createAsset,
  getAssetById,
  listAssets,
  type Asset,
} from "./assetRepository";
import {
  PRIVATE_BUCKET,
  PUBLIC_BUCKET,
  buildCompanyLibraryPath,
  removeAssetObjects,
  uploadAssetObject,
  validateAssetFile,
} from "./assetStorage";
import { createSignedUrls, resolvePublicUrl } from "./assetUrlResolver";
import type { AssetScope, AssetType } from "./assetTypes";

const GLOBAL_LIBRARY_SCOPES: readonly AssetScope[] = [
  "global_internal",
  "global_public",
  "website_public",
];

const COMPANY_LIBRARY_SCOPES: ReadonlySet<AssetScope> = new Set<AssetScope>([
  "company_internal",
  "company_public",
]);

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

export type CompanyAdminMediaLibraryKind = "global_library" | "company_library";
export type CompanyAdminMediaAvailability = "selectable" | "legacy_reference" | "company_archived";

export interface CompanyAdminMediaUrls {
  thumbUrl: string | null;
  fullUrl: string | null;
}

export interface CompanyAdminMediaItem {
  asset: Asset;
  urls: CompanyAdminMediaUrls | null;
  library: CompanyAdminMediaLibraryKind;
  isReadOnly: boolean;
  isArchived: boolean;
  canSelect: boolean;
  canArchive: boolean;
  availability: CompanyAdminMediaAvailability;
}

export interface CompanyAdminMediaLibraryResult {
  globalItems: CompanyAdminMediaItem[];
  companyItems: CompanyAdminMediaItem[];
  allItems: CompanyAdminMediaItem[];
}

export interface ListCompanyAdminMediaLibraryOptions {
  companyId: string;
  /** Explicit archived global asset ids already referenced by this company. */
  referencedGlobalAssetIds?: string[];
  /** Include archived company-owned local rows for management/restore UX later. */
  includeArchivedCompanyAssets?: boolean;
}

export interface UploadCompanyMediaInput {
  file: File;
  companyId: string;
  title?: string | null;
  description?: string | null;
  tags?: string[];
  categoryId?: string | null;
  createdBy?: string | null;
}

/** True for Super Admin source assets that Company Admin may browse but not mutate. */
export function isGlobalSourceAsset(asset: Pick<Asset, "companyId" | "customerId" | "scope">): boolean {
  return !asset.companyId && !asset.customerId && GLOBAL_LIBRARY_SCOPES.includes(asset.scope);
}

/** True for a company-owned top-level local library asset (not customer media). */
export function isCompanyOwnedLibraryAsset(
  asset: Pick<Asset, "companyId" | "customerId" | "scope">,
  companyId: string,
): boolean {
  const normalizedCompanyId = companyId.trim();
  return (
    Boolean(normalizedCompanyId) &&
    asset.companyId === normalizedCompanyId &&
    !asset.customerId &&
    COMPANY_LIBRARY_SCOPES.has(asset.scope)
  );
}

/** Company Admin can archive only own-company local library assets, never global originals. */
export function canArchiveCompanyAdminMediaAsset(companyId: string, asset: Asset): boolean {
  const viewer: AssetViewerContext = { role: "company_admin", companyId: companyId.trim() };
  return isCompanyOwnedLibraryAsset(asset, companyId) && canManageAsset(viewer, asset);
}

/** Returns active/selectable global source assets plus explicit archived legacy references. */
export async function listCompanyAdminGlobalLibraryAssets(
  referencedGlobalAssetIds: string[] = [],
): Promise<Asset[]> {
  const referenced = new Set(referencedGlobalAssetIds.map((id) => id.trim()).filter(Boolean));
  const results = await Promise.all(
    GLOBAL_LIBRARY_SCOPES.map((scope) => listAssets({ scope, includeArchived: true })),
  );

  return results
    .flat()
    .filter(isGlobalSourceAsset)
    .filter((asset) => !asset.archivedAt || referenced.has(asset.id))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/** Lists company-owned local library assets. Does not return customer-scoped media. */
export async function listCompanyOwnedMediaAssets(options: {
  companyId: string;
  includeArchived?: boolean;
}): Promise<Asset[]> {
  const companyId = options.companyId.trim();
  if (!companyId) return [];

  const assets = await listAssets({ companyId, includeArchived: options.includeArchived ?? true });
  return assets
    .filter((asset) => isCompanyOwnedLibraryAsset(asset, companyId))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/** Lists the future Company Admin Media Center's two lanes: Global + Company. */
export async function listCompanyAdminMediaLibrary(
  options: ListCompanyAdminMediaLibraryOptions,
): Promise<CompanyAdminMediaLibraryResult> {
  const companyId = options.companyId.trim();
  if (!companyId) return { globalItems: [], companyItems: [], allItems: [] };

  const [globalAssets, companyAssets] = await Promise.all([
    listCompanyAdminGlobalLibraryAssets(options.referencedGlobalAssetIds ?? []),
    listCompanyOwnedMediaAssets({
      companyId,
      includeArchived: options.includeArchivedCompanyAssets ?? true,
    }),
  ]);
  const urls = await resolveCompanyAdminMediaUrls([...globalAssets, ...companyAssets]);

  const globalItems = globalAssets.map<CompanyAdminMediaItem>((asset) => {
    const isArchived = Boolean(asset.archivedAt);
    return {
      asset,
      urls: urls.get(asset.id) ?? null,
      library: "global_library",
      isReadOnly: true,
      isArchived,
      canSelect: !isArchived,
      canArchive: false,
      availability: isArchived ? "legacy_reference" : "selectable",
    };
  });

  const companyItems = companyAssets.map<CompanyAdminMediaItem>((asset) => {
    const isArchived = Boolean(asset.archivedAt);
    return {
      asset,
      urls: urls.get(asset.id) ?? null,
      library: "company_library",
      isReadOnly: false,
      isArchived,
      canSelect: !isArchived,
      canArchive: !isArchived && canArchiveCompanyAdminMediaAsset(companyId, asset),
      availability: isArchived ? "company_archived" : "selectable",
    };
  });

  return { globalItems, companyItems, allItems: [...globalItems, ...companyItems] };
}

/** Convenience for future pickers: active global assets + active company assets only. */
export async function listSelectableCompanyAdminMedia(
  options: ListCompanyAdminMediaLibraryOptions,
): Promise<CompanyAdminMediaItem[]> {
  const library = await listCompanyAdminMediaLibrary(options);
  return library.allItems.filter((item) => item.canSelect);
}

/** Archives a company-owned local media row. Global Super Admin assets are rejected. */
export async function archiveCompanyAdminMediaAsset(assetId: string, companyId: string): Promise<void> {
  const company = companyId.trim();
  if (!company) throw new Error("Company media archive requires a company context.");

  const asset = await getAssetById(assetId);
  if (!asset) throw new Error("Asset was not found.");
  if (!canArchiveCompanyAdminMediaAsset(company, asset)) {
    throw new Error("Company Admin can only archive company-owned local media assets.");
  }

  await archiveAsset(assetId);
}

/** Uploads a company-owned local library asset into the private company library. */
export async function uploadCompanyMedia(input: UploadCompanyMediaInput): Promise<Asset> {
  const companyId = input.companyId.trim();
  if (!companyId) throw new Error("Company media upload requires a company context.");
  const companyUuid = await requireCompanyUuid(companyId);
  const assetType = assetTypeForFile(input.file.type, input.file.name);

  const validation = validateAssetFile({
    assetType,
    mimeType: input.file.type,
    fileSize: input.file.size,
  });
  if (validation.ok === false) throw new Error(validation.reason);

  const assetId = makeId("asset");
  const ext = fileExtension(input.file.type, input.file.name);
  const originalPath = buildCompanyLibraryPath(companyUuid, assetId, `original.${ext}`);
  const uploadedPaths: string[] = [];

  try {
    await uploadAssetObject({
      bucket: PRIVATE_BUCKET,
      path: originalPath,
      body: input.file,
      contentType: input.file.type || undefined,
    });
    uploadedPaths.push(originalPath);

    let thumbnailPath: string | null = null;
    let previewPath: string | null = null;
    let width: number | null = null;
    let height: number | null = null;

    if (assetType === "image") {
      try {
        const processed = await processImageFile(input.file);
        width = processed.sourceWidth;
        height = processed.sourceHeight;
        thumbnailPath = buildCompanyLibraryPath(companyUuid, assetId, "thumb.webp");
        previewPath = buildCompanyLibraryPath(companyUuid, assetId, "preview.webp");
        await uploadAssetObject({
          bucket: PRIVATE_BUCKET,
          path: thumbnailPath,
          body: dataUrlToBlob(processed.micro.url),
          contentType: "image/webp",
        });
        uploadedPaths.push(thumbnailPath);
        await uploadAssetObject({
          bucket: PRIVATE_BUCKET,
          path: previewPath,
          body: dataUrlToBlob(processed.preview.url),
          contentType: "image/webp",
        });
        uploadedPaths.push(previewPath);
      } catch (err) {
        console.error("[companyMediaLibrary] image derivative generation failed", err);
      }
    }

    return await createAsset({
      id: assetId,
      companyId,
      companyUuid,
      scope: "company_internal",
      visibility: "internal",
      assetType,
      mimeType: input.file.type || null,
      name: input.file.name,
      title: input.title ?? null,
      description: input.description ?? null,
      tags: input.tags ?? [],
      categoryId: input.categoryId ?? null,
      storageBucket: PRIVATE_BUCKET,
      storagePath: originalPath,
      thumbnailBucket: thumbnailPath ? PRIVATE_BUCKET : null,
      thumbnailPath,
      previewBucket: previewPath ? PRIVATE_BUCKET : null,
      previewPath,
      width,
      height,
      fileSize: input.file.size,
      createdBy: input.createdBy ?? null,
    });
  } catch (err) {
    if (uploadedPaths.length > 0) {
      try {
        await removeAssetObjects(PRIVATE_BUCKET, uploadedPaths);
      } catch (cleanupErr) {
        console.error("[companyMediaLibrary] orphan cleanup failed", cleanupErr);
      }
    }
    throw err;
  }
}

/** Resolves ready-to-render URLs for global and company-owned media assets. */
export async function resolveCompanyAdminMediaUrls(
  assets: Asset[],
): Promise<Map<string, CompanyAdminMediaUrls>> {
  const out = new Map<string, CompanyAdminMediaUrls>();
  if (assets.length === 0) return out;

  const privatePaths: string[] = [];
  for (const asset of assets) {
    if (asset.storageBucket === PRIVATE_BUCKET) {
      for (const path of [asset.thumbnailPath, asset.previewPath, asset.storagePath]) {
        if (path) privatePaths.push(path);
      }
    }
  }

  const signed =
    privatePaths.length > 0
      ? await createSignedUrls(PRIVATE_BUCKET, Array.from(new Set(privatePaths)))
      : new Map<string, string>();

  for (const asset of assets) {
    out.set(asset.id, resolveAssetUrls(asset, signed));
  }

  return out;
}

function resolveAssetUrls(asset: Asset, signed: Map<string, string>): CompanyAdminMediaUrls {
  const thumbPath = asset.thumbnailPath ?? asset.previewPath ?? asset.storagePath ?? null;
  let thumbUrl: string | null = null;
  let fullUrl: string | null = null;

  if (asset.storageBucket === PUBLIC_BUCKET) {
    fullUrl = asset.publicUrl ?? (asset.storagePath ? resolvePublicUrl(PUBLIC_BUCKET, asset.storagePath) : null);
    thumbUrl = thumbPath ? resolvePublicUrl(PUBLIC_BUCKET, thumbPath) : fullUrl;
  } else if (asset.storageBucket === PRIVATE_BUCKET) {
    fullUrl = asset.storagePath ? (signed.get(asset.storagePath) ?? null) : null;
    thumbUrl = thumbPath ? (signed.get(thumbPath) ?? fullUrl) : fullUrl;
  } else {
    fullUrl = asset.publicUrl ?? null;
    thumbUrl = fullUrl;
  }

  return { thumbUrl, fullUrl };
}

function assetTypeForFile(mimeType: string, fileName: string): AssetType {
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

function fileExtension(mimeType: string, fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  if (dot > 0 && dot < fileName.length - 1) {
    const ext = fileName.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "");
    if (ext) return ext;
  }
  return MIME_EXTENSION[(mimeType || "").toLowerCase()] ?? "bin";
}

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

async function requireCompanyUuid(companyId: string): Promise<string> {
  const map = await loadCompanyUuidMap();
  const uuid = map.get(companyId) ?? null;
  if (!uuid) throw new Error(`No Supabase company found for "${companyId}".`);
  return uuid;
}
