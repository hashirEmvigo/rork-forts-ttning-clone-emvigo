/**
 * Public website imagery — Supabase-authoritative placement proof.
 *
 * Drives {@link getWebsiteImagesForPage} / {@link setWebsiteImage} /
 * {@link clearWebsiteImage} against mocked repository / URL-resolver / audit
 * seams, proving:
 *   • a placement is a per-(page, slot) public `public_website_page` link;
 *   • reads resolve from the cached link metadata in ONE query (no asset
 *     round-trip), keep the newest link per slot, and skip non-public/uncached;
 *   • only a PUBLIC image/icon may be assigned (private / non-image rejected);
 *   • setting archives any existing active link for the slot FIRST, then creates
 *     a public website link carrying the cached public URL + alt, and audits;
 *   • clearing archives the active link(s) and no-ops cleanly when empty;
 *   • nothing here touches localStorage / mediaStore.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import type { Asset, AssetLink } from "./assetTypes";

const mocks = vi.hoisted(() => ({
  listAssetLinks: vi.fn(),
  createAssetLink: vi.fn(),
  archiveAssetLink: vi.fn(),
  resolvePublicUrl: vi.fn(),
  safeRecordAssetActivity: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({ isSupabaseConfigured: true }));

vi.mock("./assetRepository", () => ({
  listAssetLinks: mocks.listAssetLinks,
  createAssetLink: mocks.createAssetLink,
  archiveAssetLink: mocks.archiveAssetLink,
}));

vi.mock("./assetUrlResolver", () => ({ resolvePublicUrl: mocks.resolvePublicUrl }));

vi.mock("./assetAudit", () => ({ safeRecordAssetActivity: mocks.safeRecordAssetActivity }));

vi.mock("./assetStorage", () => ({
  PUBLIC_BUCKET: "public-assets",
  PRIVATE_BUCKET: "private-assets",
}));

import {
  PUBLIC_WEBSITE_ENTITY_TYPE,
  clearWebsiteImage,
  getWebsiteImagesForPage,
  listWebsiteImageLinks,
  setWebsiteImage,
} from "./websiteImagery";

function asset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: "asset_pub",
    companyId: null,
    customerId: null,
    folderId: null,
    categoryId: null,
    scope: "website_public",
    visibility: "public",
    assetType: "image",
    mimeType: "image/webp",
    name: "hero.webp",
    title: "Office hero",
    description: null,
    altText: "Bright clean office",
    tags: [],
    storageBucket: "public-assets",
    storagePath: "website/home/asset_pub/original.webp",
    publicUrl: "https://cdn.example/website/home/asset_pub/original.webp",
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
    entityType: PUBLIC_WEBSITE_ENTITY_TYPE,
    entityId: "home",
    placementKey: "home_hero",
    scope: "website_public",
    visibility: "public",
    sortOrder: 0,
    isActive: true,
    metadata: { mediaUrl: "https://cdn.example/home_hero.webp", alt: "Bright clean office" },
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
    link({
      assetId: input.assetId as string,
      entityId: input.entityId as string,
      placementKey: input.placementKey as string,
      metadata: (input.metadata as Record<string, unknown>) ?? {},
    }),
  );
  mocks.archiveAssetLink.mockResolvedValue(undefined);
  mocks.resolvePublicUrl.mockImplementation((_bucket: string, path: string) => `https://cdn.example/${path}`);
  mocks.safeRecordAssetActivity.mockResolvedValue(null);
});

describe("listWebsiteImageLinks", () => {
  it("scopes to one page when a slug is given", async () => {
    await listWebsiteImageLinks("home");
    expect(mocks.listAssetLinks).toHaveBeenCalledWith({
      entityType: "public_website_page",
      entityId: "home",
    });
  });

  it("lists across all pages when no slug is given", async () => {
    await listWebsiteImageLinks();
    expect(mocks.listAssetLinks).toHaveBeenCalledWith({ entityType: "public_website_page" });
  });
});

describe("getWebsiteImagesForPage", () => {
  it("resolves slot images from cached link metadata in one query", async () => {
    mocks.listAssetLinks.mockResolvedValueOnce([
      link({ placementKey: "home_hero", metadata: { mediaUrl: "https://cdn.example/a.webp", alt: "A" } }),
      link({ placementKey: "home_quality", metadata: { mediaUrl: "https://cdn.example/b.webp", alt: "B" } }),
    ]);
    const images = await getWebsiteImagesForPage("home");
    expect(images.get("home_hero")).toEqual({
      slotKey: "home_hero",
      pageSlug: "home",
      assetId: "asset_pub",
      url: "https://cdn.example/a.webp",
      alt: "A",
      mediaType: "image",
    });
    expect(images.get("home_quality")?.url).toBe("https://cdn.example/b.webp");
  });

  it("resolves a slot as a video — by explicit metadata.mediaType, or inferred from the URL", async () => {
    mocks.listAssetLinks.mockResolvedValueOnce([
      link({
        placementKey: "public_calculator_right_visual",
        entityId: "rakna-ut-ditt-pris",
        metadata: { mediaUrl: "https://cdn.example/clip.mp4", mediaType: "video", alt: "Atmosphere" },
      }),
      // No mediaType in metadata, but a .mov URL → inferred as video.
      link({ placementKey: "hero_clip", metadata: { mediaUrl: "https://cdn.example/loop.mov" } }),
      // A querystring after the extension must not fool the inference.
      link({ placementKey: "hero_still", metadata: { mediaUrl: "https://cdn.example/a.webp?v=2" } }),
    ]);
    const images = await getWebsiteImagesForPage("rakna-ut-ditt-pris");
    expect(images.get("public_calculator_right_visual")?.mediaType).toBe("video");
    expect(images.get("hero_clip")?.mediaType).toBe("video");
    expect(images.get("hero_still")?.mediaType).toBe("image");
  });

  it("keeps the newest active link per slot", async () => {
    mocks.listAssetLinks.mockResolvedValueOnce([
      link({ id: "old", placementKey: "home_hero", createdAt: "2026-01-01T00:00:00.000Z", metadata: { mediaUrl: "https://cdn.example/old.webp" } }),
      link({ id: "new", placementKey: "home_hero", createdAt: "2026-05-01T00:00:00.000Z", metadata: { mediaUrl: "https://cdn.example/new.webp" } }),
    ]);
    const images = await getWebsiteImagesForPage("home");
    expect(images.get("home_hero")?.url).toBe("https://cdn.example/new.webp");
  });

  it("skips placements with no cached public URL", async () => {
    mocks.listAssetLinks.mockResolvedValueOnce([link({ placementKey: "home_hero", metadata: {} })]);
    const images = await getWebsiteImagesForPage("home");
    expect(images.has("home_hero")).toBe(false);
  });

  it("skips non-public placements defensively", async () => {
    mocks.listAssetLinks.mockResolvedValueOnce([
      link({ placementKey: "home_hero", visibility: "internal", metadata: { mediaUrl: "https://cdn.example/a.webp" } }),
    ]);
    const images = await getWebsiteImagesForPage("home");
    expect(images.has("home_hero")).toBe(false);
  });
});

describe("setWebsiteImage", () => {
  const target = { slotKey: "home_hero", pageSlug: "home" };

  it("rejects a non-public asset without writing anything", async () => {
    await expect(
      setWebsiteImage(target, asset({ visibility: "internal" }), null, { id: "usr_sa" }),
    ).rejects.toThrow(/public/i);
    expect(mocks.createAssetLink).not.toHaveBeenCalled();
    expect(mocks.archiveAssetLink).not.toHaveBeenCalled();
  });

  it("rejects a public but non-image asset (e.g. a video)", async () => {
    await expect(
      setWebsiteImage(target, asset({ assetType: "video", mimeType: "video/mp4", publicUrl: "https://cdn.example/clip.mp4" })),
    ).rejects.toThrow(/image/i);
    expect(mocks.createAssetLink).not.toHaveBeenCalled();
  });

  it("archives the existing slot link FIRST, then creates a public link with cached media", async () => {
    mocks.listAssetLinks.mockResolvedValueOnce([link({ id: "lnk_old" })]);
    await setWebsiteImage(target, asset(), "Custom alt", { id: "usr_sa", role: "super_admin" });

    expect(mocks.archiveAssetLink).toHaveBeenCalledWith("lnk_old");
    expect(mocks.createAssetLink).toHaveBeenCalledTimes(1);
    const archiveOrder = mocks.archiveAssetLink.mock.invocationCallOrder[0];
    const createOrder = mocks.createAssetLink.mock.invocationCallOrder[0];
    expect(archiveOrder).toBeLessThan(createOrder);

    const input = mocks.createAssetLink.mock.calls[0][0];
    expect(input).toMatchObject({
      assetId: "asset_pub",
      entityType: "public_website_page",
      entityId: "home",
      placementKey: "home_hero",
      scope: "website_public",
      visibility: "public",
      createdBy: "usr_sa",
    });
    expect(input.metadata).toMatchObject({
      mediaUrl: "https://cdn.example/website/home/asset_pub/original.webp",
      alt: "Custom alt",
    });
  });

  it("derives a public URL + alt from the asset when none is supplied", async () => {
    await setWebsiteImage(
      target,
      asset({ publicUrl: null, altText: "Alt from asset", storageBucket: "public-assets", storagePath: "website/home/asset_pub/original.webp" }),
    );
    const input = mocks.createAssetLink.mock.calls[0][0];
    expect(input.metadata).toMatchObject({
      mediaUrl: "https://cdn.example/website/home/asset_pub/original.webp",
      alt: "Alt from asset",
    });
  });

  it("records a public_website_asset_changed audit event", async () => {
    await setWebsiteImage(target, asset(), null, { id: "usr_sa", role: "super_admin" });
    expect(mocks.safeRecordAssetActivity).toHaveBeenCalledTimes(1);
    expect(mocks.safeRecordAssetActivity.mock.calls[0][0]).toMatchObject({
      eventType: "public_website_asset_changed",
      assetId: "asset_pub",
      actorUserId: "usr_sa",
    });
  });
});

describe("clearWebsiteImage", () => {
  const target = { slotKey: "home_hero", pageSlug: "home" };

  it("archives every active link for the slot and audits", async () => {
    mocks.listAssetLinks.mockResolvedValueOnce([link({ id: "a" }), link({ id: "b" })]);
    await clearWebsiteImage(target, { id: "usr_sa" });
    expect(mocks.archiveAssetLink).toHaveBeenCalledTimes(2);
    expect(mocks.archiveAssetLink).toHaveBeenCalledWith("a");
    expect(mocks.archiveAssetLink).toHaveBeenCalledWith("b");
    expect(mocks.safeRecordAssetActivity).toHaveBeenCalledTimes(1);
  });

  it("no-ops (no archive, no audit) when the slot is empty", async () => {
    mocks.listAssetLinks.mockResolvedValueOnce([]);
    await clearWebsiteImage(target);
    expect(mocks.archiveAssetLink).not.toHaveBeenCalled();
    expect(mocks.safeRecordAssetActivity).not.toHaveBeenCalled();
  });
});
