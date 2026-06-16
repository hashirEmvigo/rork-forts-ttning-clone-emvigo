import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { normalizePublicConfigResponse, PublicCalculatorError } from "@/lib/calculator/publicCalculatorClient";
import type {
  PublicCalculateResponse,
  PublicConfigResponse,
  PublicQuestion,
  PublicSubmitRequest,
  PublicSubmitResponse,
} from "@/lib/calculator/publicCalculatorClient";

/**
 * Behavioural tests for the PUBLIC price calculator page (Slice 6A). The Edge
 * Function client is mocked, so the page + its React Query hooks are exercised
 * against fixtures that mirror the seeded Städalliansen config. These prove the
 * page is public (no auth context / no redirect), handles the disabled/dark
 * state, drives the dynamic form, calls `calculate` with the right payload, and
 * never wires `submit` in this slice.
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

// ── fixtures (mirror migration 0060) ─────────────────────────────────────────

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
  // Slice 9A: real, non-pricing informational question (mirrors migration 0061).
  q("property_type", "Typ av bostad", "select", false, 3, [
    { value: "apartment", label: "Lägenhet" },
    { value: "house", label: "Villa" },
    { value: "terraced", label: "Radhus" },
    { value: "other", label: "Annat" },
  ]),
  // Slice 12I: three private recurring intervals only (no monthly / one_time).
  q("frequency", "Intervall", "select", true, 4, [
    { value: "weekly", label: "Varje vecka" },
    { value: "biweekly", label: "Varannan vecka" },
    { value: "every_four_weeks", label: "Var fjärde vecka" },
  ]),
  q("addons", "Tillval", "multiselect", false, 5, [
    { value: "oven", label: "Ugn" },
    { value: "fridge", label: "Kyl/frys" },
  ]),
  // Still served by the config, but the page must NOT render it (canonical
  // Postnummer lives in the contact step) — see the consolidation test below.
  q("postal_code", "Postnummer", "postal_code", true, 6),
  // Slice 9A: optional, non-pricing free-text address.
  q("address", "Adress", "text", false, 7),
  // Slice 12G: price-affecting pets toggle (home only).
  q("has_pets", "Vi har husdjur", "boolean", false, 8),
];

const MOVEOUT_QUESTIONS: PublicQuestion[] = [
  q("sqm", "Boyta (m²)", "number", true, 1, [], { min: 10, max: 500, step: 1 }),
  q("property_type", "Typ av bostad", "select", true, 2, [
    { value: "apartment", label: "Lägenhet" },
    { value: "house", label: "Villa" },
  ]),
  q("bathrooms", "Antal badrum", "integer", true, 3, [], { min: 1, max: 10, step: 1 }),
  q("glazed_balcony", "Inglasad balkong", "boolean", false, 4),
  q("desired_date", "Önskat datum", "date", false, 5),
];

function makeConfig(enabled: boolean): PublicConfigResponse {
  return {
    ok: true,
    enabled,
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
      backToWebsite: { label: "Tillbaka till webbplatsen", href: "/" },
    },
    services: enabled
      ? [
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
            serviceKey: "move_out_cleaning",
            displayName: "Flyttstädning",
            description: "Noggrann flyttstädning.",
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
            sortOrder: 2,
            questions: MOVEOUT_QUESTIONS,
            addons: [],
          },
        ]
      : [],
    cleaningPlans: enabled
      ? [
          { id: "p1", planKey: "flexible", name: "Flexibel", description: "Lägre timpris.", serviceKey: "home_cleaning", hourlyRate: 349, vatRatePercent: 25, priceAdjustmentType: "fixed_amount", priceAdjustmentValue: 0, rutEligible: false, rutEnabled: false, rutPercent: 0, rutApplyTo: "total_customer_price", showRutBreakdown: false, flexibilityLevel: "high", customerDayTimeControl: null, sameStaffPreferenceLevel: null, bookingPriority: null, cancellationTermsSummary: null, isDefault: true, sortOrder: 1 },
          { id: "p2", planKey: "fixed", name: "Fast", description: "Fast dag och tid.", serviceKey: "home_cleaning", hourlyRate: 399, vatRatePercent: 25, priceAdjustmentType: "fixed_amount", priceAdjustmentValue: 0, rutEligible: false, rutEnabled: false, rutPercent: 0, rutApplyTo: "total_customer_price", showRutBreakdown: false, flexibilityLevel: "medium", customerDayTimeControl: null, sameStaffPreferenceLevel: null, bookingPriority: null, cancellationTermsSummary: null, isDefault: false, sortOrder: 2 },
          { id: "p3", planKey: "priority", name: "Prioritet", description: "Högsta prioritet.", serviceKey: "home_cleaning", hourlyRate: 449, vatRatePercent: 25, priceAdjustmentType: "fixed_amount", priceAdjustmentValue: 0, rutEligible: false, rutEnabled: false, rutPercent: 0, rutApplyTo: "total_customer_price", showRutBreakdown: false, flexibilityLevel: "low", customerDayTimeControl: null, sameStaffPreferenceLevel: null, bookingPriority: null, cancellationTermsSummary: null, isDefault: false, sortOrder: 3 },
        ]
      : [],
    faq: [{ q: "Hur beräknas priset?", a: "Baseras på ytan och vald plan." }],
  };
}

const HOME_RESULT: PublicCalculateResponse = {
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

const HOME_SUBMIT_SUCCESS: PublicSubmitResponse = {
  ok: true,
  enabled: true,
  available: true,
  status: "submitted",
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
  quoteRequestLegacyId: "Q-2045",
  reference: null,
  validUntil: "2025-12-31",
  requiresManualReview: false,
  nextStep: { confirmationText: "Vi återkommer inom kort med en offert.", showLoginPrompt: false, loginPromptText: null },
};

// Radix primitives (Select/Switch) probe these jsdom-missing APIs.
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

/**
 * Renders + selects a service (no auto-selection as of Slice 12G — the details,
 * plan, contact steps and the right-side result panel only appear after an
 * explicit choice). Defaults to Hemstädning.
 */
async function renderAndSelect(name: RegExp = /Hemstädning/i): Promise<void> {
  renderCalculator();
  fireEvent.click(await screen.findByRole("button", { name }));
}

/** Reads the robots meta the <Seo> component writes for the current page state. */
function robotsContent(): string | null {
  return document.head.querySelector<HTMLMetaElement>('meta[name="robots"]')?.getAttribute("content") ?? null;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetchConfig.mockResolvedValue({ status: "ok", config: makeConfig(true) });
  mocks.calculate.mockResolvedValue(HOME_RESULT);
  mocks.submit.mockResolvedValue(HOME_SUBMIT_SUCCESS);
});

describe("PriceCalculator — public access", () => {
  it("renders for an unauthenticated visitor (no AppProvider, no redirect) and sets SEO", async () => {
    renderCalculator();

    // The page renders with no auth context wrapping it — proving it is public.
    expect(await screen.findByRole("heading", { level: 1, name: "Räkna ut ditt pris" })).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe("Räkna ut ditt pris | Städportalen"));
  });
});

describe("PriceCalculator — disabled (dark) state", () => {
  it("shows a coming-soon state and never calls calculate", async () => {
    mocks.fetchConfig.mockResolvedValue({ status: "ok", config: makeConfig(false) });
    renderCalculator();

    expect(await screen.findByText(/Vi finjusterar våra priser/i)).toBeInTheDocument();
    // No active calculator surface — and crucially no submit surface.
    expect(screen.queryByText("Hemstädning")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Skicka offertförfrågan/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/E-post/)).not.toBeInTheDocument();
    expect(mocks.calculate).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
  });
});

describe("PriceCalculator — enabled form", () => {
  it("renders enabled services and selects NONE by default (Slice 12G)", async () => {
    renderCalculator();

    const home = await screen.findByRole("button", { name: /Hemstädning/i });
    // No auto-selection: neither service card is pressed on initial load.
    expect(home).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: /Flyttstädning/i })).toHaveAttribute("aria-pressed", "false");
    // …and the right-side result panel is not shown until a service is chosen.
    expect(screen.queryByText("Uppskattat pris")).not.toBeInTheDocument();
  });

  it("home cleaning shows the cleaning-plan selector with the default plan selected", async () => {
    await renderAndSelect();

    expect(await screen.findByText("Välj städupplägg")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Flexibel/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Prioritet/i })).toBeInTheDocument();
  });

  it("move-out cleaning does NOT require a cleaning plan (no plan selector)", async () => {
    renderCalculator();

    fireEvent.click(await screen.findByRole("button", { name: /Flyttstädning/i }));

    await waitFor(() => expect(screen.queryByText("Välj städupplägg")).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /^Flexibel/i })).not.toBeInTheDocument();
  });

  it("calls calculate with the home payload and renders the server result", async () => {
    await renderAndSelect();

    fireEvent.change(await screen.findByLabelText(/Boyta \(m²\)/), { target: { value: "70" } });

    await waitFor(
      () =>
        expect(mocks.calculate).toHaveBeenLastCalledWith("rakna-ut-ditt-pris", {
          serviceKey: "home_cleaning",
          answers: { sqm: 70 },
          cleaningPlanKey: "flexible",
        }),
      { timeout: 3000 },
    );

    // The price now appears both as the headline and in the "Summering" row.
    expect((await screen.findAllByText("2 100–2 600 kr")).length).toBeGreaterThan(0);
    // Slice 12Q Phase B: per-visit time reads "3 tim, 0 min (3h)", not "3 h".
    expect(screen.getByText("3 tim, 0 min (3h)")).toBeInTheDocument();
  });

  it("calls calculate for move-out with no cleaning plan key value", async () => {
    mocks.calculate.mockResolvedValue({
      ...HOME_RESULT,
      serviceKey: "move_out_cleaning",
      pricingModel: "move_out_fixed_plus_addons",
      estimatedHours: null,
      displayText: "3 200–3 900 kr",
      selectedPlan: null,
    });
    renderCalculator();

    fireEvent.click(await screen.findByRole("button", { name: /Flyttstädning/i }));
    fireEvent.change(await screen.findByLabelText(/Boyta \(m²\)/), { target: { value: "70" } });

    await waitFor(
      () =>
        expect(mocks.calculate).toHaveBeenLastCalledWith("rakna-ut-ditt-pris", {
          serviceKey: "move_out_cleaning",
          answers: { sqm: 70 },
          cleaningPlanKey: null,
        }),
      { timeout: 3000 },
    );

    expect((await screen.findAllByText("3 200–3 900 kr")).length).toBeGreaterThan(0);
  });
});

/** A config whose Home Cleaning service uses a specific plan pricing model. */
function configWithHomePlanModel(
  planPricingModel: "hourly_rate_by_plan" | "price_adjustment_per_plan" | "time_adjustment_per_visit",
): PublicConfigResponse {
  const base = makeConfig(true);
  return {
    ...base,
    services: base.services.map((s) =>
      s.serviceKey === "home_cleaning" ? { ...s, plansEnabled: true, planPricingModel } : s,
    ),
  };
}

describe("PriceCalculator — plan card hourly-rate visibility (Slice 12J)", () => {
  it("hides per-plan hourly rates in time_adjustment_per_visit mode (names stay)", async () => {
    mocks.fetchConfig.mockResolvedValue({ status: "ok", config: configWithHomePlanModel("time_adjustment_per_visit") });
    await renderAndSelect();

    expect(await screen.findByText("Välj städupplägg")).toBeInTheDocument();
    // Plan names remain visible so the customer can still choose an upplägg…
    expect(screen.getByRole("button", { name: /Flexibel/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Prioritet/i })).toBeInTheDocument();
    // …but the misleading 349/399/449 kr/h comparison is hidden (one shared rate).
    expect(screen.queryByText("349 kr/h")).not.toBeInTheDocument();
    expect(screen.queryByText("399 kr/h")).not.toBeInTheDocument();
    expect(screen.queryByText("449 kr/h")).not.toBeInTheDocument();
    expect(screen.queryByText("timpris")).not.toBeInTheDocument();
  });

  it("shows per-plan hourly rates in hourly_rate_by_plan mode", async () => {
    mocks.fetchConfig.mockResolvedValue({ status: "ok", config: configWithHomePlanModel("hourly_rate_by_plan") });
    await renderAndSelect();

    expect(await screen.findByText("Välj städupplägg")).toBeInTheDocument();
    // Per-plan rates ARE the differentiator in this mode, so they remain visible.
    expect(screen.getByText("349 kr/h")).toBeInTheDocument();
  });
});

describe("PriceCalculator — submit (write path)", () => {
  it("renders the real contact fields when the calculator is enabled", async () => {
    await renderAndSelect();

    expect(await screen.findByLabelText(/^Namn$/)).toBeInTheDocument();
    expect(screen.getByLabelText(/E-post/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Telefon/)).toBeInTheDocument();
    // Postnummer is now a SINGLE canonical contact field — the duplicate
    // postal-code form question is no longer rendered in the details grid.
    expect(screen.getAllByLabelText(/Postnummer/)).toHaveLength(1);
    expect(screen.getByRole("button", { name: /Skicka offertförfrågan/i })).toBeEnabled();
  });

  it("requires a valid email before submitting (no network call) and links the error to the field", async () => {
    await renderAndSelect();

    fireEvent.click(await screen.findByRole("button", { name: /Skicka offertförfrågan/i }));

    expect(await screen.findByText(/Ange en giltig e-postadress/i)).toBeInTheDocument();
    expect(mocks.submit).not.toHaveBeenCalled();
    const emailInput = screen.getByLabelText(/E-post/);
    expect(emailInput).toHaveAttribute("aria-invalid", "true");
    expect(emailInput.getAttribute("aria-describedby") ?? "").toContain("calc-contact-email-error");
  });

  it("blocks submit for a malformed email", async () => {
    await renderAndSelect();

    fireEvent.change(await screen.findByLabelText(/E-post/), { target: { value: "not-an-email" } });
    fireEvent.click(screen.getByRole("button", { name: /Skicka offertförfrågan/i }));

    expect(await screen.findByText(/Ange en giltig e-postadress/i)).toBeInTheDocument();
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("submits home cleaning with serviceKey + cleaningPlanKey and the contact (never a client price)", async () => {
    await renderAndSelect();

    fireEvent.change(await screen.findByLabelText(/Boyta \(m²\)/), { target: { value: "70" } });
    fireEvent.change(screen.getByLabelText(/E-post/), { target: { value: "kund@example.com" } });
    fireEvent.change(screen.getByLabelText(/Postnummer/), { target: { value: "417 01" } });
    fireEvent.click(screen.getByRole("button", { name: /Skicka offertförfrågan/i }));

    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1));
    const [slug, request] = mocks.submit.mock.calls[0] as [string, PublicSubmitRequest];
    expect(slug).toBe("rakna-ut-ditt-pris");
    expect(request.serviceKey).toBe("home_cleaning");
    expect(request.cleaningPlanKey).toBe("flexible");
    expect(request.answers).toEqual({ sqm: 70 });
    expect(request.contact.email).toBe("kund@example.com");
    // The client price is NEVER part of the submit request.
    expect(Object.keys(request)).not.toContain("calculatedPrice");
    expect(Object.keys(request)).not.toContain("price");
  });

  it("submits move-out cleaning with no cleaningPlanKey", async () => {
    mocks.submit.mockResolvedValue({
      ...HOME_SUBMIT_SUCCESS,
      serviceKey: "move_out_cleaning",
      selectedPlan: null,
      estimatedHours: null,
    });
    renderCalculator();

    fireEvent.click(await screen.findByRole("button", { name: /Flyttstädning/i }));
    fireEvent.change(await screen.findByLabelText(/Boyta \(m²\)/), { target: { value: "70" } });
    fireEvent.change(screen.getByLabelText(/E-post/), { target: { value: "kund@example.com" } });
    fireEvent.change(screen.getByLabelText(/Postnummer/), { target: { value: "417 01" } });
    fireEvent.click(screen.getByRole("button", { name: /Skicka offertförfrågan/i }));

    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1));
    const [, request] = mocks.submit.mock.calls[0] as [string, PublicSubmitRequest];
    expect(request.serviceKey).toBe("move_out_cleaning");
    expect(request.cleaningPlanKey).toBeNull();
  });

  it("renders the quote-created confirmation on success and replaces the form", async () => {
    await renderAndSelect();

    fireEvent.change(await screen.findByLabelText(/E-post/), { target: { value: "kund@example.com" } });
    fireEvent.change(screen.getByLabelText(/Postnummer/), { target: { value: "417 01" } });
    fireEvent.click(screen.getByRole("button", { name: /Skicka offertförfrågan/i }));

    expect(await screen.findByText(/Offertförfrågan skickad/i)).toBeInTheDocument();
    expect(screen.getByText(/skapat en preliminär offertförfrågan/i)).toBeInTheDocument();
    // The safe, non-uuid legacy reference is shown; the submit CTA is gone.
    expect(screen.getByText("Q-2045")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Skicka offertförfrågan/i })).not.toBeInTheDocument();
  });

  it("never renders the raw internal status token in the confirmation", async () => {
    mocks.submit.mockResolvedValue({ ...HOME_SUBMIT_SUCCESS, status: "INTERNAL_STATUS_TOKEN" });
    await renderAndSelect();

    fireEvent.change(await screen.findByLabelText(/E-post/), { target: { value: "kund@example.com" } });
    fireEvent.change(screen.getByLabelText(/Postnummer/), { target: { value: "417 01" } });
    fireEvent.click(screen.getByRole("button", { name: /Skicka offertförfrågan/i }));

    await screen.findByText(/Offertförfrågan skickad/i);
    expect(document.body.textContent ?? "").not.toContain("INTERNAL_STATUS_TOKEN");
  });

  it("shows a friendly error and preserves the form when submit fails", async () => {
    mocks.submit.mockRejectedValue(new Error("Vi kunde inte skicka din förfrågan."));
    await renderAndSelect();

    fireEvent.change(await screen.findByLabelText(/E-post/), { target: { value: "kund@example.com" } });
    fireEvent.change(screen.getByLabelText(/Postnummer/), { target: { value: "417 01" } });
    fireEvent.click(screen.getByRole("button", { name: /Skicka offertförfrågan/i }));

    expect(await screen.findByText(/Vi kunde inte skicka din förfrågan/i)).toBeInTheDocument();
    // Form state is preserved (email kept) and the CTA stays — not a confirmation.
    expect(screen.getByLabelText(/E-post/)).toHaveValue("kund@example.com");
    expect(screen.getByRole("button", { name: /Skicka offertförfrågan/i })).toBeInTheDocument();
  });

  it("renders a hidden, non-tabbable honeypot field (never an accessible input)", async () => {
    await renderAndSelect();
    await screen.findByLabelText(/E-post/);

    const honeypot = document.querySelector<HTMLInputElement>('input[name="company_website"]');
    expect(honeypot).not.toBeNull();
    expect(honeypot?.getAttribute("tabindex")).toBe("-1");
    expect(honeypot?.getAttribute("autocomplete")).toBe("off");
    // It lives inside an aria-hidden container, so it is not an accessible field
    // and a real visitor never sees or fills it.
    expect(honeypot?.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it("shows a friendly rate-limit message on HTTP 429 and preserves the form (no confirmation)", async () => {
    mocks.submit.mockRejectedValue(
      new PublicCalculatorError(
        "För många förfrågningar just nu. Vänta en liten stund och försök igen.",
        { rateLimited: true, retryAfterSeconds: 30 },
      ),
    );
    await renderAndSelect();

    fireEvent.change(await screen.findByLabelText(/E-post/), { target: { value: "kund@example.com" } });
    fireEvent.change(screen.getByLabelText(/Postnummer/), { target: { value: "417 01" } });
    fireEvent.click(screen.getByRole("button", { name: /Skicka offertförfrågan/i }));

    expect(await screen.findByText(/För många förfrågningar/i)).toBeInTheDocument();
    // The form is preserved (email kept, CTA present) — NOT a success confirmation.
    expect(screen.getByLabelText(/E-post/)).toHaveValue("kund@example.com");
    expect(screen.getByRole("button", { name: /Skicka offertförfrågan/i })).toBeInTheDocument();
    expect(screen.queryByText(/Offertförfrågan skickad/i)).not.toBeInTheDocument();
  });

  it("prevents a duplicate submit while a request is in flight", async () => {
    let resolveSubmit: ((value: PublicSubmitResponse) => void) | null = null;
    mocks.submit.mockReturnValue(
      new Promise<PublicSubmitResponse>((resolve) => {
        resolveSubmit = resolve;
      }),
    );
    await renderAndSelect();

    fireEvent.change(await screen.findByLabelText(/E-post/), { target: { value: "kund@example.com" } });
    fireEvent.change(screen.getByLabelText(/Postnummer/), { target: { value: "417 01" } });
    fireEvent.click(screen.getByRole("button", { name: /Skicka offertförfrågan/i }));

    // While pending the CTA is disabled + announces busy, so a second click is a no-op.
    const busyCta = await screen.findByRole("button", { name: /Skickar/i });
    expect(busyCta).toBeDisabled();
    expect(busyCta).toHaveAttribute("aria-busy", "true");
    fireEvent.click(busyCta);

    expect(mocks.submit).toHaveBeenCalledTimes(1);
    resolveSubmit?.(HOME_SUBMIT_SUCCESS);
    expect(await screen.findByText(/Offertförfrågan skickad/i)).toBeInTheDocument();
  });
});

describe("PriceCalculator — Slice 9A UX (service collapse, fields, postal)", () => {
  it("renders Typ av bostad and Adress, and only a single canonical Postnummer", async () => {
    await renderAndSelect();

    expect(await screen.findByText("Typ av bostad")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Adress$/)).toBeInTheDocument();
    // The postal_code form question is filtered out; only the contact field remains.
    expect(screen.getAllByLabelText(/Postnummer/)).toHaveLength(1);
  });

  it("collapses the service grid into a summary after choosing a service, and reopens via Ändra tjänst", async () => {
    renderCalculator();

    // Initial state: the grid is expanded (both service cards are shown).
    const home = await screen.findByRole("button", { name: /Hemstädning/i });
    expect(screen.getByRole("button", { name: /Flyttstädning/i })).toBeInTheDocument();

    // Choosing a service collapses the grid into a compact summary row.
    fireEvent.click(home);
    expect(await screen.findByRole("button", { name: /Ändra tjänst/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Flyttstädning/i })).not.toBeInTheDocument();

    // "Ändra tjänst" re-expands the grid so the visitor can switch.
    fireEvent.click(screen.getByRole("button", { name: /Ändra tjänst/i }));
    expect(await screen.findByRole("button", { name: /Flyttstädning/i })).toBeInTheDocument();
  });

  it("requires Postnummer before submitting (no network call) and links the error to the field", async () => {
    await renderAndSelect();

    fireEvent.change(await screen.findByLabelText(/E-post/), { target: { value: "kund@example.com" } });
    // Postnummer left empty → the submit is blocked client-side.
    fireEvent.click(screen.getByRole("button", { name: /Skicka offertförfrågan/i }));

    expect(await screen.findByText(/Ange ditt postnummer/i)).toBeInTheDocument();
    expect(mocks.submit).not.toHaveBeenCalled();
    const postal = screen.getByLabelText(/Postnummer/);
    expect(postal).toHaveAttribute("aria-invalid", "true");
  });
});

describe("PriceCalculator — graceful fallbacks (partial/malformed config)", () => {
  it("shows a friendly unavailable state when enabled but no services exist", async () => {
    mocks.fetchConfig.mockResolvedValue({
      status: "ok",
      config: { ...makeConfig(true), services: [], cleaningPlans: [] },
    });
    renderCalculator();

    expect(await screen.findByText(/Inga tjänster är tillgängliga/i)).toBeInTheDocument();
    expect(mocks.calculate).not.toHaveBeenCalled();
  });

  it("shows a safe fallback (and never prices) when a required plan has no options", async () => {
    const config = makeConfig(true);
    config.services = config.services.filter((s) => s.serviceKey === "home_cleaning"); // requires a plan
    config.cleaningPlans = [];
    mocks.fetchConfig.mockResolvedValue({ status: "ok", config });
    renderCalculator();

    fireEvent.click(await screen.findByRole("button", { name: /Hemstädning/i }));
    expect(await screen.findByText(/Planalternativ kunde inte laddas/i)).toBeInTheDocument();
    expect(mocks.calculate).not.toHaveBeenCalled();
  });

  it("renders without crashing when the selected service has no questions", async () => {
    const config = makeConfig(true);
    const moveOut = config.services.find((s) => s.serviceKey === "move_out_cleaning")!;
    config.services = [{ ...moveOut, questions: [] }];
    config.cleaningPlans = [];
    mocks.fetchConfig.mockResolvedValue({ status: "ok", config });
    renderCalculator();

    fireEvent.click(await screen.findByRole("button", { name: /Flyttstädning/i }));
    expect(await screen.findByText(/Inga fält att fylla i/i)).toBeInTheDocument();
  });

  it("shows a friendly error (no crash) when the calculate request fails", async () => {
    mocks.calculate.mockRejectedValue(new Error("boom"));
    await renderAndSelect();

    fireEvent.change(await screen.findByLabelText(/Boyta \(m²\)/), { target: { value: "70" } });

    expect(
      await screen.findByText(/Vi kunde inte beräkna priset/i, undefined, { timeout: 3000 }),
    ).toBeInTheDocument();
    // The page chrome is still intact — no crash.
    expect(screen.getByRole("heading", { level: 1, name: "Räkna ut ditt pris" })).toBeInTheDocument();
  });
});

describe("PriceCalculator — preliminary-estimate framing", () => {
  it("shows preliminary-estimate copy near the result (never a final quote)", async () => {
    await renderAndSelect();

    expect(await screen.findByText(/Preliminär uppskattning/i)).toBeInTheDocument();
    expect(screen.getByText(/Slutpriset bekräftas efter en kort kontakt/i)).toBeInTheDocument();
  });
});

describe("PriceCalculator — never leaks internal-only fields", () => {
  it("drops internal fields carried on the raw payload so they never render", async () => {
    // Build the config through the REAL normalizer from a payload that carries
    // internal-only fields; the page must never surface them.
    const config = normalizePublicConfigResponse({
      ok: true,
      enabled: true,
      company: { name: "Städalliansen Sverige AB" },
      settings: { currency: "SEK", priceDisplayMode: "range" },
      services: [
        {
          serviceKey: "home_cleaning",
          displayName: "Hemstädning",
          enabled: true,
          requiresCleaningPlan: true,
          sortOrder: 1,
          marginPercent: 42,
          internalNotes: "INTERNAL_NOTE_LEAK",
          pricingRules: [{ id: "RULE_SECRET_LEAK" }],
          questions: [
            { questionKey: "sqm", label: "Boyta (m²)", inputType: "number", required: true, validation: { min: 10 } },
          ],
        },
      ],
      cleaningPlans: [
        { planKey: "flexible", name: "Flexibel", hourlyRate: 349, isDefault: true, sortOrder: 1, rawPricingRules: ["RAW_RULE_LEAK"] },
      ],
      faq: [],
    });
    expect(config).not.toBeNull();
    mocks.fetchConfig.mockResolvedValue({ status: "ok", config: config as PublicConfigResponse });
    renderCalculator();

    await screen.findByRole("heading", { level: 1, name: "Räkna ut ditt pris" });
    const text = document.body.textContent ?? "";
    expect(text).not.toContain("INTERNAL_NOTE_LEAK");
    expect(text).not.toContain("RULE_SECRET_LEAK");
    expect(text).not.toContain("RAW_RULE_LEAK");
  });
});

describe("PriceCalculator — accessibility", () => {
  it("gives every visible form input an accessible label", async () => {
    await renderAndSelect();

    expect(await screen.findByLabelText(/Boyta \(m²\)/)).toBeInTheDocument();
    expect(screen.getByLabelText("Vi har husdjur")).toBeInTheDocument();
    // Postnummer is the single canonical contact field (no duplicate question).
    expect(screen.getAllByLabelText(/Postnummer/)).toHaveLength(1);
    expect(screen.getByLabelText(/^Namn$/)).toBeInTheDocument();
  });

  it("exposes the result as an aria-live polite region", async () => {
    await renderAndSelect();
    await screen.findByRole("heading", { level: 1, name: "Räkna ut ditt pris" });

    expect(document.querySelector('[aria-live="polite"]')).not.toBeNull();
  });

  it("supports arrow-key roving focus across the service cards", async () => {
    renderCalculator();
    const home = await screen.findByRole("button", { name: /Hemstädning/i });
    const moveOut = screen.getByRole("button", { name: /Flyttstädning/i });

    home.focus();
    expect(document.activeElement).toBe(home);
    const group = home.closest('[role="group"]') as HTMLElement;
    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(document.activeElement).toBe(moveOut);
  });

  it("links validation errors to the field (aria-invalid + aria-describedby)", async () => {
    mocks.calculate.mockResolvedValue({
      ...HOME_RESULT,
      valid: false,
      calculatedPrice: null,
      displayText: "",
      issues: [{ code: "out_of_range", field: "sqm", message: "Ange en giltig boyta." }],
    });
    await renderAndSelect();

    fireEvent.change(await screen.findByLabelText(/Boyta \(m²\)/), { target: { value: "70" } });

    // The field is flagged invalid once the server settles on an invalid result.
    await waitFor(
      () => expect(screen.getByLabelText(/Boyta \(m²\)/)).toHaveAttribute("aria-invalid", "true"),
      { timeout: 3000 },
    );
    const input = screen.getByLabelText(/Boyta \(m²\)/);
    expect(input.getAttribute("aria-describedby") ?? "").toContain("calc-field-sqm-error");
    // The message is surfaced (on the field and in the result panel).
    expect(screen.getAllByText("Ange en giltig boyta.").length).toBeGreaterThan(0);
  });

  it("marks the required contact email with aria-required and a label", async () => {
    await renderAndSelect();
    const email = await screen.findByLabelText(/E-post/);
    expect(email).toHaveAttribute("aria-required", "true");
    expect(email).toHaveAttribute("type", "email");
  });
});

describe("PriceCalculator — no auto-selection + gating (Slice 12G)", () => {
  it("selects no service and hides the result panel/details/contact on initial load", async () => {
    renderCalculator();

    await screen.findByRole("button", { name: /Hemstädning/i });
    // No service chosen → no right-side price card, no details, no contact step.
    expect(screen.queryByText("Uppskattat pris")).not.toBeInTheDocument();
    expect(screen.queryByText("Fyll i information om uppdraget")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Boyta \(m²\)/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/E-post/)).not.toBeInTheDocument();
  });

  it("reveals the result panel + details after selecting Hemstädning", async () => {
    await renderAndSelect(/Hemstädning/i);

    expect(await screen.findByText("Uppskattat pris")).toBeInTheDocument();
    expect(screen.getByLabelText(/Boyta \(m²\)/)).toBeInTheDocument();
  });

  it("reveals the result panel after selecting Flyttstädning", async () => {
    await renderAndSelect(/Flyttstädning/i);

    expect(await screen.findByText("Uppskattat pris")).toBeInTheDocument();
  });
});

describe("PriceCalculator — home cleaning grouping + pets/address (Slice 12G/12I)", () => {
  it("groups home fields into titled sections (Bostad, Tillägg och önskemål)", async () => {
    await renderAndSelect();

    expect(await screen.findByText("Bostad")).toBeInTheDocument();
    expect(screen.getByText("Tillägg och önskemål")).toBeInTheDocument();
  });

  it("shows Boyta + Intervall in box 1 and no longer renders the retired Antal badrum field", async () => {
    await renderAndSelect();

    expect(await screen.findByLabelText(/Boyta \(m²\)/)).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /Intervall/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/Antal badrum/)).not.toBeInTheDocument();
  });

  it("offers only weekly/biweekly/every_four_weeks intervals (no '1 gång i månaden')", async () => {
    await renderAndSelect();

    fireEvent.click(await screen.findByRole("combobox", { name: /Intervall/i }));
    expect(await screen.findByRole("option", { name: "Varje vecka" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Varannan vecka" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Var fjärde vecka" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /gång i månaden/i })).not.toBeInTheDocument();
  });

  it("shows the per-visit price as main with a four-week secondary once an interval is chosen", async () => {
    await renderAndSelect();

    fireEvent.change(await screen.findByLabelText(/Boyta \(m²\)/), { target: { value: "70" } });
    fireEvent.click(screen.getByRole("combobox", { name: /Intervall/i }));
    fireEvent.click(await screen.findByRole("option", { name: "Varje vecka" }));

    // Slice 12J Part E: the MAIN figure is the price PER VISIT (eyebrow
    // "Pris per tillfälle"). Slice 12Q Phase B: the four-week total now lives in
    // the "Summering" section as "Pris per fyra veckors period", and the old
    // explanatory note is gone.
    expect(await screen.findByText("Pris per fyra veckors period", undefined, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText("Summering")).toBeInTheDocument();
    // "Pris per tillfälle" appears as the eyebrow AND the summary row label.
    expect(screen.getAllByText("Pris per tillfälle").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("Priset för fyra veckor baseras på valt intervall.")).not.toBeInTheDocument();
  });

  it("shows the RUT display toggle for RUT-qualified home cleaning and per-visit time as 'tim/min'", async () => {
    await renderAndSelect();

    fireEvent.change(await screen.findByLabelText(/Boyta \(m²\)/), { target: { value: "70" } });
    fireEvent.click(screen.getByRole("combobox", { name: /Intervall/i }));
    fireEvent.click(await screen.findByRole("option", { name: "Varje vecka" }));

    await screen.findByText("Summering", undefined, { timeout: 3000 });
    // Display controls: VAT toggle always present; RUT toggle only for RUT-qualified.
    expect(screen.getByLabelText("Visa priser inklusive moms")).toBeInTheDocument();
    // Copy rule: never "inklusive RUT".
    expect(screen.queryByText(/inklusive RUT/i)).not.toBeInTheDocument();
    // Human-readable per-visit time format "X tim, XX min (X.Xh)".
    expect(screen.getByText(/tim,\s*\d+\s*min\s*\(\d/)).toBeInTheDocument();
  });

  it("renders the optional Adress field (not required) for home cleaning", async () => {
    await renderAndSelect();

    const address = await screen.findByLabelText(/^Adress$/);
    expect(address).toBeInTheDocument();
    expect(address).not.toBeRequired();
    expect(address).not.toHaveAttribute("aria-required", "true");
  });

  it("renders the 'Vi har husdjur' toggle for home cleaning", async () => {
    await renderAndSelect();

    expect(await screen.findByLabelText("Vi har husdjur")).toBeInTheDocument();
  });

  it("includes has_pets in the calculate payload only when the toggle is on", async () => {
    await renderAndSelect();

    fireEvent.change(await screen.findByLabelText(/Boyta \(m²\)/), { target: { value: "70" } });
    await waitFor(
      () =>
        expect(mocks.calculate).toHaveBeenLastCalledWith("rakna-ut-ditt-pris", {
          serviceKey: "home_cleaning",
          answers: { sqm: 70 },
          cleaningPlanKey: "flexible",
        }),
      { timeout: 3000 },
    );

    // Turning the pets toggle on re-prices with has_pets:true (server-authoritative).
    fireEvent.click(screen.getByLabelText("Vi har husdjur"));
    await waitFor(
      () =>
        expect(mocks.calculate).toHaveBeenLastCalledWith("rakna-ut-ditt-pris", {
          serviceKey: "home_cleaning",
          answers: { sqm: 70, has_pets: true },
          cleaningPlanKey: "flexible",
        }),
      { timeout: 3000 },
    );
  });
});

/**
 * Full-detail home results carrying the VAT/RUT/rounding point fields the result
 * card needs to (a) round to the configured interval and (b) switch the displayed
 * price mode with the VAT/RUT toggles. Slice 12Q follow-up.
 */
const HOME_RESULT_ROUNDING: PublicCalculateResponse = {
  ...HOME_RESULT,
  estimatedHours: 2,
  calculatedPrice: 516,
  minPrice: 469,
  maxPrice: 563,
  priceExclVat: 413,
  vatRatePercent: 25,
  vatAmount: 103,
  priceInclVat: 516,
  rutEnabled: false,
  rutPercent: 50,
  showRutBreakdown: false,
  rutDeduction: 0,
  priceAfterRut: 516,
  roundingIncrement: 10,
  displayText: "469–563 kr",
};

const HOME_RESULT_RUT: PublicCalculateResponse = {
  ...HOME_RESULT,
  estimatedHours: 2,
  calculatedPrice: 250,
  minPrice: 240,
  maxPrice: 260,
  priceExclVat: 400,
  vatRatePercent: 25,
  vatAmount: 100,
  priceInclVat: 500,
  rutEnabled: true,
  rutPercent: 50,
  showRutBreakdown: true,
  rutDeduction: 250,
  priceAfterRut: 250,
  roundingIncrement: 10,
  displayText: "240–260 kr",
};

describe("PriceCalculator — result card price display (Slice 12Q follow-up)", () => {
  it("rounds the top price + summary to the nearest interval (469–563 → 470–560)", async () => {
    mocks.calculate.mockResolvedValue(HOME_RESULT_ROUNDING);
    await renderAndSelect();
    fireEvent.change(await screen.findByLabelText(/Boyta \(m²\)/), { target: { value: "70" } });

    // Both the large top figure AND the "Pris per tillfälle" summary row use the
    // same rounded values; the raw unrounded range is never shown.
    const rounded = await screen.findAllByText("470–560 kr", undefined, { timeout: 3000 });
    expect(rounded.length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText("469–563 kr")).not.toBeInTheDocument();
  });

  it("replaces the top preliminary text with a dynamic status line and keeps the bottom disclaimer", async () => {
    mocks.calculate.mockResolvedValue(HOME_RESULT_RUT);
    await renderAndSelect();
    fireEvent.change(await screen.findByLabelText(/Boyta \(m²\)/), { target: { value: "70" } });

    await screen.findByText("Summering", undefined, { timeout: 3000 });
    // Old top preliminary line is gone.
    expect(
      screen.queryByText("Det här är en preliminär uppskattning – inte en bindande offert."),
    ).not.toBeInTheDocument();
    // Dynamic status line reflects the default mode (RUT-qualified plan).
    expect(screen.getByTestId("result-status-line")).toHaveTextContent("Efter RUT-avdrag · Inkl. moms");
    // Bottom disclaimer remains.
    expect(
      screen.getByText("Uppskattningen är preliminär. Slutpriset bekräftas efter en kort kontakt."),
    ).toBeInTheDocument();
  });

  it("does not render the old default price-detail block (Pris före RUT / Pris efter RUT)", async () => {
    mocks.calculate.mockResolvedValue(HOME_RESULT_RUT);
    await renderAndSelect();
    fireEvent.change(await screen.findByLabelText(/Boyta \(m²\)/), { target: { value: "70" } });

    await screen.findByText("Summering", undefined, { timeout: 3000 });
    expect(screen.queryByText("Pris före RUT")).not.toBeInTheDocument();
    expect(screen.queryByText("RUT-avdrag")).not.toBeInTheDocument();
    expect(screen.queryByText("Pris efter RUT")).not.toBeInTheDocument();
  });

  it("RUT toggle updates the top price + summary and the status line", async () => {
    mocks.calculate.mockResolvedValue(HOME_RESULT_RUT);
    await renderAndSelect();
    fireEvent.change(await screen.findByLabelText(/Boyta \(m²\)/), { target: { value: "70" } });

    await screen.findByText("Summering", undefined, { timeout: 3000 });
    // Default: after-RUT, incl. VAT → 240–260 kr (top + summary).
    expect((await screen.findAllByText("240–260 kr")).length).toBeGreaterThanOrEqual(2);

    // Toggle RUT off → before-RUT, incl. VAT → 480–520 kr everywhere.
    fireEvent.click(screen.getByLabelText("Visa pris efter RUT-avdrag"));
    expect((await screen.findAllByText("480–520 kr")).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByTestId("result-status-line")).toHaveTextContent("Före RUT-avdrag · Inkl. moms");
  });

  it("hides the RUT toggle + RUT status text for a non-RUT-qualified result", async () => {
    mocks.calculate.mockResolvedValue(HOME_RESULT_ROUNDING);
    await renderAndSelect();
    fireEvent.change(await screen.findByLabelText(/Boyta \(m²\)/), { target: { value: "70" } });

    await screen.findByText("Summering", undefined, { timeout: 3000 });
    expect(screen.queryByLabelText("Visa pris efter RUT-avdrag")).not.toBeInTheDocument();
    // VAT-only status line (no RUT phrasing).
    const status = screen.getByTestId("result-status-line");
    expect(status).toHaveTextContent("Inkl. moms");
    expect(status).not.toHaveTextContent(/RUT/);
  });
});

describe("PriceCalculator — SEO indexability per state", () => {
  it("marks the disabled (dark) state as noindex", async () => {
    mocks.fetchConfig.mockResolvedValue({ status: "ok", config: makeConfig(false) });
    renderCalculator();

    await screen.findByText(/Vi finjusterar våra priser/i);
    // The page (not just the <Seo> unit) wires noindex while the calculator is dark.
    await waitFor(() => expect(robotsContent()).toBe("noindex, follow"));
  });

  it("marks the active (enabled) calculator as indexable", async () => {
    renderCalculator();

    await screen.findByRole("heading", { level: 1, name: "Räkna ut ditt pris" });
    await waitFor(() => expect(robotsContent()).toBe("index, follow"));
  });
});
