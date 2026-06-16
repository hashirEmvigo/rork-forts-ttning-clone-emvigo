import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Slice 2d-2 — Time Reporting parity fetch runner + sanitized telemetry tests.
 *
 * Proves {@link runTimeReportingParityForReport} / {@link
 * runTimeReportingParityBatch} are READ-ONLY, gated and never-throwing: with the
 * gate off nothing is fetched / recorded; with it on they fetch the Supabase
 * rows by deterministic id, run the PURE comparators and record SANITIZED
 * telemetry. Covers perfect match, the severity + per-domain counters, missing
 * Supabase / missing legacy, fetch + comparator failure recovery, the
 * Mission Log OFF/ON absence grading, the recent-mismatch cap, the centralized
 * sanitizer (comments / message bodies / payloads stripped) and the strict
 * read-only boundary (no writes).
 */

type Row = Record<string, unknown>;

const mocks = vi.hoisted(() => {
  class FakeQuery {
    private filters: Array<[string, unknown]> = [];
    constructor(
      private readonly client: FakeClient,
      private readonly table: string,
    ) {}

    select(_cols?: string): this {
      return this;
    }
    eq(column: string, value: unknown): this {
      this.filters.push([column, value]);
      return this;
    }
    is(column: string, value: unknown): this {
      this.filters.push([column, value]);
      return this;
    }

    private apply(): Row[] {
      const rows = this.client.rows(this.table);
      return rows.filter((r) => this.filters.every(([c, v]) => r[c] === v));
    }

    private failure(): { message: string } | null {
      return this.client.failOn.has(this.table)
        ? { message: `boom:${this.table}` }
        : null;
    }

    async maybeSingle(): Promise<{ data: Row | null; error: { message: string } | null }> {
      const error = this.failure();
      if (error) return { data: null, error };
      const matches = this.apply();
      return { data: matches[0] ?? null, error: null };
    }

    // Thenable: awaiting the builder resolves to the filtered list.
    then<TResult1 = { data: Row[] | null; error: { message: string } | null }>(
      onfulfilled?: (value: { data: Row[] | null; error: { message: string } | null }) => TResult1,
    ): Promise<TResult1> {
      const error = this.failure();
      const value = error ? { data: null, error } : { data: this.apply(), error: null };
      return Promise.resolve(onfulfilled ? onfulfilled(value) : (value as unknown as TResult1));
    }
  }

  class FakeClient {
    tables = new Map<string, Row[]>();
    failOn = new Set<string>();
    /** Records any forbidden write call so tests can assert read-only. */
    writeCalls: string[] = [];

    rows(name: string): Row[] {
      if (!this.tables.has(name)) this.tables.set(name, []);
      return this.tables.get(name) as Row[];
    }

    seed<T extends object>(name: string, rows: readonly T[]): void {
      this.rows(name).push(...(rows as unknown as Row[]));
    }

    from(name: string) {
      const query = new FakeQuery(this, name);
      // Attach write spies that should NEVER be called by the runner.
      return Object.assign(query, {
        upsert: (..._args: unknown[]) => {
          this.writeCalls.push(`${name}.upsert`);
          return Promise.resolve({ error: null });
        },
        insert: (..._args: unknown[]) => {
          this.writeCalls.push(`${name}.insert`);
          return Promise.resolve({ error: null });
        },
        update: (..._args: unknown[]) => {
          this.writeCalls.push(`${name}.update`);
          return Promise.resolve({ error: null });
        },
        delete: (..._args: unknown[]) => {
          this.writeCalls.push(`${name}.delete`);
          return Promise.resolve({ error: null });
        },
      });
    }

    reset(): void {
      this.tables.clear();
      this.failOn.clear();
      this.writeCalls = [];
    }
  }

  return { holder: { client: new FakeClient(), configured: true } };
});

vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return mocks.holder.client;
  },
  get isSupabaseConfigured() {
    return mocks.holder.configured;
  },
}));

import {
  runTimeReportingParityForReport,
  runTimeReportingParityBatch,
  shouldRunTimeReportingShadowValidation,
  type ParityReportInput,
} from "./timeReportingParityRunner";
import {
  getTimeReportingParityState,
  resetTimeReportingParityState,
  sanitizeParityMismatch,
  REDACTED,
} from "./timeReportingParityState";
import {
  toTimeReportUpsertRow,
  toTimeAllocationUpsertRows,
  toTimeReportSubmittedEventInsertRow,
  toTimeReportFlagUpsertRow,
  toTimeReportFlagOpenedEventInsertRow,
  toTimeReportCheckoutMessageInsertRow,
  buildTimeReportLegacyId,
  getCheckoutMessageText,
  type TimeReportingCheckoutContext,
} from "./timeReportingMigration";
import {
  toMissionLogEntryUpsertRow,
  toMissionStaffSessionUpsertRow,
  toMissionCheckoutEventInsertRow,
} from "./missionLogMigration";
import type { ParityMismatch } from "./parityShared";
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

/** Seeds the Supabase fake with the rows the dual-write would have written. */
function seedTimeReporting(report: TimeReport, context: TimeReportingCheckoutContext = CTX): void {
  const c = mocks.holder.client;
  c.seed("time_reports", [toTimeReportUpsertRow(report, context, NORD_UUID)]);
  c.seed("time_allocations", toTimeAllocationUpsertRows(report, NORD_UUID));
  c.seed("time_report_events", [toTimeReportSubmittedEventInsertRow(report, NORD_UUID)]);
  if (report.approvalStatus !== "auto_approved") {
    c.seed("time_report_flags", [toTimeReportFlagUpsertRow(report, NORD_UUID)]);
    c.seed("time_report_flag_events", [toTimeReportFlagOpenedEventInsertRow(report, NORD_UUID)]);
  }
  const messageText = getCheckoutMessageText(report);
  if (messageText) {
    c.seed("time_report_messages", [
      toTimeReportCheckoutMessageInsertRow(report, messageText, NORD_UUID),
    ]);
  }
}

/** Seeds the Mission Log fake with the rows the dual-write would have written. */
function seedMissionLog(report: TimeReport): void {
  const c = mocks.holder.client;
  c.seed("mission_log_entries", [toMissionLogEntryUpsertRow(report, CTX, NORD_UUID)]);
  c.seed("mission_staff_sessions", [toMissionStaffSessionUpsertRow(report, NORD_UUID)]);
  c.seed("mission_log_events", [toMissionCheckoutEventInsertRow(report, NORD_UUID)]);
}

const ON = { enabled: true } as const;

beforeEach(() => {
  mocks.holder.client.reset();
  mocks.holder.configured = true;
  resetTimeReportingParityState();
});

describe("Slice 2d-2 · gate (TIME_REPORTING_SHADOW_VALIDATE default OFF)", () => {
  it("is OFF by default and a run with the gate off fetches nothing / records nothing", async () => {
    expect(shouldRunTimeReportingShadowValidation()).toBe(false);
    seedTimeReporting(makeReport());
    const res = await runTimeReportingParityForReport(makeReport(), CTX);
    expect(res.ran).toBe(false);
    expect(res.skippedReason).toBe("disabled");
    expect(res.timeReporting).toBeNull();
    expect(getTimeReportingParityState().totalChecked).toBe(0);
    expect(mocks.holder.client.writeCalls).toHaveLength(0);
  });

  it("flag ON (enabled override) runs the validation", async () => {
    seedTimeReporting(makeReport());
    const res = await runTimeReportingParityForReport(makeReport(), CTX, ON);
    expect(res.ran).toBe(true);
    expect(res.timeReporting).not.toBeNull();
    expect(getTimeReportingParityState().totalChecked).toBe(1);
  });
});

describe("Slice 2d-2 · perfect match + counters", () => {
  it("a perfect match updates matched, not mismatched", async () => {
    seedTimeReporting(makeReport());
    const res = await runTimeReportingParityForReport(makeReport(), CTX, ON);
    expect(res.timeReporting?.matched).toBe(true);
    const s = getTimeReportingParityState();
    expect(s.matched).toBe(1);
    expect(s.mismatched).toBe(0);
    expect(s.blocking).toBe(0);
    expect(s.warning).toBe(0);
  });

  it("never writes (read-only) on a full run incl. Mission Log", async () => {
    const report = makeReport({ deviationComment: "Extra room" });
    seedTimeReporting(report);
    seedMissionLog(report);
    await runTimeReportingParityForReport(report, CTX, {
      enabled: true,
      includeMissionLog: true,
      missionLogDualWriteEnabled: true,
    });
    expect(mocks.holder.client.writeCalls).toHaveLength(0);
  });
});

describe("Slice 2d-2 · mismatch severity counters", () => {
  it("a blocking mismatch (missing report) updates blocking + missingInSupabase", async () => {
    // Nothing seeded → the report row is missing (blocking) + missing-in-Supabase.
    const res = await runTimeReportingParityForReport(makeReport(), CTX, ON);
    expect(res.timeReporting?.matched).toBe(false);
    const s = getTimeReportingParityState();
    expect(s.mismatched).toBe(1);
    expect(s.blocking).toBeGreaterThanOrEqual(1);
    expect(s.missingInSupabase).toBe(1);
  });

  it("a warning mismatch (service_row divergence) updates warning", async () => {
    const report = makeReport();
    seedTimeReporting(report);
    mocks.holder.client.rows("time_reports")[0].service_row_legacy_id = "srv_WRONG";
    await runTimeReportingParityForReport(report, CTX, ON);
    const s = getTimeReportingParityState();
    expect(s.warning).toBeGreaterThanOrEqual(1);
    expect(s.mismatched).toBe(1);
  });

  it("an info mismatch (Mission Log absent, dual-write OFF) is info, still a pass", async () => {
    const report = makeReport();
    seedTimeReporting(report);
    // No Mission Log rows seeded; dual-write considered OFF → absence = info.
    const res = await runTimeReportingParityForReport(report, CTX, {
      enabled: true,
      includeMissionLog: true,
      missionLogDualWriteEnabled: false,
    });
    expect(res.missionLog?.matched).toBe(true);
    const s = getTimeReportingParityState();
    expect(s.info).toBeGreaterThanOrEqual(1);
  });
});

describe("Slice 2d-2 · per-domain aggregation", () => {
  it("allocation mismatch aggregation", async () => {
    const report = makeReport();
    seedTimeReporting(report);
    mocks.holder.client
      .rows("time_allocations")
      .find((a) => a.legacy_id === "alloc:trep_1:scheduled")!.minutes = 999;
    await runTimeReportingParityForReport(report, CTX, ON);
    expect(getTimeReportingParityState().allocationMismatches).toBeGreaterThanOrEqual(1);
  });

  it("status mismatch aggregation", async () => {
    const report = makeReport();
    seedTimeReporting(report);
    mocks.holder.client.rows("time_reports")[0].status = "auto_approved";
    await runTimeReportingParityForReport(report, CTX, ON);
    expect(getTimeReportingParityState().statusMismatches).toBeGreaterThanOrEqual(1);
  });

  it("flag mismatch aggregation (unexpected flag on auto-approved)", async () => {
    const report = makeReport({ approvalStatus: "auto_approved" });
    seedTimeReporting(report);
    // Seed an unexpected flag for an auto-approved report.
    mocks.holder.client.seed("time_report_flags", [
      toTimeReportFlagUpsertRow(makeReport(), NORD_UUID),
    ]);
    await runTimeReportingParityForReport(report, CTX, ON);
    expect(getTimeReportingParityState().flagMismatches).toBeGreaterThanOrEqual(1);
  });

  it("event mismatch aggregation (missing submitted event)", async () => {
    const report = makeReport();
    seedTimeReporting(report);
    mocks.holder.client.tables.set("time_report_events", []);
    await runTimeReportingParityForReport(report, CTX, ON);
    expect(getTimeReportingParityState().eventMismatches).toBeGreaterThanOrEqual(1);
  });

  it("message mismatch aggregation (missing message when comment exists)", async () => {
    const report = makeReport({ deviationComment: "Extra room" });
    seedTimeReporting(report);
    mocks.holder.client.tables.set("time_report_messages", []);
    await runTimeReportingParityForReport(report, CTX, ON);
    expect(getTimeReportingParityState().messageMismatches).toBeGreaterThanOrEqual(1);
  });

  it("mission-link mismatch aggregation (Mission Log ON, rows missing)", async () => {
    const report = makeReport();
    seedTimeReporting(report);
    const res = await runTimeReportingParityForReport(report, CTX, {
      enabled: true,
      includeMissionLog: true,
      missionLogDualWriteEnabled: true,
    });
    expect(res.missionLog?.matched).toBe(false);
    expect(getTimeReportingParityState().missionLinkMismatches).toBeGreaterThanOrEqual(1);
  });
});

describe("Slice 2d-2 · Mission Log OFF vs ON absence grading", () => {
  it("OFF → missing Mission Log rows are info / non-blocking (pass)", async () => {
    const report = makeReport();
    seedTimeReporting(report);
    const res = await runTimeReportingParityForReport(report, CTX, {
      enabled: true,
      includeMissionLog: true,
      missionLogDualWriteEnabled: false,
    });
    expect(res.missionLog?.matched).toBe(true);
    expect(res.missionLog?.mismatches.every((m) => m.severity === "info")).toBe(true);
  });

  it("ON → missing Mission Log rows are blocking", async () => {
    const report = makeReport();
    seedTimeReporting(report);
    const res = await runTimeReportingParityForReport(report, CTX, {
      enabled: true,
      includeMissionLog: true,
      missionLogDualWriteEnabled: true,
    });
    expect(res.missionLog?.matched).toBe(false);
    expect(getTimeReportingParityState().blocking).toBeGreaterThanOrEqual(1);
  });

  it("ON → Mission Log rows present + matching is a pass", async () => {
    const report = makeReport();
    seedTimeReporting(report);
    seedMissionLog(report);
    const res = await runTimeReportingParityForReport(report, CTX, {
      enabled: true,
      includeMissionLog: true,
      missionLogDualWriteEnabled: true,
    });
    expect(res.missionLog?.matched).toBe(true);
  });
});

describe("Slice 2d-2 · batch mode", () => {
  it("validates each report and counts them", async () => {
    const a = makeReport({ id: "trep_a" });
    const b = makeReport({ id: "trep_b" });
    seedTimeReporting(a);
    seedTimeReporting(b);
    const inputs: ParityReportInput[] = [
      { report: a, context: CTX },
      { report: b, context: CTX },
    ];
    const res = await runTimeReportingParityBatch(inputs, ON);
    expect(res.ran).toBe(true);
    expect(res.checked).toBe(2);
    expect(getTimeReportingParityState().totalChecked).toBe(2);
  });

  it("records missing-in-legacy for a Supabase id absent from the batch", async () => {
    const a = makeReport({ id: "trep_a" });
    seedTimeReporting(a);
    const res = await runTimeReportingParityBatch([{ report: a, context: CTX }], {
      enabled: true,
      supabaseReportLegacyIds: [buildTimeReportLegacyId(a), "treport:trep_ghost"],
    });
    expect(res.missingInLegacy).toEqual(["treport:trep_ghost"]);
    expect(getTimeReportingParityState().missingInLegacy).toBe(1);
  });

  it("gate OFF → batch does not run", async () => {
    const res = await runTimeReportingParityBatch([{ report: makeReport(), context: CTX }]);
    expect(res.ran).toBe(false);
    expect(res.skippedReason).toBe("disabled");
    expect(getTimeReportingParityState().totalChecked).toBe(0);
  });
});

describe("Slice 2d-2 · failure handling (never throws)", () => {
  it("a Supabase fetch failure is recorded and does not throw", async () => {
    mocks.holder.client.failOn.add("time_reports");
    const res = await runTimeReportingParityForReport(makeReport(), CTX, ON);
    expect(res.fetchError).toContain("time_reports fetch failed");
    const s = getTimeReportingParityState();
    expect(s.fetchFailures).toBe(1);
    expect(s.lastError).toContain("time_reports fetch failed");
  });

  it("an unconfigured client is recorded as a failure, not thrown", async () => {
    mocks.holder.configured = false;
    const res = await runTimeReportingParityForReport(makeReport(), CTX, ON);
    expect(res.fetchError).toContain("not configured");
    expect(getTimeReportingParityState().fetchFailures).toBe(1);
  });

  it("a comparator error is recorded and does not throw", async () => {
    seedTimeReporting(makeReport());
    const res = await runTimeReportingParityForReport(makeReport(), CTX, {
      enabled: true,
      compareTimeReporting: () => {
        throw new Error("comparator boom");
      },
    });
    expect(res.fetchError).toContain("comparator boom");
    expect(getTimeReportingParityState().fetchFailures).toBe(1);
  });
});

describe("Slice 2d-2 · sanitized telemetry", () => {
  it("caps the recent mismatch ring at 50", async () => {
    // Each missing-report run records one blocking mismatch → push 60.
    for (let i = 0; i < 60; i += 1) {
      await runTimeReportingParityForReport(makeReport({ id: `trep_${i}` }), CTX, ON);
    }
    expect(getTimeReportingParityState().recentMismatches.length).toBe(50);
  });

  it("a real deviation-comment message divergence is recorded but the body is stripped", async () => {
    const report = makeReport({ deviationComment: "Secret customer note about access codes" });
    seedTimeReporting(report);
    // Corrupt the stored message body so the comparator flags a divergence.
    mocks.holder.client.rows("time_report_messages")[0].message = "different secret body";
    await runTimeReportingParityForReport(report, CTX, ON);

    const recent = getTimeReportingParityState().recentMismatches;
    const messageMismatch = recent.find((m) => m.table === "time_report_messages");
    expect(messageMismatch).toBeDefined();
    expect(messageMismatch?.expected).toBe(REDACTED);
    expect(messageMismatch?.actual).toBe(REDACTED);
    // The raw comment / body must not appear anywhere in telemetry.
    const serialized = JSON.stringify(getTimeReportingParityState());
    expect(serialized).not.toContain("Secret customer note");
    expect(serialized).not.toContain("different secret body");
  });

  it("sanitizeParityMismatch strips name snapshots", () => {
    const mismatch: ParityMismatch = {
      type: "employee_name_snapshot.mismatch",
      domain: "time_reporting",
      table: "time_reports",
      sourceLegacyId: "treport:trep_1",
      field: "employee_name_snapshot",
      expected: "Astrid Johansen",
      actual: "Astrid J.",
      severity: "warning",
      timestamp: "2026-06-10T10:00:00.000Z",
    };
    const sanitized = sanitizeParityMismatch(mismatch);
    expect(sanitized.expected).toBe(REDACTED);
    expect(sanitized.actual).toBe(REDACTED);
  });

  it("sanitizeParityMismatch strips non-scalar / full-payload context + values", () => {
    const mismatch: ParityMismatch = {
      type: "report.payload",
      domain: "time_reporting",
      table: "time_reports",
      sourceLegacyId: "treport:trep_1",
      expected: { huge: "report", nested: { a: 1 } } as unknown,
      actual: 42,
      severity: "warning",
      timestamp: "2026-06-10T10:00:00.000Z",
      context: { report: { secret: "payload" }, minutes: 60, allocationType: "scheduled_billable" },
    };
    const sanitized = sanitizeParityMismatch(mismatch);
    expect(sanitized.expected).toBe(REDACTED); // object payload redacted
    expect(sanitized.actual).toBe(42); // scalar kept
    expect(sanitized.context).toEqual({ minutes: 60, allocationType: "scheduled_billable" });
  });

  it("keeps short scalar ids / minutes verbatim for a non-sensitive divergence", async () => {
    const report = makeReport();
    seedTimeReporting(report);
    mocks.holder.client.rows("time_reports")[0].scheduled_duration_minutes = 999;
    await runTimeReportingParityForReport(report, CTX, ON);
    const recent = getTimeReportingParityState().recentMismatches;
    const m = recent.find((x) => x.field === "scheduled_duration_minutes");
    expect(m?.expected).toBe(60);
    expect(m?.actual).toBe(999);
  });
});
