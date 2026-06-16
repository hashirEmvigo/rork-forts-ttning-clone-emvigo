import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * P4H — Wave 1D: Customer dual-write validation.
 *
 * Drives the REAL dual-write mirror (`mirrorCustomerWrites`) against an
 * in-memory Supabase fake reproducing the exact query surface the mirror uses
 * (`from().select().eq().maybeSingle()`, `from().upsert(rows, { onConflict })`,
 * and the `companies` map read). A live Supabase needs an authenticated browser
 * session and cannot run in CI, so the fake stands in for it.
 *
 * What this proves, automatically and repeatably:
 *   • create-path dual write mirrors a new customer
 *   • update-path dual write mirrors an edit
 *   • archive-path dual write mirrors a status change
 *   • post-write validation reports 0 mismatches on a clean mirror
 *   • idempotency — mirroring the same write twice never duplicates rows
 *   • failure handling — an upsert error is recorded (never thrown)
 *   • company scoping — a row whose company has no mapping is skipped, not written
 *   • removal detection — a locally-removed id is surfaced (RLS blocks delete)
 */

type Row = Record<string, unknown>;

const mocks = vi.hoisted(() => {
  class QueryBuilder {
    private filters: Array<[string, unknown]> = [];
    private isFilters: Array<[string, null]> = [];
    constructor(private rows: Row[]) {}
    eq(col: string, val: unknown): this {
      this.filters.push([col, val]);
      return this;
    }
    is(col: string, val: null): this {
      this.isFilters.push([col, val]);
      return this;
    }
    private applied(): Row[] {
      return this.rows.filter(
        (r) =>
          this.filters.every(([c, v]) => r[c] === v) &&
          // `.is(col, null)` matches null OR an absent column (loose null check).
          this.isFilters.every(([c]) => r[c] === null || r[c] === undefined),
      );
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
    upsertCalls = 0;
    /** When set, the next upsert returns this error (then clears). */
    failNextUpsert: string | null = null;
    /** When set, the next soft-delete update returns this error (then clears). */
    failNextUpdate: string | null = null;
    private table(name: string): Row[] {
      if (!this.tables.has(name)) this.tables.set(name, []);
      return this.tables.get(name) as Row[];
    }
    from(name: string) {
      const rows = this.table(name);
      return {
        select: (_cols?: string) => new QueryBuilder(rows),
        upsert: (incoming: Row[], opts: { onConflict: string }) => {
          if (this.failNextUpsert) {
            const message = this.failNextUpsert;
            this.failNextUpsert = null;
            return Promise.resolve({ error: { message } });
          }
          this.upsertCalls += 1;
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
            if (this.failNextUpdate) {
              const message = this.failNextUpdate;
              this.failNextUpdate = null;
              return Promise.resolve({ error: { message } });
            }
            const set = new Set(vals);
            for (let i = 0; i < rows.length; i += 1) {
              if (set.has(rows[i][col])) rows[i] = { ...rows[i], ...patch };
            }
            return Promise.resolve({ error: null });
          },
        }),
      };
    }
    reset(): void {
      this.tables.clear();
      this.upsertCalls = 0;
      this.failNextUpsert = null;
      this.failNextUpdate = null;
    }
  }

  return { client: new FakeClient() };
});

vi.mock("@/lib/supabase", () => ({
  supabase: mocks.client,
  isSupabaseConfigured: true,
}));

import type { Customer } from "@/types";
import {
  mirrorCustomerWrites,
  getCustomerDualWriteState,
  resetCustomerDualWriteState,
} from "./customerDualWrite";

const NORDLYS = "cmp_nordlys";
const NORDLYS_UUID = "00000000-0000-4000-8000-000000000001";

/** Seeds the fake `companies` table so the uuid map resolves NORDLYS. */
function seedCompanies(): void {
  mocks.client.tables.set("companies", [{ id: NORDLYS_UUID, legacy_id: NORDLYS }]);
}

function makeCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: "cust_test_1",
    companyId: NORDLYS,
    name: "Acme AS",
    customerNumber: "C-900",
    email: "acme@example.com",
    status: "active",
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  } as Customer;
}

function customerRows(): Row[] {
  return mocks.client.tables.get("customers") ?? [];
}

beforeEach(() => {
  mocks.client.reset();
  resetCustomerDualWriteState();
  seedCompanies();
});

// ── Create-path dual write ────────────────────────────────
describe("P4H · create-path dual write", () => {
  it("mirrors a newly created customer into Supabase", async () => {
    const customer = makeCustomer();
    const result = await mirrorCustomerWrites([], [customer]);

    expect(result.ok).toBe(true);
    expect(result.noop).toBe(false);
    expect(result.diff.created).toEqual([customer.id]);
    expect(result.mirrored).toBe(1);
    expect(result.mismatches).toEqual([]);
    expect(customerRows()).toHaveLength(1);
    expect(customerRows()[0].legacy_id).toBe(customer.id);
    expect(getCustomerDualWriteState().created).toBe(1);
  });
});

// ── Update-path dual write ────────────────────────────────
describe("P4H · update-path dual write", () => {
  it("mirrors an edit and reports 0 field mismatches", async () => {
    const before = makeCustomer();
    await mirrorCustomerWrites([], [before]);

    const after = makeCustomer({ name: "Acme Renamed AS", updatedAt: "2024-02-02T00:00:00.000Z" });
    const result = await mirrorCustomerWrites([before], [after]);

    expect(result.diff.updated).toEqual([after.id]);
    expect(result.mirrored).toBe(1);
    expect(result.mismatches).toEqual([]);
    expect(result.ok).toBe(true);

    const row = customerRows()[0];
    expect(row.name).toBe("Acme Renamed AS");
    expect((row.data as Customer).updatedAt).toBe("2024-02-02T00:00:00.000Z");
    expect(getCustomerDualWriteState().updated).toBe(1);
  });

  it("is a clean no-op when nothing changed", async () => {
    const customer = makeCustomer();
    await mirrorCustomerWrites([], [customer]);
    const result = await mirrorCustomerWrites([customer], [customer]);

    expect(result.noop).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.mirrored).toBe(0);
    expect(getCustomerDualWriteState().noops).toBe(1);
  });
});

// ── Archive-path dual write ───────────────────────────────
describe("P4H · archive-path dual write", () => {
  it("mirrors an archive (status change) without deleting the row", async () => {
    const active = makeCustomer();
    await mirrorCustomerWrites([], [active]);

    const archived = makeCustomer({ status: "archived", updatedAt: "2024-03-03T00:00:00.000Z" });
    const result = await mirrorCustomerWrites([active], [archived]);

    expect(result.ok).toBe(true);
    expect(result.diff.updated).toEqual([archived.id]);
    expect(customerRows()).toHaveLength(1);
    expect(customerRows()[0].status).toBe("archived");
  });
});

// ── Idempotency ───────────────────────────────────────────
describe("P4H · idempotency", () => {
  it("mirroring the same create twice never duplicates rows", async () => {
    const customer = makeCustomer();
    await mirrorCustomerWrites([], [customer]);
    await mirrorCustomerWrites([], [customer]);

    expect(customerRows()).toHaveLength(1);
    const ids = customerRows().map((r) => r.legacy_id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ── Failure handling ──────────────────────────────────────
describe("P4H · failure handling", () => {
  it("records an upsert failure without throwing (local write already succeeded)", async () => {
    mocks.client.failNextUpsert = "network down";
    const customer = makeCustomer();

    const result = await mirrorCustomerWrites([], [customer]);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("network down");
    expect(result.mirrored).toBe(0);
    expect(customerRows()).toHaveLength(0);
    expect(getCustomerDualWriteState().failures).toBe(1);
  });
});

// ── Company scoping ───────────────────────────────────────
describe("P4H · company scoping", () => {
  it("skips (does not write) a customer whose company has no Supabase mapping", async () => {
    const orphan = makeCustomer({ id: "cust_orphan", companyId: "cmp_unmapped" });
    const result = await mirrorCustomerWrites([], [orphan]);

    expect(result.mirrored).toBe(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.reason).toContain("Migrate companies first");
    expect(customerRows()).toHaveLength(0);
    expect(getCustomerDualWriteState().skipped).toBe(1);
  });
});

// ── Removal propagation (soft delete) ─────────────────────
describe("customer removal soft-delete propagation", () => {
  it("soft-deletes a locally-removed customer (stamps deleted_at)", async () => {
    const customer = makeCustomer();
    await mirrorCustomerWrites([], [customer]);
    expect((customerRows()[0] as Row).deleted_at).toBe(null);

    const result = await mirrorCustomerWrites([customer], []);
    expect(result.noop).toBe(false);
    expect(result.diff.removed).toEqual([customer.id]);
    expect(result.removed).toBe(1);
    expect(getCustomerDualWriteState().removedDetected).toBe(1);
    expect(getCustomerDualWriteState().removed).toBe(1);
    // Row is retained but soft-deleted (history preserved; RLS blocks hard delete).
    expect(customerRows()).toHaveLength(1);
    expect((customerRows()[0] as Row).deleted_at).toBeTypeOf("string");
  });

  it("re-creating a soft-deleted customer clears deleted_at (undelete via upsert)", async () => {
    const customer = makeCustomer();
    await mirrorCustomerWrites([], [customer]);
    await mirrorCustomerWrites([customer], []); // soft-delete
    expect((customerRows()[0] as Row).deleted_at).toBeTypeOf("string");

    // Re-create with the same id → upsert undeletes.
    const result = await mirrorCustomerWrites([], [customer]);
    expect(result.ok).toBe(true);
    expect(customerRows()).toHaveLength(1);
    expect((customerRows()[0] as Row).deleted_at).toBe(null);
  });

  it("records a soft-delete failure without throwing", async () => {
    const customer = makeCustomer();
    await mirrorCustomerWrites([], [customer]);

    mocks.client.failNextUpdate = "network down";
    const result = await mirrorCustomerWrites([customer], []);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("network down");
    expect(getCustomerDualWriteState().failures).toBe(1);
  });
});

// ── Archive vs delete ─────────────────────────────────────
describe("archive is not a soft-delete", () => {
  it("archiving keeps deleted_at null (status update only)", async () => {
    const active = makeCustomer();
    await mirrorCustomerWrites([], [active]);

    const archived = makeCustomer({ status: "archived", updatedAt: "2024-03-03T00:00:00.000Z" });
    await mirrorCustomerWrites([active], [archived]);

    const row = customerRows()[0] as Row;
    expect(row.status).toBe("archived");
    expect(row.deleted_at).toBe(null);
    expect(getCustomerDualWriteState().removed).toBe(0);
  });
});
