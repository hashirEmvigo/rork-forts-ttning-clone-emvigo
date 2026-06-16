import { describe, expect, it } from "vitest";
import {
  applyOccurrenceException,
  occurrenceExceptionHasStaffingOverride,
  type BookingOccurrence,
  type BookingOccurrenceException,
} from "@/types";

/** Minimal active occurrence assigned to Ingrid, used across the cases below. */
function makeOccurrence(overrides: Partial<BookingOccurrence> = {}): BookingOccurrence {
  return {
    id: "row-1:2025-01-13",
    occurrenceKey: "row-1:2025-01-13",
    sourceType: "base_service",
    sourceId: "row-1",
    parentServiceRowId: "row-1",
    occurrenceDate: "2025-01-13",
    companyId: "co-1",
    workOrderId: "wo-1",
    customerId: "cust-1",
    customerName: "Test Customer",
    serviceName: "Cleaning",
    serviceDate: "2025-01-13",
    plannedStartTime: "08:00",
    plannedEndTime: "10:00",
    assignedEmployeeIds: ["ingrid"],
    assignedEmployeeNames: ["Ingrid Sand"],
    unassignedEmployeeSlots: 0,
    assignmentStatus: "assigned",
    employeeTimeOverrides: [],
    hasCustomEmployeeTimes: false,
    totalLabourMinutesOverride: null,
    recurrenceInterval: "weekly",
    status: "scheduled",
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeException(
  overrides: Partial<BookingOccurrenceException> = {},
): BookingOccurrenceException {
  return {
    id: "ex-1",
    occurrenceKey: "row-1:2025-01-13",
    parentServiceRowId: "row-1",
    occurrenceDate: "2025-01-13",
    status: "active",
    createdAt: "2025-01-02T00:00:00.000Z",
    updatedAt: "2025-01-02T00:00:00.000Z",
    ...overrides,
  };
}

const resolveName = (id: string): string | undefined =>
  ({ ingrid: "Ingrid Sand", kari: "Kari Moen" })[id];

describe("occurrenceExceptionHasStaffingOverride", () => {
  it("is false for cancel/reschedule-only exceptions", () => {
    expect(occurrenceExceptionHasStaffingOverride(makeException())).toBe(false);
    expect(
      occurrenceExceptionHasStaffingOverride(
        makeException({ status: "rescheduled", overrideOccurrenceDate: "2025-01-14" }),
      ),
    ).toBe(false);
  });

  it("is true when any staffing override field is set", () => {
    expect(
      occurrenceExceptionHasStaffingOverride(
        makeException({ overrideAssignedEmployeeIds: ["kari"] }),
      ),
    ).toBe(true);
    expect(
      occurrenceExceptionHasStaffingOverride(
        makeException({ overrideUnassignedEmployeeSlots: 1 }),
      ),
    ).toBe(true);
  });
});

describe("applyOccurrenceException — assignment override", () => {
  it("reassigns the occurrence and resolves the new employee name", () => {
    const result = applyOccurrenceException(
      makeOccurrence(),
      makeException({ overrideAssignedEmployeeIds: ["kari"] }),
      resolveName,
    );
    expect(result.assignedEmployeeIds).toEqual(["kari"]);
    expect(result.assignedEmployeeNames).toEqual(["Kari Moen"]);
    expect(result.status).toBe("scheduled");
    expect(result.assignmentStatus).toBe("assigned");
  });

  it("recomputes the assignment status when an override creates an open slot", () => {
    const result = applyOccurrenceException(
      makeOccurrence(),
      makeException({ overrideAssignedEmployeeIds: [], overrideUnassignedEmployeeSlots: 1 }),
      resolveName,
    );
    expect(result.assignedEmployeeIds).toEqual([]);
    expect(result.unassignedEmployeeSlots).toBe(1);
    expect(result.assignmentStatus).toBe("staffing_needed");
  });

  it("returns the occurrence unchanged when there is no exception", () => {
    const occ = makeOccurrence();
    expect(applyOccurrenceException(occ, null, resolveName)).toBe(occ);
  });

  it("combines a reassignment with a reschedule overlay", () => {
    const result = applyOccurrenceException(
      makeOccurrence(),
      makeException({
        status: "rescheduled",
        overrideOccurrenceDate: "2025-01-14",
        overrideStartTime: "12:00",
        overrideAssignedEmployeeIds: ["kari"],
      }),
      resolveName,
    );
    expect(result.status).toBe("rescheduled");
    expect(result.serviceDate).toBe("2025-01-14");
    expect(result.plannedStartTime).toBe("12:00");
    expect(result.assignedEmployeeIds).toEqual(["kari"]);
  });

  it("still cancels a reassigned occurrence (cancel overlay wins on status)", () => {
    const result = applyOccurrenceException(
      makeOccurrence(),
      makeException({ status: "cancelled", overrideAssignedEmployeeIds: ["kari"] }),
      resolveName,
    );
    expect(result.status).toBe("cancelled");
    expect(result.assignedEmployeeIds).toEqual(["kari"]);
  });
});
