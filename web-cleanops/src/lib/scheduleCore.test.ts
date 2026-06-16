import { describe, expect, it } from "vitest";
import {
  buildScheduleBoard,
  computeScheduleBoardMetrics,
  overallIntegrity,
  resolveScheduleProgram,
  runScheduleIntegrityChecks,
  scheduleEntryOperationalStatus,
  summarizeScheduleProgram,
  type ScheduleCoreInput,
} from "./scheduleCore";
import type {
  BookingOccurrenceException,
  WorkOrder,
  WorkOrderServiceRow,
} from "@/types";

function makeRow(overrides: Partial<WorkOrderServiceRow> = {}): WorkOrderServiceRow {
  return {
    id: "row-1",
    serviceName: "Window Cleaning",
    quantity: 1,
    status: "planned",
    serviceDate: "2026-06-01", // Monday
    recurrenceInterval: "weekly",
    plannedStartTime: "08:00",
    plannedEndTime: "10:00", // 120 min visit
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
    employees: [{ id: "emp-1", name: "Ingrid Sand" }],
    exceptions: [],
    fromDate: "2026-06-01",
    toDate: "2026-06-30",
    ...overrides,
  };
}

describe("resolveScheduleProgram", () => {
  it("resolves one entry per recurrence date in range, enriched with metadata", () => {
    const entries = resolveScheduleProgram(baseInput());
    expect(entries.map((e) => e.displayDate)).toEqual([
      "2026-06-01",
      "2026-06-08",
      "2026-06-15",
      "2026-06-22",
      "2026-06-29",
    ]);
    const first = entries[0];
    expect(first.customerName).toBe("Bergen Office Park");
    expect(first.assignedEmployeeNames).toEqual(["Ingrid Sand"]);
    expect(first.workOrderNumber).toBe("WO-1001");
    expect(first.recurrenceLabel).toBeTruthy();
    expect(first.visitMinutes).toBe(120);
  });

  it("skips archived (non-live) service rows", () => {
    const input = baseInput({
      workOrders: [makeWorkOrder([makeRow({ archived: true })])],
    });
    expect(resolveScheduleProgram(input)).toEqual([]);
  });

  it("skips every row of an inactivated (archived/deleted) work order", () => {
    // The reported critical bug: an inactivated work order must leave NO
    // orphaned live bookings on the board, even though its rows are not archived.
    const input = baseInput({
      workOrders: [makeWorkOrder([makeRow()], { status: "inactive" })],
    });
    expect(resolveScheduleProgram(input)).toEqual([]);
  });

  it("keeps live work orders while dropping a sibling inactive one", () => {
    const live = makeWorkOrder([makeRow({ id: "row-live" })], {
      id: "wo-live",
      number: "WO-LIVE",
    });
    const dead = makeWorkOrder([makeRow({ id: "row-dead" })], {
      id: "wo-dead",
      number: "WO-DEAD",
      status: "inactive",
    });
    const entries = resolveScheduleProgram(baseInput({ workOrders: [live, dead] }));
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e) => e.workOrderNumber === "WO-LIVE")).toBe(true);
  });

  it("returns entries sorted by date then start time", () => {
    const rows = [
      makeRow({ id: "row-late", plannedStartTime: "13:00", plannedEndTime: "15:00" }),
      makeRow({ id: "row-early", plannedStartTime: "08:00", plannedEndTime: "10:00" }),
    ];
    const entries = resolveScheduleProgram(
      baseInput({ workOrders: [makeWorkOrder(rows)], toDate: "2026-06-01" }),
    );
    expect(entries.map((e) => e.startTime)).toEqual(["08:00", "13:00"]);
  });

  it("applies a cancellation exception and can exclude cancelled entries", () => {
    const exceptions: BookingOccurrenceException[] = [
      {
        id: "ex-1",
        occurrenceKey: "row-1:2026-06-08",
        parentServiceRowId: "row-1",
        occurrenceDate: "2026-06-08",
        status: "cancelled",
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-01T00:00:00.000Z",
      },
    ];
    const withCancelled = resolveScheduleProgram(baseInput({ exceptions, includeCancelled: true }));
    expect(withCancelled.find((e) => e.occurrenceDate === "2026-06-08")?.status).toBe("cancelled");

    // Cancelled is excluded by default (matching Schedule / Lab / Booking Queue).
    const withoutCancelled = resolveScheduleProgram(baseInput({ exceptions }));
    expect(withoutCancelled.some((e) => e.occurrenceDate === "2026-06-08")).toBe(false);
  });

  it("flags a rescheduled occurrence without changing its identity date", () => {
    const exceptions: BookingOccurrenceException[] = [
      {
        id: "ex-2",
        occurrenceKey: "row-1:2026-06-15",
        parentServiceRowId: "row-1",
        occurrenceDate: "2026-06-15",
        status: "rescheduled",
        overrideOccurrenceDate: "2026-06-16",
        overrideStartTime: "12:00",
        overrideEndTime: "14:00",
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-01T00:00:00.000Z",
      },
    ];
    const entry = resolveScheduleProgram(baseInput({ exceptions })).find(
      (e) => e.occurrenceKey === "row-1:2026-06-15",
    );
    expect(entry?.occurrenceDate).toBe("2026-06-15");
    expect(entry?.displayDate).toBe("2026-06-16");
    expect(entry?.isRescheduled).toBe(true);
    expect(entry?.startTime).toBe("12:00");
    // The authoritative move is exposed for the Schedule / Booking Queue.
    expect(entry?.reschedule).toEqual({
      originalDate: "2026-06-15",
      newDate: "2026-06-16",
      originalStartTime: "08:00",
      originalEndTime: "10:00",
      newStartTime: "12:00",
      newEndTime: "14:00",
    });
    // The planned window changed, so "Changed" should be flagged.
    expect(entry?.isTimeChanged).toBe(true);
  });

  it("does not flag isTimeChanged for a date-only reschedule", () => {
    const exceptions: BookingOccurrenceException[] = [
      {
        id: "ex-3",
        occurrenceKey: "row-1:2026-06-15",
        parentServiceRowId: "row-1",
        occurrenceDate: "2026-06-15",
        status: "rescheduled",
        overrideOccurrenceDate: "2026-06-17",
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-01T00:00:00.000Z",
      },
    ];
    const entry = resolveScheduleProgram(baseInput({ exceptions })).find(
      (e) => e.occurrenceKey === "row-1:2026-06-15",
    );
    expect(entry?.displayDate).toBe("2026-06-17");
    expect(entry?.isTimeChanged).toBe(false);
    expect(entry?.reschedule?.newStartTime).toBe("08:00");
  });

  it("leaves reschedule null and isTimeChanged false for an untouched occurrence", () => {
    const entry = resolveScheduleProgram(baseInput())[0];
    expect(entry.reschedule).toBeNull();
    expect(entry.isTimeChanged).toBe(false);
  });
});

describe("scheduleEntryOperationalStatus", () => {
  it("maps a clean occurrence with a planned time to Scheduled", () => {
    const entry = resolveScheduleProgram(baseInput())[0];
    expect(scheduleEntryOperationalStatus(entry).status).toBe("scheduled");
  });

  it("maps a cancelled occurrence to Cancelled", () => {
    const exceptions: BookingOccurrenceException[] = [
      {
        id: "ex-c",
        occurrenceKey: "row-1:2026-06-08",
        parentServiceRowId: "row-1",
        occurrenceDate: "2026-06-08",
        status: "cancelled",
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-01T00:00:00.000Z",
      },
    ];
    const entry = resolveScheduleProgram(baseInput({ exceptions, includeCancelled: true })).find(
      (e) => e.occurrenceKey === "row-1:2026-06-08",
    );
    expect(entry && scheduleEntryOperationalStatus(entry).status).toBe("cancelled");
  });

  it("maps a rescheduled occurrence to Rebooked", () => {
    const exceptions: BookingOccurrenceException[] = [
      {
        id: "ex-r",
        occurrenceKey: "row-1:2026-06-15",
        parentServiceRowId: "row-1",
        occurrenceDate: "2026-06-15",
        status: "rescheduled",
        overrideOccurrenceDate: "2026-06-16",
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-01T00:00:00.000Z",
      },
    ];
    const entry = resolveScheduleProgram(baseInput({ exceptions })).find(
      (e) => e.occurrenceKey === "row-1:2026-06-15",
    );
    expect(entry && scheduleEntryOperationalStatus(entry).status).toBe("rebooked");
  });
});

describe("summarizeScheduleProgram", () => {
  it("rolls up active counts, labour and distinct dimensions", () => {
    const entries = resolveScheduleProgram(
      baseInput({ workOrders: [makeWorkOrder([makeRow({ assignedEmployeeIds: ["emp-1", "emp-2"] })])] }),
    );
    const summary = summarizeScheduleProgram(entries);
    expect(summary.total).toBe(5);
    expect(summary.active).toBe(5);
    expect(summary.distinctCustomers).toBe(1);
    expect(summary.distinctEmployees).toBe(2);
    // 5 occurrences × 120 min visit × 2 staff = 1200 labour minutes.
    expect(summary.visitMinutes).toBe(600);
    expect(summary.labourMinutes).toBe(1200);
  });

  it("counts unstaffed active entries", () => {
    const entries = resolveScheduleProgram(
      baseInput({
        workOrders: [makeWorkOrder([makeRow({ assignedEmployeeIds: [], unassignedEmployeeSlots: 0 })])],
      }),
    );
    expect(summarizeScheduleProgram(entries).unstaffed).toBe(5);
  });
});

describe("computeScheduleBoardMetrics", () => {
  it("splits active occurrences into fully / partially / unstaffed buckets", () => {
    // A single day so each weekly row yields exactly one occurrence.
    const entries = resolveScheduleProgram(
      baseInput({
        workOrders: [
          makeWorkOrder([
            makeRow({ id: "full", assignedEmployeeIds: ["emp-1"], unassignedEmployeeSlots: 0 }),
            makeRow({ id: "partial", assignedEmployeeIds: ["emp-1"], unassignedEmployeeSlots: 2 }),
            makeRow({ id: "open", assignedEmployeeIds: [], unassignedEmployeeSlots: 0 }),
          ]),
        ],
        toDate: "2026-06-01",
      }),
    );
    const m = computeScheduleBoardMetrics(entries);
    expect(m.totalOccurrences).toBe(3);
    expect(m.fullyStaffed).toBe(1);
    expect(m.partiallyStaffed).toBe(1);
    expect(m.unstaffed).toBe(1);
    expect(m.cancelled).toBe(0);
    expect(m.openSlots).toBe(2);
    // Mutual exclusivity: buckets sum to the active total.
    expect(m.fullyStaffed + m.partiallyStaffed + m.unstaffed).toBe(
      m.totalOccurrences - m.cancelled,
    );
    const day = m.byDate.get("2026-06-01");
    expect(day).toEqual({ occurrences: 3, openSlots: 2 });
  });

  it("counts cancelled occurrences without adding them to any staffing bucket", () => {
    const exceptions: BookingOccurrenceException[] = [
      {
        id: "ex-cancel",
        occurrenceKey: "row-1:2026-06-01",
        parentServiceRowId: "row-1",
        occurrenceDate: "2026-06-01",
        status: "cancelled",
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-01T00:00:00.000Z",
      },
    ];
    const entries = resolveScheduleProgram(
      baseInput({ exceptions, includeCancelled: true, toDate: "2026-06-01" }),
    );
    const m = computeScheduleBoardMetrics(entries);
    expect(m.totalOccurrences).toBe(1);
    expect(m.cancelled).toBe(1);
    expect(m.fullyStaffed).toBe(0);
    expect(m.partiallyStaffed).toBe(0);
    expect(m.unstaffed).toBe(0);
    expect(m.openSlots).toBe(0);
  });

  it("keeps the cancelled count from the full period when cancelled rows are hidden", () => {
    const exceptions: BookingOccurrenceException[] = [
      {
        id: "ex-cancel",
        occurrenceKey: "row-1:2026-06-01",
        parentServiceRowId: "row-1",
        occurrenceDate: "2026-06-01",
        status: "cancelled",
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-01T00:00:00.000Z",
      },
    ];
    // "Show cancelled" OFF: visible board entries exclude the cancelled one,
    // while the cancelled-inclusive list is fed as the cancelled source.
    const visible = resolveScheduleProgram(
      baseInput({ exceptions, includeCancelled: false, toDate: "2026-06-01" }),
    );
    const all = resolveScheduleProgram(
      baseInput({ exceptions, includeCancelled: true, toDate: "2026-06-01" }),
    );
    expect(visible).toHaveLength(0); // board does not render the cancelled occurrence

    const m = computeScheduleBoardMetrics(visible, all);
    expect(m.cancelled).toBe(1); // tile still counts it
    expect(m.totalOccurrences).toBe(0); // board totals stay on visible entries
    expect(m.fullyStaffed).toBe(0);
    expect(m.partiallyStaffed).toBe(0);
    expect(m.unstaffed).toBe(0);
    expect(m.openSlots).toBe(0);
    expect(m.labourMinutes).toBe(0);
    expect(m.byDate.get("2026-06-01")).toBeUndefined();
  });

  it("reports the same cancelled count whether cancelled rows are shown or hidden", () => {
    const exceptions: BookingOccurrenceException[] = [
      {
        id: "ex-cancel",
        occurrenceKey: "row-1:2026-06-01",
        parentServiceRowId: "row-1",
        occurrenceDate: "2026-06-01",
        status: "cancelled",
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-01T00:00:00.000Z",
      },
    ];
    const all = resolveScheduleProgram(
      baseInput({ exceptions, includeCancelled: true, toDate: "2026-06-01" }),
    );
    const hidden = resolveScheduleProgram(
      baseInput({ exceptions, includeCancelled: false, toDate: "2026-06-01" }),
    );
    // Shown: entries already include cancelled, so it doubles as the source.
    const shownMetrics = computeScheduleBoardMetrics(all, all);
    // Hidden: visible entries lack the cancelled one; full list supplies count.
    const hiddenMetrics = computeScheduleBoardMetrics(hidden, all);
    expect(shownMetrics.cancelled).toBe(1);
    expect(hiddenMetrics.cancelled).toBe(1);
    expect(shownMetrics.cancelled).toBe(hiddenMetrics.cancelled);
    // Shown board renders the cancelled occurrence in its totals; hidden does not.
    expect(shownMetrics.totalOccurrences).toBe(1);
    expect(hiddenMetrics.totalOccurrences).toBe(0);
  });

  it("counts a multi-employee cancelled occurrence once from the full list", () => {
    const exceptions: BookingOccurrenceException[] = [
      {
        id: "ex-cancel",
        occurrenceKey: "row-multi:2026-06-01",
        parentServiceRowId: "row-multi",
        occurrenceDate: "2026-06-01",
        status: "cancelled",
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-01T00:00:00.000Z",
      },
    ];
    const all = resolveScheduleProgram(
      baseInput({
        workOrders: [
          makeWorkOrder([
            makeRow({ id: "row-multi", assignedEmployeeIds: ["emp-1", "emp-2"] }),
          ]),
        ],
        exceptions,
        includeCancelled: true,
        toDate: "2026-06-01",
      }),
    );
    const hidden = resolveScheduleProgram(
      baseInput({
        workOrders: [
          makeWorkOrder([
            makeRow({ id: "row-multi", assignedEmployeeIds: ["emp-1", "emp-2"] }),
          ]),
        ],
        exceptions,
        includeCancelled: false,
        toDate: "2026-06-01",
      }),
    );
    const m = computeScheduleBoardMetrics(hidden, all);
    expect(m.cancelled).toBe(1); // counted once despite two assignees
  });

  it("counts a multi-employee occurrence exactly once", () => {
    const entries = resolveScheduleProgram(
      baseInput({
        workOrders: [
          makeWorkOrder([makeRow({ assignedEmployeeIds: ["emp-1", "emp-2"] })]),
        ],
        toDate: "2026-06-01",
      }),
    );
    const m = computeScheduleBoardMetrics(entries);
    expect(m.totalOccurrences).toBe(1);
    expect(m.fullyStaffed).toBe(1);
    expect(m.byDate.get("2026-06-01")?.occurrences).toBe(1);
  });

  it("returns all-zero metrics for an empty program", () => {
    const m = computeScheduleBoardMetrics([]);
    expect(m).toEqual({
      totalOccurrences: 0,
      fullyStaffed: 0,
      partiallyStaffed: 0,
      unstaffed: 0,
      cancelled: 0,
      labourMinutes: 0,
      openSlots: 0,
      byDate: new Map(),
    });
  });
});

describe("buildScheduleBoard", () => {
  interface BoardItem {
    id: string;
    date: string;
    employeeIds: string[];
  }
  const items: BoardItem[] = [
    { id: "a", date: "2026-06-01", employeeIds: ["emp-1"] },
    { id: "b", date: "2026-06-01", employeeIds: ["emp-2"] },
    { id: "c", date: "2026-06-02", employeeIds: ["emp-1"] },
    // multi-employee item: appears under both, but is one distinct item.
    { id: "d", date: "2026-06-02", employeeIds: ["emp-1", "emp-2"] },
    // unassigned / open-slot item.
    { id: "e", date: "2026-06-01", employeeIds: [] },
  ];

  const board = buildScheduleBoard(
    items,
    (i) => i.employeeIds,
    (i) => i.date,
  );

  it("buckets items by employee id then by date", () => {
    expect(board.byEmployee.get("emp-1")?.get("2026-06-01")?.map((i) => i.id)).toEqual(["a"]);
    expect(board.byEmployee.get("emp-1")?.get("2026-06-02")?.map((i) => i.id)).toEqual(["c", "d"]);
    expect(board.byEmployee.get("emp-2")?.get("2026-06-01")?.map((i) => i.id)).toEqual(["b"]);
  });

  it("indexes a multi-employee item under every assignee", () => {
    expect(board.byEmployee.get("emp-1")?.get("2026-06-02")?.some((i) => i.id === "d")).toBe(true);
    expect(board.byEmployee.get("emp-2")?.get("2026-06-02")?.some((i) => i.id === "d")).toBe(true);
  });

  it("routes unassigned items to the unassigned-by-date bucket", () => {
    expect(board.unassignedByDate.get("2026-06-01")?.map((i) => i.id)).toEqual(["e"]);
    expect(board.hasUnassigned).toBe(true);
    expect(board.employeeIdsWithWork).toEqual(new Set(["emp-1", "emp-2"]));
  });

  it("reports no unassigned work when every item has an assignee", () => {
    const assignedOnly = buildScheduleBoard(
      items.filter((i) => i.employeeIds.length > 0),
      (i) => i.employeeIds,
      (i) => i.date,
    );
    expect(assignedOnly.hasUnassigned).toBe(false);
    expect(assignedOnly.unassignedByDate.size).toBe(0);
  });
});

describe("buildScheduleBoard — open-slot routing & crash safety", () => {
  interface StaffItem {
    id: string;
    date: string;
    employeeIds?: string[] | null;
    openSlots?: number | null;
  }

  it("routes a partially-assigned item under its employee AND into Unassigned", () => {
    // One assignee + one open slot — must appear in both places, but once each.
    const items: StaffItem[] = [
      { id: "partial", date: "2026-06-01", employeeIds: ["emp-1"], openSlots: 1 },
    ];
    const board = buildScheduleBoard(
      items,
      (i) => i.employeeIds,
      (i) => i.date,
      (i) => i.openSlots,
    );
    expect(board.byEmployee.get("emp-1")?.get("2026-06-01")?.map((i) => i.id)).toEqual(["partial"]);
    expect(board.unassignedByDate.get("2026-06-01")?.map((i) => i.id)).toEqual(["partial"]);
    expect(board.hasUnassigned).toBe(true);
  });

  it("routes a fully unassigned item only into Unassigned", () => {
    const board = buildScheduleBoard(
      [{ id: "open", date: "2026-06-01", employeeIds: [], openSlots: 2 }],
      (i) => i.employeeIds,
      (i) => i.date,
      (i) => i.openSlots,
    );
    expect(board.byEmployee.size).toBe(0);
    expect(board.unassignedByDate.get("2026-06-01")?.map((i) => i.id)).toEqual(["open"]);
  });

  it("does not throw when assignedEmployeeIds is missing/undefined", () => {
    const items: StaffItem[] = [
      { id: "x", date: "2026-06-01", employeeIds: undefined, openSlots: undefined },
      { id: "y", date: "2026-06-01", employeeIds: null },
    ];
    expect(() =>
      buildScheduleBoard(
        items,
        (i) => i.employeeIds,
        (i) => i.date,
        (i) => i.openSlots,
      ),
    ).not.toThrow();
    const board = buildScheduleBoard(
      items,
      (i) => i.employeeIds,
      (i) => i.date,
      (i) => i.openSlots,
    );
    // Missing assignees → treated as fully unassigned open work.
    expect(board.unassignedByDate.get("2026-06-01")?.map((i) => i.id)).toEqual(["x", "y"]);
  });

  it("ignores empty employee id strings rather than bucketing them", () => {
    const board = buildScheduleBoard(
      [{ id: "z", date: "2026-06-01", employeeIds: ["", "emp-9"], openSlots: 0 }],
      (i) => i.employeeIds,
      (i) => i.date,
      (i) => i.openSlots,
    );
    expect(board.employeeIdsWithWork).toEqual(new Set(["emp-9"]));
    expect(board.byEmployee.has("")).toBe(false);
  });

  it("treats a negative open-slot count as zero", () => {
    const board = buildScheduleBoard(
      [{ id: "neg", date: "2026-06-01", employeeIds: ["emp-1"], openSlots: -3 }],
      (i) => i.employeeIds,
      (i) => i.date,
      (i) => i.openSlots,
    );
    expect(board.hasUnassigned).toBe(false);
    expect(board.unassignedByDate.size).toBe(0);
  });
});

describe("resolveScheduleProgram — staffing fields", () => {
  it("derives openSlotCount, requiredStaffCount and isPartiallyAssigned", () => {
    const entries = resolveScheduleProgram(
      baseInput({
        workOrders: [
          makeWorkOrder([makeRow({ assignedEmployeeIds: ["emp-1"], unassignedEmployeeSlots: 1 })]),
        ],
        toDate: "2026-06-01",
      }),
    );
    expect(entries).toHaveLength(1);
    const e = entries[0];
    expect(e.assignedEmployeeIds).toEqual(["emp-1"]);
    expect(e.openSlotCount).toBe(1);
    expect(e.unassignedEmployeeSlots).toBe(1);
    expect(e.requiredStaffCount).toBe(2);
    expect(e.isPartiallyAssigned).toBe(true);
  });

  it("redistributed labour is preserved on the entry and in board metrics", () => {
    // Baseline: 2 employees × 2h visit = 4h total labour.
    const baselineEntries = resolveScheduleProgram(
      baseInput({
        workOrders: [
          makeWorkOrder([makeRow({ assignedEmployeeIds: ["emp-1", "emp-2"], unassignedEmployeeSlots: 0 })]),
        ],
        toDate: "2026-06-01",
      }),
    );
    const baselineLabour = computeScheduleBoardMetrics(baselineEntries).labourMinutes;
    expect(baselineLabour).toBe(240);

    // Redistributed: 1 employee, total labour pinned at 4h.
    const entries = resolveScheduleProgram(
      baseInput({
        workOrders: [
          makeWorkOrder([
            makeRow({
              assignedEmployeeIds: ["emp-1"],
              unassignedEmployeeSlots: 0,
              totalLabourMinutesOverride: 240,
            }),
          ]),
        ],
        toDate: "2026-06-01",
      }),
    );
    const e = entries[0];
    expect(e.visitMinutes).toBe(120);
    expect(e.labourMinutes).toBe(240);
    expect(e.perEmployeeMinutes).toBe(240);
    expect(e.isLabourRedistributed).toBe(true);
    expect(e.requiredStaffCount).toBe(1);
    // Total labour preserved despite the reduced crew.
    expect(computeScheduleBoardMetrics(entries).labourMinutes).toBe(baselineLabour);
  });

  it("defaults a fully unassigned occurrence to requiredStaffCount >= 1", () => {
    const entries = resolveScheduleProgram(
      baseInput({
        workOrders: [
          makeWorkOrder([makeRow({ assignedEmployeeIds: [], unassignedEmployeeSlots: 0 })]),
        ],
        toDate: "2026-06-01",
      }),
    );
    const e = entries[0];
    expect(e.assignedEmployeeIds).toEqual([]);
    expect(e.openSlotCount).toBe(0);
    expect(e.requiredStaffCount).toBe(1);
    expect(e.isPartiallyAssigned).toBe(false);
  });
});

describe("runScheduleIntegrityChecks", () => {
  it("passes all checks for a clean program", () => {
    const entries = resolveScheduleProgram(baseInput());
    const checks = runScheduleIntegrityChecks(entries, {
      fromDate: "2026-06-01",
      toDate: "2026-06-30",
    });
    expect(overallIntegrity(checks)).toBe("pass");
    expect(checks.find((c) => c.id === "unique-keys")?.status).toBe("pass");
  });

  it("warns when an active entry has no staffing intent", () => {
    const entries = resolveScheduleProgram(
      baseInput({
        workOrders: [makeWorkOrder([makeRow({ assignedEmployeeIds: [], unassignedEmployeeSlots: 0 })])],
      }),
    );
    const checks = runScheduleIntegrityChecks(entries, {
      fromDate: "2026-06-01",
      toDate: "2026-06-30",
    });
    const staffing = checks.find((c) => c.id === "staffing-defined");
    expect(staffing?.status).toBe("warn");
    expect(staffing?.count).toBe(5);
    expect(overallIntegrity(checks)).toBe("warn");
  });

  it("warns when customer metadata cannot be resolved", () => {
    const entries = resolveScheduleProgram(baseInput({ customers: [] }));
    const checks = runScheduleIntegrityChecks(entries, {
      fromDate: "2026-06-01",
      toDate: "2026-06-30",
    });
    expect(checks.find((c) => c.id === "resolved-metadata")?.status).toBe("warn");
  });
});
