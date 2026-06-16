import { describe, expect, it } from "vitest";

import { buildVisitChipLabour } from "./scheduleCellLabour";

describe("buildVisitChipLabour", () => {
  it("builds a compact [Duration / Labour] badge for a single assignee", () => {
    const result = buildVisitChipLabour({
      visitMinutes: 120,
      labourMinutes: 240,
      perEmployeeMinutes: 240,
      assignedEmployeeNames: ["Ingrid"],
      isLabourRedistributed: true,
    });
    expect(result.summaryLabel).toBe("[2.0h / 4.0h]");
    expect(result.perEmployeeMinutes).toBe(240);
    expect(result.isRedistributed).toBe(true);
  });

  it("shows total labour for an increased-labour crew", () => {
    const result = buildVisitChipLabour({
      visitMinutes: 120,
      labourMinutes: 360,
      perEmployeeMinutes: 120,
      assignedEmployeeNames: ["Ingrid", "Kari", "Lars"],
      isLabourRedistributed: false,
    });
    expect(result.summaryLabel).toBe("[2.0h / 6.0h]");
    expect(result.perEmployeeMinutes).toBe(120);
    expect(result.isRedistributed).toBe(false);
  });

  it("reflects a split job where the on-site duration shrinks", () => {
    const result = buildVisitChipLabour({
      visitMinutes: 40,
      labourMinutes: 120,
      perEmployeeMinutes: 40,
      assignedEmployeeNames: ["Ingrid", "Kari", "Lars"],
      isLabourRedistributed: true,
    });
    expect(result.summaryLabel).toBe("[0.67h / 2.0h]");
  });

  it("formats quarter-hour durations compactly", () => {
    const result = buildVisitChipLabour({
      visitMinutes: 150,
      labourMinutes: 270,
      perEmployeeMinutes: 270,
      assignedEmployeeNames: ["Fatima"],
      isLabourRedistributed: false,
    });
    expect(result.summaryLabel).toBe("[2.5h / 4.5h]");
  });

  it("returns null badge for missing/zero values without throwing", () => {
    const result = buildVisitChipLabour({
      visitMinutes: null,
      labourMinutes: null,
      perEmployeeMinutes: null,
      assignedEmployeeNames: ["Ingrid"],
      isLabourRedistributed: false,
    });
    expect(result.summaryLabel).toBeNull();
    expect(result.perEmployeeMinutes).toBeNull();
    expect(result.isRedistributed).toBe(false);
  });
});
