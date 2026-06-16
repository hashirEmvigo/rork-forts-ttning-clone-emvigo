/**
 * WO-6 — Work Order source-of-truth cut-over (P5J). Design-only.
 *
 * The Work Orders authority switch — the direct analogue of
 * {@link import("./wave1f.cutover.blueprint")}. Records the pre-cut-over
 * checklist, the authority model, the read/write cut-over policy, the
 * divergence/failure handling rules, the rollback/backout plan, and the final
 * Work Order migration status. The runnable pieces are:
 *   • feature flag       — WORK_ORDERS_SUPABASE_AUTHORITATIVE (default OFF)
 *   • backout snapshot   — src/lib/data/workOrderBackout.ts
 *   • cut-over runtime   — src/lib/data/workOrderCutover.ts
 *   • read hooks         — use-work-order-list-source / use-work-order-detail-source
 *   • write seams        — AppContext.persistWorkOrders / persistBookingOccurrenceExceptions
 *
 * Nothing here executes a cut-over. The flag is OFF by default, so the app keeps
 * behaving exactly as WO-5.6 left it. Flipping the flag is reversible and
 * data-free; this file documents the contract that makes that safe.
 *
 * IMPORTANT: Schedule is NOT switched in WO-6. The resolver
 * (`resolveScheduleProgram`), recurrence, variation and exception LOGIC are all
 * untouched; Schedule keeps reading the local resolver path. Schedule
 * interval-query migration is the later WO-7 phase.
 */

// ── Part 1 — Pre-cut-over checklist ───────────────────────

export interface WorkOrderCutoverCheck {
  check: string;
  required: string;
  verifiedBy: string;
}

/** Every check must pass (in live staging) BEFORE the authoritative flag is on. */
export const WO_PRE_CUTOVER_CHECKLIST: ReadonlyArray<WorkOrderCutoverCheck> = [
  { check: "List read flag on", required: "work_orders_list_supabase_read = ON", verifiedBy: "staging env / SystemPerformance WO-2 panel" },
  { check: "Detail read flag on", required: "work_orders_detail_supabase_read = ON", verifiedBy: "staging env / SystemPerformance WO-3 panel" },
  { check: "Dual write on", required: "work_orders_dual_write = ON", verifiedBy: "staging env / SystemPerformance WO-5 panel" },
  { check: "Removal propagation in place", required: "removed parents / service rows / exceptions soft-deleted; ghost schedule risk = none", verifiedBy: "WO-5.6 removal propagation (migration 0009) + dual-write state" },
  { check: "Soak result clean", required: "0 critical drift, 0 schedule mismatches, 0 scope failures, 0 write failures, rollback verified", verifiedBy: "runWorkOrderSoak / WO-5.5 soak panel" },
  { check: "Schedule dependency clean", required: "0 divergences between local + Supabase-reconstructed resolve output", verifiedBy: "validateWorkOrderScheduleDependency()" },
  { check: "Live RLS confirmed", required: "Company A cannot read/write Company B (work_orders / service rows / exceptions); super_admin reads all", verifiedBy: "live Supabase query under each role (migrations 0008 + 0009)" },
  { check: "Backout snapshot taken", required: "export with per-company counts + service-row/variation/exception totals + checksum", verifiedBy: "exportWorkOrderBackout() / Source-of-Truth panel" },
];

// ── Part 2 — Authority model ──────────────────────────────

export type WorkOrderAuthoritySource = "localStorage" | "supabase";

export interface WorkOrderAuthorityRow {
  operation: string;
  before: WorkOrderAuthoritySource;
  after: WorkOrderAuthoritySource;
  note: string;
}

/**
 * The authority shift the flag performs. localStorage is retained as a
 * synchronized BACKOUT copy on writes even after cut-over (strategy B), which is
 * what keeps rollback instant. Schedule is intentionally absent — it stays on
 * the local resolver in WO-6.
 */
export const WO_AUTHORITY_MODEL: ReadonlyArray<WorkOrderAuthorityRow> = [
  { operation: "List read (Customer Card · Work Orders tab)", before: "localStorage", after: "supabase", note: "Falls back to backout copy on failure; fallback recorded." },
  { operation: "Detail read (WorkOrderDetails)", before: "localStorage", after: "supabase", note: "Falls back to backout copy when a row is missing/errors; recorded." },
  { operation: "Write (work order + service rows)", before: "localStorage", after: "supabase", note: "localStorage written first as backout copy, then authoritative mirror (incl. WO-5.6 soft-delete removal)." },
  { operation: "Write (occurrence exceptions, separate store)", before: "localStorage", after: "supabase", note: "Mirrored via persistBookingOccurrenceExceptions; scoped via parent service row's company." },
  { operation: "Schedule resolver", before: "localStorage", after: "localStorage", note: "UNCHANGED in WO-6 — Schedule reads the local resolver path; interval migration is WO-7." },
  { operation: "Backout copy", before: "localStorage", after: "localStorage", note: "Always kept in sync so rollback needs no data migration." },
];

// ── Part 3 — Write-path cut-over decision ─────────────────

export type WorkOrderWriteStrategy =
  | "A_no_local_write"
  | "B_local_backout_copy"
  | "C_post_write_sync";

export interface WorkOrderWriteStrategyDecision {
  chosen: WorkOrderWriteStrategy;
  rationale: ReadonlyArray<string>;
  rejected: ReadonlyArray<{ option: WorkOrderWriteStrategy; why: string }>;
}

/**
 * We choose B — keep writing localStorage as a temporary backout copy — exactly
 * as Customers did. It makes rollback instant and data-free with zero
 * divergence, and it is critical for Work Orders because the Schedule resolver
 * still reads the local store in WO-6: the local write must remain current.
 */
export const WO_WRITE_STRATEGY: WorkOrderWriteStrategyDecision = {
  chosen: "B_local_backout_copy",
  rationale: [
    "Rollback is `flag OFF` with no data migration — localStorage is already current.",
    "Schedule still reads the local store in WO-6, so the local write MUST stay current — strategy B guarantees it inline.",
    "No silent divergence: every write touches both stores; the post-write validator + shadow read keep proving parity.",
    "The local write is synchronous and cannot fail on Supabase, so the work-order operation is never blocked.",
  ],
  rejected: [
    { option: "A_no_local_write", why: "Schedule reads localStorage in WO-6 — skipping the local write would break the board; also rollback would need a Supabase→local export." },
    { option: "C_post_write_sync", why: "A separate sync pass leaves a window where the backout copy (and Schedule's input) is stale; B keeps it current inline." },
  ],
};

// ── Part 4 — Read-path fallback policy ────────────────────

export interface WorkOrderFallbackRule {
  scenario: string;
  behavior: string;
  recorded: string;
}

/** Explicit, never-silent fallback behaviour under authoritative mode. */
export const WO_READ_FALLBACK_POLICY: ReadonlyArray<WorkOrderFallbackRule> = [
  { scenario: "Supabase list read fails", behavior: "Render the localStorage backout copy (list never blanks).", recorded: "recordWorkOrderCutoverFailure('read.list') → readFallbacks++, console.warn (dev)." },
  { scenario: "Supabase detail read fails / no row", behavior: "Render the localStorage record (page never breaks).", recorded: "recordWorkOrderCutoverFailure('read.detail') → readFallbacks++." },
  { scenario: "Supabase reachable, returns rows", behavior: "Supabase is primary; counted as a primary read.", recorded: "recordWorkOrderCutoverRead() → list/detailReadsPrimary++." },
];

// ── Part 5 — Divergence / failure handling ────────────────

export type WorkOrderDivergenceSeverity = "critical" | "high" | "medium" | "low";

export interface WorkOrderDivergenceRule {
  event: string;
  handling: string;
  severity: WorkOrderDivergenceSeverity;
}

/** How each divergence/failure is handled — no silent failures. */
export const WO_DIVERGENCE_HANDLING: ReadonlyArray<WorkOrderDivergenceRule> = [
  { event: "Supabase write succeeds, local backout fails", handling: "Local write is synchronous and precedes the mirror, so this cannot happen silently; a thrown save would surface to the caller.", severity: "high" },
  { event: "Supabase write fails / timeout", handling: "localStorage already advanced; recorded as write.mirror cut-over failure; retried on the next write of that record (idempotent upsert).", severity: "high" },
  { event: "Network timeout (read)", handling: "Fall back to backout copy; recorded as readFallback.", severity: "medium" },
  { event: "RLS failure", handling: "Read returns no row / write rejected; surfaced as a failure; indicates a tenancy/config problem to fix before proceeding.", severity: "critical" },
  { event: "Missing company mapping", handling: "Mirror skips the row + records it; companies must be migrated first.", severity: "high" },
  { event: "Partial service-row write", handling: "Parent + rows upsert in sequence; a row-upsert error aborts and is recorded; the post-write validator + shadow read detect any service-row count drift.", severity: "high" },
  { event: "Partial exception write", handling: "Exception store mirrors separately via persistBookingOccurrenceExceptions; failures recorded; shadow read detects exception drift.", severity: "high" },
  { event: "Soft-delete propagation failure", handling: "Removed parents/rows/exceptions soft-delete via UPDATE; an error is recorded; a surviving stale row is caught by shadow read + schedule dependency validation (ghost-occurrence guard).", severity: "critical" },
];

// ── Part 6 — Rollback / backout plan ──────────────────────

export interface WorkOrderRollbackStep {
  step: number;
  action: string;
  detail: string;
}

/**
 * The documented, executable backout. Because localStorage is kept current as
 * the backout copy (and Schedule still reads it), the primary rollback is a
 * single flag flip. The recovery steps cover the rare case where Supabase
 * accrued writes the local copy somehow missed (it should not, given strategy B).
 */
export const WO_ROLLBACK_PLAN: ReadonlyArray<WorkOrderRollbackStep> = [
  { step: 1, action: "Flip WORK_ORDERS_SUPABASE_AUTHORITATIVE OFF", detail: "Reads + writes return to localStorage immediately; no data migration. Also flip the list/detail/dual-write flags OFF for a full backout." },
  { step: 2, action: "Confirm parity", detail: "Run shadowReadWorkOrders() — localStorage (authoritative again) should already match Supabase." },
  { step: 3, action: "Confirm schedule safety", detail: "Run validateWorkOrderScheduleDependency() — local + Supabase-reconstructed resolve output must still match; Schedule never switched, so the board is unaffected." },
  { step: 4, action: "Recover any Supabase-only writes (rare)", detail: "If the shadow read shows Supabase-newer rows, re-import via the WO-1 migration tool / backout snapshot before continuing." },
  { step: 5, action: "Verify checksum", detail: "verifyWorkOrderBackout(snapshot) confirms the local dataset (work orders + exceptions) against the pre-cut-over snapshot." },
];

// ── Part 7 — Exit criteria + final status ─────────────────

export interface WorkOrderCutoverExitCriterion {
  criterion: string;
  measuredBy: string;
}

/** COMPLETE only when all hold (in live staging) with the flag ON. */
export const WO_CUTOVER_EXIT_CRITERIA: ReadonlyArray<WorkOrderCutoverExitCriterion> = [
  { criterion: "Supabase authoritative for work-order reads + writes", measuredBy: "getWorkOrderCutoverState().authoritative === true" },
  { criterion: "Create / update / archive / reactivate work", measuredBy: "post-cut-over workflow validation" },
  { criterion: "Service-row + variation + exception writes mirror", measuredBy: "WorkOrderDualWriteState parents/serviceRows/exceptions mirrored; 0 mismatches" },
  { criterion: "List + WorkOrderDetails render from Supabase", measuredBy: "readSource === 'supabase', primary read counters climbing" },
  { criterion: "Schedule remains unchanged + clean", measuredBy: "Schedule on local resolver; validateWorkOrderScheduleDependency() === ok" },
  { criterion: "Company scope + RLS verified", measuredBy: "cross-company read/write blocked under each role" },
  { criterion: "0 critical drift", measuredBy: "shadowReadWorkOrders / cutover failures === 0 critical" },
  { criterion: "Rollback verified", measuredBy: "flag OFF restores localStorage; checksum matches snapshot" },
  { criterion: "localStorage retained as backout", measuredBy: "WO_WRITE_STRATEGY === B; backout copy kept current" },
];

export type WorkOrderMigrationStatus =
  | "infrastructure"
  | "reads-flagged"
  | "dual-write"
  | "soak"
  | "removal-propagation"
  | "cutover-ready"
  | "cutover-complete";

export interface WorkOrderMigrationFinalStatus {
  status: WorkOrderMigrationStatus;
  summary: string;
  nextPhase: string;
  nextPhaseRationale: ReadonlyArray<string>;
}

/**
 * WO-6 delivers the cut-over MECHANISM behind a default-OFF flag; flipping it to
 * authoritative in production happens only after live staging sign-off. The next
 * phase is WO-7 — the Schedule interval-query migration — which can begin only
 * once Work Orders are authoritative and stable.
 */
export const WORK_ORDER_MIGRATION_FINAL_STATUS: WorkOrderMigrationFinalStatus = {
  status: "cutover-ready",
  summary:
    "Work Orders can run Supabase-authoritative behind WORK_ORDERS_SUPABASE_AUTHORITATIVE (default OFF). Reads (list + detail) are Supabase-primary with recorded localStorage fallback; writes go localStorage-backout-first then authoritative mirror (parent + service rows + exceptions, incl. WO-5.6 soft-delete removal); a checksummed backout snapshot + single-flag rollback are in place. Schedule is NOT migrated — it still reads the local resolver and validates cleanly.",
  nextPhase: "WO-7 — Schedule interval-query migration",
  nextPhaseRationale: [
    "Work Orders are now authoritative + stable, the prerequisite for moving Schedule off the local store.",
    "WO-4 already proved a Supabase-reconstructed ScheduleCoreInput resolves identical occurrences — the foundation for WO-7.",
    "Schedule interval queries are the last localStorage dependency for the work-order domain.",
    "Reuses the validated wave pattern proven on Customers + Work Orders: read switch → dual write → soak → cut-over.",
  ],
};
