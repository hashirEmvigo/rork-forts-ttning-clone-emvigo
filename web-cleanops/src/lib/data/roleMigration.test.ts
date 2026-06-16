import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ROLE-1 — Role migration + shadow-read parity.
 *
 * Drives the real `migrateRoles` / `shadowReadRoles` paths against an in-memory
 * Supabase fake, proving that:
 *   • migrate upserts the role rows (idempotent, legacy_id preserved),
 *   • a GLOBAL role (companyId null) migrates with company_id null, never skipped,
 *   • a dry-run writes nothing,
 *   • a company role whose company has no Supabase mapping is skipped + reported,
 *   • shadow-read reports parity (count / id / name / detail) after migration.
 *
 * localStorage is the source of truth; these utilities only populate + verify.
 */

type Row = Record<string, unknown>;

const mocks = vi.hoisted(() => {
  class QueryBuilder {
    private filters: Array<[string, unknown]> = [];
    private orClauses: string[] = [];
    constructor(private rows: Row[]) {}
    eq(col: string, val: unknown): this {
      this.filters.push([col, val]);
      return this;
    }
    or(clause: string): this {
      this.orClauses.push(clause);
      return this;
    }
    private matchesOr(r: Row): boolean {
      if (this.orClauses.length === 0) return true;
      // Single PostgREST-style OR: "company_legacy_id.eq.X,company_legacy_id.is.null"
      return this.orClauses.every((clause) =>
        clause.split(",").some((part) => {
          const [col, op, val] = part.split(".");
          if (op === "eq") return r[col] === val;
          if (op === "is" && val === "null") return r[col] === null;
          return false;
        }),
      );
    }
    private applied(): Row[] {
      return this.rows.filter(
        (r) => this.filters.every(([c, v]) => r[c] === v) && this.matchesOr(r),
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

const storeMocks = vi.hoisted(() => ({ roles: [] as unknown[] }));
vi.mock("@/lib/store", () => ({
  getRoles: () => storeMocks.roles,
}));

import type { Role } from "@/types";
import { migrateRoles, shadowReadRoles } from "./roleMigration";

const NORDLYS = "cmp_nordlys";
const UUID = "00000000-0000-4000-8000-000000000000";

function seedCompanies(): void {
  mocks.client.tables.set("companies", [{ id: UUID, legacy_id: NORDLYS }]);
}

function role(id: string, companyId: string | null = NORDLYS, name = id): Role {
  return {
    id,
    name,
    description: `${name} desc`,
    companyId,
    isSystem: false,
    permissions: ["a", "b"],
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function roleRows(): Row[] {
  return mocks.client.tables.get("roles") ?? [];
}

beforeEach(() => {
  mocks.client.reset();
  storeMocks.roles = [];
});

describe("ROLE-1 · migrateRoles", () => {
  it("upserts role rows preserving legacy_id", async () => {
    seedCompanies();
    storeMocks.roles = [role("role_a"), role("role_b")];
    const report = await migrateRoles();
    expect(report.ok).toBe(true);
    expect(report.writtenCount).toBe(2);
    expect(roleRows().map((r) => r.legacy_id).sort()).toEqual(["role_a", "role_b"]);
  });

  it("migrates a GLOBAL role (companyId null) with company_id null", async () => {
    seedCompanies();
    storeMocks.roles = [role("role_tpl_employee", null)];
    const report = await migrateRoles();
    expect(report.ok).toBe(true);
    expect(report.skipped).toHaveLength(0);
    expect(roleRows()[0]?.company_id).toBeNull();
  });

  it("dry-run writes nothing", async () => {
    seedCompanies();
    storeMocks.roles = [role("role_a")];
    const report = await migrateRoles({ dryRun: true });
    expect(report.plannedCount).toBe(1);
    expect(report.writtenCount).toBe(0);
    expect(roleRows()).toHaveLength(0);
  });

  it("skips a company role whose company has no Supabase row", async () => {
    // No companies seeded.
    storeMocks.roles = [role("role_a")];
    const report = await migrateRoles();
    expect(report.ok).toBe(false);
    expect(report.skipped).toHaveLength(1);
    expect(roleRows()).toHaveLength(0);
  });
});

describe("ROLE-1 · shadowReadRoles", () => {
  it("reports full parity after a clean migration", async () => {
    seedCompanies();
    storeMocks.roles = [role("role_a"), role("role_tpl_employee", null)];
    await migrateRoles();
    const report = await shadowReadRoles();
    expect(report.countMatch).toBe(true);
    expect(report.idsMatch).toBe(true);
    expect(report.summaryMatch).toBe(true);
    expect(report.detailMatch).toBe(true);
    expect(report.ok).toBe(true);
  });

  it("flags a count mismatch when Supabase is missing a role", async () => {
    seedCompanies();
    storeMocks.roles = [role("role_a"), role("role_b")];
    await migrateRoles();
    storeMocks.roles = [...(storeMocks.roles as Role[]), role("role_c")];
    const report = await shadowReadRoles();
    expect(report.countMatch).toBe(false);
    expect(report.missingInSupabase).toContain("role_c");
    expect(report.ok).toBe(false);
  });
});
