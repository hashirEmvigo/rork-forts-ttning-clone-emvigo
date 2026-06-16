import { describe, expect, it } from "vitest";
import { evaluateDragAction } from "./evaluateDragAction";
import { resolveDragScope } from "./resolveDragScope";
import { planDragWrite } from "./planDragWrite";
import { applyDragWrite, type DragWriters } from "./applyDragWrite";
import type { DragAction, DragSource, DragWrite } from "./dragTypes";

/** A recurring single-assignee source (Ingrid on 31/5), no open slots. */
function recurringSource(overrides: Partial<DragSource> = {}): DragSource {
  return {
    occurrenceKey: "row_1:2026-05-31",
    parentServiceRowId: "row_1",
    workOrderId: "wo_1",
    isRecurring: true,
    sourceEmployeeId: "ingrid",
    sourceDate: "2026-05-31",
    startTime: "08:00",
    endTime: "10:00",
    assignedEmployeeIds: ["ingrid"],
    openSlotCount: 0,
    labourMinutes: 120,
    isLabourRedistributed: false,
    ...overrides,
  };
}

describe("evaluateDragAction", () => {
  it("produces a reassign employee delta for a single-assignee, same-date move", () => {
    const res = evaluateDragAction(recurringSource(), {
      employeeId: "kari",
      date: "2026-05-31",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.action.deltas.employee).toEqual({
      kind: "reassign",
      from: "ingrid",
      to: "kari",
    });
    // Pure employee drag never carries date/time deltas.
    expect(res.action.deltas.date).toBeUndefined();
    expect(res.action.deltas.time).toBeUndefined();
  });

  it("produces a fill_slot delta when dragged from the Unassigned row", () => {
    const res = evaluateDragAction(
      recurringSource({ sourceEmployeeId: null, assignedEmployeeIds: [], openSlotCount: 1 }),
      { employeeId: "kari", date: "2026-05-31" },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.action.deltas.employee).toEqual({ kind: "fill_slot", to: "kari" });
  });

  it("blocks multi-assignee cards", () => {
    const res = evaluateDragAction(
      recurringSource({ assignedEmployeeIds: ["ingrid", "kari"] }),
      { employeeId: "olof", date: "2026-05-31" },
    );
    expect(res).toEqual({ ok: false, reason: "blocked_multi" });
  });

  it("rejects a combined employee + date move (different employee AND date)", () => {
    const res = evaluateDragAction(recurringSource(), {
      employeeId: "kari",
      date: "2026-06-01",
    });
    expect(res).toEqual({ ok: false, reason: "invalid" });
  });

  it("produces a date delta for a pure date move (same employee, new day)", () => {
    const res = evaluateDragAction(recurringSource(), {
      employeeId: "ingrid",
      date: "2026-06-07",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.action.deltas.date).toEqual({
      from: "2026-05-31",
      to: "2026-06-07",
      startTime: "08:00",
      endTime: "10:00",
    });
    // A pure date move never carries an employee or time delta.
    expect(res.action.deltas.employee).toBeUndefined();
    expect(res.action.deltas.time).toBeUndefined();
  });

  it("allows a date move for a multi-assignee card (staffing untouched)", () => {
    const res = evaluateDragAction(
      recurringSource({ assignedEmployeeIds: ["ingrid", "kari"] }),
      { employeeId: "ingrid", date: "2026-06-07" },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.action.deltas.date?.to).toBe("2026-06-07");
  });

  it("does not wire unassigned-row date moves (no source employee)", () => {
    const res = evaluateDragAction(
      recurringSource({ sourceEmployeeId: null, assignedEmployeeIds: [], openSlotCount: 1 }),
      { employeeId: "kari", date: "2026-06-07" },
    );
    expect(res).toEqual({ ok: false, reason: "invalid" });
  });

  it("produces an in-place time delta when dropped on its own employee + date cell", () => {
    const res = evaluateDragAction(recurringSource(), {
      employeeId: "ingrid",
      date: "2026-05-31",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // Seeded with the current window (startTo === startFrom); the dialog edits it.
    expect(res.action.deltas.time).toEqual({
      startFrom: "08:00",
      startTo: "08:00",
      durationMinutes: 120,
    });
    // A pure time move never carries an employee or date delta.
    expect(res.action.deltas.employee).toBeUndefined();
    expect(res.action.deltas.date).toBeUndefined();
  });

  it("does not produce a time delta when the occurrence has no start time", () => {
    const res = evaluateDragAction(recurringSource({ startTime: null, endTime: null }), {
      employeeId: "ingrid",
      date: "2026-05-31",
    });
    // No window to adjust → the same-cell drop stays inert.
    expect(res).toEqual({ ok: false, reason: "invalid" });
  });

  it("produces an unassign delta when dropped on the Unassigned row (single assignee)", () => {
    const res = evaluateDragAction(recurringSource(), { unassigned: true, date: "2026-05-31" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.action.deltas.employee).toEqual({ kind: "unassign", from: "ingrid" });
    expect(res.action.deltas.date).toBeUndefined();
  });

  it("unassigns only the source employee from a multi-assignee card", () => {
    const res = evaluateDragAction(
      recurringSource({ sourceEmployeeId: "kari", assignedEmployeeIds: ["ingrid", "kari", "lars"] }),
      { unassigned: true, date: "2026-05-31" },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.action.deltas.employee).toEqual({ kind: "unassign", from: "kari" });
  });

  it("ignores dropping an already-open card back onto the Unassigned row", () => {
    const res = evaluateDragAction(
      recurringSource({ sourceEmployeeId: null, assignedEmployeeIds: [], openSlotCount: 1 }),
      { unassigned: true, date: "2026-05-31" },
    );
    expect(res).toEqual({ ok: false, reason: "no_change" });
  });

  it("rejects an unassign drop onto a different date (no reschedule via Unassigned)", () => {
    const res = evaluateDragAction(recurringSource(), { unassigned: true, date: "2026-06-07" });
    expect(res).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("resolveDragScope", () => {
  function action(isRecurring: boolean): DragAction {
    return {
      occurrenceKey: "row_1:2026-05-31",
      parentServiceRowId: "row_1",
      workOrderId: "wo_1",
      isRecurring,
      deltas: { employee: { kind: "reassign", from: "ingrid", to: "kari" } },
    };
  }

  it("routes recurring drags to occurrence scope, locked, no prompt", () => {
    expect(resolveDragScope(action(true))).toEqual({
      scope: "occurrence",
      prompt: false,
      allowedScopes: ["occurrence"],
    });
  });

  it("routes one-time drags to series scope, no prompt", () => {
    expect(resolveDragScope(action(false))).toEqual({
      scope: "series",
      prompt: false,
      allowedScopes: ["series"],
    });
  });

  function dateAction(isRecurring: boolean): DragAction {
    return {
      occurrenceKey: "row_1:2026-05-31",
      parentServiceRowId: "row_1",
      workOrderId: "wo_1",
      isRecurring,
      deltas: {
        date: { from: "2026-05-31", to: "2026-06-07", startTime: "08:00", endTime: "10:00" },
      },
    };
  }

  it("routes a recurring date move to occurrence scope and prompts the scope shell", () => {
    expect(resolveDragScope(dateAction(true))).toEqual({
      scope: "occurrence",
      prompt: true,
      allowedScopes: ["occurrence"],
    });
  });

  it("routes a one-time date move to occurrence scope without prompting", () => {
    expect(resolveDragScope(dateAction(false))).toEqual({
      scope: "occurrence",
      prompt: false,
      allowedScopes: ["occurrence"],
    });
  });

  function timeAction(isRecurring: boolean): DragAction {
    return {
      occurrenceKey: "row_1:2026-05-31",
      parentServiceRowId: "row_1",
      workOrderId: "wo_1",
      isRecurring,
      deltas: { time: { startFrom: "08:00", startTo: "09:00", durationMinutes: 120 } },
    };
  }

  it("routes a recurring time move to occurrence scope and prompts the scope shell", () => {
    expect(resolveDragScope(timeAction(true))).toEqual({
      scope: "occurrence",
      prompt: true,
      allowedScopes: ["occurrence"],
    });
  });

  it("routes a one-time time move to occurrence scope without prompting", () => {
    expect(resolveDragScope(timeAction(false))).toEqual({
      scope: "occurrence",
      prompt: false,
      allowedScopes: ["occurrence"],
    });
  });
});

describe("planDragWrite", () => {
  const baseAction: DragAction = {
    occurrenceKey: "row_1:2026-05-31",
    parentServiceRowId: "row_1",
    workOrderId: "wo_1",
    isRecurring: true,
    deltas: { employee: { kind: "reassign", from: "ingrid", to: "kari" } },
  };

  it("emits staffing (and never schedule) for an employee reassign", () => {
    const write = planDragWrite({
      action: baseAction,
      scope: "occurrence",
      staffing: {
        assignedEmployeeIds: ["ingrid"],
        openSlotCount: 0,
        labourMinutes: 120,
        isLabourRedistributed: false,
      },
    });
    expect(write.staffing).toEqual({
      assignedEmployeeIds: ["kari"],
      unassignedEmployeeSlots: 0,
      totalLabourMinutes: null,
    });
    // Invariant: a pure employee drag must never carry a schedule change.
    expect(write.schedule).toBeUndefined();
    expect(write.scope).toBe("occurrence");
    expect(write.occurrenceKey).toBe("row_1:2026-05-31");
  });

  it("preserves pinned labour on a redistributed reassign", () => {
    const write = planDragWrite({
      action: baseAction,
      scope: "occurrence",
      staffing: {
        assignedEmployeeIds: ["ingrid"],
        openSlotCount: 0,
        labourMinutes: 120,
        isLabourRedistributed: true,
      },
    });
    expect(write.staffing?.totalLabourMinutes).toBe(120);
  });

  it("emits an open-slot staffing write for an unassign (multi-assignee)", () => {
    const write = planDragWrite({
      action: {
        ...baseAction,
        deltas: { employee: { kind: "unassign", from: "kari" } },
      },
      scope: "occurrence",
      staffing: {
        assignedEmployeeIds: ["ingrid", "kari", "lars"],
        openSlotCount: 0,
        labourMinutes: 360,
        isLabourRedistributed: false,
      },
    });
    expect(write.staffing).toEqual({
      assignedEmployeeIds: ["ingrid", "lars"],
      unassignedEmployeeSlots: 1,
      totalLabourMinutes: null,
    });
    expect(write.schedule).toBeUndefined();
  });

  it("preserves pinned labour and required headcount on an unassign", () => {
    const write = planDragWrite({
      action: {
        ...baseAction,
        deltas: { employee: { kind: "unassign", from: "ingrid" } },
      },
      scope: "occurrence",
      staffing: {
        assignedEmployeeIds: ["ingrid"],
        openSlotCount: 0,
        labourMinutes: 120,
        isLabourRedistributed: true,
      },
    });
    // Single assignee removed → 0 assigned, 1 open slot (headcount preserved).
    expect(write.staffing?.assignedEmployeeIds).toEqual([]);
    expect(write.staffing?.unassignedEmployeeSlots).toBe(1);
    expect(write.staffing?.totalLabourMinutes).toBe(120);
  });

  it("emits no staffing when there is no delta at all", () => {
    const write = planDragWrite({
      action: { ...baseAction, deltas: {} },
      scope: "occurrence",
      staffing: {
        assignedEmployeeIds: ["ingrid"],
        openSlotCount: 0,
        labourMinutes: 120,
        isLabourRedistributed: false,
      },
    });
    expect(write.staffing).toBeUndefined();
    expect(write.schedule).toBeUndefined();
  });

  it("emits schedule (and never staffing) for a date move, preserving the window", () => {
    const write = planDragWrite({
      action: {
        ...baseAction,
        deltas: {
          date: { from: "2026-05-31", to: "2026-06-07", startTime: "08:00", endTime: "10:00" },
        },
      },
      scope: "occurrence",
      staffing: {
        assignedEmployeeIds: ["ingrid"],
        openSlotCount: 0,
        labourMinutes: 120,
        isLabourRedistributed: false,
      },
    });
    expect(write.schedule).toEqual({ date: "2026-06-07", startTime: "08:00", endTime: "10:00" });
    // Invariant: a date move must never carry a staffing change.
    expect(write.staffing).toBeUndefined();
  });

  it("passes a null window through as undefined (no explicit time override)", () => {
    const write = planDragWrite({
      action: {
        ...baseAction,
        deltas: {
          date: { from: "2026-05-31", to: "2026-06-07", startTime: null, endTime: null },
        },
      },
      scope: "occurrence",
      staffing: {
        assignedEmployeeIds: ["ingrid"],
        openSlotCount: 0,
        labourMinutes: 120,
        isLabourRedistributed: false,
      },
    });
    expect(write.schedule).toEqual({ date: "2026-06-07", startTime: undefined, endTime: undefined });
  });
});

describe("applyDragWrite — scope routing", () => {
  function staffingWrite(scope: DragWrite["scope"]): DragWrite {
    return {
      scope,
      occurrenceKey: "row_1:2026-05-31",
      parentServiceRowId: "row_1",
      workOrderId: "wo_1",
      staffing: {
        assignedEmployeeIds: ["kari"],
        unassignedEmployeeSlots: 0,
        totalLabourMinutes: null,
      },
    };
  }

  function spyWriters(): {
    writers: DragWriters;
    calls: { reassign: unknown[]; updateRow: unknown[]; reschedule: unknown[] };
  } {
    const calls = {
      reassign: [] as unknown[],
      updateRow: [] as unknown[],
      reschedule: [] as unknown[],
    };
    const writers: DragWriters = {
      reassignOccurrence: (occurrenceKey, input) => {
        calls.reassign.push({ occurrenceKey, input });
        return { ok: true };
      },
      updateServiceRow: (workOrderId, serviceRowId, patch) => {
        calls.updateRow.push({ workOrderId, serviceRowId, patch });
        return { ok: true };
      },
      rescheduleOccurrence: (occurrenceKey, input) => {
        calls.reschedule.push({ occurrenceKey, input });
        return { ok: true };
      },
    };
    return { writers, calls };
  }

  function scheduleWrite(): DragWrite {
    return {
      scope: "occurrence",
      occurrenceKey: "row_1:2026-05-31",
      parentServiceRowId: "row_1",
      workOrderId: "wo_1",
      schedule: { date: "2026-06-07", startTime: "08:00", endTime: "10:00" },
    };
  }

  it("routes occurrence scope to reassignOccurrence only", () => {
    const { writers, calls } = spyWriters();
    const res = applyDragWrite(staffingWrite("occurrence"), writers);
    expect(res.ok).toBe(true);
    expect(calls.reassign).toEqual([
      {
        occurrenceKey: "row_1:2026-05-31",
        input: {
          assignedEmployeeIds: ["kari"],
          unassignedEmployeeSlots: 0,
          totalLabourMinutes: null,
        },
      },
    ]);
    expect(calls.updateRow).toHaveLength(0);
  });

  it("routes series scope to updateServiceRow only", () => {
    const { writers, calls } = spyWriters();
    const res = applyDragWrite(staffingWrite("series"), writers);
    expect(res.ok).toBe(true);
    expect(calls.updateRow).toEqual([
      {
        workOrderId: "wo_1",
        serviceRowId: "row_1",
        patch: {
          assignedEmployeeIds: ["kari"],
          unassignedEmployeeSlots: 0,
          totalLabourMinutesOverride: null,
        },
      },
    ]);
    expect(calls.reassign).toHaveLength(0);
  });

  it("routes an occurrence date move to rescheduleOccurrence only", () => {
    const { writers, calls } = spyWriters();
    const res = applyDragWrite(scheduleWrite(), writers);
    expect(res.ok).toBe(true);
    expect(calls.reschedule).toEqual([
      {
        occurrenceKey: "row_1:2026-05-31",
        input: { newDate: "2026-06-07", newStartTime: "08:00", newEndTime: "10:00" },
      },
    ]);
    expect(calls.reassign).toHaveLength(0);
    expect(calls.updateRow).toHaveLength(0);
  });

  it("fails a date move when no reschedule writer is injected", () => {
    const res = applyDragWrite(scheduleWrite(), {
      reassignOccurrence: () => ({ ok: true }),
      updateServiceRow: () => ({ ok: true }),
    });
    expect(res.ok).toBe(false);
  });

  it("does not support from_here_forward until the variation writer lands", () => {
    const { writers } = spyWriters();
    const res = applyDragWrite(staffingWrite("from_here_forward"), writers);
    expect(res.ok).toBe(false);
  });

  it("uses the from_here_forward writer when one is injected (Phase 4 seam)", () => {
    const { writers } = spyWriters();
    const res = applyDragWrite(staffingWrite("from_here_forward"), {
      ...writers,
      addRecurringVariation: () => ({ ok: true }),
    });
    expect(res.ok).toBe(true);
  });
});

describe("engine end-to-end (gesture → write) parity with Phase 1", () => {
  it("recurring single-assignee reassign → occurrence reassignOccurrence", () => {
    const source = recurringSource();
    const evaluation = evaluateDragAction(source, { employeeId: "kari", date: "2026-05-31" });
    expect(evaluation.ok).toBe(true);
    if (!evaluation.ok) return;
    const { scope } = resolveDragScope(evaluation.action);
    const write = planDragWrite({
      action: evaluation.action,
      scope,
      staffing: {
        assignedEmployeeIds: source.assignedEmployeeIds,
        openSlotCount: source.openSlotCount,
        labourMinutes: source.labourMinutes,
        isLabourRedistributed: source.isLabourRedistributed,
      },
    });
    expect(write.scope).toBe("occurrence");
    expect(write.staffing?.assignedEmployeeIds).toEqual(["kari"]);
  });

  it("one-time reassign → series updateServiceRow", () => {
    const source = recurringSource({ isRecurring: false });
    const evaluation = evaluateDragAction(source, { employeeId: "kari", date: "2026-05-31" });
    expect(evaluation.ok).toBe(true);
    if (!evaluation.ok) return;
    const { scope } = resolveDragScope(evaluation.action);
    expect(scope).toBe("series");
  });

  it("recurring unassign → occurrence scope, open-slot staffing write", () => {
    const source = recurringSource();
    const evaluation = evaluateDragAction(source, { unassigned: true, date: "2026-05-31" });
    expect(evaluation.ok).toBe(true);
    if (!evaluation.ok) return;
    const { scope } = resolveDragScope(evaluation.action);
    const write = planDragWrite({
      action: evaluation.action,
      scope,
      staffing: {
        assignedEmployeeIds: source.assignedEmployeeIds,
        openSlotCount: source.openSlotCount,
        labourMinutes: source.labourMinutes,
        isLabourRedistributed: source.isLabourRedistributed,
      },
    });
    expect(write.scope).toBe("occurrence");
    expect(write.staffing).toEqual({
      assignedEmployeeIds: [],
      unassignedEmployeeSlots: 1,
      totalLabourMinutes: null,
    });
  });

  it("one-time unassign → series scope (updates the service row directly)", () => {
    const source = recurringSource({ isRecurring: false });
    const evaluation = evaluateDragAction(source, { unassigned: true, date: "2026-05-31" });
    expect(evaluation.ok).toBe(true);
    if (!evaluation.ok) return;
    const { scope } = resolveDragScope(evaluation.action);
    expect(scope).toBe("series");
  });
});
