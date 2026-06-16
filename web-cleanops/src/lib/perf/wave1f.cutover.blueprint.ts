/**
 * Wave 1F — Customer source-of-truth cut-over (P4J). Design-only.
 *
 * The FIRST true operational source-of-truth switch. Records the pre-cut-over
 * checklist, the authority model, the read/write cut-over policy, the
 * divergence/failure handling rules, the rollback/backout plan, and the final
 * Customer migration status. The runnable pieces are:
 *   • feature flag       — CUSTOMERS_SUPABASE_AUTHORITATIVE (default OFF)
 *   • backout snapshot   — src/lib/data/customerBackout.ts
 *   • cut-over runtime   — src/lib/data/customerCutover.ts
 *   • read hooks         — use-customer-list-source / use-customer-detail-source
 *   • write seam         — AppContext.persistCustomers
 *
 * Nothing here executes a cut-over. The flag is OFF by default, so the app keeps
 * behaving exactly as Wave 1E left it. Flipping the flag is reversible and
 * data-free; this file documents the contract that makes that safe.
 */

// ── Part 1 — Pre-cut-over checklist ───────────────────────

export interface CutoverCheck {
  check: string;
  required: string;
  verifiedBy: string;
}

/** Every check must pass (in live staging) BEFORE the authoritative flag is on. */
export const PRE_CUTOVER_CHECKLIST: ReadonlyArray<CutoverCheck> = [
  { check: "List read flag on", required: "customers_list_supabase_read = ON", verifiedBy: "staging env / SystemPerformance Wave 1B panel" },
  { check: "Detail read flag on", required: "customers_detail_supabase_read = ON", verifiedBy: "staging env / SystemPerformance Wave 1C panel" },
  { check: "Dual write on", required: "customers_dual_write = ON", verifiedBy: "staging env / SystemPerformance Wave 1D panel" },
  { check: "Soak result clean", required: "0 critical drift, 0 scope failures, 0 write failures, rollback verified", verifiedBy: "runCustomerSoak / Wave 1E soak panel" },
  { check: "Live RLS confirmed", required: "Company A cannot read Company B; super_admin reads all", verifiedBy: "live Supabase query under each role (migration 0007)" },
  { check: "Backout snapshot taken", required: "export with per-company counts + checksum", verifiedBy: "exportCustomerBackout() / Source-of-Truth panel" },
];

// ── Part 2 — Authority model ──────────────────────────────

export type AuthoritySource = "localStorage" | "supabase";

export interface AuthorityRow {
  operation: string;
  before: AuthoritySource;
  after: AuthoritySource;
  note: string;
}

/**
 * The authority shift the flag performs. localStorage is retained as a
 * synchronized BACKOUT copy on writes even after cut-over (option B), which is
 * what keeps rollback instant.
 */
export const AUTHORITY_MODEL: ReadonlyArray<AuthorityRow> = [
  { operation: "List read", before: "localStorage", after: "supabase", note: "Falls back to backout copy on failure; fallback recorded." },
  { operation: "Detail read", before: "localStorage", after: "supabase", note: "Falls back to backout copy when a row is missing/errors; recorded." },
  { operation: "Write (create/update/archive)", before: "localStorage", after: "supabase", note: "localStorage written first as backout copy, then authoritative mirror." },
  { operation: "Backout copy", before: "localStorage", after: "localStorage", note: "Always kept in sync so rollback needs no data migration." },
];

// ── Part 3 — Write-path cut-over decision ─────────────────

export type WriteStrategy = "A_no_local_write" | "B_local_backout_copy" | "C_post_write_sync";

export interface WriteStrategyDecision {
  chosen: WriteStrategy;
  rationale: ReadonlyArray<string>;
  rejected: ReadonlyArray<{ option: WriteStrategy; why: string }>;
}

/**
 * Part 4 asked which of A/B/C to use for localStorage once Supabase is
 * authoritative. We choose B — keep writing localStorage as a temporary backout
 * copy — because it makes rollback instant and data-free with zero divergence.
 */
export const WRITE_STRATEGY: WriteStrategyDecision = {
  chosen: "B_local_backout_copy",
  rationale: [
    "Rollback is `flag OFF` with no data migration — localStorage is already current.",
    "No silent divergence: every write touches both stores; the post-write validator + shadow read keep proving parity.",
    "The local write is synchronous and cannot fail on Supabase, so the customer operation is never blocked.",
  ],
  rejected: [
    { option: "A_no_local_write", why: "Rollback would require exporting Supabase back to localStorage first — slower, riskier, not instant." },
    { option: "C_post_write_sync", why: "A separate sync pass adds a window where the backout copy is stale; B keeps it current inline." },
  ],
};

// ── Part 4 — Read-path fallback policy ────────────────────

export interface FallbackRule {
  scenario: string;
  behavior: string;
  recorded: string;
}

/** Explicit, never-silent fallback behaviour under authoritative mode. */
export const READ_FALLBACK_POLICY: ReadonlyArray<FallbackRule> = [
  { scenario: "Supabase list read fails", behavior: "Render the localStorage backout copy (list never blanks).", recorded: "recordCutoverFailure('read.list') → readFallbacks++, console.warn (dev)." },
  { scenario: "Supabase detail read fails / no row", behavior: "Render the localStorage record (card never breaks).", recorded: "recordCutoverFailure('read.detail') → readFallbacks++." },
  { scenario: "Supabase reachable, returns rows", behavior: "Supabase is primary; counted as a primary read.", recorded: "recordCutoverRead() → list/detailReadsPrimary++." },
];

// ── Part 5 — Divergence / failure handling ────────────────

export type DivergenceSeverity = "critical" | "high" | "medium" | "low";

export interface DivergenceRule {
  event: string;
  handling: string;
  severity: DivergenceSeverity;
}

/** How each divergence/failure is handled — no silent failures. */
export const DIVERGENCE_HANDLING: ReadonlyArray<DivergenceRule> = [
  { event: "Supabase write succeeds, local backout fails", handling: "Local write is synchronous and precedes the mirror, so this cannot happen silently; a thrown save would surface to the caller.", severity: "high" },
  { event: "Supabase write fails / timeout", handling: "localStorage already advanced; recorded as write.mirror cut-over failure; retried on the next write of that record (idempotent upsert).", severity: "high" },
  { event: "Network timeout (read)", handling: "Fall back to backout copy; recorded as readFallback.", severity: "medium" },
  { event: "RLS failure", handling: "Read returns no row / write rejected; surfaced as a failure; indicates a tenancy/config problem to fix before proceeding.", severity: "critical" },
  { event: "Duplicate customer number", handling: "Detected by the existing update guard (localStorage) before the mirror; Supabase upsert keys on legacy_id so no duplicate row.", severity: "medium" },
  { event: "Missing company mapping", handling: "Mirror skips the row + records it; companies must be migrated first.", severity: "high" },
];

// ── Part 6 — Rollback / backout plan ──────────────────────

export interface RollbackStep {
  step: number;
  action: string;
  detail: string;
}

/**
 * The documented, executable backout. Because localStorage is kept current as
 * the backout copy, the primary rollback is a single flag flip. The recovery
 * steps below cover the rare case where Supabase accrued writes that the local
 * copy somehow missed (it should not, given option B).
 */
export const ROLLBACK_PLAN: ReadonlyArray<RollbackStep> = [
  { step: 1, action: "Flip CUSTOMERS_SUPABASE_AUTHORITATIVE OFF", detail: "Reads + writes return to localStorage immediately; no data migration." },
  { step: 2, action: "Confirm parity", detail: "Run shadowReadCustomers() — localStorage (now authoritative again) should already match Supabase." },
  { step: 3, action: "Recover any Supabase-only writes (rare)", detail: "If the shadow read shows Supabase-newer rows, re-import via the Wave 1A migration tool / backout snapshot before continuing." },
  { step: 4, action: "Verify checksum", detail: "verifyCustomerBackout(snapshot) confirms the local dataset against the pre-cut-over snapshot." },
];

// ── Part 7 — Exit criteria + final status ─────────────────

export interface CutoverExitCriterion {
  criterion: string;
  measuredBy: string;
}

/** COMPLETE only when all hold (in live staging) with the flag ON. */
export const CUTOVER_EXIT_CRITERIA: ReadonlyArray<CutoverExitCriterion> = [
  { criterion: "Supabase authoritative for reads + writes", measuredBy: "getCustomerCutoverState().authoritative === true" },
  { criterion: "Create / update / archive / reactivate work", measuredBy: "post-cut-over workflow validation" },
  { criterion: "List + Card render from Supabase", measuredBy: "readSource === 'supabase', primary read counters climbing" },
  { criterion: "Company scope + RLS verified", measuredBy: "cross-company read/write blocked under each role" },
  { criterion: "0 critical drift", measuredBy: "shadowReadCustomers / cutover failures === 0 critical" },
  { criterion: "Rollback verified", measuredBy: "flag OFF restores localStorage; checksum matches snapshot" },
  { criterion: "localStorage retained as backout", measuredBy: "WRITE_STRATEGY === B; backout copy kept current" },
];

export type CustomerMigrationStatus = "infrastructure" | "reads-flagged" | "dual-write" | "soak" | "cutover-ready" | "cutover-complete";

export interface CustomerMigrationFinalStatus {
  status: CustomerMigrationStatus;
  summary: string;
  nextEntity: string;
  nextEntityRationale: ReadonlyArray<string>;
}

/**
 * Wave 1F delivers the cut-over MECHANISM behind a default-OFF flag; flipping it
 * to authoritative in production happens only after live staging sign-off. The
 * recommended next entity after Customers is Work Orders (the next-largest
 * boot-time dataset and the Schedule's main dependency), using the exact same
 * wave pattern proven on Customers.
 */
export const CUSTOMER_MIGRATION_FINAL_STATUS: CustomerMigrationFinalStatus = {
  status: "cutover-ready",
  summary:
    "Customers can run Supabase-authoritative behind CUSTOMERS_SUPABASE_AUTHORITATIVE (default OFF). Reads are Supabase-primary with recorded localStorage fallback; writes go localStorage-backout-first then authoritative mirror; a checksummed backout snapshot + single-flag rollback are in place.",
  nextEntity: "Work Orders",
  nextEntityRationale: [
    "Largest remaining boot-time dataset after Customers.",
    "The Schedule resolver depends on Work Orders, so migrating them unblocks the schedule interval query (Wave 2).",
    "Nested service rows / variations / exceptions stay detail-only (jsonb) exactly as Customers' nested data did.",
    "Reuses the validated wave pattern: schema → repository → migration tool → shadow read → read switch → dual write → soak → cut-over.",
  ],
};
