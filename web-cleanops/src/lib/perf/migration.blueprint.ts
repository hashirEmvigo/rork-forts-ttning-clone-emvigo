/**
 * Operational Data Migration — Master Blueprint (P4A).
 *
 * Design-only. Nothing here runs, queries, creates tables, migrates data, or
 * changes behaviour. It is the single forward-looking contract that unifies the
 * prior audit phases (P1 search/pagination, P2 detail-on-demand, P3 cache layer,
 * P3.5 monitoring, OP1 operational mapping, OP2 activity-log, OP3 schedule, OP4
 * boot-time hydration) into one staged migration architecture, expressed as
 * typed, importable documentation so each wave has a concrete target and can be
 * reviewed/diffed alongside the code it describes.
 *
 * Current reality (grounded in prior audits, unchanged here):
 *  - `AppContext`/`AppProvider` eagerly hydrates ~36 full, UN-scoped datasets at
 *    mount via `useState(() => getX())`; operational data lives in localStorage.
 *  - Supabase is used today only for auth, companies, and entitlements.
 *  - mediaStore / protocolRunStore / visitOccurrenceStore are ALREADY lazy and
 *    company-scoped — the target model the rest should converge on.
 *  - Activity Log (auditEvents), Schedule (workOrders), Customers, Work Orders
 *    and Time Reports are the major future pressure points.
 *
 * This blueprint does NOT: create tables, migrate data, rewrite AppContext,
 * change auth/permissions/workflows/scheduling/booking, or add backend calls.
 */

// ── Part 2/3 — Target layer model ─────────────────────────

/** A layer in the future data-access architecture. */
export interface ArchitectureLayer {
  layer: string;
  responsibility: string;
  owns: string;
  mustNotOwn: string;
}

/**
 * The future layered architecture. Each layer has a single responsibility and a
 * strict "must not own" boundary so operational data never leaks back up into a
 * god-provider. Data flows downward: session → company → permissions → queries →
 * feature stores/route loaders → UI.
 */
export const MIGRATION_LAYERS: ReadonlyArray<ArchitectureLayer> = [
  {
    layer: "Auth / Session",
    responsibility: "Authenticate the user, restore the session, expose identity.",
    owns: "currentUser, session token, auth state.",
    mustNotOwn: "Any company or operational data.",
  },
  {
    layer: "Company Context",
    responsibility: "Track the active company and its lightweight metadata; gate company switching.",
    owns: "activeCompanyId, company access list, company settings, company-level config.",
    mustNotOwn: "Customers, employees, work orders or any operational list.",
  },
  {
    layer: "Permission / Entitlement",
    responsibility: "Resolve roles, permissions, entitlements and feature flags for the active session+company.",
    owns: "roles, permission matrix, entitlements, feature flags.",
    mustNotOwn: "Operational data; it only gates access to it.",
  },
  {
    layer: "Query Layer",
    responsibility: "The single typed boundary for fetching scoped, paged, cached data.",
    owns: "Query definitions, cache keys, invalidation, pagination, metering hooks.",
    mustNotOwn: "UI state or business rules — it returns data, nothing more.",
  },
  {
    layer: "Feature Stores / Route Loaders",
    responsibility: "Per-route/per-feature data ownership; compose query results for a surface.",
    owns: "The data a specific surface needs, fetched on entry, dropped on exit.",
    mustNotOwn: "Cross-feature global state — that stays in the layers above.",
  },
  {
    layer: "UI Components",
    responsibility: "Render summary/detail data and emit user events.",
    owns: "Local view state only.",
    mustNotOwn: "Data fetching logic or caches — they consume the query layer.",
  },
];

// ── Part 3 — Future AppContext responsibility ─────────────

export interface AppContextResponsibility {
  /** Whether AppContext should keep this after migration. */
  keep: boolean;
  item: string;
  rationale: string;
}

/**
 * What AppContext should keep vs. shed. Today it owns ~36 collections; after
 * migration it keeps only small, session-wide identity/permission/config and
 * sheds every operational list to the query layer / route loaders.
 */
export const APPCONTEXT_RESPONSIBILITY: ReadonlyArray<AppContextResponsibility> = [
  { keep: true, item: "authenticated user", rationale: "Session identity, read everywhere." },
  { keep: true, item: "active company + company access", rationale: "Small; drives scoping (may move to CompanyProvider)." },
  { keep: true, item: "roles / permissions", rationale: "Tiny, session-wide, gates UI." },
  { keep: true, item: "entitlements / feature flags", rationale: "Small; gates features globally." },
  { keep: true, item: "global UI / session state", rationale: "Theme, active company switcher, transient UI." },
  { keep: false, item: "customers", rationale: "Operational list → query-driven, paged, company-scoped." },
  { keep: false, item: "employees / users", rationale: "Operational list → query-driven, company-scoped." },
  { keep: false, item: "work orders", rationale: "Schedule source → date+company interval query." },
  { keep: false, item: "schedule occurrences / booking queue / exceptions", rationale: "Interval-scoped queries, not global memory." },
  { keep: false, item: "activity logs (auditEvents)", rationale: "Date-paged, company-scoped query (OP2)." },
  { keep: false, item: "time reports", rationale: "Date-paged, employee/company-scoped query." },
  { keep: false, item: "media / protocol runs", rationale: "Already lazy; never global." },
  { keep: false, item: "large catalogue/config datasets", rationale: "Route-scoped + cached, not eager at boot." },
];

/** Staged extraction order for pulling operational data out of AppContext. */
export const APPCONTEXT_EXTRACTION_PLAN: ReadonlyArray<{ step: number; action: string }> = [
  { step: 1, action: "Introduce a CompanyProvider that reads the active company + settings; AppContext delegates to it." },
  { step: 2, action: "Introduce the query layer behind a stable interface; keep the localStorage adapter as the first implementation (no behaviour change)." },
  { step: 3, action: "Move customers + work orders reads to the query layer; AppContext stops hydrating them." },
  { step: 4, action: "Move activity log + time reports to date-paged queries." },
  { step: 5, action: "Move remaining operational lists; AppContext retains only session/permission/config." },
];

// ── Part 4 — CompanyProvider design ───────────────────────

export interface CompanyProviderSpec {
  owns: ReadonlyArray<string>;
  mustNotOwn: ReadonlyArray<string>;
  switchBehavior: ReadonlyArray<string>;
}

/**
 * Future CompanyProvider. Owns only lightweight company-scoped session data and
 * is the single place company switching invalidates company-scoped caches.
 */
export const COMPANY_PROVIDER: CompanyProviderSpec = {
  owns: [
    "active company id + metadata (name, plan)",
    "company settings (active company only)",
    "company feature access / module enablement",
    "company-level configuration",
  ],
  mustNotOwn: [
    "customers / employees / work orders / any operational list",
    "activity logs / time reports",
    "media / protocol runs",
  ],
  switchBehavior: [
    "On company switch: drop ALL company-scoped caches (list query cache, schedule interval cache, lookup cache, detail cache).",
    "Re-fetch Tier A/B for the new company only; never hold two companies' operational data at once.",
    "Session cache survives; company cache is rebuilt; the schedule interval cache key already carries `scope` so stale intervals cannot bleed across companies.",
  ],
};

// ── Part 5 — Query layer design ───────────────────────────

/** A capability the future query layer must support. */
export interface QueryCapability {
  capability: string;
  detail: string;
}

export const QUERY_LAYER_CAPABILITIES: ReadonlyArray<QueryCapability> = [
  { capability: "Company scoping", detail: "Every query carries the active companyId; no cross-company reads." },
  { capability: "Date scoping", detail: "Interval/date-range filters for schedule, activity, time reports." },
  { capability: "Pagination", detail: "Offset for list UIs; cursor (keyset) for high-volume append-only logs." },
  { capability: "Summary/detail separation", detail: "List queries return summaries only; detail fetched on open." },
  { capability: "Cache keys", detail: "Deterministic keys from {entity, companyId, dateRange, filters, page}." },
  { capability: "Invalidation", detail: "Mutations invalidate the affected keys (and neighbours where relevant)." },
  { capability: "Realtime hooks", detail: "Optional subscription per surface, layered on top of the same query." },
  { capability: "Metering hooks", detail: "Each query/mutation increments per-company usage counters at the boundary." },
];

// ── Part 6 — Entity migration designs ─────────────────────

export type WaveId = "wave-0" | "wave-1" | "wave-2" | "wave-3" | "wave-4" | "wave-5" | "wave-6";

export interface EntityMigration {
  entity: string;
  summaryQuery: string;
  detailQuery: string;
  pagination: "offset" | "cursor" | "interval" | "none";
  indexes: ReadonlyArray<string>;
  cacheStrategy: string;
  priority: WaveId;
  notes: string;
}

/**
 * Per-entity future query + cache model. Indexes are recommendations for the
 * future Postgres/Supabase tables (see {@link INDEX_STRATEGY} for rationale).
 */
export const ENTITY_MIGRATIONS: ReadonlyArray<EntityMigration> = [
  {
    entity: "Customers",
    summaryQuery: "company-scoped, paged, text/identifier search → CustomerSummary[]",
    detailQuery: "by id → CustomerDetail (+ lazy tabs: notes, media, work orders, activity)",
    pagination: "offset",
    indexes: ["(company_id, name)", "(company_id, customer_number)", "(company_id, created_at desc)"],
    cacheStrategy: "List query cache keyed by {company, search, page}; detail cache short-lived per id.",
    priority: "wave-1",
    notes: "Largest list dataset; P1 search/pagination already wired client-side.",
  },
  {
    entity: "Employees",
    summaryQuery: "company-scoped, paged → EmployeeSummary[]",
    detailQuery: "by id → EmployeeDetail; activity query date-scoped; assignment lookup memoized",
    pagination: "offset",
    indexes: ["(company_id, name)", "(company_id, status)", "(company_id, employee_number)"],
    cacheStrategy: "List cache + a Tier-B employeeNameById lookup selector reused across surfaces.",
    priority: "wave-1",
    notes: "Needed by many surfaces; cache the name/area lookups (P3 selectors).",
  },
  {
    entity: "Work Orders",
    summaryQuery: "company+status scoped, paged → WorkOrderSummary[]",
    detailQuery: "by id → WorkOrderDetail incl. service rows, variations, exceptions",
    pagination: "offset",
    indexes: ["(company_id, status, created_at desc)", "(company_id, customer_id)", "(company_id, scheduled_date)"],
    cacheStrategy: "Detail cache per id; schedule reads occurrences, not full work orders.",
    priority: "wave-1",
    notes: "Feeds the schedule resolver — must be query-backed before schedule migration.",
  },
  {
    entity: "Schedule",
    summaryQuery: "interval query {company, fromDate, toDate, filters} → ScheduleOccurrenceSummary[]",
    detailQuery: "occurrence → work order / customer / protocol on open",
    pagination: "interval",
    indexes: ["(company_id, scheduled_date)", "(company_id, employee_id, scheduled_date)"],
    cacheStrategy: "IntervalCache (P3) keyed by {company, dateRange, filters, viewMode}; per-interval dataToken invalidation.",
    priority: "wave-2",
    notes: "Highest growth risk; summary object defined in schedule.blueprint.ts.",
  },
  {
    entity: "Activity Log",
    summaryQuery: "company+date scoped, cursor-paged → ActivityEventSummary[]",
    detailQuery: "by id → full event payload (rare)",
    pagination: "cursor",
    indexes: [
      "(company_id, created_at desc)",
      "(company_id, actor_id, created_at desc)",
      "(company_id, entity_type, entity_id, created_at desc)",
      "(company_id, action, created_at desc)",
    ],
    cacheStrategy: "Newest page cached; older pages fetched on scroll; retention classes (OP2).",
    priority: "wave-3",
    notes: "Highest write velocity; capped at 500 today — server query removes the ceiling.",
  },
  {
    entity: "Time Reports / Employee Activity",
    summaryQuery: "company+employee+date scoped, paged → TimeReportSummary[]",
    detailQuery: "by id → full report; check-in/check-out future model",
    pagination: "offset",
    indexes: ["(company_id, employee_id, date desc)", "(company_id, work_order_id)", "(company_id, date desc)"],
    cacheStrategy: "Date-window cache; employee activity derived from time reports + audit feed (hybrid).",
    priority: "wave-3",
    notes: "Scales with employees × days; OP2 recommends a hybrid derived/normalized feed.",
  },
  {
    entity: "Media",
    summaryQuery: "company-scoped metadata + thumbnail URL → MediaSummary[]",
    detailQuery: "signed URL for original on open",
    pagination: "offset",
    indexes: ["(company_id, entity_type, entity_id)", "(company_id, created_at desc)"],
    cacheStrategy: "Browser/CDN cache; thumbnail vs original separation; signed URLs short-lived.",
    priority: "wave-4",
    notes: "Move base64/localStorage to object storage; per-company byte attribution.",
  },
  {
    entity: "Protocol Runs / Visit Occurrences",
    summaryQuery: "company+interval scoped → run/occurrence summaries",
    detailQuery: "by id → full protocol responses on open",
    pagination: "interval",
    indexes: ["(company_id, work_order_id)", "(company_id, occurred_at desc)"],
    cacheStrategy: "Already lazy company-scoped getters; minimal change to server queries.",
    priority: "wave-5",
    notes: "Already the target model; lowest migration risk.",
  },
];

// ── Part 7 — Summary vs detail contracts ──────────────────

export interface SummaryDetailContract {
  contract: string;
  summaryFields: ReadonlyArray<string>;
  detailOnly: ReadonlyArray<string>;
  neverInList: ReadonlyArray<string>;
}

/**
 * Strict summary/detail contracts. `summaryFields` are the ONLY fields a list
 * query returns; `detailOnly` load on record open; `neverInList` must never
 * appear in any list/boot payload (heavy or high-cardinality).
 */
export const SUMMARY_DETAIL_CONTRACTS: ReadonlyArray<SummaryDetailContract> = [
  {
    contract: "Customer",
    summaryFields: ["id", "displayName", "customerNumber", "cityLabel", "status", "activeWorkOrderCount"],
    detailOnly: ["fullAddress", "contacts", "billingData", "notes", "protocolAssignments"],
    neverInList: ["media", "activityHistory", "protocolResponses"],
  },
  {
    contract: "Employee",
    summaryFields: ["id", "displayName", "employeeNumber", "role", "status", "areaLabel"],
    detailOnly: ["contactDetails", "languages", "assignmentHistory", "settings"],
    neverInList: ["timeReports", "visitHistory", "mediaUploads"],
  },
  {
    contract: "WorkOrder",
    summaryFields: ["id", "customerDisplayName", "status", "serviceLabel", "scheduledDate", "employeeIds"],
    detailOnly: ["serviceRows", "variations", "exceptions", "notes"],
    neverInList: ["protocolResponses", "media", "activityHistory"],
  },
  {
    contract: "ScheduleOccurrence",
    summaryFields: ["visitId", "date", "startTime", "endTime", "employeeIds", "customerDisplayName", "status", "serviceLabel"],
    detailOnly: ["workOrderDetail", "customerCard", "protocolResponses"],
    neverInList: ["media", "fullCustomerProfile", "billingData", "activityHistory"],
  },
  {
    contract: "ActivityEvent",
    summaryFields: ["id", "createdAt", "actorId", "actorLabel", "action", "entityType", "entityId", "severity"],
    detailOnly: ["fullPayload", "beforeAfterDiff"],
    neverInList: ["attachments", "relatedMedia"],
  },
  {
    contract: "Media",
    summaryFields: ["id", "thumbnailUrl", "entityType", "entityId", "createdAt", "bytes"],
    detailOnly: ["originalSignedUrl", "exif"],
    neverInList: ["base64Data"],
  },
];

// ── Part 8 — Indexing strategy ────────────────────────────

export interface IndexRecommendation {
  index: string;
  table: string;
  reason: string;
}

/**
 * Recommended indexes for the future tables. Every operational table leads with
 * `company_id` (tenant isolation + the universal filter), then the surface's
 * primary sort/filter. Composite indexes target the exact query shapes above.
 */
export const INDEX_STRATEGY: ReadonlyArray<IndexRecommendation> = [
  { index: "(company_id, created_at desc)", table: "all operational tables", reason: "Tenant-scoped newest-first listing — the default list/feed query." },
  { index: "(company_id, status, created_at desc)", table: "work_orders", reason: "Status-filtered work-order lists without a full scan." },
  { index: "(company_id, customer_id)", table: "work_orders, invoices", reason: "All records for one customer within a tenant." },
  { index: "(company_id, employee_id, date desc)", table: "time_reports", reason: "Per-employee time history, date-windowed." },
  { index: "(company_id, scheduled_date)", table: "work_orders / occurrences", reason: "Interval schedule query — the highest-frequency read." },
  { index: "(company_id, employee_id, scheduled_date)", table: "occurrences", reason: "Per-employee schedule lane within an interval." },
  { index: "(company_id, entity_type, entity_id, created_at desc)", table: "activity_events", reason: "Entity timeline (customer/work-order history) filter." },
  { index: "(company_id, actor_id, created_at desc)", table: "activity_events", reason: "Per-actor audit trail." },
  { index: "(company_id, action, created_at desc)", table: "activity_events", reason: "Action-type filtered audit query." },
  { index: "(company_id, name)", table: "customers, employees", reason: "Alphabetical paging + prefix search." },
  { index: "(company_id, customer_number)", table: "customers", reason: "Identifier lookup (bypasses the 5-char search rule, P1)." },
];

// ── Part 9 — Cache strategy ───────────────────────────────

export interface CacheLayerSpec {
  cache: string;
  owner: string;
  key: string;
  lifetime: string;
  invalidation: string;
  survivesCompanySwitch: boolean;
}

/**
 * Future cache layers. Company-scoped caches are dropped on company switch;
 * only the session cache survives. Mirrors OP4 cache ownership, extended with
 * the list query cache the migration introduces.
 */
export const CACHE_LAYERS: ReadonlyArray<CacheLayerSpec> = [
  { cache: "Session cache", owner: "AuthProvider", key: "userId", lifetime: "Until logout / token expiry", invalidation: "Sign-out, refresh failure", survivesCompanySwitch: true },
  { cache: "Company cache", owner: "CompanyProvider", key: "companyId", lifetime: "Until company switch", invalidation: "Switch, company-settings mutation", survivesCompanySwitch: false },
  { cache: "Lookup cache", owner: "Memoized selectors (selectors.ts)", key: "source array reference", lifetime: "Until source reference changes", invalidation: "referenceToken change", survivesCompanySwitch: false },
  { cache: "Schedule interval cache", owner: "IntervalCache (intervalCache.ts)", key: "{company, dateRange, filters, viewMode}", lifetime: "LRU-bounded per session", invalidation: "Per-interval dataToken", survivesCompanySwitch: false },
  { cache: "List query cache", owner: "Query layer", key: "{entity, company, search, page, filters}", lifetime: "Short TTL / until mutation", invalidation: "Mutation of the entity", survivesCompanySwitch: false },
  { cache: "Detail cache", owner: "Query layer / detail view", key: "{entity, id}", lifetime: "Recent records only", invalidation: "Mutation of that record", survivesCompanySwitch: false },
  { cache: "Media cache", owner: "Browser / CDN", key: "asset url", lifetime: "CDN-controlled", invalidation: "Asset replacement", survivesCompanySwitch: true },
];

// ── Part 10 — Realtime strategy ───────────────────────────

export type RealtimeClass = "immediate" | "on-refresh" | "none";

export interface RealtimeEventSpec {
  event: string;
  class: RealtimeClass;
  rationale: string;
}

/**
 * Selective realtime classification. Channels are scoped per company and per
 * active surface — never global, never one subscription per row. Only the
 * `immediate` set justifies a live channel; everything else updates on refresh
 * or not at all.
 */
export const REALTIME_EVENTS: ReadonlyArray<RealtimeEventSpec> = [
  { event: "Active job status change", class: "immediate", rationale: "Dispatchers need live job state." },
  { event: "Check-in / check-out", class: "immediate", rationale: "Drives live attendance / active-job view." },
  { event: "Urgent schedule change / assignment change", class: "immediate", rationale: "Affects who works now." },
  { event: "Critical notification", class: "immediate", rationale: "Time-sensitive by definition." },
  { event: "Customer name / detail update", class: "on-refresh", rationale: "Eventually-consistent is fine." },
  { event: "Work-order note update", class: "on-refresh", rationale: "Non-blocking edit." },
  { event: "Non-critical activity event", class: "on-refresh", rationale: "Feed catches up on next load." },
  { event: "Settings / historical reports / archive / old logs", class: "none", rationale: "No live value; fetch on demand." },
];

/** Channel strategy guardrails. */
export const REALTIME_CHANNEL_STRATEGY: ReadonlyArray<string> = [
  "One channel per company + active surface (e.g. `company:{id}:schedule`).",
  "Subscribe only while the surface is mounted; unsubscribe on navigation.",
  "Never a global channel; never one subscription per row.",
  "Realtime layers on top of the same query — it pokes a refetch/patch, it is not the data source.",
];

// ── Part 11 — Usage & performance metering ────────────────

export interface MeteringHookSpec {
  metric: string;
  collectedAt: string;
  family: "performance" | "usage" | "billing-input";
}

/**
 * Where metering hooks live. Every cost-driving action is attributable to a
 * companyId at the server boundary. Blueprint only — no storage, no billing.
 */
export const METERING_HOOKS: ReadonlyArray<MeteringHookSpec> = [
  { metric: "api_requests", collectedAt: "Query-layer boundary", family: "usage" },
  { metric: "db_queries", collectedAt: "Query-layer boundary", family: "performance" },
  { metric: "rows_read", collectedAt: "Query-layer boundary", family: "usage" },
  { metric: "rows_written", collectedAt: "Mutation boundary", family: "usage" },
  { metric: "schedule_occurrences_generated", collectedAt: "Schedule resolver", family: "performance" },
  { metric: "activity_events_written", collectedAt: "Audit append", family: "usage" },
  { metric: "media_bytes_stored", collectedAt: "Object-storage upload", family: "billing-input" },
  { metric: "media_bytes_served", collectedAt: "Signed-URL / CDN edge", family: "billing-input" },
  { metric: "ai_tokens_used", collectedAt: "AI server wrapper", family: "billing-input" },
  { metric: "ai_requests", collectedAt: "AI server wrapper", family: "usage" },
  { metric: "realtime_connection_minutes", collectedAt: "Channel subscribe/unsubscribe", family: "billing-input" },
  { metric: "exports_generated", collectedAt: "Export endpoint", family: "usage" },
  { metric: "notifications_sent", collectedAt: "Notification dispatcher", family: "usage" },
];

// ── Part 12 — Migration waves ─────────────────────────────

export interface MigrationWave {
  wave: WaveId;
  title: string;
  scope: string;
  entryCriteria: string;
  exitCriteria: string;
}

/**
 * The safe migration order. Wave 0 builds the seams (interfaces + adapters) with
 * NO data movement, so every later wave is a swap behind a stable interface.
 * Largest boot datasets (customers, work orders) move first; realtime/metering
 * last, only once server boundaries are stable.
 */
export const MIGRATION_WAVES: ReadonlyArray<MigrationWave> = [
  {
    wave: "wave-0",
    title: "Contracts & adapters",
    scope: "Define query-layer interfaces, summary/detail contracts, and a localStorage adapter implementing them. No data migration.",
    entryCriteria: "P4A blueprint approved.",
    exitCriteria: "Every entity reads through the query interface; localStorage adapter passes parity tests.",
  },
  {
    wave: "wave-1",
    title: "Customers + Work Orders foundation",
    scope: "Move the largest boot-time datasets to company-scoped, paged Supabase queries behind the existing interface.",
    entryCriteria: "Wave 0 complete; tables created with recommended indexes.",
    exitCriteria: "AppContext no longer hydrates customers/work orders; boot memory drops; parity validated.",
  },
  {
    wave: "wave-2",
    title: "Schedule interval query",
    scope: "Move schedule generation to company+date interval queries returning ScheduleOccurrenceSummary; keep the IntervalCache.",
    entryCriteria: "Work orders server-backed (wave 1).",
    exitCriteria: "Schedule renders from interval queries; cache hit-rate validated against budget.",
  },
  {
    wave: "wave-3",
    title: "Activity Log + Time Reports",
    scope: "Move high-volume append-only events to cursor-paged, date-scoped queries with retention classes.",
    entryCriteria: "Waves 1–2 stable.",
    exitCriteria: "500-cap removed; activity/time queries paged; retention policy applied.",
  },
  {
    wave: "wave-4",
    title: "Media storage",
    scope: "Move base64/localStorage media to object storage with thumbnail/original separation and signed URLs.",
    entryCriteria: "Operational lists server-backed.",
    exitCriteria: "No base64 in DB; per-company byte attribution live.",
  },
  {
    wave: "wave-5",
    title: "Protocol Runs + Visit Occurrences",
    scope: "Move the already-lazy stores to scoped server queries (minimal change).",
    entryCriteria: "Waves 1–4 stable.",
    exitCriteria: "Execution data fully server-backed.",
  },
  {
    wave: "wave-6",
    title: "Realtime + Usage Metering",
    scope: "Introduce selective per-surface realtime and per-company metering at the now-stable server boundary.",
    entryCriteria: "All operational data server-backed.",
    exitCriteria: "Immediate-class events live; metering counters recording per company.",
  },
];

// ── Part 13 — Risk & rollback plan ────────────────────────

export type WaveRiskLevel = "low" | "medium" | "high" | "critical";

export interface WaveRisk {
  wave: WaveId;
  risk: WaveRiskLevel;
  complexity: WaveRiskLevel;
  rollback: string;
  validation: string;
}

/**
 * Per-wave risk + rollback. The adapter seam (wave 0) means each wave can fall
 * back to the localStorage implementation by flipping the adapter, with shadow
 * logging comparing server vs local results before cut-over.
 */
export const WAVE_RISKS: ReadonlyArray<WaveRisk> = [
  { wave: "wave-0", risk: "low", complexity: "medium", rollback: "Pure additive interfaces; revert the commit.", validation: "Adapter parity tests vs current getters." },
  { wave: "wave-1", risk: "high", complexity: "high", rollback: "Flip adapter back to localStorage; data still present client-side during dual-write window.", validation: "Row-count + spot-diff per company; shadow-read compare." },
  { wave: "wave-2", risk: "high", complexity: "high", rollback: "Fall back to client resolver over cached work orders.", validation: "Occurrence-count parity across the four scaling scenarios." },
  { wave: "wave-3", risk: "medium", complexity: "medium", rollback: "Re-enable client-side capped log read.", validation: "Event-count + newest-page parity; cursor stability." },
  { wave: "wave-4", risk: "medium", complexity: "high", rollback: "Keep base64 fallback until object-storage verified.", validation: "Byte-for-byte image checksum; signed-URL access." },
  { wave: "wave-5", risk: "low", complexity: "low", rollback: "Stores already lazy; revert to local getter.", validation: "Run/occurrence parity per company." },
  { wave: "wave-6", risk: "medium", complexity: "medium", rollback: "Disable channels + metering flags; queries unaffected.", validation: "Channel scope audit; per-company counter reconciliation." },
];
