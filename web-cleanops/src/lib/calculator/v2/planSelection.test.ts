import { describe, expect, it } from "vitest";

import { selectPlanV2 } from "./planSelection";
import type { CalculatorPlanV2 } from "./types";

function hourlyPlan(overrides: Partial<CalculatorPlanV2> & Pick<CalculatorPlanV2, "planKey">): CalculatorPlanV2 {
  return {
    label: overrides.planKey,
    description: null,
    active: true,
    isDefault: false,
    sortOrder: 0,
    kind: "hourly",
    hourlyRateExclVat: 410,
    startAdjustmentHours: 0,
    pricePerSqmExclVat: null,
    fixedAdjustmentExclVat: null,
    minimumPriceExclVat: null,
    ...overrides,
  };
}

describe("selectPlanV2", () => {
  it("returns a no_active_plan issue when nothing is active", () => {
    const res = selectPlanV2([hourlyPlan({ planKey: "flexibel", active: false })]);
    expect(res.plan).toBeNull();
    expect(res.requiresPublicChoice).toBe(false);
    expect(res.issue?.code).toBe("no_active_plan");
  });

  it("auto-selects the single active plan with no public choice", () => {
    const res = selectPlanV2([
      hourlyPlan({ planKey: "flexibel", sortOrder: 0 }),
      hourlyPlan({ planKey: "fast", active: false, sortOrder: 1 }),
    ]);
    expect(res.plan?.planKey).toBe("flexibel");
    expect(res.requiresPublicChoice).toBe(false);
    expect(res.activePlans).toHaveLength(1);
  });

  it("flags a public choice and picks the default when multiple are active", () => {
    const res = selectPlanV2([
      hourlyPlan({ planKey: "flexibel", sortOrder: 0 }),
      hourlyPlan({ planKey: "fast", sortOrder: 1, isDefault: true }),
      hourlyPlan({ planKey: "prioritet", sortOrder: 2 }),
    ]);
    expect(res.requiresPublicChoice).toBe(true);
    expect(res.plan?.planKey).toBe("fast");
    expect(res.activePlans.map((p) => p.planKey)).toEqual(["flexibel", "fast", "prioritet"]);
  });

  it("honours an explicitly requested active plan key", () => {
    const res = selectPlanV2(
      [
        hourlyPlan({ planKey: "flexibel", sortOrder: 0, isDefault: true }),
        hourlyPlan({ planKey: "prioritet", sortOrder: 2 }),
      ],
      "prioritet",
    );
    expect(res.plan?.planKey).toBe("prioritet");
  });

  it("falls back to the default when the requested key is not active", () => {
    const res = selectPlanV2(
      [
        hourlyPlan({ planKey: "flexibel", sortOrder: 0, isDefault: true }),
        hourlyPlan({ planKey: "fast", sortOrder: 1 }),
      ],
      "does_not_exist",
    );
    expect(res.plan?.planKey).toBe("flexibel");
  });

  it("falls back to the first active by sort order when no default is set", () => {
    const res = selectPlanV2([
      hourlyPlan({ planKey: "prioritet", sortOrder: 2 }),
      hourlyPlan({ planKey: "flexibel", sortOrder: 0 }),
      hourlyPlan({ planKey: "fast", sortOrder: 1 }),
    ]);
    expect(res.plan?.planKey).toBe("flexibel");
  });
});
