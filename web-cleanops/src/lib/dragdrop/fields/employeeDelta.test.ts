import { describe, expect, it } from "vitest";
import { buildDropStaffingWrite, evaluateDrop } from "./employeeDelta";

describe("evaluateDrop", () => {
  it("reassigns a single-assignee card to a different employee on the same date", () => {
    const res = evaluateDrop({
      drag: {
        sourceEmployeeId: "ingrid",
        sourceDate: "2026-05-31",
        assignedEmployeeIds: ["ingrid"],
        openSlotCount: 0,
      },
      targetEmployeeId: "kari",
      targetDate: "2026-05-31",
    });
    expect(res).toBe("reassign");
  });

  it("blocks reassignment for multi-assignee cards", () => {
    const res = evaluateDrop({
      drag: {
        sourceEmployeeId: "ingrid",
        sourceDate: "2026-05-31",
        assignedEmployeeIds: ["ingrid", "kari"],
        openSlotCount: 0,
      },
      targetEmployeeId: "olof",
      targetDate: "2026-05-31",
    });
    expect(res).toBe("blocked_multi");
  });

  it("rejects dropping onto a different date (no rescheduling in Phase 1)", () => {
    const res = evaluateDrop({
      drag: {
        sourceEmployeeId: "ingrid",
        sourceDate: "2026-05-31",
        assignedEmployeeIds: ["ingrid"],
        openSlotCount: 0,
      },
      targetEmployeeId: "kari",
      targetDate: "2026-06-01",
    });
    expect(res).toBe("invalid");
  });

  it("rejects dropping back onto the same employee (no change)", () => {
    const res = evaluateDrop({
      drag: {
        sourceEmployeeId: "ingrid",
        sourceDate: "2026-05-31",
        assignedEmployeeIds: ["ingrid"],
        openSlotCount: 0,
      },
      targetEmployeeId: "ingrid",
      targetDate: "2026-05-31",
    });
    expect(res).toBe("invalid");
  });

  it("fills an open slot when dragged from the Unassigned row", () => {
    const res = evaluateDrop({
      drag: {
        sourceEmployeeId: null,
        sourceDate: "2026-05-31",
        assignedEmployeeIds: [],
        openSlotCount: 1,
      },
      targetEmployeeId: "kari",
      targetDate: "2026-05-31",
    });
    expect(res).toBe("fill_slot");
  });

  it("fills a slot on a partially-assigned card without blocking", () => {
    const res = evaluateDrop({
      drag: {
        sourceEmployeeId: null,
        sourceDate: "2026-05-31",
        assignedEmployeeIds: ["ingrid"],
        openSlotCount: 1,
      },
      targetEmployeeId: "kari",
      targetDate: "2026-05-31",
    });
    expect(res).toBe("fill_slot");
  });

  it("rejects a slot-fill when the target is already assigned", () => {
    const res = evaluateDrop({
      drag: {
        sourceEmployeeId: null,
        sourceDate: "2026-05-31",
        assignedEmployeeIds: ["kari"],
        openSlotCount: 1,
      },
      targetEmployeeId: "kari",
      targetDate: "2026-05-31",
    });
    expect(res).toBe("invalid");
  });

  it("rejects a slot-fill when there are no open slots", () => {
    const res = evaluateDrop({
      drag: {
        sourceEmployeeId: null,
        sourceDate: "2026-05-31",
        assignedEmployeeIds: [],
        openSlotCount: 0,
      },
      targetEmployeeId: "kari",
      targetDate: "2026-05-31",
    });
    expect(res).toBe("invalid");
  });
});

describe("buildDropStaffingWrite", () => {
  it("replaces the single assignee and keeps open slots + scaled labour on reassign", () => {
    const res = buildDropStaffingWrite({
      mode: "reassign",
      staffing: {
        assignedEmployeeIds: ["ingrid"],
        openSlotCount: 0,
        labourMinutes: 120,
        isLabourRedistributed: false,
      },
      targetEmployeeId: "kari",
    });
    expect(res.assignedEmployeeIds).toEqual(["kari"]);
    expect(res.unassignedEmployeeSlots).toBe(0);
    // Not redistributed → labour stays headcount-scaled (null).
    expect(res.totalLabourMinutes).toBeNull();
  });

  it("preserves pinned total labour when reassigning a redistributed job", () => {
    const res = buildDropStaffingWrite({
      mode: "reassign",
      staffing: {
        assignedEmployeeIds: ["ingrid"],
        openSlotCount: 0,
        labourMinutes: 120,
        isLabourRedistributed: true,
      },
      targetEmployeeId: "kari",
    });
    expect(res.assignedEmployeeIds).toEqual(["kari"]);
    expect(res.totalLabourMinutes).toBe(120);
  });

  it("keeps open slots unchanged when reassigning a partially-assigned card", () => {
    const res = buildDropStaffingWrite({
      mode: "reassign",
      staffing: {
        assignedEmployeeIds: ["ingrid"],
        openSlotCount: 2,
        labourMinutes: 360,
        isLabourRedistributed: false,
      },
      targetEmployeeId: "kari",
    });
    expect(res.assignedEmployeeIds).toEqual(["kari"]);
    expect(res.unassignedEmployeeSlots).toBe(2);
  });

  it("adds the target and consumes one slot on fill_slot", () => {
    const res = buildDropStaffingWrite({
      mode: "fill_slot",
      staffing: {
        assignedEmployeeIds: ["ingrid"],
        openSlotCount: 1,
        labourMinutes: 240,
        isLabourRedistributed: false,
      },
      targetEmployeeId: "kari",
    });
    expect(res.assignedEmployeeIds).toEqual(["ingrid", "kari"]);
    expect(res.unassignedEmployeeSlots).toBe(0);
  });

  it("fills a slot on a fully-open occurrence", () => {
    const res = buildDropStaffingWrite({
      mode: "fill_slot",
      staffing: {
        assignedEmployeeIds: [],
        openSlotCount: 1,
        labourMinutes: 120,
        isLabourRedistributed: false,
      },
      targetEmployeeId: "kari",
    });
    expect(res.assignedEmployeeIds).toEqual(["kari"]);
    expect(res.unassignedEmployeeSlots).toBe(0);
  });

  it("unassign: removes the single assignee and opens one slot", () => {
    const res = buildDropStaffingWrite({
      mode: "unassign",
      staffing: {
        assignedEmployeeIds: ["ingrid"],
        openSlotCount: 0,
        labourMinutes: 120,
        isLabourRedistributed: false,
      },
      removeEmployeeId: "ingrid",
    });
    expect(res.assignedEmployeeIds).toEqual([]);
    expect(res.unassignedEmployeeSlots).toBe(1);
    expect(res.totalLabourMinutes).toBeNull();
  });

  it("unassign: removes only the source employee from a multi-assignee card", () => {
    const res = buildDropStaffingWrite({
      mode: "unassign",
      staffing: {
        assignedEmployeeIds: ["ingrid", "kari", "lars"],
        openSlotCount: 0,
        labourMinutes: 360,
        isLabourRedistributed: false,
      },
      removeEmployeeId: "kari",
    });
    expect(res.assignedEmployeeIds).toEqual(["ingrid", "lars"]);
    expect(res.unassignedEmployeeSlots).toBe(1);
  });

  it("unassign: adds to existing open slots and preserves pinned labour", () => {
    const res = buildDropStaffingWrite({
      mode: "unassign",
      staffing: {
        assignedEmployeeIds: ["ingrid"],
        openSlotCount: 2,
        labourMinutes: 360,
        isLabourRedistributed: true,
      },
      removeEmployeeId: "ingrid",
    });
    expect(res.assignedEmployeeIds).toEqual([]);
    expect(res.unassignedEmployeeSlots).toBe(3);
    expect(res.totalLabourMinutes).toBe(360);
  });
});
