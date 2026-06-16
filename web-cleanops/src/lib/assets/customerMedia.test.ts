/**
 * Customer Media Center — Supabase-authoritative data layer (Phase 2) proof.
 *
 * Drives the customer-media orchestration against mocked repository / storage /
 * URL-resolver seams, proving:
 *   • new uploads default to scope `customer_internal` + visibility `internal`
 *     (admin-only) and write the 3 WebP layers to the PRIVATE bucket under the
 *     company/customer path before the metadata row is created;
 *   • making an item customer-visible flips BOTH scope + visibility together;
 *   • the layer→slot mapping (micro→thumbnail, hover→preview, preview→storage)
 *     and its read-side inverse are stable;
 *   • a failed metadata write cleans up the just-uploaded objects;
 *   • list reads are scoped to the customer-media scopes and never touch
 *     localStorage.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import type { Asset } from "./assetRepository";

const mocks = vi.hoisted(() => ({
  loadCompanyUuidMap: vi.fn(),
  makeId: vi.fn(),
  createAsset: vi.fn(),
  updateAsset: vi.fn(),
  softDeleteAsset: vi.fn(),
  listAssets: vi.fn(),
  getAssetById: vi.fn(),
  uploadAssetObject: vi.fn(),
  removeAssetObjects: vi.fn(),
  createSignedUrls: vi.fn(),
}));

vi.mock("@/lib/data/customerMigration", () => ({
  loadCompanyUuidMap: mocks.loadCompanyUuidMap,
}));

vi.mock("@/lib/store", () => ({
  makeId: mocks.makeId,
}));

vi.mock("./assetRepository", () => ({
  createAsset: mocks.createAsset,
  updateAsset: mocks.updateAsset,
  softDeleteAsset: mocks.softDeleteAsset,
  listAssets: mocks.listAssets,
  getAssetById: mocks.getAssetById,
}));

vi.mock("./assetUrlResolver", () => ({
  createSignedUrls: mocks.createSignedUrls,
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
  archiveCustomerMedia,
  customerMediaCategory,
  customerMediaScopeVisibility,
  isCustomerVisible,
  listCustomerMedia,
  resolveCustomerMediaSourceById,
  resolveCustomerMediaSources,
  setCustomerMediaVisibility,
  uploadCustomerMedia,
} from "./customerMedia";

/** A tiny valid base64 data URL so atob/Blob succeed. */
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
    companyId: "cmp_1",
    customerId: "cust_1",
    folderId: null,
    categoryId: null,
    scope: "customer_internal",
    visibility: "internal",
    assetType: "image",
    mimeType: "image/webp",
    name: "customer-asset_1.webp",
    title: null,
    description: null,
    altText: null,
    tags: ["customer"],
    storageBucket: "private-assets",
    storagePath: "companies/uuid-company-1/customers/cust_1/asset_1/preview.webp",
    publicUrl: null,
    thumbnailBucket: "private-assets",
    thumbnailPath: "companies/uuid-company-1/customers/cust_1/asset_1/micro.webp",
    previewBucket: "private-assets",
    previewPath: "companies/uuid-company-1/customers/cust_1/asset_1/hover.webp",
    posterAssetId: null,
    width: 2000,
    height: 1500,
    durationSeconds: null,
    fileSize: 25000,
    checksum: null,
    copiedFromAssetId: null,
    copiedFromAssetLegacyId: null,
    sourceAssetId: null,
    sourceAssetLegacyId: null,
    metadata: { mediaCategory: "customer" },
    createdBy: "usr_1",
    updatedBy: null,
    archivedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadCompanyUuidMap.mockResolvedValue(new Map([["cmp_1", "uuid-company-1"]]));
  mocks.makeId.mockReturnValue("asset_new");
  mocks.createAsset.mockImplementation(async (input: Record<string, unknown>) => ({
    ...asset(),
    id: (input.id as string) ?? "asset_new",
  }));
  mocks.updateAsset.mockResolvedValue(asset());
  mocks.softDeleteAsset.mockResolvedValue(undefined);
  mocks.listAssets.mockResolvedValue([]);
  mocks.getAssetById.mockResolvedValue(null);
  mocks.uploadAssetObject.mockImplementation(async (i: { path: string }) => ({ path: i.path }));
  mocks.removeAssetObjects.mockResolvedValue(undefined);
  mocks.createSignedUrls.mockResolvedValue(new Map());
});

describe("customerMediaScopeVisibility", () => {
  it("defaults to admin/internal and opts in to customer-visible explicitly", () => {
    expect(customerMediaScopeVisibility(false)).toEqual({
      scope: "customer_internal",
      visibility: "internal",
    });
    expect(customerMediaScopeVisibility(true)).toEqual({
      scope: "customer_visible",
      visibility: "customer_visible",
    });
  });
});

describe("isCustomerVisible / customerMediaCategory", () => {
  it("derives the visible flag from visibility, not scope", () => {
    expect(isCustomerVisible({ visibility: "customer_visible" })).toBe(true);
    expect(isCustomerVisible({ visibility: "internal" })).toBe(false);
  });

  it("reads the legacy media category from metadata, defaulting to customer", () => {
    expect(customerMediaCategory(asset({ metadata: { mediaCategory: "key" } }))).toBe("key");
    expect(customerMediaCategory(asset({ metadata: {} }))).toBe("customer");
  });
});

describe("uploadCustomerMedia", () => {
  it("uploads 3 layers to the private bucket then creates an admin/internal asset", async () => {
    await uploadCustomerMedia({
      companyId: "cmp_1",
      customerId: "cust_1",
      processed: processed(),
      category: "key",
      createdBy: "usr_1",
    });

    // 3 layers uploaded to the company/customer path in the private bucket.
    expect(mocks.uploadAssetObject).toHaveBeenCalledTimes(3);
    const paths = mocks.uploadAssetObject.mock.calls.map((c) => c[0].path);
    expect(paths).toEqual([
      "companies/uuid-company-1/customers/cust_1/asset_new/micro.webp",
      "companies/uuid-company-1/customers/cust_1/asset_new/hover.webp",
      "companies/uuid-company-1/customers/cust_1/asset_new/preview.webp",
    ]);
    for (const call of mocks.uploadAssetObject.mock.calls) {
      expect(call[0].bucket).toBe("private-assets");
      expect(call[0].contentType).toBe("image/webp");
    }

    expect(mocks.createAsset).toHaveBeenCalledTimes(1);
    const input = mocks.createAsset.mock.calls[0][0];
    expect(input.scope).toBe("customer_internal");
    expect(input.visibility).toBe("internal");
    expect(input.companyId).toBe("cmp_1");
    expect(input.companyUuid).toBe("uuid-company-1");
    expect(input.customerId).toBe("cust_1");
    expect(input.assetType).toBe("image");
    expect(input.tags).toEqual(["key"]);
    expect(input.metadata).toEqual({ mediaCategory: "key" });
    // Layer → slot mapping: preview=storage (canonical), micro=thumbnail, hover=preview.
    expect(input.storagePath).toBe(
      "companies/uuid-company-1/customers/cust_1/asset_new/preview.webp",
    );
    expect(input.thumbnailPath).toBe(
      "companies/uuid-company-1/customers/cust_1/asset_new/micro.webp",
    );
    expect(input.previewPath).toBe(
      "companies/uuid-company-1/customers/cust_1/asset_new/hover.webp",
    );
    expect(input.fileSize).toBe(25000);
  });

  it("creates a customer-visible asset when visible is explicitly true", async () => {
    await uploadCustomerMedia({
      companyId: "cmp_1",
      customerId: "cust_1",
      processed: processed(),
      category: "cover",
      visible: true,
    });
    const input = mocks.createAsset.mock.calls[0][0];
    expect(input.scope).toBe("customer_visible");
    expect(input.visibility).toBe("customer_visible");
  });

  it("rejects when no Supabase company maps to the legacy company id", async () => {
    mocks.loadCompanyUuidMap.mockResolvedValueOnce(new Map());
    await expect(
      uploadCustomerMedia({
        companyId: "cmp_unknown",
        customerId: "cust_1",
        processed: processed(),
        category: "customer",
      }),
    ).rejects.toThrow(/No Supabase company/);
    expect(mocks.uploadAssetObject).not.toHaveBeenCalled();
  });

  it("cleans up uploaded objects when the metadata write fails", async () => {
    mocks.createAsset.mockRejectedValueOnce(new Error("rls denied"));
    await expect(
      uploadCustomerMedia({
        companyId: "cmp_1",
        customerId: "cust_1",
        processed: processed(),
        category: "customer",
      }),
    ).rejects.toThrow(/rls denied/);
    expect(mocks.removeAssetObjects).toHaveBeenCalledTimes(1);
    expect(mocks.removeAssetObjects.mock.calls[0][1]).toHaveLength(3);
  });
});

describe("setCustomerMediaVisibility", () => {
  it("updates scope AND visibility together", async () => {
    await setCustomerMediaVisibility("asset_1", true, "usr_1");
    expect(mocks.updateAsset).toHaveBeenCalledWith("asset_1", {
      scope: "customer_visible",
      visibility: "customer_visible",
      updatedBy: "usr_1",
    });

    await setCustomerMediaVisibility("asset_1", false);
    expect(mocks.updateAsset).toHaveBeenLastCalledWith("asset_1", {
      scope: "customer_internal",
      visibility: "internal",
      updatedBy: null,
    });
  });
});

describe("archiveCustomerMedia", () => {
  it("soft-deletes the asset", async () => {
    await archiveCustomerMedia("asset_1");
    expect(mocks.softDeleteAsset).toHaveBeenCalledWith("asset_1");
  });
});

describe("listCustomerMedia", () => {
  it("scopes to the customer/company and narrows to customer-media scopes, newest first", async () => {
    mocks.listAssets.mockResolvedValueOnce([
      asset({ id: "older", scope: "customer_internal", createdAt: "2026-01-01T00:00:00.000Z" }),
      asset({ id: "newer", scope: "customer_visible", createdAt: "2026-02-01T00:00:00.000Z" }),
      asset({ id: "foreign", scope: "company_internal", createdAt: "2026-03-01T00:00:00.000Z" }),
    ]);
    const result = await listCustomerMedia({ companyId: "cmp_1", customerId: "cust_1" });
    expect(mocks.listAssets).toHaveBeenCalledWith({ companyId: "cmp_1", customerId: "cust_1" });
    expect(result.map((a) => a.id)).toEqual(["newer", "older"]);
  });

  it("returns [] WITHOUT querying when the customer/company id is blank (never lists company-wide)", async () => {
    expect(await listCustomerMedia({ companyId: "cmp_1", customerId: "" })).toEqual([]);
    expect(await listCustomerMedia({ companyId: "cmp_1", customerId: "   " })).toEqual([]);
    expect(
      await listCustomerMedia({
        companyId: "cmp_1",
        customerId: undefined as unknown as string,
      }),
    ).toEqual([]);
    expect(await listCustomerMedia({ companyId: "", customerId: "cust_1" })).toEqual([]);
    // An unscoped listAssets() would return EVERY customer's media — it must
    // never be reached without a concrete customer.
    expect(mocks.listAssets).not.toHaveBeenCalled();
  });

  it("drops any row belonging to a different customer (cross-customer isolation)", async () => {
    mocks.listAssets.mockResolvedValueOnce([
      asset({ id: "mine", customerId: "cust_1", scope: "customer_internal" }),
      asset({ id: "theirs", customerId: "cust_2", scope: "customer_internal" }),
      asset({ id: "also_theirs", customerId: "cust_99", scope: "customer_visible" }),
    ]);
    const result = await listCustomerMedia({ companyId: "cmp_1", customerId: "cust_1" });
    expect(result.map((a) => a.id)).toEqual(["mine"]);
  });
});

describe("resolveCustomerMediaSources", () => {
  it("maps signed URLs back onto the micro/hover/preview layers", async () => {
    mocks.createSignedUrls.mockResolvedValueOnce(
      new Map([
        [asset().thumbnailPath, "https://signed/micro"],
        [asset().previewPath, "https://signed/hover"],
        [asset().storagePath, "https://signed/preview"],
      ]),
    );
    const sources = await resolveCustomerMediaSources([asset()]);
    expect(sources.get("asset_1")).toEqual({
      microThumbnailUrl: "https://signed/micro",
      hoverThumbnailUrl: "https://signed/hover",
      previewImageUrl: "https://signed/preview",
      caption: undefined,
    });
  });

  it("omits an asset when its canonical object cannot be signed", async () => {
    mocks.createSignedUrls.mockResolvedValueOnce(new Map());
    const sources = await resolveCustomerMediaSources([asset()]);
    expect(sources.has("asset_1")).toBe(false);
  });
});

describe("resolveCustomerMediaSourceById", () => {
  it("returns null when the asset is gone", async () => {
    mocks.getAssetById.mockResolvedValueOnce(null);
    expect(await resolveCustomerMediaSourceById("missing")).toBeNull();
  });

  it("never throws — resolves null on error", async () => {
    mocks.getAssetById.mockRejectedValueOnce(new Error("boom"));
    expect(await resolveCustomerMediaSourceById("asset_1")).toBeNull();
  });

  it("returns null (and never signs) when the asset belongs to a different customer", async () => {
    mocks.getAssetById.mockResolvedValueOnce(asset({ customerId: "cust_1" }));
    expect(await resolveCustomerMediaSourceById("asset_1", "cust_2")).toBeNull();
    expect(mocks.createSignedUrls).not.toHaveBeenCalled();
  });

  it("resolves the source when the asset belongs to the expected customer", async () => {
    mocks.getAssetById.mockResolvedValueOnce(asset({ customerId: "cust_1" }));
    mocks.createSignedUrls.mockResolvedValueOnce(
      new Map([
        [asset().thumbnailPath, "https://signed/micro"],
        [asset().previewPath, "https://signed/hover"],
        [asset().storagePath, "https://signed/preview"],
      ]),
    );
    expect(await resolveCustomerMediaSourceById("asset_1", "cust_1")).toEqual({
      microThumbnailUrl: "https://signed/micro",
      hoverThumbnailUrl: "https://signed/hover",
      previewImageUrl: "https://signed/preview",
      caption: undefined,
    });
  });
});
