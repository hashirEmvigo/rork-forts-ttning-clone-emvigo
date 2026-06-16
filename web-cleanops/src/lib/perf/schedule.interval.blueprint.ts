/**
 * P6A — Schedule interval-query migration design. DESIGN-ONLY.
 *
 * This is the design + contract-validation phase that opens the Schedule
 * migration. It does NOT switch the Schedule UI, does NOT change
 * {@link resolveScheduleProgram}, and does NOT change recurrence / variation /
 * exception logic. It is typed, importable documentation that pins down the
 * Supabase-backed interval query the future read switch (P6B) will build against.
 *
 * Why this phase is mostly contract validation, not new machinery: WO-4 already
 * shipped the runnable substrate this design needs and proved it clean:
 *   • `buildScheduleInputFromSupabase()` — reconstructs a {@link ScheduleCoreInput}
 *     from `work_orders` + `work_order_service_rows` + `work_order_occurrence_exceptions`
 *     (lossless via `data` jsonb), with customers / employees / postal cities held
 *     constant from the local store until they migrate on their own tracks.
 *   • `compareScheduleInterval()` — runs the resolver over the SAME interval from
 *     the local source and the Supabase-reconstructed source and diffs every
 *     occurrence (count / keys / dates / times / customer / employees / status /
 *     variation + reschedule + time-change indicators).
 *   • `RESOLVER_INPUT_COVERAGE` — every resolver field mapped to its post-migration
 *     source; zero `missing`.
 * And OP3's `schedule.blueprint.ts` already holds the dependency map
 * ({@link SCHEDULE_DEPENDENCIES}), the future summary shape
 * ({@link SCHEDULE_SUMMARY_FIELDS}), the query indexes ({@link SCHEDULE_QUERY_INDEXES}),
 * and the cache-invalidation rules ({@link SCHEDULE_INVALIDATION_RULES}).
 *
 * So P6A's job is to (a) re-audit the live Schedule input against today's
 * post-WO-6 reality, (b) decide the repository contract shape without
 * overbuilding, (c) define the interval-only fetch strategy and indexes, (d)
 * define the cache key + invalidation, (e) define the shadow-validation plan that
 * gates P6B, and (f) record the risks/blockers. Nothing here executes.
 */

// ── Part 1 — Current schedule input audit ─────────────────

/** Whether an input the resolver consumes is already migrated to Supabase. */
export type ScheduleInputMigrationState =
  | "migrated" // already in Supabase (WO-6 authoritative behind a flag)
  | "in-progress" // migrating on its own track
  | "local-only"; // still localStorage-only

export interface ScheduleInputAuditRow {
  /** The resolver input being audited. */
  input: string;
  /** Where the live Schedule reads it from today. */
  currentSource: string;
  /** Fields the resolver actually needs from it. */
  requiredFields: string;
  /** Who owns/produces the data today. */
  currentOwner: string;
  /** Where the interval query will read it from after P6B. */
  futureSupabaseSource: string;
  state: ScheduleInputMigrationState;
}

/**
 * What the live Schedule receives today (post-WO-6). The work-order domain
 * (orders + service rows + exceptions) is migrated and authoritative behind a
 * flag; customers / employees / postal cities are still resolved from the local
 * store and are held constant in the dry-run until their own tracks complete.
 * The date range + filters are derived per request and are not stored anywhere.
 */
export const SCHEDULE_INPUT_AUDIT: ReadonlyArray<ScheduleInputAuditRow> = [
  {
    input: "workOrders[] (LIVE only)",
    currentSource: "AppContext in-memory workOrders (localStorage-backed)",
    requiredFields: "status (live gate), serviceRows[], companyId, customerId",
    currentOwner: "Work Orders domain",
    futureSupabaseSource: "work_orders (company_id, work_order_status partial-live index)",
    state: "migrated",
  },
  {
    input: "serviceRows[].recurrence + embedded variations",
    currentSource: "Nested in workOrders (in-memory)",
    requiredFields: "status, archived, serviceDate/serviceEndDate, recurrenceInterval, plannedStart/EndTime, assignedEmployeeIds, unassignedEmployeeSlots, variations[] (embedded)",
    currentOwner: "Work Orders domain",
    futureSupabaseSource: "work_order_service_rows (flat schedule-critical columns + lossless data jsonb for variations)",
    state: "migrated",
  },
  {
    input: "occurrence exceptions[]",
    currentSource: "Separate in-memory exception store (localStorage-backed)",
    requiredFields: "parentServiceRowId, occurrenceDate, status, overrideOccurrenceDate, overrideStart/EndTime, staffing/labour overrides (data jsonb)",
    currentOwner: "Work Orders domain (separate store)",
    futureSupabaseSource: "work_order_occurrence_exceptions (explicit company_id + lossless data jsonb)",
    state: "migrated",
  },
  {
    input: "customers[] (id, name, addresses)",
    currentSource: "AppContext in-memory customers",
    requiredFields: "id, name, addresses (for display name + address/city label)",
    currentOwner: "Customers domain",
    futureSupabaseSource: "customers (already migrated; joined server-side or held constant during P6A/P6B)",
    state: "migrated",
  },
  {
    input: "employees[] (id, name)",
    currentSource: "AppContext in-memory employees",
    requiredFields: "id, name (assignee name resolution only)",
    currentOwner: "Employees domain",
    futureSupabaseSource: "employees (separate track; name lookup only)",
    state: "in-progress",
  },
  {
    input: "postalCities[]",
    currentSource: "AppContext in-memory reference data",
    requiredFields: "postalCode → city label",
    currentOwner: "Reference data",
    futureSupabaseSource: "postal_cities reference table (separate track)",
    state: "in-progress",
  },
  {
    input: "fromDate / toDate (+ widened scan window)",
    currentSource: "Derived per request (view mode → range)",
    requiredFields: "inclusive YYYY-MM-DD bounds; scan widened for cross-boundary reschedules",
    currentOwner: "Schedule UI / resolver",
    futureSupabaseSource: "Request params — server widens the fetched interval the same way the resolver widens its scan",
    state: "local-only",
  },
  {
    input: "filters (includeCancelled, employeeIds, status, serviceType)",
    currentSource: "Derived per request from board filter state",
    requiredFields: "includeCancelled flag + optional narrowing sets",
    currentOwner: "Schedule UI",
    futureSupabaseSource: "Request params — applied server-side before the interval is returned",
    state: "local-only",
  },
];

// ── Part 2 — Schedule repository contract decision ────────

export type ScheduleContractDecision = "reuse" | "extend" | "new";

export interface ScheduleContractField {
  member: string;
  decision: ScheduleContractDecision;
  rationale: string;
}

/**
 * Contract decision. A `ScheduleRepository` ALREADY exists
 * (`ReadRepository<ScheduleOccurrenceSummary, ScheduleOccurrenceDetail,
 * ScheduleListParams>`) and `ScheduleListParams` already carries
 * `fromDate / toDate / employeeIds`. Rather than invent a parallel surface, P6B
 * reuses `listSummaries(params)` as the interval query — it is exactly
 * "company-scoped + date-scoped list of lightweight occurrence summaries". The
 * `listOccurrencesByInterval` name from the brief is satisfied by that method;
 * we only EXTEND `ScheduleListParams` with the few narrowing flags the resolver
 * already honours, and document the interval-whole pagination rule. No new
 * repository type, no speculative methods.
 */
export const SCHEDULE_CONTRACT_DECISION: ReadonlyArray<ScheduleContractField> = [
  { member: "ScheduleRepository", decision: "reuse", rationale: "Already defined via ReadRepository; the Supabase adapter implements the same interface so call-sites never change." },
  { member: "listSummaries(params) = the interval query", decision: "reuse", rationale: "Company- + date-scoped summary list IS listOccurrencesByInterval; no second method needed." },
  { member: "getDetail(visitId) = occurrence detail-on-demand", decision: "reuse", rationale: "Board rows open detail lazily; never bundled into the interval payload." },
  { member: "ScheduleListParams.fromDate / toDate", decision: "reuse", rationale: "Interval bounds already on the params type." },
  { member: "ScheduleListParams.employeeIds", decision: "reuse", rationale: "Assignment-lane narrowing already present." },
  { member: "ScheduleListParams.includeCancelled", decision: "extend", rationale: "Resolver honours it; add to params so it is applied server-side rather than after fetch." },
  { member: "ScheduleListParams.statuses / serviceTypes", decision: "extend", rationale: "Optional server-side narrowing (mirrors ScheduleQueryRequest); keeps large intervals from over-fetching." },
  { member: "ScheduleListParams.viewMode", decision: "extend", rationale: "Caching/telemetry granularity hint; also lets the server pick the widen window." },
  { member: "listOccurrencesByInterval as a NEW method", decision: "new", rationale: "REJECTED — duplicates listSummaries. Documented here only to record the decision against the brief." },
];

// ── Part 3 — Supabase input builder (already shipped in WO-4) ──

export interface ScheduleBuilderContract {
  fn: string;
  status: "shipped" | "planned";
  produces: string;
  note: string;
}

/**
 * The Supabase input builder the brief asks for already exists from WO-4 and is
 * proven clean. P6B does NOT re-implement it; it wraps the SAME builder behind
 * the read flag (or, later, replaces the in-memory arrays with a true scoped
 * server query that returns the summary shape directly). Recorded here as the
 * contract P6B consumes.
 */
export const SCHEDULE_INPUT_BUILDERS: ReadonlyArray<ScheduleBuilderContract> = [
  { fn: "buildScheduleInputFromSupabase(options)", status: "shipped", produces: "ScheduleCoreInput { workOrders[], customers[], employees[], postalCities[], exceptions[], fromDate, toDate, includeCancelled }", note: "WO-4. Work orders + exceptions from Supabase (lossless data jsonb); lookups held constant. Feeds the unchanged resolver." },
  { fn: "buildScheduleInputFromLocal(options)", status: "shipped", produces: "ScheduleCoreInput (same shape, local source)", note: "WO-4. The local twin — same lookups — so any divergence is attributable purely to the migrated work-order representation." },
  { fn: "reconstructExceptionsFromSupabase(companyId)", status: "shipped", produces: "BookingOccurrenceException[]", note: "WO-4. Reads the lossless exception data jsonb (summary projection drops staffing/labour overrides the resolver needs)." },
  { fn: "interval query → ScheduleOccurrenceSummary[] (server-resolved)", status: "planned", produces: "Pre-sorted summary rows (SCHEDULE_SUMMARY_FIELDS) + dataToken", note: "P6B+ optimisation: resolve server-side and return summaries directly, so the client never hydrates all work orders. Until then the builder + local resolver is the bridge." },
];

// ── Part 4 — Interval query strategy ──────────────────────

export interface ScheduleFetchClass {
  recordClass: string;
  whyFetched: string;
  filter: string;
  index: string;
}

/**
 * The interval fetch must load ONLY what the interval needs — never all work
 * orders (risk #1 in `schedule.blueprint.ts`). These are the record classes a
 * `(companyId, fromDate, toDate)` query must pull, with the filter + supporting
 * index for each. The scan window is widened exactly as the resolver widens it,
 * so a reschedule whose override lands in range but whose rule date sits outside
 * is still fetched.
 */
export const SCHEDULE_FETCH_CLASSES: ReadonlyArray<ScheduleFetchClass> = [
  {
    recordClass: "Service rows active in the interval",
    whyFetched: "One-time / bounded rows whose serviceDate..serviceEndDate overlaps the range generate occurrences directly.",
    filter: "company_id = ? AND archived = false AND status live AND service_date <= toDate AND (service_end_date IS NULL OR service_end_date >= widenedFrom)",
    index: "(company_id, service_date) + partial WHERE NOT archived AND status live",
  },
  {
    recordClass: "Recurring rows that can generate in the interval",
    whyFetched: "Open-ended recurring rows (no end, or end past the range start) can produce occurrences inside the range.",
    filter: "company_id = ? AND archived = false AND status live AND recurrence_interval <> 'none' AND service_date <= toDate",
    index: "(company_id, recurrence_interval, service_date)",
  },
  {
    recordClass: "Rows with an exception in the interval",
    whyFetched: "A reschedule can move an occurrence INTO the range from outside; the exception's row + its source date must be fetched (scan widening).",
    filter: "exceptions: company_id = ? AND occurrence_date BETWEEN widenedFrom AND widenedTo → collect parent_service_row_id",
    index: "(company_id, occurrence_date) on work_order_occurrence_exceptions",
  },
  {
    recordClass: "Parent work orders for the fetched rows",
    whyFetched: "Live gate (isLiveWorkOrder) + companyId/customerId for each row; only the parents referenced by fetched rows.",
    filter: "id IN (fetched parent ids) AND work_order_status live",
    index: "(company_id, work_order_status) partial WHERE live",
  },
  {
    recordClass: "Occurrence exceptions in the (widened) interval",
    whyFetched: "Cancel / reschedule / time-change overlay applied per occurrence.",
    filter: "company_id = ? AND occurrence_date BETWEEN widenedFrom AND widenedTo",
    index: "(company_id, parent_service_row_id, occurrence_date)",
  },
];

/** The scan-widening rule the server must replicate from the resolver. */
export const SCHEDULE_SCAN_WIDENING_NOTE =
  "Fetch exceptions first; for any 'rescheduled' exception whose overrideOccurrenceDate lands in [fromDate,toDate], extend the row/occurrence fetch lower/upper bound to include its rule-derived occurrenceDate. This mirrors resolveScheduleProgram's scan-window widening so cross-boundary reschedules surface on the day they moved TO.";

// ── Part 5 — Cache strategy ───────────────────────────────

export interface ScheduleCacheKeyPart {
  part: string;
  source: string;
  note: string;
}

/**
 * Cache integrates with the EXISTING `IntervalCache` + `buildIntervalCacheKey`
 * (intervalCache.ts). The key already supports `scope | viewMode | from..to |
 * filters`; P6A adds `dataToken` semantics for the server-backed era. Today a
 * single whole-cache `dataToken` (referenceToken over the source arrays) is
 * correct-but-coarse; the server era can carry a PER-INTERVAL dataToken so only
 * intervals whose underlying rows changed are dropped.
 */
export const SCHEDULE_CACHE_KEY_PARTS: ReadonlyArray<ScheduleCacheKeyPart> = [
  { part: "companyId (scope)", source: "active company / super-admin 'all'", note: "First key segment; a company switch can never read another tenant's interval." },
  { part: "viewMode", source: "request granularity (day|week|month|custom)", note: "Distinguishes a week view from a month view over overlapping dates." },
  { part: "fromDate..toDate", source: "request bounds", note: "The interval itself." },
  { part: "filters", source: "includeCancelled + employeeIds + statuses + serviceTypes", note: "Serialised deterministically so filter order never changes the key." },
  { part: "dataToken", source: "referenceToken(workOrders, exceptions, customers, employees) today; per-interval server token later", note: "Token change drops the cache (whole today; per-interval in the server era)." },
];

export interface ScheduleCacheInvalidation {
  event: string;
  scope: "current-interval" | "neighbouring-intervals" | "all-intervals";
  rationale: string;
}

/**
 * Invalidation reuses OP3's `SCHEDULE_INVALIDATION_RULES`. Restated here scoped
 * to the work-order write events that now flow through the migrated write seam,
 * so P6B knows exactly which interval(s) to drop when each mutation fires.
 */
export const SCHEDULE_CACHE_INVALIDATION: ReadonlyArray<ScheduleCacheInvalidation> = [
  { event: "Work order / service row created", scope: "current-interval", rationale: "Adds occurrences only in the affected interval(s)." },
  { event: "Service row planned-time / assignment change", scope: "current-interval", rationale: "Re-buckets one interval; staffing math changes locally." },
  { event: "Variation created/edited on an occurrence", scope: "current-interval", rationale: "Alters one occurrence's window/label." },
  { event: "Occurrence reschedule (date move)", scope: "neighbouring-intervals", rationale: "Occurrence leaves one interval and lands in another — drop both (scan widening)." },
  { event: "Occurrence cancel / restore", scope: "current-interval", rationale: "Flags/removes one occurrence in its interval." },
  { event: "Recurrence-rule change on a service row", scope: "all-intervals", rationale: "Regenerates the whole future series." },
  { event: "Work order archived / inactivated (incl. WO-5.6 soft-delete)", scope: "all-intervals", rationale: "Removes all its future occurrences across every interval — the ghost-occurrence guard." },
  { event: "Customer / employee rename", scope: "all-intervals", rationale: "Denormalised names appear across all intervals (low frequency)." },
];

// ── Part 6 — Shadow validation plan ───────────────────────

export interface ScheduleShadowDimension {
  dimension: string;
  source: string;
  blocking: boolean;
}

/**
 * Shadow validation reuses WO-4's `compareScheduleInterval()` — it already
 * resolves the SAME interval from local + Supabase-reconstructed inputs and
 * diffs every occurrence. P6B runs it in the background while the read flag is
 * ON (exactly like the work-order shadow read), surfacing any drift; nothing is
 * silently ignored. These are the dimensions it compares and which are
 * cut-over-blocking.
 */
export const SCHEDULE_SHADOW_DIMENSIONS: ReadonlyArray<ScheduleShadowDimension> = [
  { dimension: "occurrence count", source: "compareScheduleInterval.countMatch", blocking: true },
  { dimension: "occurrence keys (parentServiceRowId:occurrenceDate)", source: "missingInSupabase / extraInSupabase", blocking: true },
  { dimension: "displayDate / occurrenceDate", source: "ENTRY_COMPARE_FIELDS divergence", blocking: true },
  { dimension: "startTime / endTime", source: "ENTRY_COMPARE_FIELDS divergence", blocking: true },
  { dimension: "customerId / customerName", source: "ENTRY_COMPARE_FIELDS divergence", blocking: true },
  { dimension: "assignedEmployeeIds", source: "ENTRY_COMPARE_FIELDS divergence", blocking: true },
  { dimension: "status", source: "ENTRY_COMPARE_FIELDS divergence", blocking: true },
  { dimension: "isVariation / isRescheduled / isTimeChanged indicators", source: "ENTRY_COMPARE_FIELDS divergence", blocking: true },
];

/** The validation entry points P6B wires to the background shadow run. */
export const SCHEDULE_SHADOW_ENTRYPOINTS: ReadonlyArray<{ fn: string; gates: string }> = [
  { fn: "compareScheduleInterval(options)", gates: "Per-interval occurrence diff while the read flag is ON." },
  { fn: "validateWorkOrderScheduleDependency(options)", gates: "Full WO-4 gate (service-row + variation + exception parity + interval dry-run); must be ok before any P6B cut-over." },
];

// ── Part 7 — Risks / blockers ─────────────────────────────

export type ScheduleDesignRiskSeverity = "critical" | "high" | "medium" | "low";

export interface ScheduleDesignRisk {
  rank: number;
  risk: string;
  severity: ScheduleDesignRiskSeverity;
  mitigation: string;
}

/** Risks/blockers to resolve across P6B+ (design-phase view). */
export const SCHEDULE_DESIGN_RISKS: ReadonlyArray<ScheduleDesignRisk> = [
  { rank: 1, risk: "Interval query that accidentally fetches all work orders (full hydration)", severity: "critical", mitigation: "Strict (company_id, date) filters per SCHEDULE_FETCH_CLASSES; never SELECT * without a date bound." },
  { rank: 2, risk: "Scan-widening mismatch drops cross-boundary reschedules", severity: "critical", mitigation: "Server replicates SCHEDULE_SCAN_WIDENING_NOTE exactly; covered by compareScheduleInterval reschedule cases." },
  { rank: 3, risk: "Variations live in service-row data jsonb, not relational — a summary projection could drop them", severity: "high", mitigation: "Reconstruct from lossless data jsonb (as WO-4 does) OR resolve variations server-side before returning summaries; never read variations from flat columns." },
  { rank: 4, risk: "Exception staffing/labour overrides missing from the summary projection", severity: "high", mitigation: "reconstructExceptionsFromSupabase reads the full data jsonb; the interval query must do the same, not the summary row." },
  { rank: 5, risk: "Customers/employees/postalCities not yet authoritative in Supabase", severity: "medium", mitigation: "Hold lookups constant from the local store (WO-4 approach) until their tracks land; both resolve twins use the same lookups so divergence is attributable." },
  { rank: 6, risk: "Coarse whole-cache invalidation churns large intervals", severity: "medium", mitigation: "Per-interval dataToken in the server era (SCHEDULE_CACHE_KEY_PARTS); reschedule drops neighbours only." },
  { rank: 7, risk: "Stale Supabase rows creating ghost occurrences", severity: "high", mitigation: "Already mitigated by WO-5.6 removal propagation + soft-delete; re-asserted by validateWorkOrderScheduleDependency before P6B cut-over." },
];

// ── Part 8 — Phase status + recommendation for P6B ────────

export type ScheduleMigrationDesignStatus = "design-complete" | "in-design";

export interface ScheduleMigrationDesignVerdict {
  status: ScheduleMigrationDesignStatus;
  uiSwitched: false;
  resolverChanged: false;
  realtime: false;
  summary: string;
  nextPhase: string;
  nextPhaseRationale: ReadonlyArray<string>;
}

/**
 * P6A verdict. The interval-query design, repository-contract decision, input
 * builder contract, fetch/index strategy, cache strategy, and shadow-validation
 * plan are all defined and grounded in shipped WO-4 tooling that already
 * validates clean. The Schedule UI and resolver are untouched. Next is P6B — the
 * Schedule interval read switch behind a default-OFF flag with background shadow
 * comparison, following the proven read-switch pattern.
 */
export const SCHEDULE_MIGRATION_DESIGN_VERDICT: ScheduleMigrationDesignVerdict = {
  status: "design-complete",
  uiSwitched: false,
  resolverChanged: false,
  realtime: false,
  summary:
    "Schedule interval-query migration is designed against shipped, validated WO-4 tooling. The repository contract is REUSED (ScheduleRepository.listSummaries with an extended ScheduleListParams — no new method); the Supabase input builder (buildScheduleInputFromSupabase) and shadow comparator (compareScheduleInterval) already exist and resolve identical occurrences. Interval fetch is strictly (company_id, date)-scoped with documented indexes and resolver-matching scan widening; caching reuses IntervalCache with a per-interval dataToken plan; shadow validation reuses validateWorkOrderScheduleDependency. resolveScheduleProgram, recurrence, variation and exception logic are unchanged; no UI switch; no realtime.",
  nextPhase: "P6B — Schedule interval read switch (flag-gated, shadow-validated)",
  nextPhaseRationale: [
    "Add work_orders-style flag (default OFF) routing the Schedule input through buildScheduleInputFromSupabase, with local fallback.",
    "Run compareScheduleInterval in the background when the flag is ON; surface any drift, fall back to local on error.",
    "Keep resolveScheduleProgram and the board untouched — only the input SOURCE moves behind the flag.",
    "Gate any cut-over on validateWorkOrderScheduleDependency() === ok for representative intervals + 0 critical shadow drift.",
  ],
};
