import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * SVC-3 — Service dual-write mirror.
 *
 * Drives the real `mirrorServiceWrites` path against an in-memory Supabase fake,
 * proving that:
 *   • a create mirrors the service row,
 *   • a GLOBAL service (companyId null) mirrors with company_id null, not skipped,
 *   • an update re-mirrors only the changed service,
 *   • repeated mirrors are idempotent (no duplicate rows),
 *   • a removal soft-deletes the Supabase row (removal propagation),
 *   • a noop (no prev→next change) performs no Supabase work,
 *   • a Supabase failure is recorded (localStorage already advanced),
 *   • a company service with no Supabase mapping is skipped.
 *
 * localStorage is the source of truth throughout — this helper only mirrors.
 */

type Row = Record<string, unknown>;

const mocks = vi.hoisted(() => {
  let failUpsertTable: string | null = null;

  class QueryBuilder {
    private filters: Array<[string, unknown]> = [];
    constructor(private rows: Row[]) {}
    eq(col: string, val: unknown): this {
      this.filters.push([col, val]);
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
          if (failUpsertTable === name) {
            return Promise.resolve({ error: { message: `simulated ${name} failure` } });
          }
          const key = opts.onConflict;
          for (const row of incoming) {
            const idx = rows.findIndex((r) => r[key] === row[key]);
            if (idx >= 0) rows[idx] = { ...rows[idx], ...row };
            else rows.push({ ...row });
          }
          return Promise.resolve({ error: null });
        },
        update: (patch: Row) => ({
          in: (col: string, vals: unknown[]) => {
            for (const row of rows) {
              if (vals.includes(row[col])) Object.assign(row, patch);
            }
            return Promise.resolve({ error: null });
          },
        }),
      };
    }
    reset(): void {
      this.tables.clear();
      failUpsertTable = null;
    }
    failOn(table: string | null): void {
      failUpsertTable = table;
    }
  }

  return { client: new FakeClient() };
});

vi.mock("@/lib/supabase", () => ({
  supabase: mocks.client,
  isSupabaseConfigured: true,
}));

import type { Service } from "@/types";
import {
  mirrorServiceWrites,
  getServiceDualWriteState,
  resetServiceDualWriteState,
} from "./serviceDualWrite";

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
  resetServiceDualWriteState();
});

describe("SVC-3 · service dual write", () => {
  it("mirrors a new service on create", async () => {
    seedCompanies();
    const result = await mirrorServiceWrites([], [service("svc_a")]);
    expect(result.ok).toBe(true);
    expect(result.mirrored).toBe(1);
    expect(serviceRows()).toHaveLength(1);
    expect(serviceRows()[0].legacy_id).toBe("svc_a");
    expect(serviceRows()[0].deleted_at).toBeNull();
  });

  it("mirrors a GLOBAL service with company_id null (never skipped)", async () => {
    // No companies seeded — a global service must still mirror.
    const result = await mirrorServiceWrites([], [service("svc_global", "Global", null)]);
    expect(result.ok).toBe(true);
    expect(result.mirrored).toBe(1);
    expect(result.skipped).toHaveLength(0);
    expect(serviceRows()[0].company_id).toBeNull();
  });

  it("is idempotent — repeated mirrors never duplicate rows", async () => {
    seedCompanies();
    const all = [service("svc_a")];
    await mirrorServiceWrites([], all);
    await mirrorServiceWrites([], all);
    expect(serviceRows()).toHaveLength(1);
  });

  it("re-mirrors only the changed service on update", async () => {
    seedCompanies();
    const before = [service("svc_a"), service("svc_b")];
    await mirrorServiceWrites([], before);
    resetServiceDualWriteState();
    const after = [service("svc_a", "Renamed A"), service("svc_b")];
    const result = await mirrorServiceWrites(before, after);
    expect(result.mirrored).toBe(1);
    expect(serviceRows().find((r) => r.legacy_id === "svc_a")?.name).toBe("Renamed A");
  });

  it("soft-deletes a removed service (removal propagation)", async () => {
    seedCompanies();
    const before = [service("svc_a"), service("svc_b")];
    await mirrorServiceWrites([], before);
    const after = [service("svc_a")];
    const result = await mirrorServiceWrites(before, after);
    expect(result.removed).toBe(1);
    const removedRow = serviceRows().find((r) => r.legacy_id === "svc_b");
    expect(removedRow?.deleted_at).toBeTruthy();
  });

  it("noop — no prev→next change does no Supabase work", async () => {
    seedCompanies();
    const all = [service("svc_a")];
    const result = await mirrorServiceWrites(all, all);
    expect(result.noop).toBe(true);
    expect(result.mirrored).toBe(0);
    expect(getServiceDualWriteState().noops).toBe(1);
  });

  it("records a failure when the upsert fails", async () => {
    seedCompanies();
    mocks.client.failOn("services");
    const result = await mirrorServiceWrites([], [service("svc_a")]);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("upsert failed");
    expect(getServiceDualWriteState().failures).toBeGreaterThan(0);
  });

  it("skips a company service whose company has no Supabase mapping", async () => {
    // No companies seeded → no uuid for a company-owned service.
    const result = await mirrorServiceWrites([], [service("svc_a")]);
    expect(result.mirrored).toBe(0);
    expect(result.skipped).toHaveLength(1);
    expect(getServiceDualWriteState().skipped).toBe(1);
  });

  it("company writer skips a global row but still upserts its own company row", async () => {
    seedCompanies();
    const result = await mirrorServiceWrites(
      [],
      [service("svc_global", "Global", null), service("svc_company")],
      { companyId: NORDLYS, isSuperAdmin: false },
    );
    expect(serviceRows().map((r) => r.legacy_id)).toEqual(["svc_company"]);
    expect(result.mirrored).toBe(1);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].id).toBe("svc_global");
    expect(getServiceDualWriteState().failures).toBe(0);
    expect(getServiceDualWriteState().created).toBe(1);
  });

  it("super_admin writer still mirrors global rows", async () => {
    const result = await mirrorServiceWrites(
      [],
      [service("svc_global", "Global", null)],
      { companyId: null, isSuperAdmin: true },
    );
    expect(result.ok).toBe(true);
    expect(result.mirrored).toBe(1);
    expect(result.skipped).toHaveLength(0);
    expect(serviceRows()[0].company_id).toBeNull();
  });
});
