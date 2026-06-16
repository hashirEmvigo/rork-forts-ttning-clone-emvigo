/**
 * Customer staging soak harness (P4I · Wave 1E).
 *
 * The validation step BEFORE Customers become the authoritative source of truth.
 * It exercises the full set of customer workflows repeatedly — create, update
 * (name / contact / address / area / owner), archive, reopen, search, list nav —
 * driving the SAME code paths a staging operator would (localStorage write →
 * background Supabase mirror → shadow-read drift check) and accumulating a
 * structured soak report with a clear cut-over verdict.
 *
 * Guarantees / invariants this harness preserves:
 *   • localStorage stays authoritative — every workflow writes localStorage via
 *     {@link saveCustomers} FIRST; the Supabase mirror is fire-and-forget.
 *   • No source-of-truth switch — this is validation tooling, not a cut-over.
 *   • Company-scoped — every mutation only ever touches the target company's
 *     rows; a scope check asserts this on each write.
 *   • Drift is surfaced, never hidden — periodic {@link shadowReadCustomers}
 *     runs feed the critical-drift counter and notes.
 *   • Rollback is proven — a final drill runs a workflow with the mirror OFF and
 *     confirms localStorage still advances while Supabase is left untouched.
 *
 * It is dev/admin-only and never wired into a production code path.
 */
import { getCustomers, saveCustomers } from "@/lib/store";
import { perf } from "@/lib/perf";
import type { Customer } from "@/types";
import { migrateCustomers } from "./customerMigration";
import {
  mirrorCustomerWrites,
  getCustomerDualWriteState,
  resetCustomerDualWriteState,
} from "./customerDualWrite";
import { shadowReadCustomers } from "./customerMigration";
import { localDataLayer } from "./localStorageAdapters";

/** The customer workflows exercised by the soak. */
export type SoakWorkflow =
  | "create"
  | "updateName"
  | "updateContact"
  | "updateAddress"
  | "updateArea"
  | "updateOwner"
  | "archive"
  | "reopen"
  | "search"
  | "listNav";

/** Rotation of write + read workflows, mirroring real staging usage. */
const WORKFLOW_ORDER: ReadonlyArray<SoakWorkflow> = [
  "create",
  "updateName",
  "updateContact",
  "updateAddress",
  "updateArea",
  "updateOwner",
  "search",
  "archive",
  "listNav",
  "reopen",
];

/** Per-workflow execution counts. */
export type SoakWorkflowCounts = Record<SoakWorkflow, number>;

function emptyCounts(): SoakWorkflowCounts {
  return {
    create: 0,
    updateName: 0,
    updateContact: 0,
    updateAddress: 0,
    updateArea: 0,
    updateOwner: 0,
    archive: 0,
    reopen: 0,
    search: 0,
    listNav: 0,
  };
}

/** A single timing observation pulled from the perf registry after the soak. */
export interface SoakPerfObservation {
  label: string;
  calls: number;
  avgMs: number;
  maxMs: number;
}

/** Options controlling a soak run. */
export interface CustomerSoakOptions {
  /** App-facing company id to exercise (required — scope is always enforced). */
  companyId: string;
  /** Number of workflow iterations to run (default 40). */
  iterations?: number;
  /**
   * Establish baseline parity by migrating the company's existing customers to
   * Supabase before the loop (default true). Without it, pre-existing rows would
   * report as "missing in Supabase" and the shadow read would never be clean.
   */
  seedBaseline?: boolean;
}

/** Structured outcome of a soak run + the cut-over readiness verdict. */
export interface CustomerSoakReport {
  companyId: string;
  /** Total workflow operations executed (reads + writes). */
  operations: number;
  byWorkflow: SoakWorkflowCounts;

  // ── Drift ───────────────────────────────────
  /** Periodic shadow-read passes performed during the soak. */
  shadowRuns: number;
  /** Shadow-read passes that returned full parity. */
  shadowClean: number;
  /** Shadow-read passes that surfaced any mismatch (count / id / field). */
  criticalDrift: number;
  /** Human-readable drift notes — never empty when criticalDrift > 0. */
  driftNotes: string[];

  // ── Dual write ──────────────────────────────
  /** Rows mirrored into Supabase across the soak. */
  mirrored: number;
  /** Field-level post-write mismatches observed by the mirror. */
  mismatches: number;
  /** Mirror runs that failed (Supabase unavailable / error / timeout). */
  writeFailures: number;
  /** Source rows skipped for want of a company mapping. */
  skipped: number;
  lastError: string | null;

  // ── Company scope ───────────────────────────
  /** Write scope assertions performed (one per mutating workflow). */
  scopeChecks: number;
  /** Writes that touched a row outside the target company (must be 0). */
  scopeFailures: number;

  // ── Rollback drill ──────────────────────────
  /** True when the mirror-OFF drill advanced localStorage without touching Supabase. */
  rollbackVerified: boolean;

  // ── Performance ─────────────────────────────
  perf: SoakPerfObservation[];

  // ── Verdict ─────────────────────────────────
  verdict: "READY" | "NOT READY";
  /** Reasons a READY verdict was withheld — empty when READY. */
  blockers: string[];
}

let soakCounter = 0;

/** Builds a fresh, company-scoped customer for the create workflow. */
function buildSoakCustomer(companyId: string): Customer {
  soakCounter += 1;
  const tag = `${Date.now().toString(36)}_${soakCounter}`;
  const now = new Date().toISOString();
  return {
    id: `soak_${companyId}_${tag}`,
    companyId,
    name: `Soak Customer ${soakCounter}`,
    customerNumber: `C-SOAK-${soakCounter}`,
    email: `soak${soakCounter}@example.test`,
    status: "active",
    customerType: "commercial",
    phone: "+46000000000",
    mainContact: "Soak Contact",
    updatedAt: now,
    addresses: [],
    contacts: [],
  } as Customer;
}

/** Applies a mutating workflow to the target customer, returning the new record. */
function mutate(customer: Customer, kind: SoakWorkflow, n: number): Customer {
  const now = new Date().toISOString();
  switch (kind) {
    case "updateName":
      return { ...customer, name: `${customer.name} ·${n}`, updatedAt: now };
    case "updateContact":
      return {
        ...customer,
        mainContact: `Contact ${n}`,
        phone: `+4670${String(n).padStart(7, "0")}`,
        contacts: [
          {
            id: `soak_contact_${n}`,
            name: `Contact ${n}`,
            isPrimary: true,
            isContactPerson: true,
          },
        ],
        updatedAt: now,
      };
    case "updateAddress":
      return {
        ...customer,
        addresses: [
          {
            id: `soak_addr_${n}`,
            label: "Soak office",
            street: `Soak Street ${n}`,
            postalCode: "11122",
            isInvoice: true,
            isDelivery: true,
          },
        ],
        updatedAt: now,
      };
    case "updateArea":
      return { ...customer, areaId: `soak_area_${n % 3}`, updatedAt: now };
    case "updateOwner":
      return { ...customer, ownerId: `soak_owner_${n % 4}`, updatedAt: now };
    case "archive":
      return { ...customer, status: "inactive", updatedAt: now };
    case "reopen":
      return { ...customer, status: "active", updatedAt: now };
    default:
      return customer;
  }
}

const SOAK_PERF_LABELS: ReadonlyArray<string> = [
  "customer.write.local",
  "customer.write.supabase",
  "customer.write.dual",
  "customer.write.validation",
];

function collectPerf(): SoakPerfObservation[] {
  const { timers } = perf.snapshot();
  const out: SoakPerfObservation[] = [];
  for (const label of SOAK_PERF_LABELS) {
    const t = timers[label];
    if (t && t.calls > 0) {
      out.push({ label, calls: t.calls, avgMs: t.avgMs, maxMs: t.maxMs });
    }
  }
  return out;
}

/**
 * Runs a customer soak against a single company.
 *
 * Read-only on business behaviour: it writes to localStorage exactly as the app
 * does, mirrors the writes to the Supabase shadow copy, and never switches the
 * source of truth. Returns a structured report + a cut-over verdict.
 */
export async function runCustomerSoak(
  options: CustomerSoakOptions,
): Promise<CustomerSoakReport> {
  const { companyId } = options;
  const iterations = Math.max(1, options.iterations ?? 40);
  const seedBaseline = options.seedBaseline ?? true;

  resetCustomerDualWriteState();

  const report: CustomerSoakReport = {
    companyId,
    operations: 0,
    byWorkflow: emptyCounts(),
    shadowRuns: 0,
    shadowClean: 0,
    criticalDrift: 0,
    driftNotes: [],
    mirrored: 0,
    mismatches: 0,
    writeFailures: 0,
    skipped: 0,
    lastError: null,
    scopeChecks: 0,
    scopeFailures: 0,
    rollbackVerified: false,
    perf: [],
    verdict: "NOT READY",
    blockers: [],
  };

  // Establish baseline parity so the shadow read can ever be clean.
  if (seedBaseline) {
    const baseline = await migrateCustomers({ companyId });
    if (!baseline.ok && baseline.error) {
      report.lastError = baseline.error;
    }
  }

  // Track a "current" customer for the update/archive/reopen workflows.
  let currentId: string | null =
    getCustomers().find((c) => c.companyId === companyId)?.id ?? null;

  for (let i = 0; i < iterations; i++) {
    const kind = WORKFLOW_ORDER[i % WORKFLOW_ORDER.length];
    report.byWorkflow[kind] += 1;
    report.operations += 1;

    // ── Read-only workflows ──
    if (kind === "search") {
      await localDataLayer.customers.search({ companyId, search: "soak" });
      continue;
    }
    if (kind === "listNav") {
      await localDataLayer.customers.listSummaries({ companyId, page: 1, pageSize: 25 });
      continue;
    }

    // ── Mutating workflows ──
    const prev = getCustomers();
    let next: Customer[];
    let touchedId: string;

    if (kind === "create" || !currentId) {
      const created = buildSoakCustomer(companyId);
      touchedId = created.id;
      currentId = created.id;
      next = [created, ...prev];
    } else {
      const target = prev.find((c) => c.id === currentId);
      if (!target) {
        // The tracked row vanished; fall back to a create next loop.
        currentId = null;
        const created = buildSoakCustomer(companyId);
        touchedId = created.id;
        currentId = created.id;
        next = [created, ...prev];
      } else {
        const updated = mutate(target, kind, i);
        touchedId = updated.id;
        next = prev.map((c) => (c.id === updated.id ? updated : c));
      }
    }

    // localStorage is authoritative — write it first, always.
    saveCustomers(next);

    // Company-scope assertion: the change must stay inside the target company.
    report.scopeChecks += 1;
    const touched = next.find((c) => c.id === touchedId);
    if (!touched || touched.companyId !== companyId) {
      report.scopeFailures += 1;
    }

    // Mirror to Supabase (fire-and-await here so the soak can validate parity).
    const result = await mirrorCustomerWrites(prev, next);
    report.mirrored += result.mirrored;
    report.skipped += result.skipped.length;
    report.mismatches += result.mismatches.length;
    if (result.error) {
      report.writeFailures += 1;
      report.lastError = result.error;
    }

    // Periodic drift check (every 5 mutating ops + on the final iteration).
    if (i % 5 === 0 || i === iterations - 1) {
      const shadow = await shadowReadCustomers(companyId);
      report.shadowRuns += 1;
      if (shadow.ok) {
        report.shadowClean += 1;
      } else {
        report.criticalDrift += 1;
        for (const note of shadow.notes) report.driftNotes.push(`#${i}: ${note}`);
      }
    }
  }

  // ── Rollback drill: mirror OFF, localStorage must still advance ──
  const stateBefore = getCustomerDualWriteState();
  const prevForDrill = getCustomers();
  const drillCustomer = buildSoakCustomer(companyId);
  const nextForDrill = [drillCustomer, ...prevForDrill];
  saveCustomers(nextForDrill); // authoritative write, NO mirror call
  const stateAfter = getCustomerDualWriteState();
  const localAdvanced = getCustomers().some((c) => c.id === drillCustomer.id);
  const supabaseUntouched = stateAfter.runs === stateBefore.runs;
  report.rollbackVerified = localAdvanced && supabaseUntouched;

  // ── Perf + verdict ──
  report.perf = collectPerf();

  if (report.criticalDrift > 0) report.blockers.push(`${report.criticalDrift} shadow-read drift event(s)`);
  if (report.scopeFailures > 0) report.blockers.push(`${report.scopeFailures} company-scope failure(s)`);
  if (report.writeFailures > 0) report.blockers.push(`${report.writeFailures} mirror write failure(s)`);
  if (report.mismatches > 0) report.blockers.push(`${report.mismatches} field-level write mismatch(es)`);
  if (report.skipped > 0) report.blockers.push(`${report.skipped} row(s) skipped (no company mapping)`);
  if (!report.rollbackVerified) report.blockers.push("rollback drill did not confirm localStorage-only mode");
  if (report.operations === 0) report.blockers.push("no operations executed");

  report.verdict = report.blockers.length === 0 ? "READY" : "NOT READY";
  return report;
}

// Expose a console handle in development for manual soak runs.
// Merges with the handles attached in parity.ts / customerMigration.ts / customerDualWrite.ts.
if (import.meta.env.DEV === true && typeof window !== "undefined") {
  const w = window as unknown as { __cleanopsData?: Record<string, unknown> };
  w.__cleanopsData = {
    ...(w.__cleanopsData ?? {}),
    runCustomerSoak,
  };
}
