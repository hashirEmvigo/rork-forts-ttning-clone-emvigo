/**
 * Operational Execution parity — sanitized telemetry state (Slice 2d-2).
 *
 * The cumulative, sanitized telemetry the parity runner ({@link
 * import("./timeReportingParityRunner")}) records into. It is the parity
 * analogue of {@link import("./timeReportingCutover")}: a module-level state
 * object holding counters + a capped, SANITIZED recent-mismatch ring the
 * Development Center can surface. It holds NO React state and performs NO I/O —
 * the runner calls into it.
 *
 * VALIDATION ONLY: nothing here switches a live read, blocks checkout or mutates
 * data. The runner is gated by {@link TIME_REPORTING_SHADOW_VALIDATE}.
 *
 * SANITIZATION IS CENTRAL + ENFORCED HERE: every mismatch is run through
 * {@link sanitizeParityMismatch} before it is stored, so deviation comments,
 * message bodies, employee/customer name snapshots and any non-scalar payloads
 * NEVER enter telemetry. Only short scalar ids / minutes / counts / statuses are
 * retained; sensitive fields are replaced with `[redacted]`.
 */
import { TIME_REPORTING_SHADOW_VALIDATE } from "@/lib/featureFlags";
import type {
  ParityDomain,
  ParityMismatch,
  ParityResult,
  ParitySeverity,
} from "./parityShared";

/** Cap on retained recent mismatches (matches the cut-over telemetry ring). */
const MAX_RECENT_MISMATCHES = 50;

/** Max retained length of a scalar string value before it is `[redacted]`. */
const MAX_SCALAR_STRING = 80;

/** Sentinel stored in place of any sensitive / non-scalar value. */
export const REDACTED = "[redacted]" as const;

/**
 * Fields whose VALUES are sensitive (free text / PII) and must never be stored
 * verbatim — only the fact that they diverged is kept.
 */
const SENSITIVE_FIELDS = new Set<string>([
  "message",
  "employee_name_snapshot",
  "customer_name_snapshot",
]);

/** Tables whose row VALUES are sensitive (the admin↔employee message thread). */
const SENSITIVE_TABLES = new Set<string>(["time_report_messages"]);

/** A single sanitized recent mismatch retained in telemetry (scalars only). */
export interface SanitizedParityMismatch {
  type: string;
  domain: ParityDomain;
  table: string;
  sourceLegacyId: string;
  field?: string;
  severity: ParitySeverity;
  /** Sanitized scalar (or `[redacted]`); omitted when there was no value. */
  expected?: string | number | boolean | null;
  /** Sanitized scalar (or `[redacted]`); omitted when there was no value. */
  actual?: string | number | boolean | null;
  /** Whitelisted scalar context only (ids / minutes / counts). */
  context?: Record<string, string | number | boolean>;
  at: string;
}

/** Cumulative, sanitized parity telemetry (development instrumentation). */
export interface TimeReportingParityState {
  /** Whether the parity runner is allowed to run right now. */
  enabled: boolean;
  /** Total comparator results recorded (one per report-domain comparison). */
  totalChecked: number;
  /** Results that were a PASS (no warning/blocking mismatch). */
  matched: number;
  /** Results that carried at least one warning/blocking mismatch. */
  mismatched: number;
  /** Cumulative blocking-severity mismatches. */
  blocking: number;
  /** Cumulative warning-severity mismatches. */
  warning: number;
  /** Cumulative info-severity mismatches. */
  info: number;
  /** Reports present in legacy but missing in Supabase. */
  missingInSupabase: number;
  /** Report rows present in Supabase but absent from the legacy batch. */
  missingInLegacy: number;
  /** Cumulative allocation-domain mismatches. */
  allocationMismatches: number;
  /** Cumulative status / payroll / invoice / requires-review mismatches. */
  statusMismatches: number;
  /** Cumulative flag / flag-event mismatches. */
  flagMismatches: number;
  /** Cumulative event (submitted / checked-out) mismatches. */
  eventMismatches: number;
  /** Cumulative message mismatches. */
  messageMismatches: number;
  /** Cumulative Mission Log soft-link / Mission Log domain mismatches. */
  missionLinkMismatches: number;
  /** Fetch / comparator failures that were recorded (never thrown). */
  fetchFailures: number;
  /** Last sanitized error summary, if any. */
  lastError: string | null;
  lastValidationAt: string | null;
  /** Most-recent sanitized mismatches (capped, newest first). */
  recentMismatches: SanitizedParityMismatch[];
}

function whoamiEnabled(): boolean {
  return TIME_REPORTING_SHADOW_VALIDATE;
}

const state: TimeReportingParityState = createEmpty();

function createEmpty(): TimeReportingParityState {
  return {
    enabled: whoamiEnabled(),
    totalChecked: 0,
    matched: 0,
    mismatched: 0,
    blocking: 0,
    warning: 0,
    info: 0,
    missingInSupabase: 0,
    missingInLegacy: 0,
    allocationMismatches: 0,
    statusMismatches: 0,
    flagMismatches: 0,
    eventMismatches: 0,
    messageMismatches: 0,
    missionLinkMismatches: 0,
    fetchFailures: 0,
    lastError: null,
    lastValidationAt: null,
    recentMismatches: [],
  };
}

// ── Sanitization ────────────────────────────────────────────────────────────

function isScalar(v: unknown): v is string | number | boolean | null {
  return (
    v === null ||
    typeof v === "string" ||
    typeof v === "number" ||
    typeof v === "boolean"
  );
}

/** Sanitizes one VALUE: sensitive or non-scalar / long strings become redacted. */
function sanitizeValue(
  value: unknown,
  sensitive: boolean,
): string | number | boolean | null | undefined {
  if (value === undefined) return undefined;
  if (sensitive) return REDACTED;
  if (!isScalar(value)) return REDACTED; // objects / arrays = potential payloads
  if (typeof value === "string" && value.length > MAX_SCALAR_STRING) return REDACTED;
  return value;
}

/** Sanitizes a context bag: keeps only short scalar values; drops the rest. */
function sanitizeContext(
  context: Record<string, unknown> | undefined,
  sensitive: boolean,
): Record<string, string | number | boolean> | undefined {
  if (!context || sensitive) return undefined;
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(context)) {
    if (v === null || v === undefined) continue;
    if (typeof v === "number" || typeof v === "boolean") {
      out[k] = v;
    } else if (typeof v === "string" && v.length <= MAX_SCALAR_STRING) {
      out[k] = v;
    }
    // non-scalar / long strings are dropped entirely.
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * The single, centralized sanitizer. Strips deviation comments, message bodies,
 * name snapshots and any non-scalar payload from a {@link ParityMismatch},
 * keeping only the structural shape + short scalar diagnostics. PURE — no I/O.
 */
export function sanitizeParityMismatch(
  mismatch: ParityMismatch,
): SanitizedParityMismatch {
  const sensitive =
    (mismatch.field !== undefined && SENSITIVE_FIELDS.has(mismatch.field)) ||
    SENSITIVE_TABLES.has(mismatch.table);

  const sanitized: SanitizedParityMismatch = {
    type: mismatch.type,
    domain: mismatch.domain,
    table: mismatch.table,
    sourceLegacyId: mismatch.sourceLegacyId,
    severity: mismatch.severity,
    at: mismatch.timestamp,
  };
  if (mismatch.field !== undefined) sanitized.field = mismatch.field;

  const expected = sanitizeValue(mismatch.expected, sensitive);
  if (expected !== undefined) sanitized.expected = expected;
  const actual = sanitizeValue(mismatch.actual, sensitive);
  if (actual !== undefined) sanitized.actual = actual;

  const context = sanitizeContext(mismatch.context, sensitive);
  if (context) sanitized.context = context;

  return sanitized;
}

// ── Categorization (which diagnostic counter a mismatch increments) ──────────

function isAllocation(m: ParityMismatch): boolean {
  return m.table === "time_allocations" || m.type.startsWith("allocation");
}
function isStatus(m: ParityMismatch): boolean {
  return (
    m.field === "status" ||
    m.field === "payroll_approval_status" ||
    m.field === "invoice_basis_status" ||
    m.field === "requires_admin_review" ||
    m.field === "flag_resolution_status"
  );
}
function isFlag(m: ParityMismatch): boolean {
  return (
    m.table === "time_report_flags" ||
    m.table === "time_report_flag_events" ||
    m.type.startsWith("flag")
  );
}
function isEvent(m: ParityMismatch): boolean {
  return (
    m.table === "time_report_events" ||
    m.table === "mission_log_events" ||
    m.type.startsWith("submitted_event") ||
    m.type.startsWith("checked_out_event")
  );
}
function isMessage(m: ParityMismatch): boolean {
  return m.table === "time_report_messages" || m.type.startsWith("message");
}
function isMissionLink(m: ParityMismatch): boolean {
  return (
    m.domain === "mission_log" ||
    m.field === "mission_log_entry_legacy_id" ||
    m.field === "mission_staff_session_legacy_id"
  );
}

function pushRecent(sanitized: SanitizedParityMismatch): void {
  state.recentMismatches.unshift(sanitized);
  if (state.recentMismatches.length > MAX_RECENT_MISMATCHES) {
    state.recentMismatches.length = MAX_RECENT_MISMATCHES;
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

/** Returns an immutable snapshot of the cumulative parity telemetry. */
export function getTimeReportingParityState(): TimeReportingParityState {
  return {
    ...state,
    enabled: whoamiEnabled(),
    recentMismatches: [...state.recentMismatches],
  };
}

/** Clears the parity telemetry (used by tests + the dev console). */
export function resetTimeReportingParityState(): void {
  Object.assign(state, createEmpty());
  state.recentMismatches = [];
}

/**
 * Records ONE comparator {@link ParityResult} into telemetry. Increments the
 * total / matched-or-mismatched counters, the per-severity + per-domain
 * diagnostic counters, and pushes each mismatch (SANITIZED) into the capped
 * recent ring. `report.missing` (Time Reporting) counts as missing-in-Supabase.
 */
export function recordParityResult(result: ParityResult): void {
  state.totalChecked += 1;
  state.lastValidationAt = new Date().toISOString();
  if (result.matched) {
    state.matched += 1;
  } else {
    state.mismatched += 1;
  }

  for (const m of result.mismatches) {
    if (m.severity === "blocking") state.blocking += 1;
    else if (m.severity === "warning") state.warning += 1;
    else state.info += 1;

    if (m.type === "report.missing") state.missingInSupabase += 1;
    if (isAllocation(m)) state.allocationMismatches += 1;
    if (isStatus(m)) state.statusMismatches += 1;
    if (isFlag(m)) state.flagMismatches += 1;
    if (isEvent(m)) state.eventMismatches += 1;
    if (isMessage(m)) state.messageMismatches += 1;
    if (isMissionLink(m)) state.missionLinkMismatches += 1;

    pushRecent(sanitizeParityMismatch(m));
  }
}

/**
 * Records a report row found in Supabase that has no corresponding legacy report
 * in the validated batch (the inverse of `report.missing`). Sanitized — only the
 * report legacy id is kept.
 */
export function recordParityMissingInLegacy(reportLegacyId: string): void {
  state.missingInLegacy += 1;
  state.lastValidationAt = new Date().toISOString();
  pushRecent({
    type: "report.missing_in_legacy",
    domain: "time_reporting",
    table: "time_reports",
    sourceLegacyId: reportLegacyId,
    severity: "warning",
    at: new Date().toISOString(),
  });
}

/**
 * Records a fetch / comparator failure (never a mismatch). Sanitized: the ref is
 * a legacy-id / scope string and the message is truncated. Never throws.
 */
export function recordParityFetchFailure(ref: string, message: string): void {
  state.fetchFailures += 1;
  state.lastValidationAt = new Date().toISOString();
  const summary = message.length > 200 ? `${message.slice(0, 200)}…` : message;
  state.lastError = `${ref}: ${summary}`;
  if (import.meta.env.DEV === true) {
    // eslint-disable-next-line no-console
    console.warn(`[TIMEREPORTING-2d] parity fetch failure for ${ref}: ${summary}`);
  }
}

// Expose console handles in development for manual inspection.
if (import.meta.env.DEV === true && typeof window !== "undefined") {
  const w = window as unknown as { __cleanopsData?: Record<string, unknown> };
  w.__cleanopsData = {
    ...(w.__cleanopsData ?? {}),
    getTimeReportingParityState,
    resetTimeReportingParityState,
  };
}
