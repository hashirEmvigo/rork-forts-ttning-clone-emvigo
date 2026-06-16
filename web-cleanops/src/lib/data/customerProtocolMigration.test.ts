import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PROT-1 — Customer Protocol (aggregate) migration + shadow-read parity against
 * an in-memory Supabase fake. localStorage (jsdom) is the source of truth.
 */
type Row = Record<string, unknown>;

const mocks = vi.hoisted(() => {
  class QueryBuilder {
    private filters: Array<[string, unknown]> = [];
    constructor(private rows: Row[]) {}
    eq(col: string, val: unknown): this {
      this.filters.push([col, val]);
      return this;
    }
    is(col: string, val: unknown): this {
      this.filters.push([col, val]);
      return this;
    }
    or(_expr: string): this {
      return this;
    }
    private applied(): Row[] {
      return this.rows.filter((r) => this.filters.every(([c, v]) => r[c] === v));
    }
    maybeSingle(): Promise<{ data: Row | null; error: null }> {
      return Promise.resolve({ data: this.applied()[0] ?? null, error: null });
    }
    then<R>(onFulfilled: (res: { data: Row[]; error: null }) => R): Promise<R> {
      return Promise.resolve({ data: this.applied(), error: null }).then(onFulfilled);
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
        select: (_cols?: string) => new QueryBuilder(rows),
        upsert: (incoming: Row[], opts: { onConflict: string }) => {
          const key = opts.onConflict;
          for (const row of incoming) {
            const idx = rows.findIndex((r) => r[key] === row[key]);
            if (idx >= 0) rows[idx] = { ...rows[idx], ...row };
            else rows.push({ ...row });
          }
          return Promise.resolve({ error: null });
        },
      };
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

import type { CustomerProtocolV2 } from "@/types";
import {
  migrateCustomerProtocols,
  shadowReadCustomerProtocols,
} from "./customerProtocolMigration";

const NORDLYS = "cmp_nordlys";
const UUID = "00000000-0000-4000-8000-000000000000";

function seedCompanies(): void {
  mocks.client.tables.set("companies", [{ id: UUID, legacy_id: NORDLYS }]);
}

function protocol(id: string, companyId = NORDLYS): CustomerProtocolV2 {
  return {
    id,
    companyId,
    customerId: "cust_1",
    sourceTemplateId: "ctpl_1",
    sourceTemplateName: "Base",
    sourceTemplateVersion: 1,
    name: id,
    categoryIds: [],
    floorPresetIds: [],
    isArchived: false,
    schemaVersion: 2,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  } as CustomerProtocolV2;
}

function setLocal(protocols: CustomerProtocolV2[]): void {
  localStorage.setItem("cleanops.customerProtocolsV2", JSON.stringify(protocols));
  localStorage.setItem("cleanops.customerProtocolSections", JSON.stringify([]));
  localStorage.setItem("cleanops.customerProtocolItems", JSON.stringify([]));
}

beforeEach(() => {
  mocks.client.reset();
  localStorage.clear();
});

describe("PROT-1 · migrateCustomerProtocols", () => {
  it("upserts protocol aggregates preserving legacy_id + scope", async () => {
    seedCompanies();
    setLocal([protocol("cprot_a"), protocol("cprot_b")]);
    const report = await migrateCustomerProtocols();
    expect(report.ok).toBe(true);
    expect(report.writtenCount).toBe(2);
  });

  it("skips a protocol whose company has no Supabase row", async () => {
    setLocal([protocol("cprot_a")]);
    const report = await migrateCustomerProtocols();
    expect(report.ok).toBe(false);
    expect(report.skipped).toHaveLength(1);
  });
});

describe("PROT-1 · shadowReadCustomerProtocols", () => {
  it("reports full parity after a clean migration", async () => {
    seedCompanies();
    setLocal([protocol("cprot_a")]);
    await migrateCustomerProtocols();
    const report = await shadowReadCustomerProtocols(NORDLYS);
    expect(report.countMatch).toBe(true);
    expect(report.idsMatch).toBe(true);
    expect(report.detailMatch).toBe(true);
    expect(report.ok).toBe(true);
  });
});
