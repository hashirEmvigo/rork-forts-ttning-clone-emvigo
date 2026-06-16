import { describe, expect, it } from "vitest";
import {
  applyAssignToggle,
  buildAssignSuggestions,
  compareVariationStaffing,
  computeEmployeeCustomerHistory,
  computePreservedLabourMinutes,
  resolveCreateStaffing,
  resolveEmployeeAddition,
  resolveEmployeeRemoval,
  resolveOpenSlotRemoval,
  resolveStaffingSaveGate,
  shouldPromptAdditionIntent,
  shouldPromptOpenSlotRemoval,
  shouldPromptRemovalIntent,
  undoEmployeeAddition,
  validateStaffingChange,
  type EmployeeCustomerHistory,
} from "./employeeAssignment";
import type { Employee, TimeReport, WorkOrder, WorkOrderServiceRow } from "@/types";

const NOW = new Date("2026-06-10T00:00:00.000Z");

function makeEmployee(overrides: Partial<Employee> = {}): Employee {
  return {
    id: "emp-1",
    companyId: "co-1",
    name: "Ingrid Sand",
    email: "ingrid@example.com",
    status: "active",
    teamIds: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeRow(overrides: Partial<WorkOrderServiceRow> = {}): WorkOrderServiceRow {
  return {
    id: "row-1",
    serviceName: "Regular Cleaning",
    quantity: 1,
    status: "planned",
    serviceDate: "2026-06-01",
    recurrenceInterval: "one_time",
    assignedEmployeeIds: [],
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
    number: "WO-1007",
    status: "planned",
    serviceRows: rows,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeTimeReport(overrides: Partial<TimeReport> = {}): TimeReport {
  return {
    id: "tr-1",
    companyId: "co-1",
    workOrderId: "wo-1",
    serviceRowId: "row-1",
    jobName: "Regular Cleaning",
    employeeId: "emp-1",
    employeeName: "Ingrid Sand",
    scheduledMinutes: 120,
    actualMinutes: 120,
    deviationMinutes: 0,
    bookingId: null,
    billableDeviationMinutes: 0,
    internalDeviationMinutes: 0,
    deviationReason: null,
    deviationComment: null,
    auditHistory: [],
    approvalStatus: "auto_approved",
    approvedBy: "System",
    approvedAt: "2026-06-02T00:00:00.000Z",
    submittedAt: "2026-06-02T08:00:00.000Z",
    createdAt: "2026-06-02T00:00:00.000Z",
    updatedAt: "2026-06-02T00:00:00.000Z",
    ...overrides,
  };
}

describe("computeEmployeeCustomerHistory", () => {
  it("counts assigned rows and time reports, tracking the last visit date", () => {
    const workOrders = [
      makeWorkOrder([
        makeRow({ id: "past-1", serviceDate: "2026-05-20", assignedEmployeeIds: ["emp-1"] }),
        makeRow({ id: "past-2", serviceDate: "2026-05-28", assignedEmployeeIds: ["emp-1"] }),
      ]),
    ];
    const reports = [makeTimeReport({ submittedAt: "2026-06-02T08:00:00.000Z", employeeId: "emp-1" })];
    const history = computeEmployeeCustomerHistory("cust-1", workOrders, reports, {
      now: NOW,
      excludeRowId: "row-being-edited",
    });
    const entry = history.get("emp-1") as EmployeeCustomerHistory;
    expect(entry.count).toBe(3);
    expect(entry.lastVisitDate).toBe("2026-06-02");
  });

  it("excludes the row being edited so its own assignment is not counted", () => {
    const workOrders = [
      makeWorkOrder([makeRow({ id: "current", serviceDate: "2026-06-01", assignedEmployeeIds: ["emp-1"] })]),
    ];
    const history = computeEmployeeCustomerHistory("cust-1", workOrders, [], {
      now: NOW,
      excludeRowId: "current",
    });
    expect(history.has("emp-1")).toBe(false);
  });

  it("ignores work outside the lookback window and other customers", () => {
    const workOrders = [
      makeWorkOrder([makeRow({ id: "old", serviceDate: "2020-01-01", assignedEmployeeIds: ["emp-1"] })]),
      makeWorkOrder([makeRow({ id: "other", serviceDate: "2026-06-01", assignedEmployeeIds: ["emp-2"] })], {
        id: "wo-2",
        customerId: "cust-2",
      }),
    ];
    const history = computeEmployeeCustomerHistory("cust-1", workOrders, [], { now: NOW });
    expect(history.has("emp-1")).toBe(false);
    expect(history.has("emp-2")).toBe(false);
  });
});

describe("buildAssignSuggestions", () => {
  const employees = [
    makeEmployee({ id: "emp-1", name: "Ingrid Sand" }),
    makeEmployee({ id: "emp-2", name: "Kari Moen" }),
    makeEmployee({ id: "emp-3", name: "Lars Vik" }),
  ];

  it("gives a star + label to employees with history and none to those without", () => {
    const history = new Map<string, EmployeeCustomerHistory>([
      ["emp-1", { count: 8, lastVisitDate: "2026-06-02" }],
      ["emp-2", { count: 3, lastVisitDate: "2026-05-28" }],
    ]);
    const suggestions = buildAssignSuggestions({ employees, history, selectedIds: [] });
    const ingrid = suggestions.find((s) => s.employee.id === "emp-1");
    const lars = suggestions.find((s) => s.employee.id === "emp-3");
    expect(ingrid?.star).not.toBeNull();
    expect(ingrid?.historyLabel).toBe("Previously worked here 8 times · Last visit: 2026-06-02");
    expect(lars?.star).toBeNull();
    expect(lars?.historyLabel).toBeNull();
  });

  it("marks the most-recent employee as 'last' and a high-volume one as 'frequent'", () => {
    const history = new Map<string, EmployeeCustomerHistory>([
      // emp-1 frequent (>=5) but older; emp-2 has the most recent visit.
      ["emp-1", { count: 8, lastVisitDate: "2026-05-01" }],
      ["emp-2", { count: 6, lastVisitDate: "2026-06-02" }],
    ]);
    const suggestions = buildAssignSuggestions({ employees, history, selectedIds: [] });
    expect(suggestions.find((s) => s.employee.id === "emp-2")?.star).toBe("last");
    expect(suggestions.find((s) => s.employee.id === "emp-1")?.star).toBe("frequent");
  });

  it("treats a single prior visit as 'previous'", () => {
    const history = new Map<string, EmployeeCustomerHistory>([
      ["emp-3", { count: 1, lastVisitDate: "2026-01-10" }],
      ["emp-1", { count: 9, lastVisitDate: "2026-06-05" }],
    ]);
    const suggestions = buildAssignSuggestions({ employees, history, selectedIds: [] });
    expect(suggestions.find((s) => s.employee.id === "emp-3")?.star).toBe("previous");
  });

  it("sorts assigned first, then history (most visits), then others alphabetically", () => {
    const history = new Map<string, EmployeeCustomerHistory>([
      ["emp-2", { count: 3, lastVisitDate: "2026-05-28" }],
    ]);
    // emp-3 (Lars) is currently assigned but has no history; should still lead.
    const suggestions = buildAssignSuggestions({ employees, history, selectedIds: ["emp-3"] });
    expect(suggestions.map((s) => s.employee.id)).toEqual(["emp-3", "emp-2", "emp-1"]);
  });

  it("does not change the selection — only reflects it via isAssigned", () => {
    const suggestions = buildAssignSuggestions({
      employees,
      history: new Map(),
      selectedIds: ["emp-2"],
    });
    expect(suggestions.filter((s) => s.isAssigned).map((s) => s.employee.id)).toEqual(["emp-2"]);
  });
});

describe("applyAssignToggle", () => {
  it("removing an employee converts the position into one open slot", () => {
    const res = applyAssignToggle({ selectedIds: ["emp-1", "emp-2"], openSlots: 0, employeeId: "emp-2" });
    expect(res.selectedIds).toEqual(["emp-1"]);
    expect(res.openSlots).toBe(1);
  });

  it("adding an employee fills an existing open slot", () => {
    const res = applyAssignToggle({ selectedIds: ["emp-1"], openSlots: 1, employeeId: "emp-2" });
    expect(res.selectedIds).toEqual(["emp-1", "emp-2"]);
    expect(res.openSlots).toBe(0);
  });

  it("adding an employee with no open slots adds genuinely extra staff", () => {
    const res = applyAssignToggle({ selectedIds: ["emp-1"], openSlots: 0, employeeId: "emp-2" });
    expect(res.selectedIds).toEqual(["emp-1", "emp-2"]);
    expect(res.openSlots).toBe(0);
  });
});

describe("computePreservedLabourMinutes", () => {
  it("scales the visit window by the planned headcount when no override exists", () => {
    // 2 employees on a 2h visit = 4h total labour.
    expect(
      computePreservedLabourMinutes({ visitMinutes: 120, assignedCount: 2, openSlots: 0 }),
    ).toBe(240);
  });

  it("prefers an existing pinned override over headcount scaling", () => {
    expect(
      computePreservedLabourMinutes({
        visitMinutes: 120,
        assignedCount: 1,
        openSlots: 0,
        totalLabourMinutesOverride: 240,
      }),
    ).toBe(240);
  });

  it("returns null when the visit window is unknown and nothing is pinned", () => {
    expect(
      computePreservedLabourMinutes({ visitMinutes: null, assignedCount: 2, openSlots: 0 }),
    ).toBeNull();
  });
});

describe("resolveEmployeeRemoval", () => {
  it("keeps the requirement: removed position becomes one open slot", () => {
    const res = resolveEmployeeRemoval({
      assignedIdsBefore: ["emp-1", "emp-2"],
      openSlotsBefore: 0,
      removedEmployeeId: "emp-2",
      intent: "keep_open_slot",
      visitMinutes: 120,
    });
    expect(res.blocked).toBe(false);
    expect(res.assignedEmployeeIds).toEqual(["emp-1"]);
    expect(res.openSlots).toBe(1);
    // Required staff unchanged → no override needed (scales with headcount).
    expect(res.totalLabourMinutesOverride).toBeNull();
  });

  it("redistributes: 2 employees × 2h → 1 employee carries 4h planned labour", () => {
    const res = resolveEmployeeRemoval({
      assignedIdsBefore: ["emp-1", "emp-2"],
      openSlotsBefore: 0,
      removedEmployeeId: "emp-2",
      intent: "redistribute",
      visitMinutes: 120,
    });
    expect(res.blocked).toBe(false);
    expect(res.assignedEmployeeIds).toEqual(["emp-1"]);
    expect(res.openSlots).toBe(0);
    expect(res.totalLabourMinutesOverride).toBe(240);
    expect(res.perEmployeeMinutes).toBe(240);
  });

  it("redistributes: 3 employees × 2h → 2 employees carry 3h each", () => {
    const res = resolveEmployeeRemoval({
      assignedIdsBefore: ["emp-1", "emp-2", "emp-3"],
      openSlotsBefore: 0,
      removedEmployeeId: "emp-3",
      intent: "redistribute",
      visitMinutes: 120,
    });
    expect(res.assignedEmployeeIds).toEqual(["emp-1", "emp-2"]);
    expect(res.openSlots).toBe(0);
    expect(res.totalLabourMinutesOverride).toBe(360);
    expect(res.perEmployeeMinutes).toBe(180);
  });

  it("blocks redistribution when no employees would remain", () => {
    const res = resolveEmployeeRemoval({
      assignedIdsBefore: ["emp-1"],
      openSlotsBefore: 0,
      removedEmployeeId: "emp-1",
      intent: "redistribute",
      visitMinutes: 120,
    });
    expect(res.blocked).toBe(true);
    // Staffing is left untouched when blocked.
    expect(res.assignedEmployeeIds).toEqual(["emp-1"]);
  });

  it("reduce_requirement: drops the requirement, adds no open slot, clears the override", () => {
    // Ingrid + Kari on a 3h visit (an extra person was added). Removing Kari
    // because fewer people are needed must return labour to a single-person job.
    const res = resolveEmployeeRemoval({
      assignedIdsBefore: ["ingrid", "kari"],
      openSlotsBefore: 0,
      removedEmployeeId: "kari",
      intent: "reduce_requirement",
      visitMinutes: 180,
    });
    expect(res.blocked).toBe(false);
    expect(res.assignedEmployeeIds).toEqual(["ingrid"]);
    expect(res.openSlots).toBe(0);
    // Override cleared so labour scales naturally back to 3h for one person.
    expect(res.totalLabourMinutesOverride).toBeNull();
    expect(res.perEmployeeMinutes).toBe(180);
  });

  it("reduce_requirement: clears even a previously pinned override", () => {
    const res = resolveEmployeeRemoval({
      assignedIdsBefore: ["ingrid", "kari"],
      openSlotsBefore: 0,
      removedEmployeeId: "kari",
      intent: "reduce_requirement",
      visitMinutes: 180,
      totalLabourMinutesOverride: 360,
    });
    expect(res.totalLabourMinutesOverride).toBeNull();
  });

  it("redistribute: keeps a previously pinned override (stays redistributed)", () => {
    // An already-redistributed booking should remain redistributed.
    const res = resolveEmployeeRemoval({
      assignedIdsBefore: ["emp-1", "emp-2", "emp-3"],
      openSlotsBefore: 0,
      removedEmployeeId: "emp-3",
      intent: "redistribute",
      visitMinutes: 120,
      totalLabourMinutesOverride: 360,
    });
    expect(res.totalLabourMinutesOverride).toBe(360);
  });
});

describe("undoEmployeeAddition", () => {
  it("removes the employee without inventing an open slot", () => {
    // Add-then-remove: Kari was added as extra staff (no slot consumed), so
    // undoing the add must not leave an open slot behind.
    const res = undoEmployeeAddition({
      selectedIds: ["ingrid", "kari"],
      openSlots: 0,
      employeeId: "kari",
    });
    expect(res.selectedIds).toEqual(["ingrid"]);
    expect(res.openSlots).toBe(0);
  });

  it("preserves existing open slots and clamps at zero", () => {
    const res = undoEmployeeAddition({
      selectedIds: ["ingrid", "kari"],
      openSlots: 2,
      employeeId: "kari",
    });
    expect(res.selectedIds).toEqual(["ingrid"]);
    expect(res.openSlots).toBe(2);
  });
});

describe("shouldPromptAdditionIntent", () => {
  it("prompts for an extra add to an already-staffed booking (no open slot)", () => {
    expect(shouldPromptAdditionIntent({ assignedCountBefore: 1, openSlotsBefore: 0 })).toBe(true);
  });

  it("does not prompt when filling an open slot (required labour is unchanged)", () => {
    expect(shouldPromptAdditionIntent({ assignedCountBefore: 1, openSlotsBefore: 1 })).toBe(false);
  });

  it("does not prompt for the first assignment (no one staffed yet)", () => {
    expect(shouldPromptAdditionIntent({ assignedCountBefore: 0, openSlotsBefore: 0 })).toBe(false);
  });
});

describe("shouldPromptRemovalIntent", () => {
  it("does not prompt when removing the sole assigned employee (becomes an open slot)", () => {
    // Removing the only assigned employee (e.g. the original Ingrid) has just one
    // sensible outcome — the booking turns into an open staffing need — so the
    // dispatcher is never trapped behind an intent prompt and can always remove.
    expect(shouldPromptRemovalIntent({ assignedCountBefore: 1 })).toBe(false);
  });

  it("prompts when another assigned employee remains (keep slot / reduce / redistribute)", () => {
    expect(shouldPromptRemovalIntent({ assignedCountBefore: 2 })).toBe(true);
  });

  it("does not prompt when nobody is assigned", () => {
    expect(shouldPromptRemovalIntent({ assignedCountBefore: 0 })).toBe(false);
  });
});

describe("resolveEmployeeAddition", () => {
  it("split: 1 × 3h becomes 2 employees sharing 3h total (1.5h each)", () => {
    const res = resolveEmployeeAddition({
      assignedCountAfter: 2,
      assignedCountBefore: 1,
      openSlotsBefore: 0,
      visitMinutes: 180,
      intent: "split",
    });
    // Total job time preserved at 3h; per-employee halves to 1.5h.
    expect(res.totalLabourMinutesOverride).toBe(180);
    expect(res.perEmployeeMinutes).toBe(90);
  });

  it("increase: 1 × 3h becomes 2 employees × 3h = 6h total, override cleared", () => {
    const res = resolveEmployeeAddition({
      assignedCountAfter: 2,
      assignedCountBefore: 1,
      openSlotsBefore: 0,
      visitMinutes: 180,
      intent: "increase",
    });
    // No pin — labour scales with headcount, each keeps the full visit window.
    expect(res.totalLabourMinutesOverride).toBeNull();
    expect(res.perEmployeeMinutes).toBe(180);
  });

  it("split: preserves an existing pinned override rather than re-scaling", () => {
    const res = resolveEmployeeAddition({
      assignedCountAfter: 3,
      assignedCountBefore: 2,
      openSlotsBefore: 0,
      visitMinutes: 120,
      totalLabourMinutesOverride: 360,
      intent: "split",
    });
    expect(res.totalLabourMinutesOverride).toBe(360);
    expect(res.perEmployeeMinutes).toBe(120);
  });

  it("add with split, then remove (undo) returns to the original single-person labour", () => {
    // Split-add Kari to Ingrid's 3h booking.
    const added = resolveEmployeeAddition({
      assignedCountAfter: 2,
      assignedCountBefore: 1,
      openSlotsBefore: 0,
      visitMinutes: 180,
      intent: "split",
    });
    expect(added.totalLabourMinutesOverride).toBe(180);
    // Removing a split-added employee is a plain undo: drop them, no open slot.
    const undone = undoEmployeeAddition({
      selectedIds: ["ingrid", "kari"],
      openSlots: 0,
      employeeId: "kari",
    });
    expect(undone.selectedIds).toEqual(["ingrid"]);
    expect(undone.openSlots).toBe(0);
    // The dialog then resets the override to the row's saved value (here none),
    // so labour scales back to a single-person 3h job.
    expect(
      computePreservedLabourMinutes({ visitMinutes: 180, assignedCount: 1, openSlots: 0 }),
    ).toBe(180);
  });

  it("supports adding multiple employees in one session: split a 2-person crew up to 3", () => {
    // Start: Kari assigned (3h). Add Lars → split → 3h shared by 2 (1.5h each).
    const addLars = resolveEmployeeAddition({
      assignedCountAfter: 2,
      assignedCountBefore: 1,
      openSlotsBefore: 0,
      visitMinutes: 180,
      intent: "split",
    });
    expect(addLars.totalLabourMinutesOverride).toBe(180);
    expect(addLars.perEmployeeMinutes).toBe(90);
    // Add Ingrid as a THIRD employee, carrying the pinned total from the first
    // split. Total job time stays 3h; per-employee drops to 1h across 3.
    const addIngrid = resolveEmployeeAddition({
      assignedCountAfter: 3,
      assignedCountBefore: 2,
      openSlotsBefore: 0,
      visitMinutes: 180,
      totalLabourMinutesOverride: addLars.totalLabourMinutesOverride,
      intent: "split",
    });
    expect(addIngrid.totalLabourMinutesOverride).toBe(180);
    expect(addIngrid.perEmployeeMinutes).toBe(60);
  });

  it("add with increase, then remove prompts intentful removal (reduce clears labour)", () => {
    // Increase-add Kari → 6h total. Removing her with 'reduce' returns to 3h.
    const removed = resolveEmployeeRemoval({
      assignedIdsBefore: ["ingrid", "kari"],
      openSlotsBefore: 0,
      removedEmployeeId: "kari",
      intent: "reduce_requirement",
      visitMinutes: 180,
    });
    expect(removed.assignedEmployeeIds).toEqual(["ingrid"]);
    expect(removed.totalLabourMinutesOverride).toBeNull();
    expect(removed.perEmployeeMinutes).toBe(180);
  });
});

describe("resolveOpenSlotRemoval", () => {
  it("reduce_requirement: drops one open slot, clears labour, keeps the window", () => {
    const res = resolveOpenSlotRemoval({
      assignedCount: 1,
      openSlotsBefore: 1,
      visitMinutes: 60,
      plannedStartTime: "08:00",
      intent: "reduce_requirement",
    });
    expect(res.blocked).toBe(false);
    expect(res.openSlots).toBe(0);
    expect(res.totalLabourMinutesOverride).toBeNull();
    // Window is untouched — labour scales down with the smaller crew.
    expect(res.plannedEndTime).toBeNull();
    expect(res.visitMinutes).toBe(60);
  });

  it("absorb: 08:00–09:00 (1 assigned + 1 open) extends to 08:00–10:00, labour preserved", () => {
    const res = resolveOpenSlotRemoval({
      assignedCount: 1,
      openSlotsBefore: 1,
      visitMinutes: 60,
      plannedStartTime: "08:00",
      intent: "absorb",
    });
    expect(res.blocked).toBe(false);
    expect(res.openSlots).toBe(0);
    // No pin needed — the extended window naturally carries the 2h total.
    expect(res.totalLabourMinutesOverride).toBeNull();
    expect(res.plannedEndTime).toBe("10:00");
    expect(res.visitMinutes).toBe(120);
  });

  it("absorb: spreads across remaining headcount (1 assigned + 2 slots, remove 1)", () => {
    // Before: 1 assigned + 2 slots on a 1h visit = 3h total labour.
    // Remove one slot, absorb: new headcount 2, window = 3h / 2 = 90m.
    const res = resolveOpenSlotRemoval({
      assignedCount: 1,
      openSlotsBefore: 2,
      visitMinutes: 60,
      plannedStartTime: "08:00",
      intent: "absorb",
    });
    expect(res.openSlots).toBe(1);
    expect(res.plannedEndTime).toBe("09:30");
    expect(res.visitMinutes).toBe(90);
  });

  it("absorb: preserves an existing pinned override as the labour to carry", () => {
    // Pinned 4h total on a 1h window with 1 assigned + 1 slot. Absorb the slot:
    // remaining 1 employee carries 4h → 08:00–12:00.
    const res = resolveOpenSlotRemoval({
      assignedCount: 1,
      openSlotsBefore: 1,
      visitMinutes: 60,
      plannedStartTime: "08:00",
      totalLabourMinutesOverride: 240,
      intent: "absorb",
    });
    expect(res.plannedEndTime).toBe("12:00");
    expect(res.visitMinutes).toBe(240);
  });

  it("absorb: blocked when there is no assigned crew to absorb the work", () => {
    const res = resolveOpenSlotRemoval({
      assignedCount: 0,
      openSlotsBefore: 2,
      visitMinutes: 60,
      plannedStartTime: "08:00",
      intent: "absorb",
    });
    expect(res.blocked).toBe(true);
    expect(res.plannedEndTime).toBeNull();
  });

  it("absorb: blocked when the visit window is unknown", () => {
    const res = resolveOpenSlotRemoval({
      assignedCount: 1,
      openSlotsBefore: 1,
      visitMinutes: null,
      plannedStartTime: "08:00",
      intent: "absorb",
    });
    expect(res.blocked).toBe(true);
  });

  it("absorb: blocked when the extended window would cross midnight", () => {
    const res = resolveOpenSlotRemoval({
      assignedCount: 1,
      openSlotsBefore: 1,
      visitMinutes: 120,
      plannedStartTime: "23:00",
      intent: "absorb",
    });
    expect(res.blocked).toBe(true);
  });
});

describe("open-slot removal branching (dialog regression)", () => {
  describe("shouldPromptOpenSlotRemoval", () => {
    it("requires the prompt when assigned crew remains and a slot is removed", () => {
      // 1 assigned + 1 open slot: the slot's work could be shed or absorbed, so
      // the dispatcher MUST choose — never silently dropped.
      expect(shouldPromptOpenSlotRemoval({ assignedCount: 1, openSlots: 1 })).toBe(true);
      expect(shouldPromptOpenSlotRemoval({ assignedCount: 3, openSlots: 2 })).toBe(true);
    });

    it("decrements directly (no prompt) when there is no assigned crew to absorb", () => {
      // 0 assigned + 1 slot: nobody could absorb the work, so reducing is the only
      // outcome and the slot is simply decremented.
      expect(shouldPromptOpenSlotRemoval({ assignedCount: 0, openSlots: 1 })).toBe(false);
      expect(shouldPromptOpenSlotRemoval({ assignedCount: 0, openSlots: 3 })).toBe(false);
    });

    it("never prompts when there is no open slot to remove", () => {
      expect(shouldPromptOpenSlotRemoval({ assignedCount: 2, openSlots: 0 })).toBe(false);
    });
  });

  it("Reduce intent drops the slot and labour while keeping the window", () => {
    // Branch chosen after the prompt: 08:00–09:00, 1 assigned + 1 open slot.
    expect(shouldPromptOpenSlotRemoval({ assignedCount: 1, openSlots: 1 })).toBe(true);
    const res = resolveOpenSlotRemoval({
      assignedCount: 1,
      openSlotsBefore: 1,
      visitMinutes: 60,
      plannedStartTime: "08:00",
      intent: "reduce_requirement",
    });
    expect(res.blocked).toBe(false);
    expect(res.openSlots).toBe(0);
    // Window untouched — labour scales down with the smaller crew.
    expect(res.plannedEndTime).toBeNull();
    expect(res.visitMinutes).toBe(60);
    expect(res.totalLabourMinutesOverride).toBeNull();
  });

  it("Absorb intent preserves total labour by extending the window", () => {
    // Branch chosen after the prompt: 08:00–09:00, 1 assigned + 1 open slot (2h
    // total) → remaining employee carries 2h → 08:00–10:00.
    const res = resolveOpenSlotRemoval({
      assignedCount: 1,
      openSlotsBefore: 1,
      visitMinutes: 60,
      plannedStartTime: "08:00",
      intent: "absorb",
    });
    expect(res.blocked).toBe(false);
    expect(res.openSlots).toBe(0);
    expect(res.plannedEndTime).toBe("10:00");
    // Extended window (120m) × 1 employee preserves the 2h total job time.
    expect(res.visitMinutes).toBe(120);
  });
});

describe("resolveStaffingSaveGate (save gating)", () => {
  it("blocks the save while an open-slot removal is unresolved", () => {
    const gate = resolveStaffingSaveGate({ pendingRemoval: false, pendingSlotRemoval: true });
    expect(gate.blocked).toBe(true);
    expect(gate.reason).toBe("Choose what should happen with the open slot's work before saving.");
  });

  it("allows the save once the open-slot removal is resolved", () => {
    const gate = resolveStaffingSaveGate({ pendingRemoval: false, pendingSlotRemoval: false });
    expect(gate.blocked).toBe(false);
    expect(gate.reason).toBeNull();
  });

  it("blocks (assigned-removal first) and reports its reason when both are pending", () => {
    const gate = resolveStaffingSaveGate({ pendingRemoval: true, pendingSlotRemoval: true });
    expect(gate.blocked).toBe(true);
    expect(gate.reason).toBe("Choose what should happen with the workload before saving.");
  });
});

describe("validateStaffingChange", () => {
  it("treats 2 employees + 0 open slots as a valid, unchanged save", () => {
    const res = validateStaffingChange({
      previousAssignedCount: 2,
      previousOpenSlots: 0,
      nextAssignedCount: 2,
      nextOpenSlots: 0,
    });
    expect(res.blocked).toBe(false);
    expect(res.warnings).toEqual([]);
  });

  it("blocks 0 employees + 0 open slots and forces one open slot", () => {
    const res = validateStaffingChange({
      previousAssignedCount: 1,
      previousOpenSlots: 0,
      nextAssignedCount: 0,
      nextOpenSlots: 0,
    });
    expect(res.blocked).toBe(true);
    expect(res.correctedOpenSlots).toBe(1);
  });

  it("warns when total required staffing is reduced", () => {
    const res = validateStaffingChange({
      previousAssignedCount: 2,
      previousOpenSlots: 0,
      nextAssignedCount: 1,
      nextOpenSlots: 0,
    });
    expect(res.warnings).toContain("reducing");
  });

  it("warns when total required staffing is increased", () => {
    const res = validateStaffingChange({
      previousAssignedCount: 1,
      previousOpenSlots: 0,
      nextAssignedCount: 1,
      nextOpenSlots: 1,
    });
    expect(res.warnings).toContain("increasing");
  });

  it("warns 'exceeds' when assigned employees surpass the previously required staff", () => {
    const res = validateStaffingChange({
      previousAssignedCount: 1,
      previousOpenSlots: 0,
      nextAssignedCount: 3,
      nextOpenSlots: 0,
    });
    expect(res.warnings).toContain("exceeds");
    expect(res.nextRequiredStaff).toBe(3);
  });

  it("does NOT warn 'increasing'/'exceeds' for a split add (intent resolved, no new open slots)", () => {
    // 1 assigned + 0 slots → add a second employee, choose "Split existing work".
    const res = validateStaffingChange({
      previousAssignedCount: 1,
      previousOpenSlots: 0,
      nextAssignedCount: 2,
      nextOpenSlots: 0,
      additionIntentResolved: true,
    });
    expect(res.blocked).toBe(false);
    expect(res.warnings).toEqual([]);
  });

  it("does NOT warn for an increase-intent add either (intent already chosen)", () => {
    const res = validateStaffingChange({
      previousAssignedCount: 1,
      previousOpenSlots: 0,
      nextAssignedCount: 3,
      nextOpenSlots: 0,
      additionIntentResolved: true,
    });
    expect(res.warnings).toEqual([]);
  });

  it("still warns 'increasing' when an intent add ALSO raises open slots (real open need)", () => {
    const res = validateStaffingChange({
      previousAssignedCount: 1,
      previousOpenSlots: 0,
      nextAssignedCount: 2,
      nextOpenSlots: 1,
      additionIntentResolved: true,
    });
    expect(res.warnings).toContain("increasing");
  });

  it("still warns 'reducing' even when an addition intent was resolved", () => {
    const res = validateStaffingChange({
      previousAssignedCount: 3,
      previousOpenSlots: 0,
      nextAssignedCount: 1,
      nextOpenSlots: 0,
      additionIntentResolved: true,
    });
    expect(res.warnings).toContain("reducing");
  });

  it("keeps required staffing stable when an employee is swapped for an open slot", () => {
    // 2 assigned → remove one (toggle adds an open slot) → 1 assigned + 1 open.
    const res = validateStaffingChange({
      previousAssignedCount: 2,
      previousOpenSlots: 0,
      nextAssignedCount: 1,
      nextOpenSlots: 1,
    });
    expect(res.blocked).toBe(false);
    expect(res.warnings).toEqual([]);
    expect(res.nextRequiredStaff).toBe(2);
  });
});

describe("resolveCreateStaffing (add service row)", () => {
  it("defaults to 1 open slot when no employee and no open slot is set", () => {
    const res = resolveCreateStaffing({ assignedEmployeeIds: [], openSlots: 0 });
    expect(res.corrected).toBe(true);
    expect(res.openSlots).toBe(1);
    expect(res.requiredStaff).toBe(1);
  });

  it("creates the correct required staff count from assigned employees", () => {
    const res = resolveCreateStaffing({
      assignedEmployeeIds: ["emp-1", "emp-2"],
      openSlots: 0,
    });
    expect(res.corrected).toBe(false);
    expect(res.openSlots).toBe(0);
    expect(res.requiredStaff).toBe(2);
  });

  it("never yields 0 employees + 0 open slots (cannot require nobody)", () => {
    const res = resolveCreateStaffing({ assignedEmployeeIds: [], openSlots: 0 });
    expect(res.assignedEmployeeIds.length + res.openSlots).toBeGreaterThanOrEqual(1);
  });

  it("keeps explicit open slots without correcting", () => {
    const res = resolveCreateStaffing({ assignedEmployeeIds: [], openSlots: 2 });
    expect(res.corrected).toBe(false);
    expect(res.openSlots).toBe(2);
    expect(res.requiredStaff).toBe(2);
  });
});

describe("compareVariationStaffing (variation editor)", () => {
  it("reports no difference when staffing matches the base row", () => {
    const res = compareVariationStaffing({
      baseAssignedIds: ["emp-1", "emp-2"],
      baseOpenSlots: 0,
    });
    expect(res.differs).toBe(false);
    expect(res.reduces).toBe(false);
    expect(res.baseRequiredStaff).toBe(2);
    expect(res.variationRequiredStaff).toBe(2);
  });

  it("flags a reduction when the variation lowers required staffing", () => {
    const res = compareVariationStaffing({
      baseAssignedIds: ["emp-1", "emp-2"],
      baseOpenSlots: 0,
      variationAssignedIds: ["emp-1"],
    });
    expect(res.differs).toBe(true);
    expect(res.reduces).toBe(true);
    expect(res.variationRequiredStaff).toBe(1);
  });

  it("flags an increase when an open-slot delta adds staffing", () => {
    const res = compareVariationStaffing({
      baseAssignedIds: ["emp-1"],
      baseOpenSlots: 0,
      unassignedSlotsDelta: 1,
    });
    expect(res.increases).toBe(true);
    expect(res.variationOpenSlots).toBe(1);
    expect(res.variationRequiredStaff).toBe(2);
  });

  it("clamps the open-slot delta so it never drops below zero", () => {
    const res = compareVariationStaffing({
      baseAssignedIds: ["emp-1"],
      baseOpenSlots: 1,
      unassignedSlotsDelta: -5,
    });
    expect(res.variationOpenSlots).toBe(0);
    expect(res.variationRequiredStaff).toBe(1);
    expect(res.reduces).toBe(true);
  });
});
