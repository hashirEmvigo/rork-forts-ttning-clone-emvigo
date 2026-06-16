/**
 * Work Order media — Supabase-authoritative React hook (Phase 3).
 *
 * Powers every work-order image surface (Images tab, header strip, per-service
 * row) on top of the Asset Center foundation. The read path is Supabase ONLY —
 * no localStorage authority, no `src/lib/mediaStore.ts`, no browser-domain
 * mirror. Work-order images ARE customer-owned assets (the shared customer
 * library) plus `asset_links` placements, so uploads here appear in the Customer
 * Media Center and Customer Media Center assets are selectable here.
 *
 * Mutations commit to Supabase and then refetch, so the UI reflects the true
 * persisted state and survives a hard refresh. Uploads preserve the existing
 * gating order (permission → service entitlement → trial limit); attach / detach
 * / reorder / visibility require the same `media.manage` permission as the
 * legacy attach/detach did — never more permissive.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useApp } from "@/context/AppContext";
import { useToast } from "@/hooks/use-toast";
import { authorize } from "@/lib/authz";
import { perf } from "@/lib/perf";
// Permission KEY only — not a data path. Work-order media never reads localStorage.
import { MEDIA_MANAGE_PERMISSION } from "@/lib/mediaStore";
import {
  describeImageRejection,
  estimateStorageSavings,
  formatBytes,
  processImageFile,
} from "@/lib/mediaProcessing";
import {
  describeEntitlementBlock,
  describePermissionBlock,
} from "@/lib/mediaUploadMessaging";
import {
  attachWorkOrderMedia,
  detachWorkOrderMedia,
  listWorkOrderLibrary,
  listWorkOrderPlacementLinks,
  placementVisibleToEmployee,
  reorderWorkOrderMedia,
  setWorkOrderMediaEmployeeVisibility,
  uploadWorkOrderMedia,
  workOrderMediaCategory,
  type WorkOrderMediaArea,
} from "@/lib/assets/workOrderMedia";
import type { CustomerMediaSource } from "@/lib/assets/customerMedia";
import type { Asset, AssetLink } from "@/lib/assets";
import type { MediaCategory, WorkOrder } from "@/types";

/** A customer-library asset joined with its resolved signed-URL layers. */
export interface WorkOrderMediaLibraryItem {
  asset: Asset;
  source: CustomerMediaSource | null;
  category: MediaCategory;
}

/** A resolved placement: a link joined with its (live) asset + layers. */
export interface ResolvedWorkOrderPlacement {
  link: AssetLink;
  asset: Asset;
  source: CustomerMediaSource | null;
  category: MediaCategory;
  /** Employee-app visibility, read from the link metadata (default true). */
  visibleToEmployee: boolean;
}

export interface WorkOrderMediaResult {
  /** Placements for THIS area, ordered for display (dangling links dropped). */
  placements: ResolvedWorkOrderPlacement[];
  /** The shared customer media library (newest first) for the picker. */
  library: WorkOrderMediaLibraryItem[];
  loading: boolean;
  error: string | null;
  uploading: boolean;
  /** Links an existing customer asset into this area, then refetches. */
  attach: (assetId: string) => Promise<void>;
  /** Uploads files as customer-owned assets and links them here, then refetches. */
  uploadAndAttach: (files: File[], category: MediaCategory) => Promise<void>;
  /** Removes a placement (keeps the asset in the library), then refetches. */
  detach: (linkId: string) => Promise<void>;
  /** Reorders this area's placements to match the given link ids. */
  reorder: (orderedLinkIds: string[]) => Promise<void>;
  /** Sets a placement's employee-app visibility, then refetches. */
  setEmployeeVisibility: (linkId: string, visible: boolean) => Promise<void>;
  refetch: () => Promise<void>;
}

/**
 * Work-order media for one placement area on one work order. The work order
 * supplies the company/customer scope; `area` selects the Images tab, the header
 * strip, or a specific service row.
 */
export function useWorkOrderMedia(
  order: WorkOrder,
  area: WorkOrderMediaArea,
): WorkOrderMediaResult {
  const { currentUser, getUserPermissions, evaluateMediaUploadGate } = useApp();
  const { toast } = useToast();

  const companyId = order.companyId;
  const customerId = order.customerId;

  // Rebuild a stable area object from primitives so effect/callback deps don't
  // change identity every render.
  const surface = area.surface;
  const workOrderId = area.workOrderId;
  const serviceRowId = area.surface === "service_row" ? area.serviceRowId : null;
  const stableArea = useMemo<WorkOrderMediaArea>(
    () =>
      surface === "service_row" && serviceRowId != null
        ? { surface, workOrderId, serviceRowId }
        : surface === "header"
          ? { surface: "header", workOrderId }
          : { surface: "images", workOrderId },
    [surface, workOrderId, serviceRowId],
  );

  const [placements, setPlacements] = useState<ResolvedWorkOrderPlacement[]>([]);
  const [library, setLibrary] = useState<WorkOrderMediaLibraryItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<boolean>(false);

  // Guards stale async reads from overwriting a newer fetch.
  const reqSeq = useRef<number>(0);

  const refetch = useCallback(async () => {
    const seq = ++reqSeq.current;
    setLoading(true);
    const stop = perf.start("workOrderMedia.list.supabase");
    try {
      const [{ assets, sources }, links] = await Promise.all([
        listWorkOrderLibrary({ companyId, customerId }),
        listWorkOrderPlacementLinks({ companyId, area: stableArea }),
      ]);
      if (seq !== reqSeq.current) return; // superseded
      const assetById = new Map(assets.map((a) => [a.id, a]));
      setLibrary(
        assets.map((asset) => ({
          asset,
          source: sources.get(asset.id) ?? null,
          category: workOrderMediaCategory(asset),
        })),
      );
      setPlacements(
        links
          .map((link) => {
            const asset = assetById.get(link.assetId);
            // Drop dangling links — e.g. the asset was deleted in the Customer
            // Media Center (soft-deleted assets are excluded from the library).
            if (!asset) return null;
            return {
              link,
              asset,
              source: sources.get(asset.id) ?? null,
              category: workOrderMediaCategory(asset),
              visibleToEmployee: placementVisibleToEmployee(link),
            };
          })
          .filter((x): x is ResolvedWorkOrderPlacement => x !== null),
      );
      setError(null);
    } catch (err) {
      if (seq !== reqSeq.current) return;
      setLibrary([]);
      setPlacements([]);
      setError(
        err instanceof Error ? err.message : "Failed to load work order media.",
      );
    } finally {
      stop();
      if (seq === reqSeq.current) setLoading(false);
    }
  }, [companyId, customerId, stableArea]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  /** Client-side `media.manage` gate (RLS enforces it again server-side). */
  const ensureCanManage = useCallback((): boolean => {
    if (!currentUser) {
      toast({
        title: "Sign in required",
        description: "You must be signed in to manage work order images.",
        variant: "destructive",
      });
      return false;
    }
    const allowed = authorize({
      user: currentUser,
      permissions: getUserPermissions(currentUser),
      permission: MEDIA_MANAGE_PERMISSION,
      resourceCompanyId: companyId,
    });
    if (!allowed) {
      const msg = describePermissionBlock();
      toast({ title: msg.title, description: msg.description, variant: "destructive" });
      return false;
    }
    return true;
  }, [currentUser, getUserPermissions, companyId, toast]);

  const attach = useCallback(
    async (assetId: string) => {
      if (!ensureCanManage()) return;
      const item = library.find((l) => l.asset.id === assetId);
      if (!item) return;
      try {
        await attachWorkOrderMedia({
          companyId,
          area: stableArea,
          asset: item.asset,
          createdBy: currentUser?.id ?? null,
        });
        await refetch();
      } catch (err) {
        toast({
          title: "Could not place image",
          description: err instanceof Error ? err.message : "Please try again.",
          variant: "destructive",
        });
      }
    },
    [ensureCanManage, library, companyId, stableArea, currentUser, refetch, toast],
  );

  const uploadAndAttach = useCallback(
    async (files: File[], category: MediaCategory) => {
      if (files.length === 0) return;
      if (!ensureCanManage()) return;
      // Service entitlement / trial limit (permission already checked above).
      const gate = evaluateMediaUploadGate(companyId);
      if (!gate.allowed) {
        const msg = describeEntitlementBlock(gate, currentUser!.role);
        toast({ title: msg.title, description: msg.description, variant: "destructive" });
        return;
      }

      setUploading(true);
      let stored = 0;
      let savedBytes = 0;
      const failures: string[] = [];
      try {
        for (const file of files) {
          const rejection = describeImageRejection(file);
          if (rejection !== null) {
            failures.push(
              rejection === "too_large"
                ? `Maximum file size is 20 MB (this file is ${formatBytes(file.size)}).`
                : rejection === "empty"
                  ? "The file is empty."
                  : `Unsupported image format${file.type ? ` (${file.type})` : ""}.`,
            );
            continue;
          }
          // Re-check mid-batch so a trial/service limit is respected.
          if (!evaluateMediaUploadGate(companyId).allowed) break;
          try {
            const processed = await processImageFile(file);
            savedBytes += estimateStorageSavings(file.size, processed.totalBytes).savedBytes;
            await uploadWorkOrderMedia({
              companyId,
              customerId,
              area: stableArea,
              processed,
              category,
              createdBy: currentUser?.id ?? null,
            });
            stored += 1;
          } catch (err) {
            console.error("[workOrderMedia] upload failed", err);
            failures.push(
              err instanceof Error ? err.message : "Could not upload this image.",
            );
          }
        }
      } finally {
        setUploading(false);
      }

      if (stored > 0) {
        toast({
          title: stored === 1 ? "Image uploaded" : `${stored} images uploaded`,
          description: `Compressed only — saved about ${formatBytes(savedBytes)} versus the originals.`,
        });
        await refetch();
      }
      if (failures.length > 0) {
        toast({
          title: stored > 0 ? "Some images were skipped" : "Upload failed",
          description: Array.from(new Set(failures)).join(" "),
          variant: "destructive",
        });
      }
    },
    [
      ensureCanManage,
      evaluateMediaUploadGate,
      companyId,
      customerId,
      stableArea,
      currentUser,
      refetch,
      toast,
    ],
  );

  const detach = useCallback(
    async (linkId: string) => {
      if (!ensureCanManage()) return;
      try {
        await detachWorkOrderMedia(linkId);
        await refetch();
        toast({
          title: "Removed from work order",
          description: "The image stays in the Customer Media Center.",
        });
      } catch (err) {
        toast({
          title: "Could not remove image",
          description: err instanceof Error ? err.message : "Please try again.",
          variant: "destructive",
        });
      }
    },
    [ensureCanManage, refetch, toast],
  );

  const reorder = useCallback(
    async (orderedLinkIds: string[]) => {
      if (!ensureCanManage()) return;
      // Optimistic: reflect the new order immediately, then persist + refetch.
      setPlacements((prev) => {
        const byId = new Map(prev.map((p) => [p.link.id, p]));
        const next = orderedLinkIds
          .map((id) => byId.get(id))
          .filter((p): p is ResolvedWorkOrderPlacement => p != null);
        for (const p of prev) if (!orderedLinkIds.includes(p.link.id)) next.push(p);
        return next;
      });
      try {
        await reorderWorkOrderMedia(orderedLinkIds);
        await refetch();
      } catch (err) {
        await refetch(); // restore the true order on failure
        toast({
          title: "Could not reorder images",
          description: err instanceof Error ? err.message : "Please try again.",
          variant: "destructive",
        });
      }
    },
    [ensureCanManage, refetch, toast],
  );

  const setEmployeeVisibility = useCallback(
    async (linkId: string, visible: boolean) => {
      if (!ensureCanManage()) return;
      const placement = placements.find((p) => p.link.id === linkId);
      if (!placement) return;
      try {
        await setWorkOrderMediaEmployeeVisibility(placement.link, visible);
        await refetch();
      } catch (err) {
        toast({
          title: "Could not update visibility",
          description: err instanceof Error ? err.message : "Please try again.",
          variant: "destructive",
        });
      }
    },
    [ensureCanManage, placements, refetch, toast],
  );

  return {
    placements,
    library,
    loading,
    error,
    uploading,
    attach,
    uploadAndAttach,
    detach,
    reorder,
    setEmployeeVisibility,
    refetch,
  };
}
