import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * SVCCAT — Service Package dual-write mirror.
 *
 * Drives the real `mirrorServicePackageWrites` path against an in-memory Supabase
 * fake. Packages are global master data (no companyId), so there is no skip case.
 * Proves create / idempotency / update / removal / noop / failure behaviour.
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

import type { ServicePackage } from "@/types";
import {
  mirrorServicePackageWrites,
  getServicePackageDualWriteState,
  resetServicePackageDualWriteState,
} from "./servicePackageDualWrite";

function pkg(id: string, name = id, archived = false): ServicePackage {
  return {
    id,
    name,
    archived,
    items: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function rows(): Row[] {
  return mocks.client.tables.get("service_packages") ?? [];
}

beforeEach(() => {
  mocks.client.reset();
  resetServicePackageDualWriteState();
});

describe("SVCCAT · service package dual write", () => {
  it("mirrors a new package on create (always global, company_id null)", async () => {
    const result = await mirrorServicePackageWrites([], [pkg("pkg_a")]);
    expect(result.ok).toBe(true);
    expect(result.mirrored).toBe(1);
    expect(rows()).toHaveLength(1);
    expect(rows()[0].company_id).toBeNull();
    expect(rows()[0].status).toBe("active");
  });

  it("derives status='archived' from the archived flag", async () => {
    await mirrorServicePackageWrites([], [pkg("pkg_a", "A", true)]);
    expect(rows()[0].status).toBe("archived");
  });

  it("is idempotent", async () => {
    const all = [pkg("pkg_a")];
    await mirrorServicePackageWrites([], all);
    await mirrorServicePackageWrites([], all);
    expect(rows()).toHaveLength(1);
  });

  it("re-mirrors only the changed package on update", async () => {
    const before = [pkg("pkg_a"), pkg("pkg_b")];
    await mirrorServicePackageWrites([], before);
    resetServicePackageDualWriteState();
    const after = [pkg("pkg_a", "Renamed"), pkg("pkg_b")];
    const result = await mirrorServicePackageWrites(before, after);
    expect(result.mirrored).toBe(1);
    expect(rows().find((r) => r.legacy_id === "pkg_a")?.name).toBe("Renamed");
  });

  it("soft-deletes a removed package", async () => {
    const before = [pkg("pkg_a"), pkg("pkg_b")];
    await mirrorServicePackageWrites([], before);
    const result = await mirrorServicePackageWrites(before, [pkg("pkg_a")]);
    expect(result.removed).toBe(1);
    expect(rows().find((r) => r.legacy_id === "pkg_b")?.deleted_at).toBeTruthy();
  });

  it("noop does no Supabase work", async () => {
    const all = [pkg("pkg_a")];
    const result = await mirrorServicePackageWrites(all, all);
    expect(result.noop).toBe(true);
    expect(getServicePackageDualWriteState().noops).toBe(1);
  });

  it("records a failure when the upsert fails", async () => {
    mocks.client.failOn("service_packages");
    const result = await mirrorServicePackageWrites([], [pkg("pkg_a")]);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("upsert failed");
  });
});
