/**
 * Super Admin Media Center — Supabase-authoritative React hook (Phase 1).
 *
 * Owns the platform-level global/website media surface's data + mutations on top
 * of the Asset Center foundation. The read path is Supabase ONLY (no localStorage
 * authority, no mediaStore fallback, no browser-domain mirror). Reads list the
 * three global scopes and resolve their (short-lived, never-persisted) URLs in
 * one batch. Mutations commit to Supabase first, then refetch so the UI reflects
 * the true persisted state — surviving a hard refresh. Errors surface via toast.
 *
 * Management is Super-Admin only; the hook no-ops safely for any other role (the
 * route guard is the primary gate, this is defense-in-depth).
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { useApp } from "@/context/AppContext";
import { useToast } from "@/hooks/use-toast";
import { isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import {
  logAssetArchived,
  logAssetUploaded,
  safeRecordAssetActivity,
} from "@/lib/assets/assetAudit";
import {
  archiveGlobalMedia,
  globalMediaPlacement,
  isPublicGlobalAsset,
  listGlobalMedia,
  removeGlobalMediaFromLibrary,
  resolveGlobalMediaUrls,
  restoreGlobalMedia,
  updateGlobalMediaMeta,
  uploadGlobalMedia,
  type GlobalMediaUrls,
  type GlobalMediaVisibilityTarget,
  type UpdateGlobalMediaInput,
} from "@/lib/assets/globalMedia";
import {
  clearLoginBackground as clearLoginBackgroundRemote,
  getLoginBackgroundLink,
  setLoginBackground as setLoginBackgroundRemote,
} from "@/lib/assets/loginBranding";
import type { Asset } from "@/lib/assets/assetTypes";

/** A platform asset joined with its resolved URLs + lifecycle flags. */
export interface GlobalMediaItem {
  asset: Asset;
  urls: GlobalMediaUrls | null;
  isPublic: boolean;
  isArchived: boolean;
}

/** Shared metadata applied to every file in one upload batch. */
export interface UploadGlobalMediaOptions {
  target: GlobalMediaVisibilityTarget;
  title?: string | null;
  description?: string | null;
  tags?: string[];
  categoryId?: string | null;
  folderId?: string | null;
  pathSlug?: string | null;
}

export interface GlobalMediaLibraryResult {
  items: GlobalMediaItem[];
  loading: boolean;
  error: string | null;
  uploading: boolean;
  /** True only for a Super Admin against a configured Supabase. */
  canManage: boolean;
  /** App-facing id of the asset currently used as the login background (or null). */
  loginBackgroundAssetId: string | null;
  /** Sets a public image/video as the sign-in screen background, then refetches. */
  setAsLoginBackground: (item: GlobalMediaItem) => Promise<void>;
  /** Clears the login background (reverts to the default), then refetches. */
  clearLoginBackground: () => Promise<void>;
  /** Uploads files as platform assets with shared metadata, then refetches. */
  upload: (files: File[], opts: UploadGlobalMediaOptions) => Promise<void>;
  /** Edits an asset's metadata (title/description/tags/category), then refetches. */
  updateMeta: (item: GlobalMediaItem, patch: UpdateGlobalMediaInput) => Promise<void>;
  /** Archives an asset (reversible), then refetches. */
  archive: (item: GlobalMediaItem) => Promise<void>;
  /** Restores an archived asset, then refetches. */
  restore: (item: GlobalMediaItem) => Promise<void>;
  /** Removes an asset from future global-library selection via archive semantics. */
  remove: (item: GlobalMediaItem) => Promise<boolean>;
  refetch: () => Promise<void>;
}

/** Platform-media data source for the Super Admin Media Center. */
export function useGlobalMediaLibrary(): GlobalMediaLibraryResult {
  const { currentUser } = useApp();
  const { toast } = useToast();

  const [items, setItems] = useState<GlobalMediaItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<boolean>(false);
  const [loginBackgroundAssetId, setLoginBackgroundAssetId] = useState<string | null>(null);

  const isSuperAdmin = currentUser?.role === "super_admin";
  const canManage = isSuperAdmin && isSupabaseConfigured;
  const actorId = currentUser?.id ?? null;
  const actorRole = currentUser?.role ?? null;

  // Guards stale async reads from overwriting a newer fetch.
  const reqSeq = useRef<number>(0);

  const refetch = useCallback(async () => {
    const seq = ++reqSeq.current;
    if (!isSuperAdmin || !isSupabaseConfigured) {
      setItems([]);
      setError(isSuperAdmin ? "Media Center requires Supabase." : null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const stop = perf.start("globalMedia.list.supabase");
    try {
      const assets = await listGlobalMedia({ includeArchived: true });
      const [urls, bgLink] = await Promise.all([
        resolveGlobalMediaUrls(assets),
        getLoginBackgroundLink().catch(() => null),
      ]);
      if (seq !== reqSeq.current) return; // superseded
      setItems(
        assets.map((asset) => ({
          asset,
          urls: urls.get(asset.id) ?? null,
          isPublic: isPublicGlobalAsset(asset),
          isArchived: Boolean(asset.archivedAt),
        })),
      );
      setLoginBackgroundAssetId(bgLink?.assetId ?? null);
      setError(null);
    } catch (err) {
      if (seq !== reqSeq.current) return;
      setItems([]);
      setError(err instanceof Error ? err.message : "Failed to load media.");
    } finally {
      stop();
      if (seq === reqSeq.current) setLoading(false);
    }
  }, [isSuperAdmin]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const upload = useCallback(
    async (files: File[], opts: UploadGlobalMediaOptions) => {
      if (files.length === 0) return;
      if (!canManage) {
        toast({
          title: "Not allowed",
          description: "Only a Super Admin can manage platform media.",
          variant: "destructive",
        });
        return;
      }

      const { scope, visibility } = globalMediaPlacement(opts.target);
      // A single shared title only makes sense for one file; multiple files keep
      // their own filename as the title so they stay individually identifiable.
      const single = files.length === 1;

      setUploading(true);
      let stored = 0;
      const failures: string[] = [];
      try {
        for (const file of files) {
          try {
            const asset = await uploadGlobalMedia({
              file,
              target: opts.target,
              title: single ? (opts.title ?? null) : null,
              description: opts.description ?? null,
              tags: opts.tags ?? [],
              categoryId: opts.categoryId ?? null,
              folderId: opts.folderId ?? null,
              pathSlug: opts.pathSlug ?? null,
              createdBy: actorId,
            });
            void logAssetUploaded({
              assetId: asset.id,
              actorUserId: actorId,
              actorRole,
              scope,
              visibility,
              summary: `Uploaded ${asset.title ?? asset.name} (${opts.target === "public" ? "Website / Public" : "Global internal"})`,
            });
            stored += 1;
          } catch (err) {
            console.error("[globalMedia] upload failed", err);
            failures.push(
              `${file.name}: ${err instanceof Error ? err.message : "could not upload."}`,
            );
          }
        }
      } finally {
        setUploading(false);
      }

      if (stored > 0) {
        toast({
          title: stored === 1 ? "Asset uploaded" : `${stored} assets uploaded`,
          description:
            opts.target === "public"
              ? "Stored as a public website asset — its URL is shareable."
              : "Stored in the private global library.",
        });
        await refetch();
      }
      if (failures.length > 0) {
        toast({
          title: stored > 0 ? "Some files were skipped" : "Upload failed",
          description: failures.join(" "),
          variant: "destructive",
        });
      }
    },
    [canManage, actorId, actorRole, toast, refetch],
  );

  const updateMeta = useCallback(
    async (item: GlobalMediaItem, patch: UpdateGlobalMediaInput) => {
      if (!canManage) return;
      try {
        await updateGlobalMediaMeta(item.asset.id, { ...patch, updatedBy: actorId });
        await refetch();
        toast({ title: "Saved", description: "Asset details updated." });
      } catch (err) {
        toast({
          title: "Could not save changes",
          description: err instanceof Error ? err.message : "Please try again.",
          variant: "destructive",
        });
      }
    },
    [canManage, actorId, toast, refetch],
  );

  const archive = useCallback(
    async (item: GlobalMediaItem) => {
      if (!canManage) return;
      try {
        await archiveGlobalMedia(item.asset.id);
        void logAssetArchived({
          assetId: item.asset.id,
          actorUserId: actorId,
          actorRole,
          scope: item.asset.scope,
          visibility: item.asset.visibility,
          summary: `Archived ${item.asset.title ?? item.asset.name}`,
        });
        await refetch();
        toast({
          title: "Asset archived",
          description:
            "Removed from future Media Center selection. Existing usages continue to display.",
        });
      } catch (err) {
        toast({
          title: "Could not archive",
          description: err instanceof Error ? err.message : "Please try again.",
          variant: "destructive",
        });
      }
    },
    [canManage, actorId, actorRole, toast, refetch],
  );

  const restore = useCallback(
    async (item: GlobalMediaItem) => {
      if (!canManage) return;
      try {
        await restoreGlobalMedia(item.asset.id);
        void safeRecordAssetActivity({
          eventType: "asset_restored",
          assetId: item.asset.id,
          actorUserId: actorId,
          actorRole,
          scope: item.asset.scope,
          visibility: item.asset.visibility,
          summary: `Restored ${item.asset.title ?? item.asset.name}`,
        });
        await refetch();
      } catch (err) {
        toast({
          title: "Could not restore",
          description: err instanceof Error ? err.message : "Please try again.",
          variant: "destructive",
        });
      }
    },
    [canManage, actorId, actorRole, toast, refetch],
  );

  const setAsLoginBackground = useCallback(
    async (item: GlobalMediaItem) => {
      if (!canManage) return;
      if (!item.isPublic) {
        toast({
          title: "Make it public first",
          description:
            "Only a Website / Public asset can be the login background — its URL must be " +
            "readable on the sign-in screen.",
          variant: "destructive",
        });
        return;
      }
      try {
        await setLoginBackgroundRemote(item.asset, { id: actorId, role: actorRole });
        await refetch();
        toast({
          title: "Login background updated",
          description: `\u201C${item.asset.title ?? item.asset.name}\u201D now shows on the sign-in screen.`,
        });
      } catch (err) {
        toast({
          title: "Could not set login background",
          description: err instanceof Error ? err.message : "Please try again.",
          variant: "destructive",
        });
      }
    },
    [canManage, actorId, actorRole, toast, refetch],
  );

  const clearLoginBackground = useCallback(async () => {
    if (!canManage) return;
    try {
      await clearLoginBackgroundRemote({ id: actorId, role: actorRole });
      await refetch();
      toast({
        title: "Login background cleared",
        description: "The sign-in screen reverts to the built-in default background.",
      });
    } catch (err) {
      toast({
        title: "Could not clear login background",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    }
  }, [canManage, actorId, actorRole, toast, refetch]);

  const remove = useCallback(
    async (item: GlobalMediaItem): Promise<boolean> => {
      if (!canManage) return false;
      try {
        await removeGlobalMediaFromLibrary(item.asset.id);
        void logAssetArchived({
          assetId: item.asset.id,
          actorUserId: actorId,
          actorRole,
          scope: item.asset.scope,
          visibility: item.asset.visibility,
          summary: `Removed ${item.asset.title ?? item.asset.name} from the global library`,
        });
        await refetch();
        toast({
          title: "Asset archived",
          description:
            "Removed from future Media Center selection. Existing usages continue to display.",
        });
        return true;
      } catch (err) {
        toast({
          title: "Could not archive",
          description: err instanceof Error ? err.message : "Please try again.",
          variant: "destructive",
        });
        return false;
      }
    },
    [canManage, actorId, actorRole, toast, refetch],
  );

  return {
    items,
    loading,
    error,
    uploading,
    canManage,
    loginBackgroundAssetId,
    setAsLoginBackground,
    clearLoginBackground,
    upload,
    updateMeta,
    archive,
    restore,
    remove,
    refetch,
  };
}
