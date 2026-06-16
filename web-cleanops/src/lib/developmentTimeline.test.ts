import { describe, expect, it } from "vitest";

import {
  getDevelopmentTimeline,
  getTimelineEntries,
  TIMELINE_DEFAULT_LIMIT,
  type TimelineCategory,
} from "./developmentTimeline";

const CATEGORIES: TimelineCategory[] = [
  "status",
  "migration",
  "audit",
  "activation",
  "governance",
];

describe("developmentTimeline", () => {
  it("returns a non-empty seed with stable, unique ids", () => {
    const entries = getDevelopmentTimeline();
    expect(entries.length).toBeGreaterThan(0);
    const ids = entries.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("sorts entries newest-first by date", () => {
    const entries = getDevelopmentTimeline();
    for (let i = 1; i < entries.length; i++) {
      const prev = new Date(entries[i - 1].date).getTime();
      const curr = new Date(entries[i].date).getTime();
      expect(prev).toBeGreaterThanOrEqual(curr);
    }
  });

  it("returns the same cached reference on repeated calls", () => {
    expect(getDevelopmentTimeline()).toBe(getDevelopmentTimeline());
  });

  it("only uses valid categories", () => {
    for (const e of getDevelopmentTimeline()) {
      expect(CATEGORIES).toContain(e.category);
    }
  });

  it("filters by category", () => {
    for (const category of CATEGORIES) {
      const filtered = getTimelineEntries(category);
      for (const e of filtered) {
        expect(e.category).toBe(category);
      }
    }
  });

  it("returns all entries for the 'all' filter", () => {
    expect(getTimelineEntries("all").length).toBe(getDevelopmentTimeline().length);
  });

  it("caps results at the requested limit", () => {
    expect(getTimelineEntries("all", 3).length).toBeLessThanOrEqual(3);
    expect(getTimelineEntries("all", 0).length).toBe(0);
  });

  it("defaults to the documented limit", () => {
    const all = getDevelopmentTimeline();
    const expected = Math.min(all.length, TIMELINE_DEFAULT_LIMIT);
    expect(getTimelineEntries().length).toBe(expected);
  });

  it("includes the latest verified Employees EMP-2 governance events", () => {
    const employees = getDevelopmentTimeline().filter((e) => e.moduleKey === "employees");
    const events = employees.map((e) => e.eventType);
    expect(events).toContain("EMP-2 Stage 1 complete");
    expect(events).toContain("EMP-2 Stage 2 wired (dormant)");

    const paused = employees.find((e) => e.eventType === "Activation paused");
    expect(paused?.category).toBe("activation");
    expect(paused?.note).toMatch(/EMPLOYEES_SUPABASE_READ remains OFF/i);
  });
});
