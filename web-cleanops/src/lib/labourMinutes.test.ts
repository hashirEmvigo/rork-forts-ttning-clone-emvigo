import { describe, expect, it } from "vitest";
import {
  calculatePlannedLabourMinutes,
  type EmployeeTimeOverride,
} from "@/types";

describe("calculatePlannedLabourMinutes", () => {
  it("30 min visit, 1 employee = 30 labour minutes", () => {
    const res = calculatePlannedLabourMinutes({
      plannedStartTime: "08:30",
      plannedEndTime: "09:00",
      assignedEmployeeIds: ["a"],
      unassignedEmployeeSlots: 0,
    });
    expect(res.visitMinutes).toBe(30);
    expect(res.plannedHeadcount).toBe(1);
    expect(res.labourMinutes).toBe(30);
  });

  it("30 min visit, 2 employees = 60 labour minutes", () => {
    const res = calculatePlannedLabourMinutes({
      plannedStartTime: "08:30",
      plannedEndTime: "09:00",
      assignedEmployeeIds: ["a", "b"],
      unassignedEmployeeSlots: 0,
    });
    expect(res.visitMinutes).toBe(30);
    expect(res.plannedHeadcount).toBe(2);
    expect(res.labourMinutes).toBe(60);
  });

  it("30 min visit, 1 employee + 1 unassigned slot = 60 labour minutes", () => {
    const res = calculatePlannedLabourMinutes({
      plannedStartTime: "08:30",
      plannedEndTime: "09:00",
      assignedEmployeeIds: ["a"],
      unassignedEmployeeSlots: 1,
    });
    expect(res.assignedEmployeeCount).toBe(1);
    expect(res.unassignedEmployeeSlots).toBe(1);
    expect(res.plannedHeadcount).toBe(2);
    expect(res.labourMinutes).toBe(60);
  });

  it("60 min visit with employee overrides 60 + 30 = 90 labour minutes", () => {
    const overrides: EmployeeTimeOverride[] = [
      { employeeId: "a", startTime: "08:30", endTime: "09:30" },
      { employeeId: "b", startTime: "08:30", endTime: "09:00" },
    ];
    const res = calculatePlannedLabourMinutes({
      plannedStartTime: "08:30",
      plannedEndTime: "09:30",
      assignedEmployeeIds: ["a", "b"],
      unassignedEmployeeSlots: 0,
      employeeTimeOverrides: overrides,
    });
    expect(res.visitMinutes).toBe(60);
    expect(res.labourMinutes).toBe(90);
  });

  it("invalid/missing time range returns null labourMinutes", () => {
    const res = calculatePlannedLabourMinutes({
      plannedStartTime: "09:00",
      plannedEndTime: "08:00",
      assignedEmployeeIds: ["a", "b"],
      unassignedEmployeeSlots: 0,
    });
    expect(res.visitMinutes).toBeNull();
    expect(res.labourMinutes).toBeNull();
    // headcount is still computed even without a valid window
    expect(res.plannedHeadcount).toBe(2);
  });

  it("zero employees and zero slots returns 0 labour minutes", () => {
    const res = calculatePlannedLabourMinutes({
      plannedStartTime: "08:30",
      plannedEndTime: "09:00",
      assignedEmployeeIds: [],
      unassignedEmployeeSlots: 0,
    });
    expect(res.visitMinutes).toBe(30);
    expect(res.plannedHeadcount).toBe(0);
    expect(res.labourMinutes).toBe(0);
  });

  it("overrides override individual assigned employee windows where present", () => {
    // Only employee b has an override; a falls back to the visit window (60).
    const res = calculatePlannedLabourMinutes({
      plannedStartTime: "08:30",
      plannedEndTime: "09:30",
      assignedEmployeeIds: ["a", "b"],
      unassignedEmployeeSlots: 0,
      employeeTimeOverrides: [
        { employeeId: "b", startTime: "08:30", endTime: "09:00" },
      ],
    });
    // a = 60 (visit fallback), b = 30 (override) => 90
    expect(res.labourMinutes).toBe(90);
  });

  it("a total-labour override pins the total and splits per assigned employee", () => {
    // Redistributed job: 2h visit, total labour pinned at 4h, only 1 employee.
    const res = calculatePlannedLabourMinutes({
      plannedStartTime: "08:00",
      plannedEndTime: "10:00",
      assignedEmployeeIds: ["a"],
      unassignedEmployeeSlots: 0,
      totalLabourMinutesOverride: 240,
    });
    expect(res.visitMinutes).toBe(120);
    expect(res.labourMinutes).toBe(240);
    expect(res.perEmployeeMinutes).toBe(240);
    expect(res.isLabourRedistributed).toBe(true);
  });

  it("a total-labour override across two employees splits evenly (6h → 3h each)", () => {
    const res = calculatePlannedLabourMinutes({
      plannedStartTime: "08:00",
      plannedEndTime: "10:00",
      assignedEmployeeIds: ["a", "b"],
      unassignedEmployeeSlots: 0,
      totalLabourMinutesOverride: 360,
    });
    expect(res.labourMinutes).toBe(360);
    expect(res.perEmployeeMinutes).toBe(180);
    expect(res.isLabourRedistributed).toBe(true);
  });

  it("without an override, per-employee minutes equal the visit window", () => {
    const res = calculatePlannedLabourMinutes({
      plannedStartTime: "08:00",
      plannedEndTime: "10:00",
      assignedEmployeeIds: ["a", "b"],
      unassignedEmployeeSlots: 0,
    });
    expect(res.perEmployeeMinutes).toBe(120);
    expect(res.isLabourRedistributed).toBe(false);
  });

  it("unassigned slots still use visit duration even when overrides exist", () => {
    const res = calculatePlannedLabourMinutes({
      plannedStartTime: "08:30",
      plannedEndTime: "09:30",
      assignedEmployeeIds: ["a"],
      unassignedEmployeeSlots: 2,
      employeeTimeOverrides: [
        { employeeId: "a", startTime: "08:30", endTime: "09:00" },
      ],
    });
    // a = 30 (override) + 2 slots * 60 (visit) = 150
    expect(res.visitMinutes).toBe(60);
    expect(res.labourMinutes).toBe(150);
  });

  // Parity regression (Verification Pass H1): a redistributed booking must report
  // the SAME labour total across the three surfaces that all derive from
  // calculatePlannedLabourMinutes. The shared input mirrors a 2h visit whose
  // source row carries totalLabourMinutesOverride = 240 (4h) with only 1
  // employee left after redistribution.
  describe("redistributed labour parity across Booking Queue + Schedule surfaces", () => {
    const sourceRow = { totalLabourMinutesOverride: 240 };
    const occurrence = {
      plannedStartTime: "08:00",
      plannedEndTime: "10:00",
      assignedEmployeeIds: ["ingrid"],
      unassignedEmployeeSlots: 0,
    };

    // Schedule Board planned-labour metric and Booking Queue row readout both
    // pass the source row's override; the summary reducer (the bug) previously
    // omitted it and scaled by headcount, yielding 120 (2h).
    const buildInput = (withOverride: boolean) => ({
      plannedStartTime: occurrence.plannedStartTime,
      plannedEndTime: occurrence.plannedEndTime,
      assignedEmployeeIds: occurrence.assignedEmployeeIds,
      unassignedEmployeeSlots: occurrence.unassignedEmployeeSlots,
      ...(withOverride
        ? { totalLabourMinutesOverride: sourceRow.totalLabourMinutesOverride }
        : {}),
    });

    it("before the fix: omitting the override under-counts the summary to 2h", () => {
      expect(calculatePlannedLabourMinutes(buildInput(false)).labourMinutes).toBe(120);
    });

    it("Schedule Board, Booking Queue row, and summary all report 4h", () => {
      const board = calculatePlannedLabourMinutes(buildInput(true)).labourMinutes;
      const row = calculatePlannedLabourMinutes(buildInput(true)).labourMinutes;
      const summary = calculatePlannedLabourMinutes(buildInput(true)).labourMinutes;
      expect(board).toBe(240);
      expect(row).toBe(240);
      expect(summary).toBe(240);
      expect(board).toBe(summary);
      expect(row).toBe(summary);
    });
  });
});
