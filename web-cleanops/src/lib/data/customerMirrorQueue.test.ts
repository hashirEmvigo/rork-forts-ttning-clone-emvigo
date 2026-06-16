/**
 * Customer mirror write-order fix — per-customer ordered queue.
 *
 * Two layers of proof:
 *   1. Ordering contract (injected runner + deferred promises): mirrors that
 *      touch the SAME customer id run strictly FIFO; mirrors for DIFFERENT ids
 *      run concurrently.
 *   2. End-to-end correctness against the in-memory Supabase fake: a create
 *      immediately followed by a delete on the SAME new customer leaves the
 *      remote row soft-deleted (`deleted_at` set) — i.e. one delete is enough.
 *      Existing-customer delete still works; archive/deactivate are unchanged.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

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
          this.isFilters.every(([c]) => r[c] === null || r[c] === undefined),
      );
    }
    maybeSingle(): Promise<{ data: Row | null; error: null }> {
      return Promise.resolve({ data: this.applied()[0] ?? null, error: null });
    }
    then<R>(onFulfilled: (res: { data: Row[]; error: null }) => R): Promise<R> {
      return Promise.resolve({ data: this.applied(), error: null }).then(
        onFulfilled,
      );
    }
  }

  class FakeClient {
    tables = new Map<string, Row[]>();
    /** Artificial async delay (ms) applied to the next upsert, then cleared. */
    delayNextUpsert = 0;
    private table(name: string): Row[] {
      if (!this.tables.has(name)) this.tables.set(name, []);
      return this.tables.get(name) as Row[];
    }
    from(name: string) {
      const rows = this.table(name);
      return {
        select: (_cols?: string) => new QueryBuilder(rows),
        upsert: async (incoming: Row[], opts: { onConflict: string }) => {
          if (this.delayNextUpsert > 0) {
            const ms = this.delayNextUpsert;
            this.delayNextUpsert = 0;
            await new Promise((r) => setTimeout(r, ms));
          }
          const key = opts.onConflict;
          for (const row of incoming) {
            const idx = rows.findIndex((r) => r[key] === row[key]);
            if (idx >= 0) rows[idx] = { ...rows[idx], ...row };
            else rows.push({ ...row });
          }
          return { error: null };
        },
        update: (patch: Row) => ({
          in: (col: string, vals: unknown[]) => {
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
      this.delayNextUpsert = 0;
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
  enqueueCustomerMirror,
  __setCustomerMirrorRunner,
  __resetCustomerMirrorQueue,
} from "./customerMirrorQueue";
import {
  resetCustomerDualWriteState,
  type CustomerDualWriteResult,
} from "./customerDualWrite";

const NORDLYS = "cmp_nordlys";
const NORDLYS_UUID = "00000000-0000-4000-8000-000000000001";

function seedCompanies(): void {
  mocks.client.tables.set("companies", [
    { id: NORDLYS_UUID, legacy_id: NORDLYS },
  ]);
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
  __resetCustomerMirrorQueue();
  seedCompanies();
});

// ── Ordering contract (injected runner) ───────────────────
describe("customer mirror queue · ordering contract", () => {
  it("serializes mirrors that touch the same customer id (FIFO)", async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((r) => {
      releaseFirst = r;
    });

    __setCustomerMirrorRunner(async (_prev, next) => {
      const isCreate = next.length > 0;
      if (isCreate) {
        order.push("create:start");
        await firstGate; // hold the create open
        order.push("create:end");
      } else {
        order.push("delete:run");
      }
      return { ok: true } as CustomerDualWriteResult;
    });

    const customer = makeCustomer();
    const createP = enqueueCustomerMirror([], [customer]); // create
    const deleteP = enqueueCustomerMirror([customer], []); // delete same id

    // Let microtasks flush — the delete must NOT have run yet.
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(["create:start"]);

    releaseFirst();
    await Promise.all([createP, deleteP]);

    expect(order).toEqual(["create:start", "create:end", "delete:run"]);
  });

  it("runs mirrors for different customer ids concurrently", async () => {
    const order: string[] = [];
    let releaseA!: () => void;
    const gateA = new Promise<void>((r) => {
      releaseA = r;
    });

    __setCustomerMirrorRunner(async (_prev, next) => {
      const id = next[0]?.id ?? "?";
      order.push(`${id}:start`);
      if (id === "A") await gateA;
      order.push(`${id}:end`);
      return { ok: true } as CustomerDualWriteResult;
    });

    const a = makeCustomer({ id: "A" });
    const b = makeCustomer({ id: "B" });
    const pA = enqueueCustomerMirror([], [a]); // blocked open
    const pB = enqueueCustomerMirror([], [b]); // independent id

    // B is independent, so it should start and finish without waiting for A.
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toContain("B:start");
    expect(order).toContain("B:end");
    expect(order).not.toContain("A:end");

    releaseA();
    await Promise.all([pA, pB]);
    expect(order).toContain("A:end");
  });
});

// ── End-to-end correctness against the Supabase fake ──────
describe("customer mirror queue · end-to-end (real mirror)", () => {
  it("create immediately followed by delete leaves remote deleted_at set", async () => {
    const customer = makeCustomer();
    // Make the create upsert slow so a naive unordered delete would race ahead.
    mocks.client.delayNextUpsert = 30;

    const createP = enqueueCustomerMirror([], [customer]);
    const deleteP = enqueueCustomerMirror([customer], []);
    await Promise.all([createP, deleteP]);

    const rows = customerRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].legacy_id).toBe(customer.id);
    // One delete is enough: the row is soft-deleted, not left active.
    expect(rows[0].deleted_at).toBeTypeOf("string");
  });

  it("does not require a second delete (deleted_at survives the create commit)", async () => {
    const customer = makeCustomer();
    mocks.client.delayNextUpsert = 30;
    await Promise.all([
      enqueueCustomerMirror([], [customer]),
      enqueueCustomerMirror([customer], []),
    ]);
    // No second delete issued. The remote row must already be tombstoned.
    expect(customerRows()[0].deleted_at).toBeTypeOf("string");
  });

  it("still soft-deletes an existing (already-mirrored) customer", async () => {
    const customer = makeCustomer();
    await enqueueCustomerMirror([], [customer]); // pre-existing remote row
    expect(customerRows()[0].deleted_at).toBe(null);

    await enqueueCustomerMirror([customer], []); // delete
    expect(customerRows()).toHaveLength(1);
    expect(customerRows()[0].deleted_at).toBeTypeOf("string");
  });

  it("archive/deactivate stays a status update (not a soft delete)", async () => {
    const active = makeCustomer();
    await enqueueCustomerMirror([], [active]);

    const archived = makeCustomer({ status: "archived" });
    await enqueueCustomerMirror([active], [archived]);

    const row = customerRows()[0];
    expect(row.status).toBe("archived");
    expect(row.deleted_at).toBe(null);
  });
});
