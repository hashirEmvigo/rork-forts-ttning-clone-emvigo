import { PAYROLL_EXPORT_TARGETS } from "@/types";
import type { PayrollExportTargetKey } from "@/types";

import { createNotImplementedAdapter, type PayrollExportAdapter } from "./adapter";
import { csvAdapter } from "./csvAdapter";

/**
 * The adapter registry: the single place that maps each export target to its
 * {@link PayrollExportAdapter}. Adding a future integration is a one-line change
 * here (swap the stub for the real adapter) — the basis, entitlements and UI
 * never change. CSV is the one implemented adapter this phase; every other
 * target is a clearly-labelled "not implemented" stub.
 */

const IMPLEMENTED_ADAPTERS: Partial<Record<PayrollExportTargetKey, PayrollExportAdapter>> = {
  csv: csvAdapter,
};

/** Builds the full registry, filling unimplemented targets with stubs. */
function buildRegistry(): Record<PayrollExportTargetKey, PayrollExportAdapter> {
  const registry = {} as Record<PayrollExportTargetKey, PayrollExportAdapter>;
  for (const target of PAYROLL_EXPORT_TARGETS) {
    registry[target.value] =
      IMPLEMENTED_ADAPTERS[target.value] ??
      createNotImplementedAdapter(target.value, target.label);
  }
  return registry;
}

export const PAYROLL_EXPORT_ADAPTERS: Record<PayrollExportTargetKey, PayrollExportAdapter> =
  buildRegistry();

/** Resolves the adapter for a target in O(1). Always defined (stub when unbuilt). */
export function getPayrollExportAdapter(target: PayrollExportTargetKey): PayrollExportAdapter {
  return PAYROLL_EXPORT_ADAPTERS[target];
}

/** Whether a real (non-stub) adapter exists for a target. */
export function isPayrollExportTargetImplemented(target: PayrollExportTargetKey): boolean {
  return PAYROLL_EXPORT_ADAPTERS[target].implemented;
}
