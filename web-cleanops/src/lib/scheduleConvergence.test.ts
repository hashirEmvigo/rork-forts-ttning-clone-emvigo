import { describe, expect, it } from "vitest";
import {
  resolveScheduleProgram,
  scheduleEntryOperationalStatus,
  summarizeScheduleProgram,
  type ScheduleCoreInput,
  type ScheduleEntry,
} from "./scheduleCore";
import {
  resolveBookingModifiers,
  resolveBookingOperationalStatus,
  type BookingModifierBadge,
  type OperationalStatusBadge,
} from "./bookingStatus";
import type {
  BookingOccurrenceException,
  WorkOrder,
  WorkOrderServiceRow,
} from "@/types";

/**
 * Cross-pipeline convergence tests.
 *
 * Schedule and Schedule Lab BOTH render straight from {@link resolveScheduleProgram}
 * (the Shared Schedule Core), so they are structurally identical for the same
 * inputs — these tests treat the core as the canonical result and assert the
 * day/week ranges, cancelled defaults and cross-boundary reschedules behave as
 * the convergence work requires.
 *
 * The Booking Queue derives its operational status + modifiers from the SAME
 * shared resolvers ({@link resolveBookingOperationalStatus}, {@link
 * resolveBookingModifiers}) with the SAME inputs the Schedule uses (unified
 * `isScheduled = has a concrete planned start time`). The
 * {@link bookingQueueStatusFor} / {@link bookingQueueModifiersFor} helpers below
 * reproduce exactly how `BookingQueue.tsx` wires those resolvers from a resolved
 * occurrence, so any divergence in the status/modifier mapping fails here.
 *
 * NOTE: the two surfaces still read from different source collections
 * (Schedule Core → live work-order service rows; Booking Queue → the persisted
 * booking-queue snapshot). Reconciling those collections is deliberately
 * deferred (historical/audit views, item C) and is out of scope for these tests.
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

/** Reproduces how `BookingQueue.tsx` wires the shared operational resolver. */
function bookingQueueStatusFor(entry: ScheduleEntry): OperationalStatusBadge {
  return resolveBookingOperationalStatus({
    isCancelled: entry.status === "cancelled",
    reschedule: entry.reschedule
      ? {
          originalDate: entry.reschedule.originalDate,
          newDate: entry.reschedule.newDate,
          oneTime: true,
        }
      : null,
    isVariation: entry.isVariation,
    // Unified definition shared with the Schedule Core.
    isScheduled: entry.startTime != null,
  });
}

/** Reproduces how the Booking Queue + Schedule wire the shared modifier resolver. */
function bookingQueueModifiersFor(entry: ScheduleEntry): BookingModifierBadge[] {
  return resolveBookingModifiers({
    isCancelled: entry.status === "cancelled",
    isTimeChanged: entry.isTimeChanged,
    confirmation: null,
  });
}

describe("status & modifier parity (Schedule ↔ Booking Queue)", () => {
  it("derives the identical operational status from the same inputs", () => {
    const entries = resolveScheduleProgram(baseInput());
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(bookingQueueStatusFor(entry)).toEqual(scheduleEntryOperationalStatus(entry));
    }
  });

  it("treats an occurrence with a planned start time as Scheduled on both surfaces", () => {
    const entry = resolveScheduleProgram(baseInput())[0];
    expect(entry.startTime).toBe("08:00");
    expect(scheduleEntryOperationalStatus(entry).status).toBe("scheduled");
    expect(bookingQueueStatusFor(entry).status).toBe("scheduled");
  });

  it("treats an occurrence with no planned time as Unscheduled on both surfaces", () => {
    const entry = resolveScheduleProgram(
      baseInput({
        workOrders: [makeWorkOrder([makeRow({ plannedStartTime: undefined, plannedEndTime: undefined })])],
      }),
    )[0];
    expect(entry.startTime).toBeNull();
    expect(scheduleEntryOperationalStatus(entry).status).toBe("unscheduled");
    expect(bookingQueueStatusFor(entry).status).toBe("unscheduled");
  });

  it("flags Changed identically when a manual time override exists", () => {
    const exceptions: BookingOccurrenceException[] = [
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
    const entry = resolveScheduleProgram(baseInput({ exceptions })).find(
      (e) => e.occurrenceKey === "row-1:2026-06-15",
    );
    expect(entry?.isTimeChanged).toBe(true);
    const mods = bookingQueueModifiersFor(entry as ScheduleEntry);
    expect(mods.map((m) => m.modifier)).toContain("changed");
  });

  it("shows Rebooked identically on both surfaces after a date move", () => {
    // Mirrors what the routed `rescheduleBooking` now writes: a rescheduled
    // occurrence exception with a date override (no times).
    const exceptions: BookingOccurrenceException[] = [
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
    const entry = resolveScheduleProgram(baseInput({ exceptions })).find(
      (e) => e.occurrenceKey === "row-1:2026-06-15",
    );
    expect(entry?.displayDate).toBe("2026-06-18");
    expect(scheduleEntryOperationalStatus(entry as ScheduleEntry).status).toBe("rebooked");
    expect(bookingQueueStatusFor(entry as ScheduleEntry).status).toBe("rebooked");
  });
});

describe("range filtering on the display date", () => {
  it("matches a single day's count to the occurrence on that day", () => {
    // Weekly Mondays: 2026-06-08 is the only occurrence on that day.
    const day = resolveScheduleProgram(baseInput({ fromDate: "2026-06-08", toDate: "2026-06-08" }));
    expect(day.map((e) => e.displayDate)).toEqual(["2026-06-08"]);
  });

  it("matches week-range daily counts (one weekly occurrence per week)", () => {
    const week = resolveScheduleProgram(baseInput({ fromDate: "2026-06-08", toDate: "2026-06-14" }));
    expect(week).toHaveLength(1);
    expect(week[0].displayDate).toBe("2026-06-08");
  });

  it("keeps a cross-boundary reschedule in the range it was moved INTO", () => {
    // The 2026-06-15 occurrence (week of 15th) is moved to 2026-06-23 (week of 22nd).
    const exceptions: BookingOccurrenceException[] = [
      {
        id: "ex-move",
        occurrenceKey: "row-1:2026-06-15",
        parentServiceRowId: "row-1",
        occurrenceDate: "2026-06-15",
        status: "rescheduled",
        overrideOccurrenceDate: "2026-06-23",
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-01T00:00:00.000Z",
      },
    ];
    // Target week (22–28): the moved occurrence must appear by its display date,
    // even though its rule date (06-15) is outside this range.
    const target = resolveScheduleProgram(
      baseInput({ exceptions, fromDate: "2026-06-22", toDate: "2026-06-28" }),
    );
    const moved = target.find((e) => e.occurrenceKey === "row-1:2026-06-15");
    expect(moved?.displayDate).toBe("2026-06-23");
    // The week also has its own native Monday occurrence (06-22).
    expect(target.map((e) => e.displayDate).sort()).toEqual(["2026-06-22", "2026-06-23"]);
  });

  it("drops a cross-boundary reschedule from the range it was moved OUT of", () => {
    const exceptions: BookingOccurrenceException[] = [
      {
        id: "ex-move",
        occurrenceKey: "row-1:2026-06-15",
        parentServiceRowId: "row-1",
        occurrenceDate: "2026-06-15",
        status: "rescheduled",
        overrideOccurrenceDate: "2026-06-23",
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-01T00:00:00.000Z",
      },
    ];
    // Source week (15–21): the occurrence's rule date is here, but it was moved
    // out, so it must NOT appear (no occurrence remains that week).
    const source = resolveScheduleProgram(
      baseInput({ exceptions, fromDate: "2026-06-15", toDate: "2026-06-21" }),
    );
    expect(source.some((e) => e.occurrenceKey === "row-1:2026-06-15")).toBe(false);
    expect(source).toHaveLength(0);
  });
});

describe("cancelled default behaviour", () => {
  const cancelledException: BookingOccurrenceException[] = [
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

  it("excludes cancelled occurrences by default", () => {
    const entries = resolveScheduleProgram(baseInput({ exceptions: cancelledException }));
    expect(entries.some((e) => e.occurrenceKey === "row-1:2026-06-08")).toBe(false);
  });

  it("includes cancelled occurrences only when explicitly enabled", () => {
    const entries = resolveScheduleProgram(
      baseInput({ exceptions: cancelledException, includeCancelled: true }),
    );
    const cancelled = entries.find((e) => e.occurrenceKey === "row-1:2026-06-08");
    expect(cancelled?.status).toBe("cancelled");
    expect(scheduleEntryOperationalStatus(cancelled as ScheduleEntry).status).toBe("cancelled");
    // Cancelled suppresses every modifier on both surfaces.
    expect(bookingQueueModifiersFor(cancelled as ScheduleEntry)).toEqual([]);
  });
});

describe("multi-employee and unassigned occurrences", () => {
  it("counts a multi-employee occurrence once but lists every assignee", () => {
    const entries = resolveScheduleProgram(
      baseInput({
        workOrders: [makeWorkOrder([makeRow({ assignedEmployeeIds: ["emp-1", "emp-2"] })])],
        fromDate: "2026-06-08",
        toDate: "2026-06-08",
      }),
    );
    // One distinct occurrence in the headline count…
    expect(entries).toHaveLength(1);
    // …surfaced under each assigned employee.
    expect(entries[0].assignedEmployeeNames).toEqual(["Ingrid Sand", "Lars Holm"]);
    expect(summarizeScheduleProgram(entries).distinctEmployees).toBe(2);
  });

  it("treats an open-slot occurrence as needing staffing (not unstaffed)", () => {
    const entries = resolveScheduleProgram(
      baseInput({
        workOrders: [
          makeWorkOrder([makeRow({ assignedEmployeeIds: [], unassignedEmployeeSlots: 2 })]),
        ],
        fromDate: "2026-06-08",
        toDate: "2026-06-08",
      }),
    );
    const summary = summarizeScheduleProgram(entries);
    expect(entries[0].unassignedEmployeeSlots).toBe(2);
    expect(summary.needsStaffing).toBe(1);
    expect(summary.unstaffed).toBe(0);
  });

  it("treats a no-assignee, no-slot occurrence as unstaffed", () => {
    const entries = resolveScheduleProgram(
      baseInput({
        workOrders: [
          makeWorkOrder([makeRow({ assignedEmployeeIds: [], unassignedEmployeeSlots: 0 })]),
        ],
        fromDate: "2026-06-08",
        toDate: "2026-06-08",
      }),
    );
    const summary = summarizeScheduleProgram(entries);
    expect(summary.unstaffed).toBe(1);
    expect(summary.needsStaffing).toBe(1);
  });
});
