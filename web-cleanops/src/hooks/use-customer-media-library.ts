/**
 * Customer Media Center — Supabase-authoritative React hook (Phase 2).
 *
 * Owns the Customer Media Center's data + mutations against the Asset Center
 * foundation. The read path is Supabase ONLY (no localStorage authority, no
 * browser-domain mirror); legacy `src/lib/mediaStore.ts` is never touched here,
 * so old Customer Media Center items cannot resurrect into this surface.
 *
 * Reads list a customer's assets and resolve their (short-lived, never-persisted)
 * signed-URL layer triplets in one batch. Mutations (upload / visibility toggle /
 * remove) commit to Supabase, then trigger a refetch so the UI reflects the true
 * persisted state — surviving a hard refresh. Errors surface via toast.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { useApp } from "@/context/AppContext";
import { useToast } from "@/hooks/use-toast";
import { authorize } from "@/lib/authz";
import { isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
// Permission KEY only — not a data path. Customer media never reads localStorage.
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
  archiveCustomerMedia,
  customerMediaCategory,
  isCustomerVisible,
  listCustomerMedia,
  resolveCustomerMediaSourceById,
  resolveCustomerMediaSources,
  setCustomerMediaVisibility,
  uploadCustomerMedia,
  type CustomerMediaSource,
} from "@/lib/assets/customerMedia";
import type { Asset } from "@/lib/assets";
import type { MediaCategory } from "@/types";

/** A customer-media row joined with its resolved signed-URL layers + flags. */
export interface CustomerMediaItem {
  asset: Asset;
  /** Legacy media category (preserved in asset metadata). */
  category: MediaCategory;
  /** Signed-URL layer triplet, or null when objects could not be signed. */
  source: CustomerMediaSource | null;
  /** True when the item is customer-visible (vs admin/internal). */
  visible: boolean;
}

export interface CustomerMediaLibraryResult {
  items: CustomerMediaItem[];
  loading: boolean;
  error: string | null;
  uploading: boolean;
  /** Processes + uploads files as customer-internal assets, then refetches. */
  upload: (files: File[], category: MediaCategory) => Promise<void>;
  /** Toggles an item between admin/internal and customer-visible, then refetches. */
  setVisible: (item: CustomerMediaItem, visible: boolean) => Promise<void>;
  /** Soft-deletes an item from the Center. Returns true on success. */
  remove: (item: CustomerMediaItem) => Promise<boolean>;
  refetch: () => Promise<void>;
}

/**
 * Customer Media Center data source for one customer. `companyId`/`customerId`
 * are the app-facing ids of the customer being managed (the admin's company
 * supplies RLS scope via the authenticated session).
 */
export function useCustomerMediaLibrary(
  companyId: string,
  customerId: string,
): CustomerMediaLibraryResult {
  const {
    currentUser,
    getUserPermissions,
    evaluateMediaUploadGate,
    logCustomerMediaActivity,
    logCustomerMediaMetaChange,
  } = useApp();
  const { toast } = useToast();

  const [items, setItems] = useState<CustomerMediaItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<boolean>(false);

  // Guards stale async reads from overwriting a newer fetch.
  const reqSeq = useRef<number>(0);

  const refetch = useCallback(async () => {
    const company = companyId?.trim() ?? "";
    const customer = customerId?.trim() ?? "";
    const seq = ++reqSeq.current;
    // Never read company-wide media: without a concrete customer this surface
    // shows nothing rather than every customer's media (cross-card isolation).
    if (!company || !customer) {
      setItems([]);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const stop = perf.start("customerMedia.list.supabase");
    try {
      const assets = await listCustomerMedia({ companyId: company, customerId: customer });
      const sources = await resolveCustomerMediaSources(assets);
      if (seq !== reqSeq.current) return; // superseded
      setItems(
        assets.map((asset) => ({
          asset,
          category: customerMediaCategory(asset),
          source: sources.get(asset.id) ?? null,
          visible: isCustomerVisible(asset),
        })),
      );
      setError(null);
    } catch (err) {
      if (seq !== reqSeq.current) return;
      setItems([]);
      setError(err instanceof Error ? err.message : "Failed to load media.");
    } finally {
      stop();
      if (seq === reqSeq.current) setLoading(false);
    }
  }, [companyId, customerId]);

  useEffect(() => {
    // Drop the previously-viewed customer's media SYNCHRONOUSLY when the
    // company/customer key changes (refetch identity changes with it). A slow or
    // failed fetch can then never leave another customer's images on screen.
    setItems([]);
    setError(null);
    void refetch();
  }, [refetch]);

  const upload = useCallback(
    async (files: File[], category: MediaCategory) => {
      if (files.length === 0) return;
      if (!currentUser) {
        toast({ title: "Sign in required", description: "You must be signed in to upload.", variant: "destructive" });
        return;
      }
      const permissions = getUserPermissions(currentUser);
      const allowed = authorize({
        user: currentUser,
        permissions,
        permission: MEDIA_MANAGE_PERMISSION,
        resourceCompanyId: companyId,
      });
      if (!allowed) {
        const msg = describePermissionBlock();
        toast({ title: msg.title, description: msg.description, variant: "destructive" });
        return;
      }
      const gate = evaluateMediaUploadGate(companyId);
      if (!gate.allowed) {
        const msg = describeEntitlementBlock(gate, currentUser.role);
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
            await uploadCustomerMedia({
              companyId,
              customerId,
              processed,
              category,
              visible: false, // admin/internal by default; customer-visible is explicit.
              createdBy: currentUser.id,
            });
            logCustomerMediaActivity(customerId, "uploaded", category);
            stored += 1;
          } catch (err) {
            console.error("[customerMedia] upload failed", err);
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
      currentUser,
      getUserPermissions,
      companyId,
      customerId,
      evaluateMediaUploadGate,
      logCustomerMediaActivity,
      toast,
      refetch,
    ],
  );

  const setVisible = useCallback(
    async (item: CustomerMediaItem, visible: boolean) => {
      if (item.visible === visible) return;
      try {
        await setCustomerMediaVisibility(item.asset.id, visible, currentUser?.id ?? null);
        logCustomerMediaMetaChange(
          customerId,
          "Image visibility",
          item.visible ? "Customer-visible" : "Admin only",
          visible ? "Customer-visible" : "Admin only",
        );
        await refetch();
      } catch (err) {
        toast({
          title: "Could not update visibility",
          description: err instanceof Error ? err.message : "Please try again.",
          variant: "destructive",
        });
      }
    },
    [currentUser, customerId, logCustomerMediaMetaChange, toast, refetch],
  );

  const remove = useCallback(
    async (item: CustomerMediaItem): Promise<boolean> => {
      try {
        await archiveCustomerMedia(item.asset.id);
        logCustomerMediaActivity(customerId, "deleted", item.category);
        await refetch();
        return true;
      } catch (err) {
        toast({
          title: "Could not delete image",
          description: err instanceof Error ? err.message : "Please try again.",
          variant: "destructive",
        });
        return false;
      }
    },
    [customerId, logCustomerMediaActivity, toast, refetch],
  );

  return { items, loading, error, uploading, upload, setVisible, remove, refetch };
}

/**
 * Resolves the signed-URL layer triplet for a customer's cover image (an asset
 * id stored on the customer record). Returns null when unset, unconfigured, or
 * the asset is gone — callers fall back to initials. Never throws.
 */
export function useCustomerCoverImage(
  coverAssetId: string | null | undefined,
  customerId?: string | null,
): CustomerMediaSource | null {
  const [source, setSource] = useState<CustomerMediaSource | null>(null);

  useEffect(() => {
    let active = true;
    if (!coverAssetId || !isSupabaseConfigured) {
      setSource(null);
      return;
    }
    // Pass the selected customer so a stale/foreign cover pointer can only ever
    // resolve THIS customer's own asset (never another customer's image).
    void resolveCustomerMediaSourceById(coverAssetId, customerId ?? null).then((s) => {
      if (active) setSource(s);
    });
    return () => {
      active = false;
    };
  }, [coverAssetId, customerId]);

  return source;
}
