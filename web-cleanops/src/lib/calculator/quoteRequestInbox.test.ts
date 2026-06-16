import { describe, expect, it } from "vitest";

import type { QuoteRequestView } from "./calculatorQuoteRequests";
import {
  ALL,
  applyInboxView,
  availableServiceOptions,
  availableStatusOptions,
  buildQuoteRequestCopySummary,
  buildQuoteRequestsCsv,
  DEFAULT_INBOX_FILTERS,
  filterQuoteRequests,
  hasActiveFilters,
  matchesDateRange,
  matchesSearch,
  QUOTE_REQUEST_CSV_HEADERS,
  quoteRequestPriceValue,
  sortQuoteRequests,
  summarizeQuoteRequests,
  type QuoteRequestInboxFilters,
} from "./quoteRequestInbox";

function makeView(over: Partial<QuoteRequestView> = {}): QuoteRequestView {
  return {
    legacyId: "qr_1",
    createdAt: "2026-06-01T10:00:00.000Z",
    status: "submitted",
    serviceKey: "home_cleaning",
    serviceDisplayName: "Hemstädning",
    selectedPlanName: "Flexibel",
    selectedPlanHourlyRate: 349,
    estimatedHours: 3,
    calculatedPrice: 1200,
    minPrice: 1080,
    maxPrice: 1320,
    currency: "SEK",
    priceDisplayMode: "range",
    pricingModel: "home_cleaning_recommended_hours",
    formulaVersion: "v1",
    requiresManualReview: false,
    validUntil: "2026-07-01T00:00:00.000Z",
    reference: null,
    source: "price_calculator",
    sourceUrl: null,
    prospectLegacyId: "prospect_1",
    prospectStatus: "new",
    contact: { name: "Anna Karlsson", email: "anna@example.se", phone: "070-1234567", postalCode: "12345" },
    answers: [],
    snapshotSummary: {
      formulaVersion: "v1",
      pricingModel: "home_cleaning_recommended_hours",
      selectedPlan: null,
      estimatedHours: 3,
      calculatedPrice: 1200,
      minPrice: 1080,
      maxPrice: 1320,
    },
    ...over,
  };
}

const NOW = new Date("2026-06-09T12:00:00.000Z");

function withFilters(over: Partial<QuoteRequestInboxFilters>): QuoteRequestInboxFilters {
  return { ...DEFAULT_INBOX_FILTERS, ...over };
}

describe("quoteRequestInbox — search", () => {
  it("matches across name, email, phone, service, plan, postal code, status and reference", () => {
    const v = makeView();
    expect(matchesSearch(v, "anna")).toBe(true);
    expect(matchesSearch(v, "example.se")).toBe(true);
    expect(matchesSearch(v, "070")).toBe(true);
    expect(matchesSearch(v, "Hemstäd")).toBe(true);
    expect(matchesSearch(v, "flexibel")).toBe(true);
    expect(matchesSearch(v, "12345")).toBe(true);
    expect(matchesSearch(v, "submitted")).toBe(true);
    expect(matchesSearch(v, "nomatch")).toBe(false);
  });

  it("requires all whitespace-separated terms to match", () => {
    const v = makeView();
    expect(matchesSearch(v, "anna hemstäd")).toBe(true);
    expect(matchesSearch(v, "anna flyttstäd")).toBe(false);
  });

  it("an empty query matches everything", () => {
    expect(matchesSearch(makeView(), "   ")).toBe(true);
  });
});

describe("quoteRequestInbox — filters", () => {
  const rows = [
    makeView({ legacyId: "a", serviceKey: "home_cleaning", status: "submitted", requiresManualReview: false }),
    makeView({
      legacyId: "b",
      serviceKey: "move_out_cleaning",
      serviceDisplayName: "Flyttstädning",
      status: "pending_review",
      requiresManualReview: true,
    }),
  ];

  it("filters by service key", () => {
    const out = filterQuoteRequests(rows, withFilters({ serviceKey: "move_out_cleaning" }), NOW);
    expect(out.map((r) => r.legacyId)).toEqual(["b"]);
  });

  it("filters by status", () => {
    const out = filterQuoteRequests(rows, withFilters({ status: "submitted" }), NOW);
    expect(out.map((r) => r.legacyId)).toEqual(["a"]);
  });

  it("filters by manual review only", () => {
    const out = filterQuoteRequests(rows, withFilters({ manualReviewOnly: true }), NOW);
    expect(out.map((r) => r.legacyId)).toEqual(["b"]);
  });

  it("ALL sentinel disables service/status filtering", () => {
    const out = filterQuoteRequests(rows, withFilters({ serviceKey: ALL, status: ALL }), NOW);
    expect(out).toHaveLength(2);
  });
});

describe("quoteRequestInbox — date range", () => {
  it("today matches the same UTC day as now", () => {
    const today = makeView({ createdAt: "2026-06-09T08:00:00.000Z" });
    const yesterday = makeView({ createdAt: "2026-06-08T23:00:00.000Z" });
    expect(matchesDateRange(today, "today", NOW)).toBe(true);
    expect(matchesDateRange(yesterday, "today", NOW)).toBe(false);
  });

  it("last_7_days / last_30_days use rolling windows", () => {
    const fiveDaysAgo = makeView({ createdAt: "2026-06-04T12:00:00.000Z" });
    const twentyDaysAgo = makeView({ createdAt: "2026-05-20T12:00:00.000Z" });
    expect(matchesDateRange(fiveDaysAgo, "last_7_days", NOW)).toBe(true);
    expect(matchesDateRange(twentyDaysAgo, "last_7_days", NOW)).toBe(false);
    expect(matchesDateRange(twentyDaysAgo, "last_30_days", NOW)).toBe(true);
  });

  it("all always matches; an unparseable date fails bounded ranges", () => {
    const bad = makeView({ createdAt: "not-a-date" });
    expect(matchesDateRange(bad, "all", NOW)).toBe(true);
    expect(matchesDateRange(bad, "last_7_days", NOW)).toBe(false);
  });
});

describe("quoteRequestInbox — sorting", () => {
  const rows = [
    makeView({ legacyId: "old", createdAt: "2026-06-01T10:00:00.000Z", calculatedPrice: 500, status: "submitted", serviceDisplayName: "Bravo" }),
    makeView({ legacyId: "new", createdAt: "2026-06-08T10:00:00.000Z", calculatedPrice: 3000, status: "accepted", serviceDisplayName: "Alpha" }),
  ];

  it("newest first by default", () => {
    expect(sortQuoteRequests(rows, "newest").map((r) => r.legacyId)).toEqual(["new", "old"]);
  });
  it("oldest first", () => {
    expect(sortQuoteRequests(rows, "oldest").map((r) => r.legacyId)).toEqual(["old", "new"]);
  });
  it("price desc / asc", () => {
    expect(sortQuoteRequests(rows, "price_desc").map((r) => r.legacyId)).toEqual(["new", "old"]);
    expect(sortQuoteRequests(rows, "price_asc").map((r) => r.legacyId)).toEqual(["old", "new"]);
  });
  it("service + status alphabetical", () => {
    expect(sortQuoteRequests(rows, "service").map((r) => r.legacyId)).toEqual(["new", "old"]);
    expect(sortQuoteRequests(rows, "status").map((r) => r.legacyId)).toEqual(["new", "old"]);
  });
  it("does not mutate the input array", () => {
    const input = [...rows];
    sortQuoteRequests(input, "oldest");
    expect(input.map((r) => r.legacyId)).toEqual(["old", "new"]);
  });
});

describe("quoteRequestInbox — composed view + summary", () => {
  it("applyInboxView filters then sorts", () => {
    const rows = [
      makeView({ legacyId: "a", status: "submitted", createdAt: "2026-06-02T10:00:00.000Z" }),
      makeView({ legacyId: "b", status: "submitted", createdAt: "2026-06-07T10:00:00.000Z" }),
      makeView({ legacyId: "c", status: "accepted", createdAt: "2026-06-08T10:00:00.000Z" }),
    ];
    const out = applyInboxView(rows, withFilters({ status: "submitted", sort: "newest" }), NOW);
    expect(out.map((r) => r.legacyId)).toEqual(["b", "a"]);
  });

  it("summarizeQuoteRequests aggregates totals", () => {
    const rows = [
      makeView({ status: "submitted", requiresManualReview: false, calculatedPrice: 1000 }),
      makeView({ status: "pending_review", requiresManualReview: true, calculatedPrice: 2000 }),
      makeView({ status: "accepted", requiresManualReview: false, calculatedPrice: null, minPrice: 500, maxPrice: 900 }),
    ];
    expect(summarizeQuoteRequests(rows)).toEqual({
      total: 3,
      submitted: 1,
      manualReview: 1,
      estimatedValue: 1000 + 2000 + 500,
    });
  });

  it("quoteRequestPriceValue prefers point price then min then max", () => {
    expect(quoteRequestPriceValue(makeView({ calculatedPrice: 1200 }))).toBe(1200);
    expect(quoteRequestPriceValue(makeView({ calculatedPrice: null, minPrice: 800 }))).toBe(800);
    expect(quoteRequestPriceValue(makeView({ calculatedPrice: null, minPrice: null, maxPrice: 0 }))).toBe(0);
  });

  it("hasActiveFilters reflects deviation from default", () => {
    expect(hasActiveFilters(DEFAULT_INBOX_FILTERS)).toBe(false);
    expect(hasActiveFilters(withFilters({ search: "x" }))).toBe(true);
    expect(hasActiveFilters(withFilters({ manualReviewOnly: true }))).toBe(true);
  });
});

describe("quoteRequestInbox — option discovery", () => {
  const rows = [
    makeView({ serviceKey: "home_cleaning", serviceDisplayName: "Hemstädning", status: "submitted" }),
    makeView({ serviceKey: "move_out_cleaning", serviceDisplayName: "Flyttstädning", status: "accepted" }),
    makeView({ serviceKey: "home_cleaning", serviceDisplayName: "Hemstädning", status: "submitted" }),
  ];
  it("availableServiceOptions returns distinct services sorted by label", () => {
    expect(availableServiceOptions(rows)).toEqual([
      { serviceKey: "move_out_cleaning", label: "Flyttstädning" },
      { serviceKey: "home_cleaning", label: "Hemstädning" },
    ]);
  });
  it("availableStatusOptions returns distinct statuses", () => {
    expect(availableStatusOptions(rows)).toEqual(["accepted", "submitted"]);
  });
});

describe("quoteRequestInbox — safe export", () => {
  it("CSV header + row is public-safe and has no uuid/trace", () => {
    const csv = buildQuoteRequestsCsv([makeView({ reference: "Q-1001" })]);
    const [header, row] = csv.split("\r\n");
    expect(header).toBe(QUOTE_REQUEST_CSV_HEADERS.join(","));
    expect(row).toContain("Q-1001");
    expect(row).toContain("anna@example.se");
    expect(row).toContain("Hemstädning");
    // No raw pricing internals or uuids leak.
    expect(csv).not.toContain("ruleValues");
    expect(csv).not.toContain("rawPrice");
  });

  it("CSV escapes commas and quotes", () => {
    const csv = buildQuoteRequestsCsv([makeView({ contact: { name: 'Doe, "Jane"', email: "x@y.se", phone: null, postalCode: null } })]);
    expect(csv).toContain('"Doe, ""Jane"""');
  });

  it("copy summary lists only public-safe fields", () => {
    const text = buildQuoteRequestCopySummary(makeView({ reference: "Q-1001" }));
    expect(text).toContain("Quote request Q-1001");
    expect(text).toContain("Name: Anna Karlsson");
    expect(text).toContain("Service: Hemstädning");
    expect(text).toContain("Status: submitted");
    expect(text).not.toContain("qr_1"); // reference preferred over legacyId
  });
});
