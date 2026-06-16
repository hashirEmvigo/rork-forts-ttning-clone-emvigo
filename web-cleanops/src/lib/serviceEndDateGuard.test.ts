import { describe, expect, it } from "vitest";
import {
  isAfterServiceEnd,
  isHiddenOrphanOccurrence,
  isLiveSourceRow,
} from "./serviceEndDateGuard";
import type { WorkOrderServiceRow } from "@/types";

function makeRow(overrides: Partial<WorkOrderServiceRow> = {}): WorkOrderServiceRow {
  return {
    id: "row-1",
    serviceName: "Cleaning",
    quantity: 1,
    status: "planned",
    serviceDate: "2026-05-31",
    recurrenceInterval: "weekly",
    plannedStartTime: "08:30",
    plannedEndTime: "09:00",
    assignedEmployeeIds: ["a"],
    unassignedEmployeeSlots: 0,
    sortOrder: 0,
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("isAfterServiceEnd", () => {
  it("excludes occurrences dated after the live row's end date", () => {
    const row = makeRow({ serviceEndDate: "2026-05-31" });
    expect(isAfterServiceEnd("2026-06-08", row, false)).toBe(true);
    expect(isAfterServiceEnd("2026-06-14", row, false)).toBe(true);
    expect(isAfterServiceEnd("2026-06-28", row, false)).toBe(true);
  });

  it("keeps the occurrence on the end date itself", () => {
    const row = makeRow({ serviceEndDate: "2026-05-31" });
    expect(isAfterServiceEnd("2026-05-31", row, false)).toBe(false);
    expect(isAfterServiceEnd("2026-05-24", row, false)).toBe(false);
  });

  it("does not filter when the live row has no end date (unbounded)", () => {
    const row = makeRow({ serviceEndDate: null });
    expect(isAfterServiceEnd("2026-12-31", row, false)).toBe(false);
    const rowUndefined = makeRow({ serviceEndDate: undefined });
    expect(isAfterServiceEnd("2026-12-31", rowUndefined, false)).toBe(false);
    const rowBlank = makeRow({ serviceEndDate: "   " });
    expect(isAfterServiceEnd("2026-12-31", rowBlank, false)).toBe(false);
  });

  it("does not filter when the source row is gone (orphaned snapshot)", () => {
    // Stale persisted item whose live row no longer exists: leave it alone.
    expect(isAfterServiceEnd("2026-06-08", undefined, false)).toBe(false);
  });

  it("exempts occurrences with an explicit persisted exception", () => {
    const row = makeRow({ serviceEndDate: "2026-05-31" });
    // A deliberately rescheduled/closed-out occurrence stays traceable.
    expect(isAfterServiceEnd("2026-06-08", row, true)).toBe(false);
  });

  it("ignores invalid date strings safely", () => {
    const row = makeRow({ serviceEndDate: "2026-05-31" });
    expect(isAfterServiceEnd("", row, false)).toBe(false);
    expect(isAfterServiceEnd("not-a-date", row, false)).toBe(false);
  });
});

describe("isLiveSourceRow", () => {
  it("treats a present, non-archived row as live", () => {
    expect(isLiveSourceRow(makeRow())).toBe(true);
    expect(isLiveSourceRow(makeRow({ archived: false }))).toBe(true);
  });

  it("treats a missing row as not live (orphan)", () => {
    expect(isLiveSourceRow(undefined)).toBe(false);
  });

  it("treats an archived row as not live (superseded/renewed service)", () => {
    // Bergen WO-1002: the old row was archived when the service was renewed into
    // a fresh row, so the archived row must stop driving future bookings.
    expect(isLiveSourceRow(makeRow({ archived: true }))).toBe(false);
  });
});

describe("isHiddenOrphanOccurrence", () => {
  const today = "2026-05-31";

  it("hides a future orphan with no history (stale ghost)", () => {
    expect(
      isHiddenOrphanOccurrence({
        occurrenceDate: "2026-06-14",
        hasLiveSourceRow: false,
        today,
      }),
    ).toBe(true);
  });

  it("never hides a row that still has a live source row", () => {
    expect(
      isHiddenOrphanOccurrence({
        occurrenceDate: "2026-06-14",
        hasLiveSourceRow: true,
        today,
      }),
    ).toBe(false);
  });

  it("keeps a strictly-past orphan occurrence visible", () => {
    expect(
      isHiddenOrphanOccurrence({
        occurrenceDate: "2026-05-24",
        hasLiveSourceRow: false,
        today,
      }),
    ).toBe(false);
  });

  it("hides an orphan dated today (stale ghost, e.g. Bergen WO-1002)", () => {
    // A today orphan can't reflect a current AO edit — the live row carries its
    // own correctly-reconciled queue item — so the stale snapshot is suppressed.
    expect(
      isHiddenOrphanOccurrence({
        occurrenceDate: today,
        hasLiveSourceRow: false,
        today,
      }),
    ).toBe(true);
  });

  it("hides a future orphan even when it carries a reschedule/exception", () => {
    // The Bergen WO-1002 "Moved from…" rows: a future reschedule of a deleted
    // service row is itself a ghost and must not render as active future work.
    expect(
      isHiddenOrphanOccurrence({
        occurrenceDate: "2026-06-01",
        hasLiveSourceRow: false,
        today,
      }),
    ).toBe(true);
    expect(
      isHiddenOrphanOccurrence({
        occurrenceDate: "2026-06-08",
        hasLiveSourceRow: false,
        today,
      }),
    ).toBe(true);
  });

  it("ignores invalid date strings safely", () => {
    expect(
      isHiddenOrphanOccurrence({
        occurrenceDate: "not-a-date",
        hasLiveSourceRow: false,
        today,
      }),
    ).toBe(false);
  });
});
