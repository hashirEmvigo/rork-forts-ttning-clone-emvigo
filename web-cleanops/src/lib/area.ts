import type { Area, Customer } from "@/types";

/**
 * Area — structured operational dimension helpers.
 *
 * Area is a real, company-scoped system dimension rather than a loose string.
 * These pure helpers normalize names for matching, resolve a customer's
 * structured area (preferring {@link Customer.areaId}, falling back to a
 * name-match against the legacy free-text {@link Customer.area}), and expose the
 * default seed names. Everything here is deterministic and side-effect free so
 * it can be reused across UI/store and unit-tested in isolation.
 */

/**
 * Default areas seeded for every company on first launch. English names keep the
 * system dimension consistent regardless of the company's locale.
 */
export const DEFAULT_AREA_NAMES: readonly string[] = [
  "Gothenburg",
  "Stockholm",
  "Malmö",
];

/** Normalizes an area name for case-insensitive, whitespace-tolerant matching. */
export function normalizeAreaName(name: string | undefined | null): string {
  return (name ?? "").trim().toLowerCase();
}

/** Returns only the active areas, preserving input order. */
export function activeAreas(areas: readonly Area[]): Area[] {
  return areas.filter((a) => a.isActive);
}

/**
 * Finds an area whose name matches the given free-text value (case-insensitive),
 * scoped to a company. Returns undefined when the value is empty or unmatched.
 */
export function matchAreaByName(
  areas: readonly Area[],
  companyId: string,
  rawName: string | undefined | null,
): Area | undefined {
  const target = normalizeAreaName(rawName);
  if (!target) return undefined;
  return areas.find(
    (a) => a.companyId === companyId && normalizeAreaName(a.name) === target,
  );
}

/**
 * Resolves the structured {@link Area} for a customer. Prefers the stored
 * {@link Customer.areaId}; if unset, falls back to matching the legacy free-text
 * {@link Customer.area} by name (so pre-migration data still resolves). Returns
 * undefined when no area can be resolved.
 */
export function resolveCustomerArea(
  customer: Pick<Customer, "companyId" | "areaId" | "area">,
  areas: readonly Area[],
): Area | undefined {
  if (customer.areaId) {
    const byId = areas.find((a) => a.id === customer.areaId);
    if (byId) return byId;
  }
  return matchAreaByName(areas, customer.companyId, customer.area);
}

/**
 * Canonical write-side normalizer for a customer's area fields. Given a chosen
 * {@link Area} id (possibly empty), returns the pair to persist:
 * - `areaId` is the canonical value (undefined when no area is chosen)
 * - `area` is the backward-compatible display mirror, only set when the id
 *   resolves to a real area. It is never written as an empty string — when no
 *   area is chosen `area` is `undefined` (omitted) rather than `""`.
 *
 * Shared by the create and update flows so both normalize area identically.
 */
export function resolveAreaWriteFields(
  areaId: string | undefined | null,
  areas: readonly Area[],
): { areaId: string | undefined; area: string | undefined } {
  const id = areaId || undefined;
  if (!id) return { areaId: undefined, area: undefined };
  const name = areas.find((a) => a.id === id)?.name;
  return { areaId: id, area: name || undefined };
}

/**
 * Display name for a customer's area, or "Not assigned" when none resolves.
 * Never returns a raw legacy free-text value unless it matched a real area.
 */
export function customerAreaLabel(
  customer: Pick<Customer, "companyId" | "areaId" | "area">,
  areas: readonly Area[],
): string {
  return resolveCustomerArea(customer, areas)?.name ?? "Not assigned";
}
