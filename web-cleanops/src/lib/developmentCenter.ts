/**
 * CleanOps Development Center — internal architecture registry (v1).
 *
 * A Super Admin–only source of truth describing every CleanOps module: what
 * exists, what is built, what is still localStorage-based vs Supabase-backed,
 * and what is planned. This is NOT a customer-facing feature and NOT a task
 * manager — it is a structured technical registry.
 *
 * v1 ships as a typed, read-only seed registry. The model is deliberately
 * shaped like a backend table (stable `key`, flat status fields, `updatedAt`)
 * so it can later be moved to a Supabase `development_modules` table without
 * changing the UI — the page reads from {@link getDevelopmentModules}, which is
 * the single seam a future repository would replace.
 */

/** High-level lifecycle of a module. */
export type ModuleStatus =
  | "planned"
  | "in_progress"
  | "partial"
  | "active"
  | "built"
  | "production_ready"
  | "deprecated"
  | "blocked";

/**
 * Migration lifecycle for a module moving from localStorage to Supabase. Tracks
 * the migration's own state independently of overall release readiness — a
 * migration can be `verified` (built + audited) while still `awaiting_activation`
 * behind feature flags. `not_applicable` for modules with no migration path.
 */
export type MigrationStatus =
  | "not_started"
  | "in_progress"
  | "built"
  | "verified"
  | "activated"
  | "not_applicable";

/** Migration/backing status for Supabase-shaped fields. */
export type SupabaseStatus =
  | "not_started"
  | "in_progress"
  | "partial"
  | "complete"
  | "not_applicable";

/** Row-level security status. */
export type RlsStatus =
  | "not_started"
  | "designed"
  | "partial"
  | "complete"
  | "not_applicable";

/** Whether the module is still reading/writing localStorage. */
export type LocalStorageStatus =
  | "authoritative"
  | "dual_write"
  | "partial"
  | "removed_from_write_path"
  | "removed"
  | "not_applicable";

/** Activity-log coverage. */
export type ActivityLogStatus = "not_started" | "partial" | "complete" | "planned" | "not_applicable";

/** Permission-model coverage. */
export type PermissionStatus = "not_started" | "partial" | "complete" | "not_applicable";

/** Entitlement / package-gating coverage. */
export type EntitlementStatus =
  | "not_started"
  | "planned"
  | "partial"
  | "complete"
  | "not_applicable";

/** External-API readiness. */
export type ApiStatus = "not_started" | "planned" | "partial" | "ready" | "not_applicable";

/** AI-feature readiness. */
export type AiStatus = "not_started" | "planned" | "partial" | "ready" | "not_applicable";

/** i18n / language readiness. */
export type LanguageStatus = "not_started" | "planned" | "partial" | "ready" | "not_applicable";

/** Automated-test coverage. */
export type TestStatus = "not_started" | "partial" | "complete" | "not_applicable";

/** Overall release readiness signal. */
export type ReleaseReadiness =
  | "not_ready"
  | "in_review"
  | "awaiting_activation"
  | "verified"
  | "not_applicable";

/** Broad grouping of a module by responsibility area. */
export type ModuleCategory =
  | "Platform"
  | "Directory"
  | "Operations"
  | "Checklists"
  | "Portals"
  | "Payroll"
  | "Billing"
  | "Integrations"
  | "Intelligence"
  | "System";

/**
 * A single tracked CleanOps module. Field names map 1:1 to columns a future
 * Supabase `development_modules` table would carry.
 */
export interface DevelopmentModule {
  id: string;
  /** Stable machine key, e.g. "companies". Unique across the registry. */
  key: string;
  name: string;
  description: string;
  category: ModuleCategory;
  status: ModuleStatus;
  /** The owning surface/area, e.g. "Super Admin" or "Company Admin". */
  ownerArea: string;
  /** Keys of other modules this one depends on. */
  dependencies: string[];
  /** Human-readable related feature names. */
  relatedFeatures: string[];
  supabaseStatus: SupabaseStatus;
  localStorageStatus: LocalStorageStatus;
  rlsStatus: RlsStatus;
  permissionStatus: PermissionStatus;
  activityLogStatus: ActivityLogStatus;
  entitlementStatus: EntitlementStatus;
  apiStatus: ApiStatus;
  aiStatus: AiStatus;
  languageStatus: LanguageStatus;
  testStatus: TestStatus;
  releaseReadiness: ReleaseReadiness;
  /**
   * Optional Supabase-migration lifecycle status. Present on modules that have
   * (or will have) a localStorage→Supabase migration path; omitted for modules
   * where migration does not apply.
   */
  migrationStatus?: MigrationStatus;
  notes: string;
  updatedAt: string;
  /**
   * Optional target release/milestone for planned or in-progress modules,
   * e.g. "v1.1" or "Q3". Present mainly on roadmap items not yet implemented.
   */
  targetRelease?: string;
}

const SEED_DATE = "2026-06-02T00:00:00.000Z";

/**
 * The seeded module registry. Statuses reflect the current, honestly-assessed
 * state of each module. Keep this list the single source of truth; add new
 * modules here as they are introduced.
 */
const SEED_MODULES: ReadonlyArray<Omit<DevelopmentModule, "id">> = [
  {
    key: "auth",
    name: "Auth",
    description: "Supabase Auth sign-in, password recovery, sessions and SMTP-backed reset flow.",
    category: "Platform",
    status: "active",
    ownerArea: "Platform",
    dependencies: ["profiles"],
    relatedFeatures: ["Login", "Forgot Password", "Reset Password", "SMTP / Resend"],
    supabaseStatus: "complete",
    localStorageStatus: "not_applicable",
    rlsStatus: "not_applicable",
    permissionStatus: "complete",
    activityLogStatus: "partial",
    entitlementStatus: "not_applicable",
    apiStatus: "partial",
    aiStatus: "not_started",
    languageStatus: "planned",
    testStatus: "partial",
    releaseReadiness: "in_review",
    notes:
      "Supabase Auth + SMTP/Resend reset flow verified. admin-create-user duplicate-email guard staged but Edge Function deploy is pending.",
    updatedAt: SEED_DATE,
  },
  {
    key: "profiles",
    name: "Profiles",
    description: "Supabase profiles identity records loaded after sign-in; role and company linkage.",
    category: "Platform",
    status: "active",
    ownerArea: "Platform",
    dependencies: ["auth"],
    relatedFeatures: ["Profile record", "Role mapping", "Company linkage"],
    supabaseStatus: "complete",
    localStorageStatus: "partial",
    rlsStatus: "complete",
    permissionStatus: "complete",
    activityLogStatus: "not_started",
    entitlementStatus: "not_applicable",
    apiStatus: "not_started",
    aiStatus: "not_started",
    languageStatus: "planned",
    testStatus: "partial",
    releaseReadiness: "in_review",
    notes: "Profiles table + RLS in place; consumed by Auth on sign-in.",
    updatedAt: SEED_DATE,
  },
  {
    key: "companies",
    name: "Companies",
    description: "Organisations on the platform. Super Admin scope. Supabase-authoritative writes.",
    category: "Platform",
    status: "production_ready",
    ownerArea: "Super Admin",
    dependencies: ["auth", "profiles"],
    relatedFeatures: ["Create company", "Update company", "Company scoping"],
    supabaseStatus: "complete",
    localStorageStatus: "removed_from_write_path",
    rlsStatus: "complete",
    permissionStatus: "complete",
    activityLogStatus: "not_started",
    entitlementStatus: "partial",
    apiStatus: "not_started",
    aiStatus: "not_started",
    languageStatus: "planned",
    testStatus: "partial",
    releaseReadiness: "verified",
    notes:
      "createCompany/updateCompany write to Supabase; INSERT/UPDATE RLS verified; data persists after refresh; no ghost company on failed insert.",
    updatedAt: SEED_DATE,
  },
  {
    key: "employees",
    name: "Employees",
    description: "Internal staff members, profiles, teams and availability.",
    category: "Directory",
    status: "partial",
    ownerArea: "Company Admin",
    dependencies: ["companies", "schedule"],
    relatedFeatures: ["Employee list", "Teams", "Availability"],
    supabaseStatus: "partial",
    localStorageStatus: "dual_write",
    rlsStatus: "complete",
    permissionStatus: "complete",
    activityLogStatus: "partial",
    entitlementStatus: "not_applicable",
    apiStatus: "not_started",
    aiStatus: "not_started",
    languageStatus: "planned",
    testStatus: "partial",
    releaseReadiness: "in_review",
    migrationStatus: "activated",
    notes:
      "Directory READ is Supabase-authoritative (P-cutover · B-area 3): EMPLOYEES_SUPABASE_READ resolves ON in real app builds, so the directory reconciles full employee records from Supabase (table 0010) with localStorage kept as the synchronized backout seed (zero-flash, unsafe-empty keeps the seed). Login identity already flows through the global Supabase profiles roster. EMP-4 (Employee Supabase Write Mirror) is now BUILT and additive: mirrorEmployeeWrites mirrors every create/update/archive/delete into Supabase (idempotent upsert on legacy_id, soft-delete removal propagation, post-write field validation, optional deep shadow validation) from persistEmployees. Write mirror + deep shadow validation are gated by EMPLOYEES_DUAL_WRITE + EMPLOYEES_SHADOW_VALIDATE, both default OFF in committed code; localStorage stays the authoritative write target (no EMPLOYEE authoritative-write flag). readStatus: not_authoritative-for-writes; writeMirror: implemented; shadowValidation: implemented; releaseReadiness: awaiting_validation. ACTION REQUIRED before relying on Supabase reads: run migrateEmployees backfill per company, then enable EMPLOYEES_DUAL_WRITE, then EMPLOYEES_SHADOW_VALIDATE, and watch drift = 0. Rollback is a single env flip (=false). OPERATIONAL SURFACE: the EMP-4 backfill/validation can now be executed + observed from the DEPLOYED dev/demo environment via the Super Admin-only Employee Supabase Migration page (/employee-migration) — preflight inspection, dry-run, per-company backfill, shadow validation, flag + write-mirror/read telemetry, and a sanitized PII-free diagnostic export. It performs only the safe non-destructive helpers; it never toggles flags, edits rows, or shows employee PII. This replaces the local bun-run-dev console for the rollout.",
    updatedAt: "2026-06-06T12:00:00.000Z",
  },
  {
    key: "customers",
    name: "Customers",
    description: "Customer cards: identity, addresses, contacts and scheduling preferences.",
    category: "Directory",
    status: "active",
    ownerArea: "Company Admin",
    dependencies: ["companies"],
    relatedFeatures: ["Customer Card", "Addresses", "Cleaning preferences", "Portal logins"],
    supabaseStatus: "complete",
    localStorageStatus: "dual_write",
    rlsStatus: "complete",
    permissionStatus: "complete",
    activityLogStatus: "partial",
    entitlementStatus: "not_applicable",
    apiStatus: "not_started",
    aiStatus: "not_started",
    languageStatus: "planned",
    testStatus: "complete",
    releaseReadiness: "verified",
    migrationStatus: "activated",
    notes:
      "Supabase-authoritative (P-cutover · B-area 1). CUSTOMERS_SUPABASE_AUTHORITATIVE resolves ON in real app builds: the list + Customer Card read from Supabase as primary; every create/update/archive writes localStorage first (synchronized backout copy, strategy B) then mirrors to the authoritative Supabase table. Reads fall back to the backout copy on error/empty and every fallback is recorded + surfaced (never silent). Rollback is a single env flip (=false). SOFT-DELETE + DELETE DIVERGENCE FIX (now complete): migration 0033 adds customers.deleted_at + idx_customers_active; mirrorCustomerWrites propagates removals as company-scoped soft-delete (deleted_at = now(), idempotent, never throws into the UI); list/detail/summary Supabase reads exclude deleted_at rows; toCustomerUpsertRow writes deleted_at: null so re-create/reactivate clears the tombstone; archive stays a status/archivedAt update (NOT a delete). CREATE/DELETE UI RACE FIX (now complete): useCustomerListSource appends local-only newly-created rows during the mirror window (create-race guard, no duplicates) and subtracts a session-scoped customerDeleteTombstones set so a deleted customer disappears immediately without reload; tombstones are NOT persisted and clear only after a fresh Supabase read confirms the id is no longer returned (confirm-by-read via a reconcile signal), with a bounded max-age fallback — clearing on mere mirror-resolve was too early. TEST RESIDUE CLEANUP: the four pre-0033 'Test kund mission log' rows were soft-deleted via deleted_at (scoped, no hard delete). No customer flags changed; CUSTOMERS_SUPABASE_AUTHORITATIVE unchanged. Governed by docs/architecture/02-data-authority-and-test-data-policy.md. REMAINING: a Super Admin Customer Migration/Readiness surface (extraInSupabase / stale-deleted detection + controlled soft-delete-extras) is recommended but NOT yet built. Tests green across customerDualWrite / customerMigration / customerDeleteTombstones / use-customer-list-source suites.",
    updatedAt: "2026-06-08T12:00:00.000Z",
  },
  {
    key: "work_orders",
    name: "Work Orders",
    description: "Work orders containing services, assignments and execution.",
    category: "Operations",
    status: "active",
    ownerArea: "Company Admin",
    dependencies: ["customers", "schedule", "services"],
    relatedFeatures: ["Service rows", "Variations", "Exceptions", "Assignments"],
    supabaseStatus: "complete",
    localStorageStatus: "dual_write",
    rlsStatus: "complete",
    permissionStatus: "complete",
    activityLogStatus: "partial",
    entitlementStatus: "not_applicable",
    apiStatus: "not_started",
    aiStatus: "not_started",
    languageStatus: "planned",
    testStatus: "complete",
    releaseReadiness: "verified",
    migrationStatus: "activated",
    notes:
      "Supabase-authoritative (P-cutover · B-area 2). WORK_ORDERS_SUPABASE_AUTHORITATIVE resolves ON in real app builds: the WO list + WorkOrderDetails read from Supabase as primary (parent + service rows + the separate occurrence exceptions); every write completes against localStorage first (synchronized backout copy, strategy B) then mirrors to Supabase, incl. WO-5.6 soft-delete removal propagation. Reads fall back to the backout copy on error/empty and every fallback is recorded + surfaced. Rollback is a single env flip (=false). 68 tests green across 10 files. DETAIL MIRROR-WINDOW CONSISTENCY FIX (now complete): a shared detail mirror-window resolver (src/lib/data/detailMirrorWindow.ts) now bridges the gap between a local-first write and the async Supabase mirror/remote read so newly added/updated/deleted child rows are reflected immediately without a refresh. WorkOrderDetails / service rows (use-work-order-detail-source) use the shared bridge so an added or deleted service row appears/disappears instantly; the Customer detail panels were hardened against the same stale-remote race via the same shared resolver; the Work Order list (use-work-order-list-source) gained an optimistic create-append so a newly created WO shows immediately. This is a consistency/readiness improvement for Supabase-authoritative read surfaces only — NO flags, migrations, backfill, or Mission Log rollout status changed; Supabase remains the target authority per docs/architecture/02-data-authority-and-test-data-policy.md. READ-vs-ACTION SEAM CONSISTENCY FIX (now complete): the authoritative read surfaces could resolve a record (customer / work order) that exists ONLY in Supabase while every AppContext action/access seam still gated on and mutated the in-memory localStorage arrays — so a Supabase-only record rendered fine but actions failed (“Work order not found” on checkout / update / delete service row; “You do not have permission” on Create Work Order from the Customer Card because canAccessCustomer couldn’t see the Supabase-only customer). Two READ-side hydration bridges now back-fill the resolved remote record into local state: hydrateCustomerFromRemote (CustomerCard) and hydrateWorkOrderFromRemote (WorkOrderDetails), both via the pure reconcileHydratedRecord helper (src/lib/data/remoteRecordHydration.ts) — adds when missing, refreshes only when remote is strictly newer, never duplicates, never clobbers newer local, never mirrors back (the record already lives in Supabase); company scoping stays enforced by the company-scoped detail read. Separately, the Settings→Services catalog now merges instead of blindly replacing: mergeServiceDirectory (src/lib/data/serviceDirectoryMerge.ts) keeps the remote catalog authoritative but preserves a just-created/edited local service inside a 10-minute mirror window so it is not lost while its mirror commits (and does not resurrect a service deleted on another client). This unblocked Mission Log checkout validation, which was failing because the validator could not reliably open / act on the work order. NO Mission Log flags changed; NO migrations or backfill performed; consistency/readiness fix only.",
    updatedAt: "2026-06-05T15:30:00.000Z",
  },
  {
    key: "booking_queue",
    name: "Booking Lists",
    description: "Generated booking lists awaiting scheduling and assignment.",
    category: "Operations",
    status: "active",
    ownerArea: "Company Admin",
    dependencies: ["customers", "schedule"],
    relatedFeatures: ["Queue filters", "Assignment", "Status badges"],
    supabaseStatus: "complete",
    localStorageStatus: "dual_write",
    rlsStatus: "complete",
    permissionStatus: "complete",
    activityLogStatus: "not_started",
    entitlementStatus: "not_applicable",
    apiStatus: "not_started",
    aiStatus: "not_started",
    languageStatus: "planned",
    testStatus: "complete",
    releaseReadiness: "verified",
    migrationStatus: "activated",
    notes: "Supabase-authoritative (BQ wave). booking_queue table (0025), company-scoped RLS, repository, read seam, dual-write + shadow validation built and flipped; localStorage kept as the synchronized backout copy (strategy B). Planning/operational queue ONLY — explicitly NOT a payroll/billing structure (Time Reports / Invoices / Payroll Basis stay paused). Rollback is a single env flip (=false).",
    updatedAt: "2026-06-05T12:00:00.000Z",
  },
  {
    key: "schedule",
    name: "Schedule",
    description: "Planning calendar of customer bookings and recurring visits; highest growth risk.",
    category: "Operations",
    status: "active",
    ownerArea: "Company Admin",
    dependencies: ["customers", "employees", "work_orders"],
    relatedFeatures: ["Recurrence", "Occurrence exceptions", "Schedule Lab"],
    supabaseStatus: "complete",
    localStorageStatus: "dual_write",
    rlsStatus: "complete",
    permissionStatus: "complete",
    activityLogStatus: "partial",
    entitlementStatus: "not_applicable",
    apiStatus: "not_started",
    aiStatus: "planned",
    languageStatus: "planned",
    testStatus: "complete",
    releaseReadiness: "verified",
    migrationStatus: "activated",
    notes:
      "Supabase-authoritative INPUT (P-cutover · B-area 2). SCHEDULE_SUPABASE_AUTHORITATIVE resolves ON in real app builds: the board derives its occurrences from the Supabase-backed work orders + base occurrence exceptions (the same authoritative source as the Work Order surfaces) via the interval-scoped read path. The single resolver (resolveScheduleProgram), recurrence, variation and exception LOGIC are unchanged; there is no new engine and no realtime. localStorage stays the synchronized fallback/backout input; on a Supabase error/empty the board transparently falls back and the fallback is recorded + surfaced. Rollback is a single env flip (=false). 17 tests green across 4 files.",
    updatedAt: "2026-06-05T12:00:00.000Z",
  },
  {
    key: "mission_log",
    name: "Mission Log",
    description:
      "Operational execution ledger (what actually happened): planned-vs-actual mission times, per-employee check-in/out sessions, GPS/QR verification, delay projection, mission events and booked-time rating. Separate from Time Reporting. The legacy Missions / Visit Occurrences anchor remains underneath.",
    category: "Operations",
    status: "active",
    ownerArea: "Employee",
    dependencies: ["work_orders", "schedule"],
    relatedFeatures: [
      "MissionLogEntry",
      "MissionStaffSession",
      "MissionLogEvent",
      "Booked-time rating",
      "Delay projection",
      "Execution records",
    ],
    supabaseStatus: "partial",
    localStorageStatus: "dual_write",
    rlsStatus: "complete",
    permissionStatus: "partial",
    activityLogStatus: "not_started",
    entitlementStatus: "partial",
    apiStatus: "partial",
    aiStatus: "not_started",
    languageStatus: "planned",
    testStatus: "partial",
    releaseReadiness: "in_review",
    migrationStatus: "activated",
    notes:
      "DUAL-WRITE CONTROLLED CHECKOUT VALIDATION PASSED (latest): the Slice 2c-1 Mission Log checkout dual-write is now validated live in the deployed dev/demo build. Migration 0031 applied + verified (4 tables / 3 deleted_at / 0 events-mutable / 4 RLS / 0 event update-delete policies / 3 mutable update triggers). EXPO_PUBLIC_MISSION_LOG_DUAL_WRITE=true is confirmed ACTIVE in the deployed bundle (an earlier zero-row result was a stale pre-flag bundle, fixed by rebuild/redeploy). A read-only Mission Log Dual-Write Diagnostics panel was added to Development Center (super_admin, directly above the System Timeline) surfacing the effective flag + sanitized cut-over telemetry. VALIDATION: two checkouts on the SAME service-row mission context (180/184 then 60/60) produced mission_log_entries=1, mission_staff_sessions=2, mission_log_events=2 (distinct idempotency_keys checked_out:trep_ggllcen3rm + checked_out:trep_6c3v9oixdv, both employee_checked_out / actor employee / same mission_log_entry_legacy_id), mission_booked_time_ratings=0 — CONFIRMED CORRECT: one mission entry per work-order/service-row context (UPSERT converges), one staff session per checkout/time report (OPTION B distinct id), one immutable event per checkout/time report (distinct idempotency_key → no false duplicate, no event mutation), zero booked-time ratings as designed (dual-write never writes that table). FLAGS UNCHANGED: MISSION_LOG_SUPABASE_READ=false, MISSION_LOG_SUPABASE_AUTHORITATIVE=false, TIME_REPORTING_SHADOW_VALIDATE=false. NO Mission Log UI / read cut-over / Supabase-authoritative status started; NO migrations or backfill in this step — status/diagnostics only. NEXT SAFE STEP: pause here as validated dual-write, or enable TIME_REPORTING_SHADOW_VALIDATE later as the next gated step per the rollout runbook; reads/authoritative mode remain out of scope. " +
      "The execution ANCHOR — Missions / Visit Occurrences (CustomerProtocol → VisitOccurrence → ProtocolRun) — is Supabase-authoritative (MISSION wave). visit_occurrences table (0021), company-scoped RLS, repository, read seam + the standalone store firing its own dual-write mirror, all flipped; localStorage kept as the synchronized backout copy (strategy B). REMAINING localStorage dependency: ProtocolRun execution snapshots (protocolRuns / RunSections / RunItems) are not yet migrated. " +
      "OPERATIONAL EXECUTION Phase 1 (foundation only): the Mission Log architecture is now registered as the `mission_log` entitlement feature key in the bundle-first registry, with TYPE foundations (src/types/missionLog.ts: MissionStatus / DelayStatus / MissionLogEntry / MissionStaffSession / MissionLogEvent / MissionBookedTimeRating), a pure delay-projection helper (src/lib/domain/missionDelay.ts) and a read-only repository INTERFACE (src/lib/data/missionLogRepository.ts). NO SQL, no Supabase adapter, no UI, no routes, no behaviour flip — Supabase-first intended for the build phase. Mission Log never mutates Schedule, payroll, invoices or the time bank. " +
      "PHASE 2a-1 (Mission Log SCHEMA FOUNDATION only): migration 0031_mission_log_tables.sql adds the four execution-ledger tables — mission_log_entries (flat company scope + booking / booking-occurrence / work-order / FLAT nullable service-row / customer SOFT legacy-id references — NO forward time_report link, Time Reporting will own that link back later — plus scheduled-time / mission_status / delay_status / requires_admin_review summary columns + lossless data jsonb), mission_staff_sessions (per-employee check-in/out: status / check method / actual times flat + data jsonb), mission_log_events (IMMUTABLE append-only: INSERT-only RLS, no UPDATE/DELETE, occurred_at / created_at / idempotency_key / schema_version) and mission_booked_time_ratings (per staff session, rating CHECK between 0 and 10). All cross-entity refs are legacy-id text (never FKs) so the migration is empty-Supabase-safe; legacy_id is the idempotent upsert key; entries/sessions/ratings use the WO-5.6 deleted_at soft-delete. Company-scoped RLS (own-company + super_admin) on every table; review/service-row/occurrence indexes for high-volume queues. Mission Log feature flags (MISSION_LOG_SUPABASE_READ / _DUAL_WRITE / _SUPABASE_AUTHORITATIVE) added DEFAULT OFF (envFlag, NOT the cutover resolver). NO repository, adapter, read seam, dual-write, UI, routes or behaviour flip yet — schema only. Mission Log stays execution-ledger only: it does not mutate Schedule, approve Time Reporting, create payroll/invoice basis, touch the time bank, send notifications or infer AI decisions. " +
      "SLICE 2b-1 (Mission Log READ ADAPTER only): added src/lib/data/supabaseMissionLogRepository.ts — the first read implementation of the MissionLogRepository contract against the 0031 tables (listSummaries / getDetail / search / count). Filtering + pagination are SERVER-SIDE (eq/in/gte/lte/or ilike + range + count:exact) so rows are never fully loaded and sliced in memory; summaries are lightweight (flat columns + the entry data jsonb, NOT sessions or events), staff sessions + the IMMUTABLE event stream (ordered occurred_at asc) load ONLY in getDetail, soft-deleted rows are excluded by default, and a serviceRowLegacyId filter param was added to MissionLogListParams for later delete-guard / cut-over parity. Empty Supabase is valid: empty list / null detail, NO fallback to localStorage, NO seed, NO unsafe-empty. The adapter is DORMANT — not wired into AppContext, any page, route or dual-write; shouldReadMissionLogFromSupabase() exposes the default-OFF MISSION_LOG_SUPABASE_READ gate for a future consumer (NOT the cut-over resolver). 20 fixture tests cover empty Supabase, summaries, detail sessions/events, search, count, date/status/delay/requires-review/serviceRow filters, pagination, soft-delete exclusion and company-scope isolation. apiStatus raised not_started→partial. No Time Reporting / SavedReviewQueue repository, no checkout cut-over, no Schedule / payroll / invoice / time-bank writes. " +
      "SLICE 2c-1 (Mission Log checkout DUAL-WRITE foundation only, flag OFF): added missionLogMigration.ts (pure deterministic-id derivation + to*UpsertRow / to*InsertRow mappers), missionLogDualWrite.ts (mirrorMissionLogCheckout) and missionLogCutover.ts (shouldMirrorMissionLogCheckout gate + sanitized telemetry: attempted / succeeded / failed / skippedMissingCompany / lastError / recentFailures). A fire-and-forget mirror is attached in AppContext.submitTimeReportCheckout immediately AFTER persistTimeReports, gated by MISSION_LOG_DUAL_WRITE (DEFAULT OFF, NOT cutoverFlag). The legacy localStorage checkout stays AUTHORITATIVE — it has already succeeded before the mirror runs, the mirror never throws, and a Supabase failure is recorded in cut-over state and never surfaced (no user-facing error). Writes ONLY three tables: mission_log_entries (UPSERT, one mission/service-row context, FLAT service_row_legacy_id for delete-guard parity, mission_status=completed, delay_status derived from actual-vs-scheduled minutes, requires_admin_review mirrors non-auto-approval), mission_staff_sessions (UPSERT, status=checked_out / check_out_method=manual / check_in_method=missing / actual_check_out_time=submittedAt — NO fabricated GPS/QR/check-in) and mission_log_events (IMMUTABLE employee_checked_out insert via upsert ignoreDuplicates on legacy_id). IDEMPOTENCY: entry id mission:{workOrderId}:{serviceRowId|wo}; staff-session id OPTION B session:{entryId}:{employeeId}:{legacyReportId} (a second checkout by the same employee for the same mission is a DISTINCT session, never merged; a retried checkout converges); event idempotency_key checked_out:{legacyReportId} cannot drift on retry. Missing company UUID mapping is SKIPPED + surfaced, writing nothing. NOT WRITTEN: mission_booked_time_ratings, any Time Reporting table, payroll/invoice basis, time bank, notifications, AI. 12 fixture tests (missionLogDualWrite.test.ts) cover gate-OFF, deterministic ids, success, idempotent retry (no duplicate entries/events), Option-B distinct sessions, failure-without-throw, partial-then-retry convergence, not-configured, missing-company skip, flat service_row_legacy_id and the strict three-table boundary. localStorageStatus stays dual_write. NO Time Reporting dual-write, parity comparator, read cut-over, UI, routes, AppContext read change, TimeReportStatusBadge or service-row delete-guard changes.",
    updatedAt: "2026-06-11T09:00:00.000Z",
  },
  {
    key: "time_reporting",
    name: "Time Reporting",
    description:
      "Standalone approval, adjustment and time-classification workspace (separate page from Mission Log), optimised for high-volume exception-based review: saved review queues, advanced filters, bulk actions, inline editing, and flag triage tracked separately from approval. Consumes Mission Log execution data.",
    category: "Operations",
    status: "planned",
    ownerArea: "Company Admin",
    dependencies: ["mission_log", "work_orders", "customers", "employees"],
    relatedFeatures: [
      "TimeReport (authoritative)",
      "TimeAllocation",
      "TimeDeviationReasonCode",
      "Payroll/Invoice readiness (separate)",
      "SavedReviewQueue",
      "FlagResolutionStatus",
      "AiReviewRecommendation",
    ],
    supabaseStatus: "partial",
    localStorageStatus: "not_applicable",
    rlsStatus: "complete",
    permissionStatus: "not_started",
    activityLogStatus: "planned",
    entitlementStatus: "partial",
    apiStatus: "partial",
    aiStatus: "planned",
    languageStatus: "planned",
    testStatus: "partial",
    releaseReadiness: "not_ready",
    migrationStatus: "in_progress",
    notes:
      "OPERATIONAL EXECUTION Phase 1 (foundation only). Registered as the `time_reporting` entitlement feature key (bundle-first registry). TYPE foundations (src/types/timeReporting.ts): the NEW authoritative TimeReport model + TimeReportStatus / PayrollApprovalStatus / InvoiceBasisStatus (payroll and invoice kept independent), TimeAllocation, TimeDeviationReasonCode, TimeReportMessage, TimeReportingSettings, and the review/triage concepts FlagResolutionStatus, AiReviewRecommendation, SavedFilter and SavedReviewQueue. Pure helpers (src/lib/domain/timeReportingReview.ts: flag-actionable/resolved classifiers + AI-recommendation priority/bulk-candidate helpers — AI NEVER makes a final decision) and read-only repository INTERFACES (src/lib/data/timeReportingRepository.ts). " +
      "PHASE 2a-2 (Time Reporting SCHEMA FOUNDATION only): migration 0032_time_reporting_tables.sql adds nine tables — time_reports (flat company scope + SOFT legacy-id refs: mission_log_entry_legacy_id NULLABLE-but-indexed [adjustment #1] as the future link BACK to Mission Log, mission_staff_session / booking / booking-occurrence / work-order / FLAT nullable service-row [adjustment: delete-guard/cut-over parity] / customer / employee, name snapshots, scheduled/actual/deviation minutes, status, INDEPENDENT payroll_approval_status + invoice_basis_status, requires_admin_review, a DENORMALISED flag_resolution_status SUMMARY kept SEPARATE from approval, nullable ai_recommendation advisory-only, submitted_at + lossless data jsonb), time_allocations (classified minute slices with is_payroll/invoice/billable relevance flags), time_deviation_reason_codes (company config), time_report_events (IMMUTABLE append-only), time_report_flags (resolution_status lifecycle SEPARATE from approval), time_report_flag_events (IMMUTABLE append-only resolution history), time_report_messages (APPEND-ONLY [adjustment #2] — future status metadata via data jsonb, no UPDATE/DELETE), saved_filters + saved_review_queues (simple non-behavioural storage). All cross-entity refs are legacy-id text (never FKs) so the migration is empty-Supabase-safe; legacy_id is the idempotent upsert key; mutable tables use the WO-5.6 deleted_at soft-delete; event/history tables are INSERT-only. Company-scoped RLS (own-company + super_admin) on every table; high-volume review-queue indexes (status / submitted / requires_admin_review / employee / customer / service_row / mission_entry / payroll / invoice / flag_resolution). Time Reporting flags (TIME_REPORTING_SUPABASE_READ / _DUAL_WRITE / _SUPABASE_AUTHORITATIVE) added DEFAULT OFF (envFlag, NOT the cutover resolver). NO repository, adapter, read seam, dual-write, checkout cut-over, UI, routes, bulk mutations, notifications or AI inference yet — schema only. Time Reporting never writes payroll/invoice basis or touches the time bank; AI only advises. " +
      "SLICE 2b-2 (Time Reporting READ ADAPTER only): added src/lib/data/supabaseTimeReportingRepository.ts — the first read implementation of the TimeReportingRepository contract against the 0032 tables (listSummaries / getDetail / search / count). Filtering + pagination are SERVER-SIDE (eq/in/gte/lte/or ilike + range + count:exact) so rows are never fully loaded and sliced in memory; summaries are lightweight (flat columns + the report data jsonb, NOT allocations / flags / messages / events), and getDetail is the ONLY path that loads the non-deleted allocations + flags plus the IMMUTABLE message / event / flag-event streams (ordered created_at/occurred_at asc, legacy_id tiebreak). Approval status, payroll approval status, invoice basis status and flag-resolution status are read INDEPENDENTLY. Filters: submitted date range, status, payroll status, invoice status, flag-resolution status, AI recommendation (advisory), requires-admin-review, employee, customer, and (refined onto TimeReportListParams) serviceRowLegacyId + missionLogEntryLegacyId, plus min/max ABSOLUTE deviation thresholds. Refined the read models in timeReportingRepository.ts: TimeReportDetail now extends TimeReport with allocations / flags / messages / events / flagEvents (+ TimeReportFlagRecord / TimeReportEventRecord / TimeReportFlagEventRecord read shapes). Empty Supabase is valid: empty list / null detail, NO fallback to localStorage, NO seed, NO unsafe-empty. The adapter is DORMANT — not wired into AppContext, any page, route or dual-write; shouldReadTimeReportingFromSupabase() exposes the default-OFF TIME_REPORTING_SUPABASE_READ gate for a future consumer (NOT the cut-over resolver). 31 fixture tests cover empty Supabase, summaries, detail children + ordering, search, count, every status/flag/AI/employee/customer/serviceRow/missionEntry/deviation filter, pagination, soft-delete exclusion and company-scope isolation. apiStatus raised not_started→partial. No SavedReviewQueue repository, no checkout cut-over, no bulk mutations, no Schedule / payroll / invoice / time-bank writes. " +
      "SLICE 2b-3 (Saved Review Queue READ ADAPTER only): added src/lib/data/supabaseSavedReviewQueueRepository.ts — the read implementation of the SavedReviewQueueRepository contract (list / getById / count) against the 0032 saved_review_queues (+ linked saved_filters) tables. Company-scoped first; soft-deleted rows excluded by default; filtering + pagination are SERVER-SIDE (eq/or ilike + range + count:exact) so rows are never fully loaded and sliced in memory; queue rows stay lightweight (flat columns + the lossless queue data jsonb that already embeds its filter); deterministic ordering (sort_order asc, legacy_id tiebreak). Shared and private queues are both returned with the `shared` flag mapped. The saved filter criteria stay in data jsonb — getById hydrates the filter from the linked saved_filters row ONLY when the queue does not already embed it (read-only link mapping, NO evaluation/execution, NO membership computed), falling back to an empty filter when the linked filter is missing/soft-deleted. Empty Supabase is valid: empty list / null getById, NO fallback to localStorage, NO seed, NO unsafe-empty. The adapter is DORMANT — not wired into AppContext, any page, route or mutation; shouldReadSavedReviewQueuesFromSupabase() exposes the default-OFF TIME_REPORTING_SUPABASE_READ gate for a future consumer (NOT the cut-over resolver). 17 fixture tests cover empty Supabase, queue mapping, shared/private handling, ordering, saved-filter link hydration + fallback, count, pagination, soft-delete exclusion, company-scope isolation and search. No create/update/delete queue behaviour, no bulk actions, no checkout cut-over, no Schedule / payroll / invoice / time-bank writes. " +
      "SLICE 2c-2a (Time Reporting checkout DUAL-WRITE CORE only): added src/lib/data/timeReportingMigration.ts (pure deterministic-id derivation + to*UpsertRow / to*InsertRow mappers), timeReportingDualWrite.ts (mirrorTimeReportingCheckout) and timeReportingCutover.ts (shouldMirrorTimeReportingCheckout gate + sanitized dual-write telemetry). ATTACHMENT POINT: AppContext.submitTimeReportCheckout, immediately AFTER the Slice 2c-1 Mission Log mirror — `if (shouldMirrorTimeReportingCheckout()) void mirrorTimeReportingCheckout(report, { customerId: order.customerId })`, gated by TIME_REPORTING_DUAL_WRITE (DEFAULT OFF, NOT cutoverFlag). The legacy localStorage checkout stays AUTHORITATIVE: it has already succeeded before the mirror runs, the mirror is fire-and-forget and never throws, and a Supabase failure is recorded in the cut-over state and never surfaced (no user-facing error). TABLES WRITTEN (CORE only): time_reports (UPSERT, one authoritative report per checkout — flat company_id UUID + company_legacy_id, mission_log_entry_legacy_id + mission_staff_session_legacy_id computed via the SAME Slice 2c-1 keys EVEN WHEN Mission Log dual-write is off, soft booking/occurrence/work-order legacy ids, FLAT nullable service_row_legacy_id for delete-guard parity, customer/employee legacy ids + name snapshots, scheduled/actual/deviation minutes, status mapped auto_approved→auto_approved / pending_admin_approval→admin_review_required, requires_admin_review, payroll_approval_status=not_ready + invoice_basis_status=not_ready INDEPENDENT, flag_resolution_status NULL + ai_recommendation NULL, submitted_at, lossless data jsonb with new-model snapshot + legacy report), time_allocations (UPSERT — scheduled_billable ALWAYS written even at 0 minutes; extra_billable only when billableDeviationMinutes>0; internal_non_billable only when internalDeviationMinutes>0; zero-minute deviation slices skipped; is_payroll/invoice/billable relevance flags CLASSIFY time only, never write payroll/invoice basis) and time_report_events (IMMUTABLE time_report_submitted INSERT via upsert ignoreDuplicates on legacy_id — never duplicates, never mutates). IDEMPOTENCY: report id `treport:{reportId}`; allocations `alloc:{reportId}:{scheduled|billable_deviation|internal_deviation}`; event legacy_id `tr_event:{reportId}:submitted` + idempotency_key `time_report_submitted:{reportId}` (pure functions of the legacy report id → retries converge, never duplicate; partial success then retry converges). Missing company UUID mapping → recorded skip, no write, no throw. NOT WRITTEN in 2c-2a: time_report_flags, time_report_flag_events, time_report_messages (Slice 2c-2b), and never payroll/invoice basis, time-bank, notifications or AI inference. 17 fixture tests (timeReportingDualWrite.test.ts) cover gate-OFF no-write, deterministic ids, status mapping, report+allocations+event write, mission-log soft links, scheduled-always / zero-deviation-skip / internal classification, idempotent retry, report failure + partial-then-retry convergence, not-configured + missing-company skip, company-scope isolation and the strict CORE write boundary. DORMANT: TIME_REPORTING_DUAL_WRITE default OFF, no read switch, no live UI consumer, no AppContext read behaviour change, legacy TimeReport read/barrel untouched, no parity comparator, shadow read or read cut-over. " +
      "SLICE 2c-2b (Time Reporting checkout DUAL-WRITE flag + message): EXTENDED the SAME dual-write path (timeReportingMigration.ts + timeReportingDualWrite.ts) with the optional review surface — NO competing path, the 2c-2a CORE writes (time_reports / time_allocations / time_report_events) are unchanged. ADDED conditional writes AFTER the submitted event: time_report_flags (ONE `deviation_review` flag, written ONLY when the checkout requires admin review [approvalStatus !== auto_approved]; INSERT-ONCE via upsert ignoreDuplicates on legacy_id `tr_flag:{reportId}:admin_review` so a retried mirror never clobbers a later admin resolution; resolution_status=open tracked SEPARATELY from approval; no fabricated severity), time_report_flag_events (the IMMUTABLE `flag_opened` event null→open for that flag, legacy_id `tr_flag_event:{reportId}:opened`, idempotency_key `time_report_flag_opened:{reportId}`, insert-ignore — written only alongside a flag), and time_report_messages (ONE IMMUTABLE checkout message written ONLY when a real trimmed deviationComment exists [no empty/whitespace message], sender=employee, legacy_id `tr_msg:{reportId}:checkout_comment`, idempotency_key `time_report_checkout_comment:{reportId}`, insert-ignore). The report's denormalised flag_resolution_status rollup is set to `open` when a flag is raised (auto-approved → null), still SEPARATE from approval. Failure handling is identical: every new write is fire-and-forget, never throws, a Supabase error is recorded in the cut-over telemetry (failed++) and never surfaced; legacy checkout stays authoritative. Gate unchanged: TIME_REPORTING_DUAL_WRITE (DEFAULT OFF, NOT cutoverFlag). NO payroll/invoice basis, time-bank, notification or AI writes; status / allocation / payroll / invoice mapping, mission-log soft links and service_row_legacy_id handling all UNCHANGED. Tests: extended timeReportingDualWrite.test.ts to 32 (flag created for pending / none for auto-approved, flag+event idempotent retry, rollup=open, message only when comment exists, no empty/whitespace message, message idempotent retry, flag/flag-event/message insert-failure recorded-not-thrown, partial-then-retry convergence across flags+message, strict write boundary). Time Reporting checkout dual-write: flag/message added, flag still OFF; parity/shadow validation NOT started; read cut-over NOT started; Supabase-authoritative NOT started. " +
      "SLICE 2d-1 (Operational Execution PARITY comparators only — pure functions + tests, NO runtime hook): added src/lib/data/parityShared.ts (structured ParityMismatch model — type / domain / table / sourceLegacyId / field / expected / actual / severity info|warning|blocking / timestamp / sanitized context — + a pure ParityCollector with an injectable clock and isParityPass where info-only is a PASS), timeReportingParity.ts (compareTimeReportingParity) and missionLogParity.ts (compareMissionLogParity). Both comparators are PURE — they take the legacy checkout TimeReport + context + ALREADY-FETCHED Supabase row fixtures and return structured mismatches; NO Supabase / localStorage reads, NO writes, NO logging, NO UI / AppContext integration — and REUSE the SAME deterministic id + status/flag/message derivation the dual-write writes through (timeReportingMigration / missionLogMigration) so parity can never drift. Time Reporting validates report existence + deterministic legacy id, company/work-order/service-row/employee ids, name snapshot, scheduled/actual/deviation minutes, status mapping, requires_admin_review, submitted_at, mission soft links, scheduled allocation ALWAYS present (even 0 min) + deviation allocations only when >0 + minutes + no unexpected rows, ONE non-duplicated submitted event, pending→one open deviation flag (+ flag_opened event) / auto-approved→no flag, message only when a real comment exists; BLOCKING = missing report / missing scheduled allocation / missing+duplicate submitted event + the payroll/invoice not_ready + ai_recommendation null INVARIANTS, everything else warning. AUDIT/EVENT EQUIVALENCE IS SOFT (2d-1 clarification): the submitted action is proven by the deterministic non-duplicated time_report_submitted event with occurred_at==submittedAt, NOT a field-by-field auditHistory diff. Mission Log validates entry/session/checked_out existence + deterministic ids + service_row/employee/customer + non-duplicated event; ABSENCE is dual-write-state aware — missionLogDualWriteEnabled OFF → missing rows are info (expected, still a PASS, while the Time Reporting comparator independently validates the mission soft-link ids), ON → missing entry/session/event blocking + duplicate checked_out blocking; present rows validated either way. 36 fixture tests (28 + 8) cover the perfect match, every divergence, the invariants, soft submitted-event equivalence + duplicate, mission link, ON-missing=blocking vs OFF-missing=info, and purity. NO runtime hook, fetch runner, telemetry/cutover state, Development Center button, checkout blocking, shadow read, read cut-over, UI, routes, delete-guard switch, TimeReportStatusBadge change, legacy removal, payroll/invoice/time-bank writes or AI. " +
      "SLICE 2d-2 (Operational Execution PARITY fetch runner + sanitized telemetry — still DORMANT, dev/test utility only): added the TIME_REPORTING_SHADOW_VALIDATE feature flag (envFlag, DEFAULT OFF, NOT cutoverFlag — it ONLY gates the parity runner and never switches reads, blocks/alters checkout or changes UI), src/lib/data/timeReportingParityState.ts (cumulative SANITIZED telemetry: enabled / totalChecked / matched / mismatched / blocking / warning / info / missingInSupabase / missingInLegacy / allocation / status / flag / event / message / missionLink mismatch counters / fetchFailures / lastError / lastValidationAt + a 50-capped recentMismatches ring; the CENTRALIZED sanitizeParityMismatch strips deviation comments, message bodies, employee/customer name snapshots and any non-scalar payload — sensitive field/table values become `[redacted]`, only short scalar ids/minutes/counts/statuses are kept) and src/lib/data/timeReportingParityRunner.ts (runTimeReportingParityForReport / runTimeReportingParityBatch + shouldRunTimeReportingShadowValidation). The runner is READ-ONLY: it fetches the Supabase rows by their DETERMINISTIC legacy ids (time_reports by legacy_id + company_legacy_id + deleted_at null via maybeSingle; child allocations/flags by time_report_legacy_id excluding soft-deleted; events/flag_events/messages by time_report_legacy_id; Mission Log entry/session/checkout-event each by their OWN deterministic legacy_id so a sibling report can never look like a duplicate), runs the PURE Slice 2d-1 comparators and records sanitized telemetry — it NEVER upserts/inserts/updates/deletes, never touches localStorage, never imports AppContext/UI, and NEVER throws into the caller (a Supabase fetch failure, unconfigured client or comparator error is caught, recorded as a sanitized fetch failure and returned). GATING: with the gate off NOTHING is fetched and NO telemetry is recorded (an `enabled` opt overrides the flag for tests/the future caller). MISSION LOG is OPT-IN per call (includeMissionLog); absence grading follows MISSION_LOG_DUAL_WRITE (overridable): OFF → missing Mission Log rows are info/expected (a PASS), ON → blocking. Batch mode is bounded + sequential and, given a caller-provided lightweight set of Supabase report legacy_ids, records the inverse (rows absent from the legacy batch) as missing-in-legacy — no broad scan by default. NO runtime/checkout hook, NO Development Center button, NO read cut-over, NO Supabase-authoritative status. 27 runner tests + the 2d-1 comparator tests stay green. " +
      "SLICE 2d-3 (Operational Execution PARITY runtime hook — gated fire-and-forget, single-report, still NO UI / read cut-over / Supabase-authoritative): wired the Slice 2d-2 parity runner into the SUCCESS TAIL of mirrorTimeReportingCheckout (src/lib/data/timeReportingDualWrite.ts) — NOT AppContext. After every Time Reporting write completes successfully it calls runTimeReportingParityForReport(report, context, { enabled: true, includeMissionLog, missionLogDualWriteEnabled }) FIRE-AND-FORGET; running here (after the writes) removes the Time Reporting write/read race. GATE: shouldRunTimeReportingShadowValidation() (TIME_REPORTING_SHADOW_VALIDATE, DEFAULT OFF) — gate OFF → the runner is NOT called at all; the hook is only reachable when the Time Reporting mirror itself runs, which already implies TIME_REPORTING_DUAL_WRITE. NOT called on a mirror FAILURE or a missing-company SKIP (the success tail is never reached). includeMissionLog reflects MISSION_LOG_DUAL_WRITE (off → Mission Log rows are not fetched/compared, absence stays non-blocking; on → graded warning/blocking) — Mission Log is a separate sibling fire-and-forget mirror so its rows may briefly lag, recorded as telemetry only, never affecting checkout, NO ordering dependency added between the two mirrors. FAILURE ISOLATION: the runner never throws, but the returned promise is defensively .catch-swallowed AND the synchronous call is try/caught, so a rejection / sync throw can never surface to the already-successful checkout. AppContext is UNCHANGED (it still calls mirrorTimeReportingCheckout(report, { customerId }) with no hook opts; the opts exist ONLY for deterministic tests). NO read cut-over, UI, routes, Development Center button, service-row delete-guard switch, TimeReportStatusBadge change, legacy TimeReport removal, payroll/invoice/time-bank/notification/AI behaviour. Tests: timeReportingShadowHook.test.ts (gate OFF → not called, gate ON + success → called once, includeMissionLog reflects Mission Log ON/OFF, NOT called on failure/skip, runner rejection + sync throw swallowed, default no-opt path dormant under vitest). " +
      "ROLLOUT RUNBOOK (controlled-enablement, docs/tracking only — NO code behaviour change): added docs/architecture/40-operational-execution-dual-write-rollout-runbook.md — the step-by-step package for safely enabling MISSION_LOG_DUAL_WRITE → TIME_REPORTING_DUAL_WRITE → TIME_REPORTING_SHADOW_VALIDATE (in that order) in a dev/demo environment, with a per-flag checkpoint, the Checkout A/B/C manual validation checklist, the expected per-table row matrix + invariants (scheduled allocation always present, zero-minute deviation slices skipped, payroll/invoice not_ready, ai_recommendation null, idempotent retries), read-only SQL inspection queries keyed by company/work-order/service-row/deterministic time_report legacy ids, parity telemetry inspection (window.__cleanopsData.getTimeReportingParityState; success = 0 blocking, 0 fetchFailures, 0 unexpected warnings), stop conditions, per-flag instant data-free rollback, the required test suites + the two accepted pre-existing flakies. Architecture recap corrected: Mission Log schema = migration 0031, Time Reporting schema = migration 0032. ROLLOUT STATE: controlled validation PENDING; all three flags remain DEFAULT OFF in committed code; NO read cut-over; NOT Supabase-authoritative. " +
      "PRE-EXISTING FLAKINESS (NOT fixed here, tracked only): src/lib/protocolRunStore.test.ts has intermittent ordering failures caused by same-millisecond time-based ids (multiple records created within one millisecond get non-deterministic relative order). Unrelated to the Operational Execution read-seam slices — it does not touch protocolRunStore. To be fixed separately (e.g. a monotonic id/sequence tiebreak or injected clock), not as part of this wave. " +
      "PRE-EXISTING FLAKINESS #2 (NOT fixed here, tracked only): src/lib/developmentTimeline.test.ts asserts getTimelineEntries('all').length === total, which fails because getTimelineEntries defaults to the 50-entry cap (TIMELINE_DEFAULT_LIMIT) while the seed now exceeds 50 entries. Pre-existing per the committed-base verification; do not fix it in this slice. " +
      "LEGACY DEPENDENCY (untouched): the legacy checkout `TimeReport` in src/types/index.ts still drives the live Work Order checkout flow (submitTimeReportCheckout / WorkOrderDetails), gates destructive service-row deletes and is covered by parity/assignment tests. It is the natural cut-over target of the first behavioural Time Reporting wave (dual-write → shadow read → read cut-over → legacy removal), after which the bare `TimeReport` name consolidates onto the new model. " +
      "SHADOW-VALIDATE PHASE 0 (OBSERVABILITY ONLY — built, NO flag change): added a read-only Time Reporting Parity Diagnostics panel to Development Center (super_admin only, directly below the Mission Log Dual-Write Diagnostics panel and above the System Timeline). It surfaces the EFFECTIVE build-time-baked Time Reporting flag values (EXPO_PUBLIC_TIME_REPORTING_DUAL_WRITE / _SHADOW_VALIDATE / _SUPABASE_READ / _SUPABASE_AUTHORITATIVE), a Dual-write ACTIVE/INACTIVE pill (shouldMirrorTimeReportingCheckout) + a Shadow ACTIVE/INACTIVE pill, the live in-memory getTimeReportingParityState() summary (totalChecked / matched / mismatched / missingInSupabase / missingInLegacy / fetchFailures / lastValidationAt / lastError), severity counters (blocking / warning / info), per-domain counters (allocation / status / flag / event / message / mission-link), the getTimeReportingCutoverState() checkout dual-write telemetry (attempted / succeeded / failed / skippedMissingCompany / lastRun) and the SANITIZED 50-capped recent-mismatch ring, with a clear empty-state when no parity run has occurred. Purely observational: no toggles, no mutations, no automatic test execution, no live-data writes — it only READS the existing dormant telemetry exported by Slices 2d-2/2c-2a. NO flags changed: TIME_REPORTING_DUAL_WRITE / _SHADOW_VALIDATE / _SUPABASE_READ / _SUPABASE_AUTHORITATIVE all remain DEFAULT OFF; only the already-validated MISSION_LOG_DUAL_WRITE stays true. NO runtime behaviour change, NO read cut-over, NOT Supabase-authoritative. With shadow validation OFF the panel reads its dormant empty state. " +
      "TIME_REPORTING_DUAL_WRITE CONTROLLED ENABLEMENT — DEPLOYED, AWAITING CHECKOUT VALIDATION (latest): the controlled Time Reporting dual-write enablement phase is now DEPLOYED but NOT yet validated. PRE-FLIGHT GATES PASSED FIRST: targeted read-only test suites green (96/96 across timeReportingDualWrite / timeReportingParity / timeReportingParityRunner / timeReportingShadowHook), and the migration 0032 schema gate passed in the deployed dev/demo Supabase — all nine required tables (time_reports, time_allocations, time_report_events, time_report_flags, time_report_flag_events, time_report_messages, time_deviation_reason_codes, saved_filters, saved_review_queues) returned 200 [] on the read-only anon schema-cache probe (visible + RLS-protected). FLAG CHANGE (single line): added EXPO_PUBLIC_TIME_REPORTING_DUAL_WRITE=true to web-cleanops/.env and rebuilt/redeployed so the Vite bundle bakes in the flag. EFFECTIVE DEPLOYED FLAG STATE: MISSION_LOG_DUAL_WRITE=true (already validated), TIME_REPORTING_DUAL_WRITE=true (NEWLY ENABLED), TIME_REPORTING_SHADOW_VALIDATE=false, TIME_REPORTING_SUPABASE_READ=false, TIME_REPORTING_SUPABASE_AUTHORITATIVE=false, MISSION_LOG_SUPABASE_READ=false, MISSION_LOG_SUPABASE_AUTHORITATIVE=false. RESULT: each checkout now also mirrors the Time Reporting tables (the legacy localStorage checkout remains AUTHORITATIVE; the mirror is fire-and-forget and never surfaces failures). NO controlled checkout validation has been run yet, NO shadow validation, NO reads, NOT Supabase-authoritative, NO UI/read cut-over. NEXT SAFE STEP (separately approved): run the controlled Checkout A/B/C validation set and verify Time Reporting mirror telemetry in the Parity Diagnostics panel. Changed files: web-cleanops/.env, src/lib/developmentCenter.ts, src/lib/developmentTimeline.ts. ",
    updatedAt: "2026-06-11T15:00:00.000Z",
    targetRelease: "Operational Execution Phase 2",
  },
  {
    key: "operational_flags",
    name: "Operational Flags",
    description:
      "Add-on: converts Mission Log and Time Reporting conditions into visible operational risk indicators with their own resolution lifecycle (open / reviewed / approved / dismissed / escalated / kept-for-review), tracked separately from time-report approval.",
    category: "Operations",
    status: "planned",
    ownerArea: "Company Admin",
    dependencies: ["mission_log", "time_reporting"],
    relatedFeatures: ["Flag conditions", "FlagResolutionStatus", "Flag audit trail"],
    supabaseStatus: "not_started",
    localStorageStatus: "not_applicable",
    rlsStatus: "not_started",
    permissionStatus: "not_started",
    activityLogStatus: "planned",
    entitlementStatus: "partial",
    apiStatus: "not_started",
    aiStatus: "not_started",
    languageStatus: "planned",
    testStatus: "not_started",
    releaseReadiness: "not_ready",
    migrationStatus: "not_started",
    notes:
      "OPERATIONAL EXECUTION Phase 1: reserved as the `operational_flags` entitlement feature key + FlagResolutionStatus type + pure triage helpers only. No conditions engine, no UI, no behaviour.",
    updatedAt: "2026-06-09T10:00:00.000Z",
    targetRelease: "Operational Execution (add-on)",
  },
  {
    key: "notification_center",
    name: "Notification Center",
    description:
      "Add-on: consumes operational events and delivers in-app/push/email/SMS messages to admins, employees and customers under company settings + opt-in. Mission Log never sends customer notifications directly.",
    category: "Operations",
    status: "planned",
    ownerArea: "Company Admin",
    dependencies: ["mission_log"],
    relatedFeatures: ["Event consumption", "Delivery channels", "Notification settings"],
    supabaseStatus: "not_started",
    localStorageStatus: "not_applicable",
    rlsStatus: "not_started",
    permissionStatus: "not_started",
    activityLogStatus: "planned",
    entitlementStatus: "partial",
    apiStatus: "not_started",
    aiStatus: "not_started",
    languageStatus: "planned",
    testStatus: "not_started",
    releaseReadiness: "not_ready",
    migrationStatus: "not_started",
    notes:
      "OPERATIONAL EXECUTION Phase 1: reserved as the `notification_center` entitlement feature key only. No delivery, channels or settings implemented.",
    updatedAt: "2026-06-09T10:00:00.000Z",
    targetRelease: "Operational Execution (add-on)",
  },
  {
    key: "incident_management",
    name: "Incident Management",
    description:
      "Add-on: consumes operational events and creates formal incident cases with their own timeline and handling.",
    category: "Operations",
    status: "planned",
    ownerArea: "Company Admin",
    dependencies: ["mission_log"],
    relatedFeatures: ["Incident cases", "Incident timeline", "Case handling"],
    supabaseStatus: "not_started",
    localStorageStatus: "not_applicable",
    rlsStatus: "not_started",
    permissionStatus: "not_started",
    activityLogStatus: "planned",
    entitlementStatus: "partial",
    apiStatus: "not_started",
    aiStatus: "not_started",
    languageStatus: "planned",
    testStatus: "not_started",
    releaseReadiness: "not_ready",
    migrationStatus: "not_started",
    notes:
      "OPERATIONAL EXECUTION Phase 1: reserved as the `incident_management` entitlement feature key only. No case model or UI implemented.",
    updatedAt: "2026-06-09T10:00:00.000Z",
    targetRelease: "Operational Execution (add-on)",
  },
  {
    key: "action_center",
    name: "Action Center",
    description:
      "Add-on: central queue of items requiring a human decision or follow-up, sourced from Mission Log, Time Reporting and other modules.",
    category: "Operations",
    status: "planned",
    ownerArea: "Company Admin",
    dependencies: ["mission_log", "time_reporting"],
    relatedFeatures: ["ActionItem", "Decision queue", "Assignment"],
    supabaseStatus: "not_started",
    localStorageStatus: "not_applicable",
    rlsStatus: "not_started",
    permissionStatus: "not_started",
    activityLogStatus: "planned",
    entitlementStatus: "partial",
    apiStatus: "not_started",
    aiStatus: "not_started",
    languageStatus: "planned",
    testStatus: "not_started",
    releaseReadiness: "not_ready",
    migrationStatus: "not_started",
    notes:
      "OPERATIONAL EXECUTION Phase 1: reserved as the `action_center` entitlement feature key only. No ActionItem model or queue UI implemented.",
    updatedAt: "2026-06-09T10:00:00.000Z",
    targetRelease: "Operational Execution (add-on)",
  },
  {
    key: "time_quality_analytics",
    name: "Time Quality Analytics",
    description:
      "Premium add-on: booked-time accuracy and pattern analysis (customer time fit, employee time patterns, reason-code statistics). Mission Log Core collects the booked-time rating; this provides the advanced analysis with neutral language.",
    category: "Intelligence",
    status: "planned",
    ownerArea: "Company Admin",
    dependencies: ["mission_log", "time_reporting"],
    relatedFeatures: ["Customer Time Fit", "Employee Time Patterns", "Reason Code Statistics"],
    supabaseStatus: "not_started",
    localStorageStatus: "not_applicable",
    rlsStatus: "not_started",
    permissionStatus: "not_started",
    activityLogStatus: "not_started",
    entitlementStatus: "partial",
    apiStatus: "not_started",
    aiStatus: "planned",
    languageStatus: "planned",
    testStatus: "not_started",
    releaseReadiness: "not_ready",
    migrationStatus: "not_started",
    notes:
      "OPERATIONAL EXECUTION Phase 1: reserved as the `time_quality_analytics` entitlement feature key only. Booked-time rating collection belongs to Mission Log Core (type foundation present); advanced analytics are entitlement-gated and not implemented.",
    updatedAt: "2026-06-09T10:00:00.000Z",
    targetRelease: "Operational Execution (add-on)",
  },
  {
    key: "requests",
    name: "Requests",
    description: "Customer-initiated requests and change asks routed to the company.",
    category: "Operations",
    status: "partial",
    ownerArea: "Company Admin",
    dependencies: ["customers"],
    relatedFeatures: ["Request intake", "Status tracking"],
    supabaseStatus: "not_started",
    localStorageStatus: "authoritative",
    rlsStatus: "not_started",
    permissionStatus: "partial",
    activityLogStatus: "not_started",
    entitlementStatus: "not_applicable",
    apiStatus: "not_started",
    aiStatus: "not_started",
    languageStatus: "planned",
    testStatus: "not_started",
    releaseReadiness: "not_ready",
    notes: "localStorage-based intake; not yet migrated.",
    updatedAt: SEED_DATE,
  },
  {
    key: "keys",
    name: "Keys",
    description: "Physical key handling and custody tracking per customer/site.",
    category: "Operations",
    status: "partial",
    ownerArea: "Company Admin",
    dependencies: ["customers"],
    relatedFeatures: ["Key register", "Custody status"],
    supabaseStatus: "not_started",
    localStorageStatus: "authoritative",
    rlsStatus: "not_started",
    permissionStatus: "partial",
    activityLogStatus: "not_started",
    entitlementStatus: "not_applicable",
    apiStatus: "not_started",
    aiStatus: "not_started",
    languageStatus: "planned",
    testStatus: "not_started",
    releaseReadiness: "not_ready",
    notes: "localStorage-based key custody; pending migration.",
    updatedAt: SEED_DATE,
  },
  {
    key: "activity_log",
    name: "Activity Log",
    description: "Cross-module audit trail of create/edit/status changes with before/after values.",
    category: "System",
    status: "active",
    ownerArea: "Platform",
    dependencies: [],
    relatedFeatures: ["Audit entries", "Before/after diff", "Actor + timestamp"],
    supabaseStatus: "complete",
    localStorageStatus: "dual_write",
    rlsStatus: "complete",
    permissionStatus: "complete",
    activityLogStatus: "not_applicable",
    entitlementStatus: "not_applicable",
    apiStatus: "not_started",
    aiStatus: "not_started",
    languageStatus: "planned",
    testStatus: "complete",
    releaseReadiness: "verified",
    migrationStatus: "activated",
    notes:
      "Supabase-authoritative (ACTIVITY wave). The append-only audit trail (cleanops.auditEvents) moved onto the new activity_events table (0029): flat indexed columns (company scope / actor / action / occurred_at) + lossless data jsonb, company-scoped RLS where super_admin sees all (incl. platform-level company_id null events), APPEND-ONLY (insert policies only — the trail is immutable under RLS, no update/delete). Repository (date-ordered, newest-first, capped reads), read seam (useActivitySource), append-only dual-write mirror (mirrorActivityAppend — inserts only, never updates/removes), migration + shadow validation. localStorage kept as the synchronized backout copy (still hard-capped at the newest 500). Rollback is a single env flip (=false).",
    updatedAt: "2026-06-08T12:00:00.000Z",
  },
  {
    key: "entitlements",
    name: "Entitlements / Packages",
    description: "Feature/package gating that enables capabilities per company.",
    category: "System",
    status: "active",
    ownerArea: "Super Admin",
    dependencies: ["companies"],
    relatedFeatures: ["Package definitions", "Capability flags", "Entitlement Validation"],
    supabaseStatus: "complete",
    localStorageStatus: "dual_write",
    rlsStatus: "complete",
    permissionStatus: "complete",
    activityLogStatus: "partial",
    entitlementStatus: "not_applicable",
    apiStatus: "not_started",
    aiStatus: "not_started",
    languageStatus: "planned",
    testStatus: "complete",
    releaseReadiness: "verified",
    migrationStatus: "activated",
    notes:
      "Supabase-authoritative (ENT wave). All THREE entitlement stores moved onto Supabase (tables 0028): service_global_entitlements (platform-wide availability — GLOBAL master data, readable to all, super-admin writes), company_service_entitlements (per-company tri-state access — company-scoped + super_admin), and service_entitlement_log (immutable APPEND-ONLY billing/support trail — insert policies only). Repository + read seam (useEntitlementSource reconciles all three), dual-write mirrors (mirrorGlobalEntitlementWrites / mirrorCompanyEntitlementWrites upsert + soft-delete removal; mirrorEntitlementLogAppend append-only), migration + shadow validation. The bundle-first resolver + ServiceFeatureKey registry are unchanged; this wave moved the SOURCE OF TRUTH only. localStorage kept as the synchronized backout copy (strategy B). Rollback is a single env flip (=false).",
    updatedAt: "2026-06-08T12:00:00.000Z",
  },
  {
    key: "system_settings",
    name: "System Settings",
    description: "Platform-level (Master Admin) configuration: booking horizon, Preferred Time Evaluation master gate, entitlement-resolver controls.",
    category: "System",
    status: "active",
    ownerArea: "Super Admin",
    dependencies: [],
    relatedFeatures: ["Booking horizon", "Preferred Time Evaluation gate", "Entitlement resolver mode"],
    supabaseStatus: "complete",
    localStorageStatus: "dual_write",
    rlsStatus: "complete",
    permissionStatus: "complete",
    activityLogStatus: "complete",
    entitlementStatus: "not_applicable",
    apiStatus: "not_started",
    aiStatus: "not_started",
    languageStatus: "planned",
    testStatus: "complete",
    releaseReadiness: "verified",
    migrationStatus: "activated",
    notes:
      "Supabase-authoritative (SYSSET wave) — the LONE remaining in-scope source-of-truth gap that kept Super Admin 'partial', now closed. The platform-level (Master Admin) configuration record (cleanops.systemSettings) moved onto the new system_settings table (0030): a SINGLETON global record (no company scope, one row keyed by the constant legacy_id 'global') carrying the booking-generation horizon, the Preferred Time Evaluation master gate and the entitlement-resolver mode + shadow-log flag in a lossless data jsonb. RLS: world-readable by every authenticated user (the PTE gate + resolver mode are consumed app-wide, mirroring settings_templates), super-admin-only writes. Repository (getSystemSettingsFromSupabase — single maybeSingle read), read seam (useSystemSettingsSource reconciles the single record; a missing row pre-migration keeps the local seed, never blanks), dual-write mirror (mirrorSystemSettingsWrite — single upsert on change + post-write round-trip validation, fired by updateSystemSettings), migration + shadow validation (single-record detail parity). localStorage kept as the synchronized backout copy (strategy B). Rollback is a single env flip (=false).",
    updatedAt: "2026-06-08T13:00:00.000Z",
  },
  {
    key: "checklist_manager",
    name: "Checklist Manager",
    description: "Reusable checklist templates, libraries, global templates and customer protocols.",
    category: "Checklists",
    status: "active",
    ownerArea: "Super Admin / Company Admin",
    dependencies: ["companies", "customers"],
    relatedFeatures: ["Templates", "Libraries", "Global Templates", "Customer Protocols", "Protocol Runs"],
    supabaseStatus: "partial",
    localStorageStatus: "dual_write",
    rlsStatus: "complete",
    permissionStatus: "complete",
    activityLogStatus: "partial",
    entitlementStatus: "partial",
    apiStatus: "not_started",
    aiStatus: "not_started",
    languageStatus: "planned",
    testStatus: "partial",
    releaseReadiness: "in_review",
    migrationStatus: "activated",
    notes:
      "Supabase-authoritative for the core records (MCPM wave). checklist_templates (global best-practice library + company-owned, stored losslessly as one nested ChecklistTemplateAggregate row) and customer_protocols (company+customer scoped aggregate) are flipped via tables 0027 with global+company RLS, repositories, read seams, dual-write + shadow validation; localStorage kept as the synchronized backout copy (strategy B). REMAINING localStorage dependencies: ProtocolRun execution snapshots, the checklist library building blocks (libraryRooms / libraryTasks), checklist categories and checklist adoptions are not part of this wave. Rollback is a single env flip (=false).",
    updatedAt: "2026-06-05T12:00:00.000Z",
  },
  {
    key: "customer_portal",
    name: "Customer Portal",
    description: "Client-facing area: cleaning protocols, preferences and request submission.",
    category: "Portals",
    status: "active",
    ownerArea: "Customer",
    dependencies: ["customers", "checklist_manager"],
    relatedFeatures: ["My Cleaning Protocols", "Cleaning Preferences"],
    supabaseStatus: "not_started",
    localStorageStatus: "authoritative",
    rlsStatus: "not_started",
    permissionStatus: "complete",
    activityLogStatus: "not_started",
    entitlementStatus: "partial",
    apiStatus: "not_started",
    aiStatus: "not_started",
    languageStatus: "planned",
    testStatus: "partial",
    releaseReadiness: "not_ready",
    notes: "Customer-facing routes live; backed by localStorage data sources.",
    updatedAt: SEED_DATE,
  },
  {
    key: "employee_app",
    name: "Employee App",
    description: "On-the-ground workspace for staff: schedule, work orders and execution.",
    category: "Portals",
    status: "active",
    ownerArea: "Employee",
    dependencies: ["schedule", "work_orders", "mission_log"],
    relatedFeatures: ["Employee portal", "Assigned visits", "Checklist execution"],
    supabaseStatus: "not_started",
    localStorageStatus: "authoritative",
    rlsStatus: "not_started",
    permissionStatus: "complete",
    activityLogStatus: "not_started",
    entitlementStatus: "not_applicable",
    apiStatus: "not_started",
    aiStatus: "not_started",
    languageStatus: "planned",
    testStatus: "partial",
    releaseReadiness: "not_ready",
    notes: "Employee portal routes live; depends on operational modules still on localStorage.",
    updatedAt: SEED_DATE,
  },
  {
    key: "time_codes",
    name: "Time Codes",
    description: "Payroll-foundation time codes (attendance/absence) referenced by services.",
    category: "Payroll",
    status: "active",
    ownerArea: "Super Admin",
    dependencies: ["services", "activity_log"],
    relatedFeatures: ["Master library", "Service timeCodeId", "Usage count"],
    supabaseStatus: "complete",
    localStorageStatus: "dual_write",
    rlsStatus: "complete",
    permissionStatus: "complete",
    activityLogStatus: "complete",
    entitlementStatus: "not_applicable",
    apiStatus: "not_started",
    aiStatus: "not_started",
    languageStatus: "planned",
    testStatus: "complete",
    releaseReadiness: "verified",
    migrationStatus: "activated",
    notes:
      "Supabase-authoritative (TIMECODE wave — the payroll/time FOUNDATION). time_codes table (0024) with a GLOBAL master library (companyId === null) + company codes, global+company RLS, repository, read seam, dual-write + shadow validation built and flipped; localStorage kept as the synchronized backout copy (strategy B). Anchors the paused payroll/time domain (services.timeCodeId + time reports soft-reference a code by legacy id). Rollback is a single env flip (=false).",
    updatedAt: "2026-06-05T12:00:00.000Z",
  },
  {
    key: "payroll_export",
    name: "Payroll Export",
    description: "Adapter-based payroll export architecture: basis, profiles, runs and adapters.",
    category: "Payroll",
    status: "in_progress",
    ownerArea: "Super Admin / Company Admin",
    dependencies: ["time_codes", "entitlements", "activity_log"],
    relatedFeatures: ["Export Profiles", "Export Runs", "Adapter registry", "Capabilities"],
    supabaseStatus: "partial",
    localStorageStatus: "authoritative",
    rlsStatus: "not_started",
    permissionStatus: "complete",
    activityLogStatus: "complete",
    entitlementStatus: "complete",
    apiStatus: "planned",
    aiStatus: "not_started",
    languageStatus: "planned",
    testStatus: "complete",
    releaseReadiness: "in_review",
    notes:
      "Foundation only: data model, profile/run models, adapter interface, CSV reference adapter, Settings UI, entitlement keys, permissions, audit logging and tests. No real Fortnox/PAXml/Visma/Hogia/API/SFTP/Webhook adapters yet. Migration 0012 staged.",
    updatedAt: SEED_DATE,
  },
  {
    key: "payroll_basis",
    name: "PayrollBasis Core",
    description:
      "Internal source-of-truth payroll basis: periods, basis rows (snapshotted), manual rows, approval and lock workflow feeding approved rows to export adapters. Architecture approved; implementation intentionally postponed.",
    category: "Payroll",
    status: "planned",
    ownerArea: "Super Admin / Company Admin",
    dependencies: ["time_codes", "services", "payroll_export"],
    relatedFeatures: [
      "PayrollPeriod",
      "PayrollBasis",
      "PayrollBasisRow",
      "Manual payroll rows",
      "Approval workflow",
      "Lock workflow",
      "Statistics-ready snapshots",
    ],
    supabaseStatus: "not_started",
    localStorageStatus: "not_applicable",
    rlsStatus: "not_started",
    permissionStatus: "not_started",
    activityLogStatus: "not_started",
    entitlementStatus: "planned",
    apiStatus: "not_started",
    aiStatus: "not_started",
    languageStatus: "planned",
    testStatus: "not_started",
    releaseReadiness: "not_ready",
    migrationStatus: "not_started",
    notes:
      "Status: Not Started. Readiness: Architecture Approved. Priority: Future Payroll Phase. " +
      "Prerequisite foundation COMPLETE: Time Codes, Service Basis Types, Payroll Export Architecture, Statistics snapshot strategy. " +
      "Future deliverables: PayrollPeriod, PayrollBasis, PayrollBasisRow, manual payroll rows, approval workflow, lock workflow, export readiness, statistics-ready snapshots. " +
      "Explicitly OUT OF SCOPE: OB calculation, OB Journal, collective-agreement calculations, Fortnox/PAXml/Visma/Hogia integrations, API exports, statistics dashboards. " +
      "Key architectural decisions: (1) ServiceBasisType drives payroll/invoice inclusion. (2) TimeCode and ServiceBasisType are separate concepts. (3) Historical rows must use snapshots. (4) PayrollBasis is the internal source of truth. (5) Export adapters consume approved PayrollBasis rows only. (6) Future statistics read snapshots, not mutable service data. " +
      "Documentation/roadmap registration only — no implementation has begun.",
    targetRelease: "Future Payroll Phase",
    updatedAt: SEED_DATE,
  },
  {
    key: "statistics_foundation",
    name: "Statistics Foundation",
    description:
      "Snapshot-based workforce & billability statistics foundation: employee workload, employment-rate tracking, utilization and payroll analytics. Documentation/roadmap only — no implementation.",
    category: "Intelligence",
    status: "planned",
    ownerArea: "Super Admin / Company Admin",
    dependencies: ["time_codes", "services", "payroll_basis"],
    relatedFeatures: [
      "Employee workload",
      "Employment-rate tracking",
      "Billability",
      "Utilization",
      "Payroll analytics",
      "Company statistics",
    ],
    supabaseStatus: "not_started",
    localStorageStatus: "not_applicable",
    rlsStatus: "not_started",
    permissionStatus: "not_started",
    activityLogStatus: "not_started",
    entitlementStatus: "planned",
    apiStatus: "not_started",
    aiStatus: "not_started",
    languageStatus: "planned",
    testStatus: "not_started",
    releaseReadiness: "not_ready",
    migrationStatus: "not_started",
    notes:
      "Status: Planned. Documentation only. " +
      "Prerequisite foundation: Time Codes (✔), Service Basis Types (✔), Service Categories governance (✔), Payroll Groups (✔), PayrollBasis (planned). " +
      "Future scope: employee workload, employment-rate tracking, billability, utilization, payroll analytics, company statistics. " +
      "Architecture rule: statistics MUST read snapshotted WorkStatisticsRow/PayrollBasisRow fields, never mutable Service/TimeCode values. No implementation has begun.",
    targetRelease: "Future Statistics Phase",
    updatedAt: SEED_DATE,
  },
  {
    key: "invoice_foundation",
    name: "Invoice Foundation",
    description:
      "Snapshot-based invoicing foundation: how future invoice rows (InvoiceBasis) are generated from Services + Customer Agreements with historical safety. Architecture-review/roadmap only — no calculation, generation or exports.",
    category: "Billing",
    status: "planned",
    ownerArea: "Super Admin / Company Admin",
    dependencies: ["services", "customers"],
    relatedFeatures: [
      "InvoiceBasis",
      "InvoiceBasisRow",
      "Service Basis Types (billable inclusion)",
      "Customer Agreements (pricing source)",
      "Time Bank transactions",
      "Cancellation / reschedule fees",
      "Manual invoice adjustments",
      "Snapshot pricing/quantity",
      "Revenue & profitability statistics",
    ],
    supabaseStatus: "not_started",
    localStorageStatus: "not_applicable",
    rlsStatus: "not_started",
    permissionStatus: "not_started",
    activityLogStatus: "not_started",
    entitlementStatus: "planned",
    apiStatus: "not_started",
    aiStatus: "not_started",
    languageStatus: "planned",
    testStatus: "not_started",
    releaseReadiness: "not_ready",
    migrationStatus: "not_started",
    notes:
      "Status: Planned / Architecture Reviewed / Not Started. Architecture review only — no invoice calculation, generation, exports or migrations. " +
      "Purpose: create invoice-ready rows (InvoiceBasis) from operational data. Future source inputs: customer agreements, services, serviceBasisType, visits/work orders, time bank transactions, cancellation/reschedule fees, manual invoice adjustments. Future output: approved invoice basis rows. " +
      "Dependencies: Services (✔), Service Basis Types (✔ — `serviceBasisType` drives invoice inclusion: billable=in, non_billable/excluded=out), Customer Agreements (authoritative commercial/pricing source), Invoice Basis (future). " +
      "Key architectural decisions: (1) A separate InvoiceBasis is required — Service alone is insufficient (Service holds catalog defaults, not per-customer agreed price or actual quantity); Customer Agreement is the authoritative commercial source, Service stays catalog/default data. (2) ServiceBasisType is the inclusion gate (only `billable` reaches Invoice Basis). (3) Invoice rows MUST SNAPSHOT service name, pricing method (billingType), pricing values (price/vat/minimumPrice/unit), customer, and quantity so historical invoices never change when Services or agreements are edited. (4) billingType (fixed/hourly/per_unit/subscription) expresses pricing method but likely needs future commercial concepts — object/per-site, kilometer/travel, and material billing. (5) Invoice statistics (revenue, billable hours, utilization, profitability) MUST read snapshots, not mutable Service/agreement data. (6) Time Bank stays transaction-based and must NOT mix time ledger with money ledger; only its billable consumption/fees feed Invoice Basis. (7) Invoice Basis must be INDEPENDENT from the invoice export target (it feeds either an external system or a future CleanOps invoice module). " +
      "No single combined status field; Derived Badge stays computed from the typed axes. No implementation has begun.",
    targetRelease: "Future Billing Phase",
    updatedAt: SEED_DATE,
  },
  {
    key: "invoice_export",
    name: "External Invoice Export / API",
    description:
      "Path A export layer: send approved Invoice Basis rows to external accounting/invoice systems. CleanOps creates the invoice basis; the external finance system creates the official invoice. Roadmap only — no implementation.",
    category: "Billing",
    status: "planned",
    ownerArea: "Super Admin / Company Admin",
    dependencies: ["invoice_foundation", "api_integrations"],
    relatedFeatures: [
      "Fortnox export",
      "Visma export",
      "API export",
      "CSV export",
      "PDF / export file",
      "Custom customer-specific integrations",
    ],
    supabaseStatus: "not_started",
    localStorageStatus: "not_applicable",
    rlsStatus: "not_started",
    permissionStatus: "not_started",
    activityLogStatus: "not_started",
    entitlementStatus: "planned",
    apiStatus: "planned",
    aiStatus: "not_started",
    languageStatus: "planned",
    testStatus: "not_started",
    releaseReadiness: "not_ready",
    migrationStatus: "not_started",
    notes:
      "Status: Planned / Not Started. Roadmap registration only — no export adapters, API, bank or accounting connections. " +
      "Purpose: allow approved Invoice Basis rows to be sent to external accounting/invoice systems. Future targets: Fortnox, Visma, API export, CSV export, PDF/export file, custom customer-specific integrations. " +
      "Architecture: Path A = Invoice Basis → external invoice system/API. The external finance system remains the accounting source of truth and creates the official invoice. Invoice Basis is independent from the export target; adapters consume approved rows only (mirrors the Payroll Export adapter pattern). No implementation has begun.",
    targetRelease: "Future Billing Phase",
    updatedAt: SEED_DATE,
  },
  {
    key: "cleanops_invoice",
    name: "CleanOps Invoice Module",
    description:
      "Future-option Path B module: create and send invoices directly inside CleanOps from approved Invoice Basis. A LIMITED operational invoicing module — not full accounting. Roadmap only — no implementation.",
    category: "Billing",
    status: "planned",
    ownerArea: "Super Admin / Company Admin",
    dependencies: ["invoice_foundation"],
    relatedFeatures: [
      "Create invoices from approved Invoice Basis",
      "Send invoices from CleanOps",
      "Invoice PDF generation",
      "Invoice status tracking",
      "Payment status tracking",
      "Bank / API connection",
      "Reminders / payment follow-up",
      "Customer invoice history",
    ],
    supabaseStatus: "not_started",
    localStorageStatus: "not_applicable",
    rlsStatus: "not_started",
    permissionStatus: "not_started",
    activityLogStatus: "not_started",
    entitlementStatus: "planned",
    apiStatus: "not_started",
    aiStatus: "not_started",
    languageStatus: "planned",
    testStatus: "not_started",
    releaseReadiness: "not_ready",
    migrationStatus: "not_started",
    notes:
      "Status: FUTURE OPTION / Not Started (mapped to the `planned` enum; lifecycle nuance recorded here). Roadmap registration only — no invoice generation, sending, PDF, bank connection or payment tracking. " +
      "Purpose: allow CleanOps to create and send invoices directly. This is a LIMITED invoicing module, NOT full accounting — CleanOps is explicitly not planned as a full bookkeeping system. " +
      "Future capabilities: create invoices from approved Invoice Basis, send invoices, invoice PDF generation, invoice status tracking, payment status tracking, bank/API connection, reminders/payment follow-up, customer invoice history. " +
      "Architecture: Path B = Invoice Basis → CleanOps Invoice → Invoice Journal → external accounting system. The accounting source of truth may remain external. No implementation has begun.",
    targetRelease: "Future Billing Phase",
    updatedAt: SEED_DATE,
  },
  {
    key: "rut_handling",
    name: "RUT Handling",
    description:
      "Swedish RUT tax-deduction handling for future invoicing: eligibility, amount calculation, reference data, logging, status and correction handling. Designed as a controlled future module, not mixed into basic service logic. Roadmap only — no implementation.",
    category: "Billing",
    status: "planned",
    ownerArea: "Super Admin / Company Admin",
    dependencies: ["invoice_foundation", "customers"],
    relatedFeatures: [
      "RUT eligibility filter",
      "RUT amount calculation",
      "Customer identity/reference data (where legally allowed)",
      "RUT log",
      "RUT status tracking",
      "RUT correction handling",
      "Export / reporting support",
    ],
    supabaseStatus: "not_started",
    localStorageStatus: "not_applicable",
    rlsStatus: "not_started",
    permissionStatus: "not_started",
    activityLogStatus: "not_started",
    entitlementStatus: "planned",
    apiStatus: "not_started",
    aiStatus: "not_started",
    languageStatus: "planned",
    testStatus: "not_started",
    releaseReadiness: "not_ready",
    migrationStatus: "not_started",
    notes:
      "Status: Planned / Not Started. Roadmap registration only — no RUT calculation, reference-data capture, logging or export. " +
      "Purpose: prepare for Swedish RUT handling in future invoicing. Future capabilities: RUT eligibility filter, RUT amount calculation, customer personal identity/reference data where legally allowed, RUT log, RUT status tracking, RUT correction handling, export/reporting support. " +
      "Architectural decision: RUT must be a controlled future module, NOT mixed into basic service logic. Personal/identity data handling is subject to legal review before any implementation. No implementation has begun.",
    targetRelease: "Future Billing Phase",
    updatedAt: SEED_DATE,
  },
  {
    key: "invoice_journal",
    name: "Invoice Journal / Accounting Export",
    description:
      "Future-option Path B output: if CleanOps creates invoices directly, export accounting-relevant journal data (invoice journal, payment journal, RUT journal) to an external accounting system. CleanOps is not a full bookkeeping system. Roadmap only — no implementation.",
    category: "Billing",
    status: "planned",
    ownerArea: "Super Admin / Company Admin",
    dependencies: ["cleanops_invoice", "rut_handling", "api_integrations"],
    relatedFeatures: [
      "Invoice journal",
      "Payment journal",
      "RUT journal",
      "PDF export",
      "API export",
      "Accounting-system export file",
    ],
    supabaseStatus: "not_started",
    localStorageStatus: "not_applicable",
    rlsStatus: "not_started",
    permissionStatus: "not_started",
    activityLogStatus: "not_started",
    entitlementStatus: "planned",
    apiStatus: "planned",
    aiStatus: "not_started",
    languageStatus: "planned",
    testStatus: "not_started",
    releaseReadiness: "not_ready",
    migrationStatus: "not_started",
    notes:
      "Status: FUTURE OPTION / Not Started (mapped to the `planned` enum; lifecycle nuance recorded here). Roadmap registration only — no journal generation or accounting export. " +
      "Purpose: when CleanOps creates invoices directly (Path B), export accounting-relevant invoice journal data to an external accounting system. Future outputs: invoice journal, payment journal, RUT journal, PDF export, API export, accounting-system export file. " +
      "Architectural decision: CleanOps should NOT become a full bookkeeping system — the accounting source of truth may remain external. CleanOps generates operational invoice data and journals for export only. No implementation has begun.",
    targetRelease: "Future Billing Phase",
    updatedAt: SEED_DATE,
  },
  {
    key: "customer_agreement",
    name: "Customer Agreement Foundation",
    description:
      "The missing commercial parent between Customer and operational data: Customer → CustomerAgreement → CustomerAgreementLine → (optional) TimeBankWallet → TimeBankTransaction. Becomes the authoritative commercial source; Service stays catalog/default data. ARCHITECTURE LOCKED / Implementation Ready — next step is Implementation Planning. No code implemented yet.",
    category: "Billing",
    status: "planned",
    ownerArea: "Super Admin / Company Admin",
    dependencies: ["customers", "services"],
    relatedFeatures: [
      "CustomerAgreement (parent)",
      "CustomerAgreementLine",
      "Billing models: per_visit / monthly_fixed / time_bank / hybrid (governed enum)",
      "PricingModel: fixed / per_unit / custom",
      "InvoiceInterval enum: per_visit / weekly / monthly / quarterly / biannual / yearly / on_completion",
      "Agreement source metadata: sourceType / sourceReferenceId",
      "Customer-specific & service-specific pricing",
      "Recurrence rules",
      "TimeBankWallet / TimeBankTransaction",
      "Cancellation & reschedule policies",
      "Invoice settings & recipients",
      "RUT settings",
      "Agreement versioning / snapshots",
    ],
    supabaseStatus: "not_started",
    localStorageStatus: "not_applicable",
    rlsStatus: "not_started",
    permissionStatus: "not_started",
    activityLogStatus: "not_started",
    entitlementStatus: "planned",
    apiStatus: "not_started",
    aiStatus: "not_started",
    languageStatus: "planned",
    testStatus: "not_started",
    releaseReadiness: "not_ready",
    migrationStatus: "not_started",
    notes:
      "CUSTOMER AGREEMENT DETAIL PAGE (Phase 14 · first host page; admin-only, not verified, not customer-facing): src/pages/admin/CustomerAgreementDetail.tsx is the first surface that views a single Customer Agreement. It loads the agreement version + lines + version chain through the read-only seam src/hooks/use-customer-agreement-detail-source.ts (useCustomerAgreementDetailSource → supabaseCustomerAgreementRepository.getDetail/listLines/listVersionChain, scope-guarded by company; super admins read unscoped). Layout = four sections: agreement summary, service lines, version information, and the Time Bank panel. The Time Bank panel is MOUNTED here via useTimeBankPanel with the company's entitlement resolved through the real pipeline (resolveTimeBankEntitlement); a denied company renders the disabled, read-only panel state and no wallet is ever created from the page. Route: /agreements/:agreementId (ProtectedRoute requirePermission='users.manage'). No nav link yet (no agreement list page exists) — link from a future Customer Agreements list / the Customer Card once available. Empty/loading/error/not-found states handled at the page level. No agreement editing, no wallet provisioning, no billing, no scheduler, no customer portal. Tests: src/pages/admin/CustomerAgreementDetail.test.tsx (7 RTL — summary/lines/version render, not-found, loading, panel mount with wallet, disabled-when-denied, handler pass-through, no edit/delete controls) + src/hooks/use-customer-agreement-detail-source.test.tsx (4 — load, not-found, scope isolation, load-error). " +
      "TIME BANK ADMIN PANEL (Phase 13 · first admin UI surface for an agreement; foundation only — no customer portal, no scheduler, no billing, not verified): src/components/customer/TimeBankAdminPanel.tsx + the pure src/lib/data/timeBankPanelModel.ts render the Time Bank picture for an agreement group (entitlement, wallet balances, rules, cancellation policy, opening balance, ledger, legacy notes) and offer the safe admin actions (single opening balance, legacy note, audited manual adjustment, optional freeze/close). Intended to live in the Customer Agreement detail view; that detail page does not exist yet, so the panel is built reusable and not yet mounted. The panel never creates a wallet and never edits/deletes ledger rows. PERSISTENCE WIRING (Phase 13 · admin panel persistence): src/hooks/use-time-bank-panel.ts (useTimeBankPanel) is the single container seam between the presentational panel and Supabase — it LOADS wallet (getWalletByAgreementGroupId) + immutable ledger (listTransactions) + informational legacy notes (listLegacyNotes), ASSEMBLES the TimeBankPanelInput (balances/warnings derived downstream, never stored), and EXPOSES safe write handlers routed through the existing persistence functions: recordOpeningBalance (single-occurrence, deterministic-id re-runnable), recordLegacyHistoryNote (never affects balance), appendWalletTransaction (manual_add/manual_remove, frozen/closed-gated), and the new setWalletStatus (freeze/close; closed is terminal; no-op same-status). Every action refreshes on success; load/save/validation/gate errors surface (loadError/actionError) — no silent failures. The hook NEVER creates a wallet. Tests: src/hooks/use-time-bank-panel.test.tsx (11 RTL against the in-memory Supabase harness) cover repository loading, opening-balance persistence + duplicate prevention, legacy-note persistence (ledger-neutral), adjustment persistence, write-error surfacing, and frozen/closed restrictions; src/lib/data/timeBankPersistence.test.ts gains 3 setWalletStatus cases (freeze, no-op, closed-terminal). See Time Bank Architecture (Phase 13) for the full description. " +
      "TEMPLATE → AGREEMENT ORCHESTRATION (Phase 10 · foundation only; no UI/activation): src/lib/data/agreementTemplateOrchestration.ts · createCustomerAgreementFromTemplate() now PERSISTS a Customer Agreement v1 + lines (via supabaseCustomerAgreementRepository.upsertVersions/upsertLines, parent→children) from a persisted Agreement Template, with an INJECTED Time Bank entitlement gate (templates never bypass entitlements) and optional idempotent wallet creation. Each run mints a fresh agreementGroupId (sourceType='template', sourceReferenceId=templateId for traceability only); not globally idempotent by default; template edit/archival never affects the created agreement. 19 harness tests pass. See agreement_templates for the full description. " +
      "Status: Planned / Architecture Reviewed / Not Started. Priority: HIGH. Roadmap & architecture registration only — Customer Agreement is NOT implemented yet. " +
      "Identified as the missing commercial foundation required BEFORE: Time Bank, Invoice Basis, Monthly Billing, Hybrid Billing, Cancellation Rules, Reschedule Rules, Pricing Engine, future Invoice Module. " +
      "Dependencies completed: Customers (✔), Services (✔), Service Categories (✔), Service Basis Types (✔), Payroll Groups (✔). Future dependencies: Time Bank, Invoice Basis, Pricing Engine, Invoice Module. " +
      "Recommended structure: Customer → CustomerAgreement → CustomerAgreementLine → TimeBankWallet (optional) → TimeBankTransaction. " +
      "Architecture decisions: (1) Service remains catalog/default data. (2) Customer Agreement becomes the authoritative commercial source. (3) Supports billing models per_visit, monthly_fixed, time_bank, hybrid. (4) Agreement changes MUST use versioning — never overwrite historical commercial terms. (5) Agreement Lines store customer-specific pricing and rules. (6) Invoice Basis must later read agreed commercial values from Customer Agreement, not Service catalog defaults. (7) Time Bank must belong to Customer Agreement (via TimeBankWallet), NOT directly on Customer; transaction-based, time ledger kept separate from money ledger. " +
      "Future capabilities to record: customer-specific pricing, service-specific pricing, recurrence rules, time bank, cancellation policies, reschedule policies, invoice settings, invoice recipients, RUT settings, hybrid billing. No implementation has begun. " +
      "=== FINAL IMPLEMENTATION CONTRACTS (locked — must be enforced at build time, no implementation yet) === " +
      "CONTRACT 1 — Hybrid Billing Precedence: effectiveBillingModel = line.billingModelOverride ?? agreement.billingModel. Validation: billingModelOverride is ONLY allowed when agreement.billingModel = hybrid; for all non-hybrid agreements billingModelOverride MUST be null. Reason: Invoice Basis must never guess which billing model applies. " +
      "CONTRACT 2 — Frozen Time Bank Wallet reservation handling: TimeBankWallet binds to agreementGroupId; wallet lifecycle = active | frozen | closed. When an agreement moves away from time_bank or hybrid billing and the wallet becomes frozen, the system MUST explicitly resolve any reserved balance — reserved time must not be orphaned. Implementation must choose and enforce exactly one of: release reservations, honor already-existing reservations, or require manual resolution before freezing. No silent orphaned reservations allowed. " +
      "CONTRACT 3 — Agreement Status State Machine: statuses = draft | active | paused | superseded | cancelled | ended. Allowed transitions: draft → active | cancelled; active → paused | superseded | cancelled | ended; paused → active | cancelled | ended; superseded = terminal; cancelled = terminal; ended = terminal. Only active or paused agreements may be superseded by a new version. Terminal statuses MUST NEVER return to active. Reason: agreement status must be deterministic for scheduling, invoice basis, time bank, statistics and customer portal. " +
      "=== ARCHITECTURE LOCKED — IMPLEMENTATION READY (signed off; next step = Implementation Planning; no code implemented yet) === " +
      "All commercial-design decisions are now locked. The final design includes: (1) CustomerAgreement (versioned header) and CustomerAgreementLine (children of a single version). (2) agreementGroupId version chain — agreementGroupId groups all versions, each version has its own agreement id, supersedesVersionId / supersededById link the chain, old versions are superseded (never overwritten). (3) Agreement Status state machine (CONTRACT 3 above). (4) Hybrid billing precedence rule (CONTRACT 1 above): effectiveBillingModel = line.billingModelOverride ?? agreement.billingModel, override only legal when header billingModel = hybrid. (5) Agreement versioning rules (see Agreement Versioning Foundation): commercial changes create a new version; notes / internal name+metadata / validFrom+validTo extensions are in-place edits. (6) WorkOrder reference strategy: future work orders / service rows reference sourceAgreementId + sourceAgreementVersion + sourceAgreementLineId (snapshotted at generation time). (7) Agreement snapshots: lines copy catalog/service values (serviceNameSnapshot, categoryNameSnapshot, categoryTypeSnapshot, serviceBasisTypeSnapshot, timeCodeSnapshot, payrollGroupTypeSnapshot) — never live-link to mutable Service rows. (8) Future TimeBankWallet binds to agreementGroupId (not the agreement version id) — see Time Bank Architecture. " +
      "Out of scope for Customer Agreement Phase 1 (explicitly deferred): Time Bank implementation, Invoice Basis, Invoice generation, Agreement Templates, Pricing Engine, RUT, Customer Portal, PayrollBasis. " +
      "=== SCHEMA REFINEMENTS (LOCKED — approved 2026; SCHEMA NOW LOCKED, ready for migration) === " +
      "REFINEMENT 1 — invoiceInterval is its own enum (do NOT reuse RecurrenceInterval): invoice cadence and scheduling recurrence are separate concepts. Approved InvoiceInterval values: per_visit | weekly | monthly | quarterly | biannual | yearly | on_completion. " +
      "REFINEMENT 2 — BillingModel extensibility: BillingModel is a GOVERNED enum (per_visit | monthly_fixed | time_bank | hybrid) and must ONLY be extended through deliberate schema changes — no free-text billing models. Future candidates: per_hour, usage_based, retainer. Any new value MUST require: a label and description, an explicit Invoice Basis rule, and hybrid precedence validation (see CONTRACT 1). " +
      "REFINEMENT 3 — PricingModel gains custom: approved PricingModel values = fixed | per_unit | custom. Rule: when pricingModel = custom, the agreed line price/snapshot is authoritative and NO pricing-engine derivation is applied. " +
      "REFINEMENT 4 — Agreement source metadata on CustomerAgreement: add sourceType (manual | template | imported | converted_quote) and sourceReferenceId (nullable soft reference). Do NOT enforce FK constraints yet. " +
      "=== SCHEMA LOCKED === All header/line shapes, enums (BillingModel, AgreementStatus, PricingModel, InvoiceInterval), agreementGroupId strategy, separate lines table, numeric(12,2) money columns, snapshot model, version chain and Supabase structure are locked. Next step: proceed to implementation/migration only after this updated Development Center entry is confirmed. Do not start migration until the locked schema has been recorded (now recorded). " +
      "TIME BANK TEMPLATE RULE BINDING (Phase 8 · ready for integration — foundation built): When creating a Customer Agreement from a template, Time Bank rules are snapshot-copied from the template's advisory `TimeBankTemplateRules` into the agreement's authoritative values via `createAgreementTimeBankSnapshot()`. After this call the agreement OWNS the rules independently — template changes never affect existing agreements. See Agreement Template Foundation entry and Time Bank Architecture entry for the binding model. CORE RULE: templates suggest; agreements own; no live-linking; entitlement gate must still be applied before wallet creation.",
    targetRelease: "Future Billing Phase",
    updatedAt: SEED_DATE,
  },
  {
    key: "customer_agreement_migration_harness",
    name: "Customer Agreement Migration Validation Harness",
    description:
      "First-line, CI-safe validation harness for the Customer Agreement migration + shadow-read bridge. Runs the real migrateCustomerAgreements() → shadowReadCustomerAgreements() round-trip against seeded fixtures and an in-memory mocked Supabase client — no browser, localStorage, env, network, or real Supabase dependencies. Validation / Tooling. Status: PASS / Ready.",
    category: "System",
    status: "production_ready",
    ownerArea: "Platform / Engineering",
    dependencies: ["customer_agreement"],
    relatedFeatures: [
      "migrateCustomerAgreements() round-trip",
      "shadowReadCustomerAgreements() integrity check",
      "Synthetic agreement derivation",
      "Parent-before-child upsert ordering",
      "Chunking (>200 agreements) validation",
      "Dry-run (writtenCount=0) validation",
      "Write/upsert failure handling (failTable)",
      "Drift / self-healing verification",
      "Mismatch & version-chain anomaly detection",
      "Missing customer / missing service / extra-in-Supabase reporting",
      "Scope isolation (company scoping, multi-company, null companyId)",
      "In-memory mocked Supabase client + typed shared fixtures",
    ],
    supabaseStatus: "not_applicable",
    localStorageStatus: "not_applicable",
    rlsStatus: "not_applicable",
    permissionStatus: "not_applicable",
    activityLogStatus: "not_applicable",
    entitlementStatus: "not_applicable",
    apiStatus: "not_applicable",
    aiStatus: "not_applicable",
    languageStatus: "not_applicable",
    testStatus: "complete",
    releaseReadiness: "verified",
    migrationStatus: "not_applicable",
    notes:
      "Status: PASS / Ready. Category: Validation / Tooling (registry enum: System). Purpose: first-line CI validation harness for Customer Agreement migration and shadow-read integrity. " +
      "Files: src/lib/data/customerAgreementHarness.ts (harness + in-memory mocked Supabase client + typed fixtures), src/lib/data/customerAgreementHarness.test.ts (22 tests, hardened from 11). " +
      "Validates: migration logic, bridge behaviour, synthetic agreement derivation, parent-before-child ordering, chunking across >200 agreements, dry-run (no writes, writtenCount=0, still reports success), upsert/write-failure handling (ok=false + report.error + correct writtenCount + abort), drift detection and self-healing re-migration, mismatch detection, version-chain anomalies, missing-customer / missing-service / extra-in-Supabase / orphaned-remote reporting, and scope isolation (company-scoped getDetail rejection, multi-company, null companyId). " +
      "Isolation: no browser APIs, no localStorage, no environment variables, no network requests, no real Supabase client. Guarded so it can never write to production Supabase. Runs in Node/CI without a browser session. " +
      "LIMITATION (explicit): this validates migration LOGIC, not INFRASTRUCTURE. It does NOT replace real Supabase / RLS / auth-session / live company-scoping validation, which remains a separate staging / pre-production responsibility before any Customer Agreement activation. " +
      "Maintenance: keep harness fixtures and the mocked Supabase query surface in sync with the real supabaseCustomerAgreementRepository and migration bridge whenever those change; re-run the suite before any migration-rule change reaches staging. Registration only — no production migration behaviour changed.",
    updatedAt: SEED_DATE,
  },
  {
    key: "supabase_migration_runbook",
    name: "Supabase Migration Runbook (0006–0016)",
    description:
      "Discoverability pointer to the prepared manual Supabase migration package. Migration execution is STILL PENDING — manual SQL Editor execution is the selected path and final approval is still required before running anything. Runbook lives at web-cleanops/docs/manual-migration-runbook.md.",
    category: "System",
    status: "blocked",
    ownerArea: "Platform / Engineering",
    dependencies: ["customer_agreement", "time_bank", "agreement_templates"],
    relatedFeatures: [
      "Manual migration runbook (web-cleanops/docs/manual-migration-runbook.md)",
      "Per-migration SQL blocks 0006 → 0016",
      "Per-migration verification SQL + REST checks",
      "Stop conditions between steps",
      "Final PostgREST schema cache reload (NOTIFY pgrst, 'reload schema')",
      "Final validation checklist",
    ],
    supabaseStatus: "not_started",
    localStorageStatus: "not_applicable",
    rlsStatus: "not_started",
    permissionStatus: "not_applicable",
    activityLogStatus: "not_applicable",
    entitlementStatus: "not_applicable",
    apiStatus: "not_applicable",
    aiStatus: "not_applicable",
    languageStatus: "not_applicable",
    testStatus: "not_applicable",
    releaseReadiness: "not_ready",
    migrationStatus: "not_started",
    notes:
      "Status: migration_runbook_prepared_pending_manual_execution. " +
      "WHERE: the complete manual-execution package is web-cleanops/docs/manual-migration-runbook.md. " +
      "STATE: migration execution is STILL PENDING — no migrations have been run against the live database. " +
      "SELECTED PATH: manual execution in the existing Supabase SQL Editor (no privileged execution channel exists through Rork for the externally-managed live project). " +
      "SCOPE: migrations 0006 through 0016 are prepared for STRICTLY SEQUENTIAL, one-at-a-time execution; verification (table existence + REST 200 + RLS + no errors) is REQUIRED after each migration before continuing. " +
      "HARD EXCLUSION: 0001_schema_plan must NOT be executed (plan-only file; would create thinner/conflicting versions of operational tables). " +
      "APPROVAL GATE: final approval is still required before running anything — this entry is a discoverability note only; it does not authorize, execute, or change any migration SQL, feature flags, or environment variables.",
    updatedAt: SEED_DATE,
  },
  {
    key: "pricing_engine",
    name: "Pricing & Agreement Adjustment Engine",
    description:
      "Future bulk pricing/agreement adjustment tooling: increase prices by amount or percentage with filters, impact preview, agreement versioning and bulk customer agreement updates. Roadmap only — no implementation.",
    category: "Billing",
    status: "planned",
    ownerArea: "Super Admin / Company Admin",
    dependencies: ["customer_agreement"],
    relatedFeatures: [
      "Increase prices by amount",
      "Increase prices by percentage",
      "Filter by service",
      "Filter by category",
      "Filter by customer type",
      "Preview impact before applying",
      "Agreement versioning",
      "Bulk customer agreement updates",
    ],
    supabaseStatus: "not_started",
    localStorageStatus: "not_applicable",
    rlsStatus: "not_started",
    permissionStatus: "not_started",
    activityLogStatus: "not_started",
    entitlementStatus: "planned",
    apiStatus: "not_started",
    aiStatus: "not_started",
    languageStatus: "planned",
    testStatus: "not_started",
    releaseReadiness: "not_ready",
    migrationStatus: "not_started",
    notes:
      "Status: Planned / Not Started. Roadmap registration only — no implementation. " +
      "Dependency: Customer Agreement Foundation (must exist first). " +
      "Future capabilities: increase prices by amount, increase prices by percentage, filter by service / category / customer type, preview impact before applying, agreement versioning, bulk customer agreement updates. " +
      "Architecture note: adjustments operate on Customer Agreement lines (the authoritative commercial source) and MUST create new agreement versions — they must never overwrite historical commercial terms or already-generated invoice/time-bank/statistics rows. No implementation has begun.",
    targetRelease: "Future Billing Phase",
    updatedAt: SEED_DATE,
  },
  {
    key: "customer_type_taxonomy",
    name: "Customer Type Taxonomy",
    description:
      "Stable, governed customer classification (fixed CustomerType enum + derived CustomerSegment, never free-text) for filtering, pricing, statistics and automation. Foundation ALREADY EXISTS — scope is extend & normalize, not create from scratch. Required before the Pricing & Agreement Adjustment Engine can safely filter by customer type.",
    category: "Directory",
    status: "partial",
    ownerArea: "Super Admin / Company Admin",
    dependencies: ["customers"],
    relatedFeatures: [
      "CustomerType governed enum (exists, active)",
      "CustomerSegment derived axis (exists, active)",
      "Extend enum: housing_association, municipality, other",
      "OPEN DECISION: special_services — keep as CustomerType or move to Agreement/Service classification?",
      "Private vs business customer",
      "RUT eligibility grouping",
      "Pricing adjustment filters",
      "Invoice behavior",
      "Agreement templates",
      "Statistics segmentation",
      "AI recommendations",
      "Package / feature targeting",
      "Deprecate SettingsData.customerTypes (legacy free-text)",
    ],
    supabaseStatus: "not_started",
    localStorageStatus: "not_applicable",
    rlsStatus: "not_started",
    permissionStatus: "not_started",
    activityLogStatus: "not_started",
    entitlementStatus: "planned",
    apiStatus: "not_started",
    aiStatus: "not_started",
    languageStatus: "planned",
    testStatus: "not_started",
    releaseReadiness: "not_ready",
    migrationStatus: "not_started",
    notes:
      "Status: PARTIAL — the governed foundation already exists; scope is EXTEND & NORMALIZE, not create from scratch. " +
      "Current state (grounded in code): `CustomerType` is a fixed hardcoded enum (commercial | private | one_time | special_services) with CUSTOMER_TYPES / CUSTOMER_TYPE_LABELS / CUSTOMER_TYPE_DESCRIPTIONS, mandatory on create, normalized on read (customerType.ts). `CustomerSegment` (b2b | b2c | one_time) already exists and is DERIVED from CustomerType via segmentForCustomerType — not edited directly. Both are active and persisted (customer_type column). " +
      "Planned extension: add three governed values to the CustomerType enum — `housing_association` (Housing Association / BRF), `municipality` (Municipality), and `other` (Other). " +
      "Explicitly EXCLUDED from CustomerType: `property_manager` and `framework_agreement` are NOT customer types. A property manager is an invoice-recipient / contact role (belongs to the future InvoiceRecipient entity), and a framework agreement is a commercial construct (belongs to Customer Agreement), not a classification of the customer itself. " +
      "Legacy deprecation: `SettingsData.customerTypes` (free-text SettingsItem list) is LEGACY/DEPRECATED for business logic — it must not drive pricing, RUT, invoice rules or agreement templates. The governed `CustomerType` enum is the single source of truth; the settings list is retained only for backwards-compatible persisted data and is being removed from the Settings categories surface. " +
      "Architectural decision: pricing/automation logic MUST rely on the stable enum (+ derived segment), never free-text labels, so historical rows and filters stay deterministic. CustomerSegment stays separate from and derived by CustomerType; internal grouping uses tags/segments, never the type enum. " +
      "=== OPEN DESIGN DECISION (must be reviewed BEFORE extending the CustomerType enum with housing_association / municipality / other) === " +
      "Decision: should `special_services` remain a CustomerType, or should it be moved to Agreement / Service classification later? " +
      "Context: special_services is currently part of the fixed CustomerType enum, but NO existing seed/mock customers use it (verified — only `commercial` appears in seed data). It appears to represent specialized service WORK (floor care, sanitization, custom service packages) rather than a classification of the customer. This may be better expressed through Service Category, Service Basis Type, Agreement Template, Customer Agreement Line, or customer tags/segments. " +
      "Resolution policy (NOT to be acted on now): do NOT remove special_services now; do NOT migrate it now. Keep it as legacy / forward-compatible until the Customer Agreement and Agreement Template implementation phase, when this decision is to be resolved. The enum extension (housing_association, municipality, other) must not proceed until this decision has been reviewed.",
    targetRelease: "Future Billing Phase",
    updatedAt: SEED_DATE,
  },
  {
    key: "agreement_versioning",
    name: "Agreement Versioning Foundation",
    description:
      "The versioning & snapshot contract for Customer Agreement and Agreement Lines: price/billing-model/frequency/service changes create new versions, superseded versions stay readable, and generated rows reference/snapshot the producing version. Foundation LOGIC LAYER + PERSISTENCE WRITE PATH built (pure resolver/version-creation module + repository version write + persistence orchestration, all harness-validated) — no live activation, no production-authoritative flip.",
    category: "Billing",
    status: "in_progress",
    ownerArea: "Super Admin / Company Admin",
    dependencies: ["customer_agreement"],
    relatedFeatures: [
      "Agreement version records",
      "Immutable historical terms",
      "Version-on-price-change",
      "Version-on-billing-model-change",
      "Version-on-frequency/service-change",
      "Current-version resolver",
      "Active-on-date (historical) resolver",
      "Supersede + line snapshot helpers",
      "Version-chain integrity validation",
      "normalizeToVersionOne compatibility helper",
      "TimeBankWallet binds to agreementGroupId (proven)",
      "Snapshot references on generated rows",
      "Readable superseded versions",
      "Repository version write path (upsertVersions / upsertLines)",
      "Version persistence orchestration (persistAgreementVersion / persistNewAgreementVersion)",
      "End-to-end create→persist→read→resolve validation",
      "Idempotent re-persist (drift self-heal)",
      "Dry-run persistence",
    ],
    supabaseStatus: "partial",
    localStorageStatus: "not_applicable",
    rlsStatus: "partial",
    permissionStatus: "not_started",
    activityLogStatus: "not_started",
    entitlementStatus: "planned",
    apiStatus: "not_started",
    aiStatus: "not_started",
    languageStatus: "planned",
    testStatus: "complete",
    releaseReadiness: "not_ready",
    migrationStatus: "not_applicable",
    notes:
      "Status: IN PROGRESS — foundation LOGIC LAYER + PERSISTENCE WRITE PATH built and harness-validated; NOT activated. No live flag rollout, no production-authoritative flip, no customer activation, no live migration. " +
      "PERSISTENCE LAYER (added): src/lib/data/customerAgreementRepository.ts now exposes a foundation write path — upsertVersions() / upsertLines() (chunked, idempotent on legacy_id, byte-identical to the migration mappers). src/lib/data/agreementVersionPersistence.ts orchestrates it: persistAgreementVersion() (one version + line snapshots) and persistNewAgreementVersion() (full supersede flow — createNewAgreementVersion → snapshotLinesForNewVersion → write superseded prior + new live version parents-first, then new line snapshots), resolving the tenant UUID via loadCompanyUuidMap, with dryRun support and structured PersistVersionReport. src/lib/data/agreementVersionPersistence.test.ts (11 end-to-end harness tests: create→persist→read→resolve current/historical/chain across v1→v2 and v1→v2→v3, immutable historical snapshots, agreementGroupId continuity, idempotent self-heal, write-failure abort, missing-tenant abort, state-machine throw, dry-run, company scoping). The write path is foundation only — NOT wired to any UI and performs no activation. Schema 0013 compatibility verified: rows route through the existing upsert mappers; the prior version is only touched by the supersede flip (status→superseded, supersededById, updatedAt). " +
      "RLS REVIEW: the write path satisfies migration 0013's company-scoped policies by carrying the real company_id UUID (resolved from loadCompanyUuidMap); INSERT/UPDATE are allowed within own company (or super_admin), DELETE stays blocked (versions are superseded, never deleted). Live RLS enforcement, real authenticated sessions and real company scoping are NOT exercised by the in-memory harness and remain a staging / pre-production responsibility. " +
      "Files: src/lib/data/agreementVersioning.ts (pure resolver + version-creation module), src/lib/data/agreementVersioning.test.ts (unit tests), src/lib/data/agreementVersioningHarness.test.ts (version-chain shadow harness). Builds on the LOCKED Customer Agreement schema (migration 0013) which already carries all versioning columns (agreementGroupId, 1-based version, supersedesVersionId/supersededById, status state machine, immutable line snapshots) — no new tables added. " +
      "Delivered: status helpers (isTerminalStatus / isLiveStatus / canBeSuperseded), resolvers (listVersionsForGroup, findVersionById, resolveCurrentVersion, resolveVersionActiveOn), createNewAgreementVersion (supersede without mutating history), snapshotLinesForNewVersion (immutable line snapshots), diffRequiresNewVersion (price/billing/frequency/service force a new version; name/notes/validTo-extension are in-place), normalizeToVersionOne (existing agreements become v1 — pure, no live migration), validateVersionChain (sequence/single-live/link integrity), timeBankWalletBindingKey (proves the wallet binds to agreementGroupId, NOT a version id), and async resolveCurrentVersionForGroup / resolveVersionActiveOnForGroup composing the existing repository read surface. " +
      "LIMITATION (explicit): logic + persistence layer only — not wired to any UI, no activation. Validation is in-memory (harness) only; real Supabase infrastructure, RLS enforcement and authenticated sessions are NOT validated here and remain a staging / pre-production round-trip responsibility. The future TimeBankWallet is NOT implemented; Time Bank may now BEGIN its foundation work (Customer Agreement + Agreement Versioning logic + persistence are built and validated) but Time Bank itself stays not-activated. " +
      "Purpose: define the versioning and snapshot contract for Customer Agreement and Agreement Lines. Required by: Customer Agreement Foundation, Pricing & Agreement Adjustment Engine, Time Bank, Invoice Basis, Invoice Journal, Statistics, RUT handling, future customer portal. " +
      "Purpose: define the versioning and snapshot contract for Customer Agreement and Agreement Lines. Required by: Customer Agreement Foundation, Pricing & Agreement Adjustment Engine, Time Bank, Invoice Basis, Invoice Journal, Statistics, RUT handling, future customer portal. " +
      "Architecture decisions: (1) Agreement changes MUST NOT overwrite historical terms. (2) Price changes create a new agreement version. (3) Billing-model changes create a new agreement version. (4) Recurrence/duration changes MAY create a new version depending on impact. (5) Historical invoice/time-bank/statistics rows must reference or snapshot the agreement version that produced them. (6) Superseded versions remain readable. (7) Future generated rows must store snapshots and MUST NEVER depend on mutable agreement values at read time. No implementation has begun. " +
      "=== FINAL IMPLEMENTATION CONTRACT (locked — relates to Agreement Status State Machine, see Customer Agreement Foundation CONTRACT 3) === " +
      "Versioning <> status interaction: a new agreement version may ONLY supersede a prior version whose status is active or paused. Superseding sets the prior version's status to `superseded` (terminal) and carries forward agreementGroupId; the new version receives its own agreement id and supersedesVersionId / supersededById links. Terminal statuses (superseded, cancelled, ended) can never be superseded or returned to active. In-place edits that do NOT create a new version: notes, internal name/metadata, and validFrom/validTo extensions when commercial terms are unchanged.",
    targetRelease: "Future Billing Phase",
    updatedAt: SEED_DATE,
  },
  {
    key: "time_bank",
    name: "Time Bank Architecture",
    description:
      "Transaction-based minute wallet for recurring cleaning/home-service customers: Customer → CustomerAgreement → agreementGroupId → TimeBankWallet → TimeBankTransaction. Wallet binds to agreementGroupId so it survives versioning, price changes and line changes. FOUNDATION LOGIC LAYER + PERSISTENCE WRITE PATH + REFILL ENGINE built (immutable ledger core + Supabase tables (migration 0014) + repository read/write + idempotent persistence orchestration + pure refill/carryover/expiry/warning planner, all harness-validated) — append-only ledger, no stored balance, no scheduler/cron, no UI, no activation. ENTITLEMENT INTEGRATION wired: 'time_bank' is now a registered ServiceFeatureKey (premium add-on — globally available, company-disabled by default) and Time Bank access is resolved entirely through the real bundle-first entitlement resolver. The Template→Agreement orchestration gate is connected to that resolver (createTimeBankEntitlementGate), so a wallet is only provisioned when a bundle grant or company override entitles Time Bank; otherwise the agreement is still created with Time Bank suppressed and the structured denial reason recorded. Recommended bundle model: Time Bank is an ADD-ON capability (boolean grant) with allocation/refill caps owned by the agreement; future bundle-controlled allocation/refill limits are declarable as registry limits when needed. Not verified (pending real Supabase/RLS/session validation); no UI, no billing, no activation.",
    category: "Billing",
    status: "built",
    ownerArea: "Super Admin / Company Admin",
    dependencies: ["customer_agreement", "agreement_versioning", "entitlements"],
    relatedFeatures: [
      "TimeBankWallet (one active per agreementGroupId)",
      "TimeBankTransaction ledger (signed integer minutes)",
      "Immutable transaction-ledger architecture (no stored balances)",
      "Balance derivation (current / reserved / available)",
      "Historical balance reproduction (as-of date)",
      "Wallet statuses: active / frozen / closed",
      "State-machine write gates (frozen honors reservations)",
      "Negative balance floor enforcement",
      "Reservation warning thresholds (percent + absolute fallback)",
      "Wallet binds to agreementGroupId (proven across version chain)",
      "Manual adjustments (audited)",
      "Cancellation / reschedule consumption",
      "Carryover / expiry policy (planning helper)",
      "Cancelled-visit credit (single net-credit transaction with full audit breakdown)",
      "Configurable cancellation deduction (none / fixed minutes / percentage)",
      "Refill Engine: scheduled accrual planning (weekly / monthly / quarterly / yearly / manual / disabled)",
      "Idempotent refill planning (deterministic per-period id — no duplicate-period credits)",
      "Carryover at refill (unlimited / capped trim / no_carryover reset) as append-only expiry",
      "Time-based expiry (FIFO lot age expiry + period-boundary expiry)",
      "Derived warnings (low-balance / negative-balance / expiring-soon)",
      "Plan/execute orchestration split (plan reads only; execute appends idempotently)",
      "Monthly Time Bank statements (statistics aggregation)",
      "Billable / non-billable + by-category usage breakdown",
      "Supabase persistence (migration 0014: time_bank_wallets + append-only time_bank_transactions)",
      "Company-scoped RLS (wallets read/write; transactions SELECT+INSERT only)",
      "Repository read/write surface (upsertWallets / appendTransactions / wallet+ledger reads)",
      "Idempotent wallet creation per agreementGroupId",
      "Idempotent / re-runnable transaction append + opening balance",
      "Persisted balance derivation (current / reserved / available / as-of / statement)",
      "Wallet continuity proven across persisted v1→v2→v3 version chain",
      "Registered ServiceFeatureKey 'time_bank' (premium add-on: global-on, company-off by default)",
      "Access decided through the real bundle-first entitlement resolver (base / add-on / override)",
      "Structured entitlement decision (status / source / contributing bundles / denial reason) surfaced in creation reports",
      "Orchestration gate connected to the real resolver — templates can never bypass entitlements",
      "Opening Balance (dedicated `opening_balance` ledger type — single, append-only, balance-affecting)",
      "Legacy History Notes (informational only — separate table, never balance-affecting)",
      "Migration/onboarding: opening balance + pasted legacy history, balance derived from ledger only",
    ],
    supabaseStatus: "complete",
    localStorageStatus: "not_applicable",
    rlsStatus: "complete",
    permissionStatus: "not_started",
    activityLogStatus: "not_started",
    entitlementStatus: "complete",
    apiStatus: "not_started",
    aiStatus: "not_started",
    languageStatus: "planned",
    testStatus: "complete",
    releaseReadiness: "not_ready",
    migrationStatus: "built",
    notes:
      "MOUNTED ON FIRST HOST PAGE (Phase 14 · admin-only, NOT verified, NOT customer-facing): the Time Bank admin panel is now mounted on the first Customer Agreement detail page (src/pages/admin/CustomerAgreementDetail.tsx, route /agreements/:agreementId, requirePermission='users.manage'). The page loads the agreement + lines + version chain via the read-only useCustomerAgreementDetailSource hook and resolves the company's Time Bank entitlement through the real pipeline (resolveTimeBankEntitlement) before passing it to useTimeBankPanel. Behaviour: entitled + wallet ⇒ full panel; entitled + no wallet ⇒ no-wallet info; denied ⇒ disabled read-only panel (no wallet ever created from the page). No nav link yet (no agreement list page exists) — to be linked from a future Customer Agreements list / Customer Card. Still no customer portal, scheduler or billing. Tests: src/pages/admin/CustomerAgreementDetail.test.tsx (7) + src/hooks/use-customer-agreement-detail-source.test.tsx (4). " +
      "FIRST ADMIN UI PANEL (Phase 13 · admin UI foundation only; NO customer portal, NO scheduler/cron, NO billing/payroll wiring, NO activation, NOT verified). The first Time Bank UI surface is built as a self-contained, reusable admin panel intended for the Customer Agreement detail view (no such page exists yet, so the panel is not yet mounted on a route). src/lib/data/timeBankPanelModel.ts is the PURE view-model: buildTimeBankPanelModel(input) assembles visibility/disabled state, entitlement display (allowed/status/source/contributing bundles/denial reason), wallet summary (status + current/reserved/available derived from the immutable ledger + low-balance warning via evaluateReservationWarning + overdraft flag + opening-balance minutes), read-only rules display, cancellation-credit display, opening-balance presence, chronologically-ordered ledger rows (with the cancellation breakdown surfaced for admin/audit), and legacy notes — plus formatMinutes/parseHoursMinutes and the SAFETY GATES (gateCreateOpeningBalance enforces at-most-one via validateSingleOpeningBalance + canRecordTransaction; gateAddAdjustment honours the frozen/closed state machine; gateAddLegacyNote needs only a wallet). src/components/customer/TimeBankAdminPanel.tsx renders all sections and emits the small safe actions via optional callbacks (onCreateOpeningBalance, onAddAdjustment, onAddLegacyNote, onSetWalletStatus). SAFETY: the panel NEVER creates a wallet (entitlement governs creation elsewhere) — a denied/no-wallet case renders read-only/disabled; no edit/delete of ledger rows (corrections go through adjustments); a second opening balance is impossible; legacy notes stay strictly informational and never enter balance derivation. Tests: src/lib/data/timeBankPanelModel.test.ts (19) + src/components/customer/TimeBankAdminPanel.test.tsx (16 RTL) cover visibility/disabled, balance rendering, opening-balance creation + duplicate prevention + validation, legacy-note creation + balance separation, adjustment gating (frozen blocked), cancellation display, frozen/closed display, no-wallet-when-denied and absence of dangerous mutation controls. Not customer-facing, not verified, no scheduler/billing/portal. " +
      "VERSION-CHAIN CONTINUITY VALIDATION (Phase 12 · cross-layer validation only; NO code/behaviour change, NO status change, NO UI, NO activation): src/lib/data/timeBankVersionContinuity.test.ts is the dedicated end-to-end proof that wallet continuity holds through the COMPLETE real stack (orchestration + persistence + versioning), not just indirect unit slices. Flow exercised: persisted Template → createCustomerAgreementFromTemplate (entitled) → Agreement v1 + wallet → opening balance + monthly_refill + cancelled_visit_credit + manual_remove + legacy note → persistNewAgreementVersion v2 (pricing) → v3 (service lines) → v4 (Time Bank settings) → ensureWalletForAgreement on every new version. ASSERTED: exactly ONE wallet for the whole chain (verified across 12 versions too), wallet binds to agreementGroupId and NEVER a version id (walletMatchesAgreementChain), all ledger history + legacy notes stay attached to the same wallet, derived balance reproducible + unchanged by versioning (legacy notes never affect it), template mutation/archival after creation never touches wallet or chain, a later entitlement loss does NOT delete the wallet/history (the gate governs CREATION only — reads + audit stay reproducible; new refills would simply not be auto-provisioned via the gated orchestration path), and a FAILED version write never orphans/duplicates the wallet (ensure stays idempotent per group). 7 tests pass; 306 Time Bank/agreement tests green; build green. No remaining behaviour gap for this invariant. " +
      "OPENING BALANCE & LEGACY HISTORY (Phase 11 · migration/onboarding foundation only; no UI, no activation, no real data import). === PRINCIPLE === Opening balance and historical information are STRICTLY SEPARATED: only LEDGER TRANSACTIONS may affect a wallet balance; informational history never does. === OPENING BALANCE === New dedicated ledger type `opening_balance` (added to TimeBankTransactionType enum + lists/labels + migration 0014 type CHECK + SIGNED_TYPES so the value applies as-is; transactionKind → 'migration' for statistics). It represents the STARTING balance imported into CleanOps, is append-only/immutable/auditable, affects the wallet balance like any entry, and is expected AT MOST ONCE per wallet. src/lib/data/timeBankMigration.ts: buildOpeningBalanceTransaction (deterministic id `${walletId}-opening` → idempotent re-import), openingBalanceTransactionId, findOpeningBalances/hasOpeningBalance, validateSingleOpeningBalance (rejects a SECOND opening balance — a true correction must go through correction/manual_* so the audit trail records WHY). Stores importedBy (actorId), importedAt (effectiveAt/createdAt), optional note (reason) and optional sourceReference (sourceWorkOrderId). recordOpeningBalance now writes `opening_balance` (was `migration`) with enforceSingle (default true: reads the ledger first, rejects a different second opening balance, while a SAME-id re-run stays an idempotent no-op). buildStatement adds openingBalanceMinutes (kept SEPARATE from migrationMinutes) so customer-facing statements can label 'Opening Balance' distinctly. === LEGACY HISTORY NOTES === New type TimeBankLegacyHistoryNote (id, walletId, agreementGroupId, companyId, note free-text/multiline, importedBy?, importedAt?, sourceSystem?, attachments? for FUTURE document support, createdAt) — deliberately a DIFFERENT type from TimeBankTransaction so it can NEVER enter balance/statement/warning/refill/expiry/carryover. buildLegacyHistoryNote + validateLegacyHistoryNote (only hard rule: non-empty text). Persistence: migration 0016 adds time_bank_legacy_notes (NO `minutes` column by design; company-scoped RLS SELECT+INSERT only, no UPDATE/DELETE — immutable like the ledger). Repository: insertLegacyNotes (idempotent on legacy_id) / listLegacyNotes; persistence recordLegacyHistoryNote (validates, resolves tenant UUID, dryRun, idempotent). === REPORTING === buildAdminHistoryView returns ledger + legacyNotes kept distinct (admin/audit sees both, clearly separated); buildCustomerHistoryView returns the ledger (incl. Opening Balance) and HIDES raw legacy notes unless includeLegacyNotes is set. === BALANCE SAFETY === proven: opening balance + transactions derive correctly; legacy notes never change balance/warnings/expiry/refill (structurally impossible — they are not transactions). === TESTS === src/lib/data/timeBankOpeningBalance.test.ts (14: opening balance affects balance, negative opening, opening+tx derivation, statement visibility, single-opening enforcement, deterministic id, notes-don't-affect balance/warnings/expiry/refill, note validation, multiline+attachments, customer vs admin views) + src/lib/data/timeBankMigration.persistence.test.ts (7: persisted single opening_balance drives balance + statement, reject different second opening, same-id idempotent no-op, notes in separate table never touch ledger, multiple notes read-back, empty-note rejection, full migration/onboarding scenario). All 167 Time Bank tests pass. No UI, no activation, no real customer data import, no billing wiring. " +
      "TEMPLATE → AGREEMENT ORCHESTRATION WALLET PROVISIONING (Phase 10 · foundation only; no UI, no scheduler, no activation): src/lib/data/agreementTemplateOrchestration.ts · createCustomerAgreementFromTemplate() may now provision a wallet at agreement creation, but ONLY when the agreement's Time Bank snapshot requests it (allocationMinutes>0) AND an INJECTED entitlement gate allows it (omitted/denied gate ⇒ agreement still created, NO wallet — no hidden activation). Wallet creation reuses ensureWalletForAgreement (idempotent per agreementGroupId, binds to the stable group id) and appends NO refill (scheduler stays inactive). The cancellation credit policy is carried in the snapshot only — no transaction at creation. 19 harness tests pass. See agreement_templates. " +
      "CANCELLATION CREDIT RULES (Phase 7 · business-rule & transaction model — foundation only; no UI, no billing wiring, no activation). === PRINCIPLE === When a scheduled visit is cancelled, the remaining visit time (after a configured deduction) is transferred into the customer's Time Bank as ONE net-credit ledger entry — NEVER as a customer-visible 'duration minus cancellation fee' pair. Example: 4h scheduled, 1h deduction → customer sees a single 'Cancelled Visit Credit +3h'. === TRANSACTION MODEL === New ledger type `cancelled_visit_credit` (added to TimeBankTransactionType enum + migration 0014 CHECK + POSITIVE_TYPES so its minutes are always a positive net credit; transactionKind → 'accrual' for statistics). The entry stores `minutes = creditedMinutes` (the net, customer-facing value) plus a `cancellationCredit: TimeBankCancellationCredit` breakdown { originalVisitMinutes, deductionMethod, deductionValue, deductionMinutes, creditedMinutes, cancellationReason } so the AUDIT trail retains the full calculation while customer views render only the net '+X minutes'. Source visit/work-order linkage reuses the existing sourceWorkOrderId / sourceOccurrenceId / sourceAgreementVersionId audit fields. === DEDUCTION RULES === TimeBankCancellationDeductionMethod = none (full credit) | fixed (deduct N minutes) | percentage (deduct P% of duration, 0–100). calculateCancellationCredit(originalVisitMinutes, policy) is PURE + integer-only: percentage is rounded to whole minutes, the deduction is never larger than the visit, and the credit is clamped to [minCreditMinutes, originalVisitMinutes]; returns null when disabled and the builder returns null when the net credit is 0. === SETTINGS MODEL === TimeBankCancellationPolicy { enabled, deductionMethod, deductionMinutes?, deductionPercent?, minCreditMinutes? }; validateCancellationPolicy enforces non-negative integer fixed minutes, integer 0–100 percent, non-negative minCreditMinutes (a disabled policy is always valid). defaultCancellationPolicy() = enabled + full credit (customer-friendly default). === AGREEMENT/TEMPLATE COMPATIBILITY (recommendation) === Model as COMPANY-LEVEL DEFAULT + AGREEMENT-LEVEL OVERRIDE (mirrors TimeBankRules): the company sets a default cancellation policy; Agreement Templates may carry a suggested policy that is SNAPSHOT-COPIED into the Customer Agreement at creation; the Customer Agreement value (when set) is authoritative for that wallet. Recommended company default: ENABLED + FULL CREDIT (none), letting stricter companies opt into fixed/percentage deductions. === STATE MACHINE === cancelled_visit_credit is blocked on frozen + closed wallets (frozen accrues nothing new, consistent with refills/adjustments); allowed only on active wallets via canRecordTransaction. === STATISTICS/REPORTING === credits surface in statements under the 'accrual' kind but remain individually identifiable by the granular `cancelled_visit_credit` type; statements/customer history show the net credit, admin/audit show the breakdown; future payroll/billability reads the same auditable ledger (no destructive updates, balances remain reproducible). DEV CENTER RECOMMENDATION: documentation + foundation transaction model only — status stays BUILT (not verified, not activated); no UI, no billing, no live migration. Files: src/types/index.ts, src/lib/data/timeBank.ts, src/lib/data/timeBankCancellation.test.ts, supabase/migrations/0014_time_bank.sql, src/lib/data/index.ts. " +
      "BUSINESS RULE LAYER (Phase 6 · operating model — architecture & business-rule review ONLY; no code, no UI, no billing wiring, no activation). === PRODUCT MODEL === A Time Bank is a PREPAID POOL OF SERVICE MINUTES attached to a recurring service relationship (a Customer Agreement group), spendable on work that falls OUTSIDE the agreement's fixed recurring scope (extra cleaning, ad-hoc visits, admin support, service recovery, quality follow-up, goodwill). It is NOT a discount, NOT money, NOT a refundable deposit — it is a minute ledger only (money ledger stays separate, LOCKED decision 6). ELIGIBILITY: only agreements whose billingModel is time_bank or hybrid may own a live wallet; per_visit / monthly_fixed agreements may hold a frozen/zero wallet for history but accrue nothing. OPTIONALITY: Time Bank is OPT-IN per agreement (default OFF) — it is enabled by the agreement's billing model + the company's entitlement, never auto-created for every customer. AGREEMENT TEMPLATE INTERACTION: templates may carry suggested TimeBankRules (allocation/refill/carryover/expiry) that are SNAPSHOT-COPIED into the Customer Agreement at creation (templates are not contracts); allocationMinutes on the agreement is authoritative (decision 7), template values are advisory. === ALLOCATION MODEL (recommendation) === Supported: fixed monthly (recommended DEFAULT — predictable accrual, easy budgeting, matches monthly_fixed billing rhythm; con: unused minutes pressure carryover policy), fixed quarterly/yearly (fewer ledger events, better for low-touch enterprise contracts; con: large lump grants amplify carryover/expiry exposure and refund disputes), one-time/manual (best for project work or goodwill top-ups; con: no automatic replenishment — easy to forget), unlimited (NOT recommended as an allocation — defeats the prepaid-pool model and breaks billable-hours statistics; if 'all-inclusive' is wanted, model it as monthly_fixed billing WITHOUT a wallet, not as an unlimited wallet). RECOMMENDED DEFAULT: fixed MONTHLY allocation with unlimited carryover. === CONSUMPTION MODEL (recommendation) === Minutes are consumed only via append-only consumption transactions (visit_consumption / cancellation_consumption / reschedule_consumption) plus manual_remove for admin corrections; every consumption MUST carry serviceCategorySnapshot + billable flag so statements split usage by category and billable/non-billable (already supported by buildStatement). Business categories (extra cleaning, additional visits, administrative support, service recovery, quality follow-up, goodwill compensation) map to serviceCategorySnapshot and DO affect reporting (payroll/billable-hours/workload) but DO NOT change ledger math — they are reporting metadata, not separate balances (decision 1: one wallet, one balance). Goodwill/service-recovery should default billable=false; extra paid work billable=true. === CARRYOVER (recommendation) === unlimited (accrue forever — simplest, most customer-friendly), capped (trim above maxBalanceMinutes — protects against runaway liability), no_carryover (use-it-or-lose-it reset each period — maximizes revenue capture but worst customer goodwill). RECOMMENDED DEFAULT: UNLIMITED (matches LOCKED decision 8); offer capped for enterprise liability control. All three are append-only expiry entries — never balance rewrites. === EXPIRY (recommendation) === no expiry (default), rolling expiry (FIFO age-based, e.g. minutes older than 365 days expire — fair, predictable), calendar-boundary expiry (everything expires at period end — aggressive). RECOMMENDED DEFAULT: NO EXPIRY; if expiry is required for liability/accounting, prefer ROLLING (age-based FIFO) over calendar-boundary as it is fairer and less dispute-prone. === BILLING COMPATIBILITY (review) === Wallet binds to agreementGroupId so it survives versioning/price/line changes (decision 2); time ledger stays separate from money ledger (decision 6) — overage beyond the negative floor or paid top-ups must create a future invoice-intent row, never a balance edit. Compatible with fixed + recurring agreements (wallet rides alongside the recurring schedule), service packages (allocation can be package-derived), future invoicing (consumption + billable flag feed invoice basis), future payroll (non-billable consumption = internal cost), future statistics (by-category + billable split already in statements). No invoicing implemented. === PACKAGE COMPATIBILITY (review) === The platform has NO hardcoded Starter/Professional/Enterprise tiers — packaging is the ENTITLEMENT BUNDLE system (base_plan + add-on grants with limits). RECOMMENDATION: model Time Bank as a HYBRID — a capability gated by an entitlement grant (time_bank service key) that can ship inside a base_plan (e.g. higher tiers include it) OR be sold as a stand-alone add-on bundle; allocation limits (e.g. included monthly minutes) ride on entitlement_bundle_grant_limits. This keeps Time Bank packaging governed by the existing bundle resolver rather than a new tier enum. === STATISTICS / AUDIT (confirmation) === All balances are DERIVED from an append-only ledger (no stored balance), transactions are SELECT+INSERT only under RLS (no update/delete), every consumption carries actor + category + billable + source metadata — so all transactions remain auditable, statements remain reproducible, and historical balances remain reproducible as-of any instant (deriveBalanceAsOf). === DEV CENTER / VERDICT === No status change: remains BUILT (this phase added the documented operating model only). Verdict: PASS — business-rule layer defined; no activation, no UI, no billing integration performed. " +
      "REFILL ENGINE (added Phase 5 · pure planning layer, foundation only): src/lib/data/timeBankRefill.ts is a PURE, idempotent planner — NO writes, NO scheduler, NO cron, NO background job, NO UI, NO activation. planTimeBankRefill(wallet, transactions, periodDate) decides whether a refill is due and returns PLANNED (unwritten) entries: refillPeriodKey/refillPeriodStart key each refill on a deterministic per-period id (weekly 2026-W03 / monthly 2026-01 / quarterly 2026-Q1 / yearly 2026) so re-planning a period is a guaranteed no-op (never a duplicate-period credit); none=disabled and manual=one-time are never auto-scheduled; frozen/closed wallets block the refill via canRecordTransaction (decision 3). Carryover (decision 8) is expressed as APPEND-ONLY expiry entries, never balance rewrites: unlimited accrues, no_carryover expires the pre-refill leftover then credits the allocation, capped trims post-refill excess above maxBalanceMinutes. planTimeBankExpiry handles the `expiry` policy in two configured modes — age-based FIFO lot expiry (expiryAfterDays) via computeAgeExpiry, or period-boundary expiry of the carried positive balance when no age is set. evaluateWalletWarnings derives low-balance (reuses evaluateReservationWarning), negative-balance and expiring-soon signals (never stored). TimeBankRefillFrequency extended with `manual` + `yearly`; TimeBankRules gains expiryAfterDays. Orchestration (src/lib/data/timeBankPersistence.ts): planWalletRefill READS the persisted ledger + plans (no write); executeRefillPlan APPENDS the plan's entries idempotently via appendWalletTransaction — planning and write-execution are intentionally separate. src/lib/data/timeBankRefill.test.ts (29 tests: monthly/quarterly/yearly cadences, disabled/manual, idempotency + duplicate-period prevention, capped + no_carryover carryover, age + boundary expiry, threshold/negative/expiring warnings, frozen-block, closed-reject, v1→v2→v3 wallet continuity). No scheduler/cron/production job, no billing/payroll wiring, no activation. " +
      "Status: BUILT — FOUNDATION LOGIC LAYER + PERSISTENCE WRITE PATH + REFILL ENGINE built and harness-validated; NOT activated and NOT verified (verified requires real Supabase/RLS/authenticated-session staging). No UI, no feature flag, no production-authoritative flip, no customer rollout, no live migration. Depends on Customer Agreement Foundation + Agreement Versioning Foundation (both built + validated). " +
      "PERSISTENCE LAYER (added Phase 4): migration 0014 (supabase/migrations/0014_time_bank.sql) creates time_bank_wallets (one-per-agreementGroupId unique index, NO stored balance column — balance is always derived; flat scope columns + rules/data jsonb; active|frozen|closed check) and time_bank_transactions (APPEND-ONLY: signed-integer minutes with non-zero check, governed type enum check, effective_at for as-of reads, statistics columns + data jsonb). RLS mirrors 0013 via current_company_id()/is_super_admin(): wallets get company-scoped SELECT/INSERT/UPDATE (no DELETE); transactions get SELECT + INSERT ONLY (no UPDATE, no DELETE) so the ledger is immutable and history can never be rewritten or destroyed through normal app paths. src/lib/data/timeBankRepository.ts adds the row mappers + read/write surface: upsertWallets (idempotent on legacy_id), appendTransactions (upsert onConflict legacy_id with ignoreDuplicates → re-run is a NO-OP insert, never an UPDATE), getWalletByAgreementGroupId / getWalletById / listWalletsByCustomer / listWalletsByCompany / listTransactions (ordered by effective_at). src/lib/data/timeBankPersistence.ts orchestrates: ensureWalletForAgreement (IDEMPOTENT per agreementGroupId — reuses an existing wallet, never makes a second; binds to the stable group id, never a version id), appendWalletTransaction (gates type through canRecordTransaction, builds the immutable entry, appends idempotently; rejects non-integer minutes before any write), recordOpeningBalance (deterministic id → safely re-runnable migration entry), and readWalletBalance / readWalletBalanceAsOf / readWalletStatement (read persisted ledger, DERIVE balance in the logic layer — never stored). Tenant UUID resolved via loadCompanyUuidMap so RLS company_id FK is satisfied; dryRun supported; wallet (parent) written before transactions (children) so a failed wallet write leaves no orphan ledger rows. src/lib/data/timeBankPersistence.test.ts (18 end-to-end harness tests: wallet creation + idempotent reuse, append + effective_at ordering, balance derivation from reads, historical as-of, statement statistics, reserve→consume→release lifecycle, frozen honours consumption/blocks reservation, closed rejects all, duplicate-id prevention, re-runnable opening balance, wallet/transaction write-failure handling, non-integer rejection, cross-company scope isolation, and version-chain continuity v1→v2→v3 with ledger entries spanning versions). " +
      "SUPABASE INTEGRATION: schema 0014 is compatible with the 0013 customer_agreements wave and existing repository patterns (legacy_id idempotency key, company_legacy_id scope, real company_id UUID FK, flat columns + data jsonb, 200-row chunked upserts, perf.start instrumentation). Validated against the in-memory Supabase stand-in: inserts, idempotent re-inserts, scoped reads and full ledger reconstruction. " +
      "RLS REVIEW: wallets — company users read/write only their own company's wallets (super_admin all), no DELETE; transactions — company users read/insert only, NO update/delete for anyone, so ledger entries cannot be mutated or deleted through normal app paths. Missing/explicit gap: live RLS enforcement, real authenticated sessions and real cross-company denial are NOT exercised by the in-memory harness and remain a staging / pre-production responsibility before `verified`. " +
      "DEVELOPMENT CENTER RECOMMENDATION: promote in_progress → BUILT (persistence write path + schema + RLS designed and harness-validated). Do NOT mark verified until a staging/pre-production round-trip validates real Supabase infrastructure, live RLS and authenticated sessions. TIME BANK READINESS: Time Bank Foundation (logic + persistence) is complete; remaining work before activation is refill scheduling jobs + dated expiry, Customer Agreement billing-model transition wiring (auto freeze/close), UI and the staging verification — none performed here. " +
      "FOUNDATION DELIVERED (logic only): src/types/index.ts adds the domain model — TimeBankWallet (binds to agreementGroupId), TimeBankTransaction (append-only, signed integer minutes), TimeBankBalance (derived), TimeBankRules (allocation/refill/floor/carryover/thresholds), plus the locked enums TimeBankWalletStatus (active|frozen|closed), TimeBankTransactionType (monthly_refill, manual_add, manual_remove, visit_consumption, cancellation_consumption, reschedule_consumption, reservation, reservation_release, correction, expiry, migration) and TimeBankCarryoverPolicy. src/lib/data/timeBank.ts is the PURE immutable-ledger core: deriveBalance / deriveBalanceAsOf (no balance is ever stored — every balance is folded from the ledger, so historical balances are always reproducible and later entries never rewrite the past), normalizeMinutes (sign-by-type, integer-only — rejects floating-point hours), buildTransaction / buildWalletForAgreement (immutable builders; wallet binds to agreement.agreementGroupId, never a version id), walletMatchesAgreementChain (proves continuity across v1→v2→v3), canRecordTransaction (state machine: frozen honors existing reservations + consumption + corrections, blocks new reservations/refills/adjustments; closed blocks all), evaluateConsumption (negative-floor enforcement), evaluateReservationWarning (percent-of-allocation with absolute fallback), validateLedger (no orphans, integer/sign/zero checks, reserved-never-negative), buildStatement (opening/closing balance, refills, consumption by category + billable/non-billable, adjustments, expiry, corrections — statement & statistics ready), carryoverExpiryDelta (capped/no_carryover planning helper). src/lib/data/timeBank.test.ts validates all of the above end-to-end (refill→reserve→consume→release, frozen-honors-reservation CONTRACT 2, historical as-of reproduction, version-chain continuity). " +
      "AGREEMENT TEMPLATE RULE BINDING (Phase 8 · foundation built; no UI, no activation): TimeBankTemplateRules type added to types/index.ts. timeBankTemplateBinding.ts is the PURE bridge — defaultTemplateTimeBankRules(), templateTimeBankEnabled(), inheritTimeBankRulesFromTemplate(), inheritCancellationPolicyFromTemplate(), and createAgreementTimeBankSnapshot() (the single template-to-agreement integration seam). CONTRACTS: (a) Templates suggest; agreements own final rules (independent, never live-linked). (b) Template changes never rewrite existing agreements. (c) Entitlement gate respected — no hidden activation through template selection. (d) Cancellation credit inherits same snapshot principle. (e) agreementGroupId binding unchanged. 44 tests pass. " +
      "REMAINING WORK before verified/activation: (1) staging/pre-production round-trip validating real Supabase infrastructure, live RLS enforcement and authenticated sessions; (2) refill scheduling job + dated time-based expiry; (3) integration with Customer Agreement billing-model transitions (auto freeze/close on move away from time_bank/hybrid); (4) UI + activation. DONE in this phase: persistence layer (Supabase tables migration 0014 + repository read/write path + idempotent shadow writes) and company-scoped RLS policies (designed in 0014). " +
      "LIMITATION (explicit): logic + persistence foundation only — in-memory harness validation; real Supabase infrastructure, RLS enforcement and authenticated sessions are NOT validated here and remain a staging / pre-production responsibility. Time Bank is NOT activated and is NOT wired to any UI, billing or payroll flow. " +
      "Status: ARCHITECTURE LOCKED / Foundation Logic Built / Not Activated. Depends on Customer Agreement Foundation + Agreement Versioning Foundation (both built first). " +
      "Structure: Customer → CustomerAgreement → agreementGroupId → TimeBankWallet → TimeBankTransaction. " +
      "=== LOCKED DECISIONS === " +
      "(1) ONE TimeBankWallet per agreementGroupId — do not create separate wallets per service, line or billing bucket; customers/admins see a single balance (statements may still break usage down by service category). " +
      "(2) Wallet binds to agreementGroupId, NOT the agreement version id — so it survives agreement versioning, price changes, line additions/removals and recurrence changes. " +
      "(3) Wallet statuses: active | frozen | closed. Frozen wallet HONORS existing reservations (they remain valid and may be consumed) and BLOCKS new reservations; no new refill transactions and no new manual adjustments while frozen. This resolves Customer Agreement CONTRACT 2 (honor strategy chosen) — no orphaned reservations. " +
      "(4) Transactions store SIGNED INTEGER MINUTES only — never floating-point hours. Transaction types: monthly_refill, manual_add, manual_remove, visit_consumption, cancellation_consumption, reschedule_consumption, cancelled_visit_credit, reservation, reservation_release, correction, expiry, migration. " +
      "(5) NO direct balance editing — every balance change is a transaction (append-only ledger); manual balance overwrite is not allowed. " +
      "(6) Money ledger and time ledger remain SEPARATE — TimeBankTransaction tracks minutes only; if a manual adjustment or overage should affect invoicing it must create/reference a separate future invoice intent / invoice basis row. " +
      "(7) allocationMinutes is AUTHORITATIVE and drives refill; suggestedAllocationMinutes is advisory only (schedule-derived, never the live commercial source of truth). " +
      "(8) Default carryover = UNLIMITED (no global cap); Agreement Templates / Customer Agreements may later override with capped / expiry / no_carryover. " +
      "(9) Statements are a REQUIRED future capability: opening balance, refills, visit/cancellation/reschedule consumption, manual adjustments, expiry, closing balance — for customer portal, support, dispute resolution, admin reconciliation, future AI. " +
      "(10) Balance model: availableBalance = currentBalance - reservedBalance. Reservation warning (stage 1) uses availableBalance against warning/critical thresholds and warns without auto-blocking. Consumption enforcement (stage 2) uses currentBalance + negativeFloorMinutes at visit_consumption — if consumption would breach the floor it blocks or requires explicit override. Warnings are percentage-based relative to allocationMinutes with fallback absolute thresholds for zero-allocation wallets. " +
      "Recommended wallet fields: id, agreementGroupId, customerId, companyId, status, allocationMinutes, suggestedAllocationMinutes, refillAnchor, refillFrequency, negativeFloorMinutes, carryoverPolicy, maxBalanceMinutes, warning/critical thresholds, createdAt, updatedAt. No implementation has begun.",
    targetRelease: "Future Billing Phase",
    updatedAt: SEED_DATE,
  },
  {
    key: "agreement_templates",
    name: "Agreement Template Foundation",
    description:
      "Reusable starting points for Customer Agreements with two ownership levels (global = Super Admin, company = Company Admin). Templates are NOT contracts: AgreementTemplate → createAgreementFromTemplate() → CustomerAgreement + CustomerAgreementLine, where the Customer Agreement snapshots copied template values and becomes independent after creation. FOUNDATION LOGIC LAYER BUILT (pure type model + template→agreement creation flow + validation, harness-validated) — no persistence, no UI, no activation.",
    category: "Billing",
    status: "built",
    ownerArea: "Super Admin / Company Admin",
    dependencies: ["customer_agreement", "agreement_versioning", "time_bank", "services"],
    relatedFeatures: [
      "AgreementTemplate (global | company ownership)",
      "AgreementTemplateLine",
      "Global platform-standard templates (Super Admin)",
      "Company-owned templates (Company Admin)",
      "createAgreementFromTemplate() — snapshot template → CustomerAgreement + lines",
      "Template versioning (templateGroupId + version)",
      "Template validation (validateTemplateForCreation)",
      "Header/line overrides during agreement creation",
      "Time Bank inheritance through template → agreement (via timeBankTemplateBinding)",
      "Cancellation credit inheritance through template → agreement",
      "Template independence — editing template after creation does NOT affect existing agreements",
      "Template version changes only affect NEW agreements",
      "Entitlement gate respected (not bypassed by template selection)",
      "createCustomerAgreementFromTemplate() — persisted template → persisted agreement v1 (+ optional gated wallet)",
      "Time Bank gate connected to the REAL entitlement resolver (createTimeBankEntitlementGate)",
    ],
    supabaseStatus: "in_progress",
    localStorageStatus: "not_applicable",
    rlsStatus: "designed",
    permissionStatus: "not_started",
    activityLogStatus: "not_started",
    entitlementStatus: "partial",
    apiStatus: "not_started",
    aiStatus: "not_started",
    languageStatus: "planned",
    testStatus: "complete",
    releaseReadiness: "not_ready",
    migrationStatus: "in_progress",
    notes:
      "SUPER ADMIN MANAGEMENT UI (Phase 15 · added — admin-only foundation UI; NOT verified, NOT customer-facing, NO agreement creation, NO wallet provisioning): the FIRST Agreement Templates management surface. Route /agreement-templates (super_admin guard + settings_templates.manage), navigation entry under Settings, page src/pages/superadmin/AgreementTemplates.tsx. PURE view-model src/lib/data/agreementTemplatesAdminModel.ts (toLatestVersionRows/toTemplateListRow/toTemplateLineRows/toTimeBankDefaultsView/toCancellationDefaultsView/toVersionChain + refill/carryover label maps) formats list rows, lines, the READ-ONLY Time Bank defaults, cancellation-credit defaults and the immutable version chain. Container hook src/hooks/use-agreement-templates-admin.ts owns all repository I/O (listGlobalTemplates + per-company listCompanyTemplates + getTemplateWithLines + listVersionChain) and the small safe write actions wired to the existing persistence layer: createGlobalTemplate (draft), editTemplate (re-persists the SAME version row — immutability preserved), addLine/deactivateLine, publishTemplate (draft→active), archive (status flip, never delete), copyToCompany (copyGlobalTemplateToCompany). UI: two-pane console — left lists the global library + a company picker for one company's templates; right shows header defaults, service lines, Time Bank defaults, cancellation defaults and the version chain, with create/edit/copy/add-line dialogs. SAFETY: manages BLUEPRINTS only — never creates a Customer Agreement, never provisions a wallet (entitlement gate still governs that); no destructive delete (deactivate/archive only); Supabase-unconfigured renders a clean disabled state. Tests: src/lib/data/agreementTemplatesAdminModel.test.ts (10) + src/pages/superadmin/AgreementTemplates.test.tsx (11 RTL) — list/empty/disabled/access states, detail rendering, publish/archive/deactivate pass-through, action-error surfacing. agreement_templates stays BUILT (NOT verified): UI now exists but still needs staging Supabase/RLS/session validation before activation. " +
      "ENTITLEMENT INTEGRATION (Phase 10 · added): the orchestration Time Bank gate is no longer a stub — production callers pass createTimeBankEntitlementGate() (src/lib/data/timeBankEntitlement.ts), which resolves access through the real bundle-first entitlement pipeline (loadEntitlementContext → resolveCompanyEntitlements → decideTimeBankEntitlement on the 'time_bank' ServiceFeatureKey). The gate may now return a structured TimeBankEntitlementDecision (status / source / contributing bundles / denial reason), surfaced on report.timeBank for support/debugging; a bare boolean is still accepted for tests. Templates can never bypass entitlements: a wallet is provisioned only when a bundle grant or company override entitles Time Bank, else the agreement is created with Time Bank suppressed and the denial reason recorded. " +
      "TEMPLATE → AGREEMENT ORCHESTRATION (Phase 10 · added — foundation/orchestration only; no UI, no scheduler, no live migration, no billing wiring, no production flip): src/lib/data/agreementTemplateOrchestration.ts adds createCustomerAgreementFromTemplate() — the single controlled flow that turns a PERSISTED Agreement Template into a PERSISTED Customer Agreement v1. Flow: load template + active lines (scope-guarded getTemplateWithLines) → validateTemplateForCreation (active + ≥1 active line) → pure createAgreementFromTemplate snapshot → ENTITLEMENT GATE → resolve tenant UUID → upsertVersions([agreement]) then upsertLines(lines) (parent before children, no orphan lines) → optional idempotent Time Bank wallet (ensureWalletForAgreement) → structured CreateCustomerAgreementReport. ENTITLEMENT GATE: the Time Bank decision is INJECTED (timeBankEntitlementGate: (companyId) => boolean|Promise<boolean>), so the orchestrator can NEVER silently reach into / activate the entitlement pipeline. Policy when Time Bank is requested by the template but the gate DENIES (or is omitted → default DENIED): the agreement is STILL created (customer-friendly, not blocked by a missing add-on) but Time Bank is forced OFF and NO wallet is created; report.timeBank.reason = 'entitlement_denied' (vs 'template_disabled' / 'enabled'). WALLET: only created when template requests it AND allocationMinutes>0 AND entitled; idempotent per agreementGroupId (no duplicates on retry); NO refill transaction appended (scheduler stays inactive). CANCELLATION POLICY: copied into the snapshot (report.timeBank.cancellationCreditPolicy) — NO transaction at creation; used only later on visit cancellation. VERSIONING: every run mints a FRESH agreementGroupId + version-1 id (sourceType='template', sourceReferenceId=templateId for traceability only); future versioning unaffected; template edit/archival/deletion never affects the created agreement. IDEMPOTENCY/SAFETY: creating an agreement from a template is NOT globally idempotent by default (each call = a genuine new agreement); wallet creation IS idempotent per agreementGroupId; writes ordered agreement→lines→wallet so a failed wallet write leaves a valid agreement reported via ok:false; dryRun supported (computes report, writes nothing). ORCHESTRATION TESTS: src/lib/data/agreementTemplateOrchestration.test.ts (19 end-to-end harness tests, all pass): successful create+persist + readback, header/line overrides, fresh agreementGroupId per call, reject missing/out-of-scope/draft/line-less templates (no write on validation failure), Time Bank OFF by default, wallet created when entitled, agreement-without-wallet when denied, omitted gate = denied, wallet idempotency (single row), no transaction at creation, cancellation policy copied without transaction, template mutation/archival after creation does not affect agreement, company isolation, unmigrated-company abort (no write), dryRun writes nothing. " +
      "PERSISTENCE LAYER (Phase 9 · added — foundation only; no UI, no activation, no production flip, no live migration, no automatic wallet creation): migration 0015 (supabase/migrations/0015_agreement_templates.sql) creates agreement_templates and agreement_template_lines. agreement_templates: legacy_id (idempotency key) + template_group_id (stable version-chain key) + owner_type (global|company) + nullable company_id/company_legacy_id (NULL for GLOBAL, non-null for COMPANY, enforced by an owner_company CHECK) + name/version/status (draft|active|inactive|superseded) + billing_model/invoice_interval + time_bank_eligible + copied_from_template_id (traceability for global→company copies) + supersedes/superseded links + valid_from/valid_to + lossless data jsonb; status-based archive (NO deleted_at — matches the 0013/0014 status soft-delete convention) and NO delete policy. agreement_template_lines: per-template snapshot rows (legacy_id, template_legacy_id, template_group_id, owner_type, company scope, sort_order, service/pricing snapshot columns, active) + data jsonb, ordered by sort_order. RLS mirrors 0013/0014 via current_company_id()/is_super_admin(): GLOBAL templates (company_id IS NULL) are SELECT-able by every authenticated user and writable only by super_admin; COMPANY templates get company-scoped SELECT/INSERT/UPDATE (super_admin across all); NO delete policy on either table (archive = status flip; history stays readable). src/lib/data/agreementTemplatesRepository.ts adds row mappers (toAgreementTemplateUpsertRow/toAgreementTemplateLineUpsertRow) + read/write surface: upsertTemplates (idempotent on legacy_id — a new VERSION is a new legacy_id so old versions are never mutated), upsertTemplateLines (immutable line snapshots), getTemplateById, listGlobalTemplates, listCompanyTemplates, listActiveTemplates (own active company templates + all active global), listVersionChain (ordered, company-scoped), listLines, getTemplateWithLines. src/lib/data/agreementTemplatesPersistence.ts orchestrates: persistTemplate (IDEMPOTENT upsert of template+lines; resolves tenant UUID for company templates via loadCompanyUuidMap, global→null; parent written before children so no orphan lines; dryRun supported; aborts cleanly if the company is not migrated), copyGlobalTemplateToCompany (reads persisted global, builds an INDEPENDENT company draft via copyTemplateToCompany — fresh id+group, copiedFromTemplateId for traceability only, never live-linked — and persists), archiveTemplate (status flip to inactive/superseded, row preserved), createAgreementFromPersistedTemplate (reads persisted template+lines, validates active+≥1 active line, runs the PURE createAgreementFromTemplate snapshot flow; the resulting agreement is an INDEPENDENT v1 snapshot, NOT persisted here, and NO wallet is created — entitlement still gates Time Bank). src/lib/data/agreementTemplates.ts gains copyTemplateToCompany (pure copy builder) and AgreementTemplate.copiedFromTemplateId. " +
      "PERSISTENCE TESTS: src/lib/data/agreementTemplatesPersistence.test.ts (15 end-to-end harness tests against the in-memory Supabase stand-in — no network/env/localStorage/session): company + global template persistence, template-line persistence + ordering, idempotent re-persist (no duplicates), dryRun writes nothing, company-not-migrated abort, global/company/active listing, immutable version chain (old version unmutated), copy global→company (independent draft, fresh group, copiedFromTemplateId, editing copy does not touch source), archive via status flip, company isolation (out-of-scope read returns null), template→agreement v1 from persisted data, reject non-active/line-less template, Time Bank rules + cancellation policy persistence and inheritance (ON carries 600m allocation, plain template snapshot OFF), and template mutation after creation does NOT affect the created agreement. All pass. " +
      "DEVELOPMENT CENTER RECOMMENDATION: agreement_templates moves in_progress → BUILT (foundation logic + persistence + RLS design + repository + orchestration + harness all complete). NOT verified — remaining before verified/activation: (1) staging/pre-production round-trip validating real Supabase infrastructure, live RLS enforcement (global readable + super_admin-only global writes + company isolation) and authenticated sessions; (2) Super Admin + Company Admin UI (manage global/company templates, copy flow, publish/version); (3) wiring createAgreementFromPersistedTemplate into the real Customer Agreement creation UI + agreement write path; (4) entitlement gate enforcement at activation. No activation or production rollout performed. " +
      "Status: BUILT (FOUNDATION) — logic + persistence layer complete and harness-validated; NOT activated. No UI, no feature flags, no production-authoritative flip, no customer rollout, no live migration. " +
      "FOUNDATION DELIVERED (Phase 9 · pure type model + template→agreement creation flow): src/types/index.ts adds AgreementTemplate, AgreementTemplateLine, AgreementTemplateRecurrenceDefaults types with enums AgreementTemplateOwnerType (global|company) and AgreementTemplateStatus (draft|active|inactive|superseded). src/lib/data/agreementTemplates.ts is the PURE logic core — buildAgreementTemplate() factory, buildAgreementTemplateLine() factory, validateTemplateForCreation() (gates on status=active + at least one active line), and createAgreementFromTemplate() — the core snapshot flow: template + lines → new CustomerAgreement (v1, fresh agreementGroupId, sourceType=template) + CustomerAgreementLine[] + AgreementTimeBankSnapshot (via timeBankTemplateBinding integration). Override hierarchy: template defaults → explicit header/line/timeBankRules/cancellationPolicy overrides. After creation the agreement is COMPLETELY INDEPENDENT — template changes never affect it (proven in tests). " +
      "CORE CONTRACTS BUILT: (1) Templates are blueprints; Agreements are operational records. (2) Templates suggest; agreements own. (3) Snapshot-on-create — values COPIED, never live-linked. (4) Future template changes never mutate existing agreements. (5) Template version changes only affect NEW agreements. (6) Every agreement starts as version 1 with a fresh agreementGroupId. (7) Entitlement gate NOT enforced — caller must apply before wallet creation; template selection alone cannot activate Time Bank. " +
      "TEST HARNESS: src/lib/data/agreementTemplates.test.ts — comprehensive: template creation (company/global, defaults, unique ids, Time Bank rules), template line creation (defaults, flags, recurrence, overrides), template validation (reject null/draft/inactive/superseded, reject no active lines, accept active with lines), agreement creation (v1 header, lines snapshot, source traceability, fresh agreementGroupId), override behavior (header/line/timeBank/cancellation overrides win), template independence (edit after creation → agreement unchanged, add/remove lines, v1→v2 only affects NEW, survives template deletion), Time Bank inheritance (OFF default, ON with allocation, zero allocation→OFF, override wins), cancellation credit inheritance, entitlement compatibility, agreementGroupId continuity. " +
      "REMAINING WORK: Supabase schema+migration, repository read/write, RLS, UI for Super Admin + Company Admin, copy global→company flow, persistence orchestration, wire to agreement creation UI. No activation or production rollout performed. " +
      "Purpose: make it easy to create Customer Agreements from reusable templates while preserving company-specific flexibility. Templates are reusable starting points, NOT contracts — Customer Agreement remains the commercial source of truth after creation. " +
      "Two ownership levels: (1) GLOBAL templates owned by Super Admin (platform standards, e.g. Private Standard, Private Time Bank, Business Monthly, BRF Standard, Municipality Contract, Office Cleaning Monthly); (2) COMPANY templates owned by Company Admin (created by copying a global template or from scratch, only available inside that company). " +
      "Ownership rules — Super Admin: create/edit/activate-deactivate/version/publish global templates. Company Admin: view global templates, create customer agreements from global templates, copy global → company template, create/edit/activate-deactivate company templates, create customer agreements from company templates. Company Admin CANNOT edit/delete global templates or touch other companies' templates. " +
      "Copy flow: Global Agreement Template → Copy → Company Agreement Template → Create Customer Agreement. A Customer Agreement created from a template MUST become independent after creation — future template updates must never auto-rewrite existing customer agreements (snapshot copied values, store only sourceTemplateId + sourceTemplateVersion for traceability). " +
      "Versioning: templates support versioning via a stable templateGroupId + version (e.g. Private Standard v1 → v2). New customer agreements may use v2; existing agreements created from v1 must not change automatically. Same principle for company-owned templates. Shares the Agreement Versioning Foundation contract. " +
      "Recommended entity structure: AgreementTemplate { id, templateGroupId, ownerType: global|company, companyId (nullable), name, description, status, version, validFrom, validTo, billingModel, invoiceInterval, defaultCancellationPolicyId, defaultReschedulePolicyId, timeBankEligible, active, createdAt, updatedAt }. AgreementTemplateLine { id, templateId, serviceId, service snapshot fields, default price, default VAT, pricingModel, billingModelOverride, default quantity, default durationMinutes, recurrence defaults, serviceBasisType snapshot, categoryType snapshot, payrollGroupType snapshot, sortOrder, active }. " +
      "Review answers: (1) No equivalent exists for AGREEMENT templates today — the only template concept in the system is checklist/protocol templates (development_center key for those is separate); Customer Agreement itself is greenfield, so agreement templates are fully new. (2) Templates should be implemented AFTER Customer Agreement + Agreement Versioning — a template is just a pre-filled agreement, so the agreement schema must exist first or the template schema would have to be reworked. (3) Global and company templates SHOULD share the same entity, discriminated by ownerType + nullable companyId (avoids duplicate schemas, simplifies the copy flow and RLS). (4) A Customer Agreement should store only sourceTemplateId + sourceTemplateVersion for traceability and snapshot all copied values — it must NOT stay live-linked to mutable template values at read time. (5) Versioning risks: template edits silently mutating in-flight agreement creation, ambiguous 'latest' resolution, company copies drifting from global parents, and deactivated/superseded templates needing to remain readable for audit. (6) Recommended implementation order: Customer Agreement Foundation → Agreement Versioning Foundation → Customer Type Taxonomy → Agreement Template Foundation → Pricing Engine. " +
      "Dependencies completed/required: Customer Agreement Foundation, Agreement Versioning Foundation, Services, Service Categories, Service Basis Types, Payroll Groups, Time Codes. Future dependents: Customer onboarding, Customer Agreement creation, Time Bank setup, Invoice Basis, Pricing Engine, Package/entitlement strategy. No implementation has begun. " +
      "TIME BANK TEMPLATE RULE BINDING (Phase 8 · foundation model built; no UI, no activation): Agreement Templates may now carry suggested Time Bank settings via a dedicated type (`TimeBankTemplateRules`): timeBankEnabled, allocationMinutes, refillFrequency, carryoverPolicy, maxBalanceMinutes, expiryAfterDays, negativeFloorMinutes, cancellationCreditPolicy, warning/critical thresholds, refillAnchor — all OPTIONAL by design. The TYPE lives in types/index.ts; the BINDING LOGIC lives in src/lib/data/timeBankTemplateBinding.ts. SAFE DEFAULT: `defaultTemplateTimeBankRules()` returns Time Bank OFF (disabled, zero allocation, unlimited carryover, no expiry, cancellation credit disabled). INHERITANCE: `inheritTimeBankRulesFromTemplate(templateRules, overrides?)` merges template suggestions → authoritative TimeBankRules (resolution: safe defaults → template suggestions → explicit overrides). `inheritCancellationPolicyFromTemplate(templatePolicy, overrides?)` does the same for the cancellation credit policy, with validation. SNAPSHOT SEAM: `createAgreementTimeBankSnapshot(input)` creates the full AgreementTimeBankSnapshot { timeBankEnabled, rules, cancellationCreditPolicy, … } — the single integration seam template→agreement. CORE CONTRACTS BUILT: (1) Templates provide defaults; agreements own final active rules (independent after creation, never live-linked). (2) Template changes never rewrite existing agreements (immutability proven in tests). (3) Template version changes only affect NEW agreements created from the new version. (4) Entitlement gate: templates may SUGGEST Time Bank rules, but an entitlement MUST still decide whether the company/package can use Time Bank — no hidden activation through template selection. (5) cancellationCreditPolicy inheritance follows the same snapshot-on-create principle (templates suggest, agreements own, validated before save). (6) agreementGroupId binding is never tied to template selection — the wallet always binds to the agreement's stable group id. 44 tests pass (defaults, enabled-check, rules inheritance, cancellation-policy inheritance, override precedence, immutability, version changes, template-delete independence, entitlement gate respect, agreementGroupId binding). No UI, no Supabase, no activation, no production migration — foundation logic only.",
    targetRelease: "Future Billing Phase",
    updatedAt: SEED_DATE,
  },
  {
    key: "api_integrations",
    name: "API & Integrations",
    description: "Outbound/inbound integrations and a public API surface for partners.",
    category: "Integrations",
    status: "planned",
    ownerArea: "Platform",
    dependencies: ["auth", "entitlements"],
    relatedFeatures: ["Public API", "Webhooks", "SFTP", "Third-party connectors"],
    supabaseStatus: "not_started",
    localStorageStatus: "not_applicable",
    rlsStatus: "not_started",
    permissionStatus: "not_started",
    activityLogStatus: "not_started",
    entitlementStatus: "planned",
    apiStatus: "planned",
    aiStatus: "not_started",
    languageStatus: "not_applicable",
    testStatus: "not_started",
    releaseReadiness: "not_ready",
    notes: "Roadmap item. Payroll Export reserves API/SFTP/Webhook export targets to slot in here.",
    targetRelease: "v2",
    updatedAt: SEED_DATE,
  },
  {
    key: "ai_assistant",
    name: "AI Assistant",
    description: "Future AI/automation layer across scheduling, statistics and operational insight.",
    category: "Intelligence",
    status: "planned",
    ownerArea: "Platform",
    dependencies: ["schedule", "statistics"],
    relatedFeatures: ["Scheduling suggestions", "Insight summaries"],
    supabaseStatus: "not_started",
    localStorageStatus: "not_applicable",
    rlsStatus: "not_started",
    permissionStatus: "not_started",
    activityLogStatus: "not_started",
    entitlementStatus: "planned",
    apiStatus: "not_started",
    aiStatus: "planned",
    languageStatus: "not_applicable",
    testStatus: "not_started",
    releaseReadiness: "not_ready",
    notes: "Roadmap item. Not started.",
    targetRelease: "v2",
    updatedAt: SEED_DATE,
  },
  {
    key: "language_module",
    name: "Language Module",
    description: "Internationalisation / multi-language support across the platform.",
    category: "System",
    status: "planned",
    ownerArea: "Platform",
    dependencies: [],
    relatedFeatures: ["Locale switching", "Translated strings", "Swedish/English"],
    supabaseStatus: "not_applicable",
    localStorageStatus: "not_applicable",
    rlsStatus: "not_applicable",
    permissionStatus: "not_started",
    activityLogStatus: "not_applicable",
    entitlementStatus: "not_applicable",
    apiStatus: "not_applicable",
    aiStatus: "not_started",
    languageStatus: "planned",
    testStatus: "not_started",
    releaseReadiness: "not_ready",
    notes: "Roadmap item. Most modules carry languageStatus: planned pending this foundation.",
    targetRelease: "v1.1",
    updatedAt: SEED_DATE,
  },
  {
    key: "statistics",
    name: "Statistics / Reports",
    description: "Analytics, operational metrics and exported insights.",
    category: "Intelligence",
    status: "partial",
    ownerArea: "Company Admin",
    dependencies: ["work_orders", "schedule", "customers"],
    relatedFeatures: ["Reports", "Dashboards", "Exports"],
    supabaseStatus: "not_started",
    localStorageStatus: "authoritative",
    rlsStatus: "not_started",
    permissionStatus: "complete",
    activityLogStatus: "not_started",
    entitlementStatus: "partial",
    apiStatus: "not_started",
    aiStatus: "planned",
    languageStatus: "planned",
    testStatus: "not_started",
    releaseReadiness: "not_ready",
    notes: "Reporting permission exists; computed from localStorage data.",
    updatedAt: SEED_DATE,
  },
  {
    key: "settings",
    name: "Settings",
    description: "Workspace configuration hub: roles, activity log, checklist config and module settings.",
    category: "System",
    status: "active",
    ownerArea: "Super Admin / Company Admin",
    dependencies: ["roles"],
    relatedFeatures: ["Roles & Permissions", "Activity Log", "Time Codes", "Payroll Export"],
    supabaseStatus: "complete",
    localStorageStatus: "dual_write",
    rlsStatus: "complete",
    permissionStatus: "complete",
    activityLogStatus: "partial",
    entitlementStatus: "partial",
    apiStatus: "not_started",
    aiStatus: "not_started",
    languageStatus: "planned",
    testStatus: "partial",
    releaseReadiness: "verified",
    migrationStatus: "activated",
    notes:
      "Supabase-authoritative across both settings stores (SET wave): settings_templates (the always-global Super Admin starter-bundle catalogue, world-readable / super-admin-write) + company_settings (one company-scoped live record per company, keyed 1:1 to the company) via tables 0026, with repositories, read seams, dual-write + shadow validation; localStorage kept as the synchronized backout copy (strategy B). Rollback is a single env flip (=false). " +
      "Company Admin navigation simplification completed & verified (2026-06-03): the Company Admin sidebar renders the curated object-first layout (Dashboard, Planning, Users, Operations, Finance & Info, Help & Settings); legacy technical categories (Platform, Directory, Checklists, Protocols, Backoffice, Customer Portal, Modules) are no longer shown for company_admin. Customers + Employees grouped under Users; Requests under Operations; News under Finance & Info; Customer Protocols, Customer Invoices and Teams reachable from their Customers/Employees pages. The curated layout is AUTHORITATIVE: DashboardLayout returns companyAdminSections early for role === 'company_admin' and never merges dynamic module/category groups, so no persisted menu config can append legacy top-level groups. The only persisted sidebar state is collapsed/expanded (use-sidebar.tsx, localStorage 'sidebar-collapsed') — no menu/order configuration exists; module enablement and permissions only hide/show items INSIDE the curated structure. Super Admin navigation unchanged. Temporary [SIDEBAR DIAGNOSTIC] logging removed. Read-side/UX only — no auth, permission, route, schema, Work Order or Customer write-path changes. Build/static checks pass. Changed files: src/components/layout/DashboardLayout.tsx.",
    updatedAt: SEED_DATE,
  },
  {
    key: "services",
    name: "Services",
    description:
      "Master library of service definitions (Home Cleaning, Window Cleaning, Travel Time, etc.) referenced by work orders and time codes.",
    category: "Operations",
    status: "active",
    ownerArea: "Super Admin",
    dependencies: ["companies", "time_codes"],
    relatedFeatures: ["Service catalog", "timeCodeId reference", "Pricing metadata"],
    supabaseStatus: "complete",
    localStorageStatus: "dual_write",
    rlsStatus: "complete",
    permissionStatus: "complete",
    activityLogStatus: "partial",
    entitlementStatus: "not_applicable",
    apiStatus: "not_started",
    aiStatus: "not_started",
    languageStatus: "planned",
    testStatus: "complete",
    releaseReadiness: "verified",
    migrationStatus: "activated",
    notes:
      "Supabase-authoritative across the whole service catalog (SVC + SVCCAT waves): Services (table 0018, GLOBAL Super Admin catalog + company services), Service Categories + Payroll Groups (table 0019, global + company) and Service Packages (table 0019, always-global master data) all flipped with repositories, read seams, dual-write + shadow validation; localStorage kept as the synchronized backout copy (strategy B). Carries timeCodeId / serviceBasisType / optional payrollGroupId. Rollback is a single env flip (=false).",
    updatedAt: "2026-06-05T12:00:00.000Z",
  },
  {
    key: "roles",
    name: "Roles & Permissions",
    description:
      "Role definitions and the permission model enforced across modules (e.g. settings.timecodes.manage, payroll.export.*).",
    category: "System",
    status: "active",
    ownerArea: "Super Admin / Company Admin",
    dependencies: ["profiles"],
    relatedFeatures: ["Role definitions", "Permission keys", "Access gating"],
    supabaseStatus: "complete",
    localStorageStatus: "dual_write",
    rlsStatus: "complete",
    permissionStatus: "complete",
    activityLogStatus: "partial",
    entitlementStatus: "not_applicable",
    apiStatus: "not_started",
    aiStatus: "not_started",
    languageStatus: "planned",
    testStatus: "partial",
    releaseReadiness: "verified",
    migrationStatus: "activated",
    notes:
      "Role DEFINITIONS are Supabase-authoritative (ROLE wave, identity part 1 of 2). roles table (0022) carrying GLOBAL Super Admin templates (companyId === null) + company roles, global+company RLS, repository, read seam, dual-write + shadow validation, all flipped; localStorage kept as the synchronized backout copy (strategy B). Completes the identity graph (auth user → profile → employee → role assignment) onto Supabase alongside the app_users login directory. Rollback is a single env flip (=false). " +
      "UX/read-side consistency pass completed & verified (2026-06-03): company_admin and super_admin role cards share the same useAssignedUsers roster for counts; customers (incl. login-less records) appear in Assigned Users; member counts are inspectable via an in-place member dialog on both surfaces; '+N more' opens the full permission list; full Assigned Users navigation retained. Read-side only — no auth, schema, permission-rule, security-model, Customer write-path or Work Order changes. Changed files: src/components/roles/RoleTemplatesGrid.tsx, src/hooks/use-assigned-users.ts.",
    updatedAt: SEED_DATE,
  },
  {
    key: "super_admin",
    name: "Super Admin",
    description: "Platform console: companies, services, global templates, system settings and diagnostics.",
    category: "System",
    status: "active",
    ownerArea: "Super Admin",
    dependencies: ["companies", "entitlements", "system_settings"],
    relatedFeatures: [
      "Companies",
      "Services",
      "Global Templates",
      "System Settings",
      "System Performance",
      "Development Center",
    ],
    supabaseStatus: "complete",
    localStorageStatus: "dual_write",
    rlsStatus: "complete",
    permissionStatus: "complete",
    activityLogStatus: "complete",
    entitlementStatus: "complete",
    apiStatus: "not_started",
    aiStatus: "not_started",
    languageStatus: "planned",
    testStatus: "complete",
    releaseReadiness: "verified",
    migrationStatus: "activated",
    notes:
      "COMPLETE — honest re-score after the SYSSET wave closed the lone remaining in-scope source-of-truth gap. Every sub-surface of the Super Admin console is now Supabase-authoritative with localStorage as the synchronized backout copy (strategy B): Companies, Services + catalog, Global Templates (settings_templates + checklist_templates), Roles, Entitlements / Packages (tables 0028: global + company + immutable log), the Activity Log (table 0029: append-only trail) and — newly — System Settings (table 0030: the SINGLETON platform configuration record carrying the booking horizon, the Preferred Time Evaluation master gate and the entitlement-resolver controls). System Performance + this Development Center registry are intentionally dev/diagnostic surfaces (no source-of-truth data) and never blocked completion. Rollback for any area is a single env flip (=false). With System Settings migrated there is no remaining in-scope localStorage source-of-truth dependency under the Super Admin area.",
    updatedAt: "2026-06-08T13:00:00.000Z",
  },
  {
    key: "teams",
    name: "Teams",
    description: "Company team groupings of employees used for assignment and scheduling.",
    category: "Directory",
    status: "active",
    ownerArea: "Company Admin",
    dependencies: ["employees"],
    relatedFeatures: ["Team directory", "Employee membership", "Assignment grouping"],
    supabaseStatus: "complete",
    localStorageStatus: "dual_write",
    rlsStatus: "complete",
    permissionStatus: "complete",
    activityLogStatus: "partial",
    entitlementStatus: "not_applicable",
    apiStatus: "not_started",
    aiStatus: "not_started",
    languageStatus: "planned",
    testStatus: "complete",
    releaseReadiness: "verified",
    migrationStatus: "activated",
    notes:
      "Supabase-authoritative (TEAM wave — first global-directory cut-over built from scratch). teams table (0017), company-scoped RLS, repository, read seam, dual-write (incl. soft-delete removal propagation) + shadow validation, all flipped; localStorage kept as the synchronized backout copy (strategy B). Rollback is a single env flip (=false).",
    updatedAt: "2026-06-05T12:00:00.000Z",
  },
  {
    key: "areas",
    name: "Area Cluster (Areas / Postal Cities / Languages)",
    description:
      "The operational geography + language dimensions — Areas, Postal Cities and Employee Languages — that customer visibility, employee area access, customer ownership and scheduling reference by stable id.",
    category: "Directory",
    status: "active",
    ownerArea: "Company Admin",
    dependencies: ["companies"],
    relatedFeatures: ["Areas", "Postal Cities", "Employee Languages", "Area Scoped Access"],
    supabaseStatus: "complete",
    localStorageStatus: "dual_write",
    rlsStatus: "complete",
    permissionStatus: "complete",
    activityLogStatus: "partial",
    entitlementStatus: "not_applicable",
    apiStatus: "not_started",
    aiStatus: "not_started",
    languageStatus: "planned",
    testStatus: "complete",
    releaseReadiness: "verified",
    migrationStatus: "activated",
    notes:
      "Supabase-authoritative (AREA wave — moved before Missions because Missions reference these by id). Three company-scoped tables (0020: areas / postal_cities / employee_languages), company-scoped RLS, repositories, read seams, dual-write + shadow validation, all flipped; localStorage kept as the synchronized backout copy (strategy B). Rollback is a single env flip (=false).",
    updatedAt: "2026-06-05T12:00:00.000Z",
  },
  {
    key: "users",
    name: "Users / Logins",
    description:
      "The app-facing login directory (role assignment, employee/customer linking, area scope) — distinct from, and complementary to, the Supabase profiles authentication backbone.",
    category: "System",
    status: "active",
    ownerArea: "Super Admin / Company Admin",
    dependencies: ["profiles", "roles"],
    relatedFeatures: ["Login directory", "Role assignment", "Area scope", "Employee/customer linking"],
    supabaseStatus: "complete",
    localStorageStatus: "dual_write",
    rlsStatus: "complete",
    permissionStatus: "complete",
    activityLogStatus: "partial",
    entitlementStatus: "not_applicable",
    apiStatus: "not_started",
    aiStatus: "not_started",
    languageStatus: "planned",
    testStatus: "complete",
    releaseReadiness: "verified",
    migrationStatus: "activated",
    notes:
      "Supabase-authoritative (USER wave — identity part 2 of 2, closes the identity split). The cleanops.users login directory moved onto a NEW app_users table (0023), DISTINCT from profiles: profiles stays the auth-side identity (1:1 with auth.users, source of truth for authentication + base_role/company for RLS), app_users is the operational login record the app renders/edits. SECURITY: passwords are NEVER mirrored — the source is the password-free login record and admin auth still runs exclusively through Supabase Auth. company-scoped RLS (super admins see globals, no world-readable tier), repository, read seam, dual-write + shadow validation; localStorage kept as the synchronized backout copy (strategy B). Rollback is a single env flip (=false).",
    updatedAt: "2026-06-05T12:00:00.000Z",
  },
  {
    key: "modules",
    name: "Modules",
    description:
      "The global Module catalogue + Module Categories (master data) and the per-company Module availability/enable config.",
    category: "System",
    status: "active",
    ownerArea: "Super Admin / Company Admin",
    dependencies: ["companies", "entitlements"],
    relatedFeatures: ["Module catalogue", "Module Categories", "Company module enablement"],
    supabaseStatus: "complete",
    localStorageStatus: "dual_write",
    rlsStatus: "complete",
    permissionStatus: "complete",
    activityLogStatus: "not_started",
    entitlementStatus: "partial",
    apiStatus: "not_started",
    aiStatus: "not_started",
    languageStatus: "planned",
    testStatus: "complete",
    releaseReadiness: "verified",
    migrationStatus: "activated",
    notes:
      "Supabase-authoritative (MCPM wave). Global modules + module_categories (world-readable / super-admin-write) and the company-scoped company_modules availability config (composite legacy_id '<companyId>:<moduleId>') via tables 0027, with repositories, read seams, dual-write + shadow validation; localStorage kept as the synchronized backout copy (strategy B). Rollback is a single env flip (=false).",
    updatedAt: "2026-06-05T12:00:00.000Z",
  },
  {
    key: "media",
    name: "Media Library",
    description: "Company-scoped media assets (thumbnails / previews + content metadata) attached to customers, protocols and execution.",
    category: "Operations",
    status: "active",
    ownerArea: "Company Admin",
    dependencies: ["companies"],
    relatedFeatures: ["Media assets", "Thumbnails / previews", "Asset metadata"],
    supabaseStatus: "complete",
    localStorageStatus: "dual_write",
    rlsStatus: "complete",
    permissionStatus: "complete",
    activityLogStatus: "not_started",
    entitlementStatus: "not_applicable",
    apiStatus: "not_started",
    aiStatus: "not_started",
    languageStatus: "planned",
    testStatus: "complete",
    releaseReadiness: "verified",
    migrationStatus: "activated",
    notes:
      "Supabase-authoritative (MCPM wave). Flat company-scoped media_assets table (0027) mirroring the lossless asset record (three thumbnail/preview URLs + content metadata) — never binary originals; company-scoped RLS, repository, read seam, dual-write + shadow validation; localStorage kept as the synchronized backout copy (strategy B). Rollback is a single env flip (=false).",
    updatedAt: "2026-06-05T12:00:00.000Z",
  },
];

let cached: DevelopmentModule[] | null = null;

/**
 * Returns the development-module registry. This is the single seam a future
 * Supabase repository would replace — the UI must not read the seed array
 * directly. Ids are derived deterministically from each module's stable `key`.
 */
export function getDevelopmentModules(): DevelopmentModule[] {
  if (cached) return cached;
  cached = SEED_MODULES.map((m) => ({ id: `dm-${m.key}`, ...m }));
  return cached;
}

/** Looks up a single module by its stable key. */
export function getDevelopmentModule(key: string): DevelopmentModule | undefined {
  return getDevelopmentModules().find((m) => m.key === key);
}

/** Resolves a dependency key to its display name, falling back to the key. */
export function moduleNameForKey(key: string): string {
  return getDevelopmentModule(key)?.name ?? key;
}

/**
 * Whether a module is a roadmap/future item that is not yet implemented.
 * Planned modules are excluded from "completion" expectations and surfaced
 * separately in the UI.
 */
export function isPlannedModule(m: DevelopmentModule): boolean {
  return m.status === "planned";
}

/** Qualitative band derived from a module's numeric health score. */
export type HealthBand = "critical" | "developing" | "solid" | "production";

/** Result of {@link computeModuleHealth}. */
export interface ModuleHealth {
  /** 0–100 weighted completeness score. */
  score: number;
  /** Qualitative band for badge colouring. */
  band: HealthBand;
  /** Number of dimensions that counted toward the score (excludes not_applicable). */
  dimensions: number;
}

/**
 * Per-value contribution on a 0–1 scale. `not_applicable` returns `null` so the
 * dimension is excluded from both numerator and denominator — a module is never
 * penalised for a stage that genuinely does not apply to it.
 */
function valueScore(value: string): number | null {
  switch (value) {
    // fully done
    case "complete":
    case "ready":
    case "production_ready":
    case "verified":
    case "removed":
      return 1;
    // effectively done / low-risk
    case "removed_from_write_path":
    case "built":
    case "awaiting_activation":
    case "activated":
      return 0.9;
    // mid progress
    case "partial":
    case "in_progress":
    case "in_review":
    case "dual_write":
    case "active":
      return 0.5;
    // early intent
    case "planned":
      return 0.25;
    // nothing yet / highest risk
    case "not_started":
    case "not_ready":
    case "authoritative":
    case "blocked":
      return 0;
    // excluded
    case "not_applicable":
    case "deprecated":
      return null;
    default:
      return null;
  }
}

/** Weights per dimension — backing store and release readiness matter most. */
const HEALTH_WEIGHTS: Record<string, number> = {
  supabaseStatus: 2,
  localStorageStatus: 1.5,
  rlsStatus: 1.5,
  releaseReadiness: 2,
  permissionStatus: 1,
  activityLogStatus: 1,
  entitlementStatus: 0.5,
  testStatus: 1,
  apiStatus: 0.5,
};

/**
 * Computes a weighted 0–100 health score for a module from its status fields.
 * Dimensions marked `not_applicable` are excluded entirely, so e.g. a pure
 * roadmap item or a UI-only module is scored only on the stages it actually has.
 */
export function computeModuleHealth(m: DevelopmentModule): ModuleHealth {
  const fields: Array<keyof DevelopmentModule> = [
    "supabaseStatus",
    "localStorageStatus",
    "rlsStatus",
    "releaseReadiness",
    "permissionStatus",
    "activityLogStatus",
    "entitlementStatus",
    "testStatus",
    "apiStatus",
  ];

  let weightedSum = 0;
  let weightTotal = 0;
  let dimensions = 0;

  for (const field of fields) {
    const raw = valueScore(String(m[field]));
    if (raw === null) continue;
    const weight = HEALTH_WEIGHTS[field] ?? 1;
    weightedSum += raw * weight;
    weightTotal += weight;
    dimensions += 1;
  }

  const score = weightTotal === 0 ? 0 : Math.round((weightedSum / weightTotal) * 100);
  const band: HealthBand =
    score >= 90 ? "production" : score >= 70 ? "solid" : score >= 40 ? "developing" : "critical";

  return { score, band, dimensions };
}
