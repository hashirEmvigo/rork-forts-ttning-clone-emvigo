import { describe, expect, it } from "vitest";
import {
  detectTimeConflicts,
  type ConflictNeighbour,
} from "./timeConflict";

function neighbour(partial: Partial<ConflictNeighbour> & { occurrenceKey: string }): ConflictNeighbour {
  return {
    date: "2026-06-01",
    startTime: "10:15",
    endTime: "12:15",
    customerName: "Customer 2",
    serviceName: "Cleaning",
    timeLabel: "10:15–12:15",
    ...partial,
  };
}

describe("detectTimeConflicts", () => {
  it("reports an overlapping neighbour on the same day", () => {
    const conflicts = detectTimeConflicts(
      { occurrenceKey: "row-4:2026-06-01", date: "2026-06-01", startTime: "11:00", endTime: "13:00" },
      [neighbour({ occurrenceKey: "row-2:2026-06-01" })],
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].occurrenceKey).toBe("row-2:2026-06-01");
  });

  it("does not conflict when windows only touch at the edge", () => {
    const conflicts = detectTimeConflicts(
      { occurrenceKey: "row-4:2026-06-01", date: "2026-06-01", startTime: "08:00", endTime: "10:15" },
      [neighbour({ occurrenceKey: "row-2:2026-06-01", startTime: "10:15", endTime: "12:15" })],
    );
    expect(conflicts).toHaveLength(0);
  });

  it("ignores the candidate's own occurrence", () => {
    const conflicts = detectTimeConflicts(
      { occurrenceKey: "row-2:2026-06-01", date: "2026-06-01", startTime: "10:30", endTime: "12:00" },
      [neighbour({ occurrenceKey: "row-2:2026-06-01" })],
    );
    expect(conflicts).toHaveLength(0);
  });

  it("ignores neighbours on a different day", () => {
    const conflicts = detectTimeConflicts(
      { occurrenceKey: "row-4:2026-06-01", date: "2026-06-01", startTime: "11:00", endTime: "13:00" },
      [neighbour({ occurrenceKey: "row-2:2026-06-02", date: "2026-06-02" })],
    );
    expect(conflicts).toHaveLength(0);
  });

  it("ignores neighbours without a valid window", () => {
    const conflicts = detectTimeConflicts(
      { occurrenceKey: "row-4:2026-06-01", date: "2026-06-01", startTime: "11:00", endTime: "13:00" },
      [neighbour({ occurrenceKey: "row-2:2026-06-01", startTime: null, endTime: null })],
    );
    expect(conflicts).toHaveLength(0);
  });

  it("returns nothing when the candidate window is invalid", () => {
    const conflicts = detectTimeConflicts(
      { occurrenceKey: "row-4:2026-06-01", date: "2026-06-01", startTime: "13:00", endTime: "11:00" },
      [neighbour({ occurrenceKey: "row-2:2026-06-01" })],
    );
    expect(conflicts).toHaveLength(0);
  });
});
