/**
 * Customer Agreement validation harness (Phase 1 · CI-safe, shadow only).
 *
 * A guarded, browser-free test harness that lets the Customer Agreement
 * migration + shadow-read round-trip run automatically in Node/CI — with NO
 * localStorage, NO signed-in Supabase session, and NO network. It provides:
 *
 *   1. {@link createInMemorySupabase} — a tiny in-memory stand-in for the
 *      Supabase client that supports exactly the query surface the bridge uses
 *      (`from().select().eq().in().order().maybeSingle()`, `upsert`). It stores
 *      upserted rows in a `Map<table, rows>` and reads them back, so a migrate
 *      followed by a shadow read sees identical rows.
 *
 *   2. Module-level singleton state ({@link harnessDb}, {@link harnessStore},
 *      {@link harnessSupabase}) shared between the test and the `vi.mock`
 *      factories (which resolve this module via dynamic import). The test seeds
 *      fixtures + companies, runs the bridge, asserts the report.
 *
 *   3. Deterministic fixture builders mirroring the domain shapes.
 *
 * SAFETY — this harness can NEVER touch a real Supabase project:
 *   * It performs no network I/O; every "query" resolves from an in-memory Map.
 *   * It is only wired in via `vi.mock`, so importing it does not replace the
 *     real client anywhere outside the test process.
 *   * It writes nothing to localStorage and reads no env vars.
 *
 * Out of scope (nothing here): activation, dual-write, Time Bank, Invoice Basis,
 * Agreement Templates, Pricing Engine, RUT, Customer Portal, UI.
 */
import type {
  Customer,
  Service,
  WorkOrder,
  WorkOrderServiceRow,
} from "@/types";

// ── In-memory Supabase stand-in ───────────────────────────

/** A queued result override or failure injection for a specific table. */
interface QueryResult {
  data: Row[] | null;
  error: { message: string } | null;
}

type Row = Record<string, unknown>;

/** A minimal, thenable query builder matching the bridge's call patterns. */
interface MockQueryBuilder extends PromiseLike<QueryResult> {
  select(columns?: string): MockQueryBuilder;
  eq(column: string, value: unknown): MockQueryBuilder;
  in(column: string, values: unknown[]): MockQueryBuilder;
  order(column: string, opts?: { ascending?: boolean }): MockQueryBuilder;
  maybeSingle(): Promise<{ data: Row | null; error: { message: string } | null }>;
  upsert(
    rows: ReadonlyArray<object>,
    opts: { onConflict: string },
  ): Promise<{ error: { message: string } | null }>;
}

/** The controllable surface of an in-memory Supabase client. */
export interface InMemorySupabase {
  /** The Supabase-client-shaped object to inject in place of `supabase`. */
  client: { from(table: string): MockQueryBuilder };
  /** Raw table storage: table name → rows (the exact upserted row objects). */
  db: Map<string, Row[]>;
  /** Seed a `companies` row so `loadCompanyUuidMap` resolves a tenant UUID. */
  seedCompany(legacyId: string, uuid: string): void;
  /** Force reads on a table to fail (to exercise `supabaseReadFailures`). */
  failTable(table: string): void;
  /** Clear a forced failure on a table. */
  clearFailure(table: string): void;
  /** Reset all tables and failures to empty. */
  reset(): void;
}

function compareValues(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  const sa = String(a);
  const sb = String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

/**
 * Creates a self-contained in-memory Supabase stand-in. No network, no env,
 * no localStorage — every query resolves from the backing `Map`.
 */
export function createInMemorySupabase(): InMemorySupabase {
  const db = new Map<string, Row[]>();
  const failures = new Set<string>();

  function rowsFor(table: string): Row[] {
    let rows = db.get(table);
    if (!rows) {
      rows = [];
      db.set(table, rows);
    }
    return rows;
  }

  function makeBuilder(table: string): MockQueryBuilder {
    const predicates: Array<(row: Row) => boolean> = [];
    let orderBy: { column: string; ascending: boolean } | null = null;

    function resolve(): QueryResult {
      if (failures.has(table)) {
        return { data: null, error: { message: `injected read failure on "${table}"` } };
      }
      let result = rowsFor(table).filter((row) => predicates.every((p) => p(row)));
      if (orderBy) {
        const { column, ascending } = orderBy;
        result = [...result].sort((a, b) => {
          const cmp = compareValues(a[column], b[column]);
          return ascending ? cmp : -cmp;
        });
      }
      return { data: result, error: null };
    }

    const builder: MockQueryBuilder = {
      select() {
        return builder;
      },
      eq(column, value) {
        predicates.push((row) => row[column] === value);
        return builder;
      },
      in(column, values) {
        predicates.push((row) => values.includes(row[column]));
        return builder;
      },
      order(column, opts) {
        orderBy = { column, ascending: opts?.ascending ?? true };
        return builder;
      },
      maybeSingle() {
        const { data, error } = resolve();
        return Promise.resolve({ data: data?.[0] ?? null, error });
      },
      upsert(rows, opts) {
        if (failures.has(table)) {
          return Promise.resolve({ error: { message: `injected write failure on "${table}"` } });
        }
        const key = opts.onConflict;
        const current = rowsFor(table);
        for (const incoming of rows as readonly Row[]) {
          const index = current.findIndex((existing) => existing[key] === incoming[key]);
          if (index >= 0) current[index] = incoming;
          else current.push(incoming);
        }
        return Promise.resolve({ error: null });
      },
      then(onFulfilled, onRejected) {
        return Promise.resolve(resolve()).then(onFulfilled, onRejected);
      },
    };
    return builder;
  }

  return {
    client: { from: (table: string) => makeBuilder(table) },
    db,
    seedCompany(legacyId, uuid) {
      rowsFor("companies").push({ id: uuid, legacy_id: legacyId });
    },
    failTable(table) {
      failures.add(table);
    },
    clearFailure(table) {
      failures.delete(table);
    },
    reset() {
      db.clear();
      failures.clear();
    },
  };
}

// ── Shared singleton state (test ↔ vi.mock factories) ─────

/** The shared in-memory Supabase used by both the test and the mocked client. */
export const harnessSupabase: InMemorySupabase = createInMemorySupabase();

/** The shared local "store" the mocked `@/lib/store` getters read from. */
export const harnessStore: {
  customers: Customer[];
  workOrders: WorkOrder[];
  services: Service[];
} = { customers: [], workOrders: [], services: [] };

/** Resets both the in-memory Supabase and the local store to empty. */
export function resetHarness(): void {
  harnessSupabase.reset();
  harnessStore.customers = [];
  harnessStore.workOrders = [];
  harnessStore.services = [];
}

// ── Deterministic fixture builders ────────────────────────

const FIXTURE_TS = "2026-01-01T00:00:00.000Z";

/** Builds a fixture {@link Customer} (defaults to company `cmp_1`). */
export function makeCustomer(over: Partial<Customer> = {}): Customer {
  return {
    id: "cust_1",
    companyId: "cmp_1",
    name: "Acme AB",
    customerNumber: "C-1001",
    email: "ops@acme.test",
    status: "active",
    createdAt: FIXTURE_TS,
    updatedAt: FIXTURE_TS,
    ...over,
  } as Customer;
}

/** Builds a fixture {@link WorkOrderServiceRow}. */
export function makeRow(over: Partial<WorkOrderServiceRow> = {}): WorkOrderServiceRow {
  return {
    id: "row_1",
    serviceName: "Home cleaning",
    quantity: 2,
    unit: "h",
    price: 199.5,
    vat: 25,
    status: "planned",
    serviceDate: "2026-01-10",
    assignedEmployeeIds: [],
    unassignedEmployeeSlots: 0,
    sortOrder: 0,
    createdAt: FIXTURE_TS,
    updatedAt: FIXTURE_TS,
    ...over,
  } as WorkOrderServiceRow;
}

/** Builds a fixture {@link WorkOrder} wrapping the supplied service rows. */
export function makeWorkOrder(
  rows: WorkOrderServiceRow[],
  over: Partial<WorkOrder> = {},
): WorkOrder {
  return {
    id: "wo_1",
    companyId: "cmp_1",
    customerId: "cust_1",
    number: "WO-1001",
    status: "planned",
    serviceRows: rows,
    createdAt: FIXTURE_TS,
    updatedAt: FIXTURE_TS,
    ...over,
  } as WorkOrder;
}

/** Builds a fixture {@link Service} (catalog entry). */
export function makeService(over: Partial<Service> = {}): Service {
  return {
    id: "svc_home",
    companyId: "cmp_1",
    categoryId: "cat_1",
    name: "Home cleaning",
    billingType: "fixed",
    serviceBasisType: "billable",
    deductionEligible: false,
    deductionType: "none",
    smsEnabled: false,
    status: "active",
    createdAt: FIXTURE_TS,
    updatedAt: FIXTURE_TS,
    ...over,
  } as Service;
}
