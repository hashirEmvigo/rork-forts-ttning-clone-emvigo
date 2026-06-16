import {
  PAYROLL_EXPORT_TARGETS,
  type PayrollExportCapability,
  type PayrollExportProfile,
  type PayrollExportRun,
  type PayrollExportTargetKey,
} from "@/types";

import { capabilityKey } from "./payrollExportStore";
import { isPayrollExportTargetImplemented } from "./payroll/registry";

/**
 * Payroll Export resolver — the read/lookup layer.
 *
 * Mirrors the cached-resolver pattern used by other Settings modules
 * ({@link timeCodeResolver.ts}, the entitlement resolver): indexes are built once
 * from the persisted lists, then every lookup is O(1). Everything is pure and
 * side-effect free, so it is reusable by the context, UI and tests.
 */

/** O(1) capability lookup keyed by `company::target`. */
export interface PayrollCapabilityIndex {
  byKey: ReadonlyMap<string, PayrollExportCapability>;
}

export function buildCapabilityIndex(
  capabilities: readonly PayrollExportCapability[],
): PayrollCapabilityIndex {
  const byKey = new Map<string, PayrollExportCapability>();
  for (const cap of capabilities) byKey.set(capabilityKey(cap.companyId, cap.target), cap);
  return { byKey };
}

/**
 * Whether a company is entitled to a payroll export target (Super-Admin enabled).
 * Targets default to disabled when no capability record exists.
 */
export function isTargetEnabledForCompany(
  index: PayrollCapabilityIndex,
  companyId: string,
  target: PayrollExportTargetKey,
): boolean {
  return index.byKey.get(capabilityKey(companyId, target))?.enabled === true;
}

/**
 * The export targets a company admin may use: enabled for the company. When
 * `onlyImplemented` is true, stub (unbuilt) adapters are excluded — useful for
 * the "run export" surface where only working adapters can produce output.
 */
export function availableTargetsForCompany(
  index: PayrollCapabilityIndex,
  companyId: string,
  options?: { onlyImplemented?: boolean },
): PayrollExportTargetKey[] {
  return PAYROLL_EXPORT_TARGETS.map((t) => t.value).filter((target) => {
    if (!isTargetEnabledForCompany(index, companyId, target)) return false;
    if (options?.onlyImplemented && !isPayrollExportTargetImplemented(target)) return false;
    return true;
  });
}

/** Profiles belonging to a company, in stable creation order. */
export function profilesForCompany(
  profiles: readonly PayrollExportProfile[],
  companyId: string,
): PayrollExportProfile[] {
  return profiles
    .filter((p) => p.companyId === companyId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * The profiles a company admin may actually run an export with: company-owned,
 * active, the target still entitled, and backed by an implemented adapter.
 */
export function runnableProfiles(
  profiles: readonly PayrollExportProfile[],
  index: PayrollCapabilityIndex,
  companyId: string,
): PayrollExportProfile[] {
  return profilesForCompany(profiles, companyId).filter(
    (p) =>
      p.active &&
      isTargetEnabledForCompany(index, companyId, p.target) &&
      isPayrollExportTargetImplemented(p.target),
  );
}

/** Export runs for a company, most recent first. */
export function runsForCompany(
  runs: readonly PayrollExportRun[],
  companyId: string,
): PayrollExportRun[] {
  return runs
    .filter((r) => r.companyId === companyId)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}
