/**
 * CleanOps Development Center — System Timeline (v1).
 *
 * A Super Admin–only, read-only history of important *governance* events:
 * module status changes, migration status changes, release-readiness changes,
 * audits/verifications, activation pauses/completions, rollback drills and
 * framework/governance updates.
 *
 * This is deliberately NOT a general activity log and NOT a task tracker. It
 * exists purely to make Development Center governance history legible — what
 * changed, when, and why.
 *
 * v1 ships as a typed, static seed list. The model is shaped like a backend
 * table (stable `id`, ISO `date`, flat fields) so it can later move to a
 * Supabase `development_timeline` table without changing the UI — the page
 * reads from {@link getDevelopmentTimeline}, the single seam a future
 * repository would replace. There is no automatic runtime logging yet.
 */

/**
 * Governance category for a timeline entry. Maps 1:1 to the filter tabs in the
 * Development Center timeline (plus an implicit "All").
 */
export type TimelineCategory =
  | "status"
  | "migration"
  | "audit"
  | "activation"
  | "governance";

/**
 * A single governance event. Field names map to columns a future Supabase
 * `development_timeline` table would carry.
 */
export interface TimelineEntry {
  id: string;
  /** ISO 8601 timestamp of when the event occurred / was recorded. */
  date: string;
  /** Display label of the affected module/area, e.g. "Employees" or "Framework". */
  module: string;
  /**
   * Optional stable module key linking to a {@link DevelopmentModule}. Omitted
   * for cross-cutting governance events (e.g. framework updates).
   */
  moduleKey?: string;
  /** Governance category, used for filtering. */
  category: TimelineCategory;
  /** Short human-readable description of the event. */
  eventType: string;
  /** Prior value, when the event represents a transition. */
  from?: string;
  /** New value, when the event represents a transition. */
  to?: string;
  /** Resulting governed status/label, when relevant. */
  status?: string;
  /** Evidence reference or note explaining the change. */
  note?: string;
}

/**
 * Maximum entries the UI renders by default. Older entries remain in the seed
 * (returned by {@link getDevelopmentTimeline}) but the page caps what it shows
 * to avoid an unbounded list.
 */
export const TIMELINE_DEFAULT_LIMIT = 50;

/**
 * Seed history, in roughly chronological order of authoring. Order here does
 * not matter — {@link getDevelopmentTimeline} sorts newest-first by `date`.
 * Keep this the single source of truth; append new governance events as they
 * occur.
 */
const SEED_TIMELINE: ReadonlyArray<Omit<TimelineEntry, "id">> = [
  {
    date: "2026-06-05T18:00:00.000Z",
    module: "Browser Storage Source-of-Truth Remediation",
    category: "governance",
    eventType: "Phase 2B Legacy Browser-Domain Runtime Quarantine technically verified",
    from: "legacy browser-domain tools reachable from normal runtime",
    to: "migration/backout/soak/devtools/browser-origin mirror paths quarantined",
    status: "verified",
    note: "Phase 2B technical verification/quarantine pass completed as a quarantine patch, not a store-layer rewrite; final acceptance remains a review decision. Normal runtime access to legacy browser-domain migration, backout, soak, DevTools and browser-origin mirror paths is fail-closed through the runtime quarantine boundary. Supabase Auth/session persistence is untouched, no migrations were introduced, and Phase 2C has NOT started. Runtime files verified in the technical implementation: web-cleanops/src/lib/data/runtimeQuarantine.ts; web-cleanops/src/main.tsx; web-cleanops/src/context/AppContext.tsx; web-cleanops/src/pages/superadmin/EmployeeMigration.tsx; web-cleanops/src/pages/superadmin/SystemPerformance.tsx. Validation recorded: runChecks({ appPath: \"web-cleanops\" }) passed. Next recommended scope: Phase 2C should replace or retire the remaining domain-specific localStorage stores module-by-module, starting with execution/checklist stores, then media/payroll/supporting utilities, preserving only explicitly reviewed non-authoritative cache patterns.",
  },
  {
    date: "2026-06-12T16:00:00.000Z",
    module: "Work Orders",
    moduleKey: "work_orders",
    category: "migration",
    eventType:
      "Work Orders Phase 1 dual-write ACCEPTED (parent work order + service row mirror verified) — list/detail reads + authoritative mode remain OFF",
    status: "active",
    note: "Work Orders Phase 1 (dual-write only) is now VALIDATED & ACCEPTED in the deployed dev/demo build. SCHEMA GATE (green, pre-flight): read-only anon schema-cache probes returned 200 [] for public.work_orders, public.work_order_service_rows and public.work_order_occurrence_exceptions (visible + RLS-protected); migration 0008 (tables) applied; migration 0009 soft-delete columns (deleted_at) applied on all three; RLS/helper dependencies (companies, profiles, current_company_id(), is_super_admin()) present. FLAG STATE (explicitly pinned): added two lines to web-cleanops/.env — EXPO_PUBLIC_WORK_ORDERS_DUAL_WRITE=true and EXPO_PUBLIC_WORK_ORDERS_SUPABASE_AUTHORITATIVE=false — and rebuilt/redeployed so Vite bakes the flags; the explicit authoritative=false neutralizes the cutoverFlag default-ON so reads stay localStorage/fallback only. EFFECTIVE WORK ORDERS FLAGS: WORK_ORDERS_DUAL_WRITE=true, WORK_ORDERS_LIST_SUPABASE_READ=false, WORK_ORDERS_DETAIL_SUPABASE_READ=false, WORK_ORDERS_SUPABASE_AUTHORITATIVE=false. VALIDATION (fresh Work Order WO-1004, legacy_id wo_a7r43updkv, customer test-time-check1): parent row confirmed in public.work_orders (number=WO-1004, legacy_id=wo_a7r43updkv, status=completed, company_id=26bd8f84-c057-428f-b41e-8ee0de4c8455, company_legacy_id=cmp_9ovsofaxha, customer_legacy_id present, deleted_at=NULL); service row confirmed in public.work_order_service_rows (work_order_legacy_id=wo_a7r43updkv, service_name=svc-service-test-001, status=planned, company_id=26bd8f84-c057-428f-b41e-8ee0de4c8455, company_legacy_id=cmp_9ovsofaxha, deleted_at=NULL). CONCLUSION: parent work order + service row mirror writes are verified; Phase 1 dual-write ACCEPTED. SCOPE BOUNDARIES (unchanged this step): Phase 2 read flags NOT started (cross-browser visibility not expected until WORK_ORDERS_LIST/DETAIL_SUPABASE_READ are enabled + validated), Work Orders authoritative mode NOT enabled, Time Reporting validation remains PAUSED, NO Mission Log changes, NO RLS/migration/backfill changes. NEXT SAFE STEP (separately approved): Phase 2 Work Orders read validation.",
  },
  {
    date: "2026-06-12T10:00:00.000Z",
    module: "Customers",
    moduleKey: "customers",
    category: "audit",
    eventType:
      "Customers list action seam FIXED & ACCEPTED (read/action split-brain, ordered mirror queue, same-browser + cross-browser soft-delete resurrection)",
    status: "active",
    note: "The Customers list / three-dot row-action blocker is now RESOLVED and ACCEPTED for the tested flow: a newly created customer can be deleted with ONE click, the row disappears immediately in the acting browser, stays gone after that browser refreshes, and the cross-browser deleted-customer resurrection is gone after a refresh/re-read. FOUR layered root causes were fixed in sequence. (1) READ/ACTION SPLIT-BRAIN: the Customers list is Supabase-authoritative but the row-action handlers (delete / archive / deactivate / activate) resolved + mutated the AppContext/localStorage customer array, so Supabase-only rows threw 'customer not found' or showed a success toast with stale status. FIX: list-level actions now hydrate the Supabase-rendered row into AppContext/local state first (the same proven CustomerCard hydration pattern, batched via hydrateCustomersFromRemote), so updateCustomer/deleteCustomer/archiveCustomer can always resolve the target row, plus an optimistic overlay so deactivate/archive reflect immediately. (2) UNORDERED MIRROR WRITES: for a just-created customer, the create upsert and a following delete soft-delete were fire-and-forget and unordered, so a delete could match 0 rows and the later create commit left deleted_at null (the 'two clicks' bug). FIX: a per-customer-id ordered FIFO mirror queue (customerMirrorQueue) serialises mirrors for the SAME id (create/upsert completes before delete/archive/deactivate for that id) while independent customers are not globally blocked; UI stays fire-and-forget and never blocks on Supabase. (3) SAME-BROWSER SOFT-DELETE RESURRECTION: after a delete, a stale cached remote snapshot + hydration could write the tombstoned id back into local state. FIX: the hydration effect no longer hydrates tombstoned/deleted ids, the cached remote snapshot is pruned on the delete reconcile signal, and tombstone expiry forces a fresh Supabase read instead of resurrecting a stale row (customerDeleteTombstones). (4) CROSS-BROWSER localOnly RESURRECTION: useCustomerListSource appended ANY local-only row absent from the authoritative remote result, so a second browser kept a soft-deleted customer alive from its own localStorage. FIX: a pending-create registry (customerPendingCreates, mirrors the tombstone pattern) — a localOnly row is only appended if its id is pending-create (registered on createCustomer, cleared when a successful remote read includes it, plus max-age safety); after a CONFIRMED successful non-empty authoritative read, a local row that is neither remote nor pending-create is treated as stale and dropped. FAILURE SAFETY: on a failed / unsafe-empty remote read the existing fallback is preserved — local rows are never pruned. SQL TRUTH confirmed the database was always correct after one delete (deleted_at set, is_soft_deleted true, updated_at advanced); every fix was on the client read/merge/reconcile seam. SCOPE: NO database migration, NO RLS changes, NO flag changes, NO Time Reporting validation, NO unrelated refactors. Tests added/updated and static/build checks passed (use-customer-list-source.test.tsx, customerDeleteTombstones.test.ts, customerPendingCreates.test.ts, customerMirrorQueue.test.ts). Files changed across the seam: src/context/AppContext.tsx, src/hooks/use-customer-list-source.ts, src/lib/data/customerDualWrite.ts, src/lib/data/customerMirrorQueue.ts, src/lib/data/customerDeleteTombstones.ts, src/lib/data/customerPendingCreates.ts, src/lib/data/remoteRecordHydration.ts, src/lib/data/index.ts, src/pages/admin/Customers.tsx. REMAINING RISK: cross-browser propagation is refresh/re-read based (NO realtime/polling by design); a second browser still requires a refresh to observe another browser's delete. NEXT: resume the paused TIME_REPORTING_DUAL_WRITE controlled-checkout validation as a separate, explicitly-approved step.",
  },
  {
    date: "2026-06-11T20:00:00.000Z",
    module: "Settings",
    moduleKey: "settings",
    category: "audit",
    eventType:
      "Settings cross-browser persistence audit: ALL CURRENTLY TESTED BLOCKERS RESOLVED & ACCEPTED (Services, Roles & Permissions, Employee language/spr\u00e5k)",
    status: "active",
    note: "The Settings cross-browser persistence follow-up registered earlier is now RESOLVED for every tested flow \u2014 manually confirmed: a change made in one browser/session is visible from a separate browser/fresh session for (1) Settings \u2192 Services category/service, (2) Roles & Permissions, and (3) Employee Settings \u2192 language/spr\u00e5k. RESOLUTION SUMMARY: (a) Settings \u2192 Services company_admin category/service persistence was fixed by the mirror writer-scope guard (company_admin dual-write batches no longer include global/cross-company rows that RLS rejects, so the new company-scoped row is no longer rolled back), and supporting migrations 0018 (services) + 0019 (service catalog tables) are applied + verified for Services. (b) Employee language/spr\u00e5k persistence was a MISSING-MIGRATION class issue \u2014 migration 0020 (areas, postal_cities, employee_languages) is now applied + verified (read-only anon schema-cache probes returned 200 [] with no PGRST205 for all three tables). (c) Roles & Permissions persistence was the same missing-migration class \u2014 migration 0022 (roles) is now applied + verified (probe returned 200 [], no PGRST205). The authNonce / post-auth re-read fix remains in place so authoritative reads reload once Supabase Auth is ready. SCOPE BOUNDARIES UNCHANGED: service_packages remain super-admin-only by design unless explicitly decided otherwise later; the package-service relationship remains a separate product/architecture decision (NOT redesigned here). NO new implementation, NO flag changes, NO shadow validation, NO read/authoritative cut-over in this governance update. NEXT: with the Settings persistence blockers cleared, the paused TIME_REPORTING_DUAL_WRITE validation may now be resumed as a separate, explicitly-approved step.",
  },
  {
    date: "2026-06-11T18:00:00.000Z",
    module: "Service Catalog",
    moduleKey: "services",
    category: "migration",
    eventType:
      "Settings \u2192 Services company_admin category/service persistence FIXED & ACCEPTED (mirror writer-scope guard)",
    status: "active",
    note: "Company_admin fresh-browser acceptance test PASSED: a category + service created as company_admin in one browser are visible after logging in as the same company_admin in a separate browser/session. ROOT CAUSE FIXED: the dual-write mirror batch could include GLOBAL (company_id null) and cross-company rows read from Supabase, and company_admin is not permitted to upsert global/cross-company rows under RLS \u2014 one invalid row poisoned the whole batched upsert, rolling back the new company-scoped category alongside it. FIX: mirror functions now take an explicit writer scope (writer.companyId + writer.isSuperAdmin) passed from the AppContext persist paths via currentUser; for a non-super-admin writer, any row whose companyId !== writer.companyId is EXCLUDED from the created/updated/removal batches and recorded as skipped with a clear reason (row outside writer company scope), never counted as a failure. Only rows the writer is allowed to write are upserted. Super_admin behaviour is preserved (may still write global rows; no change to global master-data management). Guard applied symmetrically to serviceCategoryDualWrite.ts, serviceDualWrite.ts and payrollGroupDualWrite.ts; getMirrorWriterScope added to the AppContext persist paths (persistServiceCategories, persistServices). SUPPORTING CONTEXT (already in place): migrations 0018 (services) + 0019 (service catalog tables) applied + verified (all four tables return 200, no PGRST205, schema cache healthy); the authNonce / post-auth re-read fix (categories/services/packages reload after Supabase Auth is ready) remains in place. SCOPE BOUNDARIES UNCHANGED: service_packages remain super-admin-only by design; the package-service relationship remains a separate product/architecture decision (NOT redesigned here). NO RLS changes, NO migrations, NO flag changes, NO read/authoritative cutover, NO Time Reporting validation in this fix. Tests added/updated for company_admin mirror diffs (global row skipped, company row upserted) and super_admin still mirroring global rows; static/build checks pass. Changed files: src/lib/data/serviceCategoryDualWrite.ts, src/lib/data/serviceDualWrite.ts, src/lib/data/payrollGroupDualWrite.ts, src/lib/data/serviceCategoryDualWrite.test.ts, src/lib/data/serviceDualWrite.test.ts, src/context/AppContext.tsx.",
  },
  {
    date: "2026-06-11T18:05:00.000Z",
    module: "Settings",
    moduleKey: "settings",
    category: "audit",
    eventType:
      "FOLLOW-UP / BLOCKER REGISTERED: Settings cross-browser persistence audit required (Roles & Permissions, Employee language/spr\u00e5k, other Settings modules)",
    status: "not_ready",
    note: "New broader follow-up opened AFTER the Settings \u2192 Services category/service fix was accepted. The SAME class of cross-browser persistence problem (change is visible in the session where it is made, but NOT visible from another browser/session \u2014 local/browser state updates while persistence/read-back across sessions is unreliable) was observed in OTHER Settings areas during the same acceptance pass: (1) Roles & Permissions, (2) Employee Settings \u2192 language / spr\u00e5k. AUDIT SCOPE (investigation only, NOT started): determine whether the same persistence-architecture pattern \u2014 localStorage-first state, fire-and-forget Supabase mirror, Supabase-authoritative reads, RLS, company scope, or a missing/unapplied migration \u2014 affects Roles & Permissions, Employee language/spr\u00e5k, and any other Settings module with that shape, and classify each as write-path / read-path / RLS / scope-mapping / missing-table. This is the Services-class root cause generalised: company-scoped writes that either never land in Supabase or are read back under a different scope after a fresh session. EXPLICITLY OUT OF SCOPE / HELD: do NOT resume Time Reporting validation, do NOT enable shadow validation, do NOT change read/authoritative flags, do NOT redesign packages, and do NOT implement any new fix \u2014 this entry only registers the audit so it is tracked as a separate blocker. NEXT STEP (separately approved): read-only/code investigation of the affected Settings modules, then report per-module root cause + smallest safe fix plan before any implementation.",
  },
  {
    date: "2026-06-11T15:00:00.000Z",
    module: "Time Reporting",
    moduleKey: "time_reporting",
    category: "migration",
    eventType: "TIME_REPORTING_DUAL_WRITE controlled enablement DEPLOYED — awaiting checkout validation (no read/authoritative/shadow, no UI cut-over)",
    status: "awaiting_validation",
    note: "Controlled Time Reporting dual-write enablement is now DEPLOYED in the dev/demo build but NOT yet validated. PRE-FLIGHT GATES PASSED FIRST: targeted read-only test suites green 96/96 (timeReportingDualWrite / timeReportingParity / timeReportingParityRunner / timeReportingShadowHook), and the migration 0032 schema gate passed in the deployed Supabase — all nine required tables (time_reports, time_allocations, time_report_events, time_report_flags, time_report_flag_events, time_report_messages, time_deviation_reason_codes, saved_filters, saved_review_queues) returned 200 [] on the read-only anon schema-cache probe (visible + RLS-protected). FLAG CHANGE: added EXPO_PUBLIC_TIME_REPORTING_DUAL_WRITE=true to web-cleanops/.env (single line) and rebuilt/redeployed so the Vite bundle bakes in the flag. EFFECTIVE DEPLOYED FLAG STATE: MISSION_LOG_DUAL_WRITE=true (already validated, the other active flag), TIME_REPORTING_DUAL_WRITE=true (NEWLY ENABLED), TIME_REPORTING_SHADOW_VALIDATE=false, TIME_REPORTING_SUPABASE_READ=false, TIME_REPORTING_SUPABASE_AUTHORITATIVE=false, MISSION_LOG_SUPABASE_READ=false, MISSION_LOG_SUPABASE_AUTHORITATIVE=false. RESULT: each checkout now ALSO mirrors the Time Reporting tables; the legacy localStorage checkout stays AUTHORITATIVE (the mirror is fire-and-forget, never throws, never surfaces failures). NO controlled checkout validation run yet, NO shadow validation, NO reads, NOT Supabase-authoritative, NO UI/read cut-over. NEXT SAFE STEP (separately approved): run the controlled Checkout A/B/C validation set and verify Time Reporting mirror telemetry in the Parity Diagnostics panel. Changed files: web-cleanops/.env, src/lib/developmentCenter.ts, src/lib/developmentTimeline.ts.",
  },
  {
    date: "2026-06-11T12:00:00.000Z",
    module: "Time Reporting",
    moduleKey: "time_reporting",
    category: "status",
    eventType: "Time Reporting Parity Diagnostics BUILT (Shadow-Validate Phase 0, observability only) — no flag change, shadow validation still OFF",
    status: "awaiting_activation",
    note: "Added a read-only Time Reporting Parity Diagnostics panel to Development Center (super_admin only, directly below the Mission Log Dual-Write Diagnostics panel and above the System Timeline). It exposes the previously-dormant Slice 2d-2 / 2c-2a telemetry in the deployed dev/demo build without DevTools: EFFECTIVE build-time-baked flags (EXPO_PUBLIC_TIME_REPORTING_DUAL_WRITE / _SHADOW_VALIDATE / _SUPABASE_READ / _SUPABASE_AUTHORITATIVE), a Dual-write ACTIVE/INACTIVE pill (shouldMirrorTimeReportingCheckout) + a Shadow ACTIVE/INACTIVE pill, the getTimeReportingParityState() summary (totalChecked / matched / mismatched / missingInSupabase / missingInLegacy / fetchFailures / lastValidationAt / lastError), severity counters (blocking / warning / info), per-domain counters (allocation / status / flag / event / message / mission-link), the getTimeReportingCutoverState() checkout dual-write telemetry (attempted / succeeded / failed / skippedMissingCompany / lastRun) and the SANITIZED 50-cap recent-mismatch ring, with a clear empty-state when no parity run has occurred. OBSERVABILITY ONLY: no toggles, no mutations, no automatic test execution, no live-data writes — it only READS existing exported telemetry. NO flags changed: TIME_REPORTING_DUAL_WRITE / _SHADOW_VALIDATE / _SUPABASE_READ / _SUPABASE_AUTHORITATIVE all remain DEFAULT OFF; only the already-validated MISSION_LOG_DUAL_WRITE stays true. NO runtime behaviour change, NO read cut-over, NOT Supabase-authoritative. Build/static checks passed. Shadow validation NOT enabled — the panel reads its dormant empty state until TIME_REPORTING_SHADOW_VALIDATE is turned on in a future controlled step.",
  },
  {
    date: "2026-06-11T09:00:00.000Z",
    module: "Mission Log",
    moduleKey: "mission_log",
    category: "migration",
    eventType: "Mission Log dual-write CONTROLLED CHECKOUT VALIDATION PASSED — flag live in deployed build, no read cut-over",
    note: "Controlled validation of the Slice 2c-1 Mission Log checkout dual-write is now PASSED in the deployed dev/demo build. Migration 0031 applied + verified (4 tables / 3 deleted_at / 0 events-mutable / 4 RLS / 0 event update-delete policies / 3 mutable update triggers). EXPO_PUBLIC_MISSION_LOG_DUAL_WRITE=true is confirmed ACTIVE in the deployed bundle (an earlier zero-row result was a stale pre-flag bundle; resolved by rebuild/redeploy). A read-only Mission Log Dual-Write Diagnostics panel was added to Development Center (super_admin, directly above the System Timeline) surfacing the effective MISSION_LOG_DUAL_WRITE flag + sanitized cut-over telemetry (attempted/succeeded/failed/skippedMissingCompany). VALIDATION METHOD: two controlled checkouts on the SAME service-row mission context (scheduled/actual 180/184, then 60/60). OBSERVED ROWS: mission_log_entries=1, mission_staff_sessions=2, mission_log_events=2 (idempotency_key checked_out:trep_ggllcen3rm + checked_out:trep_6c3v9oixdv — distinct legacy report ids, both employee_checked_out / actor employee / same mission_log_entry_legacy_id), mission_booked_time_ratings=0. INTERPRETATION CONFIRMED CORRECT: one mission entry per work-order/service-row context (UPSERT converges), one staff session per checkout/time report (OPTION B distinct-session id), one immutable employee_checked_out event per checkout/time report (distinct idempotency_key → no false duplicate, no event mutation), and zero booked-time ratings as expected (the dual-write deliberately never writes mission_booked_time_ratings). FLAGS UNCHANGED: MISSION_LOG_SUPABASE_READ=false, MISSION_LOG_SUPABASE_AUTHORITATIVE=false, TIME_REPORTING_SHADOW_VALIDATE=false. NO Mission Log UI / read cut-over / Supabase-authoritative status started. NO migrations or backfill in this step — status/diagnostics only. NEXT SAFE STEP (recommendation, not yet executed): the dual-write can be PAUSED here as validated, or TIME_REPORTING_SHADOW_VALIDATE enabled later as the next gated step per the rollout runbook; reads/authoritative mode remain out of scope.",
  },
  {
    date: "2026-05-28T09:00:00.000Z",
    module: "Customers",
    moduleKey: "customers",
    category: "migration",
    eventType: "Migration verified",
    from: "in_progress",
    to: "verified",
    status: "awaiting_activation",
    note: "Read + write parity verified; drift clean during soak.",
  },
  {
    date: "2026-05-28T09:30:00.000Z",
    module: "Customers",
    moduleKey: "customers",
    category: "status",
    eventType: "Release readiness raised",
    from: "not_ready",
    to: "awaiting_activation",
    status: "awaiting_activation",
    note: "Pending activation approval; localStorage retained for rollback.",
  },
  {
    date: "2026-05-29T11:00:00.000Z",
    module: "Work Orders",
    moduleKey: "work-orders",
    category: "migration",
    eventType: "Migration verified",
    from: "in_progress",
    to: "verified",
    status: "awaiting_activation",
    note: "Dual-write parity verified; cutover telemetry clean.",
  },
  {
    date: "2026-05-29T11:30:00.000Z",
    module: "Work Orders",
    moduleKey: "work-orders",
    category: "status",
    eventType: "Release readiness raised",
    from: "not_ready",
    to: "awaiting_activation",
    status: "awaiting_activation",
  },
  {
    date: "2026-05-30T10:00:00.000Z",
    module: "Schedule",
    moduleKey: "schedule",
    category: "audit",
    eventType: "Verification completed",
    note: "Shadow-read parity and read-path performance audited.",
  },
  {
    date: "2026-05-30T10:15:00.000Z",
    module: "Schedule",
    moduleKey: "schedule",
    category: "migration",
    eventType: "Migration verified",
    from: "partial",
    to: "verified",
    status: "verified",
    note: "Interval-scoped read path verified with clean drift.",
  },
  {
    date: "2026-05-30T10:30:00.000Z",
    module: "Schedule",
    moduleKey: "schedule",
    category: "status",
    eventType: "Release readiness raised",
    from: "not_ready",
    to: "awaiting_activation",
    status: "awaiting_activation",
  },
  {
    date: "2026-06-01T14:00:00.000Z",
    module: "Framework",
    category: "governance",
    eventType: "Migration Framework v0.2 adopted",
    note: "Separate-axes model: ModuleStatus / MigrationStatus / ReleaseReadiness kept independent.",
  },
  {
    date: "2026-06-01T15:00:00.000Z",
    module: "Framework",
    category: "governance",
    eventType: "Derived Badge Mapping spec accepted",
    note: "Read-only display badge derived from existing registry fields; never promotes stored status.",
  },
  {
    date: "2026-06-02T08:00:00.000Z",
    module: "Employees",
    moduleKey: "employees",
    category: "audit",
    eventType: "EMP-2 architecture plan approved",
    note: "Read-path seam, telemetry shape, and empty-result safety rule agreed before implementation.",
  },
  {
    date: "2026-06-02T10:00:00.000Z",
    module: "Employees",
    moduleKey: "employees",
    category: "migration",
    eventType: "EMP-2 Stage 1 complete",
    from: "planned",
    to: "built",
    status: "in_progress",
    note: "Read-path infrastructure: feature flag (OFF), employeeCutover telemetry, read-seam hook + tests.",
  },
  {
    date: "2026-06-02T12:00:00.000Z",
    module: "Employees",
    moduleKey: "employees",
    category: "migration",
    eventType: "EMP-2 Stage 2 wired (dormant)",
    from: "built",
    to: "wired_dormant",
    status: "in_progress",
    note: "Read seam wired into AppContext behind EMPLOYEES_SUPABASE_READ; telemetry strip added to System Performance.",
  },
  {
    date: "2026-06-02T12:30:00.000Z",
    module: "Employees",
    moduleKey: "employees",
    category: "activation",
    eventType: "Activation paused",
    status: "not_ready",
    note: "EMPLOYEES_SUPABASE_READ remains OFF. No flag-ON soak in shared/demo environment. localStorage authoritative.",
  },
  {
    date: "2026-06-02T12:45:00.000Z",
    module: "Employees",
    moduleKey: "employees",
    category: "status",
    eventType: "Governed status held",
    status: "in_progress",
    note: "Employees remains Under Migration / Not Ready; localStorage remains the only write target.",
  },
  {
    date: "2026-06-02T14:00:00.000Z",
    module: "Framework",
    category: "governance",
    eventType: "Service Architecture review & stabilization phase opened",
    note: "PayrollBasis Core paused; Service foundation hardened first (Categories, Payroll Groups, OB review, architecture review).",
  },
  {
    date: "2026-06-02T14:15:00.000Z",
    module: "Services",
    moduleKey: "services",
    category: "governance",
    eventType: "Service Categories governance added",
    note: "Stable categoryType enum + Super Admin–governed global catalogue (7 categories). Additive; legacy categories backfilled, no data loss.",
  },
  {
    date: "2026-06-02T14:30:00.000Z",
    module: "Services",
    moduleKey: "services",
    category: "governance",
    eventType: "Payroll Groups model established",
    note: "5 governed payroll/statistics aggregation groups; optional payrollGroupId on Service. Model + settings structure only — no statistics UI.",
  },
  {
    date: "2026-06-02T14:45:00.000Z",
    module: "Statistics Foundation",
    moduleKey: "statistics_foundation",
    category: "status",
    eventType: "Registered (planned)",
    to: "planned",
    status: "not_ready",
    note: "Documentation/roadmap only. Depends on Time Codes, Service Basis Types, Payroll Groups, PayrollBasis. Snapshot-read rule recorded.",
  },
  {
    date: "2026-06-03T11:00:00.000Z",
    module: "Roles & Permissions",
    moduleKey: "roles",
    category: "governance",
    eventType: "Role assignment state synced via shared matcher",
    note: "Read-side only — no auth, schema, permission-model or write-path change. Introduced a single shared userHoldsRole matcher in lib/employeeRoles (explicit roleId OR matching built-in role for base role + company) and used it for the role-card count, member list and the Assign dialog. Users who already hold a role (incl. via base role) now render as a disabled, blue ‘Assigned’ state; assignUserRole and the Assign handler both no-op on duplicate assignment. Role count, member list, Assign dialog, customer/user card and employee role display now agree. Changed files: src/lib/employeeRoles.ts, src/components/roles/RolesPanel.tsx, src/components/roles/AssignUsersDialog.tsx, src/context/AppContext.tsx.",
  },
  {
    date: "2026-06-03T11:30:00.000Z",
    module: "Employees",
    moduleKey: "employees",
    category: "governance",
    eventType: "Area Access management added to Employee page",
    note: "UX only — no schema or permission-model change. Added an ‘Area access’ row action (focused dialog, not inline) for employees with a linked login: view current access, choose All areas or selected areas, save via the existing updateUser(login.id, { areaScope }) path. Area-picker logic extracted into a shared AreaScopePicker reused by UserDialog and the new EmployeeAreaAccessDialog, so behaviour stays consistent. Area access stays on User.areaScope; employees without a login show ‘Create login first’ and cannot edit area access until a login exists. Changed files: src/components/users/AreaScopePicker.tsx, src/components/users/UserDialog.tsx, src/components/employees/EmployeeAreaAccessDialog.tsx, src/pages/admin/Employees.tsx.",
  },
  {
    date: "2026-06-03T09:00:00.000Z",
    module: "Roles & Permissions",
    moduleKey: "roles",
    category: "governance",
    eventType: "Roles & Permissions UX/read-side consistency pass completed & verified",
    note: "Read-side only — no auth, schema, permission-rule, security-model, Customer write-path or Work Order changes. company_admin and super_admin role cards now share the same useAssignedUsers roster for counts; customers (incl. login-less records) included in Assigned Users; member counts inspectable via in-place RoleMembersDialog on both surfaces; permission inspection via RolePermissionsDialog; full Assigned Users navigation retained. Build/static checks pass. Changed files: src/components/roles/RoleTemplatesGrid.tsx, src/hooks/use-assigned-users.ts.",
  },
  {
    date: "2026-06-03T15:00:00.000Z",
    module: "Employees",
    moduleKey: "employees",
    category: "governance",
    eventType: "Per-day availability surfaced on Employee roster (compact)",
    note: "UX/read-side only — no schema or permission-model change. Following the per-day availability model (acceptable vs. preferred windows per weekday), added a single-line Availability column to the Employees list. A pure formatCompactAvailability helper in lib/employeeSchedule collapses a contiguous, uniform schedule to e.g. ‘Mon–Fri 08:00–16:00’ and anything that differs between days (different windows or gaps) to ‘Variable’, keeping the roster scannable; the full per-day breakdown remains on the Add/Edit dialog and profile. Synthetic admin rows show ‘—’. Future consideration recorded: Availability (WHEN someone can work) and Employment (employment type, employment rate %, contracted hours) are distinct concepts and must live on separate models — employment data must NOT be folded into the availability model. Changed files: src/lib/employeeSchedule.ts, src/pages/admin/Employees.tsx.",
  },
  {
    date: "2026-06-03T13:00:00.000Z",
    module: "Employees",
    moduleKey: "employees",
    category: "governance",
    eventType: "Company Admins surfaced in Employee roster",
    note: "Read-side only — no auth, schema, permission-model or write-path change. The Employee roster previously synthesized a display-only row only for the signed-in Super Admin, so Company Admin logins without an employee profile (the viewer themselves and peer admins) were missing. Generalized the synthetic-row logic to cover all admin logins (company_admin + super_admin) in the company that lack a linked employee record, deduping against real employee rows. Customer visibility is company- + area-scoped (never employee-linked), so customers created by these admins were always company-visible; confirmed no regression for other roles, custom roles or existing customer visibility. Changed files: src/pages/admin/Employees.tsx.",
  },
  {
    date: "2026-06-03T15:00:00.000Z",
    module: "Roles & Permissions",
    moduleKey: "employees",
    category: "governance",
    eventType: "Security: Super Admin role is Super-Admin-assignable only",
    note: "Security fix — no schema change. Root cause: role selectors offered every active role regardless of who was assigning, so a Company Admin could pick Super Admin when adding/editing an employee. Added a single canAssignRole(assignerRole, role) boundary in lib/employeeRoles — the Super Admin base role may only be granted by a Super Admin — and threaded it through listAssignableRoles(companyId, roles, assignerRole) so the option never appears for non-super-admins. Enforced the SAME rule at every write path so a crafted request can't bypass the UI: AppContext.assignUserRole, createEmployeeWithLogin (base role AND pinned custom role) and createUser all reject Super Admin elevation unless the actor is Super Admin. EmployeeDialog now passes currentUser.role into the selector. Other roles (Company Admin, Employee, Customer, custom roles) remain assignable by both admins. Changed files: src/lib/employeeRoles.ts, src/components/employees/EmployeeDialog.tsx, src/context/AppContext.tsx, src/lib/employeeRoles.test.ts.",
  },
  {
    date: "2026-06-03T15:30:00.000Z",
    module: "Customers",
    moduleKey: "customers",
    category: "governance",
    eventType: "Admins exempt from Area Scoped Access for customers",
    note: "Visibility fix — no schema or permission-model change. Root cause: Area Scoped Access filters customers by the login's area scope, and area-less customers (no areaId) are visible to all-area scopes only; a Company Admin carrying a selected scope therefore lost newly created, area-less customers. Added isAreaScopeExempt(role) in lib/areaScope (super_admin + company_admin) as the single source of truth for who bypasses area scoping, and applied it in the Customers list and the Customer Card access guard (previously only Super Admin bypassed). Result: administrators reliably see all company customers — including area-less ones — while Area Scoped Access still narrows ordinary staff. Changed files: src/lib/areaScope.ts, src/pages/admin/Customers.tsx, src/pages/admin/CustomerCard.tsx.",
  },
  {
    date: "2026-06-03T16:00:00.000Z",
    module: "Roles & Permissions",
    moduleKey: "employees",
    category: "governance",
    eventType: "Super Admin cross-company role editing (Assigned Users)",
    note: "The Super Admin Assigned Users directory was read-only. Made the Role column inline-editable for Super Admins only: a per-row selector lists the assignable roles for THAT user's own company via listAssignableRoles(userCompanyId, roles, 'super_admin') and writes through the existing assignUserRole path, so the assignment always targets the correct company/user and is never blocked by company-scoped filters. Non-super-admins keep the read-only badge view. Changed files: src/components/roles/AssignedUsersTable.tsx.",
  },
  {
    date: "2026-06-03T16:15:00.000Z",
    module: "Customers & Employees",
    category: "governance",
    eventType: "Delete policy (no-operational-history) — scoping note",
    note: "Investigation note — no code change. Permanent customer/employee delete (allowed only with no Work Orders/Missions, with cascade cleanup, else Archive) has NO existing infrastructure: there is no deleteCustomer/deleteEmployee path, no archived state (EntityStatus is active|inactive only), and archiveValidation.ts covers only work-order service rows/variations. This is a net-new feature requiring a typed dependency-cascade engine and is tracked as a dedicated follow-up rather than bundled with the security/visibility fixes, to avoid risky data loss. Today only Deactivate/Activate exists.",
  },
  {
    date: "2026-06-03T18:30:00.000Z",
    module: "Customers",
    category: "governance",
    eventType: "Add Customer accordion UX + onboarding visibility",
    note: "The Add/Edit Customer dialog was rebuilt as the same single-expand accordion used by the Employee dialog: Box 1 Customer information (name, new orgNumber, email, phone, customer type), Box 2 Cleaning days & time (read-only summary pointing to the workspace's Cleaning Days & Time step to avoid a duplicate per-day editor), Box 3 Keys & alarm (Coming soon placeholder, summary 'Not configured'), Box 4 Location & ownership (postal city, area, customer owner, connected logins), and Box 5 Onboarding (create-only). Onboarding is now an explicit, pre-selected choice instead of two ambiguous buttons: a 'Start onboarding process (Recommended)' checkbox drives the single primary action ('Create & start onboarding' vs 'Add customer'). New persisted Customer fields onboardingStatus ('in_progress'|'completed'), onboardingStartedAt, onboardingCompletedAt (plus orgNumber); createCustomer accepts orgNumber/phone/startOnboarding and stamps the status. The Customers list shows a 'Onboarding' badge while in_progress; the customer workspace gains an 'Onboard Process' section (only while in_progress) explaining the admin can return to complete info here or via the Customer card, with a 'Mark onboarding complete' action. Finish onboarding now also marks the active customer's onboarding complete. Changed files: src/types/index.ts, src/context/AppContext.tsx, src/components/customers/CustomerDialog.tsx, src/pages/admin/Customers.tsx.",
  },
  {
    date: "2026-06-03T19:30:00.000Z",
    module: "Employees",
    category: "governance",
    eventType: "Permanent delete now releases the email for reuse (orphaned login fix)",
    note: "Bug: after permanently deleting an employee with no operational history, re-adding an employee with the SAME email was blocked by 'A user with this email address already exists.' Root cause: deleteEmployee only removed the LOCAL users-array row; the Supabase Auth user and its profiles row (which mirrors the email and backs the Edge Function's duplicate pre-check) were never deleted, so the email stayed reserved. Fix: new admin-delete-user Edge Function (service_role only, verify_jwt=false, performs its own authz — active super_admin may delete anyone; active company_admin may delete only non-super-admins in their own company; blocks self-deletion) deletes the auth user by id, which cascades to the profile via 'profiles.id references auth.users(id) on delete cascade' (migration 0003), releasing the email. New client helper deleteSupabaseUser (in adminCreateUser.ts) posts the auth user id with the caller's session token; non-UUID (local-only) logins are treated as already-released; a not-found user is idempotent success. deleteEmployee is now async and, when ENABLE_USER_CREATION is on, releases the Supabase user FIRST and ABORTS the whole delete if that fails — so the employee is never removed while an orphaned login/locked email remains. The localStorage-only path already freed the email (it drops the users-array row). Employees page handleDelete awaits the async delete. Test: src/lib/adminDeleteUser.test.ts covers skip-local-only, posts-and-succeeds, and surfaces-error-so-caller-aborts. NOTE: the Edge Function must be deployed (supabase functions deploy admin-delete-user) before the fix takes effect in the cloud-user mode. Changed files: supabase/functions/admin-delete-user/index.ts (new), supabase/config.toml, src/lib/adminCreateUser.ts, src/context/AppContext.tsx, src/pages/admin/Employees.tsx, src/lib/adminDeleteUser.test.ts.",
  },
  {
    date: "2026-06-03T17:00:00.000Z",
    module: "Customers & Employees",
    category: "governance",
    eventType: "Delete / Archive policy shipped (no-operational-history)",
    note: "Net-new feature. Permanent delete is now possible for test/new records with no operational history; records with history must be archived. New pure validators in lib/entityDeleteValidation: validateCustomerDelete (blocked by any work order OR mission/scheduled visit) and validateEmployeeDelete (blocked by any completed mission OR future assigned mission). AppContext resolves dependency counts from the live stores and exposes getCustomerDeletability/deleteCustomer/archiveCustomer and getEmployeeDeletability/deleteEmployee/archiveEmployee, all restricted to Company Admin + Super Admin. Delete cascades safe cleanup to avoid orphans — customer delete removes owned media assets and cleaning protocols and unlinks portal logins (notes/card-log/contacts/addresses live on the record and go with it); employee delete removes owned media, the linked login/user account, and clears customer-owner references. Archive is the history-preserving fallback: sets status inactive + a new archivedAt timestamp (added to Customer and Employee types), suspends the customer's active protocols, and disables the linked employee login. Delete is self-protected (an admin can't delete/archive their own account) and synthetic admin roster rows are never deletable. UI: a single ‘Delete or archive…’ row action on both the Customers and Employees pages opens a confirmation dialog that offers a permanent Delete only when allowed, always offers Archive, and lists the blocking reasons when delete is blocked. New audit actions customer.delete/customer.archive/employee.delete/employee.archive. Changed files: src/lib/entityDeleteValidation.ts (new), src/types/index.ts, src/context/AppContext.tsx, src/pages/admin/Customers.tsx, src/pages/admin/Employees.tsx.",
  },
  {
    date: "2026-06-03T20:15:00.000Z",
    module: "Roles & Permissions",
    category: "governance",
    eventType: "Deleted users now disappear from Assigned Users (stale roster cache fix)",
    note: "Bug: after a Company Admin permanently deleted employees/users, those users (e.g. Company Admins Marcus Lannö and Nadiia Onysko) still appeared in Master Admin → Roles & Permissions → Assigned Users, role member counts and other role surfaces. Root cause: Assigned Users is NOT a separate source of truth — every role surface (AssignedUsersTable, RolesPanel, RoleTemplatesGrid, CompanyAssignmentsTable) reads the single useAssignedUsers() roster, which folds Supabase `profiles` via the React Query key ['admin-profiles-roster'] (staleTime 60s). deleteEmployee correctly deletes the Supabase auth user (cascading to its profile via migration 0003), but never invalidated that cached query, so the deleted profile lingered in the cache for the lifetime of the session. Fix: AppContext now calls queryClient.invalidateQueries({ queryKey: ['admin-profiles-roster'] }) after a successful deleteEmployee AND archiveEmployee, forcing an immediate refetch so the roster (and every dependent role surface + member count) reflects the live profiles table. Cross-session was already correct — a fresh Master Admin load refetches and omits deleted profiles — so this closes the same-session stale-cache gap. Customer delete/archive needs no equivalent because the customer roster source reads the reactive local customers store directly. NOTE: requires the admin-delete-user Edge Function to be deployed (supabase functions deploy admin-delete-user) for the profile to actually be removed in cloud-user mode. Changed files: src/context/AppContext.tsx.",
  },
  {
    date: "2026-06-03T21:30:00.000Z",
    module: "Employees",
    category: "governance",
    eventType: "Email-based fallback cleanup for legacy employee delete",
    note: "Follow-up to the 'delete releases the email' fix. Legacy employees can carry a local/non-UUID userId (e.g. usr_...) while an orphaned Supabase auth user + profiles row still reserves the email — so deleting purely by userId never freed the email and re-create kept failing. Fix: admin-delete-user now accepts an OPTIONAL `email` alongside `user_id`. Path selection: a valid auth UUID still deletes by id; otherwise the function falls back to an email lookup over `profiles` (ilike). The email path resolves to EXACTLY ONE profile — zero matches is idempotent success (email already free), and TWO OR MORE matches fail safely with a 409 email_conflict instead of guessing. ALL existing safety rules apply to the resolved target on both paths: never delete the signed-in caller; Company Admin may only delete non-super-admins in their OWN company; Super Admin may delete across companies; deletion cascades to the profile via migration 0003, releasing the email. Client deleteSupabaseUser(userId, email?) now sends user_id when it's a real UUID and/or a lowercased email; it only skips the server entirely when there is neither a UUID nor an email. deleteEmployee passes BOTH target.userId and target.email and calls the function whenever ENABLE_USER_CREATION is on and either is present, still aborting the whole delete if cloud cleanup fails (no orphans). Temporary debug logging is kept (deleteEmployee, deleteSupabaseUser, and the function's request/lookup/response logs) until legacy + new delete→recreate is confirmed. FUNCTION_VERSION bumped to 2024-delete-user-3-email-fallback-debug. Tests: src/lib/adminDeleteUser.test.ts adds email-fallback-on-local-id and id+email cases. NOTE: redeploy required — supabase functions deploy admin-delete-user. Changed files: supabase/functions/admin-delete-user/index.ts, src/lib/adminCreateUser.ts, src/context/AppContext.tsx, src/lib/adminDeleteUser.test.ts.",
  },
  {
    date: "2026-06-03T23:00:00.000Z",
    module: "Employees & Roles",
    category: "governance",
    eventType: "Single source of truth: directory + assigned-users now share the global profiles roster",
    note: "Bug: a newly created employee (e.g. testuser@stadalliansen.se) did NOT appear on Company Admin → Employees, while Master Admin → Roles & Permissions → Assigned Users showed a different dataset (incl. people who should no longer exist). Root cause: there was NO single source of truth. The Employees page read ONLY this device's localStorage employees (+ synthetic admin rows built from the local users array), whereas Assigned Users folded in the GLOBAL Supabase `profiles` roster. A login provisioned on another device created a global profile but no local employee record on the viewing device, so it was visible to Assigned Users but invisible to Employees; the two surfaces never converged. Fix: profiles is now the shared global identity backbone for BOTH surfaces. New listDirectoryProfiles() in lib/profile.ts returns EVERY RLS-visible profile (all roles, super admin sees all / company admin sees own company — migration 0003 policies), and listAdminProfiles now derives from it. New shared hook useDirectoryProfiles() (src/hooks/use-directory-profiles.ts) fetches that roster once under the single React Query key ['directory-profiles-roster'] (staleTime 60s). useAssignedUsers consumes the shared hook instead of its own admin-only query. The Employees page also consumes it and folds in profile-only rows (__profile__: prefix) for staff/admin logins (super_admin/company_admin/employee; customers excluded) that have no local representation — deduped by lower-cased email against local employees + admin rows, company-scoped, role shown read-only via RoleBadge and per-row actions hidden (no editable local record). AppContext invalidates the shared key after createUser, createEmployeeWithLogin and createLoginForEmployee (Supabase path) AND after deleteEmployee/archiveEmployee, so creates appear and deletes/archives disappear across every directory surface immediately. Read-only consolidation — no auth, schema, permission-rule or write-path changes. Build/static checks pass. Changed files: src/lib/profile.ts, src/hooks/use-directory-profiles.ts (new), src/hooks/use-assigned-users.ts, src/pages/admin/Employees.tsx, src/context/AppContext.tsx.",
  },
  {
    date: "2026-06-03T23:45:00.000Z",
    module: "Framework",
    category: "audit",
    eventType: "localStorage source-of-truth audit completed (no migration implemented)",
    note: "Full audit of every store seam to map where CleanOps still uses localStorage as the source of truth. Method: enumerated all localStorage.getItem/setItem writers and the lib/store.ts key registry, cross-checked against the Supabase migrations (0001–0016), the repository seams in lib/data, and the migration feature flags in lib/featureFlags.ts. KEY FINDING: every migration flag (CUSTOMERS_* / WORK_ORDERS_* / SCHEDULE_* / EMPLOYEES_SUPABASE_READ) defaults OFF and none is set via EXPO_PUBLIC_* in this environment, so for the flagged areas localStorage is STILL authoritative and Supabase is a validated shadow only. CLASSIFICATION — (A) Supabase-first / already migrated: Companies (read via USE_SUPABASE_COMPANIES + companiesSupabase.ts), Identity/Profiles (auth + admin/directory roster via lib/profile.ts, used live by Employees + Assigned Users), Customer Agreements (customerAgreementRepository, migr 0013), Agreement Templates (agreementTemplatesRepository, migr 0015), Time Bank (timeBankRepository, migr 0014/0016). (B) Hybrid / shadow infra present but localStorage authoritative (flags OFF): Customers (list/detail read + dual-write + authoritative seams all OFF; tables 0007), Work Orders/AO (same; tables 0008/0009), Schedule (interval read + authoritative input OFF), Employees (read-side directory now folds the global profiles roster for DISPLAY, but ALL writes + the canonical record stay in localStorage; EMPLOYEES_SUPABASE_READ OFF; table 0010), Roles & Permissions (assigned-users roster reads profiles, but role definitions cleanops.roles and every role ASSIGNMENT are localStorage). (C) localStorage-first, no Supabase path yet: Users/logins credential array (cleanops.users — distinct from profiles), Missions/visit occurrences (visitOccurrenceStore), Services + Service Categories + Packages + Payroll Groups + Favorites, Teams (cleanops.teams), Areas + Postal Cities + Employee Languages, Payroll export (payrollExportStore — table 0012 exists but UI reads local), Time Codes (timeCodeStore — table 0011 exists but UI reads local), Settings (system/company/settings-templates/work-order/time-report/duration), Modules + Company Modules + Module Categories, Checklists (templates/adoptions/categories), Protocols (customer protocols/runs/library rooms+tasks/floor presets), Media assets (mediaStore), Booking Queue + occurrence exceptions, Invoices, Time Reports, Audit events, Service entitlements (global/company/log). (D) Demo/dev-only localStorage (no migration needed): session + reset tokens (legacy auth demo path, bypassed when USE_SUPABASE_AUTH on), per-company feature flags, recent customers, sidebar collapsed state, and the one-time cleanops.migration.* backfill guards. RISKS confirmed: cross-device mismatch for every (B)/(C) area (data is per-browser); stale users + role/profile mismatch because identity is global (profiles) while logins+roles are local; deleted records linger cross-device (a delete on one browser never reaches another); customer visibility mismatch (a customer created on device A is invisible on device B); and TOTAL data loss for all (B)/(C) stores if localStorage is cleared — only (A) survives. A cleanup/migration plan to retire localStorage as source of truth has been proposed to the team; deliberately NOT implemented in this step (audit + classification + documentation only). Changed files: src/lib/developmentTimeline.ts.",
  },
  {
    date: "2026-06-03T23:55:00.000Z",
    module: "Customers",
    moduleKey: "customers",
    category: "migration",
    eventType: "Customers cut over to Supabase-authoritative (B-area 1)",
    from: "awaiting_activation",
    to: "supabase_authoritative",
    status: "active",
    note: "First operational B-area cut-over off localStorage source-of-truth, executed on the existing Wave 1F infrastructure (no new data path). New cutoverFlag() resolver in lib/featureFlags makes a source-of-truth flag authoritative-ON by default in real app builds, OFF only under vitest (so the safe-default cut-over suites keep validating the localStorage path), with instant rollback via an explicit =false env override. Flipped CUSTOMERS_SUPABASE_AUTHORITATIVE to that resolver, which IMPLIES the list + detail read paths and the dual-write mirror. RESULT: the Customers list and Customer Card now READ from Supabase as primary (company-scoped, via the validated CustomerRepository seam), and every create/update/archive writes localStorage first (the synchronized backout copy) then mirrors to the authoritative Supabase customers table — so customer create/update/archive is consistent across devices and stale per-device localStorage no longer wins. SAFETY: reads fall back to the localStorage backout copy on Supabase error OR empty result (the list never blanks), and every fallback/mirror failure is recorded in the cut-over telemetry + surfaced via the write-failure toast (never silent). ROLLBACK is instant + data-free: EXPO_PUBLIC_CUSTOMERS_SUPABASE_AUTHORITATIVE=false. Work Orders / Schedule / Employees remain on their existing flags (still localStorage-authoritative) and are the next B-areas in order. Tests: all 1809 pass (cut-over suite still validates the OFF default under vitest); build/static checks pass. Changed files: src/lib/featureFlags.ts, src/lib/developmentTimeline.ts.",
  },
  {
    date: "2026-06-04T08:00:00.000Z",
    module: "Work Orders",
    moduleKey: "work-orders",
    category: "migration",
    eventType: "Work Orders cut over to Supabase-authoritative (B-area 2)",
    from: "awaiting_activation",
    to: "supabase_authoritative",
    status: "active",
    note: "Second B-area cut-over off localStorage source-of-truth, executed simultaneously with Schedule on the existing WO-6 infrastructure (no new data path). Flipped WORK_ORDERS_SUPABASE_AUTHORITATIVE from the OFF-by-default envFlag()||false to the shared cutoverFlag() resolver — authoritative-ON in real app builds, OFF only under vitest so the safe-default cut-over suites keep validating the localStorage path, with instant rollback via an explicit =false env override. The flag IMPLIES the WO list + WorkOrderDetails read paths and the dual-write mirror (parent + work_order_service_rows + the separate work_order_occurrence_exceptions incl. WO-5.6 soft-delete removal propagation). RESULT: the Work Order list (Customer Card · Work Orders tab) and WorkOrderDetails now READ from Supabase as primary (company/area-scoped via the validated WorkOrderRepository seam), and every create/update/archive/service-row/variation/staffing/exception write completes against localStorage first (the synchronized backout copy) then mirrors to the authoritative Supabase tables — so work-order changes are consistent across devices and stale per-device localStorage no longer wins. SAFETY: reads fall back to the localStorage backout copy on Supabase error OR empty result (lists never blank), and every fallback/mirror failure is recorded in the cut-over telemetry + surfaced (never silent). ROLLBACK is instant + data-free: EXPO_PUBLIC_WORK_ORDERS_SUPABASE_AUTHORITATIVE=false. Changed files: src/lib/featureFlags.ts, src/lib/developmentTimeline.ts.",
  },
  {
    date: "2026-06-04T08:05:00.000Z",
    module: "Schedule",
    moduleKey: "schedule",
    category: "migration",
    eventType: "Schedule cut over to Supabase-authoritative input (B-area 2)",
    from: "awaiting_activation",
    to: "supabase_authoritative",
    status: "active",
    note: "Third B-area cut-over, executed simultaneously with Work Orders as a single step on the existing P6D infrastructure (no new schedule engine, no realtime). Flipped SCHEDULE_SUPABASE_AUTHORITATIVE from the OFF-by-default envFlag()||false to the shared cutoverFlag() resolver — authoritative-ON in real app builds, OFF only under vitest so the safe-default suites keep validating the localStorage input path, with instant rollback via an explicit =false env override. The flag IMPLIES the P6C interval-scoped Supabase read path. SCOPE: the cut-over moves only the SOURCE of the resolver INPUT (work orders + base occurrence exceptions) to Supabase-authoritative; resolveScheduleProgram, recurrence, variation and exception LOGIC, the board, metrics, filters, cache and every interaction are untouched, and customer/employee/postal-city lookups still come from the local store (those migrate on their own tracks). RESULT: the Schedule board now derives its occurrences from the Supabase-backed work orders + exceptions (the same authoritative source as the Work Order surfaces), so schedule contents are consistent across devices. SAFETY: on a Supabase error / empty / unreachable result the Schedule transparently falls back to the local input and the fallback is recorded + surfaced (never silent); the interval cache key carries the authority mode so authoritative and non-authoritative intervals never collide. ROLLBACK is instant + data-free: EXPO_PUBLIC_SCHEDULE_SUPABASE_AUTHORITATIVE=false. REMAINING localStorage dependencies after this step: Users/logins credential array, Missions/visit occurrences, Services/Categories/Packages/Payroll Groups, Teams, Areas/Postal Cities/Languages, Payroll export, and Employees writes (EMPLOYEES_SUPABASE_READ still OFF; Employees is the next B-area). Changed files: src/lib/featureFlags.ts, src/lib/developmentTimeline.ts.",
  },
  {
    date: "2026-06-04T09:00:00.000Z",
    module: "Employees",
    moduleKey: "employees",
    category: "migration",
    eventType: "Employees directory cut over to Supabase-authoritative read (B-area 3)",
    from: "wired_dormant",
    to: "supabase_authoritative",
    status: "active",
    note: "Fourth B-area cut-over, executed on the existing EMP-2 read-path infrastructure (no new data path). Flipped EMPLOYEES_SUPABASE_READ from the OFF-by-default envFlag()||false to the shared cutoverFlag() resolver — authoritative-ON in real app builds so the employee directory reconciles from Supabase as the primary source, OFF only under vitest so the safe-default EMP-2 read suites keep validating the localStorage seed path, with instant rollback via an explicit =false env override. RESULT: the employee directory now READS the full employee records (losslessly reconstructed from the data jsonb) from Supabase via the validated listFullEmployeesFromSupabase / useEmployeeDirectorySource seam, company-scoped, so the directory is consistent across devices and stale per-device localStorage no longer wins on read. This compounds the earlier identity consolidation: the Employees + Assigned Users surfaces already share the global profiles roster for login identity, and now the employee-record directory itself is Supabase-primary. SAFETY (Framework v0.2 §8): the synchronous localStorage seed is kept first (zero flash), then reconciled ONLY on a healthy, non-empty Supabase result; on a Supabase error / unreachable result OR an UNSAFE empty (Supabase returns 0 while localStorage has data) the directory keeps the local seed (it never blanks) and the event is recorded + surfaced via employeeCutover telemetry; a background shadowReadEmployees keeps diffing count/id/summary/detail and flags drift (observability only, never blocks the UI). SCOPE / REMAINING: this cut-over moves the directory READ only. Employee-record WRITES still complete against localStorage (there is no employee dual-write / authoritative-write seam yet — that is a separate later wave), though login identity writes already propagate through the Supabase profiles roster + admin Edge Functions and invalidate the shared directory key. ROLLBACK is instant + data-free: EXPO_PUBLIC_EMPLOYEES_SUPABASE_READ=false. Tests: all 1809 pass (EMP-2 read suite still validates the OFF default under vitest); build/static checks pass. Changed files: src/lib/featureFlags.ts, src/lib/developmentTimeline.ts.",
  },
  {
    date: "2026-06-04T11:00:00.000Z",
    module: "Teams",
    moduleKey: "teams",
    category: "migration",
    eventType: "Teams cut-over wave built (TEAM-1..3): table, repository, read seam, dual-write, shadow validation",
    from: "localstorage_only",
    to: "wired_dormant",
    status: "active",
    note: "Full cut-over wave built for Teams (previously localStorage-only with no Supabase seam at all). NEW INFRASTRUCTURE: (1) migration 0017_teams_table.sql — a flat teams table (legacy_id unique key + company_id UUID FK + company_legacy_id scope + name/description flat columns + lossless data jsonb + deleted_at soft-delete), real company-scoped RLS (own-company + super_admin select/insert/update; no DELETE policy — removal is a soft-delete UPDATE), updated_at trigger and the active-row partial index, modeled exactly on employees 0010. (2) supabaseTeamRepository.ts — listFullTeamsFromSupabase + listTeamSummariesFromSupabase read paths (soft-deleted rows filtered, company_legacy_id scoping mirrors the store). (3) teamMigration.ts — idempotent migrateTeams (upsert on legacy_id, dryRun, skip+report unmapped companies) + shadowReadTeams (count/id/name/detail parity). (4) teamDualWrite.ts — mirrorTeamWrites with create/update mirroring, WO-5.6 removal propagation (soft-delete), post-write field validation and cumulative telemetry. (5) teamCutover.ts — shouldReadTeamsFromSupabase / shouldMirrorTeamWrites decision + fallback/unsafe-empty/drift telemetry. (6) use-team-directory-source.ts — the TEAM-2 read seam (synchronous local seed, reconcile only on a healthy non-empty Supabase result, unsafe-empty keeps the seed, stale-request guard, background shadow compare). FLAGS added: TEAMS_SUPABASE_READ + TEAMS_DUAL_WRITE (granular, OFF by default) and TEAMS_SUPABASE_AUTHORITATIVE (shared cutoverFlag). Tests added for repository/migration/dual-write/cutover/hook. localStorage stays authoritative for this entry; the flip is the next event.",
  },
  {
    date: "2026-06-04T11:30:00.000Z",
    module: "Teams",
    moduleKey: "teams",
    category: "migration",
    eventType: "Teams cut over to Supabase-authoritative (B-area 5)",
    from: "wired_dormant",
    to: "supabase_authoritative",
    status: "active",
    note: "Fifth B-area cut-over, executed on the TEAM-1..3 infrastructure built in the prior event. TEAMS_SUPABASE_AUTHORITATIVE uses the shared cutoverFlag() resolver — authoritative-ON in real app builds, OFF only under vitest so the safe-default suites keep validating the localStorage path, with instant rollback via an explicit =false env override. The authoritative flag IMPLIES both the read path (shouldReadTeamsFromSupabase) and the write mirror (shouldMirrorTeamWrites). RESULT: the team directory now READS the full team records from Supabase via listFullTeamsFromSupabase / useTeamDirectorySource (company-scoped), and every team create/update/delete completes against localStorage first (the backout copy, strategy B) and is then mirrored to Supabase — incl. soft-delete removal propagation — so teams are consistent across devices and stale per-device localStorage no longer wins. AppContext wiring: a team directory effect reconciles the in-memory teams to a healthy non-empty Supabase result; persistTeams snapshots prev→next and fires mirrorTeamWrites fire-and-forget under the flag. SAFETY (Framework v0.2 §8): the synchronous localStorage seed is kept first (zero flash), reconciled ONLY on a healthy non-empty result; on a Supabase error / unreachable / UNSAFE empty (0 rows while localStorage has data) the directory keeps the local seed (never blanks) and the event is recorded + surfaced via teamCutover telemetry; a background shadowReadTeams flags count/id/name/detail drift (observability only). ROLLBACK is instant + data-free: EXPO_PUBLIC_TEAMS_SUPABASE_AUTHORITATIVE=false. REMAINING localStorage dependencies after this step: Users/logins credential array, Missions/visit occurrences, Services/Categories/Packages/Payroll Groups (Services is the next B-area), Areas/Postal Cities/Languages, and Payroll export. Changed files: supabase/migrations/0017_teams_table.sql, src/lib/featureFlags.ts, src/lib/data/{supabaseTeamRepository,teamMigration,teamDualWrite,teamCutover,index}.ts, src/hooks/use-team-directory-source.ts, src/context/AppContext.tsx, src/lib/developmentTimeline.ts.",
  },
  {
    date: "2026-06-04T12:00:00.000Z",
    module: "Services",
    moduleKey: "services",
    category: "migration",
    eventType: "Services cut-over wave built + flipped (SVC-1..4): table, repository, read seam, dual-write, shadow validation, authoritative",
    from: "localstorage_only",
    to: "supabase_authoritative",
    status: "active",
    note: "Sixth B-area cut-over and the first of the service-catalog domain. Services was previously localStorage-only with no Supabase seam. The KEY difference from Teams: a Service can be GLOBAL (companyId === null → the Super Admin catalog) as well as company-owned, so the whole wave handles null-company rows end to end. NEW INFRASTRUCTURE: (1) migration 0018_services_table.sql — a flat services table (legacy_id unique key + nullable company_id UUID FK + nullable company_legacy_id scope + category_legacy_id + name/status flat columns + lossless data jsonb + deleted_at soft-delete), company-scoped RLS EXTENDED with a global-catalog read policy (company_id is null is readable by every authenticated user; global writes stay super-admin-only), updated_at trigger, active-row and global-active partial indexes. (2) supabaseServiceRepository.ts — listFullServicesFromSupabase + listServiceSummariesFromSupabase; a company scope returns that company's services PLUS the shared global catalog (PostgREST OR filter), mirroring the in-memory array's effective contents. (3) serviceMigration.ts — idempotent migrateServices (upsert on legacy_id, dryRun, global services migrate with company_id null and are never skipped, company services with no Supabase mapping are skipped+reported) + shadowReadServices (count/id/name/detail parity, scope = company + globals). (4) serviceDualWrite.ts — mirrorServiceWrites with create/update mirroring, global-row handling, WO-5.6 removal propagation (soft-delete), post-write field validation (null company normalised) and cumulative telemetry. (5) serviceCutover.ts — shouldReadServicesFromSupabase / shouldMirrorServiceWrites decision + fallback/unsafe-empty/drift telemetry. (6) use-service-directory-source.ts — the SVC-2 read seam (synchronous local seed, reconcile only on a healthy non-empty Supabase result, unsafe-empty keeps the seed, stale-request guard, background shadow compare). FLAGS: SERVICES_SUPABASE_READ + SERVICES_DUAL_WRITE (granular, OFF by default) and SERVICES_SUPABASE_AUTHORITATIVE (shared cutoverFlag — authoritative-ON in app builds, OFF under vitest). AppContext wiring: a service directory effect reconciles the in-memory services to a healthy non-empty Supabase result; persistServices snapshots prev→next and fires mirrorServiceWrites fire-and-forget under the flag. RESULT: the service catalog now READS from Supabase as primary (company services + global catalog) and every service create/update/delete completes against localStorage first (the backout copy, strategy B) then mirrors to Supabase, so services are consistent across devices. SAFETY (Framework v0.2 §8): zero-flash local seed, reconcile only on healthy non-empty, unsafe-empty/error keeps the local seed (never blanks) and is recorded; background shadowReadServices flags drift. Tests added for repository/migration (incl. global + scoped), dual-write (incl. global + skip), and the read-seam hook. ROLLBACK is instant + data-free: EXPO_PUBLIC_SERVICES_SUPABASE_AUTHORITATIVE=false. REMAINING after this step: the sibling service-catalog stores (Service Categories, Service Packages, Payroll Groups) are still localStorage-first and are the immediate next waves; plus Users/logins credential array, Missions/visit occurrences, Areas/Postal Cities/Languages, and Payroll export. Changed files: supabase/migrations/0018_services_table.sql, src/lib/featureFlags.ts, src/lib/data/{supabaseServiceRepository,serviceMigration,serviceDualWrite,serviceCutover,index}.ts, src/hooks/use-service-directory-source.ts, src/context/AppContext.tsx, and the new test suites.",
  },
  {
    date: "2026-06-04T12:30:00.000Z",
    module: "Service Catalog",
    moduleKey: "services",
    category: "migration",
    eventType:
      "Service-catalog wave built + flipped (SVCCAT): Service Categories, Payroll Groups, Service Packages — tables, repositories, read seams, dual-writes, shadow validation, authoritative",
    from: "localstorage_only",
    to: "supabase_authoritative",
    status: "active",
    note: "Service-catalog wave completing the Services domain begun in SVC-1..4. Three master-data areas moved from localStorage-only to Supabase-authoritative in one wave, reusing the Services architecture verbatim. KEY shapes: Service Categories and Payroll Groups support GLOBAL rows (companyId === null → the Super Admin catalog) exactly like Services; Service Packages are ALWAYS global master data (the type carries no companyId), so every package row is company_id = null and never needs a company mapping. NEW INFRASTRUCTURE: (1) migration 0019_service_catalog_tables.sql — three flat tables (service_categories, payroll_groups, service_packages), each legacy_id unique key + nullable company_id UUID FK + company_legacy_id scope + name/status flat columns + lossless data jsonb + deleted_at soft-delete, a shared set_service_catalog_updated_at trigger, active + global-active partial indexes, and company-scoped RLS EXTENDED with a global-catalog read policy (company_id is null readable by every authenticated user; global writes super-admin-only; packages are read-by-all, write-by-super-admin; no DELETE policy — removal is a soft-delete UPDATE). (2) supabase{ServiceCategory,PayrollGroup,ServicePackage}Repository.ts — listFull* + listSummaries*; categories/groups return the company rows PLUS the shared global catalog (PostgREST OR filter), packages return the whole global catalog. (3) {serviceCategory,payrollGroup,servicePackage}Migration.ts — idempotent migrate* (upsert on legacy_id, dryRun, global rows never skipped, company rows with no Supabase mapping skipped+reported; packages derive status from the archived flag) + shadowRead* (count/id/name/detail parity). (4) {serviceCategory,payrollGroup,servicePackage}DualWrite.ts — mirror*Writes with create/update mirroring, global-row handling, WO-5.6 soft-delete removal propagation, post-write field validation and telemetry. (5) {serviceCategory,payrollGroup,servicePackage}Cutover.ts — shouldRead*/shouldMirror* decisions + fallback/unsafe-empty/drift telemetry. (6) use-{service-category,payroll-group,service-package}-directory-source.ts — read seams (synchronous local seed, reconcile only on a healthy non-empty Supabase result, unsafe-empty keeps the seed, stale-request guard, background shadow compare). FLAGS: SERVICE_CATEGORIES_/PAYROLL_GROUPS_/SERVICE_PACKAGES_ each with SUPABASE_READ + DUAL_WRITE (granular, OFF) and SUPABASE_AUTHORITATIVE (shared cutoverFlag — authoritative-ON in app builds, OFF under vitest, instant =false rollback). AppContext wiring: three directory effects reconcile the in-memory serviceCategories/payrollGroups/servicePackages to a healthy non-empty Supabase result; persistServiceCategories + persistServicePackages snapshot prev→next and fire their mirror fire-and-forget under the flag (Payroll Groups have no in-app write path today, so only the READ reconcile is wired — the dual-write module is built, tested and ready for when a write path lands). RESULT: the entire service catalog (services + categories + packages + payroll groups) now reads Supabase-primary and is consistent across devices; stale per-device localStorage no longer wins on read. SAFETY (Framework v0.2 §8): synchronous local seed first (zero flash), reconcile only on healthy non-empty; on error / unreachable / UNSAFE empty the seed is kept (never blanks) and surfaced via cutover telemetry; background shadow reads flag drift (observability only). ROLLBACK is instant + data-free per area via the matching EXPO_PUBLIC_*_SUPABASE_AUTHORITATIVE=false. REMAINING localStorage-first areas after this step: Users/logins credential array, Missions/visit occurrences, Areas/Postal Cities/Languages, Settings/Modules, Payroll/Time Codes/Time Reports/Invoices/Booking Queue, and Checklists/Protocols/Media. Changed files: supabase/migrations/0019_service_catalog_tables.sql, src/lib/featureFlags.ts, src/lib/data/{supabaseServiceCategoryRepository,serviceCategoryMigration,serviceCategoryDualWrite,serviceCategoryCutover,supabasePayrollGroupRepository,payrollGroupMigration,payrollGroupDualWrite,payrollGroupCutover,supabaseServicePackageRepository,servicePackageMigration,servicePackageDualWrite,servicePackageCutover,index}.ts, src/hooks/use-{service-category,payroll-group,service-package}-directory-source.ts, src/context/AppContext.tsx, plus dual-write tests.",
  },
  {
    date: "2026-06-04T13:30:00.000Z",
    module: "Area Cluster",
    moduleKey: "areas",
    category: "migration",
    eventType:
      "Area-cluster wave built + flipped (AREA): Areas, Postal Cities, Employee Languages — tables, repositories, read seams, dual-writes, shadow validation, authoritative",
    from: "localstorage_only",
    to: "supabase_authoritative",
    status: "active",
    note: "Seventh B-area cut-over. The area cluster — the operational geography + language dimensions that customer visibility, employee area access, customer ownership and scheduling all reference by stable id — moved from localStorage-only to Supabase-authoritative in one wave, reusing the Teams architecture verbatim. Moved BEFORE Missions deliberately, because Missions/visit occurrences depend on these references. KEY shape: unlike the service catalog there are NO global rows — Area, PostalCity and EmployeeLanguage are all COMPANY-scoped, so RLS mirrors teams exactly (own-company + super_admin). NEW INFRASTRUCTURE: (1) migration 0020_area_cluster_tables.sql — three flat tables (areas, postal_cities, employee_languages), each legacy_id unique key + company_id UUID FK + company_legacy_id scope + flat summary columns (areas: name/is_active; postal_cities: name/area_legacy_id/is_active; employee_languages: code/name/is_active/is_default) + lossless data jsonb + deleted_at soft-delete, a shared set_area_cluster_updated_at trigger, active + scope indexes, and company-scoped RLS (own-company + super_admin select/insert/update; no DELETE policy — removal is a soft-delete UPDATE). (2) supabase{Area,PostalCity,EmployeeLanguage}Repository.ts — listFull* + listSummaries* (company-scoped, soft-deleted rows filtered). (3) {area,postalCity,employeeLanguage}Migration.ts — idempotent migrate* (upsert on legacy_id, dryRun, company rows with no Supabase mapping skipped+reported) + shadowRead* (count/id/name[+code/areaId]/detail parity). (4) {area,postalCity,employeeLanguage}DualWrite.ts — mirror*Writes with create/update mirroring, WO-5.6 soft-delete removal propagation, post-write field validation and telemetry. (5) {area,postalCity,employeeLanguage}Cutover.ts — shouldRead*/shouldMirror* decisions + fallback/unsafe-empty/drift telemetry. (6) use-{area,postal-city,employee-language}-directory-source.ts — read seams (synchronous local seed, reconcile only on a healthy non-empty Supabase result, unsafe-empty keeps the seed, stale-request guard, background shadow compare). FLAGS: {AREAS,POSTAL_CITIES,EMPLOYEE_LANGUAGES}_SUPABASE_READ + _DUAL_WRITE (granular, OFF) and _SUPABASE_AUTHORITATIVE (shared cutoverFlag — authoritative-ON in app builds, OFF under vitest, each IMPLIES its own read + mirror). AppContext wiring: three directory effects reconcile the in-memory areas/postalCities/employeeLanguages to a healthy non-empty Supabase result; the 13 area-cluster write callbacks (create/update/archive/restore area + postal city, create/update/archive/restore/set-default language) snapshot prev→next from the store and fire mirror*Writes fire-and-forget under the flag (the legacy single-default invariant stays owned by the store; sibling-row updates are mirrored too). RESULT: areas, postal cities and languages now READ from Supabase as primary (company-scoped) and every write completes against localStorage first (backout copy) then mirrors to the authoritative Supabase tables incl. soft-delete removal — so they are consistent across devices and stale per-device localStorage no longer wins. SAFETY (Framework v0.2 §8): on a Supabase error / unreachable / UNSAFE empty (0 rows while localStorage has data) the directory keeps the local seed (never blanks) and the event is recorded + surfaced via the cutover telemetry; a background shadowRead* flags drift (observability only). ROLLBACK is instant + data-free per area: EXPO_PUBLIC_{AREAS,POSTAL_CITIES,EMPLOYEE_LANGUAGES}_SUPABASE_AUTHORITATIVE=false. REMAINING localStorage dependencies after this step: Users/logins credential array, Missions/visit occurrences (the next B-area), Payroll export, and Employees writes. Tests added: areaMigration/postalCityMigration/employeeLanguageMigration parity suites. Changed files: supabase/migrations/0020_area_cluster_tables.sql, src/lib/featureFlags.ts, src/lib/data/{supabaseAreaRepository,supabasePostalCityRepository,supabaseEmployeeLanguageRepository,areaMigration,postalCityMigration,employeeLanguageMigration,areaDualWrite,postalCityDualWrite,employeeLanguageDualWrite,areaCutover,postalCityCutover,employeeLanguageCutover}.ts (+ index.ts), src/hooks/use-{area,postal-city,employee-language}-directory-source.ts, src/context/AppContext.tsx, src/lib/developmentTimeline.ts.",
  },
  {
    date: "2026-06-04T14:30:00.000Z",
    module: "Missions",
    moduleKey: "missions",
    category: "migration",
    eventType:
      "Missions / Visit Occurrences wave built + flipped (MISSION): table, repository, read seam, dual-write, shadow validation, authoritative",
    from: "localstorage_only",
    to: "supabase_authoritative",
    status: "active",
    note: "Eighth B-area cut-over and the highest-priority operational area still on localStorage. Missions/visit occurrences — the execution anchor CustomerProtocol → VisitOccurrence → ProtocolRun that check-in, mobile execution and reporting attach to — moved from a localStorage-only standalone store to Supabase-authoritative, reusing the Areas architecture. CLEANER SOLUTION (no production data to preserve): rather than AppContext wiring (the store has no central in-memory list), the standalone synchronous store now fires the dual-write mirror ITSELF, fire-and-forget, gated by the cut-over flag — so the synchronous store API is unchanged while writes become cross-device-consistent. NEW INFRASTRUCTURE: (1) migration 0021_visit_occurrences_table.sql — a flat visit_occurrences table (legacy_id unique key + company_id UUID FK + company_legacy_id scope + customer_legacy_id / work_order_legacy_id / service_row_id soft references + scheduled_date + status flat columns + lossless data jsonb + WO-5.6 deleted_at), company+date / customer / work-order / active indexes, updated_at trigger, company-scoped RLS (own-company + super_admin select/insert/update; no DELETE — the app uses the 'cancelled' status for soft lifecycle). (2) supabaseVisitOccurrenceRepository.ts — listFull* + listSummaries* (company-scoped, soft-deleted filtered, deterministically sorted). (3) visitOccurrenceMigration.ts — idempotent migrateVisitOccurrences (upsert on legacy_id, dryRun, company rows with no Supabase mapping skipped+reported) + shadowReadVisitOccurrences (count/id/summary[customer+workOrder+date+status]/detail parity); getAllVisitOccurrences added to the store as the source. (4) visitOccurrenceDualWrite.ts — mirrorVisitOccurrenceWrites with create/update mirroring, defensive WO-5.6 soft-delete removal propagation, post-write field validation and telemetry. (5) visitOccurrenceCutover.ts — shouldRead/shouldMirror decisions + fallback/unsafe-empty/drift telemetry. (6) use-visit-occurrence-source.ts — the read seam (local seed, reconcile only on a healthy non-empty Supabase result, unsafe-empty keeps the seed, stale-request guard, background shadow compare). FLAGS: VISIT_OCCURRENCES_SUPABASE_READ + VISIT_OCCURRENCES_DUAL_WRITE (granular, OFF) + VISIT_OCCURRENCES_SUPABASE_AUTHORITATIVE (cutoverFlag — authoritative-ON in app builds, OFF under vitest). ROLLBACK is instant + data-free: EXPO_PUBLIC_VISIT_OCCURRENCES_SUPABASE_AUTHORITATIVE=false. REMAINING localStorage dependencies after this step: Users/logins credential array, Settings/Modules, Payroll/Time Codes/Time Reports/Invoices/Booking Queue, Checklists/Protocols/Media, and Roles & Permissions role definitions + assignments.",
  },
  {
    date: "2026-06-04T15:30:00.000Z",
    module: "Roles & Permissions",
    moduleKey: "roles",
    category: "migration",
    eventType:
      "Roles & Permissions wave built + flipped (ROLE): table, repository, read seam, dual-write, shadow validation, authoritative",
    from: "localstorage_only",
    to: "supabase_authoritative",
    status: "active",
    note: "Identity wave, part 1 of 2. Role definitions (cleanops.roles) moved from localStorage-only to Supabase-authoritative, reusing the Services architecture (a role can be a GLOBAL Super Admin template, companyId === null, as well as company-owned). This is the first half of unifying identity onto Supabase so the whole graph (auth user → profile → employee → role assignment) is Supabase-sourced; profiles were already the global identity backbone. NEW INFRASTRUCTURE: (1) migration 0022_roles_table.sql — a flat roles table (legacy_id unique key + nullable company_id UUID FK + nullable company_legacy_id scope + name/base_role/is_system flat columns + lossless data jsonb carrying permissions[]/templateId/isActive + WO-5.6 deleted_at), company-scoped RLS EXTENDED with a global-templates read policy (company_id is null readable by every authenticated user; global writes super-admin-only; no DELETE policy), updated_at trigger, active + global-active partial indexes. (2) supabaseRoleRepository.ts — listFullRolesFromSupabase + listRoleSummariesFromSupabase; a company scope returns that company's roles PLUS the shared global templates (PostgREST OR filter). (3) roleMigration.ts — idempotent migrateRoles (upsert on legacy_id, dryRun, global roles migrate with company_id null and are never skipped, company roles with no Supabase mapping skipped+reported) + shadowReadRoles (count/id/name/detail parity). (4) roleDualWrite.ts — mirrorRoleWrites with create/update mirroring, global-row handling, soft-delete removal propagation, post-write validation + telemetry. (5) roleCutover.ts — shouldReadRolesFromSupabase / shouldMirrorRoleWrites decisions + fallback/unsafe-empty/drift telemetry. (6) use-role-directory-source.ts — the ROLE-2 read seam (synchronous local seed, reconcile only on a healthy non-empty result, unsafe-empty keeps the seed, stale-request guard, background shadow compare). FLAGS: ROLES_SUPABASE_READ + ROLES_DUAL_WRITE (granular, OFF) and ROLES_SUPABASE_AUTHORITATIVE (shared cutoverFlag, authoritative-ON in app builds / OFF under vitest). AppContext: a role directory effect reconciles roles to a healthy non-empty Supabase result; persistRoles snapshots prev→next and fires mirrorRoleWrites fire-and-forget under the flag. Tests for migration + cutover added. ROLLBACK is instant + data-free: EXPO_PUBLIC_ROLES_SUPABASE_AUTHORITATIVE=false.",
  },
  {
    date: "2026-06-04T16:00:00.000Z",
    module: "Users / Logins",
    moduleKey: "users",
    category: "migration",
    eventType:
      "Users / logins directory wave built + flipped (USER): app_users table, repository, read seam, dual-write, shadow validation, authoritative",
    from: "localstorage_only",
    to: "supabase_authoritative",
    status: "active",
    note: "Identity wave, part 2 of 2 — closes the identity split. The app-facing Users/logins directory (cleanops.users) moved from localStorage-only to Supabase-authoritative via a NEW public.app_users table, DISTINCT from the existing Supabase profiles backbone: profiles remains the auth-side identity (1:1 with auth.users, source of truth for AUTHENTICATION + base_role/company for RLS), while app_users is the operational login directory the app renders and edits (role assignment, employee/customer linking, area scope). SECURITY: passwords are NEVER mirrored — the source is the password-free getUsers(), the data jsonb carries only the non-secret login record, and admin authentication still runs exclusively through Supabase Auth. A login can be GLOBAL (companyId === null → platform super admin). NEW INFRASTRUCTURE: (1) migration 0023_app_users_table.sql — a flat app_users table (legacy_id unique key + nullable company_id UUID FK + nullable company_legacy_id scope + email/role/status flat columns + lossless password-free data jsonb + WO-5.6 deleted_at), company-scoped RLS where super_admin sees all (incl. global super-admin logins) and company admins see only their own company's logins — deliberately NO world-readable global tier (logins are not shared catalog data), lower(email)/active/global-active indexes, updated_at trigger. (2) supabaseUserRepository.ts — listFullUsersFromSupabase + listUserSummariesFromSupabase (eq company scope; RLS surfaces globals to super admins via the unscoped path). (3) userMigration.ts — idempotent migrateUsers (upsert on legacy_id, dryRun, global logins migrate with company_id null, company logins with no Supabase mapping skipped+reported) + shadowReadUsers (count/id/email/detail parity). (4) userDualWrite.ts — mirrorUserWrites with create/update mirroring, global-row handling, soft-delete removal propagation, post-write validation + telemetry. (5) userCutover.ts — shouldReadUsersFromSupabase / shouldMirrorUserWrites decisions + telemetry. (6) use-user-directory-source.ts — the USER-2 read seam (synchronous local seed, reconcile only on a healthy non-empty result, unsafe-empty keeps the seed). FLAGS: USERS_SUPABASE_READ + USERS_DUAL_WRITE (granular, OFF) and USERS_SUPABASE_AUTHORITATIVE (shared cutoverFlag). AppContext: a login directory effect reconciles users to a healthy non-empty Supabase result; persistUsers snapshots prev→next and fires mirrorUserWrites fire-and-forget under the flag. Tests for migration (incl. password-free assertion) + cutover added. REMAINING localStorage source-of-truth after this wave: Payroll/Time domain, Settings/Modules, Checklists/Protocols/Media. ROLLBACK is instant + data-free: EXPO_PUBLIC_USERS_SUPABASE_AUTHORITATIVE=false.",
  },
  {
    date: "2026-06-04T18:00:00.000Z",
    module: "Time Codes",
    moduleKey: "time_codes",
    category: "migration",
    eventType:
      "Payroll/Time domain wave begun — Time Code library built + flipped (TIMECODE): time_codes table, repository, read seam, dual-write, shadow validation, authoritative",
    from: "localstorage_only",
    to: "supabase_authoritative",
    status: "active",
    note: "Payroll/Time domain wave, part 1 — the payroll FOUNDATION. The Time Code library (cleanops.timeCodes, the seeded Super Admin master codes 10/385/355/360/374/380 + future company codes) moved from localStorage-only to Supabase-authoritative, reusing the Roles/Services global-directory architecture (a time code can be a GLOBAL master-library code, companyId === null, as well as company-owned). Time Codes is the anchor of the whole Payroll/Time domain: services.timeCodeId and time reports soft-reference a code by its legacy id, so its stability had to land before the dependent records (Time Reports, Invoices, Booking Queue, Payroll Export). NEW INFRASTRUCTURE: (1) migration 0024_time_codes_table.sql — a flat time_codes table (legacy_id unique key + nullable company_id UUID FK + nullable company_legacy_id scope + code/type/active/system_managed flat columns + lossless data jsonb + WO-5.6 deleted_at), company-scoped RLS EXTENDED with a global read policy (company_id is null readable by every authenticated user; global writes super-admin-only; no DELETE policy), updated_at trigger, active + global-active partial indexes. (2) supabaseTimeCodeRepository.ts — listFullTimeCodesFromSupabase + listTimeCodeSummariesFromSupabase; a company scope returns that company's codes PLUS the shared global master library (PostgREST OR filter). (3) timeCodeMigration.ts — idempotent migrateTimeCodes (upsert on legacy_id, dryRun, global codes migrate with company_id null and are never skipped, company codes with no Supabase mapping skipped+reported) + shadowReadTimeCodes (count/id/code/detail parity). (4) timeCodeDualWrite.ts — mirrorTimeCodeWrites with create/update mirroring, global-row handling, soft-delete removal propagation, post-write validation + telemetry. (5) timeCodeCutover.ts — shouldReadTimeCodesFromSupabase / shouldMirrorTimeCodeWrites decisions + fallback/unsafe-empty/drift telemetry. (6) use-time-code-directory-source.ts — the TIMECODE-2 read seam (synchronous local seed, reconcile only on a healthy non-empty result, unsafe-empty keeps the seed, stale-request guard, background shadow compare). WIRED into AppContext (directory reconcile effect + persistTimeCodes mirror). FLAGS: TIME_CODES_SUPABASE_READ + TIME_CODES_DUAL_WRITE (granular, OFF) and TIME_CODES_SUPABASE_AUTHORITATIVE (cutoverFlag — authoritative-ON in app builds, OFF under vitest, instant =false rollback). REMAINING in the Payroll/Time domain (still localStorage-first, inside lib/store.ts unless noted): Time Reports (cleanops.timeReports), Invoices (cleanops.invoices), Booking Queue (cleanops.bookingQueue + bookingOccurrenceExceptions), Payroll Export (payrollExportStore: capabilities/profiles/runs — table 0012 exists). These interval/operational records carry heavier cross-references and are the next sub-waves.",
  },
  {
    date: "2026-06-04T20:00:00.000Z",
    module: "Booking Queue",
    moduleKey: "booking_queue",
    category: "migration",
    eventType:
      "Booking Queue full-wave built + flipped (BQ): booking_queue table, repository, read seam, dual-write, shadow validation, authoritative",
    from: "localstorage_only",
    to: "supabase_authoritative",
    status: "active",
    note: "The Booking Queue — the PLANNING layer between Work Orders (the source of work) and the future Schedule module — moved from localStorage-only (cleanops.bookingQueue) to Supabase-authoritative, reusing the Areas company-scoped architecture (every queue item carries a non-null companyId; there are NO global rows). Booking Queue is the PLANNING/operational queue ONLY; it is explicitly NOT a payroll/billing structure, so it is safe to migrate now while Time Reports / Payroll Basis / Payroll Statistics / Invoices / InvoiceBasis stay PAUSED pending the long-term payroll & billing architecture. NEW INFRASTRUCTURE: (1) migration 0025_booking_queue_table.sql — a flat booking_queue table (legacy_id unique key + nullable company_id UUID FK + company_legacy_id scope + the soft references work_order_legacy_id / service_row_legacy_id / customer_legacy_id carried flat as indexed columns, NEVER FKs since each referenced record migrates on its own track + assignment_status / schedule_status / service_date flat columns + cancelled_at + lossless data jsonb + WO-5.6 deleted_at), company-scoped RLS (own-company + super_admin, no global tier, no DELETE policy), updated_at trigger, company+date / work-order / service-row / customer / active-partial indexes. (2) supabaseBookingQueueRepository.ts — listFullBookingQueueFromSupabase + listBookingQueueSummariesFromSupabase (company-scoped eq filter; soft-deleted rows filtered out). (3) bookingQueueMigration.ts — idempotent migrateBookingQueue (upsert on legacy_id, dryRun, items with no Supabase company mapping skipped+reported) + shadowReadBookingQueue (count/id/soft-reference/detail parity). (4) bookingQueueDualWrite.ts — mirrorBookingQueueWrites with create/update mirroring, soft-delete removal propagation, post-write validation (legacy_id/company/work_order/service_row) + telemetry. (5) bookingQueueCutover.ts — shouldReadBookingQueueFromSupabase / shouldMirrorBookingQueueWrites / isBookingQueueSupabaseAuthoritative decisions + fallback/unsafe-empty/drift telemetry. (6) use-booking-queue-directory-source.ts — the BQ read seam (synchronous local seed, reconcile only on a healthy non-empty result, unsafe-empty keeps the seed, stale-request guard, background shadow compare); the AppContext syncBookingItem re-derivation + access filtering still run on top so the source swap is transparent. WIRED into AppContext: the read seam reconciles the raw queue into setBookingQueue, and persistBookingQueue mirrors every write (localStorage first, then Supabase fire-and-forget; authoritative failures surfaced). FLAGS: BOOKING_QUEUE_SUPABASE_READ + BOOKING_QUEUE_DUAL_WRITE (granular, OFF) and BOOKING_QUEUE_SUPABASE_AUTHORITATIVE (cutoverFlag — authoritative-ON in app builds, OFF under vitest). Rollback is a single env =false. TESTS: bookingQueueMigration.test.ts (migrate/shadow parity) + bookingQueueCutover.test.ts (telemetry).",
  },
  {
    date: "2026-06-04T22:00:00.000Z",
    module: "Settings",
    moduleKey: "settings",
    category: "migration",
    eventType:
      "Settings full-wave built + flipped (SET): settings_templates (global) + company_settings (company-scoped) tables, repositories, read seams, dual-write, shadow validation, authoritative",
    from: "localstorage_only",
    to: "supabase_authoritative",
    status: "active",
    note: "The Settings domain moved from localStorage-only to Supabase-authoritative across its TWO stores. (A) settings_templates (cleanops.settingsTemplates) — the Super Admin governance catalogue of starter settings bundles — is ALWAYS GLOBAL master data (the type carries no companyId), so it reuses the service_packages architecture (always-global, super-admin governed, world-readable by every authenticated user). (B) company_settings (cleanops.companySettings) — one COMPANY-scoped record per company (the company's live settings, optionally seeded from a template) — reuses the Areas company-scoped architecture, with the twist that a record's identity IS its companyId (there is no separate id field), so legacy_id == company_legacy_id and the record is keyed 1:1 to the company. NEW INFRASTRUCTURE: (1) migration 0026_settings_tables.sql — settings_templates (global-only RLS: world-readable, super-admin writes) + company_settings (company-scoped RLS: own-company + super_admin), both with legacy_id unique key + lossless data jsonb (the full SettingsData blob) + WO-5.6 deleted_at, updated_at triggers, name / global-active / company-active indexes; no DELETE policy on either. (2) supabaseSettingsTemplateRepository.ts + supabaseCompanySettingsRepository.ts — full + summary reads. (3) settingsTemplateMigration.ts (global; never skipped) + companySettingsMigration.ts (company-scoped; records with no Supabase company mapping skipped+reported), each with idempotent migrate (upsert on legacy_id, dryRun) + shadow read (count/id/summary/detail parity). (4) settingsTemplateDualWrite.ts + companySettingsDualWrite.ts — create/update mirroring, soft-delete removal propagation, post-write validation + telemetry. (5) settingsTemplateCutover.ts + companySettingsCutover.ts — shouldRead*/shouldMirror* decisions + fallback/unsafe-empty/drift telemetry. (6) use-settings-template-directory-source.ts (global catalog) + use-company-settings-directory-source.ts (company-scoped) read seams (synchronous local seed, reconcile only on a healthy non-empty result, unsafe-empty keeps the seed, stale-request guard, background shadow compare). WIRED into AppContext: both read seams reconcile into setSettingsTemplates / setCompanySettings, and persistSettingsTemplates / persistCompanySettings mirror every write. FLAGS: SETTINGS_TEMPLATES_* and COMPANY_SETTINGS_* (granular read + dual-write OFF; authoritative cutoverFlag — ON in app builds, OFF under vitest). Rollback per store is a single env =false. TESTS: settingsMigration.test.ts + settingsCutover.test.ts.",
  },
  {
    date: "2026-06-05T10:00:00.000Z",
    module: "Modules / Checklists / Protocols / Media",
    moduleKey: "mcpm",
    category: "migration",
    eventType:
      "Final localStorage retirement wave built + flipped (MCPM): modules / module_categories / company_modules / checklist_templates / customer_protocols / media_assets tables, repositories, read seams, dual-write, shadow validation, authoritative",
    from: "localstorage_only",
    to: "supabase_authoritative",
    status: "active",
    note: "FINAL-WAVE note (kept for history). The four-domain localStorage-retirement wave moved four domains from localStorage-only to Supabase-authoritative. (A) MODULES — the global Module catalogue + Module Categories are GLOBAL master data (reuse the settings_templates world-readable / super-admin-write model), while company_modules is the COMPANY-scoped per-company availability/enable config (reuse the Areas company-scoped model; identity is the composite legacy_id '<companyId>:<moduleId>'). (B) CHECKLISTS — checklist templates are a HIERARCHY (template → sections → items); with no production data to preserve the cleanest model is ONE row per top-level template carrying the full nested structure losslessly in data jsonb as a ChecklistTemplateAggregate. A template can be GLOBAL (scope='global', company_id null — the shared best-practice library) or company-owned (reuse the roles global+company model). (C) PROTOCOLS — customer protocols are the same aggregate model (protocol → sections → items), always company + customer scoped (reuse Areas). (D) MEDIA — media_assets is flat, company-scoped; the lossless asset record (three thumbnail/preview URLs + content metadata) is mirrored, never binary originals (the store only ever persists processed layers). NEW INFRASTRUCTURE: (1) migration 0027_modules_checklists_protocols_media_tables.sql — six tables, each with a legacy_id unique key + lossless data jsonb + WO-5.6 deleted_at soft-delete + updated_at trigger; global tables (modules / module_categories / global checklist templates) world-readable with super-admin writes, company tables (company_modules / customer_protocols / media_assets + company checklist templates) own-company + super_admin RLS; no DELETE policy on any table. (2) supabaseModuleRepository / supabaseChecklistTemplateRepository / supabaseCustomerProtocolRepository / supabaseMediaAssetRepository — full + summary reads (company scopes return company rows + shared globals where applicable). (3) moduleMigration / checklistTemplateMigration / customerProtocolMigration / mediaAssetMigration — idempotent migrate (upsert on legacy_id, dryRun, global rows never skipped, company rows with no Supabase mapping skipped+reported) + shadow read (count/id/summary/detail parity; the checklist & protocol shadows compare the full nested aggregate). (4) moduleDualWrite (three mirrors: modules / categories / company config) / checklistTemplateDualWrite / customerProtocolDualWrite / mediaAssetDualWrite — create/update mirroring, global-row handling, soft-delete removal propagation, post-write validation + telemetry; the stores fire the mirror self-firing (writeAssets / writeTemplates|writeSections|writeItems / saveModules|saveCompanyModules|saveModuleCategories), localStorage staying authoritative (the modules store uses a dynamic import to break the store→dualWrite→store cycle). (5) moduleCutover / checklistTemplateCutover / customerProtocolCutover / mediaAssetCutover — shouldRead*/shouldMirror*/is*Authoritative decisions + fallback/unsafe-empty/drift telemetry. (6) use-module-source / use-checklist-template-source / use-customer-protocol-source / use-media-asset-source read seams (synchronous local seed, reconcile only on a healthy non-empty result, unsafe-empty keeps the seed, stale-request guard, background shadow compare). FLAGS: MODULES_* / CHECKLIST_TEMPLATES_* / CUSTOMER_PROTOCOLS_* / MEDIA_ASSETS_* (granular read + dual-write OFF; authoritative via the shared cutoverFlag — ON in app builds, OFF under vitest). Rollback for any area is a single env '=false'. This closes the planned localStorage retirement; Time Reports / Payroll Basis / Payroll Statistics / Invoices / Payroll calculations / InvoiceBasis remain INTENTIONALLY PAUSED pending the long-term payroll & billing architecture.",
  },
  {
    date: "2026-06-05T12:00:00.000Z",
    module: "Framework",
    category: "governance",
    eventType: "localStorage Retirement closeout — Supabase confirmed authoritative for all in-scope operational business data",
    note: "Earlier closeout snapshot (superseded by the ENT + ACTIVITY waves below, which retired the two follow-ups it had listed as not-yet-scoped). Closing milestone for the localStorage → Supabase migration program before Mission Log development begins. Development Center registry updated: every cut-over module now records supabaseStatus=complete, localStorageStatus=dual_write (synchronized backout copy, strategy B), migrationStatus=activated. SUPABASE-AUTHORITATIVE (source of truth): Companies, Profiles/Identity, Customers, Work Orders, Schedule input, Employees directory READ, Teams, Services + Service Categories + Payroll Groups + Service Packages, Areas + Postal Cities + Employee Languages, Missions/Visit Occurrences, Roles & Permissions (definitions), Users/Logins (app_users), Time Codes, Booking Queue, Settings (settings_templates + company_settings), Modules + Module Categories + Company Modules, Checklist Templates, Customer Protocols, Media Assets — plus the pre-existing Customer Agreements / Agreement Templates / Time Bank foundations. Every cut-over uses cutoverFlag(): authoritative-ON in real app builds, OFF under vitest, instant data-free rollback via a single EXPO_PUBLIC_*=false env flip; reads fall back to the localStorage backout copy on error/empty and every fallback is recorded + surfaced (never silent). CONFIRMATION: no in-scope operational business data still depends on localStorage as the source of truth — localStorage is retained ONLY as the strategy-B backout copy plus UI-preference / cache / session-helper / dev-only roles. REMAINING localStorage (NOT a source-of-truth gap): (1) INTENTIONALLY PAUSED pending the long-term payroll & billing architecture — Time Reports (cleanops.timeReports), Invoices (cleanops.invoices), Payroll Export (cleanops.payroll.*), Payroll Basis / Statistics / InvoiceBasis (not yet built); (2) NOT-YET-SCOPED operational areas tracked as follow-ups — Activity Log (cleanops.auditEvents), Service Entitlements (serviceGlobalEntitlements / companyServiceEntitlements / serviceEntitlementLog), ProtocolRun execution snapshots (protocolRuns / RunSections / RunItems), checklist building blocks (libraryRooms / libraryTasks / checklistCategories / checklistAdoptions), Keys, Requests, and the secondary settings sub-stores (workOrderSettings / timeReportSettings / durationSettings / systemSettings / floorPresets); (3) UI PREFERENCE — recentCustomers, serviceFavorites, autoAreaFromPostalCity, local featureFlags, sidebar-collapsed; (4) CACHE — files (cleanops.files object-store stand-in); (5) SESSION/AUTH HELPER — session, resetTokens (auth itself is Supabase); (6) DEV-ONLY — the cleanops.migration.* one-time backfill markers. Migration work is now PAUSED; focus shifts to Mission Log architecture & development.",
  },
  {
    date: "2026-06-08T12:00:00.000Z",
    module: "Entitlements / Packages",
    moduleKey: "entitlements",
    category: "migration",
    eventType: "Service Entitlements cut-over — Supabase authoritative (ENT wave)",
    from: "localstorage_only",
    to: "supabase_authoritative",
    status: "active",
    note: "Closed a real localStorage-authoritative dependency that kept Super Admin 'partial'. All THREE entitlement stores moved onto Supabase together. NEW INFRASTRUCTURE: (1) migration 0028_service_entitlements_tables.sql — service_global_entitlements (platform-wide availability; GLOBAL master data, legacy_id = service key, readable by every authenticated user, super-admin writes), company_service_entitlements (per-company tri-state access; synthetic legacy_id '<companyId>::<serviceKey>', own-company + super_admin RLS), service_entitlement_log (immutable APPEND-ONLY trail; legacy_id = entry id, company_id null for platform-wide changes, INSERT policy only → no update/delete under RLS). Mutable tables carry the WO-5.6 deleted_at soft-delete + updated_at trigger; the log has neither. (2) supabaseEntitlementRepository.ts — full reads for all three (global readable to all, company eq-scoped, log date-ordered). (3) entitlementMigration.ts — migrateEntitlements (idempotent upsert on legacy_id, dryRun, company rows skipped+reported where no Supabase company mapping, globals + platform log have no company dependency) + shadowReadEntitlements (per-store count + detail parity). (4) entitlementDualWrite.ts — mirrorGlobalEntitlementWrites / mirrorCompanyEntitlementWrites (upsert + soft-delete removal) + mirrorEntitlementLogAppend (append-only insert), shared telemetry state. (5) entitlementCutover.ts — shouldReadEntitlementsFromSupabase / shouldMirrorEntitlementWrites + fallback/unsafe-empty/drift recorders. (6) use-entitlement-source.ts — reconciles all three stores to a HEALTHY Supabase snapshot; unsafe-empty keeps the local seed (never blanks). (7) AppContext wiring — the read seam reconciles state when active; persistServiceGlobalEntitlements / persistCompanyServiceEntitlements / appendServiceEntitlementLog mirror under the cut-over. (8) ENTITLEMENTS_* flags (read / dual_write / authoritative via cutoverFlag). (9) entitlementMigration.test.ts. The bundle-first resolver + ServiceFeatureKey registry are UNCHANGED — this wave moved the SOURCE OF TRUTH only. localStorage kept as the strategy-B backout copy; rollback is a single env flip (=false).",
  },
  {
    date: "2026-06-08T12:05:00.000Z",
    module: "Activity Log",
    moduleKey: "activity_log",
    category: "migration",
    eventType: "Activity Log cut-over — Supabase authoritative (ACTIVITY wave)",
    from: "localstorage_only",
    to: "supabase_authoritative",
    status: "active",
    note: "Closed the second of Super Admin's two real localStorage-authoritative dependencies. The append-only audit trail (cleanops.auditEvents, hard-capped at the newest 500) moved onto Supabase. NEW INFRASTRUCTURE: (1) migration 0029_activity_events_table.sql — activity_events with flat indexed columns (company scope / actor / action / occurred_at) + lossless data jsonb; company-scoped read RLS where super_admin sees all (incl. platform-level company_id null events), APPEND-ONLY (insert policies only → no update/delete under RLS); NO soft-delete (an audit trail is never removed); date-paged indexes (OP2 activity-log blueprint) remove the 500-cap ceiling on the server side. (2) supabaseActivityRepository.ts — newest-first, capped full + summary reads. (3) activityMigration.ts — migrateActivityEvents (idempotent upsert on legacy_id, platform-level events migrate with company_id null, company events with no Supabase mapping skipped+reported) + shadowReadActivityEvents (id-set + detail parity over the local capped set; extra uncapped Supabase rows are expected, never flagged). (4) activityDualWrite.ts — mirrorActivityAppend (APPEND-ONLY: inserts only events present in next but not prev; never updates/removes). (5) activityCutover.ts — decision + fallback/unsafe-empty/drift telemetry. (6) use-activity-source.ts — reconciles the trail to a HEALTHY non-empty Supabase result; unsafe-empty keeps the local seed. (7) AppContext wiring — the read seam reconciles auditEvents when active; appendAudit mirrors the newly-appended event under the cut-over. (8) ACTIVITY_LOG_* flags (read / dual_write / authoritative via cutoverFlag). (9) activityMigration.test.ts. localStorage kept as the strategy-B backout copy (still 500-capped); rollback is a single env flip (=false).",
  },
  {
    date: "2026-06-08T12:10:00.000Z",
    module: "Super Admin",
    moduleKey: "super_admin",
    category: "status",
    eventType: "Super Admin re-scored after ENT + ACTIVITY waves — both real localStorage dependencies resolved",
    from: "localStorage-authoritative dependencies (Entitlements + Activity Log)",
    to: "Supabase-authoritative dependencies; one in-scope gap remains (System Settings)",
    status: "partial",
    note: "Honest re-score (NOT a cosmetic rollup edit). The two former blockers that kept Super Admin 'partial' were genuine localStorage-authoritative stores and are now Supabase-authoritative: Entitlements / Packages (tables 0028) and Activity Log (table 0029). Super Admin's other sub-surfaces were already Supabase-authoritative (Companies, Services + catalog, Global Templates = settings_templates + checklist_templates, Roles). Registry updated: activity_log + entitlements → supabaseStatus=complete / localStorageStatus=dual_write / migrationStatus=activated / testStatus=complete / releaseReadiness=verified; super_admin → rlsStatus=complete, activityLogStatus=complete, entitlementStatus=complete, localStorageStatus=dual_write. Super Admin remains 'partial' DELIBERATELY: System Settings (cleanops.systemSettings) is still a localStorage-authoritative single-record blob with no Supabase table yet — the lone remaining in-scope source-of-truth gap. System Performance + the Development Center registry are intentionally dev/diagnostic surfaces (no source-of-truth data). To reach 'complete': migrate System Settings (schema + repo + read seam + dual-write + cut-over). Migration program now PAUSES; focus shifts to Mission Log.",
  },
  {
    date: "2026-06-08T13:00:00.000Z",
    module: "System Settings",
    moduleKey: "system_settings",
    category: "migration",
    eventType: "System Settings cut-over — Supabase authoritative (SYSSET wave)",
    from: "localstorage_only",
    to: "supabase_authoritative",
    status: "active",
    note: "Closed the LONE remaining in-scope source-of-truth gap that kept Super Admin 'partial'. The platform-level (Master Admin) configuration record (cleanops.systemSettings) — read app-wide by the entitlement resolver, the booking-generation horizon and the Preferred Time Evaluation master gate — moved onto Supabase. NEW INFRASTRUCTURE: (1) migration 0030_system_settings_table.sql — system_settings, a SINGLETON global record (no company scope, exactly one row keyed by the constant legacy_id 'global') with a lossless data jsonb + the WO-5.6 deleted_at soft-delete (kept for symmetry; never used) + updated_at trigger; RLS world-readable by every authenticated user (the PTE gate + resolver mode are consumed app-wide, mirroring settings_templates), super-admin-only INSERT/UPDATE, no DELETE policy. (2) supabaseSystemSettingsRepository.ts — getSystemSettingsFromSupabase (single maybeSingle read, normalized, returns null pre-migration). (3) systemSettingsMigration.ts — migrateSystemSettings (idempotent single upsert, dryRun) + shadowReadSystemSettings (single-record detail parity). (4) systemSettingsDualWrite.ts — mirrorSystemSettingsWrite (no-op when unchanged; single upsert on change; post-write round-trip validation). (5) systemSettingsCutover.ts — shouldReadSystemSettingsFromSupabase / shouldMirrorSystemSettingsWrites / isSystemSettingsSupabaseAuthoritative + fallback/unsafe-empty/drift telemetry. (6) use-system-settings-source.ts — reconciles the single record to the Supabase copy; a missing row pre-migration keeps the local seed (never blanks). (7) AppContext wiring — the read seam reconciles systemSettings when active; updateSystemSettings mirrors the record under the cut-over (local-first backout copy, fire-and-forget, escalates a failed authoritative mirror). (8) SYSTEM_SETTINGS_* flags (read / dual_write / authoritative via cutoverFlag). (9) systemSettingsMigration.test.ts. localStorage kept as the strategy-B backout copy; rollback is a single env flip (=false).",
  },
  {
    date: "2026-06-08T13:05:00.000Z",
    module: "Super Admin",
    moduleKey: "super_admin",
    category: "status",
    eventType: "Super Admin re-scored to COMPLETE after SYSSET wave — final in-scope gap resolved",
    from: "one in-scope gap remaining (System Settings)",
    to: "fully Supabase-authoritative; no in-scope localStorage source-of-truth dependency",
    status: "active",
    note: "Honest re-score (NOT cosmetic). System Settings (cleanops.systemSettings) — the lone remaining in-scope localStorage-authoritative store — is now Supabase-authoritative (table 0030, SINGLETON global record). Registry updated: new system_settings module → supabaseStatus=complete / localStorageStatus=dual_write / migrationStatus=activated / testStatus=complete / releaseReadiness=verified; super_admin → supabaseStatus=complete / testStatus=complete / releaseReadiness=verified / migrationStatus=activated, system_settings added to its dependency graph. Every Super Admin sub-surface is now Supabase-authoritative with localStorage as the strategy-B backout copy: Companies, Services + catalog, Global Templates (settings_templates + checklist_templates), Roles, Entitlements / Packages (0028), Activity Log (0029), System Settings (0030). System Performance + the Development Center registry are intentionally dev/diagnostic surfaces (no source-of-truth data). Migration program now PAUSES; focus shifts to Mission Log.",
  },
  {
    date: "2026-06-09T10:00:00.000Z",
    module: "Framework",
    category: "governance",
    eventType: "Operational Execution initiative opened — Phase 1 foundation (no behaviour flip)",
    note: "Started the Operational Execution initiative separating Schedule (planned) → Booking Queue (admin status) → Mission Log (execution ledger) → Time Reporting (approval/classification) → Payroll Basis / Invoice Basis (approved outputs). Phase 1 is FOUNDATION-ONLY: 9 entitlement feature keys registered in the existing bundle-first SERVICE_FEATURE_REGISTRY (mission_log, time_reporting, operational_flags, notification_center, incident_management, action_center, time_quality_analytics, payroll_basis, invoice_basis); the architecture's active/trial/inactive vocabulary maps onto the existing ServiceEntitlementStatus (active→enabled, trial→trial, inactive→disabled) via src/lib/operationalExecution.ts — NO new flat entitlement model. Type foundations (src/types/missionLog.ts, src/types/timeReporting.ts), pure helpers (src/lib/domain/missionDelay.ts, src/lib/domain/timeReportingReview.ts) and read-only repository INTERFACES (src/lib/data/missionLogRepository.ts, src/lib/data/timeReportingRepository.ts). EXCLUDED this phase: SQL migrations, Supabase adapters, UI pages, App.tsx routes, bulk mutations, notifications, AI inference, payroll/invoice behaviour, time-bank writes, any production behaviour flip. Payroll Basis + Invoice Basis are RESERVED feature keys only.",
  },
  {
    date: "2026-06-09T10:05:00.000Z",
    module: "Mission Log",
    moduleKey: "mission_log",
    category: "status",
    eventType: "Mission Log architecture foundation added (Phase 1)",
    note: "Registered the `mission_log` feature key and added the execution-ledger TYPE foundation (MissionLogEntry / MissionStaffSession / MissionLogEvent / MissionBookedTimeRating + status enums), a pure delay-projection helper and a read-only repository interface. No SQL/UI/behaviour; Mission Log never mutates Schedule, payroll, invoices or the time bank. entitlementStatus raised not_applicable→partial.",
  },
  {
    date: "2026-06-09T10:10:00.000Z",
    module: "Time Reporting",
    moduleKey: "time_reporting",
    category: "status",
    eventType: "Time Reporting registered (planned) — authoritative model foundation",
    to: "planned",
    status: "not_ready",
    note: "New module registered with the `time_reporting` feature key. The NEW authoritative TimeReport model + payroll/invoice-independent statuses, TimeAllocation, TimeDeviationReasonCode, settings, and the high-volume review concepts (SavedReviewQueue / SavedFilter / FlagResolutionStatus / AiReviewRecommendation) added as pure types + helpers, plus read-only repository interfaces. Flag resolution is tracked SEPARATELY from approval; AI only recommends, never decides. LEGACY checkout `TimeReport` (src/types/index.ts) is intentionally LEFT UNTOUCHED in Phase 1 — it drives the live Work Order checkout flow, gates service-row deletes and is covered by tests; it is the cut-over target of the first behavioural Time Reporting wave, after which the bare name consolidates onto the new model. The 5 operational add-ons (operational_flags / notification_center / incident_management / action_center / time_quality_analytics) registered as planned; payroll_basis + invoice_basis reserved as keys only.",
  },
  {
    date: "2026-06-10T09:00:00.000Z",
    module: "Mission Log",
    moduleKey: "mission_log",
    category: "migration",
    eventType: "Mission Log SCHEMA FOUNDATION added (Phase 2a-1) — schema only, no behaviour",
    note: "Phase 2a-1 lands the durable execution-ledger SCHEMA only. New migration 0031_mission_log_tables.sql creates four tables. mission_log_entries: company-scoped (company_id UUID FK + company_legacy_id), SOFT legacy-id references (booking_legacy_id, booking_occurrence_legacy_id keeping the visit_occurrences link soft, work_order_legacy_id, a FLAT nullable service_row_legacy_id for delete-guard / cut-over parity lookups, customer_legacy_id) — every ref is text, NEVER an FK, so the migration is empty-Supabase-safe — plus scheduled_start/end_time, mission_status, delay_status and requires_admin_review summary columns and a lossless data jsonb. ADJUSTMENTS APPLIED: removed any time_report_legacy_id (Mission Log carries NO forward link to Time Reporting; one mission → many sessions → later many time reports, so Time Reporting will own the link back via mission_log_entry_legacy_id in its own wave); added the flat service_row_legacy_id with a (company_id, service_row_legacy_id) index. mission_staff_sessions: per-employee check-in/out (status / check_in_method / check_out_method / actual times flat + data jsonb). mission_log_events: IMMUTABLE append-only — INSERT-only RLS, NO UPDATE/DELETE policy, no updated_at/deleted_at, with occurred_at / created_at / idempotency_key / schema_version (mirrors activity_events 0029). mission_booked_time_ratings: per staff session, rating CHECK between 0 and 10, tied to both mission and session + employee. legacy_id is the idempotent upsert key on every table; entries/sessions/ratings use the WO-5.6 deleted_at soft-delete (an upsert undeletes). Company-scoped RLS (own-company + super_admin select/insert/update; no DELETE on the soft-delete tables; INSERT-only on events) via the existing current_company_id()/is_super_admin() helpers. Review/service-row/occurrence/status indexes geared for high-volume review queues. Feature flags MISSION_LOG_SUPABASE_READ / _DUAL_WRITE / _SUPABASE_AUTHORITATIVE added DEFAULT OFF (envFlag, NOT cutoverFlag — nothing reads or writes these tables yet). EXCLUDED (unchanged): time_reports / time_allocations / time_report_flags / time_report_messages tables, saved review queues, Time Reporting repository implementation, checkout dual-write, UI, routes, behaviour flip, notifications, payroll, invoice, time-bank writes, AI inference. Mission Log remains execution-ledger only — it does not mutate Schedule, approve Time Reporting, create payroll/invoice basis, affect the time bank, send notifications or infer AI decisions. Changed files: supabase/migrations/0031_mission_log_tables.sql (new), src/lib/featureFlags.ts, src/lib/developmentCenter.ts, src/lib/developmentTimeline.ts.",
  },
  {
    date: "2026-06-10T09:30:00.000Z",
    module: "Time Reporting",
    moduleKey: "time_reporting",
    category: "migration",
    eventType: "Time Reporting SCHEMA FOUNDATION added (Phase 2a-2) — schema only, no behaviour",
    note: "Phase 2a-2 lands the durable Time Reporting SCHEMA only. New migration 0032_time_reporting_tables.sql creates NINE tables. time_reports: company-scoped (company_id UUID FK + company_legacy_id), SOFT legacy-id references — mission_log_entry_legacy_id is the future link BACK to Mission Log and is NULLABLE-but-indexed per ADJUSTMENT #1 (legacy checkout does not yet always have a mission entry; not-null is deferred until the behavioural cut-over proves every report can attach), plus mission_staff_session_legacy_id, booking/booking-occurrence/work-order legacy ids, a FLAT nullable service_row_legacy_id [(company_id, service_row_legacy_id) index] for delete-guard / cut-over parity, customer/employee legacy ids and name snapshots — every ref is text, NEVER an FK, so the migration is empty-Supabase-safe. Flat summary columns: scheduled/actual/deviation minutes, status, INDEPENDENT payroll_approval_status + invoice_basis_status, requires_admin_review, a DENORMALISED flag_resolution_status SUMMARY kept SEPARATE from approval, nullable ai_recommendation (advisory only — AI never decides), submitted_at + lossless data jsonb. time_allocations: classified minute slices with allocation_type + is_payroll_relevant / is_invoice_relevant / is_billable flags (reconstructs billable/non-billable/payroll/invoice splits without writing any payroll/invoice basis). time_deviation_reason_codes: company-configurable codes. time_report_events + time_report_flag_events: IMMUTABLE append-only (INSERT-only RLS, NO UPDATE/DELETE, occurred_at / idempotency_key / schema_version). time_report_flags: resolution_status lifecycle tracked SEPARATELY from report approval. time_report_messages: APPEND-ONLY per ADJUSTMENT #2 (INSERT+SELECT only, no UPDATE/DELETE; future message status metadata rides in data jsonb, no behaviour now). saved_filters + saved_review_queues: simple non-behavioural storage. legacy_id is the idempotent upsert key on every table; mutable tables use the WO-5.6 deleted_at soft-delete (an upsert undeletes); event/history/message tables are INSERT-only. Company-scoped RLS (own-company + super_admin) via current_company_id()/is_super_admin() on every table. High-volume review-queue indexes: status / submitted_at / requires_admin_review / employee / customer / service_row / mission_entry / payroll_status / invoice_status / flag_resolution / open-flags. Feature flags TIME_REPORTING_SUPABASE_READ / _DUAL_WRITE / _SUPABASE_AUTHORITATIVE added DEFAULT OFF (envFlag, NOT the cutover resolver — nothing reads/writes these tables yet). EXCLUDED: repository, adapter, read seam, dual-write, checkout cut-over, shadow read, parity checks, UI, routes, bulk mutations, notifications, payroll/invoice basis, time-bank writes, AI inference. Time Reporting links BACK to Mission Log (never forward); approval status and flag resolution status stay separate; payroll and invoice readiness stay independent. Development Center: time_reporting module updated supabaseStatus partial / rlsStatus complete / migrationStatus in_progress.",
  },
  {
    date: "2026-06-10T10:00:00.000Z",
    module: "Mission Log",
    moduleKey: "mission_log",
    category: "migration",
    eventType: "Mission Log READ ADAPTER added (Slice 2b-1) — read seam only, dormant, no behaviour",
    note: "Slice 2b-1 lands the FIRST Mission Log read adapter. New src/lib/data/supabaseMissionLogRepository.ts implements the storage-agnostic MissionLogRepository contract (listSummaries / getDetail / search / count) against the migration-0031 tables (mission_log_entries / mission_staff_sessions / mission_log_events). QUERY RULES: every query is company-scoped first (company_legacy_id), soft-deleted rows (deleted_at) are excluded by default, and filtering + pagination are SERVER-SIDE (eq/in/gte/lte + or-ilike identifier search + range + count:exact) so rows are never fully loaded and sliced in memory. listSummaries/search return lightweight summaries built from the flat columns + the single entry data jsonb (name snapshot + actual times) — never the sessions or the event stream; getDetail is the ONLY path that loads the per-employee sessions (soft-deleted excluded) and the IMMUTABLE event stream (ordered occurred_at asc, legacy_id tiebreak). Added a serviceRowLegacyId filter param to MissionLogListParams (backs the later legacy delete-guard / cut-over parity lookups via the flat service_row_legacy_id column). EMPTY SUPABASE IS VALID: empty list / total 0 / null detail — NO fallback to localStorage, NO seed, NO unsafe-empty. The adapter is DORMANT: it is NOT wired into AppContext, any page, route, dual-write, shadow-read or cut-over, and the legacy checkout TimeReport flow is untouched; shouldReadMissionLogFromSupabase() exposes the DEFAULT-OFF MISSION_LOG_SUPABASE_READ gate for a future consumer (deliberately NOT the cutover resolver). 20 fixture tests (supabaseMissionLogRepository.test.ts) cover empty Supabase, summary mapping + ordering, detail sessions/events ordering, search, count, date/mission-status/delay-status/requires-admin-review/serviceRowLegacyId filters, server-side pagination + pre-pagination total, soft-delete exclusion and company-scope isolation. Development Center: mission_log apiStatus not_started→partial. EXCLUDED: Time Reporting repository, SavedReviewQueue repository, UI, routes, AppContext wiring, dual-write, shadow read, read cut-over, legacy TimeReport changes, bulk mutations, notifications, AI inference — and no Schedule / payroll / invoice / time-bank writes. Changed files: src/lib/data/supabaseMissionLogRepository.ts (new), src/lib/data/supabaseMissionLogRepository.test.ts (new), src/lib/data/missionLogRepository.ts (serviceRowLegacyId param), src/lib/developmentCenter.ts, src/lib/developmentTimeline.ts.",
  },
  {
    date: "2026-06-10T11:00:00.000Z",
    module: "Time Reporting",
    moduleKey: "time_reporting",
    category: "migration",
    eventType: "Time Reporting READ ADAPTER added (Slice 2b-2) — read seam only, dormant, no behaviour",
    note: "Slice 2b-2 lands the FIRST Time Reporting read adapter. New src/lib/data/supabaseTimeReportingRepository.ts implements the storage-agnostic TimeReportingRepository contract (listSummaries / getDetail / search / count) against the migration-0032 tables (time_reports / time_allocations / time_report_flags / time_report_events / time_report_flag_events / time_report_messages). QUERY RULES: every query is company-scoped first (company_legacy_id), soft-deleted rows (deleted_at) are excluded by default, and filtering + pagination are SERVER-SIDE (eq/in/gte/lte + or-ilike identifier search + range + count:exact) so rows are never fully loaded and sliced in memory. listSummaries/search return lightweight summaries built from the flat columns + the single report data jsonb — never the allocations / flags / messages / event streams; getDetail is the ONLY path that loads the non-deleted allocations + flags and the IMMUTABLE message / event / flag-event streams (ordered created_at/occurred_at asc, legacy_id tiebreak). SEPARATION: approval status, payroll approval status, invoice basis status and flag-resolution status are read INDEPENDENTLY. Filters: submitted date range, status, payroll status, invoice status, flag-resolution status, AI recommendation (advisory only), requires-admin-review, employee, customer, plus serviceRowLegacyId + missionLogEntryLegacyId (refined onto TimeReportListParams) and min/max ABSOLUTE deviation thresholds. Refined read models in timeReportingRepository.ts: TimeReportDetail now extends TimeReport with allocations / flags / messages / events / flagEvents (+ TimeReportFlagRecord / TimeReportEventRecord / TimeReportFlagEventRecord). EMPTY SUPABASE IS VALID: empty list / total 0 / null detail — NO fallback to localStorage, NO seed, NO unsafe-empty. The adapter is DORMANT: it is NOT wired into AppContext, any page, route, dual-write, shadow-read or cut-over, and the legacy checkout TimeReport flow is untouched; shouldReadTimeReportingFromSupabase() exposes the DEFAULT-OFF TIME_REPORTING_SUPABASE_READ gate for a future consumer (deliberately NOT the cutover resolver). 31 fixture tests (supabaseTimeReportingRepository.test.ts) cover empty Supabase, summary mapping + ordering, detail children + ordering, search, count, status/payroll/invoice/flag-resolution/AI/employee/customer/serviceRow/missionEntry/deviation filters, server-side pagination + pre-pagination total, soft-delete exclusion and company-scope isolation. Development Center: time_reporting apiStatus not_started→partial. EXCLUDED: SavedReviewQueue repository, checkout cut-over, bulk mutations, UI, routes, AppContext wiring, notifications, AI inference, and any Schedule / payroll / invoice / time-bank writes. Changed files: src/lib/data/supabaseTimeReportingRepository.ts (new), src/lib/data/supabaseTimeReportingRepository.test.ts (new), src/lib/data/timeReportingRepository.ts (detail children + serviceRowLegacyId / missionLogEntryLegacyId params), src/lib/developmentCenter.ts, src/lib/developmentTimeline.ts."
  },
  {
    date: "2026-06-10T12:00:00.000Z",
    module: "Time Reporting",
    moduleKey: "time_reporting",
    category: "migration",
    eventType: "Saved Review Queue READ ADAPTER added (Slice 2b-3) — read seam only, dormant, no behaviour",
    note: "Slice 2b-3 lands the Saved Review Queue read adapter. New src/lib/data/supabaseSavedReviewQueueRepository.ts implements the storage-agnostic SavedReviewQueueRepository contract (list / getById / count) against the migration-0032 saved_review_queues (+ linked saved_filters) tables. QUERY RULES: every query is company-scoped first (company_legacy_id), soft-deleted rows (deleted_at) are excluded by default, and filtering + pagination are SERVER-SIDE (eq + or-ilike name/description search + range + count:exact) so rows are never fully loaded and sliced in memory. list returns lightweight queues built from the flat columns + the single queue data jsonb (which already embeds its filter losslessly); ordering is deterministic (sort_order asc, legacy_id tiebreak). Shared and private queues are both returned with the `shared` flag mapped. The saved filter criteria STAY in data jsonb — getById hydrates the filter from the linked saved_filters row ONLY when the queue does not already embed it (read-only link mapping, NO evaluation/execution of saved filters, NO membership computed), falling back to an empty filter when the linked filter is missing/soft-deleted. EMPTY SUPABASE IS VALID: empty list / total 0 / null getById — NO fallback to localStorage, NO seed, NO unsafe-empty. The adapter is DORMANT: it is NOT wired into AppContext, any page, route or mutation, and the legacy checkout TimeReport flow is untouched; shouldReadSavedReviewQueuesFromSupabase() exposes the DEFAULT-OFF TIME_REPORTING_SUPABASE_READ gate for a future consumer (deliberately NOT the cutover resolver). 17 fixture tests (supabaseSavedReviewQueueRepository.test.ts) cover empty Supabase, queue mapping, shared/private handling, sort ordering, saved-filter link hydration + soft-deleted-filter fallback, count, server-side pagination + pre-pagination total, soft-delete exclusion, company-scope isolation and free-text search. EXCLUDED: create/update/delete queue behaviour, bulk actions, checkout dual-write/shadow-read/cut-over, UI, routes, notifications and all payroll / invoice / time-bank / AI writes. SEPARATELY TRACKED (not fixed here): pre-existing protocolRunStore.test.ts ordering flakiness from same-millisecond time-based ids — unrelated to this read-seam slice. Files: src/lib/data/supabaseSavedReviewQueueRepository.ts (new), src/lib/data/supabaseSavedReviewQueueRepository.test.ts (new), src/lib/developmentCenter.ts, src/lib/developmentTimeline.ts."
  },
  {
    date: "2026-06-10T13:00:00.000Z",
    module: "Mission Log",
    moduleKey: "mission_log",
    category: "migration",
    eventType: "Mission Log checkout DUAL-WRITE foundation added (Slice 2c-1) — fire-and-forget mirror, flag OFF",
    note: "Slice 2c-1 lands the FIRST Mission Log write seam: a fire-and-forget dual-write that mirrors ONE legacy work-order checkout into the migration-0031 execution-ledger tables, gated by MISSION_LOG_DUAL_WRITE (DEFAULT OFF). New files: missionLogMigration.ts (pure deterministic-id derivation + to*UpsertRow / to*InsertRow mappers), missionLogDualWrite.ts (mirrorMissionLogCheckout) and missionLogCutover.ts (shouldMirrorMissionLogCheckout gate + sanitized dual-write telemetry). ATTACHMENT POINT: AppContext.submitTimeReportCheckout, immediately AFTER persistTimeReports([report, ...]) — `if (shouldMirrorMissionLogCheckout()) void mirrorMissionLogCheckout(report, { customerId: order.customerId })`. The legacy localStorage checkout stays AUTHORITATIVE: it has already succeeded before the mirror runs, the mirror never throws, and a Supabase failure is recorded in the cut-over state and never surfaced (no user-facing error). TABLES WRITTEN: mission_log_entries (UPSERT, one mission/service-row context — flat company_id UUID + company_legacy_id, soft booking/occurrence/work-order/customer legacy ids, FLAT nullable service_row_legacy_id for delete-guard parity, mission_status=completed, delay_status derived from actual-vs-scheduled minutes, requires_admin_review mirrors non-auto-approval, lossless data jsonb), mission_staff_sessions (UPSERT — status=checked_out, check_out_method=manual, check_in_method=missing, actual_check_out_time=submittedAt; NO fabricated GPS/QR/check-in) and mission_log_events (IMMUTABLE employee_checked_out INSERT via upsert ignoreDuplicates on legacy_id — never duplicates, never mutates an existing event). IDEMPOTENCY: entry id `mission:{workOrderId}:{serviceRowId|wo}`; staff-session id OPTION B `session:{entryId}:{employeeId}:{legacyReportId}` so a second checkout by the same employee for the same mission is a DISTINCT session, never merged, while a retried checkout converges; event idempotency_key `checked_out:{legacyReportId}` is a stable pure function of the report id and cannot drift on retry. A checkout whose company has no Supabase UUID mapping is SKIPPED + surfaced (skippedMissingCompany), writing nothing. NOT WRITTEN: mission_booked_time_ratings, every Time Reporting table (time_reports / time_allocations / time_report_flags / time_report_events / time_report_messages), payroll basis, invoice basis, the time bank, notifications, AI inference. 12 fixture tests (missionLogDualWrite.test.ts) cover gate-OFF (no write attempted), deterministic ids + derived delay status, legacy+Supabase success, idempotent retry (no duplicate entries/events), Option-B distinct sessions, Supabase failure recorded without throwing, partial-then-retry convergence, not-configured, missing-company skip, flat service_row_legacy_id, and the strict three-table write boundary. EXCLUDED: Time Reporting dual-write, parity comparator, read cut-over, UI, routes, AppContext read change, TimeReportStatusBadge, service-row delete-guard changes.",
  },
  {
    date: "2026-06-10T15:00:00.000Z",
    module: "Time Reporting",
    moduleKey: "time_reporting",
    category: "migration",
    eventType: "Time Reporting checkout DUAL-WRITE flag + message added (Slice 2c-2b) — fire-and-forget, flag OFF",
    note: "Slice 2c-2b EXTENDS the SAME Time Reporting checkout dual-write path (timeReportingMigration.ts + timeReportingDualWrite.ts) with the optional review surface — NO competing path; the 2c-2a CORE writes (time_reports / time_allocations / time_report_events) are UNCHANGED. ADDED conditional writes AFTER the submitted event: time_report_flags (ONE `deviation_review` flag, written ONLY when the checkout requires admin review [approvalStatus !== auto_approved]; INSERT-ONCE via upsert ignoreDuplicates on legacy_id `tr_flag:{reportId}:admin_review` so a retried mirror never clobbers a later admin resolution; resolution_status=open tracked SEPARATELY from approval; no fabricated severity), time_report_flag_events (the IMMUTABLE `flag_opened` event null→open for that flag, legacy_id `tr_flag_event:{reportId}:opened`, idempotency_key `time_report_flag_opened:{reportId}`, insert-ignore — only alongside a flag), and time_report_messages (ONE IMMUTABLE checkout message written ONLY when a real trimmed deviationComment exists [no empty/whitespace message], sender=employee, legacy_id `tr_msg:{reportId}:checkout_comment`, idempotency_key `time_report_checkout_comment:{reportId}`, insert-ignore). The report's denormalised flag_resolution_status rollup is set to `open` when a flag is raised (auto-approved → null), still SEPARATE from approval. Failure handling is identical: every new write is fire-and-forget, never throws, a Supabase error is recorded in the cut-over telemetry (failed++) and never surfaced; the legacy checkout stays authoritative. Gate unchanged: TIME_REPORTING_DUAL_WRITE (DEFAULT OFF, NOT cutoverFlag). NO payroll/invoice basis, time-bank, notification or AI writes; status / allocation / payroll / invoice mapping, mission-log soft links and service_row_legacy_id handling all UNCHANGED. Tests: extended timeReportingDualWrite.test.ts to 32 (flag for pending / none for auto-approved, flag+event idempotent retry, rollup=open, message only when comment exists, no empty/whitespace message, message idempotent retry, flag/flag-event/message insert-failure recorded-not-thrown, partial-then-retry convergence across flags+message, strict write boundary). Parity/shadow validation NOT started; read cut-over NOT started; Supabase-authoritative NOT started.",
  },
  {
    date: "2026-06-10T16:00:00.000Z",
    module: "Time Reporting",
    moduleKey: "time_reporting",
    category: "migration",
    eventType: "Operational Execution PARITY comparators added (Slice 2d-1) — pure functions + tests, no runtime hook",
    note: "Slice 2d-1 lands the PURE parity/shadow-validation comparators (NO runtime hook, fetch runner, telemetry state, Development Center button, checkout blocking or read cut-over). New files: parityShared.ts (the structured ParityMismatch model — type / domain / table / sourceLegacyId / field / expected / actual / severity info|warning|blocking / timestamp / sanitized context — plus a pure ParityCollector with an injectable clock and an isParityPass helper where info-only is still a PASS), timeReportingParity.ts (compareTimeReportingParity) and missionLogParity.ts (compareMissionLogParity). Both comparators are PURE: they take the legacy checkout TimeReport + context + ALREADY-FETCHED Supabase row fixtures and return structured mismatches — NO Supabase / localStorage reads, NO writes, NO logging side effects, NO UI / AppContext integration. They REUSE the SAME deterministic id + status/flag/message derivation the dual-write writes through (timeReportingMigration / missionLogMigration: buildTimeReportLegacyId / allocation + submitted-event + flag + message id builders / buildMissionLogEntryLegacyId / buildMissionStaffSessionLegacyId / buildCheckoutEventLegacyId) so parity can never drift from the write path. TIME REPORTING checks: report exists + deterministic legacy id, company/work-order/service-row/employee legacy ids, employee name snapshot, scheduled/actual/deviation minutes, status mapping, requires_admin_review, submitted_at, mission_log_entry/staff_session soft links, the scheduled allocation ALWAYS present (even 0 min) + deviation allocations present only when >0 + minutes match + no unexpected allocations, ONE non-duplicated submitted event, pending→one open deviation flag (+ its flag_opened event) / auto-approved→no flag, and a checkout message only when a real comment exists. SEVERITY: missing report / missing scheduled allocation / missing+duplicate submitted event and the payroll+invoice not_ready + ai_recommendation null INVARIANTS are blocking; field / allocation / flag / message divergences are warning. AUDIT/EVENT EQUIVALENCE IS SOFT (2d-1 clarification): the submitted action is validated by presence of the deterministic non-duplicated time_report_submitted event with occurred_at==submittedAt, NOT a field-by-field auditHistory diff. MISSION LOG checks: entry / staff session / checked_out event existence + deterministic ids + service_row / employee / customer matches + non-duplicated event; ABSENCE is dual-write-state aware — missionLogDualWriteEnabled OFF → missing rows are graded info (expected, still a PASS) while the Time Reporting comparator independently validates the deterministic mission soft-link ids regardless; ON → missing entry/session/event are blocking and a duplicated checked_out event is blocking; a row that IS present is validated either way. 36 fixture tests (timeReportingParity.test.ts 28 + missionLogParity.test.ts 8) cover the perfect match, every field/allocation/flag/message divergence, the invariants, soft submitted-event equivalence + duplicate, mission link, Mission Log ON-missing=blocking vs OFF-missing=info, and purity (no Supabase/localStorage calls, injectable clock). EXCLUDED: runtime hook, fetch runner, telemetry/cutover state, Development Center diagnostic button, checkout blocking, shadow read, read cut-over, UI, routes, service-row delete-guard switch, TimeReportStatusBadge change, legacy TimeReport removal, payroll/invoice/time-bank writes, AI inference.",
  },
  {
    date: "2026-06-10T17:00:00.000Z",
    module: "Time Reporting",
    moduleKey: "time_reporting",
    category: "migration",
    eventType: "Operational Execution PARITY fetch runner + sanitized telemetry added (Slice 2d-2) — dormant, dev/test utility, no runtime hook",
    note: "Slice 2d-2 lands the READ-ONLY parity fetch runner + sanitized telemetry on top of the Slice 2d-1 pure comparators (still NO runtime/checkout hook, NO Development Center button, NO read cut-over, NO Supabase-authoritative status). Added the TIME_REPORTING_SHADOW_VALIDATE feature flag (envFlag, DEFAULT OFF, NOT cutoverFlag) which ONLY gates the runner — it never switches live reads, never blocks or alters checkout and never changes the UI. New files: timeReportingParityState.ts (cumulative SANITIZED telemetry — enabled / totalChecked / matched / mismatched / blocking / warning / info / missingInSupabase / missingInLegacy / allocation / status / flag / event / message / missionLink mismatch counters / fetchFailures / lastError / lastValidationAt + a 50-capped recentMismatches ring; the CENTRALIZED sanitizeParityMismatch strips deviation comments, message bodies, employee/customer name snapshots and any non-scalar payload — sensitive field/table values become `[redacted]`, only short scalar ids/minutes/counts/statuses are retained) and timeReportingParityRunner.ts (runTimeReportingParityForReport / runTimeReportingParityBatch + shouldRunTimeReportingShadowValidation). FETCH STRATEGY (read-only, by deterministic id, company-scoped): time_reports by legacy_id + company_legacy_id + deleted_at null (maybeSingle); child allocations + flags by time_report_legacy_id excluding soft-deleted; events / flag_events / messages by time_report_legacy_id; Mission Log entry / staff session / checkout event each fetched by their OWN deterministic legacy_id (so a sibling report on the same mission entry can never look like a duplicate). It runs the PURE comparators and records sanitized telemetry — NEVER upserts/inserts/updates/deletes, never touches localStorage, never imports AppContext/UI, and NEVER throws into the caller (a Supabase fetch failure, unconfigured client or comparator error is caught, recorded as a sanitized fetch failure and returned). GATING: gate OFF → nothing fetched, nothing recorded (an `enabled` opt overrides the flag for tests / the future caller). MISSION LOG parity is OPT-IN per call (includeMissionLog); absence grading follows MISSION_LOG_DUAL_WRITE (overridable per call): OFF → missing Mission Log rows are info/expected (a PASS), ON → blocking. BATCH mode is bounded + sequential and, given a caller-provided lightweight set of Supabase report legacy_ids, records the inverse (Supabase rows absent from the legacy batch) as missing-in-legacy — no broad scan by default. 27 runner fixture tests cover gate OFF/ON, perfect match, blocking/warning/info counters, missing-in-Supabase, missing-in-legacy (batch), allocation/status/flag/event/message/mission-link aggregation, Mission Log OFF (info) vs ON (blocking) absence, the recent-mismatch cap, the sanitizer (comments / message bodies / name snapshots / non-scalar payloads stripped) and the strict read-only boundary (zero write calls). EXCLUDED: runtime/checkout hook, Development Center diagnostic button, shadow read as a live source, read cut-over, UI, routes, service-row delete-guard switch, TimeReportStatusBadge change, legacy TimeReport removal, payroll / invoice / time-bank / notification / AI writes, Schedule mutation.",
  },
  {
    date: "2026-06-10T18:00:00.000Z",
    module: "Time Reporting",
    moduleKey: "time_reporting",
    category: "migration",
    eventType: "Operational Execution PARITY runtime hook added (Slice 2d-3) — gated fire-and-forget, single-report, no UI / read cut-over",
    note: "Slice 2d-3 wires the Slice 2d-2 parity runner into the SUCCESS TAIL of mirrorTimeReportingCheckout (timeReportingDualWrite.ts) — NOT AppContext. After every Time Reporting write completes successfully it calls runTimeReportingParityForReport(report, context, { enabled: true, includeMissionLog, missionLogDualWriteEnabled }) FIRE-AND-FORGET; running it here (AFTER the writes) removes the Time Reporting write/read race. GATE: shouldRunTimeReportingShadowValidation() (TIME_REPORTING_SHADOW_VALIDATE, DEFAULT OFF) — gate OFF → the runner is NOT called at all; the hook is only reachable when the Time Reporting mirror itself runs, which already implies TIME_REPORTING_DUAL_WRITE. It is NOT called on a mirror FAILURE or a missing-company SKIP (the success tail is never reached). includeMissionLog reflects MISSION_LOG_DUAL_WRITE (off → Mission Log rows are not fetched/compared, their absence stays non-blocking; on → graded warning/blocking) — Mission Log is a SEPARATE sibling fire-and-forget mirror so its rows may briefly lag Time Reporting validation; that is recorded as telemetry only, never affects checkout, and NO ordering dependency was added between the two mirrors. FAILURE ISOLATION: the runner is designed never to throw, but the returned promise is defensively .catch-swallowed AND the synchronous call is try/caught, so a runner rejection / synchronous throw can never surface to the already-successful checkout. AppContext is UNCHANGED — it still calls mirrorTimeReportingCheckout(report, { customerId }) with no hook opts; the optional MirrorTimeReportingHookOptions (shadowValidationEnabled / missionLogDualWriteEnabled / runShadowValidation) exist ONLY for deterministic tests. NO read cut-over, shadow read as live source, UI, routes, Development Center button, service-row delete-guard switch, TimeReportStatusBadge change, legacy TimeReport removal, bulk actions, notifications, payroll/invoice basis, time-bank writes or AI inference. Tests: new timeReportingShadowHook.test.ts (gate OFF → not called, gate ON + success → called exactly once, includeMissionLog reflects Mission Log ON/OFF, NOT called on mirror failure/skip, runner rejection + synchronous throw swallowed without breaking the mirror, default no-opt path dormant under vitest). Also TRACKED (not fixed): developmentTimeline.test.ts asserts getTimelineEntries('all').length === total but getTimelineEntries defaults to the 50-entry cap while the seed exceeds 50 — pre-existing, left as-is per the slice scope.",
  },
  {
    date: "2026-06-10T14:00:00.000Z",
    module: "Time Reporting",
    moduleKey: "time_reporting",
    category: "migration",
    eventType: "Time Reporting checkout DUAL-WRITE CORE added (Slice 2c-2a) — fire-and-forget mirror, flag OFF",
    note: "Slice 2c-2a lands the Time Reporting checkout write seam (CORE only): a fire-and-forget dual-write that mirrors ONE legacy work-order checkout into the migration-0032 Time Reporting CORE tables, gated by TIME_REPORTING_DUAL_WRITE (DEFAULT OFF, NOT cutoverFlag). New files: timeReportingMigration.ts (pure deterministic-id derivation + to*UpsertRow / to*InsertRow mappers), timeReportingDualWrite.ts (mirrorTimeReportingCheckout) and timeReportingCutover.ts (shouldMirrorTimeReportingCheckout gate + sanitized dual-write telemetry). ATTACHMENT POINT: AppContext.submitTimeReportCheckout, immediately AFTER the Slice 2c-1 Mission Log mirror — `if (shouldMirrorTimeReportingCheckout()) void mirrorTimeReportingCheckout(report, { customerId: order.customerId })`. The legacy localStorage checkout stays AUTHORITATIVE: it has already succeeded before the mirror runs, the mirror never throws, and a Supabase failure is recorded in the cut-over state and never surfaced (no user-facing error). TABLES WRITTEN (CORE only): time_reports (UPSERT, one authoritative report per checkout — flat company_id UUID + company_legacy_id, mission_log_entry_legacy_id + mission_staff_session_legacy_id computed via the SAME Slice 2c-1 keys EVEN WHEN Mission Log dual-write is off, soft booking/occurrence/work-order legacy ids, FLAT nullable service_row_legacy_id for delete-guard parity, customer/employee legacy ids + name snapshots, scheduled/actual/deviation minutes, status mapped auto_approved→auto_approved / pending_admin_approval→admin_review_required, requires_admin_review, payroll_approval_status=not_ready + invoice_basis_status=not_ready INDEPENDENT, flag_resolution_status NULL + ai_recommendation NULL, lossless data jsonb), time_allocations (UPSERT — scheduled_billable ALWAYS written even at 0 minutes; extra_billable only when billableDeviationMinutes>0; internal_non_billable only when internalDeviationMinutes>0; zero-minute deviation slices skipped; is_payroll/invoice/billable relevance flags CLASSIFY time only) and time_report_events (IMMUTABLE time_report_submitted INSERT via upsert ignoreDuplicates on legacy_id). IDEMPOTENCY: report id `treport:{reportId}`; allocations `alloc:{reportId}:{scheduled|billable_deviation|internal_deviation}`; event idempotency_key `time_report_submitted:{reportId}` — pure functions of the legacy report id so retries converge and partial success then retry converges. Missing company UUID mapping → recorded skip, no write, no throw. NOT WRITTEN in 2c-2a: time_report_flags, time_report_flag_events, time_report_messages (Slice 2c-2b), and never payroll/invoice basis, time-bank, notifications or AI inference. 17 fixture tests (timeReportingDualWrite.test.ts) green. DORMANT: flag default OFF, no read switch, no live UI consumer, no AppContext read behaviour change, legacy TimeReport read/barrel untouched, no parity comparator / shadow read / read cut-over.",
  },
  {
    date: "2026-06-12T17:00:00.000Z",
    module: "TypeScript Cleanup",
    category: "governance",
    eventType:
      "TypeScript cleanup / strict TS debt track PAUSED — surfaced in Development Center → Paused Workstreams",
    status: "paused",
    note: "The strict TypeScript cleanup track is PAUSED (documentation/status only — no runtime change). Latest known strict count ~170; the latest mini-wave reduced strict errors by 5 and changed TEST FILES ONLY (src/hooks/use-work-order-mutations.test.tsx, src/hooks/use-time-bank-panel.test.tsx, src/components/workorder/ServiceProtocolLink.test.tsx); earlier safe slices were the Entitlements synthetic limit-key test drift and scheduleConvergence.test.ts. Remaining strict debt is intentionally deferred (production/data-layer/Supabase cast debt in src/lib/data/*, Calculator V2-related debt, other deferred strict-mode issues) and runChecks may still fail on known pre-existing TS-DEBT outside the test-only scope — those must NOT be fixed under this track. MUST NOT resume automatically: no new cleanup slices, no broad src/lib/data/* cast debt, no “Fix errors”. RESUME (explicit instruction only): re-run runChecks + the strict baseline, report the total, then propose one test-only fixture slice at a time. Now visible in Development Center → Paused Workstreams; full record in docs/dev-center/10-paused-workstreams-and-handoff-status.md. No production logic, schema, RLS, migrations or Edge Functions touched.",
  },
  {
    date: "2026-06-12T17:05:00.000Z",
    module: "Calculator V2",
    category: "governance",
    eventType:
      "Calculator V2 PAUSED / future project — surfaced in Development Center → Paused Workstreams",
    status: "paused",
    note: "Calculator V2 is PAUSED completely and remains a FUTURE project (documentation/status only — no runtime change). It is NOT started: an approved strategy plan exists on file, but no V2 implementation slice has been executed. The adjacent completed baseline is the Home-only calculator baseline (separate from V2 rebuild; see docs/dev-center/price-calculator/04-home-only-baseline-status.md). MUST NOT resume automatically: do not work on Calculator V2, do not update its plan checkboxes, do not modify calculator runtime behaviour or tests, and do not infer V2 work from background context or plan reminders. RESUME (explicit instruction only): start from a fresh Calculator V2 plan confirmation and keep it separate from general TS cleanup. Now visible in Development Center → Paused Workstreams; full record in docs/dev-center/10-paused-workstreams-and-handoff-status.md.",
  },
  {
    date: "2026-06-12T17:10:00.000Z",
    module: "Auth / Admin User Lifecycle",
    moduleKey: "auth",
    category: "governance",
    eventType:
      "Auth / Invite / Admin User Lifecycle PAUSED — surfaced in Development Center → Paused Workstreams",
    status: "paused",
    note: "The Auth / Invite / Admin User Lifecycle track is PAUSED, including admin-user-lifecycle deployment/debugging (documentation/status only — no runtime change, no Edge Function touched). Password recovery WORKS (UX/error handling improved). Admin User Lifecycle UI/function work exists in the repo. BLOCKER: admin-user-lifecycle deployment is paused — a local repo/sync issue blocked the local deploy because the operator's local folder did not contain supabase/functions/admin-user-lifecycle/index.ts; in the Rork-synced repo the file IS present, so resolve the local sync first. Not blocking current work. MUST NOT resume automatically: no admin-user-lifecycle deploy/debug, no invite flow, no password recovery, no user lifecycle actions, no Edge Functions. RESUME (explicit instruction only): resolve the repo/sync issue and confirm the function exists locally, then `supabase functions deploy admin-user-lifecycle --project-ref swqcdcpwofdnmoureifu`, then test Last Login / Invite Status, Resend Invite, Disable User, blocked login after disable, Enable User, successful login after enable. Now visible in Development Center → Paused Workstreams; full record in docs/dev-center/10-paused-workstreams-and-handoff-status.md.",
  },
];

let cached: TimelineEntry[] | null = null;

/**
 * Returns the governance timeline, sorted newest-first by `date`. This is the
 * single seam a future Supabase repository would replace — the UI must not read
 * the seed array directly. Ids are derived deterministically from each entry's
 * position so they remain stable across reloads.
 */
export function getDevelopmentTimeline(): TimelineEntry[] {
  if (cached) return cached;
  cached = SEED_TIMELINE.map((e, i) => ({ id: `dt-${i + 1}`, ...e })).sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );
  return cached;
}

/**
 * Returns timeline entries filtered by category (or all), sorted newest-first.
 * Pure and read-only.
 *
 * The {@link TIMELINE_DEFAULT_LIMIT} cap applies ONLY to the default view (no
 * arguments). Passing an explicit category returns the FULL filtered set unless
 * an explicit `limit` is also given, so callers asking for a specific slice are
 * never silently truncated as the seed grows.
 */
export function getTimelineEntries(
  category?: TimelineCategory | "all",
  limit?: number,
): TimelineEntry[] {
  const all = getDevelopmentTimeline();
  const resolvedCategory = category ?? "all";
  const matched =
    resolvedCategory === "all" ? all : all.filter((e) => e.category === resolvedCategory);
  const effectiveLimit =
    limit !== undefined
      ? Math.max(0, limit)
      : category === undefined
        ? TIMELINE_DEFAULT_LIMIT
        : matched.length;
  return matched.slice(0, effectiveLimit);
}
