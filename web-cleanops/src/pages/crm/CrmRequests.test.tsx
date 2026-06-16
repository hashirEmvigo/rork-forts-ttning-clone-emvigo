import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * REQUEST CRM Request List shell (TICKET-003B) tests. We mock the app context
 * (role + permission), the feature flags, and the heavy DashboardLayout so the
 * suite focuses on the shell: mock rows render, the search filter narrows the
 * list using LOCAL state only (no network), and permission gating fails closed.
 */
const mocks = vi.hoisted(() => ({
  role: "super_admin" as "super_admin" | "company_admin" | "employee" | "customer",
  permissions: new Set<string>(),
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
}));

vi.mock("@/components/layout/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/AccessDenied", () => ({
  AccessDenied: () => <div data-testid="access-denied">Access denied</div>,
}));

import CrmRequests from "./CrmRequests";
import { REQUEST_CRM_REQUESTS } from "@/lib/requestCrm/mockData";

function renderRequests() {
  return render(
    <TooltipProvider>
      <MemoryRouter>
        <CrmRequests />
      </MemoryRouter>
    </TooltipProvider>,
  );
}

beforeEach(() => {
  mocks.role = "super_admin";
  mocks.permissions = new Set(["requests.view"]);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("REQUEST CRM Request List — rendering", () => {
  it("renders the mock request rows for an authorized admin", () => {
    renderRequests();
    expect(screen.getByTestId("crm-requests")).toBeInTheDocument();
    expect(screen.getByTestId("crm-request-list")).toBeInTheDocument();
    expect(screen.getByTestId("crm-request-row-req-5551")).toBeInTheDocument();
  });

  it("shows the full mock count and the mock-data notice", () => {
    renderRequests();
    expect(screen.getByTestId("crm-request-count")).toHaveTextContent(
      `Showing ${REQUEST_CRM_REQUESTS.length} of ${REQUEST_CRM_REQUESTS.length} mock requests`,
    );
    expect(screen.getByTestId("crm-mock-data-notice")).toBeInTheDocument();
    expect(screen.getAllByTestId("automation-center-reference").length).toBeGreaterThanOrEqual(1);
  });

  it("opens the read-only detail foundation from the per-row Preview action", () => {
    renderRequests();
    const previewButtons = screen.getAllByRole("button", { name: /Preview/i });
    expect(previewButtons.length).toBeGreaterThan(0);

    fireEvent.click(previewButtons[0]);

    expect(screen.getByTestId("crm-request-detail")).toBeInTheDocument();
    expect(screen.getByTestId("crm-request-detail-readonly-note")).toBeInTheDocument();
    // The detail drawer only exposes inert "later slice" action placeholders.
    const actions = screen.getByTestId("crm-request-detail-actions");
    for (const button of within(actions).getAllByRole("button")) {
      expect(button).toBeDisabled();
    }
  });

  it("renders the Company Admin create entry point and opens the local-only create sheet", () => {
    mocks.role = "company_admin";
    mocks.permissions = new Set(["requests.view"]);

    renderRequests();
    const createButton = screen.getByTestId("crm-request-create-button");
    expect(createButton).toHaveTextContent("Create request");

    fireEvent.click(createButton);

    expect(screen.getByTestId("crm-request-create-sheet")).toBeInTheDocument();
    expect(screen.getByTestId("crm-request-create-local-note")).toHaveTextContent(
      "This form does not create a real request",
    );
    expect(screen.getByTestId("crm-request-create-title")).toBeInTheDocument();
    expect(screen.getByTestId("crm-request-create-future-sections")).toHaveTextContent("Later slice");
  });
});

describe("REQUEST CRM Request List — read-only filtering", () => {
  it("narrows the list via search using local state and triggers no network", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    renderRequests();
    fireEvent.change(screen.getByTestId("crm-request-search"), {
      target: { value: "water leak" },
    });

    expect(screen.getByTestId("crm-request-row-req-5555")).toBeInTheDocument();
    expect(screen.queryByTestId("crm-request-row-req-5551")).not.toBeInTheDocument();
    expect(screen.getByTestId("crm-request-count")).toHaveTextContent(
      `Showing 1 of ${REQUEST_CRM_REQUESTS.length} mock requests`,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("shows an empty state when no row matches", () => {
    renderRequests();
    fireEvent.change(screen.getByTestId("crm-request-search"), {
      target: { value: "zzz-no-match" },
    });
    expect(screen.getByTestId("crm-request-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("crm-request-list")).not.toBeInTheDocument();
  });
});

describe("REQUEST CRM Request List — permission gating", () => {
  it("fails closed without requests.view", () => {
    mocks.permissions = new Set();
    renderRequests();
    expect(screen.getByTestId("access-denied")).toBeInTheDocument();
    expect(screen.queryByTestId("crm-requests")).not.toBeInTheDocument();
  });

  it("allows a company admin who holds requests.view", () => {
    mocks.role = "company_admin";
    mocks.permissions = new Set(["requests.view"]);
    renderRequests();
    expect(screen.getByTestId("crm-requests")).toBeInTheDocument();
    expect(screen.getByTestId("crm-request-create-button")).toBeInTheDocument();
    expect(screen.queryByTestId("access-denied")).not.toBeInTheDocument();
  });
});
