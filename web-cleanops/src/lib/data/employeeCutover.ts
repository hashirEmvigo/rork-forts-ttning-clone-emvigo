/**
 * Employee read-path source runtime (P7D · EMP-2).
 *
 * The decision + telemetry layer for the Employees read-path switch — the
 * Employees analogue of {@link import("./scheduleCutover")} /
 * {@link import("./customerCutover")}, adapted to the fact that Employees is a
 * single GLOBAL company directory (an in-memory array seeded once at app mount),
 * NOT an interval-scoped projection. When {@link EMPLOYEES_SUPABASE_READ} is on,
 * the directory is reconciled from Supabase via the validated
 * {@link listFullEmployeesFromSupabase} path while localStorage stays the
 * authoritative source and the ONLY write target.
 *
 * This module centralises:
 *   • source resolution — whether the directory should read from Supabase,
 *   • fallback + failure handling — every Supabase read that fails OR returns an
 *     UNSAFE empty result (empty while localStorage has data) is RECORDED and
 *     surfaced, never silently swallowed,
 *   • the live state behind the future Super Admin "Employees · EMP-2 Read"
 *     monitoring panel (deferred per the Dashboard v1.0 spec).
 *
 * It holds NO React state and performs NO I/O — the {@link useEmployeeDirectorySource}
 * hook calls into it; it only resolves policy and records counters. The hook is
 * responsible for gating every call by `enabled` (flag ON + Supabase configured),
 * so the record functions are intentionally NOT flag-gated — they faithfully
 * count whatever the (already-gated) hook reports.
 *
 * EMP-2 scope: read ONLY. There is NO dual-write and NO authoritative mode here.
 * Rollback is `flag OFF` → the directory seeds from localStorage with no Supabase
 * dependency on the path.
 */
import {
  EMPLOYEES_SUPABASE_READ,
  EMPLOYEES_DUAL_WRITE,
  EMPLOYEES_SHADOW_VALIDATE,
} from "@/lib/featureFlags";

/** Which store currently backs the employee directory the UI renders. */
export type EmployeeReadSource = "supabase" | "localStorage";

/** Why a recorded read event served the localStorage seed instead of Supabase. */
export type EmployeeReadFailureKind = "read" | "unsafe.empty" | "drift";

/** A single recorded fallback/failure/drift event during Supabase-read mode. */
export interface EmployeeReadFailure {
  kind: EmployeeReadFailureKind;
  /** App-facing company scope (or "*") the read was attempted for. */
  ref: string;
  message: string;
  at: string;
}

/** Live, cumulative read-path telemetry (development instrumentation only). */
export interface EmployeeCutoverState {
  /** Whether the directory is read from Supabase (flag ON). */
  supabaseRead: boolean;
  /** Resolved read source right now (recomputed from the live flag). */
  readSource: EmployeeReadSource;
  /** Directories successfully served from Supabase (healthy, non-empty / safe-empty). */
  supabaseReads: number;
  /** Reads that served the localStorage seed (fallback / unsafe-empty). */
  localReads: number;
  /** Reads that fell back to the localStorage seed after a failure or unsafe empty. */
  fallbacks: number;
  /** Total failure/drift events recorded. */
  failures: number;
  /** Background shadow comparisons that found drift. */
  shadowDrift: number;
  /** Supabase reads that returned empty WHILE localStorage had data (unsafe). */
  unsafeEmptyReads: number;
  /** Human-readable summary of the most recent shadow mismatch, when any. */
  lastMismatch: string | null;
  /** ISO timestamp of the most recent recorded event. */
  lastEventAt: string | null;
  /** Bounded ring of the most recent failures for the monitoring panel. */
  recentFailures: EmployeeReadFailure[];
}

const MAX_RECENT_FAILURES = 50;

const state: EmployeeCutoverState = {
  supabaseRead: EMPLOYEES_SUPABASE_READ,
  readSource: EMPLOYEES_SUPABASE_READ ? "supabase" : "localStorage",
  supabaseReads: 0,
  localReads: 0,
  fallbacks: 0,
  failures: 0,
  shadowDrift: 0,
  unsafeEmptyReads: 0,
  lastMismatch: null,
  lastEventAt: null,
  recentFailures: [],
};

/**
 * Whether the employee directory should READ from Supabase. True only when the
 * EMP-2 read flag is on. EMP-2 introduces NO authoritative mode, so this is the
 * single gate (a later wave would OR in an authority flag here).
 */
export function shouldReadEmployeesFromSupabase(): boolean {
  return EMPLOYEES_SUPABASE_READ;
}

/**
 * Whether employee writes should be MIRRORED to Supabase (EMP-4). True when the
 * granular {@link EMPLOYEES_DUAL_WRITE} flag is on. EMP-4 introduces NO
 * authoritative-write mode, so this is the single gate (a later wave would OR in
 * an authority flag here). localStorage stays the authoritative write target.
 */
export function shouldMirrorEmployeeWrites(): boolean {
  return EMPLOYEES_DUAL_WRITE;
}

/**
 * Whether the employee write mirror should run the deeper company-scoped shadow
 * validation pass after a successful mirror (EMP-4). Has no effect unless
 * {@link shouldMirrorEmployeeWrites} is also true.
 */
export function shouldShadowValidateEmployees(): boolean {
  return EMPLOYEES_SHADOW_VALIDATE;
}

/** Returns an immutable snapshot of the cumulative read-path telemetry. */
export function getEmployeeCutoverState(): EmployeeCutoverState {
  return {
    ...state,
    supabaseRead: EMPLOYEES_SUPABASE_READ,
    readSource: EMPLOYEES_SUPABASE_READ ? "supabase" : "localStorage",
    recentFailures: [...state.recentFailures],
  };
}

/** Clears the read-path telemetry (used by tests + the dev console). */
export function resetEmployeeCutoverState(): void {
  state.supabaseReads = 0;
  state.localReads = 0;
  state.fallbacks = 0;
  state.failures = 0;
  state.shadowDrift = 0;
  state.unsafeEmptyReads = 0;
  state.lastMismatch = null;
  state.lastEventAt = null;
  state.recentFailures = [];
}

function pushFailure(kind: EmployeeReadFailureKind, ref: string, message: string): void {
  const at = new Date().toISOString();
  state.failures += 1;
  state.lastEventAt = at;
  state.recentFailures.unshift({ kind, ref, message, at });
  if (state.recentFailures.length > MAX_RECENT_FAILURES) {
    state.recentFailures.length = MAX_RECENT_FAILURES;
  }
}

/**
 * Records a directory successfully served from Supabase (healthy non-empty, or a
 * safe empty where localStorage is also empty). Called by the hook only when the
 * read path is enabled.
 */
export function recordEmployeeSupabaseRead(): void {
  state.supabaseReads += 1;
}

/**
 * Records a Supabase read that failed and forced a fallback to the localStorage
 * seed. Surfaced, never silent. Also counts as a local serve.
 */
export function recordEmployeeReadFallback(ref: string, message: string): void {
  state.fallbacks += 1;
  state.localReads += 1;
  pushFailure("read", ref, message);
  if (import.meta.env.DEV === true) {
    // eslint-disable-next-line no-console
    console.warn(`[EMP-2] Employee directory fallback for ${ref}: ${message}`);
  }
}

/**
 * Records an UNSAFE empty Supabase result — empty while localStorage has data.
 * Per Framework v0.2 §8, empty ≠ a successful read in this case: the local seed
 * is retained (the directory is never blanked) and the event is surfaced. Also
 * counts as a fallback + local serve.
 */
export function recordEmployeeUnsafeEmpty(ref: string): void {
  state.unsafeEmptyReads += 1;
  state.fallbacks += 1;
  state.localReads += 1;
  pushFailure(
    "unsafe.empty",
    ref,
    "Supabase returned 0 employees while localStorage has data — kept local seed.",
  );
  if (import.meta.env.DEV === true) {
    // eslint-disable-next-line no-console
    console.warn(`[EMP-2] Employee directory unsafe empty for ${ref} — kept local seed.`);
  }
}

/**
 * Records background shadow-comparison drift between the localStorage directory
 * and the Supabase copy. `summary` is the human-readable mismatch note surfaced
 * in the monitoring panel. Drift only flags observability; it never blocks the
 * UI (the served data already fell back if the read itself was unhealthy).
 */
export function recordEmployeeShadowDrift(summary: string): void {
  state.shadowDrift += 1;
  state.lastMismatch = summary;
  pushFailure("drift", "shadow", summary);
  if (import.meta.env.DEV === true) {
    // eslint-disable-next-line no-console
    console.warn(`[EMP-2] Employee directory shadow drift: ${summary}`);
  }
}

// Expose console handles in development for manual inspection.
if (import.meta.env.DEV === true && typeof window !== "undefined") {
  const w = window as unknown as { __cleanopsData?: Record<string, unknown> };
  w.__cleanopsData = {
    ...(w.__cleanopsData ?? {}),
    getEmployeeCutoverState,
    resetEmployeeCutoverState,
    shouldReadEmployeesFromSupabase,
    shouldMirrorEmployeeWrites,
    shouldShadowValidateEmployees,
  };
}
