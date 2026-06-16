/**
 * Customer migration CLOSURE AUDIT (P4K). Design-only.
 *
 * Wave 1F delivered the cut-over MECHANISM behind a default-OFF flag. Before any
 * NEW entity (Work Orders / Employees) starts, this file is the single typed
 * record of the Customer migration's final shape:
 *   • the four customer flags + their dependency order and rollback behaviour,
 *   • a precise data-source map for every customer surface,
 *   • the hidden-dependency audit (every remaining localStorage getter call),
 *   • the verified rollback/backout drill,
 *   • the live-staging rollout checklist,
 *   • what must stay temporarily vs. what can eventually be removed.
 *
 * Nothing here executes. All customer flags remain OFF by default, so the app
 * behaves exactly as Wave 1F left it. This is an audit + cleanup-readiness pass.
 */

// ── Part 1 — Customer flag audit ──────────────────────────

export type FlagEnv = "staging-first" | "production-after-soak";

export interface CustomerFlagAudit {
  flag: string;
  envVar: string;
  defaultValue: false;
  intendedEnv: FlagEnv;
  /** 1-based dependency order — lower flags should be enabled first. */
  dependencyOrder: number;
  controls: string;
  rollback: string;
}

/**
 * All four customer migration flags. Defaults are FALSE; each is independently
 * reversible. The read flags are folded by the authoritative flag (it implies
 * both read paths even if their own flags are off — see customerCutover.ts).
 */
export const CUSTOMER_FLAG_AUDIT: ReadonlyArray<CustomerFlagAudit> = [
  {
    flag: "customers_list_supabase_read",
    envVar: "EXPO_PUBLIC_CUSTOMERS_LIST_SUPABASE_READ",
    defaultValue: false,
    intendedEnv: "staging-first",
    dependencyOrder: 1,
    controls: "useCustomerListSource → Customers list reads full rows from Supabase; localStorage fallback.",
    rollback: "Flag OFF → list reads localStorage. Instant, data-free.",
  },
  {
    flag: "customers_detail_supabase_read",
    envVar: "EXPO_PUBLIC_CUSTOMERS_DETAIL_SUPABASE_READ",
    defaultValue: false,
    intendedEnv: "staging-first",
    dependencyOrder: 2,
    controls: "useCustomerDetailSource → Customer Card reads detail from Supabase; localStorage fallback.",
    rollback: "Flag OFF → card reads localStorage. Instant, data-free.",
  },
  {
    flag: "customers_dual_write",
    envVar: "EXPO_PUBLIC_CUSTOMERS_DUAL_WRITE",
    defaultValue: false,
    intendedEnv: "staging-first",
    dependencyOrder: 3,
    controls: "AppContext.persistCustomers → mirrors create/update/archive to Supabase after the local write.",
    rollback: "Flag OFF → writes localStorage only. Instant, data-free.",
  },
  {
    flag: "customers_supabase_authoritative",
    envVar: "EXPO_PUBLIC_CUSTOMERS_SUPABASE_AUTHORITATIVE",
    defaultValue: false,
    intendedEnv: "production-after-soak",
    dependencyOrder: 4,
    controls: "Folds all three paths ON; Supabase becomes primary for reads + authoritative for writes; localStorage kept as synchronized backout copy.",
    rollback: "Flag OFF → localStorage authoritative again; verify with shadowReadCustomers() + verifyCustomerBackout().",
  },
];

// ── Part 2 — Customer data-source map ─────────────────────

export type DataSourceKind =
  | "supabase-when-flagged"
  | "localStorage"
  | "dual"
  | "backout-only"
  | "tooling"
  | "separate-source";

export interface CustomerDataSource {
  surface: string;
  source: DataSourceKind;
  entryPoint: string;
  note: string;
}

/**
 * Precise current source for every customer surface. "supabase-when-flagged"
 * means localStorage today (flags OFF) and Supabase once the relevant flag /
 * authoritative mode is enabled — always with a localStorage fallback.
 */
export const CUSTOMER_DATA_SOURCE_MAP: ReadonlyArray<CustomerDataSource> = [
  { surface: "Customer List read", source: "supabase-when-flagged", entryPoint: "useCustomerListSource", note: "Supabase via listFullCustomersFromSupabase when list/authoritative flag on; else localStorage." },
  { surface: "Customer Card read", source: "supabase-when-flagged", entryPoint: "useCustomerDetailSource", note: "Supabase via getDetail when detail/authoritative flag on; else localStorage." },
  { surface: "Customer create", source: "dual", entryPoint: "AppContext.persistCustomers", note: "localStorage first (backout copy), then mirrored to Supabase when dual-write/authoritative on." },
  { surface: "Customer update (contact/address/area/owner/status/prefs)", source: "dual", entryPoint: "AppContext.persistCustomers", note: "Same single write seam; all edits funnel here." },
  { surface: "Customer archive / reactivate", source: "dual", entryPoint: "AppContext.persistCustomers", note: "Status change persisted + mirrored like any other write." },
  { surface: "Customer search", source: "supabase-when-flagged", entryPoint: "Customers.tsx in-page filter / repository.search", note: "Follows the list source; search threshold semantics preserved on both sides." },
  { surface: "Customer Card tabs (bookings, work orders, activity, invoices, media, protocols, notes)", source: "separate-source", entryPoint: "their own stores", note: "Unaffected by the customer detail switch — they read work orders / activity / media etc., not CustomerDetail." },
  { surface: "Customer migration tool", source: "tooling", entryPoint: "migrateCustomers", note: "Idempotent localStorage → Supabase backfill; keep until cleanup." },
  { surface: "Customer shadow read (list + detail)", source: "tooling", entryPoint: "shadowReadCustomers / shadowReadCustomerDetail", note: "Background parity check; keep until cleanup." },
  { surface: "Customer backout export", source: "backout-only", entryPoint: "exportCustomerBackout / verifyCustomerBackout", note: "Checksummed snapshot of localStorage; rollback safety net." },
];

// ── Part 3 — Hidden dependency audit ──────────────────────

export type DependencyClass =
  | "intentional-current-path"
  | "backout-only"
  | "migration-tooling"
  | "refactor-later"
  | "potential-bug";

export interface DependencyOccurrence {
  location: string;
  symbol: string;
  classification: DependencyClass;
  note: string;
}

/**
 * Every remaining direct customer localStorage/getter dependency, classified.
 * No occurrence is an unintended live-data bug — the write seam is centralised
 * in persistCustomers and reads go through the source hooks. Cross-surface
 * `customers.find(...)` lookups read the in-memory AppContext array (already
 * fed by the source hook), so they inherit the active source for free.
 */
export const HIDDEN_DEPENDENCY_AUDIT: ReadonlyArray<DependencyOccurrence> = [
  { location: "store.ts getCustomers / saveCustomers", symbol: "getCustomers / saveCustomers", classification: "intentional-current-path", note: "The localStorage primitives; backout copy + sole source when flags OFF. Keep." },
  { location: "AppContext.persistCustomers", symbol: "getCustomers + saveCustomers", classification: "intentional-current-path", note: "The single write seam; snapshots prev then saves, then mirrors. Keep." },
  { location: "AppContext customers.find(...) (viewAs, update guards)", symbol: "customers.find", classification: "intentional-current-path", note: "Reads the in-memory AppContext array, which already follows the active list source." },
  { location: "WorkOrderDetails / BookingQueue / Profile / CleaningPreferences / Protocols", symbol: "customers.find", classification: "intentional-current-path", note: "Cross-entity label/lookup against the shared in-memory array — not a separate localStorage read." },
  { location: "customerBackout.ts", symbol: "getCustomers", classification: "backout-only", note: "Snapshot + checksum source for rollback. Keep until cleanup." },
  { location: "customerMigration.ts / customerSoak.ts", symbol: "getCustomers / saveCustomers", classification: "migration-tooling", note: "Backfill + soak harness. Keep until cleanup." },
  { location: "parity.ts / localStorageAdapters.ts", symbol: "getCustomers", classification: "migration-tooling", note: "Parity validation + the local adapter that the seam compares against. Keep." },
  { location: "*.test.ts (parity, listRead, detailRead, migration, soak, backout)", symbol: "getCustomers / saveCustomers", classification: "migration-tooling", note: "Test harness; keep while the seam exists." },
];

// ── Part 4 — Rollback / backout drill ─────────────────────

export interface RollbackDrillStep {
  order: number;
  action: string;
  expected: string;
}

/** The verified backout sequence — flip the four flags OFF, in reverse order. */
export const ROLLBACK_DRILL: ReadonlyArray<RollbackDrillStep> = [
  { order: 1, action: "customers_supabase_authoritative = OFF", expected: "localStorage authoritative again; reads/writes return to local. No data migration." },
  { order: 2, action: "customers_dual_write = OFF", expected: "Writes stop mirroring to Supabase; localStorage only." },
  { order: 3, action: "customers_detail_supabase_read = OFF", expected: "Customer Card reads localStorage." },
  { order: 4, action: "customers_list_supabase_read = OFF", expected: "Customers list reads localStorage." },
  { order: 5, action: "verifyCustomerBackout(snapshot)", expected: "Current localStorage checksum matches the pre-cut-over snapshot — no customer data loss; no UI regression; no orphan rows." },
];

// ── Part 5 — Monitoring audit ─────────────────────────────

export interface MonitoringSignal {
  signal: string;
  shownBy: string;
  present: boolean;
}

/** What the Super Admin → System Performance customer panels surface. */
export const MONITORING_AUDIT: ReadonlyArray<MonitoringSignal> = [
  { signal: "Customer source of truth (authoritative mode)", shownBy: "getCustomerCutoverState().authoritative", present: true },
  { signal: "Active flags + read source / write source", shownBy: "Source-of-Truth panel", present: true },
  { signal: "Read fallbacks + write failures (drift)", shownBy: "getCustomerCutoverState().readFallbacks / writeFailures / recentFailures", present: true },
  { signal: "Shadow-read validation state", shownBy: "shadowReadCustomers / shadowReadCustomerDetail panels", present: true },
  { signal: "Last backout snapshot (counts + checksum + time)", shownBy: "getCustomerBackoutMeta()", present: true },
  { signal: "Rollback readiness", shownBy: "Closure panel — all flags reversible, backout verified", present: true },
];

// ── Part 6 — Live-staging rollout checklist ───────────────

export interface RolloutStep {
  order: number;
  step: string;
  gate: string;
}

/** The ordered checklist for enabling Customers in live staging → production. */
export const LIVE_STAGING_CHECKLIST: ReadonlyArray<RolloutStep> = [
  { order: 1, step: "SQL migration applied", gate: "0007_customers_table.sql present in target Supabase project." },
  { order: 2, step: "Companies migrated", gate: "Company UUID map resolvable (loadCompanyUuidMap)." },
  { order: 3, step: "Customer migration executed", gate: "migrateCustomers() report: 0 failed, 0 unexpected skips." },
  { order: 4, step: "Shadow read clean", gate: "shadowReadCustomers() ok for every company; 0 critical mismatches." },
  { order: 5, step: "RLS verified", gate: "Company A cannot read Company B; super_admin reads all." },
  { order: 6, step: "Flags enabled in order", gate: "list → detail → dual-write → (after soak) authoritative." },
  { order: 7, step: "Rollback tested", gate: "Flags OFF restores localStorage; verifyCustomerBackout matches." },
  { order: 8, step: "Monitoring checked", gate: "Source-of-Truth + closure panels show expected state." },
];

// ── Part 7 — Cleanup plan ─────────────────────────────────

export interface CleanupItem {
  item: string;
  reason: string;
}

/** Keep these in place through the next few entity migrations. */
export const KEEP_TEMPORARILY: ReadonlyArray<CleanupItem> = [
  { item: "Customer migration tooling (migrateCustomers)", reason: "Re-runnable backfill + recovery for rollback." },
  { item: "Shadow-read tooling", reason: "Ongoing drift detection during the authoritative soak window." },
  { item: "localStorage backout copy + exportCustomerBackout", reason: "Instant, data-free rollback safety net." },
  { item: "Cut-over telemetry (customerCutover)", reason: "Surfaces read fallbacks + write failures while authoritative." },
];

/** Eligible for removal only AFTER Customers run authoritative in prod, stable. */
export const FUTURE_CLEANUP_CANDIDATES: ReadonlyArray<CleanupItem> = [
  { item: "localStorage customer source (getCustomers/saveCustomers reads)", reason: "Retire once Supabase is the proven sole source." },
  { item: "Dual-write mirror path", reason: "Redundant once localStorage is no longer a backout copy." },
  { item: "Backout snapshot copy", reason: "Drop once rollback to localStorage is no longer a supported option." },
  { item: "__cleanopsData dev console handles", reason: "Inspection-only; remove with the tooling they expose." },
];

// ── Part 8 — Closure verdict + next entity ────────────────

export type ClosureVerdict = "consistent" | "blocked";

export interface CustomerClosureAudit {
  verdict: ClosureVerdict;
  summary: string;
  remainingLocalStorageIsIntentional: boolean;
  rollbackVerified: boolean;
  nextEntity: string;
  nextEntityRationale: ReadonlyArray<string>;
}

/**
 * Closure verdict: the Customer migration is internally consistent. Every flag
 * is documented + default-OFF, every remaining localStorage dependency is
 * intentional (current path / backout / tooling), rollback is a verified flag
 * flip, and monitoring surfaces the live state. Ready to begin the next entity.
 */
export const CUSTOMER_CLOSURE_AUDIT: CustomerClosureAudit = {
  verdict: "consistent",
  summary:
    "Customer migration is fully mapped and reversible: 4 default-OFF flags with a clear dependency order, a single write seam (persistCustomers), source hooks for list + detail reads, a checksummed backout copy, and monitoring for authority/drift/fallbacks. No unintended live-data localStorage dependency remains.",
  remainingLocalStorageIsIntentional: true,
  rollbackVerified: true,
  nextEntity: "Work Orders",
  nextEntityRationale: [
    "Largest remaining boot-time dataset after Customers.",
    "The Schedule resolver depends on Work Orders — migrating them unblocks the schedule interval query (Wave 2).",
    "Nested service rows / variations / exceptions stay detail-only (jsonb), exactly like Customers' nested data.",
    "Reuses the proven wave pattern: schema → repository → migration tool → shadow read → read switch → dual write → soak → cut-over → closure.",
  ],
};
