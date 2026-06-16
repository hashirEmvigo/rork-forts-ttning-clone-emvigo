import { describe, expect, it } from "vitest";

import {
  MAX_CUSTOM_LABEL_LENGTH,
  mapOverrideRow,
  validateOverrideDraft,
  type OverrideDraft,
} from "./navigationOverridesAdmin";

function draft(over: Partial<OverrideDraft> = {}): OverrideDraft {
  return {
    menuKey: "calculator.pricing",
    customLabel: null,
    customIcon: null,
    sortOrder: null,
    isVisible: true,
    ...over,
  };
}

describe("mapOverrideRow", () => {
  it("maps a clean row to the override view", () => {
    expect(
      mapOverrideRow({
        menu_key: "calculator.pricing",
        custom_label: "Priser",
        custom_icon: "Calculator",
        sort_order: 5,
        is_visible: true,
      }),
    ).toEqual({ menuKey: "calculator.pricing", customLabel: "Priser", customIcon: "Calculator", sortOrder: 5, isVisible: true });
  });

  it("drops a blank label and an unknown icon defensively", () => {
    const mapped = mapOverrideRow({
      menu_key: "x",
      custom_label: "   ",
      custom_icon: "NotAnIcon",
      sort_order: null,
      is_visible: null,
    });
    expect(mapped.customLabel).toBeNull();
    expect(mapped.customIcon).toBeNull();
    expect(mapped.isVisible).toBe(true); // null is treated as visible
  });
});

describe("validateOverrideDraft", () => {
  it("accepts a default (all-null) draft", () => {
    expect(validateOverrideDraft(draft())).toEqual([]);
  });

  it("accepts a valid customized draft", () => {
    expect(validateOverrideDraft(draft({ customLabel: "Priser", customIcon: "Calculator", sortOrder: 3 }))).toEqual([]);
  });

  it("rejects a too-long custom label", () => {
    const long = "x".repeat(MAX_CUSTOM_LABEL_LENGTH + 1);
    expect(validateOverrideDraft(draft({ customLabel: long }))).toContain(
      `Custom label must be ${MAX_CUSTOM_LABEL_LENGTH} characters or fewer.`,
    );
  });

  it("rejects an icon outside the controlled set", () => {
    expect(validateOverrideDraft(draft({ customIcon: "skull" }))).toContain("Choose an icon from the allowed set.");
  });

  it("rejects a non-integer sort order", () => {
    expect(validateOverrideDraft(draft({ sortOrder: 2.5 }))).toContain("Sort order must be a whole number.");
  });

  it("rejects a whitespace-only label", () => {
    expect(validateOverrideDraft(draft({ customLabel: "   " })).length).toBeGreaterThan(0);
  });
});
