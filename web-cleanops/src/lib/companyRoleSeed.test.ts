import { describe, expect, it } from "vitest";

import {
  buildCompanyRoleSeedPlan,
  buildGlobalRoleTemplates,
  COMPANY_SCOPED_BASE_ROLES,
  selectCompanyRoles,
  selectCustomGlobalTemplates,
} from "./companyRoleSeed";
import { DEFAULT_ROLE_PERMISSIONS } from "./permissions";
import { systemRoleId } from "./store";
import type { Role, UserRole } from "@/types";

const COMPANY = "cmp_stad";
const OTHER = "cmp_other";

/** Global Super Admin templates (companyId === null) — the shared source. */
const TEMPLATES: Role[] = [
  {
    id: "role_tpl_super_admin",
    name: "Super Admin",
    description: "Platform oversight.",
    companyId: null,
    isSystem: true,
    baseRole: "super_admin",
    permissions: ["platform.manage"],
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "role_tpl_company_admin",
    name: "Company Admin",
    description: "Runs the company.",
    companyId: null,
    isSystem: true,
    baseRole: "company_admin",
    permissions: ["settings.manage", "roles.manage", "employees.manage"],
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "role_tpl_employee",
    name: "Employee",
    description: "Front-line staff.",
    companyId: null,
    isSystem: true,
    baseRole: "employee",
    permissions: ["employee.portal.view"],
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "role_tpl_customer",
    name: "Customer",
    description: "Client portal.",
    companyId: null,
    isSystem: true,
    baseRole: "customer",
    permissions: ["customer.portal.view"],
    createdAt: "2026-01-01T00:00:00.000Z",
  },
];

describe("selectCompanyRoles", () => {
  it("returns the company's own roles and excludes global templates", () => {
    const companyRole: Role = {
      id: systemRoleId("company_admin", COMPANY),
      name: "Company Admin",
      description: "",
      companyId: COMPANY,
      isSystem: true,
      baseRole: "company_admin",
      permissions: ["settings.manage"],
      createdAt: "2026-02-01T00:00:00.000Z",
    };

    const result = selectCompanyRoles([...TEMPLATES, companyRole], COMPANY);

    expect(result).toEqual([companyRole]);
    // No global template leaks into the company admin panel.
    expect(result.every((r) => r.companyId !== null)).toBe(true);
  });

  it("is blank when only global templates exist (the bug 0046 backfills away)", () => {
    expect(selectCompanyRoles(TEMPLATES, COMPANY)).toEqual([]);
  });

  it("scopes to the given company and ignores other companies' roles", () => {
    const mine: Role = {
      id: systemRoleId("employee", COMPANY),
      name: "Employee",
      description: "",
      companyId: COMPANY,
      isSystem: true,
      baseRole: "employee",
      permissions: [],
      createdAt: "2026-02-01T00:00:00.000Z",
    };
    const theirs: Role = { ...mine, id: systemRoleId("employee", OTHER), companyId: OTHER };

    expect(selectCompanyRoles([mine, theirs], COMPANY)).toEqual([mine]);
  });

  it("returns empty for a null company (platform super admin has no company panel)", () => {
    expect(selectCompanyRoles(TEMPLATES, null)).toEqual([]);
  });
});

describe("selectCustomGlobalTemplates", () => {
  /** The global Prospect custom template (companyId null, no base role). */
  const prospectTemplate: Role = {
    id: "role_tpl_prospect",
    name: "Prospect",
    description: "Prospective contact.",
    companyId: null,
    isSystem: true,
    permissions: [],
    createdAt: "2026-01-01T00:00:00.000Z",
  };

  it("returns global templates that are not one of the four base roles", () => {
    const result = selectCustomGlobalTemplates([...TEMPLATES, prospectTemplate]);

    expect(result.map((r) => r.id)).toEqual(["role_tpl_prospect"]);
    // Never surfaces a base-role template (those carry a baseRole).
    expect(result.every((r) => !r.baseRole)).toBe(true);
  });

  it("excludes company-scoped custom roles (only global templates belong here)", () => {
    const companyProspect: Role = {
      id: `role_${COMPANY}_prospect`,
      name: "Prospect",
      description: "",
      companyId: COMPANY,
      isSystem: true,
      permissions: [],
      createdAt: "2026-02-01T00:00:00.000Z",
    };

    const result = selectCustomGlobalTemplates([prospectTemplate, companyProspect]);

    expect(result).toEqual([prospectTemplate]);
  });

  it("is empty when only base-role templates exist", () => {
    expect(selectCustomGlobalTemplates(TEMPLATES)).toEqual([]);
  });
});

describe("buildCompanyRoleSeedPlan", () => {
  it("derives one company-scoped role per company base role, excluding super_admin", () => {
    const plan = buildCompanyRoleSeedPlan(TEMPLATES, COMPANY);

    expect(plan.map((r) => r.baseRole)).toEqual(["company_admin", "employee", "customer"]);
    expect(plan.some((r) => r.baseRole === "super_admin")).toBe(false);
  });

  it("inherits permissions from the template and rewrites id/companyId/isSystem", () => {
    const plan = buildCompanyRoleSeedPlan(TEMPLATES, COMPANY);
    const admin = plan.find((r) => r.baseRole === "company_admin");

    expect(admin).toBeDefined();
    expect(admin?.id).toBe(systemRoleId("company_admin", COMPANY));
    expect(admin?.companyId).toBe(COMPANY);
    expect(admin?.isSystem).toBe(true);
    // Permissions copied verbatim from the global template.
    expect(admin?.permissions).toEqual(["settings.manage", "roles.manage", "employees.manage"]);
  });

  it("is idempotent: re-running with the seeded roles present yields no new rows", () => {
    const first = buildCompanyRoleSeedPlan(TEMPLATES, COMPANY);
    expect(first).toHaveLength(3);

    // Second pass treats the just-seeded rows as existing → nothing to insert.
    const second = buildCompanyRoleSeedPlan(TEMPLATES, COMPANY, first);
    expect(second).toEqual([]);
  });

  it("only fills the gaps when some company roles already exist", () => {
    const existingEmployee: Role = {
      id: systemRoleId("employee", COMPANY),
      name: "Employee",
      description: "",
      companyId: COMPANY,
      isSystem: true,
      baseRole: "employee",
      permissions: [],
      createdAt: "2026-02-01T00:00:00.000Z",
    };

    const plan = buildCompanyRoleSeedPlan(TEMPLATES, COMPANY, [existingEmployee]);

    expect(plan.map((r) => r.baseRole)).toEqual(["company_admin", "customer"]);
  });

  it("produces a non-blank company panel once the plan is applied", () => {
    const seeded = buildCompanyRoleSeedPlan(TEMPLATES, COMPANY);
    const directory = [...TEMPLATES, ...seeded];

    const panel = selectCompanyRoles(directory, COMPANY);

    expect(panel).toHaveLength(3);
    expect(panel.every((r) => r.companyId === COMPANY)).toBe(true);
  });

  it("does nothing when no global templates exist", () => {
    expect(buildCompanyRoleSeedPlan([], COMPANY)).toEqual([]);
  });
});

describe("buildGlobalRoleTemplates (migration 0047 mirror)", () => {
  it("seeds the four global templates as company-null system rows", () => {
    const templates = buildGlobalRoleTemplates();

    expect(templates.map((r) => r.baseRole)).toEqual([
      "super_admin",
      "company_admin",
      "employee",
      "customer",
    ]);
    expect(templates.every((r) => r.companyId === null)).toBe(true);
    expect(templates.every((r) => r.isSystem)).toBe(true);
    // Deterministic template ids match systemRoleId(base, null).
    expect(templates.map((r) => r.id)).toEqual([
      "role_tpl_super_admin",
      "role_tpl_company_admin",
      "role_tpl_employee",
      "role_tpl_customer",
    ]);
  });

  it("inherits the canonical default permissions for every base role", () => {
    const templates = buildGlobalRoleTemplates();
    const bases: UserRole[] = ["super_admin", "company_admin", "employee", "customer"];
    for (const base of bases) {
      const tpl = templates.find((r) => r.baseRole === base);
      expect(tpl?.permissions).toEqual(DEFAULT_ROLE_PERMISSIONS[base]);
    }
  });

  it("turns a blank company panel into the three company roles (the 0047 → 0046 fix)", () => {
    const templates = buildGlobalRoleTemplates();

    // Before: only global templates exist in the directory → panel BLANK (the live bug).
    expect(selectCompanyRoles(templates, COMPANY)).toEqual([]);

    // Seed the company roles from the templates, then the panel is populated.
    const seeded = buildCompanyRoleSeedPlan(templates, COMPANY);
    const panel = selectCompanyRoles([...templates, ...seeded], COMPANY);

    expect(panel.map((r) => r.baseRole)).toEqual([...COMPANY_SCOPED_BASE_ROLES]);
    expect(panel.every((r) => r.companyId === COMPANY)).toBe(true);
    // super_admin is platform-only — never copied into a company.
    expect(panel.some((r) => r.baseRole === "super_admin")).toBe(false);
  });

  it("is idempotent end-to-end: re-seeding from the templates adds nothing", () => {
    const templates = buildGlobalRoleTemplates();
    const first = buildCompanyRoleSeedPlan(templates, COMPANY);
    expect(first).toHaveLength(3);

    const second = buildCompanyRoleSeedPlan(templates, COMPANY, [...templates, ...first]);
    expect(second).toEqual([]);
  });
});
