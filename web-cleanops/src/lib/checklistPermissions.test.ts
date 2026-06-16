import { describe, expect, it } from "vitest";

import {
  ALL_PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSION_MODULES,
} from "./permissions";

/**
 * These tests cover permission *registration* only (the pure catalogue). Route-
 * level gating is enforced by <ProtectedRoute> rendering in App.tsx; testing
 * that would require a full router/auth render harness, which the project does
 * not currently have — see "Areas not covered" in the ticket report.
 */

const VIEW = "checklists.settings.view";
const MANAGE = "checklists.settings.manage";

const EXEC_VIEW = "checklists.execution.view";
const EXEC_COMPLETE = "checklists.execution.complete";
const EXEC_INSPECT = "checklists.execution.inspect";

describe("checklist permission registration", () => {
  it("registers the checklist settings view and manage keys", () => {
    expect(ALL_PERMISSIONS).toContain(VIEW);
    expect(ALL_PERMISSIONS).toContain(MANAGE);
  });

  it("groups both keys under a single checklists module", () => {
    const module = PERMISSION_MODULES.find((m) => m.id === "checklists");
    expect(module).toBeDefined();
    expect(module?.permissions.map((p) => p.key)).toEqual([VIEW, MANAGE]);
  });

  it("grants admins both view and manage by default", () => {
    for (const role of ["super_admin", "company_admin"] as const) {
      expect(DEFAULT_ROLE_PERMISSIONS[role]).toContain(VIEW);
      expect(DEFAULT_ROLE_PERMISSIONS[role]).toContain(MANAGE);
    }
  });

  it("does not grant checklist settings access to employees or customers", () => {
    for (const role of ["employee", "customer"] as const) {
      expect(DEFAULT_ROLE_PERMISSIONS[role]).not.toContain(VIEW);
      expect(DEFAULT_ROLE_PERMISSIONS[role]).not.toContain(MANAGE);
    }
  });
});

describe("checklist execution permission registration (Phase 3A)", () => {
  it("registers the execution view/complete/inspect keys", () => {
    expect(ALL_PERMISSIONS).toContain(EXEC_VIEW);
    expect(ALL_PERMISSIONS).toContain(EXEC_COMPLETE);
    expect(ALL_PERMISSIONS).toContain(EXEC_INSPECT);
  });

  it("groups execution keys under a dedicated module", () => {
    const module = PERMISSION_MODULES.find(
      (m) => m.id === "checklists_execution",
    );
    expect(module).toBeDefined();
    expect(module?.permissions.map((p) => p.key)).toEqual([
      EXEC_VIEW,
      EXEC_COMPLETE,
      EXEC_INSPECT,
    ]);
  });

  it("grants admins all execution permissions by default", () => {
    for (const role of ["super_admin", "company_admin"] as const) {
      expect(DEFAULT_ROLE_PERMISSIONS[role]).toContain(EXEC_VIEW);
      expect(DEFAULT_ROLE_PERMISSIONS[role]).toContain(EXEC_COMPLETE);
      expect(DEFAULT_ROLE_PERMISSIONS[role]).toContain(EXEC_INSPECT);
    }
  });

  it("does not grant execution permissions to employees or customers by default", () => {
    for (const role of ["employee", "customer"] as const) {
      expect(DEFAULT_ROLE_PERMISSIONS[role]).not.toContain(EXEC_VIEW);
      expect(DEFAULT_ROLE_PERMISSIONS[role]).not.toContain(EXEC_COMPLETE);
      expect(DEFAULT_ROLE_PERMISSIONS[role]).not.toContain(EXEC_INSPECT);
    }
  });
});
