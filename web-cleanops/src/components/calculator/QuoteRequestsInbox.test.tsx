import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { QuoteRequestView } from "@/lib/calculator/calculatorQuoteRequests";
import type { UseCalculatorQuoteRequestsResult } from "@/hooks/use-calculator-quote-requests";

const mocks = vi.hoisted(() => ({
  useCalculatorQuoteRequests: vi.fn(),
  refetch: vi.fn(),
}));

vi.mock("@/hooks/use-calculator-quote-requests", () => ({
  useCalculatorQuoteRequests: () => mocks.useCalculatorQuoteRequests(),
}));

import { QuoteRequestsInbox } from "./QuoteRequestsInbox";

const HOME_VIEW: QuoteRequestView = {
  legacyId: "qr_home_1",
  createdAt: "2026-06-08T10:00:00.000Z",
  status: "submitted",
  serviceKey: "home_cleaning",
  serviceDisplayName: "Hemstädning",
  selectedPlanName: "Flexibel",
  selectedPlanHourlyRate: 349,
  estimatedHours: 3,
  calculatedPrice: 1047,
  minPrice: 950,
  maxPrice: 1150,
  currency: "SEK",
  priceDisplayMode: "range",
  pricingModel: "home_cleaning_recommended_hours",
  formulaVersion: "v1",
  requiresManualReview: true,
  validUntil: "2026-07-08T10:00:00.000Z",
  reference: null,
  source: "price_calculator",
  sourceUrl: "https://stadportalen.se/rakna-ut-ditt-pris",
  prospectLegacyId: "prospect_1",
  prospectStatus: "new",
  contact: {
    name: "Calculator Test Customer",
    email: "calculator.test@example.com",
    phone: "0700000000",
    postalCode: "41700",
  },
  answers: [
    { questionKey: "sqm", questionLabel: "Boyta (kvm)", inputType: "number", value: 70, affectsPricing: true, sortOrder: 1 },
    { questionKey: "addons", questionLabel: "Tillval", inputType: "multiselect", value: ["oven"], affectsPricing: true, sortOrder: 2 },
  ],
  snapshotSummary: {
    formulaVersion: "v1",
    pricingModel: "home_cleaning_recommended_hours",
    selectedPlan: { planKey: "flexible", name: "Flexibel", hourlyRate: 349 },
    estimatedHours: 3,
    calculatedPrice: 1047,
    minPrice: 950,
    maxPrice: 1150,
  },
};

function setHook(partial: Partial<UseCalculatorQuoteRequestsResult>): void {
  mocks.useCalculatorQuoteRequests.mockReturnValue({
    quoteRequests: [],
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: mocks.refetch,
    ...partial,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("QuoteRequestsInbox", () => {
  it("shows the empty state when there are no quote requests", () => {
    setHook({ quoteRequests: [] });
    render(<QuoteRequestsInbox />);

    expect(screen.getByText("No quote requests yet.")).toBeInTheDocument();
    expect(
      screen.getByText(/When the public calculator is enabled and customers submit requests/i),
    ).toBeInTheDocument();
  });

  it("shows a loading state", () => {
    setHook({ isLoading: true });
    render(<QuoteRequestsInbox />);
    expect(screen.getByText(/Loading quote requests/i)).toBeInTheDocument();
  });

  it("shows a friendly error state", () => {
    setHook({ error: new Error("rls denied") });
    render(<QuoteRequestsInbox />);
    expect(screen.getByText("Could not load quote requests")).toBeInTheDocument();
    expect(screen.getByText("rls denied")).toBeInTheDocument();
  });

  it("renders a row with the contact, service and a price", () => {
    setHook({ quoteRequests: [HOME_VIEW] });
    render(<QuoteRequestsInbox />);

    expect(screen.getByText("Calculator Test Customer")).toBeInTheDocument();
    expect(screen.getByText("calculator.test@example.com")).toBeInTheDocument();
    expect(screen.getByText("Hemstädning")).toBeInTheDocument();
    expect(screen.getByText("Submitted")).toBeInTheDocument();
    // Price range renders with the currency suffix.
    expect(screen.getByText(/kr/)).toBeInTheDocument();
  });

  it("shows a manual-review badge only when required", () => {
    setHook({ quoteRequests: [HOME_VIEW] });
    const { rerender } = render(<QuoteRequestsInbox />);
    expect(screen.getByText("Manual review")).toBeInTheDocument();

    setHook({ quoteRequests: [{ ...HOME_VIEW, requiresManualReview: false }] });
    rerender(<QuoteRequestsInbox />);
    expect(screen.queryByText("Manual review")).not.toBeInTheDocument();
  });

  it("opens a detail dialog with submitted answers and a snapshot summary", () => {
    setHook({ quoteRequests: [HOME_VIEW] });
    render(<QuoteRequestsInbox />);

    fireEvent.click(screen.getByRole("button", { name: /View details for Calculator Test Customer/i }));

    const dialog = screen.getByRole("dialog");
    // Contact / prospect details.
    expect(within(dialog).getByText("41700")).toBeInTheDocument();
    // Submitted answers (label + formatted multiselect value).
    expect(within(dialog).getByText("Boyta (kvm)")).toBeInTheDocument();
    expect(within(dialog).getByText("70")).toBeInTheDocument();
    expect(within(dialog).getByText("Tillval")).toBeInTheDocument();
    expect(within(dialog).getByText("oven")).toBeInTheDocument();
    // Snapshot summary group is present.
    expect(within(dialog).getByText("Snapshot summary")).toBeInTheDocument();
  });

  it("does not render raw trace, rule values or uuids in the detail dialog", () => {
    setHook({ quoteRequests: [HOME_VIEW] });
    render(<QuoteRequestsInbox />);

    fireEvent.click(screen.getByRole("button", { name: /View details for Calculator Test Customer/i }));

    const dialog = screen.getByRole("dialog");
    const text = dialog.textContent ?? "";
    expect(text).not.toMatch(/ruleValues/i);
    expect(text).not.toMatch(/\bsteps\b/i);
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i); // any uuid
  });

  it("calls refetch when the refresh control is pressed", () => {
    setHook({ quoteRequests: [HOME_VIEW] });
    render(<QuoteRequestsInbox />);

    fireEvent.click(screen.getByRole("button", { name: /Refresh/i }));
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
  });
});
