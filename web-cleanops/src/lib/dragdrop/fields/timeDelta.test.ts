import { describe, expect, it } from "vitest";
import { buildTimeScheduleWrite, durationMinutesOf } from "./timeDelta";

describe("durationMinutesOf", () => {
  it("computes the minutes between a valid window", () => {
    expect(durationMinutesOf("08:00", "10:00")).toBe(120);
    expect(durationMinutesOf("09:15", "10:00")).toBe(45);
  });

  it("returns null for a missing or invalid window", () => {
    expect(durationMinutesOf(null, "10:00")).toBeNull();
    expect(durationMinutesOf("08:00", null)).toBeNull();
    expect(durationMinutesOf("10:00", "08:00")).toBeNull();
    expect(durationMinutesOf("10:00", "10:00")).toBeNull();
  });
});

describe("buildTimeScheduleWrite", () => {
  it("preserves duration when moving the start time later", () => {
    const write = buildTimeScheduleWrite({
      date: "2026-06-01",
      currentStart: "08:00",
      currentEnd: "10:00",
      newStart: "09:00",
    });
    expect(write).toEqual({ date: "2026-06-01", startTime: "09:00", endTime: "11:00" });
  });

  it("preserves duration when moving the start time earlier", () => {
    const write = buildTimeScheduleWrite({
      date: "2026-06-01",
      currentStart: "10:15",
      currentEnd: "12:15",
      newStart: "07:30",
    });
    expect(write).toEqual({ date: "2026-06-01", startTime: "07:30", endTime: "09:30" });
  });

  it("keeps the day unchanged (no cascading, no date move)", () => {
    const write = buildTimeScheduleWrite({
      date: "2026-06-01",
      currentStart: "08:00",
      currentEnd: "09:00",
      newStart: "13:00",
    });
    expect(write.date).toBe("2026-06-01");
  });

  it("leaves end null when the current window has no resolvable duration", () => {
    const write = buildTimeScheduleWrite({
      date: "2026-06-01",
      currentStart: null,
      currentEnd: null,
      newStart: "09:00",
    });
    expect(write).toEqual({ date: "2026-06-01", startTime: "09:00", endTime: null });
  });
});
