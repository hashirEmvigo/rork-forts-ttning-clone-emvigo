/**
 * Asset Center permission mirrors (Phase 1) — must match the SQL predicates in
 * migration 0055 (asset_is_readable / asset_is_manageable + the public policy).
 */
import {
  canCopyGlobalAsset,
  canManageAsset,
  canPublishPublicAsset,
  canReadAsset,
  type AssetAccessShape,
  type AssetViewerContext,
} from "./assetPermissions";

const SUPER: AssetViewerContext = { role: "super_admin", companyId: null };
const ADMIN_A: AssetViewerContext = { role: "company_admin", companyId: "cmp_a" };
const EMP_A: AssetViewerContext = { role: "employee", companyId: "cmp_a" };
const ADMIN_B: AssetViewerContext = { role: "company_admin", companyId: "cmp_b" };
const CUSTOMER_A: AssetViewerContext = {
  role: "customer",
  companyId: "cmp_a",
  customerId: "cus_1",
};
const PUBLIC: AssetViewerContext = { role: null };

const globalInternal: AssetAccessShape = {
  scope: "global_internal",
  visibility: "internal",
  companyId: null,
};
const websitePublic: AssetAccessShape = {
  scope: "website_public",
  visibility: "public",
  companyId: null,
};
const companyAInternal: AssetAccessShape = {
  scope: "company_internal",
  visibility: "internal",
  companyId: "cmp_a",
};
const customerVisibleA: AssetAccessShape = {
  scope: "customer_visible",
  visibility: "customer_visible",
  companyId: "cmp_a",
  customerId: "cus_1",
};

describe("canReadAsset", () => {
  it("public/anon can read only public assets", () => {
    expect(canReadAsset(PUBLIC, websitePublic)).toBe(true);
    expect(canReadAsset(PUBLIC, globalInternal)).toBe(false);
    expect(canReadAsset(PUBLIC, companyAInternal)).toBe(false);
  });

  it("super admin reads everything", () => {
    expect(canReadAsset(SUPER, globalInternal)).toBe(true);
    expect(canReadAsset(SUPER, companyAInternal)).toBe(true);
    expect(canReadAsset(SUPER, customerVisibleA)).toBe(true);
  });

  it("any signed-in user can browse the global library", () => {
    expect(canReadAsset(ADMIN_A, globalInternal)).toBe(true);
    expect(canReadAsset(EMP_A, globalInternal)).toBe(true);
  });

  it("company staff read only their own company's assets", () => {
    expect(canReadAsset(ADMIN_A, companyAInternal)).toBe(true);
    expect(canReadAsset(EMP_A, companyAInternal)).toBe(true);
    expect(canReadAsset(ADMIN_B, companyAInternal)).toBe(false);
  });

  it("a customer reads only their own customer-visible assets", () => {
    expect(canReadAsset(CUSTOMER_A, customerVisibleA)).toBe(true);
    // Internal company asset is not visible to the customer.
    expect(canReadAsset(CUSTOMER_A, companyAInternal)).toBe(false);
    // A different customer's visible asset is not readable.
    expect(
      canReadAsset(CUSTOMER_A, { ...customerVisibleA, customerId: "cus_2" }),
    ).toBe(false);
  });
});

describe("canManageAsset", () => {
  it("super admin manages everything", () => {
    expect(canManageAsset(SUPER, globalInternal)).toBe(true);
    expect(canManageAsset(SUPER, websitePublic)).toBe(true);
  });

  it("company admin manages own-company company/customer assets only", () => {
    expect(canManageAsset(ADMIN_A, companyAInternal)).toBe(true);
    expect(canManageAsset(ADMIN_A, customerVisibleA)).toBe(true);
    expect(canManageAsset(ADMIN_B, companyAInternal)).toBe(false);
  });

  it("company admin cannot manage global assets or publish public assets", () => {
    expect(canManageAsset(ADMIN_A, globalInternal)).toBe(false);
    expect(
      canManageAsset(ADMIN_A, { scope: "company_public", visibility: "public", companyId: "cmp_a" }),
    ).toBe(false);
  });

  it("employees cannot manage the library by default", () => {
    expect(canManageAsset(EMP_A, companyAInternal)).toBe(false);
  });
});

describe("copy + publish gates", () => {
  it("super admin and company admin can copy global assets; others cannot", () => {
    expect(canCopyGlobalAsset(SUPER)).toBe(true);
    expect(canCopyGlobalAsset(ADMIN_A)).toBe(true);
    expect(canCopyGlobalAsset(EMP_A)).toBe(false);
    expect(canCopyGlobalAsset(PUBLIC)).toBe(false);
  });

  it("only super admin can publish public website assets in Phase 1", () => {
    expect(canPublishPublicAsset(SUPER)).toBe(true);
    expect(canPublishPublicAsset(ADMIN_A)).toBe(false);
  });
});
