import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * USER-1 — User (login) migration + shadow-read parity.
 *
 * Drives the real `migrateUsers` / `shadowReadUsers` paths against an in-memory
 * Supabase fake, proving that:
 *   • migrate upserts the login rows (idempotent, legacy_id preserved),
 *   • a GLOBAL login (companyId null) migrates with company_id null, never skipped,
 *   • passwords are never written (the source is the password-free getUsers()),
 *   • a dry-run writes nothing,
 *   • a company login whose company has no Supabase mapping is skipped + reported,
 *   • shadow-read reports parity (count / id / email / detail) after migration.
 *
 * localStorage is the source of truth; these utilities only populate + verify.
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

const storeMocks = vi.hoisted(() => ({ users: [] as unknown[] }));
vi.mock("@/lib/store", () => ({
  getUsers: () => storeMocks.users,
}));

import type { User } from "@/types";
import { migrateUsers, shadowReadUsers } from "./userMigration";

const NORDLYS = "cmp_nordlys";
const UUID = "00000000-0000-4000-8000-000000000000";

function seedCompanies(): void {
  mocks.client.tables.set("companies", [{ id: UUID, legacy_id: NORDLYS }]);
}

function user(id: string, companyId: string | null = NORDLYS): User {
  return {
    id,
    name: id,
    email: `${id}@example.com`,
    role: companyId === null ? "super_admin" : "employee",
    companyId,
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function userRows(): Row[] {
  return mocks.client.tables.get("app_users") ?? [];
}

beforeEach(() => {
  mocks.client.reset();
  storeMocks.users = [];
});

describe("USER-1 · migrateUsers", () => {
  it("upserts login rows preserving legacy_id", async () => {
    seedCompanies();
    storeMocks.users = [user("usr_a"), user("usr_b")];
    const report = await migrateUsers();
    expect(report.ok).toBe(true);
    expect(report.writtenCount).toBe(2);
    expect(userRows().map((r) => r.legacy_id).sort()).toEqual(["usr_a", "usr_b"]);
  });

  it("migrates a GLOBAL login (companyId null) with company_id null", async () => {
    seedCompanies();
    storeMocks.users = [user("usr_super", null)];
    const report = await migrateUsers();
    expect(report.ok).toBe(true);
    expect(report.skipped).toHaveLength(0);
    expect(userRows()[0]?.company_id).toBeNull();
  });

  it("never writes a password into the mirrored row", async () => {
    seedCompanies();
    storeMocks.users = [user("usr_a")];
    await migrateUsers();
    const row = userRows()[0] as { data: Record<string, unknown> };
    expect("password" in row.data).toBe(false);
  });

  it("dry-run writes nothing", async () => {
    seedCompanies();
    storeMocks.users = [user("usr_a")];
    const report = await migrateUsers({ dryRun: true });
    expect(report.plannedCount).toBe(1);
    expect(report.writtenCount).toBe(0);
    expect(userRows()).toHaveLength(0);
  });

  it("skips a company login whose company has no Supabase row", async () => {
    storeMocks.users = [user("usr_a")];
    const report = await migrateUsers();
    expect(report.ok).toBe(false);
    expect(report.skipped).toHaveLength(1);
    expect(userRows()).toHaveLength(0);
  });
});

describe("USER-1 · shadowReadUsers", () => {
  it("reports full parity after a clean migration", async () => {
    seedCompanies();
    storeMocks.users = [user("usr_a"), user("usr_b")];
    await migrateUsers();
    const report = await shadowReadUsers();
    expect(report.countMatch).toBe(true);
    expect(report.idsMatch).toBe(true);
    expect(report.summaryMatch).toBe(true);
    expect(report.detailMatch).toBe(true);
    expect(report.ok).toBe(true);
  });

  it("flags a count mismatch when Supabase is missing a login", async () => {
    seedCompanies();
    storeMocks.users = [user("usr_a"), user("usr_b")];
    await migrateUsers();
    storeMocks.users = [...(storeMocks.users as User[]), user("usr_c")];
    const report = await shadowReadUsers();
    expect(report.countMatch).toBe(false);
    expect(report.missingInSupabase).toContain("usr_c");
    expect(report.ok).toBe(false);
  });
});
