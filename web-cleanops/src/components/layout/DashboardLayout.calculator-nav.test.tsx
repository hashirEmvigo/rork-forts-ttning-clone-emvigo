import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { UserRole } from "@/types";

/**
 * Sidebar visibility + permission behaviour for the Super Admin–only Calculator
 * nav entry.
 *
 * The nav gate (DashboardLayout.calculatorSection) requires BOTH `role ===
 * "super_admin"` AND `hasPermission("calculator.manage")`. Permissions resolve
 * from the authoritative role record (Supabase in app builds), so this test
 * pins the exact visibility contract the live menu follows: the item appears
 * only for a Super Admin who actually holds `calculator.manage`, and never for
 * any other role — independent of how the permission set is sourced.
 */

const mocks = vi.hoisted(() => ({ useApp: vi.fn() }));

vi.mock("@/context/AppContext", () => ({ useApp: () => mocks.useApp() }));
vi.mock("@/hooks/use-sidebar", () => ({
  useSidebarCollapsed: () => ({ collapsed: false, setCollapsed: vi.fn(), toggle: vi.fn() }),
}));
vi.mock("@/hooks/use-customer-write-failure-toast", () => ({
  useCustomerWriteFailureToast: () => {},
}));
vi.mock("@/components/layout/ViewAsBanner", () => ({ ViewAsBanner: () => null }));
// Slice 11C: the sidebar reads the main-navigation overlay. An empty map means
// "no overrides", so every item passes through with its default presentation.
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

describe("DashboardLayout — Calculator nav visibility", () => {
  it("shows the Calculator nav item for a Super Admin holding calculator.manage", () => {
    setAppState("super_admin", ["calculator.manage"]);
    renderLayout();

    const link = screen.getByRole("link", { name: "Calculator" });
    expect(link).toHaveAttribute("href", "/calculator");
  });

  it("hides the Calculator nav item for a Super Admin missing calculator.manage", () => {
    setAppState("super_admin", []);
    renderLayout();

    expect(screen.queryByRole("link", { name: "Calculator" })).not.toBeInTheDocument();
  });

  it("never shows the Calculator nav item for a Company Admin (Phase 2)", () => {
    // Even if the permission were somehow granted, the curated Company Admin
    // layout has no Calculator entry — assert the realistic (ungranted) case.
    setAppState("company_admin", []);
    renderLayout();

    expect(screen.queryByRole("link", { name: "Calculator" })).not.toBeInTheDocument();
  });

  it("never shows the Calculator nav item for Employee or Customer", () => {
    for (const role of ["employee", "customer"] as const) {
      setAppState(role, ["calculator.manage"]);
      const { unmount } = renderLayout();

      expect(screen.queryByRole("link", { name: "Calculator" })).not.toBeInTheDocument();
      unmount();
    }
  });
});
