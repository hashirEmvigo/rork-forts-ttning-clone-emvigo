import { describe, expect, it } from "vitest";
import {
  ARCHIVE_BLOCKED_END_DATE_NOT_PASSED_MESSAGE,
  ARCHIVE_BLOCKED_NO_END_DATE_MESSAGE,
  validateServiceRowArchive,
  validateServiceRowDelete,
  validateServiceRowForceDelete,
  validateVariationDelete,
  isOccurrenceExceptionOperational,
  getOccurrenceExceptionEffectiveDate,
  isForceDeleteConfirmed,
  type ServiceRowForceDeleteContext,
} from "@/lib/archiveValidation";
import type {
  BookingOccurrenceException,
  RecurringVariation,
  WorkOrderServiceRow,
} from "@/types";

/** Builds a minimal occurrence exception, overridable per test. */
function makeException(
  overrides: Partial<BookingOccurrenceException> = {},
): BookingOccurrenceException {
  return {
    id: "exc_1",
    occurrenceKey: "worow_1:2026-06-01",
    parentServiceRowId: "worow_1",
    occurrenceDate: "2026-06-01",
    status: "rescheduled",
    createdAt: "2026-05-30T00:00:00.000Z",
    updatedAt: "2026-05-30T00:00:00.000Z",
    ...overrides,
  };
}

/** Builds a minimal active variation, overridable per test. */
function makeVariation(overrides: Partial<RecurringVariation> = {}): RecurringVariation {
  return {
    id: "var_1",
    name: "Deep Clean",
    frequency: "every_n_visits",
    interval: 2,
    status: "active",
    enabled: true,
    createdAt: "2026-05-30T00:00:00.000Z",
    updatedAt: "2026-05-30T00:00:00.000Z",
    ...overrides,
  };
}

/** Builds a minimal service row, overridable per test. */
function makeRow(overrides: Partial<WorkOrderServiceRow> = {}): WorkOrderServiceRow {
  return {
    id: "worow_1",
    serviceName: "Cleaning",
    quantity: 1,
    status: "planned",
    serviceDate: "2026-06-15",
    assignedEmployeeIds: [],
    unassignedEmployeeSlots: 0,
    sortOrder: 0,
    createdAt: "2026-05-30T00:00:00.000Z",
    updatedAt: "2026-05-30T00:00:00.000Z",
    ...overrides,
  };
}

const NOW = new Date("2026-05-30T12:00:00.000Z");
const EMPTY = { hasTimeReports: false, hasOccurrenceExceptions: false, now: NOW };

describe("validateServiceRowArchive", () => {
  it("allows a planned service row when status is the only active signal", () => {
    const res = validateServiceRowArchive(makeRow({ serviceDate: "2026-05-01", status: "planned" }), NOW);

    expect(res.allowed).toBe(true);
    expect(res.blockedReason).toBeUndefined();
    expect(res.blockedMessage).toBeUndefined();
    expect(res.warnings.length).toBeGreaterThan(0);
  });

  it("allows an in-progress service row when status is the only active signal", () => {
    const res = validateServiceRowArchive(makeRow({ serviceDate: "2026-05-01", status: "in_progress" }), NOW);

    expect(res.allowed).toBe(true);
    expect(res.blockedReason).toBeUndefined();
    expect(res.blockedMessage).toBeUndefined();
    expect(res.warnings.length).toBeGreaterThan(0);
  });

  it("keeps blocking recurring service rows without an end date", () => {
    const res = validateServiceRowArchive(
      makeRow({ recurrenceInterval: "weekly", serviceEndDate: undefined, status: "planned" }),
      NOW,
    );

    expect(res.allowed).toBe(false);
    expect(res.blockedReason).toBe("no_end_date");
    expect(res.blockedMessage).toBe(ARCHIVE_BLOCKED_NO_END_DATE_MESSAGE);
  });

  it("allows a recurring service row after its end date has passed", () => {
    const res = validateServiceRowArchive(
      makeRow({
        recurrenceInterval: "weekly",
        serviceDate: "2026-05-01",
        serviceEndDate: "2026-05-15",
        status: "planned",
      }),
      NOW,
    );

    expect(res.allowed).toBe(true);
    expect(res.blockedReason).toBeUndefined();
    expect(res.blockedMessage).toBeUndefined();
  });

  it("keeps blocking service rows whose effective end date has not passed", () => {
    const res = validateServiceRowArchive(makeRow({ serviceDate: "2026-06-15", status: "planned" }), NOW);

    expect(res.allowed).toBe(false);
    expect(res.blockedReason).toBe("end_date_not_passed");
    expect(res.blockedMessage).toBe(ARCHIVE_BLOCKED_END_DATE_NOT_PASSED_MESSAGE);
  });

  it("keeps blocking recurring service rows whose end date has not passed", () => {
    const res = validateServiceRowArchive(
      makeRow({
        recurrenceInterval: "weekly",
        serviceDate: "2026-05-01",
        serviceEndDate: "2026-06-15",
        status: "planned",
      }),
      NOW,
    );

    expect(res.allowed).toBe(false);
    expect(res.blockedReason).toBe("end_date_not_passed");
    expect(res.blockedMessage).toBe(ARCHIVE_BLOCKED_END_DATE_NOT_PASSED_MESSAGE);
  });
});

describe("validateServiceRowDelete", () => {
  it("allows deleting a brand-new future row with no history", () => {
    const res = validateServiceRowDelete(makeRow(), EMPTY);
    expect(res.allowed).toBe(true);
    expect(res.blockingFactors).toEqual([]);
    expect(res.blockedMessage).toBeUndefined();
  });

  it("allows deleting a past planned row when no protected history exists", () => {
    const res = validateServiceRowDelete(makeRow({ serviceDate: "2026-05-01" }), EMPTY);
    expect(res.allowed).toBe(true);
    expect(res.blockingFactors).toEqual([]);
  });

  it("allows deleting an in-progress row when no protected history exists", () => {
    const res = validateServiceRowDelete(makeRow({ status: "in_progress" }), EMPTY);
    expect(res.allowed).toBe(true);
    expect(res.blockingFactors).toEqual([]);
  });

  it("blocks deletion when the service has been completed", () => {
    const res = validateServiceRowDelete(makeRow({ status: "completed" }), EMPTY);
    expect(res.allowed).toBe(false);
    expect(res.blockingFactors).toContain("service_completed");
  });

  it("blocks deletion when a time report exists", () => {
    const res = validateServiceRowDelete(makeRow(), {
      ...EMPTY,
      hasTimeReports: true,
    });
    expect(res.allowed).toBe(false);
    expect(res.blockingFactors).toContain("has_time_reports");
  });

  it("blocks deletion when a booking occurrence exception exists", () => {
    const res = validateServiceRowDelete(makeRow(), {
      ...EMPTY,
      hasOccurrenceExceptions: true,
    });
    expect(res.allowed).toBe(false);
    expect(res.blockingFactors).toContain("has_occurrence_exceptions");
  });

  it("allows deletion when planned variations exist but no protected history exists", () => {
    const variation = { id: "var_1" } as RecurringVariation;
    const res = validateServiceRowDelete(makeRow({ variations: [variation] }), EMPTY);
    expect(res.allowed).toBe(true);
    expect(res.blockingFactors).toEqual([]);
  });

  it("allows deletion when the service date is exactly today", () => {
    const res = validateServiceRowDelete(makeRow({ serviceDate: "2026-05-30" }), EMPTY);
    expect(res.allowed).toBe(true);
  });

  it("reports every protected-history blocking factor at once", () => {
    const variation = { id: "var_1" } as RecurringVariation;
    const res = validateServiceRowDelete(
      makeRow({ serviceDate: "2026-05-01", status: "completed", variations: [variation] }),
      { hasTimeReports: true, hasOccurrenceExceptions: true, now: NOW },
    );
    expect(res.allowed).toBe(false);
    expect(res.blockingFactors).toEqual([
      "service_completed",
      "has_time_reports",
      "has_occurrence_exceptions",
    ]);
    expect(res.reasons).toHaveLength(3);
  });
});

describe("isOccurrenceExceptionOperational", () => {
  it("treats a future-only occurrence (start date 2026-06-01) as NOT operational", () => {
    const exc = makeException({ occurrenceDate: "2026-06-01" });
    expect(isOccurrenceExceptionOperational(exc, NOW)).toBe(false);
  });

  it("treats a future occurrence rescheduled to another future date as NOT operational", () => {
    const exc = makeException({
      occurrenceDate: "2026-06-01",
      overrideOccurrenceDate: "2026-06-02",
    });
    expect(isOccurrenceExceptionOperational(exc, NOW)).toBe(false);
  });

  it("treats a past original occurrence as operational", () => {
    const exc = makeException({ occurrenceDate: "2026-05-01" });
    expect(isOccurrenceExceptionOperational(exc, NOW)).toBe(true);
  });

  it("treats an occurrence moved into the past as operational", () => {
    const exc = makeException({
      occurrenceDate: "2026-06-01",
      overrideOccurrenceDate: "2026-05-01",
    });
    expect(isOccurrenceExceptionOperational(exc, NOW)).toBe(true);
  });

  it("resolves the effective date from the override when present", () => {
    expect(
      getOccurrenceExceptionEffectiveDate(
        makeException({ occurrenceDate: "2026-06-01", overrideOccurrenceDate: "2026-06-05" }),
      ),
    ).toBe("2026-06-05");
    expect(
      getOccurrenceExceptionEffectiveDate(makeException({ occurrenceDate: "2026-06-01" })),
    ).toBe("2026-06-01");
  });
});

describe("validateServiceRowDelete — future-starting recurring service", () => {
  it("allows deleting a future service even with future-only occurrence exceptions", () => {
    // The caller is responsible for filtering to operational exceptions; a
    // future-only reschedule/cancel resolves hasOccurrenceExceptions to false.
    const exc = makeException({
      occurrenceDate: "2026-06-01",
      overrideOccurrenceDate: "2026-06-02",
    });
    const hasOccurrenceExceptions = isOccurrenceExceptionOperational(exc, NOW);
    const res = validateServiceRowDelete(makeRow({ serviceDate: "2026-06-01" }), {
      hasTimeReports: false,
      hasOccurrenceExceptions,
      now: NOW,
    });
    expect(res.allowed).toBe(true);
    expect(res.blockingFactors).toEqual([]);
  });
});

const ALL_CLEAR: ServiceRowForceDeleteContext = {
  hasPayrollBasis: false,
  hasInvoiceBasis: false,
  hasCompletedTimeReports: false,
  hasLockedHistory: false,
  hasExportedPayroll: false,
  hasExportedInvoice: false,
};

describe("validateServiceRowForceDelete", () => {
  it("allows force delete when generated history exists but no financial/locked data does", () => {
    // Generated history is irrelevant to force delete — only dependencies block it.
    const res = validateServiceRowForceDelete(ALL_CLEAR);
    expect(res.allowed).toBe(true);
    expect(res.blockingFactors).toEqual([]);
    expect(res.blockedMessage).toBeUndefined();
  });

  it("blocks force delete when completed time reports exist", () => {
    const res = validateServiceRowForceDelete({
      ...ALL_CLEAR,
      hasCompletedTimeReports: true,
    });
    expect(res.allowed).toBe(false);
    expect(res.blockingFactors).toContain("has_completed_time_reports");
  });

  it("blocks force delete when a payroll basis exists", () => {
    const res = validateServiceRowForceDelete({ ...ALL_CLEAR, hasPayrollBasis: true });
    expect(res.allowed).toBe(false);
    expect(res.blockingFactors).toContain("has_payroll_basis");
  });

  it("blocks force delete when an invoice basis exists", () => {
    const res = validateServiceRowForceDelete({ ...ALL_CLEAR, hasInvoiceBasis: true });
    expect(res.allowed).toBe(false);
    expect(res.blockingFactors).toContain("has_invoice_basis");
  });

  it("blocks force delete on locked history and exported payroll/invoice data", () => {
    const res = validateServiceRowForceDelete({
      hasPayrollBasis: false,
      hasInvoiceBasis: false,
      hasCompletedTimeReports: false,
      hasLockedHistory: true,
      hasExportedPayroll: true,
      hasExportedInvoice: true,
    });
    expect(res.allowed).toBe(false);
    expect(res.blockingFactors).toEqual([
      "has_locked_history",
      "has_exported_payroll",
      "has_exported_invoice",
    ]);
    expect(res.reasons).toHaveLength(3);
    expect(res.blockedMessage).toBeDefined();
  });
});

describe("isForceDeleteConfirmed", () => {
  it("accepts delete, DELETE and Delete (case-insensitive, trimmed)", () => {
    expect(isForceDeleteConfirmed("delete")).toBe(true);
    expect(isForceDeleteConfirmed("DELETE")).toBe(true);
    expect(isForceDeleteConfirmed("Delete")).toBe(true);
    expect(isForceDeleteConfirmed("  delete  ")).toBe(true);
  });

  it("rejects any other value", () => {
    expect(isForceDeleteConfirmed("")).toBe(false);
    expect(isForceDeleteConfirmed("del")).toBe(false);
    expect(isForceDeleteConfirmed("remove")).toBe(false);
    expect(isForceDeleteConfirmed("delete now")).toBe(false);
  });
});

describe("validateVariationDelete", () => {
  it("allows deleting a variation with no history", () => {
    const res = validateVariationDelete(makeVariation(), { appliedInPast: false });
    expect(res.allowed).toBe(true);
    expect(res.blockingFactors).toEqual([]);
    expect(res.blockedMessage).toBeUndefined();
  });

  it("blocks deletion when the variation already applied in the past", () => {
    const res = validateVariationDelete(makeVariation(), { appliedInPast: true });
    expect(res.allowed).toBe(false);
    expect(res.blockingFactors).toContain("applied_in_past");
  });

  it("blocks deletion when the variation replaced another", () => {
    const res = validateVariationDelete(
      makeVariation({ replacesVariationId: "var_0" }),
      { appliedInPast: false },
    );
    expect(res.allowed).toBe(false);
    expect(res.blockingFactors).toContain("in_replace_chain");
  });

  it("blocks deletion when the variation was itself replaced", () => {
    const res = validateVariationDelete(
      makeVariation({ replacedByVariationId: "var_2", replacedAt: "2026-05-30T00:00:00.000Z" }),
      { appliedInPast: false },
    );
    expect(res.allowed).toBe(false);
    expect(res.blockingFactors).toContain("in_replace_chain");
  });

  it("reports both blocking factors at once", () => {
    const res = validateVariationDelete(
      makeVariation({ replacesVariationId: "var_0" }),
      { appliedInPast: true },
    );
    expect(res.allowed).toBe(false);
    expect(res.blockingFactors).toEqual(["applied_in_past", "in_replace_chain"]);
    expect(res.reasons).toHaveLength(2);
    expect(res.blockedMessage).toBeDefined();
  });
});
