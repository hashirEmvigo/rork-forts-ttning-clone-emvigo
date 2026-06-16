import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  PublicAddon,
  PublicCalculateRequest,
  PublicCalculateResponse,
  PublicCleaningPlan,
  PublicService,
} from "@/lib/calculator/publicCalculatorClient";

/**
 * GPM-10-C — an enabled + ready generic `sqm_fixed` service that has active,
 * public-visible add-ons must expose them as real, selectable inputs in the public
 * calculator, and those selections must flow into the SAME server-authoritative
 * calculate/submit path (under `answers.addonSelections`) the runtime already
 * prices. These tests exercise the real public page (the Edge client is mocked) and
 * pin the contract:
 *   • a service WITH add-ons renders the "Tillval" step + its add-on inputs;
 *   • toggling a boolean add-on includes it in the calculate request;
 *   • a quantity add-on renders a number input and sends the chosen quantity;
 *   • the (mocked) server result that reflects the add-on is shown in the panel;
 *   • a service WITHOUT add-ons renders no Tillval step and is otherwise unchanged;
 *   • legacy/Home (no generic add-ons) is unchanged;
 *   • an INCOMPLETE (non-selectable) service never renders add-on inputs.
 * No serviceKey-specific logic: behaviour is driven purely by the service's add-ons.
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

/** A public boolean add-on (overridable). */
function booleanAddon(over: Partial<PublicAddon> = {}): PublicAddon {
  return {
    addonKey: "balcony",
    publicLabel: "Inglasad balkong",
    description: null,
    inputType: "boolean",
    booleanDefault: false,
    quantityMin: 0,
    quantityMax: null,
    quantityStep: 1,
    quantityDefault: 0,
    required: false,
    sortOrder: 1,
    ...over,
  };
}

/** A public quantity add-on (overridable). */
function quantityAddon(over: Partial<PublicAddon> = {}): PublicAddon {
  return booleanAddon({
    addonKey: "windows",
    publicLabel: "Antal fönster",
    inputType: "quantity",
    quantityMin: 0,
    quantityMax: 20,
    quantityStep: 1,
    quantityDefault: 0,
    sortOrder: 2,
    ...over,
  });
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
 * A fully-ready generic `sqm_fixed` service (mirrors the server's literal sqm_fixed
 * config). Overridable so add-on / no-add-on variants are easy to build.
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

/** A valid sqm_fixed calculate result; `price` drives every customer-facing figure. */
function sqmResult(serviceKey: string, price: number): PublicCalculateResponse {
  const exclVat = Math.round((price / 1.25) * 100) / 100;
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
    calculatedPrice: price,
    minPrice: price,
    maxPrice: price,
    priceExclVat: exclVat,
    vatRatePercent: 25,
    vatAmount: Math.round((price - exclVat) * 100) / 100,
    priceInclVat: price,
    rutEnabled: false,
    rutPercent: 50,
    showRutBreakdown: false,
    rutDeduction: null,
    priceAfterRut: null,
    roundingIncrement: null,
    displayText: `Cirka ${price.toLocaleString("sv-SE").replace(/\u00a0/g, " ")} kr`,
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

const ADDONS_STEP_NAME = /^Tillval$/;
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

/** The last calculate request the mocked Edge client received. */
function lastCalcRequest(): PublicCalculateRequest {
  const call = mocks.calculate.mock.calls.at(-1);
  return call?.[1] as PublicCalculateRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PriceCalculator — generic add-ons public flow (GPM-10-C)", () => {
  it("renders the Tillval step + add-on input for a service WITH active add-ons", async () => {
    mocks.fetchConfig.mockResolvedValue({
      status: "ok",
      config: makeConfig(
        [legacyHome(), sqmFixedService({ addons: [booleanAddon()] })],
        [sqmPlan("flyttstad_sqm")],
      ),
    });
    renderCalculator();

    fireEvent.click(await screen.findByRole("button", { name: /Flyttstädning/i }));

    // The dedicated add-ons step + the add-on's customer-facing input both render.
    expect(await screen.findByRole("heading", { name: ADDONS_STEP_NAME })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: /Inglasad balkong/i })).toBeInTheDocument();
  });

  it("does NOT render the Tillval step for a service without add-ons", async () => {
    mocks.fetchConfig.mockResolvedValue({
      status: "ok",
      config: makeConfig([legacyHome(), sqmFixedService()], [sqmPlan("flyttstad_sqm")]),
    });
    renderCalculator();

    fireEvent.click(await screen.findByRole("button", { name: /Flyttstädning/i }));

    // Details step is there, but no add-ons step (zero footprint for no-addon services).
    expect(await screen.findByText("Fyll i information om uppdraget")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: ADDONS_STEP_NAME })).not.toBeInTheDocument();
  });

  it("includes a toggled boolean add-on in the calculate request under addonSelections", async () => {
    mocks.fetchConfig.mockResolvedValue({
      status: "ok",
      config: makeConfig(
        [sqmFixedService({ addons: [booleanAddon()] })],
        [sqmPlan("flyttstad_sqm")],
      ),
    });
    mocks.calculate.mockResolvedValue(sqmResult("flyttstad_sqm", 3840));
    renderCalculator();

    fireEvent.click(await screen.findByRole("button", { name: /Flyttstädning/i }));
    fireEvent.change(await screen.findByLabelText(/Boyta/), { target: { value: "80" } });
    fireEvent.click(await screen.findByRole("switch", { name: /Inglasad balkong/i }));

    // The selection rides along on the SAME calculate request, under addonSelections.
    await waitFor(
      () =>
        expect(mocks.calculate).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            serviceKey: "flyttstad_sqm",
            addonSelections: { balcony: true },
          }),
        ),
      { timeout: 3000 },
    );
  });

  it("reflects the add-on in the (server-authoritative) price shown in the panel", async () => {
    mocks.fetchConfig.mockResolvedValue({
      status: "ok",
      config: makeConfig(
        [sqmFixedService({ addons: [booleanAddon()] })],
        [sqmPlan("flyttstad_sqm")],
      ),
    });
    // The mocked server prices the add-on: +160 kr when the balcony toggle is on.
    mocks.calculate.mockImplementation((_slug: string, req: PublicCalculateRequest) =>
      Promise.resolve(
        sqmResult("flyttstad_sqm", req.addonSelections?.balcony === true ? 4000 : 3840),
      ),
    );
    renderCalculator();

    fireEvent.click(await screen.findByRole("button", { name: /Flyttstädning/i }));
    fireEvent.change(await screen.findByLabelText(/Boyta/), { target: { value: "80" } });

    // Base price first…
    expect((await screen.findAllByText(/3 840/, undefined, { timeout: 3000 })).length).toBeGreaterThan(0);

    // …then the add-on raises it through the same server path.
    fireEvent.click(screen.getByRole("switch", { name: /Inglasad balkong/i }));
    expect((await screen.findAllByText(/4 000/, undefined, { timeout: 3000 })).length).toBeGreaterThan(0);
  });

  it("renders a quantity add-on as a number input and sends the chosen quantity", async () => {
    mocks.fetchConfig.mockResolvedValue({
      status: "ok",
      config: makeConfig(
        [sqmFixedService({ addons: [quantityAddon()] })],
        [sqmPlan("flyttstad_sqm")],
      ),
    });
    mocks.calculate.mockResolvedValue(sqmResult("flyttstad_sqm", 3840));
    renderCalculator();

    fireEvent.click(await screen.findByRole("button", { name: /Flyttstädning/i }));
    fireEvent.change(await screen.findByLabelText(/Boyta/), { target: { value: "80" } });
    fireEvent.change(await screen.findByLabelText(/Antal fönster/), { target: { value: "3" } });

    await waitFor(
      () =>
        expect(mocks.calculate).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({ addonSelections: { windows: 3 } }),
        ),
      { timeout: 3000 },
    );
  });

  it("keeps the request free of addonSelections until a selection is made", async () => {
    mocks.fetchConfig.mockResolvedValue({
      status: "ok",
      config: makeConfig(
        [sqmFixedService({ addons: [booleanAddon()] })],
        [sqmPlan("flyttstad_sqm")],
      ),
    });
    mocks.calculate.mockResolvedValue(sqmResult("flyttstad_sqm", 3840));
    renderCalculator();

    fireEvent.click(await screen.findByRole("button", { name: /Flyttstädning/i }));
    fireEvent.change(await screen.findByLabelText(/Boyta/), { target: { value: "80" } });

    await waitFor(() => expect(mocks.calculate).toHaveBeenCalled(), { timeout: 3000 });
    // Default-off boolean add-on, untouched → the request omits addonSelections entirely
    // (the server applies the default), preserving the established payload shape.
    expect("addonSelections" in lastCalcRequest()).toBe(false);
  });

  it("does NOT render add-on inputs for an incomplete (non-selectable) service", async () => {
    mocks.fetchConfig.mockResolvedValue({
      status: "ok",
      config: makeConfig(
        [legacyHome(), sqmFixedService({ engineSupported: false, addons: [booleanAddon()] })],
        [sqmPlan("flyttstad_sqm")],
      ),
    });
    renderCalculator();

    // The incomplete service sits in the read-only preview lane and is not selectable,
    // so its add-on input is never rendered and calculate is never called.
    expect(await screen.findByRole("region", { name: PREVIEW_SECTION_NAME })).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: /Inglasad balkong/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: ADDONS_STEP_NAME })).not.toBeInTheDocument();
  });

  it("keeps legacy/Home unchanged (no Tillval step; normal details flow)", async () => {
    mocks.fetchConfig.mockResolvedValue({
      status: "ok",
      config: makeConfig([legacyHome(), sqmFixedService({ addons: [booleanAddon()] })], [sqmPlan("flyttstad_sqm")]),
    });
    renderCalculator();

    fireEvent.click(await screen.findByRole("button", { name: /Hemstädning/i }));

    expect(await screen.findByText("Fyll i information om uppdraget")).toBeInTheDocument();
    // Home carries no generic add-ons here → no Tillval step (unchanged behaviour).
    expect(screen.queryByRole("heading", { name: ADDONS_STEP_NAME })).not.toBeInTheDocument();
  });
});
