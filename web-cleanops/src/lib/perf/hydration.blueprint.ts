/**
 * Boot-time hydration elimination architecture blueprint (OP4).
 *
 * Design-only. Nothing here runs, queries, or changes behaviour. It is the
 * forward-looking architecture for CleanOps startup loading — the risk OP1/OP3
 * ranked as the true long-term scalability ceiling (ahead of Schedule resolve
 * itself) — expressed as typed, importable documentation so the future Supabase
 * migration (P4) has a concrete contract, and so the startup map / data tiers /
 * cache ownership can be reviewed and diffed alongside the code they describe.
 *
 * Current reality (audited OP4, AppContext.tsx `AppProvider`):
 *  - The provider eagerly hydrates ~36 datasets at mount via
 *    `useState(() => getX())` (lines ~1482–1561). Every getter reads the FULL,
 *    UN-scoped collection from localStorage and holds it in React state for the
 *    whole session: companies, users, roles, employees, customers, teams, areas,
 *    postalCities, employeeLanguages, modules, companyModules, moduleCategories,
 *    auditEvents, checklistTemplates, checklistAdoptions, customerProtocols,
 *    libraryRooms, libraryTasks, settingsTemplates, companySettings,
 *    serviceCategories, services, servicePackages, serviceFavorites, workOrders,
 *    workOrderSettings, timeReportSettings, durationSettings, systemSettings,
 *    serviceGlobalEntitlements, companyServiceEntitlements, serviceEntitlementLog,
 *    timeReports, bookingQueue, bookingOccurrenceExceptions, invoices.
 *  - There is NO company scoping at the storage layer for these — an admin holds
 *    every company's rows in memory; multi-tenant boot would load all tenants.
 *  - Three stores are ALREADY lazy / company-scoped and NOT hydrated in
 *    AppContext: mediaStore (getMediaAsset), protocolRunStore (getRuns(companyId)),
 *    visitOccurrenceStore (getVisitOccurrences(companyId)). These are the model
 *    the rest of the operational data should converge on.
 *  - auditEvents is the one collection with a cap (sliced to 500 on append);
 *    every other operational collection is unbounded.
 *
 * This blueprint does NOT migrate anything, does NOT rewrite AppContext, and does
 * NOT change auth, permissions, or business logic. It documents the target.
 */

// ── Part 1 — Startup hydration map ────────────────────────

/** Where a dataset currently lives / loads. */
export type HydrationSource = "localStorage" | "supabase" | "derived";

/** When the data is needed relative to boot. */
export type HydrationTiming = "startup" | "post-startup" | "on-demand";

/** Scope the data SHOULD have in a future architecture. */
export type HydrationScope = "global" | "company" | "user" | "session";

/** Future-growth pressure of the dataset. */
export type HydrationGrowth = "low" | "medium" | "high" | "critical";

/** Target data tier (see {@link DATA_TIERS}). */
export type DataTier = "A" | "B" | "C" | "D";

export interface HydrationEntry {
  /** Dataset name (matches the AppContext state field where applicable). */
  dataset: string;
  /** Today's load source. */
  source: HydrationSource;
  /** Is it loaded eagerly at provider mount today? */
  eagerToday: boolean;
  /** Future growth pressure. */
  growth: HydrationGrowth;
  /** Scope it should have post-migration. */
  targetScope: HydrationScope;
  /** Target tier — drives the future loading timing. */
  tier: DataTier;
  /** Why it is loaded / what reads it. */
  purpose: string;
}

/**
 * Complete map of what `AppProvider` pulls into memory at boot, plus the three
 * already-lazy stores for contrast. `eagerToday=true` rows are the elimination
 * targets; the `tier`/`targetScope` columns define where each should land.
 */
export const HYDRATION_MAP: ReadonlyArray<HydrationEntry> = [
  // Tier A — core session (legitimately near-startup)
  { dataset: "currentUser / session", source: "supabase", eagerToday: true, growth: "low", targetScope: "session", tier: "A", purpose: "Authenticated identity; restored from Supabase session." },
  { dataset: "companies", source: "localStorage", eagerToday: true, growth: "medium", targetScope: "global", tier: "A", purpose: "Company access list / company switcher (super-admin)." },
  { dataset: "roles", source: "localStorage", eagerToday: true, growth: "low", targetScope: "global", tier: "A", purpose: "Role definitions for permission resolution." },
  { dataset: "systemSettings", source: "localStorage", eagerToday: true, growth: "low", targetScope: "global", tier: "A", purpose: "Platform-wide configuration." },
  { dataset: "companySettings", source: "localStorage", eagerToday: true, growth: "medium", targetScope: "company", tier: "A", purpose: "Per-company configuration for the active company." },
  { dataset: "serviceGlobalEntitlements", source: "localStorage", eagerToday: true, growth: "low", targetScope: "global", tier: "A", purpose: "Entitlement baseline; gates features." },
  { dataset: "companyServiceEntitlements", source: "localStorage", eagerToday: true, growth: "medium", targetScope: "company", tier: "A", purpose: "Per-company entitlement overrides." },
  { dataset: "modules / companyModules / moduleCategories", source: "localStorage", eagerToday: true, growth: "low", targetScope: "company", tier: "A", purpose: "Feature-module enablement / navigation gating." },

  // Tier B — frequently-used summaries (load after boot / on first view)
  { dataset: "teams", source: "localStorage", eagerToday: true, growth: "medium", targetScope: "company", tier: "B", purpose: "Team grouping for schedule / assignment summaries." },
  { dataset: "areas", source: "localStorage", eagerToday: true, growth: "medium", targetScope: "company", tier: "B", purpose: "Area scoping / filters." },
  { dataset: "postalCities", source: "localStorage", eagerToday: true, growth: "medium", targetScope: "company", tier: "B", purpose: "Address city labels for lists/schedule." },
  { dataset: "employeeLanguages", source: "localStorage", eagerToday: true, growth: "low", targetScope: "company", tier: "B", purpose: "Lookup for employee language settings." },

  // Tier C — operational datasets (MUST NOT load globally at boot)
  { dataset: "customers", source: "localStorage", eagerToday: true, growth: "critical", targetScope: "company", tier: "C", purpose: "Customer list / lookups — must be paged + company-scoped." },
  { dataset: "employees", source: "localStorage", eagerToday: true, growth: "high", targetScope: "company", tier: "C", purpose: "Employee list / assignment — company-scoped." },
  { dataset: "users", source: "localStorage", eagerToday: true, growth: "high", targetScope: "company", tier: "C", purpose: "User accounts; admin views only." },
  { dataset: "workOrders", source: "localStorage", eagerToday: true, growth: "critical", targetScope: "company", tier: "C", purpose: "Source of schedule occurrences — date+company scoped query." },
  { dataset: "bookingQueue", source: "localStorage", eagerToday: true, growth: "high", targetScope: "company", tier: "C", purpose: "Booking queue — paginated server query." },
  { dataset: "bookingOccurrenceExceptions", source: "localStorage", eagerToday: true, growth: "high", targetScope: "company", tier: "C", purpose: "Reschedule/cancel overlay — interval-scoped." },
  { dataset: "timeReports", source: "localStorage", eagerToday: true, growth: "critical", targetScope: "company", tier: "C", purpose: "Time/check-out history — date-paged query." },
  { dataset: "auditEvents", source: "localStorage", eagerToday: true, growth: "critical", targetScope: "company", tier: "C", purpose: "Activity log — capped at 500 today; date-paged server query (OP2 blueprint)." },
  { dataset: "invoices", source: "localStorage", eagerToday: true, growth: "high", targetScope: "company", tier: "C", purpose: "Billing records — paged query." },
  { dataset: "customerProtocols", source: "localStorage", eagerToday: true, growth: "high", targetScope: "company", tier: "C", purpose: "Protocol assignments — load per customer/work-order." },
  { dataset: "serviceEntitlementLog", source: "localStorage", eagerToday: true, growth: "high", targetScope: "company", tier: "C", purpose: "Append-only entitlement audit — paged query." },

  // Tier C-adjacent — config-ish but grows with catalogue
  { dataset: "services / serviceCategories / servicePackages / serviceFavorites", source: "localStorage", eagerToday: true, growth: "medium", targetScope: "company", tier: "B", purpose: "Service catalogue; mostly stable, company-scoped." },
  { dataset: "checklistTemplates / checklistAdoptions", source: "localStorage", eagerToday: true, growth: "medium", targetScope: "company", tier: "B", purpose: "Protocol template library; load on protocol surfaces." },
  { dataset: "libraryRooms / libraryTasks / settingsTemplates", source: "localStorage", eagerToday: true, growth: "medium", targetScope: "company", tier: "B", purpose: "Checklist building blocks; load on settings/protocol surfaces." },
  { dataset: "workOrderSettings / timeReportSettings / durationSettings", source: "localStorage", eagerToday: true, growth: "low", targetScope: "company", tier: "B", purpose: "Operational config; small, company-scoped." },

  // Tier D — detail / already-lazy (the target model)
  { dataset: "media assets", source: "localStorage", eagerToday: false, growth: "critical", targetScope: "company", tier: "D", purpose: "Already lazy (mediaStore.getMediaAsset) — load thumbnails/detail on demand." },
  { dataset: "protocol runs", source: "localStorage", eagerToday: false, growth: "critical", targetScope: "company", tier: "D", purpose: "Already lazy (protocolRunStore.getRuns(companyId)) — load on protocol open." },
  { dataset: "visit occurrences", source: "localStorage", eagerToday: false, growth: "critical", targetScope: "company", tier: "D", purpose: "Already lazy (visitOccurrenceStore.getVisitOccurrences(companyId)) — interval/detail scoped." },
];

// ── Part 2 — Data tier classification ─────────────────────

export interface DataTierDefinition {
  tier: DataTier;
  label: string;
  loadTiming: HydrationTiming;
  rule: string;
  examples: string;
}

/**
 * The four loading tiers. A=immediate session essentials, B=summaries loaded
 * just after boot or on first view, C=operational datasets that must be
 * company- and (where relevant) date-scoped and never globally hydrated,
 * D=detail data that is always lazy. Everything currently eager in Tiers C/D is
 * an elimination target.
 */
export const DATA_TIERS: ReadonlyArray<DataTierDefinition> = [
  { tier: "A", label: "Core session data", loadTiming: "startup", rule: "May load immediately after login. Small, global/company config + identity.", examples: "user, company access, roles, permissions, entitlements, feature flags, basic company settings." },
  { tier: "B", label: "Frequently-used summaries", loadTiming: "post-startup", rule: "Load after startup or on first view of the relevant surface — never block boot.", examples: "dashboard summaries, schedule interval summary, booking counters, notifications, lookups." },
  { tier: "C", label: "Operational datasets", loadTiming: "on-demand", rule: "Must be company-scoped (and date-scoped where relevant), paged, never globally hydrated.", examples: "customers, employees, work orders, booking queue, activity log, time reports." },
  { tier: "D", label: "Detail data", loadTiming: "on-demand", rule: "Always lazy-loaded on detail open. Never part of any list/boot payload.", examples: "customer detail, protocol answers, media, activity history, notes, attachments." },
];

// ── Part 3 — Startup budgets ──────────────────────────────

export interface StartupBudget {
  phase: string;
  target: string;
  rationale: string;
}

/**
 * Target startup budgets for the future server-backed architecture. Not
 * enforced today (operational data is in-memory). They define the desired
 * post-migration envelope so boot work can be measured against a goal.
 */
export const STARTUP_BUDGETS: ReadonlyArray<StartupBudget> = [
  { phase: "Login → first authenticated paint", target: "< 500 ms", rationale: "Tier A only: session + company access + permissions + entitlements + flags." },
  { phase: "Initial application boot", target: "< 1 s", rationale: "Tier A + shell; Tier B summaries stream in after first paint." },
  { phase: "Company switch", target: "< 1 s", rationale: "Drop company-scoped caches, load Tier A/B for the new company only." },
  { phase: "Initial memory footprint", target: "Bounded, ≈ independent of total customer/work-order count", rationale: "No Tier C/D collection held globally; memory scales with the active view, not the tenant size." },
  { phase: "Tier C list first page", target: "< 400 ms (one paged, company-scoped query)", rationale: "Customers/employees/queue load a single page, not the whole table." },
];

// ── Part 4 — Context responsibility roadmap ───────────────

/** Where a dataset's ownership SHOULD move (no refactor now — roadmap only). */
export type ContextDestination =
  | "stay-global-context"
  | "scoped-provider"
  | "query-driven"
  | "route-scoped"
  | "never-global";

export interface ContextResponsibility {
  dataset: string;
  destination: ContextDestination;
  rationale: string;
}

/**
 * AppContext responsibility assessment. Today AppContext owns ~36 collections.
 * Most operational data should leave global context entirely and become
 * query-driven / route-scoped; only small session/config data legitimately
 * belongs in a global provider.
 */
export const CONTEXT_RESPONSIBILITIES: ReadonlyArray<ContextResponsibility> = [
  { dataset: "currentUser, roles, entitlements, feature flags, systemSettings", destination: "stay-global-context", rationale: "Small, session-wide, read everywhere — correct in global context." },
  { dataset: "companies, active companySettings, modules", destination: "scoped-provider", rationale: "Company-scoped session data — a CompanyProvider keyed by active company." },
  { dataset: "customers, employees, users, workOrders, bookingQueue, timeReports, invoices", destination: "query-driven", rationale: "Operational lists — fetched per view, paged, company-scoped; not held globally." },
  { dataset: "auditEvents, serviceEntitlementLog", destination: "query-driven", rationale: "Append-only logs — date-paged queries (OP2 activity-log blueprint)." },
  { dataset: "customerProtocols, checklist templates/library, service catalogue", destination: "route-scoped", rationale: "Loaded on the settings/protocol routes that use them, then cached." },
  { dataset: "media assets, protocol runs, visit occurrences", destination: "never-global", rationale: "Detail/high-volume — already lazy; must never be globally hydrated." },
];

// ── Part 5 — Future loading flows ─────────────────────────

export interface LoadingFlow {
  surface: string;
  loads: string;
  defers: string;
}

/** Recommended per-surface loading flow under the future architecture. */
export const LOADING_FLOWS: ReadonlyArray<LoadingFlow> = [
  { surface: "Startup", loads: "session, company access, permissions, entitlements, feature flags, basic company settings (Tier A).", defers: "Everything operational — no customers/employees/work orders/logs." },
  { surface: "Dashboard", loads: "Dashboard summary counters (server aggregates).", defers: "Underlying customer/work-order rows; opened on demand." },
  { surface: "Schedule", loads: "Interval-scoped occurrence summaries (one company+date query) + employee summary.", defers: "Work-order detail, customer card, protocol responses, media." },
  { surface: "Customers list", loads: "One paged, company-scoped summary query.", defers: "Customer detail, notes, media, work orders, activity — load on card open." },
  { surface: "Customer card", loads: "Customer summary first.", defers: "Detail sections (protocols, media, history) fetched per-tab on demand." },
  { surface: "Activity log", loads: "Latest page (date-desc), company-scoped.", defers: "Older pages — fetched on scroll / filter (OP2 blueprint)." },
];

// ── Part 6 — Company-scope assessment ─────────────────────

export interface CompanyScopeFinding {
  dataset: string;
  currentScope: "global (un-scoped)" | "company" | "session";
  mustNeverBeGlobal: boolean;
  note: string;
}

/**
 * Company-scope assessment of today's eagerly-loaded data. Every operational
 * dataset is currently read globally (all companies' rows) and must become
 * strictly company-scoped before multi-tenant production (Scenario D).
 */
export const COMPANY_SCOPE_FINDINGS: ReadonlyArray<CompanyScopeFinding> = [
  { dataset: "customers, employees, users", currentScope: "global (un-scoped)", mustNeverBeGlobal: true, note: "Loaded for every company; must filter `company_id = active`." },
  { dataset: "workOrders, bookingQueue, bookingOccurrenceExceptions", currentScope: "global (un-scoped)", mustNeverBeGlobal: true, note: "Schedule/booking source — company- and date-scoped queries only." },
  { dataset: "timeReports, invoices, auditEvents, serviceEntitlementLog", currentScope: "global (un-scoped)", mustNeverBeGlobal: true, note: "Append-only/high-volume — company-scoped, paged." },
  { dataset: "companySettings, companyServiceEntitlements, companyModules", currentScope: "global (un-scoped)", mustNeverBeGlobal: true, note: "Per-company config — load active company's row only." },
  { dataset: "roles, systemSettings, serviceGlobalEntitlements, modules", currentScope: "global (un-scoped)", mustNeverBeGlobal: false, note: "Legitimately global/platform config — small, may stay global." },
  { dataset: "companies", currentScope: "global (un-scoped)", mustNeverBeGlobal: false, note: "Super-admin company switcher needs the list; admins need only their own." },
];

// ── Part 7 — Cache ownership strategy ─────────────────────

export interface CacheOwner {
  cache: string;
  owner: string;
  lifetime: string;
  invalidation: string;
  persisted: boolean;
}

/**
 * Future cache ownership. Each cache has one owner, a clear lifetime and an
 * explicit invalidation trigger. Company-scoped caches must be dropped on
 * company switch; the schedule interval cache already carries `scope` in its key.
 */
export const CACHE_OWNERS: ReadonlyArray<CacheOwner> = [
  { cache: "Session cache", owner: "AuthProvider", lifetime: "Until logout / token expiry.", invalidation: "Sign-out, token refresh failure.", persisted: false },
  { cache: "Company cache", owner: "CompanyProvider", lifetime: "Until company switch.", invalidation: "Company switch, company-settings mutation.", persisted: false },
  { cache: "Lookup cache", owner: "Memoized selectors (selectors.ts)", lifetime: "Until source array reference changes.", invalidation: "referenceToken change on the source collection.", persisted: false },
  { cache: "Schedule interval cache", owner: "IntervalCache (intervalCache.ts)", lifetime: "LRU-bounded per session.", invalidation: "Per-interval dataToken (see schedule blueprint).", persisted: false },
  { cache: "Detail cache", owner: "Per detail view / future query layer", lifetime: "Short — recent records only.", invalidation: "Mutation of that record.", persisted: false },
  { cache: "Media cache", owner: "Browser / CDN + thumbnail layer", lifetime: "CDN-controlled.", invalidation: "Asset replacement.", persisted: true },
];

// ── Part 8 — Migration readiness matrix ───────────────────

export type MigrationPriority = "P4-first" | "P4-core" | "P4-later" | "P5+";

export interface MigrationReadinessRow {
  dataset: string;
  currentLoad: string;
  futureLoad: string;
  priority: MigrationPriority;
  impact: string;
}

/**
 * Migration readiness per major dataset — current vs future load behaviour,
 * migration priority and expected performance impact. Highest-impact, highest-
 * growth operational data migrates first; small global config can wait.
 */
export const MIGRATION_READINESS: ReadonlyArray<MigrationReadinessRow> = [
  { dataset: "workOrders / schedule", currentLoad: "Full table eager into memory at boot.", futureLoad: "Company + date-scoped interval query (schedule blueprint).", priority: "P4-first", impact: "Removes the largest boot payload; unblocks Scenario C/D." },
  { dataset: "customers", currentLoad: "Full table eager.", futureLoad: "Paged, company-scoped search query (P1 hygiene already in place).", priority: "P4-first", impact: "Biggest list dataset; boot memory drops sharply." },
  { dataset: "auditEvents (activity log)", currentLoad: "Full table eager (capped 500).", futureLoad: "Date-paged, company-scoped query (OP2 blueprint).", priority: "P4-core", impact: "Highest-velocity write surface; removes growth ceiling." },
  { dataset: "timeReports", currentLoad: "Full table eager.", futureLoad: "Date-paged, employee/company-scoped query.", priority: "P4-core", impact: "High-volume; scales with employees × days." },
  { dataset: "bookingQueue / exceptions", currentLoad: "Full tables eager.", futureLoad: "Paged + interval-scoped queries.", priority: "P4-core", impact: "Feeds schedule; must be scoped alongside it." },
  { dataset: "employees / users", currentLoad: "Full tables eager.", futureLoad: "Company-scoped, paged.", priority: "P4-core", impact: "Medium; needed by many surfaces, cache as Tier B/C." },
  { dataset: "media / protocol runs / visit occurrences", currentLoad: "Already lazy, company-scoped getters.", futureLoad: "Object storage + scoped queries (minimal change).", priority: "P4-later", impact: "Already correct model; lowest migration risk." },
  { dataset: "roles / systemSettings / global entitlements / modules", currentLoad: "Full (small) eager.", futureLoad: "Cached global/company config fetch.", priority: "P4-later", impact: "Small; can stay near-global with light caching." },
];

// ── Part J — Top 10 hydration risks (ranked) ──────────────

export interface HydrationRisk {
  rank: number;
  risk: string;
  /** Highest scenario where it bites. */
  bitesAt: "A" | "B" | "C" | "D";
  phase: "P4" | "P5" | "P6";
  mitigation: string;
}

/** Top hydration risks, highest first. */
export const HYDRATION_RISKS: ReadonlyArray<HydrationRisk> = [
  { rank: 1, risk: "Full un-scoped hydration of all operational tables at boot", bitesAt: "C", phase: "P4", mitigation: "Tier-C data becomes query-driven, paged, company-scoped; nothing operational loads at boot." },
  { rank: 2, risk: "No company scoping at the storage layer — admins hold every company's rows", bitesAt: "D", phase: "P4", mitigation: "Strict `company_id` filter on every operational query + company-scoped caches dropped on switch." },
  { rank: 3, risk: "workOrders fully in memory feeds the whole schedule resolver", bitesAt: "C", phase: "P4", mitigation: "Date+company interval query (schedule blueprint); never load the booking store client-side." },
  { rank: 4, risk: "customers full-table hydration grows linearly with the biggest dataset", bitesAt: "C", phase: "P4", mitigation: "Paged server search (P1 search/pagination already wired) over a server query." },
  { rank: 5, risk: "auditEvents / timeReports unbounded write-heavy growth", bitesAt: "C", phase: "P4", mitigation: "Date-paged queries + retention classes (OP2 activity-log blueprint)." },
  { rank: 6, risk: "Memory footprint scales with tenant size, not the active view", bitesAt: "C", phase: "P4", mitigation: "Hold only the active view's page; bounded caches with explicit owners." },
  { rank: 7, risk: "Multi-tenant boot cannot hold all companies simultaneously", bitesAt: "D", phase: "P4", mitigation: "CompanyProvider loads one active company; super-admin loads the list, not the data." },
  { rank: 8, risk: "AppContext as a god-provider owning ~36 collections", bitesAt: "B", phase: "P4", mitigation: "Split into Auth/Company providers + query-driven operational data; route-scope the rest." },
  { rank: 9, risk: "localStorage size/quota and parse cost at boot", bitesAt: "B", phase: "P4", mitigation: "Stop persisting operational tables client-side once server-backed; keep only session/config." },
  { rank: 10, risk: "Catalogue/config datasets re-parsed every boot even when unchanged", bitesAt: "A", phase: "P4", mitigation: "Cached config fetch with ETag/version; load on the route that needs it." },
];
