/**
 * Login-page branding — Supabase-authoritative login background selection.
 *
 * Lets a Super Admin pick which platform asset renders as the sign-in screen's
 * brand-panel background (image or video), straight from the Media Center —
 * instead of editing a hardcoded URL in `AuthShell`.
 *
 * The selection is modelled as a SINGLETON {@link AssetLink}:
 *   entity_type = "login_page", entity_id = null, placement_key = "login_background",
 *   scope = "website_public", visibility = "public".
 *
 * Why an `asset_link`:
 *   • The sign-in screen is UNAUTHENTICATED. The Asset Center RLS already grants
 *     the `anon` role SELECT on `asset_links`/`assets` rows whose visibility is
 *     `public` (policies `*_select_public` in migration 0055), so a logged-out
 *     visitor can read this placement + its asset with no extra RLS/migration.
 *   • Only a PUBLIC asset (public-assets bucket, stable public URL) can be the
 *     background — a private/signed URL would expire and 404 on the login page.
 *
 * The chosen public URL + media type are cached in the link metadata so the
 * login page resolves the background in a SINGLE read (no asset round-trip);
 * the asset row is used as a fallback. No localStorage / mediaStore is touched.
 */
import { isSupabaseConfigured } from "@/lib/supabase";

import {
  archiveAssetLink,
  createAssetLink,
  getAssetById,
  listAssetLinks,
  updateAssetLink,
} from "./assetRepository";
import { safeRecordAssetActivity } from "./assetAudit";
import { resolvePublicUrl } from "./assetUrlResolver";
import { PUBLIC_BUCKET } from "./assetStorage";
import type { Asset, AssetLink, AssetLinkEntityType, AssetPlacementKey } from "./assetTypes";

/** Polymorphic entity type for the (singleton) login-page placement. */
export const LOGIN_PAGE_ENTITY_TYPE: AssetLinkEntityType = "login_page";

/** The single slot that holds the login brand-panel background (image OR video). */
export const LOGIN_BACKGROUND_PLACEMENT: AssetPlacementKey = "login_background";

/** Media kinds allowed as a login background. */
export type LoginBackgroundMediaType = "image" | "video";

/**
 * Per-breakpoint overlay (scrim) opacities applied over the login background so
 * the sign-in UI stays readable. Each value is a percentage (0–100).
 */
export interface LoginOverlay {
  /** Brand-tinted wash over the desktop side panel. Higher = stronger filter. */
  desktop: number;
  /** Photo dim behind the mobile sign-in card. Higher = photo less visible. */
  mobile: number;
}

/** Built-in overlay — used for the default background and as the reset target. */
export const DEFAULT_LOGIN_OVERLAY: LoginOverlay = { desktop: 55, mobile: 45 };

/** Clamps any value to an integer percentage in [0, 100], or returns a fallback. */
function clampOverlay(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(100, Math.max(0, Math.round(value)));
}

/** Reads the per-breakpoint overlay opacities from link metadata (clamped, defaulted). */
export function parseLoginOverlay(
  metadata: Record<string, unknown> | null | undefined,
): LoginOverlay {
  return {
    desktop: clampOverlay(metadata?.desktopOverlay, DEFAULT_LOGIN_OVERLAY.desktop),
    mobile: clampOverlay(metadata?.mobileOverlay, DEFAULT_LOGIN_OVERLAY.mobile),
  };
}

/** A resolved, ready-to-render login background. Never persisted as-is. */
export interface LoginBackground {
  /** App-facing id of the chosen asset. */
  assetId: string;
  /** Stable public URL of the asset's original object. */
  url: string;
  /** Whether to render a looping `<video>` or an `<img>`. */
  mediaType: LoginBackgroundMediaType;
  /** Per-breakpoint overlay opacities to render over the media. */
  overlay: LoginOverlay;
}

/** The actor performing a change (for the audit trail). */
export interface LoginBrandingActor {
  id?: string | null;
  role?: string | null;
}

/** Resolves a stable public URL for a public asset's original object (or null). */
function resolvePublicAssetUrl(asset: Asset): string | null {
  if (asset.publicUrl) return asset.publicUrl;
  if (asset.storageBucket === PUBLIC_BUCKET && asset.storagePath) {
    return resolvePublicUrl(PUBLIC_BUCKET, asset.storagePath);
  }
  return null;
}

/** Narrows an asset type to a login media kind (everything visual maps to image). */
function mediaTypeForAsset(asset: Pick<Asset, "assetType">): LoginBackgroundMediaType {
  return asset.assetType === "video" ? "video" : "image";
}

/**
 * Returns the active login-page background link, or null when none is set / the
 * client is unconfigured. Defensive against duplicates: if more than one active
 * link somehow exists, the newest wins (the rest are stale and ignored).
 */
export async function getLoginBackgroundLink(): Promise<AssetLink | null> {
  if (!isSupabaseConfigured) return null;
  const links = await listAssetLinks({
    entityType: LOGIN_PAGE_ENTITY_TYPE,
    placementKey: LOGIN_BACKGROUND_PLACEMENT,
  });
  if (links.length === 0) return null;
  return links
    .slice()
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
}

/**
 * Resolves the currently-configured login background for rendering. Works for an
 * UNAUTHENTICATED visitor (public RLS). Returns null when nothing is configured,
 * the client is unconfigured, or the linked asset is no longer public/resolvable
 * — callers should fall back to their built-in default in that case.
 */
export async function getLoginBackground(): Promise<LoginBackground | null> {
  const link = await getLoginBackgroundLink();
  if (!link) return null;

  // Fast path: the public URL + media type cached on the link at set-time, so
  // the login page resolves in ONE read (no asset round-trip).
  const cachedUrl = typeof link.metadata?.mediaUrl === "string" ? link.metadata.mediaUrl : null;
  const cachedType =
    link.metadata?.mediaType === "video"
      ? "video"
      : link.metadata?.mediaType === "image"
        ? "image"
        : null;
  if (cachedUrl && cachedType) {
    return {
      assetId: link.assetId,
      url: cachedUrl,
      mediaType: cachedType,
      overlay: parseLoginOverlay(link.metadata),
    };
  }

  // Fallback: resolve from the asset row (still public-readable for anon).
  const asset = await getAssetById(link.assetId);
  if (!asset || asset.visibility !== "public") return null;
  const url = resolvePublicAssetUrl(asset);
  if (!url) return null;
  return {
    assetId: asset.id,
    url,
    mediaType: mediaTypeForAsset(asset),
    overlay: parseLoginOverlay(link.metadata),
  };
}

/**
 * Sets the given asset as the login background. The asset MUST be a PUBLIC
 * image/video so its URL works on the unauthenticated sign-in screen. Enforces
 * the singleton: any existing active login-page background link is archived
 * first, then a new public link is created (Super-Admin only, gated by RLS).
 */
export async function setLoginBackground(
  asset: Asset,
  actor: LoginBrandingActor = {},
): Promise<AssetLink> {
  if (asset.visibility !== "public") {
    throw new Error(
      "Only a Website / Public asset can be the login background, so its URL stays " +
        "readable on the sign-in screen. Re-upload it as public first.",
    );
  }
  if (asset.assetType !== "image" && asset.assetType !== "video") {
    throw new Error("The login background must be an image or a video.");
  }
  const url = resolvePublicAssetUrl(asset);
  if (!url) {
    throw new Error("This asset has no public URL yet, so it can't be used as the login background.");
  }

  // Singleton invariant (the DB unique index treats null entity_id as distinct,
  // so we enforce "one active login background" here).
  const existing = await listAssetLinks({
    entityType: LOGIN_PAGE_ENTITY_TYPE,
    placementKey: LOGIN_BACKGROUND_PLACEMENT,
  });
  for (const link of existing) {
    await archiveAssetLink(link.id);
  }

  const created = await createAssetLink({
    assetId: asset.id,
    entityType: LOGIN_PAGE_ENTITY_TYPE,
    entityId: null,
    placementKey: LOGIN_BACKGROUND_PLACEMENT,
    scope: "website_public",
    visibility: "public",
    createdBy: actor.id ?? null,
    metadata: { mediaUrl: url, mediaType: mediaTypeForAsset(asset) },
  });

  void safeRecordAssetActivity({
    eventType: "login_page_video_changed",
    assetId: asset.id,
    actorUserId: actor.id ?? null,
    actorRole: actor.role ?? null,
    scope: "website_public",
    visibility: "public",
    summary: `Set "${asset.title ?? asset.name}" as the login background`,
  });

  return created;
}

/**
 * Clears the login background by archiving any active login-page background
 * link(s). The login page then falls back to its built-in default. No-op (and
 * no audit event) when nothing is configured. The linked asset is untouched.
 */
export async function clearLoginBackground(actor: LoginBrandingActor = {}): Promise<void> {
  const existing = await listAssetLinks({
    entityType: LOGIN_PAGE_ENTITY_TYPE,
    placementKey: LOGIN_BACKGROUND_PLACEMENT,
  });
  if (existing.length === 0) return;
  for (const link of existing) {
    await archiveAssetLink(link.id);
  }
  void safeRecordAssetActivity({
    eventType: "login_page_video_changed",
    actorUserId: actor.id ?? null,
    actorRole: actor.role ?? null,
    scope: "website_public",
    visibility: "public",
    summary: "Cleared the login background (reverted to the default)",
  });
}
