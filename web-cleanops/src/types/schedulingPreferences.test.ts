import { describe, expect, it } from "vitest";

import {
  emptySchedulingPreferences,
  legacyPreferencesToV2,
  normalizeSchedulingPreferencesV2,
} from "./index";
import type { CleaningDayPreference, CustomerSchedulingPreferences } from "./index";

function legacyDay(overrides: Partial<CleaningDayPreference> = {}): CleaningDayPreference {
  return {
    id: "day_1",
    day: "monday",
    optimalStartTime: "09:00",
    optimalEndTime: "12:00",
    acceptableStartTime: "08:00",
    acceptableEndTime: "15:00",
    ...overrides,
  };
}

describe("CUSTOMER-SCHEDULING-PREFERENCES-A1.1 V2 normalization", () => {
  it("migrates legacy preferredDays to preferredRecurringWindows", () => {
    const v2 = legacyPreferencesToV2({
      ...emptySchedulingPreferences(),
      version: undefined,
      preferredDays: [legacyDay({ id: "preferred_1", day: "tuesday" })],
    });

    expect(v2.version).toBe(2);
    expect(v2.preferredRecurringWindows).toEqual([
      expect.objectContaining({
        id: "preferred_1_preferred",
        day: "tuesday",
        startTime: "09:00",
        endTime: "12:00",
      }),
    ]);
  });

  it("migrates legacy preferred acceptable ranges and secondaryDays to acceptableRecurringWindows", () => {
    const v2 = legacyPreferencesToV2({
      ...emptySchedulingPreferences(),
      version: undefined,
      preferredDays: [legacyDay({ id: "preferred_1", day: "monday" })],
      secondaryDays: [
        legacyDay({
          id: "secondary_1",
          day: "wednesday",
          acceptableStartTime: "10:00",
          acceptableEndTime: "14:00",
        }),
      ],
    });

    expect(v2.acceptableRecurringWindows).toEqual([
      expect.objectContaining({
        id: "preferred_1_preferred_acceptable",
        day: "monday",
        startTime: "08:00",
        endTime: "15:00",
      }),
      expect.objectContaining({
        id: "secondary_1_secondary",
        day: "wednesday",
        startTime: "10:00",
        endTime: "14:00",
      }),
    ]);
  });

  it("maps legacy absenceHandling / absencePriority to temporaryReschedulingPriority", () => {
    const v2 = legacyPreferencesToV2({
      ...emptySchedulingPreferences(),
      version: undefined,
      absenceHandling: "skip_visit_wait_regular_employee",
      absencePriority: ["regular_day_substitute_employee"],
    });

    expect(v2.temporaryReschedulingPriority?.[0]).toBe("skip_visit_wait_regular_employee");
    expect(v2.temporaryReschedulingPriority).toContain("regular_day_substitute_employee");
  });

  it("defaults acceptableTemporaryWindows to empty and never copies recurring windows", () => {
    const v2 = legacyPreferencesToV2({
      ...emptySchedulingPreferences(),
      version: undefined,
      preferredDays: [legacyDay({})],
      secondaryDays: [legacyDay({ id: "secondary_1", day: "friday" })],
    });

    expect(v2.acceptableTemporaryWindows).toEqual([]);
  });

  it("does not rehydrate removed V2 windows from legacy preferredDays or secondaryDays", () => {
    const normalized = normalizeSchedulingPreferencesV2({
      ...emptySchedulingPreferences(),
      version: 2,
      preferredRecurringWindows: [],
      acceptableRecurringWindows: [],
      acceptableTemporaryWindows: [],
      preferredDays: [legacyDay({ id: "old_preferred", day: "monday" })],
      secondaryDays: [legacyDay({ id: "old_secondary", day: "tuesday" })],
      absencePriority: [],
      temporaryReschedulingPriority: [],
    });

    expect(normalized.preferredRecurringWindows).toEqual([]);
    expect(normalized.acceptableRecurringWindows).toEqual([]);
    expect(normalized.acceptableTemporaryWindows).toEqual([]);
  });

  it("normalizes invalid or empty V2 windows safely", () => {
    const prefs: CustomerSchedulingPreferences = {
      ...emptySchedulingPreferences(),
      version: 2,
      preferredRecurringWindows: [
        {
          id: "bad_window",
          day: "monday",
          startTime: "13:00",
          endTime: "09:00",
        },
      ],
      acceptableTemporaryWindows: [
        {
          id: "good_temp",
          day: "tuesday",
          startTime: "10:00",
          endTime: "12:00",
        },
      ],
    };

    const normalized = normalizeSchedulingPreferencesV2(prefs);

    expect(normalized.preferredRecurringWindows).toEqual([]);
    expect(normalized.acceptableTemporaryWindows).toEqual([
      expect.objectContaining({ id: "good_temp", day: "tuesday" }),
    ]);
  });
});
