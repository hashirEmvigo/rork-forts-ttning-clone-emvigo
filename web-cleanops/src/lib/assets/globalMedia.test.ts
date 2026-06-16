/**
 * Super Admin Media Center — Supabase-authoritative data layer (Phase 1) proof.
 *
 * Drives the global/website media orchestration against mocked repository /
 * storage / URL-resolver / image-pipeline seams, proving:
 *   • exposure mapping: "internal" → global_internal/internal/PRIVATE bucket;
 *     "public" → website_public/public/PUBLIC bucket;
 *   • the ORIGINAL file is always uploaded (library semantics) and images
 *     additionally derive a thumb + preview, while videos/PDFs/docs do not;
 *   • public assets persist a stable publicUrl; private assets do not;
 *   • a failed metadata write cleans up the just-uploaded objects;
 *   • list reads query ONLY the three global scopes (never company/customer
 *     media) and drop any company/customer-owned row defensively;
 *   • URL resolution uses public URLs for the public bucket and batch-signed
 *     URLs for the private bucket;
 *   • nothing here touches localStorage / mediaStore.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import type { Asset } from "./assetTypes";

const mocks = vi.hoisted(() => ({
  makeId: vi.fn(),
  createAsset: vi.fn(),
  updateAsset: vi.fn(),
  archiveAsset: vi.fn(),
  restoreAsset: vi.fn(),
  softDeleteAsset: vi.fn(),
  listAssets: vi.fn(),
  uploadAssetObject: vi.fn(),
  removeAssetObjects: vi.fn(),
  createSignedUrls: vi.fn(),
  resolvePublicUrl: vi.fn(),
  processImageFile: vi.fn(),
}));

vi.mock("@/lib/store", () => ({ makeId: mocks.makeId }));

vi.mock("@/lib/mediaProcessing", () => ({ processImageFile: mocks.processImageFile }));

vi.mock("./assetRepository", () => ({
  createAsset: mocks.createAsset,
  updateAsset: mocks.updateAsset,
  archiveAsset: mocks.archiveAsset,
  restoreAsset: mocks.restoreAsset,
  softDeleteAsset: mocks.softDeleteAsset,
  listAssets: mocks.listAssets,
}));

vi.mock("./assetUrlResolver", () => ({
  createSignedUrls: mocks.createSignedUrls,
  resolvePublicUrl: mocks.resolvePublicUrl,
}));

vi.mock("./assetStorage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./assetStorage")>();
  return {
    ...actual,
    uploadAssetObject: mocks.uploadAssetObject,
    removeAssetObjects: mocks.removeAssetObjects,
  };
});

import {
  archiveGlobalMedia,
  assetTypeForFile,
  deleteGlobalMedia,
  globalMediaPlacement,
  removeGlobalMediaFromLibrary,
  isPublicGlobalAsset,
  listGlobalMedia,
  resolveGlobalMediaUrls,
  restoreGlobalMedia,
  updateGlobalMediaMeta,
  uploadGlobalMedia,
} from "./globalMedia";

/** A minimal File-like object (only .name/.type/.size are read pre-mock). */
function fakeFile(name: string, type: string, size: number): File {
  return { name, type, size } as unknown as File;
}

function processed() {
  return {
    micro: { layer: "micro" as const, url: "data:image/webp;base64,AAAA", width: 72, height: 54, bytes: 1000 },
    hover: { layer: "hover" as const, url: "data:image/webp;base64,AAAA", width: 400, height: 300, bytes: 4000 },
    preview: { layer: "preview" as const, url: "data:image/webp;base64,AAAA", width: 1280, height: 960, bytes: 20000 },
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
    categoryId: null,
    scope: "global_internal",
    visibility: "internal",
    assetType: "image",
    mimeType: "image/png",
    name: "logo.png",
    title: null,
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
    width: 2000,
    height: 1500,
    durationSeconds: null,
    fileSize: 1234,
    checksum: null,
    copiedFromAssetId: null,
    copiedFromAssetLegacyId: null,
    sourceAssetId: null,
    sourceAssetLegacyId: null,
    metadata: {},
    createdBy: "usr_sa",
    updatedBy: null,
    archivedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.makeId.mockReturnValue("asset_new");
  mocks.createAsset.mockImplementation(async (input: Record<string, unknown>) => ({
    ...asset(),
    id: (input.id as string) ?? "asset_new",
  }));
  mocks.updateAsset.mockResolvedValue(asset());
  mocks.archiveAsset.mockResolvedValue(undefined);
  mocks.restoreAsset.mockResolvedValue(undefined);
  mocks.softDeleteAsset.mockResolvedValue(undefined);
  mocks.listAssets.mockResolvedValue([]);
  mocks.uploadAssetObject.mockImplementation(async (i: { path: string }) => ({ path: i.path }));
  mocks.removeAssetObjects.mockResolvedValue(undefined);
  mocks.createSignedUrls.mockResolvedValue(new Map());
  mocks.resolvePublicUrl.mockImplementation(
    (_bucket: string, path: string) => `https://cdn.example/${path}`,
  );
  mocks.processImageFile.mockResolvedValue(processed());
});

describe("globalMediaPlacement", () => {
  it("maps internal to the private global library and public to the public website bucket", () => {
    expect(globalMediaPlacement("internal")).toEqual({
      scope: "global_internal",
      visibility: "internal",
      bucket: "private-assets",
    });
    expect(globalMediaPlacement("public")).toEqual({
      scope: "website_public",
      visibility: "public",
      bucket: "public-assets",
    });
  });
});

describe("isPublicGlobalAsset", () => {
  it("derives the public flag from visibility", () => {
    expect(isPublicGlobalAsset({ visibility: "public" })).toBe(true);
    expect(isPublicGlobalAsset({ visibility: "internal" })).toBe(false);
  });
});

describe("assetTypeForFile", () => {
  it("classifies common platform asset kinds", () => {
    expect(assetTypeForFile("image/png", "a.png")).toBe("image");
    expect(assetTypeForFile("image/svg+xml", "icon.svg")).toBe("icon");
    expect(assetTypeForFile("", "logo.svg")).toBe("icon");
    expect(assetTypeForFile("video/mp4", "hero.mp4")).toBe("video");
    expect(assetTypeForFile("application/pdf", "guide.pdf")).toBe("pdf");
    expect(assetTypeForFile("text/plain", "notes.txt")).toBe("document");
    expect(
      assetTypeForFile(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "spec.docx",
      ),
    ).toBe("document");
    expect(assetTypeForFile("application/octet-stream", "data.bin")).toBe("other");
  });
});

describe("uploadGlobalMedia", () => {
  it("uploads a public website image (original + thumb + preview) to the PUBLIC bucket with a public URL", async () => {
    await uploadGlobalMedia({
      file: fakeFile("hero.png", "image/png", 4096),
      target: "public",
      title: "Homepage hero",
      tags: ["hero"],
      pathSlug: "homepage",
      createdBy: "usr_sa",
    });

    // original + thumb + preview, all to the public bucket under website/homepage.
    expect(mocks.uploadAssetObject).toHaveBeenCalledTimes(3);
    const paths = mocks.uploadAssetObject.mock.calls.map((c) => c[0].path);
    expect(paths).toEqual([
      "website/homepage/asset_new/original.png",
      "website/homepage/asset_new/thumb.webp",
      "website/homepage/asset_new/preview.webp",
    ]);
    for (const call of mocks.uploadAssetObject.mock.calls) {
      expect(call[0].bucket).toBe("public-assets");
    }

    expect(mocks.createAsset).toHaveBeenCalledTimes(1);
    const input = mocks.createAsset.mock.calls[0][0];
    expect(input.scope).toBe("website_public");
    expect(input.visibility).toBe("public");
    expect(input.assetType).toBe("image");
    expect(input.storageBucket).toBe("public-assets");
    expect(input.storagePath).toBe("website/homepage/asset_new/original.png");
    expect(input.thumbnailPath).toBe("website/homepage/asset_new/thumb.webp");
    expect(input.previewPath).toBe("website/homepage/asset_new/preview.webp");
    expect(input.publicUrl).toBe("https://cdn.example/website/homepage/asset_new/original.png");
    expect(input.companyId).toBeUndefined();
    expect(input.customerId).toBeUndefined();
    expect(input.width).toBe(2000);
    expect(input.fileSize).toBe(4096);
  });

  it("uploads an internal image to the PRIVATE global library with no public URL", async () => {
    await uploadGlobalMedia({
      file: fakeFile("diagram.png", "image/png", 2048),
      target: "internal",
    });
    const paths = mocks.uploadAssetObject.mock.calls.map((c) => c[0].path);
    expect(paths).toEqual([
      "global/internal/asset_new/original.png",
      "global/internal/asset_new/thumb.webp",
      "global/internal/asset_new/preview.webp",
    ]);
    for (const call of mocks.uploadAssetObject.mock.calls) {
      expect(call[0].bucket).toBe("private-assets");
    }
    const input = mocks.createAsset.mock.calls[0][0];
    expect(input.scope).toBe("global_internal");
    expect(input.visibility).toBe("internal");
    expect(input.publicUrl).toBeNull();
    expect(mocks.resolvePublicUrl).not.toHaveBeenCalled();
  });

  it("stores ONLY the original for non-images (PDF) and never derives layers", async () => {
    await uploadGlobalMedia({
      file: fakeFile("manual.pdf", "application/pdf", 9000),
      target: "internal",
    });
    expect(mocks.processImageFile).not.toHaveBeenCalled();
    expect(mocks.uploadAssetObject).toHaveBeenCalledTimes(1);
    expect(mocks.uploadAssetObject.mock.calls[0][0].path).toBe(
      "global/internal/asset_new/original.pdf",
    );
    const input = mocks.createAsset.mock.calls[0][0];
    expect(input.assetType).toBe("pdf");
    expect(input.thumbnailPath).toBeNull();
    expect(input.previewPath).toBeNull();
  });

  it("rejects oversized files before any upload", async () => {
    await expect(
      uploadGlobalMedia({
        file: fakeFile("huge.mp4", "video/mp4", 99 * 1024 * 1024),
        target: "internal",
      }),
    ).rejects.toThrow(/limit/i);
    expect(mocks.uploadAssetObject).not.toHaveBeenCalled();
    expect(mocks.createAsset).not.toHaveBeenCalled();
  });

  it("still stores the asset when image derivation fails (original-only fallback)", async () => {
    mocks.processImageFile.mockRejectedValueOnce(new Error("canvas unavailable"));
    await uploadGlobalMedia({
      file: fakeFile("photo.jpg", "image/jpeg", 5000),
      target: "internal",
    });
    expect(mocks.uploadAssetObject).toHaveBeenCalledTimes(1);
    const input = mocks.createAsset.mock.calls[0][0];
    expect(input.storagePath).toBe("global/internal/asset_new/original.jpg");
    expect(input.thumbnailPath).toBeNull();
  });

  it("cleans up uploaded objects when the metadata write fails", async () => {
    mocks.createAsset.mockRejectedValueOnce(new Error("rls denied"));
    await expect(
      uploadGlobalMedia({
        file: fakeFile("logo.png", "image/png", 4096),
        target: "public",
      }),
    ).rejects.toThrow(/rls denied/);
    expect(mocks.removeAssetObjects).toHaveBeenCalledTimes(1);
    expect(mocks.removeAssetObjects.mock.calls[0][1]).toHaveLength(3);
  });
});

describe("listGlobalMedia", () => {
  it("queries the three global scopes and merges newest-first", async () => {
    mocks.listAssets.mockImplementation(async (q: { scope?: string }) => {
      if (q.scope === "global_internal") {
        return [asset({ id: "i1", scope: "global_internal", createdAt: "2026-01-01T00:00:00.000Z" })];
      }
      if (q.scope === "website_public") {
        return [asset({ id: "w1", scope: "website_public", createdAt: "2026-03-01T00:00:00.000Z" })];
      }
      return [];
    });
    const result = await listGlobalMedia();
    const scopesQueried = mocks.listAssets.mock.calls.map((c) => c[0].scope).sort();
    expect(scopesQueried).toEqual(["global_internal", "global_public", "website_public"]);
    for (const call of mocks.listAssets.mock.calls) expect(call[0].includeArchived).toBe(true);
    expect(result.map((a) => a.id)).toEqual(["w1", "i1"]);
  });

  it("drops any company/customer-owned row defensively (no cross-tenant leak)", async () => {
    mocks.listAssets.mockResolvedValueOnce([
      asset({ id: "global", companyId: null, customerId: null }),
      asset({ id: "company", companyId: "cmp_1" }),
      asset({ id: "customer", customerId: "cust_9" }),
    ]);
    const result = await listGlobalMedia();
    expect(result.map((a) => a.id)).toEqual(["global"]);
  });
});

describe("updateGlobalMediaMeta / archive / restore / safe remove", () => {
  it("updates metadata through the repository", async () => {
    await updateGlobalMediaMeta("asset_1", { title: "New", tags: ["a"], updatedBy: "usr_sa" });
    expect(mocks.updateAsset).toHaveBeenCalledWith("asset_1", {
      title: "New",
      description: undefined,
      tags: ["a"],
      categoryId: undefined,
      folderId: undefined,
      updatedBy: "usr_sa",
    });
  });

  it("archives, restores and removes from the global library without soft-deleting", async () => {
    await archiveGlobalMedia("asset_1");
    expect(mocks.archiveAsset).toHaveBeenCalledWith("asset_1");
    await restoreGlobalMedia("asset_1");
    expect(mocks.restoreAsset).toHaveBeenCalledWith("asset_1");

    await removeGlobalMediaFromLibrary("asset_1");
    await deleteGlobalMedia("asset_2");

    expect(mocks.archiveAsset).toHaveBeenCalledWith("asset_1");
    expect(mocks.archiveAsset).toHaveBeenCalledWith("asset_2");
    expect(mocks.softDeleteAsset).not.toHaveBeenCalled();
  });
});

describe("resolveGlobalMediaUrls", () => {
  it("uses stable public URLs for public-bucket assets (no signing)", async () => {
    const a = asset({
      id: "pub",
      storageBucket: "public-assets",
      storagePath: "website/login/pub/original.png",
      thumbnailBucket: "public-assets",
      thumbnailPath: "website/login/pub/thumb.webp",
      previewBucket: "public-assets",
      previewPath: "website/login/pub/preview.webp",
      visibility: "public",
      scope: "website_public",
      publicUrl: "https://cdn.example/website/login/pub/original.png",
    });
    const urls = await resolveGlobalMediaUrls([a]);
    expect(mocks.createSignedUrls).not.toHaveBeenCalled();
    expect(urls.get("pub")).toEqual({
      thumbUrl: "https://cdn.example/website/login/pub/thumb.webp",
      fullUrl: "https://cdn.example/website/login/pub/original.png",
    });
  });

  it("batch-signs private-bucket assets and maps the slots back", async () => {
    const a = asset();
    mocks.createSignedUrls.mockResolvedValueOnce(
      new Map([
        [a.thumbnailPath, "https://signed/thumb"],
        [a.storagePath, "https://signed/original"],
      ]),
    );
    const urls = await resolveGlobalMediaUrls([a]);
    expect(mocks.createSignedUrls).toHaveBeenCalledTimes(1);
    expect(mocks.createSignedUrls.mock.calls[0][0]).toBe("private-assets");
    expect(urls.get("asset_1")).toEqual({
      thumbUrl: "https://signed/thumb",
      fullUrl: "https://signed/original",
    });
  });
});
