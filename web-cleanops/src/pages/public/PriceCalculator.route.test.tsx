import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  PublicCalculateResponse,
  PublicConfigResponse,
} from "@/lib/calculator/publicCalculatorClient";

/**
 * Router-level smoke test for the PUBLIC calculator. It mounts the EXACT public
 * route entries App.tsx registers (`/rakna-ut-ditt-pris` + the `/rakna-ut-pris`
 * alias) inside a MemoryRouter — with `/login` and `/dashboard` present as redirect
 * sentinels — to prove the page is reachable logged-out, never bounces to auth,
 * the alias redirects, a real calculation renders, the submit CTA is present, and
 * no write (submit) happens on load. The Edge Function client is mocked (no network).
 *
 * (This is the closest router-level integration the repo supports — there is no
 * Playwright/Cypress E2E harness; route tests use MemoryRouter by convention.)
 */

const mocks = vi.hoisted(() => ({
  fetchConfig: vi.fn(),
  calculate: vi.fn(),
  submit: vi.fn(),
}));

vi.mock("@/lib/calculator/publicCalculatorClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/calculator/publicCalculatorClient")>();
  return {
    ...actual,
    fetchPublicCalculatorConfig: (...args: unknown[]) => mocks.fetchConfig(...args),
    requestPublicCalculation: (...args: unknown[]) => mocks.calculate(...args),
    submitPublicQuoteRequest: (...args: unknown[]) => mocks.submit(...args),
  };
});

import PriceCalculator from "./PriceCalculator";

const CONFIG: PublicConfigResponse = {
  ok: true,
  enabled: true,
  company: { name: "Städalliansen Sverige AB" },
  settings: {
    publicSlug: "rakna-ut-ditt-pris",
    priceDisplayMode: "range",
    currency: "SEK",
    showPriceBeforeContact: true,
    requireContactBeforeResult: false,
    showLoginPromptAfterSubmit: false,
    rutDisplayMode: "none",
    defaultVatRatePercent: 25,
    quoteValidityDays: 30,
  },
  content: { pageTitle: "Räkna ut ditt pris" },
  services: [
    {
      serviceKey: "home_cleaning",
      displayName: "Hemstädning",
      description: null,
      enabled: true,
      comingSoon: false,
      pricingModel: "home_cleaning_recommended_hours",
      genericPricingModel: null,
      engineSupported: false,
      primaryInput: null,
      unitLabel: null,
      requiresCleaningPlan: true,
      plansEnabled: true,
      planPricingModel: "hourly_rate_by_plan",
      defaultPlanKey: null,
      baseHourlyRateExclVat: null,
      defaultVatRatePercent: 25,
      sortOrder: 1,
      questions: [
        {
          questionKey: "sqm",
          label: "Boyta (m²)",
          helpText: null,
          inputType: "number",
          required: true,
          options: [],
          validation: { min: 10, max: 500, step: 1 },
          sortOrder: 1,
        },
      ],
      addons: [],
    },
  ],
  cleaningPlans: [
    {
      id: "p1",
      planKey: "flexible",
      name: "Flexibel",
      description: null,
      serviceKey: "home_cleaning",
      hourlyRate: 349,
      vatRatePercent: 25,
      priceAdjustmentType: "fixed_amount",
      priceAdjustmentValue: 0,
      rutEligible: false,
      rutEnabled: false,
      rutPercent: 0,
      rutApplyTo: "total_customer_price",
      showRutBreakdown: false,
      flexibilityLevel: null,
      customerDayTimeControl: null,
      sameStaffPreferenceLevel: null,
      bookingPriority: null,
      cancellationTermsSummary: null,
      isDefault: true,
      sortOrder: 1,
    },
  ],
  faq: [],
};

const RESULT: PublicCalculateResponse = {
  ok: true,
  enabled: true,
  valid: true,
  issues: [],
  serviceKey: "home_cleaning",
  pricingModel: "home_cleaning_recommended_hours",
  formulaVersion: "v1",
  currency: "SEK",
  priceDisplayMode: "range",
  estimatedHours: 3,
  calculatedPrice: 2350,
  minPrice: 2100,
  maxPrice: 2600,
  priceExclVat: null,
  vatRatePercent: 25,
  vatAmount: null,
  priceInclVat: null,
  rutEnabled: false,
  rutPercent: 0,
  showRutBreakdown: false,
  rutDeduction: null,
  priceAfterRut: null,
  roundingIncrement: null,
  displayText: "2 100–2 600 kr",
  selectedPlan: { planKey: "flexible", name: "Flexibel", hourlyRate: 349, vatRatePercent: 25, rutEnabled: false, rutPercent: 0, showRutBreakdown: false },
};

/** Surfaces the current pathname so redirects/aliases are assertable. */
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="pathname">{location.pathname}</div>;
}

/** Mounts the real public route table at `initialPath` (no auth providers). */
function renderAt(initialPath: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialPath]}>
        <LocationProbe />
        <Routes>
          <Route path="/rakna-ut-ditt-pris" element={<PriceCalculator />} />
          <Route path="/rakna-ut-pris" element={<Navigate to="/rakna-ut-ditt-pris" replace />} />
          {/* Redirect sentinels — if the page wrongly required auth it would land here. */}
          <Route path="/login" element={<div>Login page</div>} />
          <Route path="/dashboard" element={<div>Dashboard page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetchConfig.mockResolvedValue({ status: "ok", config: CONFIG });
  mocks.calculate.mockResolvedValue(RESULT);
});

describe("public calculator route (smoke)", () => {
  it("is reachable logged-out and never redirects to auth", async () => {
    renderAt("/rakna-ut-ditt-pris");

    expect(await screen.findByRole("heading", { level: 1, name: "Räkna ut ditt pris" })).toBeInTheDocument();
    expect(screen.getByTestId("pathname")).toHaveTextContent("/rakna-ut-ditt-pris");
    expect(screen.queryByText("Login page")).not.toBeInTheDocument();
    expect(screen.queryByText("Dashboard page")).not.toBeInTheDocument();
  });

  it("redirects the /rakna-ut-pris alias to /rakna-ut-ditt-pris", async () => {
    renderAt("/rakna-ut-pris");

    expect(await screen.findByRole("heading", { level: 1, name: "Räkna ut ditt pris" })).toBeInTheDocument();
    expect(screen.getByTestId("pathname")).toHaveTextContent("/rakna-ut-ditt-pris");
  });

  it("renders a server-calculated result after entering inputs", async () => {
    renderAt("/rakna-ut-ditt-pris");

    // No service is auto-selected (Slice 12G) — choose one before the details appear.
    fireEvent.click(await screen.findByRole("button", { name: /Hemstädning/i }));
    fireEvent.change(await screen.findByLabelText(/Boyta \(m²\)/), { target: { value: "70" } });

    expect(
      (await screen.findAllByText("2 100–2 600 kr", undefined, { timeout: 3000 })).length,
    ).toBeGreaterThan(0);
    await waitFor(() => expect(mocks.calculate).toHaveBeenCalled());
  });

  it("shows the submit CTA present and enabled, with no write triggered on load", async () => {
    renderAt("/rakna-ut-ditt-pris");

    // The contact + submit step only appears after a service is chosen (Slice 12G).
    fireEvent.click(await screen.findByRole("button", { name: /Hemstädning/i }));
    const cta = await screen.findByRole("button", { name: /Skicka offertförfrågan/i });
    expect(cta).toBeEnabled();
    // Merely loading the page never writes — submit only fires on an explicit,
    // validated user action.
    expect(mocks.submit).not.toHaveBeenCalled();
  });
});
