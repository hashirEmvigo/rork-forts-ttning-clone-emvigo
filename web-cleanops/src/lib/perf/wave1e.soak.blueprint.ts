/**
 * Wave 1E — Customer staging soak validation (P4I). Design-only.
 *
 * Records the soak plan, the staging flag configuration, the monitored signals,
 * and the cut-over readiness criteria for making Customers the authoritative
 * source of truth. Nothing here switches a source of truth, migrates data, or
 * changes behaviour — it documents the validation contract the runnable harness
 * (`src/lib/data/customerSoak.ts` + `customerSoak.test.ts`) proves.
 *
 * localStorage stays authoritative for the whole of Wave 1E. Supabase is the
 * shadow target that reads + dual-write mirror keep in sync; the soak confirms
 * that sync holds under sustained real-world workflows before any cut-over.
 */

// ── Part 1 — Staging flag configuration ───────────────────

export type FlagEnvironment = "staging" | "production";

export interface SoakFlagConfig {
  flag: string;
  env: string;
  staging: "ON" | "OFF";
  production: "ON" | "OFF";
  note: string;
}

/**
 * The three customer flags are enabled in STAGING only for the soak; production
 * stays OFF. Each is independent and instantly reversible (set OFF → localStorage
 * is the sole path again, no data rollback).
 */
export const SOAK_FLAGS: ReadonlyArray<SoakFlagConfig> = [
  {
    flag: "customers_list_supabase_read",
    env: "EXPO_PUBLIC_CUSTOMERS_LIST_SUPABASE_READ",
    staging: "ON",
    production: "OFF",
    note: "Customer LIST reads from Supabase (full records via the repository seam); falls back to localStorage on any error.",
  },
  {
    flag: "customers_detail_supabase_read",
    env: "EXPO_PUBLIC_CUSTOMERS_DETAIL_SUPABASE_READ",
    staging: "ON",
    production: "OFF",
    note: "Customer CARD detail reads from Supabase; falls back to localStorage when a row is missing / errors.",
  },
  {
    flag: "customers_dual_write",
    env: "EXPO_PUBLIC_CUSTOMERS_DUAL_WRITE",
    staging: "ON",
    production: "OFF",
    note: "Customer writes mirror to Supabase after the authoritative localStorage write; failures recorded as drift, never blocking.",
  },
];

// ── Part 2 — Workflows exercised ──────────────────────────

export interface SoakWorkflowSpec {
  workflow: string;
  kind: "read" | "write";
  exercises: string;
}

/**
 * The workflow matrix the soak repeats. Reads validate the list/detail flags;
 * writes validate the dual-write mirror + post-write parity.
 */
export const SOAK_WORKFLOWS: ReadonlyArray<SoakWorkflowSpec> = [
  { workflow: "Customer create", kind: "write", exercises: "create-path mirror; new legacy_id upsert; company mapping." },
  { workflow: "Name update", kind: "write", exercises: "update-path mirror; summary field parity." },
  { workflow: "Contact update", kind: "write", exercises: "mainContact + contacts[] mirror; detail jsonb parity." },
  { workflow: "Address update", kind: "write", exercises: "addresses[] mirror; nested-collection parity." },
  { workflow: "Area change", kind: "write", exercises: "areaId mirror; flat column parity." },
  { workflow: "Owner change", kind: "write", exercises: "ownerId mirror; flat column parity." },
  { workflow: "Archive", kind: "write", exercises: "status → inactive mirror; status parity." },
  { workflow: "Reopen / reactivate", kind: "write", exercises: "status → active mirror; idempotent re-upsert." },
  { workflow: "Search", kind: "read", exercises: "identifier/name threshold search through the repository." },
  { workflow: "List navigation", kind: "read", exercises: "paged company-scoped list reads." },
];

// ── Part 3 — Monitored signals ────────────────────────────

export type SoakSignalSeverity = "critical" | "high" | "medium" | "low";

export interface SoakSignal {
  signal: string;
  source: string;
  severity: SoakSignalSeverity;
  note: string;
}

/** Drift, failure and performance signals tracked across the soak. */
export const SOAK_SIGNALS: ReadonlyArray<SoakSignal> = [
  { signal: "Shadow-read drift (count / id / summary / detail)", source: "shadowReadCustomers / shadowReadCustomerDetail", severity: "critical", note: "Any mismatch withholds READY." },
  { signal: "Post-write field mismatch", source: "mirrorCustomerWrites validation", severity: "critical", note: "legacy_id / company / number / status / updated_at compared after each mirror." },
  { signal: "Company-scope leak", source: "soak scope assertion", severity: "critical", note: "A mutation touching another company's row fails the soak immediately." },
  { signal: "Mirror write failure / timeout", source: "CustomerDualWriteState.failures", severity: "high", note: "localStorage still succeeds; recorded as drift, counts toward blockers." },
  { signal: "Rows skipped (no company mapping)", source: "CustomerDualWriteState.skipped", severity: "high", note: "Indicates companies must be migrated first." },
  { signal: "Write latency (local / supabase / dual / validation)", source: "perf timers customer.write.*", severity: "low", note: "Measurement only — no optimization in this phase." },
];

// ── Part 4 — Cut-over readiness criteria ──────────────────

export interface CutoverCriterion {
  criterion: string;
  required: string;
  measuredBy: string;
}

/**
 * A READY verdict for "Customers Supabase Source of Truth" requires ALL of these.
 * The runnable soak (`runCustomerSoak`) computes the same verdict from live data.
 */
export const CUTOVER_CRITERIA: ReadonlyArray<CutoverCriterion> = [
  { criterion: "Zero critical drift", required: "0 shadow-read drift events", measuredBy: "report.criticalDrift === 0" },
  { criterion: "Zero company-scope failures", required: "0 cross-company writes/reads", measuredBy: "report.scopeFailures === 0" },
  { criterion: "Zero write failures", required: "0 mirror failures", measuredBy: "report.writeFailures === 0" },
  { criterion: "Zero field mismatches", required: "0 post-write mismatches", measuredBy: "report.mismatches === 0" },
  { criterion: "No unmapped rows", required: "0 skipped rows", measuredBy: "report.skipped === 0" },
  { criterion: "Rollback proven", required: "mirror OFF → localStorage advances, Supabase untouched", measuredBy: "report.rollbackVerified === true" },
  { criterion: "Sustained operations", required: "≥ 40 mixed workflow operations", measuredBy: "report.operations" },
];

// ── Part 5 — Verdict ──────────────────────────────────────

export type SoakVerdict = "READY" | "NOT READY" | "PENDING SOAK";

export interface SoakReadiness {
  target: string;
  verdict: SoakVerdict;
  rationale: ReadonlyArray<string>;
  remainingBlockers: ReadonlyArray<string>;
  /** The next phase this readiness feeds, once approved. */
  nextPhase: string;
}

/**
 * The automated soak (`customerSoak.test.ts`) runs a 40-iteration mixed-workflow
 * soak against the seeded `cmp_nordlys` company and asserts a READY verdict:
 * 0 drift, 0 scope failures, 0 mirror failures, 0 mismatches, rollback proven.
 * The live staging soak must reproduce this against real usage before approval.
 */
export const SOAK_READINESS: SoakReadiness = {
  target: "Customers · Supabase source of truth",
  verdict: "READY",
  rationale: [
    "Automated soak completes 40 mixed read+write workflows with 0 critical drift across periodic shadow reads.",
    "Every mutation is company-scoped; the scope assertion finds 0 cross-company leaks.",
    "The dual-write mirror records 0 failures and 0 post-write field mismatches once companies are mapped.",
    "The rollback drill confirms a mirror-OFF write still advances localStorage while Supabase is left untouched — rollback is instant and data-free.",
  ],
  remainingBlockers: [
    "Live staging soak duration must accrue real operator hours/operations (the automated run proves the mechanism, not production volume).",
    "DB-level RLS (migration 0007) to be confirmed once against the live project under each role (normal vs super_admin).",
  ],
  nextPhase:
    "Wave 1F — Customer source-of-truth cut-over: make Supabase authoritative for reads, retire the dual-write mirror's localStorage-first ordering, keep an export/backout window. Begin only after staging soak sign-off.",
};
