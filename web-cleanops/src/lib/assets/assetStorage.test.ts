/**
 * Asset Center storage helpers (Phase 1) — pure bucket/path/validation logic.
 */
import {
  PRIVATE_BUCKET,
  PUBLIC_BUCKET,
  MAX_ASSET_BYTES,
  bucketForScope,
  isPublicScope,
  validateAssetFile,
  buildPublicWebsitePath,
  buildGlobalInternalPath,
  buildCompanyLibraryPath,
  buildCompanyCustomerPath,
} from "./assetStorage";

describe("bucketForScope / isPublicScope", () => {
  it("routes public scopes to the public bucket", () => {
    expect(bucketForScope("website_public")).toBe(PUBLIC_BUCKET);
    expect(bucketForScope("global_public")).toBe(PUBLIC_BUCKET);
    expect(isPublicScope("website_public")).toBe(true);
  });

  it("routes every other scope to the private bucket", () => {
    for (const scope of [
      "global_internal",
      "company_internal",
      "company_public",
      "customer_internal",
      "customer_visible",
      "protocol_internal",
      "work_order_internal",
      "case_internal",
    ] as const) {
      expect(bucketForScope(scope)).toBe(PRIVATE_BUCKET);
      expect(isPublicScope(scope)).toBe(false);
    }
  });
});

describe("validateAssetFile", () => {
  it("accepts a valid image", () => {
    expect(
      validateAssetFile({ assetType: "image", mimeType: "image/webp", fileSize: 1000 }),
    ).toEqual({ ok: true });
  });

  it("rejects a wrong MIME type for the asset type", () => {
    const res = validateAssetFile({
      assetType: "image",
      mimeType: "video/mp4",
      fileSize: 1000,
    });
    expect(res.ok).toBe(false);
  });

  it("rejects an empty or oversized file", () => {
    expect(validateAssetFile({ assetType: "image", mimeType: "image/webp", fileSize: 0 }).ok).toBe(false);
    expect(
      validateAssetFile({
        assetType: "video",
        mimeType: "video/mp4",
        fileSize: MAX_ASSET_BYTES + 1,
      }).ok,
    ).toBe(false);
  });

  it("accepts any MIME for the open 'attachment' / 'other' types", () => {
    expect(
      validateAssetFile({ assetType: "attachment", mimeType: "application/zip", fileSize: 10 }).ok,
    ).toBe(true);
  });
});

describe("path builders", () => {
  it("builds public website paths", () => {
    expect(buildPublicWebsitePath("login", "asset_1", "original.mp4")).toBe(
      "website/login/asset_1/original.mp4",
    );
  });

  it("builds private global-internal paths", () => {
    expect(buildGlobalInternalPath("asset_1", "original.pdf")).toBe(
      "global/internal/asset_1/original.pdf",
    );
  });

  it("uses the company UUID as the company path segment (storage RLS match)", () => {
    const uuid = "11111111-1111-4111-8111-111111111111";
    expect(buildCompanyLibraryPath(uuid, "asset_1", "original.webp")).toBe(
      `companies/${uuid}/library/asset_1/original.webp`,
    );
    expect(buildCompanyCustomerPath(uuid, "cus_9", "asset_1", "original.webp")).toBe(
      `companies/${uuid}/customers/cus_9/asset_1/original.webp`,
    );
  });
});
