import { render, screen } from "@testing-library/react";
import { MemoryRouter, Navigate, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProtectedRoute } from "@/components/ProtectedRoute";
import { REQUEST_CRM_MODULE_ID } from "@/lib/requestCrm/shellNav";
import type { UserRole } from "@/types";

/**
 * Exercises the live REQUEST CRM **operational** route-guard wiring
 * (WAVE-003I-R). The real `<ProtectedRoute>` is rendered with the exact
 * `allow` / `requirePermission` / `requireModule` combo `App.tsx` uses for
 * `/crm`, `/crm/dashboard` and `/crm/requests`, so this proves operational
 * access additionally follows `canAccessModule(currentUser, "admin-requests")`
 * — the established Service → Module seam — on top of the unchanged feature
 * flag and `requests.view` permission gates.
 *
 * The settings routes (`/crm/settings`, `/crm/settings/:tab`) are deliberately
 * NOT module-gated by this wave and are not exercised here.
 */
const mocks = vi.hoisted(() => ({ useApp: vi.fn() }));

vi.mock("@/context/AppContext", () => ({ useApp: () => mocks.useApp() }));

function setAppState(
  role: UserRole | null,
  permissions: string[],
  accessibleModules: string[],
): void {
  const grantedPermissions = new Set<string>(permissions);
  const accessible = new Set<string>(accessibleModules);
  mocks.useApp.mockReturnValue({
    currentUser: role
      ? { id: "usr_test", name: "Test", role, companyId: role === "super_admin" ? null : "cmp_1" }
      : null,
    isAuthRestoring: false,
    hasPermission: (permission: string) => grantedPermissions.has(permission),
    canAccessModule: (_user: unknown, moduleId: string) => accessible.has(moduleId),
    logout: vi.fn(),
  });
}

function renderCrmRoute(path: "/crm" | "/crm/dashboard" | "/crm/requests") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/crm"
          element={
            <ProtectedRoute
              allow={["super_admin", "company_admin"]}
              requirePermission="requests.view"
              requireModule={REQUEST_CRM_MODULE_ID}
            >
              <Navigate to="/crm/dashboard" replace />
            </ProtectedRoute>
          }
        />
        <Route
          path="/crm/dashboard"
          element={
            <ProtectedRoute
              allow={["super_admin", "company_admin"]}
              requirePermission="requests.view"
              requireModule={REQUEST_CRM_MODULE_ID}
            >
              <div>CRM dashboard content</div>
            </ProtectedRoute>
          }
        />
        <Route
          path="/crm/requests"
          element={
            <ProtectedRoute
              allow={["super_admin", "company_admin"]}
              requirePermission="requests.view"
              requireModule={REQUEST_CRM_MODULE_ID}
            >
              <div>CRM requests content</div>
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

describe("REQUEST CRM operational routes — module gate (admin-requests)", () => {
  it("uses the existing admin-requests module id as the gate", () => {
    expect(REQUEST_CRM_MODULE_ID).toBe("admin-requests");
  });

  it("lets a Company Admin with requests.view AND a usable admin-requests module reach the dashboard", () => {
    setAppState("company_admin", ["requests.view"], ["admin-requests"]);
    renderCrmRoute("/crm/dashboard");

    expect(screen.getByText("CRM dashboard content")).toBeInTheDocument();
    expect(screen.queryByText("Dashboard page")).not.toBeInTheDocument();
  });

  it("lets a Company Admin with requests.view AND a usable admin-requests module reach the request list", () => {
    setAppState("company_admin", ["requests.view"], ["admin-requests"]);
    renderCrmRoute("/crm/requests");

    expect(screen.getByText("CRM requests content")).toBeInTheDocument();
    expect(screen.queryByText("Dashboard page")).not.toBeInTheDocument();
  });

  it("redirects a Company Admin who holds requests.view but whose admin-requests module is not usable", () => {
    setAppState("company_admin", ["requests.view"], []);
    renderCrmRoute("/crm/dashboard");

    expect(screen.getByText("Dashboard page")).toBeInTheDocument();
    expect(screen.queryByText("CRM dashboard content")).not.toBeInTheDocument();
  });

  it("redirects a Company Admin missing requests.view even if the module is usable (permission gate intact)", () => {
    setAppState("company_admin", [], ["admin-requests"]);
    renderCrmRoute("/crm/requests");

    expect(screen.getByText("Dashboard page")).toBeInTheDocument();
    expect(screen.queryByText("CRM requests content")).not.toBeInTheDocument();
  });

  it("redirects a Super Admin, whose company-scoped admin-requests module is not usable, to the dashboard", () => {
    // `canAccessModule` returns false for a Super Admin (no companyId), so the
    // operational shell is unreachable for them once aligned with the module model.
    setAppState("super_admin", ["requests.view"], []);
    renderCrmRoute("/crm/dashboard");

    expect(screen.getByText("Dashboard page")).toBeInTheDocument();
    expect(screen.queryByText("CRM dashboard content")).not.toBeInTheDocument();
  });

  it("redirects a signed-out visitor to login before any module check", () => {
    setAppState(null, [], []);
    renderCrmRoute("/crm/requests");

    expect(screen.getByText("Login page")).toBeInTheDocument();
    expect(screen.queryByText("CRM requests content")).not.toBeInTheDocument();
  });

  it("redirects the /crm entry route when the admin-requests module is not usable (no leak to the dashboard redirect)", () => {
    setAppState("company_admin", ["requests.view"], []);
    renderCrmRoute("/crm");

    expect(screen.getByText("Dashboard page")).toBeInTheDocument();
    expect(screen.queryByText("CRM dashboard content")).not.toBeInTheDocument();
  });
});
