import { describe, expect, it } from "vitest";

import { calculateMissionDelay } from "@/lib/domain/missionDelay";

describe("calculateMissionDelay", () => {
  it("spreads lost staff-minutes across the planned team", () => {
    // One employee 20 min late, 2-person team → ceil(20 / 2) = 10.
    expect(
      calculateMissionDelay({
        plannedTeamSize: 2,
        lateEmployeeMinutes: [20],
        scheduledDurationMinutes: 120,
      }),
    ).toBe(10);
  });

  it("sums multiple late employees and rounds up", () => {
    expect(
      calculateMissionDelay({
        plannedTeamSize: 2,
        lateEmployeeMinutes: [15, 10],
        scheduledDurationMinutes: 120,
      }),
    ).toBe(13); // ceil(25 / 2)
  });

  it("ignores early arrivals (negative lateness is treated as 0)", () => {
    expect(
      calculateMissionDelay({
        plannedTeamSize: 2,
        lateEmployeeMinutes: [-30, 20],
        scheduledDurationMinutes: 120,
      }),
    ).toBe(10);
  });

  it("clamps an invalid team size to at least 1 (no divide-by-zero)", () => {
    expect(
      calculateMissionDelay({
        plannedTeamSize: 0,
        lateEmployeeMinutes: [12],
        scheduledDurationMinutes: 60,
      }),
    ).toBe(12);
  });

  it("returns 0 when nobody is late", () => {
    expect(
      calculateMissionDelay({
        plannedTeamSize: 3,
        lateEmployeeMinutes: [],
        scheduledDurationMinutes: 90,
      }),
    ).toBe(0);
  });
});
