/**
 * Asset Center repository (Phase 1) — Supabase-authoritative CRUD proof.
 *
 * Drives the repository against an in-memory Supabase fake honouring the exact
 * chains it uses (`insert(row).select(cols).single()`,
 * `update(patch).eq(...).is("deleted_at", null).select(cols)`, plus the unique
 * `legacy_id` constraint and `deleted_at`/`archived_at` filtering). Proves:
 *   • create/get/update/archive/restore/soft-delete persist + survive re-reads,
 *   • a write affecting 0 rows REJECTS (never a silent no-op),
 *   • links/variants/activity/copy-history persist,
 *   • a company copy stays INDEPENDENT after the global original is deleted,
 *   • there is NO localStorage authority on this path.
 */
type Row = Record<string, unknown>;
type Result = { data: Row[]; error: { message: string } | null };

const mocks = vi.hoisted(() => {
  function isoNow(): string {
    return new Date().toISOString();
  }

  // Mimics the DB's `id uuid primary key default gen_random_uuid()` so rows get a
  // stable uuid on insert (needed by createAssetLink's legacy_id → uuid lookup).
  let uuidSeq = 0;
  function nextUuid(): string {
    uuidSeq += 1;
    return `uuid-${uuidSeq}`;
  }

  class TableOp {
    private filters: Array<[string, unknown]> = [];
    private op: "select" | "insert" | "update" = "select";
    private payload: Row | null = null;
    private cols: string | null = null;
    constructor(private rows: Row[]) {}

    insert(row: Row): this {
      this.op = "insert";
      this.payload = row;
      return this;
    }
    update(patch: Row): this {
      this.op = "update";
      this.payload = patch;
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
      return this.filters.every(([c, v]) => (r[c] ?? null) === (v ?? null));
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
        const row = this.payload;
        if (this.rows.some((r) => r.legacy_id === row.legacy_id)) {
          return {
            data: [],
            error: { message: `duplicate legacy_id ${String(row.legacy_id)}` },
          };
        }
        const stored: Row = {
          deleted_at: null,
          archived_at: null,
          is_active: true,
          created_at: isoNow(),
          updated_at: isoNow(),
          ...row,
        };
        if (stored.id === undefined) stored.id = nextUuid();
        this.rows.push(stored);
        return { data: this.project([stored]), error: null };
      }
      if (this.op === "update" && this.payload) {
        const affected: Row[] = [];
        for (const r of this.rows) {
          if (this.matches(r)) {
            Object.assign(r, this.payload, { updated_at: isoNow() });
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

    // Supabase `.maybeSingle()` — 0 rows is not an error (returns null).
    maybeSingle(): Promise<{ data: Row | null; error: { message: string } | null }> {
      return this.single();
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

import {
  archiveAsset,
  archiveAssetLink,
  createAsset,
  createAssetLink,
  createAssetVariant,
  getAssetById,
  listAssetLinks,
  listAssetVariants,
  listAssets,
  recordAssetActivityEvent,
  recordAssetCopyHistory,
  restoreAsset,
  softDeleteAsset,
  updateAsset,
} from "./assetRepository";

function assetRows(): Row[] {
  return mocks.client.tables.get("assets") ?? [];
}

beforeEach(() => {
  mocks.client.reset();
  localStorage.clear();
});

describe("Asset Center repository · assets CRUD", () => {
  it("create persists and survives a re-read (hard refresh)", async () => {
    const created = await createAsset({
      scope: "global_internal",
      assetType: "image",
      name: "logo.webp",
      title: "Brand logo",
      tags: ["brand"],
    });
    expect(created.id).toMatch(/^asset_/);

    const after = await getAssetById(created.id);
    expect(after?.title).toBe("Brand logo");
    expect(after?.tags).toEqual(["brand"]);
    expect(after?.scope).toBe("global_internal");
  });

  it("list filters by scope and company", async () => {
    await createAsset({ scope: "global_internal", assetType: "image", name: "g.webp" });
    await createAsset({
      scope: "company_internal",
      companyId: "cmp_nordlys",
      assetType: "image",
      name: "c.webp",
    });

    const globals = await listAssets({ scope: "global_internal" });
    expect(globals).toHaveLength(1);
    expect(globals[0].name).toBe("g.webp");

    const company = await listAssets({ companyId: "cmp_nordlys" });
    expect(company).toHaveLength(1);
    expect(company[0].name).toBe("c.webp");
  });

  it("update persists new metadata after re-read", async () => {
    const a = await createAsset({ scope: "global_internal", assetType: "image", name: "x" });
    await updateAsset(a.id, { title: "Renamed", visibility: "public" });

    const after = await getAssetById(a.id);
    expect(after?.title).toBe("Renamed");
    expect(after?.visibility).toBe("public");
  });

  it("rejects an update that affects 0 rows (not found / RLS) — never a silent no-op", async () => {
    await expect(updateAsset("asset_missing", { title: "x" })).rejects.toThrow(/0 rows/);
  });

  it("archive sets archived_at and hides it from active lists while preserving the asset record", async () => {
    const a = await createAsset({ scope: "global_internal", assetType: "image", name: "x" });

    await archiveAsset(a.id);
    expect(await listAssets({ scope: "global_internal" })).toHaveLength(0);
    expect(await listAssets({ scope: "global_internal", includeArchived: true })).toHaveLength(1);

    const archived = await getAssetById(a.id);
    expect(archived).not.toBeNull();
    expect(archived?.archivedAt).toBeTruthy();
    expect(assetRows().find((r) => r.legacy_id === a.id)?.deleted_at).toBeNull();

    await restoreAsset(a.id);
    expect(await listAssets({ scope: "global_internal" })).toHaveLength(1);
  });

  it("soft-delete sets deleted_at; the asset disappears from reads and a repeat rejects", async () => {
    const a = await createAsset({ scope: "global_internal", assetType: "image", name: "x" });

    await softDeleteAsset(a.id);
    expect(await getAssetById(a.id)).toBeNull();
    expect(assetRows().find((r) => r.legacy_id === a.id)?.deleted_at).toBeTruthy();

    await expect(softDeleteAsset(a.id)).rejects.toThrow(/0 rows/);
  });
});

describe("Asset Center repository · links + variants", () => {
  it("creates and lists an active link, then archive removes it from the active list", async () => {
    const a = await createAsset({ scope: "website_public", visibility: "public", assetType: "video", name: "hero.mp4" });
    const link = await createAssetLink({
      assetId: a.id,
      entityType: "login_page",
      placementKey: "login_left_panel_video",
      scope: "website_public",
      visibility: "public",
    });

    const links = await listAssetLinks({ placementKey: "login_left_panel_video" });
    expect(links.map((l) => l.id)).toContain(link.id);

    await archiveAssetLink(link.id);
    expect(await listAssetLinks({ placementKey: "login_left_panel_video" })).toHaveLength(0);
  });

  it("resolves asset_id (uuid) from the asset's legacy id and denormalises customer_id", async () => {
    // Regression: links must carry the asset's real uuid, never a null asset_id
    // (asset_links.asset_id is a NOT NULL FK). Callers only pass the legacy id.
    const a = await createAsset({
      scope: "customer_internal",
      companyId: "cmp_1",
      companyUuid: "uuid-cmp-1",
      customerId: "cust_1",
      customerUuid: "uuid-cust-1",
      assetType: "image",
      name: "wo.webp",
    });
    await createAssetLink({
      assetId: a.id,
      companyId: "cmp_1",
      companyUuid: "uuid-cmp-1",
      entityType: "work_order",
      entityId: "wo_1",
      placementKey: "work_order_header_image",
      scope: "customer_internal",
    });

    const assetUuid = (mocks.client.tables.get("assets") ?? []).find(
      (r) => r.legacy_id === a.id,
    )?.id;
    const stored = (mocks.client.tables.get("asset_links") ?? [])[0];
    expect(assetUuid).toBeTruthy();
    expect(stored.asset_id).toBe(assetUuid); // satisfies the NOT NULL FK
    expect(stored.asset_legacy_id).toBe(a.id);
    expect(stored.customer_id).toBe("uuid-cust-1");
  });

  it("rejects linking an unknown asset and inserts no row (no null asset_id)", async () => {
    await expect(
      createAssetLink({
        assetId: "asset_missing",
        entityType: "work_order",
        placementKey: "work_order_image",
        scope: "customer_internal",
      }),
    ).rejects.toThrow(/was not found/);
    expect(mocks.client.tables.get("asset_links") ?? []).toHaveLength(0);
  });

  it("creates and lists a variant for an asset", async () => {
    const a = await createAsset({ scope: "global_internal", assetType: "image", name: "x" });
    await createAssetVariant({
      assetId: a.id,
      scope: "global_internal",
      variantType: "thumbnail",
      storageBucket: "private-assets",
      storagePath: "global/internal/x/thumb.webp",
    });

    const variants = await listAssetVariants(a.id);
    expect(variants).toHaveLength(1);
    expect(variants[0].variantType).toBe("thumbnail");
  });
});

describe("Asset Center repository · copy independence", () => {
  it("a company copy keeps its audit reference and survives deletion of the global original", async () => {
    const global = await createAsset({
      scope: "global_internal",
      assetType: "image",
      name: "master.webp",
    });
    const copy = await createAsset({
      scope: "company_internal",
      companyId: "cmp_nordlys",
      assetType: "image",
      name: "master.webp",
      copiedFromAssetId: global.id,
      copiedFromAssetLegacyId: global.id,
      sourceAssetId: global.id,
    });
    await recordAssetCopyHistory({
      sourceAssetLegacyId: global.id,
      sourceScope: "global_internal",
      copiedAssetLegacyId: copy.id,
      targetCompanyId: "cmp_nordlys",
      copiedBy: "user_admin",
    });

    // Delete the global original.
    await softDeleteAsset(global.id);
    expect(await getAssetById(global.id)).toBeNull();

    // The company copy is unaffected and retains its audit reference.
    const stillThere = await getAssetById(copy.id);
    expect(stillThere).not.toBeNull();
    expect(stillThere?.copiedFromAssetId).toBe(global.id);
  });
});

describe("Asset Center repository · activity audit", () => {
  it("records an append-only activity event", async () => {
    const a = await createAsset({ scope: "global_internal", assetType: "image", name: "x" });
    const event = await recordAssetActivityEvent({
      eventType: "asset_uploaded",
      assetId: a.id,
      actorUserId: "user_admin",
      scope: "global_internal",
      summary: "Uploaded master image",
    });
    expect(event.eventType).toBe("asset_uploaded");
    expect(event.assetId).toBe(a.id);
  });
});

describe("Asset Center repository · no localStorage authority", () => {
  it("never reads or writes localStorage; state survives a clear()", async () => {
    const a = await createAsset({ scope: "global_internal", assetType: "image", name: "x" });
    await updateAsset(a.id, { title: "y" });
    await createAssetLink({
      assetId: a.id,
      entityType: "service",
      placementKey: "service_card_image",
      scope: "company_internal",
    });

    expect(localStorage.length).toBe(0);

    // Clearing browser storage cannot change the persisted asset.
    localStorage.clear();
    expect((await getAssetById(a.id))?.title).toBe("y");
  });
});
