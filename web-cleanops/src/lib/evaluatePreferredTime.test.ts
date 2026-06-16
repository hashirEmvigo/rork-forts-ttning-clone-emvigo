import { describe, expect, it } from "vitest";
import {
  evaluatePreferredTimeStatus,
  isPreferredTimeEvaluationAvailable,
  preferredTimeInputFromPreferences,
} from "./evaluatePreferredTime";
import type { PreferredTimeEvaluationInput } from "./evaluatePreferredTime";
import { emptySchedulingPreferences, normalizeSchedulingPreferencesV2 } from "@/types";
import type { CleaningDayPreference, CustomerSchedulingPreferences } from "@/types";

function base(
  overrides: Partial<PreferredTimeEvaluationInput> = {},
): PreferredTimeEvaluationInput {
  return {
    scheduledDate: "2026-06-01", // Monday
    plannedStartTime: "08:00",
    plannedEndTime: "10:00",
    preferredDays: ["monday"],
    preferredTimeRanges: [{ day: "monday", startTime: "08:00", endTime: "12:00" }],
    ...overrides,
  };
}

describe("evaluatePreferredTimeStatus", () => {
  it("returns none when there are no preferences at all", () => {
    expect(
      evaluatePreferredTimeStatus({
        scheduledDate: "2026-06-01",
        plannedStartTime: "08:00",
        plannedEndTime: "10:00",
      }).status,
    ).toBe("none");
  });

  it("returns optimal when preferred day and time both match", () => {
    expect(evaluatePreferredTimeStatus(base()).status).toBe("optimal");
  });

  it("returns outside_range on a preferred-day mismatch", () => {
    // 2026-06-02 is a Tuesday.
    expect(
      evaluatePreferredTimeStatus(base({ scheduledDate: "2026-06-02" })).status,
    ).toBe("outside_range");
  });

  it("returns outside_range on a preferred-time mismatch", () => {
    expect(
      evaluatePreferredTimeStatus(
        base({ plannedStartTime: "13:00", plannedEndTime: "15:00" }),
      ).status,
    ).toBe("outside_range");
  });

  it("returns outside_range when the day matches but the time is outside (no acceptable ranges)", () => {
    expect(
      evaluatePreferredTimeStatus(
        base({ plannedStartTime: "12:30", plannedEndTime: "14:00" }),
      ).status,
    ).toBe("outside_range");
  });

  it("returns acceptable when only the acceptable range matches", () => {
    const result = evaluatePreferredTimeStatus(
      base({
        plannedStartTime: "13:00",
        plannedEndTime: "15:00",
        acceptableDays: ["monday"],
        acceptableTimeRanges: [{ day: "monday", startTime: "07:00", endTime: "16:00" }],
      }),
    );
    expect(result.status).toBe("acceptable");
  });

  it("prefers optimal over acceptable when both match", () => {
    const result = evaluatePreferredTimeStatus(
      base({
        acceptableDays: ["monday"],
        acceptableTimeRanges: [{ day: "monday", startTime: "07:00", endTime: "16:00" }],
      }),
    );
    expect(result.status).toBe("optimal");
  });

  it("returns not_evaluated when the scheduled time is missing", () => {
    expect(
      evaluatePreferredTimeStatus(base({ plannedStartTime: null, plannedEndTime: null }))
        .status,
    ).toBe("not_evaluated");
  });

  it("returns not_evaluated when the scheduled day cannot be resolved", () => {
    expect(
      evaluatePreferredTimeStatus(base({ scheduledDate: null, scheduledDay: null }))
        .status,
    ).toBe("not_evaluated");
  });

  it("matches across multiple preferred days", () => {
    const input = base({
      scheduledDate: "2026-06-03", // Wednesday
      preferredDays: ["monday", "wednesday", "friday"],
      preferredTimeRanges: [
        { day: "monday", startTime: "08:00", endTime: "12:00" },
        { day: "wednesday", startTime: "08:00", endTime: "12:00" },
      ],
    });
    expect(evaluatePreferredTimeStatus(input).status).toBe("optimal");
  });

  it("matches across multiple preferred time ranges on the same day", () => {
    const input = base({
      plannedStartTime: "14:00",
      plannedEndTime: "15:00",
      preferredTimeRanges: [
        { day: "monday", startTime: "08:00", endTime: "10:00" },
        { day: "monday", startTime: "13:00", endTime: "16:00" },
      ],
    });
    expect(evaluatePreferredTimeStatus(input).status).toBe("optimal");
  });

  it("treats a preferred day with no time range as a day-only match", () => {
    const input = base({ preferredTimeRanges: [] });
    expect(evaluatePreferredTimeStatus(input).status).toBe("optimal");
  });

  it("uses an explicitly provided scheduledDay over the date", () => {
    const input = base({ scheduledDate: "2026-06-02", scheduledDay: "monday" });
    expect(evaluatePreferredTimeStatus(input).status).toBe("optimal");
  });
});

describe("isPreferredTimeEvaluationAvailable (settings gating)", () => {
  it("is unavailable when the company has disabled it (feature off at company level)", () => {
    expect(
      isPreferredTimeEvaluationAvailable({ masterAllows: true, companyEnabled: false }),
    ).toBe(false);
  });

  it("is unavailable when the master admin blocks it, even if the company enabled it", () => {
    expect(
      isPreferredTimeEvaluationAvailable({ masterAllows: false, companyEnabled: true }),
    ).toBe(false);
  });

  it("is available only when both master allows and company enables it", () => {
    expect(
      isPreferredTimeEvaluationAvailable({ masterAllows: true, companyEnabled: true }),
    ).toBe(true);
  });

  it("defaults companyEntitled to true so existing callers keep working", () => {
    expect(
      isPreferredTimeEvaluationAvailable({ masterAllows: true, companyEnabled: true }),
    ).toBe(true);
  });

  it("is unavailable when the company is not entitled to the add-on", () => {
    expect(
      isPreferredTimeEvaluationAvailable({
        masterAllows: true,
        companyEntitled: false,
        companyEnabled: true,
      }),
    ).toBe(false);
  });

  it("is available when master allows, company is entitled, and company enables it", () => {
    expect(
      isPreferredTimeEvaluationAvailable({
        masterAllows: true,
        companyEntitled: true,
        companyEnabled: true,
      }),
    ).toBe(true);
  });
});

describe("preferredTimeInputFromPreferences adapter", () => {
  function day(overrides: Partial<CleaningDayPreference>): CleaningDayPreference {
    return {
      id: "d1",
      day: "monday",
      optimalStartTime: "09:00",
      optimalEndTime: "12:00",
      acceptableStartTime: "08:00",
      acceptableEndTime: "15:00",
      ...overrides,
    };
  }

  it("maps optimal windows so an in-optimal occurrence is optimal", () => {
    // Legacy (pre-V2) customer: preferredDays migrate into recurring windows.
    const prefs: CustomerSchedulingPreferences = {
      ...emptySchedulingPreferences(),
      version: undefined,
      preferredDays: [day({})],
    };
    const input = preferredTimeInputFromPreferences(prefs, {
      scheduledDate: "2026-06-01", // Monday
      plannedStartTime: "09:30",
      plannedEndTime: "11:00",
    });
    expect(evaluatePreferredTimeStatus(input).status).toBe("optimal");
  });

  it("maps acceptable windows so an outside-optimal/in-acceptable occurrence is acceptable", () => {
    // Legacy (pre-V2) customer: preferredDays migrate into recurring windows.
    const prefs: CustomerSchedulingPreferences = {
      ...emptySchedulingPreferences(),
      version: undefined,
      preferredDays: [day({})],
    };
    const input = preferredTimeInputFromPreferences(prefs, {
      scheduledDate: "2026-06-01", // Monday
      plannedStartTime: "08:00",
      plannedEndTime: "08:45",
    });
    expect(evaluatePreferredTimeStatus(input).status).toBe("acceptable");
  });

  it("returns none when the customer has no preferences stored", () => {
    const input = preferredTimeInputFromPreferences(emptySchedulingPreferences(), {
      scheduledDate: "2026-06-01",
      plannedStartTime: "09:00",
      plannedEndTime: "10:00",
    });
    expect(evaluatePreferredTimeStatus(input).status).toBe("none");
  });

  it("uses V2 preferred recurring windows as optimal", () => {
    const prefs: CustomerSchedulingPreferences = {
      ...emptySchedulingPreferences(),
      version: 2,
      preferredRecurringWindows: [
        { id: "pref_1", day: "monday", startTime: "09:00", endTime: "12:00" },
      ],
      acceptableRecurringWindows: [],
      acceptableTemporaryWindows: [],
    };
    const input = preferredTimeInputFromPreferences(prefs, {
      scheduledDate: "2026-06-01",
      plannedStartTime: "09:30",
      plannedEndTime: "11:00",
    });
    expect(evaluatePreferredTimeStatus(input).status).toBe("optimal");
  });

  it("uses V2 acceptable recurring windows as acceptable", () => {
    const prefs: CustomerSchedulingPreferences = {
      ...emptySchedulingPreferences(),
      version: 2,
      preferredRecurringWindows: [
        { id: "pref_1", day: "monday", startTime: "06:00", endTime: "07:00" },
      ],
      acceptableRecurringWindows: [
        { id: "acc_1", day: "monday", startTime: "08:00", endTime: "15:00" },
      ],
      acceptableTemporaryWindows: [],
    };
    const input = preferredTimeInputFromPreferences(prefs, {
      scheduledDate: "2026-06-01",
      plannedStartTime: "09:30",
      plannedEndTime: "11:00",
    });
    expect(evaluatePreferredTimeStatus(input).status).toBe("acceptable");
  });

  it("ignores V2 acceptable temporary windows for normal preferred-time evaluation", () => {
    const prefs: CustomerSchedulingPreferences = {
      ...emptySchedulingPreferences(),
      version: 2,
      preferredRecurringWindows: [],
      acceptableRecurringWindows: [],
      acceptableTemporaryWindows: [
        { id: "temp_1", day: "monday", startTime: "08:00", endTime: "15:00" },
      ],
    };
    const input = preferredTimeInputFromPreferences(prefs, {
      scheduledDate: "2026-06-01",
      plannedStartTime: "09:30",
      plannedEndTime: "11:00",
    });
    expect(evaluatePreferredTimeStatus(input).status).toBe("none");
  });

  it("keeps legacy records evaluable through V2 normalization", () => {
    const prefs: CustomerSchedulingPreferences = {
      ...emptySchedulingPreferences(),
      version: undefined,
      preferredDays: [day({})],
    };
    const normalized = normalizeSchedulingPreferencesV2(prefs);
    expect(normalized.preferredRecurringWindows).toEqual([
      expect.objectContaining({ day: "monday", startTime: "09:00", endTime: "12:00" }),
    ]);
    const input = preferredTimeInputFromPreferences(prefs, {
      scheduledDate: "2026-06-01",
      plannedStartTime: "09:30",
      plannedEndTime: "11:00",
    });
    expect(evaluatePreferredTimeStatus(input).status).toBe("optimal");
  });
});
