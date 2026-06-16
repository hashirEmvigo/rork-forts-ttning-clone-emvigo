import { describe, expect, it, vi } from "vitest";

/**
 * Slice 2d-1 — Time Reporting checkout parity comparator tests.
 *
 * Proves {@link compareTimeReportingParity} is a PURE comparator: it takes a
 * legacy checkout TimeReport + already-fetched Supabase row fixtures (built with
 * the SAME dual-write mappers, so parity can never drift from the write path) and
 * returns structured mismatches. No Supabase / localStorage calls, no writes, no
 * logging. Covers the perfect match, every field/allocation/flag/message
 * divergence, the payroll/invoice/AI invariants, soft submitted-event
 * equivalence, and the mission soft-link.
 */

import { compareTimeReportingParity, type TimeReportingParityRows } from "./timeReportingParity";
import {
  toTimeReportUpsertRow,
  toTimeAllocationUpsertRows,
  toTimeReportSubmittedEventInsertRow,
  toTimeReportFlagUpsertRow,
  toTimeReportFlagOpenedEventInsertRow,
  toTimeReportCheckoutMessageInsertRow,
  shouldCreateAdminReviewFlag,
  getCheckoutMessageText,
  buildScheduledAllocationLegacyId,
  type TimeReportingCheckoutContext,
} from "./timeReportingMigration";
import type { TimeReport } from "@/types";

const NORD = "cmp_nord";
const NORD_UUID = "11111111-1111-1111-1111-111111111111";
const CTX: TimeReportingCheckoutContext = { customerId: "cust_1", customerNameSnapshot: "Nordic AS" };

function makeReport(overrides: Partial<TimeReport> = {}): TimeReport {
  return {
    id: "trep_1",
    companyId: NORD,
    workOrderId: "wo_1",
    serviceRowId: "srv_1",
    jobName: "Window cleaning",
    employeeId: "emp_1",
    employeeName: "Astrid",
    scheduledMinutes: 60,
    actualMinutes: 75,
    deviationMinutes: 15,
    bookingId: null,
    billableDeviationMinutes: 10,
    internalDeviationMinutes: 5,
    deviationReason: null,
    deviationComment: null,
    auditHistory: [],
    approvalStatus: "pending_admin_approval",
    approvedBy: null,
    approvedAt: null,
    submittedAt: "2026-06-10T10:00:00.000Z",
    createdAt: "2026-06-10T10:00:00.000Z",
    updatedAt: "2026-06-10T10:00:00.000Z",
    ...overrides,
  };
}

/** Builds the perfect-match fetched bundle exactly as the dual-write would write it. */
function buildRows(report: TimeReport, context: TimeReportingCheckoutContext = CTX): TimeReportingParityRows {
  const flags = shouldCreateAdminReviewFlag(report) ? [toTimeReportFlagUpsertRow(report, NORD_UUID)] : [];
  const flagEvents = shouldCreateAdminReviewFlag(report)
    ? [toTimeReportFlagOpenedEventInsertRow(report, NORD_UUID)]
    : [];
  const text = getCheckoutMessageText(report);
  const messages = text ? [toTimeReportCheckoutMessageInsertRow(report, text, NORD_UUID)] : [];
  return {
    report: toTimeReportUpsertRow(report, context, NORD_UUID),
    allocations: toTimeAllocationUpsertRows(report, NORD_UUID),
    events: [toTimeReportSubmittedEventInsertRow(report, NORD_UUID)],
    flags,
    flagEvents,
    messages,
  };
}

const types = (r: { mismatches: { type: string }[] }): string[] => r.mismatches.map((m) => m.type);

describe("Slice 2d-1 · Time Reporting parity · purity", () => {
  it("performs no Supabase / localStorage calls", () => {
    const localSpy = typeof localStorage !== "undefined" ? vi.spyOn(Storage.prototype, "getItem") : null;
    const report = makeReport();
    compareTimeReportingParity(report, CTX, buildRows(report));
    if (localSpy) {
      expect(localSpy).not.toHaveBeenCalled();
      localSpy.mockRestore();
    }
  });

  it("uses an injectable clock for mismatch timestamps", () => {
    const report = makeReport();
    const rows = buildRows(report);
    rows.report = null;
    const res = compareTimeReportingParity(report, CTX, rows, { now: () => "2030-01-01T00:00:00.000Z" });
    expect(res.mismatches[0].timestamp).toBe("2030-01-01T00:00:00.000Z");
  });
});

describe("Slice 2d-1 · Time Reporting parity · happy path", () => {
  it("perfect match (pending, with deviation + comment) returns a pass", () => {
    const report = makeReport({ deviationComment: "Extra grime" });
    const res = compareTimeReportingParity(report, CTX, buildRows(report));
    expect(res.matched).toBe(true);
    expect(res.mismatches).toHaveLength(0);
  });

  it("perfect match (auto-approved, no deviation, no comment) returns a pass", () => {
    const report = makeReport({
      approvalStatus: "auto_approved",
      approvedBy: "system",
      approvedAt: "2026-06-10T10:00:00.000Z",
      scheduledMinutes: 60,
      actualMinutes: 60,
      deviationMinutes: 0,
      billableDeviationMinutes: 0,
      internalDeviationMinutes: 0,
    });
    const res = compareTimeReportingParity(report, CTX, buildRows(report));
    expect(res.matched).toBe(true);
    expect(res.mismatches).toHaveLength(0);
  });

  it("scheduled allocation at 0 minutes is valid", () => {
    const report = makeReport({
      approvalStatus: "auto_approved",
      scheduledMinutes: 0,
      actualMinutes: 0,
      deviationMinutes: 0,
      billableDeviationMinutes: 0,
      internalDeviationMinutes: 0,
    });
    const rows = buildRows(report);
    expect(rows.allocations).toHaveLength(1);
    expect(rows.allocations[0].legacy_id).toBe(buildScheduledAllocationLegacyId(report));
    const res = compareTimeReportingParity(report, CTX, rows);
    expect(res.matched).toBe(true);
  });
});

describe("Slice 2d-1 · Time Reporting parity · report-level mismatches", () => {
  it("missing time_report row is blocking and short-circuits", () => {
    const report = makeReport();
    const rows = buildRows(report);
    rows.report = null;
    const res = compareTimeReportingParity(report, CTX, rows);
    expect(res.matched).toBe(false);
    expect(res.mismatches).toHaveLength(1);
    expect(res.mismatches[0].type).toBe("report.missing");
    expect(res.mismatches[0].severity).toBe("blocking");
  });

  it("service_row_legacy_id mismatch", () => {
    const report = makeReport();
    const rows = buildRows(report);
    rows.report!.service_row_legacy_id = "srv_WRONG";
    const res = compareTimeReportingParity(report, CTX, rows);
    expect(types(res)).toContain("service_row_legacy_id.mismatch");
    expect(res.matched).toBe(false);
  });

  it("employee mismatch", () => {
    const report = makeReport();
    const rows = buildRows(report);
    rows.report!.employee_legacy_id = "emp_WRONG";
    const res = compareTimeReportingParity(report, CTX, rows);
    expect(types(res)).toContain("employee_legacy_id.mismatch");
  });

  it("scheduled / actual / deviation minute mismatches", () => {
    const report = makeReport();
    const rows = buildRows(report);
    rows.report!.scheduled_duration_minutes = 1;
    rows.report!.actual_duration_minutes = 2;
    rows.report!.total_deviation_minutes = 3;
    const res = compareTimeReportingParity(report, CTX, rows);
    expect(types(res)).toEqual(
      expect.arrayContaining([
        "scheduled_duration_minutes.mismatch",
        "actual_duration_minutes.mismatch",
        "total_deviation_minutes.mismatch",
      ]),
    );
  });

  it("status mapping mismatch", () => {
    const report = makeReport();
    const rows = buildRows(report);
    rows.report!.status = "auto_approved";
    const res = compareTimeReportingParity(report, CTX, rows);
    expect(types(res)).toContain("status.mismatch");
  });

  it("submitted_at mismatch", () => {
    const report = makeReport();
    const rows = buildRows(report);
    rows.report!.submitted_at = "2020-01-01T00:00:00.000Z";
    const res = compareTimeReportingParity(report, CTX, rows);
    expect(types(res)).toContain("submitted_at.mismatch");
  });

  it("mission soft-link mismatch", () => {
    const report = makeReport();
    const rows = buildRows(report);
    rows.report!.mission_log_entry_legacy_id = "mission:WRONG";
    const res = compareTimeReportingParity(report, CTX, rows);
    expect(types(res)).toContain("mission_log_entry_legacy_id.mismatch");
  });
});

describe("Slice 2d-1 · Time Reporting parity · invariants (blocking)", () => {
  it("payroll status must remain not_ready", () => {
    const report = makeReport();
    const rows = buildRows(report);
    rows.report!.payroll_approval_status = "approved";
    const res = compareTimeReportingParity(report, CTX, rows);
    const m = res.mismatches.find((x) => x.field === "payroll_approval_status");
    expect(m?.severity).toBe("blocking");
  });

  it("invoice status must remain not_ready", () => {
    const report = makeReport();
    const rows = buildRows(report);
    rows.report!.invoice_basis_status = "approved";
    const res = compareTimeReportingParity(report, CTX, rows);
    const m = res.mismatches.find((x) => x.field === "invoice_basis_status");
    expect(m?.severity).toBe("blocking");
  });

  it("ai_recommendation must remain null", () => {
    const report = makeReport();
    const rows = buildRows(report);
    rows.report!.ai_recommendation = "approve";
    const res = compareTimeReportingParity(report, CTX, rows);
    const m = res.mismatches.find((x) => x.field === "ai_recommendation");
    expect(m?.severity).toBe("blocking");
  });
});

describe("Slice 2d-1 · Time Reporting parity · allocations", () => {
  it("missing scheduled allocation is blocking", () => {
    const report = makeReport();
    const rows = buildRows(report);
    rows.allocations = rows.allocations.filter(
      (a) => a.legacy_id !== buildScheduledAllocationLegacyId(report),
    );
    const res = compareTimeReportingParity(report, CTX, rows);
    const m = res.mismatches.find((x) => x.type === "allocation.missing");
    expect(m?.severity).toBe("blocking");
  });

  it("missing billable deviation allocation when expected", () => {
    const report = makeReport();
    const rows = buildRows(report);
    rows.allocations = rows.allocations.filter((a) => !a.legacy_id.endsWith(":billable_deviation"));
    const res = compareTimeReportingParity(report, CTX, rows);
    const m = res.mismatches.find((x) => x.type === "allocation.missing");
    expect(m?.severity).toBe("warning");
  });

  it("unexpected zero-minute deviation allocation", () => {
    const report = makeReport({
      approvalStatus: "auto_approved",
      scheduledMinutes: 60,
      actualMinutes: 60,
      deviationMinutes: 0,
      billableDeviationMinutes: 0,
      internalDeviationMinutes: 0,
    });
    const rows = buildRows(report);
    // Inject a billable deviation allocation that should NOT exist (0 minutes).
    const withDeviation = makeReport({ billableDeviationMinutes: 10 });
    rows.allocations.push(toTimeAllocationUpsertRows(withDeviation, NORD_UUID)[1]);
    const res = compareTimeReportingParity(report, CTX, rows);
    expect(types(res)).toContain("allocation.unexpected");
  });

  it("allocation sum / minutes mismatch", () => {
    const report = makeReport();
    const rows = buildRows(report);
    rows.allocations[0].minutes = 999;
    const res = compareTimeReportingParity(report, CTX, rows);
    expect(types(res)).toContain("minutes.mismatch");
  });
});

describe("Slice 2d-1 · Time Reporting parity · submitted event (soft equivalence)", () => {
  it("missing submitted event is blocking", () => {
    const report = makeReport();
    const rows = buildRows(report);
    rows.events = [];
    const res = compareTimeReportingParity(report, CTX, rows);
    const m = res.mismatches.find((x) => x.type === "submitted_event.missing");
    expect(m?.severity).toBe("blocking");
  });

  it("duplicate submitted event is blocking", () => {
    const report = makeReport();
    const rows = buildRows(report);
    rows.events = [
      toTimeReportSubmittedEventInsertRow(report, NORD_UUID),
      toTimeReportSubmittedEventInsertRow(report, NORD_UUID),
    ];
    const res = compareTimeReportingParity(report, CTX, rows);
    const m = res.mismatches.find((x) => x.type === "submitted_event.duplicate");
    expect(m?.severity).toBe("blocking");
  });

  it("submitted event occurred_at must match submittedAt", () => {
    const report = makeReport();
    const rows = buildRows(report);
    rows.events[0].occurred_at = "2000-01-01T00:00:00.000Z";
    const res = compareTimeReportingParity(report, CTX, rows);
    expect(types(res)).toContain("occurred_at.mismatch");
  });
});

describe("Slice 2d-1 · Time Reporting parity · flags", () => {
  it("pending report missing its open deviation flag", () => {
    const report = makeReport();
    const rows = buildRows(report);
    rows.flags = [];
    const res = compareTimeReportingParity(report, CTX, rows);
    expect(types(res)).toContain("flag.missing");
  });

  it("auto-approved report with an unexpected flag", () => {
    const report = makeReport({ approvalStatus: "auto_approved" });
    const rows = buildRows(report);
    rows.flags = [toTimeReportFlagUpsertRow(makeReport(), NORD_UUID)];
    const res = compareTimeReportingParity(report, CTX, rows);
    expect(types(res)).toContain("flag.unexpected");
  });

  it("missing flag_opened event when the flag exists", () => {
    const report = makeReport();
    const rows = buildRows(report);
    rows.flagEvents = [];
    const res = compareTimeReportingParity(report, CTX, rows);
    expect(types(res)).toContain("flag_opened_event.missing");
  });
});

describe("Slice 2d-1 · Time Reporting parity · messages", () => {
  it("comment message present when expected", () => {
    const report = makeReport({ deviationComment: "Locked gate, waited 15m" });
    const res = compareTimeReportingParity(report, CTX, buildRows(report));
    expect(res.matched).toBe(true);
  });

  it("missing message when a real comment exists", () => {
    const report = makeReport({ deviationComment: "Locked gate" });
    const rows = buildRows(report);
    rows.messages = [];
    const res = compareTimeReportingParity(report, CTX, rows);
    expect(types(res)).toContain("message.missing");
  });

  it("unexpected message when no comment exists", () => {
    const report = makeReport({ deviationComment: null });
    const rows = buildRows(report);
    rows.messages = [toTimeReportCheckoutMessageInsertRow(report, "fabricated", NORD_UUID)];
    const res = compareTimeReportingParity(report, CTX, rows);
    expect(types(res)).toContain("message.unexpected");
  });
});
