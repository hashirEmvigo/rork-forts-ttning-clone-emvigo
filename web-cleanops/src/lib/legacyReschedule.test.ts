import { describe, expect, it } from "vitest";
import { legacyRescheduleToException, withLegacyReschedules } from "./legacyReschedule";
import { resolveScheduleProgram, type ScheduleCoreInput } from "./scheduleCore";
import type {
  BookingOccurrenceException,
  BookingQueueItem,
  WorkOrder,
  WorkOrderServiceRow,
} from "@/types";

function makeItem(overrides: Partial<BookingQueueItem> = {}): BookingQueueItem {
  return {
    id: "book-1",
    companyId: "co-1",
    workOrderId: "wo-1",
    workOrderNumber: "WO-1001",
    serviceRowId: "row-1",
    customerId: "cust-1",
    customerName: "Bergen Office Park",
    serviceName: "Window Cleaning",
    serviceDate: "2026-06-01",
    recurrenceInterval: "one_time",
    assignmentStatus: "unassigned",
    scheduleStatus: "unscheduled",
    scheduledDate: null,
    scheduledStartTime: null,
    scheduledEndTime: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeRow(overrides: Partial<WorkOrderServiceRow> = {}): WorkOrderServiceRow {
  return {
    id: "row-1",
    serviceName: "Window Cleaning",
    quantity: 1,
    status: "planned",
    serviceDate: "2026-06-01",
    recurrenceInterval: "one_time",
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

function makeWorkOrder(rows: WorkOrderServiceRow[]): WorkOrder {
  return {
    id: "wo-1",
    companyId: "co-1",
    customerId: "cust-1",
    number: "WO-1001",
    status: "planned",
    serviceRows: rows,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function coreInput(overrides: Partial<ScheduleCoreInput> = {}): ScheduleCoreInput {
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

describe("legacyRescheduleToException", () => {
  it("returns null when there is no legacy reschedule", () => {
    expect(legacyRescheduleToException(makeItem())).toBeNull();
  });

  it("converts an ISO-dated legacy reschedule into a synthetic exception keyed on the rule date", () => {
    const item = makeItem({
      reschedule: {
        originalDate: "2026-06-01T00:00:00.000Z",
        newDate: "2026-06-05T00:00:00.000Z",
        oneTime: true,
        rescheduledAt: "2026-05-01T00:00:00.000Z",
      },
    });
    const ex = legacyRescheduleToException(item);
    expect(ex).not.toBeNull();
    expect(ex?.occurrenceKey).toBe("row-1:2026-06-01");
    expect(ex?.occurrenceDate).toBe("2026-06-01");
    expect(ex?.status).toBe("rescheduled");
    expect(ex?.overrideOccurrenceDate).toBe("2026-06-05");
    // The legacy model never carried times.
    expect(ex?.overrideStartTime).toBeNull();
    expect(ex?.overrideEndTime).toBeNull();
  });

  it("returns null for a no-op move (new date equals the rule date)", () => {
    const item = makeItem({
      reschedule: {
        originalDate: "2026-06-01",
        newDate: "2026-06-01",
        oneTime: true,
        rescheduledAt: "2026-05-01T00:00:00.000Z",
      },
    });
    expect(legacyRescheduleToException(item)).toBeNull();
  });

  it("returns null when the item has no rule (service) date", () => {
    const item = makeItem({
      serviceDate: null,
      reschedule: {
        originalDate: "2026-06-01",
        newDate: "2026-06-05",
        oneTime: true,
        rescheduledAt: "2026-05-01T00:00:00.000Z",
      },
    });
    expect(legacyRescheduleToException(item)).toBeNull();
  });
});

describe("withLegacyReschedules", () => {
  const legacyItem = makeItem({
    reschedule: {
      originalDate: "2026-06-01",
      newDate: "2026-06-05",
      oneTime: true,
      rescheduledAt: "2026-05-01T00:00:00.000Z",
    },
  });

  it("returns the same array reference when there is nothing to bridge", () => {
    const exceptions: BookingOccurrenceException[] = [];
    expect(withLegacyReschedules([makeItem()], exceptions)).toBe(exceptions);
  });

  it("appends a synthetic exception for a legacy reschedule", () => {
    const merged = withLegacyReschedules([legacyItem], []);
    expect(merged).toHaveLength(1);
    expect(merged[0].occurrenceKey).toBe("row-1:2026-06-01");
    expect(merged[0].overrideOccurrenceDate).toBe("2026-06-05");
  });

  it("never overrides a real persisted exception for the same occurrence", () => {
    const real: BookingOccurrenceException = {
      id: "bocc-1",
      occurrenceKey: "row-1:2026-06-01",
      parentServiceRowId: "row-1",
      occurrenceDate: "2026-06-01",
      status: "rescheduled",
      overrideOccurrenceDate: "2026-06-10",
      createdAt: "2026-05-02T00:00:00.000Z",
      updatedAt: "2026-05-02T00:00:00.000Z",
    };
    const merged = withLegacyReschedules([legacyItem], [real]);
    // Only the real exception remains — no synthetic duplicate is appended.
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("bocc-1");
    expect(merged[0].overrideOccurrenceDate).toBe("2026-06-10");
  });
});

describe("Schedule Core sees legacy reschedules via the compatibility reader", () => {
  const legacyItem = makeItem({
    reschedule: {
      originalDate: "2026-06-01",
      newDate: "2026-06-05",
      oneTime: true,
      rescheduledAt: "2026-05-01T00:00:00.000Z",
    },
  });

  it("is invisible to Schedule Core without the bridge (documents the old divergence)", () => {
    // No exceptions → the one-time row still sits on its rule date 06-01.
    const entries = resolveScheduleProgram(coreInput());
    const entry = entries.find((e) => e.occurrenceKey === "row-1:2026-06-01");
    expect(entry?.displayDate).toBe("2026-06-01");
    expect(entry?.reschedule).toBeNull();
  });

  it("appears on the new display date once the legacy move is bridged in", () => {
    const exceptions = withLegacyReschedules([legacyItem], []);
    const entries = resolveScheduleProgram(coreInput({ exceptions }));
    const entry = entries.find((e) => e.occurrenceKey === "row-1:2026-06-01");
    expect(entry?.status).toBe("rescheduled");
    expect(entry?.displayDate).toBe("2026-06-05");
    expect(entry?.reschedule?.originalDate).toBe("2026-06-01");
    expect(entry?.reschedule?.newDate).toBe("2026-06-05");
  });

  it("keeps a cross-boundary legacy move only on the new date's range", () => {
    const exceptions = withLegacyReschedules([legacyItem], []);
    // Source range (around 06-01) must NOT contain the moved occurrence.
    const source = resolveScheduleProgram(
      coreInput({ exceptions, fromDate: "2026-06-01", toDate: "2026-06-03" }),
    );
    expect(source.some((e) => e.occurrenceKey === "row-1:2026-06-01")).toBe(false);
    // Target range (around 06-05) DOES contain it, by its display date.
    const target = resolveScheduleProgram(
      coreInput({ exceptions, fromDate: "2026-06-04", toDate: "2026-06-07" }),
    );
    const moved = target.find((e) => e.occurrenceKey === "row-1:2026-06-01");
    expect(moved?.displayDate).toBe("2026-06-05");
  });
});
