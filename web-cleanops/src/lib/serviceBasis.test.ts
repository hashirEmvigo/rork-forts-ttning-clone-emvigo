import { describe, expect, it } from "vitest";

import {
  isIncludedInInvoiceBasis,
  isIncludedInPayrollBasis,
  minutesToHours,
  normalizeServiceBasisType,
  sumBasisHours,
} from "./serviceBasis";
import type { ServiceBasisType, WorkStatisticsRow } from "@/types";

describe("service basis inclusion rules", () => {
  it("billable is included in both payroll and invoice basis", () => {
    expect(isIncludedInPayrollBasis("billable")).toBe(true);
    expect(isIncludedInInvoiceBasis("billable")).toBe(true);
  });

  it("non_billable is payroll-only", () => {
    expect(isIncludedInPayrollBasis("non_billable")).toBe(true);
    expect(isIncludedInInvoiceBasis("non_billable")).toBe(false);
  });

  it("excluded contributes to neither basis", () => {
    expect(isIncludedInPayrollBasis("excluded")).toBe(false);
    expect(isIncludedInInvoiceBasis("excluded")).toBe(false);
  });
});

describe("normalizeServiceBasisType", () => {
  it("passes through valid values", () => {
    const valid: ServiceBasisType[] = ["billable", "non_billable", "excluded"];
    for (const v of valid) expect(normalizeServiceBasisType(v)).toBe(v);
  });

  it("defaults legacy/unknown values to billable", () => {
    expect(normalizeServiceBasisType(undefined)).toBe("billable");
    expect(normalizeServiceBasisType(null)).toBe("billable");
    expect(normalizeServiceBasisType("")).toBe("billable");
    expect(normalizeServiceBasisType("nonsense")).toBe("billable");
  });
});

describe("minutesToHours", () => {
  it("derives hours from canonical minutes", () => {
    expect(minutesToHours(90)).toBe(1.5);
    expect(minutesToHours(60)).toBe(1);
  });

  it("guards against non-positive / invalid input", () => {
    expect(minutesToHours(0)).toBe(0);
    expect(minutesToHours(-30)).toBe(0);
    expect(minutesToHours(Number.NaN)).toBe(0);
  });
});

describe("sumBasisHours (snapshot-driven statistics seam)", () => {
  const row = (
    serviceBasisTypeSnapshot: ServiceBasisType,
    durationMinutes: number,
  ): WorkStatisticsRow => ({
    id: `row_${serviceBasisTypeSnapshot}_${durationMinutes}`,
    serviceId: "svc_1",
    serviceNameSnapshot: "Sample",
    serviceBasisTypeSnapshot,
    timeCodeId: null,
    timeCodeSnapshot: null,
    employeeId: "emp_1",
    date: "2026-06-02",
    durationMinutes,
    sourceType: "work_order",
    sourceId: "wo_1",
  });

  it("splits hours by classification and derives percentages", () => {
    const totals = sumBasisHours([
      row("billable", 180), // 3h
      row("non_billable", 60), // 1h
      row("excluded", 120), // 2h
    ]);
    expect(totals.billableHours).toBe(3);
    expect(totals.nonBillableHours).toBe(1);
    expect(totals.excludedHours).toBe(2);
    expect(totals.payrollHours).toBe(4);
    expect(totals.invoiceHours).toBe(3);
    expect(totals.billablePercentage).toBeCloseTo(0.75);
    expect(totals.nonBillablePercentage).toBeCloseTo(0.25);
  });

  it("returns zeroed percentages when there are no payroll hours", () => {
    const totals = sumBasisHours([row("excluded", 120)]);
    expect(totals.payrollHours).toBe(0);
    expect(totals.billablePercentage).toBe(0);
    expect(totals.nonBillablePercentage).toBe(0);
  });

  it("is immutable against later edits — totals derive only from the snapshot", () => {
    // A row snapshotted as billable still counts as billable even if the live
    // service is later reclassified; we only ever read the snapshot field.
    const totals = sumBasisHours([row("billable", 60)]);
    expect(totals.invoiceHours).toBe(1);
  });
});
