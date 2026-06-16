/**
 * Work Order media — Supabase-authoritative data layer (Phase 3).
 *
 * Reconnects Work Order images to the Asset Center foundation (migrations
 * 0055/0056). Work orders NEVER own their own images: an image is a
 * customer-owned {@link Asset} (scope `customer_internal` by default,
 * `customer_visible` only when explicit — exactly like the Customer Media
 * Center), and a *placement* is an {@link AssetLink} pointing that asset at a
 * location inside the work order.
 *
 * There is NO localStorage authority and NO `src/lib/mediaStore.ts` on this
 * path. Uploads reuse the Customer Media Center pipeline ({@link uploadCustomerMedia}),
 * so Work Order uploads appear in the Customer Media Center and Customer Media
 * Center assets are selectable in work orders — one shared customer library.
 *
 * Placement model (all via `asset_links`):
 *   • Images tab (general attachment)
 *       entity_type  = "work_order"
 *       entity_id    = workOrderId
 *       placement_key= "work_order_image"
 *   • Header strip
 *       entity_type  = "work_order"
 *       entity_id    = workOrderId
 *       placement_key= "work_order_header_image"
 *   • Service-row strip
 *       entity_type  = "work_order_service_row"
 *       entity_id    = serviceRowId
 *       placement_key= "work_order_service_row_image"
 *       metadata.workOrderId = workOrderId
 *   • sort_order               → ordering within an area
 *   • metadata.visibleToEmployee → employee-app visibility (default true)
 *
 * Legacy `order.mediaPlacements` and `cleanops.mediaAssets` are NOT read or
 * written here; old `media_*` references simply resolve to nothing.
 */
import { loadCompanyUuidMap } from "@/lib/data/customerMigration";
import type { ProcessedImage } from "@/lib/mediaProcessing";
import type { MediaCategory } from "@/types";

import {
  createAssetLink,
  archiveAssetLink,
  listAssetLinks,
  updateAssetLink,
} from "./assetRepository";
import type {
  Asset,
  AssetLink,
  AssetLinkEntityType,
  AssetPlacementKey,
} from "./assetTypes";
import {
  customerMediaCategory,
  listCustomerMedia,
  resolveCustomerMediaSources,
  uploadCustomerMedia,
  type CustomerMediaSource,
} from "./customerMedia";

// ── Placement areas ──────────────────────────────────────────────────────────

/** A location inside a work order an image can be placed at. */
export type WorkOrderMediaArea =
  /** The "Images" tab — a general attachment to the work order. */
  | { surface: "images"; workOrderId: string }
  /** The work-order identity header strip. */
  | { surface: "header"; workOrderId: string }
  /** One specific service row. */
  | { surface: "service_row"; workOrderId: string; serviceRowId: string };

/** Resolves the `asset_links` coordinates + base metadata for an area. */
interface PlacementDescriptor {
  entityType: AssetLinkEntityType;
  entityId: string;
  placementKey: AssetPlacementKey;
  /** Extra metadata stamped on the link (e.g. the parent workOrderId). */
  baseMetadata: Record<string, unknown>;
}

/** Maps a {@link WorkOrderMediaArea} to its `asset_links` placement coordinates. */
export function descriptorForArea(area: WorkOrderMediaArea): PlacementDescriptor {
  switch (area.surface) {
    case "images":
      return {
        entityType: "work_order",
        entityId: area.workOrderId,
        placementKey: "work_order_image",
        baseMetadata: {},
      };
    case "header":
      return {
        entityType: "work_order",
        entityId: area.workOrderId,
        placementKey: "work_order_header_image",
        baseMetadata: {},
      };
    case "service_row":
      return {
        entityType: "work_order_service_row",
        entityId: area.serviceRowId,
        placementKey: "work_order_service_row_image",
        // workOrderId lets a service-row placement be traced back to its order.
        baseMetadata: { workOrderId: area.workOrderId },
      };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function requireCompanyUuid(companyId: string): Promise<string> {
  const normalized = companyId.trim();
  if (!normalized) throw new Error("Work order media requires a company context.");
  const map = await loadCompanyUuidMap();
  const uuid = map.get(normalized) ?? null;
  if (!uuid) throw new Error(`No Supabase company found for "${normalized}".`);
  return uuid;
}

/**
 * Employee-app visibility of a placement (stored on the LINK, not the asset).
 * Defaults to true so legacy/unset placements stay visible.
 */
export function placementVisibleToEmployee(link: Pick<AssetLink, "metadata">): boolean {
  return link.metadata?.visibleToEmployee !== false;
}

/** Sorts links by sort order (createdAt breaks ties). */
function bySortOrder(a: AssetLink, b: AssetLink): number {
  return a.sortOrder !== b.sortOrder
    ? a.sortOrder - b.sortOrder
    : a.createdAt.localeCompare(b.createdAt);
}

// ── Reads ───────────────────────────────────────────────────────────────────

/**
 * Lists the ACTIVE placement links for one area, ordered for display. These are
 * links only — resolving them to assets/sources is the caller's job (so the
 * shared customer-library fetch can be reused). Dangling links (whose asset was
 * deleted) are dropped at resolve time, not here.
 */
export async function listWorkOrderPlacementLinks(params: {
  companyId: string;
  area: WorkOrderMediaArea;
}): Promise<AssetLink[]> {
  const d = descriptorForArea(params.area);
  const links = await listAssetLinks({
    entityType: d.entityType,
    entityId: d.entityId,
    placementKey: d.placementKey,
    companyId: params.companyId,
  });
  return links.sort(bySortOrder);
}

/**
 * Lists the shared customer media library for a work order (newest first) and a
 * map of `assetId → signed-URL layer triplet`, resolved in one storage
 * round-trip. This is the SAME library the Customer Media Center shows.
 */
export async function listWorkOrderLibrary(params: {
  companyId: string;
  customerId: string;
}): Promise<{
  assets: Asset[];
  sources: Map<string, CustomerMediaSource>;
}> {
  const assets = await listCustomerMedia(params);
  const sources = await resolveCustomerMediaSources(assets);
  return { assets, sources };
}

/** The category an asset was uploaded under (re-exported for picker filters). */
export { customerMediaCategory as workOrderMediaCategory };

// ── Writes ───────────────────────────────────────────────────────────────────

/**
 * Links an existing customer asset into a work-order placement area. The link
 * denormalises the asset's scope/visibility (so the shared RLS predicates
 * apply). If the asset is already actively placed in this exact area the
 * existing link is returned unchanged — the same image is never linked twice to
 * one location.
 */
export async function attachWorkOrderMedia(params: {
  companyId: string;
  area: WorkOrderMediaArea;
  asset: Pick<Asset, "id" | "scope" | "visibility">;
  createdBy?: string | null;
}): Promise<AssetLink> {
  const { companyId, area, asset } = params;
  const d = descriptorForArea(area);
  const companyUuid = await requireCompanyUuid(companyId);

  // De-dupe + compute the next sort order from the current active links.
  const existing = await listAssetLinks({
    entityType: d.entityType,
    entityId: d.entityId,
    placementKey: d.placementKey,
    companyId,
  });
  const dup = existing.find((l) => l.assetId === asset.id);
  if (dup) return dup;
  const sortOrder =
    existing.length > 0 ? Math.max(...existing.map((l) => l.sortOrder)) + 1 : 0;

  return createAssetLink({
    assetId: asset.id,
    companyId,
    companyUuid,
    entityType: d.entityType,
    entityId: d.entityId,
    placementKey: d.placementKey,
    scope: asset.scope,
    visibility: asset.visibility,
    sortOrder,
    metadata: { ...d.baseMetadata, visibleToEmployee: true },
    createdBy: params.createdBy ?? null,
  });
}

export interface UploadWorkOrderMediaInput {
  companyId: string;
  customerId: string;
  area: WorkOrderMediaArea;
  processed: ProcessedImage;
  category: MediaCategory;
  createdBy?: string | null;
}

/**
 * Uploads a processed image as a customer-owned asset (admin/internal by
 * default — visibility is never silently widened) and immediately links it into
 * the given work-order area. Because the asset is customer-scoped it also shows
 * up in the Customer Media Center.
 */
export async function uploadWorkOrderMedia(
  input: UploadWorkOrderMediaInput,
): Promise<{ asset: Asset; link: AssetLink }> {
  const asset = await uploadCustomerMedia({
    companyId: input.companyId,
    customerId: input.customerId,
    processed: input.processed,
    category: input.category,
    visible: false, // admin/internal by default; customer-visible stays explicit.
    createdBy: input.createdBy ?? null,
  });
  const link = await attachWorkOrderMedia({
    companyId: input.companyId,
    area: input.area,
    asset,
    createdBy: input.createdBy ?? null,
  });
  return { asset, link };
}

/**
 * Removes a placement (archives the link). The customer-owned asset is NEVER
 * touched — it stays in the Customer Media Center.
 */
export async function detachWorkOrderMedia(linkId: string): Promise<void> {
  await archiveAssetLink(linkId);
}

/**
 * Reorders an area's placements to match `orderedLinkIds`: each listed link's
 * sort order becomes its index. Ids not in the list are left untouched.
 */
export async function reorderWorkOrderMedia(orderedLinkIds: string[]): Promise<void> {
  await Promise.all(
    orderedLinkIds.map((id, index) => updateAssetLink(id, { sortOrder: index })),
  );
}

/**
 * Sets a placement's employee-app visibility on the LINK metadata (so the same
 * image can be visible for one service row and hidden for another). Preserves
 * the rest of the link's metadata (e.g. workOrderId).
 */
export async function setWorkOrderMediaEmployeeVisibility(
  link: AssetLink,
  visibleToEmployee: boolean,
): Promise<AssetLink> {
  return updateAssetLink(link.id, {
    metadata: { ...(link.metadata ?? {}), visibleToEmployee },
  });
}
