import { describe, expect, it } from "vitest";

import { resolveStaffingIndicator } from "./staffingIndicator";

describe("resolveStaffingIndicator", () => {
  it("renders nothing when there are no employees and no open slots", () => {
    const r = resolveStaffingIndicator(0, 0);
    expect(r.hasContent).toBe(false);
    expect(r.icon).toBe("none");
    expect(r.countLabel).toBeNull();
    expect(r.openSlotLabel).toBeNull();
  });

  it("uses the single-person icon for 1 assigned", () => {
    const r = resolveStaffingIndicator(1, 0);
    expect(r.icon).toBe("single");
    expect(r.showGroupPlus).toBe(false);
    expect(r.countLabel).toBe("1");
  });

  it("uses the group icon without plus for 2 assigned", () => {
    const r = resolveStaffingIndicator(2, 0);
    expect(r.icon).toBe("group");
    expect(r.showGroupPlus).toBe(false);
    expect(r.countLabel).toBe("2");
  });

  it("shows the group plus affordance for 3 or more assigned", () => {
    expect(resolveStaffingIndicator(3, 0).showGroupPlus).toBe(true);
    expect(resolveStaffingIndicator(5, 0).showGroupPlus).toBe(true);
    expect(resolveStaffingIndicator(5, 0).countLabel).toBe("5");
  });

  it("adds an open-slot affordance alongside assigned employees", () => {
    const r = resolveStaffingIndicator(3, 1);
    expect(r.icon).toBe("group");
    expect(r.showGroupPlus).toBe(true);
    expect(r.countLabel).toBe("3");
    expect(r.openSlotLabel).toBe("+1");
  });

  it("shows only the open-slot affordance when nobody is assigned", () => {
    const r = resolveStaffingIndicator(0, 1);
    expect(r.hasContent).toBe(true);
    expect(r.icon).toBe("none");
    expect(r.countLabel).toBeNull();
    expect(r.openSlotLabel).toBe("+1");
  });

  it("never folds open slots into the assigned count", () => {
    const r = resolveStaffingIndicator(2, 3);
    expect(r.assignedCount).toBe(2);
    expect(r.openSlots).toBe(3);
    expect(r.countLabel).toBe("2");
    expect(r.openSlotLabel).toBe("+3");
  });

  it("clamps negative / fractional / nullish input safely", () => {
    const r = resolveStaffingIndicator(-2, undefined);
    expect(r.assignedCount).toBe(0);
    expect(r.openSlots).toBe(0);
    expect(resolveStaffingIndicator(2.7, 1.9).assignedCount).toBe(2);
    expect(resolveStaffingIndicator(2.7, 1.9).openSlots).toBe(1);
  });
});
