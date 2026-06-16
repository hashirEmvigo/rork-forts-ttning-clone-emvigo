import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * SVC-1 — Service migration + shadow-read parity.
 *
 * Drives the real `migrateServices` / `shadowReadServices` paths against an
 * in-memory Supabase fake, proving that:
 *   • migrate upserts the service rows (idempotent, legacy_id preserved),
 *   • a GLOBAL service (companyId === null) migrates with company_id = null and
 *     is NEVER skipped,
 *   • a dry-run writes nothing,
 *   • a company service whose company has no Supabase mapping is skipped + reported,
 *   • shadow-read reports parity (count / id / name / detail) after migration.
 *
 * localStorage is the source of truth; these utilities only populate + verify.
 */

type Row = Record<string, unknown>;

const mocks = vi.hoisted(() => {
  type OrCond = { col: string; op: "eq" | "is"; val: unknown };

  function parseOr(expr: string): OrCond[] {
    return expr.split(",").map((part) => {
      const [col, op, raw] = part.split(".");
      const val = raw === "null" ? null : raw;
      return { col, op: op as "eq" | "is", val };
    });
  }

  class QueryBuilder {
    private filters: Array<[string, unknown]> = [];
    private orConds: OrCond[] | null = null;
    constructor(private rows: Row[]) {}
    eq(col: string, val: unknown): this {
      this.filters.push([col, val]);
      return this;
    }
    or(expr: string): this {
      this.orConds = parseOr(expr);
      return this;
    }
    private applied(): Row[] {
      return this.rows.filter((r) => {
        const eqOk = this.filters.every(([c, v]) => r[c] === v);
        if (!eqOk) return false;
        if (!this.orConds) return true;
        return this.orConds.some((c) => r[c.col] === c.val);
      });
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

const storeMocks = vi.hoisted(() => ({ services: [] as unknown[] }));
vi.mock("@/lib/store", () => ({
  getServices: () => storeMocks.services,
}));

import type { Service } from "@/types";
import { migrateServices, shadowReadServices } from "./serviceMigration";

const NORDLYS = "cmp_nordlys";
const UUID = "00000000-0000-4000-8000-000000000000";

function seedCompanies(): void {
  mocks.client.tables.set("companies", [{ id: UUID, legacy_id: NORDLYS }]);
}

function service(id: string, name = id, companyId: string | null = NORDLYS): Service {
  return {
    id,
    companyId,
    categoryId: null,
    name,
    billingType: "fixed",
    serviceBasisType: "billable",
    deductionEligible: false,
    deductionType: "none",
    smsEnabled: false,
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function serviceRows(): Row[] {
  return mocks.client.tables.get("services") ?? [];
}

beforeEach(() => {
  mocks.client.reset();
  storeMocks.services = [];
});

describe("SVC-1 · migrateServices", () => {
  it("upserts service rows preserving legacy_id", async () => {
    seedCompanies();
    storeMocks.services = [service("svc_a"), service("svc_b")];
    const report = await migrateServices();
    expect(report.ok).toBe(true);
    expect(report.writtenCount).toBe(2);
    expect(serviceRows().map((r) => r.legacy_id).sort()).toEqual(["svc_a", "svc_b"]);
  });

  it("migrates a GLOBAL service (companyId null) with company_id null, never skipped", async () => {
    seedCompanies();
    storeMocks.services = [service("svc_global", "Global", null)];
    const report = await migrateServices();
    expect(report.ok).toBe(true);
    expect(report.skipped).toHaveLength(0);
    expect(report.writtenCount).toBe(1);
    const row = serviceRows().find((r) => r.legacy_id === "svc_global");
    expect(row?.company_id).toBeNull();
    expect(row?.company_legacy_id).toBeNull();
  });

  it("dry-run writes nothing", async () => {
    seedCompanies();
    storeMocks.services = [service("svc_a")];
    const report = await migrateServices({ dryRun: true });
    expect(report.plannedCount).toBe(1);
    expect(report.writtenCount).toBe(0);
    expect(serviceRows()).toHaveLength(0);
  });

  it("skips a company service whose company has no Supabase row", async () => {
    // No companies seeded.
    storeMocks.services = [service("svc_a")];
    const report = await migrateServices();
    expect(report.ok).toBe(false);
    expect(report.skipped).toHaveLength(1);
    expect(serviceRows()).toHaveLength(0);
  });
});

describe("SVC-1 · shadowReadServices", () => {
  it("reports full parity after a clean migration (incl. a global service)", async () => {
    seedCompanies();
    storeMocks.services = [service("svc_a"), service("svc_global", "Global", null)];
    await migrateServices();
    const report = await shadowReadServices();
    expect(report.countMatch).toBe(true);
    expect(report.idsMatch).toBe(true);
    expect(report.summaryMatch).toBe(true);
    expect(report.detailMatch).toBe(true);
    expect(report.ok).toBe(true);
  });

  it("flags a count mismatch when Supabase is missing a service", async () => {
    seedCompanies();
    storeMocks.services = [service("svc_a"), service("svc_b")];
    await migrateServices();
    storeMocks.services = [...(storeMocks.services as Service[]), service("svc_c")];
    const report = await shadowReadServices();
    expect(report.countMatch).toBe(false);
    expect(report.missingInSupabase).toContain("svc_c");
    expect(report.ok).toBe(false);
  });

  it("company-scoped shadow read includes the global catalog", async () => {
    seedCompanies();
    storeMocks.services = [
      service("svc_company", "Company", NORDLYS),
      service("svc_global", "Global", null),
    ];
    await migrateServices();
    const report = await shadowReadServices(NORDLYS);
    // Scope = this company's services PLUS the shared global catalog.
    expect(report.localCount).toBe(2);
    expect(report.countMatch).toBe(true);
    expect(report.ok).toBe(true);
  });
});
