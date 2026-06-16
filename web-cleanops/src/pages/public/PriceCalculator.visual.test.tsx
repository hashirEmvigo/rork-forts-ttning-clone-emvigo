import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { WebsiteImage } from "@/lib/assets";
import type { PublicConfigResponse, PublicCalculateResponse } from "@/lib/calculator/publicCalculatorClient";

/**
 * Slice 9B + 12F + 12G — public calculator RIGHT-SIDE visual panel.
 *
 * Proves the premium right column: it only mounts AFTER a service is explicitly
 * chosen (Slice 12G — there is no auto-selection), shows exactly ONE "Uppskattat
 * pris" card (no second blue box), keeps FAQ/"Bra att veta" reachable only through
 * that card's dialog, and places the Media-Center-managed atmosphere visual BELOW
 * the price box (Slice 12F) — never behind/inside it. The media is SERVICE-SPECIFIC
 * (`public_calculator_<serviceKey>_visual`) with a temporary fallback to the shared
 * legacy slot (`public_calculator_right_visual`); with neither linked the card is
 * omitted. An `<img>` renders for image slots and a play-once `<video>` for video
 * slots (autoplay/muted/inline on desktop, never loops, fades in then out on
 * `ended` without unmounting, never on mobile). The Edge client + media layer are
 * mocked, so nothing here hits the network.
 */

const mocks = vi.hoisted(() => ({
  fetchConfig: vi.fn(),
  calculate: vi.fn(),
  submit: vi.fn(),
  getWebsiteImages: vi.fn(),
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

// The page reads ONLY getWebsiteImagesForPage from the assets barrel (the picker
// is a future slice), so a focused mock keeps these tests deterministic + offline.
vi.mock("@/lib/assets", () => ({
  getWebsiteImagesForPage: (...args: unknown[]) => mocks.getWebsiteImages(...args),
}));

import PriceCalculator from "./PriceCalculator";

// ── fixtures ─────────────────────────────────────────────────────────────────

const SLUG = "rakna-ut-ditt-pris";
const VIDEO_URL = "https://cdn.example/website/general/asset_clip/original.mp4";
const IMAGE_URL = "https://cdn.example/website/general/asset_still/original.webp";
const HOME_IMG = "https://cdn.example/website/home/original.webp";
const OFFICE_IMG = "https://cdn.example/website/office/original.webp";
const LEGACY_IMG = "https://cdn.example/website/legacy/original.webp";

/** Builds a single Media-Center image/video entry for a given slot. */
function media(slotKey: string, mediaType: "image" | "video", url: string): WebsiteImage {
  return { slotKey, pageSlug: SLUG, assetId: "asset_x", url, alt: "Ett rent och inbjudande hem", mediaType };
}

/** A media map keyed by the Hemstädning service-specific slot (the default service). */
function homeMedia(mediaType: "image" | "video", url: string): Map<string, WebsiteImage> {
  return new Map<string, WebsiteImage>([
    [
      "public_calculator_home_cleaning_visual",
      media("public_calculator_home_cleaning_visual", mediaType, url),
    ],
  ]);
}

/** A media map keyed only by the LEGACY shared slot (must now be IGNORED — Slice 12H). */
function legacyOnlyMedia(mediaType: "image" | "video", url: string): Map<string, WebsiteImage> {
  return new Map<string, WebsiteImage>([
    ["public_calculator_right_visual", media("public_calculator_right_visual", mediaType, url)],
  ]);
}

function makeConfig(): PublicConfigResponse {
  return {
    ok: true,
    enabled: true,
    company: { name: "Städalliansen Sverige AB" },
    settings: {
      publicSlug: SLUG,
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
        questions: [
          {
            questionKey: "sqm",
            label: "Kontorsyta (m²)",
            helpText: null,
            inputType: "number",
            required: true,
            options: [],
            validation: { min: 10, max: 5000, step: 1 },
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
        description: "Lägre timpris.",
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
        flexibilityLevel: "high",
        customerDayTimeControl: null,
        sameStaffPreferenceLevel: null,
        bookingPriority: null,
        cancellationTermsSummary: null,
        isDefault: true,
        sortOrder: 1,
      },
    ],
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

/** Sets a desktop (lg) or mobile viewport for `useIsDesktopViewport` (matchMedia). */
function setViewport(isDesktop: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches: isDesktop && query.includes("min-width: 1024px"),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

beforeAll(() => {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.releasePointerCapture ??= () => {};
  proto.scrollIntoView ??= () => {};
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetchConfig.mockResolvedValue({ status: "ok", config: makeConfig() });
  mocks.calculate.mockResolvedValue(HOME_RESULT);
  mocks.submit.mockResolvedValue(null);
  // Default: no linked media → the clean gradient fallback.
  mocks.getWebsiteImages.mockResolvedValue(new Map<string, WebsiteImage>());
  setViewport(true);
});

function renderCalculator() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/${SLUG}`]}>
        <PriceCalculator />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/**
 * Renders + selects a service (no auto-selection as of Slice 12G — the right
 * column, result panel and media only mount after an explicit choice). Defaults
 * to Hemstädning.
 */
async function renderAndSelect(name: RegExp = /Hemstädning/i): Promise<void> {
  renderCalculator();
  fireEvent.click(await screen.findByRole("button", { name }));
}

describe("PriceCalculator — right-column gating (Slice 12G)", () => {
  it("does NOT mount the result panel or media (or call the media layer) before a service is selected", async () => {
    mocks.getWebsiteImages.mockResolvedValue(homeMedia("image", IMAGE_URL));
    renderCalculator();

    await screen.findByRole("button", { name: /Hemstädning/i });
    // No right column → no price card, no visual, and the media layer is never hit.
    expect(screen.queryByText("Uppskattat pris")).not.toBeInTheDocument();
    expect(screen.queryByTestId("calculator-right-visual")).not.toBeInTheDocument();
    expect(mocks.getWebsiteImages).not.toHaveBeenCalled();
  });

  it("mounts the result panel + media only after a service is chosen", async () => {
    mocks.getWebsiteImages.mockResolvedValue(homeMedia("image", IMAGE_URL));
    await renderAndSelect();

    expect(await screen.findByText("Uppskattat pris")).toBeInTheDocument();
    await waitFor(() => expect(mocks.getWebsiteImages).toHaveBeenCalledWith(SLUG));
    expect(await screen.findByTestId("calculator-right-visual")).toBeInTheDocument();
  });
});

describe("PriceCalculator — right-side visual panel (Slice 9B)", () => {
  it("renders exactly ONE primary 'Uppskattat pris' card and no second blue box", async () => {
    await renderAndSelect();

    // The result eyebrow is the single card's identity — exactly one on the page.
    expect(await screen.findByText("Uppskattat pris")).toBeInTheDocument();
    expect(screen.getAllByText("Uppskattat pris")).toHaveLength(1);
    // The old FAQ / "Bra att veta" boxes no longer sit on the page as separate cards.
    expect(screen.queryByText("Vanliga frågor")).not.toBeInTheDocument();
    expect(screen.queryByText("Bra att veta")).not.toBeInTheDocument();
  });

  it("keeps FAQ + 'Bra att veta' reachable through the price card's dialog", async () => {
    await renderAndSelect();

    const helpButton = await screen.findByRole("button", { name: /Frågor & svar/i });
    fireEvent.click(helpButton);

    // The dialog surfaces both the FAQ and the reassurance ("Bra att veta") content.
    expect(await screen.findByText("Vanliga frågor")).toBeInTheDocument();
    expect(screen.getByText("Bra att veta")).toBeInTheDocument();
    expect(screen.getByText("Hur beräknas priset?")).toBeInTheDocument();
  });

  it("renders no visual card (price box stands alone) when no media is linked", async () => {
    await renderAndSelect();

    await screen.findByText("Uppskattat pris");
    await waitFor(() => expect(mocks.getWebsiteImages).toHaveBeenCalledWith(SLUG));
    // With no linked asset the atmosphere card is omitted entirely (clean) — the
    // price box stands alone, never an empty <img>/<video> placeholder.
    expect(screen.queryByTestId("calculator-right-visual")).not.toBeInTheDocument();
    expect(screen.queryByTestId("calculator-right-video")).not.toBeInTheDocument();
    expect(screen.getAllByText("Uppskattat pris")).toHaveLength(1);
  });

  it("renders a Media-Center image slot as an <img> on desktop", async () => {
    mocks.getWebsiteImages.mockResolvedValue(homeMedia("image", IMAGE_URL));
    await renderAndSelect();

    const backdrop = await screen.findByTestId("calculator-right-visual");
    const img = await waitFor(() => {
      const found = backdrop.querySelector("img");
      expect(found).not.toBeNull();
      return found as HTMLImageElement;
    });
    expect(img).toHaveAttribute("src", IMAGE_URL);
    expect(backdrop.querySelector("video")).toBeNull();
  });

  it("renders the video slot with autoplay/muted/playsInline and never loops (desktop)", async () => {
    mocks.getWebsiteImages.mockResolvedValue(homeMedia("video", VIDEO_URL));
    await renderAndSelect();

    const video = (await screen.findByTestId("calculator-right-video")) as HTMLVideoElement;
    expect(video).toHaveAttribute("src", VIDEO_URL);
    expect(video).toHaveAttribute("autoplay");
    expect(video).toHaveAttribute("playsinline");
    expect(video).toHaveAttribute("preload", "metadata");
    expect(video.muted).toBe(true);
    // Atmosphere clip, not a repeating animation.
    expect(video).not.toHaveAttribute("loop");
    expect(video.loop).toBe(false);
  });

  it("fades the video IN on mount then OUT on `ended` without unmounting it", async () => {
    mocks.getWebsiteImages.mockResolvedValue(homeMedia("video", VIDEO_URL));
    await renderAndSelect();

    const video = (await screen.findByTestId("calculator-right-video")) as HTMLVideoElement;
    // It fades IN to fully visible shortly after mounting (opacity-0 → opacity-100).
    await waitFor(() => expect(video.className).toContain("opacity-100"));

    fireEvent.ended(video);

    // After it ends the SAME node stays mounted (absolutely positioned) and just
    // fades back to transparent — so the layout never shifts.
    await waitFor(() => expect(video.className).toContain("opacity-0"));
    expect(video).toBeInTheDocument();
    expect(screen.getAllByText("Uppskattat pris")).toHaveLength(1);
  });

  it("does NOT mount the video (or the visual card) on mobile", async () => {
    setViewport(false);
    mocks.getWebsiteImages.mockResolvedValue(homeMedia("video", VIDEO_URL));
    await renderAndSelect();

    await screen.findByText("Uppskattat pris");
    await waitFor(() => expect(mocks.getWebsiteImages).toHaveBeenCalledWith(SLUG));
    // The atmosphere visual is desktop-only — never mounted on mobile.
    expect(screen.queryByTestId("calculator-right-video")).not.toBeInTheDocument();
    expect(screen.queryByTestId("calculator-right-visual")).not.toBeInTheDocument();
  });

  it("still prices normally with the video backdrop present", async () => {
    mocks.getWebsiteImages.mockResolvedValue(homeMedia("video", VIDEO_URL));
    await renderAndSelect();

    await screen.findByTestId("calculator-right-video");
    fireEvent.change(await screen.findByLabelText(/Boyta \(m²\)/), { target: { value: "70" } });

    await waitFor(() => expect(mocks.calculate).toHaveBeenCalled(), { timeout: 3000 });
    expect((await screen.findAllByText("2 100–2 600 kr")).length).toBeGreaterThan(0);
  });
});

describe("PriceCalculator — service-specific media (Slice 12G)", () => {
  it("places the media card BELOW the result panel (never behind/inside it)", async () => {
    mocks.getWebsiteImages.mockResolvedValue(homeMedia("image", IMAGE_URL));
    await renderAndSelect();

    const visual = await screen.findByTestId("calculator-right-visual");
    const priceEyebrow = screen.getByText("Uppskattat pris");
    // The result panel precedes the media card in document order (it sits below it).
    const order = priceEyebrow.compareDocumentPosition(visual);
    expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("uses the service-specific slot and ignores the legacy slot when both exist", async () => {
    mocks.getWebsiteImages.mockResolvedValue(
      new Map<string, WebsiteImage>([
        ["public_calculator_home_cleaning_visual", media("public_calculator_home_cleaning_visual", "image", HOME_IMG)],
        ["public_calculator_right_visual", media("public_calculator_right_visual", "image", LEGACY_IMG)],
      ]),
    );
    await renderAndSelect(/Hemstädning/i);

    const visual = await screen.findByTestId("calculator-right-visual");
    await waitFor(() => expect(visual.querySelector("img")).toHaveAttribute("src", HOME_IMG));
  });

  it("hides the media card when ONLY the legacy slot exists (no legacy fallback — Slice 12H)", async () => {
    mocks.getWebsiteImages.mockResolvedValue(legacyOnlyMedia("image", LEGACY_IMG));
    await renderAndSelect(/Hemstädning/i);

    await screen.findByText("Uppskattat pris");
    await waitFor(() => expect(mocks.getWebsiteImages).toHaveBeenCalledWith(SLUG));
    // The legacy shared slot is no longer a fallback → the media card is omitted.
    expect(screen.queryByTestId("calculator-right-visual")).not.toBeInTheDocument();
  });

  it("swaps the media to the new service's slot when the service changes", async () => {
    mocks.getWebsiteImages.mockResolvedValue(
      new Map<string, WebsiteImage>([
        ["public_calculator_home_cleaning_visual", media("public_calculator_home_cleaning_visual", "image", HOME_IMG)],
        ["public_calculator_office_cleaning_visual", media("public_calculator_office_cleaning_visual", "image", OFFICE_IMG)],
      ]),
    );
    await renderAndSelect(/Hemstädning/i);

    const homeVisual = await screen.findByTestId("calculator-right-visual");
    await waitFor(() => expect(homeVisual.querySelector("img")).toHaveAttribute("src", HOME_IMG));

    // Re-open the service grid and switch to office → the media swaps to its slot.
    fireEvent.click(screen.getByRole("button", { name: /Ändra tjänst/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Kontorsstädning/i }));

    await waitFor(() =>
      expect(screen.getByTestId("calculator-right-visual").querySelector("img")).toHaveAttribute("src", OFFICE_IMG),
    );
  });

  it("hides the media card for a service with no media, even when another service has it", async () => {
    // Only home has a linked slot; office has none and no legacy fallback exists.
    mocks.getWebsiteImages.mockResolvedValue(
      new Map<string, WebsiteImage>([
        ["public_calculator_home_cleaning_visual", media("public_calculator_home_cleaning_visual", "image", HOME_IMG)],
      ]),
    );
    await renderAndSelect(/Kontorsstädning/i);

    await screen.findByText("Uppskattat månadspris");
    await waitFor(() => expect(mocks.getWebsiteImages).toHaveBeenCalledWith(SLUG));
    // Office has no slot (and no legacy fallback) → the media card is omitted cleanly.
    expect(screen.queryByTestId("calculator-right-visual")).not.toBeInTheDocument();
  });
});
