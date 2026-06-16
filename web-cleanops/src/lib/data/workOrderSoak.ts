/**
 * Work Order staging soak harness (P5H · WO-5.5).
 *
 * The validation step BEFORE Work Orders become the authoritative source of
 * truth (WO-6). The direct analogue of {@link import("./customerSoak")}, scaled
 * up for the far more complex Work Order aggregate: a parent work order, its
 * nested service rows, EMBEDDED variations, and the SEPARATE occurrence-exception
 * store — all of which drive the Schedule resolver.
 *
 * It exercises the full set of real work-order workflows repeatedly — create,
 * header update, add/edit/archive service row, recurrence + planned-time change,
 * staffing, variation, archive/reactivate, plus the separate
 * reschedule/cancel/restore occurrence-exception path — driving the SAME code
 * seams a staging operator would:
 *
 *   localStorage write (authoritative) → background Supabase mirror → shadow-read
 *   drift check → schedule-dependency dry-run.
 *
 * Guarantees / invariants this harness preserves:
 *   • localStorage stays authoritative — every workflow writes localStorage via
 *     {@link saveWorkOrders} / {@link saveBookingOccurrenceExceptions} FIRST; the
 *     Supabase mirror is fire-and-forget.
 *   • No source-of-truth switch — this is validation tooling, not a cut-over.
 *   • Schedule untouched — the resolver, recurrence, variation and exception
 *     LOGIC are never modified; the soak only validates that the Supabase
 *     representation reproduces the resolver's output for the same interval.
 *   • Company-scoped — every mutation only touches the target company's rows; a
 *     scope check asserts this on each write.
 *   • Drift is surfaced, never hidden — periodic {@link shadowReadWorkOrders} and
 *     {@link validateWorkOrderScheduleDependency} runs feed the critical-drift +
 *     schedule-mismatch counters.
 *   • Rollback is proven — a final drill runs a workflow with the mirror OFF and
 *     confirms localStorage still advances while Supabase is left untouched.
 *
 * It is dev/admin-only and never wired into a production code path.
 */
import {
  getWorkOrders,
  saveWorkOrders,
  getBookingOccurrenceExceptions,
  saveBookingOccurrenceExceptions,
} from "@/lib/store";
import { perf } from "@/lib/perf";
import type { WorkOrder, WorkOrderServiceRow, BookingOccurrenceException } from "@/types";
import { migrateWorkOrders, shadowReadWorkOrders } from "./workOrderMigration";
import {
  mirrorWorkOrderWrites,
  mirrorWorkOrderExceptionWrites,
  getWorkOrderDualWriteState,
  resetWorkOrderDualWriteState,
} from "./workOrderDualWrite";
import { validateWorkOrderScheduleDependency } from "./workOrderScheduleValidation";
import { localDataLayer } from "./localStorageAdapters";

/** The work-order workflows exercised by the soak. */
export type WorkOrderSoakWorkflow =
  | "create"
  | "updateHeader"
  | "addServiceRow"
  | "editServiceRow"
  | "changeRecurrence"
  | "changePlannedTime"
  | "assignEmployee"
  | "addVariation"
  | "archive"
  | "reactivate"
  | "rescheduleOccurrence"
  | "cancelOccurrence"
  | "restoreOccurrence"
  | "search"
  | "listNav"
  | "openDetail"
  | "openSchedule";

/** Rotation of write + read workflows, mirroring real staging usage. */
const WORKFLOW_ORDER: ReadonlyArray<WorkOrderSoakWorkflow> = [
  "create",
  "updateHeader",
  "addServiceRow",
  "editServiceRow",
  "changeRecurrence",
  "search",
  "changePlannedTime",
  "assignEmployee",
  "addVariation",
  "listNav",
  "rescheduleOccurrence",
  "openDetail",
  "cancelOccurrence",
  "archive",
  "openSchedule",
  "reactivate",
  "restoreOccurrence",
];

/** Per-workflow execution counts. */
export type WorkOrderSoakWorkflowCounts = Record<WorkOrderSoakWorkflow, number>;

function emptyCounts(): WorkOrderSoakWorkflowCounts {
  return {
    create: 0,
    updateHeader: 0,
    addServiceRow: 0,
    editServiceRow: 0,
    changeRecurrence: 0,
    changePlannedTime: 0,
    assignEmployee: 0,
    addVariation: 0,
    archive: 0,
    reactivate: 0,
    rescheduleOccurrence: 0,
    cancelOccurrence: 0,
    restoreOccurrence: 0,
    search: 0,
    listNav: 0,
    openDetail: 0,
    openSchedule: 0,
  };
}

/** A single timing observation pulled from the perf registry after the soak. */
export interface WorkOrderSoakPerfObservation {
  label: string;
  calls: number;
  avgMs: number;
  maxMs: number;
}

/** Options controlling a soak run. */
export interface WorkOrderSoakOptions {
  /** App-facing company id to exercise (required — scope is always enforced). */
  companyId: string;
  /** Number of workflow iterations to run (default 40). */
  iterations?: number;
  /**
   * Establish baseline parity by migrating the company's existing work orders to
   * Supabase before the loop (default true). Without it, pre-existing rows would
   * report as "missing in Supabase" and the shadow read would never be clean.
   */
  seedBaseline?: boolean;
}

/** Structured outcome of a soak run + the cut-over readiness verdict. */
export interface WorkOrderSoakReport {
  companyId: string;
  /** Total workflow operations executed (reads + writes). */
  operations: number;
  byWorkflow: WorkOrderSoakWorkflowCounts;

  // ── Drift (shadow read) ─────────────────────
  /** Periodic shadow-read passes performed during the soak. */
  shadowRuns: number;
  /** Shadow-read passes that returned full parity. */
  shadowClean: number;
  /** Shadow-read passes that surfaced any mismatch (count / id / summary / rows / exceptions). */
  criticalDrift: number;
  /** Human-readable drift notes — never empty when criticalDrift > 0. */
  driftNotes: string[];

  // ── Schedule dependency ─────────────────────
  /** Schedule dependency validation passes performed. */
  scheduleRuns: number;
  /** Schedule passes where local == Supabase-reconstructed (counts + keys + fields). */
  scheduleClean: number;
  /** Schedule passes that surfaced any occurrence divergence (must be 0 for READY). */
  scheduleMismatches: number;
  /** Human-readable schedule notes — never empty when scheduleMismatches > 0. */
  scheduleNotes: string[];

  // ── Dual write ──────────────────────────────
  /** Parent work-order rows mirrored into Supabase across the soak. */
  parentsMirrored: number;
  /** Service rows mirrored into Supabase across the soak. */
  serviceRowsMirrored: number;
  /** Occurrence exceptions mirrored into Supabase across the soak. */
  exceptionsMirrored: number;
  /** Field-level post-write mismatches observed by the mirror. */
  mismatches: number;
  /** Mirror runs that failed (Supabase unavailable / error / timeout). */
  writeFailures: number;
  /** Source rows skipped for want of a company mapping (or missing parent row). */
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
  perf: WorkOrderSoakPerfObservation[];

  // ── Verdict ─────────────────────────────────
  verdict: "READY" | "NOT READY";
  /** Reasons a READY verdict was withheld — empty when READY. */
  blockers: string[];
}

let soakCounter = 0;

/** Formats a Date as a date-only "YYYY-MM-DD" string. */
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** The soak operates over a fixed near-future window so its rows are schedulable. */
function soakWindow(): { fromDate: string; toDate: string; serviceDate: string } {
  const now = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - 1);
  const service = new Date(now);
  service.setDate(service.getDate() + 3);
  const to = new Date(now);
  to.setDate(to.getDate() + 35);
  return { fromDate: isoDate(from), toDate: isoDate(to), serviceDate: isoDate(service) };
}

/** Builds a fresh, company-scoped work order (with one live recurring row). */
function buildSoakWorkOrder(companyId: string, customerId: string): WorkOrder {
  soakCounter += 1;
  const tag = `${Date.now().toString(36)}_${soakCounter}`;
  const now = new Date().toISOString();
  const { serviceDate } = soakWindow();
  const rowId = `soak_row_${companyId}_${tag}`;
  const row: WorkOrderServiceRow = {
    id: rowId,
    serviceName: `Soak Service ${soakCounter}`,
    quantity: 1,
    status: "planned",
    serviceDate,
    recurrenceInterval: "weekly",
    plannedStartTime: "08:00",
    plannedEndTime: "10:00",
    assignedEmployeeIds: [],
    unassignedEmployeeSlots: 1,
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
  };
  return {
    id: `soak_wo_${companyId}_${tag}`,
    companyId,
    customerId,
    number: `WO-SOAK-${soakCounter}`,
    title: `Soak Work Order ${soakCounter}`,
    status: "planned",
    serviceRows: [row],
    createdAt: now,
    updatedAt: now,
  };
}

/** Applies a mutating WORK-ORDER workflow, returning the new record. */
function mutateWorkOrder(order: WorkOrder, kind: WorkOrderSoakWorkflow, n: number): WorkOrder {
  const now = new Date().toISOString();
  const rows = [...(order.serviceRows ?? [])];
  const first = rows[0];

  switch (kind) {
    case "updateHeader":
      return { ...order, title: `${order.title ?? "Soak"} ·${n}`, updatedAt: now };
    case "addServiceRow": {
      const { serviceDate } = soakWindow();
      const newRow: WorkOrderServiceRow = {
        id: `soak_row_${order.id}_${n}`,
        serviceName: `Extra Service ${n}`,
        quantity: 1,
        status: "planned",
        serviceDate,
        recurrenceInterval: "every_2_weeks",
        plannedStartTime: "12:00",
        plannedEndTime: "13:30",
        assignedEmployeeIds: [],
        unassignedEmployeeSlots: 0,
        sortOrder: rows.length,
        createdAt: now,
        updatedAt: now,
      };
      return { ...order, serviceRows: [...rows, newRow], updatedAt: now };
    }
    case "editServiceRow":
      if (!first) return order;
      rows[0] = { ...first, serviceName: `${first.serviceName} (rev ${n})` };
      return { ...order, serviceRows: rows, updatedAt: now };
    case "changeRecurrence":
      if (!first) return order;
      rows[0] = {
        ...first,
        recurrenceInterval: n % 2 === 0 ? "weekly" : "every_2_weeks",
      };
      return { ...order, serviceRows: rows, updatedAt: now };
    case "changePlannedTime":
      if (!first) return order;
      rows[0] = {
        ...first,
        plannedStartTime: `0${(n % 6) + 6}:00`.slice(-5),
        plannedEndTime: `1${(n % 4) + 2}:00`.slice(-5),
      };
      return { ...order, serviceRows: rows, updatedAt: now };
    case "assignEmployee":
      if (!first) return order;
      rows[0] = {
        ...first,
        assignedEmployeeIds: [`soak_emp_${n % 3}`],
        unassignedEmployeeSlots: 0,
      };
      return { ...order, serviceRows: rows, updatedAt: now };
    case "addVariation":
      if (!first) return order;
      rows[0] = {
        ...first,
        variations: [
          ...(first.variations ?? []),
          {
            id: `soak_var_${first.id}_${n}`,
            name: `Soak Variation ${n}`,
            frequency: "every_n_weeks",
            interval: 4,
            startTime: "09:00",
            endTime: "11:00",
            assignedEmployeeIds: [`soak_emp_${n % 2}`],
            status: "active",
            appliesFrom: soakWindow().serviceDate,
            enabled: true,
            createdAt: now,
            updatedAt: now,
          },
        ],
      };
      return { ...order, serviceRows: rows, updatedAt: now };
    case "archive":
      return { ...order, status: "inactive", updatedAt: now };
    case "reactivate":
      return { ...order, status: "planned", updatedAt: now };
    default:
      return order;
  }
}

const SOAK_PERF_LABELS: ReadonlyArray<string> = [
  "workOrders.write.supabase",
  "workOrders.write.dual",
  "workOrders.write.validation",
  "workOrders.schedule.reconstruct",
  "workOrders.schedule.dryRun",
];

function collectPerf(): WorkOrderSoakPerfObservation[] {
  const { timers } = perf.snapshot();
  const out: WorkOrderSoakPerfObservation[] = [];
  for (const label of SOAK_PERF_LABELS) {
    const t = timers[label];
    if (t && t.calls > 0) {
      out.push({ label, calls: t.calls, avgMs: t.avgMs, maxMs: t.maxMs });
    }
  }
  return out;
}

/** Mirrors a work-order write and folds its result into the report. */
async function mirrorAndRecord(
  prev: WorkOrder[],
  next: WorkOrder[],
  report: WorkOrderSoakReport,
): Promise<void> {
  const result = await mirrorWorkOrderWrites(prev, next);
  report.parentsMirrored += result.mirroredWorkOrders;
  report.serviceRowsMirrored += result.mirroredServiceRows;
  report.skipped += result.skipped.length;
  report.mismatches += result.mismatches.length;
  if (result.error) {
    report.writeFailures += 1;
    report.lastError = result.error;
  }
}

/**
 * Runs a work-order soak against a single company.
 *
 * Read-only on business behaviour: it writes to localStorage exactly as the app
 * does (parent work orders + the separate occurrence-exception store), mirrors
 * the writes to the Supabase shadow copy, validates schedule parity, and never
 * switches the source of truth. Returns a structured report + a cut-over verdict.
 */
export async function runWorkOrderSoak(
  options: WorkOrderSoakOptions,
): Promise<WorkOrderSoakReport> {
  const { companyId } = options;
  const iterations = Math.max(1, options.iterations ?? 40);
  const seedBaseline = options.seedBaseline ?? true;
  const window = soakWindow();

  resetWorkOrderDualWriteState();

  const report: WorkOrderSoakReport = {
    companyId,
    operations: 0,
    byWorkflow: emptyCounts(),
    shadowRuns: 0,
    shadowClean: 0,
    criticalDrift: 0,
    driftNotes: [],
    scheduleRuns: 0,
    scheduleClean: 0,
    scheduleMismatches: 0,
    scheduleNotes: [],
    parentsMirrored: 0,
    serviceRowsMirrored: 0,
    exceptionsMirrored: 0,
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
    const baseline = await migrateWorkOrders({ companyId });
    if (!baseline.ok && baseline.error) {
      report.lastError = baseline.error;
    }
  }

  // A representative customer id from the company's existing work orders (so the
  // schedule resolver can render names); falls back to a synthetic id (parity
  // still holds — both sides use the same customer lookup).
  const seedOrder = getWorkOrders().find((w) => w.companyId === companyId);
  const customerId = seedOrder?.customerId ?? `soak_customer_${companyId}`;

  // Track a "current" work order + service row for the update workflows.
  let currentId: string | null = seedOrder?.id ?? null;

  /** Resolves the live current order from the latest localStorage snapshot. */
  function currentOrder(orders: WorkOrder[]): WorkOrder | undefined {
    return currentId ? orders.find((w) => w.id === currentId) : undefined;
  }

  /** Resolves a schedulable service row of the current order to overlay. */
  function currentRow(order: WorkOrder | undefined): WorkOrderServiceRow | undefined {
    return order?.serviceRows?.[0];
  }

  for (let i = 0; i < iterations; i++) {
    const kind = WORKFLOW_ORDER[i % WORKFLOW_ORDER.length];
    report.byWorkflow[kind] += 1;
    report.operations += 1;

    // ── Read-only workflows ──
    if (kind === "search") {
      await localDataLayer.workOrders.search({ companyId, search: "soak" });
      continue;
    }
    if (kind === "listNav") {
      await localDataLayer.workOrders.listSummaries({ companyId, page: 1, pageSize: 25 });
      continue;
    }
    if (kind === "openDetail") {
      if (currentId) await localDataLayer.workOrders.getDetail(currentId, { companyId });
      continue;
    }
    if (kind === "openSchedule") {
      const schedule = await validateWorkOrderScheduleDependency({
        companyId,
        fromDate: window.fromDate,
        toDate: window.toDate,
      });
      report.scheduleRuns += 1;
      if (schedule.ok) {
        report.scheduleClean += 1;
      } else {
        report.scheduleMismatches += 1;
        if (!schedule.serviceRows.ok) report.scheduleNotes.push(`#${i}: service-row parity`);
        if (!schedule.variations.ok) report.scheduleNotes.push(`#${i}: variation parity`);
        if (!schedule.exceptions.ok) report.scheduleNotes.push(`#${i}: exception parity`);
        for (const note of schedule.interval.notes) report.scheduleNotes.push(`#${i}: ${note}`);
      }
      continue;
    }

    // ── Occurrence-exception workflows (separate store) ──
    if (
      kind === "rescheduleOccurrence" ||
      kind === "cancelOccurrence" ||
      kind === "restoreOccurrence"
    ) {
      const order = currentOrder(getWorkOrders());
      const row = currentRow(order);
      if (!order || !row) continue;

      const occurrenceDate = window.serviceDate;
      const occurrenceKey = `${row.id}:${occurrenceDate}`;
      const prevExceptions = getBookingOccurrenceExceptions();
      const now = new Date().toISOString();
      const existing = prevExceptions.find((e) => e.occurrenceKey === occurrenceKey);

      const base: BookingOccurrenceException = existing ?? {
        id: `soak_exc_${row.id}_${i}`,
        occurrenceKey,
        parentServiceRowId: row.id,
        occurrenceDate,
        status: "active",
        createdAt: now,
        updatedAt: now,
      };
      // Restore is represented as an active-status overlay UPDATE (clearing the
      // overrides), not a hard removal: WO-5 dual write intentionally mirrors
      // created/updated rows only — hard delete is out of scope — so an active
      // overlay (a scheduling no-op, identical to following the rule) keeps the
      // mirror faithful and drift-free.
      const updated: BookingOccurrenceException =
        kind === "rescheduleOccurrence"
          ? {
              ...base,
              status: "rescheduled",
              overrideOccurrenceDate: window.serviceDate,
              overrideStartTime: "14:00",
              overrideEndTime: "15:30",
              updatedAt: now,
            }
          : kind === "cancelOccurrence"
            ? {
                ...base,
                status: "cancelled",
                overrideOccurrenceDate: null,
                overrideStartTime: null,
                overrideEndTime: null,
                updatedAt: now,
              }
            : {
                ...base,
                status: "active",
                overrideOccurrenceDate: null,
                overrideStartTime: null,
                overrideEndTime: null,
                updatedAt: now,
              };
      const nextExceptions: BookingOccurrenceException[] = existing
        ? prevExceptions.map((e) => (e.occurrenceKey === occurrenceKey ? updated : e))
        : [updated, ...prevExceptions];

      // localStorage authoritative — write first, then mirror.
      saveBookingOccurrenceExceptions(nextExceptions);

      // Scope assertion: the overlaid occurrence's parent row must belong to the
      // target company's current order (which is company-scoped by construction).
      report.scopeChecks += 1;
      if (order.companyId !== companyId) report.scopeFailures += 1;

      const result = await mirrorWorkOrderExceptionWrites(prevExceptions, nextExceptions);
      report.exceptionsMirrored += result.mirroredExceptions;
      report.skipped += result.skipped.length;
      if (result.error) {
        report.writeFailures += 1;
        report.lastError = result.error;
      }
      continue;
    }

    // ── Mutating work-order workflows ──
    const prev = getWorkOrders();
    let next: WorkOrder[];
    let touchedId: string;

    if (kind === "create" || !currentId) {
      const created = buildSoakWorkOrder(companyId, customerId);
      touchedId = created.id;
      currentId = created.id;
      next = [created, ...prev];
    } else {
      const target = prev.find((w) => w.id === currentId);
      if (!target) {
        currentId = null;
        const created = buildSoakWorkOrder(companyId, customerId);
        touchedId = created.id;
        currentId = created.id;
        next = [created, ...prev];
      } else {
        const updated = mutateWorkOrder(target, kind, i);
        touchedId = updated.id;
        next = prev.map((w) => (w.id === updated.id ? updated : w));
      }
    }

    // localStorage is authoritative — write it first, always.
    saveWorkOrders(next);

    // Company-scope assertion: the change must stay inside the target company.
    report.scopeChecks += 1;
    const touched = next.find((w) => w.id === touchedId);
    if (!touched || touched.companyId !== companyId) {
      report.scopeFailures += 1;
    }

    // Mirror to Supabase (awaited here so the soak can validate parity).
    await mirrorAndRecord(prev, next, report);

    // Periodic drift check (every 5 mutating ops + on the final iteration).
    if (i % 5 === 0 || i === iterations - 1) {
      const shadow = await shadowReadWorkOrders(companyId);
      report.shadowRuns += 1;
      if (shadow.ok) {
        report.shadowClean += 1;
      } else {
        report.criticalDrift += 1;
        for (const note of shadow.notes) report.driftNotes.push(`#${i}: ${note}`);
      }
    }
  }

  // ── Final schedule safety check over the whole window ──
  const finalSchedule = await validateWorkOrderScheduleDependency({
    companyId,
    fromDate: window.fromDate,
    toDate: window.toDate,
  });
  report.scheduleRuns += 1;
  if (finalSchedule.ok) {
    report.scheduleClean += 1;
  } else {
    report.scheduleMismatches += 1;
    if (!finalSchedule.serviceRows.ok) report.scheduleNotes.push("final: service-row parity");
    if (!finalSchedule.variations.ok) report.scheduleNotes.push("final: variation parity");
    if (!finalSchedule.exceptions.ok) report.scheduleNotes.push("final: exception parity");
    for (const note of finalSchedule.interval.notes) report.scheduleNotes.push(`final: ${note}`);
  }

  // ── Rollback drill: mirror OFF, localStorage must still advance ──
  const stateBefore = getWorkOrderDualWriteState();
  const prevForDrill = getWorkOrders();
  const drillOrder = buildSoakWorkOrder(companyId, customerId);
  const nextForDrill = [drillOrder, ...prevForDrill];
  saveWorkOrders(nextForDrill); // authoritative write, NO mirror call
  const stateAfter = getWorkOrderDualWriteState();
  const localAdvanced = getWorkOrders().some((w) => w.id === drillOrder.id);
  const supabaseUntouched = stateAfter.runs === stateBefore.runs;
  report.rollbackVerified = localAdvanced && supabaseUntouched;

  // ── Perf + verdict ──
  report.perf = collectPerf();

  if (report.criticalDrift > 0) report.blockers.push(`${report.criticalDrift} shadow-read drift event(s)`);
  if (report.scheduleMismatches > 0) report.blockers.push(`${report.scheduleMismatches} schedule-dependency mismatch(es)`);
  if (report.scopeFailures > 0) report.blockers.push(`${report.scopeFailures} company-scope failure(s)`);
  if (report.writeFailures > 0) report.blockers.push(`${report.writeFailures} mirror write failure(s)`);
  if (report.mismatches > 0) report.blockers.push(`${report.mismatches} field-level write mismatch(es)`);
  if (report.skipped > 0) report.blockers.push(`${report.skipped} row(s) skipped (no company mapping)`);
  if (!report.rollbackVerified) report.blockers.push("rollback drill did not confirm localStorage-only mode");
  if (report.operations === 0) report.blockers.push("no operations executed");

  report.verdict = report.blockers.length === 0 ? "READY" : "NOT READY";
  return report;
}

// Expose a console handle in development for manual soak runs. Merges with the
// handles attached in the other data modules.
if (import.meta.env.DEV === true && typeof window !== "undefined") {
  const w = window as unknown as { __cleanopsData?: Record<string, unknown> };
  w.__cleanopsData = {
    ...(w.__cleanopsData ?? {}),
    runWorkOrderSoak,
  };
}
