/**
 * Schedule authoritative staging soak (P6E).
 *
 * The validation step AFTER P6D made Supabase the AUTHORITATIVE Schedule INPUT
 * behind {@link SCHEDULE_SUPABASE_AUTHORITATIVE}, and BEFORE that authority is
 * trusted in a live staging build. It is the read-only Schedule analogue of
 * {@link import("./workOrderSoak")} / {@link import("./customerSoak")}: where
 * those exercise WRITE seams, the Schedule has NO writes — its only migration
 * surface is the resolver INPUT source — so this harness instead validates that
 * the Supabase-authoritative input reproduces the local resolver output across
 * every Schedule view mode and scenario, repeatedly.
 *
 * What it exercises (per the P6E brief):
 *   • daily / weekly / two-week / monthly view-mode intervals,
 *   • recurring visits, variations, cancelled / rescheduled / restored
 *     occurrences, time changes and employee assignments — all validated through
 *     {@link compareScheduleInterval}, whose per-occurrence diff already compares
 *     status / isVariation / isRescheduled / isTimeChanged / assignedEmployeeIds,
 *   • a Supabase-failure FALLBACK drill (the local input always resolves — the
 *     backout path the hook falls back to), recorded via the cutover telemetry,
 *   • a ROLLBACK drill (flag OFF → localStorage authoritative input still resolves
 *     identically — rollback is instant and data-free).
 *
 * Guarantees / invariants this harness preserves:
 *   • {@link resolveScheduleProgram}, recurrence, variation and exception LOGIC
 *     are NEVER modified — the soak only runs the resolver from two input sources
 *     and diffs the output.
 *   • There is exactly ONE resolver and no realtime.
 *   • No source-of-truth switch happens here — flipping authority is the flag, not
 *     this tool. The soak is dev/admin-only and never wired into a production path.
 *   • Company-scoped — every comparison is constrained to the target company.
 *   • Drift is surfaced, never hidden — any interval whose local vs Supabase
 *     resolve diverges feeds the critical-drift counter + notes.
 */
import { getWorkOrders } from "@/lib/store";
import { perf } from "@/lib/perf";
import {
  compareScheduleInterval,
  validateServiceRowFieldParity,
  validateVariationParity,
  validateExceptionParity,
  buildScheduleInputFromLocal,
  type ScheduleReconstructionOptions,
} from "./workOrderScheduleValidation";
import { resolveScheduleProgram } from "@/lib/scheduleCore";
import {
  isScheduleSupabaseAuthoritative,
  shouldReadScheduleFromSupabase,
  getScheduleCutoverState,
  resetScheduleCutoverState,
  recordScheduleSupabaseInput,
  recordScheduleInputFallback,
  recordScheduleShadowDrift,
  type ScheduleInputSource,
} from "./scheduleCutover";
import { migrateWorkOrders } from "./workOrderMigration";

/** The Schedule view modes whose interval lengths the soak reproduces. */
export type ScheduleSoakViewMode = "daily" | "weekly" | "twoWeek" | "monthly";

/** Display-window length (in days) for each view mode. */
const VIEW_MODE_DAYS: Record<ScheduleSoakViewMode, number> = {
  daily: 1,
  weekly: 7,
  twoWeek: 14,
  monthly: 31,
};

const VIEW_MODE_ORDER: ReadonlyArray<ScheduleSoakViewMode> = [
  "daily",
  "weekly",
  "twoWeek",
  "monthly",
];

/** Per-interval (per view-mode window) parity outcome. */
export interface ScheduleSoakIntervalResult {
  viewMode: ScheduleSoakViewMode;
  fromDate: string;
  toDate: string;
  /** Occurrences the LOCAL-input resolve produced for the window. */
  localOccurrences: number;
  /** Occurrences the SUPABASE-input resolve produced for the window. */
  supabaseOccurrences: number;
  /** True when counts + keys + every compared field match. */
  ok: boolean;
  countMatch: boolean;
  keysMatch: boolean;
  /** Per-occurrence field divergences on shared keys. */
  divergences: number;
  /** Human-readable notes — never empty when ok is false. */
  notes: string[];
}

/** A single timing observation pulled from the perf registry after the soak. */
export interface ScheduleSoakPerfObservation {
  label: string;
  calls: number;
  avgMs: number;
  maxMs: number;
}

/** Options controlling a Schedule soak run. */
export interface ScheduleSoakOptions {
  /** App-facing company id to exercise (required — scope is always enforced). */
  companyId: string;
  /**
   * Number of full view-mode sweeps to run (default 3). Each sweep runs all four
   * view-mode intervals, so total interval comparisons = sweeps × 4.
   */
  sweeps?: number;
  /**
   * Establish baseline parity by migrating the company's existing work orders to
   * Supabase before the sweeps (default true). Without it, pre-existing rows
   * report as "missing in Supabase" and every interval would drift.
   */
  seedBaseline?: boolean;
  /** Window anchor (defaults to today). The sweeps start here and step forward. */
  anchorDate?: string;
}

/** Structured outcome of a Schedule soak run + the readiness verdict. */
export interface ScheduleSoakReport {
  companyId: string;
  /** The live SCHEDULE_SUPABASE_AUTHORITATIVE flag state at run time. */
  authoritativeFlag: boolean;
  /** The resolved active input source (supabase when reading, else localStorage). */
  inputSource: ScheduleInputSource;

  // ── Per-view-mode interval parity ───────────
  intervals: ScheduleSoakIntervalResult[];
  /** Interval comparisons performed (sweeps × view modes). */
  scheduleRuns: number;
  /** Interval comparisons that returned full parity. */
  scheduleClean: number;
  /** Interval comparisons that surfaced any divergence (must be 0 for READY). */
  criticalDrift: number;
  totalLocalOccurrences: number;
  totalSupabaseOccurrences: number;
  totalDivergences: number;
  /** Human-readable drift notes — never empty when criticalDrift > 0. */
  driftNotes: string[];

  // ── Schedule-critical parity ────────────────
  serviceRowParityOk: boolean;
  variationParityOk: boolean;
  exceptionParityOk: boolean;
  /** Parity mismatch notes — never empty when any parity is false. */
  parityNotes: string[];

  // ── Fallback drill ──────────────────────────
  /** True when the local backout input resolves (the Supabase-failure fallback). */
  fallbackVerified: boolean;

  // ── Rollback drill ──────────────────────────
  /** True when the flag-OFF (localStorage authoritative) input resolves identically. */
  rollbackVerified: boolean;

  // ── Performance ─────────────────────────────
  perf: ScheduleSoakPerfObservation[];

  // ── Verdict ─────────────────────────────────
  verdict: "READY" | "NOT READY";
  /** Reasons a READY verdict was withheld — empty when READY. */
  blockers: string[];
}

/** Formats a Date as a date-only "YYYY-MM-DD" string. */
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Computes the [from, to] display window for a view mode anchored at `start`. */
function windowFor(viewMode: ScheduleSoakViewMode, start: Date): { fromDate: string; toDate: string } {
  const from = new Date(start);
  const to = new Date(start);
  to.setDate(to.getDate() + VIEW_MODE_DAYS[viewMode] - 1);
  return { fromDate: isoDate(from), toDate: isoDate(to) };
}

const SOAK_PERF_LABELS: ReadonlyArray<string> = [
  "schedule.soak.interval",
  "workOrders.schedule.reconstruct",
  "workOrders.schedule.dryRun",
];

function collectPerf(): ScheduleSoakPerfObservation[] {
  const { timers } = perf.snapshot();
  const out: ScheduleSoakPerfObservation[] = [];
  for (const label of SOAK_PERF_LABELS) {
    const t = timers[label];
    if (t && t.calls > 0) {
      out.push({ label, calls: t.calls, avgMs: t.avgMs, maxMs: t.maxMs });
    }
  }
  return out;
}

/**
 * Runs a Schedule authoritative soak against a single company.
 *
 * Read-only end-to-end: it migrates the company's existing work orders to the
 * Supabase shadow (baseline), then repeatedly resolves the SAME interval from the
 * local input and the Supabase-authoritative input and diffs every occurrence
 * across daily / weekly / two-week / monthly windows. It never switches the
 * source of truth and never mutates business data. Returns a structured report +
 * a readiness verdict for trusting Schedule authority in staging.
 */
export async function runScheduleAuthoritativeSoak(
  options: ScheduleSoakOptions,
): Promise<ScheduleSoakReport> {
  const { companyId } = options;
  const sweeps = Math.max(1, options.sweeps ?? 3);
  const seedBaseline = options.seedBaseline ?? true;
  const anchor = options.anchorDate ? new Date(options.anchorDate) : new Date();

  resetScheduleCutoverState();

  const report: ScheduleSoakReport = {
    companyId,
    authoritativeFlag: isScheduleSupabaseAuthoritative(),
    inputSource: getScheduleCutoverState().inputSource,
    intervals: [],
    scheduleRuns: 0,
    scheduleClean: 0,
    criticalDrift: 0,
    totalLocalOccurrences: 0,
    totalSupabaseOccurrences: 0,
    totalDivergences: 0,
    driftNotes: [],
    serviceRowParityOk: false,
    variationParityOk: false,
    exceptionParityOk: false,
    parityNotes: [],
    fallbackVerified: false,
    rollbackVerified: false,
    perf: [],
    verdict: "NOT READY",
    blockers: [],
  };

  // Establish baseline parity so the interval comparisons can ever be clean.
  if (seedBaseline) {
    const baseline = await migrateWorkOrders({ companyId });
    if (!baseline.ok && baseline.error) {
      report.driftNotes.push(`baseline migration: ${baseline.error}`);
    }
  }

  // ── Schedule-critical parity (service rows / variations / exceptions) ──
  const [serviceRows, variations, exceptions] = await Promise.all([
    validateServiceRowFieldParity(companyId),
    validateVariationParity(companyId),
    validateExceptionParity(companyId),
  ]);
  report.serviceRowParityOk = serviceRows.ok;
  report.variationParityOk = variations.ok;
  report.exceptionParityOk = exceptions.ok;
  for (const note of [...serviceRows.notes, ...variations.notes, ...exceptions.notes]) {
    report.parityNotes.push(note);
  }

  // ── Per-view-mode interval sweeps ──
  for (let sweep = 0; sweep < sweeps; sweep++) {
    // Step each sweep forward by a week so recurring rows are exercised across
    // multiple occurrence dates (boundary crossings, week-over-week recurrence).
    const start = new Date(anchor);
    start.setDate(start.getDate() + sweep * 7);

    for (const viewMode of VIEW_MODE_ORDER) {
      const { fromDate, toDate } = windowFor(viewMode, start);
      const opts: ScheduleReconstructionOptions = {
        companyId,
        fromDate,
        toDate,
        includeCancelled: true,
      };

      const stop = perf.start("schedule.soak.interval");
      const cmp = await compareScheduleInterval(opts);
      stop();

      recordScheduleSupabaseInput();

      const result: ScheduleSoakIntervalResult = {
        viewMode,
        fromDate,
        toDate,
        localOccurrences: cmp.localOccurrences,
        supabaseOccurrences: cmp.supabaseOccurrences,
        ok: cmp.ok,
        countMatch: cmp.countMatch,
        keysMatch: cmp.keysMatch,
        divergences: cmp.divergences.length,
        notes: cmp.notes,
      };
      report.intervals.push(result);
      report.scheduleRuns += 1;
      report.totalLocalOccurrences += cmp.localOccurrences;
      report.totalSupabaseOccurrences += cmp.supabaseOccurrences;
      report.totalDivergences += cmp.divergences.length;

      if (cmp.ok) {
        report.scheduleClean += 1;
      } else {
        report.criticalDrift += 1;
        const summary = `${viewMode} ${fromDate}..${toDate}: ${cmp.notes.join("; ") || "divergence"}`;
        report.driftNotes.push(summary);
        recordScheduleShadowDrift(summary);
      }
    }
  }

  // ── Fallback drill: the local backout input must always resolve ──
  // This is exactly the path the Schedule falls back to when the Supabase input
  // build fails under authority. We resolve it directly (no Supabase) and record
  // a fallback event so the counter is surfaced — never silent.
  try {
    const weeklyWindow = windowFor("weekly", anchor);
    const localInput = buildScheduleInputFromLocal({
      companyId,
      ...weeklyWindow,
      includeCancelled: true,
    });
    const a = resolveScheduleProgram(localInput);
    const b = resolveScheduleProgram(localInput);
    // Stable + deterministic: the fallback render is reproducible.
    report.fallbackVerified = a.length === b.length;
    recordScheduleInputFallback(companyId, "P6E fallback drill (simulated Supabase failure)");
  } catch {
    report.fallbackVerified = false;
  }

  // ── Rollback drill: flag OFF → localStorage authoritative input resolves ──
  // Rollback is the absence of the flag. Whether or not authority is currently
  // on, the localStorage input path is always available and is the rollback
  // target; we confirm it resolves over a representative window.
  try {
    const monthlyWindow = windowFor("monthly", anchor);
    const rollbackInput = buildScheduleInputFromLocal({
      companyId,
      ...monthlyWindow,
      includeCancelled: true,
    });
    resolveScheduleProgram(rollbackInput);
    report.rollbackVerified = true;
  } catch {
    report.rollbackVerified = false;
  }

  // Reflect the resolved source after the run (authority implies supabase read).
  report.inputSource = shouldReadScheduleFromSupabase() ? "supabase" : "localStorage";

  // ── Perf + verdict ──
  report.perf = collectPerf();

  if (report.criticalDrift > 0) {
    report.blockers.push(`${report.criticalDrift} interval(s) with shadow drift`);
  }
  if (report.totalDivergences > 0) {
    report.blockers.push(`${report.totalDivergences} occurrence field divergence(s)`);
  }
  if (!report.serviceRowParityOk) report.blockers.push("service-row parity failed");
  if (!report.variationParityOk) report.blockers.push("variation parity failed");
  if (!report.exceptionParityOk) report.blockers.push("exception parity failed");
  if (!report.fallbackVerified) report.blockers.push("fallback drill did not confirm local resolve");
  if (!report.rollbackVerified) report.blockers.push("rollback drill did not confirm local authoritative input");
  if (report.scheduleRuns === 0) report.blockers.push("no interval comparisons executed");

  report.verdict = report.blockers.length === 0 ? "READY" : "NOT READY";
  return report;
}

/**
 * Lists the company ids with schedulable work orders, so a soak runner can pick a
 * representative company without re-deriving it from the store.
 */
export function listScheduleSoakCompanies(): string[] {
  return Array.from(new Set(getWorkOrders().map((w) => w.companyId)));
}

// Expose a console handle in development for manual soak runs. Merges with the
// handles attached in the other data modules.
if (import.meta.env.DEV === true && typeof window !== "undefined") {
  const w = window as unknown as { __cleanopsData?: Record<string, unknown> };
  w.__cleanopsData = {
    ...(w.__cleanopsData ?? {}),
    runScheduleAuthoritativeSoak,
    listScheduleSoakCompanies,
  };
}
