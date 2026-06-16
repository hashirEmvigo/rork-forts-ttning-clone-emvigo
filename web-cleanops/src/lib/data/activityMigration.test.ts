import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ACTIVITY-1 — Activity Log migration + shadow-read parity. Drives the real
 * `migrateActivityEvents` / `shadowReadActivityEvents` paths against an
 * in-memory Supabase fake. The trail is append-only — there is no removal path.
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
    order(): this {
      return this;
    }
    limit(): this {
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

const storeMocks = vi.hoisted(() => ({ events: [] as unknown[] }));
vi.mock("@/lib/store", () => ({
  getAuditEvents: () => storeMocks.events,
}));

import type { AuditEvent } from "@/types";
import { migrateActivityEvents, shadowReadActivityEvents } from "./activityMigration";

const NORDLYS = "cmp_nordlys";
const UUID = "00000000-0000-4000-8000-000000000000";

function seedCompanies(): void {
  mocks.client.tables.set("companies", [{ id: UUID, legacy_id: NORDLYS }]);
}

function event(id: string, companyId: string | null = NORDLYS): AuditEvent {
  return {
    id,
    at: "2026-01-01T00:00:00.000Z",
    actorId: "u1",
    actorName: "System",
    actorRole: "super_admin",
    companyId,
    action: "system_settings.update",
    summary: `event ${id}`,
  };
}

function activityRows(): Row[] {
  return mocks.client.tables.get("activity_events") ?? [];
}

beforeEach(() => {
  mocks.client.reset();
  storeMocks.events = [];
});

describe("ACTIVITY-1 · migrateActivityEvents", () => {
  it("upserts event rows preserving legacy_id", async () => {
    seedCompanies();
    storeMocks.events = [event("aud_a"), event("aud_b")];
    const report = await migrateActivityEvents();
    expect(report.ok).toBe(true);
    expect(report.writtenCount).toBe(2);
    expect(activityRows().map((r) => r.legacy_id).sort()).toEqual(["aud_a", "aud_b"]);
  });

  it("migrates a platform-level event with company_id null", async () => {
    seedCompanies();
    storeMocks.events = [event("aud_platform", null)];
    const report = await migrateActivityEvents();
    expect(report.ok).toBe(true);
    expect(activityRows()[0].company_id).toBeNull();
  });

  it("dry-run writes nothing", async () => {
    seedCompanies();
    storeMocks.events = [event("aud_a")];
    const report = await migrateActivityEvents({ dryRun: true });
    expect(report.plannedCount).toBe(1);
    expect(report.writtenCount).toBe(0);
    expect(activityRows()).toHaveLength(0);
  });

  it("skips a company event whose company has no Supabase row", async () => {
    storeMocks.events = [event("aud_a")];
    const report = await migrateActivityEvents();
    expect(report.ok).toBe(false);
    expect(report.skipped).toHaveLength(1);
  });
});

describe("ACTIVITY-1 · shadowReadActivityEvents", () => {
  it("reports parity after a clean migration", async () => {
    seedCompanies();
    storeMocks.events = [event("aud_a"), event("aud_b")];
    await migrateActivityEvents();
    const report = await shadowReadActivityEvents();
    expect(report.idsMatch).toBe(true);
    expect(report.detailMatch).toBe(true);
    expect(report.ok).toBe(true);
  });

  it("flags a missing event not yet in Supabase", async () => {
    seedCompanies();
    storeMocks.events = [event("aud_a")];
    await migrateActivityEvents();
    storeMocks.events = [...(storeMocks.events as AuditEvent[]), event("aud_c")];
    const report = await shadowReadActivityEvents();
    expect(report.idsMatch).toBe(false);
    expect(report.missingInSupabase).toContain("aud_c");
    expect(report.ok).toBe(false);
  });
});
