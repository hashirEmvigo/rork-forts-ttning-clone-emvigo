/**
 * Customer lifecycle dependency checks must use shared Supabase truth, never
 * browser-local Work Orders / booking queue state, so preview and online agree.
 */
type Row = Record<string, unknown>;

const mocks = vi.hoisted(() => {
  interface CountResponse {
    data: null;
    error: { message: string } | null;
    count: number | null;
  }

  class FakeCountQuery {
    private filters: Array<(row: Row) => boolean> = [];

    constructor(
      private readonly client: FakeClient,
      private readonly table: string,
    ) {}

    eq(column: string, value: unknown): this {
      this.filters.push((row) => row[column] === value);
      return this;
    }

    is(column: string, value: null): this {
      this.filters.push((row) => row[column] === value || row[column] === undefined);
      return this;
    }

    private resolve(): CountResponse {
      if (this.client.failOn.has(this.table)) {
        return {
          data: null,
          error: { message: `boom:${this.table}` },
          count: null,
        };
      }
      const count = this.client
        .rows(this.table)
        .filter((row) => this.filters.every((filter) => filter(row))).length;
      return { data: null, error: null, count };
    }

    then<TResult1 = CountResponse>(
      onfulfilled?: (value: CountResponse) => TResult1,
    ): Promise<TResult1> {
      const value = this.resolve();
      return Promise.resolve(onfulfilled ? onfulfilled(value) : (value as unknown as TResult1));
    }
  }

  class FakeClient {
    tables = new Map<string, Row[]>();
    failOn = new Set<string>();
    writeCalls: string[] = [];

    rows(table: string): Row[] {
      if (!this.tables.has(table)) this.tables.set(table, []);
      return this.tables.get(table) as Row[];
    }

    seed(table: string, rows: Row[]): void {
      this.rows(table).push(...rows);
    }

    from(table: string) {
      return {
        select: (_columns?: string, _options?: { count?: "exact"; head?: boolean }) =>
          new FakeCountQuery(this, table),
        upsert: () => {
          this.writeCalls.push(`${table}.upsert`);
          return Promise.resolve({ error: null });
        },
        insert: () => {
          this.writeCalls.push(`${table}.insert`);
          return Promise.resolve({ error: null });
        },
        update: () => {
          this.writeCalls.push(`${table}.update`);
          return Promise.resolve({ error: null });
        },
        delete: () => {
          this.writeCalls.push(`${table}.delete`);
          return Promise.resolve({ error: null });
        },
      };
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

import { fetchCustomerDeleteDependencyContext } from "./customerDeleteDependencies";

describe("fetchCustomerDeleteDependencyContext", () => {
  beforeEach(() => {
    mocks.holder.client.reset();
    mocks.holder.configured = true;
  });

  it("allows delete from an empty shared backend even when a browser has local-only Work Orders", async () => {
    const localOnlyWorkOrders = [{ id: "wo-local", customerId: "cust-1" }];

    const result = await fetchCustomerDeleteDependencyContext({
      customerId: "cust-1",
      companyId: "cmp-1",
    });

    expect(localOnlyWorkOrders).toHaveLength(1);
    expect(result.validation.allowed).toBe(true);
    expect(result.counts).toMatchObject({
      workOrderCount: 0,
      bookingQueueCount: 0,
      missionLogEntryCount: 0,
      timeReportCount: 0,
      customerAgreementCount: 0,
      timeBankWalletCount: 0,
      visitOccurrenceCount: 0,
      customerProtocolCount: 0,
      protocolRunCount: 0,
      mediaAssetCount: 0,
      appUserLinkCount: 0,
      missionCount: 0,
    });
    expect(mocks.holder.client.writeCalls).toEqual([]);
  });

  it("returns the same Delete vs Archive decision for two clients with different local state", async () => {
    mocks.holder.client.seed("work_orders", [
      {
        legacy_id: "wo-shared",
        company_legacy_id: "cmp-1",
        customer_legacy_id: "cust-1",
        deleted_at: null,
      },
    ]);
    const clientALocalWorkOrders: Row[] = [];
    const clientBLocalWorkOrders: Row[] = [
      { id: "wo-local-b-1", customerId: "cust-1" },
      { id: "wo-local-b-2", customerId: "cust-2" },
    ];

    const clientA = await fetchCustomerDeleteDependencyContext({
      customerId: "cust-1",
      companyId: "cmp-1",
    });
    const clientB = await fetchCustomerDeleteDependencyContext({
      customerId: "cust-1",
      companyId: "cmp-1",
    });

    expect(clientALocalWorkOrders).toHaveLength(0);
    expect(clientBLocalWorkOrders).toHaveLength(2);
    expect(clientA.validation.allowed).toBe(false);
    expect(clientB.validation.allowed).toBe(false);
    expect(clientA.validation.blockingFactors).toEqual(clientB.validation.blockingFactors);
    expect(clientA.counts).toEqual(clientB.counts);
    expect(clientA.counts.workOrderCount).toBe(1);
  });

  it("counts expanded active non-deleted backend dependencies in the customer company scope", async () => {
    mocks.holder.client.seed("work_orders", [
      { legacy_id: "wo-live", company_legacy_id: "cmp-1", customer_legacy_id: "cust-1", deleted_at: null },
      { legacy_id: "wo-deleted", company_legacy_id: "cmp-1", customer_legacy_id: "cust-1", deleted_at: "2026-06-01T00:00:00Z" },
      { legacy_id: "wo-other-company", company_legacy_id: "cmp-2", customer_legacy_id: "cust-1", deleted_at: null },
    ]);
    mocks.holder.client.seed("booking_queue", [
      { legacy_id: "bq-live", company_legacy_id: "cmp-1", customer_legacy_id: "cust-1", deleted_at: null, cancelled_at: null },
      { legacy_id: "bq-cancelled", company_legacy_id: "cmp-1", customer_legacy_id: "cust-1", deleted_at: null, cancelled_at: "2026-06-01T00:00:00Z" },
      { legacy_id: "bq-deleted", company_legacy_id: "cmp-1", customer_legacy_id: "cust-1", deleted_at: "2026-06-01T00:00:00Z", cancelled_at: null },
    ]);
    mocks.holder.client.seed("mission_log_entries", [
      { legacy_id: "mission-live", company_legacy_id: "cmp-1", customer_legacy_id: "cust-1", deleted_at: null },
      { legacy_id: "mission-other-customer", company_legacy_id: "cmp-1", customer_legacy_id: "cust-2", deleted_at: null },
    ]);
    mocks.holder.client.seed("time_reports", [
      { legacy_id: "tr-live", company_legacy_id: "cmp-1", customer_legacy_id: "cust-1", deleted_at: null },
      { legacy_id: "tr-deleted", company_legacy_id: "cmp-1", customer_legacy_id: "cust-1", deleted_at: "2026-06-01T00:00:00Z" },
    ]);
    mocks.holder.client.seed("customer_agreements", [
      { legacy_id: "agr-live", company_legacy_id: "cmp-1", customer_legacy_id: "cust-1" },
    ]);
    mocks.holder.client.seed("time_bank_wallets", [
      { legacy_id: "wallet-live", company_legacy_id: "cmp-1", customer_legacy_id: "cust-1" },
    ]);
    mocks.holder.client.seed("visit_occurrences", [
      { legacy_id: "visit-live", company_legacy_id: "cmp-1", customer_legacy_id: "cust-1", deleted_at: null },
    ]);
    mocks.holder.client.seed("customer_protocols", [
      { legacy_id: "protocol-live", company_legacy_id: "cmp-1", customer_legacy_id: "cust-1", deleted_at: null },
    ]);
    mocks.holder.client.seed("protocol_runs", [
      { legacy_id: "run-live", company_legacy_id: "cmp-1", customer_legacy_id: "cust-1", deleted_at: null },
    ]);
    mocks.holder.client.seed("media_assets", [
      { legacy_id: "media-live", company_legacy_id: "cmp-1", entity_type: "customer", entity_id: "cust-1", deleted_at: null },
      { legacy_id: "media-work-order", company_legacy_id: "cmp-1", entity_type: "work_order", entity_id: "cust-1", deleted_at: null },
    ]);
    mocks.holder.client.seed("app_users", [
      { legacy_id: "user-linked", company_legacy_id: "cmp-1", "data->>linkedCustomerId": "cust-1", deleted_at: null },
    ]);

    const result = await fetchCustomerDeleteDependencyContext({
      customerId: "cust-1",
      companyId: "cmp-1",
    });

    expect(result.counts).toMatchObject({
      workOrderCount: 1,
      bookingQueueCount: 1,
      missionLogEntryCount: 1,
      timeReportCount: 1,
      customerAgreementCount: 1,
      timeBankWalletCount: 1,
      visitOccurrenceCount: 1,
      customerProtocolCount: 1,
      protocolRunCount: 1,
      mediaAssetCount: 1,
      appUserLinkCount: 1,
      missionCount: 5,
    });
    expect(result.validation.allowed).toBe(false);
    expect(result.validation.reasons).toContain("This customer has one or more work orders.");
    expect(result.validation.reasons).toContain("This customer has bookings, missions, or time reports.");
  });

  it("fails closed when Supabase is unavailable", async () => {
    mocks.holder.configured = false;

    await expect(
      fetchCustomerDeleteDependencyContext({ customerId: "cust-1", companyId: "cmp-1" }),
    ).rejects.toThrow("Supabase is not configured");
  });
});
