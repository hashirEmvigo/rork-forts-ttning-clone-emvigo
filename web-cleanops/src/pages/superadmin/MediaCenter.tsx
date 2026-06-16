import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Archive,
  ArchiveRestore,
  Copy,
  ExternalLink,
  File as FileIcon,
  FileText,
  Film,
  Globe,
  Image as ImageIcon,
  ImageOff,
  ImagePlus,
  Loader2,
  Lock,
  MonitorPlay,
  MonitorX,
  Pencil,
  Search,
  ShieldAlert,
  Upload,
} from "lucide-react";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { AccessDenied } from "@/components/AccessDenied";
import { WebsiteImageryPanel } from "@/components/media/WebsiteImageryPanel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useApp } from "@/context/AppContext";
import { useToast } from "@/hooks/use-toast";
import { formatDateTime } from "@/lib/format";
import { formatBytes } from "@/lib/mediaProcessing";
import {
  listAssetCategories,
  listAssetFolders,
  type AssetCategory,
  type AssetFolder,
  type AssetType,
} from "@/lib/assets";
import {
  useGlobalMediaLibrary,
  type GlobalMediaItem,
  type UploadGlobalMediaOptions,
} from "@/hooks/use-global-media-library";
import {
  getAssetCategorySection,
  groupItemsByAssetCategory,
  type AssetCategoryItemGroup,
} from "@/lib/assets/assetCategorySections";
import type { GlobalMediaVisibilityTarget } from "@/lib/assets/globalMedia";

type TabKey =
  | "all"
  | "images"
  | "videos"
  | "documents"
  | "website"
  | "website-imagery"
  | "archived";

const TYPE_META: Record<AssetType, { label: string; Icon: typeof ImageIcon }> = {
  image: { label: "Image", Icon: ImageIcon },
  icon: { label: "Icon", Icon: ImageIcon },
  video: { label: "Video", Icon: Film },
  pdf: { label: "PDF", Icon: FileText },
  document: { label: "Document", Icon: FileText },
  attachment: { label: "File", Icon: FileIcon },
  other: { label: "File", Icon: FileIcon },
};

const NONE = "__none__";

/**
 * Super Admin — Media Center. The platform-level home for global/website assets
 * (login & marketing media, module/service graphics, icons, instructional PDFs
 * and reusable templates). Built on the Supabase-authoritative Asset Center
 * foundation: every upload/edit/archive commits to Supabase and survives a hard
 * refresh. Public assets live in the world-readable `public-assets` bucket;
 * internal/global assets live in `private-assets` and preview via signed URLs.
 * Restricted to the Super Admin — company admins never reach this surface.
 */
export default function MediaCenter() {
  const { currentUser } = useApp();
  const {
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
  } = useGlobalMediaLibrary();

  const [tab, setTab] = useState<TabKey>("all");
  const [query, setQuery] = useState<string>("");
  const [uploadOpen, setUploadOpen] = useState<boolean>(false);
  const [editItem, setEditItem] = useState<GlobalMediaItem | null>(null);
  const [previewItem, setPreviewItem] = useState<GlobalMediaItem | null>(null);
  const [pendingArchive, setPendingArchive] = useState<GlobalMediaItem | null>(null);
  const [openCategorySections, setOpenCategorySections] = useState<string[]>([]);

  const active = useMemo(() => items.filter((it) => !it.isArchived), [items]);
  const archived = useMemo(() => items.filter((it) => it.isArchived), [items]);

  // Public images are the only assets assignable to public website slots.
  const publicImageItems = useMemo(
    () =>
      active.filter(
        (it) =>
          it.isPublic && (it.asset.assetType === "image" || it.asset.assetType === "icon"),
      ),
    [active],
  );

  const counts = useMemo(
    () => ({
      all: active.length,
      images: active.filter((it) => it.asset.assetType === "image" || it.asset.assetType === "icon")
        .length,
      videos: active.filter((it) => it.asset.assetType === "video").length,
      documents: active.filter(
        (it) =>
          it.asset.assetType === "pdf" ||
          it.asset.assetType === "document" ||
          it.asset.assetType === "attachment" ||
          it.asset.assetType === "other",
      ).length,
      website: active.filter((it) => it.isPublic).length,
      archived: archived.length,
    }),
    [active, archived],
  );

  const tabItems = useMemo(() => {
    const base =
      tab === "archived"
        ? archived
        : tab === "images"
          ? active.filter(
              (it) => it.asset.assetType === "image" || it.asset.assetType === "icon",
            )
          : tab === "videos"
            ? active.filter((it) => it.asset.assetType === "video")
            : tab === "documents"
              ? active.filter(
                  (it) =>
                    it.asset.assetType === "pdf" ||
                    it.asset.assetType === "document" ||
                    it.asset.assetType === "attachment" ||
                    it.asset.assetType === "other",
                )
              : tab === "website"
                ? active.filter((it) => it.isPublic)
                : active;

    const q = query.trim().toLowerCase();
    if (!q) return base;
    return base.filter((it) => {
      const hay = [
        it.asset.title ?? "",
        it.asset.name,
        it.asset.description ?? "",
        ...it.asset.tags,
        getAssetCategorySection(it.asset.categoryId).label,
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [tab, active, archived, query]);

  const groupedCategoryItems = useMemo(() => groupItemsByAssetCategory(tabItems), [tabItems]);
  const shouldGroupByCategory = tab === "images" || tab === "archived";

  useEffect(() => {
    setOpenCategorySections([]);
  }, [tab, query]);

  // Defense-in-depth: the route already restricts this to Super Admin.
  if (currentUser?.role !== "super_admin") return <AccessDenied />;

  return (
    <DashboardLayout wide>
      <PageHeader
        title="Media Center"
        description="Platform-wide media & documents — login and website assets, module/service graphics, icons, and reusable files. Stored in the Asset Center; public assets are world-readable."
        action={
          <Button onClick={() => setUploadOpen(true)} disabled={!canManage}>
            <Upload className="h-4 w-4" />
            Upload asset
          </Button>
        }
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)} className="mb-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <TabsList className="flex-wrap">
            <TabTrigger value="all" label="All media" count={counts.all} />
            <TabTrigger value="images" label="Images" count={counts.images} />
            <TabTrigger value="videos" label="Videos" count={counts.videos} />
            <TabTrigger value="documents" label="Documents" count={counts.documents} />
            <TabTrigger value="website" label="Website / Public" count={counts.website} />
            <TabTrigger value="website-imagery" label="Website imagery" />
            <TabTrigger value="archived" label="Archived" count={counts.archived} />
          </TabsList>
          {tab !== "website-imagery" ? (
            <div className="relative w-full lg:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search title, name, tags…"
                className="pl-9"
              />
            </div>
          ) : null}
        </div>
      </Tabs>

      {tab === "website-imagery" ? (
        <WebsiteImageryPanel publicImages={publicImageItems} />
      ) : error ? (
        <EmptyState
          icon={<ShieldAlert className="h-6 w-6 text-destructive" />}
          tone="error"
          message={error}
        />
      ) : loading ? (
        <div className="flex items-center justify-center rounded-2xl border border-dashed border-border bg-muted/30 px-4 py-20 text-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">Loading media…</span>
        </div>
      ) : tabItems.length === 0 ? (
        <EmptyState
          icon={<ImageOff className="h-6 w-6 text-muted-foreground" />}
          message={
            active.length === 0 && archived.length === 0
              ? "No media yet. Upload your first global or website asset."
              : query.trim()
                ? "No assets match your search."
                : "Nothing here yet."
          }
        />
      ) : shouldGroupByCategory ? (
        <CategorySectionList
          groups={groupedCategoryItems}
          canManage={canManage}
          loginBackgroundAssetId={loginBackgroundAssetId}
          openSections={openCategorySections}
          onOpenSectionsChange={setOpenCategorySections}
          onPreview={setPreviewItem}
          onEdit={setEditItem}
          onArchive={setPendingArchive}
          onRestore={(item) => void restore(item)}
          onSetLoginBackground={(item) => void setAsLoginBackground(item)}
          onClearLoginBackground={() => void clearLoginBackground()}
          itemNoun={tab === "images" ? "image" : "asset"}
        />
      ) : (
        <MediaGrid
          items={tabItems}
          canManage={canManage}
          loginBackgroundAssetId={loginBackgroundAssetId}
          onPreview={setPreviewItem}
          onEdit={setEditItem}
          onArchive={setPendingArchive}
          onRestore={(item) => void restore(item)}
          onSetLoginBackground={(item) => void setAsLoginBackground(item)}
          onClearLoginBackground={() => void clearLoginBackground()}
        />
      )}

      <UploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        uploading={uploading}
        onUpload={async (files, opts) => {
          await upload(files, opts);
          setUploadOpen(false);
        }}
      />

      <EditDialog
        item={editItem}
        onOpenChange={(open) => !open && setEditItem(null)}
        onSave={async (patch) => {
          if (editItem) await updateMeta(editItem, patch);
          setEditItem(null);
        }}
      />

      <PreviewDialog item={previewItem} onOpenChange={(open) => !open && setPreviewItem(null)} />

      <AlertDialog
        open={pendingArchive !== null}
        onOpenChange={(open) => !open && setPendingArchive(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive this asset?</AlertDialogTitle>
            <AlertDialogDescription>
              This image may already be used by companies. Archiving it removes “{pendingArchive?.asset.title ?? pendingArchive?.asset.name}” from future selection, but existing usages will continue to display the image.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const target = pendingArchive;
                setPendingArchive(null);
                if (target) void archive(target);
              }}
            >
              Remove from global library
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}

function TabTrigger({
  value,
  label,
  count,
}: {
  value: TabKey;
  label: string;
  count?: number;
}) {
  return (
    <TabsTrigger value={value} className="gap-1.5">
      {label}
      {count !== undefined ? (
        <span className="rounded-full bg-muted-foreground/15 px-1.5 text-[11px] font-semibold tabular-nums">
          {count}
        </span>
      ) : null}
    </TabsTrigger>
  );
}

interface MediaGridProps {
  items: GlobalMediaItem[];
  canManage: boolean;
  loginBackgroundAssetId: string | null;
  onPreview: (item: GlobalMediaItem) => void;
  onEdit: (item: GlobalMediaItem) => void;
  onArchive: (item: GlobalMediaItem) => void;
  onRestore: (item: GlobalMediaItem) => void;
  onSetLoginBackground: (item: GlobalMediaItem) => void;
  onClearLoginBackground: () => void;
}

function MediaGrid({
  items,
  canManage,
  loginBackgroundAssetId,
  onPreview,
  onEdit,
  onArchive,
  onRestore,
  onSetLoginBackground,
  onClearLoginBackground,
}: MediaGridProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
      {items.map((item) => (
        <MediaCard
          key={item.asset.id}
          item={item}
          canManage={canManage}
          isLoginBackground={loginBackgroundAssetId === item.asset.id}
          onPreview={() => onPreview(item)}
          onEdit={() => onEdit(item)}
          onArchive={() => onArchive(item)}
          onRestore={() => onRestore(item)}
          onSetLoginBackground={() => onSetLoginBackground(item)}
          onClearLoginBackground={onClearLoginBackground}
        />
      ))}
    </div>
  );
}

interface CategorySectionListProps extends Omit<MediaGridProps, "items"> {
  groups: AssetCategoryItemGroup<GlobalMediaItem>[];
  openSections: string[];
  onOpenSectionsChange: (sections: string[]) => void;
  itemNoun: "asset" | "image";
}

function CategorySectionList({
  groups,
  openSections,
  onOpenSectionsChange,
  itemNoun,
  ...gridProps
}: CategorySectionListProps) {
  return (
    <Accordion
      type="multiple"
      value={openSections}
      onValueChange={onOpenSectionsChange}
      className="space-y-3"
    >
      {groups.map(({ section, items }) => {
        const countLabel = `${items.length} ${itemNoun}${items.length === 1 ? "" : "s"}`;
        const isOpen = openSections.includes(section.id);
        return (
          <AccordionItem
            key={section.id}
            value={section.id}
            data-testid={`media-category-section-${section.id}`}
            className="overflow-hidden rounded-2xl border border-border bg-card px-4 shadow-sm"
          >
            <AccordionTrigger className="py-4 text-left hover:no-underline">
              <span className="flex min-w-0 flex-col gap-1 pr-3">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-foreground">{section.label}</span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                    {countLabel}
                  </span>
                </span>
                <span className="text-xs font-normal text-muted-foreground">{section.description}</span>
              </span>
            </AccordionTrigger>
            <AccordionContent className="pb-4">
              {isOpen ? <MediaGrid {...gridProps} items={items} /> : null}
            </AccordionContent>
          </AccordionItem>
        );
      })}
    </Accordion>
  );
}

function EmptyState({
  icon,
  message,
  tone = "muted",
}: {
  icon: ReactNode;
  message: string;
  tone?: "muted" | "error";
}) {
  return (
    <div
      className={
        tone === "error"
          ? "flex flex-col items-center justify-center rounded-2xl border border-dashed border-destructive/40 bg-destructive/5 px-4 py-16 text-center"
          : "flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-muted/30 px-4 py-16 text-center"
      }
    >
      {icon}
      <p
        className={
          tone === "error"
            ? "mt-2 max-w-md text-sm text-destructive"
            : "mt-2 max-w-md text-sm text-muted-foreground"
        }
      >
        {message}
      </p>
    </div>
  );
}

interface MediaCardProps {
  item: GlobalMediaItem;
  canManage: boolean;
  isLoginBackground: boolean;
  onPreview: () => void;
  onEdit: () => void;
  onArchive: () => void;
  onRestore: () => void;
  onSetLoginBackground: () => void;
  onClearLoginBackground: () => void;
}

function MediaCard({
  item,
  canManage,
  isLoginBackground,
  onPreview,
  onEdit,
  onArchive,
  onRestore,
  onSetLoginBackground,
  onClearLoginBackground,
}: MediaCardProps) {
  const { toast } = useToast();
  const { asset, urls, isPublic, isArchived } = item;
  const meta = TYPE_META[asset.assetType];
  const isVisual = asset.assetType === "image" || asset.assetType === "icon";
  // A login background must be a PUBLIC image/video so its URL works on the
  // unauthenticated sign-in screen.
  const canBeLoginBackground =
    isPublic && (asset.assetType === "image" || asset.assetType === "video");

  const handleCopyUrl = async () => {
    const url = asset.publicUrl ?? urls?.fullUrl ?? null;
    if (!url) return;
    try {
      await navigator.clipboard?.writeText(url);
      toast({ title: "URL copied", description: "Public asset URL copied to clipboard." });
    } catch {
      toast({ title: "Copy failed", description: url, variant: "destructive" });
    }
  };

  return (
    <div className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-card transition-shadow hover:shadow-md">
      {/* Preview area */}
      <button
        type="button"
        onClick={onPreview}
        className="relative flex aspect-[4/3] items-center justify-center overflow-hidden bg-muted/40 outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Preview ${asset.title ?? asset.name}`}
      >
        {isVisual && urls?.thumbUrl ? (
          <img
            src={urls.thumbUrl}
            alt={asset.title ?? asset.name}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
        ) : (
          <meta.Icon className="h-10 w-10 text-muted-foreground" />
        )}
        <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-background/85 px-2 py-0.5 text-[11px] font-medium text-foreground shadow-sm backdrop-blur">
          <meta.Icon className="h-3 w-3" />
          {meta.label}
        </span>
        {isArchived ? (
          <span className="absolute right-2 top-2 rounded-full bg-foreground/80 px-2 py-0.5 text-[11px] font-semibold text-background">
            Archived
          </span>
        ) : isPublic ? (
          <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-semibold text-white">
            <Globe className="h-3 w-3" />
            Public
          </span>
        ) : (
          <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-slate-700 px-2 py-0.5 text-[11px] font-semibold text-white">
            <Lock className="h-3 w-3" />
            Internal
          </span>
        )}
        {isLoginBackground ? (
          <span className="absolute bottom-2 left-2 flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground shadow-sm">
            <MonitorPlay className="h-3 w-3" />
            Login background
          </span>
        ) : null}
      </button>

      {/* Meta */}
      <div className="flex flex-1 flex-col gap-2 p-3">
        <p className="truncate text-sm font-semibold text-foreground" title={asset.title ?? asset.name}>
          {asset.title ?? asset.name}
        </p>
        {asset.description ? (
          <p className="line-clamp-2 text-xs text-muted-foreground">{asset.description}</p>
        ) : null}
        <div className="flex flex-wrap items-center gap-1.5">
          {asset.tags.slice(0, 3).map((tag) => (
            <Badge key={tag} variant="secondary" className="text-[10px]">
              {tag}
            </Badge>
          ))}
        </div>
        <p className="mt-auto text-[11px] text-muted-foreground">
          {formatBytes(asset.fileSize ?? 0)} · {formatDateTime(asset.createdAt)}
        </p>

        {/* Actions */}
        <div className="mt-1 flex flex-wrap items-center gap-1.5 border-t border-border pt-2">
          <Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5 px-2" onClick={onPreview}>
            <ExternalLink className="h-3.5 w-3.5" />
            Open
          </Button>
          {isPublic ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 px-2"
              onClick={() => void handleCopyUrl()}
            >
              <Copy className="h-3.5 w-3.5" />
              Copy URL
            </Button>
          ) : null}
          {canManage ? (
            <>
              {!isArchived ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5 px-2"
                  onClick={onEdit}
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Edit
                </Button>
              ) : null}
              {isArchived ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5 px-2"
                  onClick={onRestore}
                >
                  <ArchiveRestore className="h-3.5 w-3.5" />
                  Restore
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5 px-2"
                  onClick={onArchive}
                >
                  <Archive className="h-3.5 w-3.5" />
                  Remove from global library
                </Button>
              )}
              {isLoginBackground ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5 px-2 text-primary hover:text-primary"
                  onClick={onClearLoginBackground}
                >
                  <MonitorX className="h-3.5 w-3.5" />
                  Remove from login
                </Button>
              ) : canBeLoginBackground && !isArchived ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5 px-2"
                  onClick={onSetLoginBackground}
                >
                  <MonitorPlay className="h-3.5 w-3.5" />
                  Use for login
                </Button>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

interface UploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  uploading: boolean;
  onUpload: (files: File[], opts: UploadGlobalMediaOptions) => Promise<void>;
}

function UploadDialog({ open, onOpenChange, uploading, onUpload }: UploadDialogProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [target, setTarget] = useState<GlobalMediaVisibilityTarget>("internal");
  const [title, setTitle] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [tags, setTags] = useState<string>("");
  const [categoryId, setCategoryId] = useState<string>(NONE);
  const [folderSlug, setFolderSlug] = useState<string>(NONE);
  const [categories, setCategories] = useState<AssetCategory[]>([]);
  const [folders, setFolders] = useState<AssetFolder[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    void (async () => {
      try {
        const [cats, fols] = await Promise.all([listAssetCategories(), listAssetFolders({})]);
        if (!active) return;
        setCategories(cats.filter((c) => !c.companyId && !c.archivedAt));
        setFolders(fols.filter((f) => !f.companyId && !f.archivedAt && f.scope === "website_public"));
      } catch {
        if (active) {
          setCategories([]);
          setFolders([]);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [open]);

  const reset = () => {
    setFiles([]);
    setTarget("internal");
    setTitle("");
    setDescription("");
    setTags("");
    setCategoryId(NONE);
    setFolderSlug(NONE);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleClose = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const submit = async () => {
    if (files.length === 0) return;
    const parsedTags = tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    await onUpload(files, {
      target,
      title: title.trim() || null,
      description: description.trim() || null,
      tags: parsedTags,
      categoryId: categoryId === NONE ? null : categoryId,
      pathSlug: target === "public" && folderSlug !== NONE ? folderSlug : null,
    });
    reset();
  };

  const single = files.length === 1;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload asset</DialogTitle>
          <DialogDescription>
            Add media or a document to the platform library. Choose where it lives before
            uploading.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {/* Exposure */}
          <div className="grid gap-1.5">
            <Label>Visibility</Label>
            <div className="grid grid-cols-2 gap-2">
              <ExposureOption
                active={target === "internal"}
                onClick={() => setTarget("internal")}
                icon={<Lock className="h-4 w-4" />}
                title="Global internal"
                subtitle="Private library"
              />
              <ExposureOption
                active={target === "public"}
                onClick={() => setTarget("public")}
                icon={<Globe className="h-4 w-4" />}
                title="Website / Public"
                subtitle="World-readable"
              />
            </div>
          </div>

          {target === "public" ? (
            <div className="flex items-start gap-2.5 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                Public assets are stored in the world-readable bucket. Anyone with the URL can
                open this file — only upload assets meant for public websites, the login page or
                marketing.
              </p>
            </div>
          ) : null}

          {/* File picker */}
          <div className="grid gap-1.5">
            <Label>File{single ? "" : "s"}</Label>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-border bg-muted/20 px-4 py-6 text-center transition-colors hover:bg-muted/40"
            >
              <ImagePlus className="h-6 w-6 text-muted-foreground" />
              <span className="text-sm font-medium text-foreground">
                {files.length === 0
                  ? "Choose files"
                  : files.length === 1
                    ? files[0].name
                    : `${files.length} files selected`}
              </span>
              <span className="text-xs text-muted-foreground">
                Images, videos, PDFs and documents · up to 50 MB each
              </span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => setFiles(e.target.files ? Array.from(e.target.files) : [])}
            />
          </div>

          {single ? (
            <div className="grid gap-1.5">
              <Label htmlFor="asset-title">Title</Label>
              <Input
                id="asset-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Optional display name"
              />
            </div>
          ) : null}

          <div className="grid gap-1.5">
            <Label htmlFor="asset-description">Description</Label>
            <Textarea
              id="asset-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional notes about this asset"
              rows={2}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="asset-tags">Tags</Label>
              <Input
                id="asset-tags"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="comma, separated"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Category</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger>
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>None</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {target === "public" && folders.length > 0 ? (
            <div className="grid gap-1.5">
              <Label>Website section</Label>
              <Select value={folderSlug} onValueChange={setFolderSlug}>
                <SelectTrigger>
                  <SelectValue placeholder="General" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>General</SelectItem>
                  {folders.map((f) => (
                    <SelectItem key={f.id} value={f.slug ?? f.id}>
                      {f.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleClose(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={files.length === 0 || uploading}>
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Upload {files.length > 1 ? `${files.length} files` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ExposureOption({
  active,
  onClick,
  icon,
  title,
  subtitle,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "flex items-center gap-2.5 rounded-xl border-2 border-primary bg-primary/5 px-3 py-2.5 text-left"
          : "flex items-center gap-2.5 rounded-xl border border-border bg-card px-3 py-2.5 text-left transition-colors hover:bg-accent"
      }
    >
      <span className={active ? "text-primary" : "text-muted-foreground"}>{icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">{title}</span>
        <span className="block truncate text-[11px] text-muted-foreground">{subtitle}</span>
      </span>
    </button>
  );
}

interface EditDialogProps {
  item: GlobalMediaItem | null;
  onOpenChange: (open: boolean) => void;
  onSave: (patch: { title: string | null; description: string | null; tags: string[] }) => Promise<void>;
}

function EditDialog({ item, onOpenChange, onSave }: EditDialogProps) {
  const [title, setTitle] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [tags, setTags] = useState<string>("");
  const [saving, setSaving] = useState<boolean>(false);

  useEffect(() => {
    if (!item) return;
    setTitle(item.asset.title ?? "");
    setDescription(item.asset.description ?? "");
    setTags(item.asset.tags.join(", "));
  }, [item]);

  const submit = async () => {
    setSaving(true);
    try {
      await onSave({
        title: title.trim() || null,
        description: description.trim() || null,
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={item !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit asset</DialogTitle>
          <DialogDescription className="truncate">{item?.asset.name}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="edit-title">Title</Label>
            <Input id="edit-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="edit-description">Description</Label>
            <Textarea
              id="edit-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="edit-tags">Tags</Label>
            <Input
              id="edit-tags"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="comma, separated"
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PreviewDialog({
  item,
  onOpenChange,
}: {
  item: GlobalMediaItem | null;
  onOpenChange: (open: boolean) => void;
}) {
  if (!item) {
    return (
      <Dialog open={false} onOpenChange={onOpenChange}>
        <DialogContent />
      </Dialog>
    );
  }

  const { asset, urls } = item;
  const url = urls?.fullUrl ?? null;
  const isVisual = asset.assetType === "image" || asset.assetType === "icon";
  const isVideo = asset.assetType === "video";

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl gap-0 overflow-hidden p-0">
        <DialogHeader className="px-5 py-4">
          <DialogTitle className="truncate">{asset.title ?? asset.name}</DialogTitle>
          <DialogDescription className="truncate">
            {TYPE_META[asset.assetType].label} · {formatBytes(asset.fileSize ?? 0)}
          </DialogDescription>
        </DialogHeader>
        <div className="flex max-h-[70vh] items-center justify-center overflow-auto bg-black">
          {!url ? (
            <div className="flex flex-col items-center gap-2 px-6 py-16 text-center text-sm text-white/70">
              <ImageOff className="h-6 w-6" />
              Preview unavailable.
            </div>
          ) : isVisual ? (
            <img src={url} alt={asset.title ?? asset.name} className="max-h-[70vh] w-auto object-contain" />
          ) : isVideo ? (
            <video src={url} controls className="max-h-[70vh] w-full bg-black" />
          ) : (
            <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
              <FileText className="h-10 w-10 text-white/80" />
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-sm font-medium text-black"
              >
                <ExternalLink className="h-4 w-4" />
                Open file
              </a>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
