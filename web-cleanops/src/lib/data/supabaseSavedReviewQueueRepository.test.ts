import { beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";

/**
 * Slice 2b-3 — Saved Review Queue read adapter fixture tests.
 *
 * Proves {@link supabaseSavedReviewQueueRepository} reads the migration-0032
 * `saved_review_queues` (+ linked `saved_filters`) tables correctly through a
 * fake PostgREST client: empty Supabase is valid (empty list / null getById, NO
 * fallback / NO seed), queue rows map flat columns + the lossless `data` jsonb,
 * shared and private queues are both returned with `shared` mapped correctly,
 * ordering is deterministic (sort_order then legacy_id), the saved-filter LINK is
 * hydrated in getById only when the queue does not embed its filter, and
 * soft-delete exclusion / company-scope isolation / pagination all hold.
 * Read-only — no create/update/delete, no filter evaluation, no behaviour.
 */

type Row = Record<string, unknown>;

const mocks = vi.hoisted(() => {
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
    is(col: string, val: unknown): this {
      this.filters.push((r) =>
        val === null ? r[col] === null || r[col] === undefined : r[col] === val,
      );
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

import { supabaseSavedReviewQueueRepository } from "./supabaseSavedReviewQueueRepository";

const NORD = "cmp_nord";
const FJORD = "cmp_fjord";

interface QueueSeed {
  legacyId: string;
  company: string;
  name?: string;
  description?: string | null;
  shared?: boolean;
  sortOrder?: number;
  savedFilterLegacyId?: string | null;
  deletedAt?: string | null;
  /** When omitted, the queue embeds a filter; set `embedFilter: false` to drop it. */
  embedFilter?: boolean;
}

function queueRow(s: QueueSeed): Row {
  const embeddedFilter =
    s.embedFilter === false
      ? undefined
      : {
          id: `flt_${s.legacyId}`,
          companyId: s.company,
          name: `${s.name ?? "Queue"} filter`,
          match: "all",
          criteria: [{ field: "gps_flag", operator: "exists", values: [] }],
          createdAt: "2026-06-01T08:00:00.000Z",
          updatedAt: "2026-06-01T08:00:00.000Z",
        };
  return {
    legacy_id: s.legacyId,
    company_legacy_id: s.company,
    name: s.name ?? "GPS flags",
    description: s.description ?? null,
    saved_filter_legacy_id: s.savedFilterLegacyId ?? null,
    shared: s.shared ?? false,
    sort_order: s.sortOrder ?? 0,
    created_by_user_id: "user_1",
    deleted_at: s.deletedAt ?? null,
    created_at: "2026-06-01T08:00:00.000Z",
    updated_at: "2026-06-02T08:00:00.000Z",
    data: {
      id: s.legacyId,
      companyId: s.company,
      name: s.name ?? "GPS flags",
      description: s.description ?? undefined,
      shared: s.shared ?? false,
      sortOrder: s.sortOrder ?? 0,
      createdByUserId: "user_1",
      createdAt: "2026-06-01T08:00:00.000Z",
      updatedAt: "2026-06-02T08:00:00.000Z",
      ...(embeddedFilter ? { filter: embeddedFilter } : {}),
    },
  };
}

function filterRow(legacyId: string, company: string, deletedAt?: string | null): Row {
  return {
    legacy_id: legacyId,
    company_legacy_id: company,
    deleted_at: deletedAt ?? null,
    data: {
      id: legacyId,
      companyId: company,
      name: "Linked GPS filter",
      match: "any",
      criteria: [{ field: "gps_flag", operator: "exists", values: [] }],
      createdAt: "2026-06-01T08:00:00.000Z",
      updatedAt: "2026-06-01T08:00:00.000Z",
    },
  };
}

beforeEach(() => {
  mocks.client.reset();
});

describe("Slice 2b-3 · empty Supabase is valid (no fallback / no seed)", () => {
  it("returns an empty list and total 0", async () => {
    const res = await supabaseSavedReviewQueueRepository.list({ companyId: NORD });
    expect(res.items).toEqual([]);
    expect(res.total).toBe(0);
  });

  it("returns null for a missing queue", async () => {
    const queue = await supabaseSavedReviewQueueRepository.getById("missing", {
      companyId: NORD,
    });
    expect(queue).toBeNull();
  });

  it("counts zero on an empty table", async () => {
    expect(await supabaseSavedReviewQueueRepository.count({ companyId: NORD })).toBe(0);
  });
});

describe("Slice 2b-3 · list queues", () => {
  it("maps flat columns + data jsonb into the queue shape", async () => {
    mocks.client.seed("saved_review_queues", [
      queueRow({
        legacyId: "q1",
        company: NORD,
        name: "Training time",
        description: "Likely safe to approve",
        shared: true,
        sortOrder: 2,
      }),
    ]);
    const res = await supabaseSavedReviewQueueRepository.list({ companyId: NORD });
    expect(res.items).toHaveLength(1);
    const q = res.items[0];
    expect(q.id).toBe("q1");
    expect(q.companyId).toBe(NORD);
    expect(q.name).toBe("Training time");
    expect(q.description).toBe("Likely safe to approve");
    expect(q.shared).toBe(true);
    expect(q.sortOrder).toBe(2);
    expect(q.filter.criteria).toHaveLength(1);
  });

  it("returns both shared and private queues with the shared flag mapped", async () => {
    mocks.client.seed("saved_review_queues", [
      queueRow({ legacyId: "shared_q", company: NORD, shared: true, sortOrder: 0 }),
      queueRow({ legacyId: "private_q", company: NORD, shared: false, sortOrder: 1 }),
    ]);
    const res = await supabaseSavedReviewQueueRepository.list({ companyId: NORD });
    expect(res.items.map((q) => [q.id, q.shared])).toEqual([
      ["shared_q", true],
      ["private_q", false],
    ]);
  });

  it("orders by sort_order then legacy_id", async () => {
    mocks.client.seed("saved_review_queues", [
      queueRow({ legacyId: "b", company: NORD, sortOrder: 1 }),
      queueRow({ legacyId: "a", company: NORD, sortOrder: 1 }),
      queueRow({ legacyId: "first", company: NORD, sortOrder: 0 }),
    ]);
    const res = await supabaseSavedReviewQueueRepository.list({ companyId: NORD });
    expect(res.items.map((q) => q.id)).toEqual(["first", "a", "b"]);
  });
});

describe("Slice 2b-3 · getById + saved-filter link mapping", () => {
  it("returns the embedded filter without touching saved_filters", async () => {
    mocks.client.seed("saved_review_queues", [
      queueRow({ legacyId: "q1", company: NORD }),
    ]);
    const queue = await supabaseSavedReviewQueueRepository.getById("q1");
    expect(queue).not.toBeNull();
    expect(queue?.filter.name).toBe("Queue filter");
    expect(queue?.filter.match).toBe("all");
  });

  it("hydrates the linked saved filter when the queue has no embedded filter", async () => {
    mocks.client.seed("saved_review_queues", [
      queueRow({
        legacyId: "q1",
        company: NORD,
        embedFilter: false,
        savedFilterLegacyId: "flt_linked",
      }),
    ]);
    mocks.client.seed("saved_filters", [filterRow("flt_linked", NORD)]);
    const queue = await supabaseSavedReviewQueueRepository.getById("q1");
    expect(queue?.filter.name).toBe("Linked GPS filter");
    expect(queue?.filter.match).toBe("any");
    expect(queue?.filter.criteria).toHaveLength(1);
  });

  it("falls back to an empty filter when the linked filter is soft-deleted", async () => {
    mocks.client.seed("saved_review_queues", [
      queueRow({
        legacyId: "q1",
        company: NORD,
        embedFilter: false,
        savedFilterLegacyId: "flt_gone",
      }),
    ]);
    mocks.client.seed("saved_filters", [
      filterRow("flt_gone", NORD, "2026-06-05T00:00:00.000Z"),
    ]);
    const queue = await supabaseSavedReviewQueueRepository.getById("q1");
    expect(queue?.filter.criteria).toEqual([]);
    expect(queue?.filter.id).toBe("flt_gone");
  });
});

describe("Slice 2b-3 · count", () => {
  it("counts company-scoped queues", async () => {
    mocks.client.seed("saved_review_queues", [
      queueRow({ legacyId: "q1", company: NORD }),
      queueRow({ legacyId: "q2", company: NORD }),
      queueRow({ legacyId: "f1", company: FJORD }),
    ]);
    expect(await supabaseSavedReviewQueueRepository.count({ companyId: NORD })).toBe(2);
  });
});

describe("Slice 2b-3 · pagination", () => {
  beforeEach(() => {
    const rows: Row[] = [];
    for (let i = 1; i <= 5; i += 1) {
      rows.push(queueRow({ legacyId: `q${i}`, company: NORD, sortOrder: i }));
    }
    mocks.client.seed("saved_review_queues", rows);
  });

  it("returns a server-side page with the full pre-pagination total", async () => {
    const res = await supabaseSavedReviewQueueRepository.list({
      companyId: NORD,
      page: 1,
      pageSize: 2,
    });
    expect(res.items.map((q) => q.id)).toEqual(["q1", "q2"]);
    expect(res.total).toBe(5);
    expect(res.page).toBe(1);
    expect(res.pageSize).toBe(2);
  });

  it("returns the second page", async () => {
    const res = await supabaseSavedReviewQueueRepository.list({
      companyId: NORD,
      page: 2,
      pageSize: 2,
    });
    expect(res.items.map((q) => q.id)).toEqual(["q3", "q4"]);
    expect(res.total).toBe(5);
  });
});

describe("Slice 2b-3 · soft-delete exclusion", () => {
  it("excludes soft-deleted queues from the list", async () => {
    mocks.client.seed("saved_review_queues", [
      queueRow({ legacyId: "live", company: NORD, sortOrder: 0 }),
      queueRow({
        legacyId: "gone",
        company: NORD,
        sortOrder: 1,
        deletedAt: "2026-06-12T00:00:00.000Z",
      }),
    ]);
    const res = await supabaseSavedReviewQueueRepository.list({ companyId: NORD });
    expect(res.items.map((q) => q.id)).toEqual(["live"]);
  });

  it("returns null getById for a soft-deleted queue", async () => {
    mocks.client.seed("saved_review_queues", [
      queueRow({ legacyId: "gone", company: NORD, deletedAt: "2026-06-12T00:00:00.000Z" }),
    ]);
    expect(await supabaseSavedReviewQueueRepository.getById("gone")).toBeNull();
  });
});

describe("Slice 2b-3 · company-scope isolation", () => {
  beforeEach(() => {
    mocks.client.seed("saved_review_queues", [
      queueRow({ legacyId: "n1", company: NORD }),
      queueRow({ legacyId: "f1", company: FJORD }),
    ]);
  });

  it("lists only the scoped company's queues", async () => {
    const res = await supabaseSavedReviewQueueRepository.list({ companyId: NORD });
    expect(res.items.map((q) => q.id)).toEqual(["n1"]);
  });

  it("returns null getById when the company-scope guard does not match", async () => {
    expect(
      await supabaseSavedReviewQueueRepository.getById("f1", { companyId: NORD }),
    ).toBeNull();
    expect(
      await supabaseSavedReviewQueueRepository.getById("f1", { companyId: FJORD }),
    ).not.toBeNull();
  });

  it("matches a free-text search against name", async () => {
    mocks.client.reset();
    mocks.client.seed("saved_review_queues", [
      queueRow({ legacyId: "n1", company: NORD, name: "GPS flags" }),
      queueRow({ legacyId: "n2", company: NORD, name: "Training time" }),
    ]);
    const res = await supabaseSavedReviewQueueRepository.list({
      companyId: NORD,
      search: "Training",
    });
    expect(res.items.map((q) => q.id)).toEqual(["n2"]);
  });
});
