import { describe, expect, it } from "vitest";

import {
  formatHoursPerSqm,
  formatHoursWithMinutes,
  formatMinutesWithHours,
  formatPlainNumber,
  hoursToMinutes,
  minutesToHours,
  parseLooseNumber,
} from "./timeUnits";

describe("timeUnits — Slice 12N display standard", () => {
  it("formats minute-backed values as 'X min (Y h)'", () => {
    expect(formatMinutesWithHours(30)).toBe("30 min (0.5 h)");
    expect(formatMinutesWithHours(180)).toBe("180 min (3 h)");
    expect(formatMinutesWithHours(15)).toBe("15 min (0.25 h)");
    expect(formatMinutesWithHours(45)).toBe("45 min (0.75 h)");
    expect(formatMinutesWithHours(120)).toBe("120 min (2 h)");
  });

  it("formats hour-backed values as 'X min (Y h)'", () => {
    expect(formatHoursWithMinutes(0.25)).toBe("15 min (0.25 h)");
    expect(formatHoursWithMinutes(0.5)).toBe("30 min (0.5 h)");
    expect(formatHoursWithMinutes(2)).toBe("120 min (2 h)");
    expect(formatHoursWithMinutes(1.5)).toBe("90 min (1.5 h)");
  });

  it("formats hours-per-m² values as 'X min/m² (Y h/m²)'", () => {
    expect(formatHoursPerSqm(0.02)).toBe("1.2 min/m² (0.02 h/m²)");
  });

  it("handles negative time deltas (plan/start adjustments)", () => {
    expect(formatMinutesWithHours(-15)).toBe("-15 min (-0.25 h)");
    expect(formatHoursWithMinutes(-0.5)).toBe("-30 min (-0.5 h)");
    expect(formatMinutesWithHours(0)).toBe("0 min (0 h)");
  });

  it("does not emit trailing zeros or floating-point noise", () => {
    expect(formatPlainNumber(0.5)).toBe("0.5");
    expect(formatPlainNumber(1)).toBe("1");
    expect(formatPlainNumber(0.02 * 60, 2)).toBe("1.2");
    expect(formatPlainNumber(-0)).toBe("0");
  });

  it("converts between minutes and hours symmetrically", () => {
    expect(minutesToHours(30)).toBe(0.5);
    expect(hoursToMinutes(0.75)).toBe(45);
    expect(minutesToHours(-15)).toBe(-0.25);
  });

  it("parses loose numbers, tolerating spaces and a comma decimal", () => {
    expect(parseLooseNumber("45")).toBe(45);
    expect(parseLooseNumber("1 200,5")).toBe(1200.5);
    expect(parseLooseNumber("-15")).toBe(-15);
    expect(parseLooseNumber("")).toBeNull();
    expect(parseLooseNumber("abc")).toBeNull();
  });
});
