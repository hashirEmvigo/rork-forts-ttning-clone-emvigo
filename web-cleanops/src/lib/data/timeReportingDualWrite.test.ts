import { beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";

/**
 * Slice 2c-2a/2c-2b — Time Reporting checkout dual-write fixture tests.
 *
 * 2c-2a proves {@link mirrorTimeReportingCheckout} mirrors ONE legacy checkout
 * TimeReport into the migration-0032 Time Reporting CORE tables (`time_reports`
 * / `time_allocations` / `time_report_events`) through a fake PostgREST client:
 * deterministic ids, idempotent retries, legacy success + Supabase failure still
 * does not throw, partial-then-retry convergence, missing-company skip, flat
 * service_row_legacy_id, the mission-log soft links, allocation split
 * correctness, status mapping, payroll/invoice not_ready, AI null.
 *
 * 2c-2b extends the SAME path with the optional review surface: a
 * `deviation_review` `time_report_flags` row + its immutable `flag_opened`
 * `time_report_flag_events` event ONLY when the checkout requires admin review
 * (never for auto-approved), and ONE immutable `time_report_messages` row ONLY
 * when the checkout carries a real deviation comment (never empty) — all
 * idempotent, all sanitized-failure-safe, with the strict write boundary (no
 * Mission Log / payroll / invoice / time-bank / notification writes).
 */

type Row = Record<string, unknown>;

interface UpsertOpts {
  onConflict?: string;
  ignoreDuplicates?: boolean;
}

const mocks = vi.hoisted(() => {
  class FakeClient {
    tables = new Map<string, Row[]>();
    companies: Array<{ id: string; legacy_id: string }> = [];
    /** Table names whose upsert should return an error (failure injection). */
    failOn = new Set<string>();

    private table(name: string): Row[] {
      if (!this.tables.has(name)) this.tables.set(name, []);
      return this.tables.get(name) as Row[];
    }

    from(name: string) {
      return {
        select: (_cols?: string) =>
          Promise.resolve({
            data: name === "companies" ? this.companies : this.table(name),
            error: null,
          }),
        upsert: (rowOrRows: Row | Row[], opts?: UpsertOpts) => {
          if (this.failOn.has(name)) {
            return Promise.resolve({ error: { message: `boom:${name}` } });
          }
          const rows = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows];
          const store = this.table(name);
          for (const r of rows) {
            const idx = store.findIndex((x) => x.legacy_id === r.legacy_id);
            if (idx >= 0) {
              // ignoreDuplicates → immutable: keep the existing row untouched.
              if (!opts?.ignoreDuplicates) store[idx] = r;
            } else {
              store.push(r);
            }
          }
          return Promise.resolve({ error: null });
        },
      };
    }

    seedCompany(legacyId: string, uuid: string): void {
      this.companies.push({ id: uuid, legacy_id: legacyId });
    }
    rows(name: string): Row[] {
      return this.table(name);
    }
    reset(): void {
      this.tables.clear();
      this.companies = [];
      this.failOn.clear();
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

import { mirrorTimeReportingCheckout } from "./timeReportingDualWrite";
import {
  getTimeReportingCutoverState,
  resetTimeReportingCutoverState,
  shouldMirrorTimeReportingCheckout,
} from "./timeReportingCutover";
import {
  buildTimeReportLegacyId,
  buildScheduledAllocationLegacyId,
  buildBillableDeviationAllocationLegacyId,
  buildInternalDeviationAllocationLegacyId,
  buildSubmittedEventIdempotencyKey,
  buildSubmittedEventLegacyId,
  buildAdminReviewFlagLegacyId,
  buildFlagOpenedEventLegacyId,
  buildFlagOpenedEventIdempotencyKey,
  buildCheckoutMessageLegacyId,
  buildCheckoutMessageIdempotencyKey,
  deriveTimeReportStatus,
  shouldCreateAdminReviewFlag,
  getCheckoutMessageText,
} from "./timeReportingMigration";
import {
  buildMissionLogEntryLegacyId,
  buildMissionStaffSessionLegacyId,
} from "./missionLogMigration";
import type { TimeReport } from "@/types";

const NORD = "cmp_nord";
const NORD_UUID = "11111111-1111-1111-1111-111111111111";
const VEST = "cmp_vest";
const VEST_UUID = "22222222-2222-2222-2222-222222222222";

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

beforeEach(() => {
  mocks.holder.client.reset();
  mocks.holder.configured = true;
  resetTimeReportingCutoverState();
});

describe("Slice 2c-2a · dual-write gate (default OFF)", () => {
  it("TIME_REPORTING_DUAL_WRITE is OFF by default → no mirror is attempted", async () => {
    expect(shouldMirrorTimeReportingCheckout()).toBe(false);
    // Simulate the AppContext guard: with the gate OFF nothing is written.
    if (shouldMirrorTimeReportingCheckout()) {
      await mirrorTimeReportingCheckout(makeReport(), { customerId: "cust_1" });
    }
    expect(mocks.holder.client.rows("time_reports")).toHaveLength(0);
    expect(getTimeReportingCutoverState().attempted).toBe(0);
  });
});

describe("Slice 2c-2a · deterministic ids", () => {
  it("derives stable, pure ids from the legacy report", () => {
    const r = makeReport();
    expect(buildTimeReportLegacyId(r)).toBe("treport:trep_1");
    expect(buildScheduledAllocationLegacyId(r)).toBe("alloc:trep_1:scheduled");
    expect(buildBillableDeviationAllocationLegacyId(r)).toBe("alloc:trep_1:billable_deviation");
    expect(buildInternalDeviationAllocationLegacyId(r)).toBe("alloc:trep_1:internal_deviation");
    expect(buildSubmittedEventIdempotencyKey(r)).toBe("time_report_submitted:trep_1");
    expect(buildSubmittedEventLegacyId(r)).toBe("tr_event:trep_1:submitted");
  });

  it("maps legacy approval status onto the new report status", () => {
    expect(deriveTimeReportStatus(makeReport({ approvalStatus: "auto_approved" }))).toBe("auto_approved");
    expect(deriveTimeReportStatus(makeReport({ approvalStatus: "pending_admin_approval" }))).toBe("admin_review_required");
  });
});

describe("Slice 2c-2a · legacy success + Supabase success", () => {
  it("writes one report, the allocations and one submitted event", async () => {
    mocks.holder.client.seedCompany(NORD, NORD_UUID);
    const res = await mirrorTimeReportingCheckout(makeReport(), {
      customerId: "cust_1",
      customerNameSnapshot: "Nordic AS",
    });

    expect(res.ok).toBe(true);
    expect(res.skipped).toBe(false);
    expect(res.reportWritten && res.eventWritten).toBe(true);
    expect(res.allocationsWritten).toBe(3);

    const reports = mocks.holder.client.rows("time_reports");
    const allocations = mocks.holder.client.rows("time_allocations");
    const events = mocks.holder.client.rows("time_report_events");
    expect(reports).toHaveLength(1);
    expect(allocations).toHaveLength(3);
    expect(events).toHaveLength(1);

    const report = reports[0];
    expect(report.company_id).toBe(NORD_UUID);
    expect(report.company_legacy_id).toBe(NORD);
    expect(report.service_row_legacy_id).toBe("srv_1");
    expect(report.customer_name_snapshot).toBe("Nordic AS");
    // pending_admin_approval → admin_review_required + requires review.
    expect(report.status).toBe("admin_review_required");
    expect(report.requires_admin_review).toBe(true);
    // Payroll / invoice stay not_ready; AI null. The pending checkout raises a
    // flag, so the denormalised rollup is `open` (still SEPARATE from approval).
    expect(report.payroll_approval_status).toBe("not_ready");
    expect(report.invoice_basis_status).toBe("not_ready");
    expect(report.ai_recommendation).toBeNull();
    expect(report.flag_resolution_status).toBe("open");

    expect(events[0].event_type).toBe("time_report_submitted");
    expect(events[0].idempotency_key).toBe("time_report_submitted:trep_1");

    expect(getTimeReportingCutoverState().succeeded).toBe(1);
  });

  it("computes the mission-log soft links using the same Slice 2c-1 keys", async () => {
    mocks.holder.client.seedCompany(NORD, NORD_UUID);
    const report = makeReport();
    await mirrorTimeReportingCheckout(report, { customerId: "cust_1" });

    const row = mocks.holder.client.rows("time_reports")[0];
    expect(row.mission_log_entry_legacy_id).toBe(buildMissionLogEntryLegacyId(report));
    expect(row.mission_staff_session_legacy_id).toBe(buildMissionStaffSessionLegacyId(report));
    expect(row.mission_log_entry_legacy_id).toBe("mission:wo_1:srv_1");
  });

  it("maps auto-approved checkouts onto auto_approved + no review", async () => {
    mocks.holder.client.seedCompany(NORD, NORD_UUID);
    await mirrorTimeReportingCheckout(
      makeReport({ approvalStatus: "auto_approved" }),
      { customerId: "cust_1" },
    );
    const row = mocks.holder.client.rows("time_reports")[0];
    expect(row.status).toBe("auto_approved");
    expect(row.requires_admin_review).toBe(false);
  });

  it("writes flat service_row_legacy_id as null for a work-order-level checkout", async () => {
    mocks.holder.client.seedCompany(NORD, NORD_UUID);
    await mirrorTimeReportingCheckout(makeReport({ serviceRowId: null }), { customerId: "cust_1" });
    expect(mocks.holder.client.rows("time_reports")[0].service_row_legacy_id).toBeNull();
  });
});

describe("Slice 2c-2a · allocation split", () => {
  it("always writes the scheduled allocation, even at 0 minutes", async () => {
    mocks.holder.client.seedCompany(NORD, NORD_UUID);
    await mirrorTimeReportingCheckout(
      makeReport({
        scheduledMinutes: 0,
        actualMinutes: 0,
        deviationMinutes: 0,
        billableDeviationMinutes: 0,
        internalDeviationMinutes: 0,
      }),
      { customerId: "cust_1" },
    );
    const allocations = mocks.holder.client.rows("time_allocations");
    expect(allocations).toHaveLength(1);
    expect(allocations[0].legacy_id).toBe("alloc:trep_1:scheduled");
    expect(allocations[0].allocation_type).toBe("scheduled_billable");
    expect(allocations[0].minutes).toBe(0);
    expect(allocations[0].is_billable).toBe(true);
    expect(allocations[0].is_payroll_relevant).toBe(true);
    expect(allocations[0].is_invoice_relevant).toBe(true);
  });

  it("skips zero-minute deviation allocations", async () => {
    mocks.holder.client.seedCompany(NORD, NORD_UUID);
    await mirrorTimeReportingCheckout(
      makeReport({ billableDeviationMinutes: 8, internalDeviationMinutes: 0, deviationMinutes: 8 }),
      { customerId: "cust_1" },
    );
    const ids = mocks.holder.client.rows("time_allocations").map((a) => a.legacy_id);
    expect(ids).toContain("alloc:trep_1:scheduled");
    expect(ids).toContain("alloc:trep_1:billable_deviation");
    expect(ids).not.toContain("alloc:trep_1:internal_deviation");
  });

  it("classifies the internal deviation as non-billable + non-invoice but payroll-relevant", async () => {
    mocks.holder.client.seedCompany(NORD, NORD_UUID);
    await mirrorTimeReportingCheckout(
      makeReport({ billableDeviationMinutes: 0, internalDeviationMinutes: 5, deviationMinutes: 5 }),
      { customerId: "cust_1" },
    );
    const internal = mocks.holder.client
      .rows("time_allocations")
      .find((a) => a.legacy_id === "alloc:trep_1:internal_deviation");
    expect(internal?.allocation_type).toBe("internal_non_billable");
    expect(internal?.is_billable).toBe(false);
    expect(internal?.is_invoice_relevant).toBe(false);
    expect(internal?.is_payroll_relevant).toBe(true);
  });
});

describe("Slice 2c-2a · idempotent retries", () => {
  it("retrying the SAME checkout does not duplicate the report, allocations or event", async () => {
    mocks.holder.client.seedCompany(NORD, NORD_UUID);
    const report = makeReport();
    await mirrorTimeReportingCheckout(report, { customerId: "cust_1" });
    await mirrorTimeReportingCheckout(report, { customerId: "cust_1" });

    expect(mocks.holder.client.rows("time_reports")).toHaveLength(1);
    expect(mocks.holder.client.rows("time_allocations")).toHaveLength(3);
    expect(mocks.holder.client.rows("time_report_events")).toHaveLength(1);
    expect(getTimeReportingCutoverState().attempted).toBe(2);
    expect(getTimeReportingCutoverState().succeeded).toBe(2);
  });
});

describe("Slice 2c-2a · failure handling (legacy checkout stays authoritative)", () => {
  it("a Supabase report failure is recorded and never throws", async () => {
    mocks.holder.client.seedCompany(NORD, NORD_UUID);
    mocks.holder.client.failOn.add("time_reports");

    const res = await mirrorTimeReportingCheckout(makeReport(), { customerId: "cust_1" });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("report upsert failed");
    expect(getTimeReportingCutoverState().failed).toBe(1);
    expect(getTimeReportingCutoverState().lastError).toContain("report upsert failed");
  });

  it("partial success then retry converges (allocations fail first, then succeed)", async () => {
    mocks.holder.client.seedCompany(NORD, NORD_UUID);
    mocks.holder.client.failOn.add("time_allocations");

    const first = await mirrorTimeReportingCheckout(makeReport(), { customerId: "cust_1" });
    expect(first.ok).toBe(false);
    expect(first.reportWritten).toBe(true);
    // Report already mirrored; event not yet written.
    expect(mocks.holder.client.rows("time_reports")).toHaveLength(1);
    expect(mocks.holder.client.rows("time_report_events")).toHaveLength(0);

    // Recover and retry.
    mocks.holder.client.failOn.clear();
    const second = await mirrorTimeReportingCheckout(makeReport(), { customerId: "cust_1" });
    expect(second.ok).toBe(true);
    expect(mocks.holder.client.rows("time_reports")).toHaveLength(1);
    expect(mocks.holder.client.rows("time_allocations")).toHaveLength(3);
    expect(mocks.holder.client.rows("time_report_events")).toHaveLength(1);
  });

  it("is not configured → recorded as a failure, never throws", async () => {
    mocks.holder.configured = false;
    const res = await mirrorTimeReportingCheckout(makeReport(), { customerId: "cust_1" });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("not configured");
    expect(getTimeReportingCutoverState().failed).toBe(1);
  });
});

describe("Slice 2c-2a · missing company mapping", () => {
  it("skips and records when the company has no Supabase UUID, writing nothing", async () => {
    // No company seeded → no mapping.
    const res = await mirrorTimeReportingCheckout(makeReport(), { customerId: "cust_1" });
    expect(res.skipped).toBe(true);
    expect(res.ok).toBe(false);
    expect(mocks.holder.client.rows("time_reports")).toHaveLength(0);
    expect(mocks.holder.client.rows("time_allocations")).toHaveLength(0);
    expect(mocks.holder.client.rows("time_report_events")).toHaveLength(0);
    expect(getTimeReportingCutoverState().skippedMissingCompany).toBe(1);
  });
});

describe("Slice 2c-2a · company-scope isolation", () => {
  it("carries the correct company UUID per checkout", async () => {
    mocks.holder.client.seedCompany(NORD, NORD_UUID);
    mocks.holder.client.seedCompany(VEST, VEST_UUID);
    await mirrorTimeReportingCheckout(makeReport({ id: "trep_n", companyId: NORD }), { customerId: "c1" });
    await mirrorTimeReportingCheckout(makeReport({ id: "trep_v", companyId: VEST }), { customerId: "c2" });

    const rows = mocks.holder.client.rows("time_reports");
    expect(rows.find((r) => r.legacy_id === "treport:trep_n")?.company_id).toBe(NORD_UUID);
    expect(rows.find((r) => r.legacy_id === "treport:trep_v")?.company_id).toBe(VEST_UUID);
  });
});

describe("Slice 2c-2a · strict write boundary (no Mission Log / payroll / invoice / time-bank)", () => {
  it("an auto-approved checkout with no comment writes ONLY the three CORE tables", async () => {
    mocks.holder.client.seedCompany(NORD, NORD_UUID);
    await mirrorTimeReportingCheckout(
      makeReport({ approvalStatus: "auto_approved", deviationComment: null }),
      { customerId: "cust_1" },
    );

    const written = [...mocks.holder.client.tables.keys()].filter(
      (name) => mocks.holder.client.rows(name).length > 0,
    );
    expect(written.sort()).toEqual(
      ["time_allocations", "time_report_events", "time_reports"].sort(),
    );
  });

  it("never touches Mission Log / payroll / invoice / time-bank / notification tables", async () => {
    mocks.holder.client.seedCompany(NORD, NORD_UUID);
    // A pending checkout WITH a comment exercises the full 2c-2b surface.
    await mirrorTimeReportingCheckout(
      makeReport({ deviationComment: "Customer added a room" }),
      { customerId: "cust_1" },
    );

    for (const forbidden of [
      "mission_log_entries",
      "mission_staff_sessions",
      "mission_log_events",
      "payroll_basis",
      "invoice_basis",
      "time_bank_entries",
      "notifications",
    ]) {
      expect(mocks.holder.client.rows(forbidden)).toHaveLength(0);
    }
  });
});

describe("Slice 2c-2b · deterministic flag/message ids + decisions", () => {
  it("derives stable, pure flag/flag-event/message ids", () => {
    const r = makeReport();
    expect(buildAdminReviewFlagLegacyId(r)).toBe("tr_flag:trep_1:admin_review");
    expect(buildFlagOpenedEventLegacyId(r)).toBe("tr_flag_event:trep_1:opened");
    expect(buildFlagOpenedEventIdempotencyKey(r)).toBe("time_report_flag_opened:trep_1");
    expect(buildCheckoutMessageLegacyId(r)).toBe("tr_msg:trep_1:checkout_comment");
    expect(buildCheckoutMessageIdempotencyKey(r)).toBe("time_report_checkout_comment:trep_1");
  });

  it("raises a flag only for non-auto-approved checkouts", () => {
    expect(shouldCreateAdminReviewFlag(makeReport({ approvalStatus: "pending_admin_approval" }))).toBe(true);
    expect(shouldCreateAdminReviewFlag(makeReport({ approvalStatus: "auto_approved" }))).toBe(false);
  });

  it("keeps a checkout message only when a real comment exists", () => {
    expect(getCheckoutMessageText(makeReport({ deviationComment: "Extra room" }))).toBe("Extra room");
    expect(getCheckoutMessageText(makeReport({ deviationComment: "   " }))).toBeNull();
    expect(getCheckoutMessageText(makeReport({ deviationComment: null }))).toBeNull();
  });
});

describe("Slice 2c-2b · flag write", () => {
  it("a pending-admin-approval checkout creates ONE open deviation_review flag + open event", async () => {
    mocks.holder.client.seedCompany(NORD, NORD_UUID);
    const res = await mirrorTimeReportingCheckout(makeReport(), { customerId: "cust_1" });

    expect(res.flagWritten).toBe(true);
    expect(res.flagEventWritten).toBe(true);

    const flags = mocks.holder.client.rows("time_report_flags");
    const flagEvents = mocks.holder.client.rows("time_report_flag_events");
    expect(flags).toHaveLength(1);
    expect(flagEvents).toHaveLength(1);

    expect(flags[0].legacy_id).toBe("tr_flag:trep_1:admin_review");
    expect(flags[0].flag_type).toBe("deviation_review");
    expect(flags[0].resolution_status).toBe("open");
    expect(flags[0].time_report_legacy_id).toBe("treport:trep_1");
    expect(flags[0].severity).toBeNull();

    expect(flagEvents[0].event_type).toBe("flag_opened");
    expect(flagEvents[0].from_resolution_status).toBeNull();
    expect(flagEvents[0].to_resolution_status).toBe("open");
    expect(flagEvents[0].time_report_flag_legacy_id).toBe("tr_flag:trep_1:admin_review");
    expect(flagEvents[0].idempotency_key).toBe("time_report_flag_opened:trep_1");
  });

  it("sets the report flag_resolution_status rollup to open when a flag is raised", async () => {
    mocks.holder.client.seedCompany(NORD, NORD_UUID);
    await mirrorTimeReportingCheckout(makeReport(), { customerId: "cust_1" });
    expect(mocks.holder.client.rows("time_reports")[0].flag_resolution_status).toBe("open");
  });

  it("an auto-approved checkout creates NO flag, NO flag event, NULL rollup", async () => {
    mocks.holder.client.seedCompany(NORD, NORD_UUID);
    const res = await mirrorTimeReportingCheckout(
      makeReport({ approvalStatus: "auto_approved" }),
      { customerId: "cust_1" },
    );
    expect(res.flagWritten).toBe(false);
    expect(res.flagEventWritten).toBe(false);
    expect(mocks.holder.client.rows("time_report_flags")).toHaveLength(0);
    expect(mocks.holder.client.rows("time_report_flag_events")).toHaveLength(0);
    expect(mocks.holder.client.rows("time_reports")[0].flag_resolution_status).toBeNull();
  });

  it("retrying does not duplicate the flag or flag event", async () => {
    mocks.holder.client.seedCompany(NORD, NORD_UUID);
    const report = makeReport();
    await mirrorTimeReportingCheckout(report, { customerId: "cust_1" });
    await mirrorTimeReportingCheckout(report, { customerId: "cust_1" });
    expect(mocks.holder.client.rows("time_report_flags")).toHaveLength(1);
    expect(mocks.holder.client.rows("time_report_flag_events")).toHaveLength(1);
  });

  it("a flag insert failure is recorded and never throws", async () => {
    mocks.holder.client.seedCompany(NORD, NORD_UUID);
    mocks.holder.client.failOn.add("time_report_flags");
    const res = await mirrorTimeReportingCheckout(makeReport(), { customerId: "cust_1" });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("flag insert failed");
    expect(getTimeReportingCutoverState().failed).toBe(1);
  });
});

describe("Slice 2c-2b · message write", () => {
  it("writes ONE checkout message when a deviation comment exists", async () => {
    mocks.holder.client.seedCompany(NORD, NORD_UUID);
    const res = await mirrorTimeReportingCheckout(
      makeReport({ deviationComment: "Customer added a room", deviationReason: "scope_change" }),
      { customerId: "cust_1" },
    );
    expect(res.messageWritten).toBe(true);
    const messages = mocks.holder.client.rows("time_report_messages");
    expect(messages).toHaveLength(1);
    expect(messages[0].legacy_id).toBe("tr_msg:trep_1:checkout_comment");
    expect(messages[0].message).toBe("Customer added a room");
    expect(messages[0].sender_type).toBe("employee");
    expect(messages[0].sender_id).toBe("emp_1");
    expect(messages[0].idempotency_key).toBe("time_report_checkout_comment:trep_1");
  });

  it("writes NO message when there is no comment (no fabricated empty message)", async () => {
    mocks.holder.client.seedCompany(NORD, NORD_UUID);
    const res = await mirrorTimeReportingCheckout(
      makeReport({ deviationComment: null }),
      { customerId: "cust_1" },
    );
    expect(res.messageWritten).toBe(false);
    expect(mocks.holder.client.rows("time_report_messages")).toHaveLength(0);
  });

  it("writes NO message for a whitespace-only comment", async () => {
    mocks.holder.client.seedCompany(NORD, NORD_UUID);
    await mirrorTimeReportingCheckout(
      makeReport({ deviationComment: "   " }),
      { customerId: "cust_1" },
    );
    expect(mocks.holder.client.rows("time_report_messages")).toHaveLength(0);
  });

  it("retrying does not duplicate the message", async () => {
    mocks.holder.client.seedCompany(NORD, NORD_UUID);
    const report = makeReport({ deviationComment: "Extra room" });
    await mirrorTimeReportingCheckout(report, { customerId: "cust_1" });
    await mirrorTimeReportingCheckout(report, { customerId: "cust_1" });
    expect(mocks.holder.client.rows("time_report_messages")).toHaveLength(1);
  });

  it("a message insert failure is recorded and never throws", async () => {
    mocks.holder.client.seedCompany(NORD, NORD_UUID);
    mocks.holder.client.failOn.add("time_report_messages");
    const res = await mirrorTimeReportingCheckout(
      makeReport({ deviationComment: "Extra room" }),
      { customerId: "cust_1" },
    );
    expect(res.ok).toBe(false);
    expect(res.error).toContain("message insert failed");
    expect(getTimeReportingCutoverState().failed).toBe(1);
  });
});

describe("Slice 2c-2b · partial success then retry converges (flags + message)", () => {
  it("flag event fails first, then the whole mirror converges on retry", async () => {
    mocks.holder.client.seedCompany(NORD, NORD_UUID);
    mocks.holder.client.failOn.add("time_report_flag_events");
    const report = makeReport({ deviationComment: "Extra room" });

    const first = await mirrorTimeReportingCheckout(report, { customerId: "cust_1" });
    expect(first.ok).toBe(false);
    expect(first.flagWritten).toBe(true);
    expect(first.flagEventWritten).toBe(false);
    expect(mocks.holder.client.rows("time_report_flags")).toHaveLength(1);
    expect(mocks.holder.client.rows("time_report_flag_events")).toHaveLength(0);
    expect(mocks.holder.client.rows("time_report_messages")).toHaveLength(0);

    mocks.holder.client.failOn.clear();
    const second = await mirrorTimeReportingCheckout(report, { customerId: "cust_1" });
    expect(second.ok).toBe(true);
    expect(mocks.holder.client.rows("time_report_flags")).toHaveLength(1);
    expect(mocks.holder.client.rows("time_report_flag_events")).toHaveLength(1);
    expect(mocks.holder.client.rows("time_report_messages")).toHaveLength(1);
  });
});
