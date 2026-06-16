import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  createRole: vi.fn(),
  onViewAssignedUsers: vi.fn(),
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    disabled,
    onClick,
  }: {
    children: React.ReactNode;
    disabled?: boolean;
    onClick?: () => void;
  }) => (
    <button type="button" disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
  DropdownMenuSeparator: () => <hr />,
}));

vi.mock("@/components/roles/RoleDialog", () => ({
  RoleDialog: () => null,
}));

vi.mock("@/components/roles/RoleMembersDialog", () => ({
  RoleMembersDialog: () => null,
}));

vi.mock("@/components/roles/RolePermissionsDialog", () => ({
  RolePermissionsDialog: () => null,
}));

vi.mock("@/context/AppContext", () => ({
  useApp: () => ({
    createRole: mocks.createRole,
    roles: [
      {
        id: "role_tpl_super_admin",
        companyId: null,
        name: "Super Admin",
        description: "Platform owners",
        isSystem: true,
        baseRole: "super_admin",
        permissions: ["roles.manage"],
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "role_tpl_company_admin",
        companyId: null,
        name: "Company Admin",
        description: "Company owners",
        isSystem: true,
        baseRole: "company_admin",
        permissions: ["roles.manage"],
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "role_tpl_employee",
        companyId: null,
        name: "Employee",
        description: "Employees",
        isSystem: true,
        baseRole: "employee",
        permissions: ["customers.view"],
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "role_tpl_customer",
        companyId: null,
        name: "Customer",
        description: "Customers",
        isSystem: true,
        baseRole: "customer",
        permissions: ["my_cleaning_protocols.view"],
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  }),
}));

vi.mock("@/hooks/use-assigned-users", () => ({
  useAssignedUsers: () => ({ roster: [] }),
}));

import { RoleTemplatesGrid } from "./RoleTemplatesGrid";

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CORE-WRITES-A2.1 RoleTemplatesGrid", () => {
  it("keeps Super Admin duplicate/global custom role creation disabled", () => {
    render(<RoleTemplatesGrid onViewAssignedUsers={mocks.onViewAssignedUsers} />);

    const duplicateButtons = screen.getAllByRole("button", { name: /Duplicate role \(deferred\)/i });
    expect(duplicateButtons.length).toBeGreaterThan(0);
    for (const button of duplicateButtons) {
      expect(button).toBeDisabled();
      fireEvent.click(button);
    }

    expect(mocks.createRole).not.toHaveBeenCalled();
  });
});
