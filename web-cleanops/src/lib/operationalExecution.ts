/**
 * Operational Execution — entitlement bridge (Phase 1 foundation).
 *
 * The Operational Execution architecture document describes module entitlement
 * state as `active | trial | inactive`. CleanOps does NOT use a separate flat
 * entitlement model — it uses the existing bundle-first resolver, the
 * {@link ServiceFeatureKey} union and {@link SERVICE_FEATURE_REGISTRY}. This
 * module is the thin, pure bridge between the two vocabularies, plus typed
 * helpers over the Operational Execution feature keys.
 *
 * NO new entitlement model, no resolver, no persistence — this only maps names
 * and narrows keys so later phases gate UI through the SAME resolver every
 * other feature already uses.
 */

import type { ServiceEntitlementStatus, ServiceFeatureKey } from "@/types";
import { OPERATIONAL_EXECUTION_FEATURE_KEYS } from "@/lib/serviceRegistry";

/**
 * The architecture document's entitlement vocabulary. Mapped onto the
 * platform's {@link ServiceEntitlementStatus} via
 * {@link mapEntitlementStateToStatus}.
 */
export type ArchitectureEntitlementState = "active" | "trial" | "inactive";

/**
 * Maps the architecture's entitlement state onto the platform's tri-state
 * {@link ServiceEntitlementStatus}:
 *  - `active`   → `enabled`
 *  - `trial`    → `trial`
 *  - `inactive` → `disabled`
 *
 * Pure and total. Use this when reading the architecture's language so the rest
 * of the codebase keeps speaking the existing resolver's status vocabulary.
 */
export function mapEntitlementStateToStatus(
  state: ArchitectureEntitlementState,
): ServiceEntitlementStatus {
  switch (state) {
    case "active":
      return "enabled";
    case "trial":
      return "trial";
    case "inactive":
      return "disabled";
  }
}

/** The reverse mapping, for surfacing the architecture vocabulary in UI/labels. */
export function mapStatusToEntitlementState(
  status: ServiceEntitlementStatus,
): ArchitectureEntitlementState {
  switch (status) {
    case "enabled":
      return "active";
    case "trial":
      return "trial";
    case "disabled":
      return "inactive";
  }
}

/** Set form of {@link OPERATIONAL_EXECUTION_FEATURE_KEYS} for O(1) membership. */
const OPERATIONAL_EXECUTION_KEY_SET: ReadonlySet<ServiceFeatureKey> = new Set(
  OPERATIONAL_EXECUTION_FEATURE_KEYS,
);

/** Type guard: is this feature key part of the Operational Execution domain? */
export function isOperationalExecutionFeature(key: ServiceFeatureKey): boolean {
  return OPERATIONAL_EXECUTION_KEY_SET.has(key);
}

export { OPERATIONAL_EXECUTION_FEATURE_KEYS };
