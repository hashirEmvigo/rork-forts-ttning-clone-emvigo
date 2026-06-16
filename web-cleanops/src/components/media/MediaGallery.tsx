import { useCallback, useMemo, useState } from "react";
import { ImageOff, LayoutGrid, List, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useApp } from "@/context/AppContext";
import { MediaImage } from "@/components/media/MediaImage";
import {
  MediaUploader,
  type MediaUploaderBinding,
} from "@/components/media/MediaUploader";
import { deleteMediaAsset, listMediaForEntity } from "@/lib/mediaStore";
import { formatBytes } from "@/lib/mediaProcessing";
import type { MediaAsset } from "@/types";

type GalleryView = "grid" | "list";

interface MediaGalleryProps {
  /** Entity whose media is shown and to which new uploads are attached. */
  binding: MediaUploaderBinding;
  title?: string;
  /** Initial view mode. Default "grid". */
  defaultView?: GalleryView;
  /** Hide the uploader (read-only galleries). Default false. */
  readOnly?: boolean;
  className?: string;
}

/**
 * Reusable media gallery used across Customers, Work Orders, Employees,
 * Protocols and future modules. It lists company-scoped assets for an entity
 * using only micro thumbnails, escalates to hover/preview layers on demand via
 * {@link MediaImage}, and shares the single {@link MediaUploader} experience.
 */
export function MediaGallery({
  binding,
  title = "Images",
  defaultView = "grid",
  readOnly = false,
  className,
}: MediaGalleryProps) {
  const { currentUser, getUserPermissions } = useApp();
  const [view, setView] = useState<GalleryView>(defaultView);
  // mediaStore is not reactive; bump this to re-query after writes.
  const [revision, setRevision] = useState<number>(0);

  const permissions = currentUser ? getUserPermissions(currentUser) : [];

  const assets = useMemo<MediaAsset[]>(() => {
    if (!currentUser) return [];
    return listMediaForEntity(
      currentUser,
      permissions,
      binding.entityType,
      binding.entityId,
    );
    // revision intentionally forces a re-read after uploads / deletions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, permissions, binding.entityType, binding.entityId, revision]);

  const handleDelete = useCallback(
    (assetId: string) => {
      if (!currentUser) return;
      if (deleteMediaAsset(currentUser, permissions, assetId)) {
        setRevision((r) => r + 1);
      }
    },
    [currentUser, permissions],
  );

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">
          {title}
          {assets.length > 0 ? (
            <span className="ml-1.5 text-xs font-normal text-muted-foreground">
              ({assets.length})
            </span>
          ) : null}
        </h3>
        <div className="flex items-center gap-1.5">
          <div className="flex rounded-lg border border-border p-0.5">
            <Button
              type="button"
              variant={view === "grid" ? "secondary" : "ghost"}
              size="icon"
              className="h-7 w-7"
              onClick={() => setView("grid")}
              aria-label="Grid view"
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant={view === "list" ? "secondary" : "ghost"}
              size="icon"
              className="h-7 w-7"
              onClick={() => setView("list")}
              aria-label="List view"
            >
              <List className="h-4 w-4" />
            </Button>
          </div>
          {!readOnly ? (
            <MediaUploader
              binding={binding}
              multiple
              onUploaded={() => setRevision((r) => r + 1)}
            />
          ) : null}
        </div>
      </div>

      {assets.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/30 px-4 py-8 text-center">
          <ImageOff className="h-5 w-5 text-muted-foreground" />
          <p className="mt-2 text-xs text-muted-foreground">No images yet.</p>
        </div>
      ) : view === "grid" ? (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
          {assets.map((asset) => (
            <div key={asset.id} className="group relative">
              <MediaImage source={asset} size="md" className="h-full w-full" />
              {!readOnly ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  className="absolute right-1 top-1 h-6 w-6 opacity-0 transition group-hover:opacity-100"
                  onClick={() => handleDelete(asset.id)}
                  aria-label="Delete image"
                >
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <ul className="space-y-2">
          {assets.map((asset) => (
            <li
              key={asset.id}
              className="flex items-center gap-3 rounded-xl border border-border bg-card p-2"
            >
              <MediaImage source={asset} size="thumb" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-foreground">
                  {asset.caption ?? "Image"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {asset.width}×{asset.height} · {formatBytes(asset.fileSize)}
                </p>
              </div>
              {!readOnly ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => handleDelete(asset.id)}
                  aria-label="Delete image"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
