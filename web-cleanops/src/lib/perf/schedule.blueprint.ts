/**
 * Schedule scalability & server-query architecture blueprint (OP3).
 *
 * Design-only. Nothing here runs, queries, or changes behaviour. It is the
 * forward-looking architecture for the Schedule — the surface OP1 ranked
 * `critical` growth — expressed as typed, importable documentation so the future
 * Supabase migration (P4) has a concrete contract to build against, and so the
 * dependency map / cache rules / realtime classification can be reviewed and
 * diffed alongside the code they describe.
 *
 * Current reality (audited OP3):
 *  - The Schedule renders straight from the pure resolver
 *    {@link resolveScheduleProgram} (scheduleCore.ts). It iterates every LIVE
 *    work-order service row, generates concrete occurrences in the scan window
 *    (per-row hard-capped at 500), enriches each with customer/employee metadata
 *    and returns a flat {@link ScheduleEntry}[] sorted by display date.
 *  - All inputs are in-memory arrays from AppContext (workOrders, customers,
 *    employees, postalCities, occurrence exceptions). No server query exists.
 *  - Revisiting a period is already absorbed by the in-memory interval cache
 *    (intervalCache.ts), keyed by `viewMode|range|filters` and invalidated whole
 *    whenever any source array reference changes (referenceToken).
 *  - Board grouping (buildScheduleBoard), summary roll-up (summarizeScheduleProgram),
 *    board metrics (computeScheduleBoardMetrics) are pure presentation layers
 *    over the resolved entries — they never re-derive occurrences.
 */

// ── Part 1 — Dependency map ───────────────────────────────

/** A node in the schedule dependency graph. */
export interface ScheduleDependency {
  /** What `resolveScheduleProgram` consumes. */
  input: string;
  /** direct = passed in; indirect = reached transitively by a resolver. */
  kind: "direct" | "indirect";
  /** Why the resolver needs it. */
  purpose: string;
  /** The resolver/util that actually reads or transforms it. */
  via: string;
  /** Current source of the data. */
  source: "work-orders" | "customers" | "employees" | "postal-cities" | "exceptions" | "derived";
}

/**
 * Everything `resolveScheduleProgram` depends on, direct and indirect. This is
 * the "what must a schedule query touch" contract — the future server query must
 * resolve the same inputs, but server-side and date-scoped rather than by
 * scanning the whole in-memory store.
 */
export const SCHEDULE_DEPENDENCIES: ReadonlyArray<ScheduleDependency> = [
  {
    input: "workOrders[] (LIVE only)",
    kind: "direct",
    purpose: "Source of truth — each live service row generates occurrences.",
    via: "isLiveWorkOrder / isLiveSourceRow → generateServiceRowOccurrences",
    source: "work-orders",
  },
  {
    input: "serviceRows[].recurrence / variations",
    kind: "indirect",
    purpose: "Base rule → variation resolution → per-row occurrence dates/times.",
    via: "generateServiceRowOccurrences (base rule → variation resolver)",
    source: "work-orders",
  },
  {
    input: "occurrence exceptions[]",
    kind: "direct",
    purpose: "Cancel / reschedule / time-change overlay per occurrence.",
    via: "indexOccurrenceExceptions → generateServiceRowOccurrences overlay",
    source: "exceptions",
  },
  {
    input: "customers[] (id, name, addresses)",
    kind: "direct",
    purpose: "Resolve customer display name + delivery address per entry.",
    via: "customerName / customerAddress maps built in resolver",
    source: "customers",
  },
  {
    input: "postalCities[]",
    kind: "direct",
    purpose: "Resolve a structured city label for the address.",
    via: "addressCityLabel",
    source: "postal-cities",
  },
  {
    input: "employees[] (id, name)",
    kind: "direct",
    purpose: "Resolve assigned employee names for each occurrence.",
    via: "employeeName map built in resolver",
    source: "employees",
  },
  {
    input: "assignedEmployeeIds / staffing intent",
    kind: "indirect",
    purpose: "Open-slot / partially-assigned / required-staff math per entry.",
    via: "generateServiceRowOccurrences staffing fields",
    source: "work-orders",
  },
  {
    input: "fromDate / toDate (+ widened scan window)",
    kind: "direct",
    purpose: "Interval bounds; scan widened so reschedules moved INTO range surface.",
    via: "resolveScheduleProgram scan-window widening",
    source: "derived",
  },
  {
    input: "reschedule / variation / time-change status",
    kind: "indirect",
    purpose: "Operational status + change messaging per occurrence.",
    via: "buildOccurrenceChangeMessage / scheduleEntryOperationalStatus",
    source: "derived",
  },
];

/**
 * Detail data the Schedule must NOT touch — it belongs to detail-on-demand views
 * (customer card, work-order detail, protocol runner) and must never enter a
 * schedule query payload (P2/P4 boundary).
 */
export const SCHEDULE_DETAIL_ONLY: ReadonlyArray<string> = [
  "Full customer profile (notes, billing, contacts, history)",
  "Work-order detail (full service config, attachments, activity log)",
  "Protocol/checklist responses",
  "Media (photos, damage reports)",
  "Time reports / check-out detail",
  "Activity / audit history",
];

// ── Part 2 — Scaling assessment ───────────────────────────

/** Relative scaling grade for a scenario. */
export type ScheduleScalingGrade = "ok" | "watch" | "risk" | "critical";

export interface ScheduleScalingScenario {
  id: "A" | "B" | "C" | "D";
  label: string;
  /** Rough occurrence count for a 1-week interval at this size. */
  weekOccurrences: string;
  /** Cost characteristic of resolve + transform + board for one cold interval. */
  computeCost: string;
  /** Cache effectiveness at this size. */
  cacheEffectiveness: string;
  grade: ScheduleScalingGrade;
  note: string;
}

/**
 * Schedule scaling is dominated by the *number of occurrences inside the
 * selected interval*, not the total customer/work-order count. The resolver is
 * O(rows × dates-in-range) for generation plus O(entries log entries) for the
 * final sort; board/metrics passes are O(entries). A wider date range or denser
 * recurrence — not more customers — is what grows an interval. The interval
 * cache makes revisits free, so steady navigation cost stays flat; the risk is
 * the *cold* compute on a first visit to a large/dense interval and total memory
 * if many large intervals are retained.
 */
export const SCHEDULE_SCALING: ReadonlyArray<ScheduleScalingScenario> = [
  {
    id: "A",
    label: "100 customers · 20 employees",
    weekOccurrences: "~hundreds",
    computeCost: "Trivial — sub-millisecond resolve; whole month fits one interval.",
    cacheEffectiveness: "High — every period cached after first visit.",
    grade: "ok",
    note: "No concern. In-memory resolve is comfortably within budget.",
  },
  {
    id: "B",
    label: "1,000 customers · 100 employees",
    weekOccurrences: "~low thousands",
    computeCost: "Small — cold week resolve still fast; sort begins to matter.",
    cacheEffectiveness: "High for week view; month view does more cold work.",
    grade: "watch",
    note: "Still in-memory viable. Keep view default to week, not month.",
  },
  {
    id: "C",
    label: "10,000 customers · 500 employees",
    weekOccurrences: "~tens of thousands",
    computeCost: "Cold month interval becomes expensive; boot hydration dominates.",
    cacheEffectiveness: "Per-interval still helps, but each interval is large.",
    grade: "risk",
    note: "In-memory full hydration is the real ceiling here, not the resolver. Date-scoped server queries (P4) become necessary so the client never holds all work orders.",
  },
  {
    id: "D",
    label: "50 companies · 500 employees each",
    weekOccurrences: "N/A per-tenant; aggregate is huge",
    computeCost: "Infeasible to hold all tenants in memory simultaneously.",
    cacheEffectiveness: "Must be company-scoped; cross-tenant cache is invalid.",
    grade: "critical",
    note: "Multi-tenant production cannot hydrate all companies client-side. Company-scoped, date-scoped server queries are mandatory; the interval cache key already carries `scope` for this.",
  },
];

// ── Part 3 — Future schedule summary object ───────────────

export interface ScheduleSummaryField {
  field: string;
  type: string;
  note: string;
}

/**
 * `ScheduleOccurrenceSummary` — the optimised wire/render shape the future
 * server query returns. It is a strict subset of {@link ScheduleEntry}: only the
 * fields needed to render, filter, group, drag/drop and assign WITHOUT a second
 * lookup. Everything detail-only ({@link SCHEDULE_DETAIL_ONLY}) is deliberately
 * excluded. Names are denormalised (resolved server-side) so the board never
 * round-trips for a customer/employee record just to draw a row.
 */
export const SCHEDULE_SUMMARY_FIELDS: ReadonlyArray<ScheduleSummaryField> = [
  { field: "occurrenceKey", type: "string", note: "Stable identity `parentServiceRowId:occurrenceDate`." },
  { field: "workOrderId", type: "uuid", note: "Navigation target for detail-on-demand." },
  { field: "companyId", type: "uuid", note: "Tenant scope — always present, always filtered first." },
  { field: "customerId", type: "uuid", note: "Navigation target; not the full customer object." },
  { field: "customerName", type: "string", note: "Denormalised display name (resolved server-side)." },
  { field: "addressSummary", type: "string", note: "Street + city one-liner; no full address object." },
  { field: "serviceLabel", type: "string", note: "Service name for the row." },
  { field: "displayDate", type: "date", note: "Planning date the board buckets by." },
  { field: "startTime / endTime", type: "time | null", note: "Planned window for column placement." },
  { field: "status", type: "enum", note: "scheduled | unscheduled | cancelled | rescheduled | variation." },
  { field: "employeeIds", type: "uuid[]", note: "Assignees — drives employee-row placement." },
  { field: "employeeNames", type: "string[]", note: "Denormalised assignee names for the chip." },
  { field: "openSlotCount", type: "int", note: "Open staffing slots — Unassigned-row + staffing badges." },
  { field: "requiredStaffCount", type: "int", note: "Total planned headcount for staffing math." },
  { field: "labourMinutes / visitMinutes", type: "int | null", note: "Board labour totals and column headers." },
  { field: "isVariation / isRescheduled / isTimeChanged", type: "bool", note: "Status modifiers for badges." },
];

// ── Part 4 — Future server query model ────────────────────

/**
 * Request contract for the future `GET /schedule` (or RPC) query. Company- and
 * date-scoped by construction — the server resolves occurrences for the interval
 * only, never the whole booking history. Mirrors the existing
 * {@link ScheduleCoreInput} flags so the resolver can move server-side with the
 * same semantics.
 */
export interface ScheduleQueryRequest {
  /** Tenant scope — required for an admin; super-admin may pass an explicit id. */
  companyId: string;
  /** Inclusive lower bound "YYYY-MM-DD". */
  fromDate: string;
  /** Inclusive upper bound "YYYY-MM-DD". */
  toDate: string;
  /** Granularity hint for caching/telemetry: "day" | "week" | "month" | "custom". */
  viewMode: string;
  /** Include cancelled occurrences (defaults false, matching today). */
  includeCancelled?: boolean;
  /** Optional server-side narrowing — applied before the interval is returned. */
  employeeIds?: string[];
  status?: string[];
  serviceType?: string[];
}

/**
 * Response contract. Occurrences are returned pre-sorted (display date → start
 * time → customer) so the client renders without a sort pass. Pagination is by
 * INTERVAL, not row: a schedule interval is bounded and returned whole, because
 * partial-day pages break the board's grouping. If a single interval ever
 * exceeds a safe occurrence ceiling, the server narrows the range rather than
 * paginating rows.
 */
export interface ScheduleQueryResponse {
  /** The resolved summaries for the interval (already sorted). */
  occurrences: string; // ScheduleOccurrenceSummary[] — see SCHEDULE_SUMMARY_FIELDS
  /** Server-computed roll-up so the client never recomputes totals. */
  metrics: string; // ScheduleBoardMetrics-shaped summary
  /** Identity token of the underlying data for this interval (cache validation). */
  dataToken: string;
  /** Echo of the resolved range (may be widened for cross-boundary reschedules). */
  resolvedFrom: string;
  resolvedTo: string;
}

/** Indexes that keep the future server-side resolve cheap at any row count. */
export const SCHEDULE_QUERY_INDEXES: ReadonlyArray<{ pattern: string; index: string }> = [
  { pattern: "Live work-order rows for a company", index: "(company_id, work_order_status) partial WHERE live" },
  { pattern: "Occurrences/visits in a date interval", index: "(company_id, display_date)" },
  { pattern: "Employee board (assignee × date)", index: "(company_id, employee_id, display_date)" },
  { pattern: "Occurrence exceptions overlay", index: "(company_id, parent_service_row_id, occurrence_date)" },
  { pattern: "Status / service-type narrowing", index: "(company_id, display_date, status)" },
];

// ── Part 5 & 6 — Cache + invalidation strategy ────────────

/** What a schedule mutation must invalidate. */
export type ScheduleInvalidationScope =
  | "current-interval"
  | "neighbouring-intervals"
  | "all-intervals";

export interface ScheduleInvalidationRule {
  event: string;
  scope: ScheduleInvalidationScope;
  rationale: string;
}

/**
 * Cache strategy. The cache key is `(companyId, viewMode, fromDate..toDate,
 * filters)` — already implemented in {@link buildIntervalCacheKey}. Today a
 * single `dataToken` invalidates the WHOLE cache on any source-array change
 * (correct but coarse). The future server-backed cache can be more precise:
 * each interval carries its own `dataToken` from the server, so only intervals
 * whose token changed are dropped. The rules below classify how far a given
 * mutation should reach when precise invalidation is available.
 *
 * Most mutations affect only the interval(s) the changed occurrence touches. A
 * reschedule is the notable exception: it can move an occurrence ACROSS an
 * interval boundary, so both the source and destination intervals (hence
 * neighbours) must drop. Structural changes that alter recurrence rules can
 * affect any future interval and must drop all.
 */
export const SCHEDULE_INVALIDATION_RULES: ReadonlyArray<ScheduleInvalidationRule> = [
  { event: "New booking / work order created", scope: "current-interval", rationale: "Adds occurrences in the affected interval(s) only." },
  { event: "Booking edit (time / service on a single occurrence)", scope: "current-interval", rationale: "Changes one occurrence in place." },
  { event: "Employee (re)assignment on an occurrence", scope: "current-interval", rationale: "Staffing of one interval changes; board re-buckets." },
  { event: "Occurrence reschedule (date move)", scope: "neighbouring-intervals", rationale: "Occurrence leaves one interval and lands in another — drop both." },
  { event: "Occurrence cancellation", scope: "current-interval", rationale: "Removes/flags one occurrence in its interval." },
  { event: "Variation created on an occurrence", scope: "current-interval", rationale: "Alters one occurrence's window/label." },
  { event: "Recurrence rule / service-row recurrence change", scope: "all-intervals", rationale: "Regenerates the whole future occurrence series." },
  { event: "Work order inactivated / archived", scope: "all-intervals", rationale: "Removes all its future occurrences across every interval." },
  { event: "Customer/employee rename", scope: "all-intervals", rationale: "Denormalised names appear across all intervals (low frequency)." },
];

// ── Part 7 — Realtime readiness ───────────────────────────

/** How promptly a schedule change must reach other viewers. */
export type ScheduleRealtimeClass = "immediate" | "on-refresh" | "lazy";

export interface ScheduleRealtimeEvent {
  event: string;
  class: ScheduleRealtimeClass;
  rationale: string;
}

/**
 * Realtime readiness (blueprint only — no realtime exists today; all freshness
 * is on-mount/manual). When realtime is introduced at P5 it must be selective
 * and company-scoped (one channel per company schedule), because connection-
 * minutes are an expensive resource. Only dispatch-critical, multi-user-contended
 * changes justify an immediate push; the rest can ride the next refresh or load
 * lazily on detail open.
 */
export const SCHEDULE_REALTIME_EVENTS: ReadonlyArray<ScheduleRealtimeEvent> = [
  { event: "Employee assignment / reassignment", class: "immediate", rationale: "Two dispatchers must not double-book or strand a slot — highest contention." },
  { event: "Visit status change (started / completed)", class: "immediate", rationale: "Live board accuracy during the working day." },
  { event: "Check-in", class: "immediate", rationale: "Confirms a visit is underway; drives the live operational view." },
  { event: "Check-out", class: "on-refresh", rationale: "Completion is useful but not second-critical; next refresh suffices." },
  { event: "Exception creation (cancel / reschedule)", class: "on-refresh", rationale: "Important but typically authored by one dispatcher at a time." },
  { event: "Booking created/edited elsewhere", class: "on-refresh", rationale: "Visible on next interval load; rare cross-user contention." },
  { event: "Customer/employee rename", class: "lazy", rationale: "Cosmetic denormalised label; refresh on next natural load." },
];

// ── Part 8 — Usage / performance attribution ──────────────

/**
 * Per-company schedule metering counters (blueprint only — no storage, no
 * billing). Every counter is attributable to a `companyId` and feeds the model
 * in `metering.blueprint.ts`. Today the matching dev counters are recorded by
 * the instrumentation layer (cache hit/miss, resolve timer); these are the
 * production, per-tenant equivalents to collect at the server boundary at P4.
 */
export const SCHEDULE_METERING_COUNTERS: ReadonlyArray<{ key: string; description: string }> = [
  { key: "schedule_queries", description: "Schedule interval queries executed, per company." },
  { key: "schedule_occurrences_generated", description: "Occurrences resolved/returned, per company." },
  { key: "schedule_cache_hits", description: "Interval cache hits served without a query, per company." },
  { key: "schedule_cache_misses", description: "Interval cache misses requiring a resolve/query, per company." },
  { key: "schedule_realtime_updates", description: "Realtime schedule pushes delivered, per company (P5)." },
  { key: "schedule_assignment_changes", description: "Assignment/reassignment mutations, per company." },
];

// ── Part J — Top schedule risks (ranked) ──────────────────

export interface ScheduleRisk {
  rank: number;
  risk: string;
  /** Highest scenario where it bites. */
  bitesAt: "A" | "B" | "C" | "D";
  phase: "P4" | "P5" | "P6";
  mitigation: string;
}

/** Top schedule-related risks, highest first. */
export const SCHEDULE_RISKS: ReadonlyArray<ScheduleRisk> = [
  { rank: 1, risk: "Boot-time full hydration of all work orders into memory", bitesAt: "C", phase: "P4", mitigation: "Date-scoped, company-scoped server query — never load the whole booking store client-side." },
  { rank: 2, risk: "Multi-tenant memory: all companies cannot coexist client-side", bitesAt: "D", phase: "P4", mitigation: "Strict company scope on every query + cache key (scope already in the key)." },
  { rank: 3, risk: "Cold compute of a large/dense month interval", bitesAt: "C", phase: "P4", mitigation: "Default to week view; resolve server-side; return pre-sorted summaries." },
  { rank: 4, risk: "Coarse whole-cache invalidation on any mutation", bitesAt: "B", phase: "P4", mitigation: "Per-interval dataToken so only affected intervals drop." },
  { rank: 5, risk: "Reschedule across interval boundaries serving stale neighbours", bitesAt: "B", phase: "P4", mitigation: "Invalidate neighbouring intervals on reschedule (see rules)." },
  { rank: 6, risk: "Over-fetching detail data into the board payload", bitesAt: "B", phase: "P4", mitigation: "Return ScheduleOccurrenceSummary only; detail-on-demand for the rest." },
  { rank: 7, risk: "Realtime cost if applied to every event indiscriminately", bitesAt: "C", phase: "P5", mitigation: "Selective immediate vs on-refresh classification; one channel per company." },
  { rank: 8, risk: "Unbounded interval cache memory if many large intervals retained", bitesAt: "C", phase: "P4", mitigation: "LRU bound (already 24) tuned per summary-object size." },
  { rank: 9, risk: "Client-side filtering of large intervals (status/service)", bitesAt: "B", phase: "P4", mitigation: "Push employeeIds/status/serviceType narrowing server-side (request model)." },
  { rank: 10, risk: "Lack of per-company schedule attribution before billing", bitesAt: "D", phase: "P6", mitigation: "Wire the metering counters at the server boundary." },
];
