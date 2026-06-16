/**
 * Public website imagery — Supabase-authoritative placement layer.
 *
 * Lets a Super Admin assign a PUBLIC Media Center image to a named slot on a
 * public marketing page (hero / section visuals), straight from the Media
 * Center. Mirrors the login-branding model (see {@link ./loginBranding}).
 *
 * Each placement is a SINGLETON {@link AssetLink} per (page, slot):
 *   entity_type = "public_website_page", entity_id = <pageSlug>,
 *   placement_key = <slotKey>, scope = "website_public", visibility = "public".
 *
 * Why an `asset_link`:
 *   • Public pages are UNAUTHENTICATED. The Asset Center RLS grants `anon`
 *     SELECT on `asset_links`/`assets` whose visibility is `public` (policies
 *     `*_select_public` in migration 0055), so a logged-out visitor resolves the
 *     placement with no extra RLS/migration.
 *   • Only a PUBLIC asset (public-assets bucket, stable public URL) may be
 *     assigned — a private/signed URL would expire and 404 on the public site.
 *
 * The chosen public URL + alt text + title are cached in the link metadata so a
 * public page resolves all of its images in a SINGLE query (no per-asset
 * round-trip). No localStorage / mediaStore is touched — Supabase is the source
 * of truth and the UI only reflects a successful write.
 */
import { isSupabaseConfigured } from "@/lib/supabase";

import {
  archiveAssetLink,
  createAssetLink,
  listAssetLinks,
} from "./assetRepository";
import { safeRecordAssetActivity } from "./assetAudit";
import { resolvePublicUrl } from "./assetUrlResolver";
import { PUBLIC_BUCKET } from "./assetStorage";
import type { Asset, AssetLink, AssetLinkEntityType } from "./assetTypes";

/** Polymorphic entity type for public-website image placements. */
export const PUBLIC_WEBSITE_ENTITY_TYPE: AssetLinkEntityType = "public_website_page";

/**
 * Media kinds a website slot can resolve to. Slots are image-first; `video` is
 * supported for read/render only (a few slots — e.g. the public calculator's
 * right-side visual — use a short atmosphere clip). The image-only assignment
 * guard in {@link setWebsiteImage} is unchanged.
 */
export type WebsiteImageMediaType = "image" | "video";

/** File extensions that mean a slot's cached media URL is a video, not an image. */
const VIDEO_URL_EXTENSIONS = [".mp4", ".webm", ".mov", ".m4v", ".ogv"] as const;

/**
 * Resolves a slot's media kind defensively: an explicit `mediaType` in the link
 * metadata wins; otherwise it is inferred from the cached URL's extension (so a
 * video linked outside the image picker still renders as a `<video>`); images
 * are the safe default.
 */
export function inferWebsiteMediaType(
  metadata: Record<string, unknown> | undefined,
  url: string,
): WebsiteImageMediaType {
  const declared = metadata?.mediaType;
  if (declared === "video" || declared === "image") return declared;
  const lower = url.split(/[?#]/)[0]?.toLowerCase() ?? "";
  return VIDEO_URL_EXTENSIONS.some((ext) => lower.endsWith(ext)) ? "video" : "image";
}

/** A resolved, ready-to-render website image/video. Never persisted as-is. */
export interface WebsiteImage {
  /** The slot it fills (== link.placementKey). */
  slotKey: string;
  /** The page it belongs to (== link.entityId). */
  pageSlug: string;
  /** App-facing id of the chosen asset. */
  assetId: string;
  /** Stable PUBLIC URL of the asset's original object. */
  url: string;
  /** Alt text for the `<img>` (asset alt/title, cached at assign time). */
  alt: string;
  /** Whether the slot resolves to a static image or a video clip. */
  mediaType: WebsiteImageMediaType;
}

/** The actor performing a change (for the audit trail). */
export interface WebsiteImageryActor {
  id?: string | null;
  role?: string | null;
}

/** A slot reference: which page + slot a placement targets. */
export interface WebsiteImageTarget {
  slotKey: string;
  pageSlug: string;
}

/** Resolves a stable public URL for a public asset's original object (or null). */
function resolvePublicAssetUrl(asset: Asset): string | null {
  if (asset.publicUrl) return asset.publicUrl;
  if (asset.storageBucket === PUBLIC_BUCKET && asset.storagePath) {
    return resolvePublicUrl(PUBLIC_BUCKET, asset.storagePath);
  }
  return null;
}

/** Reads a string field from link metadata, or null. */
function metaString(metadata: Record<string, unknown> | undefined, key: string): string | null {
  const value = metadata?.[key];
  return typeof value === "string" ? value : null;
}

/**
 * Lists active website-image placement links. Pass a `pageSlug` to scope to one
 * page; omit it to load every page's placements (used by the Media Center
 * manager). Returns [] when Supabase is unconfigured.
 */
export async function listWebsiteImageLinks(pageSlug?: string): Promise<AssetLink[]> {
  if (!isSupabaseConfigured) return [];
  return listAssetLinks({
    entityType: PUBLIC_WEBSITE_ENTITY_TYPE,
    ...(pageSlug !== undefined ? { entityId: pageSlug } : {}),
  });
}

/** Keeps the newest active link per placement key (defensive against duplicates). */
function newestByPlacement(links: AssetLink[]): Map<string, AssetLink> {
  const out = new Map<string, AssetLink>();
  for (const link of links) {
    const current = out.get(link.placementKey);
    if (!current || current.createdAt < link.createdAt) out.set(link.placementKey, link);
  }
  return out;
}

/**
 * Resolves every configured image for a public page in ONE query, as a
 * `slotKey → WebsiteImage` map. Works for an UNAUTHENTICATED visitor (public
 * RLS). Slots without a cached public URL are omitted so the caller falls back
 * to its built-in placeholder. Never touches private/customer/company media.
 */
export async function getWebsiteImagesForPage(
  pageSlug: string,
): Promise<Map<string, WebsiteImage>> {
  const out = new Map<string, WebsiteImage>();
  if (!isSupabaseConfigured) return out;

  const links = await listWebsiteImageLinks(pageSlug);
  for (const [slotKey, link] of newestByPlacement(links)) {
    // A public placement must carry a public URL + must be visibility=public.
    if (link.visibility !== "public") continue;
    const url = metaString(link.metadata, "mediaUrl");
    if (!url) continue;
    out.set(slotKey, {
      slotKey,
      pageSlug,
      assetId: link.assetId,
      url,
      alt: metaString(link.metadata, "alt") ?? "",
      mediaType: inferWebsiteMediaType(link.metadata, url),
    });
  }
  return out;
}

/**
 * Assigns the given PUBLIC image asset to a page slot. The asset MUST be a
 * PUBLIC image/icon so its URL works on the unauthenticated public site.
 * Enforces the per-(page, slot) singleton: any existing active link for the
 * same placement is archived first, then a new public link is created
 * (Super-Admin only, gated by RLS). The public URL + alt + title are cached on
 * the link so public pages resolve in a single read.
 */
export async function setWebsiteImage(
  target: WebsiteImageTarget,
  asset: Asset,
  alt: string | null = null,
  actor: WebsiteImageryActor = {},
): Promise<AssetLink> {
  if (asset.visibility !== "public") {
    throw new Error(
      "Only a Website / Public asset can be used on the public site, so its URL stays " +
        "readable for logged-out visitors. Upload or re-upload it as public first.",
    );
  }
  if (asset.assetType !== "image" && asset.assetType !== "icon") {
    throw new Error("Website imagery must be an image.");
  }
  const url = resolvePublicAssetUrl(asset);
  if (!url) {
    throw new Error("This asset has no public URL yet, so it can't be placed on the website.");
  }

  // Singleton invariant: archive any existing active link for this exact slot
  // BEFORE creating the new one.
  const existing = await listAssetLinks({
    entityType: PUBLIC_WEBSITE_ENTITY_TYPE,
    entityId: target.pageSlug,
    placementKey: target.slotKey,
  });
  for (const link of existing) {
    await archiveAssetLink(link.id);
  }

  const resolvedAlt = (alt ?? asset.altText ?? asset.title ?? asset.name ?? "").trim();
  const created = await createAssetLink({
    assetId: asset.id,
    entityType: PUBLIC_WEBSITE_ENTITY_TYPE,
    entityId: target.pageSlug,
    placementKey: target.slotKey,
    scope: "website_public",
    visibility: "public",
    createdBy: actor.id ?? null,
    metadata: {
      mediaUrl: url,
      alt: resolvedAlt,
      title: asset.title ?? asset.name ?? null,
    },
  });

  void safeRecordAssetActivity({
    eventType: "public_website_asset_changed",
    assetId: asset.id,
    actorUserId: actor.id ?? null,
    actorRole: actor.role ?? null,
    scope: "website_public",
    visibility: "public",
    summary: `Set "${asset.title ?? asset.name}" on ${target.pageSlug} · ${target.slotKey}`,
    metadata: { pageSlug: target.pageSlug, slotKey: target.slotKey },
  });

  return created;
}

/**
 * Clears a page slot by archiving any active link for it. The public page then
 * falls back to its built-in placeholder. No-op (and no audit event) when the
 * slot is empty. The linked asset itself is untouched.
 */
export async function clearWebsiteImage(
  target: WebsiteImageTarget,
  actor: WebsiteImageryActor = {},
): Promise<void> {
  const existing = await listAssetLinks({
    entityType: PUBLIC_WEBSITE_ENTITY_TYPE,
    entityId: target.pageSlug,
    placementKey: target.slotKey,
  });
  if (existing.length === 0) return;
  for (const link of existing) {
    await archiveAssetLink(link.id);
  }
  void safeRecordAssetActivity({
    eventType: "public_website_asset_changed",
    actorUserId: actor.id ?? null,
    actorRole: actor.role ?? null,
    scope: "website_public",
    visibility: "public",
    summary: `Cleared the image on ${target.pageSlug} · ${target.slotKey}`,
    metadata: { pageSlug: target.pageSlug, slotKey: target.slotKey },
  });
}
