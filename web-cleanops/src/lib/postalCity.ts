import type { Area, CustomerAddress, PostalCity } from "@/types";

/**
 * Postal City — structured postal-city → area mapping helpers.
 *
 * A {@link PostalCity} is a company-scoped name (e.g. Mölndal, Partille) that
 * maps to an operational {@link Area}. Admins manage the list manually — there
 * is no external postal-code API. These pure helpers normalize names for
 * matching, expose a display label, filter active cities, and resolve the
 * connected (active) area for a city. Everything here is deterministic and
 * side-effect free so it can be reused across UI/store and unit-tested.
 */

/** Normalizes a postal-city name for case-insensitive, whitespace-tolerant matching. */
export function normalizePostalCityName(name: string | undefined | null): string {
  return (name ?? "").trim().toLowerCase();
}

/** Display label for a postal city. */
export function postalCityLabel(postalCity: PostalCity | undefined | null): string {
  return postalCity?.name?.trim() ?? "";
}

/** Returns only the active postal cities, preserving input order. */
export function activePostalCities(cities: readonly PostalCity[]): PostalCity[] {
  return cities.filter((c) => c.isActive);
}

/**
 * Resolves the structured {@link PostalCity} linked to an address via its
 * explicit `postalCityId`. Returns undefined when unset or unresolved. Never
 * matches on legacy free-text — that's intentionally an explicit link only.
 */
export function addressPostalCity(
  address: Pick<CustomerAddress, "postalCityId"> | undefined | null,
  cities: readonly PostalCity[],
): PostalCity | undefined {
  const id = address?.postalCityId;
  if (!id) return undefined;
  return cities.find((c) => c.id === id);
}

/**
 * The single display-city resolver for an address, by strict priority:
 *  1. the explicitly linked {@link PostalCity}'s name (structured),
 *  2. empty string.
 *
 * The structured postal-city link is the only source of an address's city.
 * There is no free-text fallback.
 */
export function addressCityLabel(
  address: Pick<CustomerAddress, "postalCityId"> | undefined | null,
  cities: readonly PostalCity[],
): string {
  const linked = addressPostalCity(address, cities);
  return linked ? postalCityLabel(linked) : "";
}

/**
 * Resolves the postal-city id an address's edit form should preselect, WITHOUT
 * mutating stored data: the explicit `postalCityId` when it still points to a
 * known city, else undefined.
 */
export function resolveAddressPostalCityId(
  address: Pick<CustomerAddress, "postalCityId"> | undefined | null,
  cities: readonly PostalCity[],
): string | undefined {
  const explicit = address?.postalCityId;
  if (explicit && cities.some((c) => c.id === explicit)) return explicit;
  return undefined;
}

/**
 * Resolves the {@link Area} a postal city maps to. Returns the area only when it
 * exists AND is active — an archived or missing area never produces an
 * auto-assignment, so callers can safely fall back to a warning. Returns
 * undefined when the city is null or its area can't be resolved.
 */
export function resolvePostalCityArea(
  postalCity: PostalCity | undefined | null,
  areas: readonly Area[],
): Area | undefined {
  if (!postalCity?.areaId) return undefined;
  const area = areas.find((a) => a.id === postalCity.areaId);
  if (!area || !area.isActive) return undefined;
  return area;
}
