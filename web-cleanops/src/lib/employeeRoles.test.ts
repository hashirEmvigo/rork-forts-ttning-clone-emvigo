import { describe, expect, it } from "vitest";

import {
  canAssignRole,
  employeeHasPermission,
  isRoleActive,
  listAssignableRoles,
  resolveEmployeeRole,
  resolveEmployeePermissions,
  resolveUserPermissions,
  resolveUserRole,
  roleSourceType,
  userHasPermission,
  type PermissionContext,
  type RoleResolutionContext,
} from "./employeeRoles";
import { DEFAULT_ROLE_PERMISSIONS } from "./permissions";
import type { Employee, Role, User } from "@/types";

const COMPANY = "cmp_nordlys";

function makeEmployee(over: Partial<Employee> = {}): Employee {
  return {
    id: "emp_1",
    companyId: COMPANY,
    name: "Ingrid Sand",
    email: "ingrid@nordlys.io",
    status: "active",
    teamIds: [],
    userId: "usr_emp1",
    createdAt: new Date().toISOString(),
    ...over,
  };
}

function makeUser(over: Partial<User> = {}): User {
  return {
    id: "usr_emp1",
    name: "Ingrid Sand",
    email: "ingrid@nordlys.io",
    role: "employee",
    companyId: COMPANY,
    status: "active",
    createdAt: new Date().toISOString(),
    ...over,
  };
}

function makeRole(over: Partial<Role> = {}): Role {
  return {
    id: "role_x",
    name: "Role",
    description: "",
    companyId: COMPANY,
    isSystem: false,
    permissions: [],
    createdAt: new Date().toISOString(),
    ...over,
  };
}

/** The seeded system "employee" role for the company. */
const systemEmployeeRole = makeRole({
  id: `role_${COMPANY}_employee`,
  name: "Employee",
  isSystem: true,
  baseRole: "employee",
  permissions: [...DEFAULT_ROLE_PERMISSIONS.employee],
});

describe("roleSourceType", () => {
  it("classifies company-agnostic roles as system templates", () => {
    expect(roleSourceType({ companyId: null })).toBe("systemTemplate");
  });

  it("classifies company-owned roles as company roles", () => {
    expect(roleSourceType({ companyId: COMPANY })).toBe("companyRole");
  });
});

describe("isRoleActive", () => {
  it("treats absent isActive as active (legacy safe)", () => {
    expect(isRoleActive({ isActive: undefined })).toBe(true);
  });

  it("respects an explicit inactive flag", () => {
    expect(isRoleActive({ isActive: false })).toBe(false);
    expect(isRoleActive({ isActive: true })).toBe(true);
  });
});

describe("resolveUserRole (core engine)", () => {
  it("prefers the explicit custom role on the login", () => {
    const custom = makeRole({ id: "role_lead", permissions: ["schedule.edit"] });
    const ctx: PermissionContext = { roles: [custom, systemEmployeeRole] };
    expect(resolveUserRole(makeUser({ roleId: "role_lead" }), ctx)?.id).toBe("role_lead");
  });

  it("falls back to the company system role for the login base role", () => {
    const ctx: PermissionContext = { roles: [systemEmployeeRole] };
    expect(resolveUserRole(makeUser({ roleId: null }), ctx)?.id).toBe(systemEmployeeRole.id);
  });

  it("returns null when no role can be resolved", () => {
    expect(resolveUserRole(makeUser({ roleId: null }), { roles: [] })).toBeNull();
  });
});

describe("resolveUserPermissions (single source of truth)", () => {
  it("returns the resolved role's permissions", () => {
    const custom = makeRole({ id: "role_lead", permissions: ["schedule.edit", "customers.view"] });
    expect(resolveUserPermissions(makeUser({ roleId: "role_lead" }), { roles: [custom] })).toEqual([
      "schedule.edit",
      "customers.view",
    ]);
  });

  it("falls back to base-role defaults when no role resolves", () => {
    expect(resolveUserPermissions(makeUser({ roleId: null }), { roles: [] })).toEqual(
      DEFAULT_ROLE_PERMISSIONS.employee,
    );
  });

  it("matches the legacy roleId→role.permissions behaviour", () => {
    const custom = makeRole({ id: "role_lead", permissions: ["schedule.edit"] });
    expect(userHasPermission(makeUser({ roleId: "role_lead" }), "schedule.edit", { roles: [custom] })).toBe(
      true,
    );
    expect(userHasPermission(makeUser({ roleId: "role_lead" }), "customers.delete", { roles: [custom] })).toBe(
      false,
    );
  });
});

describe("resolveEmployeeRole", () => {
  it("prefers the explicit custom role on the login", () => {
    const custom = makeRole({ id: "role_lead", name: "Team Leader", permissions: ["schedule.edit"] });
    const ctx: RoleResolutionContext = {
      users: [makeUser({ roleId: "role_lead" })],
      roles: [custom, systemEmployeeRole],
    };
    expect(resolveEmployeeRole(makeEmployee(), ctx)?.id).toBe("role_lead");
  });

  it("falls back to the company system role for the login base role", () => {
    const ctx: RoleResolutionContext = {
      users: [makeUser({ roleId: null })],
      roles: [systemEmployeeRole],
    };
    expect(resolveEmployeeRole(makeEmployee(), ctx)?.id).toBe(systemEmployeeRole.id);
  });

  it("falls back to the company employee role when login is missing", () => {
    const ctx: RoleResolutionContext = { users: [], roles: [systemEmployeeRole] };
    expect(resolveEmployeeRole(makeEmployee({ userId: null }), ctx)?.id).toBe(
      systemEmployeeRole.id,
    );
  });

  it("returns null when no role can be resolved", () => {
    const ctx: RoleResolutionContext = { users: [], roles: [] };
    expect(resolveEmployeeRole(makeEmployee({ userId: null }), ctx)).toBeNull();
  });
});

describe("resolveEmployeePermissions", () => {
  it("returns the resolved role's permissions", () => {
    const custom = makeRole({ id: "role_lead", permissions: ["schedule.edit", "customers.view"] });
    const ctx: RoleResolutionContext = {
      users: [makeUser({ roleId: "role_lead" })],
      roles: [custom],
    };
    expect(resolveEmployeePermissions(makeEmployee(), ctx)).toEqual([
      "schedule.edit",
      "customers.view",
    ]);
  });

  it("falls back to base-role defaults when no role resolves", () => {
    const ctx: RoleResolutionContext = { users: [makeUser({ roleId: null })], roles: [] };
    expect(resolveEmployeePermissions(makeEmployee(), ctx)).toEqual(
      DEFAULT_ROLE_PERMISSIONS.employee,
    );
  });
});

describe("employeeHasPermission", () => {
  const ctx: RoleResolutionContext = {
    users: [makeUser({ roleId: "role_lead" })],
    roles: [makeRole({ id: "role_lead", permissions: ["schedule.edit"] })],
  };

  it("is true for a granted permission", () => {
    expect(employeeHasPermission(makeEmployee(), "schedule.edit", ctx)).toBe(true);
  });

  it("is false for a permission the role lacks", () => {
    expect(employeeHasPermission(makeEmployee(), "customers.delete", ctx)).toBe(false);
  });
});

describe("listAssignableRoles", () => {
  const template = makeRole({ id: "tpl_emp", name: "Employee", companyId: null, isSystem: true, baseRole: "employee" });
  const companySystem = systemEmployeeRole;
  const companyCustom = makeRole({ id: "role_lead", name: "Team Leader" });
  const otherCompany = makeRole({ id: "role_other", name: "Other", companyId: "cmp_x" });
  const inactive = makeRole({ id: "role_off", name: "Archived", isActive: false });

  it("includes company roles and custom roles, excludes other companies", () => {
    const result = listAssignableRoles(COMPANY, [
      template,
      companySystem,
      companyCustom,
      otherCompany,
      inactive,
    ]);
    const ids = result.map((r) => r.id);
    expect(ids).toContain(companySystem.id);
    expect(ids).toContain("role_lead");
    expect(ids).not.toContain("role_other");
  });

  it("collapses a built-in role's template + company copy to a single company-scoped entry", () => {
    const result = listAssignableRoles(COMPANY, [template, companySystem]);
    const employeeRoles = result.filter((r) => r.baseRole === "employee");
    expect(employeeRoles).toHaveLength(1);
    expect(employeeRoles[0]?.id).toBe(companySystem.id);
    expect(result.map((r) => r.id)).not.toContain("tpl_emp");
  });

  it("keeps the global template when there is no company-scoped copy", () => {
    const result = listAssignableRoles(COMPANY, [template]);
    expect(result.map((r) => r.id)).toEqual(["tpl_emp"]);
  });

  it("excludes inactive roles", () => {
    const result = listAssignableRoles(COMPANY, [companyCustom, inactive]);
    expect(result.map((r) => r.id)).not.toContain("role_off");
  });

  it("sorts system roles before company roles", () => {
    const result = listAssignableRoles(COMPANY, [companyCustom, companySystem]);
    expect(result[0]?.isSystem).toBe(true);
  });

  it("hides the Super Admin role from a Company Admin assigner", () => {
    const superAdmin = makeRole({
      id: "tpl_super",
      name: "Super Admin",
      companyId: null,
      isSystem: true,
      baseRole: "super_admin",
    });
    const result = listAssignableRoles(
      COMPANY,
      [superAdmin, companySystem, companyCustom],
      "company_admin",
    );
    expect(result.map((r) => r.id)).not.toContain("tpl_super");
    expect(result.map((r) => r.id)).toContain(companySystem.id);
  });

  it("keeps the Super Admin role for a Super Admin assigner", () => {
    const superAdmin = makeRole({
      id: "tpl_super",
      name: "Super Admin",
      companyId: null,
      isSystem: true,
      baseRole: "super_admin",
    });
    const result = listAssignableRoles(COMPANY, [superAdmin, companySystem], "super_admin");
    expect(result.map((r) => r.id)).toContain("tpl_super");
  });
});

describe("canAssignRole", () => {
  it("only lets a Super Admin grant the Super Admin role", () => {
    const superRole = { baseRole: "super_admin" as const };
    expect(canAssignRole("super_admin", superRole)).toBe(true);
    expect(canAssignRole("company_admin", superRole)).toBe(false);
    expect(canAssignRole("employee", superRole)).toBe(false);
    expect(canAssignRole(null, superRole)).toBe(false);
  });

  it("lets admins grant non-super-admin roles", () => {
    expect(canAssignRole("company_admin", { baseRole: "employee" })).toBe(true);
    expect(canAssignRole("company_admin", { baseRole: "company_admin" })).toBe(true);
    expect(canAssignRole("super_admin", { baseRole: "customer" })).toBe(true);
  });
});
