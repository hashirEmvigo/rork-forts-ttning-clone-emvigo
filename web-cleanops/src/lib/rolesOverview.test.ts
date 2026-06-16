import { describe, expect, it } from "vitest";

import {
  companyCountForBaseRole,
  tallyCompanyRoles,
  userCountForBaseRole,
} from "./rolesOverview";
import type { User } from "@/types";

const user = (patch: Partial<User>): User => ({
  id: patch.id ?? "usr_1",
  name: patch.name ?? "User One",
  email: patch.email ?? "user@example.com",
  role: patch.role ?? "employee",
  companyId: "companyId" in patch ? patch.companyId ?? null : "cmp_live",
  status: patch.status ?? "active",
  createdAt: patch.createdAt ?? "2026-01-01T00:00:00.000Z",
  roleId: patch.roleId,
});

describe("CORE-WRITES-A2.2.1 rolesOverview counts", () => {
  it("counts active users only for default role cards", () => {
    const users: User[] = [
      user({ id: "usr_active", role: "employee", status: "active" }),
      user({ id: "usr_inactive", role: "employee", status: "inactive" }),
      user({ id: "usr_admin", role: "company_admin", status: "active" }),
    ];

    expect(userCountForBaseRole(users, "employee")).toBe(1);
  });

  it("counts companies with active role holders only", () => {
    const users: User[] = [
      user({ id: "usr_a", role: "employee", companyId: "cmp_a", status: "active" }),
      user({ id: "usr_b", role: "employee", companyId: "cmp_a", status: "active" }),
      user({ id: "usr_c", role: "employee", companyId: "cmp_b", status: "inactive" }),
      user({ id: "usr_super", role: "super_admin", companyId: null, status: "active" }),
    ];

    expect(companyCountForBaseRole(users, "employee")).toBe(1);
    expect(companyCountForBaseRole(users, "super_admin")).toBe(0);
  });

  it("tallies company members from active users only", () => {
    const users: User[] = [
      user({ id: "usr_admin", role: "company_admin", companyId: "cmp_live", status: "active" }),
      user({ id: "usr_employee", role: "employee", companyId: "cmp_live", status: "active" }),
      user({ id: "usr_customer", role: "customer", companyId: "cmp_live", status: "active" }),
      user({ id: "usr_inactive_customer", role: "customer", companyId: "cmp_live", status: "inactive" }),
      user({ id: "usr_other", role: "employee", companyId: "cmp_other", status: "active" }),
    ];

    expect(tallyCompanyRoles(users, "cmp_live")).toEqual({
      admins: 1,
      employees: 1,
      customers: 1,
      total: 3,
    });
  });
});
