import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Routes, Route } from "react-router-dom";

import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * REQUEST CRM Settings Shell (TICKET-003A) tests. We mock the app context
 * (role + permission), the feature flags, and the heavy DashboardLayout so the
 * suite focuses on the shell: all sections render, the surface is read-only,
 * permission gating fails closed, deep-links work, and the automation
 * quick-review respects its flag.
 */
const mocks = vi.hoisted(() => ({
  role: "super_admin" as "super_admin" | "company_admin" | "employee" | "customer",
  permissions: new Set<string>(),
  quickReview: false,
}));

vi.mock("@/context/AppContext", () => ({
  useApp: () => ({
    currentUser: { id: "u1", name: "Test Admin", role: mocks.role, companyId: null },
    hasPermission: (key: string) => mocks.permissions.has(key),
  }),
}));

vi.mock("@/lib/featureFlags", () => ({
  ENABLE_REQUEST_CRM_FRONTEND_SHELL: true,
  ENABLE_REQUEST_CRM_SETTINGS_SHELL: true,
  get ENABLE_REQUEST_CRM_AUTOMATION_QUICK_REVIEW() {
    return mocks.quickReview;
  },
}));

vi.mock("@/components/layout/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/AccessDenied", () => ({
  AccessDenied: () => <div data-testid="access-denied">Access denied</div>,
}));

import CrmSettings from "./CrmSettings";

const SETTINGS_PERMS = ["requests.settings.view", "requests.settings.manage"];

function asRole(
  role: typeof mocks.role,
  perms: string[] = SETTINGS_PERMS,
) {
  mocks.role = role;
  mocks.permissions = new Set(perms);
}

function renderAt(path = "/crm/settings") {
  return render(
    <TooltipProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/crm/settings" element={<CrmSettings />} />
          <Route path="/crm/settings/:tab" element={<CrmSettings />} />
        </Routes>
      </MemoryRouter>
    </TooltipProvider>,
  );
}

beforeEach(() => {
  asRole("super_admin");
  mocks.quickReview = false;
});

afterEach(() => {
  cleanup();
});

describe("REQUEST CRM Settings Shell — rendering", () => {
  it("renders all eleven section tabs for a shared admin", () => {
    renderAt();
    expect(screen.getAllByRole("tab")).toHaveLength(11);
    for (const label of [
      "General",
      "Categories",
      "Types",
      "Statuses",
      "Priority",
      "SLA",
      "Access",
      "Notifications",
      "Tasks",
      "AI",
      "Runtime",
    ]) {
      expect(screen.getByRole("tab", { name: label })).toBeInTheDocument();
    }
  });

  it("shows the mock-data notice and the Automation & AI Center source-of-truth reference", () => {
    renderAt();
    expect(screen.getByTestId("crm-mock-data-notice")).toBeInTheDocument();
    expect(screen.getAllByTestId("automation-center-reference").length).toBeGreaterThanOrEqual(1);
  });

  it("defaults to the General section", () => {
    renderAt();
    expect(screen.getByTestId("crm-settings-section-general")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "General" })).toHaveAttribute("data-state", "active");
  });

  it("deep-links straight to a section via /crm/settings/:tab", () => {
    renderAt("/crm/settings/notifications");
    expect(screen.getByTestId("crm-settings-section-notifications")).toBeInTheDocument();
    expect(screen.queryByTestId("crm-settings-section-general")).not.toBeInTheDocument();
  });

  it("redirects unknown section slugs back to the base settings route", () => {
    renderAt("/crm/settings/does-not-exist");
    expect(screen.getByTestId("crm-settings-section-general")).toBeInTheDocument();
  });

  it("switches sections when another tab is selected", () => {
    renderAt();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Runtime" }));
    expect(screen.getByTestId("crm-settings-section-runtime-safety-links")).toBeInTheDocument();
  });
});

describe("REQUEST CRM Settings Shell — read-only & boundary", () => {
  it("renders the section management control as a disabled read-only placeholder", () => {
    renderAt();
    const control = screen.getByRole("button", { name: /Read-only/i });
    expect(control).toBeDisabled();
  });

  it("exposes Mock / Read-only / Slice 0 status badges", () => {
    renderAt();
    const badges = screen.getByTestId("crm-settings-badges");
    expect(badges).toHaveTextContent("Mock");
    expect(badges).toHaveTextContent("Read-only");
    expect(badges).toHaveTextContent("Slice 0");
  });
});

describe("REQUEST CRM Settings Shell — automation quick-review flag", () => {
  it("hides the automation quick-review when the flag is OFF", () => {
    mocks.quickReview = false;
    renderAt("/crm/settings/ai-automation");
    expect(screen.getByTestId("crm-quick-review-disabled")).toBeInTheDocument();
    expect(screen.queryByTestId("crm-quick-review")).not.toBeInTheDocument();
  });

  it("shows the display-only automation quick-review when the flag is ON", () => {
    mocks.quickReview = true;
    renderAt("/crm/settings/ai-automation");
    expect(screen.getByTestId("crm-quick-review")).toBeInTheDocument();
    expect(screen.queryByTestId("crm-quick-review-disabled")).not.toBeInTheDocument();
  });
});

describe("REQUEST CRM Settings Shell — permission gating", () => {
  it("blocks a shared admin who lacks requests.settings.view", () => {
    asRole("company_admin", []);
    renderAt();
    expect(screen.getByTestId("access-denied")).toBeInTheDocument();
    expect(screen.queryByTestId("crm-settings-tabs")).not.toBeInTheDocument();
  });

  it("allows a company admin who holds the view permission", () => {
    asRole("company_admin");
    renderAt();
    expect(screen.getByTestId("crm-settings-tabs")).toBeInTheDocument();
    expect(screen.queryByTestId("access-denied")).not.toBeInTheDocument();
  });

  it("blocks an employee without the permission", () => {
    asRole("employee", []);
    renderAt();
    expect(screen.getByTestId("access-denied")).toBeInTheDocument();
  });
});
