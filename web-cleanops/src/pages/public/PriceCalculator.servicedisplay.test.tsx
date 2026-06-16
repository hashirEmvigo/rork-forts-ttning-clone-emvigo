import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { PublicConfigResponse, PublicQuestion, PublicService } from "@/lib/calculator/publicCalculatorClient";

/**
 * Slice 12C, Part D — the public service selector shows the first 3 services and
 * reveals the rest behind "Visa fler". Exercises the real page + hooks against a
 * 4-service config fixture (the Edge client is mocked).
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

function q(questionKey: string, label: string, sortOrder: number): PublicQuestion {
  return {
    questionKey,
    label,
    helpText: null,
    inputType: "number",
    required: true,
    options: [],
    validation: { min: 1, max: 500, step: 1 },
    sortOrder,
  };
}

function svc(serviceKey: string, displayName: string, sortOrder: number): PublicService {
  return {
    serviceKey,
    displayName,
    description: `${displayName} beskrivning.`,
    enabled: true,
    comingSoon: false,
    pricingModel: "move_out_fixed_plus_addons",
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
    sortOrder,
    questions: [q("sqm", "Boyta (m²)", 1)],
    addons: [],
  };
}

/** A config with FOUR public-ready services (triggers the "Visa fler" toggle). */
function makeFourServiceConfig(): PublicConfigResponse {
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
      svc("home_cleaning", "Hemstädning", 1),
      svc("move_out_cleaning", "Flyttstädning", 2),
      svc("office_cleaning", "Kontorsstädning", 3),
      svc("window_cleaning", "Fönsterputs", 4),
    ],
    cleaningPlans: [],
    faq: [],
  };
}

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
  mocks.fetchConfig.mockResolvedValue({ status: "ok", config: makeFourServiceConfig() });
});

describe("PriceCalculator — service display (Visa fler)", () => {
  it("shows the first 3 services and hides the rest behind 'Visa fler'", async () => {
    renderCalculator();

    await waitFor(() => expect(screen.getByText("Hemstädning")).toBeInTheDocument());

    // First three featured services are visible.
    expect(screen.getByText("Flyttstädning")).toBeInTheDocument();
    expect(screen.getByText("Kontorsstädning")).toBeInTheDocument();
    // The fourth is hidden until expanded.
    expect(screen.queryByText("Fönsterputs")).not.toBeInTheDocument();

    // The toggle advertises how many more there are.
    const toggle = screen.getByRole("button", { name: /Visa fler/i });
    expect(toggle).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(screen.getByText("Fönsterputs")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Visa färre/i })).toBeInTheDocument();
  });
});
