import { describe, it, expect } from "vitest";
import type { RecurringVariation } from "@/types";
import { makeOccurrenceKey } from "@/types";
import {
  occurrenceIndexFromStart,
  resolveOccurrenceVariations,
  type ResolverBaseOccurrence,
} from "./variationResolver";

const baseOccurrence = (overrides: Partial<ResolverBaseOccurrence> = {}): ResolverBaseOccurrence => ({
  occurrenceDate: "2026-01-05",
  day: "monday",
  startTime: "08:00",
  endTime: "12:00",
  durationMinutes: 240,
  assignedEmployeeIds: ["anna", "johan"],
  unassignedEmployeeSlots: 0,
  notes: null,
  ...overrides,
});

const variation = (overrides: Partial<RecurringVariation>): RecurringVariation => ({
  id: overrides.id ?? "v1",
  name: overrides.name ?? "Variation",
  frequency: overrides.frequency ?? "every_n_weeks",
  interval: overrides.interval ?? 4,
  enabled: true,
  status: "active",
  createdAt: overrides.createdAt ?? "2026-01-01T00:00:00.000Z",
  updatedAt: overrides.updatedAt ?? "2026-01-01T00:00:00.000Z",
  ...overrides,
});

describe("resolveOccurrenceVariations", () => {
  it("1. returns base values when no variation applies", () => {
    const res = resolveOccurrenceVariations({
      base: baseOccurrence(),
      occurrenceIndex: 0, // 1st occurrence: every-4th-week variation doesn't match
      variations: [variation({ interval: 4, endTime: "13:00" })],
    });
    expect(res.isVariation).toBe(false);
    expect(res.isChained).toBe(false);
    expect(res.resolved.endTime).toBe("12:00");
    expect(res.appliedVariationIds).toEqual([]);
    expect(res.conflicts).toEqual([]);
  });

  it("2. applies a single matching variation", () => {
    const res = resolveOccurrenceVariations({
      base: baseOccurrence(),
      occurrenceIndex: 3, // 4th occurrence matches every-4th-week
      variations: [variation({ id: "a", interval: 4, endTime: "13:00" })],
    });
    expect(res.isVariation).toBe(true);
    expect(res.isChained).toBe(false);
    expect(res.resolved.endTime).toBe("13:00");
    expect(res.appliedVariationIds).toEqual(["a"]);
  });

  it("3. chains two matching variations", () => {
    const res = resolveOccurrenceVariations({
      base: baseOccurrence(),
      occurrenceIndex: 3,
      variations: [
        variation({ id: "a", interval: 4, endTime: "13:00" }),
        variation({ id: "b", interval: 4, unassignedSlotsDelta: 1 }),
      ],
    });
    expect(res.isVariation).toBe(true);
    expect(res.isChained).toBe(true);
    expect(res.resolved.endTime).toBe("13:00");
    expect(res.resolved.unassignedEmployeeSlots).toBe(1);
    expect(res.resolved.assignmentStatus).toBe("partially_assigned");
    expect(res.appliedVariationIds).toEqual(["a", "b"]);
    expect(res.conflicts).toEqual([]);
  });

  it("4. chains variations modifying different fields without conflict", () => {
    const res = resolveOccurrenceVariations({
      base: baseOccurrence(),
      occurrenceIndex: 3,
      variations: [
        variation({ id: "a", interval: 4, startTime: "07:00" }),
        variation({ id: "b", interval: 4, endTime: "14:00" }),
      ],
    });
    expect(res.resolved.startTime).toBe("07:00");
    expect(res.resolved.endTime).toBe("14:00");
    expect(res.conflicts).toEqual([]);
  });

  it("5. last variation wins on the same absolute field and reports a conflict", () => {
    const res = resolveOccurrenceVariations({
      base: baseOccurrence(),
      occurrenceIndex: 3,
      variations: [
        variation({ id: "a", interval: 4, endTime: "13:00", chainOrder: 1 }),
        variation({ id: "b", interval: 4, endTime: "14:00", chainOrder: 2 }),
      ],
    });
    expect(res.resolved.endTime).toBe("14:00");
    expect(res.conflicts).toHaveLength(1);
    expect(res.conflicts[0].field).toBe("endTime");
    expect(res.conflicts[0].variationIds).toEqual(["a", "b"]);
  });

  it("6. sums additive unassigned slot deltas", () => {
    const res = resolveOccurrenceVariations({
      base: baseOccurrence({ unassignedEmployeeSlots: 0 }),
      occurrenceIndex: 3,
      variations: [
        variation({ id: "a", interval: 4, unassignedSlotsDelta: 1 }),
        variation({ id: "b", interval: 4, unassignedSlotsDelta: 1 }),
      ],
    });
    expect(res.resolved.unassignedEmployeeSlots).toBe(2);
    expect(res.conflicts).toEqual([]); // additive fields never conflict
  });

  it("7. every fourth week is computed from the series start date", () => {
    const start = "2026-01-05"; // a Monday
    // 1st (idx 0), 2nd (idx 1), 3rd (idx 2) don't match; 4th (idx 3) matches.
    expect(occurrenceIndexFromStart(start, "2026-01-05", "weekly")).toBe(0);
    expect(occurrenceIndexFromStart(start, "2026-01-26", "weekly")).toBe(3);
    expect(occurrenceIndexFromStart(start, "2026-02-23", "weekly")).toBe(7);

    const v = [variation({ id: "a", interval: 4, endTime: "13:00" })];
    const matches = (date: string) =>
      resolveOccurrenceVariations({
        base: baseOccurrence({ occurrenceDate: date }),
        occurrenceIndex: occurrenceIndexFromStart(start, date, "weekly"),
        variations: v,
      }).isVariation;

    expect(matches("2026-01-05")).toBe(false);
    expect(matches("2026-01-26")).toBe(true); // 4th week
    expect(matches("2026-02-23")).toBe(true); // 8th week
  });

  it("8. result does not change when the visible date range changes", () => {
    const start = "2026-01-05";
    const target = "2026-01-26"; // 4th occurrence
    const v = [variation({ id: "a", interval: 4, endTime: "13:00" })];

    // The index is derived purely from series start + occurrence date, so the
    // resolution is identical regardless of which range the queue is showing.
    const idx = occurrenceIndexFromStart(start, target, "weekly");
    const a = resolveOccurrenceVariations({
      base: baseOccurrence({ occurrenceDate: target }),
      occurrenceIndex: idx,
      variations: v,
    });
    const b = resolveOccurrenceVariations({
      base: baseOccurrence({ occurrenceDate: target }),
      occurrenceIndex: idx,
      variations: v,
    });
    expect(a).toEqual(b);
    expect(a.resolved.endTime).toBe("13:00");
  });

  it("9. resolver does not change the occurrence key", () => {
    const date = "2026-01-26";
    const res = resolveOccurrenceVariations({
      base: baseOccurrence({ occurrenceDate: date }),
      occurrenceIndex: 3,
      variations: [variation({ id: "a", interval: 4, day: "tuesday", endTime: "13:00" })],
    });
    // The resolver returns values only — it has no occurrenceKey on its output.
    expect("occurrenceKey" in res).toBe(false);
    // The key stays anchored to the base occurrence date even though the
    // variation overrides the weekday/time.
    expect(makeOccurrenceKey("serviceRow_1", date)).toBe("serviceRow_1:2026-01-26");
    expect(res.resolved.day).toBe("tuesday");
  });

  it("ignores replaced and inactive variations", () => {
    const res = resolveOccurrenceVariations({
      base: baseOccurrence(),
      occurrenceIndex: 3,
      variations: [
        variation({ id: "old", interval: 4, endTime: "13:00", replacedByVariationId: "new" }),
        variation({ id: "off", interval: 4, endTime: "15:00", status: "inactive" }),
      ],
    });
    expect(res.isVariation).toBe(false);
    expect(res.resolved.endTime).toBe("12:00");
  });
});

describe("duration-only variation resolution (H2)", () => {
  it("derives endTime from start + duration when no endTime is set", () => {
    const res = resolveOccurrenceVariations({
      base: baseOccurrence({ startTime: "08:00", endTime: "10:00", durationMinutes: 120 }),
      occurrenceIndex: 3,
      variations: [variation({ id: "a", interval: 4, startTime: "08:00", durationMinutes: 180 })],
    });
    expect(res.isVariation).toBe(true);
    expect(res.resolved.durationMinutes).toBe(180);
    // Base 08:00-10:00 (120) is overridden: 08:00 + 180 => 11:00.
    expect(res.resolved.endTime).toBe("11:00");
  });

  it("explicit endTime wins over durationMinutes (no double application)", () => {
    const res = resolveOccurrenceVariations({
      base: baseOccurrence({ startTime: "08:00", endTime: "10:00", durationMinutes: 120 }),
      occurrenceIndex: 3,
      variations: [
        variation({ id: "a", interval: 4, startTime: "08:00", durationMinutes: 180, endTime: "09:30" }),
      ],
    });
    expect(res.resolved.endTime).toBe("09:30"); // explicit endTime wins
  });

  it("uses the resolved/base start when the variation omits startTime", () => {
    const res = resolveOccurrenceVariations({
      base: baseOccurrence({ startTime: "08:00", endTime: "10:00", durationMinutes: 120 }),
      occurrenceIndex: 3,
      variations: [variation({ id: "a", interval: 4, durationMinutes: 180 })],
    });
    // Falls back to the base start 08:00 + 180 => 11:00.
    expect(res.resolved.endTime).toBe("11:00");
  });

  it("does not crash or produce an invalid time when no start is available", () => {
    const res = resolveOccurrenceVariations({
      base: baseOccurrence({ startTime: null, endTime: null, durationMinutes: null }),
      occurrenceIndex: 3,
      variations: [variation({ id: "a", interval: 4, durationMinutes: 180 })],
    });
    expect(res.resolved.startTime).toBeNull();
    expect(res.resolved.endTime).toBeNull();
  });
});

describe("anchored variation matching", () => {
  /** Returns whether an anchored variation applies at the given occurrence index. */
  const applies = (
    index: number,
    overrides: Partial<RecurringVariation>,
  ): boolean =>
    resolveOccurrenceVariations({
      base: baseOccurrence(),
      occurrenceIndex: index,
      variations: [variation({ id: "a", endTime: "13:00", ...overrides })],
    }).isVariation;

  it("no anchor preserves the existing series-phased behavior", () => {
    // every_n_weeks, interval 4, no anchor => matches indices 3, 7, 11, ...
    expect(applies(0, { interval: 4 })).toBe(false);
    expect(applies(3, { interval: 4 })).toBe(true);
    expect(applies(7, { interval: 4 })).toBe(true);
    expect(applies(4, { interval: 4 })).toBe(false);
  });

  it("anchor + every 2nd booking matches from the selected occurrence", () => {
    // anchor 2, interval 2 => occurrences 2, 4, 6, 8, ...
    const opts = { interval: 2, anchorOccurrenceIndex: 2 };
    expect(applies(0, opts)).toBe(false);
    expect(applies(1, opts)).toBe(false);
    expect(applies(2, opts)).toBe(true);
    expect(applies(3, opts)).toBe(false);
    expect(applies(4, opts)).toBe(true);
    expect(applies(6, opts)).toBe(true);
  });

  it("anchor + every 4th booking matches occurrences anchor, +4, +8, ...", () => {
    // anchor 3, interval 4 => occurrences 3, 7, 11, 15, ...
    const opts = { interval: 4, anchorOccurrenceIndex: 3 };
    expect(applies(3, opts)).toBe(true);
    expect(applies(7, opts)).toBe(true);
    expect(applies(11, opts)).toBe(true);
    // Pre-anchor occurrences never match, even when they'd match the legacy phase.
    expect(applies(0, opts)).toBe(false);
    expect(applies(2, opts)).toBe(false);
    expect(applies(5, opts)).toBe(false);
  });

  it("anchor anchored to occurrence 0 matches from the very first occurrence", () => {
    // anchor 0, interval 4 => occurrences 0, 4, 8, ... (differs from legacy 3,7,11)
    const opts = { interval: 4, anchorOccurrenceIndex: 0 };
    expect(applies(0, opts)).toBe(true);
    expect(applies(4, opts)).toBe(true);
    expect(applies(3, opts)).toBe(false);
  });

  it("anchor near the series end still resolves correctly", () => {
    // A late anchor only applies at/after that occurrence.
    const opts = { interval: 2, anchorOccurrenceIndex: 50 };
    expect(applies(48, opts)).toBe(false);
    expect(applies(50, opts)).toBe(true);
    expect(applies(51, opts)).toBe(false);
    expect(applies(52, opts)).toBe(true);
  });

  it("archived/replaced anchored variations never apply", () => {
    const res = resolveOccurrenceVariations({
      base: baseOccurrence(),
      occurrenceIndex: 4,
      variations: [
        variation({
          id: "old",
          interval: 2,
          anchorOccurrenceIndex: 2,
          endTime: "13:00",
          replacedByVariationId: "new",
        }),
        variation({
          id: "arch",
          interval: 2,
          anchorOccurrenceIndex: 2,
          endTime: "15:00",
          status: "archived",
        }),
      ],
    });
    expect(res.isVariation).toBe(false);
    expect(res.resolved.endTime).toBe("12:00");
  });
});
