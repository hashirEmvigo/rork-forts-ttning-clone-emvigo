import { describe, expect, it } from "vitest";

import { addMinutesToTime, formatDurationHoursLabel } from "@/lib/time";

describe("addMinutesToTime", () => {
  it("adds whole-hour and quarter-hour durations", () => {
    expect(addMinutesToTime("08:00", 60)).toBe("09:00");
    expect(addMinutesToTime("08:00", 75)).toBe("09:15");
    expect(addMinutesToTime("08:00", 90)).toBe("09:30");
    expect(addMinutesToTime("08:00", 105)).toBe("09:45");
    expect(addMinutesToTime("08:00", 150)).toBe("10:30");
  });

  it("handles arbitrary custom minute counts", () => {
    expect(addMinutesToTime("08:00", 45)).toBe("08:45");
    expect(addMinutesToTime("08:00", 70)).toBe("09:10");
    expect(addMinutesToTime("08:00", 155)).toBe("10:35");
  });

  it("clamps to the same day instead of wrapping past midnight", () => {
    expect(addMinutesToTime("23:30", 120)).toBe("23:59");
  });

  it("returns null for invalid start times or minute counts", () => {
    expect(addMinutesToTime("", 60)).toBeNull();
    expect(addMinutesToTime("nope", 60)).toBeNull();
    expect(addMinutesToTime("08:00", Number.NaN)).toBeNull();
  });
});

describe("formatDurationHoursLabel", () => {
  it("renders presets as compact decimal hours", () => {
    expect(formatDurationHoursLabel(60)).toBe("1");
    expect(formatDurationHoursLabel(75)).toBe("1.25");
    expect(formatDurationHoursLabel(90)).toBe("1.5");
    expect(formatDurationHoursLabel(105)).toBe("1.75");
    expect(formatDurationHoursLabel(270)).toBe("4.5");
  });
});
