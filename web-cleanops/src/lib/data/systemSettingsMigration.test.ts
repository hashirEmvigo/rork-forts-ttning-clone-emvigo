import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * SYSSET-1 — System Settings migration + shadow-read parity. Drives the real
 * `migrateSystemSettings` / `shadowReadSystemSettings` + `mirrorSystemSettingsWrite`
 * paths against an in-memory Supabase fake. System settings are a SINGLETON
 * global record (no company scope) — one row keyed by a constant legacy_id.
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

const storeMocks = vi.hoisted(() => ({ settings: null as unknown }));
vi.mock("@/lib/store", () => ({
  getSystemSettings: () => storeMocks.settings,
}));

import { defaultSystemSettings, type SystemSettings } from "@/types";
import { migrateSystemSettings, shadowReadSystemSettings } from "./systemSettingsMigration";
import { mirrorSystemSettingsWrite } from "./systemSettingsDualWrite";

function settings(overrides?: Partial<SystemSettings>): SystemSettings {
  return { ...defaultSystemSettings(), updatedAt: "2026-01-01T00:00:00.000Z", ...overrides };
}

function systemRows(): Row[] {
  return mocks.client.tables.get("system_settings") ?? [];
}

beforeEach(() => {
  mocks.client.reset();
  storeMocks.settings = settings();
});

describe("SYSSET-1 · migrateSystemSettings", () => {
  it("upserts the singleton record keyed by the constant legacy_id", async () => {
    const report = await migrateSystemSettings();
    expect(report.ok).toBe(true);
    expect(report.writtenCount).toBe(1);
    expect(systemRows()).toHaveLength(1);
    expect(systemRows()[0].legacy_id).toBe("global");
    expect(systemRows()[0].company_id).toBeNull();
  });

  it("is idempotent — re-running keeps a single row", async () => {
    await migrateSystemSettings();
    await migrateSystemSettings();
    expect(systemRows()).toHaveLength(1);
  });

  it("dry-run writes nothing", async () => {
    const report = await migrateSystemSettings({ dryRun: true });
    expect(report.plannedCount).toBe(1);
    expect(report.writtenCount).toBe(0);
    expect(systemRows()).toHaveLength(0);
  });
});

describe("SYSSET-1 · shadowReadSystemSettings", () => {
  it("reports parity after a clean migration", async () => {
    await migrateSystemSettings();
    const report = await shadowReadSystemSettings();
    expect(report.presentInSupabase).toBe(true);
    expect(report.detailMatch).toBe(true);
    expect(report.ok).toBe(true);
  });

  it("flags a record not yet in Supabase", async () => {
    const report = await shadowReadSystemSettings();
    expect(report.presentInSupabase).toBe(false);
    expect(report.ok).toBe(false);
  });

  it("flags a detail drift between local and Supabase", async () => {
    await migrateSystemSettings();
    storeMocks.settings = settings({ bookingGenerationHorizonMonths: 12 });
    const report = await shadowReadSystemSettings();
    expect(report.detailMatch).toBe(false);
    expect(report.ok).toBe(false);
  });
});

describe("SYSSET-1 · mirrorSystemSettingsWrite", () => {
  it("no-ops when the record is unchanged", async () => {
    const same = settings();
    const result = await mirrorSystemSettingsWrite(same, same);
    expect(result.ok).toBe(true);
    expect(result.noop).toBe(true);
    expect(systemRows()).toHaveLength(0);
  });

  it("mirrors a changed record and validates the round-trip", async () => {
    const prev = settings();
    const next = settings({ allowPreferredTimeEvaluation: true });
    const result = await mirrorSystemSettingsWrite(prev, next);
    expect(result.ok).toBe(true);
    expect(result.mirrored).toBe(1);
    expect(result.mismatch).toBe(false);
    const row = systemRows()[0]?.data as SystemSettings;
    expect(row.allowPreferredTimeEvaluation).toBe(true);
  });

  it("mirrors an initial write when there is no prev snapshot", async () => {
    const next = settings({ entitlementsResolver: "bundle" });
    const result = await mirrorSystemSettingsWrite(null, next);
    expect(result.ok).toBe(true);
    expect(result.mirrored).toBe(1);
  });
});
