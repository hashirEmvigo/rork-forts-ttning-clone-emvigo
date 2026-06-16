import {
  DEFAULT_SERVICE_BASIS_TYPE,
  type ServiceBasisType,
  type WorkStatisticsRow,
} from "@/types";

/**
 * Service basis-type foundation: the single source of truth for the business
 * rules that future PayrollBasis, InvoiceBasis and workforce-statistics
 * calculations rely on. Keeping these rules in one place means downstream
 * features never re-derive inclusion logic and never need a refactor when the
 * enum grows.
 *
 * Rules:
 *  - billable     → payroll basis ✔, invoice basis ✔
 *  - non_billable → payroll basis ✔, invoice basis ✘
 *  - excluded     → payroll basis ✘, invoice basis ✘
 */

/** Whether a basis type contributes to the payroll basis (worked/registered hours). */
export function isIncludedInPayrollBasis(basisType: ServiceBasisType): boolean {
  return basisType === "billable" || basisType === "non_billable";
}

/** Whether a basis type contributes to the invoice basis (billable to a customer). */
export function isIncludedInInvoiceBasis(basisType: ServiceBasisType): boolean {
  return basisType === "billable";
}

/**
 * Normalises an unknown/legacy basis-type value to a valid {@link ServiceBasisType},
 * defaulting to {@link DEFAULT_SERVICE_BASIS_TYPE}. Used for backfilling existing
 * records and defending read paths against historical data written before the
 * field existed.
 */
export function normalizeServiceBasisType(value: unknown): ServiceBasisType {
  if (value === "billable" || value === "non_billable" || value === "excluded") {
    return value;
  }
  return DEFAULT_SERVICE_BASIS_TYPE;
}

/** Derives hours from canonical minute storage. */
export function minutesToHours(durationMinutes: number): number {
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) return 0;
  return durationMinutes / 60;
}

/** Aggregate hour totals split by basis classification, derived from snapshots. */
export interface BasisHourTotals {
  /** Hours that count toward payroll (billable + non_billable). */
  payrollHours: number;
  /** Hours that count toward an invoice (billable only). */
  invoiceHours: number;
  billableHours: number;
  nonBillableHours: number;
  excludedHours: number;
  /** billableHours / payrollHours, 0 when there are no payroll hours. */
  billablePercentage: number;
  /** nonBillableHours / payrollHours, 0 when there are no payroll hours. */
  nonBillablePercentage: number;
}

/**
 * Sums {@link WorkStatisticsRow} hours by basis classification, reading ONLY the
 * snapshotted fields so totals are immutable against later Service edits. This is
 * the calculation seam future statistics dashboards build on — provided now so the
 * row model is proven statistics-ready without any UI.
 */
export function sumBasisHours(rows: readonly WorkStatisticsRow[]): BasisHourTotals {
  let billableHours = 0;
  let nonBillableHours = 0;
  let excludedHours = 0;
  for (const row of rows) {
    const hours = minutesToHours(row.durationMinutes);
    switch (row.serviceBasisTypeSnapshot) {
      case "billable":
        billableHours += hours;
        break;
      case "non_billable":
        nonBillableHours += hours;
        break;
      case "excluded":
        excludedHours += hours;
        break;
    }
  }
  const payrollHours = billableHours + nonBillableHours;
  const invoiceHours = billableHours;
  return {
    payrollHours,
    invoiceHours,
    billableHours,
    nonBillableHours,
    excludedHours,
    billablePercentage: payrollHours > 0 ? billableHours / payrollHours : 0,
    nonBillablePercentage: payrollHours > 0 ? nonBillableHours / payrollHours : 0,
  };
}
