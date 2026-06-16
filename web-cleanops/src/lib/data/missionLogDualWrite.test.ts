import { beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";

/**
 * Slice 2c-1 — Mission Log checkout dual-write fixture tests.
 *
 * Proves {@link mirrorMissionLogCheckout} mirrors ONE legacy checkout TimeReport
 * into the migration-0031 Mission Log tables (`mission_log_entries` /
 * `mission_staff_sessions` / `mission_log_events`) through a fake PostgREST
 * client: deterministic ids, idempotent retries (no duplicate entries/events),
 * legacy success + Supabase failure still does not throw, partial-then-retry
 * convergence, missing-company skip, flat service_row_legacy_id, and the strict
 * write boundary (ONLY the three Mission Log tables — no Time Reporting, no
 * ratings, no Schedule / payroll / invoice / time-bank / notification writes).
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

import { mirrorMissionLogCheckout } from "./missionLogDualWrite";
import {
  getMissionLogCutoverState,
  resetMissionLogCutoverState,
  shouldMirrorMissionLogCheckout,
} from "./missionLogCutover";
import {
  buildMissionLogEntryLegacyId,
  buildMissionStaffSessionLegacyId,
  buildCheckoutEventIdempotencyKey,
  buildCheckoutEventLegacyId,
  deriveDelayStatusFromCheckout,
} from "./missionLogMigration";
import type { TimeReport } from "@/types";

const NORD = "cmp_nord";
const NORD_UUID = "11111111-1111-1111-1111-111111111111";

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
  resetMissionLogCutoverState();
});

describe("Slice 2c-1 · dual-write gate (default OFF)", () => {
  it("MISSION_LOG_DUAL_WRITE is OFF by default → no mirror is attempted", async () => {
    expect(shouldMirrorMissionLogCheckout()).toBe(false);
    // Simulate the AppContext guard: with the gate OFF nothing is written.
    if (shouldMirrorMissionLogCheckout()) {
      await mirrorMissionLogCheckout(makeReport(), { customerId: "cust_1" });
    }
    expect(mocks.holder.client.rows("mission_log_entries")).toHaveLength(0);
    expect(getMissionLogCutoverState().attempted).toBe(0);
  });
});

describe("Slice 2c-1 · deterministic ids", () => {
  it("derives stable, pure ids from the legacy report", () => {
    const r = makeReport();
    expect(buildMissionLogEntryLegacyId(r)).toBe("mission:wo_1:srv_1");
    expect(buildMissionStaffSessionLegacyId(r)).toBe(
      "session:mission:wo_1:srv_1:emp_1:trep_1",
    );
    expect(buildCheckoutEventIdempotencyKey(r)).toBe("checked_out:trep_1");
    expect(buildCheckoutEventLegacyId(r)).toBe(
      "event:mission:wo_1:srv_1:checked_out:trep_1",
    );
    // A service-row-less checkout collapses onto the work-order mission.
    expect(buildMissionLogEntryLegacyId(makeReport({ serviceRowId: null }))).toBe(
      "mission:wo_1:wo",
    );
  });

  it("derives delay status from actual vs scheduled minutes", () => {
    expect(deriveDelayStatusFromCheckout(makeReport({ actualMinutes: 75, scheduledMinutes: 60 }))).toBe("over_time");
    expect(deriveDelayStatusFromCheckout(makeReport({ actualMinutes: 50, scheduledMinutes: 60 }))).toBe("early_finish");
    expect(deriveDelayStatusFromCheckout(makeReport({ actualMinutes: 60, scheduledMinutes: 60 }))).toBe("on_time");
  });
});

describe("Slice 2c-1 · legacy success + Supabase success", () => {
  it("writes one entry, one session and one event", async () => {
    mocks.holder.client.seedCompany(NORD, NORD_UUID);
    const res = await mirrorMissionLogCheckout(makeReport(), { customerId: "cust_1" });

    expect(res.ok).toBe(true);
    expect(res.skipped).toBe(false);
    expect(res.entryWritten && res.sessionWritten && res.eventWritten).toBe(true);

    const entries = mocks.holder.client.rows("mission_log_entries");
    const sessions = mocks.holder.client.rows("mission_staff_sessions");
    const events = mocks.holder.client.rows("mission_log_events");
    expect(entries).toHaveLength(1);
    expect(sessions).toHaveLength(1);
    expect(events).toHaveLength(1);

    // Real company UUID carried for RLS; flat service-row carried for parity.
    expect(entries[0].company_id).toBe(NORD_UUID);
    expect(entries[0].company_legacy_id).toBe(NORD);
    expect(entries[0].service_row_legacy_id).toBe("srv_1");
    expect(entries[0].mission_status).toBe("completed");
    expect(entries[0].delay_status).toBe("over_time");
    expect(entries[0].requires_admin_review).toBe(true);

    expect(sessions[0].status).toBe("checked_out");
    expect(sessions[0].check_out_method).toBe("manual");
    expect(sessions[0].check_in_method).toBe("missing");
    expect(sessions[0].actual_check_out_time).toBe("2026-06-10T10:00:00.000Z");

    expect(events[0].event_type).toBe("employee_checked_out");
    expect(events[0].idempotency_key).toBe("checked_out:trep_1");

    expect(getMissionLogCutoverState().succeeded).toBe(1);
  });

  it("writes flat service_row_legacy_id as null for a work-order-level checkout", async () => {
    mocks.holder.client.seedCompany(NORD, NORD_UUID);
    await mirrorMissionLogCheckout(makeReport({ serviceRowId: null }), { customerId: "cust_1" });
    expect(mocks.holder.client.rows("mission_log_entries")[0].service_row_legacy_id).toBeNull();
  });
});

describe("Slice 2c-1 · idempotent retries", () => {
  it("retrying the SAME checkout does not duplicate the entry, session or event", async () => {
    mocks.holder.client.seedCompany(NORD, NORD_UUID);
    const report = makeReport();
    await mirrorMissionLogCheckout(report, { customerId: "cust_1" });
    await mirrorMissionLogCheckout(report, { customerId: "cust_1" });

    expect(mocks.holder.client.rows("mission_log_entries")).toHaveLength(1);
    expect(mocks.holder.client.rows("mission_staff_sessions")).toHaveLength(1);
    expect(mocks.holder.client.rows("mission_log_events")).toHaveLength(1);
    expect(getMissionLogCutoverState().attempted).toBe(2);
    expect(getMissionLogCutoverState().succeeded).toBe(2);
  });

  it("a second checkout by the same employee for the same mission is a DISTINCT session (Option B)", async () => {
    mocks.holder.client.seedCompany(NORD, NORD_UUID);
    await mirrorMissionLogCheckout(makeReport({ id: "trep_1" }), { customerId: "cust_1" });
    await mirrorMissionLogCheckout(makeReport({ id: "trep_2" }), { customerId: "cust_1" });

    // Same mission entry (upserted once), two distinct sessions, two events.
    expect(mocks.holder.client.rows("mission_log_entries")).toHaveLength(1);
    expect(mocks.holder.client.rows("mission_staff_sessions")).toHaveLength(2);
    expect(mocks.holder.client.rows("mission_log_events")).toHaveLength(2);
  });
});

describe("Slice 2c-1 · failure handling (legacy checkout stays authoritative)", () => {
  it("a Supabase entry failure is recorded and never throws", async () => {
    mocks.holder.client.seedCompany(NORD, NORD_UUID);
    mocks.holder.client.failOn.add("mission_log_entries");

    const res = await mirrorMissionLogCheckout(makeReport(), { customerId: "cust_1" });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("entry upsert failed");
    expect(getMissionLogCutoverState().failed).toBe(1);
    expect(getMissionLogCutoverState().lastError).toContain("entry upsert failed");
  });

  it("partial success then retry converges (session fails first, then succeeds)", async () => {
    mocks.holder.client.seedCompany(NORD, NORD_UUID);
    mocks.holder.client.failOn.add("mission_staff_sessions");

    const first = await mirrorMissionLogCheckout(makeReport(), { customerId: "cust_1" });
    expect(first.ok).toBe(false);
    expect(first.entryWritten).toBe(true);
    expect(first.sessionWritten).toBe(false);
    // Entry already mirrored; event not yet written.
    expect(mocks.holder.client.rows("mission_log_entries")).toHaveLength(1);
    expect(mocks.holder.client.rows("mission_log_events")).toHaveLength(0);

    // Recover and retry.
    mocks.holder.client.failOn.clear();
    const second = await mirrorMissionLogCheckout(makeReport(), { customerId: "cust_1" });
    expect(second.ok).toBe(true);
    expect(mocks.holder.client.rows("mission_log_entries")).toHaveLength(1);
    expect(mocks.holder.client.rows("mission_staff_sessions")).toHaveLength(1);
    expect(mocks.holder.client.rows("mission_log_events")).toHaveLength(1);
  });

  it("is not configured → recorded as a failure, never throws", async () => {
    mocks.holder.configured = false;
    const res = await mirrorMissionLogCheckout(makeReport(), { customerId: "cust_1" });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("not configured");
    expect(getMissionLogCutoverState().failed).toBe(1);
  });
});

describe("Slice 2c-1 · missing company mapping", () => {
  it("skips and records when the company has no Supabase UUID, writing nothing", async () => {
    // No company seeded → no mapping.
    const res = await mirrorMissionLogCheckout(makeReport(), { customerId: "cust_1" });
    expect(res.skipped).toBe(true);
    expect(res.ok).toBe(false);
    expect(mocks.holder.client.rows("mission_log_entries")).toHaveLength(0);
    expect(mocks.holder.client.rows("mission_staff_sessions")).toHaveLength(0);
    expect(mocks.holder.client.rows("mission_log_events")).toHaveLength(0);
    expect(getMissionLogCutoverState().skippedMissingCompany).toBe(1);
  });
});

describe("Slice 2c-1 · strict write boundary", () => {
  it("writes ONLY the three Mission Log tables (no Time Reporting / ratings / other)", async () => {
    mocks.holder.client.seedCompany(NORD, NORD_UUID);
    await mirrorMissionLogCheckout(makeReport(), { customerId: "cust_1" });

    const written = [...mocks.holder.client.tables.keys()].filter(
      (name) => mocks.holder.client.rows(name).length > 0,
    );
    expect(written.sort()).toEqual(
      ["mission_log_entries", "mission_log_events", "mission_staff_sessions"].sort(),
    );

    // Explicitly assert none of the excluded tables were touched.
    for (const forbidden of [
      "mission_booked_time_ratings",
      "time_reports",
      "time_allocations",
      "time_report_flags",
      "time_report_events",
      "time_report_messages",
    ]) {
      expect(mocks.holder.client.rows(forbidden)).toHaveLength(0);
    }
  });
});
