import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  PublicCalculateResponse,
  PublicCleaningPlan,
  PublicService,
} from "@/lib/calculator/publicCalculatorClient";

/**
 * GPM-9 — an explicitly enabled + ready generic `sqm_fixed` service must be a real
 * SELECTABLE + CALCULABLE public service, not a read-only preview card. These tests
 * exercise the real public page (the Edge client is mocked) and pin the contract:
 *   • a ready sqm_fixed service is a clickable selector card (not in the preview lane);
 *   • selecting it renders the area / m² input and the per-m² pricing basis;
 *   • entering m² calculates through the SAME server-authoritative calculate path as
 *     every other service (serviceKey + answers.sqm + active plan) — no serviceKey
 *     hardcoding, no legacy pricing rules;
 *   • the per-m² plan step never shows a misleading hourly ("kr/h") figure;
 *   • an INCOMPLETE sqm_fixed service (engine not yet supported) is NOT selectable;
 *   • legacy/Home stays selectable + calculable, unchanged.
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

/** Fully-typed PublicService factory (all required fields) — overridable. */
function svc(overrides: Partial<PublicService> = {}): PublicService {
  return {
    serviceKey: "svc",
    displayName: "Tjänst",
    description: null,
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
    sortOrder: 1,
    questions: [],
    addons: [],
    ...overrides,
  };
}

/** A legacy/Home service (no generic model → selectable, unchanged). */
function legacyHome(): PublicService {
  return svc({
    serviceKey: "home_cleaning",
    displayName: "Hemstädning",
    description: "Återkommande hemstädning.",
    pricingModel: "home_cleaning_recommended_hours",
    requiresCleaningPlan: true,
    plansEnabled: true,
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
  });
}

/**
 * A fully-ready generic `sqm_fixed` service: enabled, engine-supported, with the
 * canonical `sqm` input + unit label, plans enabled and a default priced plan.
 * Mirrors the server's literal-sqm_fixed config (pricingModel === genericPricingModel
 * === "sqm_fixed"). Overridable so incomplete variants are easy to build.
 */
function sqmFixedService(overrides: Partial<PublicService> = {}): PublicService {
  return svc({
    serviceKey: "flyttstad_sqm",
    displayName: "Flyttstädning",
    description: "Fast pris per kvadratmeter.",
    pricingModel: "sqm_fixed",
    genericPricingModel: "sqm_fixed",
    engineSupported: true,
    primaryInput: "sqm",
    unitLabel: "m²",
    requiresCleaningPlan: false,
    plansEnabled: true,
    defaultPlanKey: "normal",
    sortOrder: 2,
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
    ...overrides,
  });
}

/** The service's condition plan — carries a price per m² (hourlyRate is 0/irrelevant). */
function sqmPlan(serviceKey: string): PublicCleaningPlan {
  return {
    id: "plan-normal",
    planKey: "normal",
    name: "Normalt skick",
    description: "Standardskick.",
    serviceKey,
    hourlyRate: 0,
    vatRatePercent: 25,
    priceAdjustmentType: "fixed_amount",
    priceAdjustmentValue: 0,
    rutEligible: true,
    rutEnabled: false,
    rutPercent: 50,
    rutApplyTo: "total_customer_price",
    showRutBreakdown: false,
    flexibilityLevel: null,
    customerDayTimeControl: null,
    sameStaffPreferenceLevel: null,
    bookingPriority: null,
    cancellationTermsSummary: null,
    isDefault: true,
    sortOrder: 1,
  };
}

/** A valid sqm_fixed calculate result (80 m² × 48 = 3840 excl VAT → 3840 incl, no RUT). */
function sqmResult(serviceKey: string): PublicCalculateResponse {
  return {
    ok: true,
    enabled: true,
    valid: true,
    issues: [],
    serviceKey,
    pricingModel: "sqm_fixed",
    formulaVersion: "v2",
    currency: "SEK",
    priceDisplayMode: "range",
    estimatedHours: null,
    calculatedPrice: 3840,
    minPrice: 3840,
    maxPrice: 3840,
    priceExclVat: 3072,
    vatRatePercent: 25,
    vatAmount: 768,
    priceInclVat: 3840,
    rutEnabled: false,
    rutPercent: 50,
    showRutBreakdown: false,
    rutDeduction: null,
    priceAfterRut: null,
    roundingIncrement: null,
    displayText: "Cirka 3 840 kr",
    selectedPlan: {
      planKey: "normal",
      name: "Normalt skick",
      hourlyRate: 0,
      vatRatePercent: 25,
      rutEnabled: false,
      rutPercent: 50,
      showRutBreakdown: false,
    },
  };
}

/** Builds a config response (return type intentionally inferred — the mock is untyped). */
function makeConfig(services: PublicService[], cleaningPlans: PublicCleaningPlan[] = []) {
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
      quoteValidityDays: 30,
    },
    content: {
      pageTitle: "Räkna ut ditt pris",
      pageSubtitle: "Snabbt och enkelt.",
      backToWebsite: { label: "Tillbaka", href: "/" },
    },
    services,
    cleaningPlans,
    faq: [],
  };
}

const PREVIEW_SECTION_NAME = /Förhandsvisning av nya tjänster/i;

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
});

describe("PriceCalculator — selectable generic sqm_fixed service (GPM-9)", () => {
  it("renders an enabled + ready sqm_fixed service as a SELECTABLE card (not preview-only)", async () => {
    mocks.fetchConfig.mockResolvedValue({
      status: "ok",
      config: makeConfig([legacyHome(), sqmFixedService()], [sqmPlan("flyttstad_sqm")]),
    });
    renderCalculator();

    // It is a real, clickable selector button — the core GPM-9 outcome.
    const card = await screen.findByRole("button", { name: /Flyttstädning/i });
    expect(card).toBeInTheDocument();
    // It carries the correct per-m² pricing basis hint.
    expect(within(card).getByText("Beräknas per m²")).toBeInTheDocument();
    // It is NOT in the read-only preview lane (which is absent — every service is selectable).
    expect(screen.queryByRole("region", { name: PREVIEW_SECTION_NAME })).not.toBeInTheDocument();
  });

  it("selecting the service renders the area / m² input in the details step", async () => {
    mocks.fetchConfig.mockResolvedValue({
      status: "ok",
      config: makeConfig([legacyHome(), sqmFixedService()], [sqmPlan("flyttstad_sqm")]),
    });
    renderCalculator();

    fireEvent.click(await screen.findByRole("button", { name: /Flyttstädning/i }));

    // The details step appears and the canonical sqm (area) input renders.
    expect(await screen.findByText("Fyll i information om uppdraget")).toBeInTheDocument();
    expect(await screen.findByLabelText(/Boyta/)).toBeInTheDocument();
  });

  it("entering m² calculates through the existing server path (serviceKey + sqm + active plan)", async () => {
    mocks.fetchConfig.mockResolvedValue({
      status: "ok",
      config: makeConfig([legacyHome(), sqmFixedService()], [sqmPlan("flyttstad_sqm")]),
    });
    mocks.calculate.mockResolvedValue(sqmResult("flyttstad_sqm"));
    renderCalculator();

    fireEvent.click(await screen.findByRole("button", { name: /Flyttstädning/i }));
    fireEvent.change(await screen.findByLabelText(/Boyta/), { target: { value: "80" } });

    // The existing (server-authoritative) calculate path is invoked with the generic
    // payload: the service key, the customer's area answer, and the auto-selected plan.
    await waitFor(
      () =>
        expect(mocks.calculate).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({ serviceKey: "flyttstad_sqm", cleaningPlanKey: "normal" }),
        ),
      { timeout: 3000 },
    );
    const lastCall = mocks.calculate.mock.calls.at(-1);
    expect((lastCall?.[1] as { answers: Record<string, unknown> }).answers.sqm).toBeDefined();

    // …and the server-returned figure is rendered in the result panel.
    expect((await screen.findAllByText(/3 840/, undefined, { timeout: 3000 })).length).toBeGreaterThan(0);
  });

  it("never shows a misleading hourly (kr/h) figure for the per-m² plan step", async () => {
    mocks.fetchConfig.mockResolvedValue({
      status: "ok",
      config: makeConfig([legacyHome(), sqmFixedService()], [sqmPlan("flyttstad_sqm")]),
    });
    renderCalculator();

    fireEvent.click(await screen.findByRole("button", { name: /Flyttstädning/i }));

    // The plan step shows the condition plan, but the per-plan hourly-rate FIGURE block
    // (the "0 kr/h" amount + its "timpris" label) is hidden for a per-m² service. The
    // generic plan-step hint copy may still mention the word, so we target the label span
    // exactly rather than any substring.
    expect(await screen.findByText("Normalt skick")).toBeInTheDocument();
    expect(screen.queryByText("timpris")).not.toBeInTheDocument();
    expect(screen.queryByText(/kr\/h/i)).not.toBeInTheDocument();
  });

  it("does NOT make an INCOMPLETE sqm_fixed service selectable (engine not yet supported)", async () => {
    // engineSupported=false → client cannot render it → it stays in the read-only preview.
    mocks.fetchConfig.mockResolvedValue({
      status: "ok",
      config: makeConfig(
        [legacyHome(), sqmFixedService({ engineSupported: false })],
        [sqmPlan("flyttstad_sqm")],
      ),
    });
    renderCalculator();

    await waitFor(() => expect(screen.getByText("Hemstädning")).toBeInTheDocument());

    // Not a selectable button…
    expect(screen.queryByRole("button", { name: /Flyttstädning/i })).not.toBeInTheDocument();
    // …it appears in the read-only preview lane instead, and never calls calculate.
    const preview = screen.getByRole("region", { name: PREVIEW_SECTION_NAME });
    expect(within(preview).getByText("Flyttstädning")).toBeInTheDocument();
    expect(mocks.calculate).not.toHaveBeenCalled();
  });

  it("is driven by the pricing model, not the service key (a differently-keyed sqm_fixed is equally selectable)", async () => {
    mocks.fetchConfig.mockResolvedValue({
      status: "ok",
      config: makeConfig(
        [legacyHome(), sqmFixedService({ serviceKey: "garden_sqm", displayName: "Trädgårdsskötsel" })],
        [sqmPlan("garden_sqm")],
      ),
    });
    renderCalculator();

    expect(await screen.findByRole("button", { name: /Trädgårdsskötsel/i })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: PREVIEW_SECTION_NAME })).not.toBeInTheDocument();
  });

  it("keeps legacy/Home selectable and on its normal flow (unchanged)", async () => {
    mocks.fetchConfig.mockResolvedValue({
      status: "ok",
      config: makeConfig([legacyHome(), sqmFixedService()], [sqmPlan("flyttstad_sqm")]),
    });
    renderCalculator();

    const homeButton = await screen.findByRole("button", { name: /Hemstädning/i });
    fireEvent.click(homeButton);

    // Home advances to its details step exactly as before — no behaviour change.
    expect(await screen.findByText("Fyll i information om uppdraget")).toBeInTheDocument();
    expect(await screen.findByLabelText(/Boyta/)).toBeInTheDocument();
  });
});
