import type { ReactNode } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CalculatorAdminOverview } from "@/lib/calculator/calculatorAdmin";
import type { CalculatorConfig } from "@/lib/calculator/calculatorConfigAdmin";

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
  addService: vi.fn(),
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

const OVERVIEW: CalculatorAdminOverview = {
  companyName: "Städalliansen Sverige AB",
  matchesMvpTarget: true,
  settings: {
    legacyId: "calc_settings_x",
    companyId: "co-uuid",
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
      legacyId: "svc_home_legacy",
      serviceKey: "home_cleaning",
      displayName: "Hemstädning",
      pricingModel: "home_cleaning_recommended_hours",
      enabled: true,
      comingSoon: false,
      sortOrder: 1,
    },
  ],
  cleaningPlans: [
    { legacyId: "plan_flexible", planKey: "flexible", name: "Flexibel", hourlyRate: 349, isDefault: true, active: true, sortOrder: 1 },
  ],
  counts: {
    services: 1,
    enabledServices: 1,
    cleaningPlans: 1,
    questions: 1,
    pricingRules: 1,
    prospects: 0,
    quoteRequests: 0,
    quoteRequestAnswers: 0,
  },
};

function makeConfig(over: Partial<CalculatorConfig> = {}): CalculatorConfig {
  return {
    companyName: "Städalliansen Sverige AB",
    settings: {
      legacyId: "calc_settings_x",
      companyId: "co-uuid",
      companyLegacyId: "cmp_o2f6orw29m",
      enabled: false,
      publicSlug: "rakna-ut-ditt-pris",
      priceDisplayMode: "range",
      showPriceBeforeContact: true,
      requireContactBeforeResult: false,
      showLoginPromptAfterSubmit: true,
      quoteValidityDays: 30,
      manualReviewThresholdAmount: null,
      currency: "SEK",
      rutDisplayMode: "none",
      defaultVatRatePercent: 25,
      autoCreateProspect: true,
      autoCreateQuoteRequest: true,
      defaultQuoteStatus: "submitted",
    },
    services: [
      {
        id: "svc-home",
        legacyId: "svc_home_legacy",
        serviceKey: "home_cleaning",
        displayName: "Hemstädning",
        description: null,
        enabled: true,
        comingSoon: false,
        pricingModel: "home_cleaning_recommended_hours",
        sortOrder: 1,
        requiresCleaningPlan: true,
        plansEnabled: true,
        planPricingModel: "hourly_rate_by_plan",
        defaultPlanKey: null,
        baseHourlyRateExclVat: null,
        defaultVatRatePercent: 25,
        questions: [
          {
            legacyId: "q_sqm",
            serviceId: "svc-home",
            serviceLegacyId: "svc_home_legacy",
            questionKey: "sqm",
            label: "Boyta (m²)",
            helpText: null,
            inputType: "integer",
            required: true,
            affectsPricing: true,
            sortOrder: 1,
            active: true,
            options: [],
          },
        ],
      },
    ],
    cleaningPlans: [
      {
        legacyId: "plan_flexible",
        serviceId: "svc-home",
        serviceLegacyId: "svc_home_legacy",
        serviceKey: "home_cleaning",
        planKey: "flexible",
        name: "Flexibel",
        description: null,
        hourlyRate: 349,
        vatRatePercent: 25,
        priceAdjustmentType: "fixed_amount",
        priceAdjustmentValue: 0,
        rutEligible: true,
        rutEnabled: true,
        rutPercent: 50,
        rutApplyTo: "total_customer_price",
        showRutBreakdown: true,
        flexibilityLevel: null,
        customerDayTimeControl: null,
        sameStaffPreferenceLevel: null,
        bookingPriority: null,
        cancellationTermsSummary: null,
        isDefault: true,
        active: true,
        sortOrder: 1,
      },
    ],
    pricingRules: [
      { legacyId: "r1", serviceId: "svc-home", ruleKey: "base_hours", ruleType: "numeric_factor", valueNumeric: 2, active: true, sortOrder: 1 },
    ],
    addons: [],
    sizeBands: [],
    ...over,
  };
}

function setConfig(config: CalculatorConfig | null) {
  mocks.useCalculatorConfig.mockReturnValue({
    config,
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: mocks.configRefetch,
    isSaving: false,
    saveService: vi.fn().mockResolvedValue(undefined),
    saveQuestion: vi.fn().mockResolvedValue(undefined),
    addQuestion: vi.fn().mockResolvedValue(undefined),
    addService: mocks.addService,
    archiveService: vi.fn().mockResolvedValue(undefined),
    savePlan: vi.fn().mockResolvedValue(undefined),
    setDefaultPlan: vi.fn().mockResolvedValue(undefined),
    addPlan: vi.fn().mockResolvedValue(undefined),
    saveSettings: vi.fn().mockResolvedValue(undefined),
    savePricingRuleValue: vi.fn().mockResolvedValue(undefined),
    addAddon: vi.fn().mockResolvedValue(undefined),
    saveAddon: vi.fn().mockResolvedValue(undefined),
    archiveAddon: vi.fn().mockResolvedValue(undefined),
    pricingRuleAudit: { entries: [], isLoading: false, error: null },
  });
}

function setOverview(over: Partial<CalculatorAdminOverview> = {}) {
  mocks.useCalculatorAdmin.mockReturnValue({
    overview: { ...OVERVIEW, ...over },
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
  mocks.useApp.mockReturnValue({ currentUser: { role: "super_admin" } });
  mocks.useNavigationMenu.mockReturnValue(
    resolveNavigationGroup("calculator", [], { hasPermission: () => true }),
  );
  setOverview();
  setConfig(makeConfig());
  mocks.useCalculatorQuoteRequests.mockReturnValue({
    quoteRequests: [],
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: mocks.inboxRefetch,
  });
});

describe("CalculatorControl — service-first workbench", () => {
  it("renders service nav cards + an Add service card instead of technical tabs", () => {
    renderPage();
    // The service tile carries the service name; the old technical tabs are gone.
    expect(screen.getByTestId("calculator-service-card-home_cleaning")).toBeInTheDocument();
    expect(screen.getByTestId("calculator-add-service-card")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /^Fields$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /^Overview$/ })).not.toBeInTheDocument();
  });

  it("keeps every configuration section collapsed by default", () => {
    renderPage();
    // Section headers exist…
    expect(screen.getByTestId("calc-section-toggle-questions")).toBeInTheDocument();
    expect(screen.getByTestId("calc-section-toggle-plans")).toBeInTheDocument();
    // …but their content stays hidden until expanded.
    expect(screen.queryByRole("button", { name: "Add question" })).not.toBeInTheDocument();
    expect(screen.queryByText("Boyta (m²)")).not.toBeInTheDocument();
  });

  it("opens the Questions section to reveal the selected service's questions", () => {
    renderPage();
    fireEvent.click(screen.getByTestId("calc-section-toggle-questions"));
    expect(screen.getByRole("button", { name: "Add question" })).toBeInTheDocument();
    expect(screen.getByText("Boyta (m²)")).toBeInTheDocument();
  });

  it("opens the Plans section to reveal the selected service's plans", () => {
    renderPage();
    fireEvent.click(screen.getByTestId("calc-section-toggle-plans"));
    expect(screen.getByRole("heading", { name: "Flexibel" })).toBeInTheDocument();
  });

  it("opens the Pricing section to reveal the selected service's rules directly (no extra expand)", () => {
    renderPage();
    fireEvent.click(screen.getByTestId("calc-section-toggle-pricing"));
    const pricingPanel = document.getElementById("calc-section-panel-pricing");
    expect(pricingPanel).not.toBeNull();
    // GPM-UX-ADMIN-4 — rules show immediately; the redundant per-service expand is gone.
    expect(
      within(pricingPanel as HTMLElement).queryByRole("button", { name: /Hemstädning/ }),
    ).toBeNull();
    expect(screen.getByText("Start time for a mission")).toBeInTheDocument();
    // The pricing-change history no longer lives in the Pricing workspace.
    expect(within(pricingPanel as HTMLElement).queryByText("Recent pricing changes")).toBeNull();
  });

  it("shows the relocated pricing-change history inside the Settings section", () => {
    renderPage();
    fireEvent.click(screen.getByTestId("calc-section-toggle-settings"));
    const settingsPanel = document.getElementById("calc-section-panel-settings");
    expect(settingsPanel).not.toBeNull();
    expect(within(settingsPanel as HTMLElement).getByText("Recent pricing changes")).toBeInTheDocument();
  });

  it("consolidates customer add-ons into the unified Add-ons subsection of Pricing (GPM-UX-ADMIN-7)", () => {
    renderPage();
    fireEvent.click(screen.getByTestId("calc-section-toggle-pricing"));
    const panel = document.getElementById("calc-section-panel-pricing") as HTMLElement;
    expect(panel).not.toBeNull();
    // The customer add-ons editor now lives INSIDE one unified "Add-ons" subsection…
    const addonsSection = within(panel).getByTestId("rule-section-extra_services");
    expect(within(addonsSection).getByText("Add-ons")).toBeInTheDocument();
    expect(within(addonsSection).getByTestId("pricing-customer-addons")).toBeInTheDocument();
    expect(within(addonsSection).getByText("Active add-ons for this service")).toBeInTheDocument();
    // …with the create affordance inside it…
    expect(within(addonsSection).getByRole("button", { name: "Create new add-on" })).toBeInTheDocument();
    // …and the old standalone "Customer add-ons" labelled block is gone, as is the
    // old "Extra service time rules" label.
    expect(within(panel).queryByText("Customer add-ons")).toBeNull();
    expect(within(panel).queryByText("Extra service time rules")).toBeNull();
  });

  it("orders the Pricing subsections with Add-ons last (GPM-UX-ADMIN-7)", () => {
    renderPage();
    fireEvent.click(screen.getByTestId("calc-section-toggle-pricing"));
    const panel = document.getElementById("calc-section-panel-pricing") as HTMLElement;
    const sectionIds = within(panel)
      .getAllByTestId(/^rule-section-(?!icon-)/)
      .map((el) => el.getAttribute("data-testid"));
    // Base calculation leads; the unified Add-ons (extra_services) section is last.
    expect(sectionIds[0]).toBe("rule-section-base");
    expect(sectionIds[sectionIds.length - 1]).toBe("rule-section-extra_services");
  });

  it("no longer renders a separate Add-ons workbench section (GPM-UX-ADMIN-5)", () => {
    renderPage();
    // The standalone Add-ons accordion section is gone; sections are Questions / Plans /
    // Pricing / Settings / Requests.
    expect(screen.queryByTestId("calc-section-toggle-addons")).not.toBeInTheDocument();
    expect(screen.getByTestId("calc-section-toggle-questions")).toBeInTheDocument();
    expect(screen.getByTestId("calc-section-toggle-pricing")).toBeInTheDocument();
    expect(screen.getByTestId("calc-section-toggle-settings")).toBeInTheDocument();
  });

  it("supports multiple sections open at once and closes only the clicked one", () => {
    renderPage();
    fireEvent.click(screen.getByTestId("calc-section-toggle-questions"));
    fireEvent.click(screen.getByTestId("calc-section-toggle-plans"));
    // Both open together.
    expect(screen.getByRole("button", { name: "Add question" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Flexibel" })).toBeInTheDocument();
    // Closing Questions leaves Plans open (independent multi-open behaviour).
    fireEvent.click(screen.getByTestId("calc-section-toggle-questions"));
    expect(screen.queryByRole("button", { name: "Add question" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Flexibel" })).toBeInTheDocument();
  });

  it("keeps the read-only Quote Requests inbox in its own section", () => {
    renderPage();
    fireEvent.click(screen.getByTestId("calc-section-toggle-requests"));
    expect(screen.getByText("No quote requests yet.")).toBeInTheDocument();
  });

  it("opens the existing Add service flow from the Add service card", () => {
    renderPage();
    fireEvent.click(screen.getByTestId("calculator-add-service-card"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Add service" })).toBeInTheDocument();
  });

  it("shows a healthy configuration summary", () => {
    setConfig(makeConfig());
    renderPage();
    expect(screen.getByText("Configuration looks healthy")).toBeInTheDocument();
  });

  it("surfaces a blocking config-health issue", () => {
    setConfig(makeConfig({ pricingRules: [] }));
    renderPage();
    expect(screen.getByText(/has no active pricing rules/i)).toBeInTheDocument();
  });

  it("shows the enabled-state safety banner only when the calculator is live", () => {
    setOverview({ settings: { ...OVERVIEW.settings, enabled: true } });
    setConfig(makeConfig({ settings: { ...makeConfig().settings, enabled: true } }));
    renderPage();
    expect(screen.getByText("The public calculator is currently enabled")).toBeInTheDocument();
  });

  it("hides the safety banner while disabled", () => {
    renderPage();
    expect(screen.queryByText("The public calculator is currently enabled")).not.toBeInTheDocument();
  });
});

// ── Service nav grouping: legacy/default services hidden behind a toggle ──────
describe("CalculatorControl — service nav legacy grouping", () => {
  function multiServiceConfig(): CalculatorConfig {
    const base = makeConfig();
    const home = base.services[0];
    return {
      ...base,
      services: [
        home,
        { ...home, id: "svc-move", legacyId: "svc_move_legacy", serviceKey: "move_out_cleaning", displayName: "Flyttstädning", enabled: false, pricingModel: "move_out_fixed_plus_addons", questions: [] },
        { ...home, id: "svc-office", legacyId: "svc_office_legacy", serviceKey: "office_cleaning", displayName: "Kontorsstädning", enabled: false, pricingModel: "office_cleaning_recurring_area_frequency", questions: [] },
      ],
    };
  }

  beforeEach(() => {
    setConfig(multiServiceConfig());
  });

  it("shows only the pilot/generic service tile by default", () => {
    renderPage();
    expect(screen.getByTestId("calculator-service-card-home_cleaning")).toBeInTheDocument();
    expect(screen.queryByTestId("calculator-service-card-move_out_cleaning")).not.toBeInTheDocument();
    expect(screen.queryByTestId("calculator-service-card-office_cleaning")).not.toBeInTheDocument();
  });

  it("reveals the legacy/default service tiles when toggled", () => {
    renderPage();
    fireEvent.click(screen.getByTestId("calculator-legacy-nav-toggle"));
    expect(screen.getByTestId("calculator-service-card-move_out_cleaning")).toBeInTheDocument();
    expect(screen.getByTestId("calculator-service-card-office_cleaning")).toBeInTheDocument();
  });

  it("switches the configured service when another tile is selected", () => {
    renderPage();
    fireEvent.click(screen.getByTestId("calculator-legacy-nav-toggle"));
    fireEvent.click(screen.getByTestId("calculator-service-card-move_out_cleaning"));
    // The selected-service header reflects the newly selected service.
    const header = screen.getByTestId("calc-section-toggle-questions");
    expect(header).toBeInTheDocument();
    // Open Plans for the move-out service → its legacy read-only lane shows.
    fireEvent.click(screen.getByTestId("calc-section-toggle-plans"));
    expect(within(document.body).getAllByText(/Flyttstädning/).length).toBeGreaterThan(0);
  });
});
