import { useMemo, useRef, useState } from "react";
import { ImageOff, Library, Loader2, Search, Upload } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MediaImage } from "@/components/media/MediaImage";
import { getMediaCategory } from "@/lib/mediaCategories";
import type { WorkOrderMediaLibraryItem } from "@/hooks/use-work-order-media";
import type { MediaCategory } from "@/types";

const ALL = "__all__";
/** Work-order uploads are categorised as work-order media (matches legacy binding). */
const UPLOAD_CATEGORY: MediaCategory = "work_order";

interface UploadButtonProps {
  uploading: boolean;
  onUpload: (files: File[], category: MediaCategory) => void;
  label?: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
  className?: string;
}

/**
 * A self-contained upload button that processes + uploads work-order images via
 * the Supabase Asset Center (no localStorage / mediaStore). Uploads are tagged
 * with the `work_order` category and become customer-owned assets.
 */
export function WorkOrderMediaUploadButton({
  uploading,
  onUpload,
  label = "Upload image",
  variant = "default",
  size = "sm",
  className,
}: UploadButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        className={className}
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
      >
        {uploading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Upload className="h-4 w-4" />
        )}
        {label}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const list = e.target.files;
          if (list && list.length > 0) onUpload(Array.from(list), UPLOAD_CATEGORY);
          if (inputRef.current) inputRef.current.value = "";
        }}
      />
    </>
  );
}

interface PickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The shared customer media library to choose from. */
  library: WorkOrderMediaLibraryItem[];
  /** Asset ids already placed in this area (excluded from the picker). */
  placedAssetIds: Set<string>;
  uploading: boolean;
  onUpload: (files: File[], category: MediaCategory) => void;
  onSelect: (assetId: string) => void;
  title?: string;
  description?: string;
}

/**
 * The reusable Work Order media picker. Lets the user upload a new image (into
 * the shared customer library) or pick an existing customer asset to place.
 * Selecting never copies the asset — it only creates an `asset_links` placement.
 * Stays open after a selection so several images can be placed in a row.
 */
export function WorkOrderMediaPickerDialog({
  open,
  onOpenChange,
  library,
  placedAssetIds,
  uploading,
  onUpload,
  onSelect,
  title = "Add image",
  description = "Upload a new image or pick one from the customer library. Images stay owned by the customer — placing one never makes a copy.",
}: PickerDialogProps) {
  const [query, setQuery] = useState<string>("");
  const [categoryFilter, setCategoryFilter] = useState<string>(ALL);

  const candidates = useMemo<WorkOrderMediaLibraryItem[]>(
    () => library.filter((item) => !placedAssetIds.has(item.asset.id)),
    [library, placedAssetIds],
  );

  const categories = useMemo<MediaCategory[]>(() => {
    const set = new Set<MediaCategory>();
    for (const item of candidates) set.add(item.category);
    return [...set];
  }, [candidates]);

  const filtered = useMemo<WorkOrderMediaLibraryItem[]>(() => {
    const q = query.trim().toLowerCase();
    return candidates.filter((item) => {
      if (categoryFilter !== ALL && item.category !== categoryFilter) return false;
      if (!q) return true;
      const label = getMediaCategory(item.category)?.label ?? item.category;
      return (
        label.toLowerCase().includes(q) ||
        (item.source?.caption?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [candidates, query, categoryFilter]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
          <p className="text-sm text-muted-foreground">Upload a new image</p>
          <WorkOrderMediaUploadButton uploading={uploading} onUpload={onUpload} />
        </div>

        <div className="flex items-center gap-1.5 pt-1 text-xs font-medium text-muted-foreground">
          <Library className="h-3.5 w-3.5" /> Or select from the customer library
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search images"
              className="h-9 pl-8"
            />
          </div>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="h-9 w-full sm:w-44">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All categories</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c} value={c}>
                  {getMediaCategory(c)?.label ?? c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/30 px-4 py-10 text-center">
            <ImageOff className="h-5 w-5 text-muted-foreground" />
            <p className="mt-2 text-xs text-muted-foreground">
              {candidates.length === 0
                ? "No more customer images to place here. Upload one above."
                : "No images match your search."}
            </p>
          </div>
        ) : (
          <div className="grid max-h-[45vh] grid-cols-2 gap-3 overflow-y-auto py-1 sm:grid-cols-3">
            {filtered.map((item) => (
              <button
                key={item.asset.id}
                type="button"
                onClick={() => onSelect(item.asset.id)}
                className="group flex flex-col gap-2 rounded-xl border border-border bg-card p-2 text-left transition-colors hover:border-primary hover:bg-accent"
              >
                {item.source ? (
                  <MediaImage
                    source={item.source}
                    size="md"
                    openable={false}
                    className="h-full w-full"
                  />
                ) : (
                  <div className="flex aspect-square w-full items-center justify-center rounded-lg bg-muted">
                    <ImageOff className="h-5 w-5 text-muted-foreground" />
                  </div>
                )}
                <Badge variant="secondary" className="w-fit text-[10px]">
                  {getMediaCategory(item.category)?.label ?? item.category}
                </Badge>
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
