/**
 * Asset Center — permission helpers (Phase 1 foundation).
 *
 * Pure, client-side mirrors of the server RLS predicates in migration 0055
 * (`asset_is_readable` / `asset_is_manageable`). The DATABASE is the real
 * security boundary — these exist only so the future UI can hide actions that
 * RLS would reject, and to keep that logic in one place.
 *
 * The decisions deliberately match the SQL so behaviour is predictable:
 *   • super_admin → manage/read everything.
 *   • company_admin → manage own-company company/customer assets; cannot publish
 *     public assets; cannot touch global/website originals.
 *   • employee → read own-company assets; no library management by default.
 *   • customer → read only their own customer-visible assets (off until customer
 *     auth is wired — see current_customer_id() in 0055).
 *   • public/anon → read only `visibility === "public"`.
 */
import type {
  Asset,
  AssetScope,
  AssetVisibility,
} from "./assetTypes";

/** The minimal viewer context the predicates need (role + company/customer scope). */
export interface AssetViewerContext {
  /** Base role; null/undefined = unauthenticated public visitor. */
  role?: "super_admin" | "company_admin" | "employee" | "customer" | null;
  /** App-facing company id the viewer belongs to (null for super_admin). */
  companyId?: string | null;
  /** App-facing customer id the viewer is, when role === "customer". */
  customerId?: string | null;
}

/** Subset of asset fields the decisions depend on. */
export interface AssetAccessShape {
  companyId?: string | null;
  customerId?: string | null;
  scope: AssetScope;
  visibility: AssetVisibility;
}

const GLOBAL_SCOPES: ReadonlySet<AssetScope> = new Set<AssetScope>([
  "global_internal",
  "global_public",
]);

const COMPANY_MANAGEABLE_SCOPES: ReadonlySet<AssetScope> = new Set<AssetScope>([
  "company_internal",
  "company_public",
  "customer_internal",
  "customer_visible",
]);

/** Mirror of `asset_is_readable` + the public SELECT policy. */
export function canReadAsset(
  viewer: AssetViewerContext,
  asset: AssetAccessShape,
): boolean {
  // Public is world-readable (also the anon path).
  if (asset.visibility === "public") return true;

  const role = viewer.role ?? null;
  if (role === null) return false; // unauthenticated → public only

  if (role === "super_admin") return true;

  // Global library is browseable by any signed-in user (restricted stays SA-only).
  if (GLOBAL_SCOPES.has(asset.scope) && asset.visibility !== "restricted") return true;
  if (asset.scope === "website_public") return true;

  const sameCompany =
    asset.companyId != null && asset.companyId === (viewer.companyId ?? null);

  if (role === "company_admin" || role === "employee") {
    return sameCompany;
  }

  if (role === "customer") {
    return (
      asset.visibility === "customer_visible" &&
      sameCompany &&
      asset.customerId != null &&
      asset.customerId === (viewer.customerId ?? null)
    );
  }

  return false;
}

/** Mirror of `asset_is_manageable` (insert/update gate). */
export function canManageAsset(
  viewer: AssetViewerContext,
  asset: AssetAccessShape,
): boolean {
  const role = viewer.role ?? null;
  if (role === "super_admin") return true;
  if (role !== "company_admin") return false;
  return (
    asset.companyId != null &&
    asset.companyId === (viewer.companyId ?? null) &&
    COMPANY_MANAGEABLE_SCOPES.has(asset.scope) &&
    asset.visibility !== "public"
  );
}

/** Whether the viewer may copy a global asset into a company library (later phase). */
export function canCopyGlobalAsset(viewer: AssetViewerContext): boolean {
  const role = viewer.role ?? null;
  return role === "super_admin" || role === "company_admin";
}

/** Whether the viewer may publish/author public website assets (Phase 1: SA only). */
export function canPublishPublicAsset(viewer: AssetViewerContext): boolean {
  return (viewer.role ?? null) === "super_admin";
}

/** Convenience: read decision against a full {@link Asset}. */
export function canReadAssetRecord(
  viewer: AssetViewerContext,
  asset: Asset,
): boolean {
  return canReadAsset(viewer, asset);
}
