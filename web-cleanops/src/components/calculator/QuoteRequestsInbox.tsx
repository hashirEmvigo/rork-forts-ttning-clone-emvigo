import { useCallback, useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronRight,
  Copy,
  Download,
  Inbox,
  Loader2,
  Receipt,
  RefreshCw,
  Search,
  ShieldAlert,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useCalculatorQuoteRequests } from "@/hooks/use-calculator-quote-requests";
import type {
  AnswerValue,
} from "@/lib/calculator/publicCalculatorClient";
import type {
  QuoteRequestAnswerView,
  QuoteRequestView,
} from "@/lib/calculator/calculatorQuoteRequests";
import {
  ALL,
  applyInboxView,
  availableServiceOptions,
  availableStatusOptions,
  buildQuoteRequestCopySummary,
  buildQuoteRequestsCsv,
  DEFAULT_INBOX_FILTERS,
  hasActiveFilters,
  summarizeQuoteRequests,
  type QuoteRequestDateRange,
  type QuoteRequestInboxFilters,
  type QuoteRequestSortKey,
} from "@/lib/calculator/quoteRequestInbox";

type Tone = "green" | "blue" | "amber" | "red" | "muted";

const TONE_CLS: Record<Tone, string> = {
  green: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  blue: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  red: "bg-red-500/10 text-red-600 dark:text-red-400",
  muted: "bg-muted text-muted-foreground",
};

/** Status → badge tone. Unknown statuses fall back to neutral. */
const STATUS_TONE: Record<string, Tone> = {
  draft: "muted",
  submitted: "blue",
  pending_review: "amber",
  ready_for_customer: "green",
  viewed: "blue",
  accepted: "green",
  rejected: "red",
  expired: "muted",
  converted: "green",
};

function humanize(value: string | null): string {
  if (!value) return "—";
  return value
    .split("_")
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/** Deterministic, timezone-free `YYYY-MM-DD HH:mm` from an ISO timestamp. */
function formatDateTime(iso: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(iso);
  return m ? `${m[1]} ${m[2]}` : iso;
}

/** Deterministic date-only `YYYY-MM-DD`. */
function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(iso);
  return m ? m[1] : iso;
}

function currencySuffix(currency: string): string {
  return currency === "SEK" ? "kr" : currency;
}

function formatAmount(amount: number | null, currency: string): string {
  if (amount === null) return "—";
  return `${Math.round(amount).toLocaleString("sv-SE")} ${currencySuffix(currency)}`;
}

/**
 * Summary-card amount using the currency CODE (e.g. "1 047 SEK") rather than the
 * "kr" suffix, so the compact aggregates never collide with the per-row "kr"
 * price text on the same screen.
 */
function formatSummaryAmount(amount: number, currency: string): string {
  return `${Math.round(amount).toLocaleString("sv-SE")} ${currency}`;
}

/** Customer-facing price string: a range when presented as one, else the point price. */
function formatPrice(view: QuoteRequestView): string {
  const { minPrice, maxPrice, calculatedPrice, priceDisplayMode, currency } = view;
  if (priceDisplayMode === "range" && minPrice !== null && maxPrice !== null && minPrice !== maxPrice) {
    return `${Math.round(minPrice).toLocaleString("sv-SE")}–${Math.round(maxPrice).toLocaleString("sv-SE")} ${currencySuffix(currency)}`;
  }
  if (calculatedPrice !== null) return formatAmount(calculatedPrice, currency);
  if (minPrice !== null) return formatAmount(minPrice, currency);
  return "—";
}

function formatHours(hours: number | null): string {
  if (hours === null) return "—";
  return `${hours} h`;
}

/** Renders any answer value defensively (arrays, booleans, numbers, null). */
function formatAnswerValue(value: AnswerValue): string {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.length > 0 ? value.join(", ") : "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-medium",
        TONE_CLS[tone],
      )}
    >
      {children}
    </span>
  );
}

function StatusPill({ status }: { status: string }) {
  return <Pill tone={STATUS_TONE[status] ?? "muted"}>{humanize(status)}</Pill>;
}

function contactName(view: QuoteRequestView): string {
  return view.contact.name ?? view.contact.email ?? "Unknown contact";
}

/** A compact summary stat tile shown above the inbox toolbar. */
function InboxStat({ icon: Icon, label, value, tone }: { icon: LucideIcon; label: string; value: string; tone: Tone }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3">
      <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", TONE_CLS[tone])}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="truncate text-lg font-semibold tabular-nums leading-none">{value}</p>
        <p className="mt-1 truncate text-[11px] text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

/** A label / value row used in the detail dialog grids. */
function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-border px-3 py-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-right text-sm font-medium">{children}</span>
    </div>
  );
}

function DetailGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function AnswersList({ answers }: { answers: QuoteRequestAnswerView[] }) {
  if (answers.length === 0) {
    return <p className="text-sm text-muted-foreground">No answers were submitted.</p>;
  }
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="h-9">Question</TableHead>
            <TableHead className="h-9">Type</TableHead>
            <TableHead className="h-9">Answer</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {answers.map((answer) => (
            <TableRow key={answer.questionKey}>
              <TableCell className="py-2 align-top text-sm font-medium">
                {answer.questionLabel ?? answer.questionKey}
              </TableCell>
              <TableCell className="py-2 align-top text-xs text-muted-foreground">
                {answer.inputType ?? "—"}
              </TableCell>
              <TableCell className="py-2 align-top text-sm">{formatAnswerValue(answer.value)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function QuoteRequestDetail({ view, onCopy }: { view: QuoteRequestView; onCopy: () => void }) {
  const summary = view.snapshotSummary;
  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={onCopy}>
          <Copy className="h-3.5 w-3.5" /> Copy summary
        </Button>
      </div>

      <DetailGroup title="Contact / prospect">
        <DetailRow label="Name">{view.contact.name ?? "—"}</DetailRow>
        <DetailRow label="Email">{view.contact.email ?? "—"}</DetailRow>
        <DetailRow label="Phone">{view.contact.phone ?? "—"}</DetailRow>
        <DetailRow label="Postal code">{view.contact.postalCode ?? "—"}</DetailRow>
        <DetailRow label="Source">{view.source ?? "—"}</DetailRow>
        {view.sourceUrl ? <DetailRow label="Source URL">{view.sourceUrl}</DetailRow> : null}
        {view.prospectStatus ? (
          <DetailRow label="Prospect status">
            <Pill tone="blue">{humanize(view.prospectStatus)}</Pill>
          </DetailRow>
        ) : null}
      </DetailGroup>

      <DetailGroup title="Request">
        <DetailRow label="Reference / ID">
          <span className="font-mono text-xs">{view.reference ?? view.legacyId}</span>
        </DetailRow>
        <DetailRow label="Service">
          {view.serviceDisplayName ?? view.serviceKey ?? "—"}
          {view.serviceKey ? <span className="ml-1 font-mono text-xs text-muted-foreground">({view.serviceKey})</span> : null}
        </DetailRow>
        <DetailRow label="Status">
          <StatusPill status={view.status} />
        </DetailRow>
        <DetailRow label="Created">{formatDateTime(view.createdAt)}</DetailRow>
        <DetailRow label="Valid until">{formatDate(view.validUntil)}</DetailRow>
        <DetailRow label="Manual review">
          {view.requiresManualReview ? <Pill tone="amber">Required</Pill> : <Pill tone="muted">No</Pill>}
        </DetailRow>
      </DetailGroup>

      <DetailGroup title="Price">
        <DetailRow label="Estimated hours">{formatHours(view.estimatedHours)}</DetailRow>
        <DetailRow label="Calculated price">{formatAmount(view.calculatedPrice, view.currency)}</DetailRow>
        <DetailRow label="Range">
          {view.minPrice !== null || view.maxPrice !== null
            ? `${formatAmount(view.minPrice, view.currency)} – ${formatAmount(view.maxPrice, view.currency)}`
            : "—"}
        </DetailRow>
        <DetailRow label="Selected plan">
          {view.selectedPlanName ?? "—"}
          {view.selectedPlanHourlyRate !== null ? (
            <span className="ml-1 text-xs text-muted-foreground">
              ({formatAmount(view.selectedPlanHourlyRate, view.currency)}/h)
            </span>
          ) : null}
        </DetailRow>
        <DetailRow label="Formula version">
          <span className="font-mono text-xs">{view.formulaVersion ?? "—"}</span>
        </DetailRow>
      </DetailGroup>

      <DetailGroup title="Submitted answers">
        <AnswersList answers={view.answers} />
      </DetailGroup>

      <DetailGroup title="Snapshot summary">
        <DetailRow label="Formula version">
          <span className="font-mono text-xs">{summary.formulaVersion ?? "—"}</span>
        </DetailRow>
        <DetailRow label="Pricing model">
          <span className="font-mono text-xs">{summary.pricingModel ?? "—"}</span>
        </DetailRow>
        <DetailRow label="Plan">
          {summary.selectedPlan?.name ?? "—"}
          {summary.selectedPlan?.hourlyRate != null ? (
            <span className="ml-1 text-xs text-muted-foreground">
              ({formatAmount(summary.selectedPlan.hourlyRate, view.currency)}/h)
            </span>
          ) : null}
        </DetailRow>
        <DetailRow label="Estimated hours">{formatHours(summary.estimatedHours)}</DetailRow>
        <DetailRow label="Calculated price">{formatAmount(summary.calculatedPrice, view.currency)}</DetailRow>
        <DetailRow label="Min / Max">
          {summary.minPrice !== null || summary.maxPrice !== null
            ? `${formatAmount(summary.minPrice, view.currency)} – ${formatAmount(summary.maxPrice, view.currency)}`
            : "—"}
        </DetailRow>
      </DetailGroup>
    </div>
  );
}

const DATE_RANGE_LABELS: Record<QuoteRequestDateRange, string> = {
  all: "All dates",
  today: "Today",
  last_7_days: "Last 7 days",
  last_30_days: "Last 30 days",
};

const SORT_LABELS: Record<QuoteRequestSortKey, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
  price_desc: "Highest price",
  price_asc: "Lowest price",
  service: "Service",
  status: "Status",
};

/**
 * Super Admin — read-only quote-requests inbox (Slice 7B; finished in Slice 12C).
 * Surfaces submitted calculator quote requests for the MVP company with a search
 * + filter + sort toolbar, summary tiles, safe copy/CSV export and an expandable
 * detail dialog. Visibility ONLY: no status changes, no assignment, no
 * conversion, no writes. Every value rendered/exported is public-safe by
 * construction (no uuids, rule values, or raw calculation trace).
 */
export function QuoteRequestsInbox() {
  const { quoteRequests, isLoading, error, refetch } = useCalculatorQuoteRequests();
  const { toast } = useToast();
  const [selectedLegacyId, setSelectedLegacyId] = useState<string | null>(null);
  const [filters, setFilters] = useState<QuoteRequestInboxFilters>(DEFAULT_INBOX_FILTERS);

  // Resolved once per mount — the date filters are relative to "now".
  const now = useMemo(() => new Date(), []);

  const serviceOptions = useMemo(() => availableServiceOptions(quoteRequests), [quoteRequests]);
  const statusOptions = useMemo(() => availableStatusOptions(quoteRequests), [quoteRequests]);
  const visible = useMemo(() => applyInboxView(quoteRequests, filters, now), [quoteRequests, filters, now]);
  const summary = useMemo(() => summarizeQuoteRequests(quoteRequests), [quoteRequests]);
  const filtersActive = hasActiveFilters(filters);

  const selected = useMemo(
    () => quoteRequests.find((q) => q.legacyId === selectedLegacyId) ?? null,
    [quoteRequests, selectedLegacyId],
  );

  const summaryCurrency = quoteRequests[0]?.currency ?? "SEK";

  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) setSelectedLegacyId(null);
  }, []);

  const patchFilters = useCallback((patch: Partial<QuoteRequestInboxFilters>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
  }, []);

  const clearFilters = useCallback(() => setFilters(DEFAULT_INBOX_FILTERS), []);

  const handleCopySummary = useCallback(
    async (view: QuoteRequestView) => {
      const text = buildQuoteRequestCopySummary(view);
      try {
        await navigator.clipboard?.writeText(text);
        toast({ title: "Copied", description: "A safe summary was copied to your clipboard." });
      } catch {
        toast({ title: "Could not copy", description: "Clipboard access was blocked.", variant: "destructive" });
      }
    },
    [toast],
  );

  const handleExportCsv = useCallback(() => {
    if (visible.length === 0) return;
    try {
      const csv = buildQuoteRequestsCsv(visible);
      const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `quote-requests-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
      toast({ title: "Export ready", description: `${visible.length} quote request(s) exported to CSV.` });
    } catch {
      toast({ title: "Could not export", description: "The CSV could not be generated.", variant: "destructive" });
    }
  }, [visible, toast]);

  return (
    <section aria-label="Quote requests">
      <div className="mb-3 flex items-center gap-2">
        <Receipt className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">Quote requests</h2>
        <span className="text-xs text-muted-foreground">Submitted via the public calculator.</span>
        {quoteRequests.length > 0 ? <Pill tone="muted">{quoteRequests.length}</Pill> : null}
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-8 px-2 text-xs"
          onClick={refetch}
          disabled={isLoading}
        >
          {isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Refresh
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-card p-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading quote requests…
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-6">
          <div className="flex items-center gap-2 text-sm font-semibold text-red-600 dark:text-red-400">
            <AlertTriangle className="h-4 w-4" /> Could not load quote requests
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
          <Button variant="outline" className="mt-4" onClick={refetch}>
            <RefreshCw className="h-4 w-4" /> Try again
          </Button>
        </div>
      ) : quoteRequests.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <Inbox className="h-5 w-5" />
          </div>
          <p className="mt-4 text-sm font-semibold">No quote requests yet.</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            When the public calculator is enabled and customers submit requests, they will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Summary tiles */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <InboxStat icon={Receipt} label="Total requests" value={String(summary.total)} tone="blue" />
            <InboxStat icon={Inbox} label="New / submitted" value={String(summary.submitted)} tone="green" />
            <InboxStat icon={ShieldAlert} label="Needs review" value={String(summary.manualReview)} tone="amber" />
            <InboxStat
              icon={Wallet}
              label="Estimated value"
              value={formatSummaryAmount(summary.estimatedValue, summaryCurrency)}
              tone="muted"
            />
          </div>

          {/* Toolbar */}
          <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-3 lg:flex-row lg:flex-wrap lg:items-center">
            <div className="relative min-w-0 flex-1 lg:max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Search quote requests"
                placeholder="Search name, email, service…"
                value={filters.search}
                onChange={(e) => patchFilters({ search: e.target.value })}
                className="pl-9"
              />
            </div>

            <Select value={filters.serviceKey} onValueChange={(v) => patchFilters({ serviceKey: v })}>
              <SelectTrigger className="h-10 w-full lg:w-44" aria-label="Filter by service">
                <SelectValue placeholder="All services" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All services</SelectItem>
                {serviceOptions.map((opt) => (
                  <SelectItem key={opt.serviceKey} value={opt.serviceKey}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={filters.status} onValueChange={(v) => patchFilters({ status: v })}>
              <SelectTrigger className="h-10 w-full lg:w-40" aria-label="Filter by status">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All statuses</SelectItem>
                {statusOptions.map((status) => (
                  <SelectItem key={status} value={status}>
                    {humanize(status)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={filters.dateRange}
              onValueChange={(v) => patchFilters({ dateRange: v as QuoteRequestDateRange })}
            >
              <SelectTrigger className="h-10 w-full lg:w-36" aria-label="Filter by date">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(DATE_RANGE_LABELS) as QuoteRequestDateRange[]).map((key) => (
                  <SelectItem key={key} value={key}>
                    {DATE_RANGE_LABELS[key]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={filters.sort} onValueChange={(v) => patchFilters({ sort: v as QuoteRequestSortKey })}>
              <SelectTrigger className="h-10 w-full lg:w-40" aria-label="Sort quote requests">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(SORT_LABELS) as QuoteRequestSortKey[]).map((key) => (
                  <SelectItem key={key} value={key}>
                    {SORT_LABELS[key]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              type="button"
              variant={filters.manualReviewOnly ? "default" : "outline"}
              size="sm"
              aria-pressed={filters.manualReviewOnly}
              onClick={() => patchFilters({ manualReviewOnly: !filters.manualReviewOnly })}
              className="h-10"
            >
              <ShieldAlert className="h-4 w-4" /> Review only
            </Button>

            <div className="flex items-center gap-2 lg:ml-auto">
              {filtersActive ? (
                <Button type="button" variant="ghost" size="sm" onClick={clearFilters} className="h-10">
                  <X className="h-4 w-4" /> Clear filters
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleExportCsv}
                disabled={visible.length === 0}
                className="h-10"
              >
                <Download className="h-4 w-4" /> Export CSV
              </Button>
            </div>
          </div>

          {/* Result count */}
          <p className="px-1 text-xs text-muted-foreground" aria-live="polite">
            Showing {visible.length} of {quoteRequests.length} quote request{quoteRequests.length === 1 ? "" : "s"}.
          </p>

          {visible.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center">
              <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                <Search className="h-5 w-5" />
              </div>
              <p className="mt-4 text-sm font-semibold">No quote requests match your filters.</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                Try a different search or clear the filters to see all requests.
              </p>
              <Button variant="outline" className="mt-4" onClick={clearFilters}>
                <X className="h-4 w-4" /> Clear filters
              </Button>
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-border bg-card">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead>Created</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>Service</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead className="text-right">Est. hours</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-10 text-right" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((view) => (
                    <TableRow
                      key={view.legacyId}
                      className="cursor-pointer"
                      onClick={() => setSelectedLegacyId(view.legacyId)}
                    >
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {formatDateTime(view.createdAt)}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{contactName(view)}</div>
                        <div className="text-xs text-muted-foreground">{view.contact.email ?? "—"}</div>
                        {view.contact.phone ? (
                          <div className="text-xs text-muted-foreground">{view.contact.phone}</div>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-sm">{view.serviceDisplayName ?? view.serviceKey ?? "—"}</TableCell>
                      <TableCell className="text-sm">{view.selectedPlanName ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatHours(view.estimatedHours)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums font-medium">
                        {formatPrice(view)}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <StatusPill status={view.status} />
                          {view.requiresManualReview ? (
                            <Badge variant="outline" className="gap-1 border-amber-500/40 text-amber-600 dark:text-amber-400">
                              <ShieldAlert className="h-3 w-3" /> Manual review
                            </Badge>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          aria-label={`View details for ${contactName(view)}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedLegacyId(view.legacyId);
                          }}
                        >
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}

      <Dialog open={selected !== null} onOpenChange={handleOpenChange}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          {selected ? (
            <>
              <DialogHeader>
                <DialogTitle>Quote request · {contactName(selected)}</DialogTitle>
                <DialogDescription>
                  {formatDateTime(selected.createdAt)} · {humanize(selected.status)}
                </DialogDescription>
              </DialogHeader>
              <QuoteRequestDetail view={selected} onCopy={() => handleCopySummary(selected)} />
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}

export default QuoteRequestsInbox;
