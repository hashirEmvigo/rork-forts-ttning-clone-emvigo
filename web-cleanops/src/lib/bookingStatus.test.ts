import { describe, expect, it } from "vitest";

import {
  resolveBookingConfirmationStatus,
  resolveBookingModifiers,
  resolveBookingOperationalStatus,
} from "./bookingStatus";

describe("resolveBookingOperationalStatus", () => {
  const base = {
    isCancelled: false,
    reschedule: null,
    isVariation: false,
    isScheduled: false,
  };

  it("returns unscheduled as the neutral fallback", () => {
    const badge = resolveBookingOperationalStatus(base);
    expect(badge.status).toBe("unscheduled");
    expect(badge.color).toBe("neutral");
    expect(badge.label).toBe("Unscheduled");
  });

  it("returns scheduled when the booking has a slot", () => {
    const badge = resolveBookingOperationalStatus({ ...base, isScheduled: true });
    expect(badge.status).toBe("scheduled");
    expect(badge.color).toBe("green");
  });

  it("returns variation (violet) over scheduled", () => {
    const badge = resolveBookingOperationalStatus({
      ...base,
      isVariation: true,
      isScheduled: true,
    });
    expect(badge.status).toBe("variation");
    expect(badge.color).toBe("violet");
  });

  it("returns rebooked (blue) over variation, with a from→to tooltip", () => {
    const badge = resolveBookingOperationalStatus({
      ...base,
      isVariation: true,
      reschedule: { originalDate: "2026-05-30", newDate: "2026-06-02", oneTime: true },
    });
    expect(badge.status).toBe("rebooked");
    expect(badge.color).toBe("blue");
    expect(badge.tooltip).toContain("Saturday 30 May 2026");
    expect(badge.tooltip).toContain("Tuesday 02 Jun 2026");
    expect(badge.tooltip).toContain("One-Time Change");
    expect(badge.tooltip).not.toContain("Future occurrences unchanged");
  });

  it("does NOT treat a same-day reschedule as rebooked (no X → X)", () => {
    const badge = resolveBookingOperationalStatus({
      ...base,
      reschedule: { originalDate: "2026-06-02", newDate: "2026-06-02", oneTime: true },
    });
    expect(badge.status).toBe("unscheduled");
    expect(badge.tooltip).toBeUndefined();
  });

  it("returns cancelled (red) over everything else", () => {
    const badge = resolveBookingOperationalStatus({
      isCancelled: true,
      isVariation: true,
      isScheduled: true,
      reschedule: { originalDate: "2026-05-30", newDate: "2026-06-02", oneTime: true },
    });
    expect(badge.status).toBe("cancelled");
    expect(badge.color).toBe("red");
  });
});

describe("resolveBookingConfirmationStatus", () => {
  it("returns nothing when there is no result", () => {
    expect(resolveBookingConfirmationStatus(null)).toBeNull();
    expect(resolveBookingConfirmationStatus(undefined)).toBeNull();
  });

  it("returns nothing for none / not_evaluated", () => {
    expect(resolveBookingConfirmationStatus({ status: "none" })).toBeNull();
    expect(resolveBookingConfirmationStatus({ status: "not_evaluated" })).toBeNull();
  });

  it("auto-confirms an optimal time (green) with the short 'Auto' label", () => {
    const badge = resolveBookingConfirmationStatus({ status: "optimal" });
    expect(badge?.status).toBe("auto_confirmed");
    expect(badge?.label).toBe("Auto");
    expect(badge?.color).toBe("green");
    expect(badge?.tooltip).toBe("Within customer's approved scheduling preferences.");
  });

  it("auto-confirms an acceptable time", () => {
    const badge = resolveBookingConfirmationStatus({ status: "acceptable" });
    expect(badge?.status).toBe("auto_confirmed");
  });

  it("requires confirmation for outside_range (orange) with the short 'Pending' label", () => {
    const badge = resolveBookingConfirmationStatus({ status: "outside_range" });
    expect(badge?.status).toBe("needs_confirmation");
    expect(badge?.label).toBe("Pending");
    expect(badge?.color).toBe("orange");
    expect(badge?.tooltip).toContain("Customer confirmation required");
  });
});

describe("resolveBookingModifiers", () => {
  const base = {
    isCancelled: false,
    isTimeChanged: false,
    confirmation: null,
  };

  it("returns no modifiers for a plain booking", () => {
    expect(resolveBookingModifiers(base)).toEqual([]);
  });

  it("adds a Changed modifier when the occurrence time was overridden", () => {
    const mods = resolveBookingModifiers({ ...base, isTimeChanged: true });
    expect(mods).toHaveLength(1);
    expect(mods[0].modifier).toBe("changed");
    expect(mods[0].label).toBe("Changed");
    expect(mods[0].icon).toBe("changed");
  });

  it("adds the auto-confirmed modifier from an optimal evaluation", () => {
    const mods = resolveBookingModifiers({ ...base, confirmation: { status: "optimal" } });
    expect(mods).toHaveLength(1);
    expect(mods[0].modifier).toBe("auto_confirmed");
    expect(mods[0].label).toBe("Auto");
  });

  it("adds the needs-confirmation modifier from an outside_range evaluation", () => {
    const mods = resolveBookingModifiers({
      ...base,
      confirmation: { status: "outside_range" },
    });
    expect(mods).toHaveLength(1);
    expect(mods[0].modifier).toBe("needs_confirmation");
    expect(mods[0].label).toBe("Pending");
  });

  it("orders Changed before the confirmation modifier", () => {
    const mods = resolveBookingModifiers({
      isCancelled: false,
      isTimeChanged: true,
      confirmation: { status: "outside_range" },
    });
    expect(mods.map((m) => m.modifier)).toEqual(["changed", "needs_confirmation"]);
  });

  it("suppresses ALL modifiers for a cancelled booking", () => {
    const mods = resolveBookingModifiers({
      isCancelled: true,
      isTimeChanged: true,
      confirmation: { status: "outside_range" },
    });
    expect(mods).toEqual([]);
  });

  it("emits no confirmation modifier when there are no preferences", () => {
    expect(resolveBookingModifiers({ ...base, confirmation: { status: "none" } })).toEqual([]);
  });
});
