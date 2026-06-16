/**
 * Price Calculator — Quote Requests inbox: PURE filter / sort / summary / export
 * (Slice 12C, Part A).
 *
 * No I/O. Operates entirely on the already-loaded, public-safe
 * {@link QuoteRequestView}[] (see `calculatorQuoteRequests.ts`, which has already
 * stripped uuids, raw rule values and the calculation trace). This module powers
 * the inbox toolbar (search / service / status / date / manual-review filters +
 * sorting), the summary cards, the per-request copy summary and the CSV export.
 *
 * SAFETY: every output here is derived ONLY from {@link QuoteRequestView} fields,
 * which are public-safe by construction — there are NO uuids, no `ruleValues`, no
 * `steps[]` trace and no `rawPrice`. The copy/CSV helpers therefore cannot leak
 * internal pricing data. Being pure also makes the whole surface unit-testable.
 */
import type { QuoteRequestView } from "./calculatorQuoteRequests";

const MS_PER_DAY = 86_400_000;

/** Sentinel meaning "do not filter on this dimension". */
export const ALL = "all" as const;

/** Date-range buckets offered in the inbox toolbar. */
export type QuoteRequestDateRange = "all" | "today" | "last_7_days" | "last_30_days";

/** Sort options offered in the inbox toolbar. */
export type QuoteRequestSortKey =
  | "newest"
  | "oldest"
  | "price_desc"
  | "price_asc"
  | "service"
  | "status";

/** The full inbox filter + sort state (serialisable, never persisted). */
export interface QuoteRequestInboxFilters {
  search: string;
  /** A serviceKey or {@link ALL}. */
  serviceKey: string;
  /** A status token or {@link ALL}. */
  status: string;
  dateRange: QuoteRequestDateRange;
  manualReviewOnly: boolean;
  sort: QuoteRequestSortKey;
}

/** The neutral starting state (everything visible, newest first). */
export const DEFAULT_INBOX_FILTERS: QuoteRequestInboxFilters = {
  search: "",
  serviceKey: ALL,
  status: ALL,
  dateRange: "all",
  manualReviewOnly: false,
  sort: "newest",
};

/** True when the filters differ from the neutral default (controls "Clear filters"). */
export function hasActiveFilters(filters: QuoteRequestInboxFilters): boolean {
  return (
    filters.search.trim() !== "" ||
    filters.serviceKey !== ALL ||
    filters.status !== ALL ||
    filters.dateRange !== "all" ||
    filters.manualReviewOnly ||
    filters.sort !== "newest"
  );
}

/** The numeric price used for sorting + the estimated-value summary (point price first). */
export function quoteRequestPriceValue(view: QuoteRequestView): number {
  return view.calculatedPrice ?? view.minPrice ?? view.maxPrice ?? 0;
}

/** A distinct, label-bearing service option derived from the loaded rows. */
export interface ServiceFilterOption {
  serviceKey: string;
  label: string;
}

/** Distinct service options present in the data, sorted by label (for the Service filter). */
export function availableServiceOptions(views: readonly QuoteRequestView[]): ServiceFilterOption[] {
  const byKey = new Map<string, string>();
  for (const v of views) {
    if (!v.serviceKey) continue;
    if (!byKey.has(v.serviceKey)) {
      byKey.set(v.serviceKey, v.serviceDisplayName ?? v.serviceKey);
    }
  }
  return Array.from(byKey, ([serviceKey, label]) => ({ serviceKey, label })).sort((a, b) =>
    a.label.localeCompare(b.label, "sv"),
  );
}

/** Distinct statuses present in the data (for the Status filter), stably ordered. */
export function availableStatusOptions(views: readonly QuoteRequestView[]): string[] {
  const seen = new Set<string>();
  for (const v of views) {
    if (v.status) seen.add(v.status);
  }
  return Array.from(seen).sort((a, b) => a.localeCompare(b));
}

/** Lowercased haystack of the public-safe, searchable fields of a request. */
function searchHaystack(view: QuoteRequestView): string {
  return [
    view.contact.name,
    view.contact.email,
    view.contact.phone,
    view.contact.postalCode,
    view.serviceKey,
    view.serviceDisplayName,
    view.selectedPlanName,
    view.status,
    view.reference,
    view.legacyId,
  ]
    .filter((v): v is string => typeof v === "string" && v !== "")
    .join(" ")
    .toLowerCase();
}

/** Whether a request matches a free-text query (all whitespace-separated terms must match). */
export function matchesSearch(view: QuoteRequestView, query: string): boolean {
  const trimmed = query.trim().toLowerCase();
  if (trimmed === "") return true;
  const haystack = searchHaystack(view);
  return trimmed.split(/\s+/).every((term) => haystack.includes(term));
}

/** Whether a request's createdAt falls inside the selected date range (relative to `now`). */
export function matchesDateRange(
  view: QuoteRequestView,
  range: QuoteRequestDateRange,
  now: Date,
): boolean {
  if (range === "all") return true;
  const created = Date.parse(view.createdAt);
  if (Number.isNaN(created)) return false;

  if (range === "today") {
    // Deterministic, timezone-free same-UTC-day comparison.
    return view.createdAt.slice(0, 10) === now.toISOString().slice(0, 10);
  }
  const days = range === "last_7_days" ? 7 : 30;
  return created >= now.getTime() - days * MS_PER_DAY;
}

/** Applies all active filters (search + service + status + date + manual review). */
export function filterQuoteRequests(
  views: readonly QuoteRequestView[],
  filters: QuoteRequestInboxFilters,
  now: Date,
): QuoteRequestView[] {
  return views.filter((view) => {
    if (!matchesSearch(view, filters.search)) return false;
    if (filters.serviceKey !== ALL && view.serviceKey !== filters.serviceKey) return false;
    if (filters.status !== ALL && view.status !== filters.status) return false;
    if (filters.manualReviewOnly && !view.requiresManualReview) return false;
    if (!matchesDateRange(view, filters.dateRange, now)) return false;
    return true;
  });
}

/**
 * Returns a NEW, stably-sorted array. Ties keep their incoming order (the source
 * is already newest-first from the query), so sorting is deterministic.
 */
export function sortQuoteRequests(
  views: readonly QuoteRequestView[],
  sort: QuoteRequestSortKey,
): QuoteRequestView[] {
  const withIndex = views.map((view, index) => ({ view, index }));
  const cmp = (a: { view: QuoteRequestView; index: number }, b: { view: QuoteRequestView; index: number }): number => {
    switch (sort) {
      case "oldest":
        return Date.parse(a.view.createdAt) - Date.parse(b.view.createdAt) || a.index - b.index;
      case "price_desc":
        return quoteRequestPriceValue(b.view) - quoteRequestPriceValue(a.view) || a.index - b.index;
      case "price_asc":
        return quoteRequestPriceValue(a.view) - quoteRequestPriceValue(b.view) || a.index - b.index;
      case "service":
        return (
          (a.view.serviceDisplayName ?? a.view.serviceKey ?? "").localeCompare(
            b.view.serviceDisplayName ?? b.view.serviceKey ?? "",
            "sv",
          ) || a.index - b.index
        );
      case "status":
        return a.view.status.localeCompare(b.view.status) || a.index - b.index;
      case "newest":
      default:
        return Date.parse(b.view.createdAt) - Date.parse(a.view.createdAt) || a.index - b.index;
    }
  };
  return withIndex.sort(cmp).map((x) => x.view);
}

/** Filter then sort — the composed view shown in the inbox. */
export function applyInboxView(
  views: readonly QuoteRequestView[],
  filters: QuoteRequestInboxFilters,
  now: Date,
): QuoteRequestView[] {
  return sortQuoteRequests(filterQuoteRequests(views, filters, now), filters.sort);
}

/** Aggregate counts shown in the inbox summary cards. */
export interface QuoteRequestSummary {
  total: number;
  /** New / freshly submitted (status === "submitted"). */
  submitted: number;
  manualReview: number;
  /** Sum of the best-known price across all requests (point price first). */
  estimatedValue: number;
}

/** Computes the summary-card aggregates from a set of requests. */
export function summarizeQuoteRequests(views: readonly QuoteRequestView[]): QuoteRequestSummary {
  let submitted = 0;
  let manualReview = 0;
  let estimatedValue = 0;
  for (const v of views) {
    if (v.status === "submitted") submitted += 1;
    if (v.requiresManualReview) manualReview += 1;
    estimatedValue += quoteRequestPriceValue(v);
  }
  return { total: views.length, submitted, manualReview, estimatedValue };
}

// ── Safe export helpers (CSV + copy summary) ────────────────────────────────

/** Customer-facing price string for export (range when presented as one, else point price). */
export function formatPriceText(view: QuoteRequestView): string {
  const suffix = view.currency === "SEK" ? "kr" : view.currency;
  const { minPrice, maxPrice, calculatedPrice, priceDisplayMode } = view;
  if (priceDisplayMode === "range" && minPrice !== null && maxPrice !== null && minPrice !== maxPrice) {
    return `${Math.round(minPrice)}–${Math.round(maxPrice)} ${suffix}`;
  }
  if (calculatedPrice !== null) return `${Math.round(calculatedPrice)} ${suffix}`;
  if (minPrice !== null) return `${Math.round(minPrice)} ${suffix}`;
  return "";
}

/** Date-only `YYYY-MM-DD` from an ISO timestamp (deterministic). */
function isoDate(iso: string | null): string {
  if (!iso) return "";
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(iso);
  return m ? m[1] : iso;
}

/** `YYYY-MM-DD HH:mm` from an ISO timestamp (deterministic, timezone-free). */
function isoDateTime(iso: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(iso);
  return m ? `${m[1]} ${m[2]}` : iso;
}

/** Public-safe CSV column order (header row + per-request row). NO uuids / trace. */
export const QUOTE_REQUEST_CSV_HEADERS: readonly string[] = [
  "Created",
  "Reference",
  "Name",
  "Email",
  "Phone",
  "Postal code",
  "Service",
  "Plan",
  "Estimated hours",
  "Price",
  "Status",
  "Manual review",
  "Valid until",
];

/** Escapes a value for CSV (quotes when it contains comma / quote / newline). */
function csvCell(value: string | number | null): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** One CSV row (public-safe fields only) for a request. */
function quoteRequestCsvRow(view: QuoteRequestView): string {
  const cells: Array<string | number | null> = [
    isoDateTime(view.createdAt),
    view.reference ?? view.legacyId,
    view.contact.name,
    view.contact.email,
    view.contact.phone,
    view.contact.postalCode,
    view.serviceDisplayName ?? view.serviceKey,
    view.selectedPlanName,
    view.estimatedHours,
    formatPriceText(view),
    view.status,
    view.requiresManualReview ? "Yes" : "No",
    isoDate(view.validUntil),
  ];
  return cells.map(csvCell).join(",");
}

/**
 * Builds a public-safe CSV document (header + one row per request) from the
 * CURRENTLY-VISIBLE rows. Uses only {@link QuoteRequestView} fields, so it can
 * never include uuids, rule values or the raw calculation trace.
 */
export function buildQuoteRequestsCsv(views: readonly QuoteRequestView[]): string {
  const header = QUOTE_REQUEST_CSV_HEADERS.join(",");
  const rows = views.map(quoteRequestCsvRow);
  return [header, ...rows].join("\r\n");
}

/**
 * A short, copy-pasteable plain-text summary of ONE request (public-safe). Used
 * by the "Copy summary" action in the detail dialog. No uuids / pricing internals.
 */
export function buildQuoteRequestCopySummary(view: QuoteRequestView): string {
  const lines: string[] = [];
  lines.push(`Quote request ${view.reference ?? view.legacyId}`);
  lines.push(`Created: ${isoDateTime(view.createdAt)}`);
  if (view.contact.name) lines.push(`Name: ${view.contact.name}`);
  if (view.contact.email) lines.push(`Email: ${view.contact.email}`);
  if (view.contact.phone) lines.push(`Phone: ${view.contact.phone}`);
  if (view.contact.postalCode) lines.push(`Postal code: ${view.contact.postalCode}`);
  lines.push(`Service: ${view.serviceDisplayName ?? view.serviceKey ?? "—"}`);
  if (view.selectedPlanName) lines.push(`Plan: ${view.selectedPlanName}`);
  if (view.estimatedHours !== null) lines.push(`Estimated hours: ${view.estimatedHours} h`);
  const price = formatPriceText(view);
  if (price !== "") lines.push(`Price: ${price}`);
  lines.push(`Status: ${view.status}`);
  if (view.requiresManualReview) lines.push("Manual review: required");
  if (view.validUntil) lines.push(`Valid until: ${isoDate(view.validUntil)}`);
  return lines.join("\n");
}
