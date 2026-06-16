import type {
  WorkOrderMediaPlacement,
  WorkOrderMediaPlacementType,
} from "@/types";

/**
 * Pure helpers for managing {@link WorkOrderMediaPlacement} links on a work
 * order. Placements are references to customer-owned media assets; these
 * functions never touch the asset store. They are deliberately side-effect free
 * (no id/time generation, no persistence) so the AppContext can supply ids and
 * timestamps and so the behaviour stays unit-testable.
 *
 * Guarantees enforced here:
 *  - The same asset may be placed many times, EXCEPT a single (area, asset)
 *    pair is de-duplicated so an asset isn't linked twice to the exact same
 *    location (e.g. the header, or one specific service row).
 *  - Removing a placement only drops the link; the asset is untouched.
 *  - Deleting an asset removes every placement that referenced it.
 *  - Sort order is contiguous and scoped to each placement area.
 */

/** Identifies a single placement "area": the header, or one service row. */
export interface PlacementArea {
  placementType: WorkOrderMediaPlacementType;
  /** Required for "service_row"; ignored otherwise. */
  serviceRowId?: string | null;
}

/** Whether a placement belongs to the given area. */
function inArea(placement: WorkOrderMediaPlacement, area: PlacementArea): boolean {
  if (placement.placementType !== area.placementType) return false;
  if (area.placementType === "service_row") {
    return (placement.serviceRowId ?? null) === (area.serviceRowId ?? null);
  }
  return true;
}

/**
 * Returns the placements in one area, ascending by sort order (createdAt breaks
 * ties for legacy data with equal sort orders).
 */
export function selectPlacements(
  placements: WorkOrderMediaPlacement[] | undefined,
  area: PlacementArea,
): WorkOrderMediaPlacement[] {
  return (placements ?? [])
    .filter((p) => inArea(p, area))
    .sort((a, b) =>
      a.sortOrder !== b.sortOrder
        ? a.sortOrder - b.sortOrder
        : a.createdAt.localeCompare(b.createdAt),
    );
}

/** The next free sort order (max + 1) within an area; 0 when the area is empty. */
export function nextSortOrder(
  placements: WorkOrderMediaPlacement[] | undefined,
  area: PlacementArea,
): number {
  const inside = (placements ?? []).filter((p) => inArea(p, area));
  if (inside.length === 0) return 0;
  return Math.max(...inside.map((p) => p.sortOrder)) + 1;
}

/** Whether an asset is already placed in the given area. */
export function isAssetPlacedInArea(
  placements: WorkOrderMediaPlacement[] | undefined,
  area: PlacementArea,
  mediaAssetId: string,
): boolean {
  return (placements ?? []).some(
    (p) => inArea(p, area) && p.mediaAssetId === mediaAssetId,
  );
}

export interface AddPlacementInput {
  mediaAssetId: string;
  placementType: WorkOrderMediaPlacementType;
  serviceRowId?: string | null;
  /** Defaults to true (visible in the future Employee App). */
  visibleToEmployee?: boolean;
}

export interface AddPlacementResult {
  placements: WorkOrderMediaPlacement[];
  /** The created placement, or null when it was a no-op (already placed). */
  added: WorkOrderMediaPlacement | null;
}

/**
 * Appends a placement to an area, supplying the caller-provided id/time. If the
 * asset is already placed in that exact area the list is returned unchanged
 * (`added: null`) so the same image is never linked twice to one location.
 */
export function addPlacement(
  placements: WorkOrderMediaPlacement[] | undefined,
  input: AddPlacementInput,
  id: string,
  createdAt: string,
): AddPlacementResult {
  const current = placements ?? [];
  const area: PlacementArea = {
    placementType: input.placementType,
    serviceRowId: input.serviceRowId ?? null,
  };
  if (isAssetPlacedInArea(current, area, input.mediaAssetId)) {
    return { placements: current, added: null };
  }
  const placement: WorkOrderMediaPlacement = {
    id,
    mediaAssetId: input.mediaAssetId,
    placementType: input.placementType,
    serviceRowId:
      input.placementType === "service_row" ? input.serviceRowId ?? null : null,
    visibleToEmployee: input.visibleToEmployee ?? true,
    sortOrder: nextSortOrder(current, area),
    createdAt,
  };
  return { placements: [...current, placement], added: placement };
}

/** Removes a single placement link by id. The asset is never affected. */
export function removePlacement(
  placements: WorkOrderMediaPlacement[] | undefined,
  placementId: string,
): WorkOrderMediaPlacement[] {
  return (placements ?? []).filter((p) => p.id !== placementId);
}

/**
 * Removes every placement referencing an asset. Call this when an asset is
 * deleted from the Customer Media Library so no dangling links remain.
 */
export function removePlacementsForAsset(
  placements: WorkOrderMediaPlacement[] | undefined,
  mediaAssetId: string,
): WorkOrderMediaPlacement[] {
  return (placements ?? []).filter((p) => p.mediaAssetId !== mediaAssetId);
}

/**
 * Reorders the placements in one area to match `orderedIds`. Placements outside
 * the area are preserved untouched; ids in `orderedIds` not present in the area
 * are ignored, and area placements missing from `orderedIds` keep their relative
 * order after the listed ones.
 */
export function reorderPlacements(
  placements: WorkOrderMediaPlacement[] | undefined,
  area: PlacementArea,
  orderedIds: string[],
): WorkOrderMediaPlacement[] {
  const current = placements ?? [];
  const inside = selectPlacements(current, area);
  const rank = new Map(orderedIds.map((id, idx) => [id, idx]));
  const sortedInside = [...inside].sort((a, b) => {
    const ra = rank.has(a.id) ? (rank.get(a.id) as number) : Number.MAX_SAFE_INTEGER;
    const rb = rank.has(b.id) ? (rank.get(b.id) as number) : Number.MAX_SAFE_INTEGER;
    return ra - rb;
  });
  const newOrderById = new Map(sortedInside.map((p, idx) => [p.id, idx]));
  return current.map((p) =>
    newOrderById.has(p.id)
      ? { ...p, sortOrder: newOrderById.get(p.id) as number }
      : p,
  );
}

/** Sets a placement's employee-app visibility flag. */
export function setPlacementEmployeeVisibility(
  placements: WorkOrderMediaPlacement[] | undefined,
  placementId: string,
  visibleToEmployee: boolean,
): WorkOrderMediaPlacement[] {
  return (placements ?? []).map((p) =>
    p.id === placementId ? { ...p, visibleToEmployee } : p,
  );
}
