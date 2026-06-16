/**
 * ENT-2 — authoritative Service-Entitlement write repository.
 *
 * Proves the Service → Company persistence fix: a Super-Admin global-availability
 * toggle, a per-company disabled/trial/enabled change, and each entitlement-log
 * append commit DIRECTLY to Supabase, and a SUBSEQUENT read (the "hard refresh"
 * the entitlement source performs via {@link listGlobalEntitlementsFromSupabase} /
 * {@link listCompanyEntitlementsFromSupabase} / {@link listEntitlementLogFromSupabase})
 * reflects the true persisted state. There is NO localStorage authority on this
 * path: the company write resolves the real tenant UUID the RLS check needs and
 * REJECTS an unmapped company rather than writing a null tenant.
 *
 * Driven against an in-memory Supabase fake honouring the exact chains the
 * repository uses: `upsert(row,{onConflict}).select("data").single()`,
 * `insert(row)` (append-only log), `select(cols).eq(...)`, `.order(...)`, plus
 * the unique `legacy_id` constraint and `deleted_at` soft-delete filtering.
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
    /** Ordering is irrelevant to the in-memory fake — accept + ignore. */
    order(): this {
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

import type {
  ServiceGlobalEntitlement,
  CompanyServiceEntitlement,
  ServiceEntitlementLogEntry,
} from "@/types";
import {
  upsertGlobalEntitlementInSupabase,
  upsertCompanyEntitlementInSupabase,
  appendEntitlementLogInSupabase,
  listGlobalEntitlementsFromSupabase,
  listCompanyEntitlementsFromSupabase,
  listEntitlementLogFromSupabase,
} from "./supabaseEntitlementRepository";

const GLOBAL_LS_KEY = "cleanops.serviceGlobalEntitlements";
const COMPANY_LS_KEY = "cleanops.companyServiceEntitlements";
const LOG_LS_KEY = "cleanops.serviceEntitlementLog";

const STAD_UUID = "22222222-2222-4222-8222-222222222222";

function globalEnt(
  serviceKey: string,
  enabled: boolean,
): ServiceGlobalEntitlement {
  return {
    serviceKey: serviceKey as ServiceGlobalEntitlement["serviceKey"],
    enabled,
    updatedBy: "u_super",
    updatedAt: "2026-02-01T00:00:00.000Z",
  };
}

function companyEnt(
  companyId: string,
  serviceKey: string,
  overrides: Partial<CompanyServiceEntitlement> = {},
): CompanyServiceEntitlement {
  return {
    companyId,
    serviceKey: serviceKey as CompanyServiceEntitlement["serviceKey"],
    status: "enabled",
    enabled: true,
    enabledAt: "2026-02-01T00:00:00.000Z",
    disabledAt: null,
    trialStartedAt: null,
    trialEndedAt: null,
    updatedBy: "u_super",
    updatedAt: "2026-02-01T00:00:00.000Z",
    ...overrides,
  };
}

function logEntry(
  id: string,
  companyId: string | null,
  action: ServiceEntitlementLogEntry["action"],
): ServiceEntitlementLogEntry {
  return {
    id,
    serviceKey: "media_uploads",
    companyId,
    action,
    previousValue: false,
    newValue: true,
    changedBy: "u_super",
    changedAt: "2026-02-01T00:00:00.000Z",
  };
}

function globalRows(): Row[] {
  return mocks.client.tables.get("service_global_entitlements") ?? [];
}
function companyRows(): Row[] {
  return mocks.client.tables.get("company_service_entitlements") ?? [];
}
function logRows(): Row[] {
  return mocks.client.tables.get("service_entitlement_log") ?? [];
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

describe("ENT-2 · authoritative GLOBAL availability writes", () => {
  it("upsert persists availability and survives a re-read (hard refresh)", async () => {
    await upsertGlobalEntitlementInSupabase(globalEnt("media_uploads", true));

    const after = await listGlobalEntitlementsFromSupabase();
    expect(after.map((g) => g.serviceKey)).toContain("media_uploads");
    expect(after.find((g) => g.serviceKey === "media_uploads")?.enabled).toBe(true);
  });

  it("toggle persists in BOTH the flat column and data after re-read", async () => {
    await upsertGlobalEntitlementInSupabase(globalEnt("media_uploads", true));
    await upsertGlobalEntitlementInSupabase(globalEnt("media_uploads", false));

    const row = globalRows().find((r) => r.legacy_id === "media_uploads");
    expect(row?.enabled).toBe(false);
    expect((row?.data as ServiceGlobalEntitlement).enabled).toBe(false);

    const after = await listGlobalEntitlementsFromSupabase();
    expect(after.find((g) => g.serviceKey === "media_uploads")?.enabled).toBe(false);
  });
});

describe("ENT-2 · authoritative COMPANY (disabled/trial/enabled) writes", () => {
  it("resolves the tenant UUID and persists enablement after a re-read (hard refresh)", async () => {
    seedCompany("cmp_stad", STAD_UUID);
    await upsertCompanyEntitlementInSupabase(
      companyEnt("cmp_stad", "media_uploads", { status: "enabled", enabled: true }),
    );

    const row = companyRows().find((r) => r.legacy_id === "cmp_stad::media_uploads");
    expect(row?.company_id).toBe(STAD_UUID); // real FK the RLS check needs
    expect(row?.company_legacy_id).toBe("cmp_stad");
    expect(row?.service_key).toBe("media_uploads");
    expect(row?.status).toBe("enabled");
    expect(row?.enabled).toBe(true);

    const after = await listCompanyEntitlementsFromSupabase();
    const setting = after.find(
      (s) => s.companyId === "cmp_stad" && s.serviceKey === "media_uploads",
    );
    expect(setting?.status).toBe("enabled");
    expect(setting?.enabled).toBe(true);
  });

  it("a tri-state change (enabled → trial → disabled) persists the latest status after re-read", async () => {
    seedCompany("cmp_stad", STAD_UUID);
    await upsertCompanyEntitlementInSupabase(
      companyEnt("cmp_stad", "media_uploads", { status: "enabled", enabled: true }),
    );
    await upsertCompanyEntitlementInSupabase(
      companyEnt("cmp_stad", "media_uploads", { status: "trial", enabled: true }),
    );
    await upsertCompanyEntitlementInSupabase(
      companyEnt("cmp_stad", "media_uploads", { status: "disabled", enabled: false }),
    );

    const row = companyRows().find((r) => r.legacy_id === "cmp_stad::media_uploads");
    expect(row?.status).toBe("disabled");
    expect(row?.enabled).toBe(false);
    expect((row?.data as CompanyServiceEntitlement).status).toBe("disabled");

    // A single row per (company, service) — the upsert key collapses transitions.
    expect(companyRows()).toHaveLength(1);

    const after = await listCompanyEntitlementsFromSupabase();
    expect(after.find((s) => s.serviceKey === "media_uploads")?.status).toBe("disabled");
  });

  it("rejects an unmapped company instead of writing a null tenant", async () => {
    // No company seeded → the legacy_id→UUID map is empty.
    await expect(
      upsertCompanyEntitlementInSupabase(companyEnt("cmp_ghost", "media_uploads")),
    ).rejects.toThrow(/No Supabase company/);
    expect(companyRows()).toHaveLength(0);
  });

  it("is Supabase-authoritative: never reads/writes localStorage, survives a clear()", async () => {
    seedCompany("cmp_stad", STAD_UUID);
    expect(localStorage.getItem(COMPANY_LS_KEY)).toBeNull();

    await upsertCompanyEntitlementInSupabase(
      companyEnt("cmp_stad", "media_uploads", { status: "trial", enabled: true }),
    );
    expect(localStorage.getItem(COMPANY_LS_KEY)).toBeNull();

    // Clearing browser storage cannot change the persisted status.
    localStorage.clear();
    const after = await listCompanyEntitlementsFromSupabase();
    expect(after.find((s) => s.serviceKey === "media_uploads")?.status).toBe("trial");
  });
});

describe("ENT-2 · append-only entitlement log", () => {
  it("appends a company-scoped entry (UUID resolved) that survives a re-read", async () => {
    seedCompany("cmp_stad", STAD_UUID);
    await appendEntitlementLogInSupabase(
      logEntry("ent_1", "cmp_stad", "company_enabled"),
    );

    const row = logRows().find((r) => r.legacy_id === "ent_1");
    expect(row?.company_id).toBe(STAD_UUID);
    expect(row?.company_legacy_id).toBe("cmp_stad");
    expect(row?.action).toBe("company_enabled");

    const after = await listEntitlementLogFromSupabase();
    expect(after.map((l) => l.id)).toContain("ent_1");
  });

  it("appends a platform-wide (global) entry with a null tenant", async () => {
    await appendEntitlementLogInSupabase(logEntry("ent_g", null, "global_enabled"));

    const row = logRows().find((r) => r.legacy_id === "ent_g");
    expect(row?.company_id).toBeNull();

    const after = await listEntitlementLogFromSupabase();
    expect(after.find((l) => l.id === "ent_g")?.action).toBe("global_enabled");
  });

  it("rejects a company-scoped append for an unmapped company", async () => {
    await expect(
      appendEntitlementLogInSupabase(logEntry("ent_x", "cmp_ghost", "company_enabled")),
    ).rejects.toThrow(/No Supabase company/);
    expect(logRows()).toHaveLength(0);
  });

  it("rejects a duplicate log id (append-only, unique legacy_id)", async () => {
    await appendEntitlementLogInSupabase(logEntry("ent_dup", null, "global_enabled"));
    await expect(
      appendEntitlementLogInSupabase(logEntry("ent_dup", null, "global_disabled")),
    ).rejects.toThrow(/append failed/);
  });
});

describe("ENT-2 · no localStorage authority", () => {
  it("global + company + log writes only touch Supabase, never the legacy stores", async () => {
    seedCompany("cmp_stad", STAD_UUID);
    expect(localStorage.getItem(GLOBAL_LS_KEY)).toBeNull();
    expect(localStorage.getItem(COMPANY_LS_KEY)).toBeNull();
    expect(localStorage.getItem(LOG_LS_KEY)).toBeNull();

    await upsertGlobalEntitlementInSupabase(globalEnt("media_uploads", true));
    await upsertCompanyEntitlementInSupabase(companyEnt("cmp_stad", "media_uploads"));
    await appendEntitlementLogInSupabase(logEntry("ent_1", "cmp_stad", "company_enabled"));

    // Authoritative state lives in Supabase; the stores are never written.
    expect(localStorage.getItem(GLOBAL_LS_KEY)).toBeNull();
    expect(localStorage.getItem(COMPANY_LS_KEY)).toBeNull();
    expect(localStorage.getItem(LOG_LS_KEY)).toBeNull();
  });
});
