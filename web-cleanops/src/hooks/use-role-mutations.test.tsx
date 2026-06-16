import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { Role } from "@/types";

vi.mock("@/lib/data/supabaseRoleRepository", () => ({
  createCompanyRoleInSupabase: vi.fn(),
  updateRoleInSupabase: vi.fn(),
}));

vi.mock("@/lib/data/roleDirectoryRefresh", () => ({
  bumpRoleDirectoryRefresh: vi.fn(),
}));

vi.mock("@/lib/store", () => ({
  saveRoles: vi.fn(),
}));

vi.mock("@/lib/data/roleDualWrite", () => ({
  mirrorRoleWrites: vi.fn(),
}));

import {
  createCompanyRoleInSupabase,
  updateRoleInSupabase,
} from "@/lib/data/supabaseRoleRepository";
import { bumpRoleDirectoryRefresh } from "@/lib/data/roleDirectoryRefresh";
import { saveRoles } from "@/lib/store";
import { mirrorRoleWrites } from "@/lib/data/roleDualWrite";
import { useRoleMutations } from "./use-role-mutations";

const COMPANY = "cmp_stad";

const companyRole: Role = {
  id: "role_company_custom",
  companyId: COMPANY,
  name: "Site Supervisor",
  description: "Leads site operations",
  isSystem: false,
  permissions: ["customers.view"],
  createdAt: "2026-01-01T00:00:00.000Z",
};

const globalSystemRole: Role = {
  id: "role_tpl_super_admin",
  companyId: null,
  name: "Super Admin",
  description: "Platform owner",
  isSystem: true,
  baseRole: "super_admin",
  permissions: ["companies.manage"],
  createdAt: "2026-01-01T00:00:00.000Z",
};

const createRoleMock = vi.mocked(createCompanyRoleInSupabase);
const updateRoleMock = vi.mocked(updateRoleInSupabase);
const refreshMock = vi.mocked(bumpRoleDirectoryRefresh);
const saveRolesMock = vi.mocked(saveRoles);
const mirrorRoleWritesMock = vi.mocked(mirrorRoleWrites);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return { wrapper, invalidateSpy };
}

beforeEach(() => {
  vi.clearAllMocks();
  createRoleMock.mockResolvedValue(companyRole);
  updateRoleMock.mockResolvedValue(companyRole);
});

describe("useRoleMutations CORE-WRITES-A2.1", () => {
  it("creates company roles through Supabase only and refreshes the directory", async () => {
    const { wrapper, invalidateSpy } = createWrapper();
    const getItemSpy = vi.spyOn(Storage.prototype, "getItem");
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    const sessionGetSpy = vi.spyOn(sessionStorage, "getItem");
    const sessionSetSpy = vi.spyOn(sessionStorage, "setItem");
    const { result } = renderHook(
      () => useRoleMutations({ companyId: COMPANY, isSuperAdmin: false, canManageRoles: true }),
      { wrapper },
    );

    await result.current.createCompanyRole({
      name: "Site Supervisor",
      description: "Leads site operations",
      permissions: ["customers.view"],
    });

    expect(createRoleMock).toHaveBeenCalledWith({
      companyId: COMPANY,
      name: "Site Supervisor",
      description: "Leads site operations",
      permissions: ["customers.view"],
    });
    expect(updateRoleMock).not.toHaveBeenCalled();
    expect(saveRolesMock).not.toHaveBeenCalled();
    expect(mirrorRoleWritesMock).not.toHaveBeenCalled();
    expect(getItemSpy).not.toHaveBeenCalled();
    expect(setItemSpy).not.toHaveBeenCalled();
    expect(sessionGetSpy).not.toHaveBeenCalled();
    expect(sessionSetSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["role-directory"] }),
    );

    getItemSpy.mockRestore();
    setItemSpy.mockRestore();
    sessionGetSpy.mockRestore();
    sessionSetSpy.mockRestore();
  });

  it("updates company roles through Supabase only", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useRoleMutations({ companyId: COMPANY, isSuperAdmin: false, canManageRoles: true }),
      { wrapper },
    );

    await result.current.updateRole({
      role: companyRole,
      patch: { name: "Updated Role", permissions: ["employees.view"] },
    });

    expect(updateRoleMock).toHaveBeenCalledWith(COMPANY, "role_company_custom", {
      name: "Updated Role",
      permissions: ["employees.view"],
    });
    expect(createRoleMock).not.toHaveBeenCalled();
    expect(saveRolesMock).not.toHaveBeenCalled();
  });

  it("allows Super Admin to update existing global system roles", async () => {
    updateRoleMock.mockResolvedValueOnce(globalSystemRole);
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useRoleMutations({ companyId: null, isSuperAdmin: true, canManageRoles: true }),
      { wrapper },
    );

    await result.current.updateRole({
      role: globalSystemRole,
      patch: { description: "Updated", permissions: ["roles.manage"] },
    });

    expect(updateRoleMock).toHaveBeenCalledWith(null, "role_tpl_super_admin", {
      description: "Updated",
      permissions: ["roles.manage"],
    });
    expect(createRoleMock).not.toHaveBeenCalled();
  });

  it("keeps Super Admin global custom create disabled", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useRoleMutations({ companyId: null, isSuperAdmin: true, canManageRoles: true }),
      { wrapper },
    );

    await expect(
      result.current.createCompanyRole({ name: "Global Custom", description: "Deferred", permissions: [] }),
    ).rejects.toThrow(/Global custom role creation is not enabled yet/);

    expect(createRoleMock).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("fails closed when company role creation has no company context", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useRoleMutations({ companyId: " ", isSuperAdmin: false, canManageRoles: true }),
      { wrapper },
    );

    await expect(
      result.current.createCompanyRole({ name: "Blocked", description: "", permissions: [] }),
    ).rejects.toThrow(/company context/i);

    expect(createRoleMock).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("does not refresh when Supabase role write fails", async () => {
    createRoleMock.mockRejectedValueOnce(new Error("supabase failed"));
    const { wrapper, invalidateSpy } = createWrapper();
    const { result } = renderHook(
      () => useRoleMutations({ companyId: COMPANY, isSuperAdmin: false, canManageRoles: true }),
      { wrapper },
    );

    await expect(
      result.current.createCompanyRole({ name: "Broken", description: "", permissions: [] }),
    ).rejects.toThrow("supabase failed");

    expect(refreshMock).not.toHaveBeenCalled();
    expect(invalidateSpy).not.toHaveBeenCalled();
    expect(saveRolesMock).not.toHaveBeenCalled();
  });
});
