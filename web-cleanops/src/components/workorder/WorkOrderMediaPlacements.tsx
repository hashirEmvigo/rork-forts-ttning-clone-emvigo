import { useState } from "react";
import { GripVertical, ImageOff, Plus, X } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { MediaImage } from "@/components/media/MediaImage";
import {
  useWorkOrderMedia,
  type ResolvedWorkOrderPlacement,
} from "@/hooks/use-work-order-media";
import type { WorkOrderMediaArea } from "@/lib/assets/workOrderMedia";
import { cn } from "@/lib/utils";
import type { WorkOrder } from "@/types";

import { WorkOrderMediaPickerDialog } from "./WorkOrderMediaPicker";

/**
 * Work Order placement strips (header + per-service-row).
 *
 * Both surfaces are Supabase-authoritative: images are customer-owned Asset
 * Center records and a placement is an `asset_links` row (see
 * {@link useWorkOrderMedia}). There is NO localStorage / mediaStore on this
 * path. Removing a placement only archives the link; the asset stays in the
 * Customer Media Center. Ordering and the per-row "Visible in Employee App"
 * flag persist on the link, so they survive a hard refresh.
 */

// ─────────────────────────────────────────────
// Header images
// ─────────────────────────────────────────────

/** Header image strip for a work order. Placed thumbnails + a "+" add tile. */
export function WorkOrderHeaderImages({ order }: { order: WorkOrder }) {
  const area: WorkOrderMediaArea = { surface: "header", workOrderId: order.id };
  const media = useWorkOrderMedia(order, area);
  const [pickerOpen, setPickerOpen] = useState<boolean>(false);

  const placedAssetIds = new Set(media.placements.map((p) => p.asset.id));

  return (
    <div className="flex flex-col gap-2">
      <PlacementStrip
        placements={media.placements}
        thumbSize="md"
        onDetach={media.detach}
        onReorder={media.reorder}
      >
        <AddPlacementTile size="md" onClick={() => setPickerOpen(true)} />
      </PlacementStrip>

      <WorkOrderMediaPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        library={media.library}
        placedAssetIds={placedAssetIds}
        uploading={media.uploading}
        onUpload={media.uploadAndAttach}
        onSelect={media.attach}
      />
    </div>
  );
}

// ─────────────────────────────────────────────
// Service row images
// ─────────────────────────────────────────────

/**
 * Per-service-row image area. Same placement model as the header, plus a
 * "Visible in Employee App" toggle stored on each placement link so an image
 * can be shown for one service and hidden for another.
 */
export function ServiceRowImages({
  order,
  serviceRowId,
}: {
  order: WorkOrder;
  serviceRowId: string;
}) {
  const area: WorkOrderMediaArea = {
    surface: "service_row",
    workOrderId: order.id,
    serviceRowId,
  };
  const media = useWorkOrderMedia(order, area);
  const [pickerOpen, setPickerOpen] = useState<boolean>(false);

  const placedAssetIds = new Set(media.placements.map((p) => p.asset.id));

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-dashed border-border bg-muted/20 p-3">
      <p className="text-xs font-medium text-muted-foreground">Images</p>
      <PlacementStrip
        placements={media.placements}
        thumbSize="thumb"
        showEmployeeToggle
        onDetach={media.detach}
        onReorder={media.reorder}
        onSetEmployeeVisibility={media.setEmployeeVisibility}
      >
        <AddPlacementTile size="thumb" onClick={() => setPickerOpen(true)} />
      </PlacementStrip>

      <WorkOrderMediaPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        library={media.library}
        placedAssetIds={placedAssetIds}
        uploading={media.uploading}
        onUpload={media.uploadAndAttach}
        onSelect={media.attach}
      />
    </div>
  );
}

// ─────────────────────────────────────────────
// Shared building blocks
// ─────────────────────────────────────────────

interface PlacementStripProps {
  placements: ResolvedWorkOrderPlacement[];
  thumbSize: "thumb" | "md";
  /** Show the per-placement "Visible in Employee App" checkbox (service rows). */
  showEmployeeToggle?: boolean;
  onDetach: (linkId: string) => void;
  onReorder: (orderedLinkIds: string[]) => void;
  onSetEmployeeVisibility?: (linkId: string, visible: boolean) => void;
  /** Trailing element (the add-tile). */
  children?: React.ReactNode;
}

/** A reorderable row of placed image thumbnails with remove + drag-to-sort. */
function PlacementStrip({
  placements,
  thumbSize,
  showEmployeeToggle = false,
  onDetach,
  onReorder,
  onSetEmployeeVisibility,
  children,
}: PlacementStripProps) {
  const [dragId, setDragId] = useState<string | null>(null);

  const onDrop = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    const ids = placements.map((p) => p.link.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    const next = [...ids];
    next.splice(from, 1);
    next.splice(to, 0, dragId);
    onReorder(next);
    setDragId(null);
  };

  const tileClass = thumbSize === "md" ? "h-24 w-24" : "h-16 w-16";

  return (
    <div className="flex flex-wrap items-start gap-3">
      {placements.map((placement) => (
        <div
          key={placement.link.id}
          draggable
          onDragStart={() => setDragId(placement.link.id)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => onDrop(placement.link.id)}
          onDragEnd={() => setDragId(null)}
          className={cn(
            "group relative flex flex-col gap-1.5",
            dragId === placement.link.id && "opacity-50",
          )}
        >
          <div className="relative">
            {placement.source ? (
              <MediaImage
                source={placement.source}
                size={thumbSize}
                className={tileClass}
              />
            ) : (
              <div
                className={cn(
                  "flex items-center justify-center rounded-lg bg-muted",
                  tileClass,
                )}
              >
                <ImageOff className="h-4 w-4 text-muted-foreground" />
              </div>
            )}
            <span className="absolute left-1 top-1 flex h-5 w-5 cursor-grab items-center justify-center rounded bg-black/45 text-white opacity-0 transition group-hover:opacity-100">
              <GripVertical className="h-3 w-3" />
            </span>
            <button
              type="button"
              onClick={() => onDetach(placement.link.id)}
              aria-label="Remove image from this location"
              className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm transition hover:text-destructive"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
          {showEmployeeToggle && onSetEmployeeVisibility ? (
            <label className="flex max-w-[7rem] items-start gap-1.5 text-[11px] leading-tight text-muted-foreground">
              <Checkbox
                checked={placement.visibleToEmployee}
                onCheckedChange={(v) =>
                  onSetEmployeeVisibility(placement.link.id, v === true)
                }
                className="mt-0.5 h-3.5 w-3.5"
              />
              <span>Visible in Employee App</span>
            </label>
          ) : null}
        </div>
      ))}
      {children}
    </div>
  );
}

interface AddPlacementTileProps {
  size: "thumb" | "md";
  onClick: () => void;
}

/** The square "+" placeholder that opens the upload / library picker. */
function AddPlacementTile({ size, onClick }: AddPlacementTileProps) {
  const cls = size === "md" ? "h-24 w-24" : "h-16 w-16";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Add image"
      className={cn(
        "flex shrink-0 items-center justify-center rounded-lg border-2 border-dashed border-border bg-muted/40 text-muted-foreground transition hover:border-primary hover:text-primary",
        cls,
      )}
    >
      <Plus className={size === "md" ? "h-6 w-6" : "h-5 w-5"} />
    </button>
  );
}
