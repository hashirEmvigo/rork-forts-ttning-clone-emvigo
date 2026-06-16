import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  PublicCalculateResponse,
  PublicConfigResponse,
  PublicQuestion,
} from "@/lib/calculator/publicCalculatorClient";

/**
 * Slice 12E — office cleaning is a RECURRING service: the engine returns a monthly
 * estimate, so the public result panel must read as a MONTHLY price
 * ("Uppskattat månadspris" + a "/mån" suffix on the figure) and the service card
 * must carry the recurring pricing hint. A one-off service (home cleaning) must
 * stay unchanged ("Uppskattat pris", no "/mån"). The Edge client is mocked, so the
 * real page + hooks run against fixtures.
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

function q(
  questionKey: string,
  label: string,
  inputType: string,
  required: boolean,
  sortOrder: number,
  options: unknown = [],
  validation: unknown = {},
): PublicQuestion {
  return { questionKey, label, helpText: null, inputType, required, options, validation, sortOrder };
}

const HOME_QUESTIONS: PublicQuestion[] = [
  q("sqm", "Boyta (m²)", "number", true, 1, [], { min: 10, max: 500, step: 1 }),
];

const OFFICE_QUESTIONS: PublicQuestion[] = [
  q("sqm", "Kontorsyta (m²)", "number", true, 1, [], { min: 10, max: 5000, step: 1 }),
  q("frequency", "Ordinarie städning", "select", true, 2, [
    { value: "weekly", label: "Varje vecka" },
    { value: "custom_interval", label: "Annat intervall" },
  ]),
  q("toilets", "Antal toaletter", "integer", false, 3, [], { min: 0, max: 50, step: 1 }),
  q("supervision_cleaning", "Tillsynsstädning", "boolean", false, 8),
  q("supervision_visits_per_week", "Önskat antal tillfällen per vecka", "integer", false, 9, [], { min: 0, max: 21 }),
  q("supervision_minutes_per_visit", "Önskad tidsåtgång per tillfälle (minuter)", "integer", false, 10, [], { min: 0, max: 480 }),
];

/** A config with home (one-off) + office (recurring) public services. */
function makeConfig(): PublicConfigResponse {
  return {
    ok: true,
    enabled: true,
    company: { name: "Städalliansen Sverige AB" },
    settings: {
      publicSlug: "rakna-ut-ditt-pris",
      priceDisplayMode: "range",
      currency: "SEK",
      showPriceBeforeContact: true,
      requireContactBeforeResult: false,
      showLoginPromptAfterSubmit: true,
      rutDisplayMode: "none",
      defaultVatRatePercent: 25,
      quoteValidityDays: 30,
    },
    content: {
      pageTitle: "Räkna ut ditt pris",
      pageSubtitle: "Snabbt och enkelt.",
      backToWebsite: { label: "Tillbaka", href: "/" },
    },
    services: [
      {
        serviceKey: "home_cleaning",
        displayName: "Hemstädning",
        description: "Återkommande hemstädning.",
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
        questions: HOME_QUESTIONS,
        addons: [],
      },
      {
        serviceKey: "office_cleaning",
        displayName: "Kontorsstädning",
        description: "Återkommande kontorsstädning.",
        enabled: true,
        comingSoon: false,
        pricingModel: "office_cleaning_recurring_area_frequency",
        genericPricingModel: null,
        engineSupported: false,
        primaryInput: null,
        unitLabel: null,
        requiresCleaningPlan: false,
        plansEnabled: false,
        planPricingModel: "hourly_rate_by_plan",
        defaultPlanKey: null,
        baseHourlyRateExclVat: null,
        defaultVatRatePercent: 25,
        sortOrder: 3,
        questions: OFFICE_QUESTIONS,
        addons: [],
      },
    ],
    cleaningPlans: [
      { id: "p1", planKey: "flexible", name: "Flexibel", description: "Lägre timpris.", serviceKey: "home_cleaning", hourlyRate: 349, vatRatePercent: 25, priceAdjustmentType: "fixed_amount", priceAdjustmentValue: 0, rutEligible: false, rutEnabled: false, rutPercent: 0, rutApplyTo: "total_customer_price", showRutBreakdown: false, flexibilityLevel: "high", customerDayTimeControl: null, sameStaffPreferenceLevel: null, bookingPriority: null, cancellationTermsSummary: null, isDefault: true, sortOrder: 1 },
    ],
    faq: [],
  };
}

const OFFICE_RESULT: PublicCalculateResponse = {
  ok: true,
  enabled: true,
  valid: true,
  issues: [],
  serviceKey: "office_cleaning",
  pricingModel: "office_cleaning_recurring_area_frequency",
  formulaVersion: "v1",
  currency: "SEK",
  priceDisplayMode: "range",
  estimatedHours: null,
  calculatedPrice: 5000,
  minPrice: 4500,
  maxPrice: 5500,
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
  displayText: "4 500–5 500 kr",
  selectedPlan: null,
};

beforeAll(() => {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.releasePointerCapture ??= () => {};
  proto.scrollIntoView ??= () => {};
});

function renderCalculator() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/rakna-ut-ditt-pris"]}>
        <PriceCalculator />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetchConfig.mockResolvedValue({ status: "ok", config: makeConfig() });
  mocks.calculate.mockResolvedValue(OFFICE_RESULT);
});

describe("PriceCalculator — office recurring (monthly) wording", () => {
  it("shows the recurring pricing hint on the office service card", async () => {
    renderCalculator();

    // Both services render initially (≤ 3 → no 'Visa fler'); the office card carries
    // the recurring pricing hint ("based on area and frequency").
    await waitFor(() => expect(screen.getByText("Kontorsstädning")).toBeInTheDocument());
    expect(screen.getByText(/Beräknas på yta och städfrekvens/i)).toBeInTheDocument();
  });

  it("labels the office estimate as a monthly price (Uppskattat månadspris + /mån)", async () => {
    renderCalculator();

    // Select the recurring office service.
    fireEvent.click(await screen.findByRole("button", { name: /Kontorsstädning/i }));

    // The result eyebrow switches to the recurring (monthly) label immediately.
    expect(await screen.findByText("Uppskattat månadspris")).toBeInTheDocument();

    // Once an area is entered and the server returns a valid figure, the price is
    // suffixed with "/mån" so it never reads as a one-off total.
    fireEvent.change(await screen.findByLabelText(/Kontorsyta/), { target: { value: "120" } });

    expect(
      (await screen.findAllByText("4 500–5 500 kr", undefined, { timeout: 3000 })).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText("/mån").length).toBeGreaterThan(0);
  });

  it("keeps a one-off (non-recurring) service unchanged (Uppskattat pris, no /mån)", async () => {
    renderCalculator();

    // Select home cleaning (no auto-selection as of Slice 12G): the resting eyebrow
    // is the one-off label and no monthly suffix is shown anywhere.
    fireEvent.click(await screen.findByRole("button", { name: /Hemstädning/i }));
    expect(await screen.findByText("Uppskattat pris")).toBeInTheDocument();
    expect(screen.queryByText("Uppskattat månadspris")).not.toBeInTheDocument();
    expect(screen.queryByText("/mån")).not.toBeInTheDocument();
  });
});

describe("PriceCalculator — office custom interval + supervision (Slice 12F)", () => {
  it("shows the manual-review message for a custom interval and never a misleading price", async () => {
    renderCalculator();

    fireEvent.click(await screen.findByRole("button", { name: /Kontorsstädning/i }));
    // Choose "Annat intervall" in the frequency select.
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(await screen.findByRole("option", { name: /Annat intervall/i }));

    // The customer-info notice + the result-panel manual-review note appear, and
    // no automatic monthly price is ever requested or shown.
    expect(await screen.findByText(/För specialupplägg behöver vi mer information/i)).toBeInTheDocument();
    expect(screen.getByText(/priset manuellt/i)).toBeInTheDocument();
    expect(screen.queryByText("4 500–5 500 kr")).not.toBeInTheDocument();
    expect(screen.queryByText("/mån")).not.toBeInTheDocument();
    expect(mocks.calculate).not.toHaveBeenCalled();
  });

  it("reveals the supervision detail fields only when the supervision toggle is on", async () => {
    renderCalculator();

    fireEvent.click(await screen.findByRole("button", { name: /Kontorsstädning/i }));
    // Detail fields are hidden until the toggle is enabled (shortened labels — Slice 12H).
    expect(screen.queryByLabelText(/Tillfällen per vecka/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Tillsynsstädning"));

    expect(await screen.findByLabelText("Tillfällen per vecka")).toBeInTheDocument();
    expect(screen.getByLabelText("Minuter per tillfälle")).toBeInTheDocument();
  });

  it("renders the office fields in calm, titled sections (Slice 12G grouping)", async () => {
    renderCalculator();

    fireEvent.click(await screen.findByRole("button", { name: /Kontorsstädning/i }));

    // Step 2 is grouped into scannable cards rather than one cramped flat grid.
    // Slice 12H: the five data fields share one symmetrical group, extras separate.
    expect(await screen.findByText("Lokal och städning")).toBeInTheDocument();
    expect(screen.getByText("Tillägg och önskemål")).toBeInTheDocument();
  });
});
