import { describe, expect, it } from "vitest";

import {
  rollUpEmployeeWorkload,
  type EmployeeRollupEntry,
} from "./scheduleEmployeeRollup";

const entry = (over: Partial<EmployeeRollupEntry>): EmployeeRollupEntry => ({
  status: "scheduled",
  visitMinutes: 120,
  perEmployeeMinutes: 120,
  ...over,
});

describe("rollUpEmployeeWorkload", () => {
  it("normal booking: on-site equals labour", () => {
    const result = rollUpEmployeeWorkload([
      entry({ visitMinutes: 120, perEmployeeMinutes: 120 }),
      entry({ visitMinutes: 60, perEmployeeMinutes: 60 }),
    ]);
    expect(result.onSiteMinutes).toBe(180);
    expect(result.labourMinutes).toBe(180);
  });

  it("redistributed booking: on-site differs from labour", () => {
    // 2h visit but this lone employee carries the full 4h redistributed labour.
    const result = rollUpEmployeeWorkload([
      entry({ visitMinutes: 120, perEmployeeMinutes: 240 }),
    ]);
    expect(result.onSiteMinutes).toBe(120);
    expect(result.labourMinutes).toBe(240);
  });

  it("falls back to visit duration when no per-employee labour exists", () => {
    const result = rollUpEmployeeWorkload([
      entry({ visitMinutes: 90, perEmployeeMinutes: null }),
    ]);
    expect(result.onSiteMinutes).toBe(90);
    expect(result.labourMinutes).toBe(90);
  });

  it("multi-employee occurrence sums this employee's per-employee labour", () => {
    // The roll-up only ever sees the entries assigned to ONE employee, so each
    // occurrence contributes its own per-employee share (3h/employee here).
    const result = rollUpEmployeeWorkload([
      entry({ visitMinutes: 120, perEmployeeMinutes: 180 }),
      entry({ visitMinutes: 120, perEmployeeMinutes: 180 }),
    ]);
    expect(result.onSiteMinutes).toBe(240);
    expect(result.labourMinutes).toBe(360);
  });

  it("open slots do not inflate employee labour", () => {
    // An understaffed occurrence (open slot) still only contributes the labour
    // carried by this assigned employee, never the open slot's share.
    const result = rollUpEmployeeWorkload([
      entry({ visitMinutes: 120, perEmployeeMinutes: 120 }),
    ]);
    expect(result.labourMinutes).toBe(120);
  });

  it("excludes cancelled occurrences from both totals", () => {
    const result = rollUpEmployeeWorkload([
      entry({ visitMinutes: 120, perEmployeeMinutes: 240 }),
      entry({ status: "cancelled", visitMinutes: 120, perEmployeeMinutes: 120 }),
    ]);
    expect(result.onSiteMinutes).toBe(120);
    expect(result.labourMinutes).toBe(240);
  });

  it("clamps negative/invalid minutes to zero", () => {
    const result = rollUpEmployeeWorkload([
      entry({ visitMinutes: -30, perEmployeeMinutes: -30 }),
    ]);
    expect(result.onSiteMinutes).toBe(0);
    expect(result.labourMinutes).toBe(0);
  });
});
