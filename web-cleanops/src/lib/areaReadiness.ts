import type { Area, Customer, PostalCity } from "@/types";
import { resolveCustomerArea } from "./area";
import { resolvePostalCityArea } from "./postalCity";

/**
 * Area Readiness — overview + bulk-suggestion helpers.
 *
 * These pure helpers tell a Company Admin how close the company is to being
 * "Area-ready" (so {@link import("./areaScopeActivation")} Area Scoped Access can
 * be enabled) and make it safe to clean up customers that are missing a
 * structured Area but already have a Postal City that maps to one.
 *
 * A customer falls into exactly one readiness bucket:
 * - `has`       — already resolves to an Area (structured {@link Customer.areaId}
 *                 or legacy free-text matched to a real area).
 * - `suggested` — no resolved Area, but its Postal City maps to an *active* Area,
 *                 so a one-click "Apply" can fix it.
 * - `manual`    — no resolved Area and no usable Postal City suggestion, so an
 *                 admin must pick an Area by hand.
 *
 * Nothing here mutates data or invents an "Unassigned" area — suggestions are
 * only ever applied by explicit user action. Everything is deterministic and
 * side-effect free so it can be reused across UI/store and unit-tested.
 */

/** Which Area-readiness bucket a single customer is in. */
export type CustomerAreaReadiness = "has" | "suggested" | "manual";

/**
 * The active {@link Area} a customer's Postal City maps to, or undefined when the
 * customer has no postal city, the city is unknown, or its area is inactive/missing.
 */
export function resolveSuggestedArea(
  customer: Pick<Customer, "postalCityId">,
  areas: readonly Area[],
  postalCities: readonly PostalCity[],
): Area | undefined {
  if (!customer.postalCityId) return undefined;
  const city = postalCities.find((c) => c.id === customer.postalCityId);
  if (!city) return undefined;
  return resolvePostalCityArea(city, areas);
}

/**
 * Classifies a customer into a readiness bucket. Customers that already resolve
 * to an Area are `has`; otherwise `suggested` when a Postal City offers an active
 * area, else `manual`.
 */
export function classifyCustomerAreaReadiness(
  customer: Pick<Customer, "companyId" | "areaId" | "area" | "postalCityId">,
  areas: readonly Area[],
  postalCities: readonly PostalCity[],
): CustomerAreaReadiness {
  if (resolveCustomerArea(customer, areas)) return "has";
  return resolveSuggestedArea(customer, areas, postalCities) ? "suggested" : "manual";
}

/** Compact, UI-ready counts describing how Area-ready a company's customers are. */
export interface AreaReadinessSummary {
  /** Active areas configured for the company. */
  areasConfigured: number;
  /** Active postal cities configured for the company. */
  postalCitiesConfigured: number;
  /** Customers that do not resolve to any Area. */
  customersWithoutArea: number;
  /** Subset of the above whose Postal City maps to an active Area. */
  customersWithSuggestedArea: number;
  /** Subset of the above with no usable Postal City → Area suggestion. */
  customersRequiringManualReview: number;
  /** True when the Area Scoped Access activation pre-check passes. */
  areaScopedAccessReady: boolean;
}

/** Inputs for {@link buildAreaReadinessSummary}. Pass company-scoped collections. */
export interface AreaReadinessInput {
  customers: readonly Customer[];
  areas: readonly Area[];
  postalCities: readonly PostalCity[];
  /**
   * Whether the Area Scoped Access activation pre-check currently passes. The
   * caller supplies this so readiness numbers stay consistent with the existing
   * pre-check rather than re-deriving "operationally active" here.
   */
  areaScopedAccessReady: boolean;
}

/**
 * Builds the Area Readiness summary for a company. `customersWithoutArea` always
 * equals `customersWithSuggestedArea + customersRequiringManualReview`.
 */
export function buildAreaReadinessSummary(input: AreaReadinessInput): AreaReadinessSummary {
  const { customers, areas, postalCities, areaScopedAccessReady } = input;

  let withSuggestion = 0;
  let manualReview = 0;
  for (const customer of customers) {
    const bucket = classifyCustomerAreaReadiness(customer, areas, postalCities);
    if (bucket === "suggested") withSuggestion += 1;
    else if (bucket === "manual") manualReview += 1;
  }

  return {
    areasConfigured: areas.filter((a) => a.isActive).length,
    postalCitiesConfigured: postalCities.filter((c) => c.isActive).length,
    customersWithoutArea: withSuggestion + manualReview,
    customersWithSuggestedArea: withSuggestion,
    customersRequiringManualReview: manualReview,
    areaScopedAccessReady,
  };
}

/** A single applicable Postal City → Area suggestion for a customer. */
export interface AreaSuggestion {
  customerId: string;
  customerName: string;
  areaId: string;
  areaName: string;
}

/**
 * Returns the customers whose missing Area can be safely auto-filled from their
 * Postal City — i.e. they currently resolve to no Area and their Postal City maps
 * to exactly one active Area. Customers that already have an Area are never
 * included, so applying these can never overwrite an existing assignment.
 */
export function getApplicableAreaSuggestions(
  customers: readonly Customer[],
  areas: readonly Area[],
  postalCities: readonly PostalCity[],
): AreaSuggestion[] {
  const suggestions: AreaSuggestion[] = [];
  for (const customer of customers) {
    if (resolveCustomerArea(customer, areas)) continue; // already has an Area
    const area = resolveSuggestedArea(customer, areas, postalCities);
    if (!area) continue;
    suggestions.push({
      customerId: customer.id,
      customerName: customer.name,
      areaId: area.id,
      areaName: area.name,
    });
  }
  return suggestions;
}
