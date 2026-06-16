/**
 * Operational Execution parity — shared mismatch model + comparator helpers
 * (Slice 2d-1).
 *
 * The shared, PURE foundation the Mission Log ({@link
 * import("./missionLogParity")}) and Time Reporting ({@link
 * import("./timeReportingParity")}) parity comparators build on. It defines the
 * structured {@link ParityMismatch} model and a small collector that the
 * comparators push into — it performs NO I/O, NO Supabase / localStorage reads,
 * NO writes and NO logging side effects. Comparators take ALREADY-FETCHED row
 * fixtures and return structured results, so this file is the validation-only
 * substrate before any runtime hook, telemetry state or read cut-over exists.
 *
 * SANITIZATION: callers must keep {@link ParityMismatch.context} to small,
 * non-sensitive scalars (ids, minutes, counts) — NEVER full report payloads or
 * PII. Severity is graded `info` < `warning` < `blocking`; a result counts as a
 * PASS when it carries no `warning`/`blocking` mismatch (info-only is expected,
 * e.g. Mission Log rows absent while its dual-write is OFF).
 */

/** Mismatch gravity, ordered `info` < `warning` < `blocking`. */
export type ParitySeverity = "info" | "warning" | "blocking";

/** Which Operational Execution domain a mismatch belongs to. */
export type ParityDomain = "time_reporting" | "mission_log";

/** A single structured, sanitized parity mismatch. */
export interface ParityMismatch {
  /** Stable machine-readable mismatch type, e.g. `report.missing`. */
  type: string;
  /** The domain this mismatch belongs to. */
  domain: ParityDomain;
  /** The logical table the mismatch concerns, e.g. `time_reports`. */
  table: string;
  /** The legacy id (deterministic key / report id) the comparison anchored on. */
  sourceLegacyId: string;
  /** The specific field, when the mismatch is a field-level divergence. */
  field?: string;
  /** Expected value (sanitized scalar). */
  expected?: unknown;
  /** Actual value (sanitized scalar). */
  actual?: unknown;
  /** Gravity of the mismatch. */
  severity: ParitySeverity;
  /** ISO timestamp the mismatch was recorded (injectable for determinism). */
  timestamp: string;
  /** Small, non-sensitive extra context (ids / minutes / counts only). */
  context?: Record<string, unknown>;
}

/** The structured outcome of one comparator run. */
export interface ParityResult {
  /** True when there is no `warning`/`blocking` mismatch (info-only passes). */
  matched: boolean;
  /** All recorded mismatches, in the order they were found. */
  mismatches: ParityMismatch[];
}

/** Options common to every comparator. */
export interface ParityCompareOptions {
  /** Injectable clock for the mismatch timestamp (defaults to `Date.now`). */
  now?: () => string;
}

/** Input to {@link ParityCollector.add} — everything but `domain`/`timestamp`. */
export interface MismatchInput {
  type: string;
  table: string;
  sourceLegacyId: string;
  field?: string;
  expected?: unknown;
  actual?: unknown;
  severity: ParitySeverity;
  context?: Record<string, unknown>;
}

/** Whether a set of mismatches counts as a parity PASS (info-only is a pass). */
export function isParityPass(mismatches: ReadonlyArray<ParityMismatch>): boolean {
  return !mismatches.some((m) => m.severity !== "info");
}

/**
 * A tiny pure accumulator a comparator pushes mismatches into. Stamps each
 * mismatch with the comparator's `domain` and an injectable `timestamp`, and can
 * `result()` into a {@link ParityResult}. No I/O, no logging.
 */
export interface ParityCollector {
  readonly mismatches: ParityMismatch[];
  /** Records one mismatch. */
  add: (input: MismatchInput) => void;
  /**
   * Records a field-level mismatch ONLY when `expected` and `actual` differ
   * (via `Object.is`, so null/number/string compare correctly).
   */
  field: (
    table: string,
    sourceLegacyId: string,
    field: string,
    expected: unknown,
    actual: unknown,
    severity?: ParitySeverity,
    context?: Record<string, unknown>,
  ) => void;
  /** Snapshots the accumulated mismatches into a structured result. */
  result: () => ParityResult;
}

/** Creates a {@link ParityCollector} for one domain + injectable clock. */
export function createParityCollector(
  domain: ParityDomain,
  options: ParityCompareOptions = {},
): ParityCollector {
  const now = options.now ?? (() => new Date().toISOString());
  const mismatches: ParityMismatch[] = [];

  function add(input: MismatchInput): void {
    mismatches.push({ domain, timestamp: now(), ...input });
  }

  function field(
    table: string,
    sourceLegacyId: string,
    fieldName: string,
    expected: unknown,
    actual: unknown,
    severity: ParitySeverity = "warning",
    context?: Record<string, unknown>,
  ): void {
    if (!Object.is(expected, actual)) {
      add({
        type: `${fieldName}.mismatch`,
        table,
        sourceLegacyId,
        field: fieldName,
        expected,
        actual,
        severity,
        context,
      });
    }
  }

  function result(): ParityResult {
    return { matched: isParityPass(mismatches), mismatches: [...mismatches] };
  }

  return { mismatches, add, field, result };
}
