import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { UserRole } from "@/types";

const mocks = vi.hoisted(() => ({ useApp: vi.fn() }));

vi.mock("@/context/AppContext", () => ({ useApp: () => mocks.useApp() }));
vi.mock("@/hooks/use-sidebar", () => ({
  useSidebarCollapsed: () => ({ collapsed: false, setCollapsed: vi.fn(), toggle: vi.fn() }),
}));
vi.mock("@/hooks/use-customer-write-failure-toast", () => ({
  useCustomerWriteFailureToast: () => {},
}));
vi.mock("@/components/layout/ViewAsBanner", () => ({ ViewAsBanner: () => null }));
vi.mock("@/hooks/use-navigation-config-admin", () => ({
  useNavigationMainNav: () => new Map(),
}));

import { DashboardLayout } from "./DashboardLayout";

function setAppState(role: UserRole | null, permissions: string[]): void {
  const granted = new Set<string>(permissions);
  mocks.useApp.mockReturnValue({
    currentUser: role
      ? {
          id: "usr_test",
          name: "Test Admin",
          role,
          companyId: role === "super_admin" ? null : "cmp_1",
        }
      : null,
    companies: [],
    logout: vi.fn(),
    hasPermission: (permission: string) => granted.has(permission),
    canAccessModule: () => false,
    getNavModuleGroups: () => [],
    getMyProtocols: () => [],
  });
}

function renderLayout() {
  return render(
    <MemoryRouter>
      <DashboardLayout>
        <div>Page body</div>
      </DashboardLayout>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("DashboardLayout — Administration Center nav visibility", () => {
  it("shows the Administration Center nav item for a Super Admin with the existing platform settings permission", () => {
    setAppState("super_admin", ["settings_templates.manage"]);
    renderLayout();

    const link = screen.getByRole("link", { name: "Administration Center" });
    expect(link).toHaveAttribute("href", "/administration");
  });

  it("hides the Administration Center nav item for a Super Admin missing the existing platform settings permission", () => {
    setAppState("super_admin", []);
    renderLayout();

    expect(screen.queryByRole("link", { name: "Administration Center" })).not.toBeInTheDocument();
  });

  it("does not add Administration Center to the curated Company Admin sidebar", () => {
    setAppState("company_admin", ["settings_templates.manage"]);
    renderLayout();

    expect(screen.queryByRole("link", { name: "Administration Center" })).not.toBeInTheDocument();
  });
});
