import type { Area, AreaScope, UserRole } from "@/types";

/**
 * Area Scoped Access — pure access-control helpers.
 *
 * Area Scoped Access limits which records a login may see based on the
 * operational {@link Area} a record belongs to. The login (User) is the access
 * subject; its {@link AreaScope} declares either all-area access or an explicit
 * set of area ids.
 *
 * Everything here is deterministic and side-effect free so it can be reused by
 * the store/UI and unit-tested in isolation. Crucially, the feature is gated by
 * a company-level flag: when Area Scoped Access is **inactive** every helper
 * falls back to granting full access, so existing behavior is unchanged.
 */

/** The safe default scope: access to every area in the company. */
export const ALL_AREAS_SCOPE: AreaScope = { mode: "all", areaIds: [] };

/**
 * Roles that are NEVER restricted by Area Scoped Access. Area scoping exists to
 * narrow what ordinary staff see; administrators are responsible for the whole
 * company (or platform) and must always see every record — including newly
 * created, area-less ones — regardless of any scope stored on their login.
 *
 * - `super_admin`: platform owner, sees across every company.
 * - `company_admin`: owns their company's full operational picture.
 *
 * Keep this the single source of truth so list views, detail guards and any
 * future scoping/RLS all agree on who bypasses area scoping.
 */
export function isAreaScopeExempt(role: UserRole | undefined | null): boolean {
  return role === "super_admin" || role === "company_admin";
}

/**
 * Normalizes a possibly-missing/legacy scope into a well-formed {@link AreaScope}.
 * Anything that is not an explicit `"selected"` scope resolves to all-area
 * access. Selected scopes get a de-duplicated, defined area id list.
 */
export function normalizeAreaScope(scope: AreaScope | undefined | null): AreaScope {
  if (!scope || scope.mode !== "selected") return { mode: "all", areaIds: [] };
  const areaIds = Array.isArray(scope.areaIds) ? scope.areaIds.filter(Boolean) : [];
  return { mode: "selected", areaIds: Array.from(new Set(areaIds)) };
}

/** True when the (normalized) scope grants access to every area. */
export function hasAllAreaAccess(scope: AreaScope | undefined | null): boolean {
  return normalizeAreaScope(scope).mode === "all";
}

/**
 * Resolves the area ids a scope can access: the sentinel `"all"` for all-area
 * access, otherwise the explicit (possibly empty) set of selected ids.
 */
export function accessibleAreaIds(
  scope: AreaScope | undefined | null,
): "all" | string[] {
  const normalized = normalizeAreaScope(scope);
  return normalized.mode === "all" ? "all" : normalized.areaIds;
}

/** Parameters shared by access checks: the company feature flag + the user scope. */
export interface AreaAccessContext {
  /** Company-level Area Scoped Access flag. When false, access is unrestricted. */
  enabled: boolean;
  /** The acting login's scope (legacy/missing scopes normalize to all-area). */
  scope: AreaScope | undefined | null;
}

/**
 * Whether a login may access a record belonging to `areaId`.
 *
 * Rules (only applied when the feature is enabled):
 * - all-area scope → always true.
 * - selected scope with empty ids → always false (no scoped access).
 * - selected scope → true only if `areaId` is in the set.
 * - a record without an `areaId` → visible to all-area scopes only.
 */
export function canAccessArea(
  ctx: AreaAccessContext,
  areaId: string | undefined | null,
): boolean {
  if (!ctx.enabled) return true;
  const accessible = accessibleAreaIds(ctx.scope);
  if (accessible === "all") return true;
  if (!areaId) return false;
  return accessible.includes(areaId);
}

/**
 * Filters records by the acting login's area scope, reading each record's area
 * id via `getAreaId`. When the feature is inactive (or the scope is all-area)
 * the input list is returned unchanged.
 */
export function filterByAreaScope<T>(
  records: readonly T[],
  getAreaId: (record: T) => string | undefined | null,
  ctx: AreaAccessContext,
): T[] {
  if (!ctx.enabled || hasAllAreaAccess(ctx.scope)) return [...records];
  return records.filter((record) => canAccessArea(ctx, getAreaId(record)));
}

/**
 * Compact, human-readable summary of an area scope for list/detail display:
 * "All areas", a single area name, "A + B", or "N areas". Unknown ids are
 * skipped; an empty selected scope reads as "No areas".
 */
export function areaScopeSummary(
  scope: AreaScope | undefined | null,
  areas: readonly Area[],
): string {
  const normalized = normalizeAreaScope(scope);
  if (normalized.mode === "all") return "All areas";
  const names = normalized.areaIds
    .map((id) => areas.find((a) => a.id === id)?.name)
    .filter((n): n is string => Boolean(n))
    .sort((a, b) => a.localeCompare(b));
  if (names.length === 0) return "No areas";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} + ${names[1]}`;
  return `${names.length} areas`;
}
