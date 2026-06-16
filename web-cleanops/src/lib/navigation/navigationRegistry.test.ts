import { describe, expect, it } from "vitest";

import { isNavigationIconKey } from "./iconRegistry";
import {
  findDuplicateRegistryKeys,
  getRegistryGroup,
  isRegistryValid,
  LOCKED_TECHNICAL_FIELDS,
  mergeAdminNavigationGroup,
  NAVIGATION_GROUP_APPLIED,
  NAVIGATION_PLANNED_GROUPS,
  NAVIGATION_REGISTRY,
  navigationGroupState,
  resolveMainNavPresentationByRoute,
  resolveNavigationGroup,
  type NavigationMenuOverride,
  type NavigationRegistryItem,
} from "./navigationRegistry";

const allowAll = { hasPermission: () => true };

describe("navigation registry — structure", () => {
  it("has unique, stable keys (no duplicates)", () => {
    expect(findDuplicateRegistryKeys()).toEqual([]);
    expect(isRegistryValid()).toBe(true);
  });

  it("gives every item a translation key, default label and a valid default icon", () => {
    for (const item of NAVIGATION_REGISTRY) {
      expect(item.translationKey.trim()).not.toBe("");
      expect(item.defaultLabel.trim()).not.toBe("");
      expect(isNavigationIconKey(item.defaultIcon)).toBe(true);
      expect(item.lockedTechnicalFields).toEqual(LOCKED_TECHNICAL_FIELDS);
    }
  });

  it("uses the stable key (never the visible label) as the translation key join point", () => {
    const pricing = NAVIGATION_REGISTRY.find((i) => i.key === "calculator.pricing");
    expect(pricing?.translationKey).toBe("calculator.pricing");
    expect(pricing?.defaultLabel).toBe("Pricing");
  });

  it("registers the calculator group with all seven tab sections", () => {
    const sections = getRegistryGroup("calculator").map((i) => i.section);
    expect(sections).toEqual(["overview", "services", "plans", "pricing", "addons", "settings", "requests"]);
  });

  it("registers the customer_card group", () => {
    const keys = getRegistryGroup("customer_card").map((i) => i.key);
    expect(keys).toContain("customer_card.contact");
    expect(keys.length).toBeGreaterThan(0);
  });

  it("detects a planted duplicate key", () => {
    const planted: NavigationRegistryItem[] = [
      ...NAVIGATION_REGISTRY,
      { ...NAVIGATION_REGISTRY[0] },
    ];
    expect(findDuplicateRegistryKeys(planted)).toContain(NAVIGATION_REGISTRY[0].key);
  });
});

describe("resolveNavigationGroup — permission is authoritative", () => {
  it("drops items whose permission the user does not hold (even when visible)", () => {
    const resolved = resolveNavigationGroup("calculator", [], { hasPermission: () => false });
    expect(resolved).toEqual([]);
  });

  it("includes items only when the permission is held", () => {
    const resolved = resolveNavigationGroup("calculator", [], {
      hasPermission: (p) => p === "calculator.manage",
    });
    expect(resolved.map((i) => i.section)).toContain("pricing");
  });

  it("a visible override never bypasses a missing permission", () => {
    const overrides: NavigationMenuOverride[] = [
      { menuKey: "calculator.pricing", customLabel: "X", customIcon: null, sortOrder: null, isVisible: true },
    ];
    const resolved = resolveNavigationGroup("calculator", overrides, { hasPermission: () => false });
    expect(resolved).toEqual([]);
  });
});

describe("resolveNavigationGroup — visibility is presentation only", () => {
  it("hides an item from the resolved menu without removing it from the registry", () => {
    const overrides: NavigationMenuOverride[] = [
      { menuKey: "calculator.pricing", customLabel: null, customIcon: null, sortOrder: null, isVisible: false },
    ];
    const resolved = resolveNavigationGroup("calculator", overrides, allowAll);
    expect(resolved.find((i) => i.key === "calculator.pricing")).toBeUndefined();
    // Registry (route + permission truth) is untouched.
    expect(NAVIGATION_REGISTRY.find((i) => i.key === "calculator.pricing")).toBeDefined();
  });

  it("applies custom label, custom icon and sort order overrides", () => {
    const overrides: NavigationMenuOverride[] = [
      { menuKey: "calculator.pricing", customLabel: "Priser", customIcon: "Calculator", sortOrder: 5, isVisible: true },
    ];
    const resolved = resolveNavigationGroup("calculator", overrides, allowAll);
    const pricing = resolved.find((i) => i.key === "calculator.pricing");
    expect(pricing?.label).toBe("Priser");
    expect(pricing?.iconKey).toBe("Calculator");
    // sortOrder 5 floats it to the front.
    expect(resolved[0].key).toBe("calculator.pricing");
  });

  it("falls back to defaults for blank labels and unknown icons", () => {
    const overrides: NavigationMenuOverride[] = [
      { menuKey: "calculator.pricing", customLabel: "  ", customIcon: "NotARealIcon", sortOrder: null, isVisible: true },
    ];
    const resolved = resolveNavigationGroup("calculator", overrides, allowAll);
    const pricing = resolved.find((i) => i.key === "calculator.pricing");
    expect(pricing?.label).toBe("Pricing");
    expect(pricing?.iconKey).toBe("SlidersHorizontal");
  });
});

describe("navigationGroupState + planned groups (Slice 11C)", () => {
  it("reports applied groups as live", () => {
    for (const group of ["calculator", "customer_card", "main_navigation"] as const) {
      expect(NAVIGATION_GROUP_APPLIED[group]).toBe(true);
      expect(navigationGroupState(group)).toBe("live");
    }
  });

  it("surfaces Employee Card as a planned (not-yet-registered) group", () => {
    expect(NAVIGATION_PLANNED_GROUPS.map((g) => g.key)).toContain("employee_card");
  });
});

describe("resolveMainNavPresentationByRoute — sidebar overlay (Slice 11C)", () => {
  it("resolves every managed route to its registry default with no overrides", () => {
    const byRoute = resolveMainNavPresentationByRoute([]);
    const dashboard = byRoute.get("/dashboard");
    expect(dashboard?.label).toBe("Overview");
    expect(dashboard?.iconKey).toBe("LayoutDashboard");
    expect(dashboard?.isVisible).toBe(true);
    // All eight main_navigation routes are present.
    expect(byRoute.size).toBe(getRegistryGroup("main_navigation").length);
  });

  it("applies a custom label + icon override, matched by route", () => {
    const overrides: NavigationMenuOverride[] = [
      { menuKey: "main.customers", customLabel: "Clients", customIcon: "Star", sortOrder: null, isVisible: true },
    ];
    const byRoute = resolveMainNavPresentationByRoute(overrides);
    expect(byRoute.get("/customers")?.label).toBe("Clients");
    expect(byRoute.get("/customers")?.iconKey).toBe("Star");
  });

  it("marks a hidden item isVisible=false (presentation only; route untouched)", () => {
    const overrides: NavigationMenuOverride[] = [
      { menuKey: "main.settings", customLabel: null, customIcon: null, sortOrder: null, isVisible: false },
    ];
    const byRoute = resolveMainNavPresentationByRoute(overrides);
    expect(byRoute.get("/settings")?.isVisible).toBe(false);
    // The registry (route + permission truth) is untouched.
    expect(NAVIGATION_REGISTRY.find((i) => i.key === "main.settings")?.route).toBe("/settings");
  });

  it("falls back to the default icon for an unknown custom icon", () => {
    const overrides: NavigationMenuOverride[] = [
      { menuKey: "main.dashboard", customLabel: "  ", customIcon: "NotAnIcon", sortOrder: null, isVisible: true },
    ];
    const byRoute = resolveMainNavPresentationByRoute(overrides);
    expect(byRoute.get("/dashboard")?.label).toBe("Overview");
    expect(byRoute.get("/dashboard")?.iconKey).toBe("LayoutDashboard");
  });
});

describe("mergeAdminNavigationGroup — settings editor view", () => {
  it("includes hidden items and is not permission filtered", () => {
    const overrides: NavigationMenuOverride[] = [
      { menuKey: "calculator.pricing", customLabel: null, customIcon: null, sortOrder: null, isVisible: false },
    ];
    const merged = mergeAdminNavigationGroup("calculator", overrides);
    const pricing = merged.find((i) => i.registry.key === "calculator.pricing");
    expect(pricing).toBeDefined();
    expect(pricing?.isVisible).toBe(false);
  });

  it("marks an item customized only when an override changes a default", () => {
    const overrides: NavigationMenuOverride[] = [
      { menuKey: "calculator.fields", customLabel: "Fält", customIcon: null, sortOrder: null, isVisible: true },
    ];
    const merged = mergeAdminNavigationGroup("calculator", overrides);
    expect(merged.find((i) => i.registry.key === "calculator.fields")?.hasOverride).toBe(true);
    // An item with no override is not customized.
    expect(merged.find((i) => i.registry.key === "calculator.plans")?.hasOverride).toBe(false);
  });

  it("treats a neutral (reset) override as not customized", () => {
    const overrides: NavigationMenuOverride[] = [
      { menuKey: "calculator.plans", customLabel: null, customIcon: null, sortOrder: null, isVisible: true },
    ];
    const merged = mergeAdminNavigationGroup("calculator", overrides);
    expect(merged.find((i) => i.registry.key === "calculator.plans")?.hasOverride).toBe(false);
  });
});
