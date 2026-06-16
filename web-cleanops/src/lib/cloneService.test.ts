import { describe, expect, it } from "vitest";
import { resolveClonedEndDate } from "./cloneService";

describe("resolveClonedEndDate", () => {
  it("keeps the original end date when it is on/after the new start date", () => {
    expect(resolveClonedEndDate("2026-08-31", "2026-07-01")).toBe("2026-08-31");
  });

  it("keeps the original end date when it equals the new start date", () => {
    expect(resolveClonedEndDate("2026-07-01", "2026-07-01")).toBe("2026-07-01");
  });

  it("clears an end date that falls before the new start date", () => {
    // Reported bug: original 2026-05-31, cloned start 2026-07-01.
    expect(resolveClonedEndDate("2026-05-31", "2026-07-01")).toBeNull();
  });

  it("returns null when there is no original end date", () => {
    expect(resolveClonedEndDate(null, "2026-07-01")).toBeNull();
    expect(resolveClonedEndDate(undefined, "2026-07-01")).toBeNull();
  });

  it("returns null for blank values", () => {
    expect(resolveClonedEndDate("  ", "2026-07-01")).toBeNull();
    expect(resolveClonedEndDate("2026-08-01", "  ")).toBeNull();
  });
});
