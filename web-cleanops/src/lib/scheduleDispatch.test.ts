import { describe, expect, it } from "vitest";
import {
  groupByEmployee,
  resolveScheduleProgram,
  scheduleEntryOperationalStatus,
  type ScheduleCoreInput,
  type ScheduleEntry,
} from "./scheduleCore";
import {
  resolveBookingModifiers,
  resolveBookingOperationalStatus,
  type BookingModifierBadge,
  type OperationalStatusBadge,
} from "./bookingStatus";
import {
  describeOccurrenceCancel,
  describeOccurrenceReschedule,
  describeOccurrenceRestore,
} from "./occurrenceActivity";
import type {
  BookingOccurrenceException,
  WorkOrder,
  WorkOrderServiceRow,
} from "@/types";

/**
 * Phase 3 dispatcher-workflow tests.
 *
 * The Schedule's dispatcher actions write to the SAME authoritative models the
 * Booking Queue uses — occurrence exceptions (reschedule/cancel/restore) and the
 * work-order service row (staffing). These tests assert the DATA OUTCOMES of
 * those actions converge across the two surfaces, exactly like the resolvers
 * the live UI uses, without re-deriving any occurrence logic.
 */

function makeRow(overrides: Partial<WorkOrderServiceRow> = {}): WorkOrderServiceRow {
  return {
    id: "row-1",
    serviceName: "Window Cleaning",
    quantity: 1,
    status: "planned",
    serviceDate: "2026-06-01", // Monday
    recurrenceInterval: "weekly",
    plannedStartTime: "08:00",
    plannedEndTime: "10:00",
    assignedEmployeeIds: ["emp-1"],
    unassignedEmployeeSlots: 0,
    sortOrder: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeWorkOrder(rows: WorkOrderServiceRow[], overrides: Partial<WorkOrder> = {}): WorkOrder {
  return {
    id: "wo-1",
    companyId: "co-1",
    customerId: "cust-1",
    number: "WO-1001",
    status: "planned",
    serviceRows: rows,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function baseInput(overrides: Partial<ScheduleCoreInput> = {}): ScheduleCoreInput {
  return {
    workOrders: [makeWorkOrder([makeRow()])],
    customers: [{ id: "cust-1", name: "Bergen Office Park" }],
    employees: [
      { id: "emp-1", name: "Ingrid Sand" },
      { id: "emp-2", name: "Lars Holm" },
    ],
    exceptions: [],
    fromDate: "2026-06-01",
    toDate: "2026-06-30",
    ...overrides,
  };
}

/** Reproduces how the Booking Queue wires the shared operational resolver. */
function bookingQueueStatusFor(entry: ScheduleEntry): OperationalStatusBadge {
  return resolveBookingOperationalStatus({
    isCancelled: entry.status === "cancelled",
    reschedule: entry.reschedule
      ? { originalDate: entry.reschedule.originalDate, newDate: entry.reschedule.newDate, oneTime: true }
      : null,
    isVariation: entry.isVariation,
    isScheduled: entry.startTime != null,
  });
}

function bookingQueueModifiersFor(entry: ScheduleEntry): BookingModifierBadge[] {
  return resolveBookingModifiers({
    isCancelled: entry.status === "cancelled",
    isTimeChanged: entry.isTimeChanged,
    confirmation: null,
  });
}

describe("reschedule from Schedule appears correctly in Booking Queue", () => {
  // Mirrors exactly what `rescheduleOccurrence` persists: a rescheduled
  // exception keyed on the rule date with a date override.
  const moved: BookingOccurrenceException[] = [
    {
      id: "ex-move",
      occurrenceKey: "row-1:2026-06-15",
      parentServiceRowId: "row-1",
      occurrenceDate: "2026-06-15",
      status: "rescheduled",
      overrideOccurrenceDate: "2026-06-18",
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
    },
  ];

  it("moves the occurrence to its new display date and reads Rebooked on both surfaces", () => {
    const entry = resolveScheduleProgram(baseInput({ exceptions: moved })).find(
      (e) => e.occurrenceKey === "row-1:2026-06-15",
    ) as ScheduleEntry;
    expect(entry.displayDate).toBe("2026-06-18");
    expect(scheduleEntryOperationalStatus(entry).status).toBe("rebooked");
    expect(bookingQueueStatusFor(entry).status).toBe("rebooked");
  });

  it("flags Changed identically when a time-only override is applied", () => {
    const timeChange: BookingOccurrenceException[] = [
      {
        id: "ex-time",
        occurrenceKey: "row-1:2026-06-15",
        parentServiceRowId: "row-1",
        occurrenceDate: "2026-06-15",
        status: "rescheduled",
        overrideStartTime: "12:00",
        overrideEndTime: "14:00",
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-01T00:00:00.000Z",
      },
    ];
    const entry = resolveScheduleProgram(baseInput({ exceptions: timeChange })).find(
      (e) => e.occurrenceKey === "row-1:2026-06-15",
    ) as ScheduleEntry;
    expect(entry.isTimeChanged).toBe(true);
    expect(bookingQueueModifiersFor(entry).map((m) => m.modifier)).toContain("changed");
  });
});

describe("cancel from Schedule appears correctly in Booking Queue", () => {
  const cancelled: BookingOccurrenceException[] = [
    {
      id: "ex-cancel",
      occurrenceKey: "row-1:2026-06-08",
      parentServiceRowId: "row-1",
      occurrenceDate: "2026-06-08",
      status: "cancelled",
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
    },
  ];

  it("excludes the cancelled occurrence by default", () => {
    const entries = resolveScheduleProgram(baseInput({ exceptions: cancelled }));
    expect(entries.some((e) => e.occurrenceKey === "row-1:2026-06-08")).toBe(false);
  });

  it("shows it as Cancelled with no modifiers when cancelled are included", () => {
    const entry = resolveScheduleProgram(
      baseInput({ exceptions: cancelled, includeCancelled: true }),
    ).find((e) => e.occurrenceKey === "row-1:2026-06-08") as ScheduleEntry;
    expect(scheduleEntryOperationalStatus(entry).status).toBe("cancelled");
    expect(bookingQueueModifiersFor(entry)).toEqual([]);
  });
});

describe("employee reassignment updates the Schedule grouping", () => {
  it("re-buckets the occurrence when the service row's assignee changes", () => {
    // Before: row assigned to emp-1 → grouped under Ingrid Sand.
    const before = resolveScheduleProgram(
      baseInput({ fromDate: "2026-06-08", toDate: "2026-06-08" }),
    );
    const beforeGroups = groupByEmployee(before, (e) => e.assignedEmployeeNames);
    expect(beforeGroups.map((g) => g.name)).toEqual(["Ingrid Sand"]);

    // After `updateWorkOrderServiceRow` swaps staffing to emp-2 → grouped under Lars.
    const after = resolveScheduleProgram(
      baseInput({
        workOrders: [makeWorkOrder([makeRow({ assignedEmployeeIds: ["emp-2"] })])],
        fromDate: "2026-06-08",
        toDate: "2026-06-08",
      }),
    );
    const afterGroups = groupByEmployee(after, (e) => e.assignedEmployeeNames);
    expect(afterGroups.map((g) => g.name)).toEqual(["Lars Holm"]);
  });

  it("sends an occurrence with no assignee to a single Unassigned bucket (sorted last)", () => {
    const entries = resolveScheduleProgram(
      baseInput({
        workOrders: [makeWorkOrder([makeRow({ assignedEmployeeIds: [], unassignedEmployeeSlots: 1 })])],
        fromDate: "2026-06-08",
        toDate: "2026-06-08",
      }),
    );
    const groups = groupByEmployee(entries, (e) => e.assignedEmployeeNames);
    expect(groups).toHaveLength(1);
    expect(groups[0].isUnassigned).toBe(true);
    expect(groups[0].name).toBe("Unassigned");
  });
});

describe("multi-employee occurrence remains one distinct occurrence", () => {
  it("lists the occurrence under each assignee but counts it once", () => {
    const entries = resolveScheduleProgram(
      baseInput({
        workOrders: [makeWorkOrder([makeRow({ assignedEmployeeIds: ["emp-1", "emp-2"] })])],
        fromDate: "2026-06-08",
        toDate: "2026-06-08",
      }),
    );
    // One distinct occurrence in the headline count…
    expect(entries).toHaveLength(1);
    const groups = groupByEmployee(entries, (e) => e.assignedEmployeeNames);
    // …surfaced under BOTH assignees.
    expect(groups.map((g) => g.name)).toEqual(["Ingrid Sand", "Lars Holm"]);
    expect(groups[0].rows[0]).toBe(groups[1].rows[0]); // same single entry reference
  });
});

describe("every dispatcher action writes an activity + audit entry", () => {
  const meta = {
    serviceName: "Window Cleaning",
    workOrderNumber: "WO-1001",
    occurrenceDate: "2026-06-15",
  };

  it("cancel produces a booking_cancelled activity and bookingqueue.cancel audit", () => {
    const log = describeOccurrenceCancel(meta);
    expect(log.activityAction).toBe("booking_cancelled");
    expect(log.auditAction).toBe("bookingqueue.cancel");
    expect(log.activitySummary).toContain("Window Cleaning");
    expect(log.auditSummary).toContain("WO-1001");
  });

  it("restore produces a booking_restored activity and bookingqueue.restore audit", () => {
    const log = describeOccurrenceRestore(meta);
    expect(log.activityAction).toBe("booking_restored");
    expect(log.auditAction).toBe("bookingqueue.restore");
  });

  it("reschedule produces a booking_rescheduled activity and bookingqueue.reschedule audit", () => {
    const log = describeOccurrenceReschedule(meta, "2026-06-18");
    expect(log.activityAction).toBe("booking_rescheduled");
    expect(log.auditAction).toBe("bookingqueue.reschedule");
    expect(log.activitySummary).toContain("→");
  });
});
