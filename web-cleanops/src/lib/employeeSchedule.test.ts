import { describe, expect, it } from "vitest";
import {
  WEEKDAYS,
  copyMondayToAll,
  dailyCapacityMinutes,
  defaultWorkingSchedule,
  getWorkingDay,
  isAvailableOnDate,
  isAvailableOnWeekday,
  normalizeWorkingSchedule,
  resolveEmployeeWorkingSchedule,
  weekdayOf,
  weeklyCapacityMinutes,
} from "./employeeSchedule";
import { groupByEmployee, resolveScheduleProgram, type ScheduleCoreInput } from "./scheduleCore";
import type {
  EmployeeWorkingScheduleDay,
  WorkOrder,
  WorkOrderServiceRow,
} from "@/types";

/**
 * Employee Working Schedule core tests. The schedule describes employee
 * availability/capacity only; it never generates customer bookings (those come
 * from the Schedule Core, asserted at the bottom). All helpers are pure.
 */

describe("default weekday schedule", () => {
  it("is Mon–Fri available, weekends unavailable, ordered Mon→Sun", () => {
    const schedule = defaultWorkingSchedule();
    expect(schedule.map((d) => d.weekday)).toEqual(WEEKDAYS);
    expect(schedule.filter((d) => d.isAvailable).map((d) => d.weekday)).toEqual([
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
    ]);
    const monday = getWorkingDay(schedule, "monday");
    expect(monday.startTime).toBe("08:00");
    expect(monday.endTime).toBe("16:00");
    expect(monday.breakMinutes).toBe(30);
  });
});

describe("availability", () => {
  const schedule = defaultWorkingSchedule();

  it("employee available on an active working day", () => {
    expect(isAvailableOnWeekday(schedule, "wednesday")).toBe(true);
    // 2026-06-03 is a Wednesday.
    expect(isAvailableOnDate(schedule, "2026-06-03")).toBe(true);
  });

  it("employee unavailable on an inactive day", () => {
    expect(isAvailableOnWeekday(schedule, "sunday")).toBe(false);
    // 2026-06-07 is a Sunday.
    expect(isAvailableOnDate(schedule, "2026-06-07")).toBe(false);
  });

  it("resolves the weekday of a date without timezone drift", () => {
    expect(weekdayOf("2026-06-01")).toBe("monday");
    expect(weekdayOf("not-a-date")).toBeNull();
  });
});

describe("copy Monday to all weekdays", () => {
  it("applies Monday's settings to every other day", () => {
    const base = normalizeWorkingSchedule([
      { weekday: "monday", isAvailable: true, startTime: "07:00", endTime: "15:00", breakMinutes: 45 },
    ]);
    const copied = copyMondayToAll(base);
    expect(copied).toHaveLength(7);
    for (const day of copied) {
      expect(day.isAvailable).toBe(true);
      expect(day.startTime).toBe("07:00");
      expect(day.endTime).toBe("15:00");
      expect(day.breakMinutes).toBe(45);
    }
    // weekday keys preserved
    expect(copied.map((d) => d.weekday)).toEqual(WEEKDAYS);
  });

  it("propagates an unavailable Monday to all days", () => {
    const base = normalizeWorkingSchedule([
      { weekday: "monday", isAvailable: false, startTime: "08:00", endTime: "16:00" },
    ]);
    const copied = copyMondayToAll(base);
    expect(copied.every((d) => d.isAvailable === false)).toBe(true);
  });
});

describe("daily capacity calculation", () => {
  it("derives capacity from the working window minus break", () => {
    const day: EmployeeWorkingScheduleDay = {
      weekday: "monday",
      isAvailable: true,
      startTime: "08:00",
      endTime: "16:00",
      breakMinutes: 30,
    };
    // 8h window − 30min break = 450 minutes
    expect(dailyCapacityMinutes(day)).toBe(450);
  });

  it("uses an explicit capacityHours override when present", () => {
    const day: EmployeeWorkingScheduleDay = {
      weekday: "monday",
      isAvailable: true,
      startTime: "08:00",
      endTime: "16:00",
      breakMinutes: 30,
      capacityHours: 6,
    };
    expect(dailyCapacityMinutes(day)).toBe(360);
  });

  it("is zero on an unavailable day", () => {
    const day: EmployeeWorkingScheduleDay = {
      weekday: "sunday",
      isAvailable: false,
      startTime: "08:00",
      endTime: "16:00",
    };
    expect(dailyCapacityMinutes(day)).toBe(0);
  });

  it("sums weekly capacity across the default schedule", () => {
    // 5 working days × 450 minutes = 2250
    expect(weeklyCapacityMinutes(defaultWorkingSchedule())).toBe(2250);
  });
});

describe("missing schedule fallback", () => {
  it("falls back to the default when the employee has no schedule", () => {
    const resolved = resolveEmployeeWorkingSchedule({ workingSchedule: undefined });
    expect(resolved).toEqual(defaultWorkingSchedule());
  });

  it("fills missing weekdays and repairs invalid windows", () => {
    const resolved = normalizeWorkingSchedule([
      // only Tuesday provided, with an invalid (reversed) window
      { weekday: "tuesday", isAvailable: true, startTime: "18:00", endTime: "09:00" },
    ]);
    expect(resolved).toHaveLength(7);
    const tuesday = getWorkingDay(resolved, "tuesday");
    // invalid window repaired to the default window
    expect(tuesday.startTime).toBe("08:00");
    expect(tuesday.endTime).toBe("16:00");
    // a missing day keeps its default availability
    expect(getWorkingDay(resolved, "monday").isAvailable).toBe(true);
    expect(getWorkingDay(resolved, "saturday").isAvailable).toBe(false);
  });
});

// ── Schedule Core remains the source of booking occurrences ──────────────────

function makeRow(overrides: Partial<WorkOrderServiceRow> = {}): WorkOrderServiceRow {
  return {
    id: "row-1",
    serviceName: "Window Cleaning",
    quantity: 1,
    status: "planned",
    serviceDate: "2026-06-01", // Monday
    recurrenceInterval: "one_time",
    plannedStartTime: "08:00",
    plannedEndTime: "10:00",
    assignedEmployeeIds: ["emp-1", "emp-2"],
    unassignedEmployeeSlots: 0,
    sortOrder: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function baseInput(overrides: Partial<ScheduleCoreInput> = {}): ScheduleCoreInput {
  const wo: WorkOrder = {
    id: "wo-1",
    companyId: "co-1",
    customerId: "cust-1",
    number: "WO-1001",
    status: "planned",
    serviceRows: [makeRow()],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  return {
    workOrders: [wo],
    customers: [{ id: "cust-1", name: "Bergen Office Park" }],
    employees: [
      { id: "emp-1", name: "Ingrid Sand" },
      { id: "emp-2", name: "Lars Holm" },
    ],
    exceptions: [],
    fromDate: "2026-06-01",
    toDate: "2026-06-01",
    ...overrides,
  };
}

describe("assigned visits still come from Schedule Core", () => {
  it("the working schedule never produces occurrences; bookings come from the core", () => {
    const entries = resolveScheduleProgram(baseInput());
    expect(entries).toHaveLength(1);
    expect(entries[0].assignedEmployeeIds).toEqual(["emp-1", "emp-2"]);
  });

  it("a multi-employee occurrence appears under each assignee but counts once globally", () => {
    const entries = resolveScheduleProgram(baseInput());
    // One distinct occurrence in the global total.
    expect(entries).toHaveLength(1);

    const buckets = groupByEmployee(entries, (e) => e.assignedEmployeeNames);
    const named = buckets.filter((b) => !b.isUnassigned);
    expect(named.map((b) => b.name).sort()).toEqual(["Ingrid Sand", "Lars Holm"]);
    // Appears under each assignee (2 grouped rows) …
    expect(named.reduce((sum, b) => sum + b.rows.length, 0)).toBe(2);
    // … but is still exactly one distinct occurrence key.
    const distinctKeys = new Set(entries.map((e) => e.occurrenceKey));
    expect(distinctKeys.size).toBe(1);
  });
});
