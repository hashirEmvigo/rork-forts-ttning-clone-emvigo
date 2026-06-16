/**
 * Schedule interval-read source runtime (P6B).
 *
 * The decision + telemetry layer for the Schedule interval-read switch — the
 * Schedule analogue of {@link import("./workOrderCutover")}. When
 * {@link SCHEDULE_SUPABASE_INTERVAL_READ} is on, the Schedule builds its resolver
 * INPUT (work orders + base occurrence exceptions) from Supabase via the
 * validated WO-4 builder, while the customer / employee / postal-city LOOKUPS
 * stay local. localStorage remains the fallback on any failure.
 *
 * This module centralises:
 *   • source resolution — what input source is active right now,
 *   • fallback + failure handling — every Supabase input build that fails is
 *     RECORDED and surfaced, never silently swallowed,
 *   • the live state behind the Super Admin "Schedule · P6B Interval Read"
 *     monitoring panel.
 *
 * It holds NO React state-machine and performs NO I/O — the hook calls into it;
 * it only resolves policy and records counters. Rollback is `flag OFF` → the
 * Schedule input returns to localStorage.
 *
 * IMPORTANT: the Schedule resolver ({@link resolveScheduleProgram}), recurrence,
 * variation and exception LOGIC, the board, metrics, filters and interactions
 * are all untouched. Only the resolver INPUT source moves behind the flag.
 */
import {
  SCHEDULE_SUPABASE_INTERVAL_READ,
  SCHEDULE_SUPABASE_AUTHORITATIVE,
} from "@/lib/featureFlags";

/** Which store currently backs the Schedule resolver input. */
export type ScheduleInputSource = "supabase" | "localStorage";

/**
 * Whether Supabase is the AUTHORITATIVE Schedule input (P6D) or merely a
 * validated read source (P6B/P6C). localStorage stays the fallback in both.
 */
export type ScheduleInputAuthority = "supabase" | "localStorage";

/** A single recorded fallback/failure event during Supabase-input mode. */
export interface ScheduleInputFailure {
  /** App-facing company scope (or "*") the build was attempted for. */
  ref: string;
  message: string;
  at: string;
}

/** The most recent P6C interval-scoped query (per-class fetch counts + window). */
export interface ScheduleIntervalQueryStat {
  /** Display window requested by the board. */
  fromDate: string;
  toDate: string;
  /** Widened window actually scanned (scan-widening parity with the resolver). */
  queryFromDate: string;
  queryToDate: string;
  /** True when a reschedule pulled the scan window wider than the display window. */
  widened: boolean;
  /** Service rows that overlapped the window. */
  serviceRows: number;
  /** Parent work orders hydrated (only those owning an in-window row). */
  parents: number;
  /** Exceptions fetched for the window. */
  exceptions: number;
  at: string;
}

/** Live, cumulative interval-read telemetry (development instrumentation only). */
export interface ScheduleCutoverState {
  /** Whether the Schedule input is read from Supabase (flag ON). */
  supabaseInput: boolean;
  /** Resolved input source right now. */
  inputSource: ScheduleInputSource;
  /** Interval inputs successfully built from Supabase. */
  supabaseInputs: number;
  /** Interval input builds that fell back to localStorage after a failure. */
  fallbacks: number;
  /** Background shadow comparisons that found drift. */
  shadowDrift: number;
  /** Total failure/drift events recorded. */
  failures: number;
  /** Human-readable summary of the most recent mismatch, when any. */
  lastMismatch: string | null;
  /** ISO timestamp of the most recent recorded event. */
  lastEventAt: string | null;
  /** Bounded ring of the most recent failures for the monitoring panel. */
  recentFailures: ScheduleInputFailure[];
  /** True when Supabase is the AUTHORITATIVE Schedule input (P6D flag ON). */
  authoritative: boolean;
  /** Which store is authoritative for the Schedule input right now. */
  inputAuthority: ScheduleInputAuthority;
  /** Total interval-scoped queries run (P6C). */
  intervalQueries: number;
  /** The most recent interval-scoped query's fetch counts + window (P6C). */
  lastIntervalQuery: ScheduleIntervalQueryStat | null;
}

const MAX_RECENT_FAILURES = 50;

const state: ScheduleCutoverState = {
  supabaseInput: SCHEDULE_SUPABASE_INTERVAL_READ,
  inputSource: SCHEDULE_SUPABASE_INTERVAL_READ ? "supabase" : "localStorage",
  supabaseInputs: 0,
  fallbacks: 0,
  shadowDrift: 0,
  failures: 0,
  lastMismatch: null,
  lastEventAt: null,
  recentFailures: [],
  intervalQueries: 0,
  lastIntervalQuery: null,
  authoritative: SCHEDULE_SUPABASE_AUTHORITATIVE,
  inputAuthority: SCHEDULE_SUPABASE_AUTHORITATIVE ? "supabase" : "localStorage",
};

/**
 * Whether the Schedule should build its resolver INPUT from Supabase. True when
 * either the P6B/P6C interval-read flag is on OR the P6D authoritative flag is on
 * (authority implies the read path even if its own flag is off).
 */
export function shouldReadScheduleFromSupabase(): boolean {
  return SCHEDULE_SUPABASE_INTERVAL_READ || SCHEDULE_SUPABASE_AUTHORITATIVE;
}

/**
 * Whether Supabase is the AUTHORITATIVE Schedule input (P6D). When true the
 * Supabase interval input is primary and localStorage is the fallback / backout
 * input; rollback is `flag OFF`. The resolver is unchanged either way.
 */
export function isScheduleSupabaseAuthoritative(): boolean {
  return SCHEDULE_SUPABASE_AUTHORITATIVE;
}

/** Returns an immutable snapshot of the cumulative interval-read telemetry. */
export function getScheduleCutoverState(): ScheduleCutoverState {
  const reading = SCHEDULE_SUPABASE_INTERVAL_READ || SCHEDULE_SUPABASE_AUTHORITATIVE;
  return {
    ...state,
    supabaseInput: reading,
    inputSource: reading ? "supabase" : "localStorage",
    authoritative: SCHEDULE_SUPABASE_AUTHORITATIVE,
    inputAuthority: SCHEDULE_SUPABASE_AUTHORITATIVE ? "supabase" : "localStorage",
    recentFailures: [...state.recentFailures],
    lastIntervalQuery: state.lastIntervalQuery ? { ...state.lastIntervalQuery } : null,
  };
}

/** Clears the interval-read telemetry (used by tests + the dev console). */
export function resetScheduleCutoverState(): void {
  state.supabaseInputs = 0;
  state.fallbacks = 0;
  state.shadowDrift = 0;
  state.failures = 0;
  state.lastMismatch = null;
  state.lastEventAt = null;
  state.recentFailures = [];
  state.intervalQueries = 0;
  state.lastIntervalQuery = null;
}

/** Records a Schedule interval input successfully built from Supabase. */
export function recordScheduleSupabaseInput(): void {
  if (!shouldReadScheduleFromSupabase()) return;
  state.supabaseInputs += 1;
}

/**
 * Records a P6C interval-scoped query's per-class fetch counts + the widened
 * window it scanned, so the monitoring panel can prove the Schedule no longer
 * fetches all work orders. Gated by the flag (a no-op when OFF).
 */
export function recordScheduleIntervalQuery(stat: Omit<ScheduleIntervalQueryStat, "widened" | "at">): void {
  if (!shouldReadScheduleFromSupabase()) return;
  state.intervalQueries += 1;
  state.lastIntervalQuery = {
    ...stat,
    widened: stat.queryFromDate < stat.fromDate || stat.queryToDate > stat.toDate,
    at: new Date().toISOString(),
  };
}

/**
 * Records a Supabase input build that failed and forced a fallback to the
 * localStorage input. Surfaced, never silent.
 */
export function recordScheduleInputFallback(ref: string, message: string): void {
  const at = new Date().toISOString();
  state.fallbacks += 1;
  state.failures += 1;
  state.lastEventAt = at;
  state.recentFailures.unshift({ ref, message, at });
  if (state.recentFailures.length > MAX_RECENT_FAILURES) {
    state.recentFailures.length = MAX_RECENT_FAILURES;
  }
  if (import.meta.env.DEV === true) {
    // eslint-disable-next-line no-console
    console.warn(`[P6B] Schedule input fallback for ${ref}: ${message}`);
  }
}

/**
 * Records background shadow-comparison drift between the local-input resolve and
 * the Supabase-input resolve for an interval. `summary` is the human-readable
 * mismatch note surfaced in the monitoring panel.
 */
export function recordScheduleShadowDrift(summary: string): void {
  state.shadowDrift += 1;
  state.failures += 1;
  state.lastMismatch = summary;
  state.lastEventAt = new Date().toISOString();
  if (import.meta.env.DEV === true) {
    // eslint-disable-next-line no-console
    console.warn(`[P6B] Schedule interval shadow drift: ${summary}`);
  }
}

// Expose console handles in development for manual inspection.
if (import.meta.env.DEV === true && typeof window !== "undefined") {
  const w = window as unknown as { __cleanopsData?: Record<string, unknown> };
  w.__cleanopsData = {
    ...(w.__cleanopsData ?? {}),
    getScheduleCutoverState,
    resetScheduleCutoverState,
    shouldReadScheduleFromSupabase,
    isScheduleSupabaseAuthoritative,
    recordScheduleIntervalQuery,
  };
}
