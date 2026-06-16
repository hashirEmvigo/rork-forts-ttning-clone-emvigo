/**
 * Login-page branding — Supabase-authoritative selection proof.
 *
 * Drives {@link getLoginBackground} / {@link setLoginBackground} /
 * {@link clearLoginBackground} against mocked repository / URL-resolver / audit
 * seams, proving:
 *   • the login background is modelled as a SINGLETON public `login_page` link;
 *   • reads resolve via the link metadata fast-path, falling back to the asset;
 *   • only a PUBLIC image/video may be chosen (private / non-visual rejected);
 *   • setting archives any existing active link FIRST, then creates a public
 *     website link carrying the cached public URL + media type, and audits;
 *   • clearing archives the active link(s) and no-ops cleanly when none exist;
 *   • nothing here touches localStorage / mediaStore.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import type { Asset, AssetLink } from "./assetTypes";

const mocks = vi.hoisted(() => ({
  listAssetLinks: vi.fn(),
  createAssetLink: vi.fn(),
  archiveAssetLink: vi.fn(),
  getAssetById: vi.fn(),
  resolvePublicUrl: vi.fn(),
  safeRecordAssetActivity: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({ isSupabaseConfigured: true }));

vi.mock("./assetRepository", () => ({
  listAssetLinks: mocks.listAssetLinks,
  createAssetLink: mocks.createAssetLink,
  archiveAssetLink: mocks.archiveAssetLink,
  getAssetById: mocks.getAssetById,
}));

vi.mock("./assetUrlResolver", () => ({ resolvePublicUrl: mocks.resolvePublicUrl }));

vi.mock("./assetAudit", () => ({ safeRecordAssetActivity: mocks.safeRecordAssetActivity }));

vi.mock("./assetStorage", () => ({
  PUBLIC_BUCKET: "public-assets",
  PRIVATE_BUCKET: "private-assets",
}));

import {
  LOGIN_BACKGROUND_PLACEMENT,
  LOGIN_PAGE_ENTITY_TYPE,
  clearLoginBackground,
  getLoginBackground,
  setLoginBackground,
} from "./loginBranding";

function asset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: "asset_pub",
    companyId: null,
    customerId: null,
    folderId: null,
    categoryId: null,
    scope: "website_public",
    visibility: "public",
    assetType: "video",
    mimeType: "video/mp4",
    name: "hero.mp4",
    title: "Login hero",
    description: null,
    altText: null,
    tags: [],
    storageBucket: "public-assets",
    storagePath: "website/general/asset_pub/original.mp4",
    publicUrl: "https://cdn.example/website/general/asset_pub/original.mp4",
    thumbnailBucket: null,
    thumbnailPath: null,
    previewBucket: null,
    previewPath: null,
    posterAssetId: null,
    width: null,
    height: null,
    durationSeconds: null,
    fileSize: 4096,
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

function link(overrides: Partial<AssetLink> = {}): AssetLink {
  return {
    id: "lnk_1",
    assetId: "asset_pub",
    companyId: null,
    customerId: null,
    entityType: LOGIN_PAGE_ENTITY_TYPE,
    entityId: null,
    placementKey: LOGIN_BACKGROUND_PLACEMENT,
    scope: "website_public",
    visibility: "public",
    sortOrder: 0,
    isActive: true,
    metadata: {},
    createdBy: "usr_sa",
    archivedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listAssetLinks.mockResolvedValue([]);
  mocks.createAssetLink.mockImplementation(async (input: Record<string, unknown>) =>
    link({ assetId: input.assetId as string, metadata: (input.metadata as Record<string, unknown>) ?? {} }),
  );
  mocks.archiveAssetLink.mockResolvedValue(undefined);
  mocks.getAssetById.mockResolvedValue(asset());
  mocks.resolvePublicUrl.mockImplementation((_bucket: string, path: string) => `https://cdn.example/${path}`);
  mocks.safeRecordAssetActivity.mockResolvedValue(null);
});

describe("getLoginBackground", () => {
  it("returns null and skips the asset lookup when nothing is configured", async () => {
    mocks.listAssetLinks.mockResolvedValueOnce([]);
    const result = await getLoginBackground();
    expect(result).toBeNull();
    expect(mocks.getAssetById).not.toHaveBeenCalled();
  });

  it("queries the singleton login_page placement", async () => {
    await getLoginBackground();
    expect(mocks.listAssetLinks).toHaveBeenCalledWith({
      entityType: "login_page",
      placementKey: "login_background",
    });
  });

  it("resolves via the link metadata fast-path without an asset round-trip", async () => {
    mocks.listAssetLinks.mockResolvedValueOnce([
      link({
        assetId: "asset_pub",
        metadata: {
          mediaUrl: "https://cdn.example/website/general/asset_pub/original.mp4",
          mediaType: "video",
        },
      }),
    ]);
    const result = await getLoginBackground();
    expect(result).toEqual({
      assetId: "asset_pub",
      url: "https://cdn.example/website/general/asset_pub/original.mp4",
      mediaType: "video",
      overlay: { desktop: 55, mobile: 45 },
    });
    expect(mocks.getAssetById).not.toHaveBeenCalled();
  });

  it("falls back to the asset row when the link has no cached media", async () => {
    mocks.listAssetLinks.mockResolvedValueOnce([link({ metadata: {} })]);
    mocks.getAssetById.mockResolvedValueOnce(
      asset({ id: "asset_pub", assetType: "image", publicUrl: "https://cdn.example/login.png" }),
    );
    const result = await getLoginBackground();
    expect(mocks.getAssetById).toHaveBeenCalledWith("asset_pub");
    expect(result).toEqual({
      assetId: "asset_pub",
      url: "https://cdn.example/login.png",
      mediaType: "image",
      overlay: { desktop: 55, mobile: 45 },
    });
  });

  it("returns null when the linked asset is no longer public (defensive)", async () => {
    mocks.listAssetLinks.mockResolvedValueOnce([link({ metadata: {} })]);
    mocks.getAssetById.mockResolvedValueOnce(asset({ visibility: "internal" }));
    expect(await getLoginBackground()).toBeNull();
  });

  it("picks the newest active link if duplicates somehow exist", async () => {
    mocks.listAssetLinks.mockResolvedValueOnce([
      link({ id: "old", assetId: "asset_old", createdAt: "2026-01-01T00:00:00.000Z", metadata: { mediaUrl: "https://cdn.example/old.mp4", mediaType: "video" } }),
      link({ id: "new", assetId: "asset_new", createdAt: "2026-05-01T00:00:00.000Z", metadata: { mediaUrl: "https://cdn.example/new.mp4", mediaType: "video" } }),
    ]);
    const result = await getLoginBackground();
    expect(result?.assetId).toBe("asset_new");
  });
});

describe("setLoginBackground", () => {
  it("rejects a non-public asset without writing anything", async () => {
    await expect(
      setLoginBackground(asset({ visibility: "internal" }), { id: "usr_sa" }),
    ).rejects.toThrow(/public/i);
    expect(mocks.createAssetLink).not.toHaveBeenCalled();
    expect(mocks.archiveAssetLink).not.toHaveBeenCalled();
  });

  it("rejects a public but non-visual asset (e.g. a PDF)", async () => {
    await expect(
      setLoginBackground(asset({ assetType: "pdf", mimeType: "application/pdf", publicUrl: "https://cdn.example/guide.pdf" })),
    ).rejects.toThrow(/image or a video/i);
    expect(mocks.createAssetLink).not.toHaveBeenCalled();
  });

  it("archives the existing active link FIRST, then creates a public website link with cached media", async () => {
    mocks.listAssetLinks.mockResolvedValueOnce([link({ id: "lnk_old" })]);
    await setLoginBackground(asset({ id: "asset_pub", assetType: "image", publicUrl: "https://cdn.example/login.png" }), {
      id: "usr_sa",
      role: "super_admin",
    });

    expect(mocks.archiveAssetLink).toHaveBeenCalledWith("lnk_old");
    expect(mocks.createAssetLink).toHaveBeenCalledTimes(1);
    const archiveOrder = mocks.archiveAssetLink.mock.invocationCallOrder[0];
    const createOrder = mocks.createAssetLink.mock.invocationCallOrder[0];
    expect(archiveOrder).toBeLessThan(createOrder);

    const input = mocks.createAssetLink.mock.calls[0][0];
    expect(input).toMatchObject({
      assetId: "asset_pub",
      entityType: "login_page",
      entityId: null,
      placementKey: "login_background",
      scope: "website_public",
      visibility: "public",
      createdBy: "usr_sa",
    });
    expect(input.metadata).toEqual({ mediaUrl: "https://cdn.example/login.png", mediaType: "image" });
  });

  it("derives a public URL from the storage path when publicUrl is absent", async () => {
    await setLoginBackground(
      asset({ publicUrl: null, storageBucket: "public-assets", storagePath: "website/general/asset_pub/original.mp4" }),
    );
    const input = mocks.createAssetLink.mock.calls[0][0];
    expect(input.metadata).toEqual({
      mediaUrl: "https://cdn.example/website/general/asset_pub/original.mp4",
      mediaType: "video",
    });
  });

  it("records a login_page_video_changed audit event", async () => {
    await setLoginBackground(asset(), { id: "usr_sa", role: "super_admin" });
    expect(mocks.safeRecordAssetActivity).toHaveBeenCalledTimes(1);
    expect(mocks.safeRecordAssetActivity.mock.calls[0][0]).toMatchObject({
      eventType: "login_page_video_changed",
      assetId: "asset_pub",
      actorUserId: "usr_sa",
    });
  });
});

describe("clearLoginBackground", () => {
  it("archives every active login_page link and audits", async () => {
    mocks.listAssetLinks.mockResolvedValueOnce([link({ id: "a" }), link({ id: "b" })]);
    await clearLoginBackground({ id: "usr_sa" });
    expect(mocks.archiveAssetLink).toHaveBeenCalledTimes(2);
    expect(mocks.archiveAssetLink).toHaveBeenCalledWith("a");
    expect(mocks.archiveAssetLink).toHaveBeenCalledWith("b");
    expect(mocks.safeRecordAssetActivity).toHaveBeenCalledTimes(1);
  });

  it("no-ops (no archive, no audit) when nothing is configured", async () => {
    mocks.listAssetLinks.mockResolvedValueOnce([]);
    await clearLoginBackground();
    expect(mocks.archiveAssetLink).not.toHaveBeenCalled();
    expect(mocks.safeRecordAssetActivity).not.toHaveBeenCalled();
  });
});
