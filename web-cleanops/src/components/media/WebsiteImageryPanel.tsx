import { useMemo, useState } from "react";
import {
  Check,
  ExternalLink,
  ImageOff,
  ImagePlus,
  Images,
  Loader2,
  Search,
  ShieldAlert,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useWebsiteImagery, type WebsiteImagerySlotState } from "@/hooks/use-website-imagery";
import { PUBLIC_PAGES } from "@/lib/publicSite/pages";
import type { WebsiteImageSlot } from "@/lib/publicSite/imageSlots";
import type { GlobalMediaItem } from "@/hooks/use-global-media-library";

/** Friendly page name + route for a page slug (from the public site registry). */
function pageInfo(pageSlug: string): { name: string; path: string } {
  const page = PUBLIC_PAGES.find((p) => p.slug === pageSlug);
  const path = page?.path ?? `/${pageSlug}`;
  const name =
    pageSlug === "home"
      ? "Home"
      : pageSlug === "get-started"
        ? "Get started"
        : pageSlug.charAt(0).toUpperCase() + pageSlug.slice(1);
  return { name, path };
}

/**
 * Super Admin — Website imagery. Assigns PUBLIC Media Center images to the named
 * hero/section slots on the public marketing pages. Each assignment is persisted
 * as a public `asset_link` (Supabase-authoritative) and resolves on the live
 * public site; unassigned slots fall back to the built-in placeholder. Only
 * public images can be picked, so URLs stay readable for logged-out visitors.
 */
export function WebsiteImageryPanel({ publicImages }: { publicImages: GlobalMediaItem[] }) {
  const { groups, loading, error, canManage, busySlotKey, assign, clear } = useWebsiteImagery();
  const [pickerSlot, setPickerSlot] = useState<WebsiteImageSlot | null>(null);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-destructive/40 bg-destructive/5 px-4 py-16 text-center">
        <ShieldAlert className="h-6 w-6 text-destructive" />
        <p className="mt-2 max-w-md text-sm text-destructive">{error}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-2xl border border-dashed border-border bg-muted/30 px-4 py-20 text-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">Loading website imagery…</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
        <Images className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <p>
          Assign <span className="font-medium text-foreground">Website / Public</span> images to the
          hero and section spots on your public pages. Changes go live on the public website. Empty
          slots use the built-in placeholder.
        </p>
      </div>

      {groups.map((group) => {
        const info = pageInfo(group.pageSlug);
        return (
          <section key={group.pageSlug} className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">{info.name}</h2>
              <a
                href={info.path}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                View page
              </a>
            </div>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {group.slots.map((state) => (
                <SlotRow
                  key={state.slot.key}
                  state={state}
                  canManage={canManage}
                  busy={busySlotKey === state.slot.key}
                  onAssign={() => setPickerSlot(state.slot)}
                  onClear={() => void clear(state.slot)}
                />
              ))}
            </div>
          </section>
        );
      })}

      <AssignDialog
        slot={pickerSlot}
        images={publicImages}
        onOpenChange={(open) => !open && setPickerSlot(null)}
        onPick={(asset) => {
          if (pickerSlot) void assign(pickerSlot, asset);
          setPickerSlot(null);
        }}
      />
    </div>
  );
}

interface SlotRowProps {
  state: WebsiteImagerySlotState;
  canManage: boolean;
  busy: boolean;
  onAssign: () => void;
  onClear: () => void;
}

function SlotRow({ state, canManage, busy, onAssign, onClear }: SlotRowProps) {
  const { slot, url, title } = state;
  const assigned = Boolean(url);

  return (
    <div className="flex gap-3 rounded-xl border border-border bg-card p-3">
      {/* Preview */}
      <div className="relative flex h-[72px] w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted/50">
        {url ? (
          <img src={url} alt={title ?? slot.label} className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <ImageOff className="h-5 w-5 text-muted-foreground" />
        )}
        {busy ? (
          <span className="absolute inset-0 flex items-center justify-center bg-background/70">
            <Loader2 className="h-4 w-4 animate-spin text-foreground" />
          </span>
        ) : null}
      </div>

      {/* Meta + actions */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium text-foreground">{slot.label}</p>
          {assigned ? (
            <Badge variant="secondary" className="shrink-0 text-[10px]">
              <Check className="mr-0.5 h-2.5 w-2.5" />
              Set
            </Badge>
          ) : (
            <Badge variant="outline" className="shrink-0 text-[10px] text-muted-foreground">
              Not set
            </Badge>
          )}
        </div>
        <p className="truncate text-xs text-muted-foreground">
          {assigned ? (title ?? "Assigned image") : slot.description}
        </p>

        {canManage ? (
          <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 px-2"
              onClick={onAssign}
              disabled={busy}
            >
              <ImagePlus className="h-3.5 w-3.5" />
              {assigned ? "Replace" : "Assign"}
            </Button>
            {assigned ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5 px-2 text-muted-foreground hover:text-destructive"
                onClick={onClear}
                disabled={busy}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Clear
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

interface AssignDialogProps {
  slot: WebsiteImageSlot | null;
  images: GlobalMediaItem[];
  onOpenChange: (open: boolean) => void;
  onPick: (asset: GlobalMediaItem["asset"]) => void;
}

function AssignDialog({ slot, images, onOpenChange, onPick }: AssignDialogProps) {
  const [query, setQuery] = useState<string>("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return images;
    return images.filter((it) => {
      const hay = [it.asset.title ?? "", it.asset.name, ...it.asset.tags].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [images, query]);

  return (
    <Dialog open={slot !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Choose an image{slot ? ` · ${slot.label}` : ""}</DialogTitle>
          <DialogDescription>
            Pick a Website / Public image. Only public images appear here so the URL works on the
            public site.
          </DialogDescription>
        </DialogHeader>

        {images.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/30 px-4 py-12 text-center">
            <ImageOff className="h-6 w-6 text-muted-foreground" />
            <p className="mt-2 max-w-xs text-sm text-muted-foreground">
              No public images yet. Upload an image with the <span className="font-medium">Website / Public</span>{" "}
              visibility first, then assign it here.
            </p>
          </div>
        ) : (
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search public images…"
                className="pl-9"
              />
            </div>
            <div className="grid max-h-[55vh] grid-cols-2 gap-3 overflow-y-auto py-1 sm:grid-cols-3">
              {filtered.map((item) => (
                <button
                  key={item.asset.id}
                  type="button"
                  onClick={() => onPick(item.asset)}
                  className="group flex flex-col overflow-hidden rounded-xl border border-border bg-card text-left outline-none ring-offset-background transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="flex aspect-[4/3] items-center justify-center overflow-hidden bg-muted/40">
                    {item.urls?.thumbUrl ? (
                      <img
                        src={item.urls.thumbUrl}
                        alt={item.asset.title ?? item.asset.name}
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform group-hover:scale-[1.03]"
                      />
                    ) : (
                      <ImageOff className="h-6 w-6 text-muted-foreground" />
                    )}
                  </span>
                  <span className="truncate px-2.5 py-2 text-xs font-medium text-foreground">
                    {item.asset.title ?? item.asset.name}
                  </span>
                </button>
              ))}
              {filtered.length === 0 ? (
                <p className="col-span-full py-8 text-center text-sm text-muted-foreground">
                  No images match your search.
                </p>
              ) : null}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
