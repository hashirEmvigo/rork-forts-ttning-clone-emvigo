/**
 * Time Reporting checkout parity comparator (Slice 2d-1).
 *
 * A PURE function that proves ONE legacy checkout {@link TimeReport} is faithfully
 * represented by the Time Reporting rows the dual-write ({@link
 * import("./timeReportingDualWrite")}) should have produced. It takes the legacy
 * report + the small work-order context AND the ALREADY-FETCHED Supabase rows as
 * fixtures, and returns a structured {@link ParityResult}. It performs NO
 * Supabase / localStorage reads, NO writes and NO logging — fetching is the
 * caller's job in a later slice.
 *
 * It reuses the SAME deterministic id + status/flag/message derivation the
 * dual-write writes through ({@link import("./timeReportingMigration")} /
 * {@link import("./missionLogMigration")}) so parity can never drift from the
 * write path. AUDIT/EVENT EQUIVALENCE IS SOFT (Slice 2d-1 clarification): the
 * submitted action is validated by presence of ONE non-duplicated
 * `time_report_submitted` event with the correct deterministic id / idempotency
 * key and an `occurred_at` matching `submittedAt` — NOT a field-by-field
 * auditHistory diff.
 *
 * Invariants graded `blocking` (silent divergence risk): a missing report,
 * missing scheduled allocation, a missing/duplicated submitted event, and the
 * payroll/invoice `not_ready` + `ai_recommendation = null` carry-overs. Field /
 * allocation / flag / message divergences are graded `warning`.
 */
import type { TimeReport } from "@/types";
import {
  buildTimeReportLegacyId,
  buildScheduledAllocationLegacyId,
  buildBillableDeviationAllocationLegacyId,
  buildInternalDeviationAllocationLegacyId,
  buildSubmittedEventLegacyId,
  buildSubmittedEventIdempotencyKey,
  buildAdminReviewFlagLegacyId,
  buildFlagOpenedEventLegacyId,
  buildCheckoutMessageLegacyId,
  deriveTimeReportStatus,
  deriveRequiresAdminReview,
  shouldCreateAdminReviewFlag,
  getCheckoutMessageText,
  ADMIN_REVIEW_FLAG_TYPE,
  type TimeReportUpsertRow,
  type TimeAllocationUpsertRow,
  type TimeReportEventInsertRow,
  type TimeReportFlagUpsertRow,
  type TimeReportFlagEventInsertRow,
  type TimeReportMessageInsertRow,
  type TimeReportingCheckoutContext,
} from "./timeReportingMigration";
import {
  buildMissionLogEntryLegacyId,
  buildMissionStaffSessionLegacyId,
} from "./missionLogMigration";
import {
  createParityCollector,
  type ParityCompareOptions,
  type ParityResult,
} from "./parityShared";

/**
 * The already-fetched Time Reporting rows for ONE legacy checkout. Shapes mirror
 * exactly what the dual-write writes (so tests can build fixtures with the same
 * mappers); `report` is null when no row was found in Supabase.
 */
export interface TimeReportingParityRows {
  report: TimeReportUpsertRow | null;
  allocations: TimeAllocationUpsertRow[];
  events: TimeReportEventInsertRow[];
  flags: TimeReportFlagUpsertRow[];
  flagEvents: TimeReportFlagEventInsertRow[];
  messages: TimeReportMessageInsertRow[];
}

const SUBMITTED_EVENT_TYPE = "time_report_submitted";

/**
 * Compares ONE legacy checkout {@link TimeReport} against its already-fetched
 * Time Reporting rows. Pure: no I/O, no logging. Returns the structured
 * {@link ParityResult} (a PASS carries no warning/blocking mismatch).
 */
export function compareTimeReportingParity(
  report: TimeReport,
  context: TimeReportingCheckoutContext,
  rows: TimeReportingParityRows,
  options: ParityCompareOptions = {},
): ParityResult {
  const c = createParityCollector("time_reporting", options);
  const reportLegacyId = buildTimeReportLegacyId(report);

  // ── time_reports row ──────────────────────────────────────────────────────
  const row = rows.report;
  if (!row) {
    c.add({
      type: "report.missing",
      table: "time_reports",
      sourceLegacyId: reportLegacyId,
      severity: "blocking",
      expected: reportLegacyId,
      actual: null,
    });
    return c.result();
  }

  const T = "time_reports";
  c.field(T, reportLegacyId, "legacy_id", reportLegacyId, row.legacy_id);
  c.field(T, reportLegacyId, "company_legacy_id", report.companyId, row.company_legacy_id);
  c.field(T, reportLegacyId, "work_order_legacy_id", report.workOrderId, row.work_order_legacy_id);
  c.field(T, reportLegacyId, "service_row_legacy_id", report.serviceRowId ?? null, row.service_row_legacy_id);
  c.field(T, reportLegacyId, "employee_legacy_id", report.employeeId ?? null, row.employee_legacy_id);
  c.field(T, reportLegacyId, "employee_name_snapshot", report.employeeName, row.employee_name_snapshot);
  c.field(T, reportLegacyId, "scheduled_duration_minutes", report.scheduledMinutes, row.scheduled_duration_minutes);
  c.field(T, reportLegacyId, "actual_duration_minutes", report.actualMinutes, row.actual_duration_minutes);
  c.field(T, reportLegacyId, "total_deviation_minutes", report.deviationMinutes, row.total_deviation_minutes);
  c.field(T, reportLegacyId, "status", deriveTimeReportStatus(report), row.status);
  c.field(T, reportLegacyId, "requires_admin_review", deriveRequiresAdminReview(report), row.requires_admin_review);
  c.field(T, reportLegacyId, "submitted_at", report.submittedAt, row.submitted_at);
  c.field(T, reportLegacyId, "mission_log_entry_legacy_id", buildMissionLogEntryLegacyId(report), row.mission_log_entry_legacy_id);
  c.field(T, reportLegacyId, "mission_staff_session_legacy_id", buildMissionStaffSessionLegacyId(report), row.mission_staff_session_legacy_id);

  // Invariants — silent payroll/invoice/AI divergence is blocking.
  c.field(T, reportLegacyId, "payroll_approval_status", "not_ready", row.payroll_approval_status, "blocking");
  c.field(T, reportLegacyId, "invoice_basis_status", "not_ready", row.invoice_basis_status, "blocking");
  c.field(T, reportLegacyId, "ai_recommendation", null, row.ai_recommendation, "blocking");

  // ── time_allocations ──────────────────────────────────────────────────────
  compareAllocations(report, rows.allocations, c);

  // ── time_report_events (soft submitted-action equivalence) ────────────────
  compareSubmittedEvent(report, rows.events, c);

  // ── time_report_flags + flag_opened event ─────────────────────────────────
  compareFlags(report, rows.flags, rows.flagEvents, c);

  // ── time_report_messages ──────────────────────────────────────────────────
  compareMessages(report, rows.messages, c);

  return c.result();
}

function compareAllocations(
  report: TimeReport,
  allocations: TimeAllocationUpsertRow[],
  c: ReturnType<typeof createParityCollector>,
): void {
  const T = "time_allocations";
  const scheduledId = buildScheduledAllocationLegacyId(report);
  const billableId = buildBillableDeviationAllocationLegacyId(report);
  const internalId = buildInternalDeviationAllocationLegacyId(report);

  // Expected id → expected minutes. The scheduled allocation is ALWAYS expected
  // (even at 0 minutes); deviation slices only when their minutes are > 0.
  const expected = new Map<string, number>();
  expected.set(scheduledId, report.scheduledMinutes);
  if (report.billableDeviationMinutes > 0) expected.set(billableId, report.billableDeviationMinutes);
  if (report.internalDeviationMinutes > 0) expected.set(internalId, report.internalDeviationMinutes);

  const byId = new Map(allocations.map((a) => [a.legacy_id, a]));

  for (const [id, minutes] of expected) {
    const found = byId.get(id);
    if (!found) {
      // The scheduled base allocation missing is a blocking divergence.
      c.add({
        type: "allocation.missing",
        table: T,
        sourceLegacyId: id,
        severity: id === scheduledId ? "blocking" : "warning",
        expected: minutes,
        actual: null,
      });
      continue;
    }
    c.field(T, id, "minutes", minutes, found.minutes);
  }

  for (const a of allocations) {
    if (!expected.has(a.legacy_id)) {
      c.add({
        type: "allocation.unexpected",
        table: T,
        sourceLegacyId: a.legacy_id,
        severity: "warning",
        actual: a.minutes,
        context: { allocationType: a.allocation_type },
      });
    }
  }
}

function compareSubmittedEvent(
  report: TimeReport,
  events: TimeReportEventInsertRow[],
  c: ReturnType<typeof createParityCollector>,
): void {
  const T = "time_report_events";
  const expectedLegacyId = buildSubmittedEventLegacyId(report);
  const submitted = events.filter((e) => e.event_type === SUBMITTED_EVENT_TYPE);

  if (submitted.length === 0) {
    c.add({
      type: "submitted_event.missing",
      table: T,
      sourceLegacyId: expectedLegacyId,
      severity: "blocking",
      expected: expectedLegacyId,
      actual: null,
    });
    return;
  }

  if (submitted.length > 1) {
    c.add({
      type: "submitted_event.duplicate",
      table: T,
      sourceLegacyId: expectedLegacyId,
      severity: "blocking",
      expected: 1,
      actual: submitted.length,
    });
  }

  const event = submitted[0];
  c.field(T, expectedLegacyId, "legacy_id", expectedLegacyId, event.legacy_id);
  c.field(T, expectedLegacyId, "idempotency_key", buildSubmittedEventIdempotencyKey(report), event.idempotency_key);
  // Soft audit equivalence: occurred_at represents the checkout/submitted moment.
  c.field(T, expectedLegacyId, "occurred_at", report.submittedAt, event.occurred_at);
}

function compareFlags(
  report: TimeReport,
  flags: TimeReportFlagUpsertRow[],
  flagEvents: TimeReportFlagEventInsertRow[],
  c: ReturnType<typeof createParityCollector>,
): void {
  const T = "time_report_flags";
  const expectFlag = shouldCreateAdminReviewFlag(report);
  const flagLegacyId = buildAdminReviewFlagLegacyId(report);
  const flag = flags.find((f) => f.legacy_id === flagLegacyId) ?? null;

  if (expectFlag) {
    if (!flag) {
      c.add({
        type: "flag.missing",
        table: T,
        sourceLegacyId: flagLegacyId,
        severity: "warning",
        expected: flagLegacyId,
        actual: null,
      });
    } else {
      c.field(T, flagLegacyId, "flag_type", ADMIN_REVIEW_FLAG_TYPE, flag.flag_type);
      c.field(T, flagLegacyId, "resolution_status", "open", flag.resolution_status);

      // The flag must carry its immutable opened event.
      const openedId = buildFlagOpenedEventLegacyId(report);
      const opened = flagEvents.find((e) => e.legacy_id === openedId) ?? null;
      if (!opened) {
        c.add({
          type: "flag_opened_event.missing",
          table: "time_report_flag_events",
          sourceLegacyId: openedId,
          severity: "warning",
          expected: openedId,
          actual: null,
        });
      }
    }
  } else if (flag) {
    // Auto-approved checkouts must NOT raise a flag.
    c.add({
      type: "flag.unexpected",
      table: T,
      sourceLegacyId: flagLegacyId,
      severity: "warning",
      actual: flag.resolution_status,
    });
  }
}

function compareMessages(
  report: TimeReport,
  messages: TimeReportMessageInsertRow[],
  c: ReturnType<typeof createParityCollector>,
): void {
  const T = "time_report_messages";
  const expectedText = getCheckoutMessageText(report);
  const messageLegacyId = buildCheckoutMessageLegacyId(report);
  const message = messages.find((m) => m.legacy_id === messageLegacyId) ?? null;

  if (expectedText !== null) {
    if (!message) {
      c.add({
        type: "message.missing",
        table: T,
        sourceLegacyId: messageLegacyId,
        severity: "warning",
        expected: messageLegacyId,
        actual: null,
      });
    } else {
      c.field(T, messageLegacyId, "message", expectedText, message.message);
    }
  } else if (message) {
    // No real comment → no message should have been fabricated.
    c.add({
      type: "message.unexpected",
      table: T,
      sourceLegacyId: messageLegacyId,
      severity: "warning",
      actual: null,
    });
  }
}
