import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { QuoteRequestView } from "@/lib/calculator/calculatorQuoteRequests";
import type { UseCalculatorQuoteRequestsResult } from "@/hooks/use-calculator-quote-requests";

const mocks = vi.hoisted(() => ({
  useCalculatorQuoteRequests: vi.fn(),
  refetch: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/hooks/use-calculator-quote-requests", () => ({
  useCalculatorQuoteRequests: () => mocks.useCalculatorQuoteRequests(),
}));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

import { QuoteRequestsInbox } from "./QuoteRequestsInbox";

function makeView(over: Partial<QuoteRequestView> = {}): QuoteRequestView {
  return {
    legacyId: "qr_1",
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
    requiresManualReview: false,
    validUntil: "2026-07-08T10:00:00.000Z",
    reference: null,
    source: "price_calculator",
    sourceUrl: null,
    prospectLegacyId: "prospect_1",
    prospectStatus: "new",
    contact: { name: "Anna Karlsson", email: "anna@example.se", phone: "070-1", postalCode: "12345" },
    answers: [],
    snapshotSummary: {
      formulaVersion: "v1",
      pricingModel: "home_cleaning_recommended_hours",
      selectedPlan: null,
      estimatedHours: 3,
      calculatedPrice: 1047,
      minPrice: 950,
      maxPrice: 1150,
    },
    ...over,
  };
}

const ROWS: QuoteRequestView[] = [
  makeView({ legacyId: "a", contact: { name: "Anna Karlsson", email: "anna@example.se", phone: null, postalCode: null } }),
  makeView({
    legacyId: "b",
    serviceKey: "move_out_cleaning",
    serviceDisplayName: "Flyttstädning",
    status: "pending_review",
    requiresManualReview: true,
    contact: { name: "Bert Berg", email: "bert@example.se", phone: null, postalCode: null },
  }),
];

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

describe("QuoteRequestsInbox toolbar (Slice 12C, Part A)", () => {
  it("renders summary tiles and a result count", () => {
    setHook({ quoteRequests: ROWS });
    render(<QuoteRequestsInbox />);

    expect(screen.getByText("Total requests")).toBeInTheDocument();
    expect(screen.getByText("New / submitted")).toBeInTheDocument();
    expect(screen.getByText("Needs review")).toBeInTheDocument();
    expect(screen.getByText("Estimated value")).toBeInTheDocument();
    expect(screen.getByText(/Showing 2 of 2 quote requests/i)).toBeInTheDocument();
  });

  it("filters rows by the free-text search", () => {
    setHook({ quoteRequests: ROWS });
    render(<QuoteRequestsInbox />);

    expect(screen.getByText("Anna Karlsson")).toBeInTheDocument();
    expect(screen.getByText("Bert Berg")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search quote requests"), { target: { value: "bert" } });

    expect(screen.queryByText("Anna Karlsson")).not.toBeInTheDocument();
    expect(screen.getByText("Bert Berg")).toBeInTheDocument();
    expect(screen.getByText(/Showing 1 of 2 quote requests/i)).toBeInTheDocument();
  });

  it("the Review only toggle filters to manual-review rows only", () => {
    setHook({ quoteRequests: ROWS });
    render(<QuoteRequestsInbox />);

    fireEvent.click(screen.getByRole("button", { name: /Review only/i }));

    expect(screen.queryByText("Anna Karlsson")).not.toBeInTheDocument();
    expect(screen.getByText("Bert Berg")).toBeInTheDocument();
  });

  it("shows a filter-empty state and clears filters", () => {
    setHook({ quoteRequests: ROWS });
    render(<QuoteRequestsInbox />);

    fireEvent.change(screen.getByLabelText("Search quote requests"), { target: { value: "zzzz-nomatch" } });
    expect(screen.getByText("No quote requests match your filters.")).toBeInTheDocument();

    // Clear via the empty-state button restores all rows.
    fireEvent.click(within(screen.getByText("No quote requests match your filters.").closest("div")!).getByRole("button", { name: /Clear filters/i }));
    expect(screen.getByText("Anna Karlsson")).toBeInTheDocument();
    expect(screen.getByText("Bert Berg")).toBeInTheDocument();
  });

  it("exposes an Export CSV control when there are visible rows", () => {
    setHook({ quoteRequests: ROWS });
    render(<QuoteRequestsInbox />);
    expect(screen.getByRole("button", { name: /Export CSV/i })).toBeEnabled();
  });

  it("does not render the toolbar when there are no requests at all", () => {
    setHook({ quoteRequests: [] });
    render(<QuoteRequestsInbox />);
    expect(screen.getByText("No quote requests yet.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Search quote requests")).not.toBeInTheDocument();
  });
});
