import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { Role } from "@/types";

const mocks = vi.hoisted(() => ({
  createCompanyRole: vi.fn(),
  updateRole: vi.fn(),
  toast: vi.fn(),
  hasPermission: vi.fn(() => true),
}));

vi.mock("@/context/AppContext", () => ({
  useApp: () => ({
    currentUser: {
      id: "usr_admin",
      name: "Admin",
      email: "admin@example.com",
      role: "company_admin",
      companyId: "cmp_stad",
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    hasPermission: mocks.hasPermission,
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("@/hooks/use-role-mutations", () => ({
  useRoleMutations: () => ({
    createCompanyRole: mocks.createCompanyRole,
    updateRole: mocks.updateRole,
    isPending: false,
    error: null,
  }),
}));

vi.mock("@/lib/store", () => ({
  saveRoles: vi.fn(),
}));

import { saveRoles } from "@/lib/store";
import { RoleDialog } from "./RoleDialog";

const companyRole: Role = {
  id: "role_company_custom",
  companyId: "cmp_stad",
  name: "Site Supervisor",
  description: "Leads sites",
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

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.createCompanyRole.mockResolvedValue(companyRole);
  mocks.updateRole.mockResolvedValue(companyRole);
});

describe("CORE-WRITES-A2.1 RoleDialog", () => {
  it("awaits Supabase company role create before closing", async () => {
    const onOpenChange = vi.fn();
    render(<RoleDialog open onOpenChange={onOpenChange} companyId="cmp_stad" />);

    fireEvent.change(screen.getByLabelText(/Role name/i), {
      target: { value: "Site Supervisor" },
    });
    fireEvent.change(screen.getByLabelText(/Description/i), {
      target: { value: "Leads sites" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Create role$/i }));

    await waitFor(() =>
      expect(mocks.createCompanyRole).toHaveBeenCalledWith({
        name: "Site Supervisor",
        description: "Leads sites",
        permissions: [],
      }),
    );
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(mocks.updateRole).not.toHaveBeenCalled();
    expect(saveRoles).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Role created" }));
  });

  it("keeps the dialog open and shows an error when Supabase role create fails", async () => {
    mocks.createCompanyRole.mockRejectedValueOnce(new Error("Supabase write failed"));
    const onOpenChange = vi.fn();
    render(<RoleDialog open onOpenChange={onOpenChange} companyId="cmp_stad" />);

    fireEvent.change(screen.getByLabelText(/Role name/i), {
      target: { value: "Broken Role" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Create role$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Supabase write failed");
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(saveRoles).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Couldn't save role", variant: "destructive" }),
    );
  });

  it("updates company roles through the Supabase mutation path only", async () => {
    const onOpenChange = vi.fn();
    render(<RoleDialog open onOpenChange={onOpenChange} companyId="cmp_stad" role={companyRole} />);

    fireEvent.change(screen.getByLabelText(/Role name/i), {
      target: { value: "Updated Supervisor" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save changes/i }));

    await waitFor(() =>
      expect(mocks.updateRole).toHaveBeenCalledWith({
        role: companyRole,
        patch: {
          name: "Updated Supervisor",
          description: "Leads sites",
          permissions: ["customers.view"],
        },
      }),
    );
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(mocks.createCompanyRole).not.toHaveBeenCalled();
    expect(saveRoles).not.toHaveBeenCalled();
  });

  it("does not send protected global/system fields from the edit form", async () => {
    mocks.updateRole.mockResolvedValueOnce(globalSystemRole);
    const onOpenChange = vi.fn();
    render(<RoleDialog open onOpenChange={onOpenChange} companyId={null} role={globalSystemRole} />);

    expect(screen.getByLabelText(/Role name/i)).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Description/i), {
      target: { value: "Updated platform owner" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save changes/i }));

    await waitFor(() =>
      expect(mocks.updateRole).toHaveBeenCalledWith({
        role: globalSystemRole,
        patch: {
          description: "Updated platform owner",
          permissions: ["companies.manage"],
        },
      }),
    );
    expect(mocks.updateRole.mock.calls[0][0].patch).not.toHaveProperty("name");
    expect(mocks.updateRole.mock.calls[0][0].patch).not.toHaveProperty("companyId");
    expect(mocks.updateRole.mock.calls[0][0].patch).not.toHaveProperty("baseRole");
    expect(mocks.updateRole.mock.calls[0][0].patch).not.toHaveProperty("isSystem");
    expect(saveRoles).not.toHaveBeenCalled();
  });
});
