import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProtectedRoute } from "@/components/ProtectedRoute";
import {
  COMPANY_REQUEST_SETTINGS_VIEW_PERMISSION,
  REQUEST_CRM_MODULE_ID,
} from "@/lib/requestCrm/companyRequestSettingsNav";
import type { UserRole } from "@/types";

/**
 * Exercises the live Company Admin local Request settings route-guard wiring
 * (WAVE-003J-R). The real `<ProtectedRoute>` is rendered with the exact
 * `allow` / `requirePermission` / `requireModule` combo `App.tsx` uses for
 * `/settings/request`, proving the local settings foundation is:
 *  - Company-Admin-only (Super Admin governs globally at `/request-settings`),
 *  - gated by the existing `requests.settings.view` permission, and
 *  - additionally gated by the existing `admin-requests` module access seam
 *    (`canAccessModule`) from WAVE-003H-R / WAVE-003I-R.
 *
 * No new entitlement/module model is introduced and no existing authorization is
 * weakened — the module gate runs last so it can only narrow access.
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

function renderRequestSettingsRoute() {
  return render(
    <MemoryRouter initialEntries={["/settings/request"]}>
      <Routes>
        <Route
          path="/settings/request"
          element={
            <ProtectedRoute
              allow={["company_admin"]}
              requirePermission={COMPANY_REQUEST_SETTINGS_VIEW_PERMISSION}
              requireModule={REQUEST_CRM_MODULE_ID}
            >
              <div>Request settings content</div>
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

describe("Company Admin local Request settings route — /settings/request", () => {
  it("uses the existing request-settings permission and admin-requests module id", () => {
    expect(COMPANY_REQUEST_SETTINGS_VIEW_PERMISSION).toBe("requests.settings.view");
    expect(REQUEST_CRM_MODULE_ID).toBe("admin-requests");
  });

  it("lets a Company Admin with the permission AND a usable admin-requests module in", () => {
    setAppState("company_admin", ["requests.settings.view"], ["admin-requests"]);
    renderRequestSettingsRoute();

    expect(screen.getByText("Request settings content")).toBeInTheDocument();
    expect(screen.queryByText("Dashboard page")).not.toBeInTheDocument();
  });

  it("redirects a Company Admin whose admin-requests module is not usable", () => {
    setAppState("company_admin", ["requests.settings.view"], []);
    renderRequestSettingsRoute();

    expect(screen.getByText("Dashboard page")).toBeInTheDocument();
    expect(screen.queryByText("Request settings content")).not.toBeInTheDocument();
  });

  it("redirects a Company Admin missing requests.settings.view even if the module is usable", () => {
    setAppState("company_admin", [], ["admin-requests"]);
    renderRequestSettingsRoute();

    expect(screen.getByText("Dashboard page")).toBeInTheDocument();
    expect(screen.queryByText("Request settings content")).not.toBeInTheDocument();
  });

  it("redirects a Super Admin — they govern globally at /request-settings, not here", () => {
    setAppState("super_admin", ["requests.settings.view"], ["admin-requests"]);
    renderRequestSettingsRoute();

    expect(screen.getByText("Dashboard page")).toBeInTheDocument();
    expect(screen.queryByText("Request settings content")).not.toBeInTheDocument();
  });

  it("redirects a signed-out visitor to login before any permission/module check", () => {
    setAppState(null, [], []);
    renderRequestSettingsRoute();

    expect(screen.getByText("Login page")).toBeInTheDocument();
    expect(screen.queryByText("Request settings content")).not.toBeInTheDocument();
  });
});
