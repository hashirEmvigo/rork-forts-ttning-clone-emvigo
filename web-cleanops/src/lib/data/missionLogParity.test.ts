import { describe, expect, it } from "vitest";

/**
 * Slice 2d-1 — Mission Log checkout parity comparator tests.
 *
 * Proves {@link compareMissionLogParity} is a PURE comparator: it takes a legacy
 * checkout TimeReport + already-fetched Mission Log row fixtures (built with the
 * SAME dual-write mappers) and returns structured mismatches. No Supabase /
 * localStorage calls, no writes, no logging. Covers the present-and-matching
 * path, field divergences, the duplicate checked_out event, and the critical
 * dual-write-state behaviour: rows missing while dual-write is OFF are graded
 * `info` (a PASS), while missing rows with dual-write ON are `blocking`.
 */

import { compareMissionLogParity, type MissionLogParityRows } from "./missionLogParity";
import {
  toMissionLogEntryUpsertRow,
  toMissionStaffSessionUpsertRow,
  toMissionCheckoutEventInsertRow,
  type MissionLogCheckoutContext,
} from "./missionLogMigration";
import type { TimeReport } from "@/types";

const NORD = "cmp_nord";
const NORD_UUID = "11111111-1111-1111-1111-111111111111";
const CTX: MissionLogCheckoutContext = { customerId: "cust_1", customerNameSnapshot: "Nordic AS" };

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

/** Builds the perfect-match Mission Log fetched bundle as the dual-write would. */
function buildRows(report: TimeReport, context: MissionLogCheckoutContext = CTX): MissionLogParityRows {
  return {
    entry: toMissionLogEntryUpsertRow(report, context, NORD_UUID),
    session: toMissionStaffSessionUpsertRow(report, NORD_UUID),
    events: [toMissionCheckoutEventInsertRow(report, NORD_UUID)],
  };
}

const empty = (): MissionLogParityRows => ({ entry: null, session: null, events: [] });
const types = (r: { mismatches: { type: string }[] }): string[] => r.mismatches.map((m) => m.type);

describe("Slice 2d-1 · Mission Log parity · dual-write ON, present + matching", () => {
  it("rows present and matching returns a pass", () => {
    const report = makeReport();
    const res = compareMissionLogParity(report, CTX, buildRows(report), {
      missionLogDualWriteEnabled: true,
    });
    expect(res.matched).toBe(true);
    expect(res.mismatches).toHaveLength(0);
  });

  it("service_row_legacy_id mismatch on the entry", () => {
    const report = makeReport();
    const rows = buildRows(report);
    rows.entry!.service_row_legacy_id = "srv_WRONG";
    const res = compareMissionLogParity(report, CTX, rows, { missionLogDualWriteEnabled: true });
    expect(types(res)).toContain("service_row_legacy_id.mismatch");
    expect(res.matched).toBe(false);
  });

  it("session deterministic id / employee mismatch", () => {
    const report = makeReport();
    const rows = buildRows(report);
    rows.session!.employee_legacy_id = "emp_WRONG";
    const res = compareMissionLogParity(report, CTX, rows, { missionLogDualWriteEnabled: true });
    expect(types(res)).toContain("employee_legacy_id.mismatch");
  });

  it("checked_out event occurred_at must match submittedAt", () => {
    const report = makeReport();
    const rows = buildRows(report);
    rows.events[0].occurred_at = "2000-01-01T00:00:00.000Z";
    const res = compareMissionLogParity(report, CTX, rows, { missionLogDualWriteEnabled: true });
    expect(types(res)).toContain("occurred_at.mismatch");
  });

  it("duplicate checked_out event is blocking", () => {
    const report = makeReport();
    const rows = buildRows(report);
    rows.events = [
      toMissionCheckoutEventInsertRow(report, NORD_UUID),
      toMissionCheckoutEventInsertRow(report, NORD_UUID),
    ];
    const res = compareMissionLogParity(report, CTX, rows, { missionLogDualWriteEnabled: true });
    const m = res.mismatches.find((x) => x.type === "checked_out_event.duplicate");
    expect(m?.severity).toBe("blocking");
  });
});

describe("Slice 2d-1 · Mission Log parity · dual-write ON, missing rows = blocking", () => {
  it("missing entry / session / checked_out event are blocking", () => {
    const report = makeReport();
    const res = compareMissionLogParity(report, CTX, empty(), { missionLogDualWriteEnabled: true });
    expect(res.matched).toBe(false);
    expect(types(res)).toEqual(
      expect.arrayContaining(["entry.missing", "session.missing", "checked_out_event.missing"]),
    );
    expect(res.mismatches.every((m) => m.severity === "blocking")).toBe(true);
  });
});

describe("Slice 2d-1 · Mission Log parity · dual-write OFF, missing rows = info", () => {
  it("missing rows are info (expected), not blocking, and still a pass", () => {
    const report = makeReport();
    const res = compareMissionLogParity(report, CTX, empty(), { missionLogDualWriteEnabled: false });
    expect(res.matched).toBe(true);
    expect(types(res)).toEqual(
      expect.arrayContaining([
        "entry.absent_expected",
        "session.absent_expected",
        "checked_out_event.absent_expected",
      ]),
    );
    expect(res.mismatches.every((m) => m.severity === "info")).toBe(true);
  });

  it("rows present while OFF are still validated (a real divergence warns)", () => {
    const report = makeReport();
    const rows = buildRows(report);
    rows.entry!.work_order_legacy_id = "wo_WRONG";
    const res = compareMissionLogParity(report, CTX, rows, { missionLogDualWriteEnabled: false });
    expect(types(res)).toContain("work_order_legacy_id.mismatch");
    expect(res.matched).toBe(false);
  });
});
