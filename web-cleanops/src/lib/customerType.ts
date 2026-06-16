import {
  CUSTOMER_TYPE_LABELS,
  CUSTOMER_TYPES,
  type CustomerSegment,
  type CustomerType,
} from "@/types";

/**
 * Customer Type — core platform classification helpers.
 *
 * Customer Type is a foundational, fixed (hardcoded) system dimension rather
 * than a display label. These pure helpers normalize legacy data, map the type
 * onto the internal recommendation {@link CustomerSegment}, and expose the
 * recommended services / protocols per type so any module (work orders,
 * checklists, portal, reporting, AI/automation) can consume one source of truth.
 *
 * Everything here is deterministic and side-effect free so it can be reused by
 * UI and unit-tested in isolation.
 */

/** Narrow an arbitrary value to a known {@link CustomerType}. */
export function isCustomerType(value: unknown): value is CustomerType {
  return (
    typeof value === "string" &&
    (CUSTOMER_TYPES as readonly string[]).includes(value)
  );
}

/**
 * Legacy free-text → fixed {@link CustomerType} mapping. Older customers stored
 * free-form labels (e.g. "Commercial", "Residential", "Privat", "Office",
 * "Move-out"). This maps the known historical values onto the fixed set so
 * existing data keeps a meaningful classification after the migration.
 *
 * Returns `undefined` for unknown / empty values so callers can decide how to
 * treat unclassified legacy records (no recommendations are shown for them).
 */
export function normalizeCustomerType(
  raw: string | undefined | null,
): CustomerType | undefined {
  if (raw == null) return undefined;
  const value = raw.trim().toLowerCase();
  if (value === "") return undefined;
  if (isCustomerType(value)) return value;

  // Commercial / business synonyms (incl. Nordic labels used in demo data).
  if (
    /(commercial|office|business|b2b|f[oö]retag|bedrift|foretak|erhverv|facility|facilities|property)/.test(
      value,
    )
  ) {
    return "commercial";
  }
  // Private / residential household synonyms.
  if (/(private|privat|residential|home|household|domestic|b2c|apartment)/.test(value)) {
    return "private";
  }
  // One-time / single-event synonyms.
  if (/(one[\s_-]?time|move[\s_-]?out|single|deep\s?clean)/.test(value)) {
    return "one_time";
  }
  // Specialized projects / services.
  if (/(special|specialized|project|sanit|floor\s?care|custom)/.test(value)) {
    return "special_services";
  }
  return undefined;
}

/**
 * Maps a {@link CustomerType} onto the internal recommendation
 * {@link CustomerSegment}. Customer Type is the source of truth; segment is the
 * derived axis the template recommendation layer already understands.
 */
export function segmentForCustomerType(
  type: CustomerType | undefined,
): CustomerSegment | undefined {
  switch (type) {
    case "commercial":
    case "special_services":
      return "b2b";
    case "private":
      return "b2c";
    case "one_time":
      return "one_time";
    default:
      return undefined;
  }
}

/** Display label for a customer type (or em dash placeholder when unset). */
export function customerTypeLabel(type: CustomerType | undefined): string {
  return type ? CUSTOMER_TYPE_LABELS[type] : "—";
}

/**
 * Recommended services per {@link CustomerType}. A pure data foundation that
 * future Work Order recommendation UIs and automation can read. These are
 * suggestions only — they never restrict what can be added to a work order.
 */
export const RECOMMENDED_SERVICES_BY_TYPE: Record<CustomerType, readonly string[]> = {
  commercial: [
    "Office Cleaning",
    "Property Maintenance",
    "Stairwell Cleaning",
    "Facility Services",
  ],
  private: [
    "Home Cleaning",
    "Window Cleaning",
    "Deep Cleaning",
    "Move-Out Cleaning",
  ],
  one_time: ["Move-Out Cleaning", "Deep Cleaning", "Single-Event Cleaning"],
  special_services: [
    "Floor Care",
    "Sanitization",
    "Specialized Projects",
    "Custom Service Packages",
  ],
};

/**
 * Recommended checklist / protocol starting points per {@link CustomerType}.
 * Naming is descriptive (not linked to specific template ids) so this stays a
 * stable suggestion layer for the template picker and future automation.
 */
export const RECOMMENDED_PROTOCOLS_BY_TYPE: Record<CustomerType, readonly string[]> = {
  commercial: ["Office Cleaning Checklist", "Facility Inspection Checklist"],
  private: ["Home Cleaning Checklist", "Deep Cleaning Protocol"],
  one_time: ["Move-Out Cleaning Checklist", "Deep Cleaning Protocol"],
  special_services: [
    "Specialized Service Protocols",
    "Custom Inspection Checklists",
  ],
};

/** Recommended services for a customer type (empty when unclassified). */
export function recommendedServicesForType(
  type: CustomerType | undefined,
): readonly string[] {
  return type ? RECOMMENDED_SERVICES_BY_TYPE[type] : [];
}

/** Recommended protocols for a customer type (empty when unclassified). */
export function recommendedProtocolsForType(
  type: CustomerType | undefined,
): readonly string[] {
  return type ? RECOMMENDED_PROTOCOLS_BY_TYPE[type] : [];
}
