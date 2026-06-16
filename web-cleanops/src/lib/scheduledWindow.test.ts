import { describe, expect, it } from "vitest";
import { resolveScheduledWindow } from "./scheduledWindow";

describe("resolveScheduledWindow", () => {
  it("keeps the scheduled window equal to the allowed window with no redistribution", () => {
    // 08:00–10:00, single employee, 2h each → on-site 2h, window unchanged.
    const res = resolveScheduledWindow({
      plannedStartTime: "08:00",
      plannedEndTime: "10:00",
      visitMinutes: 120,
      perEmployeeMinutes: 120,
    });
    expect(res.scheduledStartTime).toBe("08:00");
    expect(res.scheduledEndTime).toBe("10:00");
    expect(res.onSiteMinutes).toBe(120);
    expect(res.allowedEndTime).toBe("10:00");
    expect(res.differsFromAllowed).toBe(false);
  });

  it("shrinks the scheduled window when work is split across a larger crew", () => {
    // 2h total split across 3 employees → each works 40 min in parallel →
    // on-site 40 min → scheduled 08:00–08:40, allowed window stays 08:00–10:00.
    const res = resolveScheduledWindow({
      plannedStartTime: "08:00",
      plannedEndTime: "10:00",
      visitMinutes: 120,
      perEmployeeMinutes: 40,
    });
    expect(res.scheduledStartTime).toBe("08:00");
    expect(res.scheduledEndTime).toBe("08:40");
    expect(res.onSiteMinutes).toBe(40);
    expect(res.allowedStartTime).toBe("08:00");
    expect(res.allowedEndTime).toBe("10:00");
    expect(res.allowedMinutes).toBe(120);
    expect(res.differsFromAllowed).toBe(true);
  });

  it("extends the scheduled window when work is redistributed onto a smaller crew", () => {
    // 2 people × 3h redistributed onto 1 person → 6h on-site for that person.
    const res = resolveScheduledWindow({
      plannedStartTime: "08:00",
      plannedEndTime: "11:00",
      visitMinutes: 180,
      perEmployeeMinutes: 360,
    });
    expect(res.scheduledEndTime).toBe("14:00");
    expect(res.onSiteMinutes).toBe(360);
    expect(res.differsFromAllowed).toBe(true);
  });

  it("does not increase total on-site time when staffing increases without split", () => {
    // 2 employees each work the full 3h in parallel (increase labour) →
    // on-site stays 3h, window unchanged.
    const res = resolveScheduledWindow({
      plannedStartTime: "08:00",
      plannedEndTime: "11:00",
      visitMinutes: 180,
      perEmployeeMinutes: 180,
    });
    expect(res.scheduledEndTime).toBe("11:00");
    expect(res.onSiteMinutes).toBe(180);
    expect(res.differsFromAllowed).toBe(false);
  });

  it("falls back to the visit window when no per-employee value exists", () => {
    const res = resolveScheduledWindow({
      plannedStartTime: "09:00",
      plannedEndTime: "12:00",
      visitMinutes: 180,
      perEmployeeMinutes: null,
    });
    expect(res.scheduledEndTime).toBe("12:00");
    expect(res.onSiteMinutes).toBe(180);
    expect(res.differsFromAllowed).toBe(false);
  });

  it("handles missing planned window safely", () => {
    const res = resolveScheduledWindow({
      plannedStartTime: null,
      plannedEndTime: null,
      visitMinutes: null,
      perEmployeeMinutes: null,
    });
    expect(res.scheduledStartTime).toBeNull();
    expect(res.scheduledEndTime).toBeNull();
    expect(res.onSiteMinutes).toBeNull();
    expect(res.differsFromAllowed).toBe(false);
  });

  it("clamps a too-long on-site window to the same day (no midnight wrap)", () => {
    const res = resolveScheduledWindow({
      plannedStartTime: "22:00",
      plannedEndTime: "23:00",
      visitMinutes: 60,
      perEmployeeMinutes: 600,
    });
    expect(res.scheduledEndTime).toBe("23:59");
  });
});
