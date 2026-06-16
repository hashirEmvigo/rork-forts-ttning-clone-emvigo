/**
 * Service → Module availability bridge (WAVE-003H-R).
 *
 * The single, narrow seam that lets a Super Admin **service entitlement** decide
 * a Company Admin **module's availability**. It connects two existing,
 * independent models WITHOUT merging them or creating a third access system:
 *
 *   1. Service entitlement  — `@/lib/serviceRegistry` resolves a company's
 *      effective tri-state status for a {@link ServiceFeatureKey}
 *      (`disabled` | `trial` | `enabled`) from global availability + company
 *      entitlement.
 *   2. Module access         — `@/lib/moduleAccess` collapses GLOBAL status +
 *      COMPANY available + COMPANY enabled into a {@link CompanyModuleState}.
 *
 * For a bridged module the bridge feeds Layer 2 (COMPANY available) of the
 * module access model from the service entitlement instead of the raw
 * `company_modules.available` flag. It NEVER enables the module (Layer 3, the
 * Company Admin local toggle, stays separate) and NEVER bypasses the module
 * access resolver — it only supplies the availability input.
 *
 * Scope is an explicit allow-list (see {@link SERVICE_MODULE_BRIDGE}). A
 * service's diagnostic/display `affects` metadata can therefore never silently
 * become a runtime availability bridge; only the entries listed here do.
 *
 * Pure and storage-agnostic so it is exhaustively unit-testable and reusable by
 * the context, the company/super-admin module panels and future invoicing.
 */
import { getModuleDefinition } from "@/lib/modules";
import {
  ADMIN_REQUESTS_KEY,
  getServiceDefinition,
  resolveEffectiveCompanyStatus,
} from "@/lib/serviceRegistry";
import type {
  CompanyServiceEntitlement,
  ServiceFeatureKey,
  ServiceGlobalEntitlement,
  SystemSettings,
} from "@/types";

/**
 * One Service → Module availability bridge: when a company's EFFECTIVE
 * entitlement for {@link serviceKey} is `enabled` or `trial`, the module
 * {@link moduleId} is offered/available in Company Admin Settings → Modules.
 */
export interface ServiceModuleBridgeEntry {
  serviceKey: ServiceFeatureKey;
  moduleId: string;
}

/**
 * The explicit, allow-listed Service → Module availability bridges.
 *
 * Scope (WAVE-003H-R): Admin Requests only — the `admin_requests` service
 * offers the `admin-requests` module. This is intentionally an explicit
 * allow-list, NOT a broad derivation from every registry `affects` entry, so a
 * service's diagnostic/display `affects` metadata can never silently turn into a
 * runtime availability bridge.
 *
 * A future Employee & Customer Requests service can extend this list with the
 * same pattern (`{ serviceKey: "employee_customer_requests", moduleId:
 * "employee-customer-requests" }`). It is a SEPARATE product and is deliberately
 * NOT registered here.
 */
export const SERVICE_MODULE_BRIDGE: readonly ServiceModuleBridgeEntry[] = [
  { serviceKey: ADMIN_REQUESTS_KEY, moduleId: "admin-requests" },
];

/**
 * The service key whose entitlement governs a module's availability, or
 * `undefined` when the module has no bridge (the common case).
 */
export function getServiceForBridgedModule(
  moduleId: string,
): ServiceFeatureKey | undefined {
  return SERVICE_MODULE_BRIDGE.find((b) => b.moduleId === moduleId)?.serviceKey;
}

/**
 * The module id offered by a service's entitlement, or `undefined` when the
 * service bridges no module.
 */
export function getBridgedModuleForService(
  serviceKey: ServiceFeatureKey,
): string | undefined {
  return SERVICE_MODULE_BRIDGE.find((b) => b.serviceKey === serviceKey)?.moduleId;
}

/** Whether a module's availability is governed by a service entitlement bridge. */
export function isBridgedModule(moduleId: string): boolean {
  return SERVICE_MODULE_BRIDGE.some((b) => b.moduleId === moduleId);
}

/** The entitlement inputs needed to resolve a company's effective service status. */
export interface ModuleEntitlementAvailabilityOpts {
  systemSettings: SystemSettings;
  globalEntitlements: ServiceGlobalEntitlement[];
  companyEntitlements: CompanyServiceEntitlement[];
}

/**
 * Resolves the entitlement-derived availability for a module under the
 * Service → Module bridge — the value the module access resolver consumes as
 * Layer 2 (COMPANY available).
 *
 *  - Returns `undefined` for modules with NO bridge, so the module access
 *    resolver falls back to the raw `company_modules.available` flag and every
 *    un-bridged module keeps its exact existing behavior.
 *  - For a bridged module, returns `true` when the company's EFFECTIVE service
 *    status is `enabled` or `trial` (global availability AND company entitlement
 *    both satisfied), otherwise `false`.
 *
 * This only governs Layer 2 (availability): it never enables the module (Layer
 * 3, the Company Admin local toggle, stays separate) and never overrides Layer 1
 * (global module status still wins inside the access resolver).
 */
export function resolveModuleEntitlementAvailability(
  moduleId: string,
  companyId: string,
  opts: ModuleEntitlementAvailabilityOpts,
): boolean | undefined {
  const serviceKey = getServiceForBridgedModule(moduleId);
  if (!serviceKey) return undefined;
  return resolveEffectiveCompanyStatus(serviceKey, companyId, opts) !== "disabled";
}

/** A consistency problem between a bridge entry and the registry/module models. */
export interface ServiceModuleBridgeIssue {
  serviceKey: ServiceFeatureKey;
  moduleId: string;
  kind: "unknown-service" | "unknown-module" | "affects-mismatch";
  message: string;
}

/**
 * Validates that every bridge entry stays consistent with the existing models:
 *  - the service exists in `SERVICE_FEATURE_REGISTRY`,
 *  - the module exists in `MODULE_DEFINITIONS`,
 *  - the service's registry `affects` metadata already declares that module
 *    (so the runtime bridge can never silently drift from the declared seam).
 *
 * Diagnostic only — pure, with NO effect on runtime access. Use it in tests to
 * guard the allow-list against the registry and the module catalogue.
 */
export function validateServiceModuleBridge(
  bridge: readonly ServiceModuleBridgeEntry[] = SERVICE_MODULE_BRIDGE,
): ServiceModuleBridgeIssue[] {
  const issues: ServiceModuleBridgeIssue[] = [];
  for (const entry of bridge) {
    const def = getServiceDefinition(entry.serviceKey);
    if (!def) {
      issues.push({
        serviceKey: entry.serviceKey,
        moduleId: entry.moduleId,
        kind: "unknown-service",
        message: `Bridge references unknown service “${entry.serviceKey}”.`,
      });
      continue;
    }
    if (!getModuleDefinition(entry.moduleId)) {
      issues.push({
        serviceKey: entry.serviceKey,
        moduleId: entry.moduleId,
        kind: "unknown-module",
        message: `Bridge for “${entry.serviceKey}” references unknown module “${entry.moduleId}”.`,
      });
    }
    const declaresModule = (def.affects ?? []).some(
      (s) => s.kind === "module" && s.moduleId === entry.moduleId,
    );
    if (!declaresModule) {
      issues.push({
        serviceKey: entry.serviceKey,
        moduleId: entry.moduleId,
        kind: "affects-mismatch",
        message: `Service “${entry.serviceKey}” does not declare module “${entry.moduleId}” in its registry \`affects\` metadata.`,
      });
    }
  }
  return issues;
}
