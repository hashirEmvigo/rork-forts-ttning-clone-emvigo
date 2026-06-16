import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
type Operation = {
  table: string;
  method: "select" | "eq" | "neq" | "is" | "gte" | "order";
  args: unknown[];
};

type QueryResult = { data: Row[] | null; error: { message: string } | null };

const mocks = vi.hoisted(() => {
  const allowedTable = "customer_temporary_scheduling_exceptions";

  class QueryBuilder {
    private filters: Array<(row: Row) => boolean> = [];
    private orders: Array<{ column: string; ascending: boolean }> = [];
    constructor(
      private readonly table: string,
      private readonly rows: Row[],
      private readonly operations: Operation[],
      private readonly errorByTable: Map<string, { message: string }>,
    ) {}

    eq(column: string, value: unknown): this {
      this.operations.push({ table: this.table, method: "eq", args: [column, value] });
      this.filters.push((row) => row[column] === value);
      return this;
    }

    neq(column: string, value: unknown): this {
      this.operations.push({ table: this.table, method: "neq", args: [column, value] });
      this.filters.push((row) => row[column] !== value);
      return this;
    }

    is(column: string, value: unknown): this {
      this.operations.push({ table: this.table, method: "is", args: [column, value] });
      this.filters.push((row) => row[column] === value);
      return this;
    }

    gte(column: string, value: unknown): this {
      this.operations.push({ table: this.table, method: "gte", args: [column, value] });
      this.filters.push((row) => String(row[column] ?? "") >= String(value));
      return this;
    }

    order(column: string, options: { ascending?: boolean } = {}): this {
      this.operations.push({ table: this.table, method: "order", args: [column, options] });
      this.orders.push({ column, ascending: options.ascending ?? true });
      return this;
    }

    private applied(): Row[] {
      const tableError = this.errorByTable.get(this.table);
      if (tableError) throw tableError;

      const filtered = this.rows.filter((row) => this.filters.every((fn) => fn(row)));
      return [...filtered].sort((a, b) => {
        for (const order of this.orders) {
          const left = String(a[order.column] ?? "");
          const right = String(b[order.column] ?? "");
          if (left === right) continue;
          return order.ascending ? left.localeCompare(right) : right.localeCompare(left);
        }
        return 0;
      });
    }

    then<TResult1 = QueryResult, TResult2 = never>(
      onFulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
      onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): Promise<TResult1 | TResult2> {
      try {
        const value: QueryResult = { data: this.applied(), error: null };
        return Promise.resolve(value).then(onFulfilled ?? undefined, onRejected ?? undefined);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : typeof error === "object" && error !== null && "message" in error
              ? String((error as { message: unknown }).message)
              : "query failed";
        const value: QueryResult = { data: null, error: { message } };
        return Promise.resolve(value).then(onFulfilled ?? undefined, onRejected ?? undefined);
      }
    }
  }

  class FakeClient {
    readonly tables = new Map<string, Row[]>();
    readonly operations: Operation[] = [];
    readonly errorByTable = new Map<string, { message: string }>();

    from(table: string): { select: (columns?: string) => QueryBuilder } {
      if (table !== allowedTable) throw new Error(`Forbidden table access: ${table}`);
      if (!this.tables.has(table)) this.tables.set(table, []);
      const rows = this.tables.get(table) as Row[];
      return {
        select: (columns?: string) => {
          this.operations.push({ table, method: "select", args: [columns] });
          return new QueryBuilder(table, rows, this.operations, this.errorByTable);
        },
      };
    }

    reset(): void {
      this.tables.clear();
      this.operations.length = 0;
      this.errorByTable.clear();
    }
  }

  return { client: new FakeClient(), allowedTable };
});

vi.mock("@/lib/supabase", () => ({
  supabase: mocks.client,
  isSupabaseConfigured: true,
}));

import {
  CUSTOMER_TEMPORARY_SCHEDULING_EXCEPTIONS_TABLE,
  customerTemporarySchedulingExceptionsRepository,
  deriveCustomerTemporarySchedulingExceptionTemporalState,
  mapCustomerTemporarySchedulingExceptionRow,
  type CustomerTemporarySchedulingExceptionSupabaseRow,
} from "./customerTemporarySchedulingExceptionsRepository";

const COMPANY_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_COMPANY_ID = "00000000-0000-4000-8000-000000000002";
const CUSTOMER_ID = "10000000-0000-4000-8000-000000000001";
const OTHER_CUSTOMER_ID = "10000000-0000-4000-8000-000000000002";

function row(
  overrides: Partial<CustomerTemporarySchedulingExceptionSupabaseRow> = {},
): CustomerTemporarySchedulingExceptionSupabaseRow {
  return {
    id: "20000000-0000-4000-8000-000000000001",
    company_id: COMPANY_ID,
    customer_id: CUSTOMER_ID,
    source: "admin_console",
    status: "submitted",
    start_date: "2026-06-10",
    end_date: "2026-06-12",
    windows: [{ start_time: "09:00", end_time: "12:00" }],
    reason_code: "temporary_time_preference",
    customer_note: "TEST customer note",
    admin_note: "QA admin note",
    created_by_actor_type: "admin",
    created_by_user_id: "30000000-0000-4000-8000-000000000001",
    created_by_customer_id: null,
    client_request_id: "CTSE-REQ-1",
    created_at: "2026-06-01T08:00:00.000Z",
    updated_at: "2026-06-01T08:00:00.000Z",
    cancelled_at: null,
    cancelled_by_actor_type: null,
    cancelled_by_user_id: null,
    cancelled_by_customer_id: null,
    reviewed_at: null,
    reviewed_by_user_id: null,
    ...overrides,
  };
}

function seedRows(rows: CustomerTemporarySchedulingExceptionSupabaseRow[]): void {
  mocks.client.tables.set(CUSTOMER_TEMPORARY_SCHEDULING_EXCEPTIONS_TABLE, rows as unknown as Row[]);
}

function calls(method?: Operation["method"]): Operation[] {
  return method
    ? mocks.client.operations.filter((operation) => operation.method === method)
    : [...mocks.client.operations];
}

beforeEach(() => {
  mocks.client.reset();
});

describe("Phase 3B customer temporary scheduling exceptions read model", () => {
  it("maps all expected fields and preserves submitted status and windows", () => {
    const model = mapCustomerTemporarySchedulingExceptionRow(row(), "2026-06-11");

    expect(model).toEqual({
      id: "20000000-0000-4000-8000-000000000001",
      companyId: COMPANY_ID,
      customerId: CUSTOMER_ID,
      source: "admin_console",
      status: "submitted",
      temporalState: "active",
      startDate: "2026-06-10",
      endDate: "2026-06-12",
      windows: [{ start_time: "09:00", end_time: "12:00" }],
      reasonCode: "temporary_time_preference",
      customerNote: "TEST customer note",
      adminNote: "QA admin note",
      createdByActorType: "admin",
      createdByUserId: "30000000-0000-4000-8000-000000000001",
      createdByCustomerId: null,
      clientRequestId: "CTSE-REQ-1",
      createdAt: "2026-06-01T08:00:00.000Z",
      updatedAt: "2026-06-01T08:00:00.000Z",
      cancelledAt: null,
      cancelledByActorType: null,
      cancelledByUserId: null,
      cancelledByCustomerId: null,
      reviewedAt: null,
      reviewedByUserId: null,
    });
  });

  it("preserves accepted_for_planning as planning guidance only in the read model", () => {
    const model = mapCustomerTemporarySchedulingExceptionRow(
      row({
        status: "accepted_for_planning",
        reviewed_at: "2026-06-02T08:00:00.000Z",
        reviewed_by_user_id: "30000000-0000-4000-8000-000000000002",
      }),
      "2026-06-10",
    );

    expect(model.status).toBe("accepted_for_planning");
    expect(model.temporalState).toBe("active");
    expect(model.reviewedAt).toBe("2026-06-02T08:00:00.000Z");
    expect(model.reviewedByUserId).toBe("30000000-0000-4000-8000-000000000002");
  });

  it("preserves empty windows and nullable notes/audit fields", () => {
    const model = mapCustomerTemporarySchedulingExceptionRow(
      row({
        windows: [],
        customer_note: null,
        admin_note: null,
        client_request_id: null,
        reviewed_at: null,
        reviewed_by_user_id: null,
      }),
      "2026-06-09",
    );

    expect(model.windows).toEqual([]);
    expect(model.customerNote).toBeNull();
    expect(model.adminNote).toBeNull();
    expect(model.clientRequestId).toBeNull();
    expect(model.reviewedAt).toBeNull();
    expect(model.reviewedByUserId).toBeNull();
  });
});

describe("Phase 3B customer temporary scheduling exceptions derived temporal state", () => {
  it("derives upcoming before start_date", () => {
    expect(
      deriveCustomerTemporarySchedulingExceptionTemporalState({
        status: "submitted",
        startDate: "2026-06-10",
        endDate: "2026-06-12",
        cancelledAt: null,
        today: "2026-06-09",
      }),
    ).toBe("upcoming");
  });

  it("derives active on start_date", () => {
    expect(
      deriveCustomerTemporarySchedulingExceptionTemporalState({
        status: "submitted",
        startDate: "2026-06-10",
        endDate: "2026-06-12",
        cancelledAt: null,
        today: "2026-06-10",
      }),
    ).toBe("active");
  });

  it("derives active between start_date and end_date", () => {
    expect(
      deriveCustomerTemporarySchedulingExceptionTemporalState({
        status: "accepted_for_planning",
        startDate: "2026-06-10",
        endDate: "2026-06-12",
        cancelledAt: null,
        today: "2026-06-11",
      }),
    ).toBe("active");
  });

  it("derives active on end_date", () => {
    expect(
      deriveCustomerTemporarySchedulingExceptionTemporalState({
        status: "submitted",
        startDate: "2026-06-10",
        endDate: "2026-06-12",
        cancelledAt: null,
        today: "2026-06-12",
      }),
    ).toBe("active");
  });

  it("derives expired after end_date", () => {
    expect(
      deriveCustomerTemporarySchedulingExceptionTemporalState({
        status: "submitted",
        startDate: "2026-06-10",
        endDate: "2026-06-12",
        cancelledAt: null,
        today: "2026-06-13",
      }),
    ).toBe("expired");
  });

  it("lets cancelled status override upcoming, active, and expired temporal states", () => {
    for (const today of ["2026-06-09", "2026-06-10", "2026-06-13"]) {
      expect(
        deriveCustomerTemporarySchedulingExceptionTemporalState({
          status: "cancelled",
          startDate: "2026-06-10",
          endDate: "2026-06-12",
          cancelledAt: "2026-06-08T08:00:00.000Z",
          today,
        }),
      ).toBe("cancelled");
    }
  });

  it("lets cancelled_at override non-cancelled stored statuses", () => {
    expect(
      deriveCustomerTemporarySchedulingExceptionTemporalState({
        status: "submitted",
        startDate: "2026-06-10",
        endDate: "2026-06-12",
        cancelledAt: "2026-06-11T08:00:00.000Z",
        today: "2026-06-11",
      }),
    ).toBe("cancelled");
  });
});

describe("Phase 3B customer temporary scheduling exceptions Supabase-only repository", () => {
  it("uses only the customer_temporary_scheduling_exceptions table and filters by company/customer", async () => {
    seedRows([row(), row({ id: "other", customer_id: OTHER_CUSTOMER_ID })]);

    const result = await customerTemporarySchedulingExceptionsRepository.listForCustomer({
      companyId: COMPANY_ID,
      customerId: CUSTOMER_ID,
      today: "2026-06-11",
    });

    expect(result.map((item) => item.id)).toEqual(["20000000-0000-4000-8000-000000000001"]);
    expect(calls("select")[0]).toMatchObject({
      table: CUSTOMER_TEMPORARY_SCHEDULING_EXCEPTIONS_TABLE,
      method: "select",
    });
    expect(calls("eq")).toEqual(
      expect.arrayContaining([
        { table: CUSTOMER_TEMPORARY_SCHEDULING_EXCEPTIONS_TABLE, method: "eq", args: ["company_id", COMPANY_ID] },
        { table: CUSTOMER_TEMPORARY_SCHEDULING_EXCEPTIONS_TABLE, method: "eq", args: ["customer_id", CUSTOMER_ID] },
      ]),
    );
  });

  it("active/upcoming query excludes expired and cancelled rows but returns submitted and accepted_for_planning guidance", async () => {
    seedRows([
      row({ id: "submitted_active", status: "submitted", start_date: "2026-06-01", end_date: "2026-06-10" }),
      row({
        id: "accepted_upcoming",
        status: "accepted_for_planning",
        start_date: "2026-06-11",
        end_date: "2026-06-20",
        reviewed_at: "2026-06-02T08:00:00.000Z",
        reviewed_by_user_id: "30000000-0000-4000-8000-000000000003",
      }),
      row({ id: "expired", status: "submitted", start_date: "2026-05-01", end_date: "2026-05-31" }),
      row({
        id: "cancelled_future",
        status: "cancelled",
        start_date: "2026-06-11",
        end_date: "2026-06-20",
        cancelled_at: "2026-06-02T08:00:00.000Z",
        cancelled_by_actor_type: "admin",
        cancelled_by_user_id: "30000000-0000-4000-8000-000000000001",
      }),
    ]);

    const result = await customerTemporarySchedulingExceptionsRepository.listActiveOrUpcomingForCustomer({
      companyId: COMPANY_ID,
      customerId: CUSTOMER_ID,
      today: "2026-06-10",
    });

    expect(result.map((item) => item.id)).toEqual(["submitted_active", "accepted_upcoming"]);
    expect(result.map((item) => item.status).sort()).toEqual(["accepted_for_planning", "submitted"]);
    expect(calls("gte")).toEqual([
      { table: CUSTOMER_TEMPORARY_SCHEDULING_EXCEPTIONS_TABLE, method: "gte", args: ["end_date", "2026-06-10"] },
    ]);
    expect(calls("neq")).toEqual([
      { table: CUSTOMER_TEMPORARY_SCHEDULING_EXCEPTIONS_TABLE, method: "neq", args: ["status", "cancelled"] },
    ]);
    expect(calls("is")).toEqual([
      { table: CUSTOMER_TEMPORARY_SCHEDULING_EXCEPTIONS_TABLE, method: "is", args: ["cancelled_at", null] },
    ]);
  });

  it("can include cancelled rows in the full customer list only when explicitly requested", async () => {
    seedRows([
      row({ id: "submitted" }),
      row({
        id: "cancelled",
        status: "cancelled",
        cancelled_at: "2026-06-02T08:00:00.000Z",
        cancelled_by_actor_type: "admin",
        cancelled_by_user_id: "30000000-0000-4000-8000-000000000001",
      }),
    ]);

    const defaultResult = await customerTemporarySchedulingExceptionsRepository.listForCustomer({
      companyId: COMPANY_ID,
      customerId: CUSTOMER_ID,
      today: "2026-06-11",
    });
    const explicitResult = await customerTemporarySchedulingExceptionsRepository.listForCustomer({
      companyId: COMPANY_ID,
      customerId: CUSTOMER_ID,
      includeCancelled: true,
      today: "2026-06-11",
    });

    expect(defaultResult.map((item) => item.id)).toEqual(["submitted"]);
    expect(explicitResult.map((item) => item.id).sort()).toEqual(["cancelled", "submitted"]);
  });

  it("lists submitted exceptions for an optional admin review queue", async () => {
    seedRows([
      row({ id: "submitted_a", status: "submitted", company_id: COMPANY_ID }),
      row({ id: "submitted_b", status: "submitted", company_id: OTHER_COMPANY_ID }),
      row({
        id: "accepted",
        status: "accepted_for_planning",
        company_id: COMPANY_ID,
        reviewed_at: "2026-06-02T08:00:00.000Z",
        reviewed_by_user_id: "30000000-0000-4000-8000-000000000003",
      }),
    ]);

    const scoped = await customerTemporarySchedulingExceptionsRepository.listSubmittedForAdminReview({
      companyId: COMPANY_ID,
      today: "2026-06-09",
    });
    const allRlsVisible = await customerTemporarySchedulingExceptionsRepository.listSubmittedForAdminReview({
      today: "2026-06-09",
    });

    expect(scoped.map((item) => item.id)).toEqual(["submitted_a"]);
    expect(allRlsVisible.map((item) => item.id).sort()).toEqual(["submitted_a", "submitted_b"]);
  });

  it("returns an empty array when Supabase returns a clean empty result", async () => {
    seedRows([]);

    const result = await customerTemporarySchedulingExceptionsRepository.listActiveOrUpcomingForCustomer({
      companyId: COMPANY_ID,
      customerId: CUSTOMER_ID,
      today: "2026-06-10",
    });

    expect(result).toEqual([]);
  });

  it("returns a controlled Supabase read error and does not fall back locally", async () => {
    seedRows([row()]);
    mocks.client.errorByTable.set(CUSTOMER_TEMPORARY_SCHEDULING_EXCEPTIONS_TABLE, {
      message: "TEST Supabase read denied",
    });

    await expect(
      customerTemporarySchedulingExceptionsRepository.listForCustomer({
        companyId: COMPANY_ID,
        customerId: CUSTOMER_ID,
        today: "2026-06-11",
      }),
    ).rejects.toThrow(
      "[customer_temporary_scheduling_exceptions] Supabase customer list failed: TEST Supabase read denied",
    );
  });
});

describe("Phase 3B customer temporary scheduling exceptions regression guards", () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const repositoryPath = path.resolve(
    __dirname,
    "./customerTemporarySchedulingExceptionsRepository.ts",
  );
  const repositorySource = readFileSync(repositoryPath, "utf8");

  it("does not import or reference localStorage, store modules, fallback, mirrors, bridges, or offline queues", () => {
    expect(repositorySource).not.toMatch(/localStorage/i);
    expect(repositorySource).not.toMatch(/@\/lib\/store|\.\/store|from "\.\.\/store"/);
    expect(repositorySource).not.toMatch(/fallback/i);
    expect(repositorySource).not.toMatch(/mirror/i);
    expect(repositorySource).not.toMatch(/bridge/i);
    expect(repositorySource).not.toMatch(/offline\s*queue/i);
  });

  it("does not implement write paths, RPCs, or forbidden table access", () => {
    expect(repositorySource).not.toMatch(/\.insert\s*\(/);
    expect(repositorySource).not.toMatch(/\.upsert\s*\(/);
    expect(repositorySource).not.toMatch(/\.update\s*\(/);
    expect(repositorySource).not.toMatch(/\.delete\s*\(/);
    expect(repositorySource).not.toMatch(/\.rpc\s*\(/);

    const forbiddenReferences = [
      "booking_queue",
      "work_orders",
      "work_order_service_rows",
      "work_order_occurrence_exceptions",
      "occurrence_exceptions",
      "mission_log_entries",
      "mission_staff_sessions",
      "mission_log_events",
      "time_reports",
      "time_allocations",
      "payroll",
      "invoice",
    ];

    for (const forbidden of forbiddenReferences) {
      expect(repositorySource).not.toMatch(new RegExp(forbidden, "i"));
    }
  });
});
