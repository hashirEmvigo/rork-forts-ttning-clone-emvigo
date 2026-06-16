import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ProtocolRunItem,
  ProtocolRunSection,
  ProtocolRunV2,
} from "@/types";
import type {
  ProtocolRunAggregate,
  ProtocolRunUpsertRow,
} from "./supabaseProtocolRunRepository";

/**
 * Phase 2C-A1 — Protocol Run Supabase repository boundary tests.
 *
 * These tests use an in-memory PostgREST-shaped client only. They prove the new
 * boundary does not read browser storage, treats empty Supabase as authoritative,
 * scopes reads by company, updates status and item state inside the JSON
 * aggregate, and excludes soft-deleted rows by default.
 */

type Row = Record<string, unknown>;

const mocks = vi.hoisted(() => {
  function compare(a: unknown, b: unknown): number {
    const as = String(a ?? "");
    const bs = String(b ?? "");
    return as === bs ? 0 : as < bs ? -1 : 1;
  }

  class QueryBuilder {
    private filters: Array<(row: Row) => boolean> = [];
    private sorts: Array<{ column: string; ascending: boolean }> = [];

    constructor(private rows: Row[]) {}

    eq(column: string, value: unknown): this {
      this.filters.push((row) => row[column] === value);
      return this;
    }

    is(column: string, value: unknown): this {
      this.filters.push((row) =>
        value === null ? row[column] === null || row[column] === undefined : row[column] === value,
      );
      return this;
    }

    order(column: string, opts: { ascending: boolean }): this {
      this.sorts.push({ column, ascending: opts.ascending });
      return this;
    }

    private applied(): Row[] {
      const filtered = this.rows.filter((row) => this.filters.every((filter) => filter(row)));
      return [...filtered].sort((a, b) => {
        for (const sort of this.sorts) {
          const result = compare(a[sort.column], b[sort.column]);
          if (result !== 0) return sort.ascending ? result : -result;
        }
        return 0;
      });
    }

    maybeSingle(): Promise<{ data: Row | null; error: null }> {
      return Promise.resolve({ data: this.applied()[0] ?? null, error: null });
    }

    then<R>(onFulfilled: (result: { data: Row[]; error: null }) => R): Promise<R> {
      return Promise.resolve({ data: this.applied(), error: null }).then(onFulfilled);
    }
  }

  class MutationBuilder {
    private filters: Array<(row: Row) => boolean> = [];
    private shouldReturnRows = false;

    constructor(
      private rows: Row[],
      private kind: "insert" | "update",
      private payload: Row | Row[],
    ) {}

    eq(column: string, value: unknown): this {
      this.filters.push((row) => row[column] === value);
      return this;
    }

    is(column: string, value: unknown): this {
      this.filters.push((row) =>
        value === null ? row[column] === null || row[column] === undefined : row[column] === value,
      );
      return this;
    }

    select(): this {
      this.shouldReturnRows = true;
      return this;
    }

    private apply(): Row[] {
      if (this.kind === "insert") {
        const inserted = Array.isArray(this.payload) ? this.payload : [this.payload];
        const copies = inserted.map((row) => ({ ...row }));
        this.rows.push(...copies);
        return this.shouldReturnRows ? copies : [];
      }

      const patch = this.payload as Row;
      const updated: Row[] = [];
      for (let i = 0; i < this.rows.length; i += 1) {
        const row = this.rows[i];
        if (!this.filters.every((filter) => filter(row))) continue;
        const next = { ...row, ...patch };
        this.rows[i] = next;
        updated.push(next);
      }
      return this.shouldReturnRows ? updated : [];
    }

    maybeSingle(): Promise<{ data: Row | null; error: null }> {
      return Promise.resolve({ data: this.apply()[0] ?? null, error: null });
    }

    then<R>(onFulfilled: (result: { data: Row[] | null; error: null }) => R): Promise<R> {
      return Promise.resolve({ data: this.apply(), error: null }).then(onFulfilled);
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
        select: () => new QueryBuilder(rows),
        insert: (payload: Row | Row[]) => new MutationBuilder(rows, "insert", payload),
        update: (payload: Row) => new MutationBuilder(rows, "update", payload),
      };
    }

    seed(name: string, rows: Row[]): void {
      this.tables.set(name, rows.map((row) => ({ ...row })));
    }

    tableRows(name: string): Row[] {
      return this.table(name);
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

vi.mock("@/lib/perf", () => ({
  perf: {
    start: () => () => undefined,
  },
}));

import {
  supabaseProtocolRunRepository,
  toProtocolRunUpsertRow,
} from "./supabaseProtocolRunRepository";

const COMPANY = "cmp_nord";
const OTHER_COMPANY = "cmp_fjord";
const COMPANY_UUID = "11111111-1111-4111-8111-111111111111";
const OTHER_COMPANY_UUID = "22222222-2222-4222-8222-222222222222";
const CREATED = "2026-06-01T08:00:00.000Z";
const LATER = "2026-06-01T09:00:00.000Z";

function run(overrides: Partial<ProtocolRunV2> = {}): ProtocolRunV2 {
  return {
    id: "prun_1",
    companyId: COMPANY,
    sourceTemplateId: "tpl_1",
    sourceTemplateName: "Office weekly",
    sourceTemplateVersion: 3,
    sourceCustomerProtocolId: "cprot_1",
    sourceCustomerProtocolName: "Acme weekly",
    customerId: "cust_1",
    workOrderId: "wo_1",
    visitOccurrenceId: "visit_1",
    assignedEmployeeIds: ["emp_1"],
    schemaVersion: 1,
    status: "draft",
    generatedAt: CREATED,
    generatedBy: "user_1",
    createdAt: CREATED,
    updatedAt: CREATED,
    ...overrides,
  };
}

function sections(runId = "prun_1", companyId = COMPANY): ProtocolRunSection[] {
  return [
    { id: "sec_b", companyId, runId, title: "Bathrooms", sortOrder: 2 },
    { id: "sec_a", companyId, runId, title: "Entrance", sortOrder: 1 },
  ];
}

function items(runId = "prun_1", companyId = COMPANY): ProtocolRunItem[] {
  return [
    {
      id: "item_b",
      companyId,
      runId,
      sectionId: "sec_a",
      title: "Mop floor",
      required: true,
      sortOrder: 2,
      status: "pending",
    },
    {
      id: "item_a",
      companyId,
      runId,
      sectionId: "sec_a",
      title: "Check entrance mat",
      description: "Replace if wet",
      required: false,
      sortOrder: 1,
      status: "pending",
    },
  ];
}

function aggregate(overrides: Partial<ProtocolRunV2> = {}): ProtocolRunAggregate {
  const r = run(overrides);
  return { run: r, sections: sections(r.id, r.companyId), items: items(r.id, r.companyId) };
}

function row(
  aggregateInput: ProtocolRunAggregate,
  companyUuid = COMPANY_UUID,
  overrides: Partial<ProtocolRunUpsertRow> = {},
): Row {
  return { ...toProtocolRunUpsertRow(aggregateInput, companyUuid), ...overrides } satisfies Row;
}

beforeEach(() => {
  mocks.client.reset();
});

describe("Phase 2C-A1 protocol run mapping", () => {
  it("maps aggregate fields to flat protocol_runs columns and sorted JSON data", () => {
    const mapped = toProtocolRunUpsertRow(aggregate(), COMPANY_UUID);

    expect(mapped).toMatchObject({
      legacy_id: "prun_1",
      company_id: COMPANY_UUID,
      company_legacy_id: COMPANY,
      customer_legacy_id: "cust_1",
      work_order_legacy_id: "wo_1",
      visit_occurrence_legacy_id: "visit_1",
      source_customer_protocol_legacy_id: "cprot_1",
      status: "draft",
      generated_at: CREATED,
      completed_at: null,
      deleted_at: null,
    });
    expect(mapped.data.sections.map((section) => section.id)).toEqual(["sec_a", "sec_b"]);
    expect(mapped.data.items.map((item) => item.id)).toEqual(["item_a", "item_b"]);
  });
});

describe("Phase 2C-A1 empty reads and tenant scoping", () => {
  it("returns [] / null when Supabase is empty with no fallback or seed", async () => {
    await expect(supabaseProtocolRunRepository.listByCompany(COMPANY)).resolves.toEqual([]);
    await expect(
      supabaseProtocolRunRepository.getByLegacyId("missing", { companyId: COMPANY }),
    ).resolves.toBeNull();
  });

  it("lists only the requested company and excludes deleted rows", async () => {
    mocks.client.seed("protocol_runs", [
      row(aggregate({ id: "prun_a", generatedAt: "2026-06-01T08:00:00.000Z" })),
      row(aggregate({ id: "prun_deleted", generatedAt: "2026-06-01T10:00:00.000Z" }), COMPANY_UUID, {
        deleted_at: "2026-06-02T08:00:00.000Z",
      }),
      row(
        aggregate({ id: "prun_other", companyId: OTHER_COMPANY, generatedAt: "2026-06-01T11:00:00.000Z" }),
        OTHER_COMPANY_UUID,
      ),
      row(aggregate({ id: "prun_b", generatedAt: "2026-06-01T09:00:00.000Z" })),
    ]);

    const result = await supabaseProtocolRunRepository.listByCompany(COMPANY);
    expect(result.map((item) => item.run.id)).toEqual(["prun_b", "prun_a"]);
  });

  it("returns null when getByLegacyId is out of requested company scope", async () => {
    mocks.client.seed("protocol_runs", [row(aggregate())]);

    await expect(
      supabaseProtocolRunRepository.getByLegacyId("prun_1", { companyId: OTHER_COMPANY }),
    ).resolves.toBeNull();
  });
});

describe("Phase 2C-A1 writes and JSON aggregate updates", () => {
  it("creates a run aggregate in Supabase without touching browser storage", async () => {
    const created = await supabaseProtocolRunRepository.createRunAggregate(aggregate(), {
      companyUuid: COMPANY_UUID,
    });

    expect(created.run.id).toBe("prun_1");
    expect(mocks.client.tableRows("protocol_runs")).toHaveLength(1);
    expect(mocks.client.tableRows("protocol_runs")[0]).toMatchObject({
      legacy_id: "prun_1",
      company_id: COMPANY_UUID,
      company_legacy_id: COMPANY,
    });
  });

  it("updates run aggregate status and completedAt", async () => {
    mocks.client.seed("protocol_runs", [row(aggregate())]);

    const updated = await supabaseProtocolRunRepository.updateRunAggregateStatus(
      "prun_1",
      "completed",
      { companyId: COMPANY, now: LATER },
    );

    expect(updated?.run.status).toBe("completed");
    expect(updated?.run.completedAt).toBe(LATER);
    expect(updated?.run.updatedAt).toBe(LATER);
    expect(mocks.client.tableRows("protocol_runs")[0].status).toBe("completed");
    expect(mocks.client.tableRows("protocol_runs")[0].completed_at).toBe(LATER);
  });

  it("updates one item status inside the JSON aggregate", async () => {
    mocks.client.seed("protocol_runs", [row(aggregate())]);

    const updated = await supabaseProtocolRunRepository.updateItemStatusInsideAggregate(
      "prun_1",
      "item_a",
      "done",
      { companyId: COMPANY, completedBy: "emp_1", now: LATER },
    );

    const itemA = updated?.items.find((item) => item.id === "item_a");
    const itemB = updated?.items.find((item) => item.id === "item_b");
    expect(itemA).toMatchObject({ status: "done", completedBy: "emp_1", completedAt: LATER });
    expect(itemB?.status).toBe("pending");

    const stored = mocks.client.tableRows("protocol_runs")[0].data as ProtocolRunAggregate;
    expect(stored.items.find((item) => item.id === "item_a")?.status).toBe("done");
  });

  it("soft-deletes a run and excludes it from later reads", async () => {
    mocks.client.seed("protocol_runs", [row(aggregate())]);

    await expect(
      supabaseProtocolRunRepository.softDeleteRun("prun_1", { companyId: COMPANY, now: LATER }),
    ).resolves.toBe(true);
    await expect(supabaseProtocolRunRepository.listByCompany(COMPANY)).resolves.toEqual([]);
    await expect(
      supabaseProtocolRunRepository.getByLegacyId("prun_1", { companyId: COMPANY }),
    ).resolves.toBeNull();
  });
});
