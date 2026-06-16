import type {
  MediaAsset,
  MediaCategory,
  MediaEntityType,
  MediaUsageTarget,
  MediaVisibilityTarget,
  User,
  UserRole,
} from "@/types";
import { authorize } from "@/lib/authz";
import {
  categorySupportsEntity,
  defaultUsageForCategory,
  defaultVisibilityForCategory,
} from "@/lib/mediaCategories";
import { makeId } from "@/lib/store";
import type { ProcessedImage } from "@/lib/mediaProcessing";

/**
 * Media Foundation persistence layer.
 *
 * Like {@link storage.ts}, this is a backend-shaped abstraction over
 * localStorage so it can be swapped for an object store + signed-URL backend
 * without touching callers. Two guarantees are enforced here, not in the UI:
 *  1. Tenant isolation — every asset belongs to a company and reads/writes are
 *     filtered by the requester's company scope.
 *  2. No originals — assets are created from {@link ProcessedImage} layers only;
 *     there is no API to store an original image.
 */

const MEDIA_KEY = "cleanops.mediaAssets";

/** Permission key a user must hold to manage media for a company. */
export const MEDIA_MANAGE_PERMISSION = "media.manage";

function readAssets(): MediaAsset[] {
  try {
    const raw = localStorage.getItem(MEDIA_KEY);
    return raw ? (JSON.parse(raw) as MediaAsset[]) : [];
  } catch {
    return [];
  }
}

function writeAssets(assets: MediaAsset[]): void {
  try {
    localStorage.setItem(MEDIA_KEY, JSON.stringify(assets));
  } catch (err) {
    console.error("Failed to persist media assets", err);
  }
}

export interface CreateMediaAssetInput {
  companyId: string;
  category: MediaCategory;
  entityType: MediaEntityType;
  entityId: string;
  /** Output of the client-side pipeline. Only the three layers are stored. */
  processed: ProcessedImage;
  caption?: string;
  /** Override the category's default “Used In” preset. */
  usedIn?: MediaUsageTarget[];
  /** Override the category's default “Visible For” preset. */
  visibleFor?: MediaVisibilityTarget[];
}

/**
 * Persists a processed image as a {@link MediaAsset}. Enforces company scope
 * (via the uploader) and that the category may attach to the entity type.
 *
 * @returns the stored asset, or null if the action is not authorised / invalid.
 */
export function createMediaAsset(
  uploader: User,
  permissions: string[],
  input: CreateMediaAssetInput,
): MediaAsset | null {
  const allowed = authorize({
    user: uploader,
    permissions,
    permission: MEDIA_MANAGE_PERMISSION,
    resourceCompanyId: input.companyId,
  });
  if (!allowed) return null;
  if (!categorySupportsEntity(input.category, input.entityType)) return null;

  const asset: MediaAsset = {
    id: makeId("media"),
    companyId: input.companyId,
    category: input.category,
    entityType: input.entityType,
    entityId: input.entityId,
    uploadedBy: uploader.id,
    uploadedByRole: uploader.role,
    microThumbnailUrl: input.processed.micro.url,
    hoverThumbnailUrl: input.processed.hover.url,
    previewImageUrl: input.processed.preview.url,
    width: input.processed.sourceWidth,
    height: input.processed.sourceHeight,
    fileSize: input.processed.totalBytes,
    createdAt: new Date().toISOString(),
    caption: input.caption?.trim() || undefined,
    usedIn: input.usedIn ?? defaultUsageForCategory(input.category),
    visibleFor: input.visibleFor ?? defaultVisibilityForCategory(input.category),
  };
  writeAssets([asset, ...readAssets()]);
  return asset;
}

/**
 * Resolves an asset's effective “Used In” targets. Assets created before this
 * model have no `usedIn`; they safely fall back to their category defaults.
 */
export function resolveMediaUsage(asset: MediaAsset): MediaUsageTarget[] {
  return asset.usedIn ?? defaultUsageForCategory(asset.category);
}

/**
 * Resolves an asset's effective “Visible For” audiences. Assets created before
 * this model fall back to their category defaults.
 */
export function resolveMediaVisibility(
  asset: MediaAsset,
): MediaVisibilityTarget[] {
  return asset.visibleFor ?? defaultVisibilityForCategory(asset.category);
}

/** Maps a {@link UserRole} to its visibility target, if any (scheduler is future). */
function visibilityTargetForRole(role: UserRole): MediaVisibilityTarget | null {
  switch (role) {
    case "super_admin":
      return "super_admin";
    case "company_admin":
      return "company_admin";
    case "employee":
      return "employee";
    case "customer":
      return "customer";
    default:
      return null;
  }
}

/**
 * Content-visibility check for future module surfaces: an asset shows in a module
 * only when its “Used In” includes that surface AND its “Visible For” includes the
 * viewer's role. This is layered on top of (never instead of) company isolation
 * and role permissions — callers must still gate with {@link canReadMediaAsset}.
 */
export function isMediaVisibleInModule(
  asset: MediaAsset,
  usage: MediaUsageTarget,
  role: UserRole,
): boolean {
  if (!resolveMediaUsage(asset).includes(usage)) return false;
  const target = visibilityTargetForRole(role);
  if (target === null) return false;
  return resolveMediaVisibility(asset).includes(target);
}

export interface UpdateMediaAssetMetaInput {
  category?: MediaCategory;
  usedIn?: MediaUsageTarget[];
  visibleFor?: MediaVisibilityTarget[];
}

/**
 * Updates an asset's content metadata (category, “Used In”, “Visible For”) in
 * place. Never duplicates or moves the image. Authorised by the same
 * company-scoped manage permission as reads. Rejects a category that cannot
 * attach to the asset's entity type.
 *
 * @returns the updated asset, or null if unauthorised / invalid.
 */
export function updateMediaAssetMeta(
  user: User,
  permissions: string[],
  assetId: string,
  input: UpdateMediaAssetMetaInput,
): MediaAsset | null {
  const assets = readAssets();
  const target = assets.find((a) => a.id === assetId);
  if (!target || !canReadMediaAsset(user, permissions, target)) return null;
  if (
    input.category !== undefined &&
    !categorySupportsEntity(input.category, target.entityType)
  ) {
    return null;
  }

  const updated: MediaAsset = {
    ...target,
    category: input.category ?? target.category,
    usedIn: input.usedIn ?? target.usedIn,
    visibleFor: input.visibleFor ?? target.visibleFor,
  };
  writeAssets(assets.map((a) => (a.id === assetId ? updated : a)));
  return updated;
}

/** Whether a user may read a given media asset (company scope + permission). */
export function canReadMediaAsset(
  user: User,
  permissions: string[],
  asset: MediaAsset,
): boolean {
  return authorize({
    user,
    permissions,
    permission: MEDIA_MANAGE_PERMISSION,
    resourceCompanyId: asset.companyId,
  });
}

export interface ListMediaQuery {
  entityType?: MediaEntityType;
  entityId?: string;
  category?: MediaCategory;
  /** Only assets whose effective “Used In” includes this surface. */
  usedIn?: MediaUsageTarget;
  /** Only assets whose effective “Visible For” includes this audience. */
  visibleFor?: MediaVisibilityTarget;
}

/**
 * Lists media assets the user is allowed to read, optionally filtered by entity
 * and/or category. Results are newest-first.
 */
export function listMediaAssets(
  user: User,
  permissions: string[],
  query?: ListMediaQuery,
): MediaAsset[] {
  return readAssets().filter((asset) => {
    if (query?.entityType !== undefined && asset.entityType !== query.entityType) {
      return false;
    }
    if (query?.entityId !== undefined && asset.entityId !== query.entityId) {
      return false;
    }
    if (query?.category !== undefined && asset.category !== query.category) {
      return false;
    }
    if (
      query?.usedIn !== undefined &&
      !resolveMediaUsage(asset).includes(query.usedIn)
    ) {
      return false;
    }
    if (
      query?.visibleFor !== undefined &&
      !resolveMediaVisibility(asset).includes(query.visibleFor)
    ) {
      return false;
    }
    return canReadMediaAsset(user, permissions, asset);
  });
}

/** Convenience: lists assets attached to a specific entity. */
export function listMediaForEntity(
  user: User,
  permissions: string[],
  entityType: MediaEntityType,
  entityId: string,
): MediaAsset[] {
  return listMediaAssets(user, permissions, { entityType, entityId });
}

export interface ListMediaForModuleQuery {
  /** Restrict to a single entity type (e.g. "customer"). */
  entityType?: MediaEntityType;
  /** Restrict to a single entity id (e.g. the customer id). */
  entityId?: string;
  /** The module surface the assets must be "Used In". */
  usage: MediaUsageTarget;
  /** The viewer's role, checked against each asset's "Visible For". */
  viewerRole: UserRole;
  category?: MediaCategory;
}

/**
 * Lists assets a module surface should display: those the user may read (company
 * scope) whose "Used In" includes {@link ListMediaForModuleQuery.usage} and whose
 * "Visible For" includes the viewer's role. This is the single entry point future
 * modules (Work Order, Cleaning Protocol, Employee App, Customer Portal) use so
 * visibility logic is never reimplemented per surface.
 */
export function listMediaForModule(
  user: User,
  permissions: string[],
  query: ListMediaForModuleQuery,
): MediaAsset[] {
  return listMediaAssets(user, permissions, {
    entityType: query.entityType,
    entityId: query.entityId,
    category: query.category,
  }).filter((asset) =>
    isMediaVisibleInModule(asset, query.usage, query.viewerRole),
  );
}

/**
 * Adds a usage surface to an asset — e.g. attaching a customer image to the
 * work-order module. Idempotent (returns the asset unchanged if already used
 * there) and never duplicates, copies or moves the asset; only its `usedIn`
 * metadata changes. The customer remains the owner.
 */
export function attachMediaUsage(
  user: User,
  permissions: string[],
  assetId: string,
  target: MediaUsageTarget,
): MediaAsset | null {
  const asset = getMediaAsset(user, permissions, assetId);
  if (!asset) return null;
  const usage = resolveMediaUsage(asset);
  if (usage.includes(target)) return asset;
  return updateMediaAssetMeta(user, permissions, assetId, {
    usedIn: [...usage, target],
  });
}

/**
 * Removes a usage surface from an asset — e.g. detaching a customer image from
 * the work-order module. This only removes the reference; the asset (and the
 * customer's ownership of it) is preserved. Idempotent.
 */
export function detachMediaUsage(
  user: User,
  permissions: string[],
  assetId: string,
  target: MediaUsageTarget,
): MediaAsset | null {
  const asset = getMediaAsset(user, permissions, assetId);
  if (!asset) return null;
  const usage = resolveMediaUsage(asset);
  if (!usage.includes(target)) return asset;
  return updateMediaAssetMeta(user, permissions, assetId, {
    usedIn: usage.filter((u) => u !== target),
  });
}

/** Looks up a single media asset by id, scoped to what the user may read. */
export function getMediaAsset(
  user: User,
  permissions: string[],
  assetId: string,
): MediaAsset | null {
  const asset = readAssets().find((a) => a.id === assetId);
  if (!asset || !canReadMediaAsset(user, permissions, asset)) return null;
  return asset;
}

/** Removes a media asset when the requester is authorised to read it. */
export function deleteMediaAsset(
  user: User,
  permissions: string[],
  assetId: string,
): boolean {
  const assets = readAssets();
  const target = assets.find((a) => a.id === assetId);
  if (!target || !canReadMediaAsset(user, permissions, target)) return false;
  writeAssets(assets.filter((a) => a.id !== assetId));
  return true;
}

/** Per-category usage line, useful for galleries and billing breakdowns. */
export interface MediaCategoryUsage {
  category: MediaCategory;
  count: number;
  storedBytes: number;
}

export interface MediaUsageSummary {
  /** Number of assets in scope. */
  count: number;
  /** Combined stored bytes across those assets. */
  storedBytes: number;
  /** Usage broken down by category, descending by stored bytes. */
  byCategory: MediaCategoryUsage[];
}

/**
 * Aggregates stored media usage for a company. Backend-shaped so future billing
 * specifications can read from the same source. Includes a per-category
 * breakdown (asset count + stored bytes) for reporting surfaces.
 */
export function summarizeCompanyMediaUsage(
  user: User,
  permissions: string[],
  companyId: string,
): MediaUsageSummary {
  const scoped = readAssets().filter(
    (asset) =>
      asset.companyId === companyId && canReadMediaAsset(user, permissions, asset),
  );

  const categoryMap = new Map<MediaCategory, MediaCategoryUsage>();
  for (const asset of scoped) {
    const existing = categoryMap.get(asset.category) ?? {
      category: asset.category,
      count: 0,
      storedBytes: 0,
    };
    existing.count += 1;
    existing.storedBytes += asset.fileSize;
    categoryMap.set(asset.category, existing);
  }

  return {
    count: scoped.length,
    storedBytes: scoped.reduce((sum, asset) => sum + asset.fileSize, 0),
    byCategory: [...categoryMap.values()].sort(
      (a, b) => b.storedBytes - a.storedBytes,
    ),
  };
}
