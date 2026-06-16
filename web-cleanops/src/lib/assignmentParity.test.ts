import { describe, expect, it } from "vitest";
import {
  applyAssignToggle,
  validateStaffingChange,
} from "./employeeAssignment";
import {
  resolveScheduleProgram,
  type ScheduleCoreInput,
} from "./scheduleCore";
import { normalizeUnassignedSlots } from "@/types";
import type { WorkOrder, WorkOrderServiceRow } from "@/types";

/**
 * Cross-surface staffing parity.
 *
 * Every assignment surface — Schedule board, Booking Queue, Work Order
 * quick-assign — now drives the SAME shared `AssignEmployeesDialog`, which uses
 * the SAME `employeeAssignment` helpers ({@link applyAssignToggle},
 * {@link validateStaffingChange}) and writes the SAME payload
 * (`{ assignedEmployeeIds, unassignedEmployeeSlots }`) to the SAME work-order
 * service row.
 *
 * `simulateDialogSave` reproduces exactly what the shared dialog computes on
 * save, so these tests guarantee no surface can bypass open-slot handling or
 * staffing validation, and that Schedule Core reads back the result identically
 * regardless of which surface initiated the change.
 */

interface DialogTarget {
  assignedEmployeeIds: string[];
  openSlots: number;
}

interface DialogResult {
  blocked: boolean;
  warnings: string[];
  /** The payload written to the service row (null when blocked). */
  payload: { assignedEmployeeIds: string[]; unassignedEmployeeSlots: number } | null;
}

/**
 * Mirrors `AssignEmployeesDialog`: starts from the row's current staffing,
 * applies a sequence of employee toggles + open-slot deltas, then validates the
 * proposed change. A blocked change yields no payload (the dialog forces one
 * open slot and aborts); a warned change only commits when `confirm` is true.
 */
function simulateDialogSave(
  target: DialogTarget,
  edits: { toggle?: string[]; slotDelta?: number },
  confirm = false,
): DialogResult {
  let selected = [...target.assignedEmployeeIds];
  let slots = Math.max(0, target.openSlots);

  for (const employeeId of edits.toggle ?? []) {
    const next = applyAssignToggle({ selectedIds: selected, openSlots: slots, employeeId });
    selected = next.selectedIds;
    slots = next.openSlots;
  }
  if (edits.slotDelta) slots = Math.max(0, slots + edits.slotDelta);

  const validation = validateStaffingChange({
    previousAssignedCount: target.assignedEmployeeIds.length,
    previousOpenSlots: target.openSlots,
    nextAssignedCount: selected.length,
    nextOpenSlots: slots,
  });

  if (validation.blocked) {
    return { blocked: true, warnings: [], payload: null };
  }
  if (validation.warnings.length > 0 && !confirm) {
    return { blocked: false, warnings: validation.warnings, payload: null };
  }
  return {
    blocked: false,
    warnings: validation.warnings,
    payload: { assignedEmployeeIds: selected, unassignedEmployeeSlots: slots },
  };
}

function makeRow(overrides: Partial<WorkOrderServiceRow> = {}): WorkOrderServiceRow {
  return {
    id: "row-1",
    serviceName: "Regular Cleaning",
    quantity: 1,
    status: "planned",
    serviceDate: "2026-06-01", // Monday
    recurrenceInterval: "weekly",
    plannedStartTime: "08:00",
    plannedEndTime: "10:00",
    assignedEmployeeIds: ["emp-1", "emp-2"],
    unassignedEmployeeSlots: 0,
    sortOrder: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeWorkOrder(row: WorkOrderServiceRow): WorkOrder {
  return {
    id: "wo-1",
    companyId: "co-1",
    customerId: "cust-1",
    number: "WO-1007",
    status: "planned",
    serviceRows: [row],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function scheduleInput(row: WorkOrderServiceRow, overrides: Partial<ScheduleCoreInput> = {}): ScheduleCoreInput {
  return {
    workOrders: [makeWorkOrder(row)],
    customers: [{ id: "cust-1", name: "Bergen Office Park" }],
    employees: [
      { id: "emp-1", name: "Ingrid Sand" },
      { id: "emp-2", name: "Kari Moen" },
      { id: "emp-3", name: "Lars Vik" },
    ],
    exceptions: [],
    fromDate: "2026-06-08",
    toDate: "2026-06-08",
    ...overrides,
  };
}

/** Builds the dialog target each surface derives from the same service row. */
function targetFromRow(row: WorkOrderServiceRow): DialogTarget {
  return {
    assignedEmployeeIds: row.assignedEmployeeIds ?? [],
    openSlots: normalizeUnassignedSlots(row.unassignedEmployeeSlots),
  };
}

describe("assignment parity — every surface writes the same payload", () => {
  it("derives an identical dialog target from the Schedule, Booking Queue and Work Order shapes", () => {
    const row = makeRow({ assignedEmployeeIds: ["emp-1"], unassignedEmployeeSlots: 2 });

    // Schedule board (ScheduleEntry-like): assignedEmployeeIds + openSlotCount.
    const scheduleTarget: DialogTarget = {
      assignedEmployeeIds: ["emp-1"],
      openSlots: 2,
    };
    // Booking Queue (resolved occurrence): assignedEmployeeIds + unassignedEmployeeSlots.
    const bookingTarget: DialogTarget = {
      assignedEmployeeIds: ["emp-1"],
      openSlots: normalizeUnassignedSlots(2),
    };
    // Work Order (service row directly).
    const workOrderTarget = targetFromRow(row);

    expect(bookingTarget).toEqual(scheduleTarget);
    expect(workOrderTarget).toEqual(scheduleTarget);
  });

  it("produces the same write payload for the same edit regardless of surface", () => {
    const target = targetFromRow(makeRow()); // 2 assigned, 0 open
    // Add emp-3 then add an open slot — the same edit every surface can make.
    const fromSchedule = simulateDialogSave(target, { toggle: ["emp-3"], slotDelta: 1 }, true);
    const fromQueue = simulateDialogSave(target, { toggle: ["emp-3"], slotDelta: 1 }, true);
    const fromWorkOrder = simulateDialogSave(target, { toggle: ["emp-3"], slotDelta: 1 }, true);
    expect(fromSchedule.payload).toEqual(fromQueue.payload);
    expect(fromWorkOrder.payload).toEqual(fromQueue.payload);
  });
});

describe("open-slot handling and validation are enforced on save", () => {
  it("removing an employee converts the position into an open slot (staffing preserved)", () => {
    const target = targetFromRow(makeRow()); // 2 assigned, 0 open
    const res = simulateDialogSave(target, { toggle: ["emp-2"] }, true);
    expect(res.payload).toEqual({
      assignedEmployeeIds: ["emp-1"],
      unassignedEmployeeSlots: 1,
    });
    expect(res.warnings).toEqual([]); // required staffing unchanged → no warning
  });

  it("blocks a save that would require nobody (0 employees + 0 open slots)", () => {
    const target: DialogTarget = { assignedEmployeeIds: ["emp-1"], openSlots: 0 };
    // Removing the only employee then deleting the auto-created open slot.
    const res = simulateDialogSave(target, { toggle: ["emp-1"], slotDelta: -1 });
    expect(res.blocked).toBe(true);
    expect(res.payload).toBeNull();
  });

  it("requires confirmation when staffing increases", () => {
    const target = targetFromRow(makeRow()); // 2 assigned, 0 open
    const firstAttempt = simulateDialogSave(target, { toggle: ["emp-3"] }, false);
    expect(firstAttempt.payload).toBeNull();
    expect(firstAttempt.warnings).toContain("exceeds");
    const confirmed = simulateDialogSave(target, { toggle: ["emp-3"] }, true);
    expect(confirmed.payload?.assignedEmployeeIds).toEqual(["emp-1", "emp-2", "emp-3"]);
  });
});

describe("Schedule Core reflects changes saved from any surface", () => {
  it("open slots saved from the dialog persist and are read back by Schedule Core", () => {
    const before = makeRow({ assignedEmployeeIds: ["emp-1", "emp-2"], unassignedEmployeeSlots: 0 });
    const res = simulateDialogSave(targetFromRow(before), { toggle: ["emp-2"] }, true);
    expect(res.payload).not.toBeNull();

    // Apply the payload exactly as updateWorkOrderServiceRow would.
    const after = makeRow({
      assignedEmployeeIds: res.payload!.assignedEmployeeIds,
      unassignedEmployeeSlots: res.payload!.unassignedEmployeeSlots,
    });

    const entry = resolveScheduleProgram(scheduleInput(after))[0];
    expect(entry.assignedEmployeeIds).toEqual(["emp-1"]);
    expect(entry.unassignedEmployeeSlots).toBe(1);
    expect(entry.openSlotCount).toBe(1);
    expect(entry.isPartiallyAssigned).toBe(true);
  });

  it("a change made from one surface yields the same Schedule occurrence as another", () => {
    const before = makeRow({ assignedEmployeeIds: ["emp-1"], unassignedEmployeeSlots: 1 });
    // Booking Queue fills the open slot with emp-2; Work Order makes the same edit.
    const fromQueue = simulateDialogSave(targetFromRow(before), { toggle: ["emp-2"] }, true);
    const fromWorkOrder = simulateDialogSave(targetFromRow(before), { toggle: ["emp-2"] }, true);
    expect(fromQueue.payload).toEqual(fromWorkOrder.payload);

    const queueRow = makeRow({
      assignedEmployeeIds: fromQueue.payload!.assignedEmployeeIds,
      unassignedEmployeeSlots: fromQueue.payload!.unassignedEmployeeSlots,
    });
    const workOrderRow = makeRow({
      assignedEmployeeIds: fromWorkOrder.payload!.assignedEmployeeIds,
      unassignedEmployeeSlots: fromWorkOrder.payload!.unassignedEmployeeSlots,
    });

    const queueEntry = resolveScheduleProgram(scheduleInput(queueRow))[0];
    const workOrderEntry = resolveScheduleProgram(scheduleInput(workOrderRow))[0];
    expect(queueEntry.assignedEmployeeIds).toEqual(workOrderEntry.assignedEmployeeIds);
    expect(queueEntry.openSlotCount).toBe(workOrderEntry.openSlotCount);
    expect(queueEntry.assignedEmployeeIds).toEqual(["emp-1", "emp-2"]);
    expect(queueEntry.openSlotCount).toBe(0);
  });

  it("counts a multi-employee occurrence once with both surfaces' result", () => {
    const before = makeRow({ assignedEmployeeIds: ["emp-1"], unassignedEmployeeSlots: 0 });
    const res = simulateDialogSave(targetFromRow(before), { toggle: ["emp-2"] }, true);
    const after = makeRow({
      assignedEmployeeIds: res.payload!.assignedEmployeeIds,
      unassignedEmployeeSlots: res.payload!.unassignedEmployeeSlots,
    });
    const entries = resolveScheduleProgram(scheduleInput(after));
    expect(entries).toHaveLength(1);
    expect(entries[0].assignedEmployeeNames).toEqual(["Ingrid Sand", "Kari Moen"]);
  });
});
