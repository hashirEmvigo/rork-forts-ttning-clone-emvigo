import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AUTH_RESTORE_FALLBACK_MS, ProtectedRoute } from "@/components/ProtectedRoute";

const mocks = vi.hoisted(() => ({
  logout: vi.fn(),
  useApp: vi.fn(),
}));

vi.mock("@/context/AppContext", () => ({
  useApp: () => mocks.useApp(),
}));

interface MockUser {
  id: string;
  name: string;
  role: "super_admin" | "company_admin" | "employee" | "customer";
  companyId: string | null;
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderProtectedRoute(path: string, requirePermission = "users.manage") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/customers"
          element={
            <ProtectedRoute requirePermission={requirePermission}>
              <div>Customers page</div>
            </ProtectedRoute>
          }
        />
        <Route
          path="/services"
          element={
            <ProtectedRoute allow={["super_admin"]} requirePermission="settings_templates.manage">
              <div>Services page</div>
            </ProtectedRoute>
          }
        />
        <Route
          path="/crm/dashboard"
          element={
            <ProtectedRoute
              allow={["super_admin", "company_admin"]}
              requirePermission="requests.view"
              requireModule="admin-requests"
            >
              <div>CRM operational page</div>
            </ProtectedRoute>
          }
        />
        <Route path="/login" element={<><div>Login page</div><LocationProbe /></>} />
        <Route path="/dashboard" element={<><div>Dashboard page</div><LocationProbe /></>} />
        <Route path="/" element={<><div>Overview page</div><LocationProbe /></>} />
      </Routes>
    </MemoryRouter>,
  );
}

function setAppState(input: {
  currentUser: MockUser | null;
  isAuthRestoring?: boolean;
  permissions?: string[];
  /** Module ids `canAccessModule` should resolve as accessible for this user. */
  modules?: string[];
}) {
  const permissions = new Set<string>(input.permissions ?? []);
  const modules = new Set<string>(input.modules ?? []);
  mocks.useApp.mockReturnValue({
    currentUser: input.currentUser,
    isAuthRestoring: input.isAuthRestoring ?? false,
    hasPermission: (permission: string) => permissions.has(permission),
    canAccessModule: (_user: MockUser, moduleId: string) => modules.has(moduleId),
    logout: mocks.logout,
  });
}

describe("ProtectedRoute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("preserves a protected route after a valid session/profile hydrates", () => {
    const user: MockUser = {
      id: "usr_admin",
      name: "Admin",
      role: "company_admin",
      companyId: "cmp_1",
    };
    setAppState({ currentUser: null, isAuthRestoring: true });
    const view = renderProtectedRoute("/customers");

    expect(screen.getByRole("status")).toHaveTextContent("Loading workspace");
    expect(screen.queryByText("Login page")).not.toBeInTheDocument();
    expect(screen.queryByText("Overview page")).not.toBeInTheDocument();

    setAppState({ currentUser: user, isAuthRestoring: false, permissions: ["users.manage"] });
    view.rerender(
      <MemoryRouter initialEntries={["/customers"]}>
        <Routes>
          <Route
            path="/customers"
            element={
              <ProtectedRoute requirePermission="users.manage">
                <div>Customers page</div>
              </ProtectedRoute>
            }
          />
          <Route path="/login" element={<div>Login page</div>} />
          <Route path="/" element={<div>Overview page</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("Customers page")).toBeInTheDocument();
    expect(screen.queryByText("Overview page")).not.toBeInTheDocument();
  });

  it("redirects an invalid or missing session to login", () => {
    setAppState({ currentUser: null, isAuthRestoring: false });

    renderProtectedRoute("/customers");

    expect(screen.getByText("Login page")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/login");
  });

  it("redirects an unauthorized protected route to a safe fallback", () => {
    const user: MockUser = {
      id: "usr_employee",
      name: "Employee",
      role: "employee",
      companyId: "cmp_1",
    };
    setAppState({ currentUser: user, permissions: [] });

    renderProtectedRoute("/services");

    expect(screen.getByText("Dashboard page")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/dashboard");
  });

  it("does not redirect to Overview while auth/profile state is still loading", () => {
    setAppState({ currentUser: null, isAuthRestoring: true });

    renderProtectedRoute("/customers");

    expect(screen.getByRole("status")).toHaveTextContent("Loading workspace");
    expect(screen.queryByText("Overview page")).not.toBeInTheDocument();
    expect(screen.queryByText("Login page")).not.toBeInTheDocument();
  });

  it("does not wait forever when auth/profile loading is stuck", () => {
    vi.useFakeTimers();
    setAppState({ currentUser: null, isAuthRestoring: true });

    renderProtectedRoute("/customers");

    expect(screen.getByRole("status")).toHaveTextContent("Loading workspace");

    act(() => {
      vi.advanceTimersByTime(AUTH_RESTORE_FALLBACK_MS);
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "We couldn’t finish loading your workspace.",
    );
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to login" })).toHaveAttribute("href", "/login");
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
    expect(screen.queryByText("Overview page")).not.toBeInTheDocument();
  });

  it("renders a module-gated route when permission AND module access are granted", () => {
    setAppState({
      currentUser: { id: "usr_ca", name: "Company Admin", role: "company_admin", companyId: "cmp_1" },
      permissions: ["requests.view"],
      modules: ["admin-requests"],
    });

    renderProtectedRoute("/crm/dashboard");

    expect(screen.getByText("CRM operational page")).toBeInTheDocument();
    expect(screen.queryByText("Dashboard page")).not.toBeInTheDocument();
  });

  it("redirects to the dashboard when the module is not accessible (permission alone is not enough)", () => {
    setAppState({
      currentUser: { id: "usr_ca", name: "Company Admin", role: "company_admin", companyId: "cmp_1" },
      permissions: ["requests.view"],
      modules: [],
    });

    renderProtectedRoute("/crm/dashboard");

    expect(screen.getByText("Dashboard page")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/dashboard");
    expect(screen.queryByText("CRM operational page")).not.toBeInTheDocument();
  });

  it("redirects a super admin whose company-scoped module is not usable", () => {
    // `canAccessModule` returns false for a Super Admin (no companyId); the gate
    // must therefore redirect them exactly like any other blocked user.
    setAppState({
      currentUser: { id: "usr_sa", name: "Super Admin", role: "super_admin", companyId: null },
      permissions: ["requests.view"],
      modules: [],
    });

    renderProtectedRoute("/crm/dashboard");

    expect(screen.getByText("Dashboard page")).toBeInTheDocument();
    expect(screen.queryByText("CRM operational page")).not.toBeInTheDocument();
  });

  it("enforces the permission gate before the module gate", () => {
    setAppState({
      currentUser: { id: "usr_ca", name: "Company Admin", role: "company_admin", companyId: "cmp_1" },
      permissions: [],
      modules: ["admin-requests"],
    });

    renderProtectedRoute("/crm/dashboard");

    expect(screen.getByText("Dashboard page")).toBeInTheDocument();
    expect(screen.queryByText("CRM operational page")).not.toBeInTheDocument();
  });

  it("offers sign out recovery from a stuck workspace load", () => {
    vi.useFakeTimers();
    setAppState({ currentUser: null, isAuthRestoring: true });

    renderProtectedRoute("/customers");

    act(() => {
      vi.advanceTimersByTime(AUTH_RESTORE_FALLBACK_MS);
    });

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

    expect(mocks.logout).toHaveBeenCalledTimes(1);
  });
});
