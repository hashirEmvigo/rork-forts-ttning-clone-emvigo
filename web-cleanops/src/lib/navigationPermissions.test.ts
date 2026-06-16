import { describe, expect, it } from "vitest";

import type { UserRole } from "@/types";
import {
  ALL_PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSION_MODULES,
  permissionLabel,
} from "@/lib/permissions";

/**
 * Navigation & Menu management (Slice 11A) is a Super-Admin platform capability.
 * These guard that `navigation.manage` is registered and granted ONLY to the
 * Super Admin — menu customization is Master-Admin governed and presentation
 * only, so no other role (or company admin) may reach it.
 */
const MANAGE = "navigation.manage";

describe("navigation permission catalogue", () => {
  it("registers navigation.manage under a dedicated module", () => {
    expect(ALL_PERMISSIONS).toContain(MANAGE);
    const module = PERMISSION_MODULES.find((m) => m.id === "navigation");
    expect(module).toBeDefined();
    expect(module?.permissions.map((p) => p.key)).toEqual([MANAGE]);
    expect(permissionLabel(MANAGE)).toBe("Manage navigation & menus");
  });

  it("grants navigation.manage to the Super Admin by default", () => {
    expect(DEFAULT_ROLE_PERMISSIONS.super_admin).toContain(MANAGE);
  });

  it("does NOT grant navigation.manage to company admin, employee or customer", () => {
    for (const role of ["company_admin", "employee", "customer"] as UserRole[]) {
      expect(DEFAULT_ROLE_PERMISSIONS[role]).not.toContain(MANAGE);
    }
  });
});
