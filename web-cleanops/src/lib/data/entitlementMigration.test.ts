import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ENT-1 — Service Entitlements migration + shadow-read parity. Drives the real
 * `migrateEntitlements` / `shadowReadEntitlements` paths (spanning the global +
 * company + log stores) against an in-memory Supabase fake.
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
    order(): this {
      return this;
    }
    limit(): this {
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

const storeMocks = vi.hoisted(() => ({
  globals: [] as unknown[],
  companies: [] as unknown[],
  log: [] as unknown[],
}));
vi.mock("@/lib/store", () => ({
  getServiceGlobalEntitlements: () => storeMocks.globals,
  getCompanyServiceEntitlements: () => storeMocks.companies,
  getServiceEntitlementLog: () => storeMocks.log,
}));

import type {
  ServiceGlobalEntitlement,
  CompanyServiceEntitlement,
  ServiceEntitlementLogEntry,
  ServiceFeatureKey,
} from "@/types";
import { migrateEntitlements, shadowReadEntitlements } from "./entitlementMigration";

const NORDLYS = "cmp_nordlys";
const UUID = "00000000-0000-4000-8000-000000000000";
const MEDIA: ServiceFeatureKey = "media_uploads";

function seedCompanies(): void {
  mocks.client.tables.set("companies", [{ id: UUID, legacy_id: NORDLYS }]);
}

function global(key: ServiceFeatureKey = MEDIA): ServiceGlobalEntitlement {
  return { serviceKey: key, enabled: true, updatedBy: null, updatedAt: "2026-01-01T00:00:00.000Z" };
}

function company(key: ServiceFeatureKey = MEDIA): CompanyServiceEntitlement {
  return {
    companyId: NORDLYS,
    serviceKey: key,
    status: "enabled",
    enabled: true,
    enabledAt: "2026-01-01T00:00:00.000Z",
    disabledAt: null,
    updatedBy: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function logEntry(id: string): ServiceEntitlementLogEntry {
  return {
    id,
    serviceKey: MEDIA,
    companyId: NORDLYS,
    action: "company_enabled",
    previousValue: false,
    newValue: true,
    changedBy: null,
    changedAt: "2026-01-01T00:00:00.000Z",
  };
}

beforeEach(() => {
  mocks.client.reset();
  storeMocks.globals = [];
  storeMocks.companies = [];
  storeMocks.log = [];
});

describe("ENT-1 · migrateEntitlements", () => {
  it("upserts global, company and log rows preserving keys", async () => {
    seedCompanies();
    storeMocks.globals = [global()];
    storeMocks.companies = [company()];
    storeMocks.log = [logEntry("ent_1")];

    const report = await migrateEntitlements();
    expect(report.ok).toBe(true);
    expect(report.global.written).toBe(1);
    expect(report.company.written).toBe(1);
    expect(report.log.written).toBe(1);
    expect(mocks.client.tables.get("company_service_entitlements")?.[0].legacy_id).toBe(
      `${NORDLYS}::${MEDIA}`,
    );
  });

  it("dry-run writes nothing", async () => {
    seedCompanies();
    storeMocks.globals = [global()];
    const report = await migrateEntitlements({ dryRun: true });
    expect(report.global.written).toBe(0);
    expect(mocks.client.tables.get("service_global_entitlements") ?? []).toHaveLength(0);
  });

  it("skips a company entitlement whose company has no Supabase row", async () => {
    storeMocks.companies = [company()];
    const report = await migrateEntitlements();
    expect(report.ok).toBe(false);
    expect(report.skipped).toHaveLength(1);
  });
});

describe("ENT-1 · shadowReadEntitlements", () => {
  it("reports full parity after a clean migration", async () => {
    seedCompanies();
    storeMocks.globals = [global()];
    storeMocks.companies = [company()];
    storeMocks.log = [logEntry("ent_1")];
    await migrateEntitlements();

    const report = await shadowReadEntitlements();
    expect(report.global.match).toBe(true);
    expect(report.company.match).toBe(true);
    expect(report.log.match).toBe(true);
    expect(report.detailMatch).toBe(true);
    expect(report.ok).toBe(true);
  });

  it("flags a company count mismatch when Supabase is missing a row", async () => {
    seedCompanies();
    storeMocks.companies = [company("media_uploads")];
    await migrateEntitlements();
    storeMocks.companies = [
      ...(storeMocks.companies as CompanyServiceEntitlement[]),
      company("time_bank"),
    ];
    const report = await shadowReadEntitlements();
    expect(report.company.match).toBe(false);
    expect(report.ok).toBe(false);
  });
});
