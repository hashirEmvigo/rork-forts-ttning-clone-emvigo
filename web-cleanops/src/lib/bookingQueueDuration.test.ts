import { describe, expect, it } from "vitest";

import { resolveOccurrenceDurationMinutes } from "@/lib/bookingQueueDuration";

describe("resolveOccurrenceDurationMinutes", () => {
  it("derives duration from the resolved occurrence window", () => {
    expect(
      resolveOccurrenceDurationMinutes(
        { plannedStartTime: "09:00", plannedEndTime: "12:00" },
        999,
      ),
    ).toBe(180);
  });

  it("prefers the resolved window over a stale snapshot fallback", () => {
    // The TIME column resolves 09:00–12:00 (3h); the snapshot still says 6h.
    // Duration must follow the resolved window, not the stale snapshot.
    expect(
      resolveOccurrenceDurationMinutes(
        { plannedStartTime: "09:00", plannedEndTime: "12:00" },
        360,
      ),
    ).toBe(180);
  });

  it("falls back to the snapshot when the window can't yield a duration", () => {
    expect(
      resolveOccurrenceDurationMinutes(
        { plannedStartTime: null, plannedEndTime: null },
        120,
      ),
    ).toBe(120);
  });

  it("returns null when neither the window nor a fallback is available", () => {
    expect(
      resolveOccurrenceDurationMinutes({
        plannedStartTime: null,
        plannedEndTime: null,
      }),
    ).toBeNull();
  });

  it("ignores a non-positive window and uses the fallback", () => {
    expect(
      resolveOccurrenceDurationMinutes(
        { plannedStartTime: "12:00", plannedEndTime: "12:00" },
        90,
      ),
    ).toBe(90);
  });
});
