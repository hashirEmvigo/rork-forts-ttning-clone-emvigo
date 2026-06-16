/**
 * Asset Center — Supabase-authoritative repository (Phase 1 foundation).
 *
 * The data-access boundary for the unified Asset Center (migrations 0055/0056).
 * Every read/write goes DIRECTLY to Supabase — there is NO localStorage
 * authority and NO browser-domain mirror on this path. The legacy media path
 * (src/lib/mediaStore.ts + media_assets) is untouched; this layer lives beside
 * it until later migration phases.
 *
 * Scope of Phase 1 = basic CRUD-ish operations only:
 *   • list / get assets (by scope / company / customer / category / folder / …)
 *   • create / update / archive / soft-delete asset metadata
 *   • create / archive asset links; list links/usages
 *   • create asset variant metadata; list variants
 *   • list asset categories / folders
 *   • record asset copy history + activity events
 *
 * Removal is archive (`archivedAt`) or soft-delete (`deletedAt`); there is no
 * hard delete here (and no DELETE RLS policy server-side).
 */
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import { makeId } from "@/lib/store";
import type {
  Asset,
  AssetActivityEvent,
  AssetActivityEventType,
  AssetCategory,
  AssetCopyHistory,
  AssetFolder,
  AssetLink,
  AssetLinkEntityType,
  AssetPlacementKey,
  AssetScope,
  AssetStorageBucket,
  AssetType,
  AssetVariant,
  AssetVariantType,
  AssetVisibility,
} from "./assetTypes";

class AssetSupabaseNotConfiguredError extends Error {
  constructor() {
    super(
      "Asset Center requires Supabase. Set EXPO_PUBLIC_SUPABASE_URL and " +
        "EXPO_PUBLIC_SUPABASE_ANON_KEY.",
    );
    this.name = "AssetSupabaseNotConfiguredError";
  }
}

function requireClient(): NonNullable<typeof supabase> {
  if (!isSupabaseConfigured || !supabase) throw new AssetSupabaseNotConfiguredError();
  return supabase;
}

function nowIso(): string {
  return new Date().toISOString();
}

// ── Column lists (snake_case, matching migration 0055) ──────────────────────
const ASSET_COLUMNS =
  "legacy_id, company_legacy_id, customer_legacy_id, folder_legacy_id, " +
  "category_legacy_id, scope, visibility, asset_type, mime_type, name, title, " +
  "description, alt_text, tags, storage_bucket, storage_path, public_url, " +
  "thumbnail_bucket, thumbnail_path, preview_bucket, preview_path, " +
  "poster_asset_id, width, height, duration_seconds, file_size, checksum, " +
  "copied_from_asset_id, copied_from_asset_legacy_id, source_asset_id, " +
  "source_asset_legacy_id, metadata, created_by, updated_by, archived_at, " +
  "deleted_at, created_at, updated_at";

const CATEGORY_COLUMNS =
  "legacy_id, company_legacy_id, name, slug, description, icon, sort_order, " +
  "is_system, metadata, archived_at, deleted_at, created_at, updated_at";

const FOLDER_COLUMNS =
  "legacy_id, company_legacy_id, category_legacy_id, parent_folder_legacy_id, " +
  "name, slug, description, scope, sort_order, is_system, metadata, created_by, " +
  "updated_by, archived_at, deleted_at, created_at, updated_at";

const VARIANT_COLUMNS =
  "legacy_id, asset_legacy_id, company_legacy_id, scope, visibility, " +
  "variant_type, storage_bucket, storage_path, public_url, mime_type, width, " +
  "height, duration_seconds, file_size, checksum, metadata, archived_at, " +
  "deleted_at, created_at, updated_at";

const LINK_COLUMNS =
  "legacy_id, asset_legacy_id, company_legacy_id, entity_type, entity_id, " +
  "placement_key, scope, visibility, sort_order, is_active, metadata, " +
  "created_by, archived_at, deleted_at, created_at, updated_at";

// ── Row shapes (only the fields we read back) ───────────────────────────────
type Row = Record<string, unknown>;

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}
function num(v: unknown): number | null {
  return typeof v === "number" ? v : v == null ? null : Number(v);
}
function bool(v: unknown): boolean {
  return v === true;
}
function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}
function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

// ── Row → domain mappers ────────────────────────────────────────────────────
function rowToAsset(r: Row): Asset {
  return {
    id: String(r.legacy_id),
    companyId: str(r.company_legacy_id),
    customerId: str(r.customer_legacy_id),
    folderId: str(r.folder_legacy_id),
    categoryId: str(r.category_legacy_id),
    scope: String(r.scope) as AssetScope,
    visibility: String(r.visibility) as AssetVisibility,
    assetType: String(r.asset_type) as AssetType,
    mimeType: str(r.mime_type),
    name: String(r.name),
    title: str(r.title),
    description: str(r.description),
    altText: str(r.alt_text),
    tags: strArr(r.tags),
    storageBucket: str(r.storage_bucket) as AssetStorageBucket | null,
    storagePath: str(r.storage_path),
    publicUrl: str(r.public_url),
    thumbnailBucket: str(r.thumbnail_bucket) as AssetStorageBucket | null,
    thumbnailPath: str(r.thumbnail_path),
    previewBucket: str(r.preview_bucket) as AssetStorageBucket | null,
    previewPath: str(r.preview_path),
    posterAssetId: str(r.poster_asset_id),
    width: num(r.width),
    height: num(r.height),
    durationSeconds: num(r.duration_seconds),
    fileSize: num(r.file_size),
    checksum: str(r.checksum),
    copiedFromAssetId: str(r.copied_from_asset_id),
    copiedFromAssetLegacyId: str(r.copied_from_asset_legacy_id),
    sourceAssetId: str(r.source_asset_id),
    sourceAssetLegacyId: str(r.source_asset_legacy_id),
    metadata: obj(r.metadata),
    createdBy: str(r.created_by),
    updatedBy: str(r.updated_by),
    archivedAt: str(r.archived_at),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

function rowToCategory(r: Row): AssetCategory {
  return {
    id: String(r.legacy_id),
    companyId: str(r.company_legacy_id),
    name: String(r.name),
    slug: String(r.slug),
    description: str(r.description),
    icon: str(r.icon),
    sortOrder: num(r.sort_order) ?? 0,
    isSystem: bool(r.is_system),
    metadata: obj(r.metadata),
    archivedAt: str(r.archived_at),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

function rowToFolder(r: Row): AssetFolder {
  return {
    id: String(r.legacy_id),
    companyId: str(r.company_legacy_id),
    categoryId: str(r.category_legacy_id),
    categoryLegacyId: str(r.category_legacy_id),
    parentFolderId: str(r.parent_folder_legacy_id),
    parentFolderLegacyId: str(r.parent_folder_legacy_id),
    name: String(r.name),
    slug: str(r.slug),
    description: str(r.description),
    scope: String(r.scope) as AssetScope,
    sortOrder: num(r.sort_order) ?? 0,
    isSystem: bool(r.is_system),
    metadata: obj(r.metadata),
    createdBy: str(r.created_by),
    updatedBy: str(r.updated_by),
    archivedAt: str(r.archived_at),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

function rowToVariant(r: Row): AssetVariant {
  return {
    id: String(r.legacy_id),
    assetId: String(r.asset_legacy_id),
    companyId: str(r.company_legacy_id),
    scope: String(r.scope) as AssetScope,
    visibility: String(r.visibility) as AssetVisibility,
    variantType: String(r.variant_type) as AssetVariantType,
    storageBucket: str(r.storage_bucket) as AssetStorageBucket | null,
    storagePath: str(r.storage_path),
    publicUrl: str(r.public_url),
    mimeType: str(r.mime_type),
    width: num(r.width),
    height: num(r.height),
    durationSeconds: num(r.duration_seconds),
    fileSize: num(r.file_size),
    checksum: str(r.checksum),
    metadata: obj(r.metadata),
    archivedAt: str(r.archived_at),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

function rowToLink(r: Row): AssetLink {
  return {
    id: String(r.legacy_id),
    assetId: String(r.asset_legacy_id),
    companyId: str(r.company_legacy_id),
    entityType: String(r.entity_type) as AssetLinkEntityType,
    entityId: str(r.entity_id),
    placementKey: String(r.placement_key) as AssetPlacementKey,
    scope: String(r.scope) as AssetScope,
    visibility: String(r.visibility) as AssetVisibility,
    sortOrder: num(r.sort_order) ?? 0,
    isActive: bool(r.is_active),
    metadata: obj(r.metadata),
    createdBy: str(r.created_by),
    archivedAt: str(r.archived_at),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

// ── Reads ───────────────────────────────────────────────────────────────────

/** Filters for {@link listAssets}. Soft-deleted rows are always excluded. */
export interface ListAssetsQuery {
  scope?: AssetScope;
  companyId?: string | null;
  customerId?: string | null;
  categoryId?: string | null;
  folderId?: string | null;
  visibility?: AssetVisibility;
  assetType?: AssetType;
  /** When true, include archived (archivedAt set) assets. Default false. */
  includeArchived?: boolean;
}

/** Lists non-deleted assets matching the given scope/company/etc. filters. */
export async function listAssets(query: ListAssetsQuery = {}): Promise<Asset[]> {
  const client = requireClient();
  const stop = perf.start("assets.list.supabase");
  try {
    let q = client.from("assets").select(ASSET_COLUMNS).is("deleted_at", null);
    if (query.scope !== undefined) q = q.eq("scope", query.scope);
    if (query.companyId !== undefined) q = q.eq("company_legacy_id", query.companyId);
    if (query.customerId !== undefined) q = q.eq("customer_legacy_id", query.customerId);
    if (query.categoryId !== undefined) q = q.eq("category_legacy_id", query.categoryId);
    if (query.folderId !== undefined) q = q.eq("folder_legacy_id", query.folderId);
    if (query.visibility !== undefined) q = q.eq("visibility", query.visibility);
    if (query.assetType !== undefined) q = q.eq("asset_type", query.assetType);
    const { data, error } = await q;
    if (error) throw new Error(`[assets] list failed: ${error.message}`);
    let rows = (data ?? []) as unknown as Row[];
    if (!query.includeArchived) rows = rows.filter((r) => !r.archived_at);
    return rows.map(rowToAsset);
  } finally {
    stop();
  }
}

/** Looks up a single non-deleted asset by its app-facing id. Null if absent. */
export async function getAssetById(id: string): Promise<Asset | null> {
  const client = requireClient();
  const stop = perf.start("assets.get.supabase");
  try {
    const { data, error } = await client
      .from("assets")
      .select(ASSET_COLUMNS)
      .eq("legacy_id", id)
      .is("deleted_at", null);
    if (error) throw new Error(`[assets] get failed: ${error.message}`);
    const rows = (data ?? []) as unknown as Row[];
    return rows.length > 0 ? rowToAsset(rows[0]) : null;
  } finally {
    stop();
  }
}

/** Lists asset categories. Pass `companyId` for company taxonomy, omit for global. */
export async function listAssetCategories(
  companyId?: string | null,
): Promise<AssetCategory[]> {
  const client = requireClient();
  const stop = perf.start("assetCategories.list.supabase");
  try {
    let q = client.from("asset_categories").select(CATEGORY_COLUMNS).is("deleted_at", null);
    if (companyId !== undefined) q = q.eq("company_legacy_id", companyId);
    const { data, error } = await q;
    if (error) throw new Error(`[asset_categories] list failed: ${error.message}`);
    return ((data ?? []) as unknown as Row[]).map(rowToCategory);
  } finally {
    stop();
  }
}

/** Filters for {@link listAssetFolders}. */
export interface ListFoldersQuery {
  companyId?: string | null;
  categoryId?: string | null;
  parentFolderId?: string | null;
}

/** Lists non-deleted folders matching the given scope filters. */
export async function listAssetFolders(
  query: ListFoldersQuery = {},
): Promise<AssetFolder[]> {
  const client = requireClient();
  const stop = perf.start("assetFolders.list.supabase");
  try {
    let q = client.from("asset_folders").select(FOLDER_COLUMNS).is("deleted_at", null);
    if (query.companyId !== undefined) q = q.eq("company_legacy_id", query.companyId);
    if (query.categoryId !== undefined) q = q.eq("category_legacy_id", query.categoryId);
    if (query.parentFolderId !== undefined) {
      q = q.eq("parent_folder_legacy_id", query.parentFolderId);
    }
    const { data, error } = await q;
    if (error) throw new Error(`[asset_folders] list failed: ${error.message}`);
    return ((data ?? []) as unknown as Row[]).map(rowToFolder);
  } finally {
    stop();
  }
}

/** Filters for {@link listAssetLinks}. */
export interface ListLinksQuery {
  assetId?: string;
  entityType?: AssetLinkEntityType;
  entityId?: string | null;
  placementKey?: AssetPlacementKey;
  companyId?: string | null;
  /** When true, include inactive links. Default false (active only). */
  includeInactive?: boolean;
}

/** Lists non-deleted asset links/usages. */
export async function listAssetLinks(query: ListLinksQuery = {}): Promise<AssetLink[]> {
  const client = requireClient();
  const stop = perf.start("assetLinks.list.supabase");
  try {
    let q = client.from("asset_links").select(LINK_COLUMNS).is("deleted_at", null);
    if (query.assetId !== undefined) q = q.eq("asset_legacy_id", query.assetId);
    if (query.entityType !== undefined) q = q.eq("entity_type", query.entityType);
    if (query.entityId !== undefined) q = q.eq("entity_id", query.entityId);
    if (query.placementKey !== undefined) q = q.eq("placement_key", query.placementKey);
    if (query.companyId !== undefined) q = q.eq("company_legacy_id", query.companyId);
    const { data, error } = await q;
    if (error) throw new Error(`[asset_links] list failed: ${error.message}`);
    let rows = (data ?? []) as unknown as Row[];
    if (!query.includeInactive) rows = rows.filter((r) => r.is_active === true);
    return rows.map(rowToLink);
  } finally {
    stop();
  }
}

/** Lists non-deleted variants of an asset. */
export async function listAssetVariants(assetId: string): Promise<AssetVariant[]> {
  const client = requireClient();
  const stop = perf.start("assetVariants.list.supabase");
  try {
    const { data, error } = await client
      .from("asset_variants")
      .select(VARIANT_COLUMNS)
      .eq("asset_legacy_id", assetId)
      .is("deleted_at", null);
    if (error) throw new Error(`[asset_variants] list failed: ${error.message}`);
    return ((data ?? []) as unknown as Row[]).map(rowToVariant);
  } finally {
    stop();
  }
}

// ── Writes ───────────────────────────────────────────────────────────────────

/** Fields for creating an asset. Server-managed fields are filled here. */
export interface CreateAssetInput {
  companyId?: string | null;
  companyUuid?: string | null;
  customerId?: string | null;
  customerUuid?: string | null;
  folderId?: string | null;
  categoryId?: string | null;
  scope: AssetScope;
  visibility?: AssetVisibility;
  assetType: AssetType;
  mimeType?: string | null;
  name: string;
  title?: string | null;
  description?: string | null;
  altText?: string | null;
  tags?: string[];
  storageBucket?: AssetStorageBucket | null;
  storagePath?: string | null;
  publicUrl?: string | null;
  thumbnailBucket?: AssetStorageBucket | null;
  thumbnailPath?: string | null;
  previewBucket?: AssetStorageBucket | null;
  previewPath?: string | null;
  posterAssetId?: string | null;
  width?: number | null;
  height?: number | null;
  durationSeconds?: number | null;
  fileSize?: number | null;
  checksum?: string | null;
  copiedFromAssetId?: string | null;
  copiedFromAssetLegacyId?: string | null;
  sourceAssetId?: string | null;
  sourceAssetLegacyId?: string | null;
  metadata?: Record<string, unknown>;
  createdBy?: string | null;
  /** Override the generated app-facing id (otherwise `makeId("asset")`). */
  id?: string;
}

/**
 * Creates an asset metadata record. The DB row's real FK `company_id` UUID is
 * required by RLS for company-scoped writes — pass `companyUuid` (resolve via
 * the company legacy→uuid map). Global/website assets pass no company.
 */
export async function createAsset(input: CreateAssetInput): Promise<Asset> {
  const client = requireClient();
  const stop = perf.start("assets.create.supabase");
  try {
    const legacyId = input.id ?? makeId("asset");
    const row: Row = {
      legacy_id: legacyId,
      company_id: input.companyUuid ?? null,
      company_legacy_id: input.companyId ?? null,
      customer_id: input.customerUuid ?? null,
      customer_legacy_id: input.customerId ?? null,
      folder_legacy_id: input.folderId ?? null,
      category_legacy_id: input.categoryId ?? null,
      scope: input.scope,
      visibility: input.visibility ?? "internal",
      asset_type: input.assetType,
      mime_type: input.mimeType ?? null,
      name: input.name,
      title: input.title ?? null,
      description: input.description ?? null,
      alt_text: input.altText ?? null,
      tags: input.tags ?? [],
      storage_bucket: input.storageBucket ?? null,
      storage_path: input.storagePath ?? null,
      public_url: input.publicUrl ?? null,
      thumbnail_bucket: input.thumbnailBucket ?? null,
      thumbnail_path: input.thumbnailPath ?? null,
      preview_bucket: input.previewBucket ?? null,
      preview_path: input.previewPath ?? null,
      poster_asset_id: input.posterAssetId ?? null,
      width: input.width ?? null,
      height: input.height ?? null,
      duration_seconds: input.durationSeconds ?? null,
      file_size: input.fileSize ?? null,
      checksum: input.checksum ?? null,
      copied_from_asset_id: input.copiedFromAssetId ?? null,
      copied_from_asset_legacy_id: input.copiedFromAssetLegacyId ?? null,
      source_asset_id: input.sourceAssetId ?? null,
      source_asset_legacy_id: input.sourceAssetLegacyId ?? null,
      metadata: input.metadata ?? {},
      created_by: input.createdBy ?? null,
      updated_by: input.createdBy ?? null,
      deleted_at: null,
    };
    const { data, error } = await client
      .from("assets")
      .insert(row)
      .select(ASSET_COLUMNS)
      .single();
    if (error) throw new Error(`[assets] create failed: ${error.message}`);
    if (!data) throw new Error("[assets] create returned no row.");
    return rowToAsset(data as unknown as Row);
  } finally {
    stop();
  }
}

/** Mutable asset metadata fields. Omitted fields are left unchanged. */
export interface UpdateAssetInput {
  folderId?: string | null;
  categoryId?: string | null;
  /**
   * Ownership/exposure boundary. Changing it is RLS-checked against BOTH the old
   * and new row (e.g. customer_internal → customer_visible is allowed for a
   * company admin; the new scope must still be company-manageable).
   */
  scope?: AssetScope;
  visibility?: AssetVisibility;
  name?: string;
  title?: string | null;
  description?: string | null;
  altText?: string | null;
  tags?: string[];
  posterAssetId?: string | null;
  metadata?: Record<string, unknown>;
  updatedBy?: string | null;
}

/**
 * Updates an existing, non-deleted asset's metadata. Scoped to
 * `legacy_id` + `deleted_at is null`; rejects when it affects 0 rows (not found
 * / already deleted / RLS-blocked) — never a silent no-op.
 */
export async function updateAsset(id: string, input: UpdateAssetInput): Promise<Asset> {
  const client = requireClient();
  const stop = perf.start("assets.update.supabase");
  try {
    const patch: Row = {};
    if (input.folderId !== undefined) patch.folder_legacy_id = input.folderId;
    if (input.categoryId !== undefined) patch.category_legacy_id = input.categoryId;
    if (input.scope !== undefined) patch.scope = input.scope;
    if (input.visibility !== undefined) patch.visibility = input.visibility;
    if (input.name !== undefined) patch.name = input.name;
    if (input.title !== undefined) patch.title = input.title;
    if (input.description !== undefined) patch.description = input.description;
    if (input.altText !== undefined) patch.alt_text = input.altText;
    if (input.tags !== undefined) patch.tags = input.tags;
    if (input.posterAssetId !== undefined) patch.poster_asset_id = input.posterAssetId;
    if (input.metadata !== undefined) patch.metadata = input.metadata;
    if (input.updatedBy !== undefined) patch.updated_by = input.updatedBy;

    const { data, error } = await client
      .from("assets")
      .update(patch)
      .eq("legacy_id", id)
      .is("deleted_at", null)
      .select(ASSET_COLUMNS);
    if (error) throw new Error(`[assets] update failed: ${error.message}`);
    const rows = (data ?? []) as unknown as Row[];
    if (rows.length === 0) {
      throw new Error(
        "[assets] update affected 0 rows — the asset was not found or you don't " +
          "have permission to change it.",
      );
    }
    return rowToAsset(rows[0]);
  } finally {
    stop();
  }
}

/**
 * Archives an asset (sets `archived_at`). Reversible via {@link restoreAsset}.
 * Rejects when it affects 0 rows.
 */
export async function archiveAsset(id: string): Promise<void> {
  await setAssetArchivedAt(id, nowIso(), "archive");
}

/** Restores a previously-archived asset (clears `archived_at`). */
export async function restoreAsset(id: string): Promise<void> {
  await setAssetArchivedAt(id, null, "restore");
}

async function setAssetArchivedAt(
  id: string,
  value: string | null,
  label: string,
): Promise<void> {
  const client = requireClient();
  const stop = perf.start(`assets.${label}.supabase`);
  try {
    const { data, error } = await client
      .from("assets")
      .update({ archived_at: value })
      .eq("legacy_id", id)
      .is("deleted_at", null)
      .select("legacy_id");
    if (error) throw new Error(`[assets] ${label} failed: ${error.message}`);
    const rows = (data ?? []) as unknown as Row[];
    if (rows.length === 0) {
      throw new Error(
        `[assets] ${label} affected 0 rows — the asset was not found or you don't ` +
          "have permission to change it.",
      );
    }
  } finally {
    stop();
  }
}

/**
 * Soft-deletes an asset (sets `deleted_at`), scoped to `deleted_at is null` so a
 * repeated delete is a confirmed no-op (rejects) rather than a false success.
 */
export async function softDeleteAsset(id: string): Promise<void> {
  const client = requireClient();
  const stop = perf.start("assets.softDelete.supabase");
  try {
    const { data, error } = await client
      .from("assets")
      .update({ deleted_at: nowIso() })
      .eq("legacy_id", id)
      .is("deleted_at", null)
      .select("legacy_id");
    if (error) throw new Error(`[assets] delete failed: ${error.message}`);
    const rows = (data ?? []) as unknown as Row[];
    if (rows.length === 0) {
      throw new Error(
        "[assets] delete affected 0 rows — the asset was not found or you don't " +
          "have permission to delete it.",
      );
    }
  } finally {
    stop();
  }
}

/** Fields for creating an asset link/placement. */
export interface CreateAssetLinkInput {
  assetId: string;
  companyId?: string | null;
  companyUuid?: string | null;
  entityType: AssetLinkEntityType;
  entityId?: string | null;
  placementKey: AssetPlacementKey;
  scope: AssetScope;
  visibility?: AssetVisibility;
  sortOrder?: number;
  metadata?: Record<string, unknown>;
  createdBy?: string | null;
  id?: string;
}

/**
 * Creates an asset link (a placement/usage).
 *
 * `asset_links.asset_id` is a NOT NULL uuid FK to `assets(id)`, but callers only
 * know the asset's app-facing id (`legacy_id`). We therefore resolve the real
 * uuid (and denormalise `customer_id`) from the asset row here before inserting.
 * Without this the insert fails with `null value in column "asset_id" of
 * relation "asset_links" violates not-null constraint`.
 */
export async function createAssetLink(input: CreateAssetLinkInput): Promise<AssetLink> {
  const client = requireClient();
  const stop = perf.start("assetLinks.create.supabase");
  try {
    const { data: assetRow, error: lookupError } = await client
      .from("assets")
      .select("id, customer_id")
      .eq("legacy_id", input.assetId)
      .is("deleted_at", null)
      .maybeSingle();
    if (lookupError) {
      throw new Error(`[asset_links] asset lookup failed: ${lookupError.message}`);
    }
    const resolved = (assetRow ?? null) as { id?: unknown; customer_id?: unknown } | null;
    const assetUuid = typeof resolved?.id === "string" ? resolved.id : null;
    if (!assetUuid) {
      throw new Error(
        `[asset_links] create failed: asset "${input.assetId}" was not found ` +
          "(or is not readable), so it cannot be linked.",
      );
    }
    const customerUuid = typeof resolved?.customer_id === "string" ? resolved.customer_id : null;

    const legacyId = input.id ?? makeId("asset_link");
    const row: Row = {
      legacy_id: legacyId,
      asset_id: assetUuid,
      asset_legacy_id: input.assetId,
      company_id: input.companyUuid ?? null,
      company_legacy_id: input.companyId ?? null,
      customer_id: customerUuid,
      entity_type: input.entityType,
      entity_id: input.entityId ?? null,
      placement_key: input.placementKey,
      scope: input.scope,
      visibility: input.visibility ?? "internal",
      sort_order: input.sortOrder ?? 0,
      is_active: true,
      metadata: input.metadata ?? {},
      created_by: input.createdBy ?? null,
      deleted_at: null,
    };
    const { data, error } = await client
      .from("asset_links")
      .insert(row)
      .select(LINK_COLUMNS)
      .single();
    if (error) throw new Error(`[asset_links] create failed: ${error.message}`);
    if (!data) throw new Error("[asset_links] create returned no row.");
    return rowToLink(data as unknown as Row);
  } finally {
    stop();
  }
}

/**
 * Archives (soft-deletes) an asset link — only the placement is removed; the
 * asset itself is untouched. Rejects when it affects 0 rows.
 */
export async function archiveAssetLink(id: string): Promise<void> {
  const client = requireClient();
  const stop = perf.start("assetLinks.archive.supabase");
  try {
    const { data, error } = await client
      .from("asset_links")
      .update({ deleted_at: nowIso(), is_active: false })
      .eq("legacy_id", id)
      .is("deleted_at", null)
      .select("legacy_id");
    if (error) throw new Error(`[asset_links] archive failed: ${error.message}`);
    const rows = (data ?? []) as unknown as Row[];
    if (rows.length === 0) {
      throw new Error(
        "[asset_links] archive affected 0 rows — the link was not found or you " +
          "don't have permission to change it.",
      );
    }
  } finally {
    stop();
  }
}

/** Mutable asset-link fields. Omitted fields are left unchanged. */
export interface UpdateAssetLinkInput {
  /** Ordering within a placement area (lower appears first). */
  sortOrder?: number;
  /**
   * Full replacement metadata object (callers merge before passing). Used e.g.
   * to persist `visibleToEmployee` on work-order placements.
   */
  metadata?: Record<string, unknown>;
  scope?: AssetScope;
  visibility?: AssetVisibility;
  isActive?: boolean;
}

/**
 * Updates a non-deleted asset link's placement fields (sort order / metadata /
 * scope / visibility). Scoped to `legacy_id` + `deleted_at is null`; rejects
 * when it affects 0 rows (not found / already deleted / RLS-blocked) — never a
 * silent no-op. The linked asset is never touched.
 */
export async function updateAssetLink(
  id: string,
  input: UpdateAssetLinkInput,
): Promise<AssetLink> {
  const client = requireClient();
  const stop = perf.start("assetLinks.update.supabase");
  try {
    const patch: Row = {};
    if (input.sortOrder !== undefined) patch.sort_order = input.sortOrder;
    if (input.metadata !== undefined) patch.metadata = input.metadata;
    if (input.scope !== undefined) patch.scope = input.scope;
    if (input.visibility !== undefined) patch.visibility = input.visibility;
    if (input.isActive !== undefined) patch.is_active = input.isActive;

    const { data, error } = await client
      .from("asset_links")
      .update(patch)
      .eq("legacy_id", id)
      .is("deleted_at", null)
      .select(LINK_COLUMNS);
    if (error) throw new Error(`[asset_links] update failed: ${error.message}`);
    const rows = (data ?? []) as unknown as Row[];
    if (rows.length === 0) {
      throw new Error(
        "[asset_links] update affected 0 rows — the link was not found or you " +
          "don't have permission to change it.",
      );
    }
    return rowToLink(rows[0]);
  } finally {
    stop();
  }
}

/** Fields for creating an asset variant (a derived rendition). */
export interface CreateAssetVariantInput {
  assetId: string;
  companyId?: string | null;
  companyUuid?: string | null;
  scope: AssetScope;
  visibility?: AssetVisibility;
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
  id?: string;
}

/** Creates an asset variant metadata record. */
export async function createAssetVariant(
  input: CreateAssetVariantInput,
): Promise<AssetVariant> {
  const client = requireClient();
  const stop = perf.start("assetVariants.create.supabase");
  try {
    const legacyId = input.id ?? makeId("asset_variant");
    const row: Row = {
      legacy_id: legacyId,
      asset_legacy_id: input.assetId,
      company_id: input.companyUuid ?? null,
      company_legacy_id: input.companyId ?? null,
      scope: input.scope,
      visibility: input.visibility ?? "internal",
      variant_type: input.variantType,
      storage_bucket: input.storageBucket ?? null,
      storage_path: input.storagePath ?? null,
      public_url: input.publicUrl ?? null,
      mime_type: input.mimeType ?? null,
      width: input.width ?? null,
      height: input.height ?? null,
      duration_seconds: input.durationSeconds ?? null,
      file_size: input.fileSize ?? null,
      checksum: input.checksum ?? null,
      metadata: input.metadata ?? {},
      deleted_at: null,
    };
    const { data, error } = await client
      .from("asset_variants")
      .insert(row)
      .select(VARIANT_COLUMNS)
      .single();
    if (error) throw new Error(`[asset_variants] create failed: ${error.message}`);
    if (!data) throw new Error("[asset_variants] create returned no row.");
    return rowToVariant(data as unknown as Row);
  } finally {
    stop();
  }
}

/** Fields for recording an independent global→company copy. */
export interface RecordCopyHistoryInput {
  sourceAssetId?: string | null;
  sourceAssetLegacyId?: string | null;
  sourceScope?: AssetScope | null;
  copiedAssetId?: string | null;
  copiedAssetLegacyId?: string | null;
  targetCompanyId?: string | null;
  targetCompanyUuid?: string | null;
  copiedBy?: string | null;
  note?: string | null;
  metadata?: Record<string, unknown>;
  id?: string;
}

/** Appends an asset copy-history record (the global→company copy audit). */
export async function recordAssetCopyHistory(
  input: RecordCopyHistoryInput,
): Promise<AssetCopyHistory> {
  const client = requireClient();
  const stop = perf.start("assetCopyHistory.create.supabase");
  try {
    const legacyId = input.id ?? makeId("asset_copy");
    const row: Row = {
      legacy_id: legacyId,
      source_asset_id: input.sourceAssetId ?? null,
      source_asset_legacy_id: input.sourceAssetLegacyId ?? null,
      source_scope: input.sourceScope ?? null,
      copied_asset_legacy_id: input.copiedAssetLegacyId ?? null,
      target_company_id: input.targetCompanyUuid ?? null,
      target_company_legacy_id: input.targetCompanyId ?? null,
      copied_by: input.copiedBy ?? null,
      note: input.note ?? null,
      metadata: input.metadata ?? {},
    };
    const { data, error } = await client
      .from("asset_copy_history")
      .insert(row)
      .select(
        "legacy_id, source_asset_id, source_asset_legacy_id, source_scope, " +
          "copied_asset_legacy_id, target_company_legacy_id, copied_by, note, " +
          "metadata, created_at",
      )
      .single();
    if (error) throw new Error(`[asset_copy_history] create failed: ${error.message}`);
    const r = (data ?? {}) as Row;
    return {
      id: String(r.legacy_id),
      sourceAssetId: str(r.source_asset_id),
      sourceAssetLegacyId: str(r.source_asset_legacy_id),
      sourceScope: str(r.source_scope) as AssetScope | null,
      copiedAssetLegacyId: str(r.copied_asset_legacy_id),
      targetCompanyId: str(r.target_company_legacy_id),
      copiedBy: str(r.copied_by),
      note: str(r.note),
      metadata: obj(r.metadata),
      createdAt: String(r.created_at),
    };
  } finally {
    stop();
  }
}

/** Fields for recording a lifecycle/audit event. */
export interface RecordActivityInput {
  eventType: AssetActivityEventType;
  assetId?: string | null;
  companyId?: string | null;
  companyUuid?: string | null;
  customerId?: string | null;
  actorUserId?: string | null;
  actorRole?: string | null;
  scope?: AssetScope | null;
  visibility?: AssetVisibility | null;
  summary?: string | null;
  metadata?: Record<string, unknown>;
  id?: string;
}

/** Appends an append-only asset activity/audit event. */
export async function recordAssetActivityEvent(
  input: RecordActivityInput,
): Promise<AssetActivityEvent> {
  const client = requireClient();
  const stop = perf.start("assetActivity.create.supabase");
  try {
    const legacyId = input.id ?? makeId("asset_event");
    const row: Row = {
      legacy_id: legacyId,
      event_type: input.eventType,
      asset_legacy_id: input.assetId ?? null,
      company_id: input.companyUuid ?? null,
      company_legacy_id: input.companyId ?? null,
      customer_legacy_id: input.customerId ?? null,
      actor_user_id: input.actorUserId ?? null,
      actor_role: input.actorRole ?? null,
      scope: input.scope ?? null,
      visibility: input.visibility ?? null,
      summary: input.summary ?? null,
      metadata: input.metadata ?? {},
    };
    const { data, error } = await client
      .from("asset_activity_events")
      .insert(row)
      .select(
        "legacy_id, event_type, asset_legacy_id, company_legacy_id, " +
          "customer_legacy_id, actor_user_id, actor_role, scope, visibility, " +
          "summary, metadata, created_at",
      )
      .single();
    if (error) throw new Error(`[asset_activity_events] create failed: ${error.message}`);
    const r = (data ?? {}) as Row;
    return {
      id: String(r.legacy_id),
      eventType: String(r.event_type) as AssetActivityEventType,
      assetId: str(r.asset_legacy_id),
      companyId: str(r.company_legacy_id),
      customerId: str(r.customer_legacy_id),
      actorUserId: str(r.actor_user_id),
      actorRole: str(r.actor_role),
      scope: str(r.scope) as AssetScope | null,
      visibility: str(r.visibility) as AssetVisibility | null,
      summary: str(r.summary),
      metadata: obj(r.metadata),
      createdAt: String(r.created_at),
    };
  } finally {
    stop();
  }
}

// Re-export the canonical Asset type so consumers (e.g. customerMedia) can import
// it from the repository module they already depend on.
export type { Asset } from "./assetTypes";
