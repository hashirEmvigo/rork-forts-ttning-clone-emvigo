/**
 * MOD-2A — authoritative GLOBAL Module / Module-Category write repository.
 *
 * Proves the Phase-2A fix: a module status toggle and every category create /
 * edit / archive-restore / delete / reorder commits DIRECTLY to Supabase, and a
 * SUBSEQUENT read (the "hard refresh" the directory performs via
 * {@link listFullModulesFromSupabase} / {@link listFullModuleCategoriesFromSupabase})
 * reflects the true persisted state. There is NO localStorage authority on this
 * path and a write that affects 0 rows (RLS-blocked / not found / already
 * soft-deleted) REJECTS rather than reporting a silent success.
 *
 * Driven against an in-memory Supabase fake honouring the exact chains the
 * repository uses: `insert(row).select("data").single()`,
 * `upsert(rows,{onConflict}).select("data").single()`,
 * `update(patch).eq(...).is("deleted_at", null).select(...)`, plus the unique
 * `legacy_id` constraint and `deleted_at` soft-delete filtering.
 */

type Row = Record<string, unknown>;
type Result = { data: Row[]; error: { message: string } | null };

const mocks = vi.hoisted(() => {
  class TableOp {
    private filters: Array<[string, unknown]> = [];
    private op: "select" | "insert" | "update" | "upsert" = "select";
    private payload: Row[] | null = null;
    private cols: string | null = null;
    constructor(private rows: Row[]) {}

    insert(row: Row): this {
      this.op = "insert";
      this.payload = [row];
      return this;
    }
    upsert(rowOrRows: Row | Row[]): this {
      this.op = "upsert";
      this.payload = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows];
      return this;
    }
    update(patch: Row): this {
      this.op = "update";
      this.payload = [patch];
      return this;
    }
    select(cols?: string): this {
      this.cols = cols ?? "*";
      return this;
    }
    eq(col: string, val: unknown): this {
      this.filters.push([col, val]);
      return this;
    }
    is(col: string, val: unknown): this {
      this.filters.push([col, val]);
      return this;
    }

    private matches(r: Row): boolean {
      return this.filters.every(([c, v]) => (r[c] ?? null) === v);
    }

    private project(rows: Row[]): Row[] {
      if (!this.cols || this.cols === "*") return rows.map((r) => ({ ...r }));
      const keys = this.cols.split(",").map((c) => c.trim());
      return rows.map((r) => {
        const out: Row = {};
        for (const k of keys) out[k] = r[k];
        return out;
      });
    }

    private execute(): Result {
      if (this.op === "insert" && this.payload) {
        const row = this.payload[0];
        if (this.rows.some((r) => r.legacy_id === row.legacy_id)) {
          return { data: [], error: { message: `duplicate legacy_id ${String(row.legacy_id)}` } };
        }
        const stored = { deleted_at: null, ...row };
        this.rows.push(stored);
        return { data: this.project([stored]), error: null };
      }
      if (this.op === "upsert" && this.payload) {
        const affected: Row[] = [];
        for (const row of this.payload) {
          const existing = this.rows.find((r) => r.legacy_id === row.legacy_id);
          if (existing) {
            Object.assign(existing, row);
            affected.push(existing);
          } else {
            const stored = { deleted_at: null, ...row };
            this.rows.push(stored);
            affected.push(stored);
          }
        }
        return { data: this.project(affected), error: null };
      }
      if (this.op === "update" && this.payload) {
        const affected: Row[] = [];
        for (const r of this.rows) {
          if (this.matches(r)) {
            Object.assign(r, this.payload[0]);
            affected.push(r);
          }
        }
        return { data: this.project(affected), error: null };
      }
      return { data: this.project(this.rows.filter((r) => this.matches(r))), error: null };
    }

    single(): Promise<{ data: Row | null; error: { message: string } | null }> {
      const { data, error } = this.execute();
      if (error) return Promise.resolve({ data: null, error });
      return Promise.resolve({ data: data[0] ?? null, error: null });
    }

    then<R>(onFulfilled: (res: Result) => R): Promise<R> {
      return Promise.resolve(this.execute()).then(onFulfilled);
    }
  }

  class FakeClient {
    tables = new Map<string, Row[]>();
    private table(name: string): Row[] {
      if (!this.tables.has(name)) this.tables.set(name, []);
      return this.tables.get(name) as Row[];
    }
    from(name: string) {
      return new TableOp(this.table(name));
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

import type { Module, ModuleCategory, CompanyModuleSetting } from "@/types";
import {
  upsertModuleInSupabase,
  upsertCompanyModuleInSupabase,
  createModuleCategoryInSupabase,
  updateModuleCategoryInSupabase,
  softDeleteModuleCategoryInSupabase,
  reorderModuleCategoriesInSupabase,
  listFullModulesFromSupabase,
  listFullModuleCategoriesFromSupabase,
  listFullCompanyModulesFromSupabase,
} from "./supabaseModuleRepository";

const MODULES_LS_KEY = "cleanops.modules";
const MODULE_CATEGORIES_LS_KEY = "cleanops.moduleCategories";
const COMPANY_MODULES_LS_KEY = "cleanops.companyModules";

function mod(id: string, name: string, status: Module["status"]): Module {
  return {
    id,
    name,
    description: `${name} module`,
    status,
    allowedUserTypes: ["company_admin"],
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function cat(
  id: string,
  name: string,
  sortOrder: number,
  overrides: Partial<ModuleCategory> = {},
): ModuleCategory {
  return {
    id,
    name,
    description: `${name} category`,
    icon: "layers",
    sortOrder,
    status: "active",
    visibleUserTypes: ["company_admin"],
    moduleIds: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function companyMod(
  companyId: string,
  moduleId: string,
  overrides: Partial<CompanyModuleSetting> = {},
): CompanyModuleSetting {
  return { companyId, moduleId, available: true, enabled: true, ...overrides };
}

function moduleRows(): Row[] {
  return mocks.client.tables.get("modules") ?? [];
}
function categoryRows(): Row[] {
  return mocks.client.tables.get("module_categories") ?? [];
}
function companyModuleRows(): Row[] {
  return mocks.client.tables.get("company_modules") ?? [];
}

/** Seeds a companies row so the legacy_id→UUID tenant map can resolve. */
function seedCompany(legacyId: string, uuid: string): void {
  const companies = mocks.client.tables.get("companies") ?? [];
  companies.push({ id: uuid, legacy_id: legacyId });
  mocks.client.tables.set("companies", companies);
}

beforeEach(() => {
  mocks.client.reset();
  localStorage.clear();
});

describe("MOD-2A · authoritative module status writes", () => {
  it("upsert persists status and survives a re-read (hard refresh)", async () => {
    await upsertModuleInSupabase(mod("availability", "Availability", "active"));

    const after = await listFullModulesFromSupabase();
    expect(after.map((m) => m.id)).toContain("availability");
    expect(after.find((m) => m.id === "availability")?.status).toBe("active");
  });

  it("status toggle persists in BOTH the flat column and data after re-read", async () => {
    await upsertModuleInSupabase(mod("availability", "Availability", "active"));
    await upsertModuleInSupabase(mod("availability", "Availability", "inactive"));

    const row = moduleRows().find((r) => r.legacy_id === "availability");
    expect(row?.status).toBe("inactive");
    expect((row?.data as Module).status).toBe("inactive");

    const after = await listFullModulesFromSupabase();
    expect(after.find((m) => m.id === "availability")?.status).toBe("inactive");
  });
});

describe("MOD-2A · authoritative module-category writes", () => {
  it("create persists and survives a re-read (hard refresh)", async () => {
    await createModuleCategoryInSupabase(cat("cat_ops", "Operations", 0));

    const after = await listFullModuleCategoriesFromSupabase();
    expect(after.map((c) => c.id)).toContain("cat_ops");
    expect(after.find((c) => c.id === "cat_ops")?.name).toBe("Operations");
  });

  it("rejects a duplicate legacy_id create (unique constraint)", async () => {
    await createModuleCategoryInSupabase(cat("cat_ops", "Operations", 0));
    await expect(
      createModuleCategoryInSupabase(cat("cat_ops", "Operations (dup)", 1)),
    ).rejects.toThrow(/create failed/);
  });

  it("edit persists the new name in BOTH the flat column and data", async () => {
    await createModuleCategoryInSupabase(cat("cat_ops", "Operations", 0));
    await updateModuleCategoryInSupabase(cat("cat_ops", "Operations (renamed)", 0));

    const row = categoryRows().find((r) => r.legacy_id === "cat_ops");
    expect(row?.name).toBe("Operations (renamed)");
    expect((row?.data as ModuleCategory).name).toBe("Operations (renamed)");

    const after = await listFullModuleCategoriesFromSupabase();
    expect(after.find((c) => c.id === "cat_ops")?.name).toBe("Operations (renamed)");
  });

  it("archive then restore persists status=inactive then status=active after re-read", async () => {
    await createModuleCategoryInSupabase(cat("cat_ops", "Operations", 0));

    await updateModuleCategoryInSupabase(cat("cat_ops", "Operations", 0, { status: "inactive" }));
    let after = await listFullModuleCategoriesFromSupabase();
    expect(after.find((c) => c.id === "cat_ops")?.status).toBe("inactive");
    expect(categoryRows().find((r) => r.legacy_id === "cat_ops")?.status).toBe("inactive");

    await updateModuleCategoryInSupabase(cat("cat_ops", "Operations", 0, { status: "active" }));
    after = await listFullModuleCategoriesFromSupabase();
    expect(after.find((c) => c.id === "cat_ops")?.status).toBe("active");
  });

  it("soft-delete sets deleted_at and the category disappears from a re-read", async () => {
    await createModuleCategoryInSupabase(cat("cat_ops", "Operations", 0));
    await softDeleteModuleCategoryInSupabase("cat_ops");

    const row = categoryRows().find((r) => r.legacy_id === "cat_ops");
    expect(row?.deleted_at).toBeTruthy();

    const after = await listFullModuleCategoriesFromSupabase();
    expect(after.map((c) => c.id)).not.toContain("cat_ops");
  });

  it("reorder persists each new sort_order in flat column and data after re-read", async () => {
    await createModuleCategoryInSupabase(cat("cat_a", "A", 0));
    await createModuleCategoryInSupabase(cat("cat_b", "B", 1));

    // Swap their order.
    await reorderModuleCategoriesInSupabase([cat("cat_b", "B", 0), cat("cat_a", "A", 1)]);

    const after = await listFullModuleCategoriesFromSupabase();
    expect(after.find((c) => c.id === "cat_a")?.sortOrder).toBe(1);
    expect(after.find((c) => c.id === "cat_b")?.sortOrder).toBe(0);
    expect(categoryRows().find((r) => r.legacy_id === "cat_a")?.sort_order).toBe(1);
  });

  it("rejects an update that affects 0 rows (RLS-blocked / not found) — never a silent no-op", async () => {
    await expect(
      updateModuleCategoryInSupabase(cat("cat_missing", "Missing", 0)),
    ).rejects.toThrow(/0 rows/);
  });

  it("rejects updating a soft-deleted category (deleted_at filter excludes it)", async () => {
    await createModuleCategoryInSupabase(cat("cat_ops", "Operations", 0));
    await softDeleteModuleCategoryInSupabase("cat_ops");
    await expect(
      updateModuleCategoryInSupabase(cat("cat_ops", "Operations", 0)),
    ).rejects.toThrow(/0 rows/);
  });

  it("rejects a repeated delete (already soft-deleted) instead of false success", async () => {
    await createModuleCategoryInSupabase(cat("cat_ops", "Operations", 0));
    await softDeleteModuleCategoryInSupabase("cat_ops");
    await expect(softDeleteModuleCategoryInSupabase("cat_ops")).rejects.toThrow(/0 rows/);
  });
});

describe("MOD-2B · authoritative company-module (availability/enablement) writes", () => {
  const NORDLYS_UUID = "11111111-1111-4111-8111-111111111111";

  it("resolves the tenant UUID and persists an offer after a re-read (hard refresh)", async () => {
    seedCompany("cmp_nordlys", NORDLYS_UUID);
    await upsertCompanyModuleInSupabase(
      companyMod("cmp_nordlys", "news", { available: true, enabled: true }),
    );

    const row = companyModuleRows().find((r) => r.legacy_id === "cmp_nordlys:news");
    expect(row?.company_id).toBe(NORDLYS_UUID); // real FK the RLS check needs
    expect(row?.company_legacy_id).toBe("cmp_nordlys");
    expect(row?.module_legacy_id).toBe("news");
    expect(row?.available).toBe(true);
    expect(row?.enabled).toBe(true);

    const after = await listFullCompanyModulesFromSupabase();
    const setting = after.find((s) => s.companyId === "cmp_nordlys" && s.moduleId === "news");
    expect(setting?.available).toBe(true);
    expect(setting?.enabled).toBe(true);
  });

  it("a Company-Admin disable persists in BOTH the flat column and data after re-read", async () => {
    seedCompany("cmp_nordlys", NORDLYS_UUID);
    await upsertCompanyModuleInSupabase(
      companyMod("cmp_nordlys", "news", { available: true, enabled: true }),
    );
    await upsertCompanyModuleInSupabase(
      companyMod("cmp_nordlys", "news", { available: true, enabled: false }),
    );

    const row = companyModuleRows().find((r) => r.legacy_id === "cmp_nordlys:news");
    expect(row?.enabled).toBe(false);
    expect((row?.data as CompanyModuleSetting).enabled).toBe(false);

    const after = await listFullCompanyModulesFromSupabase();
    expect(after.find((s) => s.moduleId === "news")?.enabled).toBe(false);
  });

  it("withdrawing availability persists available=false AND enabled=false", async () => {
    seedCompany("cmp_nordlys", NORDLYS_UUID);
    await upsertCompanyModuleInSupabase(
      companyMod("cmp_nordlys", "news", { available: false, enabled: false }),
    );

    const after = await listFullCompanyModulesFromSupabase();
    const setting = after.find((s) => s.moduleId === "news");
    expect(setting?.available).toBe(false);
    expect(setting?.enabled).toBe(false);
  });

  it("rejects an unmapped company instead of writing a null tenant", async () => {
    // No company seeded → the legacy_id→UUID map is empty.
    await expect(
      upsertCompanyModuleInSupabase(companyMod("cmp_ghost", "news")),
    ).rejects.toThrow(/No Supabase company/);
    expect(companyModuleRows()).toHaveLength(0);
  });

  it("is Supabase-authoritative: never reads/writes localStorage, survives a clear()", async () => {
    seedCompany("cmp_nordlys", NORDLYS_UUID);
    expect(localStorage.getItem(COMPANY_MODULES_LS_KEY)).toBeNull();

    await upsertCompanyModuleInSupabase(companyMod("cmp_nordlys", "news"));
    expect(localStorage.getItem(COMPANY_MODULES_LS_KEY)).toBeNull();

    // Clearing browser storage cannot change the persisted availability/enabled.
    localStorage.clear();
    const after = await listFullCompanyModulesFromSupabase();
    expect(after.find((s) => s.moduleId === "news")?.available).toBe(true);
  });
});

describe("MOD-2A · no localStorage authority", () => {
  it("module + category writes only touch Supabase, never the legacy stores", async () => {
    expect(localStorage.getItem(MODULES_LS_KEY)).toBeNull();
    expect(localStorage.getItem(MODULE_CATEGORIES_LS_KEY)).toBeNull();

    await upsertModuleInSupabase(mod("availability", "Availability", "active"));
    await createModuleCategoryInSupabase(cat("cat_ops", "Operations", 0));
    await updateModuleCategoryInSupabase(cat("cat_ops", "Operations (edit)", 0));
    await softDeleteModuleCategoryInSupabase("cat_ops");

    // Authoritative state lives in Supabase; the stores are never written.
    expect(localStorage.getItem(MODULES_LS_KEY)).toBeNull();
    expect(localStorage.getItem(MODULE_CATEGORIES_LS_KEY)).toBeNull();
  });
});
