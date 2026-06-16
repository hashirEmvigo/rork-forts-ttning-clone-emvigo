/**
 * Schedule migration CLOSURE AUDIT (P6F). Design-only.
 *
 * P6B–P6E delivered the Schedule input migration MECHANISM behind default-OFF
 * flags: an interval read switch (P6B), a true interval-scoped query (P6C), an
 * authoritative-input cut-over (P6D) and a staging soak that returned READY
 * (P6E). This file is the single typed record of the Schedule track's final
 * shape before it is considered CLOSED and before any new entity migration:
 *   • the two Schedule flags + their dependency order and rollback behaviour,
 *   • a precise input-source map for every datum the resolver consumes,
 *   • the localStorage fallback / backout path,
 *   • the shadow-validation summary + the cache behaviour,
 *   • the System Performance monitoring audit,
 *   • the verified rollback drill,
 *   • what must stay temporarily vs. what can eventually be removed,
 *   • the closure verdict + the recommended next migration entity.
 *
 * Nothing here executes. Both Schedule flags remain OFF by default, so the app
 * behaves exactly as P6E left it. {@link resolveScheduleProgram}, recurrence,
 * variation and exception LOGIC, the board, metrics, filters, cache and every
 * interaction are unchanged; there is exactly ONE resolver and no realtime.
 */

// ── Part 1 — Schedule flag audit ──────────────────────────

export type ScheduleFlagEnv = "staging-first" | "production-after-soak";

export interface ScheduleFlagAudit {
  flag: string;
  envVar: string;
  defaultValue: false;
  intendedEnv: ScheduleFlagEnv;
  /** 1-based dependency order — lower flags should be enabled first. */
  dependencyOrder: number;
  controls: string;
  rollback: string;
}

/**
 * The Schedule migration flags. Unlike Customers/Work Orders the Schedule has NO
 * writes — its only migration surface is the resolver INPUT source — so the
 * track has just two flags. The authoritative flag (P6D) folds the read path: it
 * implies the interval read even if {@link SCHEDULE_SUPABASE_INTERVAL_READ} is
 * off (see scheduleCutover.ts → shouldReadScheduleFromSupabase). Both default
 * FALSE and are independently reversible.
 */
export const SCHEDULE_FLAG_AUDIT: ReadonlyArray<ScheduleFlagAudit> = [
  {
    flag: "schedule_supabase_interval_read",
    envVar: "EXPO_PUBLIC_SCHEDULE_SUPABASE_INTERVAL_READ",
    defaultValue: false,
    intendedEnv: "staging-first",
    dependencyOrder: 1,
    controls:
      "useScheduleInputSource → the Schedule builds its ScheduleCoreInput from the Supabase interval-scoped query (P6C) instead of in-memory work orders; localStorage fallback. Read/validation only.",
    rollback: "Flag OFF → resolver input is built from localStorage. Instant, data-free.",
  },
  {
    flag: "schedule_supabase_authoritative",
    envVar: "EXPO_PUBLIC_SCHEDULE_SUPABASE_AUTHORITATIVE",
    defaultValue: false,
    intendedEnv: "production-after-soak",
    dependencyOrder: 2,
    controls:
      "Makes the P6C interval-scoped Supabase input the AUTHORITATIVE resolver input (implies the read path even if its own flag is off); localStorage stays a synchronized fallback / backout input.",
    rollback: "Flag OFF → localStorage authoritative input again; verify with compareScheduleInterval() on representative intervals.",
  },
];

// ── Part 2 — Schedule input-source map ────────────────────

export type ScheduleSourceKind =
  | "supabase-when-flagged"
  | "localStorage"
  | "lookup-constant"
  | "request-derived"
  | "tooling";

export interface ScheduleSourceRow {
  input: string;
  source: ScheduleSourceKind;
  entryPoint: string;
  note: string;
}

/**
 * Precise current source for every datum the resolver consumes.
 * "supabase-when-flagged" means localStorage today (flags OFF) and the
 * interval-scoped Supabase query once a Schedule flag / authoritative mode is on
 * — always with a localStorage fallback. Customer / employee / postal-city
 * lookups are still held constant from the local store (they migrate on their
 * own tracks). The date range + filters are request-derived and not stored.
 */
export const SCHEDULE_SOURCE_MAP: ReadonlyArray<ScheduleSourceRow> = [
  { input: "workOrders[] (live gate, companyId, customerId)", source: "supabase-when-flagged", entryPoint: "useScheduleInputSource → fetchScheduleIntervalFromSupabase", note: "Interval-scoped parent fetch (only parents owning an in-window row) when flagged; else in-memory localStorage array." },
  { input: "serviceRows[] (recurrence, dates, planned times, assignment, embedded variations)", source: "supabase-when-flagged", entryPoint: "fetchScheduleIntervalFromSupabase → work_order_service_rows", note: "Date-overlap + recurrence-scoped fetch; variations reconstructed losslessly from data jsonb. Schedule-critical." },
  { input: "occurrence exceptions[] (cancel / reschedule / time-change / staffing)", source: "supabase-when-flagged", entryPoint: "reconstructExceptionsFromSupabase → work_order_occurrence_exceptions", note: "(company_id, occurrence_date) windowed fetch with scan-widening; full data jsonb so staffing/labour overrides survive." },
  { input: "customers[] (id, name, addresses)", source: "lookup-constant", entryPoint: "AppContext in-memory customers", note: "Held constant from the local store on both resolve twins; migrates on the Customers track (already authoritative-capable)." },
  { input: "employees[] (id, name)", source: "lookup-constant", entryPoint: "AppContext in-memory employees", note: "Name lookup only; held constant until the Employees track lands." },
  { input: "postalCities[]", source: "lookup-constant", entryPoint: "AppContext reference data", note: "postalCode → city label; held constant until the reference-data track lands." },
  { input: "fromDate / toDate (+ widened scan window)", source: "request-derived", entryPoint: "Schedule view mode → range", note: "Inclusive YYYY-MM-DD bounds; scan widened exactly as resolveScheduleProgram widens it for cross-boundary reschedules." },
  { input: "filters (includeCancelled, employeeIds, statuses, serviceTypes)", source: "request-derived", entryPoint: "board filter state", note: "Carried into the cache key + the interval query; never changes the resolver logic." },
  { input: "resolver output (ScheduleEntry[])", source: "localStorage", entryPoint: "resolveScheduleProgram", note: "ONE resolver, unchanged. It runs identically over whichever input source is active." },
  { input: "shadow comparison", source: "tooling", entryPoint: "compareScheduleInterval / compareScheduleEntries", note: "Background per-occurrence diff of local vs Supabase-input resolve while flagged; keep until cleanup." },
  { input: "staging soak harness", source: "tooling", entryPoint: "runScheduleAuthoritativeSoak", note: "Repeated view-mode interval parity + fallback + rollback drills; dev/admin-only. Keep until cleanup." },
];

// ── Part 3 — localStorage fallback / backout path ─────────

export interface ScheduleFallbackRow {
  scenario: string;
  behaviour: string;
  recorded: boolean;
}

/**
 * The fallback / backout path. The Schedule has no writes, so "backout" is the
 * localStorage input itself: it is always available and is the rollback target.
 * Every Supabase-input failure falls back to it and is RECORDED (never silent)
 * via the cutover telemetry (recordScheduleInputFallback).
 */
export const SCHEDULE_FALLBACK_PATH: ReadonlyArray<ScheduleFallbackRow> = [
  { scenario: "Supabase unreachable / network timeout", behaviour: "buildScheduleInputFromSupabase throws → hook falls back to buildScheduleInputFromLocal; resolver runs on local input.", recorded: true },
  { scenario: "Supabase returns nothing for the interval", behaviour: "Empty interval treated as a build miss → localStorage input used so the board never goes blank.", recorded: true },
  { scenario: "Missing parent work order / service row / exception", behaviour: "Interval fetch incomplete → fall back to local input for the whole interval (no partial render).", recorded: true },
  { scenario: "RLS / company-scope failure", behaviour: "Scoped query rejected → fall back to local input; failure surfaced in the Source-of-Truth panel.", recorded: true },
  { scenario: "Flag OFF (rollback)", behaviour: "localStorage is the authoritative input; no Supabase read attempted.", recorded: false },
];

// ── Part 4 — Shadow validation summary ────────────────────

export interface ScheduleShadowSummaryRow {
  dimension: string;
  comparator: string;
  blocking: boolean;
}

/**
 * The dimensions the background shadow diff compares per occurrence. Reuses
 * WO-4's compareScheduleInterval / compareScheduleEntries — every dimension is
 * cut-over-blocking; any divergence feeds the critical-drift counter + notes and
 * is surfaced, never hidden. P6E's soak returned 0 critical drift across all
 * view modes.
 */
export const SCHEDULE_SHADOW_SUMMARY: ReadonlyArray<ScheduleShadowSummaryRow> = [
  { dimension: "occurrence count", comparator: "compareScheduleInterval.countMatch", blocking: true },
  { dimension: "occurrence keys (parentServiceRowId:occurrenceDate)", comparator: "missingInSupabase / extraInSupabase", blocking: true },
  { dimension: "displayDate / occurrenceDate", comparator: "ENTRY_COMPARE_FIELDS divergence", blocking: true },
  { dimension: "startTime / endTime", comparator: "ENTRY_COMPARE_FIELDS divergence", blocking: true },
  { dimension: "customerId / customerName", comparator: "ENTRY_COMPARE_FIELDS divergence", blocking: true },
  { dimension: "assignedEmployeeIds", comparator: "ENTRY_COMPARE_FIELDS divergence", blocking: true },
  { dimension: "status", comparator: "ENTRY_COMPARE_FIELDS divergence", blocking: true },
  { dimension: "isVariation / isRescheduled / isTimeChanged indicators", comparator: "ENTRY_COMPARE_FIELDS divergence", blocking: true },
];

// ── Part 5 — Cache behaviour summary ──────────────────────

export interface ScheduleCacheBehaviourRow {
  aspect: string;
  behaviour: string;
}

/**
 * Cache behaviour reuses the existing IntervalCache + buildIntervalCacheKey. The
 * key carries the active SOURCE and AUTHORITY mode so a Supabase interval can
 * never collide with a local one, and a per-interval dataToken drops only the
 * intervals whose underlying rows changed.
 */
export const SCHEDULE_CACHE_BEHAVIOUR: ReadonlyArray<ScheduleCacheBehaviourRow> = [
  { aspect: "Cache engine", behaviour: "Existing IntervalCache (intervalCache.ts) — unchanged; no new cache." },
  { aspect: "Source/authority in key", behaviour: "Key segments include the input source (local|supabase) + authority mode, so local and Supabase intervals never collide." },
  { aspect: "Scope", behaviour: "companyId is the first key segment — a company switch can never read another tenant's cached interval." },
  { aspect: "dataToken", behaviour: "Per-interval token over the fetched parents / service rows / exceptions; a row change drops only the affected interval(s)." },
  { aspect: "Invalidation", behaviour: "Reuses SCHEDULE_CACHE_INVALIDATION rules: reschedule drops neighbouring intervals; recurrence / archive (incl. WO-5.6 soft-delete) drop all intervals (ghost-occurrence guard)." },
];

// ── Part 6 — Monitoring audit ─────────────────────────────

export interface ScheduleMonitoringSignal {
  signal: string;
  shownBy: string;
  present: boolean;
}

/** What the Super Admin → System Performance Schedule panels surface. */
export const SCHEDULE_MONITORING_AUDIT: ReadonlyArray<ScheduleMonitoringSignal> = [
  { signal: "Active input source + authority mode", shownBy: "getScheduleCutoverState().inputSource / inputAuthority (Source-of-Truth panel)", present: true },
  { signal: "Interval-scoped query fetch counts + widened window", shownBy: "getScheduleCutoverState().lastIntervalQuery (P6C panel)", present: true },
  { signal: "Fallback + failure counts (drift)", shownBy: "getScheduleCutoverState().fallbacks / failures / recentFailures", present: true },
  { signal: "Shadow drift count + last mismatch", shownBy: "getScheduleCutoverState().shadowDrift / lastMismatch", present: true },
  { signal: "Staging soak verdict (READY) + per-view parity", shownBy: "runScheduleAuthoritativeSoak() (P6E panel)", present: true },
  { signal: "Rollback readiness", shownBy: "Closure panel — both flags reversible, fallback always available", present: true },
];

// ── Part 7 — Rollback drill ───────────────────────────────

export interface ScheduleRollbackStep {
  order: number;
  action: string;
  expected: string;
}

/** The verified backout sequence — flip the two flags OFF, in reverse order. */
export const SCHEDULE_ROLLBACK_DRILL: ReadonlyArray<ScheduleRollbackStep> = [
  { order: 1, action: "schedule_supabase_authoritative = OFF", expected: "localStorage is the authoritative resolver input again; Supabase read no longer primary. No data migration (Schedule has no writes)." },
  { order: 2, action: "schedule_supabase_interval_read = OFF", expected: "Resolver input is built from the in-memory localStorage work orders + exceptions." },
  { order: 3, action: "compareScheduleInterval() on representative intervals", expected: "Local-input resolve === prior output; 0 occurrence divergence — proven by the P6E soak rollback drill." },
];

// ── Part 8 — Cleanup plan ─────────────────────────────────

export interface ScheduleCleanupItem {
  item: string;
  reason: string;
}

/** Keep these in place through the next entity migrations. */
export const SCHEDULE_KEEP_TEMPORARILY: ReadonlyArray<ScheduleCleanupItem> = [
  { item: "localStorage Schedule input path (buildScheduleInputFromLocal)", reason: "The fallback / backout input and the rollback target while authority is flag-gated." },
  { item: "Shadow comparators (compareScheduleInterval / compareScheduleEntries)", reason: "Ongoing per-occurrence drift detection during the authoritative soak window." },
  { item: "Schedule soak harness (runScheduleAuthoritativeSoak)", reason: "Re-runnable parity + fallback + rollback validation." },
  { item: "Cut-over telemetry (scheduleCutover)", reason: "Surfaces fallbacks, failures, shadow drift + interval-query stats while flagged." },
];

/** Eligible for removal only AFTER Schedule runs authoritative in prod, stable. */
export const SCHEDULE_FUTURE_CLEANUP_CANDIDATES: ReadonlyArray<ScheduleCleanupItem> = [
  { item: "localStorage Schedule input source", reason: "Retire once the interval-scoped Supabase input is the proven sole source AND its lookup entities (customers/employees/postalCities) are authoritative." },
  { item: "Lookup-constant bridge (local customers/employees/postalCities)", reason: "Replace with server-side joins once those tracks are authoritative; until then it must stay." },
  { item: "Shadow comparators + soak harness", reason: "Drop once authority is long-stable and no longer needs continuous parity proof." },
  { item: "__cleanopsData dev console handles", reason: "Inspection-only; remove with the tooling they expose." },
];

// ── Part 9 — Closure verdict + next entity ────────────────

export type ScheduleClosureVerdict = "closed" | "blocked";

export interface ScheduleClosureAudit {
  verdict: ScheduleClosureVerdict;
  summary: string;
  resolverChanged: false;
  uiChanged: false;
  realtime: false;
  remainingLocalStorageIsIntentional: boolean;
  rollbackVerified: boolean;
  criticalDrift: number;
  nextEntity: string;
  nextEntityRationale: ReadonlyArray<string>;
}

/**
 * Closure verdict: the Schedule input migration is internally consistent and
 * CLOSED. Two default-OFF flags with a clear dependency order, an interval-scoped
 * Supabase input with a localStorage fallback / backout, an unchanged single
 * resolver, a clean P6E soak (0 critical drift across daily/weekly/two-week/
 * monthly), recorded fallbacks + shadow drift, source/authority-keyed caching,
 * and a verified flag-flip rollback. Every remaining localStorage dependency is
 * intentional (fallback / lookup-constant / tooling). Ready to begin the next
 * track: the remaining LOOKUP entities the Schedule still holds constant.
 */
export const SCHEDULE_CLOSURE_AUDIT: ScheduleClosureAudit = {
  verdict: "closed",
  summary:
    "Schedule input migration is fully mapped and reversible: 2 default-OFF flags (interval read → authoritative), an interval-scoped Supabase input (fetchScheduleIntervalFromSupabase) that never hydrates all work orders, ONE unchanged resolver (resolveScheduleProgram), a localStorage fallback that is always available + recorded, source/authority-keyed interval caching, background shadow diffs, and a P6E staging soak that returned READY with 0 critical drift. No Schedule UI change, no recurrence/variation/exception logic change, no realtime. No unintended live-data localStorage dependency remains.",
  resolverChanged: false,
  uiChanged: false,
  realtime: false,
  remainingLocalStorageIsIntentional: true,
  rollbackVerified: true,
  criticalDrift: 0,
  nextEntity: "Schedule lookup entities (Employees, then postal-city reference data)",
  nextEntityRationale: [
    "These are the only inputs the Schedule still holds constant from localStorage (customers are already migration-capable).",
    "Migrating them lets the interval query resolve names/labels server-side and removes the last lookup-constant bridge.",
    "They are small, low-risk reference datasets — name/label lookups only, no schedule-critical recurrence logic.",
    "Reuses the proven wave pattern: schema → repository → migration tool → shadow read → read switch → dual write → soak → cut-over → closure.",
  ],
};
