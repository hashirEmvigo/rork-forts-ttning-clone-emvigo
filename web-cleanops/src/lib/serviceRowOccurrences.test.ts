import { describe, expect, it } from "vitest";
import {
  generateServiceRowOccurrences,
  variationHasPastOccurrence,
  countServiceRowGeneratedOccurrences,
  type ServiceRowOccurrence,
} from "./serviceRowOccurrences";
import {
  indexOccurrenceExceptions,
  type BookingOccurrenceException,
  type RecurringVariation,
  type WorkOrderServiceRow,
} from "@/types";

/** Builds a minimal weekly service row for occurrence-generation tests. */
function makeRow(overrides: Partial<WorkOrderServiceRow> = {}): WorkOrderServiceRow {
  return {
    id: "row-1",
    serviceName: "Cleaning",
    quantity: 1,
    status: "planned",
    serviceDate: "2025-01-06", // Monday
    recurrenceInterval: "weekly",
    plannedStartTime: "08:30",
    plannedEndTime: "09:00", // 30 min visit
    assignedEmployeeIds: ["a"],
    unassignedEmployeeSlots: 0,
    sortOrder: 0,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeVariation(overrides: Partial<RecurringVariation> = {}): RecurringVariation {
  return {
    id: "var-1",
    name: "Variation",
    frequency: "every_n_visits",
    interval: 2,
    status: "active",
    enabled: true,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("generateServiceRowOccurrences", () => {
  it("returns the next N upcoming occurrences from the rule", () => {
    const occ = generateServiceRowOccurrences({
      row: makeRow(),
      fromDate: "2025-01-06",
      limit: 5,
    });
    expect(occ.map((o) => o.occurrenceDate)).toEqual([
      "2025-01-06",
      "2025-01-13",
      "2025-01-20",
      "2025-01-27",
      "2025-02-03",
    ]);
    expect(occ.map((o) => o.occurrenceIndex)).toEqual([0, 1, 2, 3, 4]);
  });

  it("respects the limit", () => {
    const occ = generateServiceRowOccurrences({
      row: makeRow(),
      fromDate: "2025-01-06",
      limit: 3,
    });
    expect(occ).toHaveLength(3);
  });

  it("anchorOccurrenceIndex equals the series occurrence index, not the page position", () => {
    // Start searching mid-series: the first visible occurrence is the 3rd in the
    // series (index 2), so its anchor is 2 — never 0.
    const occ = generateServiceRowOccurrences({
      row: makeRow(),
      fromDate: "2025-01-20",
      limit: 1,
    });
    expect(occ[0].occurrenceDate).toBe("2025-01-20");
    expect(occ[0].occurrenceIndex).toBe(2);
    expect(occ[0].anchorOccurrenceIndex).toBe(2);
  });

  it("computes visit and labour minutes (2 staff => double labour)", () => {
    const occ = generateServiceRowOccurrences({
      row: makeRow({ assignedEmployeeIds: ["a", "b"] }),
      fromDate: "2025-01-06",
      limit: 1,
    });
    expect(occ[0].visitMinutes).toBe(30);
    expect(occ[0].labourMinutes).toBe(60);
  });

  it("bounds results with a date-range search (toDate)", () => {
    const occ = generateServiceRowOccurrences({
      row: makeRow(),
      fromDate: "2025-01-06",
      toDate: "2025-01-20",
      limit: 50,
    });
    expect(occ.map((o) => o.occurrenceDate)).toEqual([
      "2025-01-06",
      "2025-01-13",
      "2025-01-20",
    ]);
  });

  it("applies an anchored variation to the resolved staffing/labour", () => {
    // Anchor at index 2, every 2nd booking, adds an open slot → 2 planned heads.
    const row = makeRow({
      variations: [
        makeVariation({
          anchorOccurrenceIndex: 2,
          interval: 2,
          unassignedSlotsDelta: 1,
        }),
      ],
    });
    const occ = generateServiceRowOccurrences({ row, fromDate: "2025-01-06", limit: 5 });
    const byIndex = new Map<number, ServiceRowOccurrence>(
      occ.map((o) => [o.occurrenceIndex, o]),
    );
    expect(byIndex.get(0)?.isVariation).toBe(false);
    expect(byIndex.get(2)?.isVariation).toBe(true);
    expect(byIndex.get(2)?.unassignedEmployeeSlots).toBe(1);
    // index 2: 1 assigned + 1 slot = 2 heads × 30 = 60 labour minutes
    expect(byIndex.get(2)?.labourMinutes).toBe(60);
    // index 4 also matches (2,4,6,…)
    expect(byIndex.get(4)?.isVariation).toBe(true);
    // index 1/3 are untouched defaults
    expect(byIndex.get(1)?.isVariation).toBe(false);
    expect(byIndex.get(3)?.isVariation).toBe(false);
  });

  it("H2: a duration-only variation expands the visit/labour window", () => {
    // Base row 08:00-10:00 (120 min, 1 staff). Variation at index 2 sets a new
    // duration of 180 with a start time but no explicit end time.
    const row = makeRow({
      plannedStartTime: "08:00",
      plannedEndTime: "10:00",
      assignedEmployeeIds: ["a"],
      variations: [
        makeVariation({
          anchorOccurrenceIndex: 2,
          interval: 2,
          startTime: "08:00",
          durationMinutes: 180,
        }),
      ],
    });
    const occ = generateServiceRowOccurrences({ row, fromDate: "2025-01-06", limit: 5 });
    const byIndex = new Map<number, ServiceRowOccurrence>(
      occ.map((o) => [o.occurrenceIndex, o]),
    );
    // Untouched base occurrence: 08:00-10:00 = 120 min visit/labour (1 staff).
    expect(byIndex.get(0)?.visitMinutes).toBe(120);
    expect(byIndex.get(0)?.labourMinutes).toBe(120);
    // Variation occurrence: derived end 11:00 → 180 min visit, 180 min labour.
    const varied = byIndex.get(2);
    expect(varied?.isVariation).toBe(true);
    expect(varied?.startTime).toBe("08:00");
    expect(varied?.endTime).toBe("11:00");
    expect(varied?.visitMinutes).toBe(180);
    expect(varied?.labourMinutes).toBe(180);
  });

  it("H2: an explicit endTime on the same variation wins over durationMinutes", () => {
    const row = makeRow({
      plannedStartTime: "08:00",
      plannedEndTime: "10:00",
      assignedEmployeeIds: ["a"],
      variations: [
        makeVariation({
          anchorOccurrenceIndex: 2,
          interval: 2,
          startTime: "08:00",
          durationMinutes: 180,
          endTime: "09:30", // explicit end wins → 90 min
        }),
      ],
    });
    const occ = generateServiceRowOccurrences({ row, fromDate: "2025-01-06", limit: 5 });
    const varied = occ.find((o) => o.occurrenceIndex === 2);
    expect(varied?.endTime).toBe("09:30");
    expect(varied?.visitMinutes).toBe(90);
    expect(varied?.labourMinutes).toBe(90);
  });

  it("respects a cancelled BookingOccurrenceException overlay", () => {
    const exceptions: BookingOccurrenceException[] = [
      {
        id: "ex-1",
        occurrenceKey: "row-1:2025-01-13",
        parentServiceRowId: "row-1",
        occurrenceDate: "2025-01-13",
        status: "cancelled",
        createdAt: "2025-01-02T00:00:00.000Z",
        updatedAt: "2025-01-02T00:00:00.000Z",
      },
    ];
    const occ = generateServiceRowOccurrences({
      row: makeRow(),
      fromDate: "2025-01-06",
      limit: 3,
      exceptions: indexOccurrenceExceptions(exceptions),
    });
    const cancelled = occ.find((o) => o.occurrenceDate === "2025-01-13");
    expect(cancelled?.status).toBe("cancelled");
    expect(occ.find((o) => o.occurrenceDate === "2025-01-06")?.status).toBe("active");
  });

  it("respects a rescheduled exception (display date/time shifts, identity stays)", () => {
    const exceptions: BookingOccurrenceException[] = [
      {
        id: "ex-2",
        occurrenceKey: "row-1:2025-01-13",
        parentServiceRowId: "row-1",
        occurrenceDate: "2025-01-13",
        status: "rescheduled",
        overrideOccurrenceDate: "2025-01-14",
        overrideStartTime: "10:00",
        overrideEndTime: "10:30",
        createdAt: "2025-01-02T00:00:00.000Z",
        updatedAt: "2025-01-02T00:00:00.000Z",
      },
    ];
    const occ = generateServiceRowOccurrences({
      row: makeRow(),
      fromDate: "2025-01-06",
      limit: 3,
      exceptions: indexOccurrenceExceptions(exceptions),
    });
    const moved = occ.find((o) => o.occurrenceKey === "row-1:2025-01-13");
    expect(moved?.status).toBe("rescheduled");
    expect(moved?.occurrenceDate).toBe("2025-01-13"); // identity preserved
    expect(moved?.displayDate).toBe("2025-01-14");
    expect(moved?.startTime).toBe("10:00");
  });

  it("reassigns a single occurrence via an assignment-override exception, leaving siblings on the series", () => {
    const exceptions: BookingOccurrenceException[] = [
      {
        id: "ex-assign",
        occurrenceKey: "row-1:2025-01-13",
        parentServiceRowId: "row-1",
        occurrenceDate: "2025-01-13",
        status: "active",
        overrideAssignedEmployeeIds: ["kari"],
        createdAt: "2025-01-02T00:00:00.000Z",
        updatedAt: "2025-01-02T00:00:00.000Z",
      },
    ];
    const occ = generateServiceRowOccurrences({
      row: makeRow({ assignedEmployeeIds: ["ingrid"] }),
      fromDate: "2025-01-06",
      limit: 3,
      exceptions: indexOccurrenceExceptions(exceptions),
    });
    const changed = occ.find((o) => o.occurrenceKey === "row-1:2025-01-13");
    expect(changed?.assignedEmployeeIds).toEqual(["kari"]);
    expect(changed?.status).toBe("active");
    // Every other occurrence still follows the series assignment (Ingrid).
    expect(occ.find((o) => o.occurrenceDate === "2025-01-06")?.assignedEmployeeIds).toEqual([
      "ingrid",
    ]);
    expect(occ.find((o) => o.occurrenceDate === "2025-01-20")?.assignedEmployeeIds).toEqual([
      "ingrid",
    ]);
  });

  it("keeps a reassigned occurrence's labour stable when only the crew identity changes", () => {
    const exceptions: BookingOccurrenceException[] = [
      {
        id: "ex-assign-2",
        occurrenceKey: "row-1:2025-01-13",
        parentServiceRowId: "row-1",
        occurrenceDate: "2025-01-13",
        status: "active",
        overrideAssignedEmployeeIds: ["kari"],
        createdAt: "2025-01-02T00:00:00.000Z",
        updatedAt: "2025-01-02T00:00:00.000Z",
      },
    ];
    const occ = generateServiceRowOccurrences({
      row: makeRow({ assignedEmployeeIds: ["ingrid"] }), // 30 min visit, 1 person
      fromDate: "2025-01-06",
      limit: 3,
      exceptions: indexOccurrenceExceptions(exceptions),
    });
    const changed = occ.find((o) => o.occurrenceKey === "row-1:2025-01-13");
    expect(changed?.visitMinutes).toBe(30);
    expect(changed?.labourMinutes).toBe(30); // unchanged: same window, same headcount
  });

  it("applies an open-slot override on a single occurrence", () => {
    const exceptions: BookingOccurrenceException[] = [
      {
        id: "ex-slot",
        occurrenceKey: "row-1:2025-01-13",
        parentServiceRowId: "row-1",
        occurrenceDate: "2025-01-13",
        status: "active",
        overrideAssignedEmployeeIds: ["kari"],
        overrideUnassignedEmployeeSlots: 2,
        createdAt: "2025-01-02T00:00:00.000Z",
        updatedAt: "2025-01-02T00:00:00.000Z",
      },
    ];
    const occ = generateServiceRowOccurrences({
      row: makeRow({ assignedEmployeeIds: ["ingrid"], unassignedEmployeeSlots: 0 }),
      fromDate: "2025-01-06",
      limit: 3,
      exceptions: indexOccurrenceExceptions(exceptions),
    });
    const changed = occ.find((o) => o.occurrenceKey === "row-1:2025-01-13");
    expect(changed?.assignedEmployeeIds).toEqual(["kari"]);
    expect(changed?.unassignedEmployeeSlots).toBe(2);
    expect(occ.find((o) => o.occurrenceDate === "2025-01-06")?.unassignedEmployeeSlots).toBe(0);
  });

  it("applies a reassignment AND a reschedule together on the same occurrence", () => {
    const exceptions: BookingOccurrenceException[] = [
      {
        id: "ex-both",
        occurrenceKey: "row-1:2025-01-13",
        parentServiceRowId: "row-1",
        occurrenceDate: "2025-01-13",
        status: "rescheduled",
        overrideOccurrenceDate: "2025-01-14",
        overrideAssignedEmployeeIds: ["kari"],
        createdAt: "2025-01-02T00:00:00.000Z",
        updatedAt: "2025-01-02T00:00:00.000Z",
      },
    ];
    const occ = generateServiceRowOccurrences({
      row: makeRow({ assignedEmployeeIds: ["ingrid"] }),
      fromDate: "2025-01-06",
      limit: 3,
      exceptions: indexOccurrenceExceptions(exceptions),
    });
    const changed = occ.find((o) => o.occurrenceKey === "row-1:2025-01-13");
    expect(changed?.status).toBe("rescheduled");
    expect(changed?.displayDate).toBe("2025-01-14");
    expect(changed?.assignedEmployeeIds).toEqual(["kari"]);
  });

  it("stops a weekly series after the service end date", () => {
    // Weekly from Mon 2025-01-06; end date falls on the 3rd occurrence (01-20).
    const occ = generateServiceRowOccurrences({
      row: makeRow({ serviceEndDate: "2025-01-20" }),
      fromDate: "2025-01-06",
      limit: 50,
    });
    expect(occ.map((o) => o.occurrenceDate)).toEqual([
      "2025-01-06",
      "2025-01-13",
      "2025-01-20",
    ]);
  });

  it("includes the end date itself but nothing after it", () => {
    // End date lands between occurrences (01-15): 01-13 is in, 01-20 is out.
    const occ = generateServiceRowOccurrences({
      row: makeRow({ serviceEndDate: "2025-01-15" }),
      fromDate: "2025-01-06",
      limit: 50,
    });
    expect(occ.map((o) => o.occurrenceDate)).toEqual(["2025-01-06", "2025-01-13"]);
  });

  it("excludes occurrences after the end date even when a date-range search asks for them", () => {
    // Range search runs to 2025-03-01 but the series ends 2025-01-20.
    const occ = generateServiceRowOccurrences({
      row: makeRow({ serviceEndDate: "2025-01-20" }),
      fromDate: "2025-01-06",
      toDate: "2025-03-01",
      limit: 50,
    });
    expect(occ.map((o) => o.occurrenceDate)).toEqual([
      "2025-01-06",
      "2025-01-13",
      "2025-01-20",
    ]);
  });

  it("does not let a variation create occurrences past the parent end date", () => {
    // Every-booking variation, but the parent series ends on the 2nd occurrence.
    const row = makeRow({
      serviceEndDate: "2025-01-13",
      variations: [
        makeVariation({ frequency: "every_n_visits", interval: 1, anchorOccurrenceIndex: 0 }),
      ],
    });
    const occ = generateServiceRowOccurrences({ row, fromDate: "2025-01-06", limit: 50 });
    expect(occ.map((o) => o.occurrenceDate)).toEqual(["2025-01-06", "2025-01-13"]);
    // The variation applied within the window, but produced no extra dates.
    expect(occ.every((o) => o.isVariation)).toBe(true);
  });

  it("returns a single occurrence for a one-time row", () => {
    const occ = generateServiceRowOccurrences({
      row: makeRow({ recurrenceInterval: "one_time" }),
      fromDate: "2025-01-06",
      limit: 5,
    });
    expect(occ).toHaveLength(1);
    expect(occ[0].occurrenceDate).toBe("2025-01-06");
    expect(occ[0].occurrenceIndex).toBe(0);
  });

  it("returns nothing when the row has no service date", () => {
    const occ = generateServiceRowOccurrences({
      row: makeRow({ serviceDate: "" }),
      fromDate: "2025-01-06",
    });
    expect(occ).toEqual([]);
  });
});

describe("daily recurring occurrence reschedule (Bug 2 regression)", () => {
  // Daily series starting on the series-start date 2026-06-01. The first
  // occurrence (June 1) must behave exactly like every later occurrence: a
  // per-occurrence reschedule moves ONLY that occurrence via an exception, never
  // the recurrence anchor or sibling occurrences.
  const dailyRow = () =>
    makeRow({
      recurrenceInterval: "daily",
      serviceDate: "2026-06-01",
      plannedStartTime: "09:00",
      plannedEndTime: "10:00",
    });

  it("anchors daily occurrences on the series start date", () => {
    const occ = generateServiceRowOccurrences({
      row: dailyRow(),
      fromDate: "2026-06-01",
      limit: 4,
    });
    expect(occ.map((o) => o.occurrenceDate)).toEqual([
      "2026-06-01",
      "2026-06-02",
      "2026-06-03",
      "2026-06-04",
    ]);
  });

  it("reschedules ONLY the series-start occurrence (June 1 -> June 2) without shifting the series", () => {
    const row = dailyRow();
    const exceptions: BookingOccurrenceException[] = [
      {
        id: "ex-jun1",
        occurrenceKey: "row-1:2026-06-01",
        parentServiceRowId: "row-1",
        occurrenceDate: "2026-06-01",
        status: "rescheduled",
        overrideOccurrenceDate: "2026-06-02",
        overrideStartTime: null,
        overrideEndTime: null,
        createdAt: "2026-05-30T00:00:00.000Z",
        updatedAt: "2026-05-30T00:00:00.000Z",
      },
    ];
    const occ = generateServiceRowOccurrences({
      row,
      fromDate: "2026-06-01",
      limit: 4,
      exceptions: indexOccurrenceExceptions(exceptions),
    });

    // The recurrence anchor (the booking's serviceDate) is never mutated.
    expect(row.serviceDate).toBe("2026-06-01");

    // An exception exists for the June 1 occurrence key and only moves its display.
    const jun1 = occ.find((o) => o.occurrenceKey === "row-1:2026-06-01");
    expect(jun1?.status).toBe("rescheduled");
    expect(jun1?.occurrenceDate).toBe("2026-06-01"); // identity/anchor preserved
    expect(jun1?.displayDate).toBe("2026-06-02"); // only this occurrence moved

    // June 2+ generated occurrences remain anchored to the original pattern.
    const jun2 = occ.find((o) => o.occurrenceKey === "row-1:2026-06-02");
    expect(jun2?.status).toBe("active");
    expect(jun2?.displayDate).toBe("2026-06-02");
    const jun3 = occ.find((o) => o.occurrenceKey === "row-1:2026-06-03");
    expect(jun3?.status).toBe("active");
    expect(jun3?.displayDate).toBe("2026-06-03");
  });

  it("exposes a stable occurrence identity for every non-cancelled occurrence (occurrence-level reschedule available)", () => {
    // The Booking Queue enables "Reschedule Occurrence" for any non-cancelled
    // row via its stable occurrenceKey. Every generated occurrence — including
    // the series-start one — must carry that identity.
    const occ = generateServiceRowOccurrences({
      row: dailyRow(),
      fromDate: "2026-06-01",
      limit: 5,
    });
    expect(occ).toHaveLength(5);
    for (const o of occ) {
      expect(o.status).not.toBe("cancelled");
      expect(o.occurrenceKey).toBe(`row-1:${o.occurrenceDate}`);
    }
  });
});

describe("variationHasPastOccurrence", () => {
  // Series starts Mon 2025-01-06, weekly. "Today" anchors what counts as past.
  it("is true when an every-booking variation already applied before today", () => {
    const v = makeVariation({ frequency: "every_n_visits", interval: 1, anchorOccurrenceIndex: 0 });
    // 2025-01-20 is the 3rd occurrence; indexes 0 and 1 are in the past.
    expect(variationHasPastOccurrence(makeRow(), v, "2025-01-20")).toBe(true);
  });

  it("is false when the variation's first match is today or later", () => {
    // Anchored at index 2 (2025-01-20); nothing before today (2025-01-20) matches.
    const v = makeVariation({ interval: 2, anchorOccurrenceIndex: 2 });
    expect(variationHasPastOccurrence(makeRow(), v, "2025-01-20")).toBe(false);
  });

  it("is false when the series itself starts today", () => {
    const v = makeVariation({ interval: 1, anchorOccurrenceIndex: 0 });
    expect(variationHasPastOccurrence(makeRow(), v, "2025-01-06")).toBe(false);
  });

  it("respects the variation's appliesFrom window", () => {
    // Even though occurrences exist before today, the variation only becomes
    // valid from 2025-01-20, so nothing applied in the past relative to today.
    const v = makeVariation({
      interval: 1,
      anchorOccurrenceIndex: 0,
      appliesFrom: "2025-01-20",
    });
    expect(variationHasPastOccurrence(makeRow(), v, "2025-01-14")).toBe(false);
  });

  it("is false for a one-time row whose only occurrence is in the future", () => {
    const row = makeRow({ recurrenceInterval: "one_time", serviceDate: "2025-02-01" });
    const v = makeVariation({ interval: 1, anchorOccurrenceIndex: 0 });
    expect(variationHasPastOccurrence(row, v, "2025-01-20")).toBe(false);
  });
});

describe("countServiceRowGeneratedOccurrences", () => {
  // A daily service mistakenly started 2026-01-01; "today" is 2026-06-01.
  const NOW = new Date(2026, 5, 1, 12, 0, 0); // local 2026-06-01

  it("splits generated occurrences into past and future around today", () => {
    const row = makeRow({
      serviceDate: "2026-01-01",
      recurrenceInterval: "daily",
      serviceEndDate: "2026-06-05",
    });
    const counts = countServiceRowGeneratedOccurrences(row, { now: NOW });
    // Jan 1 .. May 31 inclusive = 151 past days; Jun 1 .. Jun 5 inclusive = 5 future.
    expect(counts.past).toBe(151);
    expect(counts.future).toBe(5);
    expect(counts.total).toBe(156);
  });

  it("reports zero past for a future-starting service", () => {
    const row = makeRow({
      serviceDate: "2026-06-10",
      recurrenceInterval: "daily",
      serviceEndDate: "2026-06-12",
    });
    const counts = countServiceRowGeneratedOccurrences(row, { now: NOW });
    expect(counts.past).toBe(0);
    expect(counts.future).toBe(3);
  });

  it("excludes cancelled occurrences from the counts", () => {
    const row = makeRow({
      serviceDate: "2026-01-01",
      recurrenceInterval: "daily",
      serviceEndDate: "2026-01-03",
    });
    const exceptions = indexOccurrenceExceptions([
      {
        id: "e1",
        occurrenceKey: "row-1:2026-01-02",
        parentServiceRowId: "row-1",
        occurrenceDate: "2026-01-02",
        status: "cancelled",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    const counts = countServiceRowGeneratedOccurrences(row, { now: NOW, exceptions });
    // Jan 1, 2, 3 generated; Jan 2 cancelled → 2 past counted.
    expect(counts.past).toBe(2);
    expect(counts.future).toBe(0);
  });
});
