import type { ReactNode } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProtectedRoute } from "@/components/ProtectedRoute";
import { ADMINISTRATION_CENTER_CATEGORIES } from "@/lib/administrationCenter/administrationCenterRegistry";
import type { UserRole } from "@/types";

const mocks = vi.hoisted(() => ({ useApp: vi.fn() }));

vi.mock("@/context/AppContext", () => ({ useApp: () => mocks.useApp() }));
vi.mock("@/components/layout/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/dashboard/PageHeader", () => ({
  PageHeader: ({ title, description, action }: { title: string; description?: string; action?: ReactNode }) => (
    <header>
      <h1>{title}</h1>
      {description ? <p>{description}</p> : null}
      {action}
    </header>
  ),
}));
vi.mock("@/components/AccessDenied", () => ({
  AccessDenied: () => <div data-testid="access-denied">Access denied</div>,
}));

import AdministrationCenter, {
  ADMINISTRATION_CENTER_PATH,
  ADMINISTRATION_CENTER_PERMISSION,
} from "./AdministrationCenter";

function setAppState(role: UserRole | null, permissions: string[] = []): void {
  const granted = new Set<string>(permissions);
  mocks.useApp.mockReturnValue({
    currentUser: role
      ? { id: "usr_test", name: "Test Admin", role, companyId: role === "super_admin" ? null : "cmp_1" }
      : null,
    isAuthRestoring: false,
    hasPermission: (permission: string) => granted.has(permission),
    canAccessModule: () => false,
    logout: vi.fn(),
  });
}

function renderHub() {
  return render(
    <MemoryRouter>
      <AdministrationCenter />
    </MemoryRouter>,
  );
}

function renderAdministrationRoute() {
  return render(
    <MemoryRouter initialEntries={[ADMINISTRATION_CENTER_PATH]}>
      <Routes>
        <Route
          path={ADMINISTRATION_CENTER_PATH}
          element={
            <ProtectedRoute allow={["super_admin"]} requirePermission={ADMINISTRATION_CENTER_PERMISSION}>
              <AdministrationCenter />
            </ProtectedRoute>
          }
        />
        <Route path="/dashboard" element={<div>Dashboard page</div>} />
        <Route path="/login" element={<div>Login page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AdministrationCenter hub", () => {
  it("lets a Super Admin access the Administration Center route", () => {
    setAppState("super_admin", [ADMINISTRATION_CENTER_PERMISSION]);
    renderAdministrationRoute();

    expect(screen.getByRole("heading", { name: "Administration Center" })).toBeInTheDocument();
    expect(screen.queryByText("Dashboard page")).not.toBeInTheDocument();
  });

  it("blocks non-Super Admin users at the route guard", () => {
    setAppState("company_admin", [ADMINISTRATION_CENTER_PERMISSION]);
    renderAdministrationRoute();

    expect(screen.getByText("Dashboard page")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Administration Center" })).not.toBeInTheDocument();
  });

  it("renders the internal left category navigation", () => {
    setAppState("super_admin", [ADMINISTRATION_CENTER_PERMISSION]);
    renderHub();

    expect(screen.getByTestId("administration-workspace")).toBeInTheDocument();
    expect(screen.getByTestId("administration-left-panel")).toBeInTheDocument();
    expect(screen.getByTestId("administration-category-nav")).toBeInTheDocument();
  });

  it("renders categories in the left panel from the registry", () => {
    setAppState("super_admin", [ADMINISTRATION_CENTER_PERMISSION]);
    renderHub();

    const leftPanel = screen.getByTestId("administration-left-panel");
    for (const category of ADMINISTRATION_CENTER_CATEGORIES) {
      expect(within(leftPanel).getByRole("button", { name: new RegExp(category.title, "i") })).toBeInTheDocument();
    }
  });

  it("shows only one selected category's content by default", () => {
    setAppState("super_admin", [ADMINISTRATION_CENTER_PERMISSION]);
    renderHub();

    const selectedCategory = screen.getByTestId("administration-selected-category");
    expect(within(selectedCategory).getByRole("heading", { name: "Companies & Users" })).toBeInTheDocument();
    expect(within(selectedCategory).getByRole("tab", { name: /Companies/i })).toBeInTheDocument();
    expect(within(selectedCategory).queryByRole("heading", { name: "Services & Pricing" })).not.toBeInTheDocument();
    expect(within(selectedCategory).queryByText("Calculator builder")).not.toBeInTheDocument();
  });

  it("shows the Companies & Users secondary item menu", () => {
    setAppState("super_admin", [ADMINISTRATION_CENTER_PERMISSION]);
    renderHub();

    fireEvent.click(screen.getByRole("button", { name: /Companies & Users/i }));

    const itemMenu = screen.getByTestId("administration-item-menu");
    expect(within(itemMenu).getByRole("tab", { name: /Companies/i })).toBeInTheDocument();
    expect(within(itemMenu).getByRole("tab", { name: /Users/i })).toBeInTheDocument();
    expect(within(itemMenu).getByRole("tab", { name: /Provisioning workflow/i })).toBeDisabled();
  });

  it("selecting a category swaps the focused workspace instead of rendering a long catalogue", () => {
    setAppState("super_admin", [ADMINISTRATION_CENTER_PERMISSION]);
    renderHub();

    fireEvent.click(screen.getByRole("button", { name: /Services & Pricing/i }));

    const selectedCategory = screen.getByTestId("administration-selected-category");
    expect(within(selectedCategory).getByRole("heading", { name: "Services & Pricing" })).toBeInTheDocument();
    expect(within(selectedCategory).getByRole("tab", { name: /Calculator/i })).toBeInTheDocument();
    expect(within(selectedCategory).queryByRole("heading", { name: "Companies & Users" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("administration-hub")).not.toBeInTheDocument();
  });

  it("renders the search field in the left panel", () => {
    setAppState("super_admin", [ADMINISTRATION_CENTER_PERMISSION]);
    renderHub();

    const leftPanel = screen.getByTestId("administration-left-panel");
    expect(within(leftPanel).getByTestId("administration-search-input")).toBeInTheDocument();
    expect(within(leftPanel).getByText("Local registry search only.")).toBeInTheDocument();
  });

  it("searching calculator shows calculator-related results in the main content area", () => {
    setAppState("super_admin", [ADMINISTRATION_CENTER_PERMISSION]);
    renderHub();

    fireEvent.change(screen.getByTestId("administration-search-input"), { target: { value: "calculator" } });

    const results = screen.getByTestId("administration-search-results");
    expect(within(results).getByText("Services & Pricing → Calculator builder")).toBeInTheDocument();
    expect(within(results).getByText("Pricing diagnostics")).toBeInTheDocument();
    expect(within(results).getByText(/not a backend search service or command palette/i)).toBeInTheDocument();
    expect(screen.queryByTestId("administration-selected-category")).not.toBeInTheDocument();
  });

  it("searching calculator aliases returns pricing-related results", () => {
    setAppState("super_admin", [ADMINISTRATION_CENTER_PERMISSION]);
    renderHub();

    fireEvent.change(screen.getByTestId("administration-search-input"), { target: { value: "quote" } });
    expect(within(screen.getByTestId("administration-search-results")).getByText("Services & Pricing → Calculator builder")).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("administration-search-input"), { target: { value: "estimate" } });
    const results = screen.getByTestId("administration-search-results");
    expect(within(results).getByText("Services & Pricing → Calculator builder")).toBeInTheDocument();
    expect(within(results).getByText("Pricing diagnostics")).toBeInTheDocument();
  });

  it("links active item details and search results to existing known routes", () => {
    setAppState("super_admin", [ADMINISTRATION_CENTER_PERMISSION]);
    renderHub();

    expect(screen.getByTestId("administration-item-detail")).toHaveTextContent("/companies");
    expect(screen.getByTestId("administration-existing-link")).toHaveAttribute("href", "/companies");

    fireEvent.change(screen.getByTestId("administration-search-input"), { target: { value: "calculator" } });
    const searchLinks = screen
      .getAllByTestId("administration-existing-link")
      .map((link) => link.getAttribute("href"));
    expect(searchLinks).toContain("/calculator");
  });

  it("keeps planned future items disabled and non-clickable", () => {
    setAppState("super_admin", [ADMINISTRATION_CENTER_PERMISSION]);
    renderHub();

    const itemMenu = screen.getByTestId("administration-item-menu");
    const plannedTab = within(itemMenu).getByRole("tab", { name: /Provisioning workflow/i });
    expect(plannedTab).toBeDisabled();

    fireEvent.change(screen.getByTestId("administration-search-input"), { target: { value: "pricing diagnostics" } });
    const results = screen.getByTestId("administration-search-results");
    const plannedResult = within(results).getByText("Pricing diagnostics").closest("[data-testid='administration-planned-item']");
    expect(plannedResult).not.toBeNull();
    expect(within(plannedResult as HTMLElement).getByRole("button", { name: /Later slice/i })).toBeDisabled();
    expect(within(plannedResult as HTMLElement).queryByRole("link")).not.toBeInTheDocument();
  });

  it("fails closed when the page is mounted directly by a non-Super Admin", () => {
    setAppState("company_admin", [ADMINISTRATION_CENTER_PERMISSION]);
    renderHub();

    expect(screen.getByTestId("access-denied")).toBeInTheDocument();
    expect(screen.queryByTestId("administration-workspace")).not.toBeInTheDocument();
  });
});
