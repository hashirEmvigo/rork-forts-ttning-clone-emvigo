import { beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";

/**
 * Slice 2b-2 — Time Reporting read adapter fixture tests.
 *
 * Proves {@link supabaseTimeReportingRepository} reads the migration-0032 tables
 * (`time_reports` / `time_allocations` / `time_report_flags` /
 * `time_report_events` / `time_report_flag_events` / `time_report_messages`)
 * correctly through a fake PostgREST client: empty Supabase is valid (empty list
 * / null detail, NO fallback / NO seed), summaries stay lightweight, detail loads
 * allocations + flags + messages + the ordered event / flag-event streams, and
 * every list filter / search / count / pagination / soft-delete exclusion /
 * company-scope rule holds — with approval status, payroll status, invoice status
 * and flag-resolution status read independently. Read-only — no dual-write, no
 * Schedule / payroll / invoice / time-bank writes.
 */

type Row = Record<string, unknown>;

const mocks = vi.hoisted(() => {
  /** Numeric when both sides parse as finite numbers; otherwise string compare. */
  function compare(a: unknown, b: unknown): number {
    const an = typeof a === "number" ? a : Number(a);
    const bn = typeof b === "number" ? b : Number(b);
    if (
      a != null &&
      b != null &&
      Number.isFinite(an) &&
      Number.isFinite(bn) &&
      String(a).trim() !== "" &&
      String(b).trim() !== ""
    ) {
      return an === bn ? 0 : an < bn ? -1 : 1;
    }
    const as = String(a ?? "");
    const bs = String(b ?? "");
    return as === bs ? 0 : as < bs ? -1 : 1;
  }

  /** Parses one `col.op.val` term of a PostgREST `.or(...)` expression. */
  function matchOrTerm(row: Row, term: string): boolean {
    const [col, op, ...rest] = term.split(".");
    const raw = rest.join(".");
    const cell = row[col];
    if (op === "ilike") {
      const needle = raw.replace(/[*]/g, "").toLowerCase();
      return cell != null && String(cell).toLowerCase().includes(needle);
    }
    if (op === "eq") return String(cell) === raw;
    if (op === "gte") return cell != null && compare(cell, raw) >= 0;
    if (op === "lte") return cell != null && compare(cell, raw) <= 0;
    return false;
  }

  interface SelectOpts {
    count?: "exact";
    head?: boolean;
  }

  class QueryBuilder {
    private filters: Array<(r: Row) => boolean> = [];
    private sorts: Array<{ col: string; asc: boolean }> = [];
    private rangeBounds: { from: number; to: number } | null = null;

    constructor(
      private rows: Row[],
      private opts: SelectOpts = {},
    ) {}

    eq(col: string, val: unknown): this {
      this.filters.push((r) => r[col] === val);
      return this;
    }
    in(col: string, vals: readonly unknown[]): this {
      const set = new Set(vals);
      this.filters.push((r) => set.has(r[col]));
      return this;
    }
    is(col: string, val: unknown): this {
      this.filters.push((r) =>
        val === null ? r[col] === null || r[col] === undefined : r[col] === val,
      );
      return this;
    }
    gte(col: string, val: unknown): this {
      this.filters.push((r) => r[col] != null && compare(r[col], val) >= 0);
      return this;
    }
    lte(col: string, val: unknown): this {
      this.filters.push((r) => r[col] != null && compare(r[col], val) <= 0);
      return this;
    }
    or(expr: string): this {
      const terms = expr.split(",");
      this.filters.push((r) => terms.some((t) => matchOrTerm(r, t)));
      return this;
    }
    order(col: string, opts: { ascending: boolean }): this {
      this.sorts.push({ col, asc: opts.ascending });
      return this;
    }
    range(from: number, to: number): this {
      this.rangeBounds = { from, to };
      return this;
    }

    private applied(): Row[] {
      const filtered = this.rows.filter((r) => this.filters.every((f) => f(r)));
      const sorted = [...filtered].sort((a, b) => {
        for (const s of this.sorts) {
          const c = compare(a[s.col], b[s.col]);
          if (c === 0) continue;
          return s.asc ? c : -c;
        }
        return 0;
      });
      return sorted;
    }

    maybeSingle(): Promise<{ data: Row | null; error: null }> {
      return Promise.resolve({ data: this.applied()[0] ?? null, error: null });
    }

    private resolve(): { data: Row[] | null; error: null; count: number | null } {
      const all = this.applied();
      const total = this.opts.count === "exact" ? all.length : null;
      if (this.opts.head) return { data: null, error: null, count: total };
      const data = this.rangeBounds
        ? all.slice(this.rangeBounds.from, this.rangeBounds.to + 1)
        : all;
      return { data, error: null, count: total };
    }

    then<R>(
      onFulfilled: (res: { data: Row[] | null; error: null; count: number | null }) => R,
    ): Promise<R> {
      return Promise.resolve(this.resolve()).then(onFulfilled);
    }
  }

  class FakeClient {
    tables = new Map<string, Row[]>();
    private table(name: string): Row[] {
      if (!this.tables.has(name)) this.tables.set(name, []);
      return this.tables.get(name) as Row[];
    }
    from(name: string) {
      const rows = this.table(name);
      return {
        select: (_cols?: string, opts?: SelectOpts) => new QueryBuilder(rows, opts ?? {}),
      };
    }
    seed(name: string, rows: Row[]): void {
      this.tables.set(name, rows);
    }
    reset(): void {
      this.tables.clear();
    }
  }

  return { client: new FakeClient() };
});

vi.mock("@/lib/supabase", () => ({
  supabase: mocks.client,
  isSupabaseConfigured: true,
}));

import { supabaseTimeReportingRepository } from "./supabaseTimeReportingRepository";

const NORD = "cmp_nord";
const FJORD = "cmp_fjord";

interface ReportSeed {
  legacyId: string;
  company: string;
  submittedAt?: string | null;
  status?: string;
  payrollStatus?: string;
  invoiceStatus?: string;
  flagResolution?: string | null;
  ai?: string | null;
  requiresReview?: boolean;
  customer?: string;
  employee?: string;
  serviceRow?: string | null;
  missionEntry?: string | null;
  deviation?: number | null;
  scheduledMinutes?: number;
  actualMinutes?: number;
  deletedAt?: string | null;
  customerName?: string;
  employeeName?: string;
}

function reportRow(s: ReportSeed): Row {
  return {
    legacy_id: s.legacyId,
    company_legacy_id: s.company,
    mission_log_entry_legacy_id: s.missionEntry ?? null,
    customer_legacy_id: s.customer ?? "cust_1",
    customer_name_snapshot: s.customerName ?? "Bergen Office Park",
    employee_legacy_id: s.employee ?? "emp_1",
    employee_name_snapshot: s.employeeName ?? "Astrid Berg",
    work_order_legacy_id: `wo_${s.legacyId}`,
    service_row_legacy_id: s.serviceRow ?? null,
    scheduled_duration_minutes: s.scheduledMinutes ?? 120,
    actual_duration_minutes: s.actualMinutes ?? 120,
    total_deviation_minutes: s.deviation ?? 0,
    status: s.status ?? "employee_submitted",
    payroll_approval_status: s.payrollStatus ?? "not_ready",
    invoice_basis_status: s.invoiceStatus ?? "not_ready",
    requires_admin_review: s.requiresReview ?? false,
    flag_resolution_status: s.flagResolution ?? null,
    ai_recommendation: s.ai ?? null,
    submitted_at: s.submittedAt ?? "2026-06-10T08:00:00.000Z",
    deleted_at: s.deletedAt ?? null,
    data: {
      id: s.legacyId,
      companyId: s.company,
      missionLogEntryId: s.missionEntry ?? "",
      customerId: s.customer ?? "cust_1",
      customerNameSnapshot: s.customerName ?? "Bergen Office Park",
      employeeId: s.employee ?? "emp_1",
      employeeNameSnapshot: s.employeeName ?? "Astrid Berg",
      scheduledDurationMinutes: s.scheduledMinutes ?? 120,
      actualDurationMinutes: s.actualMinutes ?? 120,
      totalDeviationMinutes: s.deviation ?? 0,
      status: s.status ?? "employee_submitted",
      payrollApprovalStatus: s.payrollStatus ?? "not_ready",
      invoiceBasisStatus: s.invoiceStatus ?? "not_ready",
      submittedAt: s.submittedAt ?? "2026-06-10T08:00:00.000Z",
    },
  };
}

beforeEach(() => {
  mocks.client.reset();
});

describe("Slice 2b-2 · empty Supabase is valid (no fallback / no seed)", () => {
  it("returns an empty list and total 0", async () => {
    const res = await supabaseTimeReportingRepository.listSummaries({ companyId: NORD });
    expect(res.items).toEqual([]);
    expect(res.total).toBe(0);
  });

  it("returns null for a missing detail", async () => {
    const detail = await supabaseTimeReportingRepository.getDetail("missing", {
      companyId: NORD,
    });
    expect(detail).toBeNull();
  });

  it("counts zero on an empty table", async () => {
    expect(await supabaseTimeReportingRepository.count({ companyId: NORD })).toBe(0);
  });
});

describe("Slice 2b-2 · list summaries", () => {
  it("maps flat columns + data jsonb into lightweight summaries", async () => {
    mocks.client.seed("time_reports", [
      reportRow({
        legacyId: "t1",
        company: NORD,
        submittedAt: "2026-06-10T08:00:00.000Z",
        status: "approved",
        payrollStatus: "ready",
        invoiceStatus: "not_ready",
        flagResolution: "kept_for_review",
        ai: "likely_approve",
        customer: "cust_9",
        customerName: "Polar Shine Co.",
        employee: "emp_7",
        employeeName: "Kari Nilsen",
        missionEntry: "m1",
        deviation: 15,
        actualMinutes: 135,
      }),
    ]);
    const res = await supabaseTimeReportingRepository.listSummaries({ companyId: NORD });
    expect(res.items).toHaveLength(1);
    const s = res.items[0];
    expect(s.id).toBe("t1");
    expect(s.companyId).toBe(NORD);
    expect(s.missionLogEntryId).toBe("m1");
    expect(s.customerNameSnapshot).toBe("Polar Shine Co.");
    expect(s.employeeNameSnapshot).toBe("Kari Nilsen");
    expect(s.status).toBe("approved");
    // Approval, payroll, invoice and flag-resolution read independently.
    expect(s.payrollApprovalStatus).toBe("ready");
    expect(s.invoiceBasisStatus).toBe("not_ready");
    expect(s.flagResolutionStatus).toBe("kept_for_review");
    expect(s.aiRecommendation).toBe("likely_approve");
    expect(s.totalDeviationMinutes).toBe(15);
    expect(s.actualDurationMinutes).toBe(135);
  });

  it("orders newest submitted report first", async () => {
    mocks.client.seed("time_reports", [
      reportRow({ legacyId: "old", company: NORD, submittedAt: "2026-06-01T08:00:00.000Z" }),
      reportRow({ legacyId: "new", company: NORD, submittedAt: "2026-06-20T08:00:00.000Z" }),
    ]);
    const res = await supabaseTimeReportingRepository.listSummaries({ companyId: NORD });
    expect(res.items.map((i) => i.id)).toEqual(["new", "old"]);
  });
});

describe("Slice 2b-2 · detail with child collections", () => {
  beforeEach(() => {
    mocks.client.seed("time_reports", [
      reportRow({ legacyId: "t1", company: NORD }),
    ]);
    mocks.client.seed("time_allocations", [
      { time_report_legacy_id: "t1", deleted_at: null, created_at: "2026-06-10T08:00:00.000Z", legacy_id: "al1", data: { id: "al1", timeReportId: "t1", allocationType: "scheduled_billable", minutes: 120 } },
      { time_report_legacy_id: "t1", deleted_at: "2026-06-10T09:00:00.000Z", created_at: "2026-06-10T08:30:00.000Z", legacy_id: "al_gone", data: { id: "al_gone", timeReportId: "t1", allocationType: "excluded", minutes: 0 } },
      { time_report_legacy_id: "other", deleted_at: null, created_at: "2026-06-10T08:00:00.000Z", legacy_id: "al_other", data: { id: "al_other", timeReportId: "other", allocationType: "training", minutes: 30 } },
    ]);
    mocks.client.seed("time_report_flags", [
      { time_report_legacy_id: "t1", deleted_at: null, created_at: "2026-06-10T08:00:00.000Z", legacy_id: "fl1", data: { id: "fl1", timeReportId: "t1", flagType: "gps_flag", resolutionStatus: "open" } },
      { time_report_legacy_id: "t1", deleted_at: "2026-06-10T09:00:00.000Z", created_at: "2026-06-10T08:30:00.000Z", legacy_id: "fl_gone", data: { id: "fl_gone", timeReportId: "t1", flagType: "qr_flag", resolutionStatus: "dismissed" } },
    ]);
    mocks.client.seed("time_report_messages", [
      { time_report_legacy_id: "t1", created_at: "2026-06-10T10:00:00.000Z", legacy_id: "ms2", data: { id: "ms2", timeReportId: "t1", senderType: "admin", message: "Please confirm." } },
      { time_report_legacy_id: "t1", created_at: "2026-06-10T08:00:00.000Z", legacy_id: "ms1", data: { id: "ms1", timeReportId: "t1", senderType: "employee", message: "Ran long." } },
    ]);
    mocks.client.seed("time_report_events", [
      { time_report_legacy_id: "t1", occurred_at: "2026-06-10T10:00:00.000Z", legacy_id: "e2", data: { id: "e2", timeReportId: "t1", eventType: "approved", actorType: "admin", occurredAt: "2026-06-10T10:00:00.000Z" } },
      { time_report_legacy_id: "t1", occurred_at: "2026-06-10T08:00:00.000Z", legacy_id: "e1", data: { id: "e1", timeReportId: "t1", eventType: "submitted", actorType: "employee", occurredAt: "2026-06-10T08:00:00.000Z" } },
    ]);
    mocks.client.seed("time_report_flag_events", [
      { time_report_legacy_id: "t1", occurred_at: "2026-06-10T11:00:00.000Z", legacy_id: "fe2", data: { id: "fe2", timeReportFlagId: "fl1", timeReportId: "t1", eventType: "flag_kept", fromResolutionStatus: "reviewed", toResolutionStatus: "kept_for_review", actorType: "admin", occurredAt: "2026-06-10T11:00:00.000Z" } },
      { time_report_legacy_id: "t1", occurred_at: "2026-06-10T09:00:00.000Z", legacy_id: "fe1", data: { id: "fe1", timeReportFlagId: "fl1", timeReportId: "t1", eventType: "flag_reviewed", fromResolutionStatus: "open", toResolutionStatus: "reviewed", actorType: "admin", occurredAt: "2026-06-10T09:00:00.000Z" } },
    ]);
  });

  it("loads only this report's non-deleted allocations", async () => {
    const detail = await supabaseTimeReportingRepository.getDetail("t1");
    expect(detail).not.toBeNull();
    expect(detail?.allocations.map((a) => a.id)).toEqual(["al1"]);
  });

  it("loads only this report's non-deleted flags", async () => {
    const detail = await supabaseTimeReportingRepository.getDetail("t1");
    expect(detail?.flags.map((f) => f.id)).toEqual(["fl1"]);
  });

  it("loads messages ordered oldest-first", async () => {
    const detail = await supabaseTimeReportingRepository.getDetail("t1");
    expect(detail?.messages.map((m) => m.id)).toEqual(["ms1", "ms2"]);
  });

  it("loads the event stream ordered oldest-first", async () => {
    const detail = await supabaseTimeReportingRepository.getDetail("t1");
    expect(detail?.events.map((e) => e.id)).toEqual(["e1", "e2"]);
  });

  it("loads the flag-resolution history ordered oldest-first", async () => {
    const detail = await supabaseTimeReportingRepository.getDetail("t1");
    expect(detail?.flagEvents.map((e) => e.id)).toEqual(["fe1", "fe2"]);
  });
});

describe("Slice 2b-2 · search", () => {
  beforeEach(() => {
    mocks.client.seed("time_reports", [
      reportRow({ legacyId: "t1", company: NORD, employeeName: "Astrid Berg" }),
      reportRow({ legacyId: "t2", company: NORD, employeeName: "Kari Nilsen" }),
    ]);
  });

  it("matches a substring across the flat id + snapshot columns", async () => {
    const res = await supabaseTimeReportingRepository.search({ companyId: NORD, search: "Nilsen" });
    expect(res.items.map((i) => i.id)).toEqual(["t2"]);
  });
});

describe("Slice 2b-2 · count", () => {
  it("counts company-scoped rows ignoring pagination", async () => {
    mocks.client.seed("time_reports", [
      reportRow({ legacyId: "t1", company: NORD }),
      reportRow({ legacyId: "t2", company: NORD }),
      reportRow({ legacyId: "f1", company: FJORD }),
    ]);
    expect(await supabaseTimeReportingRepository.count({ companyId: NORD })).toBe(2);
  });
});

describe("Slice 2b-2 · filters", () => {
  beforeEach(() => {
    mocks.client.seed("time_reports", [
      reportRow({ legacyId: "a", company: NORD, submittedAt: "2026-06-05T08:00:00.000Z", status: "employee_submitted", payrollStatus: "not_ready", invoiceStatus: "not_ready", flagResolution: "open", ai: "review_recommended", customer: "cust_1", employee: "emp_1", serviceRow: "row_1", missionEntry: "m_1", deviation: 5 }),
      reportRow({ legacyId: "b", company: NORD, submittedAt: "2026-06-15T08:00:00.000Z", status: "approved", payrollStatus: "ready", invoiceStatus: "ready", flagResolution: "escalated", ai: "high_risk", requiresReview: true, customer: "cust_2", employee: "emp_2", serviceRow: "row_2", missionEntry: "m_2", deviation: -45 }),
      reportRow({ legacyId: "c", company: NORD, submittedAt: "2026-06-25T08:00:00.000Z", status: "admin_review_required", payrollStatus: "approved", invoiceStatus: "not_ready", flagResolution: "kept_for_review", ai: "likely_approve", customer: "cust_1", employee: "emp_1", serviceRow: "row_1", missionEntry: "m_1", deviation: 90 }),
    ]);
  });

  it("filters by submitted date range (inclusive whole-day window)", async () => {
    const res = await supabaseTimeReportingRepository.listSummaries({ companyId: NORD, fromDate: "2026-06-10", toDate: "2026-06-20" });
    expect(res.items.map((i) => i.id)).toEqual(["b"]);
  });

  it("filters by status", async () => {
    const res = await supabaseTimeReportingRepository.listSummaries({ companyId: NORD, statuses: ["approved", "admin_review_required"] });
    expect(res.items.map((i) => i.id).sort()).toEqual(["b", "c"]);
  });

  it("filters by payroll approval status (independent of invoice)", async () => {
    const res = await supabaseTimeReportingRepository.listSummaries({ companyId: NORD, payrollStatuses: ["ready", "approved"] });
    expect(res.items.map((i) => i.id).sort()).toEqual(["b", "c"]);
  });

  it("filters by invoice basis status (independent of payroll)", async () => {
    const res = await supabaseTimeReportingRepository.listSummaries({ companyId: NORD, invoiceStatuses: ["ready"] });
    expect(res.items.map((i) => i.id)).toEqual(["b"]);
  });

  it("filters by flag resolution status (separate from approval)", async () => {
    const res = await supabaseTimeReportingRepository.listSummaries({ companyId: NORD, flagResolutionStatuses: ["escalated", "kept_for_review"] });
    expect(res.items.map((i) => i.id).sort()).toEqual(["b", "c"]);
  });

  it("filters by AI recommendation (advisory only)", async () => {
    const res = await supabaseTimeReportingRepository.listSummaries({ companyId: NORD, aiRecommendations: ["high_risk"] });
    expect(res.items.map((i) => i.id)).toEqual(["b"]);
  });

  it("filters by requires-admin-review only", async () => {
    const res = await supabaseTimeReportingRepository.listSummaries({ companyId: NORD, requiresAdminReviewOnly: true });
    expect(res.items.map((i) => i.id)).toEqual(["b"]);
  });

  it("filters by employee", async () => {
    const res = await supabaseTimeReportingRepository.listSummaries({ companyId: NORD, employeeIds: ["emp_2"] });
    expect(res.items.map((i) => i.id)).toEqual(["b"]);
  });

  it("filters by customer", async () => {
    const res = await supabaseTimeReportingRepository.listSummaries({ companyId: NORD, customerIds: ["cust_2"] });
    expect(res.items.map((i) => i.id)).toEqual(["b"]);
  });

  it("filters by serviceRowLegacyId", async () => {
    const res = await supabaseTimeReportingRepository.listSummaries({ companyId: NORD, serviceRowLegacyId: "row_2" });
    expect(res.items.map((i) => i.id)).toEqual(["b"]);
  });

  it("filters by missionLogEntryLegacyId", async () => {
    const res = await supabaseTimeReportingRepository.listSummaries({ companyId: NORD, missionLogEntryLegacyId: "m_2" });
    expect(res.items.map((i) => i.id)).toEqual(["b"]);
  });

  it("filters by minimum ABSOLUTE deviation threshold (outside ±X)", async () => {
    // |dev|: a=5, b=45, c=90 → >= 30 keeps b and c.
    const res = await supabaseTimeReportingRepository.listSummaries({ companyId: NORD, minDeviationMinutes: 30 });
    expect(res.items.map((i) => i.id).sort()).toEqual(["b", "c"]);
  });

  it("filters by maximum ABSOLUTE deviation threshold (within ±X)", async () => {
    // |dev| <= 50 keeps a (5) and b (45), not c (90).
    const res = await supabaseTimeReportingRepository.listSummaries({ companyId: NORD, maxDeviationMinutes: 50 });
    expect(res.items.map((i) => i.id).sort()).toEqual(["a", "b"]);
  });
});

describe("Slice 2b-2 · pagination", () => {
  beforeEach(() => {
    const rows: Row[] = [];
    for (let i = 1; i <= 5; i += 1) {
      const day = String(i).padStart(2, "0");
      rows.push(
        reportRow({ legacyId: `t${i}`, company: NORD, submittedAt: `2026-06-${day}T08:00:00.000Z` }),
      );
    }
    mocks.client.seed("time_reports", rows);
  });

  it("returns a server-side page with the full pre-pagination total", async () => {
    const res = await supabaseTimeReportingRepository.listSummaries({ companyId: NORD, page: 1, pageSize: 2 });
    expect(res.items).toHaveLength(2);
    expect(res.total).toBe(5);
    expect(res.page).toBe(1);
    expect(res.pageSize).toBe(2);
    // Newest submitted first → t5, t4 on page 1.
    expect(res.items.map((i) => i.id)).toEqual(["t5", "t4"]);
  });

  it("returns the second page", async () => {
    const res = await supabaseTimeReportingRepository.listSummaries({ companyId: NORD, page: 2, pageSize: 2 });
    expect(res.items.map((i) => i.id)).toEqual(["t3", "t2"]);
    expect(res.total).toBe(5);
  });
});

describe("Slice 2b-2 · soft-delete exclusion", () => {
  it("excludes soft-deleted reports from the list", async () => {
    mocks.client.seed("time_reports", [
      reportRow({ legacyId: "live", company: NORD, submittedAt: "2026-06-10T08:00:00.000Z" }),
      reportRow({ legacyId: "gone", company: NORD, submittedAt: "2026-06-11T08:00:00.000Z", deletedAt: "2026-06-12T00:00:00.000Z" }),
    ]);
    const res = await supabaseTimeReportingRepository.listSummaries({ companyId: NORD });
    expect(res.items.map((i) => i.id)).toEqual(["live"]);
  });

  it("returns null detail for a soft-deleted report", async () => {
    mocks.client.seed("time_reports", [
      reportRow({ legacyId: "gone", company: NORD, deletedAt: "2026-06-12T00:00:00.000Z" }),
    ]);
    expect(await supabaseTimeReportingRepository.getDetail("gone")).toBeNull();
  });
});

describe("Slice 2b-2 · company-scope isolation", () => {
  beforeEach(() => {
    mocks.client.seed("time_reports", [
      reportRow({ legacyId: "n1", company: NORD }),
      reportRow({ legacyId: "f1", company: FJORD }),
    ]);
  });

  it("lists only the scoped company's reports", async () => {
    const res = await supabaseTimeReportingRepository.listSummaries({ companyId: NORD });
    expect(res.items.map((i) => i.id)).toEqual(["n1"]);
  });

  it("returns null detail when the company scope guard does not match", async () => {
    expect(await supabaseTimeReportingRepository.getDetail("f1", { companyId: NORD })).toBeNull();
    expect(await supabaseTimeReportingRepository.getDetail("f1", { companyId: FJORD })).not.toBeNull();
  });
});
