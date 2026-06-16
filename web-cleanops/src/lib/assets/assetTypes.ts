/**
 * Asset Center — domain types (Phase 1 foundation).
 *
 * Strongly-typed models for the unified Asset Center introduced by migrations
 * 0055 (tables/RLS/seed) + 0056 (storage). Naming is deliberately neutral
 * ("asset", not "image") so the same model carries images, videos, icons, PDFs,
 * documents and future attachments.
 *
 * These types describe the *domain* shape (camelCase). The Supabase rows
 * (snake_case) are mapped to/from these in {@link ./assetRepository}.
 *
 * Phase 1 is foundation-only: nothing here is wired into UI, the existing
 * localStorage media path (src/lib/mediaStore.ts) is untouched, and a company
 * copy of a global asset is INDEPENDENT (see {@link Asset.copiedFromAssetId}).
 */

/** Storage tiers. `public-assets` is world-readable; `private-assets` is not. */
export type AssetStorageBucket = "public-assets" | "private-assets";

/**
 * Ownership + exposure boundary of an asset. Drives both storage-bucket choice
 * and RLS. `*_public` / `website_public` are the only broadly-exposed scopes;
 * everything else is private/internal.
 */
export type AssetScope =
  | "global_internal"
  | "global_public"
  | "company_internal"
  | "company_public"
  | "customer_internal"
  | "customer_visible"
  | "website_public"
  | "protocol_internal"
  | "work_order_internal"
  | "case_internal";

/**
 * Who may see an asset. `public` is the ONLY value an unauthenticated visitor
 * can read; `restricted` keeps even global assets super-admin-only.
 */
export type AssetVisibility =
  | "internal"
  | "customer_visible"
  | "public"
  | "restricted";

/** The kind of file an asset represents. */
export type AssetType =
  | "image"
  | "video"
  | "icon"
  | "pdf"
  | "document"
  | "attachment"
  | "other";

/** A derived rendition of an asset (never the authoritative record). */
export type AssetVariantType =
  | "micro"
  | "thumbnail"
  | "preview"
  | "poster"
  | "mobile"
  | "web_optimized"
  | "transcoded_720p"
  | "transcoded_1080p"
  | "pdf_preview_image"
  | "original"
  | "other";

/**
 * Known polymorphic placement entity types for {@link AssetLink}. The DB does
 * NOT constrain this (new placements need no migration); this union documents
 * the intended values while still allowing any string.
 */
export type AssetLinkEntityType =
  | "login_page"
  | "public_website_page"
  | "service"
  | "service_category"
  | "cleaning_protocol_template"
  | "cleaning_protocol_instance"
  | "protocol_room"
  | "protocol_section"
  | "protocol_task"
  | "customer"
  | "customer_card"
  | "work_order"
  | "work_order_service_row"
  | "case_ticket"
  | "company_library_folder"
  | (string & {});

/**
 * Known placement keys (the slot an asset fills on an entity). Open union — any
 * string is allowed; these document the intended slots.
 */
export type AssetPlacementKey =
  | "login_background"
  | "login_left_panel_video"
  | "login_left_panel_poster_image"
  | "homepage_hero_video"
  | "homepage_hero_image"
  | "features_page_hero_image"
  | "getting_started_hero_image"
  | "service_card_image"
  | "service_category_image"
  | "protocol_room_image"
  | "protocol_section_image"
  | "protocol_task_image"
  | "customer_cover_image"
  | "work_order_image"
  | "work_order_header_image"
  | "work_order_service_row_image"
  | (string & {});

/** Lifecycle/audit event types recorded in {@link AssetActivityEvent}. */
export type AssetActivityEventType =
  | "asset_uploaded"
  | "asset_updated"
  | "asset_archived"
  | "asset_restored"
  | "asset_deleted"
  | "asset_copied_from_global"
  | "asset_linked"
  | "asset_unlinked"
  | "asset_replaced"
  | "asset_visibility_changed"
  | "public_website_asset_changed"
  | "login_page_video_changed"
  | "customer_file_uploaded"
  | "customer_file_visibility_changed";

/** Top-level taxonomy bucket. Global when {@link AssetCategory.companyId} is null. */
export interface AssetCategory {
  /** App-facing id (== row `legacy_id`). */
  id: string;
  /** Owning company id (app-facing). Null = global system category. */
  companyId?: string | null;
  name: string;
  /** Stable machine key, e.g. `cleaning_protocols`, `website_public_pages`. */
  slug: string;
  description?: string | null;
  /** Icon name (lucide-react). */
  icon?: string | null;
  sortOrder: number;
  /** True for the seeded default categories (not user-deletable). */
  isSystem: boolean;
  metadata?: Record<string, unknown>;
  archivedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A hierarchical container. Global when {@link AssetFolder.companyId} is null. */
export interface AssetFolder {
  id: string;
  companyId?: string | null;
  categoryId?: string | null;
  categoryLegacyId?: string | null;
  parentFolderId?: string | null;
  parentFolderLegacyId?: string | null;
  name: string;
  slug?: string | null;
  description?: string | null;
  scope: AssetScope;
  sortOrder: number;
  isSystem: boolean;
  metadata?: Record<string, unknown>;
  createdBy?: string | null;
  updatedBy?: string | null;
  archivedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * The core asset/file record. A library asset (this record) is distinct from
 * where it is used (see {@link AssetLink}).
 */
export interface Asset {
  /** App-facing id (== row `legacy_id`). */
  id: string;
  /** Owning company (app-facing id). Null for global/website assets. */
  companyId?: string | null;
  /** Owning customer (app-facing id), when customer-scoped. */
  customerId?: string | null;
  folderId?: string | null;
  categoryId?: string | null;
  scope: AssetScope;
  visibility: AssetVisibility;
  assetType: AssetType;
  mimeType?: string | null;
  /** Internal/file name. */
  name: string;
  /** Human-friendly display title. */
  title?: string | null;
  description?: string | null;
  altText?: string | null;
  tags: string[];
  /** Storage location of the ORIGINAL object. */
  storageBucket?: AssetStorageBucket | null;
  storagePath?: string | null;
  /** Only set for PUBLIC assets — signed URLs are never persisted. */
  publicUrl?: string | null;
  thumbnailBucket?: AssetStorageBucket | null;
  thumbnailPath?: string | null;
  previewBucket?: AssetStorageBucket | null;
  previewPath?: string | null;
  /** For videos: the poster/fallback image asset id. */
  posterAssetId?: string | null;
  width?: number | null;
  height?: number | null;
  durationSeconds?: number | null;
  fileSize?: number | null;
  checksum?: string | null;
  /**
   * Audit reference to the asset this was copied from (independence is
   * preserved — no FK, so this survives deletion of the original).
   */
  copiedFromAssetId?: string | null;
  copiedFromAssetLegacyId?: string | null;
  sourceAssetId?: string | null;
  sourceAssetLegacyId?: string | null;
  metadata?: Record<string, unknown>;
  createdBy?: string | null;
  updatedBy?: string | null;
  archivedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A derived rendition (thumbnail/preview/poster/transcode/…) of an asset. */
export interface AssetVariant {
  id: string;
  assetId: string;
  companyId?: string | null;
  customerId?: string | null;
  scope: AssetScope;
  visibility: AssetVisibility;
  variantType: AssetVariantType;
  storageBucket?: AssetStorageBucket | null;
  storagePath?: string | null;
  publicUrl?: string | null;
  mimeType?: string | null;
  width?: number | null;
  height?: number | null;
  durationSeconds?: number | null;
  fileSize?: number | null;
  checksum?: string | null;
  metadata?: Record<string, unknown>;
  archivedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A polymorphic placement: an asset used at an entity's placement slot. */
export interface AssetLink {
  id: string;
  assetId: string;
  companyId?: string | null;
  customerId?: string | null;
  entityType: AssetLinkEntityType;
  /** Target entity id. Null for singletons (e.g. the login page). */
  entityId?: string | null;
  placementKey: AssetPlacementKey;
  scope: AssetScope;
  visibility: AssetVisibility;
  sortOrder: number;
  isActive: boolean;
  metadata?: Record<string, unknown>;
  createdBy?: string | null;
  archivedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Audit record of an independent global→company copy. */
export interface AssetCopyHistory {
  id: string;
  sourceAssetId?: string | null;
  sourceAssetLegacyId?: string | null;
  sourceScope?: AssetScope | null;
  copiedAssetId?: string | null;
  copiedAssetLegacyId?: string | null;
  targetCompanyId?: string | null;
  targetCompanyLegacyId?: string | null;
  copiedBy?: string | null;
  note?: string | null;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

/** An append-only lifecycle/audit event. */
export interface AssetActivityEvent {
  id: string;
  eventType: AssetActivityEventType;
  assetId?: string | null;
  companyId?: string | null;
  customerId?: string | null;
  actorUserId?: string | null;
  actorRole?: string | null;
  scope?: AssetScope | null;
  visibility?: AssetVisibility | null;
  summary?: string | null;
  metadata?: Record<string, unknown>;
  createdAt: string;
}
