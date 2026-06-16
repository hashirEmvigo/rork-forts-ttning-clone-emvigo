/**
 * Feature Registry — central catalog of optional functionality.
 *
 * As modules introduce optional functionality (Area Scoped Access, Customer
 * Owner, Customer Portal, Time Bank, Advanced Reporting, AI, etc.), each one
 * would otherwise grow its own ad-hoc activation logic. This registry is the
 * single place where such features are declared, so toggling and lookups stay
 * consistent across the platform.
 *
 * This is *foundation only*: it deliberately has no billing, subscriptions,
 * trials, marketplace, or Super Admin UI. It simply describes the features that
 * exist and their default state. Per-company enable/disable state is persisted
 * by the store ({@link isFeatureEnabled} / {@link setFeatureEnabled}).
 *
 * Everything here is deterministic and side-effect free.
 */

/** Stable identifiers for registered optional features. */
export type FeatureId =
  | "area_scoped_access"
  | "customer_owner"
  | "customer_portal"
  | "time_bank"
  | "multilingual"
  | "advanced_reporting"
  | "ai_features";

/** Broad grouping used to organize features in future settings/admin surfaces. */
export type FeatureCategory =
  | "access"
  | "customers"
  | "operations"
  | "reporting"
  | "localization"
  | "ai";

/** Declarative description of a single optional feature. */
export interface FeatureDefinition {
  /** Stable, machine-readable identifier. */
  id: FeatureId;
  /** Human-readable name for display. */
  name: string;
  /** Short explanation of what the feature does. */
  description: string;
  /** Grouping used to organize features. */
  category: FeatureCategory;
  /** Whether the feature is on by default when no company override exists. */
  defaultEnabled: boolean;
  /** Whether the feature needs configuration before it becomes useful. */
  requiresSetup: boolean;
  /** Optional in-app route to the feature's setup/management surface. */
  setupRoute?: string;
}

/**
 * The registered features. Adding a feature here is all that is required for it
 * to be discoverable via {@link listFeatures} / {@link getFeature} and toggleable
 * per company via the store helpers.
 */
const FEATURE_DEFINITIONS: readonly FeatureDefinition[] = Object.freeze([
  {
    id: "area_scoped_access",
    name: "Area Scoped Access",
    description:
      "Limit which customers and operational data a user can access based on their assigned areas.",
    category: "access",
    defaultEnabled: false,
    requiresSetup: true,
    setupRoute: "/settings/customer-assignment",
  },
  {
    id: "customer_owner",
    name: "Customer Owner",
    description:
      "Assign internal administrative owners responsible for each customer.",
    category: "customers",
    defaultEnabled: false,
    requiresSetup: false,
  },
  {
    id: "customer_portal",
    name: "Customer Portal",
    description:
      "Give customers portal access to view content, services and communications.",
    category: "customers",
    defaultEnabled: false,
    requiresSetup: true,
  },
  {
    id: "time_bank",
    name: "Time Bank",
    description: "Track accrued and used time balances for employees.",
    category: "operations",
    defaultEnabled: false,
    requiresSetup: false,
  },
  {
    id: "multilingual",
    name: "Multi-language",
    description: "Support multiple languages across the platform.",
    category: "localization",
    defaultEnabled: false,
    requiresSetup: false,
  },
  {
    id: "advanced_reporting",
    name: "Advanced Reporting",
    description:
      "Unlock extended analytics dimensions and richer reporting views.",
    category: "reporting",
    defaultEnabled: false,
    requiresSetup: false,
  },
  {
    id: "ai_features",
    name: "AI Features",
    description:
      "Enable AI-assisted recommendations, automation and insights.",
    category: "ai",
    defaultEnabled: false,
    requiresSetup: false,
  },
]);

/** Returns every registered feature definition (input order preserved). */
export function listFeatures(): readonly FeatureDefinition[] {
  return FEATURE_DEFINITIONS;
}

/** Looks up a single feature definition by id, or undefined when unknown. */
export function getFeature(id: FeatureId | string): FeatureDefinition | undefined {
  return FEATURE_DEFINITIONS.find((f) => f.id === id);
}

/** Type guard for a known {@link FeatureId}. */
export function isKnownFeatureId(id: string): id is FeatureId {
  return FEATURE_DEFINITIONS.some((f) => f.id === id);
}
