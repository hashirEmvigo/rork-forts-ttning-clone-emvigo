import {
  PAYROLL_GROUP_TYPES,
  type PayrollGroup,
  type PayrollGroupType,
} from "@/types";

/**
 * Payroll Group governance helpers. Payroll Groups are Super Admin master data
 * used purely as an aggregation seam: future payroll and workforce-statistics
 * features sum by group rather than reading individual services, so a single
 * service reclassification never forces a reporting refactor.
 *
 * Pure (no storage/UI) so seeding and tests share one catalogue definition.
 */

/** Stable id for the seeded global payroll group of a given type. */
export function globalPayrollGroupId(type: PayrollGroupType): string {
  return `payroll_grp_${type}`;
}

const VALID_TYPES = new Set<PayrollGroupType>(PAYROLL_GROUP_TYPES.map((g) => g.value));

/** Type guard for an unknown value being a valid {@link PayrollGroupType}. */
export function isPayrollGroupType(value: unknown): value is PayrollGroupType {
  return typeof value === "string" && VALID_TYPES.has(value as PayrollGroupType);
}

/**
 * Builds the governed global payroll-group catalogue (companyId === null) from
 * {@link PAYROLL_GROUP_TYPES}, in declared order. Single source of truth for
 * fresh seeding and the backfill migration.
 */
export function buildGlobalPayrollGroups(timestamp: string): PayrollGroup[] {
  return PAYROLL_GROUP_TYPES.map((g, index) => ({
    id: globalPayrollGroupId(g.value),
    companyId: null,
    name: g.label,
    groupType: g.value,
    description: g.description,
    sortOrder: index,
    status: "active" as const,
    createdBy: "usr_root",
    createdAt: timestamp,
    updatedAt: timestamp,
  }));
}
