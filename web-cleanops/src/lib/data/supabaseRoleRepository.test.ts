import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  upsert: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  maybeSingle: vi.fn(),
  loadCompanyUuidMap: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    from: vi.fn((table: string) => {
      if (table !== "roles") throw new Error(`Unexpected table ${table}`);
      return {
        upsert: mocks.upsert,
        select: mocks.select,
      };
    }),
  },
}));

vi.mock("./customerMigration", () => ({
  loadCompanyUuidMap: mocks.loadCompanyUuidMap,
}));

import { createCompanyRoleInSupabase, updateRoleInSupabase } from "./supabaseRoleRepository";

const COMPANY = "cmp_stad";
const COMPANY_UUID = "00000000-0000-4000-8000-000000000001";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadCompanyUuidMap.mockResolvedValue(new Map([[COMPANY, COMPANY_UUID]]));
  mocks.upsert.mockResolvedValue({ error: null });
  mocks.select.mockReturnValue({ eq: mocks.eq });
  mocks.eq.mockReturnValue({ maybeSingle: mocks.maybeSingle });
});

describe("supabaseRoleRepository CORE-WRITES-A2.1", () => {
  it("creates company-scoped custom roles through Supabase only", async () => {
    const getItemSpy = vi.spyOn(Storage.prototype, "getItem");
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    const sessionGetSpy = vi.spyOn(sessionStorage, "getItem");
    const sessionSetSpy = vi.spyOn(sessionStorage, "setItem");

    const saved = await createCompanyRoleInSupabase({
      companyId: COMPANY,
      name: "Site Supervisor",
      description: "Leads site operations",
      permissions: ["customers.view", "employees.view"],
    });

    expect(saved.companyId).toBe(COMPANY);
    expect(saved.isSystem).toBe(false);
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
    const rows = mocks.upsert.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(rows[0]).toMatchObject({
      company_id: COMPANY_UUID,
      company_legacy_id: COMPANY,
      name: "Site Supervisor",
      base_role: null,
      is_system: false,
      deleted_at: null,
    });
    expect(rows[0].data).toMatchObject({
      companyId: COMPANY,
      name: "Site Supervisor",
      description: "Leads site operations",
      isSystem: false,
      permissions: ["customers.view", "employees.view"],
    });
    expect(mocks.upsert.mock.calls[0][1]).toEqual({ onConflict: "legacy_id" });
    expect(getItemSpy).not.toHaveBeenCalled();
    expect(setItemSpy).not.toHaveBeenCalled();
    expect(sessionGetSpy).not.toHaveBeenCalled();
    expect(sessionSetSpy).not.toHaveBeenCalled();

    getItemSpy.mockRestore();
    setItemSpy.mockRestore();
    sessionGetSpy.mockRestore();
    sessionSetSpy.mockRestore();
  });

  it("fails closed when a company-scoped role has no Supabase company UUID", async () => {
    mocks.loadCompanyUuidMap.mockResolvedValueOnce(new Map());

    await expect(
      createCompanyRoleInSupabase({
        companyId: COMPANY,
        name: "Blocked Role",
        description: "No UUID",
        permissions: [],
      }),
    ).rejects.toThrow(/No Supabase company found/);

    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("updates company roles only after reading the existing row in the exact scope", async () => {
    mocks.maybeSingle.mockResolvedValueOnce({
      error: null,
      data: {
        company_legacy_id: COMPANY,
        deleted_at: null,
        data: {
          id: "role_company_custom",
          companyId: COMPANY,
          name: "Old Role",
          description: "Old",
          isSystem: false,
          permissions: ["customers.view"],
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      },
    });

    const updated = await updateRoleInSupabase(COMPANY, "role_company_custom", {
      name: "Updated Role",
      description: "Updated",
      permissions: ["customers.view", "employees.view"],
    });

    expect(updated.name).toBe("Updated Role");
    expect(updated.permissions).toEqual(["customers.view", "employees.view"]);
    const rows = mocks.upsert.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(rows[0]).toMatchObject({
      legacy_id: "role_company_custom",
      company_id: COMPANY_UUID,
      company_legacy_id: COMPANY,
      name: "Updated Role",
      base_role: null,
      is_system: false,
    });
  });

  it("preserves structural/system fields when Super Admin updates a global system role", async () => {
    mocks.maybeSingle.mockResolvedValueOnce({
      error: null,
      data: {
        company_legacy_id: null,
        deleted_at: null,
        data: {
          id: "role_tpl_super_admin",
          companyId: null,
          name: "Super Admin",
          description: "Old description",
          isSystem: true,
          baseRole: "super_admin",
          permissions: ["companies.manage"],
          templateId: "tpl_original",
          isActive: true,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      },
    });

    const updated = await updateRoleInSupabase(null, "role_tpl_super_admin", {
      name: "Hacked Name",
      description: "Updated description",
      permissions: ["companies.manage", "roles.manage"],
    });

    expect(updated).toMatchObject({
      id: "role_tpl_super_admin",
      companyId: null,
      name: "Super Admin",
      description: "Updated description",
      isSystem: true,
      baseRole: "super_admin",
      templateId: "tpl_original",
      isActive: true,
    });
    const rows = mocks.upsert.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(rows[0]).toMatchObject({
      legacy_id: "role_tpl_super_admin",
      company_id: null,
      company_legacy_id: null,
      name: "Super Admin",
      base_role: "super_admin",
      is_system: true,
    });
  });

  it("rejects updates when the stored role scope does not match the requested scope", async () => {
    mocks.maybeSingle.mockResolvedValueOnce({
      error: null,
      data: {
        company_legacy_id: null,
        deleted_at: null,
        data: {
          id: "role_tpl_employee",
          companyId: null,
          name: "Employee",
          description: "Global",
          isSystem: true,
          baseRole: "employee",
          permissions: [],
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      },
    });

    await expect(
      updateRoleInSupabase(COMPANY, "role_tpl_employee", { description: "Blocked" }),
    ).rejects.toThrow(/not found/i);

    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});
