/**
 * Work Order media — Supabase-authoritative data layer (Phase 3) proof.
 *
 * Drives the work-order placement orchestration against mocked repository /
 * customer-media seams, proving:
 *   • each placement area maps to the correct asset_links coordinates
 *     (work_order / work_order_header_image / work_order_service_row_image), and
 *     service rows stamp metadata.workOrderId;
 *   • attaching denormalises the asset's scope/visibility, computes the next
 *     sort order, and de-dupes an asset already placed in the same area;
 *   • uploading goes through the Customer Media Center pipeline (admin/internal,
 *     visible:false) and then links the new customer asset — so it appears in
 *     both surfaces;
 *   • detach archives the LINK only (asset untouched);
 *   • reorder writes one sort_order per link; employee visibility persists on
 *     the link metadata without losing workOrderId.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import type { Asset, AssetLink } from "./assetTypes";

const mocks = vi.hoisted(() => ({
  loadCompanyUuidMap: vi.fn(),
  createAssetLink: vi.fn(),
  archiveAssetLink: vi.fn(),
  listAssetLinks: vi.fn(),
  updateAssetLink: vi.fn(),
  uploadCustomerMedia: vi.fn(),
  listCustomerMedia: vi.fn(),
  resolveCustomerMediaSources: vi.fn(),
  customerMediaCategory: vi.fn(),
}));

vi.mock("@/lib/data/customerMigration", () => ({
  loadCompanyUuidMap: mocks.loadCompanyUuidMap,
}));

vi.mock("./assetRepository", () => ({
  createAssetLink: mocks.createAssetLink,
  archiveAssetLink: mocks.archiveAssetLink,
  listAssetLinks: mocks.listAssetLinks,
  updateAssetLink: mocks.updateAssetLink,
}));

vi.mock("./customerMedia", () => ({
  uploadCustomerMedia: mocks.uploadCustomerMedia,
  listCustomerMedia: mocks.listCustomerMedia,
  resolveCustomerMediaSources: mocks.resolveCustomerMediaSources,
  customerMediaCategory: mocks.customerMediaCategory,
}));

import {
  attachWorkOrderMedia,
  descriptorForArea,
  detachWorkOrderMedia,
  listWorkOrderPlacementLinks,
  placementVisibleToEmployee,
  reorderWorkOrderMedia,
  setWorkOrderMediaEmployeeVisibility,
  uploadWorkOrderMedia,
  type WorkOrderMediaArea,
} from "./workOrderMedia";

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
    name: "work_order-asset_1.webp",
    title: null,
    description: null,
    altText: null,
    tags: ["work_order"],
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
    metadata: { mediaCategory: "work_order" },
    createdBy: "usr_1",
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
    assetId: "asset_1",
    companyId: "cmp_1",
    entityType: "work_order",
    entityId: "wo_1",
    placementKey: "work_order_image",
    scope: "customer_internal",
    visibility: "internal",
    sortOrder: 0,
    isActive: true,
    metadata: {},
    createdBy: null,
    archivedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const HEADER: WorkOrderMediaArea = { surface: "header", workOrderId: "wo_1" };
const IMAGES: WorkOrderMediaArea = { surface: "images", workOrderId: "wo_1" };
const SERVICE_ROW: WorkOrderMediaArea = {
  surface: "service_row",
  workOrderId: "wo_1",
  serviceRowId: "row_1",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadCompanyUuidMap.mockResolvedValue(new Map([["cmp_1", "uuid-company-1"]]));
  mocks.listAssetLinks.mockResolvedValue([]);
  mocks.archiveAssetLink.mockResolvedValue(undefined);
  mocks.updateAssetLink.mockImplementation(async (id: string) => link({ id }));
  mocks.uploadCustomerMedia.mockResolvedValue(asset({ id: "asset_new" }));
  mocks.createAssetLink.mockImplementation(async (input: Record<string, unknown>) =>
    link({
      id: "lnk_new",
      assetId: input.assetId as string,
      entityType: input.entityType as AssetLink["entityType"],
      entityId: input.entityId as string,
      placementKey: input.placementKey as AssetLink["placementKey"],
      scope: input.scope as AssetLink["scope"],
      visibility: input.visibility as AssetLink["visibility"],
      sortOrder: input.sortOrder as number,
      metadata: input.metadata as Record<string, unknown>,
    }),
  );
});

describe("descriptorForArea", () => {
  it("maps the Images tab to a general work_order placement", () => {
    expect(descriptorForArea(IMAGES)).toEqual({
      entityType: "work_order",
      entityId: "wo_1",
      placementKey: "work_order_image",
      baseMetadata: {},
    });
  });

  it("maps the header strip to work_order_header_image", () => {
    expect(descriptorForArea(HEADER)).toEqual({
      entityType: "work_order",
      entityId: "wo_1",
      placementKey: "work_order_header_image",
      baseMetadata: {},
    });
  });

  it("maps a service row to its own entity + stamps workOrderId", () => {
    expect(descriptorForArea(SERVICE_ROW)).toEqual({
      entityType: "work_order_service_row",
      entityId: "row_1",
      placementKey: "work_order_service_row_image",
      baseMetadata: { workOrderId: "wo_1" },
    });
  });
});

describe("placementVisibleToEmployee", () => {
  it("defaults to true and only hides on an explicit false", () => {
    expect(placementVisibleToEmployee({ metadata: {} })).toBe(true);
    expect(placementVisibleToEmployee({ metadata: { visibleToEmployee: true } })).toBe(true);
    expect(placementVisibleToEmployee({ metadata: { visibleToEmployee: false } })).toBe(false);
  });
});

describe("listWorkOrderPlacementLinks", () => {
  it("queries the area's coordinates and returns links sorted by sort order", async () => {
    mocks.listAssetLinks.mockResolvedValueOnce([
      link({ id: "b", sortOrder: 2 }),
      link({ id: "a", sortOrder: 1 }),
    ]);
    const result = await listWorkOrderPlacementLinks({ companyId: "cmp_1", area: HEADER });
    expect(mocks.listAssetLinks).toHaveBeenCalledWith({
      entityType: "work_order",
      entityId: "wo_1",
      placementKey: "work_order_header_image",
      companyId: "cmp_1",
    });
    expect(result.map((l) => l.id)).toEqual(["a", "b"]);
  });
});

describe("attachWorkOrderMedia", () => {
  it("links a customer asset with denormalised scope/visibility at sort 0", async () => {
    await attachWorkOrderMedia({
      companyId: "cmp_1",
      area: HEADER,
      asset: asset({ id: "asset_1", scope: "customer_internal", visibility: "internal" }),
      createdBy: "usr_1",
    });
    expect(mocks.createAssetLink).toHaveBeenCalledTimes(1);
    const input = mocks.createAssetLink.mock.calls[0][0];
    expect(input.assetId).toBe("asset_1");
    expect(input.entityType).toBe("work_order");
    expect(input.entityId).toBe("wo_1");
    expect(input.placementKey).toBe("work_order_header_image");
    expect(input.scope).toBe("customer_internal");
    expect(input.visibility).toBe("internal");
    expect(input.sortOrder).toBe(0);
    expect(input.companyUuid).toBe("uuid-company-1");
    expect(input.metadata).toEqual({ visibleToEmployee: true });
  });

  it("computes the next sort order from existing links", async () => {
    mocks.listAssetLinks.mockResolvedValueOnce([
      link({ id: "x", assetId: "a", sortOrder: 0 }),
      link({ id: "y", assetId: "b", sortOrder: 1 }),
    ]);
    await attachWorkOrderMedia({
      companyId: "cmp_1",
      area: HEADER,
      asset: asset({ id: "asset_1" }),
    });
    expect(mocks.createAssetLink.mock.calls[0][0].sortOrder).toBe(2);
  });

  it("de-dupes: returns the existing link without creating a duplicate", async () => {
    const existing = link({ id: "lnk_existing", assetId: "asset_1" });
    mocks.listAssetLinks.mockResolvedValueOnce([existing]);
    const result = await attachWorkOrderMedia({
      companyId: "cmp_1",
      area: HEADER,
      asset: asset({ id: "asset_1" }),
    });
    expect(result).toBe(existing);
    expect(mocks.createAssetLink).not.toHaveBeenCalled();
  });

  it("stamps workOrderId in metadata for service-row placements", async () => {
    await attachWorkOrderMedia({
      companyId: "cmp_1",
      area: SERVICE_ROW,
      asset: asset({ id: "asset_1", scope: "customer_visible", visibility: "customer_visible" }),
    });
    const input = mocks.createAssetLink.mock.calls[0][0];
    expect(input.entityType).toBe("work_order_service_row");
    expect(input.entityId).toBe("row_1");
    expect(input.placementKey).toBe("work_order_service_row_image");
    expect(input.scope).toBe("customer_visible");
    expect(input.visibility).toBe("customer_visible");
    expect(input.metadata).toEqual({ workOrderId: "wo_1", visibleToEmployee: true });
  });

  it("rejects when no Supabase company maps to the legacy company id", async () => {
    mocks.loadCompanyUuidMap.mockResolvedValueOnce(new Map());
    await expect(
      attachWorkOrderMedia({ companyId: "cmp_unknown", area: HEADER, asset: asset() }),
    ).rejects.toThrow(/No Supabase company/);
    expect(mocks.createAssetLink).not.toHaveBeenCalled();
  });
});

describe("uploadWorkOrderMedia", () => {
  it("uploads as an admin/internal customer asset then links it to the area", async () => {
    const result = await uploadWorkOrderMedia({
      companyId: "cmp_1",
      customerId: "cust_1",
      area: IMAGES,
      processed: {} as never,
      category: "work_order",
      createdBy: "usr_1",
    });

    expect(mocks.uploadCustomerMedia).toHaveBeenCalledTimes(1);
    const up = mocks.uploadCustomerMedia.mock.calls[0][0];
    expect(up.companyId).toBe("cmp_1");
    expect(up.customerId).toBe("cust_1");
    expect(up.category).toBe("work_order");
    expect(up.visible).toBe(false); // customer-visible stays explicit

    expect(mocks.createAssetLink).toHaveBeenCalledTimes(1);
    const linkInput = mocks.createAssetLink.mock.calls[0][0];
    expect(linkInput.assetId).toBe("asset_new");
    expect(linkInput.placementKey).toBe("work_order_image");

    expect(result.asset.id).toBe("asset_new");
    expect(result.link.assetId).toBe("asset_new");
  });
});

describe("detachWorkOrderMedia", () => {
  it("archives the link only (asset untouched)", async () => {
    await detachWorkOrderMedia("lnk_1");
    expect(mocks.archiveAssetLink).toHaveBeenCalledWith("lnk_1");
  });
});

describe("reorderWorkOrderMedia", () => {
  it("writes one sort_order per link, matching the given order", async () => {
    await reorderWorkOrderMedia(["c", "a", "b"]);
    expect(mocks.updateAssetLink).toHaveBeenCalledTimes(3);
    expect(mocks.updateAssetLink).toHaveBeenNthCalledWith(1, "c", { sortOrder: 0 });
    expect(mocks.updateAssetLink).toHaveBeenNthCalledWith(2, "a", { sortOrder: 1 });
    expect(mocks.updateAssetLink).toHaveBeenNthCalledWith(3, "b", { sortOrder: 2 });
  });
});

describe("setWorkOrderMediaEmployeeVisibility", () => {
  it("persists visibleToEmployee on the link metadata without losing workOrderId", async () => {
    await setWorkOrderMediaEmployeeVisibility(
      link({ id: "lnk_1", metadata: { workOrderId: "wo_1", visibleToEmployee: true } }),
      false,
    );
    expect(mocks.updateAssetLink).toHaveBeenCalledWith("lnk_1", {
      metadata: { workOrderId: "wo_1", visibleToEmployee: false },
    });
  });
});
