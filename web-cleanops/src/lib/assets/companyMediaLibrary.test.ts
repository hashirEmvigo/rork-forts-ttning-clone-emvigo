/**
 * Company Admin Media Library foundation proof.
 *
 * Verifies the narrow MEDIA-003 boundary: Company Admin sees active global source
 * assets as read-only/selectable, can manage only own-company local assets, and
 * archived global assets are excluded from future selection unless explicitly
 * resolved as existing legacy references.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import { groupItemsByAssetCategory } from "./assetCategorySections";
import type { Asset } from "./assetTypes";

const mocks = vi.hoisted(() => ({
  loadCompanyUuidMap: vi.fn(),
  makeId: vi.fn(),
  createAsset: vi.fn(),
  getAssetById: vi.fn(),
  archiveAsset: vi.fn(),
  listAssets: vi.fn(),
  uploadAssetObject: vi.fn(),
  removeAssetObjects: vi.fn(),
  createSignedUrls: vi.fn(),
  resolvePublicUrl: vi.fn(),
  processImageFile: vi.fn(),
}));

vi.mock("@/lib/data/customerMigration", () => ({
  loadCompanyUuidMap: mocks.loadCompanyUuidMap,
}));

vi.mock("@/lib/store", () => ({ makeId: mocks.makeId }));

vi.mock("@/lib/mediaProcessing", () => ({ processImageFile: mocks.processImageFile }));

vi.mock("./assetRepository", () => ({
  createAsset: mocks.createAsset,
  getAssetById: mocks.getAssetById,
  archiveAsset: mocks.archiveAsset,
  listAssets: mocks.listAssets,
}));

vi.mock("./assetStorage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./assetStorage")>();
  return {
    ...actual,
    uploadAssetObject: mocks.uploadAssetObject,
    removeAssetObjects: mocks.removeAssetObjects,
  };
});

vi.mock("./assetUrlResolver", () => ({
  createSignedUrls: mocks.createSignedUrls,
  resolvePublicUrl: mocks.resolvePublicUrl,
}));

import {
  archiveCompanyAdminMediaAsset,
  canArchiveCompanyAdminMediaAsset,
  isCompanyOwnedLibraryAsset,
  isGlobalSourceAsset,
  listCompanyAdminGlobalLibraryAssets,
  listCompanyAdminMediaLibrary,
  listCompanyOwnedMediaAssets,
  listSelectableCompanyAdminMedia,
  uploadCompanyMedia,
} from "./companyMediaLibrary";

function dataUrl(): string {
  return "data:image/webp;base64,AAAA";
}

function processed() {
  return {
    micro: { layer: "micro" as const, url: dataUrl(), width: 72, height: 54, bytes: 1000 },
    hover: { layer: "hover" as const, url: dataUrl(), width: 400, height: 300, bytes: 4000 },
    preview: { layer: "preview" as const, url: dataUrl(), width: 1280, height: 960, bytes: 20000 },
    sourceWidth: 2000,
    sourceHeight: 1500,
    totalBytes: 25000,
  };
}

function asset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: "asset_1",
    companyId: null,
    customerId: null,
    folderId: null,
    categoryId: "asset_cat_general",
    scope: "global_internal",
    visibility: "internal",
    assetType: "image",
    mimeType: "image/png",
    name: "image.png",
    title: "Image",
    description: null,
    altText: null,
    tags: [],
    storageBucket: "private-assets",
    storagePath: "global/internal/asset_1/original.png",
    publicUrl: null,
    thumbnailBucket: "private-assets",
    thumbnailPath: "global/internal/asset_1/thumb.webp",
    previewBucket: "private-assets",
    previewPath: "global/internal/asset_1/preview.webp",
    posterAssetId: null,
    width: 1600,
    height: 900,
    durationSeconds: null,
    fileSize: 4096,
    checksum: null,
    copiedFromAssetId: null,
    copiedFromAssetLegacyId: null,
    sourceAssetId: null,
    sourceAssetLegacyId: null,
    metadata: {},
    createdBy: "usr_1",
    updatedBy: null,
    archivedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function file(name = "service.png", type = "image/png", size = 4096): File {
  return { name, type, size } as unknown as File;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadCompanyUuidMap.mockResolvedValue(new Map([["cmp_1", "uuid-company-1"]]));
  mocks.makeId.mockReturnValue("asset_new");
  mocks.createAsset.mockImplementation(async (input: Record<string, unknown>) =>
    asset({
      id: (input.id as string) ?? "asset_new",
      companyId: input.companyId as string,
      scope: input.scope as Asset["scope"],
      visibility: input.visibility as Asset["visibility"],
      categoryId: (input.categoryId as string | null) ?? null,
    }),
  );
  mocks.getAssetById.mockResolvedValue(null);
  mocks.archiveAsset.mockResolvedValue(undefined);
  mocks.listAssets.mockResolvedValue([]);
  mocks.uploadAssetObject.mockImplementation(async (input: { path: string }) => ({ path: input.path }));
  mocks.removeAssetObjects.mockResolvedValue(undefined);
  mocks.createSignedUrls.mockResolvedValue(new Map());
  mocks.resolvePublicUrl.mockImplementation(
    (_bucket: string, path: string) => `https://cdn.example/${path}`,
  );
  mocks.processImageFile.mockResolvedValue(processed());
});

describe("Company Admin media ownership helpers", () => {
  it("classifies Super Admin global source assets separately from company-owned local assets", () => {
    const global = asset({ id: "global", companyId: null, customerId: null, scope: "global_internal" });
    const website = asset({ id: "website", companyId: null, customerId: null, scope: "website_public", visibility: "public" });
    const local = asset({ id: "local", companyId: "cmp_1", customerId: null, scope: "company_internal" });
    const customer = asset({ id: "customer", companyId: "cmp_1", customerId: "cust_1", scope: "customer_internal" });

    expect(isGlobalSourceAsset(global)).toBe(true);
    expect(isGlobalSourceAsset(website)).toBe(true);
    expect(isGlobalSourceAsset(local)).toBe(false);
    expect(isCompanyOwnedLibraryAsset(local, "cmp_1")).toBe(true);
    expect(isCompanyOwnedLibraryAsset(customer, "cmp_1")).toBe(false);
  });

  it("allows Company Admin archive only for own-company local assets, never global originals", () => {
    const global = asset({ id: "global", companyId: null, scope: "global_internal" });
    const local = asset({ id: "local", companyId: "cmp_1", scope: "company_internal" });
    const foreign = asset({ id: "foreign", companyId: "cmp_2", scope: "company_internal" });
    const publicLocal = asset({ id: "public", companyId: "cmp_1", scope: "company_public", visibility: "public" });

    expect(canArchiveCompanyAdminMediaAsset("cmp_1", global)).toBe(false);
    expect(canArchiveCompanyAdminMediaAsset("cmp_1", local)).toBe(true);
    expect(canArchiveCompanyAdminMediaAsset("cmp_1", foreign)).toBe(false);
    expect(canArchiveCompanyAdminMediaAsset("cmp_1", publicLocal)).toBe(false);
  });
});

describe("listCompanyAdminGlobalLibraryAssets", () => {
  it("returns active global source assets and excludes archived globals from future selection", async () => {
    const active = asset({ id: "active_global", scope: "global_internal", createdAt: "2026-02-01T00:00:00.000Z" });
    const archived = asset({
      id: "archived_global",
      scope: "website_public",
      visibility: "public",
      archivedAt: "2026-03-01T00:00:00.000Z",
      createdAt: "2026-03-01T00:00:00.000Z",
    });
    const strayCompany = asset({ id: "stray_company", companyId: "cmp_1", scope: "company_internal" });

    mocks.listAssets.mockImplementation(async (query: { scope?: string }) => {
      if (query.scope === "global_internal") return [active, strayCompany];
      if (query.scope === "website_public") return [archived];
      return [];
    });

    const result = await listCompanyAdminGlobalLibraryAssets();

    expect(mocks.listAssets).toHaveBeenCalledWith({ scope: "global_internal", includeArchived: true });
    expect(mocks.listAssets).toHaveBeenCalledWith({ scope: "global_public", includeArchived: true });
    expect(mocks.listAssets).toHaveBeenCalledWith({ scope: "website_public", includeArchived: true });
    expect(result.map((item) => item.id)).toEqual(["active_global"]);
  });

  it("includes an archived global asset only when it is an explicit existing reference", async () => {
    const archived = asset({
      id: "archived_global",
      scope: "website_public",
      visibility: "public",
      archivedAt: "2026-03-01T00:00:00.000Z",
      createdAt: "2026-03-01T00:00:00.000Z",
    });
    mocks.listAssets.mockImplementation(async (query: { scope?: string }) =>
      query.scope === "website_public" ? [archived] : [],
    );

    const result = await listCompanyAdminGlobalLibraryAssets(["archived_global"]);

    expect(result.map((item) => item.id)).toEqual(["archived_global"]);
  });
});

describe("listCompanyOwnedMediaAssets", () => {
  it("returns only own-company local library assets and excludes customer media", async () => {
    mocks.listAssets.mockResolvedValueOnce([
      asset({ id: "local_service", companyId: "cmp_1", customerId: null, scope: "company_internal" }),
      asset({ id: "customer_media", companyId: "cmp_1", customerId: "cust_1", scope: "customer_internal" }),
      asset({ id: "foreign", companyId: "cmp_2", customerId: null, scope: "company_internal" }),
      asset({ id: "global", companyId: null, customerId: null, scope: "global_internal" }),
    ]);

    const result = await listCompanyOwnedMediaAssets({ companyId: "cmp_1" });

    expect(mocks.listAssets).toHaveBeenCalledWith({ companyId: "cmp_1", includeArchived: true });
    expect(result.map((item) => item.id)).toEqual(["local_service"]);
  });

  it("does not query unscoped when company id is blank", async () => {
    expect(await listCompanyOwnedMediaAssets({ companyId: "  " })).toEqual([]);
    expect(mocks.listAssets).not.toHaveBeenCalled();
  });
});

describe("listCompanyAdminMediaLibrary", () => {
  it("separates read-only global library from manageable company library", async () => {
    const activeGlobal = asset({
      id: "active_global",
      title: "Shared service image",
      scope: "website_public",
      visibility: "public",
      storageBucket: "public-assets",
      storagePath: "website/services/active_global/original.png",
      thumbnailPath: "website/services/active_global/thumb.webp",
      publicUrl: "https://cdn.example/service.png",
      createdAt: "2026-03-01T00:00:00.000Z",
    });
    const archivedGlobal = asset({
      id: "archived_global",
      title: "Legacy shared image",
      scope: "global_internal",
      archivedAt: "2026-02-01T00:00:00.000Z",
      createdAt: "2026-02-01T00:00:00.000Z",
    });
    const companyLocal = asset({
      id: "company_local",
      title: "Company local image",
      companyId: "cmp_1",
      scope: "company_internal",
      storagePath: "companies/uuid-company-1/library/company_local/original.png",
      thumbnailPath: "companies/uuid-company-1/library/company_local/thumb.webp",
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    mocks.listAssets.mockImplementation(async (query: { scope?: string; companyId?: string }) => {
      if (query.scope === "website_public") return [activeGlobal];
      if (query.scope === "global_internal") return [archivedGlobal];
      if (query.companyId === "cmp_1") return [companyLocal];
      return [];
    });
    mocks.createSignedUrls.mockResolvedValueOnce(
      new Map([
        [archivedGlobal.storagePath, "https://signed/legacy"],
        [archivedGlobal.thumbnailPath, "https://signed/legacy-thumb"],
        [companyLocal.storagePath, "https://signed/company"],
        [companyLocal.thumbnailPath, "https://signed/company-thumb"],
      ]),
    );

    const library = await listCompanyAdminMediaLibrary({
      companyId: "cmp_1",
      referencedGlobalAssetIds: ["archived_global"],
    });

    expect(library.globalItems).toHaveLength(2);
    expect(library.companyItems).toHaveLength(1);
    expect(library.globalItems.find((item) => item.asset.id === "active_global")).toMatchObject({
      library: "global_library",
      isReadOnly: true,
      canSelect: true,
      canArchive: false,
      availability: "selectable",
    });
    expect(library.globalItems.find((item) => item.asset.id === "archived_global")).toMatchObject({
      library: "global_library",
      isReadOnly: true,
      canSelect: false,
      canArchive: false,
      availability: "legacy_reference",
    });
    expect(library.companyItems[0]).toMatchObject({
      library: "company_library",
      isReadOnly: false,
      canSelect: true,
      canArchive: true,
      availability: "selectable",
    });
    expect(library.globalItems.find((item) => item.asset.id === "archived_global")?.urls?.fullUrl).toBe(
      "https://signed/legacy",
    );
  });

  it("returns only selectable active global and company assets for future pickers", async () => {
    const activeGlobal = asset({ id: "active_global", scope: "global_internal" });
    const archivedGlobal = asset({
      id: "archived_global",
      scope: "global_internal",
      archivedAt: "2026-02-01T00:00:00.000Z",
    });
    const companyLocal = asset({ id: "company_local", companyId: "cmp_1", scope: "company_internal" });

    mocks.listAssets.mockImplementation(async (query: { scope?: string; companyId?: string }) => {
      if (query.scope === "global_internal") return [activeGlobal, archivedGlobal];
      if (query.companyId === "cmp_1") return [companyLocal];
      return [];
    });

    const selectable = await listSelectableCompanyAdminMedia({
      companyId: "cmp_1",
      referencedGlobalAssetIds: ["archived_global"],
    });

    expect(selectable.map((item) => item.asset.id)).toEqual(["active_global", "company_local"]);
  });
});

describe("archiveCompanyAdminMediaAsset", () => {
  it("archives own-company local media", async () => {
    mocks.getAssetById.mockResolvedValueOnce(
      asset({ id: "company_local", companyId: "cmp_1", scope: "company_internal" }),
    );

    await archiveCompanyAdminMediaAsset("company_local", "cmp_1");

    expect(mocks.archiveAsset).toHaveBeenCalledWith("company_local");
  });

  it("rejects global Super Admin assets and foreign company assets", async () => {
    mocks.getAssetById.mockResolvedValueOnce(asset({ id: "global", companyId: null, scope: "global_internal" }));
    await expect(archiveCompanyAdminMediaAsset("global", "cmp_1")).rejects.toThrow(/company-owned local/i);
    expect(mocks.archiveAsset).not.toHaveBeenCalled();

    mocks.getAssetById.mockResolvedValueOnce(
      asset({ id: "foreign", companyId: "cmp_2", scope: "company_internal" }),
    );
    await expect(archiveCompanyAdminMediaAsset("foreign", "cmp_1")).rejects.toThrow(/company-owned local/i);
    expect(mocks.archiveAsset).not.toHaveBeenCalled();
  });
});

describe("uploadCompanyMedia", () => {
  it("uploads company-owned media as private company_internal assets with existing category metadata", async () => {
    await uploadCompanyMedia({
      companyId: "cmp_1",
      file: file(),
      title: "Service image",
      tags: ["service"],
      categoryId: "asset_cat_services",
      createdBy: "usr_admin",
    });

    expect(mocks.uploadAssetObject).toHaveBeenCalledTimes(3);
    expect(mocks.uploadAssetObject.mock.calls.map((call) => call[0].path)).toEqual([
      "companies/uuid-company-1/library/asset_new/original.png",
      "companies/uuid-company-1/library/asset_new/thumb.webp",
      "companies/uuid-company-1/library/asset_new/preview.webp",
    ]);
    for (const call of mocks.uploadAssetObject.mock.calls) {
      expect(call[0].bucket).toBe("private-assets");
    }

    expect(mocks.createAsset).toHaveBeenCalledTimes(1);
    expect(mocks.createAsset.mock.calls[0][0]).toMatchObject({
      id: "asset_new",
      companyId: "cmp_1",
      companyUuid: "uuid-company-1",
      scope: "company_internal",
      visibility: "internal",
      assetType: "image",
      title: "Service image",
      tags: ["service"],
      categoryId: "asset_cat_services",
      storageBucket: "private-assets",
      storagePath: "companies/uuid-company-1/library/asset_new/original.png",
      thumbnailPath: "companies/uuid-company-1/library/asset_new/thumb.webp",
      previewPath: "companies/uuid-company-1/library/asset_new/preview.webp",
      createdBy: "usr_admin",
    });
  });

  it("keeps company-owned assets compatible with the Media Center category grouping helper", async () => {
    const library = await listCompanyAdminMediaLibrary({ companyId: "cmp_1" });
    expect(library.companyItems).toEqual([]);

    const companyItems = [
      {
        asset: asset({ id: "service", companyId: "cmp_1", scope: "company_internal", categoryId: "asset_cat_services" }),
        urls: null,
        library: "company_library" as const,
        isReadOnly: false,
        isArchived: false,
        canSelect: true,
        canArchive: true,
        availability: "selectable" as const,
      },
      {
        asset: asset({ id: "fallback", companyId: "cmp_1", scope: "company_internal", categoryId: "unknown" }),
        urls: null,
        library: "company_library" as const,
        isReadOnly: false,
        isArchived: false,
        canSelect: true,
        canArchive: true,
        availability: "selectable" as const,
      },
    ];

    const groups = groupItemsByAssetCategory(companyItems);

    expect(groups.map((group) => group.section.label)).toEqual(["Services", "General folder"]);
    expect(groups.map((group) => group.items.map((item) => item.asset.id))).toEqual([
      ["service"],
      ["fallback"],
    ]);
  });

  it("cleans up uploaded objects when company media metadata creation fails", async () => {
    mocks.createAsset.mockRejectedValueOnce(new Error("rls denied"));

    await expect(uploadCompanyMedia({ companyId: "cmp_1", file: file() })).rejects.toThrow(/rls denied/);

    expect(mocks.removeAssetObjects).toHaveBeenCalledTimes(1);
    expect(mocks.removeAssetObjects.mock.calls[0][0]).toBe("private-assets");
    expect(mocks.removeAssetObjects.mock.calls[0][1]).toHaveLength(3);
  });
});
