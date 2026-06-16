import { describe, expect, it } from "vitest";

import {
  buildGlobalPayrollGroups,
  globalPayrollGroupId,
  isPayrollGroupType,
} from "./payrollGroups";
import { PAYROLL_GROUP_TYPES } from "@/types";

describe("payroll group governance catalogue", () => {
  const ts = "2026-06-02T00:00:00.000Z";

  it("builds one global group per governed type, in declared order", () => {
    const groups = buildGlobalPayrollGroups(ts);
    expect(groups).toHaveLength(PAYROLL_GROUP_TYPES.length);
    groups.forEach((g, i) => {
      expect(g.companyId).toBeNull();
      expect(g.groupType).toBe(PAYROLL_GROUP_TYPES[i].value);
      expect(g.sortOrder).toBe(i);
      expect(g.id).toBe(globalPayrollGroupId(PAYROLL_GROUP_TYPES[i].value));
      expect(g.status).toBe("active");
    });
  });

  it("includes the five required groups", () => {
    const types = buildGlobalPayrollGroups(ts).map((g) => g.groupType);
    expect(types).toEqual([
      "working_time",
      "travel_time",
      "absence",
      "internal_time",
      "information",
    ]);
  });

  it("produces unique ids", () => {
    const ids = buildGlobalPayrollGroups(ts).map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("isPayrollGroupType", () => {
  it("accepts governed types and rejects others", () => {
    expect(isPayrollGroupType("working_time")).toBe(true);
    expect(isPayrollGroupType("internal_time")).toBe(true);
    expect(isPayrollGroupType("nope")).toBe(false);
    expect(isPayrollGroupType(null)).toBe(false);
  });
});
