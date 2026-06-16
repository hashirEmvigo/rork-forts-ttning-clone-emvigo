import { describe, expect, it } from "vitest";

import {
  ALL_PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSION_MODULES,
} from "./permissions";

/**
 * Covers price-calculator permission *registration* (the pure catalogue) and the
 * default role grants. Route-level gating (`/calculator`) and the Super Admin nav
 * gate both read `calculator.manage`; the live enforcement of the route guard is
 * covered by the <ProtectedRoute> render test in
 * `src/pages/superadmin/CalculatorControl.access.test.tsx`.
 */

const VIEW = "calculator.view";
const MANAGE = "calculator.manage";

describe("calculator permission registration (Slice 5B)", () => {
  it("registers the calculator view and manage keys", () => {
    expect(ALL_PERMISSIONS).toContain(VIEW);
    expect(ALL_PERMISSIONS).toContain(MANAGE);
  });

  it("groups both keys under a single calculator module", () => {
    const module = PERMISSION_MODULES.find((m) => m.id === "calculator");
    expect(module).toBeDefined();
    expect(module?.permissions.map((p) => p.key)).toEqual([VIEW, MANAGE]);
  });

  it("grants the Super Admin both calculator.view and calculator.manage by default", () => {
    expect(DEFAULT_ROLE_PERMISSIONS.super_admin).toContain(VIEW);
    expect(DEFAULT_ROLE_PERMISSIONS.super_admin).toContain(MANAGE);
  });

  it("does not grant calculator permissions to the Company Admin (Phase 2)", () => {
    expect(DEFAULT_ROLE_PERMISSIONS.company_admin).not.toContain(VIEW);
    expect(DEFAULT_ROLE_PERMISSIONS.company_admin).not.toContain(MANAGE);
  });

  it("does not grant calculator permissions to employees or customers", () => {
    for (const role of ["employee", "customer"] as const) {
      expect(DEFAULT_ROLE_PERMISSIONS[role]).not.toContain(VIEW);
      expect(DEFAULT_ROLE_PERMISSIONS[role]).not.toContain(MANAGE);
    }
  });
});
