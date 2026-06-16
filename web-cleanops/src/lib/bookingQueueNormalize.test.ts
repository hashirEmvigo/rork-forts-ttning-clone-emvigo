import { describe, expect, it } from "vitest";

import {
  calculatePlannedLabourMinutes,
  type BookingQueueItem,
  type WorkOrderServiceRow,
} from "@/types";
import {
  normalizeBookingQueueItem,
  normalizeServiceRowStaffing,
} from "@/lib/bookingQueueNormalize";

const EMPLOYEE_NAMES: Record<string, string> = {
  ingrid: "Ingrid Sand",
  kari: "Kari Holm",
};
const resolveName = (id: string): string | undefined => EMPLOYEE_NAMES[id];

/** A live source row, overridable per test. */
function makeRow(overrides: Partial<WorkOrderServiceRow> = {}): WorkOrderServiceRow {
  return {
    id: "row_1",
    serviceName: "Regular Cleaning",
    status: "planned",
    serviceDate: "2026-05-31",
    plannedStartTime: "09:00",
    plannedEndTime: "12:00",
    recurrenceInterval: "one_time",
    assignedEmployeeIds: ["ingrid"],
    unassignedEmployeeSlots: 0,
    sortOrder: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as WorkOrderServiceRow;
}

/** A persisted booking queue item snapshot, overridable per test. */
function makeItem(overrides: Partial<BookingQueueItem> = {}): BookingQueueItem {
  return {
    id: "book_1",
    companyId: "cmp_1",
    workOrderId: "wo_1",
    workOrderNumber: "WO-1001",
    serviceRowId: "row_1",
    customerId: "cust_1",
    customerName: "Ingrid Sand",
    serviceName: "Regular Cleaning",
    serviceDate: "2026-05-31",
    plannedStartTime: "09:00",
    plannedEndTime: "12:00",
    assignedEmployeeIds: ["ingrid"],
    unassignedEmployeeSlots: 0,
    recurrenceInterval: "one_time",
    assignmentStatus: "assigned",
    scheduleStatus: "unscheduled",
    scheduledDate: null,
    scheduledStartTime: null,
    scheduledEndTime: null,
    assignedEmployeeNames: ["Ingrid Sand"],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("normalizeServiceRowStaffing", () => {
  it("defaults legacy rows missing staffing fields", () => {
    const res = normalizeServiceRowStaffing({
      assignedEmployeeIds: undefined as unknown as string[],
      unassignedEmployeeSlots: undefined as unknown as number,
      totalLabourMinutesOverride: undefined,
    });
    expect(res.assignedEmployeeIds).toEqual([]);
    expect(res.unassignedEmployeeSlots).toBe(0);
    expect(res.totalLabourMinutesOverride).toBeNull();
  });

  it("keeps a valid pinned override and clamps negative slots", () => {
    const res = normalizeServiceRowStaffing({
      assignedEmployeeIds: ["ingrid"],
      unassignedEmployeeSlots: -3,
      totalLabourMinutesOverride: 240,
    });
    expect(res.unassignedEmployeeSlots).toBe(0);
    expect(res.totalLabourMinutesOverride).toBe(240);
  });

  it("ignores a non-positive or non-finite override", () => {
    expect(
      normalizeServiceRowStaffing({
        assignedEmployeeIds: [],
        unassignedEmployeeSlots: 0,
        totalLabourMinutesOverride: 0,
      }).totalLabourMinutesOverride,
    ).toBeNull();
    expect(
      normalizeServiceRowStaffing({
        assignedEmployeeIds: [],
        unassignedEmployeeSlots: 0,
        totalLabourMinutesOverride: Number.NaN,
      }).totalLabourMinutesOverride,
    ).toBeNull();
  });
});

describe("normalizeBookingQueueItem — re-derives from the live source row", () => {
  it("ignores a stale headcount snapshot and uses the source row", () => {
    // Old snapshot still says 2 employees; the live row now has only Ingrid.
    const item = makeItem({
      assignedEmployeeIds: ["ingrid", "kari"],
      assignedEmployeeNames: ["Ingrid Sand", "Kari Holm"],
      unassignedEmployeeSlots: 1,
    });
    const row = makeRow({ assignedEmployeeIds: ["ingrid"], unassignedEmployeeSlots: 0 });
    const res = normalizeBookingQueueItem(item, row, resolveName);
    expect(res.assignedEmployeeIds).toEqual(["ingrid"]);
    expect(res.assignedEmployeeNames).toEqual(["Ingrid Sand"]);
    expect(res.unassignedEmployeeSlots).toBe(0);
    expect(res.assignmentStatus).toBe("assigned");
  });

  it("re-derives the planned window and duration from the source row", () => {
    // Stale snapshot window 08:00–10:00; live row moved to 09:00–12:00.
    const item = makeItem({ plannedStartTime: "08:00", plannedEndTime: "10:00", durationMinutes: 120 });
    const row = makeRow({ plannedStartTime: "09:00", plannedEndTime: "12:00" });
    const res = normalizeBookingQueueItem(item, row, resolveName);
    expect(res.plannedStartTime).toBe("09:00");
    expect(res.plannedEndTime).toBe("12:00");
    expect(res.durationMinutes).toBe(180);
  });

  it("fills in staffing for an item that predates the staffing fields", () => {
    const item = makeItem({
      assignedEmployeeIds: undefined,
      unassignedEmployeeSlots: undefined,
      assignedEmployeeNames: undefined,
    });
    const row = makeRow({ assignedEmployeeIds: ["ingrid"], unassignedEmployeeSlots: 0 });
    const res = normalizeBookingQueueItem(item, row, resolveName);
    expect(res.assignedEmployeeIds).toEqual(["ingrid"]);
    expect(res.unassignedEmployeeSlots).toBe(0);
  });

  it("preserves booking-level fields (cancellation, reschedule, schedule placement)", () => {
    const item = makeItem({
      cancelledAt: "2026-04-01T00:00:00.000Z",
      cancelReason: "Customer away",
      scheduledDate: "2026-06-02",
      reschedule: {
        originalDate: "2026-05-31",
        newDate: "2026-06-02",
        oneTime: true,
        rescheduledAt: "2026-05-01T00:00:00.000Z",
      },
    });
    const res = normalizeBookingQueueItem(item, makeRow(), resolveName);
    expect(res.cancelledAt).toBe("2026-04-01T00:00:00.000Z");
    expect(res.cancelReason).toBe("Customer away");
    expect(res.scheduledDate).toBe("2026-06-02");
    expect(res.reschedule?.newDate).toBe("2026-06-02");
    expect(res.id).toBe("book_1");
  });

  it("orphan (no live source row) keeps safe shapes without crashing", () => {
    const item = makeItem({
      assignedEmployeeIds: undefined,
      assignedEmployeeNames: undefined,
      unassignedEmployeeSlots: undefined,
      employeeTimeOverrides: undefined,
      cancelledAt: "2026-04-01T00:00:00.000Z",
    });
    const res = normalizeBookingQueueItem(item, undefined, resolveName);
    expect(res.assignedEmployeeIds).toEqual([]);
    expect(res.assignedEmployeeNames).toEqual([]);
    expect(res.unassignedEmployeeSlots).toBe(0);
    expect(res.employeeTimeOverrides).toEqual([]);
    // Booking-level fields are still preserved for the audit trail.
    expect(res.cancelledAt).toBe("2026-04-01T00:00:00.000Z");
  });
});

describe("acceptance — existing booking follows the split rule without delete/recreate", () => {
  it("09:00–12:00, one assignee, no new fields → add Kari (split) → 3h labour, 1.5h each", () => {
    // An OLD booking item: 3h window, one assignee, and none of the new staffing
    // fields populated (no slots, no override) on the snapshot.
    const oldItem = makeItem({
      assignedEmployeeIds: ["ingrid"],
      assignedEmployeeNames: ["Ingrid Sand"],
      unassignedEmployeeSlots: undefined,
    });

    // The dispatcher adds Kari and chooses "Split existing work". The dialog
    // writes the resolved staffing + preserved total labour to the SOURCE ROW.
    const liveRow = makeRow({
      assignedEmployeeIds: ["ingrid", "kari"],
      unassignedEmployeeSlots: 0,
      totalLabourMinutesOverride: 180, // 3h preserved, split across the crew
    });

    const normalized = normalizeBookingQueueItem(oldItem, liveRow, resolveName);
    expect(normalized.assignedEmployeeIds).toEqual(["ingrid", "kari"]);
    expect(normalized.assignedEmployeeNames).toEqual(["Ingrid Sand", "Kari Holm"]);

    // Booking Queue labour (occurrence values + live override from the row).
    const queueLabour = calculatePlannedLabourMinutes({
      plannedStartTime: normalized.plannedStartTime,
      plannedEndTime: normalized.plannedEndTime,
      assignedEmployeeIds: normalized.assignedEmployeeIds,
      unassignedEmployeeSlots: normalized.unassignedEmployeeSlots,
      totalLabourMinutesOverride: liveRow.totalLabourMinutesOverride,
    });
    expect(queueLabour.visitMinutes).toBe(180);
    expect(queueLabour.labourMinutes).toBe(180);
    expect(queueLabour.perEmployeeMinutes).toBe(90);

    // Schedule Board reads the same live source row directly → identical labour.
    const boardLabour = calculatePlannedLabourMinutes({
      plannedStartTime: liveRow.plannedStartTime,
      plannedEndTime: liveRow.plannedEndTime,
      assignedEmployeeIds: liveRow.assignedEmployeeIds,
      unassignedEmployeeSlots: liveRow.unassignedEmployeeSlots,
      totalLabourMinutesOverride: liveRow.totalLabourMinutesOverride,
    });
    expect(boardLabour.visitMinutes).toBe(queueLabour.visitMinutes);
    expect(boardLabour.labourMinutes).toBe(queueLabour.labourMinutes);
    expect(boardLabour.perEmployeeMinutes).toBe(queueLabour.perEmployeeMinutes);
  });
});
