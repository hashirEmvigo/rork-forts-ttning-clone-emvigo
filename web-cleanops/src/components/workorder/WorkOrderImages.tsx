import { useCallback, useState } from "react";
import {
  CalendarClock,
  ImageOff,
  Library,
  Loader2,
  Unlink,
  User as UserIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MediaImage } from "@/components/media/MediaImage";
import { useApp } from "@/context/AppContext";
import { formatDateTime } from "@/lib/format";
import { getMediaCategory } from "@/lib/mediaCategories";
import {
  useWorkOrderMedia,
  type ResolvedWorkOrderPlacement,
} from "@/hooks/use-work-order-media";
import type { WorkOrderMediaArea } from "@/lib/assets/workOrderMedia";
import type { WorkOrder } from "@/types";

import { WorkOrderMediaPickerDialog, WorkOrderMediaUploadButton } from "./WorkOrderMediaPicker";

interface WorkOrderImagesProps {
  order: WorkOrder;
}

/**
 * Work Order Images tab — a Supabase-authoritative consumer view over the shared
 * customer media library.
 *
 * An image is "attached" to a work order via an `asset_links` placement
 * (`entity_type=work_order`, `placement_key=work_order_image`); the customer
 * remains the single owner. Uploading here creates a customer-owned Asset Center
 * record (so it also appears in the Customer Media Center) and links it; removing
 * only archives the link — the asset and its place in the Customer Media Center
 * are preserved. There is NO localStorage / mediaStore on this path.
 */
export function WorkOrderImages({ order }: WorkOrderImagesProps) {
  const { currentUser, users } = useApp();
  const area: WorkOrderMediaArea = { surface: "images", workOrderId: order.id };
  const media = useWorkOrderMedia(order, area);
  const [pickerOpen, setPickerOpen] = useState<boolean>(false);

  const placedAssetIds = new Set(media.placements.map((p) => p.asset.id));

  const uploaderName = useCallback(
    (placement: ResolvedWorkOrderPlacement): string => {
      const id = placement.asset.createdBy;
      return (
        (id ? users.find((u) => u.id === id)?.name : undefined) ??
        (currentUser && id === currentUser.id ? currentUser.name : undefined) ??
        "Unknown"
      );
    },
    [users, currentUser],
  );

  return (
    <div className="grid gap-5">
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="grid gap-1">
            <h3 className="text-sm font-semibold text-foreground">
              Work order images
            </h3>
            <p className="max-w-md text-xs text-muted-foreground">
              Images live in the Customer Media Center. Attach existing ones or
              upload new — removing here never deletes the original.
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => setPickerOpen(true)}
            >
              <Library className="h-4 w-4" /> Select from library
            </Button>
            <WorkOrderMediaUploadButton
              uploading={media.uploading}
              onUpload={media.uploadAndAttach}
            />
          </div>
        </div>
      </div>

      {media.error ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-destructive/40 bg-destructive/5 px-4 py-12 text-center">
          <ImageOff className="h-6 w-6 text-destructive" />
          <p className="mt-2 text-sm text-destructive">{media.error}</p>
        </div>
      ) : media.loading ? (
        <div className="flex items-center justify-center rounded-2xl border border-dashed border-border bg-muted/30 px-4 py-16 text-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">Loading images…</span>
        </div>
      ) : media.placements.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-muted/30 px-4 py-16 text-center">
          <ImageOff className="h-6 w-6 text-muted-foreground" />
          <p className="mt-2 text-sm text-muted-foreground">
            No images on this work order yet.
          </p>
          <p className="mt-1 max-w-sm text-xs text-muted-foreground/80">
            Attach images from the Customer Media Center or upload new ones —
            they’ll appear here and stay owned by the customer.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {media.placements.map((placement) => (
            <AttachedCard
              key={placement.link.id}
              placement={placement}
              uploaderName={uploaderName(placement)}
              onDetach={() => media.detach(placement.link.id)}
            />
          ))}
        </div>
      )}

      <WorkOrderMediaPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        library={media.library}
        placedAssetIds={placedAssetIds}
        uploading={media.uploading}
        onUpload={media.uploadAndAttach}
        onSelect={media.attach}
        title="Select from Customer Media Center"
        description="Choose images to make available on this work order. They stay owned by the customer."
      />
    </div>
  );
}

interface AttachedCardProps {
  placement: ResolvedWorkOrderPlacement;
  uploaderName: string;
  onDetach: () => void;
}

function AttachedCard({ placement, uploaderName, onDetach }: AttachedCardProps) {
  const { asset, source, category } = placement;
  return (
    <div className="group flex flex-col gap-3 rounded-2xl border border-border bg-card p-3">
      <div className="flex gap-3">
        {source ? (
          <MediaImage source={source} size="md" className="h-20 w-20" />
        ) : (
          <div className="flex h-20 w-20 items-center justify-center rounded-lg bg-muted">
            <ImageOff className="h-5 w-5 text-muted-foreground" />
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <Badge variant="secondary" className="w-fit">
            {getMediaCategory(category)?.label ?? category}
          </Badge>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <UserIcon className="h-3 w-3 shrink-0" />
            <span className="truncate">{uploaderName}</span>
          </p>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarClock className="h-3 w-3 shrink-0" />
            {formatDateTime(asset.createdAt)}
          </p>
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5 text-muted-foreground hover:text-destructive"
        onClick={onDetach}
      >
        <Unlink className="h-3.5 w-3.5" /> Remove from work order
      </Button>
    </div>
  );
}
