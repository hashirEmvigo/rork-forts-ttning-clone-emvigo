import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { PublicService } from "@/lib/calculator/publicCalculatorClient";

/**
 * GPM-9 — the read-only PREVIEW section now holds ONLY generic services the client
 * cannot render yet (an incomplete or not-yet-supported generic model). A fully
 * client-renderable generic `sqm_fixed` service is no longer previewed — it is a
 * real selectable + calculable service (covered by the genericselectable suite).
 *
 * These tests exercise the real public page (the Edge client is mocked) and pin the
 * GPM-9 contract for the preview lane:
 *   • a NOT-yet-renderable generic service (hourly_by_area / a reserved/unknown model)
 *     appears in the SEPARATE "Förhandsvisning av nya tjänster" section, read-only;
 *   • that preview card is READ-ONLY (no button, no selection, no calculate);
 *   • the preview leaks NO price internals;
 *   • a fully-renderable generic sqm_fixed service is NOT previewed (it is selectable);
 *   • legacy/Home services keep their normal clickable flow, unchanged.
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

/** A legacy/Home-style service (no generic model → always selectable, never previewed). */
function legacyHome(): PublicService {
  return svc({
    serviceKey: "home_cleaning",
    displayName: "Hemstädning",
    description: "Återkommande hemstädning.",
    pricingModel: "home_cleaning_recommended_hours",
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

/** A fully-renderable generic sqm_fixed service (canRender === true → selectable, NOT previewed). */
function renderableGeneric(): PublicService {
  return svc({
    serviceKey: "garden_sqm",
    displayName: "Trädgårdsskötsel",
    description: "Vi sköter din trädgård året om.",
    pricingModel: "sqm_fixed",
    genericPricingModel: "sqm_fixed",
    engineSupported: true,
    primaryInput: "sqm",
    unitLabel: "m²",
    sortOrder: 2,
  });
}

/** A generic model the client cannot render yet (engine_not_supported → previewed). */
function hourlyByAreaGeneric(): PublicService {
  return svc({
    serviceKey: "hourly_area_svc",
    displayName: "Timdebiterad yttjänst",
    description: "Debiteras per timme utifrån yta.",
    pricingModel: "hourly_by_area",
    genericPricingModel: "hourly_by_area",
    engineSupported: false,
    primaryInput: "sqm",
    unitLabel: "m²",
    sortOrder: 3,
  });
}

/** A reserved/unknown generic model (engine_not_supported → previewed). */
function unknownGeneric(): PublicService {
  return svc({
    serviceKey: "mystery_svc",
    displayName: "Okänd tjänst",
    description: "Modell som klienten inte känner till.",
    pricingModel: "unit_based",
    genericPricingModel: "unit_based",
    engineSupported: false,
    primaryInput: null,
    unitLabel: null,
    sortOrder: 4,
  });
}

/** Builds a config response (return type intentionally inferred — the mock is untyped). */
function makeConfig(services: PublicService[]) {
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
    cleaningPlans: [],
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

/** The read-only preview section, found by its accessible name (role=region). */
function previewSection(): HTMLElement {
  return screen.getByRole("region", { name: PREVIEW_SECTION_NAME });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PriceCalculator — generic service preview section (GPM-9)", () => {
  it("previews a NOT-yet-renderable generic service (hourly_by_area) with badge + unit hint", async () => {
    mocks.fetchConfig.mockResolvedValue({
      status: "ok",
      config: makeConfig([legacyHome(), hourlyByAreaGeneric()]),
    });
    renderCalculator();

    await waitFor(() => expect(screen.getByText("Hemstädning")).toBeInTheDocument());

    const section = previewSection();
    expect(within(section).getByText("Timdebiterad yttjänst")).toBeInTheDocument();
    // Preview marker so a visitor reads it as upcoming, not broken.
    expect(within(section).getByText("Förhandsvisning")).toBeInTheDocument();
    // Neutral unit hint derived from unitLabel — NOT a price.
    expect(within(section).getByText("Pris per m²")).toBeInTheDocument();
  });

  it("renders the preview card READ-ONLY — not a button, never triggers calculate", async () => {
    mocks.fetchConfig.mockResolvedValue({
      status: "ok",
      config: makeConfig([legacyHome(), hourlyByAreaGeneric()]),
    });
    renderCalculator();

    await waitFor(() => expect(screen.getByText("Hemstädning")).toBeInTheDocument());

    // The not-yet-renderable service is NOT a clickable button anywhere on the page…
    expect(screen.queryByRole("button", { name: /Timdebiterad yttjänst/i })).not.toBeInTheDocument();
    // …and the preview section contains no interactive controls at all.
    expect(within(previewSection()).queryAllByRole("button")).toHaveLength(0);

    // Clicking the preview card is inert: no calculate, no details step appears.
    fireEvent.click(within(previewSection()).getByText("Timdebiterad yttjänst"));
    expect(mocks.calculate).not.toHaveBeenCalled();
    expect(screen.queryByText("Fyll i information om uppdraget")).not.toBeInTheDocument();
  });

  it("never leaks price internals into the preview section", async () => {
    mocks.fetchConfig.mockResolvedValue({
      status: "ok",
      config: makeConfig([legacyHome(), hourlyByAreaGeneric()]),
    });
    renderCalculator();

    await waitFor(() => expect(screen.getByText("Hemstädning")).toBeInTheDocument());

    const section = previewSection();
    // No numeric price, no SEK amount, no internal field names.
    expect(section.textContent ?? "").not.toMatch(/\d/);
    expect(within(section).queryByText(/\bkr\b/i)).not.toBeInTheDocument();
    expect(within(section).queryByText(/price_per_sqm|pricePerSqm|marginal|margin/i)).not.toBeInTheDocument();
  });

  it("also previews reserved/unsupported generic models (unit_based) — never selectable", async () => {
    mocks.fetchConfig.mockResolvedValue({
      status: "ok",
      config: makeConfig([legacyHome(), unknownGeneric()]),
    });
    renderCalculator();

    await waitFor(() => expect(screen.getByText("Hemstädning")).toBeInTheDocument());

    expect(within(previewSection()).getByText("Okänd tjänst")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Okänd tjänst/i })).not.toBeInTheDocument();
  });

  it("keeps a fully-renderable generic sqm_fixed service OUT of the preview (it is selectable)", async () => {
    mocks.fetchConfig.mockResolvedValue({
      status: "ok",
      config: makeConfig([legacyHome(), renderableGeneric()]),
    });
    renderCalculator();

    // The renderable generic service is a real, clickable button (selectable flow).
    expect(await screen.findByRole("button", { name: /Trädgårdsskötsel/i })).toBeInTheDocument();
    // With no not-yet-renderable generic service, the preview section is absent entirely.
    expect(screen.queryByRole("region", { name: PREVIEW_SECTION_NAME })).not.toBeInTheDocument();
    expect(screen.queryByText("Förhandsvisning")).not.toBeInTheDocument();
  });

  it("keeps legacy/Home in the normal clickable flow and out of the preview", async () => {
    mocks.fetchConfig.mockResolvedValue({
      status: "ok",
      config: makeConfig([legacyHome(), hourlyByAreaGeneric()]),
    });
    mocks.calculate.mockResolvedValue({ ok: true, enabled: true, valid: false, issues: [] });
    renderCalculator();

    // Home is a real, clickable button (normal selectable flow).
    const homeButton = await screen.findByRole("button", { name: /Hemstädning/i });
    expect(homeButton).toBeInTheDocument();

    // Home is NOT inside the preview section.
    expect(within(previewSection()).queryByText("Hemstädning")).not.toBeInTheDocument();

    // Selecting Home advances to the details step — proving the normal flow is intact.
    fireEvent.click(homeButton);
    await waitFor(() =>
      expect(screen.getByText("Fyll i information om uppdraget")).toBeInTheDocument(),
    );
  });
});
