import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CalculatorAdminOverview } from "@/lib/calculator/calculatorAdmin";

const mocks = vi.hoisted(() => ({
  useApp: vi.fn(),
  useCalculatorAdmin: vi.fn(),
  useCalculatorConfig: vi.fn(),
  useCalculatorQuoteRequests: vi.fn(),
  useNavigationMenu: vi.fn(),
  setEnabled: vi.fn(),
  refetch: vi.fn(),
  configRefetch: vi.fn(),
  inboxRefetch: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/context/AppContext", () => ({ useApp: () => mocks.useApp() }));
vi.mock("@/hooks/use-calculator-admin", () => ({ useCalculatorAdmin: () => mocks.useCalculatorAdmin() }));
vi.mock("@/hooks/use-calculator-config-admin", () => ({
  useCalculatorConfig: () => mocks.useCalculatorConfig(),
}));
vi.mock("@/hooks/use-calculator-quote-requests", () => ({
  useCalculatorQuoteRequests: () => mocks.useCalculatorQuoteRequests(),
}));
vi.mock("@/hooks/use-navigation-config-admin", () => ({
  useNavigationMenu: () => mocks.useNavigationMenu(),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/components/layout/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

import CalculatorControl from "./CalculatorControl";
import { resolveNavigationGroup } from "@/lib/navigation/navigationRegistry";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import type { UserRole } from "@/types";

const OVERVIEW: CalculatorAdminOverview = {
  companyName: "Städalliansen Sverige AB",
  matchesMvpTarget: true,
  settings: {
    legacyId: "calc_settings_cmp_o2f6orw29m",
    companyId: "00000000-0000-4000-8000-000000000abc",
    companyLegacyId: "cmp_o2f6orw29m",
    enabled: false,
    publicSlug: "rakna-ut-ditt-pris",
    priceDisplayMode: "range",
    quoteValidityDays: 30,
    defaultQuoteStatus: "submitted",
    currency: "SEK",
  },
  services: [
    {
      legacyId: "s1",
      serviceKey: "home_cleaning",
      displayName: "Hemstädning",
      pricingModel: "home_cleaning_recommended_hours",
      enabled: true,
      comingSoon: false,
      sortOrder: 1,
    },
    {
      legacyId: "s2",
      serviceKey: "move_out_cleaning",
      displayName: "Flyttstädning",
      pricingModel: "move_out_fixed_plus_addons",
      enabled: true,
      comingSoon: false,
      sortOrder: 2,
    },
  ],
  cleaningPlans: [
    { legacyId: "p1", planKey: "flexible", name: "Flexibel", hourlyRate: 349, isDefault: true, active: true, sortOrder: 1 },
  ],
  counts: {
    services: 2,
    enabledServices: 2,
    cleaningPlans: 3,
    questions: 12,
    pricingRules: 18,
    prospects: 0,
    quoteRequests: 0,
    quoteRequestAnswers: 0,
  },
};

function setHook(overview: CalculatorAdminOverview | null) {
  mocks.useCalculatorAdmin.mockReturnValue({
    overview,
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: mocks.refetch,
    setEnabled: mocks.setEnabled,
    isUpdating: false,
  });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <CalculatorControl />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.setEnabled.mockResolvedValue(true);
  mocks.useNavigationMenu.mockReturnValue(
    resolveNavigationGroup("calculator", [], { hasPermission: () => true }),
  );
  setHook(OVERVIEW);
  mocks.useCalculatorConfig.mockReturnValue({
    config: null,
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: mocks.configRefetch,
    isSaving: false,
    saveService: vi.fn(),
    saveQuestion: vi.fn(),
    addQuestion: vi.fn(),
    savePlan: vi.fn(),
    saveSettings: vi.fn(),
    savePricingRuleValue: vi.fn(),
    pricingRuleAudit: { entries: [], isLoading: false, error: null },
  });
  mocks.useCalculatorQuoteRequests.mockReturnValue({
    quoteRequests: [],
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: mocks.inboxRefetch,
  });
});

describe("CalculatorControl access + control", () => {
  it("denies non-super-admin roles", () => {
    mocks.useApp.mockReturnValue({ currentUser: { role: "company_admin" } });
    renderPage();

    expect(screen.getByText("Access Denied")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enable calculator" })).not.toBeInTheDocument();
  });

  it("renders the locked control surface for super admins", () => {
    mocks.useApp.mockReturnValue({ currentUser: { role: "super_admin" } });
    renderPage();

    expect(screen.getByRole("heading", { name: "Calculator" })).toBeInTheDocument();
    expect(screen.getByText("Städalliansen Sverige AB")).toBeInTheDocument();
    // Owner + slug + the single master enable switch are surfaced in the status header.
    expect(screen.getByText(/cmp_o2f6orw29m/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enable calculator" })).toBeInTheDocument();
  });

  it("confirms before toggling enabled and writes only via setEnabled", async () => {
    mocks.useApp.mockReturnValue({ currentUser: { role: "super_admin" } });
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Enable calculator" }));
    expect(await screen.findByText("Enable the calculator?")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Enable" }));

    await waitFor(() => expect(mocks.setEnabled).toHaveBeenCalledWith(true));
    expect(mocks.setEnabled).toHaveBeenCalledTimes(1);
  });

  it("shows a clear empty state when the seed has not been applied", () => {
    mocks.useApp.mockReturnValue({ currentUser: { role: "super_admin" } });
    setHook(null);
    renderPage();

    expect(screen.getByText("No calculator configuration found")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enable calculator" })).not.toBeInTheDocument();
  });
});

/**
 * Exercises the live `/calculator` route guard wiring (Slice 5B). The real
 * <ProtectedRoute> is rendered with the exact `allow`/`requirePermission` combo
 * App.tsx uses for `/calculator`, so this proves access follows `calculator.manage`
 * — the same key the Super Admin navigation gate reads.
 */
function setRouteAppState(role: UserRole | null, permissions: string[]): void {
  const granted = new Set<string>(permissions);
  mocks.useApp.mockReturnValue({
    currentUser: role
      ? { id: "usr_test", name: "Test", role, companyId: role === "super_admin" ? null : "cmp_1" }
      : null,
    isAuthRestoring: false,
    hasPermission: (permission: string) => granted.has(permission),
    logout: vi.fn(),
  });
}

function renderCalculatorRoute() {
  return render(
    <MemoryRouter initialEntries={["/calculator"]}>
      <Routes>
        <Route
          path="/calculator"
          element={
            <ProtectedRoute allow={["super_admin"]} requirePermission="calculator.manage">
              <div>Calculator route content</div>
            </ProtectedRoute>
          }
        />
        <Route path="/dashboard" element={<div>Dashboard page</div>} />
        <Route path="/login" element={<div>Login page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("/calculator route permission (calculator.manage)", () => {
  it("lets a Super Admin holding calculator.manage reach the page", () => {
    setRouteAppState("super_admin", ["calculator.manage"]);
    renderCalculatorRoute();

    expect(screen.getByText("Calculator route content")).toBeInTheDocument();
    expect(screen.queryByText("Dashboard page")).not.toBeInTheDocument();
  });

  it("redirects a Company Admin without calculator.manage to the dashboard", () => {
    setRouteAppState("company_admin", []);
    renderCalculatorRoute();

    expect(screen.getByText("Dashboard page")).toBeInTheDocument();
    expect(screen.queryByText("Calculator route content")).not.toBeInTheDocument();
  });

  it("redirects a Super Admin missing calculator.manage (permission, not just role)", () => {
    setRouteAppState("super_admin", []);
    renderCalculatorRoute();

    expect(screen.getByText("Dashboard page")).toBeInTheDocument();
    expect(screen.queryByText("Calculator route content")).not.toBeInTheDocument();
  });
});
