import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Slice 2d-3 — gated fire-and-forget runtime parity validation hook tests.
 *
 * These prove the hook wired into the SUCCESS TAIL of {@link
 * mirrorTimeReportingCheckout}: with the shadow gate ON the parity runner is
 * called EXACTLY ONCE after the mirror writes complete, with `includeMissionLog`
 * reflecting MISSION_LOG_DUAL_WRITE; with the gate OFF the runner is NOT called;
 * the runner is NOT called when the mirror fails or is skipped; and a runner
 * rejection / synchronous throw can never break the (already-successful) mirror.
 *
 * The runner is INJECTED (a spy) so these tests never touch the real read-only
 * fetch path — they validate the wiring, gate and failure isolation only.
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

import {
  mirrorTimeReportingCheckout,
  type MirrorTimeReportingHookOptions,
} from "./timeReportingDualWrite";
import { resetTimeReportingCutoverState } from "./timeReportingCutover";
import type { runTimeReportingParityForReport } from "./timeReportingParityRunner";
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

/** A spy that resolves like the real (never-throwing) runner. */
function makeRunnerSpy(): typeof runTimeReportingParityForReport {
  return vi.fn(async (report, _context, opts) => ({
    ran: opts?.enabled ?? false,
    reportLegacyId: `treport:${report.id}`,
    timeReporting: null,
    missionLog: null,
    fetchError: null,
  })) as unknown as typeof runTimeReportingParityForReport;
}

beforeEach(() => {
  mocks.holder.client.reset();
  mocks.holder.configured = true;
  resetTimeReportingCutoverState();
});

describe("Slice 2d-3 · gate behaviour", () => {
  it("shadow gate OFF → mirror runs, the parity runner is NOT called", async () => {
    mocks.holder.client.seedCompany(NORD, NORD_UUID);
    const run = makeRunnerSpy();

    const res = await mirrorTimeReportingCheckout(makeReport(), { customerId: "c1" }, {
      shadowValidationEnabled: false,
      runShadowValidation: run,
    });

    expect(res.ok).toBe(true);
    expect(mocks.holder.client.rows("time_reports")).toHaveLength(1);
    expect(run).not.toHaveBeenCalled();
  });

  it("shadow gate ON + mirror success → the parity runner is called exactly once", async () => {
    mocks.holder.client.seedCompany(NORD, NORD_UUID);
    const run = makeRunnerSpy();
    const report = makeReport();

    const res = await mirrorTimeReportingCheckout(report, { customerId: "c1" }, {
      shadowValidationEnabled: true,
      runShadowValidation: run,
    });

    expect(res.ok).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(
      report,
      { customerId: "c1" },
      expect.objectContaining({ enabled: true }),
    );
  });
});

describe("Slice 2d-3 · includeMissionLog reflects MISSION_LOG_DUAL_WRITE", () => {
  it("Mission Log ON → includeMissionLog + missionLogDualWriteEnabled true", async () => {
    mocks.holder.client.seedCompany(NORD, NORD_UUID);
    const run = makeRunnerSpy();

    await mirrorTimeReportingCheckout(makeReport(), { customerId: "c1" }, {
      shadowValidationEnabled: true,
      missionLogDualWriteEnabled: true,
      runShadowValidation: run,
    });

    expect(run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        includeMissionLog: true,
        missionLogDualWriteEnabled: true,
      }),
    );
  });

  it("Mission Log OFF → includeMissionLog false (absence stays non-blocking)", async () => {
    mocks.holder.client.seedCompany(NORD, NORD_UUID);
    const run = makeRunnerSpy();

    await mirrorTimeReportingCheckout(makeReport(), { customerId: "c1" }, {
      shadowValidationEnabled: true,
      missionLogDualWriteEnabled: false,
      runShadowValidation: run,
    });

    expect(run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        includeMissionLog: false,
        missionLogDualWriteEnabled: false,
      }),
    );
  });
});

describe("Slice 2d-3 · runner is NOT called on a non-success", () => {
  it("mirror FAILURE (report upsert error) → the parity runner is not called", async () => {
    mocks.holder.client.seedCompany(NORD, NORD_UUID);
    mocks.holder.client.failOn.add("time_reports");
    const run = makeRunnerSpy();

    const res = await mirrorTimeReportingCheckout(makeReport(), { customerId: "c1" }, {
      shadowValidationEnabled: true,
      runShadowValidation: run,
    });

    expect(res.ok).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it("mirror SKIPPED (no company mapping) → the parity runner is not called", async () => {
    // No company seeded → missing UUID mapping → skipped, nothing written.
    const run = makeRunnerSpy();

    const res = await mirrorTimeReportingCheckout(makeReport(), { customerId: "c1" }, {
      shadowValidationEnabled: true,
      runShadowValidation: run,
    });

    expect(res.skipped).toBe(true);
    expect(run).not.toHaveBeenCalled();
  });
});

describe("Slice 2d-3 · validation failure never breaks the mirror/checkout", () => {
  it("a runner REJECTION is swallowed; the mirror still resolves ok", async () => {
    mocks.holder.client.seedCompany(NORD, NORD_UUID);
    const run = vi.fn(() =>
      Promise.reject(new Error("validation boom")),
    ) as unknown as typeof runTimeReportingParityForReport;

    const res = await mirrorTimeReportingCheckout(makeReport(), { customerId: "c1" }, {
      shadowValidationEnabled: true,
      runShadowValidation: run,
    });

    expect(res.ok).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    // Let the rejected microtask settle so the .catch swallows it (no unhandled).
    await Promise.resolve();
  });

  it("a runner SYNCHRONOUS throw is swallowed; the mirror still resolves ok", async () => {
    mocks.holder.client.seedCompany(NORD, NORD_UUID);
    const run = vi.fn(() => {
      throw new Error("sync boom");
    }) as unknown as typeof runTimeReportingParityForReport;

    const res = await mirrorTimeReportingCheckout(makeReport(), { customerId: "c1" }, {
      shadowValidationEnabled: true,
      runShadowValidation: run,
    });

    expect(res.ok).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("Slice 2d-3 · default hook opts (no overrides) do not call the runner under vitest", () => {
  it("without hookOpts the real flag-driven gate is OFF → runner path is dormant", async () => {
    mocks.holder.client.seedCompany(NORD, NORD_UUID);
    // No hookOpts at all — mirrors the live AppContext call. The real
    // TIME_REPORTING_SHADOW_VALIDATE flag is OFF under vitest, so the success
    // tail no-ops the validation and the mirror still succeeds.
    const res = await mirrorTimeReportingCheckout(makeReport(), { customerId: "c1" });
    expect(res.ok).toBe(true);
    expect(mocks.holder.client.rows("time_reports")).toHaveLength(1);
  });
});
