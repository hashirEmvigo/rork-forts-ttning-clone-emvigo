/**
 * WO-5.5 — Work Order staging soak validation (P5H). Design-only.
 *
 * Records the soak plan, the staging flag configuration, the monitored signals,
 * and the cut-over readiness criteria for making Work Orders the authoritative
 * source of truth (WO-6). Nothing here switches a source of truth, migrates
 * data, or changes behaviour — it documents the validation contract the runnable
 * harness (`src/lib/data/workOrderSoak.ts` + `workOrderSoak.test.ts`) proves.
 *
 * localStorage stays authoritative for the whole of WO-5.5. Supabase is the
 * shadow target that the read flags + dual-write mirror keep in sync; the soak
 * confirms that sync — AND the Schedule resolver's output — holds under sustained
 * real-world work-order workflows before any cut-over.
 *
 * Mirrors the proven {@link import("./wave1e.soak.blueprint")} pattern, scaled up
 * for the Work Order aggregate (parent + service rows + embedded variations + the
 * SEPARATE occurrence-exception store) and its Schedule dependency.
 */

// ── Part 1 — Staging flag configuration ───────────────────

export interface WorkOrderSoakFlagConfig {
  flag: string;
  env: string;
  staging: "ON" | "OFF";
  production: "ON" | "OFF";
  note: string;
}

/**
 * The three Work Order flags are enabled in STAGING only for the soak;
 * production stays OFF. Each is independent and instantly reversible (set OFF →
 * localStorage is the sole path again, no data rollback).
 */
export const WO_SOAK_FLAGS: ReadonlyArray<WorkOrderSoakFlagConfig> = [
  {
    flag: "work_orders_list_supabase_read",
    env: "EXPO_PUBLIC_WORK_ORDERS_LIST_SUPABASE_READ",
    staging: "ON",
    production: "OFF",
    note: "Work Order LIST (Customer Card · Work Orders tab) reads full records from Supabase; falls back to localStorage on any error.",
  },
  {
    flag: "work_orders_detail_supabase_read",
    env: "EXPO_PUBLIC_WORK_ORDERS_DETAIL_SUPABASE_READ",
    staging: "ON",
    production: "OFF",
    note: "WorkOrderDetails reads from Supabase (lossless data jsonb, incl. nested serviceRows); falls back to localStorage when a row is missing / errors.",
  },
  {
    flag: "work_orders_dual_write",
    env: "EXPO_PUBLIC_WORK_ORDERS_DUAL_WRITE",
    staging: "ON",
    production: "OFF",
    note: "Work-order + exception writes mirror to Supabase after the authoritative localStorage write; failures recorded as drift, never blocking. Schedule stays on the resolver.",
  },
];

// ── Part 2 — Workflows exercised ──────────────────────────

export interface WorkOrderSoakWorkflowSpec {
  workflow: string;
  kind: "read" | "write" | "exception";
  exercises: string;
}

/**
 * The workflow matrix the soak repeats. Writes validate the dual-write mirror +
 * post-write parity; exception writes validate the SEPARATE store's mirror;
 * reads validate the list/detail flags and the Schedule dependency dry-run.
 */
export const WO_SOAK_WORKFLOWS: ReadonlyArray<WorkOrderSoakWorkflowSpec> = [
  { workflow: "Create work order", kind: "write", exercises: "create-path mirror; new legacy_id upsert; parent + one live recurring service row." },
  { workflow: "Update header", kind: "write", exercises: "parent title/status mirror; summary field parity." },
  { workflow: "Add service row", kind: "write", exercises: "service-row insert; work_order_service_rows mirror; service_row_count parity." },
  { workflow: "Edit service row", kind: "write", exercises: "row field mirror; lossless data jsonb parity." },
  { workflow: "Change recurrence", kind: "write", exercises: "recurrence_interval mirror; schedule-critical field." },
  { workflow: "Change planned time", kind: "write", exercises: "planned_start/end_time mirror; schedule-critical field." },
  { workflow: "Assign employee", kind: "write", exercises: "assigned_employee_ids + unassigned_employee_slots mirror." },
  { workflow: "Add variation", kind: "write", exercises: "embedded variation in row data jsonb; variation_count + variation parity." },
  { workflow: "Archive work order", kind: "write", exercises: "status → inactive mirror; isLiveWorkOrder gate flips occurrences off (both sides)." },
  { workflow: "Reactivate work order", kind: "write", exercises: "status → planned mirror; idempotent re-upsert." },
  { workflow: "Reschedule occurrence", kind: "exception", exercises: "separate-store overlay → work_order_occurrence_exceptions mirror; rescheduled status + overrides." },
  { workflow: "Cancel occurrence", kind: "exception", exercises: "overlay cancelled status mirror; occurrence dropped on both sides." },
  { workflow: "Restore occurrence", kind: "exception", exercises: "overlay → active status UPDATE (no hard delete; WO-5 mirrors created/updated only)." },
  { workflow: "Search", kind: "read", exercises: "company-scoped work-order search through the repository." },
  { workflow: "List navigation", kind: "read", exercises: "paged company-scoped list reads." },
  { workflow: "Open detail", kind: "read", exercises: "single work-order detail read (incl. nested service rows)." },
  { workflow: "Open schedule", kind: "read", exercises: "validateWorkOrderScheduleDependency: local vs Supabase-reconstructed resolve diff over the window." },
];

// ── Part 3 — Monitored signals ────────────────────────────

export type WorkOrderSoakSignalSeverity = "critical" | "high" | "medium" | "low";

export interface WorkOrderSoakSignal {
  signal: string;
  source: string;
  severity: WorkOrderSoakSignalSeverity;
  note: string;
}

/** Drift, schedule, failure and performance signals tracked across the soak. */
export const WO_SOAK_SIGNALS: ReadonlyArray<WorkOrderSoakSignal> = [
  { signal: "Shadow-read drift (count / id / summary / service rows / exceptions / detail)", source: "shadowReadWorkOrders", severity: "critical", note: "Any mismatch withholds READY." },
  { signal: "Schedule-dependency mismatch", source: "validateWorkOrderScheduleDependency", severity: "critical", note: "Service-row + variation + exception parity AND a local-vs-Supabase occurrence dry-run over the window. Any divergence is a hard blocker for WO-6." },
  { signal: "Post-write field mismatch", source: "mirrorWorkOrderWrites validation", severity: "critical", note: "legacy_id / company / customer / number / status / service_row_count compared after each mirror." },
  { signal: "Company-scope leak", source: "soak scope assertion", severity: "critical", note: "A mutation touching another company's row (parent or exception via parent row) fails the soak immediately." },
  { signal: "Mirror write failure / timeout", source: "WorkOrderDualWriteState.failures", severity: "high", note: "localStorage still succeeds; recorded as drift, counts toward blockers." },
  { signal: "Rows skipped (no company mapping / missing parent row)", source: "WorkOrderDualWriteState.skipped", severity: "high", note: "Indicates companies must be migrated first, or an orphan exception." },
  { signal: "Write latency (supabase / dual / validation / schedule reconstruct + dry-run)", source: "perf timers workOrders.write.* / workOrders.schedule.*", severity: "low", note: "Measurement only — no optimization in this phase." },
];

// ── Part 4 — Cut-over readiness criteria ──────────────────

export interface WorkOrderCutoverCriterion {
  criterion: string;
  required: string;
  measuredBy: string;
}

/**
 * A READY verdict for "Work Orders Supabase Source of Truth" (WO-6) requires ALL
 * of these. The runnable soak (`runWorkOrderSoak`) computes the same verdict from
 * live data.
 */
export const WO_CUTOVER_CRITERIA: ReadonlyArray<WorkOrderCutoverCriterion> = [
  { criterion: "Zero critical drift", required: "0 shadow-read drift events", measuredBy: "report.criticalDrift === 0" },
  { criterion: "Zero schedule mismatches", required: "0 schedule-dependency divergences", measuredBy: "report.scheduleMismatches === 0" },
  { criterion: "Zero company-scope failures", required: "0 cross-company writes", measuredBy: "report.scopeFailures === 0" },
  { criterion: "Zero write failures", required: "0 mirror failures", measuredBy: "report.writeFailures === 0" },
  { criterion: "Zero field mismatches", required: "0 post-write mismatches", measuredBy: "report.mismatches === 0" },
  { criterion: "No unmapped rows", required: "0 skipped rows", measuredBy: "report.skipped === 0" },
  { criterion: "Rollback proven", required: "mirror OFF → localStorage advances, Supabase untouched", measuredBy: "report.rollbackVerified === true" },
  { criterion: "Sustained operations", required: "≥ 40 mixed workflow operations", measuredBy: "report.operations" },
];

// ── Part 5 — Known limitations carried into WO-6 ──────────

export interface WorkOrderSoakLimitation {
  area: string;
  detail: string;
  severity: WorkOrderSoakSignalSeverity;
}

/**
 * Honest gaps the soak surfaces. These do NOT block the WO-5.5 mechanism verdict
 * (the dual-write + read + schedule mechanism is proven), but they must be
 * resolved before / during the WO-6 authoritative cut-over.
 */
export const WO_SOAK_LIMITATIONS: ReadonlyArray<WorkOrderSoakLimitation> = [
  { area: "Hard delete", detail: "WO-5 dual write mirrors created/updated rows only — it never hard-deletes from Supabase. Removing a work order, service row or occurrence exception leaves a stale Supabase row. The soak therefore represents 'restore occurrence' as an active-status overlay UPDATE (a scheduling no-op), not a removal. A delete-propagation step is required before WO-6.", severity: "high" },
  { area: "Live staging volume", detail: "The automated soak proves the mechanism (40 mixed operations). The live staging soak must accrue real operator hours/volume before sign-off.", severity: "medium" },
  { area: "DB-level RLS", detail: "Migration 0008 RLS must be confirmed once against the live project under each role (normal vs super_admin) for work_orders / work_order_service_rows / work_order_occurrence_exceptions.", severity: "medium" },
];

// ── Part 6 — Verdict ──────────────────────────────────────

export type WorkOrderSoakVerdict = "READY" | "NOT READY" | "PENDING SOAK";

export interface WorkOrderSoakReadiness {
  target: string;
  verdict: WorkOrderSoakVerdict;
  rationale: ReadonlyArray<string>;
  remainingBlockers: ReadonlyArray<string>;
  /** The next phase this readiness feeds, once approved. */
  nextPhase: string;
}

/**
 * The automated soak (`workOrderSoak.test.ts`) runs a 40-iteration mixed-workflow
 * soak against the seeded `cmp_nordlys` company and asserts a READY verdict:
 * 0 drift, 0 schedule mismatches, 0 scope failures, 0 mirror failures, 0
 * mismatches, rollback proven. The live staging soak must reproduce this against
 * real usage — and resolve the hard-delete limitation — before WO-6 approval.
 */
export const WO_SOAK_READINESS: WorkOrderSoakReadiness = {
  target: "Work Orders · Supabase source of truth (WO-6)",
  verdict: "READY",
  rationale: [
    "Automated soak completes 40 mixed read+write+exception workflows with 0 critical drift across periodic shadow reads.",
    "The Schedule dependency holds: every dry-run resolves the SAME occurrences (counts + keys + fields) from local vs a Supabase-reconstructed input.",
    "Every mutation is company-scoped (parent rows and exceptions via their parent row); the scope assertion finds 0 cross-company leaks.",
    "The dual-write mirror records 0 failures and 0 post-write field mismatches once companies are mapped — parents, service rows AND occurrence exceptions all mirror.",
    "The rollback drill confirms a mirror-OFF write still advances localStorage while Supabase is left untouched — rollback is instant and data-free.",
  ],
  remainingBlockers: [
    "Hard-delete propagation (work order / service row / occurrence exception removal) must be implemented before WO-6 so removals don't leave stale Supabase rows.",
    "Live staging soak duration must accrue real operator hours/operations (the automated run proves the mechanism, not production volume).",
    "DB-level RLS (migration 0008) to be confirmed once against the live project under each role (normal vs super_admin).",
  ],
  nextPhase:
    "WO-6 — Work Orders source-of-truth cut-over: make Supabase authoritative for work-order reads + writes (with localStorage backout), after delete-propagation is added and staging soak is signed off. Schedule interval-query migration (WO-7) follows only once Work Orders are authoritative.",
};
