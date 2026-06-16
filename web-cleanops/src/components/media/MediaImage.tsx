import { useState } from "react";
import { Expand } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * The three progressive layers a {@link MediaImage} can render. Sourced either
 * from a {@link MediaAsset} or from inline layer fields. The original image is
 * never referenced — there is intentionally no `originalUrl`.
 */
export interface MediaImageSource {
  microThumbnailUrl: string;
  hoverThumbnailUrl: string;
  previewImageUrl: string;
  caption?: string;
}

interface MediaImageProps {
  source: MediaImageSource;
  /** Tile footprint. Lists should always use "thumb". */
  size?: "thumb" | "md";
  /** Allow opening the full preview in a modal on click. Default true. */
  openable?: boolean;
  className?: string;
}

const SIZE_CLASS: Record<NonNullable<MediaImageProps["size"]>, string> = {
  thumb: "h-12 w-12",
  md: "h-24 w-24",
};

/**
 * Progressive image tile that honours the Media Foundation loading strategy:
 *  - renders the **micro** layer by default (fast, tiny, fine for lists/grids);
 *  - swaps in the **hover** layer only once the pointer enters;
 *  - loads the **preview** layer only after the viewer modal is opened.
 *
 * Larger layers are never requested until they are actually needed.
 */
export function MediaImage({
  source,
  size = "thumb",
  openable = true,
  className,
}: MediaImageProps) {
  const [hovered, setHovered] = useState<boolean>(false);
  const [viewerOpen, setViewerOpen] = useState<boolean>(false);

  const alt = source.caption ?? "Image";
  // Only escalate to the hover layer once the pointer is actually over the tile.
  const tileSrc = hovered ? source.hoverThumbnailUrl : source.microThumbnailUrl;

  const tile = (
    <img
      src={tileSrc}
      alt={alt}
      loading="lazy"
      decoding="async"
      className="h-full w-full object-cover"
    />
  );

  return (
    <>
      {openable ? (
        <button
          type="button"
          onMouseEnter={() => setHovered(true)}
          onFocus={() => setHovered(true)}
          onClick={() => setViewerOpen(true)}
          className={cn(
            "group relative shrink-0 overflow-hidden rounded-lg bg-muted outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring",
            SIZE_CLASS[size],
            className,
          )}
          aria-label={`View image${source.caption ? `: ${source.caption}` : ""}`}
        >
          {tile}
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition group-hover:bg-black/30 group-hover:opacity-100">
            <Expand className="h-4 w-4 text-white" />
          </span>
        </button>
      ) : (
        <span
          onMouseEnter={() => setHovered(true)}
          className={cn(
            "block shrink-0 overflow-hidden rounded-lg bg-muted",
            SIZE_CLASS[size],
            className,
          )}
        >
          {tile}
        </span>
      )}

      {openable ? (
        <Dialog open={viewerOpen} onOpenChange={setViewerOpen}>
          <DialogContent className="max-w-3xl gap-0 overflow-hidden p-0">
            <DialogTitle className="sr-only">{alt}</DialogTitle>
            <div className="flex max-h-[80vh] items-center justify-center bg-black">
              {/* Preview layer is only requested once the viewer is open. */}
              {viewerOpen ? (
                <img
                  src={source.previewImageUrl}
                  alt={alt}
                  className="max-h-[80vh] w-auto object-contain"
                />
              ) : null}
            </div>
            {source.caption ? (
              <p className="border-t border-border bg-card px-5 py-3 text-sm text-muted-foreground">
                {source.caption}
              </p>
            ) : null}
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
