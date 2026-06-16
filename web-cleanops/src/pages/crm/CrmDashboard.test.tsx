import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * REQUEST CRM Dashboard shell (TICKET-003B) tests. We mock the app context
 * (role + permission), the feature flags, and the heavy DashboardLayout so the
 * suite focuses on the shell: KPI cards render, mock/read-only indicators are
 * present, the Automation & AI Center reference is display-only, the automation
 * candidates respect their flag, and permission gating fails closed.
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
  ENABLE_REQUEST_CRM_SETTINGS_SHELL: false,
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

import CrmDashboard from "./CrmDashboard";

function renderDashboard() {
  return render(
    <TooltipProvider>
      <MemoryRouter>
        <CrmDashboard />
      </MemoryRouter>
    </TooltipProvider>,
  );
}

beforeEach(() => {
  mocks.role = "super_admin";
  mocks.permissions = new Set(["requests.view"]);
  mocks.quickReview = false;
});

afterEach(() => {
  cleanup();
});

describe("REQUEST CRM Dashboard — rendering", () => {
  it("renders the mock KPI cards for an authorized admin", () => {
    renderDashboard();
    expect(screen.getByTestId("crm-dashboard")).toBeInTheDocument();
    expect(screen.getByTestId("crm-dashboard-cards")).toBeInTheDocument();
    expect(screen.getByTestId("crm-dashboard-card-open_requests")).toBeInTheDocument();
    expect(screen.getByTestId("crm-dashboard-card-emergency")).toBeInTheDocument();
  });

  it("shows the mock-data notice and Automation & AI Center reference", () => {
    renderDashboard();
    expect(screen.getByTestId("crm-mock-data-notice")).toBeInTheDocument();
    expect(screen.getAllByTestId("automation-center-reference").length).toBeGreaterThanOrEqual(1);
  });

  it("exposes Mock / Read-only / Slice 0 status badges", () => {
    renderDashboard();
    const badges = screen.getByTestId("crm-dashboard-badges");
    expect(badges).toHaveTextContent("Mock");
    expect(badges).toHaveTextContent("Read-only");
    expect(badges).toHaveTextContent("Slice 0");
  });

  it("renders a needs-attention list and a link to the request list", () => {
    renderDashboard();
    expect(screen.getByTestId("crm-attention-list")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /View all requests/i })).toHaveAttribute(
      "href",
      "/crm/requests",
    );
  });

  it("opens the read-only detail foundation when an attention row is clicked", () => {
    renderDashboard();
    const attentionRows = screen.getAllByTestId(/^crm-attention-row-/);
    expect(attentionRows.length).toBeGreaterThan(0);

    fireEvent.click(attentionRows[0]);

    expect(screen.getByTestId("crm-request-detail")).toBeInTheDocument();
    expect(screen.getByTestId("crm-request-detail-readonly-note")).toBeInTheDocument();
  });
});

describe("REQUEST CRM Dashboard — automation quick-review flag", () => {
  it("hides the automation candidates when the flag is OFF", () => {
    mocks.quickReview = false;
    renderDashboard();
    expect(screen.getByTestId("crm-dashboard-automation-disabled")).toBeInTheDocument();
    expect(screen.queryByTestId("crm-dashboard-automation-candidates")).not.toBeInTheDocument();
  });

  it("shows display-only automation candidates when the flag is ON", () => {
    mocks.quickReview = true;
    renderDashboard();
    expect(screen.getByTestId("crm-dashboard-automation-candidates")).toBeInTheDocument();
    expect(screen.queryByTestId("crm-dashboard-automation-disabled")).not.toBeInTheDocument();
  });
});

describe("REQUEST CRM Dashboard — permission gating", () => {
  it("fails closed without requests.view", () => {
    mocks.permissions = new Set();
    renderDashboard();
    expect(screen.getByTestId("access-denied")).toBeInTheDocument();
    expect(screen.queryByTestId("crm-dashboard")).not.toBeInTheDocument();
  });

  it("allows a company admin who holds requests.view", () => {
    mocks.role = "company_admin";
    mocks.permissions = new Set(["requests.view"]);
    renderDashboard();
    expect(screen.getByTestId("crm-dashboard")).toBeInTheDocument();
    expect(screen.queryByTestId("access-denied")).not.toBeInTheDocument();
  });
});
