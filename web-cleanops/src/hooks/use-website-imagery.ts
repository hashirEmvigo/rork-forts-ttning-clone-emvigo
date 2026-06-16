/**
 * Super Admin — public website imagery manager hook (Supabase-authoritative).
 *
 * Owns the "assign a Media Center image to a public-page slot" surface on top of
 * the Asset Center placement layer (see {@link @/lib/assets/websiteImagery}).
 * The read path is Supabase ONLY (no localStorage authority, no mediaStore
 * fallback). Mutations commit to Supabase first, then refetch so the UI reflects
 * the true persisted state — surviving a hard refresh. Errors surface via toast.
 *
 * Management is Super-Admin only; the hook no-ops safely for any other role (the
 * route guard is the primary gate, this is defense-in-depth). Only PUBLIC images
 * may be assigned — enforced in the data layer.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { useApp } from "@/context/AppContext";
import { useToast } from "@/hooks/use-toast";
import { isSupabaseConfigured } from "@/lib/supabase";
import {
  clearWebsiteImage,
  listWebsiteImageLinks,
  setWebsiteImage,
  type AssetLink,
  type Asset,
} from "@/lib/assets";
import {
  getWebsiteImageSlotGroups,
  type WebsiteImageSlot,
} from "@/lib/publicSite/imageSlots";

/** The resolved state of a single website image slot. */
export interface WebsiteImagerySlotState {
  slot: WebsiteImageSlot;
  /** The active placement link, or null when the slot is empty. */
  link: AssetLink | null;
  /** Cached public URL of the assigned image (for the thumbnail), or null. */
  url: string | null;
  /** Cached display title of the assigned asset, or null. */
  title: string | null;
}

/** A page heading with the resolved state of each of its slots. */
export interface WebsiteImageryGroup {
  pageSlug: string;
  slots: WebsiteImagerySlotState[];
}

export interface WebsiteImageryResult {
  groups: WebsiteImageryGroup[];
  /** Flat list of every slot's state (same data as `groups`). */
  slots: WebsiteImagerySlotState[];
  loading: boolean;
  error: string | null;
  /** True only for a Super Admin against a configured Supabase. */
  canManage: boolean;
  /** Slot key currently being written (assign/clear), for per-row spinners. */
  busySlotKey: string | null;
  /** Assigns a PUBLIC image asset to a slot, then refetches. */
  assign: (slot: WebsiteImageSlot, asset: Asset) => Promise<void>;
  /** Clears a slot (reverts to the built-in placeholder), then refetches. */
  clear: (slot: WebsiteImageSlot) => Promise<void>;
  refetch: () => Promise<void>;
}

function metaString(metadata: Record<string, unknown> | undefined, key: string): string | null {
  const value = metadata?.[key];
  return typeof value === "string" ? value : null;
}

/** Website-imagery placement data source for the Super Admin Media Center. */
export function useWebsiteImagery(): WebsiteImageryResult {
  const { currentUser } = useApp();
  const { toast } = useToast();

  const [links, setLinks] = useState<AssetLink[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [busySlotKey, setBusySlotKey] = useState<string | null>(null);

  const isSuperAdmin = currentUser?.role === "super_admin";
  const canManage = isSuperAdmin && isSupabaseConfigured;
  const actorId = currentUser?.id ?? null;
  const actorRole = currentUser?.role ?? null;

  const reqSeq = useRef<number>(0);

  const refetch = useCallback(async () => {
    const seq = ++reqSeq.current;
    if (!isSuperAdmin || !isSupabaseConfigured) {
      setLinks([]);
      setError(isSuperAdmin ? "Website imagery requires Supabase." : null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const all = await listWebsiteImageLinks();
      if (seq !== reqSeq.current) return;
      setLinks(all);
      setError(null);
    } catch (err) {
      if (seq !== reqSeq.current) return;
      setLinks([]);
      setError(err instanceof Error ? err.message : "Failed to load website imagery.");
    } finally {
      if (seq === reqSeq.current) setLoading(false);
    }
  }, [isSuperAdmin]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const assign = useCallback(
    async (slot: WebsiteImageSlot, asset: Asset) => {
      if (!canManage) return;
      setBusySlotKey(slot.key);
      try {
        await setWebsiteImage(
          { slotKey: slot.key, pageSlug: slot.pageSlug },
          asset,
          null,
          { id: actorId, role: actorRole },
        );
        await refetch();
        toast({
          title: "Image assigned",
          description: `“${asset.title ?? asset.name}” now shows on ${slot.label}.`,
        });
      } catch (err) {
        toast({
          title: "Could not assign image",
          description: err instanceof Error ? err.message : "Please try again.",
          variant: "destructive",
        });
      } finally {
        setBusySlotKey(null);
      }
    },
    [canManage, actorId, actorRole, toast, refetch],
  );

  const clear = useCallback(
    async (slot: WebsiteImageSlot) => {
      if (!canManage) return;
      setBusySlotKey(slot.key);
      try {
        await clearWebsiteImage(
          { slotKey: slot.key, pageSlug: slot.pageSlug },
          { id: actorId, role: actorRole },
        );
        await refetch();
        toast({
          title: "Image cleared",
          description: `${slot.label} now uses the built-in placeholder.`,
        });
      } catch (err) {
        toast({
          title: "Could not clear image",
          description: err instanceof Error ? err.message : "Please try again.",
          variant: "destructive",
        });
      } finally {
        setBusySlotKey(null);
      }
    },
    [canManage, actorId, actorRole, toast, refetch],
  );

  // Build per-slot state by matching the newest active link to each slot.
  const newestForSlot = (pageSlug: string, slotKey: string): AssetLink | null => {
    let best: AssetLink | null = null;
    for (const link of links) {
      if (link.entityId !== pageSlug || link.placementKey !== slotKey) continue;
      if (!best || best.createdAt < link.createdAt) best = link;
    }
    return best;
  };

  const groups: WebsiteImageryGroup[] = getWebsiteImageSlotGroups().map((group) => ({
    pageSlug: group.pageSlug,
    slots: group.slots.map((slot) => {
      const link = newestForSlot(slot.pageSlug, slot.key);
      return {
        slot,
        link,
        url: metaString(link?.metadata, "mediaUrl"),
        title: metaString(link?.metadata, "title"),
      };
    }),
  }));

  const slots: WebsiteImagerySlotState[] = groups.flatMap((g) => g.slots);

  return {
    groups,
    slots,
    loading,
    error,
    canManage,
    busySlotKey,
    assign,
    clear,
    refetch,
  };
}
