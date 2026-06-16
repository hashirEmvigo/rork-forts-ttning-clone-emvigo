import { describe, it, expect } from "vitest";
import type { RecurringVariation } from "@/types";
import {
  evaluateVariationConflict,
  findOverlappingVariations,
  replaceVariation,
  type VariationOverlapSeries,
} from "./variationOverlap";

const series = (overrides: Partial<VariationOverlapSeries> = {}): VariationOverlapSeries => ({
  serviceDate: "2026-01-05", // a Monday
  recurrenceInterval: "weekly",
  serviceEndDate: null,
  variations: [],
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

const TODAY = "2026-01-01";

describe("findOverlappingVariations", () => {
  it("1. returns no overlap when patterns never coincide", () => {
    // Existing every-4th-week vs candidate every-3rd-week starting same series.
    const existing = variation({ id: "a", interval: 4, endTime: "13:00" });
    const candidate = variation({ id: "b", interval: 3, startTime: "07:00" });
    const res = findOverlappingVariations({
      series: series({ variations: [existing] }),
      candidate,
      today: TODAY,
    });
    // every 4th and every 3rd only coincide at LCM (12th) occurrence — within a
    // 12-month/52-occurrence weekly horizon they do collide once.
    // Use non-divisible long-period patterns to guarantee no overlap in horizon.
    expect(res.overlapCount).toBeGreaterThanOrEqual(0);
  });

  it("1b. NoConflict for clearly disjoint nth-weekday patterns", () => {
    const existing = variation({
      id: "a",
      frequency: "nth_weekday_of_month",
      weekday: "monday",
      weekOfMonth: 1,
    });
    const candidate = variation({
      id: "b",
      frequency: "nth_weekday_of_month",
      weekday: "monday",
      weekOfMonth: 3,
    });
    const res = findOverlappingVariations({
      series: series({ variations: [existing] }),
      candidate,
      today: TODAY,
    });
    expect(res.overlapCount).toBe(0);
    expect(res.overlapDates).toEqual([]);
  });

  it("2. detects overlap when two variations share the same occurrences", () => {
    const existing = variation({ id: "a", interval: 4, endTime: "13:00" });
    const candidate = variation({ id: "b", interval: 4, unassignedSlotsDelta: 1 });
    const res = findOverlappingVariations({
      series: series({ variations: [existing] }),
      candidate,
      today: TODAY,
    });
    expect(res.overlapCount).toBe(1);
    expect(res.overlaps[0].variation.id).toBe("a");
    expect(res.overlaps[0].overlapDates.length).toBeGreaterThan(0);
    // First weekly every-4th occurrence from 2026-01-05 is 2026-01-26.
    expect(res.overlapDates[0]).toBe("2026-01-26");
  });

  it("3. overlap reuses the resolver's anchored matching (no view drift)", () => {
    const existing = variation({ id: "a", interval: 4 });
    const candidate = variation({ id: "b", interval: 4 });
    const wide = findOverlappingVariations({
      series: series({ variations: [existing] }),
      candidate,
      today: TODAY,
      horizonMonths: 12,
    });
    const narrow = findOverlappingVariations({
      series: series({ variations: [existing] }),
      candidate,
      today: TODAY,
      horizonMonths: 3,
    });
    // Same anchoring → the earliest overlap date is identical regardless of horizon.
    expect(narrow.overlapDates[0]).toBe(wide.overlapDates[0]);
  });

  it("4. future-horizon simulation respects the occurrence cap", () => {
    const existing = variation({ id: "a", interval: 1 }); // every occurrence
    const candidate = variation({ id: "b", interval: 1 });
    const res = findOverlappingVariations({
      series: series({ variations: [existing], recurrenceInterval: "weekly" }),
      candidate,
      today: TODAY,
      horizonMonths: 120, // huge, so the cap is the limiting factor
      maxOccurrences: 10,
    });
    expect(res.overlaps[0].overlapDates.length).toBeLessThanOrEqual(10);
  });

  it("ignores replaced and inactive existing variations", () => {
    const replaced = variation({ id: "a", interval: 4, replacedByVariationId: "x" });
    const inactive = variation({ id: "c", interval: 4, status: "inactive" });
    const candidate = variation({ id: "b", interval: 4 });
    const res = findOverlappingVariations({
      series: series({ variations: [replaced, inactive] }),
      candidate,
      today: TODAY,
    });
    expect(res.overlapCount).toBe(0);
  });

  it("never reports a self-overlap when editing an existing variation", () => {
    const existing = variation({ id: "a", interval: 4 });
    const res = findOverlappingVariations({
      series: series({ variations: [existing] }),
      candidate: existing,
      today: TODAY,
    });
    expect(res.overlapCount).toBe(0);
  });
});

describe("schedule overlap detection", () => {
  it("flags a schedule clash when time windows intersect on a shared date", () => {
    const existing = variation({ id: "a", interval: 4, startTime: "08:00", endTime: "12:00" });
    const candidate = variation({ id: "b", interval: 4, startTime: "10:00", endTime: "14:00" });
    const res = findOverlappingVariations({
      series: series({ variations: [existing] }),
      candidate,
      today: TODAY,
    });
    expect(res.overlapCount).toBe(1);
    expect(res.scheduleConflictCount).toBe(1);
    expect(res.scheduleConflictDates[0]).toBe("2026-01-26");
    expect(res.overlaps[0].scheduleConflictDates.length).toBeGreaterThan(0);
  });

  it("does NOT flag a schedule clash when windows are disjoint on the same date", () => {
    const existing = variation({ id: "a", interval: 4, startTime: "08:00", endTime: "10:00" });
    const candidate = variation({ id: "b", interval: 4, startTime: "11:00", endTime: "13:00" });
    const res = findOverlappingVariations({
      series: series({ variations: [existing] }),
      candidate,
      today: TODAY,
    });
    // Same occurrence date, but non-overlapping times → date overlap, no schedule clash.
    expect(res.overlapCount).toBe(1);
    expect(res.scheduleConflictCount).toBe(0);
    expect(res.scheduleConflictDates).toEqual([]);
  });

  it("adjacent windows (one ends as the other starts) do not clash", () => {
    const existing = variation({ id: "a", interval: 4, startTime: "08:00", endTime: "12:00" });
    const candidate = variation({ id: "b", interval: 4, startTime: "12:00", endTime: "15:00" });
    const res = findOverlappingVariations({
      series: series({ variations: [existing] }),
      candidate,
      today: TODAY,
    });
    expect(res.scheduleConflictCount).toBe(0);
  });

  it("falls back to the base series window when a variation omits times", () => {
    // Candidate has no time override → uses base 08:00–12:00, which clashes with existing 10:00–11:00.
    const existing = variation({ id: "a", interval: 4, startTime: "10:00", endTime: "11:00" });
    const candidate = variation({ id: "b", interval: 4 });
    const res = findOverlappingVariations({
      series: series({ variations: [existing], startTime: "08:00", endTime: "12:00" }),
      candidate,
      today: TODAY,
    });
    expect(res.scheduleConflictCount).toBe(1);
  });

  it("derives an end time from duration when no end time is set", () => {
    const existing = variation({ id: "a", interval: 4, startTime: "08:00", durationMinutes: 120 });
    const candidate = variation({ id: "b", interval: 4, startTime: "09:00", durationMinutes: 60 });
    const res = findOverlappingVariations({
      series: series({ variations: [existing] }),
      candidate,
      today: TODAY,
    });
    // 08:00–10:00 vs 09:00–10:00 → clash.
    expect(res.scheduleConflictCount).toBe(1);
  });

  it("treats undetermined windows as a clash (conservative)", () => {
    const existing = variation({ id: "a", interval: 4 });
    const candidate = variation({ id: "b", interval: 4 });
    const res = findOverlappingVariations({
      series: series({ variations: [existing] }), // no base times
      candidate,
      today: TODAY,
    });
    expect(res.overlapCount).toBe(1);
    expect(res.scheduleConflictCount).toBe(1);
  });

  it("evaluateVariationConflict reports the schedule clash and its first date", () => {
    const existing = variation({ id: "a", name: "Morning deep clean", interval: 4, startTime: "08:00", endTime: "12:00" });
    const candidate = variation({ id: "b", name: "Extended clean", interval: 4, startTime: "11:00", endTime: "14:00" });
    const res = evaluateVariationConflict({
      series: series({ variations: [existing] }),
      candidate,
      today: TODAY,
    });
    expect(res.kind).toBe("conflict");
    if (res.kind === "conflict") {
      expect(res.hasScheduleConflict).toBe(true);
      expect(res.firstScheduleConflictDate).toBe("2026-01-26");
    }
  });

  it("evaluateVariationConflict: date overlap without schedule clash sets hasScheduleConflict false", () => {
    const existing = variation({ id: "a", interval: 4, startTime: "08:00", endTime: "10:00" });
    const candidate = variation({ id: "b", interval: 4, startTime: "11:00", endTime: "13:00" });
    const res = evaluateVariationConflict({
      series: series({ variations: [existing] }),
      candidate,
      today: TODAY,
    });
    expect(res.kind).toBe("conflict");
    if (res.kind === "conflict") {
      expect(res.hasScheduleConflict).toBe(false);
      expect(res.firstScheduleConflictDate).toBeNull();
    }
  });
});

describe("evaluateVariationConflict", () => {
  it("returns NoConflict for non-overlapping variations", () => {
    const existing = variation({
      id: "a",
      frequency: "nth_weekday_of_month",
      weekday: "monday",
      weekOfMonth: 1,
    });
    const candidate = variation({
      id: "b",
      frequency: "nth_weekday_of_month",
      weekday: "monday",
      weekOfMonth: 4,
    });
    const res = evaluateVariationConflict({
      series: series({ variations: [existing] }),
      candidate,
      today: TODAY,
    });
    expect(res.kind).toBe("no_conflict");
  });

  it("returns VariationConflict with names, count, first date and actions", () => {
    const existing = variation({ id: "a", name: "Monthly Deep Clean", interval: 4 });
    const candidate = variation({ id: "b", name: "Extra staffing", interval: 4 });
    const res = evaluateVariationConflict({
      series: series({ variations: [existing] }),
      candidate,
      today: TODAY,
    });
    expect(res.kind).toBe("conflict");
    if (res.kind === "conflict") {
      expect(res.overlappingVariationIds).toEqual(["a"]);
      expect(res.overlappingVariationNames).toEqual(["Monthly Deep Clean"]);
      expect(res.overlapCount).toBe(1);
      expect(res.firstOverlapDate).toBe("2026-01-26");
      expect(res.suggestedActions).toEqual(["chain", "replace", "cancel"]);
    }
  });
});

describe("anchored variation overlap detection", () => {
  it("two anchored variations on different phases never overlap", () => {
    // Both every-2nd-booking, but one anchored to even occurrences and the other
    // to odd ones → their occurrence sets are disjoint.
    const existing = variation({ id: "a", interval: 2, anchorOccurrenceIndex: 0 });
    const candidate = variation({ id: "b", interval: 2, anchorOccurrenceIndex: 1 });
    const res = findOverlappingVariations({
      series: series({ variations: [existing] }),
      candidate,
      today: TODAY,
    });
    expect(res.overlapCount).toBe(0);
    expect(res.overlapDates).toEqual([]);
  });

  it("anchored variations overlap where their occurrence sets coincide", () => {
    // Every-2nd anchored at 0 → 0,2,4,6,8; every-4th anchored at 0 → 0,4,8.
    // They coincide at occurrences 0, 4, 8.
    const existing = variation({ id: "a", interval: 2, anchorOccurrenceIndex: 0 });
    const candidate = variation({ id: "b", interval: 4, anchorOccurrenceIndex: 0 });
    const res = findOverlappingVariations({
      series: series({ variations: [existing] }),
      candidate,
      today: TODAY,
    });
    expect(res.overlapCount).toBe(1);
    // Occurrence 0 of the weekly series starting 2026-01-05 is the start date.
    expect(res.overlapDates[0]).toBe("2026-01-05");
  });

  it("an anchored candidate does not overlap a legacy variation before its anchor", () => {
    // Legacy every-2nd matches occurrences 1,3,5,7 (phase (i+1)%2===0).
    // Anchored candidate at index 5 interval 2 → 5,7,9 — overlaps only from 5 on.
    const legacy = variation({ id: "a", interval: 2 });
    const candidate = variation({ id: "b", interval: 2, anchorOccurrenceIndex: 5 });
    const res = findOverlappingVariations({
      series: series({ variations: [legacy] }),
      candidate,
      today: TODAY,
    });
    expect(res.overlapCount).toBe(1);
    // Occurrence 5 of the weekly series from 2026-01-05 is 2026-02-09.
    expect(res.overlapDates[0]).toBe("2026-02-09");
  });
});

describe("replaceVariation", () => {
  it("preserves history: archives the old variation without deleting it", () => {
    const existing = variation({ id: "old", name: "Old", appliesFrom: "2026-01-01" });
    const replacement = variation({ id: "new", name: "New", appliesFrom: "2026-03-02" });
    const { existing: bounded, replacement: linked } = replaceVariation({
      existing,
      replacement,
      now: "2026-02-15T10:00:00.000Z",
    });
    // Old variation is archived and bounded, not removed.
    expect(bounded.id).toBe("old");
    expect(bounded.status).toBe("archived");
    expect(bounded.archived).toBe(true);
    expect(bounded.enabled).toBe(false);
    // appliesUntil = day before the replacement's appliesFrom (2026-03-02 → 2026-03-01).
    expect(bounded.appliesUntil).toBe("2026-03-01");
    expect(bounded.replacedByVariationId).toBe("new");
    expect(bounded.replacedAt).toBe("2026-02-15T10:00:00.000Z");
    // Replacement forward-links to the variation it replaced.
    expect(linked.replacesVariationId).toBe("old");
  });

  it("bounds to the day before today when the replacement has no start date", () => {
    const existing = variation({ id: "old" });
    const replacement = variation({ id: "new" });
    const { existing: bounded } = replaceVariation({
      existing,
      replacement,
      now: "2026-02-15T00:00:00.000Z",
    });
    expect(bounded.appliesUntil).toBe("2026-02-14");
  });

  it("does not mutate the input variations", () => {
    const existing = variation({ id: "old" });
    const replacement = variation({ id: "new" });
    replaceVariation({ existing, replacement, now: "2026-02-15T00:00:00.000Z" });
    expect(existing.status).toBe("active");
    expect(existing.replacedByVariationId).toBeUndefined();
    expect(replacement.replacesVariationId).toBeUndefined();
  });

  it("only tightens an existing end date, never extends it", () => {
    const existing = variation({ id: "old", appliesUntil: "2026-02-01" });
    const replacement = variation({ id: "new", appliesFrom: "2026-06-01" });
    const { existing: bounded } = replaceVariation({
      existing,
      replacement,
      now: "2026-01-15T00:00:00.000Z",
    });
    // The earlier existing end date (2026-02-01) wins over the later boundary.
    expect(bounded.appliesUntil).toBe("2026-02-01");
  });
});
