/**
 * Asset Center — public surface (Phase 1 foundation).
 *
 * The Supabase-authoritative data/storage/permissions foundation for the future
 * unified Asset Center (migrations 0055 + 0056). Foundation-only: no UI is wired
 * onto this layer yet, and the legacy localStorage media path
 * (src/lib/mediaStore.ts + media_assets) remains operational beside it.
 */
export type {
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

export {
  listAssets,
  getAssetById,
  listAssetCategories,
  listAssetFolders,
  listAssetLinks,
  listAssetVariants,
  createAsset,
  updateAsset,
  archiveAsset,
  restoreAsset,
  softDeleteAsset,
  createAssetLink,
  updateAssetLink,
  archiveAssetLink,
  createAssetVariant,
  recordAssetCopyHistory,
  recordAssetActivityEvent,
  type ListAssetsQuery,
  type ListFoldersQuery,
  type ListLinksQuery,
  type CreateAssetInput,
  type UpdateAssetInput,
  type CreateAssetLinkInput,
  type UpdateAssetLinkInput,
  type CreateAssetVariantInput,
  type RecordCopyHistoryInput,
  type RecordActivityInput,
} from "./assetRepository";

export {
  PUBLIC_BUCKET,
  PRIVATE_BUCKET,
  MAX_ASSET_BYTES,
  bucketForScope,
  isPublicScope,
  validateAssetFile,
  buildPublicWebsitePath,
  buildGlobalPublicPath,
  buildGlobalInternalPath,
  buildCompanyLibraryPath,
  buildCompanyCustomerPath,
  buildCompanyProtocolPath,
  buildCompanyWorkOrderPath,
  uploadAssetObject,
  removeAssetObjects,
} from "./assetStorage";

export {
  DEFAULT_SIGNED_URL_TTL_SECONDS,
  resolvePublicUrl,
  createSignedUrl,
  createSignedUrls,
  resolveAssetUrl,
} from "./assetUrlResolver";

export {
  canReadAsset,
  canReadAssetRecord,
  canManageAsset,
  canCopyGlobalAsset,
  canPublishPublicAsset,
  type AssetViewerContext,
  type AssetAccessShape,
} from "./assetPermissions";

export {
  ASSET_ACTIVITY_EVENT_TYPES,
  safeRecordAssetActivity,
  logAssetUploaded,
  logAssetArchived,
  logAssetCopiedFromGlobal,
  logAssetLinked,
  logAssetVisibilityChanged,
} from "./assetAudit";

export {
  LOGIN_PAGE_ENTITY_TYPE,
  LOGIN_BACKGROUND_PLACEMENT,
  getLoginBackground,
  getLoginBackgroundLink,
  setLoginBackground,
  clearLoginBackground,
  type LoginBackground,
  type LoginBackgroundMediaType,
  type LoginBrandingActor,
} from "./loginBranding";

export {
  archiveCompanyAdminMediaAsset,
  canArchiveCompanyAdminMediaAsset,
  isCompanyOwnedLibraryAsset,
  isGlobalSourceAsset,
  listCompanyAdminGlobalLibraryAssets,
  listCompanyAdminMediaLibrary,
  listCompanyOwnedMediaAssets,
  listSelectableCompanyAdminMedia,
  resolveCompanyAdminMediaUrls,
  uploadCompanyMedia,
  type CompanyAdminMediaAvailability,
  type CompanyAdminMediaItem,
  type CompanyAdminMediaLibraryKind,
  type CompanyAdminMediaLibraryResult,
  type CompanyAdminMediaUrls,
  type ListCompanyAdminMediaLibraryOptions,
  type UploadCompanyMediaInput,
} from "./companyMediaLibrary";

export {
  PUBLIC_WEBSITE_ENTITY_TYPE,
  getWebsiteImagesForPage,
  listWebsiteImageLinks,
  setWebsiteImage,
  clearWebsiteImage,
  type WebsiteImage,
  type WebsiteImageTarget,
  type WebsiteImageryActor,
} from "./websiteImagery";
