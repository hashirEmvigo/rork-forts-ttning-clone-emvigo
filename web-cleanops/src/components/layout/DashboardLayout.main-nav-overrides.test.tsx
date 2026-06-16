import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { UserRole } from "@/types";
import type { MainNavPresentation } from "@/lib/navigation/navigationRegistry";

/**
 * Slice 11C — the main sidebar consumes the navigation registry/override
 * PRESENTATION overlay (label / icon / visibility), matched by route. These
 * tests pin the contract: overrides relabel/re-icon/hide existing items, never
 * grant access (the permission gate runs first), and the route + active state
 * are preserved.
 */

const mocks = vi.hoisted(() => ({
  useApp: vi.fn(),
  mainNav: new Map<string, MainNavPresentation>(),
}));

vi.mock("@/context/AppContext", () => ({ useApp: () => mocks.useApp() }));
vi.mock("@/hooks/use-sidebar", () => ({
  useSidebarCollapsed: () => ({ collapsed: false, setCollapsed: vi.fn(), toggle: vi.fn() }),
}));
vi.mock("@/hooks/use-customer-write-failure-toast", () => ({
  useCustomerWriteFailureToast: () => {},
}));
vi.mock("@/components/layout/ViewAsBanner", () => ({ ViewAsBanner: () => null }));
vi.mock("@/hooks/use-navigation-config-admin", () => ({
  useNavigationMainNav: () => mocks.mainNav,
}));

import { DashboardLayout } from "./DashboardLayout";

const SUPER_ADMIN_PERMISSIONS = [
  "dashboard.view",
  "companies.manage",
  "users.manage",
  "settings_templates.manage",
  "calculator.manage",
  "settings.manage",
];

function setApp(role: UserRole, permissions: string[]): void {
  const granted = new Set<string>(permissions);
  mocks.useApp.mockReturnValue({
    currentUser: {
      id: "usr_test",
      name: "Test Admin",
      role,
      companyId: role === "super_admin" ? null : "cmp_1",
    },
    companies: [],
    logout: vi.fn(),
    hasPermission: (permission: string) => granted.has(permission),
    canAccessModule: () => false,
    getNavModuleGroups: () => [],
    getMyProtocols: () => [],
  });
}

function renderLayout(path = "/dashboard") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <DashboardLayout>
        <div>Page body</div>
      </DashboardLayout>
    </MemoryRouter>,
  );
}

function present(over: Partial<MainNavPresentation> & { key: string }): MainNavPresentation {
  return { label: "", iconKey: "Folder", isVisible: true, ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.mainNav = new Map();
  setApp("super_admin", SUPER_ADMIN_PERMISSIONS);
});

describe("DashboardLayout — main-nav overlay", () => {
  it("renders default labels when there are no overrides (resilient fallback)", () => {
    renderLayout();
    expect(screen.getByRole("link", { name: "Customers" })).toHaveAttribute("href", "/customers");
    expect(screen.getByRole("link", { name: "Companies" })).toBeInTheDocument();
  });

  it("applies a custom label override (matched by route)", () => {
    mocks.mainNav = new Map([
      ["/customers", present({ key: "main.customers", label: "Clients", iconKey: "Star" })],
    ]);
    renderLayout();

    const link = screen.getByRole("link", { name: "Clients" });
    expect(link).toHaveAttribute("href", "/customers"); // route is unchanged
    expect(screen.queryByRole("link", { name: "Customers" })).not.toBeInTheDocument();
  });

  it("applies a custom icon override (matched by route)", () => {
    mocks.mainNav = new Map([
      ["/customers", present({ key: "main.customers", label: "Clients", iconKey: "Star" })],
    ]);
    renderLayout();

    const svg = screen.getByRole("link", { name: "Clients" }).querySelector("svg");
    expect(svg?.getAttribute("class") ?? "").toContain("star");
  });

  it("hides a menu item when an override marks it not visible", () => {
    mocks.mainNav = new Map([
      ["/companies", present({ key: "main.companies", label: "Companies", isVisible: false })],
    ]);
    renderLayout();

    expect(screen.queryByRole("link", { name: "Companies" })).not.toBeInTheDocument();
    // A non-hidden sibling still renders.
    expect(screen.getByRole("link", { name: "Customers" })).toBeInTheDocument();
  });

  it("keeps permission authoritative — a 'visible' override cannot reveal a gated item", () => {
    // Super Admin WITHOUT companies.manage: the sidebar drops Companies before
    // the overlay runs, so a visible override can never add it back.
    setApp("super_admin", SUPER_ADMIN_PERMISSIONS.filter((p) => p !== "companies.manage"));
    mocks.mainNav = new Map([
      ["/companies", present({ key: "main.companies", label: "Companies", isVisible: true })],
    ]);
    renderLayout();

    expect(screen.queryByRole("link", { name: "Companies" })).not.toBeInTheDocument();
  });

  it("preserves the active-route highlight on a relabelled item", () => {
    mocks.mainNav = new Map([
      ["/customers", present({ key: "main.customers", label: "Clients", iconKey: "Star" })],
    ]);
    renderLayout("/customers");

    const link = screen.getByRole("link", { name: "Clients" });
    expect(link.className).toContain("bg-sidebar-accent");
  });
});
