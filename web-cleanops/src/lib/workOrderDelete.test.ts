import { describe, expect, it } from "vitest";
import {
  EMPTY_WORK_ORDER_RELATED_DATA,
  hasRelatedScheduleData,
  validateWorkOrderDelete,
  validateWorkOrderForceDelete,
  WORK_ORDER_DELETE_BLOCKED_MESSAGE,
  WORK_ORDER_FORCE_DELETE_BLOCKED_MESSAGE,
  type WorkOrderRelatedData,
} from "./workOrderDelete";

function data(overrides: Partial<WorkOrderRelatedData> = {}): WorkOrderRelatedData {
  return { ...EMPTY_WORK_ORDER_RELATED_DATA, ...overrides };
}

describe("validateWorkOrderDelete", () => {
  it("allows deleting a completely empty work order", () => {
    const result = validateWorkOrderDelete(data());
    expect(result.allowed).toBe(true);
    expect(result.blockingFactors).toEqual([]);
    expect(result.blockedMessage).toBeUndefined();
  });

  it("blocks deleting a work order with active service rows", () => {
    const result = validateWorkOrderDelete(data({ serviceRowCount: 1 }));
    expect(result.allowed).toBe(false);
    expect(result.blockingFactors).toContain("has_service_rows");
    expect(result.blockedMessage).toBe(WORK_ORDER_DELETE_BLOCKED_MESSAGE);
  });

  it("blocks deleting a work order with future occurrences", () => {
    const result = validateWorkOrderDelete(data({ futureOccurrenceCount: 4 }));
    expect(result.allowed).toBe(false);
    expect(result.blockingFactors).toContain("has_future_occurrences");
  });

  it("blocks on booking items, exceptions, variations and time reports", () => {
    expect(validateWorkOrderDelete(data({ bookingItemCount: 1 })).allowed).toBe(false);
    expect(validateWorkOrderDelete(data({ occurrenceExceptionCount: 1 })).allowed).toBe(false);
    expect(validateWorkOrderDelete(data({ variationCount: 1 })).allowed).toBe(false);
    expect(validateWorkOrderDelete(data({ timeReportCount: 1 })).allowed).toBe(false);
  });

  it("reports every blocking factor at once", () => {
    const result = validateWorkOrderDelete(
      data({ serviceRowCount: 2, bookingItemCount: 3, timeReportCount: 1 }),
    );
    expect(result.blockingFactors).toEqual([
      "has_service_rows",
      "has_booking_items",
      "has_time_reports",
    ]);
    expect(result.reasons).toHaveLength(3);
  });
});

describe("hasRelatedScheduleData", () => {
  it("is false for an empty work order and true once any data exists", () => {
    expect(hasRelatedScheduleData(data())).toBe(false);
    expect(hasRelatedScheduleData(data({ variationCount: 1 }))).toBe(true);
  });
});

describe("validateWorkOrderForceDelete", () => {
  it("allows force delete of an empty work order with the right confirmation", () => {
    expect(validateWorkOrderForceDelete(data(), "delete").allowed).toBe(true);
    expect(validateWorkOrderForceDelete(data(), "DELETE").allowed).toBe(true);
  });

  it("blocks force delete without the confirmation word", () => {
    const result = validateWorkOrderForceDelete(data(), "");
    expect(result.allowed).toBe(false);
    expect(result.blockedMessage).toBe("Type “delete” to confirm.");
  });

  it("blocks force delete when related data exists, even with confirmation", () => {
    const result = validateWorkOrderForceDelete(data({ futureOccurrenceCount: 2 }), "delete");
    expect(result.allowed).toBe(false);
    expect(result.blockedMessage).toBe(WORK_ORDER_FORCE_DELETE_BLOCKED_MESSAGE);
    expect(result.blockingFactors).toContain("has_future_occurrences");
  });
});
