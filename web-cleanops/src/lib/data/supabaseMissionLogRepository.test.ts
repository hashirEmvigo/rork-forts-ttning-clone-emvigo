import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Slice 2b-1 — Mission Log read adapter fixture tests.
 *
 * Proves {@link supabaseMissionLogRepository} reads the migration-0031 tables
 * (`mission_log_entries` / `mission_staff_sessions` / `mission_log_events`)
 * correctly through a fake PostgREST client: empty Supabase is valid (empty list
 * / null detail, NO fallback / NO seed), summaries stay lightweight, detail loads
 * sessions + the ordered event stream, and every list filter / search / count /
 * pagination / soft-delete exclusion / company-scope rule holds. Read-only — no
 * dual-write, no Schedule / payroll / invoice / time-bank writes.
 */

type Row = Record<string, unknown>;

const mocks = vi.hoisted(() => {
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
      this.filters.push((r) => r[col] != null && String(r[col]) >= String(val));
      return this;
    }
    lte(col: string, val: unknown): this {
      this.filters.push((r) => r[col] != null && String(r[col]) <= String(val));
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
          const av = a[s.col];
          const bv = b[s.col];
          if (av === bv) continue;
          const cmp = String(av ?? "") < String(bv ?? "") ? -1 : 1;
          return s.asc ? cmp : -cmp;
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

import { supabaseMissionLogRepository } from "./supabaseMissionLogRepository";

const NORD = "cmp_nord";
const FJORD = "cmp_fjord";

interface EntrySeed {
  legacyId: string;
  company: string;
  scheduledStart: string;
  missionStatus: string;
  delayStatus: string;
  requiresReview?: boolean;
  customer?: string;
  workOrder?: string;
  serviceRow?: string;
  occurrence?: string;
  deletedAt?: string | null;
  customerName?: string;
  actualStart?: string;
  actualEnd?: string;
}

function entryRow(s: EntrySeed): Row {
  return {
    legacy_id: s.legacyId,
    company_legacy_id: s.company,
    booking_occurrence_legacy_id: s.occurrence ?? `occ_${s.legacyId}`,
    work_order_legacy_id: s.workOrder ?? `wo_${s.legacyId}`,
    customer_legacy_id: s.customer ?? "cust_1",
    service_row_legacy_id: s.serviceRow ?? null,
    scheduled_start_time: s.scheduledStart,
    scheduled_end_time: s.scheduledStart,
    mission_status: s.missionStatus,
    delay_status: s.delayStatus,
    requires_admin_review: s.requiresReview ?? false,
    deleted_at: s.deletedAt ?? null,
    data: {
      id: s.legacyId,
      companyId: s.company,
      customerId: s.customer ?? "cust_1",
      customerNameSnapshot: s.customerName ?? "Bergen Office Park",
      workOrderId: s.workOrder ?? `wo_${s.legacyId}`,
      scheduledStartTime: s.scheduledStart,
      scheduledEndTime: s.scheduledStart,
      actualStartTime: s.actualStart,
      actualEndTime: s.actualEnd,
      missionStatus: s.missionStatus,
      delayStatus: s.delayStatus,
    },
  };
}

beforeEach(() => {
  mocks.client.reset();
});

describe("Slice 2b-1 · empty Supabase is valid (no fallback / no seed)", () => {
  it("returns an empty list and total 0", async () => {
    const res = await supabaseMissionLogRepository.listSummaries({ companyId: NORD });
    expect(res.items).toEqual([]);
    expect(res.total).toBe(0);
  });

  it("returns null for a missing detail", async () => {
    const detail = await supabaseMissionLogRepository.getDetail("missing", { companyId: NORD });
    expect(detail).toBeNull();
  });

  it("counts zero on an empty table", async () => {
    expect(await supabaseMissionLogRepository.count({ companyId: NORD })).toBe(0);
  });
});

describe("Slice 2b-1 · list summaries", () => {
  it("maps flat columns + data jsonb into lightweight summaries", async () => {
    mocks.client.seed("mission_log_entries", [
      entryRow({
        legacyId: "m1",
        company: NORD,
        scheduledStart: "2026-06-10T08:00:00.000Z",
        missionStatus: "completed",
        delayStatus: "on_time",
        customerName: "Polar Shine Co.",
        actualStart: "2026-06-10T08:05:00.000Z",
        actualEnd: "2026-06-10T10:00:00.000Z",
      }),
    ]);
    const res = await supabaseMissionLogRepository.listSummaries({ companyId: NORD });
    expect(res.items).toHaveLength(1);
    const s = res.items[0];
    expect(s.id).toBe("m1");
    expect(s.companyId).toBe(NORD);
    expect(s.customerNameSnapshot).toBe("Polar Shine Co.");
    expect(s.actualStartTime).toBe("2026-06-10T08:05:00.000Z");
    expect(s.actualEndTime).toBe("2026-06-10T10:00:00.000Z");
    expect(s.missionStatus).toBe("completed");
  });

  it("orders newest scheduled mission first", async () => {
    mocks.client.seed("mission_log_entries", [
      entryRow({ legacyId: "old", company: NORD, scheduledStart: "2026-06-01T08:00:00.000Z", missionStatus: "completed", delayStatus: "on_time" }),
      entryRow({ legacyId: "new", company: NORD, scheduledStart: "2026-06-20T08:00:00.000Z", missionStatus: "completed", delayStatus: "on_time" }),
    ]);
    const res = await supabaseMissionLogRepository.listSummaries({ companyId: NORD });
    expect(res.items.map((i) => i.id)).toEqual(["new", "old"]);
  });
});

describe("Slice 2b-1 · detail with sessions + event stream", () => {
  beforeEach(() => {
    mocks.client.seed("mission_log_entries", [
      entryRow({ legacyId: "m1", company: NORD, scheduledStart: "2026-06-10T08:00:00.000Z", missionStatus: "completed", delayStatus: "on_time" }),
    ]);
    mocks.client.seed("mission_staff_sessions", [
      { mission_log_entry_legacy_id: "m1", deleted_at: null, data: { id: "ss1", missionLogEntryId: "m1", employeeId: "emp_1" } },
      { mission_log_entry_legacy_id: "m1", deleted_at: "2026-06-10T09:00:00.000Z", data: { id: "ss_deleted", missionLogEntryId: "m1", employeeId: "emp_x" } },
      { mission_log_entry_legacy_id: "other", deleted_at: null, data: { id: "ss_other", missionLogEntryId: "other", employeeId: "emp_2" } },
    ]);
    mocks.client.seed("mission_log_events", [
      { mission_log_entry_legacy_id: "m1", occurred_at: "2026-06-10T10:00:00.000Z", legacy_id: "e2", data: { id: "e2", eventType: "mission_completed" } },
      { mission_log_entry_legacy_id: "m1", occurred_at: "2026-06-10T08:00:00.000Z", legacy_id: "e1", data: { id: "e1", eventType: "mission_started" } },
    ]);
  });

  it("loads only this mission's non-deleted sessions", async () => {
    const detail = await supabaseMissionLogRepository.getDetail("m1");
    expect(detail).not.toBeNull();
    expect(detail?.staffSessions.map((s) => s.id)).toEqual(["ss1"]);
  });

  it("loads the event stream ordered oldest-first", async () => {
    const detail = await supabaseMissionLogRepository.getDetail("m1");
    expect(detail?.events.map((e) => e.id)).toEqual(["e1", "e2"]);
  });
});

describe("Slice 2b-1 · search", () => {
  beforeEach(() => {
    mocks.client.seed("mission_log_entries", [
      entryRow({ legacyId: "m1", company: NORD, scheduledStart: "2026-06-10T08:00:00.000Z", missionStatus: "completed", delayStatus: "on_time", workOrder: "wo_2201" }),
      entryRow({ legacyId: "m2", company: NORD, scheduledStart: "2026-06-11T08:00:00.000Z", missionStatus: "completed", delayStatus: "on_time", workOrder: "wo_9999" }),
    ]);
  });

  it("matches an identifier substring across the flat id columns", async () => {
    const res = await supabaseMissionLogRepository.search({ companyId: NORD, search: "2201" });
    expect(res.items.map((i) => i.id)).toEqual(["m1"]);
  });
});

describe("Slice 2b-1 · count", () => {
  it("counts company-scoped rows ignoring pagination", async () => {
    mocks.client.seed("mission_log_entries", [
      entryRow({ legacyId: "m1", company: NORD, scheduledStart: "2026-06-10T08:00:00.000Z", missionStatus: "completed", delayStatus: "on_time" }),
      entryRow({ legacyId: "m2", company: NORD, scheduledStart: "2026-06-11T08:00:00.000Z", missionStatus: "completed", delayStatus: "on_time" }),
      entryRow({ legacyId: "f1", company: FJORD, scheduledStart: "2026-06-12T08:00:00.000Z", missionStatus: "completed", delayStatus: "on_time" }),
    ]);
    expect(await supabaseMissionLogRepository.count({ companyId: NORD })).toBe(2);
  });
});

describe("Slice 2b-1 · filters", () => {
  beforeEach(() => {
    mocks.client.seed("mission_log_entries", [
      entryRow({ legacyId: "a", company: NORD, scheduledStart: "2026-06-05T08:00:00.000Z", missionStatus: "completed", delayStatus: "on_time", customer: "cust_1", serviceRow: "row_1" }),
      entryRow({ legacyId: "b", company: NORD, scheduledStart: "2026-06-15T08:00:00.000Z", missionStatus: "missed", delayStatus: "critical_delay", requiresReview: true, customer: "cust_2", serviceRow: "row_2" }),
      entryRow({ legacyId: "c", company: NORD, scheduledStart: "2026-06-25T08:00:00.000Z", missionStatus: "in_progress", delayStatus: "over_time", customer: "cust_1", serviceRow: "row_1" }),
    ]);
  });

  it("filters by date range (inclusive whole-day window)", async () => {
    const res = await supabaseMissionLogRepository.listSummaries({ companyId: NORD, fromDate: "2026-06-10", toDate: "2026-06-20" });
    expect(res.items.map((i) => i.id)).toEqual(["b"]);
  });

  it("filters by mission status", async () => {
    const res = await supabaseMissionLogRepository.listSummaries({ companyId: NORD, missionStatuses: ["missed", "in_progress"] });
    expect(res.items.map((i) => i.id).sort()).toEqual(["b", "c"]);
  });

  it("filters by delay status", async () => {
    const res = await supabaseMissionLogRepository.listSummaries({ companyId: NORD, delayStatuses: ["critical_delay"] });
    expect(res.items.map((i) => i.id)).toEqual(["b"]);
  });

  it("filters by requires-admin-review only", async () => {
    const res = await supabaseMissionLogRepository.listSummaries({ companyId: NORD, requiresAdminReviewOnly: true });
    expect(res.items.map((i) => i.id)).toEqual(["b"]);
  });

  it("filters by serviceRowLegacyId", async () => {
    const res = await supabaseMissionLogRepository.listSummaries({ companyId: NORD, serviceRowLegacyId: "row_2" });
    expect(res.items.map((i) => i.id)).toEqual(["b"]);
  });
});

describe("Slice 2b-1 · pagination", () => {
  beforeEach(() => {
    const rows: Row[] = [];
    for (let i = 1; i <= 5; i += 1) {
      const day = String(i).padStart(2, "0");
      rows.push(
        entryRow({ legacyId: `m${i}`, company: NORD, scheduledStart: `2026-06-${day}T08:00:00.000Z`, missionStatus: "completed", delayStatus: "on_time" }),
      );
    }
    mocks.client.seed("mission_log_entries", rows);
  });

  it("returns a server-side page with the full pre-pagination total", async () => {
    const res = await supabaseMissionLogRepository.listSummaries({ companyId: NORD, page: 1, pageSize: 2 });
    expect(res.items).toHaveLength(2);
    expect(res.total).toBe(5);
    expect(res.page).toBe(1);
    expect(res.pageSize).toBe(2);
    // Newest first → m5, m4 on page 1.
    expect(res.items.map((i) => i.id)).toEqual(["m5", "m4"]);
  });

  it("returns the second page", async () => {
    const res = await supabaseMissionLogRepository.listSummaries({ companyId: NORD, page: 2, pageSize: 2 });
    expect(res.items.map((i) => i.id)).toEqual(["m3", "m2"]);
    expect(res.total).toBe(5);
  });
});

describe("Slice 2b-1 · soft-delete exclusion", () => {
  it("excludes soft-deleted entries from the list", async () => {
    mocks.client.seed("mission_log_entries", [
      entryRow({ legacyId: "live", company: NORD, scheduledStart: "2026-06-10T08:00:00.000Z", missionStatus: "completed", delayStatus: "on_time" }),
      entryRow({ legacyId: "gone", company: NORD, scheduledStart: "2026-06-11T08:00:00.000Z", missionStatus: "completed", delayStatus: "on_time", deletedAt: "2026-06-12T00:00:00.000Z" }),
    ]);
    const res = await supabaseMissionLogRepository.listSummaries({ companyId: NORD });
    expect(res.items.map((i) => i.id)).toEqual(["live"]);
  });

  it("returns null detail for a soft-deleted entry", async () => {
    mocks.client.seed("mission_log_entries", [
      entryRow({ legacyId: "gone", company: NORD, scheduledStart: "2026-06-11T08:00:00.000Z", missionStatus: "completed", delayStatus: "on_time", deletedAt: "2026-06-12T00:00:00.000Z" }),
    ]);
    expect(await supabaseMissionLogRepository.getDetail("gone")).toBeNull();
  });
});

describe("Slice 2b-1 · company-scope isolation", () => {
  beforeEach(() => {
    mocks.client.seed("mission_log_entries", [
      entryRow({ legacyId: "n1", company: NORD, scheduledStart: "2026-06-10T08:00:00.000Z", missionStatus: "completed", delayStatus: "on_time" }),
      entryRow({ legacyId: "f1", company: FJORD, scheduledStart: "2026-06-10T08:00:00.000Z", missionStatus: "completed", delayStatus: "on_time" }),
    ]);
  });

  it("lists only the scoped company's missions", async () => {
    const res = await supabaseMissionLogRepository.listSummaries({ companyId: NORD });
    expect(res.items.map((i) => i.id)).toEqual(["n1"]);
  });

  it("returns null detail when the company scope guard does not match", async () => {
    expect(await supabaseMissionLogRepository.getDetail("f1", { companyId: NORD })).toBeNull();
    expect(await supabaseMissionLogRepository.getDetail("f1", { companyId: FJORD })).not.toBeNull();
  });
});
