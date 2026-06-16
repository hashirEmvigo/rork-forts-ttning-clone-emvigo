import { useMemo, useRef, useState } from "react";
import {
  CalendarClock,
  Eye,
  ImageOff,
  Loader2,
  Lock,
  Star,
  StarOff,
  Trash2,
  Upload,
  User as UserIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MediaImage } from "@/components/media/MediaImage";
import { useApp } from "@/context/AppContext";
import { formatDateTime } from "@/lib/format";
import {
  CUSTOMER_MEDIA_CATEGORIES,
  getMediaCategory,
} from "@/lib/mediaCategories";
import {
  useCustomerMediaLibrary,
  type CustomerMediaItem,
} from "@/hooks/use-customer-media-library";
import type { MediaCategory } from "@/types";

interface CustomerMediaLibraryProps {
  customerId: string;
  companyId: string;
}

const ALL = "__all__";

/**
 * Customer Media Center — the Supabase-authoritative media surface for a
 * customer.
 *
 * Images are stored once as company- and customer-scoped Asset Center records
 * (private bucket) and read back through short-lived signed URLs. New uploads
 * default to admin/internal visibility; making an image customer-visible is an
 * explicit, per-image choice. There is no localStorage authority on this path —
 * everything persists in Supabase and survives a hard refresh.
 */
export function CustomerMediaLibrary({
  customerId,
  companyId,
}: CustomerMediaLibraryProps) {
  const { currentUser, customers, users, setCustomerCoverImage } = useApp();
  const { items, loading, error, uploading, upload, setVisible, remove } =
    useCustomerMediaLibrary(companyId, customerId);

  const [uploadCategory, setUploadCategory] = useState<MediaCategory>("customer");
  const [categoryFilter, setCategoryFilter] = useState<string>(ALL);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const coverAssetId = useMemo<string | null>(
    () => customers.find((c) => c.id === customerId)?.coverMediaAssetId ?? null,
    [customers, customerId],
  );

  const usedCategories = useMemo<MediaCategory[]>(() => {
    const set = new Set<MediaCategory>();
    for (const it of items) set.add(it.category);
    return CUSTOMER_MEDIA_CATEGORIES.filter((c) => set.has(c));
  }, [items]);

  const visibleItems = useMemo<CustomerMediaItem[]>(
    () =>
      categoryFilter === ALL
        ? items
        : items.filter((it) => it.category === categoryFilter),
    [items, categoryFilter],
  );

  const uploaderName = (item: CustomerMediaItem): string => {
    const id = item.asset.createdBy;
    return (
      (id ? users.find((u) => u.id === id)?.name : undefined) ??
      (currentUser && id === currentUser.id ? currentUser.name : undefined) ??
      "Unknown"
    );
  };

  const handlePickFiles = (list: FileList | null) => {
    if (list && list.length > 0) void upload(Array.from(list), uploadCategory);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleToggleCover = (item: CustomerMediaItem) => {
    setCustomerCoverImage(
      customerId,
      coverAssetId === item.asset.id ? null : item.asset.id,
    );
  };

  const handleDelete = async (item: CustomerMediaItem) => {
    const wasCover = coverAssetId === item.asset.id;
    const ok = await remove(item);
    if (ok && wasCover) setCustomerCoverImage(customerId, null);
  };

  return (
    <div className="grid gap-6">
      {/* Uploader */}
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="grid gap-1.5">
            <h3 className="text-sm font-semibold text-foreground">Add image</h3>
            <p className="max-w-md text-xs text-muted-foreground">
              Choose a category, then upload. Only compressed versions are stored —
              the original is discarded. New images are admin-only until you make
              them customer-visible.
            </p>
          </div>
          <div className="flex items-end gap-2">
            <div className="grid gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                Category
              </span>
              <Select
                value={uploadCategory}
                onValueChange={(v) => setUploadCategory(v as MediaCategory)}
              >
                <SelectTrigger className="h-9 w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CUSTOMER_MEDIA_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {getMediaCategory(c)?.label ?? c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              Upload image
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => handlePickFiles(e.target.files)}
            />
          </div>
        </div>
      </div>

      {/* Category filters */}
      {!loading && items.length > 0 && usedCategories.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <FilterChip
            label="All"
            count={items.length}
            active={categoryFilter === ALL}
            onClick={() => setCategoryFilter(ALL)}
          />
          {usedCategories.map((c) => (
            <FilterChip
              key={c}
              label={getMediaCategory(c)?.label ?? c}
              count={items.filter((it) => it.category === c).length}
              active={categoryFilter === c}
              onClick={() => setCategoryFilter(c)}
            />
          ))}
        </div>
      ) : null}

      {/* Gallery */}
      {error ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-destructive/40 bg-destructive/5 px-4 py-12 text-center">
          <ImageOff className="h-6 w-6 text-destructive" />
          <p className="mt-2 text-sm text-destructive">{error}</p>
        </div>
      ) : loading ? (
        <div className="flex items-center justify-center rounded-2xl border border-dashed border-border bg-muted/30 px-4 py-16 text-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">Loading media…</span>
        </div>
      ) : visibleItems.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-muted/30 px-4 py-16 text-center">
          <ImageOff className="h-6 w-6 text-muted-foreground" />
          <p className="mt-2 text-sm text-muted-foreground">
            {items.length === 0
              ? "No images yet. Upload the first one above."
              : "No images match this filter."}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visibleItems.map((item) => (
            <MediaCard
              key={item.asset.id}
              item={item}
              isCover={coverAssetId === item.asset.id}
              uploaderName={uploaderName(item)}
              onToggleCover={() => handleToggleCover(item)}
              onToggleVisible={(v) => void setVisible(item, v)}
              onDelete={() => void handleDelete(item)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface MediaCardProps {
  item: CustomerMediaItem;
  isCover: boolean;
  uploaderName: string;
  onToggleCover: () => void;
  onToggleVisible: (visible: boolean) => void;
  onDelete: () => void;
}

function MediaCard({
  item,
  isCover,
  uploaderName,
  onToggleCover,
  onToggleVisible,
  onDelete,
}: MediaCardProps) {
  const { asset, category, source, visible } = item;

  return (
    <div
      className={
        isCover
          ? "group flex flex-col gap-3 rounded-2xl border-2 border-primary bg-card p-3"
          : "group flex flex-col gap-3 rounded-2xl border border-border bg-card p-3"
      }
    >
      <div className="flex gap-3">
        <div className="relative">
          {source ? (
            <MediaImage source={source} size="md" className="h-20 w-20" />
          ) : (
            <div className="flex h-20 w-20 items-center justify-center rounded-lg bg-muted">
              <ImageOff className="h-5 w-5 text-muted-foreground" />
            </div>
          )}
          {isCover ? (
            <span className="absolute -left-1.5 -top-1.5 inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground shadow">
              <Star className="h-2.5 w-2.5 fill-current" />
              Cover
            </span>
          ) : null}
        </div>
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
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:text-destructive"
          onClick={onDelete}
          aria-label="Delete image"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      {/* Visibility toggle */}
      <label className="flex items-center justify-between gap-2 rounded-xl border border-border bg-muted/20 px-3 py-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
          {visible ? (
            <Eye className="h-3.5 w-3.5 text-primary" />
          ) : (
            <Lock className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          {visible ? "Customer-visible" : "Admin only"}
        </span>
        <Switch
          checked={visible}
          onCheckedChange={onToggleVisible}
          aria-label="Customer-visible"
        />
      </label>

      <Button
        type="button"
        variant={isCover ? "secondary" : "outline"}
        size="sm"
        className="gap-1.5"
        onClick={onToggleCover}
      >
        {isCover ? (
          <>
            <StarOff className="h-3.5 w-3.5" /> Remove cover
          </>
        ) : (
          <>
            <Star className="h-3.5 w-3.5" /> Set as cover
          </>
        )}
      </Button>
    </div>
  );
}

function FilterChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground"
          : "inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent"
      }
    >
      {label}
      <span className="tabular-nums opacity-70">{count}</span>
    </button>
  );
}
