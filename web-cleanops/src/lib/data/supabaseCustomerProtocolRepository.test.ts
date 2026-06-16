import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CustomerProtocolItem,
  CustomerProtocolSection,
  CustomerProtocolV2,
} from "@/types";
import type {
  CustomerProtocolAggregate,
  CustomerProtocolUpsertRow,
} from "./supabaseCustomerProtocolRepository";

/**
 * Phase 2C-A3.1 — Customer Protocol Supabase repository boundary tests.
 *
 * These tests use an in-memory PostgREST-shaped client only. They prove the new
 * boundary does not touch browser storage, treats empty Supabase as
 * authoritative, scopes reads by company/customer, mutates JSON aggregate
 * sections/items, archives/restores via Supabase, and excludes deleted_at rows.
 */

type Row = Record<string, unknown>;

const mocks = vi.hoisted(() => {
  class QueryBuilder {
    private filters: Array<(row: Row) => boolean> = [];

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

    private applied(): Row[] {
      return this.rows.filter((row) => this.filters.every((filter) => filter(row)));
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
    count: () => undefined,
  },
}));

import {
  supabaseCustomerProtocolRepository,
  toCustomerProtocolUpsertRow,
} from "./supabaseCustomerProtocolRepository";

const COMPANY = "cmp_nord";
const OTHER_COMPANY = "cmp_fjord";
const CUSTOMER = "cust_1";
const OTHER_CUSTOMER = "cust_2";
const COMPANY_UUID = "11111111-1111-4111-8111-111111111111";
const CREATED = "2026-06-01T08:00:00.000Z";
const LATER = "2026-06-01T09:00:00.000Z";

function protocol(overrides: Partial<CustomerProtocolV2> = {}): CustomerProtocolV2 {
  return {
    id: "cprot_1",
    companyId: COMPANY,
    customerId: CUSTOMER,
    sourceTemplateId: "tpl_1",
    sourceTemplateName: "Office weekly",
    sourceTemplateVersion: 1,
    name: "Acme weekly",
    description: "Main office protocol",
    categoryIds: ["cat_1"],
    floorPresetIds: ["floor_1"],
    isArchived: false,
    schemaVersion: 1,
    createdAt: CREATED,
    updatedAt: CREATED,
    ...overrides,
  };
}

function sections(protocolId = "cprot_1", companyId = COMPANY, customerId = CUSTOMER): CustomerProtocolSection[] {
  return [
    {
      id: "sec_b",
      companyId,
      customerId,
      customerProtocolId: protocolId,
      title: "Bathrooms",
      sortOrder: 2,
      createdAt: CREATED,
      updatedAt: CREATED,
    },
    {
      id: "sec_a",
      companyId,
      customerId,
      customerProtocolId: protocolId,
      title: "Entrance",
      sortOrder: 1,
      createdAt: CREATED,
      updatedAt: CREATED,
    },
  ];
}

function items(protocolId = "cprot_1", companyId = COMPANY, customerId = CUSTOMER): CustomerProtocolItem[] {
  return [
    {
      id: "item_b",
      companyId,
      customerId,
      customerProtocolId: protocolId,
      sectionId: "sec_a",
      title: "Mop floor",
      required: true,
      sortOrder: 2,
      createdAt: CREATED,
      updatedAt: CREATED,
    },
    {
      id: "item_a",
      companyId,
      customerId,
      customerProtocolId: protocolId,
      sectionId: "sec_a",
      title: "Check entrance mat",
      description: "Replace if wet",
      required: false,
      sortOrder: 1,
      createdAt: CREATED,
      updatedAt: CREATED,
    },
  ];
}

function aggregate(overrides: Partial<CustomerProtocolV2> = {}): CustomerProtocolAggregate {
  const p = protocol(overrides);
  return {
    protocol: p,
    sections: sections(p.id, p.companyId, p.customerId),
    items: items(p.id, p.companyId, p.customerId),
  };
}

function row(
  aggregateInput: CustomerProtocolAggregate,
  companyUuid = COMPANY_UUID,
  overrides: Partial<CustomerProtocolUpsertRow> = {},
): Row {
  return { ...toCustomerProtocolUpsertRow(aggregateInput, companyUuid), ...overrides } satisfies Row;
}

beforeEach(() => {
  mocks.client.reset();
  vi.restoreAllMocks();
});

describe("Phase 2C-A3.1 customer protocol mapping", () => {
  it("maps aggregate fields to flat customer_protocols columns and sorted JSON data", () => {
    const mapped = toCustomerProtocolUpsertRow(aggregate(), COMPANY_UUID);

    expect(mapped).toMatchObject({
      legacy_id: "cprot_1",
      company_id: COMPANY_UUID,
      company_legacy_id: COMPANY,
      customer_legacy_id: CUSTOMER,
      name: "Acme weekly",
      is_archived: false,
      deleted_at: null,
    });
    expect(mapped.data.sections.map((section) => section.id)).toEqual(["sec_a", "sec_b"]);
    expect(mapped.data.items.map((item) => item.id)).toEqual(["item_a", "item_b"]);
  });
});

describe("Phase 2C-A3.1 customer protocol empty reads and scoping", () => {
  it("returns [] / null when Supabase is empty with no fallback or seed", async () => {
    await expect(supabaseCustomerProtocolRepository.listByCompany(COMPANY)).resolves.toEqual([]);
    await expect(supabaseCustomerProtocolRepository.listByCustomer(COMPANY, CUSTOMER)).resolves.toEqual([]);
    await expect(
      supabaseCustomerProtocolRepository.getByLegacyId("missing", { companyId: COMPANY }),
    ).resolves.toBeNull();
  });

  it("does not read or write localStorage/sessionStorage", async () => {
    const localGet = vi.spyOn(Storage.prototype, "getItem");
    const localSet = vi.spyOn(Storage.prototype, "setItem");
    const sessionGet = vi.spyOn(Storage.prototype, "getItem");
    const sessionSet = vi.spyOn(Storage.prototype, "setItem");

    await supabaseCustomerProtocolRepository.createAggregate(aggregate(), { companyUuid: COMPANY_UUID });
    await supabaseCustomerProtocolRepository.listByCompany(COMPANY);
    await supabaseCustomerProtocolRepository.updateMetadata("cprot_1", { name: "Updated" }, { now: LATER });

    expect(localGet).not.toHaveBeenCalled();
    expect(localSet).not.toHaveBeenCalled();
    expect(sessionGet).not.toHaveBeenCalled();
    expect(sessionSet).not.toHaveBeenCalled();
  });

  it("lists only the requested company/customer and excludes deleted rows", async () => {
    mocks.client.seed("customer_protocols", [
      row(aggregate({ id: "cprot_a" })),
      row(aggregate({ id: "cprot_deleted" }), COMPANY_UUID, {
        deleted_at: "2026-06-02T08:00:00.000Z",
      }),
      row(aggregate({ id: "cprot_other_company", companyId: OTHER_COMPANY })),
      row(aggregate({ id: "cprot_other_customer", customerId: OTHER_CUSTOMER })),
    ]);

    const companyResult = await supabaseCustomerProtocolRepository.listByCompany(COMPANY);
    expect(companyResult.map((item) => item.protocol.id)).toEqual([
      "cprot_a",
      "cprot_other_customer",
    ]);

    const customerResult = await supabaseCustomerProtocolRepository.listByCustomer(COMPANY, CUSTOMER);
    expect(customerResult.map((item) => item.protocol.id)).toEqual(["cprot_a"]);
  });

  it("returns null when getByLegacyId is out of requested company/customer scope", async () => {
    mocks.client.seed("customer_protocols", [row(aggregate())]);

    await expect(
      supabaseCustomerProtocolRepository.getByLegacyId("cprot_1", { companyId: OTHER_COMPANY }),
    ).resolves.toBeNull();
    await expect(
      supabaseCustomerProtocolRepository.getByLegacyId("cprot_1", { customerId: OTHER_CUSTOMER }),
    ).resolves.toBeNull();
  });
});

describe("Phase 2C-A3.1 customer protocol writes and JSON aggregate updates", () => {
  it("creates a customer protocol aggregate in Supabase only", async () => {
    const created = await supabaseCustomerProtocolRepository.createAggregate(aggregate(), {
      companyUuid: COMPANY_UUID,
    });

    expect(created.protocol.id).toBe("cprot_1");
    expect(mocks.client.tableRows("customer_protocols")).toHaveLength(1);
    expect(mocks.client.tableRows("customer_protocols")[0]).toMatchObject({
      legacy_id: "cprot_1",
      company_id: COMPANY_UUID,
      company_legacy_id: COMPANY,
      customer_legacy_id: CUSTOMER,
    });
  });

  it("updates aggregate metadata", async () => {
    mocks.client.seed("customer_protocols", [row(aggregate())]);

    const updated = await supabaseCustomerProtocolRepository.updateMetadata(
      "cprot_1",
      { name: "Acme premium", description: "Expanded scope" },
      { companyId: COMPANY, customerId: CUSTOMER, now: LATER },
    );

    expect(updated?.protocol).toMatchObject({
      name: "Acme premium",
      description: "Expanded scope",
      updatedAt: LATER,
    });
    expect(mocks.client.tableRows("customer_protocols")[0]).toMatchObject({
      name: "Acme premium",
    });
  });

  it("updates sections/items inside the JSON aggregate", async () => {
    mocks.client.seed("customer_protocols", [row(aggregate())]);

    const updated = await supabaseCustomerProtocolRepository.updateSectionsAndItems(
      "cprot_1",
      [{ ...sections()[0], title: "Updated section", sortOrder: 1 }],
      [{ ...items()[0], title: "Updated item", sortOrder: 1 }],
      { companyId: COMPANY, customerId: CUSTOMER, now: LATER },
    );

    expect(updated?.sections).toHaveLength(1);
    expect(updated?.sections[0].title).toBe("Updated section");
    expect(updated?.items).toHaveLength(1);
    expect(updated?.items[0].title).toBe("Updated item");
    expect(updated?.protocol.updatedAt).toBe(LATER);

    const stored = mocks.client.tableRows("customer_protocols")[0].data as CustomerProtocolAggregate;
    expect(stored.sections[0].title).toBe("Updated section");
  });

  it("archives and restores without hard delete", async () => {
    mocks.client.seed("customer_protocols", [row(aggregate())]);

    const archived = await supabaseCustomerProtocolRepository.archive("cprot_1", {
      companyId: COMPANY,
      customerId: CUSTOMER,
      now: LATER,
    });
    expect(archived?.protocol.isArchived).toBe(true);
    expect(mocks.client.tableRows("customer_protocols")[0].deleted_at).toBeNull();

    const activeOnly = await supabaseCustomerProtocolRepository.listByCompany(COMPANY, {
      includeArchived: false,
    });
    expect(activeOnly).toEqual([]);

    const restored = await supabaseCustomerProtocolRepository.restore("cprot_1", {
      companyId: COMPANY,
      customerId: CUSTOMER,
      now: "2026-06-01T10:00:00.000Z",
    });
    expect(restored?.protocol.isArchived).toBe(false);
  });

  it("soft-deletes a row and excludes it from later reads", async () => {
    mocks.client.seed("customer_protocols", [row(aggregate())]);

    await expect(
      supabaseCustomerProtocolRepository.softDelete("cprot_1", {
        companyId: COMPANY,
        customerId: CUSTOMER,
        now: LATER,
      }),
    ).resolves.toBe(true);
    await expect(supabaseCustomerProtocolRepository.listByCompany(COMPANY)).resolves.toEqual([]);
    await expect(
      supabaseCustomerProtocolRepository.getByLegacyId("cprot_1", { companyId: COMPANY }),
    ).resolves.toBeNull();
  });
});
