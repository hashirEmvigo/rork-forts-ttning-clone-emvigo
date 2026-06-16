/**
 * Mission Log checkout parity comparator (Slice 2d-1).
 *
 * A PURE function that proves ONE legacy checkout {@link TimeReport} is faithfully
 * represented by the Mission Log rows the dual-write ({@link
 * import("./missionLogDualWrite")}) should have produced. It takes the legacy
 * report + work-order context AND the ALREADY-FETCHED Supabase rows as fixtures,
 * and returns a structured {@link ParityResult}. It performs NO Supabase /
 * localStorage reads, NO writes and NO logging.
 *
 * DUAL-WRITE-STATE AWARE (Slice 2d-1 clarification): Mission Log dual-write is
 * gated SEPARATELY from Time Reporting, so absence is interpreted by
 * `missionLogDualWriteEnabled`:
 *   • OFF → missing entry/session/event are EXPECTED and graded `info` (never a
 *     failure). The Time Reporting comparator still validates the deterministic
 *     mission soft-link ids independently — those stay valid even with no rows.
 *   • ON  → missing entry/session/checked_out event are graded `blocking`, and a
 *     duplicated checked_out event is `blocking`.
 * When a row IS present it is validated regardless of the flag (field
 * divergences graded `warning`), so a row written then disabled is still checked.
 *
 * Reuses the SAME deterministic id derivation the dual-write writes through
 * ({@link import("./missionLogMigration")}) so parity can never drift.
 */
import type { TimeReport } from "@/types";
import {
  buildMissionLogEntryLegacyId,
  buildMissionStaffSessionLegacyId,
  buildCheckoutEventLegacyId,
  buildCheckoutEventIdempotencyKey,
  type MissionLogCheckoutContext,
  type MissionLogEntryUpsertRow,
  type MissionStaffSessionUpsertRow,
  type MissionLogEventInsertRow,
} from "./missionLogMigration";
import {
  createParityCollector,
  type ParityCompareOptions,
  type ParityResult,
  type ParitySeverity,
} from "./parityShared";

/**
 * The already-fetched Mission Log rows for ONE legacy checkout. Shapes mirror
 * exactly what the dual-write writes; `entry`/`session` are null when no row was
 * found in Supabase.
 */
export interface MissionLogParityRows {
  entry: MissionLogEntryUpsertRow | null;
  session: MissionStaffSessionUpsertRow | null;
  events: MissionLogEventInsertRow[];
}

/** Options for the Mission Log comparator. */
export interface MissionLogParityOptions extends ParityCompareOptions {
  /**
   * Whether Mission Log dual-write is considered enabled. Drives how ABSENCE is
   * graded: OFF → `info` (expected); ON → `blocking`.
   */
  missionLogDualWriteEnabled: boolean;
}

const CHECKOUT_EVENT_TYPE = "employee_checked_out";

/**
 * Compares ONE legacy checkout {@link TimeReport} against its already-fetched
 * Mission Log rows. Pure: no I/O, no logging.
 */
export function compareMissionLogParity(
  report: TimeReport,
  context: MissionLogCheckoutContext,
  rows: MissionLogParityRows,
  options: MissionLogParityOptions,
): ParityResult {
  const c = createParityCollector("mission_log", options);
  const enabled = options.missionLogDualWriteEnabled;
  // Severity used when a row is ABSENT: blocking when dual-write is on, else info.
  const absentSeverity: ParitySeverity = enabled ? "blocking" : "info";

  const entryLegacyId = buildMissionLogEntryLegacyId(report);
  const sessionLegacyId = buildMissionStaffSessionLegacyId(report);

  // ── mission_log_entries ───────────────────────────────────────────────────
  const entry = rows.entry;
  if (!entry) {
    c.add({
      type: enabled ? "entry.missing" : "entry.absent_expected",
      table: "mission_log_entries",
      sourceLegacyId: entryLegacyId,
      severity: absentSeverity,
      expected: entryLegacyId,
      actual: null,
    });
  } else {
    const T = "mission_log_entries";
    c.field(T, entryLegacyId, "legacy_id", entryLegacyId, entry.legacy_id);
    c.field(T, entryLegacyId, "company_legacy_id", report.companyId, entry.company_legacy_id);
    c.field(T, entryLegacyId, "work_order_legacy_id", report.workOrderId, entry.work_order_legacy_id);
    c.field(T, entryLegacyId, "service_row_legacy_id", report.serviceRowId ?? null, entry.service_row_legacy_id);
    c.field(T, entryLegacyId, "customer_legacy_id", context.customerId, entry.customer_legacy_id);
  }

  // ── mission_staff_sessions ────────────────────────────────────────────────
  const session = rows.session;
  if (!session) {
    c.add({
      type: enabled ? "session.missing" : "session.absent_expected",
      table: "mission_staff_sessions",
      sourceLegacyId: sessionLegacyId,
      severity: absentSeverity,
      expected: sessionLegacyId,
      actual: null,
    });
  } else {
    const T = "mission_staff_sessions";
    c.field(T, sessionLegacyId, "legacy_id", sessionLegacyId, session.legacy_id);
    c.field(T, sessionLegacyId, "mission_log_entry_legacy_id", entryLegacyId, session.mission_log_entry_legacy_id);
    c.field(T, sessionLegacyId, "employee_legacy_id", report.employeeId ?? "unknown", session.employee_legacy_id);
  }

  // ── mission_log_events (checked_out) ──────────────────────────────────────
  const eventLegacyId = buildCheckoutEventLegacyId(report);
  const checkedOut = rows.events.filter((e) => e.event_type === CHECKOUT_EVENT_TYPE);
  if (checkedOut.length === 0) {
    c.add({
      type: enabled ? "checked_out_event.missing" : "checked_out_event.absent_expected",
      table: "mission_log_events",
      sourceLegacyId: eventLegacyId,
      severity: absentSeverity,
      expected: eventLegacyId,
      actual: null,
    });
  } else {
    const T = "mission_log_events";
    if (checkedOut.length > 1) {
      c.add({
        type: "checked_out_event.duplicate",
        table: T,
        sourceLegacyId: eventLegacyId,
        severity: "blocking",
        expected: 1,
        actual: checkedOut.length,
      });
    }
    const event = checkedOut[0];
    c.field(T, eventLegacyId, "legacy_id", eventLegacyId, event.legacy_id);
    c.field(T, eventLegacyId, "idempotency_key", buildCheckoutEventIdempotencyKey(report), event.idempotency_key);
    c.field(T, eventLegacyId, "occurred_at", report.submittedAt, event.occurred_at);
  }

  return c.result();
}
